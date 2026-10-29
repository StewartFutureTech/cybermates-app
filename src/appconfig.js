// Version rotation (item 10): app/protocol version + signed min-version config (same style as kill switch; separate record).
import nacl from 'tweetnacl';
import { KDF_VERSION } from './vault.js';
import { KILL_PUBKEY, b64, unb64 } from './killswitch.js';
export const APP_VERSION = KDF_VERSION; // protocol version == key-derivation version id
export const VERSION_WINDOW = 1; // vN accepts vN-1
export const UPDATE_MESSAGE = 'Please update Cybermates — this version is no longer supported.';
const FIELDS = ['type', 'min_version', 'issued_at', 'nonce', 'shard_threshold'];
let shardThreshold = 100_000; // adaptive membership: full global list below this many active users
export const getShardThreshold = () => shardThreshold;
export const canon = m => new TextEncoder().encode(JSON.stringify(FIELDS.map(k => [k, m[k] ?? null])));
// signConfig moved to scripts/lib/sign.mjs (offline only).
export function verifyConfig(m, pub = KILL_PUBKEY) { try { return m?.type === 'app_config' && Number.isInteger(m.min_version) && nacl.sign.detached.verify(canon(m), unb64(m.sig), unb64(pub)); } catch { return false; } }
let minVersion = APP_VERSION - VERSION_WINDOW;
export const getMinVersion = () => minVersion;
export function applyConfig(m, pub) { if (!verifyConfig(m, pub)) return false; minVersion = m.min_version; if (Number.isInteger(m.shard_threshold) && m.shard_threshold > 0) shardThreshold = m.shard_threshold; return true; }
export const resetConfig = () => { minVersion = APP_VERSION - VERSION_WINDOW; shardThreshold = 100_000; };
export function checkVersion(v, min = minVersion) {
  if (!Number.isInteger(v)) return { ok: false, reason: 'no-version', message: UPDATE_MESSAGE };
  if (v < min) return { ok: false, reason: 'old-version', message: UPDATE_MESSAGE };
  return { ok: true };
}
// Self check: if the signed config says this build is too old, the app must prompt to update.
export const selfOutdated = () => APP_VERSION < minVersion;
