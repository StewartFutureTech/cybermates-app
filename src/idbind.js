// v43 IDENTITY BINDING (P0 "ID spoofing"): bind each public ID code to ONE Ed25519 signing key, so a packet / advert / server
// call that claims an ID must verify against the key that ID is bound to, and an ID can't be claimed by a different key.
// The ID itself stays device-derived (src/identity.js: stable across reinstalls, so bans stick); the signing key is random per
// install (src/mesh.js newSigningKeys). Two kinds of proof travel with a key ("bd" in pings, "bind" in bootstrap calls):
//  1) CLAIM (self-signed, every client):  { v:1, code, pub, iat, pw:{ b, k, n:[k nonces] }, sig }
//     sig = Ed25519(pub's secret) over the canonical claim, and pw = a proof of work over (code, pub, iat): k independent
//     sub-puzzles SHA-256(seed | i | n_i) with >= b leading zero bits. That is the JOIN COST for web (unattested) clients:
//     minting a claim for an ID costs ~k*2^b hashes (default 10 x 2^16 ~ 655k; ~0.35 s desktop node, ~0.5 s desktop Chrome, ~1.5-2 s at 4x CPU throttle;
//     k sub-puzzles keep the variance low), verifying costs k hashes + 1 signature. Done ONCE per (ID, key), cached in the vault.
//  2) CERT (server-signed, optional): { v:1, code, pub, att, iat, exp, ss } signed by the bootstrap server's binding key
//     (env ID_BIND_SEED on Vercel; phones verify with VITE_ID_BIND_PUBKEY). The server registry (api/_lib/idbind.js) keeps one
//     key per ID, so a cert always wins over a claim and a newer cert (server-approved rebind) replaces an older pin.
// Peers keep an IdBinder: first valid proof pins code<->pub (one key per ID AND one ID per key). A different key for a pinned
// ID is refused unless it carries a NEWER server cert. No proof + no pin = refused (strangers must pay the join cost).
// ATTESTATION (Play Integrity / App Attest) is a hook only: attested clients would get the lighter ATTESTED_POW and instant
// rebinds, but server-side verification is not implemented (api/_fn/attest.js returns attested:false), so nobody gets it yet.
import nacl from 'tweetnacl';
import { b64, unb64 } from './vault.js';
export const BIND_V = 1, POW = { b: 16, k: 10 }, REBIND_POW = { b: 16, k: 20 }, ATTESTED_POW = { b: 12, k: 4 }, POW_MAX = { b: 24, k: 32 };
export const CERT_TTL_MS = 7 * 864e5, CLAIM_SKEW_MS = 10 * 60e3, PIN_MAX = 50_000;
const te = new TextEncoder(), CODE_RE = /^[A-Z0-9]{4,16}$/;
const validPub = p => { try { return typeof p === 'string' && p.length <= 64 && unb64(p).length === 32; } catch { return false; } };
// ---- SHA-256: full (for the seed) + a specialised single-block compress for the 40-byte PoW message (fast loop, no allocs)
const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
const H0 = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
const W = new Uint32Array(64), HS = new Uint32Array(8);
function compress(h, w) { // w[0..15] filled; h updated in place
  for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = (((a >>> 7 | a << 25) ^ (a >>> 18 | a << 14) ^ a >>> 3) + w[i - 16] + ((b >>> 17 | b << 15) ^ (b >>> 19 | b << 13) ^ b >>> 10) + w[i - 7]) | 0; }
  let A = h[0], B = h[1], C = h[2], D = h[3], E = h[4], F = h[5], G = h[6], Hh = h[7];
  for (let i = 0; i < 64; i++) { const t1 = (Hh + ((E >>> 6 | E << 26) ^ (E >>> 11 | E << 21) ^ (E >>> 25 | E << 7)) + ((E & F) ^ (~E & G)) + K[i] + w[i]) | 0, t2 = (((A >>> 2 | A << 30) ^ (A >>> 13 | A << 19) ^ (A >>> 22 | A << 10)) + ((A & B) ^ (A & C) ^ (B & C))) | 0; Hh = G; G = F; F = E; E = (D + t1) | 0; D = C; C = B; B = A; A = (t1 + t2) | 0; }
  h[0] = (h[0] + A) | 0; h[1] = (h[1] + B) | 0; h[2] = (h[2] + C) | 0; h[3] = (h[3] + D) | 0; h[4] = (h[4] + E) | 0; h[5] = (h[5] + F) | 0; h[6] = (h[6] + G) | 0; h[7] = (h[7] + Hh) | 0; }
