// Device-bound encryption at rest (item 2) + key-derivation versioning (item 10).
// Device key = PBKDF2_v( SHA256(SHA256( HMAC(installSecret, deviceInfo) )) , salt_v ) -> AES-GCM-256 (non-extractable).
//  - deviceInfo: Capacitor Device.getId()/model/platform when available (no restricted permissions). Android 10+ and iOS
//    block serial/IMEI, so device info alone is low-entropy and guessable; the random install secret is what makes the key strong.
//  - installSecret: random non-extractable HMAC CryptoKey kept in IndexedDB (web + Capacitor WebView). It is NOT hardware-backed;
//    a rooted device / devtools can still use it. For Android Keystore / iOS Keychain use a secure-storage plugin (gap).
// Blob format: outer AES-GCM over JSON {fields:{name:{wk,iv,ct}}}; each field has its own random data key wrapped by the device key,
// so memory/file value scanners can't find counters (boosts, starters) in plaintext at rest. Plaintext only exists while in use.
export const KDF = { // two-version window: current + previous are decryptable
  1: { salt: 'cybermates-kdf-v1', iter: 100_000, hash: 'SHA-256' },
  2: { salt: 'cybermates-kdf-v2', iter: 150_000, hash: 'SHA-256' },
};
export const KDF_VERSION = 2;
export const MIN_KDF_VERSION = KDF_VERSION - 1;
import { registerSecret } from './never-send.js';
import nacl from 'tweetnacl';
const S = () => globalThis.crypto.subtle, enc = new TextEncoder(), dec = new TextDecoder();
export const rand = n => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const b64 = u8 => { let s = ''; for (const c of new Uint8Array(u8)) s += String.fromCharCode(c); return btoa(s); };
export const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

