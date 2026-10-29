// Smoke for items 2–10 (imported by smoke.mjs).
import * as V from '../src/vault.js';
import * as T from '../src/transfer.js';
import * as M from '../src/mesh.js';
import * as E from '../src/entitlements.js';
import * as A from '../src/appconfig.js';
import * as P from '../src/p2p.js';
import { keygen } from './lib/sign.mjs';
import { verifyStripeSig, issueReceipt, keyFromSeed } from '../api/_lib/receipt.js';
import { receiptFromEvent } from '../api/stripe-webhook.js';
import nodeCrypto from 'node:crypto';
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const throws = async f => { try { await f(); return null; } catch (e) { return e; } };
const wait = (ms = 20) => new Promise(r => setTimeout(r, ms));

// ---- 2. device key + envelope ----
const store = new V.MemorySecretStore(); let saved = null; const persist = { load: async () => saved, save: async b => { saved = b; } };
const v = new V.Vault({ store, persist, info: 'dev-id|Pixel 8|android' });
await v.init({ userCode: 'ABCDEFGHJK', wallet: { boosts: 7, extraStarters: 1234567 }, name: 'Neo' });
const raw = JSON.stringify(saved);
assert(!/1234567|Neo|boosts|ABCDEFGHJK/.test(raw) && saved.kdf === V.KDF_VERSION, 'blob has no plaintext values/field names');
assert(!(await store.get('install-secret')).extractable, 'install secret is non-extractable CryptoKey');
assert((await v.use(p => { p.wallet.boosts--; return p.wallet.boosts; })) === 6 && (await v.read()).wallet.boosts === 6, 'use() decrypts in memory, re-encrypts');
assert(JSON.stringify(saved) !== raw, 're-encrypted with fresh IVs');
{ const other = new V.Vault({ store: new V.MemorySecretStore(), persist, info: 'dev-id|Pixel 8|android' }); assert(await throws(() => other.load().then(o => o.read())), 'other install secret (other device) cannot decrypt'); }
{ const wrong = new V.Vault({ store, persist, info: 'dev-id|Pixel 9|android' }); assert(await throws(() => wrong.load().then(o => o.read())), 'different device info cannot decrypt'); }
{ const k = await v.key(V.KDF_VERSION); const f = await V.sealFields(k, { a: 1, b: 1 }); assert(f.a.ct !== f.b.ct && f.a.wk.ct !== f.b.wk.ct, 'per-field random data keys (equal values look different)');
  const swapped = { a: f.b }; assert(await throws(() => V.openFields(k, swapped)), 'field swap detected (name bound as AAD)'); }
// ---- 10. KDF rotation ----
{ const st = new V.MemorySecretStore(); let s = null; const pp = { load: async () => s, save: async b => { s = b; } };
  const v1 = new V.Vault({ store: st, persist: pp, info: 'x' }); v1.blob = await V.seal(await v1.key(1), { n: 42 }, 1);
  assert((await v1.read()).n === 42 && s.kdf === 2 && v1.migrated === 1, 'v2 decrypts v1 data and re-encrypts as v2');
  v1.blob = { ...s, kdf: 0 }; assert((await throws(() => v1.read()))?.code === 'KDF_TOO_OLD', 'data older than window rejected'); }
assert(A.checkVersion(2).ok && A.checkVersion(1).ok && A.checkVersion(0).reason === 'old-version' && A.checkVersion(undefined).reason === 'no-version', 'two-version window (N, N-1)');
{ P.giveConsent('vv'); const r = P.acceptPeer({ ...P.attestation('old'), app_version: 0 }, { isMutual: () => true }); assert(r.reason === 'old-version' && r.message === A.UPDATE_MESSAGE, 'handshake rejects old peer with please-update'); }
{ const K = keygen(); const cfg = (await import('./lib/sign.mjs')).signConfig({ type: 'app_config', min_version: 2, issued_at: Date.now(), nonce: 'n1' }, K.privateKey);
  assert(!A.applyConfig({ ...cfg, min_version: 9 }, K.publicKey), 'tampered config rejected');
  assert(A.applyConfig(cfg, K.publicKey) && A.checkVersion(1).reason === 'old-version' && !A.selfOutdated(), 'signed config raises min version'); A.resetConfig(); }

