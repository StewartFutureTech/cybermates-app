// v49 smoke: MULTI-DEVICE DELIVERY ON THE MESH PATH (v37-linked devices). Node only, no network.
//  Part 1  src/e2e.js: per-ID device sets (signed by the shared profile key, md capability, cap MAX_DEVS, freshness), sibling
//          devices (my own code, my key, another X25519 key), v3 envelopes (content key wrapped per device, forward secrecy like
//          v2), every device of the recipient + my other devices open; others / echo / tamper / forgery refused; one preferred
//          device for calls & games; single device on both sides keeps v2 on the wire.
//  Part 2  backward compatibility against a FROZEN v48 client (scripts/fixtures/e2e-v48.js) both ways, mixed old/new devices of
//          one user, and the v1/v2 receive fix for a multi-device sender.
//  Part 3  src/devsync.js: friends union, block/unblock last-writer-wins, blocked/banned/re-keyed friends refused, bounds.
//  Part 4  src/mesh.js sentCopy + wiring in src/app-mesh.js (sealAll, sibling receive path, dsync, rxMeta, block log).
//    node --no-warnings scripts/smoke-mdmesh.mjs
import nacl from 'tweetnacl';
import { readFileSync } from 'node:fs';
import * as E from '../src/e2e.js';
import * as OLD from './fixtures/e2e-v48.js';
import * as DS from '../src/devsync.js';
import { RX } from '../src/shield.js';
import { b64 } from '../src/vault.js';
let n = 0; const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } n++; console.log('ok', m); };
const kp = () => { const k = nacl.sign.keyPair(); return { pub: b64(k.publicKey), sec: b64(k.secretKey) }; };
let clock = Date.now(); const now = () => clock;
const AA = 'AAAA00000000AAAA', BB = 'BBBB00000000BBBB', LL = 'LLLL00000000LLLL', MM = 'MMMM00000000MMMM', XX = 'XXXX00000000XXXX';
const dev = (code, keys, extra = {}, Cls = E.E2E) => ({ code, keys, e: new Cls({ code, keys, now, ...extra }) });
const ping = d => d.e.sealBroadcast({ id: 'p' + Math.random(), from: d.code, to: '*', ttl: 3, type: 'ping', body: { pub: d.keys.pub } });
const meet = async (...ds) => { for (const x of ds) { const p = ping(x); for (const y of ds) if (y !== x) await y.e.open(structuredClone(p)); } };
const env = (d, to, text, type = 'chat') => ({ id: 'm' + Math.random().toString(36).slice(2), from: d.code, to, ttl: 3, type, body: { text } });
const all = async (d, to, text, type) => d.e.sealAll(env(d, to, text, type));
const openText = async (d, x) => (await d.e.open(structuredClone(x)))?.body?.text ?? null;

// ---------------- Part 1: v49 e2e
const kA = kp(), kB = kp(); let sibSeen = 0;
const A1 = dev(AA, kA), A2 = dev(AA, kA, { onSibling: () => { sibSeen++; } }), B1 = dev(BB, kB), B2 = dev(BB, kB), X = dev(XX, kp());
{ const p = ping(A1); ok(p.body.md === 1 && p.body.pk?.id && JSON.stringify(p).length < 1600, `md: pings announce v49 capability md:1 + signed prekey (ping ${JSON.stringify(p).length} B)`); }
await meet(A1, A2, B1, B2, X);
ok(B1.e.devicesOf(AA).length === 2 && B1.e.devicesOf(AA).every(d => d.md && d.fs) && X.e.devicesOf(BB).length === 2, 'md: a peer learns BOTH linked devices of an ID (each xpub signed by the shared profile key)');
ok(A1.e.siblings().length === 1 && A2.e.siblings().length === 1 && A1.e.siblings()[0].xpub === A2.e.box.xpub && sibSeen === 1, 'md: each device learns its linked sibling from pings of its own code (onSibling fired once)');
ok(!A1.e.peers.has(AA) && B1.e.siblings().length === 1 && B1.e.siblings()[0].xpub === B2.e.box.xpub, 'md: my own code never becomes a "peer"; a peer\'s devices never become my siblings');
{ const ev = { code: AA, keys: kp() }; const evil = dev(AA, ev.keys); const before = A1.e.siblings().length; await A1.e.open(ping(evil)); await B1.e.open(ping(evil));
  ok(A1.e.siblings().length === before && B1.e.devicesOf(AA).length === 2, 'md: a device pinging with my code but ANOTHER profile key is neither a sibling nor a device of that ID (TOFU on the profile key)'); }