export function sha256Bytes(bytes) { // small inputs only (seed strings), same output as WebCrypto SHA-256
  const L = bytes.length, n = ((L + 9 + 63) >> 6) << 6, m = new Uint8Array(n); m.set(bytes); m[L] = 0x80; const bits = L * 8; m[n - 4] = bits >>> 24; m[n - 3] = bits >>> 16; m[n - 2] = bits >>> 8; m[n - 1] = bits; m[n - 5] = Math.floor(bits / 2 ** 32);
  const h = new Uint32Array(H0); for (let o = 0; o < n; o += 64) { for (let i = 0; i < 16; i++) W[i] = m[o + 4 * i] << 24 | m[o + 4 * i + 1] << 16 | m[o + 4 * i + 2] << 8 | m[o + 4 * i + 3]; compress(h, W); }
  const out = new Uint8Array(32); for (let i = 0; i < 8; i++) { out[4 * i] = h[i] >>> 24; out[4 * i + 1] = h[i] >>> 16; out[4 * i + 2] = h[i] >>> 8; out[4 * i + 3] = h[i]; } return out; }
const seedWords = seed => { const s = new Uint32Array(8); for (let i = 0; i < 8; i++) s[i] = seed[4 * i] << 24 | seed[4 * i + 1] << 16 | seed[4 * i + 2] << 8 | seed[4 * i + 3]; return s; };
// leading-zero-bit test of SHA-256(seed(32) | u32 i | u32 n): single padded block (40 bytes -> length 320 bits)
function powHit(sw, i, n, b) { for (let j = 0; j < 8; j++) W[j] = sw[j]; W[8] = i; W[9] = n; W[10] = 0x80000000; W[11] = W[12] = W[13] = W[14] = 0; W[15] = 320;
  HS.set(H0); compress(HS, W); if (b <= 32) return b === 0 || (HS[0] >>> (32 - b)) === 0; return HS[0] === 0 && (HS[1] >>> (64 - b)) === 0; }
export const powSeed = ({ code, pub, iat, b, k }) => sha256Bytes(te.encode(`cm-idbind-v1|${code}|${pub}|${iat}|${b}|${k}`));
// Solve k sub-puzzles. Yields to the event loop every `slice` hashes (UI never freezes); onProgress(done, k).
export async function solvePow(params, { slice = 50000, onProgress = () => {}, yieldFn = () => new Promise(r => setTimeout(r, 0)), maxHashes = 2 ** 31 } = {}) {
  const { b, k } = params, sw = seedWords(powSeed(params)), n = []; let hashes = 0;
  for (let i = 0; i < k; i++) { let x = 0; for (;;) { if (powHit(sw, i, x, b)) break; x = (x + 1) >>> 0; if (++hashes % slice === 0) { if (hashes > maxHashes) throw new Error('pow: gave up'); await yieldFn(); } } n.push(x); onProgress(i + 1, k); }
  return { n, hashes };
}
export function verifyPow(params, n) { if (!Array.isArray(n) || n.length !== params.k) return false; const sw = seedWords(powSeed(params));
  for (let i = 0; i < n.length; i++) { const x = n[i]; if (!Number.isInteger(x) || x < 0 || x > 0xffffffff || !powHit(sw, i, x >>> 0, params.b)) return false; } return true; }