// ---- 3. transfer ----
const pair = () => { const a = [], b = []; return [{ send: m => b.forEach(f => queueMicrotask(() => f(m))), on: f => a.push(f) }, { send: m => a.forEach(f => queueMicrotask(() => f(m))), on: f => b.push(f) }]; };
{ const [sb, rb] = pair(); let wiped = false; const code = T.newCode(); assert(/^\d{6}$/.test(code), '6-digit code');
  const s = await T.startSender({ bus: sb, code, getProfile: () => v.read(), wipe: async () => { await v.wipe(); wiped = true; } });
  assert(s.exp - Date.now() <= T.CODE_TTL_MS && s.exp - Date.now() > T.CODE_TTL_MS - 5000, 'code valid 10 min');
  let nsaved = null; const nv = new V.Vault({ store: new V.MemorySecretStore(), persist: { load: async () => nsaved, save: async b => { nsaved = b; } }, info: 'new-phone' });
  await T.receive({ bus: rb, code, importProfile: p => nv.init(p) }); await wait(50);
  { const np = await nv.read(); assert(np.name === 'Neo' && np.userCode === 'ABCDEFGHJK' && np.wallet.boosts === 0 && np.wallet.extraStarters === 0 && wiped && saved === null, 'transfer keeps profile, zeroes device-bound boosts/starters, re-encrypted on new device, old wiped after confirm'); } }
{ const [sb] = pair(); const [, rb2] = pair(); let t = 0; const bus = pair(); const s = await T.startSender({ bus: bus[0], code: '123456', getProfile: () => ({}), wipe: () => {}, now: () => Date.now() });
  let last; for (let i = 0; i < 6; i++) last = await throws(() => T.receive({ bus: bus[1], code: '000000' }));
  assert(s.state === 'burned' && /too-many|bad-code/.test(last.message), 'wrong codes rate-limited; code burned after 5');
  void sb; void rb2; void t; }
{ const bus = pair(); let now = Date.now(); const s = await T.startSender({ bus: bus[0], code: '111111', getProfile: () => ({}), wipe: () => {}, now: () => now }); now += T.CODE_TTL_MS + 1;
  assert((await throws(() => T.receive({ bus: bus[1], code: '111111' })))?.message === 'expired', 'expired code rejected'); void s; }

