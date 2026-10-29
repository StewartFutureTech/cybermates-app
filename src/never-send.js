// NEVER-SEND guard: central outgoing-packet filter. Every mesh bus post (src/net.js), app-mesh fetch to /api/*, and
// Supabase profile upsert passes through guardOutgoing(). It enforces that the PRIVATE encryption key material never leaves
// the device. Never-send list:
//   1. any CryptoKey object (vault AES key, install-secret HMAC key) — rejected outright
//   2. fields named like install secret / vault key / device key / KDF input / signing secret key — stripped
//   3. registered secret strings (the KDF device-info input string, see vault.js) found anywhere in the payload — rejected
//   4. the vault ciphertext blob itself (object with kdf+iv+ct) — rejected (it is only useful together with the device)
// Policy: strip forbidden keys (cheap mistakes), REJECT (throw NeverSendError) when a secret value is embedded.
export const FORBIDDEN_KEYS = /^(install[-_]?secret|installKey|devKey|deviceKey|vaultKey|encKey|encryptionKey|kdfInput|deviceInfo|hashKey|privateKey|secretKey|sec)$/i;
const secrets = new Set();
export const registerSecret = s => { if (typeof s === 'string' && s.length >= 8) secrets.add(s); };
export const _resetSecrets = () => secrets.clear();
export class NeverSendError extends Error { constructor(why) { super('never-send guard: ' + why); this.code = 'NEVER_SEND'; } }
const isCryptoKey = v => (typeof CryptoKey !== 'undefined' && v instanceof CryptoKey) || v?.[Symbol.toStringTag] === 'CryptoKey';
const isVaultBlob = v => v && typeof v === 'object' && 'kdf' in v && 'iv' in v && 'ct' in v;
function scrub(v, path, stripped, depth = 0) {
  if (depth > 40) throw new NeverSendError('payload too deep');
  if (isCryptoKey(v)) throw new NeverSendError('CryptoKey at ' + path);
  if (typeof v === 'string') { for (const s of secrets) if (v.includes(s)) throw new NeverSendError('secret material at ' + path); return v; }
  if (!v || typeof v !== 'object' || ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return v;
  if (isVaultBlob(v)) throw new NeverSendError('vault blob at ' + path);
  if (Array.isArray(v)) return v.map((x, i) => scrub(x, path + '[' + i + ']', stripped, depth + 1));
  const o = {};
  for (const [k, x] of Object.entries(v)) { if (FORBIDDEN_KEYS.test(k)) { stripped.push(path + '.' + k); continue; } o[k] = scrub(x, path + '.' + k, stripped, depth + 1); }
  return o;
}
// Returns the (possibly stripped) payload safe to send; throws NeverSendError if it embeds key material.
export function guardOutgoing(payload, { onStrip } = {}) { const stripped = []; const out = scrub(payload, '$', stripped); if (stripped.length) onStrip?.(stripped); return out; }
// Same for already-serialized bodies (fetch).
export function guardBody(body) { if (typeof body !== 'string') return body; let j; try { j = JSON.parse(body); } catch { scrub(body, '$body', []); return body; } return JSON.stringify(guardOutgoing(j)); }
export const guardedFetch = (f = globalThis.fetch) => (url, o = {}) => f(url, o.body ? { ...o, body: guardBody(o.body) } : o);
