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
//  - v49 MULTI-DEVICE (v37-linked devices share the network ID + Ed25519 profile key but each has its OWN X25519 box key and
//    prekeys): every peer keeps a set of devices (max MAX_DEVS, each xpub signed by the profile key; pings add 'md: 1' = v49).
//    Message-type envelopes (MD_TYPES) to a user with several devices, or from a user with sibling devices, are 'v3':
//    {id, from, to, sx, xs, iv, ct, md: [{d, e, k, i, w}]} - the content is sealed ONCE with a random AES-GCM key that is wrapped
//    for every fresh v49 device of the recipient AND (chats: COPY_TYPES) every fresh v49 sibling device of the sender (their 'sent copy'), each wrap
//    with key = SHA-256("cm-chat-v3" | from | sender xpub | target code | target xpub | epk | pk | X25519(eph, device prekey) |
//    X25519(sender device static, device static)) (same forward secrecy as v2; per-(peer, device) ephemeral). Other types (calls,
//    games, living mesh) go to ONE preferred device. Pre-v49 devices of a multi-device user get their own v2/v1 envelope (same id),
//    and v1/v2 from a multi-device sender open by trying its known devices. One device on both sides: wire unchanged (v2/v1).
//  - assertSealed() refuses to post any plaintext directed envelope (in particular chat/starter); used by src/net.js.
import nacl from 'tweetnacl';
import { b64, unb64, rand } from './vault.js';
const S = () => globalThis.crypto.subtle, te = new TextEncoder(), td = new TextDecoder();
const stable = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : 1)) : x);
export const PLAINTEXT_FORBIDDEN = ['starter', 'chat', 'ack', 'blocked', 'freq', 'fok', 'burn'];
export class E2EError extends Error { constructor(r) { super('e2e: ' + r); this.code = 'E2E_' + r.toUpperCase().replace(/-/g, '_'); } }
export const newBoxKeys = () => { const k = nacl.box.keyPair(); return { xpub: b64(k.publicKey), xsec: b64(k.secretKey) }; };
export const MD_TYPES = new Set(['chat', 'rcpt', 'freq', 'fok', 'blocked', 'burn', 'ret', 'profile', 'ack', 'undeliv', 'dsync']), MAX_DEVS = 5, COPY_TYPES = new Set(['chat', 'dsync']), DEV_FRESH_MS = 15 * 60e3, MD_MAX = 12;
export const devId = xpub => String(xpub || '').slice(0, 16); // v49 device id on the wire (prefix of the device X25519 key)
const zero = u => u.every(x => x === 0);
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
  constructor({ code, keys, box = newBoxKeys(), prekeys = null, onPrekeys = null, now = () => Date.now(), binder = null, bindProof = null, onSibling = null }) { Object.assign(this, { code, keys, box, binder, bindProof, onPrekeys, onSibling, now }); this.peers = new Map(); this.aes = new Map(); this.bindDrops = 0; this.sibs = new Map();
    this.pre = (Array.isArray(prekeys) ? prekeys.filter(okPre).map(x => ({ ...x })) : []).sort((a, b) => a.t - b.t); this.eph = new Map(); this.rx = new Map(); this.fsStats = { v2out: 0, v1out: 0, v2in: 0, v1in: 0, noPrekey: 0, v3out: 0, v3in: 0, v3wraps: 0, copies: 0 }; this._rotate(); }
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
  _xsig() { return this._xs?.x === this.box.xpub ? this._xs.s : (this._xs = { x: this.box.xpub, s: this._sign({ code: this.code, xpub: this.box.xpub }) }).s; }
  // v49 device sets: Map xpub -> {xpub, pre, md, seen}, most recently seen last, at most MAX_DEVS (oldest dropped).
  _putDev(devs, xpub, pre, md, keepPre = false) { const old = devs.get(xpub); devs.delete(xpub);
    devs.set(xpub, { xpub, pre: pre || (keepPre ? old?.pre || null : null), md: !!md || (keepPre && !!old?.md), seen: this.now() }); while (devs.size > MAX_DEVS) devs.delete(devs.keys().next().value); }
  _okPre(code, xpub, pk, pub) { return pk && typeof pk.id === 'string' && pk.id.length <= 24 && typeof pk.x === 'string' && pk.x.length <= 64 && this._verify({ code, xpub, pk: pk.id, x: pk.x }, pk.s, pub) ? { id: pk.id, x: pk.x, xpub } : null; }
  learn(code, pub, xpub, xsig, pk = null, md = false) { // TOFU pin: first Ed25519 key per code wins; xpub must be signed by it
    if (code === this.code) return this._learnSib(pub, xpub, xsig, pk, md);
    const cur = this.peers.get(code); if (cur && cur.pub !== pub) return false;
    if (!xpub || typeof xpub !== 'string' || xpub.length > 64 || !this._verify({ code, xpub }, xsig, pub)) return false;
    const pre = this._okPre(code, xpub, pk, pub); // v47 signed prekey
    const devs = cur?.devs || new Map(); this._putDev(devs, xpub, pre, md); // v49: every linked device of this ID
    this.peers.set(code, { pub, xpub, pre, md: !!md, devs, rx: cur?.rx && devs.has(cur.rx) ? cur.rx : null }); return true;
  }
  // v49: a ping from MY OWN code with MY profile key but another X25519 key = one of my linked (v37) devices.
  _learnSib(pub, xpub, xsig, pk, md) { if (pub !== this.keys.pub || !xpub || typeof xpub !== 'string' || xpub.length > 64 || xpub === this.box.xpub || !this._verify({ code: this.code, xpub }, xsig, pub)) return false;
    const isNew = !this.sibs.has(xpub); this._putDev(this.sibs, xpub, this._okPre(this.code, xpub, pk, pub), md); if (isNew) try { this.onSibling?.(xpub); } catch {} return true; }
  siblings() { return this._fresh(this.sibs); }
  devicesOf(code) { const p = this.peers.get(code); return p ? [...p.devs.values()].map(d => ({ id: devId(d.xpub), md: d.md, fs: !!d.pre, seen: d.seen })) : []; }
  _fresh(devs, keep = null) { const t = this.now(); return [...devs.values()].filter(d => d.xpub === keep || t - d.seen <= DEV_FRESH_MS).reverse(); } // newest first
  _usable(d) { return !!d && (!!d.pre || !d.md); } // a v49 device known only from an envelope (its ping with the signed prekey not seen yet) is not targeted
  _pref(p) { const r = p.rx && p.devs.get(p.rx); return (this._usable(r) && r) || p.devs.get(p.xpub) || { xpub: p.xpub, pre: p.pre, md: p.md, seen: 0 }; } // the device that last wrote to us, else the last one that pinged
  xpubOf(code) { return this.peers.get(code)?.xpub || null; }
  _forget(code) { for (const k of [...this.aes.keys()]) if (k.startsWith(code + '|')) this.aes.delete(k); }
  async chatKey(peer, xpub = this.xpubOf(peer)) {
    const ck = peer + '|' + xpub; if (this.aes.has(ck)) return this.aes.get(ck);
    const x = xpub; if (!x) throw new E2EError('no-key');
    const shared = nacl.scalarMult(unb64(this.box.xsec), unb64(x)), pair = [this.code, peer].sort().join('|');
    const raw = await S().digest('SHA-256', new Uint8Array([...te.encode('cm-chat-v1|' + pair + '|'), ...shared])); shared.fill(0);
    const k = S().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); this.aes.set(ck, k); while (this.aes.size > RX_CACHE) this.aes.delete(this.aes.keys().next().value); return k;
  }
  async _v2key(dhPre, dhStatic, from, to, epk, pk) {
    const pair = [from, to].sort().join('|'), raw = await S().digest('SHA-256', new Uint8Array([...te.encode('cm-chat-v2|' + pair + '|' + epk + '|' + pk + '|'), ...dhPre, ...dhStatic])); dhPre.fill(0); dhStatic.fill(0);
    return S().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); }
  // Sender ephemeral per peer (v49: per peer DEVICE): new one every EPH_ROTATE_MS / EPH_MAX_MSGS or when the device's prekey/xpub changed; secret erased at once.
  async _sendKey(to, peer) { const t = this.now(), ek = to + '|' + peer.xpub; let st = this.eph.get(ek);
    if (st && t - st.t < EPH_ROTATE_MS && st.n < EPH_MAX_MSGS && st.pk === peer.pre.id && st.xpub === peer.xpub) return st;
    const e = nacl.box.keyPair(), epk = b64(e.publicKey), dhP = nacl.scalarMult(e.secretKey, unb64(peer.pre.x)), dhS = nacl.scalarMult(unb64(this.box.xsec), unb64(peer.xpub)); e.secretKey.fill(0);
    const p = (async () => this._v2key(dhP, dhS, this.code, to, epk, peer.pre.id))();
    st = { t, n: 0, epk, pk: peer.pre.id, xpub: peer.xpub, key: await p }; this.eph.set(ek, st); while (this.eph.size > RX_CACHE) this.eph.delete(this.eph.keys().next().value); return st; }
  async _recvKey(from, xpub, epk, pkid) { const ck = from + '|' + xpub + '|' + epk + '|' + pkid, hit = this.rx.get(ck); if (hit) { this.rx.delete(ck); this.rx.set(ck, hit); return hit.key; }
    const mine = this.pre.find(x => x.id === pkid && x.xsec); if (!mine) { this.fsStats.noPrekey++; return null; } // erased (forward secrecy) or unknown
    const e = unb64(epk); if (e.length !== 32) return null;
    const key = await this._v2key(nacl.scalarMult(unb64(mine.xsec), e), nacl.scalarMult(unb64(this.box.xsec), unb64(xpub)), from, this.code, epk, pkid);
    this.rx.set(ck, { key, pk: pkid }); while (this.rx.size > RX_CACHE) this.rx.delete(this.rx.keys().next().value); return key; }
  // v49 wrap keys: bound to sender ID + sender device, target ID + target device, ephemeral and prekey id.
  async _v3key(dhPre, dhStatic, from, sx, tcode, txpub, epk, pk) { if (zero(dhPre) || zero(dhStatic)) return null; // low-order key: refused
    const raw = await S().digest('SHA-256', new Uint8Array([...te.encode('cm-chat-v3|' + from + '|' + sx + '|' + tcode + '|' + txpub + '|' + epk + '|' + pk + '|'), ...dhPre, ...dhStatic])); dhPre.fill(0); dhStatic.fill(0);
    return S().importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); }
  async _sendKey3(tcode, dev) { const t = this.now(), ek = 'v3|' + tcode + '|' + dev.xpub; let st = this.eph.get(ek);
    if (st && t - st.t < EPH_ROTATE_MS && st.n < EPH_MAX_MSGS && st.pk === dev.pre.id && st.sx === this.box.xpub) return st;
    const e = nacl.box.keyPair(), epk = b64(e.publicKey), dhP = nacl.scalarMult(e.secretKey, unb64(dev.pre.x)), dhS = nacl.scalarMult(unb64(this.box.xsec), unb64(dev.xpub)); e.secretKey.fill(0);
    const key = await this._v3key(dhP, dhS, this.code, this.box.xpub, tcode, dev.xpub, epk, dev.pre.id); if (!key) return null;
    st = { t, n: 0, epk, pk: dev.pre.id, xpub: dev.xpub, sx: this.box.xpub, key }; this.eph.set(ek, st); while (this.eph.size > RX_CACHE) this.eph.delete(this.eph.keys().next().value); return st; }
  async _recvKey3(from, sx, epk, pkid) { const ck = 'v3|' + from + '|' + sx + '|' + epk + '|' + pkid, hit = this.rx.get(ck); if (hit) { this.rx.delete(ck); this.rx.set(ck, hit); return hit.key; }
    const mine = this.pre.find(x => x.id === pkid && x.xsec); if (!mine) { this.fsStats.noPrekey++; return null; }
    const e = unb64(epk), s = unb64(sx); if (e.length !== 32 || s.length !== 32) return null;
    const key = await this._v3key(nacl.scalarMult(unb64(mine.xsec), e), nacl.scalarMult(unb64(this.box.xsec), s), from, sx, this.code, this.box.xpub, epk, pkid); if (!key) return null;
    this.rx.set(ck, { key, pk: pkid }); while (this.rx.size > RX_CACHE) this.rx.delete(this.rx.keys().next().value); return key; }
  sealBroadcast(env) { const { id, from, to, ttl } = env; // synchronous (pagehide 'bye' must go out before the page dies)
    if (env.type === 'ping') this._pinged = this.now();
    { const body = { ...env.body, ...(env.type === 'ping' ? { xpub: this.box.xpub, xsig: this._sign({ code: from, xpub: this.box.xpub }), pk: this._prekeyAd(from), ...this._mdAd(), ...(this.bindProof ? { bd: this.bindProof } : {}) } : {}) };
      return { id, from, to, ttl, type: env.type, body, sig: this._sign({ id, from, to, type: env.type, body }) }; } }
  _mdAd() { return { md: 1 }; } // v49 capability: this device opens v3 multi-device envelopes
  // Legacy single-device envelope (v2 forward-secret when the device announced a prekey, else v1 static) for ONE device.
  async _sealOne(env, dev) { const { id, from, to, ttl } = env;
    if (dev.pre && dev.pre.xpub === dev.xpub) { // v47 forward-secret path
      const st = await this._sendKey(to, dev), iv = rand(12), aad = te.encode(id + '|' + from + '|' + to + '|' + st.epk + '|' + st.pk); st.n++;
      const ct = b64(await S().encrypt({ name: 'AES-GCM', iv, additionalData: aad }, st.key, te.encode(JSON.stringify({ type: env.type, body: env.body }))));
      const o = { id, from, to, iv: b64(iv), ct, epk: st.epk, pk: st.pk }; this.fsStats.v2out++; return { ...o, ttl, type: 'e2e', sig: this._sign(o) };
    }
    this.fsStats.v1out++;
    const iv = rand(12), aad = te.encode(id + '|' + from + '|' + to);
    const ct = b64(await S().encrypt({ name: 'AES-GCM', iv, additionalData: aad }, await this.chatKey(to, dev.xpub), te.encode(JSON.stringify({ type: env.type, body: env.body }))));
    const o = { id, from, to, iv: b64(iv), ct }; return { ...o, ttl, type: 'e2e', sig: this._sign(o) };
  }
  // v49: one envelope, content key wrapped for each target {code, dev} (v49 devices with a signed prekey only).
  async _seal3(env, targets) { const { id, from, to, ttl } = env, sx = this.box.xpub, ck = rand(32), iv = rand(12), md = [];
    for (const { code, dev } of targets) { const st = await this._sendKey3(code, dev); if (!st) continue; st.n++; const wi = rand(12), d = devId(dev.xpub);
      md.push({ d, e: st.epk, k: st.pk, i: b64(wi), w: b64(await S().encrypt({ name: 'AES-GCM', iv: wi, additionalData: te.encode('cm3w|' + id + '|' + d) }, st.key, ck)) }); }
    if (!md.length) { ck.fill(0); return null; }
    const key = await S().importKey('raw', ck, 'AES-GCM', false, ['encrypt']); ck.fill(0);
    const ct = b64(await S().encrypt({ name: 'AES-GCM', iv, additionalData: te.encode('cm3|' + id + '|' + from + '|' + to + '|' + sx) }, key, te.encode(JSON.stringify({ type: env.type, body: env.body }))));
    const o = { id, from, to, sx, xs: this._xsig(), iv: b64(iv), ct, md }; this.fsStats.v3out++; this.fsStats.v3wraps += md.length; return { ...o, ttl, type: 'e2e', sig: this._sign(o) };
  }
  // v49: every envelope needed so that ALL of the recipient's devices (and my own other devices, for message types) can open it.
  async sealAll(env) {
    const { to } = env; if (to === '*') return [this.sealBroadcast(env)];
    const multi = MD_TYPES.has(env.type), sibsAll = this._fresh(this.sibs), sibs = COPY_TYPES.has(env.type) ? sibsAll.filter(d => d.md && d.pre) : [];
    if (to === this.code) { const e = sibs.length ? await this._seal3(env, sibs.map(dev => ({ code: this.code, dev }))) : null; return e ? [e] : []; } // to my own devices only (dsync)
    const peer = this.peers.get(to); if (!peer) return [await this._sealOne(env, { xpub: this.xpubOf(to), pre: null })]; // unknown: throws no-key
    const devs = multi ? this._fresh(peer.devs, peer.xpub).filter(d => d.xpub === peer.xpub || this._usable(d)) : [this._pref(peer)], v3 = devs.filter(d => d.md && d.pre && d.pre.xpub === d.xpub);
    const out = [], useV3 = v3.length > 0 && (devs.length > 1 || sibsAll.length > 0);
    if (useV3 || sibs.length) { const e = await this._seal3(env, [...(useV3 ? v3 : []).map(dev => ({ code: to, dev })), ...sibs.map(dev => ({ code: this.code, dev }))]); if (e) out.push(e); }
    for (const dev of devs) if (!(useV3 && v3.includes(dev))) out.push(await this._sealOne(env, dev)); // pre-v49 devices (or single device): v2/v1 as before
    return out;
  }
  async seal(env) { return (await this.sealAll(env))[0] || null; }
  // v49: a pre-v49 device pins only the LAST device of an ID that pinged it; when I have linked siblings, the app pings right
  // before a directed send to such a device so its v2/v1 envelope from THIS device opens there (ping is posted first, synchronously).
  wantsPing(to, type) { if (to === '*' || to === this.code || !this._fresh(this.sibs).length) return false; const p = this.peers.get(to); if (!p) return false;
    if (Math.max(...[...this.sibs.values()].map(d => d.seen)) <= (this._pinged || -1)) return false; // no sibling pinged since my last ping
    const devs = MD_TYPES.has(type) ? this._fresh(p.devs, p.xpub) : [this._pref(p)]; return devs.some(d => !d.md); }
  // v49: open a v3 envelope (one wrap is mine). From a peer (to = me) or a sibling device of mine (from = me: sent copy / dsync).
  async _open3(env) {
    if (env.type !== 'e2e' || typeof env.sx !== 'string' || env.sx.length > 64 || typeof env.xs !== 'string' || typeof env.ct !== 'string' || typeof env.iv !== 'string' || !Array.isArray(env.md) || !env.md.length || env.md.length > MD_MAX) return null;
    const own = env.from === this.code; if (!own && env.to !== this.code) return null; if (own && env.sx === this.box.xpub) return null; // my own packet echoed back
    const p = own ? null : this.peers.get(env.from), pub = own ? this.keys.pub : p?.pub; if (!pub) return null;
    const myD = devId(this.box.xpub), w = env.md.find(x => x && x.d === myD); if (!w || typeof w.e !== 'string' || typeof w.k !== 'string' || typeof w.i !== 'string' || typeof w.w !== 'string' || w.e.length > 64 || w.k.length > 24 || w.w.length > 128) return null;
    const o = { id: env.id, from: env.from, to: env.to, sx: env.sx, xs: env.xs, iv: env.iv, ct: env.ct, md: env.md };
    if (!this._verify(o, env.sig, pub) || !this._verify({ code: env.from, xpub: env.sx }, env.xs, pub)) return null;
    try { const key = await this._recvKey3(env.from, env.sx, w.e, w.k); if (!key) return null;
      const ck = new Uint8Array(await S().decrypt({ name: 'AES-GCM', iv: unb64(w.i), additionalData: te.encode('cm3w|' + env.id + '|' + myD) }, key, unb64(w.w)));
      const ckey = await S().importKey('raw', ck, 'AES-GCM', false, ['decrypt']); ck.fill(0);
      const pt = await S().decrypt({ name: 'AES-GCM', iv: unb64(env.iv), additionalData: te.encode('cm3|' + env.id + '|' + env.from + '|' + env.to + '|' + env.sx) }, ckey, unb64(env.ct));
      const { type, body } = JSON.parse(td.decode(pt));
      if (own) { this._putDev(this.sibs, env.sx, null, true, true); this.fsStats.copies++; } else { this._putDev(p.devs, env.sx, null, true, true); p.rx = env.sx; } // signed by the profile key: a device of that ID
      this.fsStats.v3in++; return { id: env.id, from: env.from, to: env.to, ttl: env.ttl, type, body, ...(own ? { copy: true } : {}) }; } catch { return null; }
  }
  // Returns the plaintext envelope, or null (bad signature / unknown sender / not for us / tamper).
  async open(env) {
    if (!env?.sig) return null;
    if (env.to === '*') { const b = env.body || {};
      if (env.type === 'ping' && b.pub) { if (!this._verify({ id: env.id, from: env.from, to: '*', type: env.type, body: b }, env.sig, b.pub)) return null;
        if (this.binder) { const r = this.binder.check(env.from, b.pub, b.bd || null); if (!r.ok) { this.bindDrops++; return null; } if (r.rebound) { this.peers.delete(env.from); this._forget(env.from); } } // v43: ID must be bound to this key
        if (!this.learn(env.from, b.pub, b.xpub, b.xsig, b.pk, b.md === 1) && this.peers.get(env.from)?.pub !== b.pub) return null; return env; }
      const p = this.peers.get(env.from); return p && this._verify({ id: env.id, from: env.from, to: '*', type: env.type, body: b }, env.sig, p.pub) ? env : null; }
    if (env.md !== undefined) return this._open3(env); // v49 multi-device envelope
    if (env.to !== this.code || env.type !== 'e2e') return null;
    const p = this.peers.get(env.from); if (!p) return null;
    const cands = [...new Set([p.rx, p.xpub, ...[...p.devs.keys()].reverse()].filter(Boolean))]; // v49: a pre-v49 (or single-envelope) sender may be any of that ID's devices
    if (env.epk !== undefined || env.pk !== undefined) { // v47 forward-secret envelope
      if (typeof env.epk !== 'string' || typeof env.pk !== 'string' || env.epk.length > 64 || env.pk.length > 24) return null;
      if (!this._verify({ id: env.id, from: env.from, to: env.to, iv: env.iv, ct: env.ct, epk: env.epk, pk: env.pk }, env.sig, p.pub)) return null;
      for (const xp of cands) try { const key = await this._recvKey(env.from, xp, env.epk, env.pk); if (!key) return null;
        const pt = await S().decrypt({ name: 'AES-GCM', iv: unb64(env.iv), additionalData: te.encode(env.id + '|' + env.from + '|' + env.to + '|' + env.epk + '|' + env.pk) }, key, unb64(env.ct));
        const { type, body } = JSON.parse(td.decode(pt)); this.fsStats.v2in++; if (cands.length > 1) p.rx = xp; return { id: env.id, from: env.from, to: env.to, ttl: env.ttl, type, body }; } catch { this.rx.delete(env.from + '|' + xp + '|' + env.epk + '|' + env.pk); }
      return null;
    }
    if (!this._verify({ id: env.id, from: env.from, to: env.to, iv: env.iv, ct: env.ct }, env.sig, p.pub)) return null;
    for (const xp of cands) try { const pt = await S().decrypt({ name: 'AES-GCM', iv: unb64(env.iv), additionalData: te.encode(env.id + '|' + env.from + '|' + env.to) }, await this.chatKey(env.from, xp), unb64(env.ct));
      const { type, body } = JSON.parse(td.decode(pt)); this.fsStats.v1in++; if (cands.length > 1) p.rx = xp; return { id: env.id, from: env.from, to: env.to, ttl: env.ttl, type, body }; } catch {}
    return null;
  }
}
