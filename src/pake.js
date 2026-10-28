// v47 PAKE for the 6-digit device transfer (CPace-style balanced PAKE over X25519, no new dependencies).
//  - Generator G = Elligator2(SHA-512(DSI | code | sid)) on Curve25519 (u-coordinate), so G depends on the code and the session.
//  - Each side picks a random scalar y and sends Y = X25519(y, G). The shared point K = X25519(y_mine, Y_theirs) only matches
//    when both used the same code. The wire carries Y values that look random for EVERY code: someone who records the traffic
//    (incl. the relay operator) has nothing to test guesses against offline. An active attacker gets ONE guess per exchange,
//    and the sender caps exchanges (transfer.js MAX_ATTEMPTS).
//  - ISK = SHA-512(DSI | sid | Y_recv | Y_send | K): 32 B encryption key + 32 B MAC key (key confirmation both ways).
//  Not constant time (JS BigInt); fine for a once-per-transfer, interactive, 10-minute code.
import nacl from 'tweetnacl';
const P = (1n << 255n) - 19n, A = 486662n, Z = 2n, te = new TextEncoder();
export const DSI = 'CPace255-cm-xfer-v1';
const md = x => { x %= P; return x < 0n ? x + P : x; };
const pw = (b, e) => { let r = 1n; b = md(b); while (e > 0n) { if (e & 1n) r = r * b % P; b = b * b % P; e >>= 1n; } return r; };
const inv = x => pw(x, P - 2n);
const leLoad = u8 => { let x = 0n; for (let i = u8.length - 1; i >= 0; i--) x = (x << 8n) | BigInt(u8[i]); return x; };
const leStore = x => { const o = new Uint8Array(32); for (let i = 0; i < 32; i++) { o[i] = Number(x & 255n); x >>= 8n; } return o; };
const cat = (...a) => { const n = a.reduce((s, x) => s + x.length, 0), o = new Uint8Array(n); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const lv = x => { const b = typeof x === 'string' ? te.encode(x) : x; return cat(new Uint8Array([b.length & 255, b.length >> 8]), b); }; // length-prefixed
export const isSquare = x => { x = md(x); return x === 0n || pw(x, (P - 1n) / 2n) === 1n; };
export const onCurve = u => isSquare(md(u * u * u + A * u * u + u)); // v^2 = u^3 + A u^2 + u has a solution
// Elligator2 (RFC 9380 map_to_curve_elligator2 for curve25519, Z = 2): field element -> u-coordinate ON the curve.
export function elligator2(r) {
  const d = md(1n + Z * r * r); let x1 = d === 0n ? md(-A) : md(-A * inv(d));
  const g = md(x1 * x1 * x1 + A * x1 * x1 + x1);
  return isSquare(g) ? x1 : md(-x1 - A);
}
export const generator = (code, sid) => leStore(elligator2(md(leLoad(nacl.hash(cat(lv(DSI), lv(String(code)), lv(sid))))))); // 64-byte hash mod p: bias < 2^-250
export const share = (code, sid) => { const y = nacl.randomBytes(32), Y = nacl.scalarMult(y, generator(code, sid)); return { y, Y }; };
const zero = u8 => u8.every(b => b === 0);
// Derives the 64-byte ISK; null for a bad / low-order peer share (K = 0 after X25519 clamping clears the cofactor).
export function isk(y, theirY, sid, yRecv, ySend) {
  if (!(theirY instanceof Uint8Array) || theirY.length !== 32) return null;
  const K = nacl.scalarMult(y, theirY); if (zero(K)) return null;
  const out = nacl.hash(cat(lv(DSI + '|isk'), lv(sid), lv(yRecv), lv(ySend), K)); K.fill(0); return out;
}
export const _test = { P, A, leLoad, leStore, md };
