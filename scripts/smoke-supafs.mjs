// v48 smoke: FORWARD SECRECY + MULTI-DEVICE for the server-relayed Supabase chat path. Node only, no network.
//  Part 1  src/backend/supabase-e2e.js fsSealer: signed device bundles (uid-bound), pins, seal2/open2 to every device of the
//          recipient + the sender's own devices, context binding (conversation / parties / sending device), tamper, low-order keys,
//          prekey rotation + erase after PREKEY_KEEP_MS (a recorded row is unreadable afterwards, even from the persisted state and
//          the long-term keys = seized phone), persistence round trip, v1 compat, size + perf.
//  Part 2  SupabaseStore against an in-memory PostgREST fake that applies the same rules as migration 20261028000015 (own rows,
//          same band + not blocked, 5-device cap, ik immutable, server-side recipient): publish/rotate, A -> B with two devices,
//          A's other device reads its own sent copy, legacy recipient -> v1 / requireFs refuses, forged rows dropped, removeDevice.
//  Part 3  wiring: src/supa-device.js vault persistence, signin.js publishes on sign-in / removes on sign-out, migration static checks.
//    node --no-warnings scripts/smoke-supafs.mjs
import nacl from 'tweetnacl';
import { readFileSync } from 'node:fs';
import * as F from '../src/backend/supabase-e2e.js';
import { SupabaseStore, ADAPTER_METHODS } from '../src/backend/supabase-store.js';
import { deviceSealer } from '../src/supa-device.js';
let n = 0; const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } n++; console.log('ok', m); };
const err = f => { try { f(); return null; } catch (e) { return e; } };
const B = u => Buffer.from(u).toString('base64');
const dev = (o = {}) => { const bx = nacl.box.keyPair(), sg = nacl.sign.keyPair(); let t = o.t0 ?? 1.7e12; const clock = { now: () => t, add: ms => { t += ms; } };
  const keys = { box: { xpub: B(bx.publicKey), xsec: B(bx.secretKey) }, sign: { pub: B(sg.publicKey), sec: B(sg.secretKey) }, deviceId: o.id || F.newDeviceId() };
  const st = { pre: null, pins: null }; const mk = (extra = {}) => F.fsSealer({ ...keys, prekeys: st.pre, pins: st.pins, onPrekeys: l => { st.pre = l; }, onPins: p => { st.pins = p; }, now: clock.now, ...extra });
  return { keys, st, clock, s: mk(), mk }; };
const UA = '11111111-1111-4111-8111-111111111111', UB = '22222222-2222-4222-8222-222222222222', UC = '33333333-3333-4333-8333-333333333333', CONV = '99999999-9999-4999-8999-999999999999';

// ---------------- Part 1: sealer
const a1 = dev(), a2 = dev(), b1 = dev(), b2 = dev(), c1 = dev();
const vb = (s, uid, row) => s.verifyDevice(uid, row);
{ const r = a1.s.bundle(UA); ok(/^cm-dev/.test('cm-dev') && r.device_id === a1.keys.deviceId && r.ik === a1.keys.box.xpub && r.sk_pub === a1.keys.sign.pub && /^[A-Za-z0-9+/]{86}==$/.test(r.spk_sig), 'bundle: public keys only, signed (format = migration checks)');
  ok(!JSON.stringify(r).includes(a1.keys.box.xsec) && !JSON.stringify(r).includes(a1.keys.sign.sec), 'bundle carries no secret');
  ok(vb(b1.s, UA, r), 'peer verifies a good bundle');
  ok(!vb(c1.s, UB, r), 'bundle is bound to its account (copied to another uid -> refused)');
  ok(!vb(c1.s, UA, { ...r, spk: b1.s.bundle(UB).spk }), 'swapped prekey (server substitution) -> signature fails');
  ok(!vb(c1.s, UA, { ...r, spk_sig: b1.s.bundle(UB).spk_sig }), 'foreign signature refused');
  const fake = nacl.sign.keyPair(), fr = { ...r, sk_pub: B(fake.publicKey) }; fr.spk_sig = B(nacl.sign.detached(new TextEncoder().encode(['cm-dev-v1', UA, fr.device_id, fr.ik, fr.sk_pub, fr.spk_id, fr.spk].join('|')), fake.secretKey));
  ok(vb(dev().s, UA, fr) && !vb(b1.s, UA, fr) && b1.s.stats.pinRefused === 1, 'pinned device: re-keyed bundle under the same device id refused (fresh observer would accept = TOFU)');
  ok(!vb(b1.s, UA, { ...r, ik: 'x' }) && !vb(b1.s, UA, { ...r, device_id: 'bad id!' }) && !vb(b1.s, UA, null), 'malformed rows refused');
  b1.s.forgetPin(UA, r.device_id); ok(vb(b1.s, UA, fr), 'forgetPin (user-confirmed key change) accepts the new keys'); b1.s.forgetPin(UA, r.device_id); ok(vb(b1.s, UA, r), 're-pinned original'); }