// A1 -> B (chat): one v3 envelope, wraps for B1, B2 and A2 (sent copy)
const c1 = await all(A1, BB, 'hello every device');
ok(c1.length === 1 && Array.isArray(c1[0].md) && c1[0].md.length === 3 && c1[0].type === 'e2e' && c1[0].epk === undefined && c1[0].pk === undefined, 'v3: chat to a 2-device user from a 2-device user = ONE envelope, 3 wraps (B1, B2, my A2)');
ok(!JSON.stringify(c1).includes('hello every device') && JSON.stringify(c1[0].md).length < 1000, 'v3: no plaintext on the wire; wraps are small');
ok(await openText(B1, c1[0]) === 'hello every device' && await openText(B2, c1[0]) === 'hello every device', 'v3: BOTH of the recipient\'s devices open it');
{ const o = await A2.e.open(structuredClone(c1[0])); ok(o?.copy === true && o.from === AA && o.to === BB && o.body.text === 'hello every device' && o.type === 'chat', 'v3: my other device A2 opens its SENT COPY (from me, to B, copy flag)'); }
ok(await A1.e.open(structuredClone(c1[0])) === null && await X.e.open(structuredClone(c1[0])) === null, 'v3: my own echo and a third party (no wrap) get nothing');
ok(B1.e.peers.get(AA).rx === A1.e.box.xpub, 'v3: receiver notes which device wrote last (preferred target for calls/games)');
{ const t = structuredClone(c1[0]); t.ct = t.ct.slice(0, -4) + (t.ct.endsWith('AAAA') ? 'BBBB' : 'AAAA'); ok(await B1.e.open(t) === null, 'v3: tampered content refused');
  const w = structuredClone(c1[0]); w.md[0].w = w.md[0].w.slice(0, -4) + 'AAAA'; w.md[1].w = w.md[1].w.slice(0, -4) + 'AAAA'; w.md[2].w = w.md[2].w.slice(0, -4) + 'AAAA'; ok(await B1.e.open(w) === null && await B2.e.open(w) === null, 'v3: tampered wrap refused');
  const d = structuredClone(c1[0]); d.md = d.md.filter(x => x.d !== E.devId(B2.e.box.xpub)); ok(await B2.e.open(d) === null, 'v3: removing a device\'s wrap (signed list) refused');
  const r = structuredClone(c1[0]); r.to = XX; ok(await X.e.open(r) === null, 'v3: re-addressed envelope refused');
  const sx = structuredClone(c1[0]); sx.sx = A2.e.box.xpub; ok(await B1.e.open(sx) === null, 'v3: swapped sender device refused (signature + key binding)');
  const evilK = kp(), f = structuredClone(c1[0]); const { sig, ttl, type, ...o } = f; f.sig = b64(nacl.sign.detached(new TextEncoder().encode(JSON.stringify(o, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([p], [q]) => p < q ? -1 : 1)) : x)), Buffer.from(evilK.sec, 'base64'))); ok(await B1.e.open(f) === null, 'v3: forged signature (other key) refused'); }
// B2 -> A (chat): both A devices + B1 copy
{ const c = await all(B2, AA, 'reply from B2'); ok(c.length === 1 && c[0].md.length === 3 && await openText(A1, c[0]) === 'reply from B2' && await openText(A2, c[0]) === 'reply from B2' && (await B1.e.open(structuredClone(c[0])))?.copy, 'v3: reply B2 -> A reaches A1 AND A2, and B1 gets the sent copy'); }
// rcpt (message type, no copy): both of A's devices, no sibling wrap
{ const c = await all(B1, AA, 'r', 'rcpt'); ok(c.length === 1 && c[0].md.length === 2 && await openText(A1, c[0]) === 'r' && await openText(A2, c[0]) === 'r' && await B2.e.open(structuredClone(c[0])) === null, 'v3: receipts reach every device of the sender (no sent copy of receipts)'); }
// call signaling / games: one preferred device only
{ await A1.e.open((await all(B2, AA, 'a', 'ack'))[0]); const c = await all(A1, BB, 'sdp', 'rtc'); ok(c.length === 1 && c[0].md.length === 1 && c[0].md[0].d === E.devId(B2.e.box.xpub) && await openText(B2, c[0]) === 'sdp' && await openText(B1, c[0]) === null, 'one-device types (calls/games): only the device that last wrote to me (B2) gets it');
  await A1.e.open((await all(B1, AA, 'a', 'ack'))[0]); const c2 = await all(A1, BB, 'sdp2', 'rtc'); ok(c2[0].md[0].d === E.devId(B1.e.box.xpub) && await openText(B1, c2[0]) === 'sdp2', 'one-device types follow the device that wrote last (now B1)'); }
