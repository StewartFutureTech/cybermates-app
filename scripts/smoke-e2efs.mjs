// v47 smoke: E2E hardening (forward secrecy for directed mesh envelopes + PAKE device transfer). Node only, no network.
//  Part 1  src/pake.js: Elligator2 points on the curve, same code -> same ISK, wrong code / other session -> different, low-order refused.
//  Part 2  src/transfer.js v2: happy path, wire has nothing to test a code against (no salt / no code hash), 10-way bucket rendezvous,
//          wrong code fails fast, burn after MAX_ATTEMPTS, expiry, forged x-err can't break a real transfer, two concurrent
//          transfers in ONE bucket both succeed, tampered data refused, active guesser = exactly one guess per answered share.
//  Part 3  src/e2e.js v2: signed prekeys in pings, v2 envelopes (epk/pk signed + AAD), sender ephemeral rotation (time / count),
//          prekey rotation + erase after PREKEY_KEEP_MS (recorded traffic unreadable afterwards, even from the persisted state +
//          long-term keys), persistence round trip, old clients still on v1 both ways, forged prekey -> v1, tamper refused, caches bounded.
//  Part 4  wiring: app-mesh persists prekeys in the vault, binder wiring unchanged, no PBKDF2(code) left.
//    node --no-warnings scripts/smoke-e2efs.mjs
import nacl from 'tweetnacl';
import { readFileSync } from 'node:fs';
import * as PK from '../src/pake.js';
import * as T from '../src/transfer.js';
import * as E from '../src/e2e.js';
import { b64 } from '../src/vault.js';
let n = 0; const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } n++; console.log('ok', m); };
const throws = async f => { try { await f(); return null; } catch (e) { return e; } };
const eq = (a, b) => !!a && !!b && Buffer.from(a).equals(Buffer.from(b));
const kp = () => { const k = nacl.sign.keyPair(); return { pub: b64(k.publicKey), sec: b64(k.secretKey) }; };

// ---------------- Part 1: PAKE
{ let off = 0; for (let i = 0; i < 400; i++) if (!PK.onCurve(PK._test.leLoad(PK.generator(String(i).padStart(6, '0'), nacl.randomBytes(16))))) off++;
  ok(off === 0, 'pake: 400/400 generators (Elligator2 of SHA-512(code, sid)) are points ON Curve25519');
  const sid = nacl.randomBytes(16), sid2 = nacl.randomBytes(16);
  ok(eq(PK.generator('123456', sid), PK.generator('123456', sid)) && !eq(PK.generator('123456', sid), PK.generator('123457', sid)) && !eq(PK.generator('123456', sid), PK.generator('123456', sid2)), 'pake: generator deterministic per (code, sid), differs for another code or session');
  const r = PK.share('123456', sid), s = PK.share('123456', sid), w = PK.share('654321', sid);
  ok(eq(PK.isk(r.y, s.Y, sid, r.Y, s.Y), PK.isk(s.y, r.Y, sid, r.Y, s.Y)) && PK.isk(r.y, s.Y, sid, r.Y, s.Y).length === 64, 'pake: same code -> both sides derive the same 64-byte ISK');
  ok(!eq(PK.isk(r.y, w.Y, sid, r.Y, w.Y), PK.isk(w.y, r.Y, sid, r.Y, w.Y)), 'pake: wrong code -> ISKs differ (key confirmation fails)');
  ok(!eq(PK.isk(r.y, s.Y, sid, r.Y, s.Y), PK.isk(r.y, s.Y, sid2, r.Y, s.Y)), 'pake: ISK bound to the session id (transcript)');
  const one = new Uint8Array(32); one[0] = 1; ok(PK.isk(r.y, new Uint8Array(32), sid, r.Y, one) === null && PK.isk(r.y, one, sid, r.Y, one) === null && PK.isk(r.y, new Uint8Array(31), sid, r.Y, one) === null, 'pake: zero / low-order / malformed shares refused (no key)');
  ok(PK.elligator2(0n) === PK._test.md(-PK._test.A) || PK.onCurve(PK.elligator2(0n)), 'pake: exceptional input r=0 handled'); }