const rows = { a1: a1.s.bundle(UA), a2: a2.s.bundle(UA), b1: b1.s.bundle(UB), b2: b2.s.bundle(UB), c1: c1.s.bundle(UC) };
const ctx = { conv: CONV, from: UA, to: UB };
const m1 = a1.s.seal2({ ...ctx, toDevs: [rows.b1, rows.b2], myDevs: [rows.a1, rows.a2], text: 'gg wp, duo later? 🎮' });
const h1 = a1.s.header(m1.body);
ok(F.isV2(m1.body) && !m1.body.includes('gg wp') && !Buffer.from(m1.body.slice(4), 'base64').toString().includes('gg wp'), 'v2 body: cm2: header, no plaintext');
ok(h1.w.length === 4 && h1.w.filter(x => x[0] === 'r').length === 2 && h1.w.filter(x => x[0] === 's').length === 2, 'wrapped for 2 recipient devices + 2 own devices');
const op = (d, uid, m = m1, c = ctx, sd = rows.a1) => d.s.open2({ ...c, me: uid, body: m.body, nonce: m.nonce, senderDev: sd });
ok(op(b1, UB) === 'gg wp, duo later? 🎮' && op(b2, UB) === 'gg wp, duo later? 🎮', 'recipient opens on BOTH devices (multi-device)');
ok(op(a2, UA) === 'gg wp, duo later? 🎮', "sender's other device opens the sent copy");
ok(op(a1, UA) === 'gg wp, duo later? 🎮', 'sending device opens its own history');
ok(err(() => op(c1, UC))?.code === 'E2E_NOT_A_PARTY' && err(() => op(c1, UB))?.code === 'E2E_NOT_FOR_THIS_DEVICE', 'third device: not a party / not targeted');
ok(!!err(() => op(b1, UB, m1, { ...ctx, conv: '88888888-8888-4888-8888-888888888888' })), 'moved to another conversation -> refused');
ok(!!err(() => op(b1, UB, m1, { conv: CONV, from: UC, to: UB }, rows.c1)), 're-attributed to another sender -> refused');
ok(!!err(() => op(b1, UB, m1, ctx, { ...rows.a2, device_id: rows.a1.device_id })), "wrong sending-device key (server swapped sender's device row) -> refused");
ok(err(() => op(b1, UB, m1, ctx, rows.a2))?.code === 'E2E_UNKNOWN_SENDER_DEVICE', 'sender device id mismatch refused');
{ const hh = JSON.parse(Buffer.from(m1.body.slice(4), 'base64').toString()); const enc = o => 'cm2:' + Buffer.from(JSON.stringify(o)).toString('base64');
  const flip = s => { const u = Buffer.from(s, 'base64'); u[5] ^= 1; return u.toString('base64'); };
  ok(!!err(() => op(b1, UB, { body: enc({ ...hh, c: flip(hh.c) }), nonce: m1.nonce })), 'tampered ciphertext refused');
  ok(!!err(() => op(b1, UB, { body: enc({ ...hh, w: hh.w.map(x => [x[0], x[1], x[2], flip(x[3])]) }), nonce: m1.nonce })), 'tampered wrapped key refused');
  ok(!!err(() => op(b1, UB, { body: enc({ ...hh, e: B(nacl.box.keyPair().publicKey) }), nonce: m1.nonce })), 'swapped ephemeral refused');
  ok(!!err(() => op(b1, UB, { body: m1.body, nonce: B(nacl.randomBytes(24)) })), 'wrong nonce refused');
  ok(err(() => op(b1, UB, { body: 'cm2:!!!', nonce: m1.nonce }))?.code === 'E2E_BAD_HEADER', 'garbage header refused'); }
{ const lo = { ...rows.b1, spk: B(new Uint8Array(32)) }; ok(err(() => a1.s.seal2({ ...ctx, toDevs: [lo], text: 'x' }))?.code === 'E2E_LOW_ORDER_KEY', 'low-order (all-zero) prekey refused'); }
ok(err(() => a1.s.seal2({ ...ctx, toDevs: [], text: 'x' }))?.code === 'E2E_NO_RECIPIENT_DEVICE', 'no recipient device -> refused');
{ const m = a1.s.seal2({ ...ctx, toDevs: [rows.b1], text: 'solo' }); ok(a1.s.header(m.body).w.some(x => x[0] === 's' && x[1] === a1.keys.deviceId) && op(a1, UA, m) === 'solo', 'own device always included (history) even when not listed');
  const m2 = a1.s.seal2({ ...ctx, toDevs: [rows.b1], text: 'solo' }); ok(a1.s.header(m.body).e !== a1.s.header(m2.body).e && m.nonce !== m2.nonce, 'fresh ephemeral + nonce per message'); }