// ---- secret storage (pluggable) ----
export class MemorySecretStore { constructor() { this.m = new Map(); } async get(k) { return this.m.get(k); } async set(k, v) { this.m.set(k, v); } async del(k) { this.m.delete(k); } }
export class IdbSecretStore { // stores CryptoKey objects; structured clone keeps them non-extractable
  db() { return this._db ||= new Promise((res, rej) => { const r = indexedDB.open('cybermates-secrets', 1); r.onupgradeneeded = () => r.result.createObjectStore('k'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async tx(mode, fn) { const d = await this.db(); return new Promise((res, rej) => { const t = d.transaction('k', mode); const r = fn(t.objectStore('k')); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); }); }
  get(k) { return this.tx('readonly', s => s.get(k)); } set(k, v) { return this.tx('readwrite', s => s.put(v, k)); } del(k) { return this.tx('readwrite', s => s.delete(k)); }
}
export async function deviceInfo(cap = globalThis.Capacitor) {
  const D = cap?.Plugins?.Device; // @capacitor/device if installed; else web fallback
  try { if (D) { const [{ identifier }, i] = await Promise.all([D.getId(), D.getInfo()]); return `${identifier}|${i.model}|${i.platform}|${i.osVersion}`; } } catch {}
  const n = globalThis.navigator || {}; return `web|${n.userAgent || 'node'}|${n.platform || ''}`;
}
// Normal path: a non-extractable HMAC CryptoKey kept in IndexedDB. WebKit can only store a CryptoKey in IndexedDB after
// wrapping it with a per-app "WebCrypto master key" from the Keychain; some in-app WKWebViews (host apps without that
// entitlement/delegate) fail exactly there with "UnknownError: The operation failed for an operation-specific reason",
// while plain IndexedDB data still works (why other sites persist fine). So the fallback keeps on-device persistence:
// raw secret bytes in IndexedDB (plain data), else localStorage, else memory; WebCrypto still derives the key.
const MODE_K = 'cybermates:vmode', SEC_K = 'cybermates:isec'; const memLS = new Map();
const ls = { get: k => { try { return localStorage.getItem(k); } catch { return memLS.get(k) ?? null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { memLS.set(k, v); } }, del: k => { try { localStorage.removeItem(k); } catch {} memLS.delete(k); } };
export const bootDiag = {}; const diag = (k, v) => { bootDiag[k] = v; try { localStorage.setItem('cm.bootdiag', JSON.stringify(bootDiag)); } catch {} };
const ename = e => (e?.name || 'Error') + ': ' + (e?.message || e);
async function rawSecret(store) {
  try { let r = await store.get('install-secret-raw'); if (!(r instanceof Uint8Array) || r.length !== 32) { r = ls.get(SEC_K) ? unb64(ls.get(SEC_K)) : rand(32); await store.set('install-secret-raw', r); } diag('secret', 'idb-raw'); return r; }
  catch (e) { diag('idb-raw', ename(e)); let s = ls.get(SEC_K); if (!s) { s = b64(rand(32)); ls.set(SEC_K, s); } diag('secret', 'localStorage-raw'); return unb64(s); }
}
async function installKey(store) {
  if (ls.get(MODE_K) !== 'raw') {
    try {
      let k = await store.get('install-secret');
      if (!k) { k = await S().generateKey({ name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign']); await store.set('install-secret', k); }
      diag('secret', 'idb-cryptokey'); return k;
    } catch (e) { diag('idb-cryptokey', ename(e)); lastVaultError.step = 'idb-store-cryptokey'; lastVaultError.error = ename(e); console.warn('vault: storing a CryptoKey in IndexedDB failed; using raw secret bytes', e); ls.set(MODE_K, 'raw'); }
  }
  return S().importKey('raw', await rawSecret(store), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}
// ---- fallback mode (boot resilience) ----
// Some in-app WKWebViews (e.g. iOS apps embedding WebKit) reject storing a CryptoKey in IndexedDB, or reject WebCrypto calls,
// with "UnknownError: The operation failed for an operation-specific reason". Then the device key is derived with tweetnacl
// from a random 32-byte install secret kept in localStorage (or memory), and fields are sealed with nacl.secretbox.
// Weaker at rest (the secret is readable by page script) but the app boots. The mode sticks per device so blobs stay readable.

export const vaultMode = () => ls.get(MODE_K) || 'webcrypto'; // webcrypto | raw (CryptoKey-in-IDB failed) | nacl (WebCrypto failed)
export const lastVaultError = { step: null, error: null };
async function naclDeviceKey(store, info, version) {
  const sec = await rawSecret(store); diag('mode', 'nacl');
  const p = KDF[version]; const m = new Uint8Array([...sec, ...enc.encode('|' + info + '|' + p.salt)]);
  return { nacl: nacl.hash(m).slice(0, 32), v: version };
}
export async function deriveDeviceKeySafe({ store, info, version = KDF_VERSION }) {
  if (vaultMode() !== 'nacl') {
    try { return await deriveDeviceKey({ store, info, version }); }
    catch (e) { diag('webcrypto-derive', ename(e)); lastVaultError.step = 'webcrypto-derive'; lastVaultError.error = ename(e); console.warn('vault: WebCrypto key derivation failed, using nacl fallback', e); ls.set(MODE_K, 'nacl'); }
  }
  return naclDeviceKey(store, info, version);
}
const subKey = (k, aad) => nacl.hash(new Uint8Array([...k, ...enc.encode('|' + (aad || ''))])).slice(0, 32);
export async function deriveDeviceKey({ store, info, version = KDF_VERSION }) {
  const p = KDF[version]; if (!p) throw new Error('unsupported kdf version ' + version);
  const m = await S().sign('HMAC', await installKey(store), enc.encode(info));
  const h = await S().digest('SHA-256', await S().digest('SHA-256', m)); // double hash
  const base = await S().importKey('raw', h, 'PBKDF2', false, ['deriveKey']);
  return S().deriveKey({ name: 'PBKDF2', salt: enc.encode(p.salt), iterations: p.iter, hash: p.hash }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function gcm(key, data, aad) { if (key?.nacl) { const iv = rand(24); return { iv: b64(iv), ct: b64(nacl.secretbox(new Uint8Array(data), iv, subKey(key.nacl, aad))) }; } const iv = rand(12); const ct = await S().encrypt({ name: 'AES-GCM', iv, ...(aad ? { additionalData: enc.encode(aad) } : {}) }, key, data); return { iv: b64(iv), ct: b64(ct) }; }
export async function ungcm(key, { iv, ct }, aad) { if (key?.nacl) { const r = nacl.secretbox.open(unb64(ct), unb64(iv), subKey(key.nacl, aad)); if (!r) throw new Error('vault: nacl decrypt failed'); return r; } return new Uint8Array(await S().decrypt({ name: 'AES-GCM', iv: unb64(iv), ...(aad ? { additionalData: enc.encode(aad) } : {}) }, key, unb64(ct))); }

// Envelope: per-field random data key wrapped by device key; field name bound as AAD.
export async function sealFields(devKey, obj) {
  const fields = {};
  for (const [name, val] of Object.entries(obj)) {
    const dk = rand(32), k = devKey?.nacl ? { nacl: dk.slice() } : await S().importKey('raw', dk, 'AES-GCM', false, ['encrypt']);
    fields[name] = { wk: await gcm(devKey, dk, 'wk:' + name), ...(await gcm(k, enc.encode(JSON.stringify(val)), 'f:' + name)) };
    dk.fill(0);
  }
  return fields;
}
export async function openFields(devKey, fields) {
  const out = {};
  for (const [name, f] of Object.entries(fields)) {
    const dk = await ungcm(devKey, f.wk, 'wk:' + name), k = devKey?.nacl ? { nacl: dk.slice() } : await S().importKey('raw', dk, 'AES-GCM', false, ['decrypt']); dk.fill(0);
    out[name] = JSON.parse(dec.decode(await ungcm(k, f, 'f:' + name)));
  }
  return out;
}
export async function seal(devKey, obj, version = KDF_VERSION) {
  const inner = enc.encode(JSON.stringify({ fields: await sealFields(devKey, obj) }));
  return { kdf: version, ...(devKey?.nacl ? { alg: 'nacl' } : {}), ...(await gcm(devKey, inner, 'cybermates-profile:' + version)) };
}
export async function open(devKey, blob) { return openFields(devKey, JSON.parse(dec.decode(await ungcm(devKey, blob, 'cybermates-profile:' + blob.kdf))).fields); }

// Vault: holds only the encrypted blob; use() decrypts in memory, runs fn, re-encrypts, drops plaintext.
export class Vault {
  constructor({ store = new MemorySecretStore(), persist = null, info } = {}) { Object.assign(this, { store, persist, info }); this.keys = {}; }
  async key(v) { if (!this.keys[v]) this.keys[v] = deriveDeviceKeySafe({ store: this.store, info: this.info ??= await deviceInfo(), version: v }); registerSecret(this.info); return this.keys[v]; }
  async load() { this.blob = await this.persist?.load?.() || this.blob || null; return this; }
  async save() { await this.persist?.save?.(this.blob); }
  async init(obj) { this.blob = await seal(await this.key(KDF_VERSION), obj); await this.save(); }
  async read() { // decrypt (migrating vN-1 -> vN). Returns a fresh plaintext copy; caller must not persist it.
    const b = this.blob; if (!b) return null;
    if (b.kdf < MIN_KDF_VERSION || !KDF[b.kdf]) throw Object.assign(new Error('Profile encrypted by an unsupported app version'), { code: 'KDF_TOO_OLD' });
    const obj = await open(await this.key(b.kdf), b);
    if (b.kdf !== KDF_VERSION) { this.blob = await seal(await this.key(KDF_VERSION), obj); await this.save(); this.migrated = b.kdf; }
    return obj;
  }
  async use(fn) { let obj = await this.read(); try { const r = await fn(obj); this.blob = await seal(await this.key(KDF_VERSION), obj); await this.save(); return r; } finally { obj = null; } }
  async wipe() { this.blob = null; await this.persist?.save?.(null); try { await this.store.del('install-secret'); await this.store.del('install-secret-raw'); } catch {} ls.del(SEC_K); ls.del(MODE_K); this.keys = {}; }
}
export const localPersist = (k = 'cybermates:vault') => ({ load: async () => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, save: async b => b ? localStorage.setItem(k, JSON.stringify(b)) : localStorage.removeItem(k) });
// LEGACY: random code was the network identity before the two-key design; now only used for pre-mesh profile userCode
// fallback. Network identity = ID key from src/identity.js (deriveIdKey). Old codes are migrated (legacyCode).
export const newUserCode = () => { const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', r = rand(10); return [...r].map(x => a[x % a.length]).join(''); }; // ~49 bits