// ---------------- Part 2: transfer v2
const hub = () => { const subs = []; const wire = []; return { wire, bus: () => { const me = { fns: [] }; subs.push(me); return { send: m => { wire.push(m); for (const s of subs) if (s !== me) for (const f of s.fns) queueMicrotask(() => f(structuredClone(m))); }, on: f => me.fns.push(f) }; }, inject: m => { wire.push(m); for (const s of subs) for (const f of s.fns) queueMicrotask(() => f(structuredClone(m))); } }; };
{ const h = hub(); let wiped = false, got = null; const code = T.newCode(); ok(/^\d{6}$/.test(code), 'transfer: 6-digit code (UI unchanged)');
  const s = await T.startSender({ bus: h.bus(), code, getProfile: () => ({ name: 'Neo', secretNote: 'zebra-42', wallet: { boosts: 3 } }), wipe: async () => { wiped = true; } });
  await T.receive({ bus: h.bus(), code, importProfile: p => { got = p; } }); await new Promise(r => setTimeout(r, 30));
  ok(got?.name === 'Neo' && got.secretNote === 'zebra-42' && wiped && s.state === 'done' && s.attempts === 1, 'transfer: right code -> profile moved, old phone wiped after confirmation, 1 share used');
  const w = JSON.stringify(h.wire); ok(!w.includes(code) && !w.includes('zebra-42') && !/salt/.test(w) && h.wire.every(m => /^x2-/.test(m.t)), 'transfer: wire carries no code, no plaintext, no PBKDF2 salt (only PAKE shares, MACs, ciphertext)');
  const keys = new Set(h.wire.flatMap(m => Object.keys(m))); ok([...keys].every(k => ['t', 'rid', 'sid', 'Y', 'v', 'kc', 'iv', 'ct', 'nonce', 'proof'].includes(k)), 'transfer: message fields limited to t/rid/sid/Y/v/kc/iv/ct/nonce/proof');
  ok(PK.onCurve(PK._test.leLoad(Buffer.from(h.wire[0].Y, 'base64'))) && PK.onCurve(PK._test.leLoad(Buffer.from(h.wire[1].Y, 'base64'))), 'transfer: shares on the wire are curve points (look like any other code\'s shares)'); }