// forward secrecy over time
{ const pk0 = b1.s.currentPrekeyId(); b1.clock.add(F.PREKEY_ROTATE_MS + 1); const pk1 = b1.s.currentPrekeyId(); ok(pk1 !== pk0, 'prekey rotates after 24 h');
  ok(op(b1, UB) === 'gg wp, duo later? 🎮', 'old prekey still opens during the keep window');
  b1.clock.add(F.PREKEY_KEEP_MS - 3600e3); b1.s.rotate(); ok(op(b1, UB) === 'gg wp, duo later? 🎮', 'still opens just before the erase deadline (> 7-day hold)');
  b1.clock.add(2 * 3600e3); b1.s.rotate(); ok(err(() => op(b1, UB))?.code === 'E2E_PREKEY_ERASED', 'after PREKEY_KEEP_MS the old prekey secret is erased -> recorded row unreadable');
  ok(!b1.st.pre.some(x => x.id === pk0), 'erased prekey gone from the persisted state too');
  const seized = b1.mk(); ok(err(() => seized.open2({ ...ctx, me: UB, body: m1.body, nonce: m1.nonce, senderDev: rows.a1 }))?.code === 'E2E_PREKEY_ERASED', 'seized phone (long-term keys + vault state) cannot open the recorded row');
  ok(op(b2, UB) === 'gg wp, duo later? 🎮', 'other device keeps its own schedule (not yet rotated)');
  const nb = b1.s.bundle(UB); const m3 = a1.s.seal2({ ...ctx, toDevs: [nb], text: 'after rotation' }); ok(b1.s.open2({ ...ctx, me: UB, body: m3.body, nonce: m3.nonce, senderDev: rows.a1 }) === 'after rotation', 'new bundle after rotation works');
  const restored = b1.mk(); ok(restored.currentPrekeyId() === b1.s.currentPrekeyId() && restored.open2({ ...ctx, me: UB, body: m3.body, nonce: m3.nonce, senderDev: rows.a1 }) === 'after rotation', 'persisted state round trip (same current prekey, opens)'); }