// dsync: my own devices only
{ const c = await all(A1, AA, 'sync', 'dsync'); ok(c.length === 1 && c[0].md.length === 1 && (await A2.e.open(structuredClone(c[0])))?.type === 'dsync' && await B1.e.open(structuredClone(c[0])) === null, 'dsync to my own code: sealed for my sibling devices only');
  const solo = dev('SSSS00000000SSSS', kp()); ok((await all(solo, solo.code, 'x', 'dsync')).length === 0, 'dsync with no sibling device: nothing is sent'); }
// single device both sides: wire unchanged (v2)
{ const P = dev('PPPP00000000PPPP', kp()), Q = dev('QQQQ00000000QQQQ', kp()); await meet(P, Q); const c = await all(P, Q.code, 'solo');
  ok(c.length === 1 && c[0].md === undefined && typeof c[0].epk === 'string' && typeof c[0].pk === 'string' && await openText(Q, c[0]) === 'solo' && P.e.fsStats.v3out === 0, 'one device on both sides: plain v2 envelope (wire unchanged from v47/v48)'); }
// freshness + cap
{ const k = kp(), devs = Array.from({ length: 7 }, () => dev('CCCC00000000CCCC', k)), R = dev('RRRR00000000RRRR', kp()); for (const d of devs) await R.e.open(ping(d));
  ok(R.e.devicesOf('CCCC00000000CCCC').length === E.MAX_DEVS, `cap: at most MAX_DEVS=${E.MAX_DEVS} devices kept per ID (oldest dropped)`);
  clock += E.DEV_FRESH_MS + 1000; await R.e.open(ping(devs[6])); await devs[6].e.open(ping(R)); const c = await all(R, 'CCCC00000000CCCC', 'fresh only');
  ok(c.length === 1 && c[0].md === undefined && await openText(devs[6], c[0]) === 'fresh only', 'freshness: devices not heard from for DEV_FRESH_MS are not targeted (only the live one -> plain v2)'); }
// forward secrecy for v3: recorded traffic unreadable after the prekey is erased, even with the long-term keys + persisted state
{ let saved = null; const kS = kp(), kT = kp(); const S1 = dev('SSSS11111111SSSS', kS), S2 = dev('SSSS11111111SSSS', kS), T1 = dev('TTTT00000000TTTT', kT, { onPrekeys: l => { saved = l; } }), T2 = dev('TTTT00000000TTTT', kT);
  await meet(S1, S2, T1, T2); const rec = (await all(S1, T1.code, 'recorded today'))[0]; ok(rec.md?.length === 3 && await openText(T1, rec) === 'recorded today', 'fs: v3 recorded message opens today');
  clock += E.PREKEY_ROTATE_MS + 1000; ping(T1); clock += E.PREKEY_KEEP_MS + 1000; ping(T1);
  const T1b = new E.E2E({ code: T1.code, keys: kT, box: T1.e.box, prekeys: saved, now }); await T1b.open(ping(S1));
  ok(saved && await T1b.open(structuredClone(rec)) === null, 'fs: after rotation + 8-day erase the recorded v3 envelope is unreadable, even from the persisted state + long-term keys'); }
