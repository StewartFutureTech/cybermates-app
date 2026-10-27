// v43 ID SPOOFING / IDENTITY BINDING (src/idbind.js + api/_lib/idbind.js + bootstrap + live receive path). No browser.
//  Part 1: proof of work + claims + rotation + certs (tamper, weak PoW, future iat, wrong server key, expiry) + join-cost timing
//  Part 2: IdBinder rules (first proof pins, one key per ID, one ID per key, no proof, cert beats claim, newer cert rebinds)
//  Part 3: live receive path: E2E ping gate (spoofed ID / stolen claim / no proof dropped BEFORE the key is learned), living-mesh
//          adverts, membership rows, gossiped stubs all refuse a key that is not the ID's bound key
//  Part 4: server registry bindGate (428/400/409, rotation, idle rebind + heavier PoW, attestation HOOK, certs, fail closed)
//          + DbBindStore against a fake PostgREST shared by 2 real node instances (first claim wins; hashed IDs/keys only)
//  Part 5: bootstrap route end to end (spoofed login/logoff can't replace or remove someone's presence row) + wiring, bundle,
//          live anon refusal of public.id_bind. Live DB half: supabase/tests/id_bindings.sql (29 checks, rolled back).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import nacl from 'tweetnacl';
const root = new URL('..', import.meta.url).pathname, SELF = new URL(import.meta.url).pathname;
const B = await import('../src/idbind.js'), { b64 } = await import('../src/vault.js');
const kp = () => { const k = nacl.sign.keyPair(); return { pub: b64(k.publicKey), sec: b64(k.secretKey) }; };
// child mode: one "Vercel instance" running bindGate against the shared fake PostgREST
if (process.argv[2] === '--child') {
  const S = await import('../api/_lib/idbind.js'), ops = JSON.parse(process.argv[3]); const cfg = S.bindCfg(); const store = S.makeBindStore(cfg); const out = [];
  for (const o of ops) out.push((await S.bindGate({ code: o.code, pub: o.pub, claim: o.claim, store, cfg })).status || 'refused');
  console.log(JSON.stringify(out)); process.exit(0);
}
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail = 1; };
const V = 'VICTIMCODE234567', X = 'ATTACKERCODE2345';
// ---------------- Part 1
{ const p = { code: V, pub: kp().pub, iat: 1, b: 10, k: 3 }; const { n } = await B.solvePow(p); ok(B.verifyPow(p, n) && !B.verifyPow({ ...p, iat: 2 }, n) && !B.verifyPow(p, [n[0], n[1]]) && !B.verifyPow(p, n.map(x => x + 1)), 'pow: solves + verifies; bound to (code,pub,iat); wrong count / nonce fails'); }
const kv = kp(), ka = kp(), kv2 = kp();
const times = []; let cV; for (let i = 0; i < 3; i++) { const t0 = performance.now(); cV = await B.makeClaim({ code: V, keys: kv }); times.push(performance.now() - t0); }
const avg = times.reduce((a, x) => a + x, 0) / times.length;
ok(avg < 3000, `join cost: default PoW ${B.POW.k} x 2^${B.POW.b} (~${(B.powWork(B.POW) / 1e3).toFixed(0)}k hashes) avg ${avg.toFixed(0)} ms on this box (max ${Math.max(...times).toFixed(0)} ms; phones ~3-4x -> ~1-2 s)`);
ok(B.verifyClaim(cV) && B.verifyClaim(cV, { code: V, pub: kv.pub }), 'claim: valid (signature + PoW)');
ok(!B.verifyClaim(cV, { code: X }) && !B.verifyClaim(cV, { pub: ka.pub }), 'claim: bound to its code and key (someone else\'s claim is useless for another key/ID)');
ok(!B.verifyClaim({ ...cV, code: X }) && !B.verifyClaim({ ...cV, pub: ka.pub }) && !B.verifyClaim({ ...cV, iat: cV.iat + 1 }) && !B.verifyClaim({ ...cV, pw: { ...cV.pw, n: [...cV.pw.n.slice(1), cV.pw.n[0]] } }), 'claim: tampered code / key / iat / nonces refused');
{ const forged = { ...cV, pub: ka.pub }; forged.sig = b64(nacl.sign.detached(new TextEncoder().encode(`cm-idbind-claim-v1|${V}|${ka.pub}|${cV.iat}|${cV.pw.b}|${cV.pw.k}|${cV.pw.n.join(',')}`), Buffer.from(ka.sec, 'base64'))); ok(!B.verifyClaim(forged), 'claim: re-signing a victim\'s PoW with another key fails (PoW covers the key)'); }
{ const weak = await B.makeClaim({ code: V, keys: kv, pow: { b: 8, k: 2 } }); ok(!B.verifyClaim(weak) && B.verifyClaim(weak, { min: { b: 8, k: 2 } }), 'claim: weaker-than-required PoW refused'); }
{ const fut = await B.makeClaim({ code: V, keys: kv, now: Date.now() + 3600e3, pow: { b: 8, k: 2 } }); ok(!B.verifyClaim(fut, { min: { b: 8, k: 2 }, now: Date.now() }), 'claim: iat from the future refused'); }
ok(!B.verifyClaim({ ...cV, pw: { b: 40, k: 1, n: [0] } }) && !B.verifyClaim({ ...cV, pw: { b: 16, k: 99, n: [] } }), 'claim: absurd PoW parameters refused before hashing (POW_MAX)');
ok(JSON.stringify(cV).length < 400, `claim size ${JSON.stringify(cV).length} B (rides in every ping)`);
{ const r = B.makeRotation({ code: V, oldKeys: kv, newPub: kv2.pub }); ok(B.verifyRotation(r, { code: V, pub: kv2.pub }) && !B.verifyRotation(r, { code: X, pub: kv2.pub }) && !B.verifyRotation(r, { code: V, pub: ka.pub }) && !B.verifyRotation({ ...r, old: ka.pub }, { code: V, pub: kv2.pub }) && !B.verifyRotation(r, { code: V, pub: kv2.pub, now: Date.now() + 3600e3 }), 'rotation: old key hands ID to new key; wrong ID / new key / old key / stale refused'); }
const srv = B.serverKeysFromSeed(Buffer.from(nacl.randomBytes(32)).toString('hex')), srv2 = B.serverKeysFromSeed(b64(nacl.randomBytes(32)));
const cert = B.makeCert({ code: V, pub: kv.pub }, srv.sec);
ok(B.verifyCert(cert, srv.pub, { code: V, pub: kv.pub }) && !B.verifyCert(cert, srv2.pub) && !B.verifyCert({ ...cert, pub: ka.pub }, srv.pub) && !B.verifyCert(cert, srv.pub, { now: cert.exp + 1 }) && !B.verifyCert(cert, null), 'cert: server-signed; wrong server key / swapped key / expired / no server key refused');
// ---------------- Part 2
{ const bd = new B.IdBinder(); const cA = await B.makeClaim({ code: V, keys: ka, pow: B.POW });
  ok(!bd.check(V, kv.pub, null).ok && bd.check(V, kv.pub, null).reason === 'no-proof', 'binder: stranger without proof refused');
  ok(bd.check(V, kv.pub, cV).ok && bd.pinned(V) === kv.pub && bd.level(V) === 'pow', 'binder: first valid claim pins V -> victim key');
  ok(bd.check(V, kv.pub, null).ok, 'binder: pinned key needs no proof again');
  const r = bd.check(V, ka.pub, cA); ok(!r.ok && r.reason === 'id-bound' && bd.pinned(V) === kv.pub, 'binder: attacker\'s OWN valid claim for V refused (V already bound) - pin unchanged');
  const cX = await B.makeClaim({ code: X, keys: kv }); ok(bd.check(X, kv.pub, cX).reason === 'key-bound', 'binder: one ID per key (victim key cannot also be X)');
  ok(bd.check(V, ka.pub, cV).reason === 'id-bound' && bd.stats.idBound >= 2, 'binder: replaying the victim\'s claim with another key refused');
  const b2 = new B.IdBinder({ serverPub: srv.pub }); ok(b2.check(V, ka.pub, cA).ok, 'binder(certs): attacker got there first with a claim (race)');
  const rc = b2.check(V, kv.pub, cert); ok(rc.ok && rc.rebound && b2.pinned(V) === kv.pub && b2.level(V) === 'cert', 'binder(certs): server cert beats the claim -> rebound to the real key');
  ok(b2.check(V, ka.pub, cA).reason === 'id-bound', 'binder(certs): attacker claim refused afterwards');
  const certNew = B.makeCert({ code: V, pub: kv2.pub, now: Date.now() + 1000 }, srv.sec), certOld = B.makeCert({ code: V, pub: ka.pub, now: Date.now() - 60e3 }, srv.sec);
  ok(!b2.check(V, ka.pub, certOld).ok, 'binder(certs): an OLDER cert cannot undo a newer one');
  ok(b2.check(V, kv2.pub, certNew).rebound && b2.pinned(V) === kv2.pub, 'binder(certs): a NEWER cert (server-approved rebind) moves the pin');
  ok(!new B.IdBinder().check(V, kv.pub, cert).ok, 'binder: cert without a configured server key is not trusted');
  const b3 = new B.IdBinder({ max: 3 }); for (const c of ['AAAA2', 'BBBB2', 'CCCC2', 'DDDD2']) b3.trust(c, kp().pub); ok(b3.byCode.size === 3 && b3.byKey.size === 3, 'binder: pin table bounded (max)');
  const b4 = new B.IdBinder(); b4.trust(V, kv.pub); ok(b4.check(V, kv.pub).ok && b4.check(V, ka.pub, cA).reason === 'id-bound', 'binder: trust() pre-pins own ID / saved friends'); }