// v1 compat
{ const legacy = F.boxSealer({ xsec: b2.keys.box.xsec }), v = legacy.seal(a1.keys.box.xpub, 'old v1'); ok(a1.s.open(b2.keys.box.xpub, v.body, v.nonce) === 'old v1', 'fsSealer opens v1 rows'); const w = a1.s.seal(b2.keys.box.xpub, 'to legacy'); ok(legacy.open(a1.keys.box.xpub, w.body, w.nonce) === 'to legacy' && !F.isV2(w.body), 'fsSealer seals v1 for a legacy peer'); }
// size + perf
{ const ten = Array.from({ length: 5 }, () => dev().s.bundle(UB)), mine = Array.from({ length: 5 }, () => dev().s.bundle(UA)); const txt = 'x'.repeat(4000);
  const t0 = performance.now(); let m; for (let i = 0; i < 20; i++) m = a1.s.seal2({ ...ctx, toDevs: ten, myDevs: mine, text: txt }); const ms = (performance.now() - t0) / 20;
  ok(a1.s.header(m.body).w.length === 11 && m.body.length < 16000 && m.nonce.length <= 64, `5+5(+self) devices, 4000-char text -> body ${m.body.length} chars (< 16000 DB check), nonce ${m.nonce.length}`);
  ok(ms < 250, `seal to 11 devices ${ms.toFixed(1)} ms/msg`);
  const t1 = performance.now(); for (let i = 0; i < 20; i++) op(b1, UB, a1.s.seal2({ ...ctx, toDevs: [b1.s.bundle(UB)], text: 'p' })); ok(true, `seal+open 1 device ${((performance.now() - t1) / 20).toFixed(1)} ms/msg`);
  ok(err(() => F.fsSealer({ box: a1.keys.box, sign: a1.keys.sign, deviceId: 'no' }))?.code === 'E2E_BAD_DEVICE_ID' && err(() => F.fsSealer({ deviceId: F.newDeviceId() }))?.code === 'E2E_NEED_DEVICE_KEYS', 'constructor validates device id + keys'); }

// ---------------- Part 2: SupabaseStore vs an in-memory PostgREST fake (rules of migration 20261028000015)
const db = { profiles: [], conversations: [], messages: [], e2e_devices: [], blocks: [] };
const band = u => db.profiles.find(p => p.id === u)?.age_band, blocked = (x, y) => db.blocks.some(b => (b.blocker_id === x && b.blocked_id === y) || (b.blocker_id === y && b.blocked_id === x));
const canSee = (t, r, me) => t === 'e2e_devices' ? r.user_id === me || (band(me) && band(me) === band(r.user_id) && !blocked(me, r.user_id) && Date.parse(r.updated_at) > Date.now() - 30 * 864e5)
  : t === 'messages' ? [r.sender_id, r.recipient_id].includes(me) : t === 'conversations' ? [r.user_a, r.user_b].includes(me) : true;
