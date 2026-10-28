// Quiet safety numbers (v52): diggable compare of pinned Ed25519 profile keys. No banner, no nag, no gate.
// Fingerprint = SHA-256 over a canonical string of both parties' (code, pub) sorted by code so both phones match.
import { sha256 } from './sha256.js';
import { unb64 } from './vault.js';
const te = new TextEncoder();
export const SN_PREFIX = 'cm-sn-v1';
export const SN_DIGITS = 60; // 12 groups of 5

/** Sort two identities by code (stable mesh ID). */
export function canonicalPair(a, b) {
  const A = { code: String(a.code || ''), pub: String(a.pub || '') };
  const B = { code: String(b.code || ''), pub: String(b.pub || '') };
  if (!A.code || !A.pub || !B.code || !B.pub) return null;
  if (A.code === B.code) return null;
  return A.code < B.code ? [A, B] : [B, A];
}

/** Canonical compare string (also QR payload). */
export function canonicalString(a, b) {
  const p = canonicalPair(a, b); if (!p) return null;
  return `${SN_PREFIX}|${p[0].code}|${p[0].pub}|${p[1].code}|${p[1].pub}`;
}

/** Sync digest → { fp (hex), number (grouped digits), groups }. */
export function formatDigest(buf) {
  const dig = new Uint8Array(buf);
  let digits = '';
  for (let i = 0; i < 30; i++) digits += String(dig[i] % 100).padStart(2, '0');
  digits = digits.slice(0, SN_DIGITS);
  const groups = digits.match(/.{1,5}/g) || [];
  const fp = [...dig].map(x => x.toString(16).padStart(2, '0')).join('');
  return { fp, number: groups.join(' '), groups, digits };
}

export async function safetyNumber(a, b) {
  const canon = canonicalString(a, b); if (!canon) return null;
  // Reject obviously bad pubs (must decode to 32-byte Ed25519).
  try { for (const x of canonicalPair(a, b)) if (unb64(x.pub).length !== 32) return null; } catch { return null; }
  const dig = await sha256(te.encode(canon));
  const f = formatDigest(dig);
  return { version: 1, canon, qr: canon, ...f };
}

/** Own short key material for "show me" — first 8 hex of sha256(pub), not secret. */
export async function ownKeyHint(pub) {
  if (!pub) return null;
  try { if (unb64(pub).length !== 32) return null; } catch { return null; }
  const dig = new Uint8Array(await sha256(te.encode('cm-sn-own|' + pub)));
  return [...dig.slice(0, 4)].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Quiet verified flag helpers (local vault map: { [peerCode]: { fp, at } }). */
export function matchVerified(map, peerCode, fp) {
  const v = map?.[peerCode]; if (!v || !fp || v.fp !== fp) return null;
  return { fp: v.fp, at: v.at || 0 };
}
export function markVerified(map, peerCode, fp, at = Date.now()) {
  const o = { ...(map || {}) }; o[peerCode] = { fp, at }; return o;
}
export function clearVerified(map, peerCode) {
  const o = { ...(map || {}) }; delete o[peerCode]; return o;
}
/** Drop entries whose stored fp no longer matches the live fingerprint (silent). */
export function pruneVerified(map, peerCode, liveFp) {
  const v = map?.[peerCode]; if (!v) return map || {};
  if (v.fp === liveFp) return map;
  return clearVerified(map, peerCode);
}

/** Resolve peer profile pub from mesh friends / e2e pins / cache. */
export function peerProfilePub(m, code) {
  if (!m || !code) return null;
  return m.node?.friends?.get(code)?.pub
    || m.e2e?.peers?.get(code)?.pub
    || m.node?.cache?.get(code)?.pub
    || null;
}