ok(await T.rendezvous('123456') === await T.rendezvous('199999') && await T.rendezvous('123456') !== await T.rendezvous('223456'), 'transfer: rendezvous = first-digit bucket only (10 channels), never a hash of the full code');
{ const set = new Set(); for (let i = 0; i < 10; i++) set.add(await T.rendezvous(i + '00000')); ok(set.size === 10, 'transfer: exactly 10 rendezvous buckets'); }
{ const h = hub(); const s = await T.startSender({ bus: h.bus(), code: '123456', getProfile: () => ({}), wipe: () => {} }); const t0 = Date.now();
  const e = await throws(() => T.receive({ bus: h.bus(), code: '100000' })); ok(e?.message === 'bad-code' && Date.now() - t0 < 3000 && s.attempts === 1, `transfer: wrong code fails fast with bad-code (${Date.now() - t0} ms), costs 1 attempt`);
  for (let i = 0; i < 4; i++) await throws(() => T.receive({ bus: h.bus(), code: '100000' }));
  ok(s.state === 'burned' && s.attempts === T.MAX_ATTEMPTS, 'transfer: burned after MAX_ATTEMPTS answered shares');
  ok((await throws(() => T.receive({ bus: h.bus(), code: '123456' })))?.message === 'too-many-attempts', 'transfer: burned code refuses even the right code (start again)'); }
{ const h = hub(); let now = Date.now(); await T.startSender({ bus: h.bus(), code: '111111', getProfile: () => ({}), wipe: () => {}, now: () => now }); now += T.CODE_TTL_MS + 1;
  ok((await throws(() => T.receive({ bus: h.bus(), code: '111111' })))?.message === 'expired', 'transfer: expired code rejected'); }
{ const h = hub(); let got = null; await T.startSender({ bus: h.bus(), code: '222222', getProfile: () => ({ a: 1 }), wipe: () => {} });
  const rb = h.bus(); rb.on(m => { if (m.t === 'x2-req') h.inject({ t: 'x-err', rid: m.rid, reason: 'too-many-attempts' }); }); // attacker races a forged error
  await T.receive({ bus: rb, code: '222222', importProfile: p => { got = p; } }); ok(got?.a === 1, 'transfer: a forged (unauthenticated) x-err cannot abort a real transfer'); }
{ const h = hub(); const got = {}; const sa = await T.startSender({ bus: h.bus(), code: '512345', getProfile: () => ({ who: 'A' }), wipe: () => {} }), sb = await T.startSender({ bus: h.bus(), code: '598765', getProfile: () => ({ who: 'B' }), wipe: () => {} });
  await Promise.all([T.receive({ bus: h.bus(), code: '512345', importProfile: p => { got.a = p.who; } }), T.receive({ bus: h.bus(), code: '598765', importProfile: p => { got.b = p.who; } })]); await new Promise(r => setTimeout(r, 30));
  ok(got.a === 'A' && got.b === 'B' && sa.state === 'done' && sb.state === 'done' && sa.attempts <= 2 && sb.attempts <= 2, 'transfer: two transfers at once in the SAME bucket both succeed, each gets its own profile (neighbours never burn each other)'); }
{ const h = hub(); let got = null; await T.startSender({ bus: h.bus(), code: '333333', getProfile: () => ({ a: 1 }), wipe: () => {} }); const rb = h.bus();
  const mitm = { send: m => rb.send(m), on: f => rb.on(m => f(m.t === 'x2-data' ? { ...m, ct: m.ct.slice(0, -6) + 'AAAAAA' } : m)) };
  ok(!!(await throws(() => T.receive({ bus: mitm, code: '333333', importProfile: p => { got = p; } }))) && got === null, 'transfer: tampered ciphertext refused, nothing imported'); }
{ const h = hub(); const s = await T.startSender({ bus: h.bus(), code: '444444', getProfile: () => ({ a: 1 }), wipe: () => {} }); const ab = h.bus(); const ans = [];
  ab.on(m => m.t === 'x2-ans' && ans.push(m)); const sid = nacl.randomBytes(16), me = PK.share('444443', sid); // active attacker's guess
  ab.send({ t: 'x2-req', rid: 'attackerRID1', sid: b64(sid), Y: b64(me.Y) }); await new Promise(r => setTimeout(r, 50));
  ok(ans.length === 1 && s.attempts === 1 && !eq(PK.isk(me.y, Buffer.from(ans[0].Y, 'base64'), sid, me.Y, Buffer.from(ans[0].Y, 'base64')), null), 'transfer: active guesser gets ONE answer for ONE guess (counted)');
  ab.send({ t: 'x2-proof', rid: 'attackerRID1', kc: 'AAAA' }); await new Promise(r => setTimeout(r, 50)); ok(s.state === 'waiting', 'transfer: bad key confirmation -> no data sent');
  ab.send({ t: 'x2-req', rid: 'x', sid: 'zz', Y: 'zz' }); ab.send({ t: 'x2-req', rid: 'attackerRID2', sid: b64(nacl.randomBytes(5)), Y: b64(me.Y) }); await new Promise(r => setTimeout(r, 30)); ok(s.attempts === 1, 'transfer: malformed requests ignored (no attempt, no answer)'); }
{ const src = readFileSync(new URL('../src/transfer.js', import.meta.url), 'utf8'); ok(!/'PBKDF2'/.test(src) && /from '\.\/pake\.js'/.test(src), 'transfer: no PBKDF2(code) left; uses src/pake.js'); }

// ---------------- Part 3: forward secrecy
let clock = Date.now(); const now = () => clock;
const mk = (code, extra = {}) => { const keys = kp(); return { keys, e: new E.E2E({ code, keys, now, ...extra }) }; };
const ping = (x, code) => x.e.sealBroadcast({ id: 'p' + Math.random(), from: code, to: '*', ttl: 3, type: 'ping', body: { pub: x.keys.pub } });
const msg = (x, from, to, text, type = 'chat') => x.e.seal({ id: 'm' + Math.random(), from, to, ttl: 3, type, body: { text } });
const AA = 'AAAA00000000AAAA', BB = 'BBBB00000000BBBB';
let saved = null; const A = mk(AA), B = mk(BB, { onPrekeys: l => { saved = l; } });
{ const pa = ping(A, AA), pb = ping(B, BB); ok(pa.body.pk?.id && pa.body.pk.x && pa.body.pk.s && JSON.stringify(pa).length < 1600, `fs: pings carry a signed prekey (ping ${JSON.stringify(pa).length} B)`);
  ok(await B.e.open(pa) && await A.e.open(pb) && A.e.peers.get(BB).pre?.id === pb.body.pk.id, 'fs: prekey learned only with the peer\'s valid Ed25519 signature'); }