export const powWork = p => p.k * 2 ** p.b; // expected hashes
const meets = (pw, min) => pw && Number.isInteger(pw.b) && Number.isInteger(pw.k) && pw.b <= POW_MAX.b && pw.k <= POW_MAX.k && pw.b >= 0 && pw.k >= 1 && powWork(pw) >= powWork(min) && pw.b >= Math.min(min.b, 12);
// ---- claims
const claimMsg = c => te.encode(`cm-idbind-claim-v1|${c.code}|${c.pub}|${c.iat}|${c.pw.b}|${c.pw.k}|${c.pw.n.join(',')}`);
// signFn (optional): custom Ed25519 signer msg -> 64-byte sig (e.g. a node:crypto KeyObject in tests); default = keys.sec (tweetnacl)
export async function makeClaim({ code, keys, now = Date.now(), pow = POW, signFn = null, ...o }) {
  if (!CODE_RE.test(code || '') || !validPub(keys?.pub)) throw new Error('idbind: bad code/key');
  const iat = Math.floor(now), { n, hashes } = await solvePow({ code, pub: keys.pub, iat, b: pow.b, k: pow.k }, o);
  const c = { v: BIND_V, code, pub: keys.pub, iat, pw: { b: pow.b, k: pow.k, n } }; c.sig = b64(signFn ? new Uint8Array(await signFn(claimMsg(c))) : nacl.sign.detached(claimMsg(c), unb64(keys.sec))); Object.defineProperty(c, 'hashes', { value: hashes }); return c;
}
// Shape + signature + PoW. min = required PoW (POW for web, ATTESTED_POW when attested, REBIND_POW for an idle rebind).
export function verifyClaim(c, { code = null, pub = null, min = POW, now = null } = {}) {
  if (!c || typeof c !== 'object' || c.v !== BIND_V || !CODE_RE.test(c.code || '') || !validPub(c.pub) || !Number.isFinite(c.iat) || typeof c.sig !== 'string' || c.sig.length > 100) return false;
  if ((code && c.code !== code) || (pub && c.pub !== pub) || !c.pw || !meets(c.pw, min) || !Array.isArray(c.pw.n)) return false;
  if (now != null && c.iat > now + CLAIM_SKEW_MS) return false; // not from the future
  try { if (!nacl.sign.detached.verify(claimMsg(c), unb64(c.sig), unb64(c.pub))) return false; } catch { return false; }
  return verifyPow({ code: c.code, pub: c.pub, iat: c.iat, b: c.pw.b, k: c.pw.k }, c.pw.n);
}
// ---- rotation statement (old key hands the ID to a new key; instant rebind on the server, no PoW wait)
const rotMsg = (code, oldPub, newPub, at) => te.encode(`cm-idbind-rot-v1|${code}|${oldPub}|${newPub}|${at}`);
export const makeRotation = ({ code, oldKeys, newPub, now = Date.now() }) => ({ code, old: oldKeys.pub, pub: newPub, at: Math.floor(now), sig: b64(nacl.sign.detached(rotMsg(code, oldKeys.pub, newPub, Math.floor(now)), unb64(oldKeys.sec))) });
export function verifyRotation(r, { code, pub, now = Date.now(), maxAgeMs = CLAIM_SKEW_MS } = {}) {
  if (!r || r.code !== code || r.pub !== pub || !validPub(r.old) || r.old === pub || !Number.isFinite(r.at) || Math.abs(now - r.at) > maxAgeMs) return false;
  try { return nacl.sign.detached.verify(rotMsg(r.code, r.old, r.pub, r.at), unb64(r.sig), unb64(r.old)); } catch { return false; } }
