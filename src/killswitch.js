// Signed kill switch. Ed25519 via WebCrypto, tweetnacl fallback. Pure logic + verification; no I/O.
// Message: {type:'kill'|'clear', scope:'all'|'user:<id>'|'session:<id>', reason, issued_at, expires_at, nonce, sig}
// issued_at/expires_at are ms epoch; sig = base64 Ed25519 over canonical(msg without sig).
import nacl from 'tweetnacl';

// ⚠️ DEV-ONLY public key (private seed is NOT in the repo). Production builds MUST set VITE_KILL_PUBKEY
// to a key generated with `node scripts/kill-switch.mjs keygen` and kept by David.
export const DEV_KILL_PUBKEY = 'nlWWYGB+Y+/fbPfNHizVSTyRcNWwBSM8oN9wTbJAnwU=';
// Fail CLOSED: production bundles without VITE_KILL_PUBKEY get NO kill key (every control message is rejected) instead of
// silently trusting the dev key. Dev server / tests (or VITE_ALLOW_DEV_KILL_KEY=1, local demo builds) use the dev key.
// Server (Node, no import.meta.env): dev key only outside NODE_ENV=production; routes use env VITE_KILL_PUBKEY anyway.
const VENV = typeof import.meta !== 'undefined' ? import.meta.env : undefined;
const devOk = VENV ? (VENV.DEV || VENV.VITE_ALLOW_DEV_KILL_KEY === '1') : (globalThis.process?.env?.NODE_ENV !== 'production');
export const KILL_PUBKEY = VENV?.VITE_KILL_PUBKEY || (devOk ? DEV_KILL_PUBKEY : '');
export const BROADCAST_MAX_AGE_MS = 10 * 60 * 1000; // live broadcasts must be issued within 10 min
export const CLOCK_SKEW_MS = 2 * 60 * 1000;
export const MAX_LIFETIME_MS = 365 * 24 * 3600 * 1000;
const FIELDS = ['type', 'scope', 'reason', 'issued_at', 'expires_at', 'nonce'];

export const b64 = u8 => typeof Buffer !== 'undefined' ? Buffer.from(u8).toString('base64') : btoa(String.fromCharCode(...u8));
export const unb64 = s => typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(s, 'base64')) : Uint8Array.from(atob(s), c => c.charCodeAt(0));
const EXT = ['level', 'strikes']; // tiered enforcement: appended ONLY when present, so legacy signatures still verify
export const canonical = m => JSON.stringify(FIELDS.map(k => [k, m[k] ?? null]).concat(EXT.filter(k => m[k] != null).map(k => [k, m[k]])));
export const bytes = m => new TextEncoder().encode(canonical(m));

export async function verifySig(msg, pubB64 = KILL_PUBKEY) {
  try {
    const pub = unb64(pubB64), sig = unb64(msg.sig || ''), data = bytes(msg);
    if (pub.length !== 32 || sig.length !== 64) return false;
    try {
      const k = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
      return await crypto.subtle.verify({ name: 'Ed25519' }, k, sig, data);
    } catch { return nacl.sign.detached.verify(data, sig, pub); } // browsers without WebCrypto Ed25519
  } catch { return false; }
}
// Signing lives ONLY in scripts/lib/sign.mjs (offline owner CLI + tests); no private-key code path exists in src/ or api/.
export function makeMsg({ type = 'kill', scope = 'all', reason = '', ttlMs = 24 * 3600 * 1000, now = Date.now(), level, strikes } = {}) {
  return { type, scope, reason, issued_at: now, expires_at: now + ttlMs, nonce: b64(nacl.randomBytes(16)), ...(level != null ? { level } : {}), ...(strikes != null ? { strikes } : {}) };
}
export const scopeApplies = (scope, { userId, sessionId }) => scope === 'all' || scope === 'user:' + userId || scope === 'session:' + sessionId;

// Full check. source: 'broadcast' (live, strict freshness) | 'record' (persistent row, valid until expires_at).
// seen: Set-like of nonces already processed (replay protection).
export async function checkControl(msg, { pubkey = KILL_PUBKEY, now = Date.now(), seen, userId, sessionId, source = 'broadcast' } = {}) {
  if (!msg || !['kill', 'clear'].includes(msg.type) || typeof msg.nonce !== 'string' || !msg.nonce) return { ok: false, reason: 'malformed' };
  if (!(await verifySig(msg, pubkey))) return { ok: false, reason: 'bad-signature' };
  const { issued_at: ia, expires_at: ea } = msg;
  if (!Number.isFinite(ia) || !Number.isFinite(ea) || ea <= ia || ea - ia > MAX_LIFETIME_MS) return { ok: false, reason: 'bad-window' };
  if (ia > now + CLOCK_SKEW_MS) return { ok: false, reason: 'future' };
  if (now > ea) return { ok: false, reason: 'expired' };
  if (source === 'broadcast' && now - ia > BROADCAST_MAX_AGE_MS) return { ok: false, reason: 'stale' };
  if (seen?.has(msg.nonce)) return { ok: false, reason: 'replay' };
  if (!scopeApplies(msg.scope, { userId, sessionId })) { seen?.add(msg.nonce); return { ok: false, reason: 'out-of-scope' }; }
  seen?.add(msg.nonce);
  return { ok: true };
}