// ---- 4–8. mesh ----
let clock = Date.now(); const now = () => clock;
const mkWallet = n => ({ n, async consume() { if (this.n <= 0) return false; this.n--; return true; }, async refund() { this.n++; } });
const mesh = new M.SimMesh();
const alice = mesh.add(new M.MeshNode({ code: 'ALICE00001', wallet: mkWallet(3), now, profile: { name: 'Alice' } }));
const relay = mesh.add(new M.MeshNode({ code: 'RELAY00001', wallet: mkWallet(0), now }), ['ALICE00001']);
const bob = mesh.add(new M.MeshNode({ code: 'BOB0000001', wallet: mkWallet(3), now, profile: { name: 'Bob' } }), ['RELAY00001']);
const eve = mesh.add(new M.MeshNode({ code: 'EVE0000001', wallet: mkWallet(3), now, profile: { name: 'Eve' } }), ['RELAY00001']);
let r = await alice.requestFriend('BOB0000001', { boost: true }); assert(r.reason === 'offline' && r.message === M.OFFLINE_MSG && alice.wallet.n === 3, 'offline recipient: "offline, try later", boost not consumed');
bob.ping(); eve.ping(); alice.ping(); await wait();
assert(alice.isOnline('BOB0000001'), 'presence via ping across relay hop');
assert((await alice.sendStarter('BOB0000001', 'hi')).reason === 'retired', 'paid 500-char starter retired');
alice.send('BOB0000001', 'chat', { from: 'ALICE00001', text: 'sneaky', at: 1 }); alice.send('BOB0000001', 'starter', { text: 'old starter' }); alice.send('BOB0000001', 'freq', { pub: alice.keys.pub, text: 'hi in a request' }); await wait();
assert(!bob.chats.get('ALICE00001')?.msgs.length && !bob.inbox.length && !bob.pendingIn.has('ALICE00001') && bob.dropped >= 3, 'accept-before-any-message: stranger chat/starter/text-in-request all dropped by the receiving phone');
assert(alice.sendChat('BOB0000001', 'hello').reason === 'not-accepted', 'sender UI cannot chat before acceptance');
r = await alice.requestFriend('BOB0000001', { boost: true }); assert(r.ok && r.delivered && alice.wallet.n === 2 && bob.pendingIn.has('ALICE00001') && bob.boosted.has('ALICE00001'), 'bare request delivered with signed receipt; boost spent + highlighted');
bob.block('EVE0000001'); r = await eve.requestFriend('BOB0000001', { boost: true });
assert(r.reason === 'blocked' && r.message === M.BLOCKED_MSG && eve.wallet.n === 3 && r.refunded && !bob.pendingIn.has('EVE0000001'), "blocked: dropped at destination, 'you've been blocked', no receipt -> boost refunded");
{ const eve2 = new M.MeshNode({ code: 'EVE0000001', wallet: mkWallet(0), now, profile: { name: 'Bob' } }); assert(bob.blocked.has(eve2.code) && !bob.blocked.has('Bob'), 'block keyed on user code, not display name'); }
bob.acceptFriend('ALICE00001'); await wait(); assert(alice.friends.has('BOB0000001'), 'accepted -> friends');
// 5. chat (only after acceptance)
assert(alice.sendChat('BOB0000001', 'live').ok, 'chat after acceptance'); await wait();
assert(bob.chats.get('ALICE00001').msgs.length === 1 && !bob.chats.get('ALICE00001').save, 'chat ephemeral by default (memory)');
alice.proposeBurn('BOB0000001', 1000); await wait(); assert(!alice.burnActive('BOB0000001'), 'burn needs both');
bob.proposeBurn('ALICE00001', 1000); await wait(); assert(alice.burnActive('BOB0000001') === 1000, 'burn active when both agree');
alice.sendChat('BOB0000001', 'secret'); await wait(); bob.markRead('ALICE00001'); clock += 1500; bob.sweep(); alice.sweep();
assert(!bob.chats.get('ALICE00001').msgs.some(m => m.text === 'secret') && !alice.chats.get('BOB0000001').msgs.some(m => m.text === 'secret'), 'burn: deleted after read + timer');
{ const bv = new V.Vault({ store: new V.MemorySecretStore(), info: 'b' }); await bv.init({}); await bob.setPlan('ALICE00001', 'Halo tomorrow 8pm', bv);
  assert((await bob.getPlans(bv)).ALICE00001.text === 'Halo tomorrow 8pm' && !JSON.stringify(bv.blob).includes('Halo'), 'plans note stored encrypted (no long-term chat save)');
  clock += M.PLAN_TTL_MS + 1; assert(!(await bob.getPlans(bv)).ALICE00001 && !(await bv.read()).plans.ALICE00001, 'plans note auto-expires after 48h');
  clock -= M.PLAN_TTL_MS + 1; bob.ping(); alice.ping(); await wait(); }
// 6. friends + signed updates
await wait(); assert(alice.friends.has('BOB0000001') && bob.friends.has('ALICE00001') && alice.view('BOB0000001').profile.name === 'Bob' && alice.friends.get('BOB0000001').stub.profile.name === 'Bob', 'mutual friendship; full profile while online, stub kept');
bob.updateProfile({ name: 'Bobby' }); await wait(); assert(alice.view('BOB0000001').profile.name === 'Bobby', 'signed profile update synced over mesh');
{ const forged = M.signProfile('BOB0000001', 99, { name: 'pwned' }, eve.keys.sec); alice.on_profile('BOB0000001', { sp: forged }); assert(alice.view('BOB0000001').profile.name === 'Bobby', 'forged profile update rejected'); }
assert(alice.sendChat('BOB0000001', 'pic', { attachment: 'img' }).ok, 'images allowed between friends');
// presence-first: online => full; offline => stub only, full purged from memory; nothing full persisted
{ const thumb = 'data:image/jpeg;base64,' + 'A'.repeat(200);
  const cam = mesh.add(new M.MeshNode({ code: 'CAM0000001', wallet: mkWallet(0), now, profile: { name: 'Cam', thumb, bio: 'SECRET-BIO', photos: ['data:image/jpeg;base64,FULLPHOTO'] } }), ['RELAY00001']);
  cam.ping(); await wait(); let pv = alice.view('CAM0000001');
  assert(pv.full && pv.profile.bio === 'SECRET-BIO', 'online peer: full profile accessible');
  clock += 6 * 60e3; pv = alice.view('CAM0000001');
  assert(!pv.full && pv.name === 'Cam' && pv.thumb === thumb && pv.code === 'CAM0000001' && pv.status === 'offline ~2h' && Object.keys(pv).sort().join() === 'code,full,name,status,thumb', 'offline peer: stub only (thumb, name, code, last-seen bucket)');
  const mem = JSON.stringify([...alice.live.values(), ...alice.cache.values(), alice.persistable()]);
  assert(!alice.live.has('CAM0000001') && !/SECRET-BIO|FULLPHOTO/.test(mem), 'after purge: nothing full in memory or persistable state');
  assert(!/bio|photos/.test(JSON.stringify(alice.persistable())), 'friends persist relationship+pubkey+stub only');
  assert(!M.validStub({ name: 'x', thumb: 'data:image/jpeg;base64,' + 'A'.repeat(5000) }) && !M.validStub({ name: 'x', bio: 'y' }), 'stubs limited to tiny thumb + name');
  clock += 3 * 864e5; alice.prune(); assert(!alice.view('CAM0000001') && alice.view('BOB0000001')?.name === 'Bobby', 'stranger stub dropped at 2 days; friend stub kept'); clock -= 3 * 864e5 + 6 * 60e3; }