let uuidN = 0; const uuid = () => `00000000-0000-4000-8000-${String(++uuidN).padStart(12, '0')}`;
function q(t, me) { const st = { op: 'select', f: [], ord: null, lim: null, one: null, ret: false };
  const run = () => { let rows = db[t].filter(r => canSee(t, r, me) && st.f.every(fn => fn(r)));
    if (st.op === 'insert') { const out = []; for (const v of st.vals) { const r = { ...v };
        if (t === 'e2e_devices') { if (r.user_id !== me) return { data: null, error: { code: '42501', message: 'rls' } }; if (db.e2e_devices.filter(x => x.user_id === me).length >= 5) return { data: null, error: { code: '23514', message: 'e2e: at most 5 devices' } };
          if (db.e2e_devices.some(x => x.user_id === me && x.device_id === r.device_id)) return { data: null, error: { code: '23505', message: 'dup' } }; r.updated_at = r.created_at = new Date().toISOString(); }
        if (t === 'conversations') { r.id = uuid(); }
        if (t === 'messages') { if (r.sender_id !== me) return { data: null, error: { code: '42501', message: 'rls' } }; const c = db.conversations.find(x => x.id === r.conversation_id); r.recipient_id = c.user_a === me ? c.user_b : c.user_a;
          if (blocked(me, r.recipient_id)) return { data: null, error: { code: '42501', message: 'rls' } }; r.id = uuid(); r.status = 'sent'; r.created_at = new Date(Date.now() + uuidN).toISOString(); r.expires_at = new Date(Date.now() + 7 * 864e5).toISOString(); }
        db[t].push(r); out.push(r); } rows = out; }
    else if (st.op === 'update') { if (t === 'e2e_devices' && Object.keys(st.vals).some(k => !['spk_id', 'spk', 'spk_sig'].includes(k))) return { data: null, error: { code: '42501', message: 'column' } };
      rows = rows.filter(r => t !== 'e2e_devices' || r.user_id === me); for (const r of rows) { Object.assign(r, st.vals); if (t === 'e2e_devices') r.updated_at = new Date().toISOString(); } }
    else if (st.op === 'delete') { rows = rows.filter(r => t !== 'e2e_devices' || r.user_id === me); db[t] = db[t].filter(r => !rows.includes(r)); }
    if (st.ord) rows = [...rows].sort((x, y) => (x[st.ord.k] < y[st.ord.k] ? -1 : 1) * (st.ord.asc ? 1 : -1)); if (st.lim) rows = rows.slice(0, st.lim);
    rows = rows.map(r => ({ ...r }));
    if (st.one === 'single') return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { code: 'PGRST116', message: 'not single' } };
    if (st.one === 'maybe') return { data: rows[0] || null, error: null };
    return { data: st.op === 'select' || st.ret ? rows : null, error: null }; };
  const o = { select() { if (st.op !== 'select') st.ret = true; return o; }, insert(v) { st.op = 'insert'; st.vals = Array.isArray(v) ? v : [v]; return o; }, update(v) { st.op = 'update'; st.vals = v; return o; }, delete() { st.op = 'delete'; return o; },
    eq(k, v) { st.f.push(r => r[k] === v); return o; }, neq(k, v) { st.f.push(r => r[k] !== v); return o; }, in(k, v) { st.f.push(r => v.includes(r[k])); return o; },
    order(k, { ascending = true } = {}) { st.ord = { k, asc: ascending }; return o; }, limit(n) { st.lim = n; return o; }, single() { st.one = 'single'; return o; }, maybeSingle() { st.one = 'maybe'; return o; },
    then(res, rej) { try { res(run()); } catch (e) { rej(e); } } }; return o; }
