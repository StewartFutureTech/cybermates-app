// One-time encrypted friend link (Friends tab → "Create friend link").
// The creator's phone shows a short single-use code (12 Crockford-base32 chars = 60 bits, "ABCD-EFGH-JKMN").
// The other person types it into the Friends search bar. The RAW CODE NEVER LEAVES EITHER PHONE:
//   K   = PBKDF2-SHA256(code, 'cybermates/flink/v1', 20k iters)    (slows offline guessing of an observed tag)
//   tag = HMAC(K, 'tag')[0..12]                                     (lookup handle; relays see only this)
// Protocol (all bodies are hashes/MACs; the band is sent only inside directed, E2E-sealed envelopes):
//   joiner → '*'    flj {t, n, m=HMAC(K, j|joiner|n)}               broadcast, proves knowledge of the code, bound to sender id
//   host   → joiner flo {n, m=HMAC(K, h|host|joiner|n), a=band}     proves the host holds the code (no spoofed host)
//   joiner → host   flf {n, m=HMAC(K, f|joiner|host|n), a=band}     then BOTH send a bare friend request; each auto-accepts
// Session stays open (several people may join) until closed (burned) or expired (default 15 min).
// Refused silently: blocked / banned peers, adult<->minor (age band mismatch), expired/burned codes, bad MACs, rate limit.
import { isMinor } from './discovery.js';
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I L O U)
export const CODE_LEN = 12, KDF_ITERS = 20000, EXPIRY_CHOICES = [5, 15, 60], DEFAULT_EXPIRY_MIN = 15, MAX_TRIES_PER_PEER = 5;
export const JOIN_RETRIES = 3, JOIN_RETRY_MS = 2500;
export const FL_TYPES = new Set(['flj', 'flo', 'flf']);
const te = new TextEncoder(), subtle = () => globalThis.crypto.subtle;
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
export function genCode(rnd = n => globalThis.crypto.getRandomValues(new Uint8Array(n))) {
  const out = []; while (out.length < CODE_LEN) for (const x of rnd(16)) if (x < 224 && out.length < CODE_LEN) out.push(ALPHABET[x % 32]); // 224 = 7*32: unbiased
  return out.join('').replace(/(.{4})(?=.)/g, '$1-'); }
// Typing-friendly: case-insensitive, dashes/spaces ignored, I/L→1, O→0, U→V
export function normalize(s) { const c = String(s || '').toUpperCase().replace(/[\s\-_.]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0').replace(/U/g, 'V');
  return c.length === CODE_LEN && [...c].every(ch => ALPHABET.includes(ch)) ? c : null; }
export const looksLikeCode = s => !!normalize(s);
export async function deriveKey(code, iters = KDF_ITERS) { const c = normalize(code); if (!c) throw new Error('bad-code');
  const base = await subtle().importKey('raw', te.encode(c), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('cybermates/flink/v1'), iterations: iters }, base, 256);
  const key = await subtle().importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = async (...parts) => hex(await subtle().sign('HMAC', key, te.encode(parts.join('|'))));
  return { tag: (await mac('tag')).slice(0, 24), mac }; }