// 7. cache + recency
assert(M.recency(clock, clock) === 'online' && M.recency(clock - 6 * 60e3, clock) === 'offline ~2h' && M.recency(clock - 3 * 3600e3, clock) === 'offline ~4h' && M.recency(clock - 5 * 3600e3, clock) === 'offline ~6h+' && M.recency(clock - 3 * 864e5, clock) === null, 'recency ladder');
{ const entries = Array.from({ length: 80 }, (_, i) => { const k = M.newSigningKeys(); return { sp: M.signProfile('U' + String(i).padStart(9, '0'), 0, { name: 'U' + i }, k.sec), pub: k.pub, lastSeen: clock }; });
  entries.push({ ...entries[0], sp: { ...entries[0].sp, profile: { name: 'forged' } } });
  alice.ingest(entries); assert(alice.cache.size === 50 && !alice.listCache().some(x => x.profile.name === 'forged'), 'cache capped at 50, unsigned/forged dropped');
  alice.gossip(); await wait(); assert(relay.cache.size >= 10, 'gossip echoes profiles to peers');
  clock += 3 * 864e5; alice.prune(); assert(alice.cache.size === 0, 'dropped after 2 days'); }

// ---- 9. receipts + webhook ----
{ const seed = Buffer.from(nodeCrypto.randomBytes(32)).toString('base64'), pub = Buffer.from(keyFromSeed(seed).publicKey).toString('base64');
  const sub = issueReceipt({ user_code: 'ALICE00001', sku: 'plus1m', status: 'active', period_end: Date.now() + 864e5 }, seed);
  const boost = issueReceipt({ user_code: 'ALICE00001', sku: 'boost5', status: 'paid', boosts: 5 }, seed);
  let f = E.activeFeatures([sub, boost], { userCode: 'ALICE00001', pub }); assert(f.plus && f.boosts === 5, 'server-signed receipts unlock');
  f = E.activeFeatures([{ ...boost, boosts: 500 }, E.signReceipt({ user_code: 'ALICE00001', sku: 'plus1m', status: 'active', period_end: 9e15 }, Buffer.from(nacl.sign.keyPair().secretKey).toString('base64'))], { userCode: 'ALICE00001', pub });
  assert(!f.plus && f.boosts === 0, 'tampered / self-signed receipts rejected');
  assert(E.activeFeatures([boost], { userCode: 'EVE0000001', pub }).boosts === 0, 'receipt bound to user code');
  const lapsed = issueReceipt({ user_code: 'ALICE00001', sku: 'plus1m', status: 'inactive', period_end: Date.now() - 1 }, seed);
  assert(!E.activeFeatures([lapsed], { userCode: 'ALICE00001', pub }).plus, 'unpaid renewal => feature removed');
  const body = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', mode: 'payment', payment_status: 'paid', client_reference_id: 'ALICE00001', metadata: { sku: 'boost5' } } } });
  const t = Math.floor(Date.now() / 1000), sig = nodeCrypto.createHmac('sha256', 'whsec_test').update(`${t}.${body}`).digest('hex');
  assert(verifyStripeSig(body, `t=${t},v1=${sig}`, 'whsec_test') && !verifyStripeSig(body + ' ', `t=${t},v1=${sig}`, 'whsec_test') && !verifyStripeSig(body, `t=${t - 900},v1=${sig}`, 'whsec_test'), 'webhook signature verified (tamper/replay window)');
  assert(receiptFromEvent(JSON.parse(body)).boosts === 5, 'webhook event -> receipt fields'); }
import nacl from 'tweetnacl';