// ---------------- Part 3: live receive path
const { E2E } = await import('../src/e2e.js');
const ping = (e, code, keys, bd) => { e.bindProof = bd; return e.sealBroadcast({ id: 'p' + Math.random(), from: code, to: '*', ttl: 3, type: 'ping', body: { pub: keys.pub } }); };
{ const rx = new E2E({ code: 'RECEIVER23456789', keys: kp(), binder: new B.IdBinder() }), vic = new E2E({ code: V, keys: kv }), att = new E2E({ code: V, keys: ka });
  const cA = await B.makeClaim({ code: V, keys: ka });
  ok(await rx.open(ping(att, V, ka, null)) === null && !rx.peers.has(V), 'e2e: ping claiming V without a binding proof dropped (key not learned)');
  ok(!!(await rx.open(ping(vic, V, kv, cV))) && rx.peers.get(V)?.pub === kv.pub, 'e2e: victim ping with its claim accepted, key learned');
  ok(await rx.open(ping(att, V, ka, cA)) === null && rx.peers.get(V).pub === kv.pub, 'e2e: attacker ping for V (own valid PoW claim, own key) dropped - V stays bound to the victim key');
  ok(await rx.open(ping(att, V, ka, cV)) === null && rx.bindDrops >= 3, 'e2e: attacker replaying the victim\'s claim dropped');
  ok(!!(await rx.open(ping(vic, V, kv, cV))), 'e2e: victim keeps working');
  const noB = new E2E({ code: 'OLDCLIENT2345678', keys: kp() }); ok(!!(await noB.open(ping(att, V, ka, null))), 'e2e: without a binder the old TOFU behaviour is unchanged (other suites)');
  const rc = new E2E({ code: 'RECEIVER23456789', keys: kp(), binder: new B.IdBinder({ serverPub: srv.pub }) });
  ok(!!(await rc.open(ping(att, V, ka, cA))) && !!(await rc.open(ping(vic, V, kv, cert))) && rc.peers.get(V).pub === kv.pub, 'e2e(certs): a server cert rebinds a raced ID and drops the attacker\'s learned key'); }
{ const { LiveNode } = await import('../src/livemesh.js'); const mk = (code, keys) => new LiveNode({ code, keys, profile: { lookingFor: ['friends'] }, send: () => {}, timer: () => 0 });
  const R = mk('RECEIVER23456789', kp()), vic = mk(V, kv), att = mk(V, ka); R.keyOf = c => c === V ? kv.pub : null;
  ok(R._admit(att.pkt) === null && R.bindDrops === 1, 'livemesh: advert for V signed by a different key dropped (bound key wins)');
  ok(!!R._admit(vic.pkt), 'livemesh: advert with V\'s bound key admitted');
  const R2 = mk('RECEIVER23456780', kp()); ok(!!R2._admit(att.pkt), 'livemesh: no binding known -> unchanged TOFU (tentacles of strangers)'); R2.keyOf = c => c === V ? kv.pub : null; ok(!!R2._admit(vic.pkt), 'livemesh: bound key overrides an earlier TOFU pin of a spoofer'); }
{ const G = await import('../src/membership.js'); const net = new G.SimNet(G.seededRng(7)); const mk = (code, keys) => new G.Member({ code, profile: { lookingFor: ['friends'] }, now: net.now, net, rng: G.seededRng(code.charCodeAt(1)), keys });
  const nk = () => nacl.sign.keyPair(); const kvm = nk(), kam = nk(); const vic = mk(V, kvm), att = mk(V, kam), R = mk('RECEIVER23456789', nk()); R.keyOf = c => c === V ? b64(kvm.publicKey) : null;
  ok(!R.accept(att.row(G.GLOBAL), { verifyNow: true }) && R.accept(vic.row(G.GLOBAL), { verifyNow: true }), 'membership: gossiped row for V with the wrong key refused; bound key accepted'); }
{ const { MeshNode } = await import('../src/mesh.js'); const vic = new MeshNode({ code: V, keys: kv, profile: { name: 'Vic' }, net: { send() {} } }), att = new MeshNode({ code: V, keys: ka, profile: { name: 'Vic' }, net: { send() {} } });
  const R = new MeshNode({ code: 'RECEIVER23456789', profile: { name: 'R' }, net: { send() {} } }); R.keyOf = c => c === V ? kv.pub : null;
  R.ingest([{ sp: att.myStub, pub: ka.pub, lastSeen: Date.now() }]); const a = R.cache.has(V); R.ingest([{ sp: vic.myStub, pub: kv.pub, lastSeen: Date.now() }]);
  ok(!a && R.cache.get(V)?.pub === kv.pub, 'mesh: gossiped stub for V with the wrong key ignored; bound key cached'); }