const client = uid => ({ from: t => q(t, uid), auth: { getSession: async () => ({ data: { session: { user: { id: uid } } } }) } });
db.profiles.push({ id: UA, age_band: 'adult', e2e_pubkey: a1.keys.box.xpub }, { id: UB, age_band: 'adult', e2e_pubkey: b1.keys.box.xpub }, { id: UC, age_band: 'adult', e2e_pubkey: c1.keys.box.xpub });
const sA1 = new SupabaseStore(client(UA), { sealer: dev({ id: 'devA1aaaa' }).s }), sA2 = new SupabaseStore(client(UA), { sealer: dev({ id: 'devA2aaaa' }).s });
const sB1 = new SupabaseStore(client(UB), { sealer: dev({ id: 'devB1bbbb' }).s }), sB2 = new SupabaseStore(client(UB), { sealer: dev({ id: 'devB2bbbb' }).s });
ok(['publishDevice', 'listDevices', 'removeDevice', 'openRow'].every(m => ADAPTER_METHODS.includes(m) && typeof SupabaseStore.prototype[m] === 'function'), 'adapter: publishDevice/listDevices/removeDevice/openRow');
for (const s of [sA1, sA2, sB1, sB2]) await s.publishDevice();
ok(db.e2e_devices.length === 4 && db.e2e_devices.every(r => !('xsec' in r)), 'four devices published (public keys only)');
{ const before = db.e2e_devices.find(r => r.device_id === 'devB1bbbb').spk_id; sB1.sealer.rotate(); await sB1.publishDevice(); ok(db.e2e_devices.filter(r => r.device_id === 'devB1bbbb').length === 1 && db.e2e_devices.find(r => r.device_id === 'devB1bbbb').spk_id === before, 'publish again = update in place (no duplicate row)'); }
{ const r = await sA1.sendMessage(UA, UB, 'hello both phones'); const raw = db.messages.find(m => m.id === r.msg.id);
  ok(r.ok && r.msg.fs && F.isV2(raw.body) && !raw.body.includes('hello') && raw.nonce, 'A -> B sent as v2 (server row = ciphertext)');
  ok(sA1.sealer.header(raw.body).w.filter(x => x[0] === 'r').length === 2 && sA1.sealer.header(raw.body).w.filter(x => x[0] === 's').length === 2, 'wrapped to both B devices + both A devices');
  for (const [s, nm] of [[sB1, 'B phone 1'], [sB2, 'B phone 2'], [sA2, "A's other phone"], [sA1, 'A sending phone']]) { const l = await s.listMessages(null); ok(l.find(m => m.id === r.msg.id)?.text === 'hello both phones' && l.find(m => m.id === r.msg.id).fs === true, nm + ' reads it'); }
  ok((await sB1.openRow(raw)).text === 'hello both phones', 'openRow (realtime row) opens');
  const sC = new SupabaseStore(client(UC), { sealer: dev({ id: 'devC1cccc' }).s }); ok(!(await sC.listMessages(null)).some(m => m.id === r.msg.id), 'third user never gets the row (RLS)'); }
// legacy recipient: no device rows -> v1 static; requireFs -> refused
{ const legacyC = new SupabaseStore(client(UC), { sealer: F.boxSealer({ xsec: c1.keys.box.xsec }) });
  const r = await sA1.sendMessage(UA, UC, 'to an old client'); ok(db.profiles.find(p => p.id === UA).e2e_pubkey === sA1.sealer.ik || db.profiles.find(p => p.id === UA).e2e_pubkey === sA2.sealer.ik, 'publishDevice keeps profiles.e2e_pubkey = an active device ik (v1 compat)');
  db.profiles.find(p => p.id === UA).e2e_pubkey = sA1.sealer.ik; ok(r.ok && !r.msg.fs && !F.isV2(db.messages.find(m => m.id === r.msg.id).body), 'legacy recipient (no bundle) -> v1 fallback');
  ok((await legacyC.listMessages(null)).find(m => m.id === r.msg.id)?.text === 'to an old client', 'legacy client opens it');
  const strict = new SupabaseStore(client(UA), { sealer: sA1.sealer, requireFs: true }); ok((await strict.sendMessage(UA, UC, 'x')).reason === 'no-peer-device', 'requireFs refuses the v1 downgrade'); }
// forged device row injected server-side for B (attacker key under B's existing device id / bad signature) is not targeted
{ const atk = dev({ id: 'devB1bbbb' }); const forged = atk.s.bundle(UB); const real = db.e2e_devices.find(r => r.device_id === 'devB1bbbb'); const saved = { ...real };
  Object.assign(real, forged); const evil = dev({ id: 'evilevil1' }).s.bundle(UB); db.e2e_devices.push({ ...evil, spk_sig: forged.spk_sig, user_id: UB, updated_at: new Date().toISOString() });
  const r = await sA1.sendMessage(UA, UB, 'pinned'); const h = sA1.sealer.header(db.messages.find(m => m.id === r.msg.id).body);
  ok(r.ok && !h.w.some(x => x[1] === 'evilevil1') && !h.w.some(x => x[1] === 'devB1bbbb'), 're-keyed (pin) + badly signed device rows are not targeted');
  ok(sA1.sealer.stats.pinRefused >= 1 && sA1.sealer.stats.badSig >= 1, 'refusals counted');
  db.e2e_devices = db.e2e_devices.filter(x => x.device_id !== 'evilevil1'); Object.assign(real, saved); sA1._dev.clear(); }