// ---- server certs
const certMsg = c => te.encode(`cm-idbind-cert-v1|${c.code}|${c.pub}|${c.att ? 1 : 0}|${c.iat}|${c.exp}`);
export const serverKeysFromSeed = seed => { const s = typeof seed === 'string' ? (/^[0-9a-f]{64}$/i.test(seed) ? Uint8Array.from(seed.match(/../g), h => parseInt(h, 16)) : unb64(seed)) : seed; if (!s || s.length !== 32) throw new Error('idbind: seed must be 32 bytes'); const k = nacl.sign.keyPair.fromSeed(s); return { pub: b64(k.publicKey), sec: b64(k.secretKey) }; };
export function makeCert({ code, pub, att = false, now = Date.now(), ttl = CERT_TTL_MS }, serverSec) { const c = { v: BIND_V, code, pub, att: !!att, iat: Math.floor(now), exp: Math.floor(now + ttl) }; c.ss = b64(nacl.sign.detached(certMsg(c), unb64(serverSec))); return c; }
export function verifyCert(c, serverPub, { now = Date.now(), code = null, pub = null } = {}) {
  if (!serverPub || !c || c.v !== BIND_V || typeof c.ss !== 'string' || !CODE_RE.test(c.code || '') || !validPub(c.pub) || !(c.exp > now) || !Number.isFinite(c.iat) || (code && c.code !== code) || (pub && c.pub !== pub)) return false;
  try { return nacl.sign.detached.verify(certMsg(c), unb64(c.ss), unb64(serverPub)); } catch { return false; } }
export const isCert = p => !!p && typeof p === 'object' && 'ss' in p;
// ---- peer-side registry (one per mesh session)
export class IdBinder {
  constructor({ serverPub = null, now = () => Date.now(), max = PIN_MAX, min = POW } = {}) { Object.assign(this, { serverPub, now, max, min }); this.byCode = new Map(); this.byKey = new Map(); this.stats = { ok: 0, pinned: 0, rebound: 0, noProof: 0, badProof: 0, idBound: 0, keyBound: 0 }; }
  pinned(code) { return this.byCode.get(code)?.pub || null; }
  level(code) { return this.byCode.get(code)?.level || null; }
  _set(code, pub, level, iat) { const old = this.byCode.get(code); if (old) { this.byKey.delete(old.pub); this.byCode.delete(code); }
    if (this.byCode.size >= this.max) { const [c0, e0] = this.byCode.entries().next().value; this.byCode.delete(c0); this.byKey.delete(e0.pub); }
    this.byCode.set(code, { pub, level, iat }); this.byKey.set(pub, code); }
  // Pre-pin a key we already trust (own ID, saved friends: they were pinned before v43). Never overrides an existing pin.
  trust(code, pub) { if (CODE_RE.test(code || '') && validPub(pub) && !this.byCode.has(code) && !this.byKey.has(pub)) this._set(code, pub, 'trusted', 0); }
  // -> { ok, level, rebound?, reason? }. proof = cert | claim | null.
  check(code, pub, proof = null) {
    const cur = this.byCode.get(code), other = this.byKey.get(pub), S = this.stats;
    if (proof && isCert(proof)) {
      if (!verifyCert(proof, this.serverPub, { now: this.now(), code, pub })) { S.badProof++; return { ok: false, reason: this.serverPub ? 'bad-cert' : 'no-server-key' }; }
      if (cur && cur.pub === pub) { if (cur.level !== 'cert' || proof.iat > cur.iat) cur.level = 'cert', cur.iat = proof.iat; S.ok++; return { ok: true, level: 'cert' }; }
      if (cur && cur.level === 'cert' && cur.iat >= proof.iat) { S.idBound++; return { ok: false, reason: 'id-bound' }; } // older cert can't undo a newer one
      if (other && other !== code) { const o = this.byCode.get(other); if (o?.level === 'cert' && o.iat >= proof.iat) { S.keyBound++; return { ok: false, reason: 'key-bound' }; } this.byCode.delete(other); }
      this._set(code, pub, 'cert', proof.iat); if (cur) S.rebound++; else S.pinned++; return { ok: true, level: 'cert', rebound: !!cur };
    }
    if (cur) { if (cur.pub === pub) { S.ok++; return { ok: true, level: cur.level }; } S.idBound++; return { ok: false, reason: 'id-bound' }; }
    if (other && other !== code) { S.keyBound++; return { ok: false, reason: 'key-bound' }; }
    if (!proof) { S.noProof++; return { ok: false, reason: 'no-proof' }; }
    if (!verifyClaim(proof, { code, pub, min: this.min, now: this.now() })) { S.badProof++; return { ok: false, reason: 'bad-claim' }; }
    this._set(code, pub, 'pow', proof.iat); S.pinned++; return { ok: true, level: 'pow' };
  }
}