// size: 1000-char chat to 5 + 4 devices fits every cap
{ const k1 = kp(), k2 = kp(), U = Array.from({ length: 5 }, () => dev('UUUU00000000UUUU', k1)), V = Array.from({ length: 5 }, () => dev('VVVV00000000VVVV', k2)); await meet(...U, ...V);
  const c = await all(U[0], 'VVVV00000000VVVV', 'x'.repeat(1000)), sz = JSON.stringify({ k: 'mesh', env: c[0] }).length;
  ok(c.length === 1 && c[0].md.length === 9 && sz < RX.MAX.mesh && c[0].md.length <= E.MD_MAX && (await Promise.all(V.map(v => openText(v, c[0])))).every(t => t?.length === 1000), `size: 1000-char chat to 5 devices + 4 of mine = 9 wraps, ${sz} B (< ${RX.MAX.mesh}); all 5 open`); }
{ const kW = kp(), W1 = dev('WWWW00000000WWWW', kW), W2 = dev('WWWW00000000WWWW', kW), R = dev('RRRR11111111RRRR', kp()); await meet(W1, W2); await W1.e.open(ping(R)); await W2.e.open(ping(R)); await R.e.open(ping(W1));
  const fromW2 = (await all(W2, R.code, 'before my ping'))[0]; ok(await openText(R, fromW2) === 'before my ping' && R.e.devicesOf('WWWW00000000WWWW').length === 2, 'early: a v3 from a linked device whose ping I have not seen yet still opens (device noted from the signed envelope)');
  const back = await all(R, 'WWWW00000000WWWW', 'answer'); ok(back.length === 1 && back[0].md === undefined && await openText(W1, back[0]) === 'answer' && R.e.fsStats.v1out === 0, 'early: that device is not targeted until its ping (signed prekey) arrives - no static v1 fallback');
  await R.e.open(ping(W2)); const back2 = await all(R, 'WWWW00000000WWWW', 'answer2'); ok(back2[0].md?.length === 2 && await openText(W2, back2[0]) === 'answer2', 'early: after its ping both devices get the next message'); }
{ const big = structuredClone(c1[0]); big.md = Array.from({ length: E.MD_MAX + 1 }, () => big.md[0]); ok(await B1.e.open(big) === null, 'v3: more than MD_MAX wraps refused before any crypto'); }

// ---------------- Part 2: backward compatibility with a frozen v48 client
clock = Date.now() + 30 * 864e5;
{ const kL = kp(), L = dev(LL, kL, {}, OLD.E2E), A1c = dev(AA, kA, { box: A1.e.box }), A2c = dev(AA, kA, { box: A2.e.box }); await meet(L, A1c, A2c);
  clock += 1000; await A1c.e.open(ping(A2c)); await L.e.open(ping(A2c)); // my sibling pinged after me
  ok(A1c.e.wantsPing(LL, 'chat') === true, 'compat: sending to a v48 phone while I have a linked sibling -> ping first (v48 pins the last device that pinged)');
  await L.e.open(ping(A1c)); // the app posts that ping synchronously before the sealed envelope
  ok(A1c.e.wantsPing(LL, 'chat') === false, 'compat: no extra ping while no sibling has pinged since my last ping');
  const out = await all(A1c, LL, 'to old phone');
  ok(out.length === 2 && Array.isArray(out[0].md) && out[0].md.length === 1 && out[1].md === undefined && typeof out[1].epk === 'string', 'compat: to a v48 phone = its normal v2 envelope + a separate v3 sent copy for my other device');
  ok(await openText(L, out[1]) === 'to old phone' && await openText(L, out[0]) === null && (await A2c.e.open(structuredClone(out[0])))?.copy, 'compat: the v48 phone opens its v2 and silently drops the v3 copy; my A2 gets the copy');
  const back = await L.e.seal(env(L, AA, 'from old phone')); ok(back.md === undefined && await openText(A1c, back) === 'from old phone', 'compat: a v48 sender reaches the device it saw last (A1) with v2 as before');
  await L.e.open(ping(A2c)); const back2 = await L.e.seal(env(L, AA, 'old again')); ok(await openText(A2c, back2) === 'old again', 'compat: ... and the other device once that one pinged last (v48 behaviour unchanged)'); }
{ const kM = kp(), M1 = dev(MM, kM, {}, OLD.E2E), M2 = dev(MM, kM), Bx = dev(BB, kB, { box: B1.e.box }); await meet(M1, M2, Bx);
  const out = await all(Bx, MM, 'mixed user');
  ok(out.length === 2 && out[0].md?.length === 1 && out[1].md === undefined, 'compat: a user with one v48 + one v49 device gets v3 (v49 device) + v2 (v48 device), same id');
  ok(await openText(M2, out[0]) === 'mixed user' && await openText(M1, out[1]) === 'mixed user' && await openText(M1, out[0]) === null && await openText(M2, out[1]) === null, 'compat: each device opens exactly its own envelope, the other is dropped silently');
  await Bx.e.open(ping(M2)); const old = await M1.e.seal(env(M1, BB, 'v48 linked sender'));
  ok(Bx.e.peers.get(MM).xpub === M2.e.box.xpub && await openText(Bx, old) === 'v48 linked sender' && Bx.e.peers.get(MM).rx === M1.e.box.xpub, 'fix: a v2 from a linked device that did NOT ping last now opens (receiver tries that ID\'s known devices; before v49 it was dropped)');
  const P = dev('PPPP11111111PPPP', kp(), {}, OLD.E2E); await meet(P, Bx); const v1 = await P.e.seal(env(P, BB, 'x')); ok(typeof v1.epk === 'string', 'compat: v48 <-> v49 single device still v2 both ways');
  const Lv1 = class extends OLD.E2E { _prekeyAd() { return undefined; } learn(c, p, x, s) { return super.learn(c, p, x, s, null); } }, O = dev('OOOO00000000OOOO', kp(), {}, Lv1); await meet(O, Bx);
  const o1 = await O.e.seal(env(O, BB, 'pre-v47')); const b1 = await all(Bx, O.code, 'to pre-v47'); ok(o1.epk === undefined && await openText(Bx, o1) === 'pre-v47' && b1.length === 1 && b1[0].epk === undefined && await openText(O, b1[0]) === 'to pre-v47', 'compat: pre-v47 (v1 static) clients still work both ways'); }

