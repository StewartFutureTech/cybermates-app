// End-to-end packet layer for EVERYTHING the mesh sends over the store/transport (Supabase Realtime or the local bus).
//  - Every envelope is Ed25519-signed by the sender's mesh signing key (sig over id/from/to + payload; ttl excluded so relays work).
//  - Directed envelopes (to = one peer: starters, chats, acks, friend requests, burn, ...) are AES-GCM-256 encrypted with a
//    per-chat key = SHA-256("cm-chat-v1" | sorted(from,to) | X25519(mySecret, theirPublic)). The real type is inside the
//    ciphertext; on the wire the type is 'e2e'. Only broadcast presence pings (to '*') stay readable, and they are signed.
//  - X25519 public keys are announced in pings, signed with the Ed25519 key (xsig) and pinned trust-on-first-use.
//  - v43 ID BINDING (src/idbind.js): with a binder, a ping's (from, pub) must pass binder.check(from, pub, body.bd) BEFORE the key
//    is learned: bd = the sender's proof (server cert or self-signed proof-of-work claim). An ID already bound to another key is
//    refused (no TOFU race for someone else's ID); a newer server cert may rebind (old pins dropped). Without a binder: TOFU as before.
//  - assertSealed() refuses to post any plaintext directed envelope (in particular chat/starter); used by src/net.js.
import nacl from 'tweetnacl';
import { b64, unb64, rand } from './vault.js';
const S = () => globalThis.crypto.subtle, te = new TextEncoder(), td = new TextDecoder();
const stable = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : 1)) : x);
export const PLAINTEXT_FORBIDDEN = ['starter', 'chat', 'ack', 'blocked', 'freq', 'fok', 'burn'];
export class E2EError extends Error { constructor(r) { super('e2e: ' + r); this.code = 'E2E_' + r.toUpperCase().replace(/-/g, '_'); } }
export const newBoxKeys = () => { const k = nacl.box.keyPair(); return { xpub: b64(k.publicKey), xsec: b64(k.secretKey) }; };
// Throws if a packet would carry a plaintext directed/chat envelope.
export function assertSealed(m) {
  const e = m?.k === 'mesh' ? m.env : null; if (!e) return m;
  if (e.to !== '*' && !(e.type === 'e2e' && e.ct && e.sig)) throw new E2EError('plaintext-directed');
  if (PLAINTEXT_FORBIDDEN.includes(e.type) || (e.to === '*' && !e.sig)) throw new E2EError('plaintext-' + e.type);
  return m;
}
export class E2E {
  constructor({ code, keys, box = newBoxKeys(), binder = null, bindProof = null }) { Object.assign(this, { code, keys, box, binder, bindProof }); this.peers = new Map(); this.aes = new Map(); this.bindDrops = 0; }
  _sign(o) { return b64(nacl.sign.detached(te.encode(stable(o)), unb64(this.keys.sec))); }
  _verify(o, sig, pub) { try { return nacl.sign.detached.verify(te.encode(stable(o)), unb64(sig), unb64(pub)); } catch { return false; } }
  learn(code, pub, xpub, xsig) { // TOFU pin: first Ed25519 key per code wins; xpub must be signed by it
    const cur = this.peers.get(code); if (cur && cur.pub !== pub) return false;
    if (!xpub || !this._verify({ code, xpub }, xsig, pub)) return false;
    if (cur?.xpub !== xpub) this.aes.delete(code);
    this.peers.set(code, { pub, xpub }); return true;
  }
  xpubOf(code) { return this.peers.get(code)?.xpub || null; }
  async chatKey(peer) {
    if (this.aes.has(peer)) return this.aes.get(peer);
    const x = this.xpubOf(peer); if (!x) throw new E2EError('no-key');
    const shared = nacl.scalarMult(unb64(this.box.xsec), unb64(x)), pair = [this.code, peer].sort().join('|');
    const raw = await S().digest('SHA-256', new Uint8Array([...te.encode('cm-chat-v1|' + pair + '|'), ...shared])); shared.fill(0);
    const k = S().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); this.aes.set(peer, k); return k;
  }
  sealBroadcast(env) { const { id, from, to, ttl } = env; // synchronous (pagehide 'bye' must go out before the page dies)
    { const body = { ...env.body, ...(env.type === 'ping' ? { xpub: this.box.xpub, xsig: this._sign({ code: from, xpub: this.box.xpub }), ...(this.bindProof ? { bd: this.bindProof } : {}) } : {}) };
      return { id, from, to, ttl, type: env.type, body, sig: this._sign({ id, from, to, type: env.type, body }) }; } }
  async seal(env) {
    const { id, from, to, ttl } = env;
    if (to === '*') return this.sealBroadcast(env);
    const iv = rand(12), aad = te.encode(id + '|' + from + '|' + to);
    const ct = b64(await S().encrypt({ name: 'AES-GCM', iv, additionalData: aad }, await this.chatKey(to), te.encode(JSON.stringify({ type: env.type, body: env.body }))));
    const o = { id, from, to, iv: b64(iv), ct }; return { ...o, ttl, type: 'e2e', sig: this._sign(o) };
  }
  // Returns the plaintext envelope, or null (bad signature / unknown sender / not for us / tamper).
  async open(env) {
    if (!env?.sig) return null;
    if (env.to === '*') { const b = env.body || {};
      if (env.type === 'ping' && b.pub) { if (!this._verify({ id: env.id, from: env.from, to: '*', type: env.type, body: b }, env.sig, b.pub)) return null;
        if (this.binder) { const r = this.binder.check(env.from, b.pub, b.bd || null); if (!r.ok) { this.bindDrops++; return null; } if (r.rebound) { this.peers.delete(env.from); this.aes.delete(env.from); } } // v43: ID must be bound to this key
        if (!this.learn(env.from, b.pub, b.xpub, b.xsig) && this.peers.get(env.from)?.pub !== b.pub) return null; return env; }
      const p = this.peers.get(env.from); return p && this._verify({ id: env.id, from: env.from, to: '*', type: env.type, body: b }, env.sig, p.pub) ? env : null; }
    if (env.to !== this.code || env.type !== 'e2e') return null;
    const p = this.peers.get(env.from); if (!p) return null;
    if (!this._verify({ id: env.id, from: env.from, to: env.to, iv: env.iv, ct: env.ct }, env.sig, p.pub)) return null;
    try { const pt = await S().decrypt({ name: 'AES-GCM', iv: unb64(env.iv), additionalData: te.encode(env.id + '|' + env.from + '|' + env.to) }, await this.chatKey(env.from), unb64(env.ct));
      const { type, body } = JSON.parse(td.decode(pt)); return { id: env.id, from: env.from, to: env.to, ttl: env.ttl, type, body }; } catch { return null; }
  }
}
