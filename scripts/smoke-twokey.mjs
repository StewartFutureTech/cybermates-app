// Two-key design: ID key (stable, device-only, no install secret) vs private vault key; never-send guard; migration;
// attestation stub; user block list (separate from ban list).
import * as V from '../src/vault.js';
import * as I from '../src/identity.js';
import * as N from '../src/never-send.js';
import { BlockList } from '../src/blocklist.js';
import { requestAttestation } from '../src/attest.js';
import { verifyAttestation } from '../api/_fn/attest.js';
import { readFileSync } from 'node:fs';
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const cap = id => ({ isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { Device: { getId: async () => ({ identifier: id }), getInfo: async () => ({ platform: 'android', manufacturer: 'Google', model: 'Pixel 8', osVersion: '15' }) } } });
const dev = await I.stableDeviceFields(cap('a1b2c3d4e5f6'));
const id1 = await I.deriveIdKey({ device: dev }), id2 = await I.deriveIdKey({ device: dev });
assert(id1 === id2 && I.isDeviceId(id1) && /^[A-Z0-9]{4,16}$/.test(id1), 'ID key deterministic, 16 chars, valid mesh code: ' + id1);
assert(id1 !== await I.deriveIdKey({ device: await I.stableDeviceFields(cap('ffff0000ffff')) }), 'different device => different ID');
assert(id1 !== await I.deriveIdKey({ device: dev, persona: 'seed-3' }), 'dev persona suffix separates demo tabs');
const src = readFileSync(new URL('../src/identity.js', import.meta.url), 'utf8');
assert(!/install-secret|installKey|KDF|APP_VERSION|getRandomValues/.test(src.replace(/\/\/.*$/gm, '')), 'identity.js code uses no install secret, no version, no randomness');
// two vaults on the same device (reinstall => new install secret) -> different encryption keys, SAME ID
const info = await V.deviceInfo(cap('a1b2c3d4e5f6'));
const va = await new V.Vault({ info }).load(), vb = await new V.Vault({ info }).load(); await va.init({ x: 1 });
let cross = false; try { vb.blob = va.blob; await vb.read(); cross = true; } catch {}
assert(!cross && id1 === await I.deriveIdKey({ device: await I.stableDeviceFields(cap('a1b2c3d4e5f6')) }), 'reinstall: new private key (old blob unreadable) but same ID key');
// migration
const rec = { code: 'ABCDEFGHJK', keys: { pub: 'p' }, friends: { F: 1 }, blocked: ['Z'] };
const r = await I.migrateIdentity(rec, { device: dev });
assert(r.changed && rec.code === id1 && rec.legacyCode === 'ABCDEFGHJK' && rec.friends.F && rec.keys.pub === 'p', 'legacy random code migrated -> ID key (legacyCode kept, keys/friends kept)');
assert(!(await I.migrateIdentity(rec, { device: dev })).changed, 'migration idempotent');
// never-send guard
N.registerSecret(info); const key = await V.deriveDeviceKey({ store: new V.MemorySecretStore(), info });
const thr = f => { try { f(); return null; } catch (e) { return e; } };
assert(thr(() => N.guardOutgoing({ k: 'mesh', env: { body: { key } } }))?.code === 'NEVER_SEND', 'CryptoKey (vault key) in packet => rejected');
assert(thr(() => N.guardOutgoing({ k: 'hello', note: 'x' + info }))?.code === 'NEVER_SEND', 'KDF input (device info) string in packet => rejected');
assert(thr(() => N.guardOutgoing({ k: 'mem', m: va.blob }))?.code === 'NEVER_SEND', 'vault blob in packet => rejected');
const s = N.guardOutgoing({ k: 'hello', code: id1, installSecret: 'zz', keys: { pub: 'p', sec: 'S', secretKey: 'S2' } });
assert(s.code === id1 && !('installSecret' in s) && s.keys.pub === 'p' && !('sec' in s.keys) && !('secretKey' in s.keys), 'forbidden fields stripped, ID + public key pass');
assert(thr(() => N.guardBody(JSON.stringify({ a: info })))?.code === 'NEVER_SEND', 'fetch bodies guarded too');
const { LocalBus } = await import('../src/net.js').catch(() => ({}));
const net = readFileSync(new URL('../src/net.js', import.meta.url), 'utf8'), am = readFileSync(new URL('../src/app-mesh.js', import.meta.url), 'utf8');
assert((net.match(/guardOutgoing\(assertSealed\(m\)\)/g) || []).length === 2 && !/[^g]fetch\(/.test(am.replace(/guardedFetch/g, '')), 'all bus posts + app-mesh fetches route through the guard');
// attestation
const att = await requestAttestation(id1, { cap: { getPlatform: () => 'web' } });
assert(att.provider === 'none' && att.nonce, 'web => unattested');
assert((await verifyAttestation({ ...att, provider: 'play-integrity', token: 't' }, {})).reason === 'not-configured', 'server stub: no env creds => not attested');
assert((await verifyAttestation({ ...att, id: 'OTHERID' }, {})).reason === 'nonce-mismatch', 'attestation nonce bound to ID');
// block list
const vv = await new V.Vault({ info: 'blk' }).load(); await vv.init({});
const bl = await new BlockList(vv, 'me').load(); await bl.add('BADGUY0000000000'); await bl.importLegacy(['OLD1234567']);
const bl2 = await new BlockList(vv, 'me').load(), other = await new BlockList(vv, 'other').load();
assert(bl2.isBlocked('BADGUY0000000000') && bl2.isBlocked('OLD1234567') && !other.isBlocked('BADGUY0000000000'), 'block list persisted in vault, per user');
assert(!bl2.allowInbound({ from: 'BADGUY0000000000' }) && bl2.allowInbound({ from: 'GOOD' }) && bl2.filter(['GOOD', 'BADGUY0000000000']).join() === 'GOOD', 'inbound + discovery from blocked IDs hidden');
await bl2.remove('BADGUY0000000000'); assert(!(await new BlockList(vv, 'me').load()).isBlocked('BADGUY0000000000'), 'unblock persists');
assert(!JSON.stringify(vv.blob).includes('OLD1234567'), 'block list encrypted at rest');
assert(!readFileSync(new URL('../src/blocklist.js', import.meta.url), 'utf8').match(/^import .*banlist/m), 'block list independent of banlist.js');
console.log('ALL OK smoke-twokey');