// ---------------- Part 3: devsync
{ const fr = new Map([['FFFF00000000FFFF', { pub: 'F'.repeat(44) }]]), log = { BADD00000000BADD: [1, 100] };
  const s = DS.buildSync({ friends: fr, blockLog: log }); ok(s.f.FFFF00000000FFFF === 'F'.repeat(44) && s.b.BADD00000000BADD[0] === 1, 'devsync: build carries friends (code -> key) + block log only');
  ok(!JSON.stringify(s).match(/text|msgs|wallet|sec/), 'devsync: no chats, wallet or secrets in the sync');
  const mine = new Map(); const r = DS.mergeSync(s, { friends: mine, blockLog: {}, now: 1000 }); ok(r.changed && r.addFriends.length === 1 && r.block[0] === 'BADD00000000BADD', 'devsync: merge adds the friend (union) and applies the block');
  ok(!DS.mergeSync(s, { friends: fr, blockLog: log, now: 1000 }).changed, 'devsync: merging what I already have changes nothing (no sync ping-pong)');
  const un = DS.mergeSync({ b: { BADD00000000BADD: [0, 200] } }, { friends: mine, blockLog: log, now: 1000 }); ok(un.unblock[0] === 'BADD00000000BADD' && un.log.BADD00000000BADD[0] === 0, 'devsync: a newer unblock wins (last writer wins)');
  ok(!DS.mergeSync({ b: { BADD00000000BADD: [0, 50] } }, { friends: mine, blockLog: log, now: 1000 }).changed, 'devsync: an older decision never overrides a newer one');
  const fut = DS.mergeSync({ b: { ZZZZ00000000ZZZZ: [1, 9e15] } }, { friends: mine, blockLog: {}, now: 1000 }); ok(fut.log.ZZZZ00000000ZZZZ[1] <= 1000 + DS.SKEW_MS, 'devsync: future timestamps clamped (no permanent lock)');
  ok(!DS.mergeSync({ f: { BADD00000000BADD: 'B'.repeat(44) } }, { friends: new Map(), blockLog: log, now: 1000 }).addFriends.length, 'devsync: a friend blocked on this device is not re-added');
  ok(!DS.mergeSync({ f: { BANN00000000BANN: 'B'.repeat(44) } }, { friends: new Map(), isBanned: c => c === 'BANN00000000BANN', now: 1000 }).addFriends.length, 'devsync: banned IDs never added');
  ok(!DS.mergeSync({ f: { PINN00000000PINN: 'B'.repeat(44) } }, { friends: new Map(), pinned: () => 'C'.repeat(44), now: 1000 }).addFriends.length, 'devsync: a friend whose key I pinned differently is refused (no re-keying through sync)');
  const huge = { f: Object.fromEntries(Array.from({ length: 1000 }, (_, i) => ['H' + String(i).padStart(15, '0'), 'H'.repeat(44)])) }; ok(DS.mergeSync(huge, { friends: new Map(), now: 1 }).addFriends.length === DS.SYNC_MAX, 'devsync: bounded to SYNC_MAX entries');
  ok(!DS.mergeSync('junk', { friends: new Map() }).changed && !DS.mergeSync({ f: { '<x>': 1, ok: 'short' }, b: { a: 'x' } }, { friends: new Map() }).changed, 'devsync: garbage ignored'); }