// device removal: a removed (signed-out) device is no longer targeted
{ await sB2.removeDevice(); const r = await sA1.sendMessage(UA, UB, 'after B2 signed out'); const l2 = await sB2.listMessages(null), l1 = await sB1.listMessages(null);
  ok(l1.find(m => m.id === r.msg.id)?.text === 'after B2 signed out' && l2.find(m => m.id === r.msg.id)?.undecryptable === true && l2.find(m => m.id === r.msg.id).why === 'E2E_NOT_FOR_THIS_DEVICE', 'removed device no longer gets new messages; the other still does'); }
// 5-device cap
{ const extra = []; for (let i = 0; i < 4; i++) extra.push(new SupabaseStore(client(UA), { sealer: dev().s })); let refused = null; for (const s of extra) { try { await s.publishDevice(); } catch (e) { refused = e; } }
  ok(refused && /5 devices/.test(refused.message) && db.e2e_devices.filter(r => r.user_id === UA).length === 5, '5-device cap per account (6th refused)'); }
// B replies; A's both phones read it (sender rows of the other side)
{ const r = await sB1.sendMessage(UB, UA, 'reply'); ok(r.ok && r.msg.fs, 'B -> A v2'); ok((await sA2.listMessages(null)).find(m => m.id === r.msg.id)?.text === 'reply', "A's second phone reads B's reply"); }

// ---------------- Part 3: wiring + migration
{ const mem = { obj: {} }; const v = { use: async fn => { const o = JSON.parse(JSON.stringify(mem.obj)); const r = await fn(o); mem.obj = o; return r; } };
  const s1 = await deviceSealer(v); await s1.flush(); const d = mem.obj.supaDevice; ok(d && d.id === s1.deviceId && d.box?.xsec && d.sign?.sec && d.pre?.length === 1, 'deviceSealer: device id + keys + prekeys kept in the vault');
  const s2 = await deviceSealer(v); ok(s2.deviceId === s1.deviceId && s2.currentPrekeyId() === s1.currentPrekeyId() && s2.ik === s1.ik, 'second boot: same device, same prekey'); }
const src = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
{ const si = src('src/signin.js'); ok(/deviceSealer/.test(si) && /publishDevice\(\)/.test(si) && /removeDevice\(\)/.test(si), 'signin: FS sealer from the vault, publish on sign-in, remove on sign-out');
  const mg = src('supabase/migrations/20261028000015_e2e_devices.sql');
  ok(/alter table public\.e2e_devices enable row level security/.test(mg) && !/to anon/.test(mg) && /grant update \(spk_id, spk, spk_sig\)/.test(mg) && /app\.can_interact\(user_id\)/.test(mg) && /interval '30 days'/.test(mg) && /n >= 5/.test(mg), 'migration: RLS, no anon, prekey-only updates, same-band/not-blocked, 30-day freshness, 5-device cap');
  ok(F.MAX_DEVICES === 5 && F.PREKEY_KEEP_MS > 7 * 864e5 && /interval '7 days'/.test(src('supabase/migrations/20261021000003_messaging_safety_community.sql')), 'prekey keep window (8 d) > server hold (7 d)');
  ok(/ownSent/.test(src('src/backend/supabase-realtime.js')), 'realtime: optional own-sent rows for multi-device'); }
console.log(`SMOKE-SUPAFS: ALL OK (${n} checks)`);