const m1 = await msg(A, AA, BB, 'hello fs'); ok(m1.type === 'e2e' && m1.epk && m1.pk && !JSON.stringify(m1).includes('hello fs'), 'fs: directed envelope is v2 (epk + pk), ciphertext only');
ok((await B.e.open(m1))?.body.text === 'hello fs' && B.e.fsStats.v2in === 1, 'fs: recipient opens v2');
ok(!(await B.e.open({ ...m1, epk: b64(nacl.randomBytes(32)) })) && !(await B.e.open({ ...m1, pk: 'other' })) && !(await B.e.open({ ...m1, ct: m1.ct.slice(0, -4) + 'AAAA' })), 'fs: epk / pk / ciphertext tamper refused (signed + AAD)');
{ const { epk: e1 } = await msg(A, AA, BB, 'x'), { epk: e2 } = await msg(A, AA, BB, 'y'); ok(e1 === m1.epk && e2 === m1.epk, 'fs: one sender ephemeral per peer within the window (cheap)');
  clock += E.EPH_ROTATE_MS + 1; const m2 = await msg(A, AA, BB, 'later'); ok(m2.epk !== m1.epk && (await B.e.open(m2))?.body.text === 'later', 'fs: sender ephemeral rotates after EPH_ROTATE_MS');
  let last = m2.epk, rot = 0; for (let i = 0; i < E.EPH_MAX_MSGS + 2; i++) { const m = await msg(A, AA, BB, 'n' + i); if (m.epk !== last) { rot++; last = m.epk; } } ok(rot === 1, 'fs: and after EPH_MAX_MSGS messages'); }
ok(A.e.eph.size === 1 && !JSON.stringify([...A.e.eph.values()].map(v => Object.keys(v))).includes('sec'), 'fs: sender keeps no ephemeral secret (only the derived key for the window)');
// prekey rotation + erasure
const day0 = await msg(A, AA, BB, 'recorded on day 0'); const pk0 = day0.pk;
clock += E.PREKEY_ROTATE_MS + 1; { const pb = ping(B, BB); ok(pb.body.pk.id !== pk0 && saved.length === 2, 'fs: prekey rotates after 24 h (new one announced, rotation persisted)'); await A.e.open(pb); }
const d1 = await msg(A, AA, BB, 'day 1'); ok(d1.pk !== pk0 && (await B.e.open(d1))?.body.text === 'day 1', 'fs: senders switch to the new prekey');
{ const B2 = new E.E2E({ code: BB, keys: B.keys, box: B.e.box, prekeys: saved, now }); await B2.open(ping(A, AA)); B2.rx.clear();
  ok((await B2.open(day0))?.body.text === 'recorded on day 0', 'fs: within the grace window a late (store-and-forward) day-0 message still opens, also from the persisted vault state'); }