// ---------------- Part 4: mesh.js sentCopy + wiring
{ const { MeshNode, newSigningKeys } = await import('../src/mesh.js'); const k = newSigningKeys(), sent = [], ev = [];
  const node = new MeshNode({ code: AA, keys: k, profile: { name: 'A' }, onEvent: (...e) => ev.push(e), net: { send: e => sent.push(e) } });
  ok(node.sentCopy(BB, { from: AA, text: 'hi', at: 5 }, 'id1') === false, 'sentCopy: not a friend on this device -> ignored');
  node.friends.set(BB, { pub: kB.pub, stub: null }); ok(node.sentCopy(BB, { from: AA, text: 'hi', at: 5 }, 'id1') && !node.sentCopy(BB, { from: AA, text: 'hi', at: 5 }, 'id1') && node.chats.get(BB).msgs.length === 1, 'sentCopy: shown once in the conversation (same id never twice)');
  const m = node.chats.get(BB).msgs[0]; ok(m.from === AA && m.state === 'sent' && m.copy && sent.length === 0, 'sentCopy: shown as mine, nothing re-sent to the friend');
  const { signRcpt } = await import('../src/mesh.js').then(x => x.signRcpt ? x : { signRcpt: null }); if (signRcpt) { node.on_rcpt(BB, { ref: 'id1', sig: signRcpt('id1', AA, BB, kB.sec), pub: kB.pub }); ok(m.state === 'delivered', 'sentCopy: the friend\'s signed receipt (delivered to all my devices) marks it delivered here too'); } }
{ const am = readFileSync(new URL('../src/app-mesh.js', import.meta.url), 'utf8'), es = readFileSync(new URL('../src/e2e.js', import.meta.url), 'utf8');
  ok(/e2e\.sealAll\(env\)\.then\(list => \{ for \(const sealed of list\) \{ const r = router\.route\(sealed, env\.id\)/.test(am) && !/e2e\.seal\(env\)/.test(am), 'wiring: outbound posts every envelope from sealAll (through the relay router)');
  ok(/if \(o\.from === id\.code\) \{ if \(o\.copy\) onCopy\(o\); return; \}/.test(am) && /msg\.env\.from === id\.code\) \{ inbound\(msg\.env\); return; \}/.test(am), 'wiring: packets from my own code go to e2e (sibling pings / copies) and never into node.receive');
  ok(/e\.from === id\.code\) return \(e\.to === '\*' \? e\.type === 'ping' : Array\.isArray\(e\.md\)\)/.test(am), 'wiring: shield admits only sibling pings and v3 envelopes from my own code');
  ok(/mergeSync\(o\.body/.test(am) && /node\.send\(id\.code, 'dsync', buildSync/.test(am) && /blockLog\[c\] = \[1, Date\.now\(\)\]/.test(am) && /blockLog\[c\] = \[0, Date\.now\(\)\]/.test(am), 'wiring: dsync built/merged; block + unblock stamped for last-writer-wins');
  ok(/onSibling, binder, bindProof: bindClaim \}\)/.test(am) && /node\.sentCopy\(o\.to, o\.body, o\.id\)/.test(am), 'wiring: new sibling -> dsync; chat copies -> node.sentCopy');
  ok(!/console\.log/.test(es) && !/fetch\(/.test(es), 'e2e.js: no logging, no network'); }
console.log(`SMOKE-MDMESH: ALL OK (${n} checks)`);
