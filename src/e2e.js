// End-to-end packet layer for EVERYTHING the mesh sends over the store/transport (Supabase Realtime or the local bus).
//  - Every envelope is Ed25519-signed by the sender's mesh signing key (sig over id/from/to + payload; ttl excluded so relays work).
//  - Directed envelopes (to = one peer: starters, chats, acks, friend requests, burn, ...) are AES-GCM-256 encrypted with a
//    per-chat key = SHA-256("cm-chat-v1" | sorted(from,to) | X25519(mySecret, theirPublic)). The real type is inside the
//    ciphertext; on the wire the type is 'e2e'. Only broadcast presence pings (to '*') stay readable, and they are signed.
//  - X25519 public keys are announced in pings, signed with the Ed25519 key (xsig) and pinned trust-on-first-use.
//  - v43 ID BINDING (src/idbind.js): with a binder, a ping's (from, pub) must pass binder.check(from, pub, body.bd) BEFORE the key
//    is learned: bd = the sender's proof (server cert or self-signed proof-of-work claim). An ID already bound to another key is
//    refused (no TOFU race for someone else's ID); a newer server cert may rebind (old pins dropped). Without a binder: TOFU as before.
//  - v47 FORWARD SECRECY: pings also carry a rotating signed PREKEY pk = {id, x, s} (X25519, rotated every 24 h, s = Ed25519 over
//    code+xpub+id+x). Toward a peer that announced one, directed envelopes are 'v2': key = SHA-256("cm-chat-v2" | pair | epk | pk |
//    X25519(eph, theirPrekey) | X25519(myStatic, theirStatic)), where eph is a per-peer sender ephemeral rotated every 10 min or
//    256 messages (its secret is erased right after the key is derived) and epk/pk are signed + bound as AAD. Prekey secrets are
//    erased 8 days after the prekey was superseded (longer than any store-and-forward / server copy), so traffic recorded today
//    can't be decrypted later even with the phone's long-term keys. Old clients (no pk in their pings) still get v1 (static).
//  - assertSealed() refuses to post any plaintext directed envelope (in particular chat/starter); used by src/net.js.
import nacl from 'tweetnacl';
import { b64, unb64, rand } from './vault.js';
const S = () => globalThis.crypto.subtle, te = new TextEncoder(), td = new TextDecoder();
const stable = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : 1)) : x);
export const PLAINTEXT_FORBIDDEN = ['starter', 'chat', 'ack', 'blocked', 'freq', 'fok', 'burn'];
export class E2EError extends Error { constructor(r) { super('e2e: ' + r); this.code = 'E2E_' + r.toUpperCase().replace(/-/g, '_'); } }
export const newBoxKeys = () => { const k = nacl.box.keyPair(); return { xpub: b64(k.publicKey), xsec: b64(k.secretKey) }; };
export const PREKEY_ROTATE_MS = 24 * 3600e3, PREKEY_KEEP_MS = 8 * 24 * 3600e3, EPH_ROTATE_MS = 10 * 60e3, EPH_MAX_MSGS = 256, RX_CACHE = 256;
const okPre = x => x && typeof x.id === 'string' && x.id.length <= 24 && typeof x.xpub === 'string' && typeof x.xsec === 'string' && Number.isFinite(x.t);
// Throws if a packet would carry a plaintext directed/chat envelope.
export function assertSealed(m) {
  const e = m?.k === 'mesh' ? m.env : null; if (!e) return m;
  if (e.to !== '*' && !(e.type === 'e2e' && e.ct && e.sig)) throw new E2EError('plaintext-directed');
  if (PLAINTEXT_FORBIDDEN.includes(e.type) || (e.to === '*' && !e.sig)) throw new E2EError('plaintext-' + e.type);
  return m;
}
export class E2E {
  constructor({ code, keys, box = newBoxKeys(), prekeys = null, onPrekeys = null, now = () => Date.now(), binder = null, bindProof = null }) { Object.assign(this, { code, keys, box, binder, bindProof, onPrekeys, now }); this.peers = new Map(); this.aes = new Map(); this.bindDrops = 0;
    this.pre = (Array.isArray(prekeys) ? prekeys.filter(okPre).map(x => ({ ...x })) : []).sort((a, b) => a.t - b.t); this.eph = new Map(); this.rx = new Map(); this.fsStats = { v2out: 0, v1out: 0, v2in: 0, v1in: 0, noPrekey: 0 }; this._rotate(); }
  // v47: keep a current prekey; erase prekeys whose successor is older than PREKEY_KEEP_MS. Returns the current prekey.
  _rotate() { const t = this.now(); let ch = false, cur = this.pre[this.pre.length - 1];
    if (!cur || t - cur.t >= PREKEY_ROTATE_MS || cur.t > t + 3600e3) { const k = nacl.box.keyPair(); cur = { id: b64(rand(9)), xpub: b64(k.publicKey), xsec: b64(k.secretKey), t }; k.secretKey.fill(0); this.pre.push(cur); ch = true; }
    while (this.pre.length > 1 && t - this.pre[1].t > PREKEY_KEEP_MS) { const gone = this.pre.shift(); for (const [k, v] of this.rx) if (v.pk === gone.id) this.rx.delete(k); gone.xsec = null; ch = true; }
    if (ch) try { this.onPrekeys?.(this.prekeyList()); } catch {}
    return cur; }
  prekeyList() { return this.pre.map(({ id, xpub, xsec, t }) => ({ id, xpub, xsec, t })); }
  _prekeyAd(from) { const c = this._rotate(); return { id: c.id, x: c.xpub, s: this._sign({ code: from, xpub: this.box.xpub, pk: c.id, x: c.xpub }) }; }
  _sign(o) { return b64(nacl.sign.detached(te.encode(stable(o)), unb64(this.keys.sec))); }
  _verify(o, sig, pub) { try { return nacl.sign.detached.verify(te.encode(stable(o)), unb64(sig), unb64(pub)); } catch { return false; } }
  learn(code, pub, xpub, xsig, pk = null) { // TOFU pin: first Ed25519 key per code wins; xpub must be signed by it
    const cur = this.peers.get(code); if (cur && cur.pub !== pub) return false;
    if (!xpub || !this._verify({ code, xpub }, xsig, pub)) return false;
    if (cur?.xpub !== xpub) this.aes.delete(code);
    const pre = pk && typeof pk.id === 'string' && pk.id.length <= 24 && typeof pk.x === 'string' && pk.x.length <= 64 && this._verify({ code, xpub, pk: pk.id, x: pk.x }, pk.s, pub) ? { id: pk.id, x: pk.x, xpub } : null; // v47 signed prekey
    this.peers.set(code, { pub, xpub, pre }); return true;
  }
  xpubOf(code) { return this.peers.get(code)?.xpub || null; }
  async chatKey(peer) {
    if (this.aes.has(peer)) return this.aes.get(peer);
    const x = this.xpubOf(peer); if (!x) throw new E2EError('no-key');
    const shared = nacl.scalarMult(unb64(this.box.xsec), unb64(x)), pair = [this.code, peer].sort().join('|');
    const raw = await S().digest('SHA-256', new Uint8Array([...te.encode('cm-chat-v1|' + pair + '|'), ...shared])); shared.fill(0);
    const k = S().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); this.aes.set(peer, k); return k;
  }
  async _v2key(dhPre, dhStatic, from, to, epk, pk) {
    const pair = [from, to].sort().join('|'), raw = await S().digest('SHA-256', new Uint8Array([...te.encode('cm-chat-v2|' + pair + '|' + epk + '|' + pk + '|'), ...dhPre, ...dhStatic])); dhPre.fill(0); dhStatic.fill(0);
    return S().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); }
  // Sender ephemeral per peer: new one every EPH_ROTATE_MS / EPH_MAX_MSGS or when the peer's prekey/xpub changed; secret erased at once.
  async _sendKey(to, peer) { const t = this.now(); let st = this.eph.get(to);
    if (st && t - st.t < EPH_ROTATE_MS && st.n < EPH_MAX_MSGS && st.pk === peer.pre.id && st.xpub === peer.xpub) return st;
    const e = nacl.box.keyPair(), epk = b64(e.publicKey), dhP = nacl.scalarMult(e.secretKey, unb64(peer.pre.x)), dhS = nacl.scalarMult(unb64(this.box.xsec), unb64(peer.xpub)); e.secretKey.fill(0);
    const p = (async () => this._v2key(dhP, dhS, this.code, to, epk, peer.pre.id))();
    st = { t, n: 0, epk, pk: peer.pre.id, xpub: peer.xpub, key: await p }; this.eph.set(to, st); return st; }
  async _recvKey(from, peer, epk, pkid) { const ck = from + '|' + epk + '|' + pkid, hit = this.rx.get(ck); if (hit) { this.rx.delete(ck); this.rx.set(ck, hit); return hit.key; }
    const mine = this.pre.find(x => x.id === pkid && x.xsec); if (!mine) { this.fsStats.noPrekey++; return null; } // erased (forward secrecy) or unknown
    const e = unb64(epk); if (e.length !== 32) return null;
    const key = await this._v2key(nacl.scalarMult(unb64(mine.xsec), e), nacl.scalarMult(unb64(this.box.xsec), unb64(peer.xpub)), from, this.code, epk, pkid);
    this.rx.set(ck, { key, pk: pkid }); while (this.rx.size > RX_CACHE) this.rx.delete(this.rx.keys().next().value); return key; }
  sealBroadcast(env) { const { id, from, to, ttl } = env; // synchronous (pagehide 'bye' must go out before the page dies)
    { const body = { ...env.body, ...(env.type === 'ping' ? { xpub: this.box.xpub, xsig: this._sign({ code: from, xpub: this.box.xpub }), pk: this._prekeyAd(from), ...(this.bindProof ? { bd: this.bindProof } : {}) } : {}) };
      return { id, from, to, ttl, type: env.type, body, sig: this._sign({ id, from, to, type: env.type, body }) }; } }
  async seal(env) {
    const { id, from, to, ttl } = env;
    if (to === '*') return this.sealBroadcast(env);
    const peer = this.peers.get(to);
    if (peer?.pre && peer.pre.xpub === peer.xpub) { // v47 forward-secret path
      const st = await this._sendKey(to, peer), iv = rand(12), aad = te.encode(id + '|' + from + '|' + to + '|' + st.epk + '|' + st.pk); st.n++;
      const ct = b64(await S().encrypt({ name: 'AES-GCM', iv, additionalData: aad }, st.key, te.encode(JSON.stringify({ type: env.type, body: env.body }))));
      const o = { id, from, to, iv: b64(iv), ct, epk: st.epk, pk: st.pk }; this.fsStats.v2out++; return { ...o, ttl, type: 'e2e', sig: this._sign(o) };
    }
    this.fsStats.v1out++;
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
        if (!this.learn(env.from, b.pub, b.xpub, b.xsig, b.pk) && this.peers.get(env.from)?.pub !== b.pub) return null; return env; }
      const p = this.peers.get(env.from); return p && this._verify({ id: env.id, from: env.from, to: '*', type: env.type, body: b }, env.sig, p.pub) ? env : null; }
    if (env.to !== this.code || env.type !== 'e2e') return null;
    const p = this.peers.get(env.from); if (!p) return null;
    if (env.epk !== undefined || env.pk !== undefined) { // v47 forward-secret envelope
      if (typeof env.epk !== 'string' || typeof env.pk !== 'string' || env.epk.length > 64 || env.pk.length > 24) return null;
      if (!this._verify({ id: env.id, from: env.from, to: env.to, iv: env.iv, ct: env.ct, epk: env.epk, pk: env.pk }, env.sig, p.pub)) return null;
      try { const key = await this._recvKey(env.from, p, env.epk, env.pk); if (!key) return null;
        const pt = await S().decrypt({ name: 'AES-GCM', iv: unb64(env.iv), additionalData: te.encode(env.id + '|' + env.from + '|' + env.to + '|' + env.epk + '|' + env.pk) }, key, unb64(env.ct));
        const { type, body } = JSON.parse(td.decode(pt)); this.fsStats.v2in++; return { id: env.id, from: env.from, to: env.to, ttl: env.ttl, type, body }; } catch { return null; }
    }
    if (!this._verify({ id: env.id, from: env.from, to: env.to, iv: env.iv, ct: env.ct }, env.sig, p.pub)) return null;
    try { const pt = await S().decrypt({ name: 'AES-GCM', iv: unb64(env.iv), additionalData: te.encode(env.id + '|' + env.from + '|' + env.to) }, await this.chatKey(env.from), unb64(env.ct));
      const { type, body } = JSON.parse(td.decode(pt)); this.fsStats.v1in++; return { id: env.id, from: env.from, to: env.to, ttl: env.ttl, type, body }; } catch { return null; }
  }
}