clock += E.PREKEY_KEEP_MS + 1; ping(B, BB);
ok(!saved.some(p => p.id === pk0) && !B.e.pre.some(p => p.id === pk0), 'fs: superseded prekey ERASED after PREKEY_KEEP_MS (memory + persisted list)');
ok((await B.e.open(day0)) === null && B.e.fsStats.noPrekey >= 1, 'fs: recorded day-0 traffic can no longer be decrypted by the phone itself');
{ const seized = new E.E2E({ code: BB, keys: B.keys, box: B.e.box, prekeys: saved, now }); await seized.open(ping(A, AA));
  ok((await seized.open(day0)) === null, 'fs: SEIZED PHONE (long-term signing + box keys + whole vault state) cannot decrypt recorded day-0 traffic'); }
{ const dhOnlyStatic = new E.E2E({ code: BB, keys: B.keys, box: B.e.box, prekeys: [], now }); await dhOnlyStatic.open(ping(A, AA)); ok((await dhOnlyStatic.open(d1)) === null, 'fs: static keys alone never open a v2 message'); }
// compatibility with pre-v47 clients
class Old extends E.E2E { _prekeyAd() { return undefined; } learn(c, p, x, s) { return super.learn(c, p, x, s, null); } } // pre-v47: no prekeys announced or used
{ const ok_ = kp(), O = { keys: ok_, e: new Old({ code: 'OLD0000000000OLD', keys: ok_ }) }, N = mk('NEW0000000000NEW');
  const po = ping(O, 'OLD0000000000OLD'); ok(!po.body.pk, 'compat: old-client ping has no prekey');
  await N.e.open(po); await O.e.open(ping(N, 'NEW0000000000NEW'));
  const toOld = await msg(N, 'NEW0000000000NEW', 'OLD0000000000OLD', 'hi old'); ok(!toOld.epk && (await O.e.open(toOld))?.body.text === 'hi old', 'compat: new -> old client falls back to v1 (old client can read it)');
  const toNew = await O.e.seal({ id: 'o1', from: 'OLD0000000000OLD', to: 'NEW0000000000NEW', ttl: 3, type: 'chat', body: { text: 'hi new' } }); ok((await N.e.open(toNew))?.body.text === 'hi new' && N.e.fsStats.v1in === 1, 'compat: old -> new client (v1) still opens'); }
{ const X = mk('XXXX00000000XXXX'), Y = mk('YYYY00000000YYYY'); const px = ping(X, 'XXXX00000000XXXX'); const forged = { ...px.body.pk, x: b64(nacl.randomBytes(32)) };
  ok(!Y.e.learn('XXXX00000000XXXX', px.body.pub, px.body.xpub, px.body.xsig, forged) || Y.e.peers.get('XXXX00000000XXXX').pre === null, 'fs: prekey with a bad signature is ignored (that peer gets v1, never an attacker key)'); }
{ const R = mk('RRRR00000000RRRR'), S = mk('SSSS00000000SSSS'), got = []; await R.e.open(ping(S, 'SSSS00000000SSSS')); await S.e.open(ping(R, 'RRRR00000000RRRR'));
  for (let i = 0; i < E.RX_CACHE + 20; i++) { S.e.eph.clear(); got.push(await R.e.open(await msg(S, 'SSSS00000000SSSS', 'RRRR00000000RRRR', 'q'))); } // fresh ephemeral each time
  ok(got.every(Boolean) && R.e.rx.size <= E.RX_CACHE, `fs: receive-key cache bounded (${R.e.rx.size} <= ${E.RX_CACHE})`); }
{ const run = async C => { const k1 = kp(), k2 = kp(), a = new C({ code: 'P100000000000001', keys: k1 }), b = new C({ code: 'P200000000000002', keys: k2 });
    await b.open(a.sealBroadcast({ id: 'q1', from: 'P100000000000001', to: '*', ttl: 3, type: 'ping', body: { pub: k1.pub } })); await a.open(b.sealBroadcast({ id: 'q2', from: 'P200000000000002', to: '*', ttl: 3, type: 'ping', body: { pub: k2.pub } }));
    const t0 = performance.now(); for (let i = 0; i < 100; i++) { const m = await a.seal({ id: 'g' + i, from: 'P100000000000001', to: 'P200000000000002', ttl: 3, type: 'arc', body: { i } }); if (!(await b.open(m))) return Infinity; } return (performance.now() - t0) / 100; };
  const v1 = await run(Old), v2 = await run(E.E2E); ok(v2 < v1 * 1.5 + 2, `fs: v2 cost ${v2.toFixed(1)} ms/msg vs v1 ${v1.toFixed(1)} ms/msg (Ed25519 sign/verify dominates both; X25519 only once per window)`); }

// ---------------- Part 4: wiring
{ const am = readFileSync(new URL('../src/app-mesh.js', import.meta.url), 'utf8');
  ok(/prekeys: id\.pre/.test(am) && /e2e\.onPrekeys = savePre/.test(am) && /r\.pre = list/.test(am), 'wiring: app-mesh loads prekeys from the vault and saves every rotation back');
  ok(/new E2E\(\{[^)]*binder, bindProof: bindClaim \}\)/.test(am), 'wiring: v43 binder wiring unchanged');
  const su = readFileSync(new URL('../src/settings-ui.js', import.meta.url), 'utf8'); ok(/rendezvous\(code\)/.test(su) && /6-digit code/.test(su), 'wiring: transfer UI unchanged (same 6-digit code flow)'); }
console.log(`E2EFS ALL OK (${n} checks)`);
