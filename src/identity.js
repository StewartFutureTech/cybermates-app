// Two-key design — ID KEY (shareable network identity). See README "Two-key design".
import { sha256 } from './sha256.js';
//   ID = base32(SHA-256("cybermates-id-v1" | platform | stable device fields [| persona:<x>]))[0..16]
//   Inputs are ONLY stable hardware/device data: Capacitor Device.getId() on native (Android: ANDROID_ID per app-signing key;
//   iOS: identifierForVendor), best-effort browser fingerprint on web. NO install secret, NO app/KDF version, NO randomness.
//   It is NEVER used as (or mixed into) an encryption key; the vault key (src/vault.js) is a separate, private derivation.
// Tradeoffs: web fingerprint is weak (changes on browser update / spoofable / shared by identical machines); a new phone
//   means a new ID; Android factory reset (or app re-signing) changes ANDROID_ID; iOS IDFV changes if all vendor apps are removed.
// Format: 16 chars from the user-code alphabet (~80 bits) => still passes membership validRow (/^[A-Z0-9]{4,16}$/) and
//   ban scopes; legacy random codes are 10 chars, so isLegacyCode() tells them apart.
const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ID_DOMAIN = 'cybermates-id-v1', ID_LEN = 16;
export const isLegacyCode = c => typeof c === 'string' && c.length === 10;
export const isDeviceId = c => typeof c === 'string' && c.length === ID_LEN && [...c].every(x => A.includes(x));
export async function stableDeviceFields(cap = globalThis.Capacitor) {
  const D = cap?.Plugins?.Device;
  try { if (D && cap?.isNativePlatform?.() !== false) { const [{ identifier }, i] = await Promise.all([D.getId(), D.getInfo()]); if (identifier) return { platform: i?.platform || 'native', strong: true, fields: [identifier, i?.manufacturer || '', i?.model || ''] }; } } catch {}
  const n = globalThis.navigator || {}, s = globalThis.screen || {}; let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
  // weak web fingerprint: deliberately excludes anything app-controlled (storage, version) so it is not secret either
  return { platform: 'web', strong: false, fields: [n.userAgent || 'node', n.platform || '', n.language || '', n.hardwareConcurrency || 0, n.deviceMemory || 0, `${s.width || 0}x${s.height || 0}x${s.colorDepth || 0}`, tz] };
}
export async function deriveIdKey({ device, persona = null } = {}) {
  device ||= await stableDeviceFields();
  const str = [ID_DOMAIN, device.platform, ...device.fields.map(String)].join('|') + (persona ? '|persona:' + persona : '');
  const h = new Uint8Array(await sha256(new TextEncoder().encode(str)));
  return [...h.slice(0, ID_LEN)].map(x => A[x % A.length]).join('');
}
// Migration of a stored mesh identity {code: <legacy random>, keys, friends, blocked} -> device ID. Signing keys/friends kept;
// the old code is remembered as legacyCode (sent to bootstrap so server bans on the old code still apply, and checked locally).
export async function migrateIdentity(rec, { device, persona } = {}) {
  const id = await deriveIdKey({ device, persona });
  if (rec.code === id) return { rec, changed: false };
  if (rec.code && !rec.legacyCode && !isDeviceId(rec.code)) rec.legacyCode = rec.code;
  else if (rec.code && rec.code !== id) (rec.priorIds ||= []).push(rec.code); // device fields changed (e.g. web fingerprint drift)
  rec.code = id; rec.idv = 1; return { rec, changed: true };
}
