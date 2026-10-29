// Device linking: ONE shared network ID per profile; per-device encryption keys (never shared, never sent).
import { sha256 } from './sha256.js';
// Flow: existing device A shows a QR / short code = signed offer {pid, nonce, exp}. New device B answers with a request
// {pid, nonce, devPub, devHash} signed by B's own new device key. A verifies + approves with a signed grant
// {pid, devPub, devHash, signingKeySealed} where the profile signing key is re-keyed (nacl.box) to B's device box key.
// The encryption key of A never leaves A; B derives its own. The server records hashed hardware fingerprints and caps links.
import nacl from 'tweetnacl';
export const LINK_TTL_MS = 5 * 60e3, MAX_DEVICES = 5;
const te = new TextEncoder(), b = u => { let t = ''; for (const x of u) t += String.fromCharCode(x); return btoa(t); }, ub = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const stable = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => p < q ? -1 : 1)) : x);
const sign = (o, sec) => ({ ...o, sig: b(nacl.sign.detached(te.encode(stable(o)), ub(sec))) });
const ver = (o, pub) => { const { sig, ...r } = o; try { return nacl.sign.detached.verify(te.encode(stable(r)), ub(sig), ub(pub)); } catch { return false; } };
export async function devHash(fields) { return b(new Uint8Array(await sha256(te.encode('cybermates-dev-v1|' + fields)))); }
export const shortCode = nonce => nonce.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8);
export function makeOffer({ pid, profileKeys, now = Date.now() }) { return sign({ t: 'link-offer', pid, nonce: b(nacl.randomBytes(9)), exp: now + LINK_TTL_MS, ppub: profileKeys.pub }, profileKeys.sec); }
export function makeRequest(offer, { devKeys, boxKeys, hash, now = Date.now() }) {
  if (!ver(offer, offer.ppub) || offer.exp < now) throw new Error('bad or expired link code');
  return sign({ t: 'link-req', pid: offer.pid, nonce: offer.nonce, devPub: devKeys.pub, devBox: boxKeys.xpub, devHash: hash }, devKeys.sec);
}
export function approve(req, offer, { profileKeys, linked = [], now = Date.now() }) {
  if (offer.exp < now || req.nonce !== offer.nonce || req.pid !== offer.pid || !ver(req, req.devPub)) return { ok: false, reason: 'bad request' };
  if (linked.length >= MAX_DEVICES) return { ok: false, reason: 'device cap' };
  const e = nacl.box.keyPair(), n = nacl.randomBytes(24), sealed = { e: b(e.publicKey), n: b(n), c: b(nacl.box(te.encode(profileKeys.sec), n, ub(req.devBox), e.secretKey)) };
  return { ok: true, grant: sign({ t: 'link-grant', pid: req.pid, devPub: req.devPub, devHash: req.devHash, keySealed: sealed, at: now }, profileKeys.sec) };
}
export function acceptGrant(grant, { offer, boxKeys }) {
  if (!ver(grant, offer.ppub) || grant.pid !== offer.pid) throw new Error('bad grant');
  const z = grant.keySealed, m = nacl.box.open(ub(z.c), ub(z.n), ub(z.e), ub(boxKeys.xsec)); if (!m) throw new Error('cannot open');
  return { pid: grant.pid, profileSec: new TextDecoder().decode(m) }; // the profile SIGNING key (shared ID); encryption key stays per-device
}
export { ver as verifySigned };