// ---------------- Part 4: server registry
process.env.CM_SIGNAL = 'mock'; delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.ID_BIND_SEED;
const S = await import('../api/_lib/idbind.js');
{ let T = Date.now(); const store = new S.MemBindStore({ now: () => T }), cfg = S.bindCfg({}); const g = o => S.bindGate({ store, cfg, now: T, ...o });
  ok(cfg.idleMs === 14 * 864e5 && !cfg.server && !cfg.db && S.bindCfg({ ID_REBIND_IDLE_DAYS: '3' }).idleMs === 3 * 864e5, 'cfg: defaults (memory store, no certs, 14-day idle rebind), env override');
  ok((await g({ code: V, pub: kv.pub })).http === 428, 'gate: no claim -> 428');
  ok((await g({ code: V, pub: kv.pub, claim: { ...cV, iat: 5 } })).http === 400, 'gate: bad claim -> 400');
  ok((await g({ code: V, pub: kv.pub, claim: cV })).status === 'new' && (await g({ code: V, pub: kv.pub, claim: cV })).status === 'same', 'gate: first claim binds (new), heartbeat (same)');
  const cA = await B.makeClaim({ code: V, keys: ka }); const r = await g({ code: V, pub: ka.pub, claim: cA });
  ok(r.http === 409 && r.error === 'id-bound' && store.byCode.get(V).pub === kv.pub, 'gate: attacker (own valid claim) for bound V -> 409 id-bound, binding unchanged');
  const cX = await B.makeClaim({ code: X, keys: kv }); ok((await g({ code: X, pub: kv.pub, claim: cX })).error === 'key-bound', 'gate: victim key for another ID -> 409 key-bound');
  const c2 = await B.makeClaim({ code: V, keys: kv2 }); ok((await g({ code: V, pub: kv2.pub, claim: c2, rot: B.makeRotation({ code: V, oldKeys: ka, newPub: kv2.pub }) })).http === 409, 'gate: rotation signed by a key that is NOT the bound one refused');
  const rr = await g({ code: V, pub: kv2.pub, claim: c2, rot: B.makeRotation({ code: V, oldKeys: kv, newPub: kv2.pub }) }); ok(rr.status === 'rebound' && rr.why === 'rotate' && store.byCode.get(V).pub === kv2.pub, 'gate: rotation signed by the bound key -> instant rebind');
  // idle rebind (reinstall on the same phone): needs 14 days of silence AND the heavier REBIND_POW
  const k3 = kp(), c3 = await B.makeClaim({ code: V, keys: k3 }), c3h = await B.makeClaim({ code: V, keys: k3, pow: B.REBIND_POW });
  T += 13 * 864e5; ok((await S.bindGate({ store, cfg, now: T, code: V, pub: k3.pub, claim: c3h })).error === 'id-bound', 'gate: idle rebind refused before 14 days of silence');
  T += 2 * 864e5; ok((await S.bindGate({ store, cfg, now: T, code: V, pub: k3.pub, claim: c3 })).error === 'id-bound', 'gate: idle rebind with only the normal PoW refused');
  const ri = await S.bindGate({ store, cfg, now: T, code: V, pub: k3.pub, claim: c3h }); ok(ri.status === 'rebound' && ri.why === 'idle' && store.log.length === 2, 'gate: after 15 silent days + REBIND_POW -> rebound (audited)');
  // attestation hook (NOT live: api/_fn/attest.js never returns attested:true today)
  const k4 = kp(), c4w = await B.makeClaim({ code: V, keys: k4, pow: B.ATTESTED_POW });
  ok((await S.bindGate({ store, cfg, now: T, code: V, pub: k4.pub, claim: c4w })).http === 400, 'hook: lighter ATTESTED_POW refused without attestation');
  ok((await S.bindGate({ store, cfg, now: T, code: V, pub: k4.pub, claim: c4w, att: { attested: true, id: X } })).http === 400, 'hook: attestation for ANOTHER ID ignored');
  const ra = await S.bindGate({ store, cfg, now: T, code: V, pub: k4.pub, claim: c4w, att: { attested: true, id: V, pub: k4.pub } }); ok(ra.status === 'rebound' && ra.why === 'attested', 'hook: (future) verified attestation for this ID + key -> lighter PoW + instant rebind');
  const AT = await import('../api/_fn/attest.js'); const real = await AT.verifyAttestation({ provider: 'play-integrity', id: V, pub: k4.pub, nonce: await (await import('../src/attest.js')).attestNonce(V, undefined, k4.pub), token: 'x' }, { GOOGLE_CLOUD_PROJECT: 'p', PLAY_INTEGRITY_SA_JSON: JSON.stringify({ client_email: 'a@b', private_key: 'k' }), ANDROID_PACKAGE_NAME: 'com.x' });
  ok(real.attested === false && real.reason === 'not-implemented', 'hook: real Play Integrity verification still a stub (attested:false, not faked)');
  ok(await (await import('../src/attest.js')).attestNonce(V, '1', k4.pub) !== await (await import('../src/attest.js')).attestNonce(V, '1'), 'attest: nonce also binds the signing key when given');
  // certs when ID_BIND_SEED is set
  const seed = Buffer.from(nacl.randomBytes(32)).toString('hex'), cfgC = S.bindCfg({ ID_BIND_SEED: seed }), k5 = kp(), c5 = await B.makeClaim({ code: 'CERTCODE23456789', keys: k5 });
  const rc = await S.bindGate({ store, cfg: cfgC, code: 'CERTCODE23456789', pub: k5.pub, claim: c5 }); ok(rc.ok && B.verifyCert(rc.cert, cfgC.server.pub, { code: 'CERTCODE23456789', pub: k5.pub }) && S.bindStatus(cfgC).certPub === cfgC.server.pub && !JSON.stringify(S.bindStatus(cfgC)).includes(seed), 'certs: ID_BIND_SEED -> signed cert in the reply; bindinfo shows only the public key');
  ok(S.bindCfg({ ID_BIND_SEED: 'short' }).server === null, 'certs: malformed seed ignored (no certs)');
  // fail closed
  const dead = new S.DbBindStore({ url: 'http://x', srk: 'k', salt: 's', timeoutMs: 200 }, { f: async () => { throw new Error('down'); } }), slow = new S.DbBindStore({ url: 'http://x', srk: 'k', salt: 's', timeoutMs: 150 }, { f: () => new Promise(() => {}) }), e500 = new S.DbBindStore({ url: 'http://x', srk: 'k', salt: 's', timeoutMs: 200 }, { f: async () => ({ ok: false, status: 500 }) });
  for (const [n, st] of [['down', dead], ['slow', slow], ['500', e500]]) ok((await S.bindGate({ store: st, cfg, code: V, pub: kv.pub, claim: cV })).http === 503, `fail closed: registry ${n} -> 503 (no new entry)`);
  ok(S.makeBindStore(S.bindCfg({ SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' })) instanceof S.DbBindStore && S.makeBindStore(S.bindCfg({})) instanceof S.MemBindStore, 'store selection: db with server env, memory otherwise'); }
// fake PostgREST id_bind shared by 2 real node instances
{ const db = new Map(), keys = new Map(), bodies = []; let calls = 0;
  const http = createServer((q, s) => { let d = ''; q.on('data', c => d += c); q.on('end', () => { calls++; const b = JSON.parse(d || '{}'); bodies.push(d);
      if (q.url !== '/rest/v1/rpc/id_bind' || q.headers.apikey !== 'srk-test') { s.writeHead(401); return s.end('{}'); }
      let out; const cur = db.get(b.p_code); if (cur === b.p_pub) out = { status: 'same' }; else if (keys.has(b.p_pub) && keys.get(b.p_pub) !== b.p_code) out = { status: 'key-bound' }; else if (!cur) { db.set(b.p_code, b.p_pub); keys.set(b.p_pub, b.p_code); out = { status: 'new' }; } else out = { status: 'id-bound' };
      s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify(out)); }); });
  await new Promise(r => http.listen(0, r)); const url = 'http://127.0.0.1:' + http.address().port;
  const k1 = kp(), k2 = kp(), C = 'SHAREDCODE234567', cl1 = await B.makeClaim({ code: C, keys: k1 }), cl2 = await B.makeClaim({ code: C, keys: k2 });
  const run = ops => new Promise(res => { const p = spawn(process.execPath, ['--no-warnings', SELF, '--child', JSON.stringify(ops)], { env: { ...process.env, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'srk-test', ID_BIND_SALT: 'salt-test' } }); let o = ''; p.stdout.on('data', d => o += d); p.on('close', () => res(JSON.parse(o.trim().split('\n').pop() || '[]'))); });
  const [r1, r2] = await Promise.all([run([{ code: C, pub: k1.pub, claim: cl1 }, { code: C, pub: k1.pub, claim: cl1 }]), run([{ code: C, pub: k2.pub, claim: cl2 }, { code: C, pub: k2.pub, claim: cl2 }])]);
  const all = [...r1, ...r2]; ok(all.filter(x => x === 'new').length === 1 && all.filter(x => x === 'same').length === 1 && all.filter(x => x === 'refused').length === 2, `2 instances, same ID, 2 keys: exactly one binding (${r1} | ${r2})`);
  ok(bodies.length >= 4 && bodies.every(x => !x.includes(C) && !x.includes(k1.pub) && !x.includes(k2.pub)) && /"p_code":"b1/.test(bodies[0]), 'db store: only HMAC-hashed IDs / keys leave the server');
  http.close(); }
// ---------------- Part 5: bootstrap route end to end
{ const SIG = await import('../api/_lib/signal.js'), G = await import('../src/membership.js'), boot = await import('../api/_fn/bootstrap.js');
  const sig = new SIG.MockSignal(), store = new S.MemBindStore(); let ip = 0;
  const call = (method, q = {}, body) => new Promise(res => { const o = { s: 200, status(c) { o.s = c; return o; }, json(b) { res({ s: o.s, b }); }, end() { res({ s: o.s }); } }; boot.default({ method, query: q, body, headers: { 'x-forwarded-for': '10.9.' + (ip++) + '.1' } }, o, sig, store); });
  const net = new G.SimNet(G.seededRng(9)), nk = () => nacl.sign.keyPair(); const mk = (code, k) => new G.Member({ code, profile: { lookingFor: ['friends'] }, now: net.now, net, rng: G.seededRng(5), keys: k });
  const VK = nk(), AK = nk(), vic = mk(V, VK), att = mk(V, AK), other = mk('OTHERCODE2345678', nk());
  const claimOf = (m, k) => B.makeClaim({ code: m.code, keys: { pub: m.pub, sec: b64(k.secretKey) } }); const cv = await claimOf(vic, VK), ca = await claimOf(att, AK);
  ok((await call('POST', {}, { op: 'login', code: V, row: vic.row(G.GLOBAL), modes: ['friends'] })).s === 428, 'route: login without bind -> 428');
  const l = await call('POST', {}, { op: 'login', code: V, row: vic.row(G.GLOBAL), modes: ['friends'], bind: cv }); ok(l.s === 200 && l.b.bind === 'new' && !l.b.cert, 'route: victim login with claim -> 200 bind:new (no cert without ID_BIND_SEED)');
  const s1 = await call('POST', {}, { op: 'login', code: V, row: att.row(G.GLOBAL), modes: ['friends'], bind: ca }); ok(s1.s === 409 && s1.b.error === 'id-bound' && s1.b.idleRebindDays === 14, 'route: spoofed login (attacker key, own PoW claim) -> 409 id-bound');
  ok((await sig.presenceGet(V))?.pub === vic.pub, 'route: presence row still the victim\'s (refund receipts keep verifying against the real key)');
  ok((await call('POST', {}, { op: 'heartbeat', code: V, row: att.row(G.GLOBAL), bind: cv })).s === 400, 'route: attacker row + victim claim -> 400 (claim must match the row key)');
  ok((await call('POST', {}, { op: 'logoff', code: V, row: att.row(G.GLOBAL) })).s === 409 && (await sig.presenceGet(V))?.pub === vic.pub, 'route: spoofed logoff (attacker-signed row) -> 409, victim stays listed');
  ok((await call('POST', {}, { op: 'logoff', code: V, row: { code: V } })).s === 400 && (await sig.presenceGet(V))?.pub === vic.pub, 'route: unsigned logoff naming the ID -> 400 (was accepted before v43)');
  ok((await call('POST', {}, { op: 'delete', code: V, row: att.row(G.GLOBAL) })).s === 409, 'route: spoofed account delete -> 409');
  const o2 = await call('POST', {}, { op: 'login', code: other.code, row: other.row(G.GLOBAL), bind: await B.makeClaim({ code: other.code, keys: { pub: vic.pub, sec: b64(VK.secretKey) } }) }); ok(o2.s === 400, 'route: claim for a different key than the row -> 400');
  ok((await call('POST', {}, { op: 'heartbeat', code: V, row: vic.row(G.GLOBAL), bind: cv })).b.bind === 'same', 'route: victim heartbeat -> same');
  ok((await call('POST', {}, { op: 'logoff', code: V, row: vic.row(G.GLOBAL) })).s === 200 && !(await sig.presenceGet(V)), 'route: victim logoff (bound key) -> removed');
  process.env.ID_BIND_SEED = b64(nacl.randomBytes(32)); const W = mk('WITHCERT23456789', nk()); const cw = await B.makeClaim({ code: W.code, keys: { pub: W.pub, sec: b64(W.keys.secretKey) } });
  const lw = await call('POST', {}, { op: 'login', code: W.code, row: W.row(G.GLOBAL), bind: cw }); const info = await call('GET', { code: W.code, bindinfo: '1' });
  ok(lw.s === 200 && B.verifyCert(lw.b.cert, info.b.certPub, { code: W.code, pub: W.pub }) && info.b.pow.k === B.POW.k && !JSON.stringify(info.b).includes(process.env.ID_BIND_SEED), 'route: with ID_BIND_SEED the login reply carries a cert; GET ?bindinfo=1 publishes only the public key + PoW params');
  delete process.env.ID_BIND_SEED; }
const src = f => readFileSync(join(root, f), 'utf8'), am = src('src/app-mesh.js');
ok(/new E2E\(\{[^)]*binder, bindProof: bindClaim \}\)/.test(am) && /node\.keyOf = c => binder\.pinned\(c\)/.test(am) && /member\.keyOf = c => binder\.pinned\(c\)/.test(am) && /live\.keyOf = c => binder\.pinned\(c\)/.test(am), 'wiring: app-mesh binds E2E pings, gossip stubs, membership rows and living-mesh adverts to the binder');
ok(/bind: op === 'login' \|\| op === 'heartbeat' \? bindClaim/.test(am) && /requestAttestation\(id\.code, \{ pub: id\.keys\.pub \}\)/.test(am) && /p\.meshIds\[asKey\]\.bindClaim = bindClaim/.test(am), 'wiring: presence sends the claim, attestation nonce binds the key, claim cached in the vault (PoW once)');
const walk = d => existsSync(d) ? readdirSync(d).flatMap(f => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]) : [];
const bundle = [...walk(join(root, 'dist')), ...walk(join(root, 'dist-admin'))].filter(f => /\.(js|html)$/.test(f)), btxt = bundle.map(f => readFileSync(f, 'utf8')).join('\n');
ok(bundle.length > 0 && /cm-idbind-claim-v1/.test(btxt) && !/ID_BIND_SEED|ID_BIND_SALT|MemBindStore|rpc\/id_bind/.test(btxt), `bundle: client binding code shipped, server registry/secrets never in the app (${bundle.length} files)`);
ok(!/import[^;]*_lib\/idbind/.test(walk(join(root, 'src')).filter(f => f.endsWith('.js')).map(f => readFileSync(f, 'utf8')).join('\n')), 'src/ never imports the server registry');
ok(existsSync(join(root, 'supabase/tests/id_bindings.sql')) && /V43RESULT/.test(src('supabase/tests/id_bindings.sql')) && /grant execute on function public\.id_bind\([^)]*\) to service_role/.test(src('supabase/migrations/20261027000010_id_bindings.sql')), 'sql: migration grants service_role only; live rolled-back test present');
{ const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = await import('../src/backend/supabase-config.js');
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/id_bind', { method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_code: 'b1smoketestcode01', p_pub: 'b1smoketestkey001' }), signal: AbortSignal.timeout(8000) }).then(async x => ({ s: x.status, ok: x.ok, b: await x.text() })).catch(() => null);
  if (!r) console.log('SKIP live anon id_bind check (offline)'); else ok(!r.ok && [401, 403, 404].includes(r.s) && !/"status":"new"/.test(r.b), `live: anon key calling id_bind is refused (HTTP ${r.s} ${(/"code":"(\w+)"/.exec(r.b) || [])[1] || ''})`); }
console.log(fail ? 'SMOKE-IDBIND: FAIL' : 'SMOKE-IDBIND: ALL OK'); process.exit(fail);