const eq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && [...a].reduce((d, ch, i) => d | (ch.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;
const nonce = () => hex(globalThis.crypto.getRandomValues(new Uint8Array(12)));
export const band = me => isMinor(me) ? 'minor' : 'adult';
export const bandsOk = (a, b) => (a === 'adult' || a === 'minor') && a === b; // no adult<->minor links, ever

// api: { node, me, requestFriend(c), isBlocked(c), isBanned(c), now?, iters?, onEvent? }
export class FriendLinks {
  constructor(api) { this.api = { now: Date.now, iters: KDF_ITERS, onEvent: () => {}, ...api }; this.host = null; this.joins = new Map(); this.expect = new Set(); this.tries = new Map(); this.installed = false; }
  get node() { return this.api.node; }
  refused(c) { return c === this.node.code || this.node.blocked?.has(c) || this.api.isBlocked?.(c) || this.api.isBanned?.(c); }
  // ---- host side ----
  async open({ minutes = DEFAULT_EXPIRY_MIN } = {}) { this.close(); if (!EXPIRY_CHOICES.includes(minutes)) minutes = DEFAULT_EXPIRY_MIN;
    const code = genCode(), k = await deriveKey(code, this.api.iters); this.host = { code, ...k, exp: this.api.now() + minutes * 60e3, minutes, added: [], used: new Set() }; this.api.onEvent('flink-open'); return { code, exp: this.host.exp }; }
  close() { if (this.host) { this.host.mac = null; this.host = null; this.api.onEvent('flink-burned'); } } // burn: key material dropped
  active() { if (this.host && this.api.now() > this.host.exp) this.close(); return this.host; }
  status() { const h = this.active(); return h ? { code: h.code, exp: h.exp, minutes: h.minutes, added: [...h.added] } : null; }
  async on_flj(from, b) { const h = this.active(); if (!h || !b || b.t !== h.tag || typeof b.n !== 'string' || b.n.length > 64 || h.used.has(b.n)) return;
    if (this.pendingHost?.get(from) === b.n) return this.replyJoin(h, from, b.n); // joiner re-broadcast: answer again
    const t = (this.tries.get(from) || 0) + 1; this.tries.set(from, t); if (t > MAX_TRIES_PER_PEER || this.refused(from)) return;
    if (!eq(b.m, await h.mac('j', from, b.n))) return;
    this.pendingHost ||= new Map(); this.pendingHost.set(from, b.n); return this.replyJoin(h, from, b.n); }
  async replyJoin(h, from, n) { try { this.node.ping?.(); } catch {} // our keys first, so the joiner can open the sealed reply
    this.node.send(from, 'flo', { n, m: await h.mac('h', this.node.code, from, n), a: band(this.api.me) }); }
  async on_flf(from, b) { const h = this.active(), n = this.pendingHost?.get(from); if (!h || !n || !b || b.n !== n) return; this.pendingHost.delete(from); h.used.add(n);
    if (!eq(b.m, await h.mac('f', from, this.node.code, n)) || this.refused(from)) return;
    if (!bandsOk(band(this.api.me), b.a) || this.peerBandConflict(from)) { this.api.onEvent('flink-age-refused', from); return; }
    if (!h.added.includes(from)) h.added.push(from); this.befriend(from); }
  // ---- joiner side ----
  async join(input) { const code = normalize(input); if (!code) return { ok: false, reason: 'bad-code' };
    const k = await deriveKey(code, this.api.iters), n = nonce(), j = { ...k, at: this.api.now(), tries: 0 }; this.joins.set(n, j);
    const body = { t: k.tag, n, m: await k.mac('j', this.node.code, n) };
    // announce our keys first (a stranger's broadcast is only opened once its signing/X25519 keys are known), then the join;
    // re-broadcast the same packet a few times in case the host missed it (host de-duplicates by nonce)
    const go = () => { if (!this.joins.has(n) || j.tries++ >= JOIN_RETRIES) return; try { this.node.ping?.(); } catch {} this.node.send('*', 'flj', body); j.timer = setTimeout(go, JOIN_RETRY_MS); j.timer?.unref?.(); };
    go(); return { ok: true, n }; }
  async on_flo(from, b) { const j = b && this.joins.get(b.n); if (!j || this.api.now() - j.at > 60e3 || this.refused(from)) return;
    if (!eq(b.m, await j.mac('h', from, this.node.code, b.n))) return; clearTimeout(j.timer); this.joins.delete(b.n);
    if (!bandsOk(band(this.api.me), b.a) || this.peerBandConflict(from)) { this.api.onEvent('flink-age-refused', from); return; }
    this.node.send(from, 'flf', { n: b.n, m: await j.mac('f', this.node.code, from, b.n), a: band(this.api.me) }); this.befriend(from); this.api.onEvent('flink-joined', from); }
  // a signed public profile that says minor/adult overrides a self-declared band claim
  peerBandConflict(c) { const p = this.node.view?.(c)?.profile; if (!p || (p.age == null && p.minor == null)) return false; return band(p) !== band(this.api.me); }
  befriend(c) { this.expect.add(c); if (this.node.friends.has(c)) return; if (this.node.pendingIn.has(c)) { this.node.acceptFriend(c); this.api.onEvent('flink-friend', c); return; }
    Promise.resolve(this.api.requestFriend(c)).catch(() => {}); this.api.onEvent('flink-friend', c); }
  // Install on a MeshNode: admit the three flink types from strangers (the node's accept-before-any-message filter would
  // drop them) and auto-accept requests from peers that proved the code. Blocked senders are still dropped by the node.
  install() { if (this.installed) return this; this.installed = true; const node = this.node, self = this;
    const recv = node.receive.bind(node);
    node.receive = function (env) { if (env && FL_TYPES.has(env.type) && !node.seen.has(env.id) && (env.to === node.code || env.to === '*') && env.from !== node.code) {
        node.seen.add(env.id); if (env.to === '*' && env.ttl > 1) node.net.forward?.({ ...env, ttl: env.ttl - 1 }, node); // same dedupe + relay as the node
        node.presence.set(env.from, node.now()); if (node.blocked.has(env.from)) return;
        const body = env.body && typeof env.body === 'object' && JSON.stringify(env.body).length < 512 ? env.body : null; if (body) self['on_' + env.type](env.from, body).catch(() => {}); return; }
      return recv(env); };
    const freq = node.on_freq.bind(node);
    node.on_freq = function (from, b, env) { freq(from, b, env); if (self.expect.has(from) && node.pendingIn.has(from) && b?.mode !== 'dating') { node.acceptFriend(from, b.pub); self.expect.delete(from); self.api.onEvent('flink-accepted', from); } };
    const fok = node.on_fok.bind(node); node.on_fok = function (f, b) { fok(f, b); if (node.friends.has(f)) self.expect.delete(f); };
    return this; }
}
