// Single-entry server super list (api/_fn/bootstrap.js + api/_lib/presence.js) against the mock store, + Supabase adapter fake.
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
import fs from 'node:fs';
import nodeCrypto from 'node:crypto';
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; process.env.CM_SIGNAL = 'mock';
const K = ({ ...(await import('../src/killswitch.js')), ...(await import('./lib/sign.mjs')) }), kp = K.keygen(); process.env.KILL_PUBKEY = kp.publicKey;
const G = await import('../src/membership.js'), SIG = await import('../api/_lib/signal.js'), boot = await import('../api/_fn/bootstrap.js'), P = await import('../api/_lib/presence.js');
const sig = new SIG.MockSignal({ pub: kp.publicKey }); let ip = 0;
// v43: login/heartbeat need the ID-binding claim (src/idbind.js); the helper attaches each test member's claim automatically
const BIND = await import('../src/idbind.js'), { b64 } = await import('../src/vault.js'), claims = new Map(); const claimFor = async m => { if (!claims.has(m.code)) claims.set(m.code, await BIND.makeClaim({ code: m.code, keys: { pub: m.pub, sec: m.keys.secretKey instanceof Uint8Array ? b64(m.keys.secretKey) : '' }, signFn: m.keys.secretKey instanceof Uint8Array ? null : msg => nodeCrypto.sign(null, msg, m.keys.secretKey) })); return claims.get(m.code); };
const call = (method, q = {}, body, hd = {}) => new Promise(res => { if (body && !('bind' in body) && ['login', 'heartbeat'].includes(body.op) && claims.has(body.code)) body = { ...body, bind: claims.get(body.code) }; const o = { s: 200, status(c) { o.s = c; return o; }, json(b) { res({ s: o.s, b }); }, end() { res({ s: o.s }); } }; boot.default({ method, query: q, body, headers: { 'x-forwarded-for': '10.0.' + (ip++) + '.1', ...hd } }, o, sig); });
const net = new G.SimNet(G.seededRng(3)); const mk = (code, lf) => { const m = new G.Member({ code, profile: { lookingFor: lf }, now: net.now, net, rng: G.seededRng(code.length + code.charCodeAt(4)) }); return m; };
const A = mk('AAAA000000000001', ['gaming']), B = mk('BBBB000000000002', ['dating']), C = mk('CCCC000000000003', ['gaming', 'friends']);
for (const m of [A, B, C]) await claimFor(m);
assert((await call('POST', {}, { op: 'login', code: A.code, row: A.row(G.GLOBAL), bind: null })).s === 428, 'v43: login without an ID-binding claim refused (428)');
for (const [m, modes] of [[A, ['gaming']], [B, ['dating']], [C, ['gaming', 'friends']]]) assert((await call('POST', {}, { op: 'login', code: m.code, row: m.row(G.GLOBAL), modes })).s === 200, 'login ' + m.code);
let r = await call('GET', { code: A.code }); assert(r.s === 200 && r.b.list.length === 2 && !r.b.list.some(x => x.code === A.code), 'GET returns the server list (others, not self)');
assert(r.b.list.every(x => G.verifyRow(x) && !JSON.stringify(x).match(/\b\d{1,3}(\.\d{1,3}){3}\b|"ip"/)), 'rows owner-signed, no IPs');
r = await call('GET', { code: A.code, mode: 'gaming' }); assert(r.b.list.length === 1 && r.b.list[0].code === C.code, 'mode-filtered list');
const forged = { ...A.row(G.GLOBAL), tags: ['hacked'] }; assert((await call('POST', {}, { op: 'login', code: A.code, row: forged })).s === 400, 'forged row refused');
assert((await call('POST', {}, { op: 'login', code: 'ZZZZ000000000009', row: B.row(G.GLOBAL) })).s === 400, 'someone else\'s row refused');
assert((await call('POST', {}, { op: 'login', code: A.code })).s === 400, 'login without row refused');
assert((await call('POST', {}, { op: 'heartbeat', code: A.code, row: A.row(G.GLOBAL), modes: ['gaming'] })).s === 200, 'heartbeat refreshes');
assert((await call('POST', {}, { op: 'logoff', code: B.code, row: B.row(G.GLOBAL) })).s === 200 && !(await call('GET', { code: A.code })).b.list.some(x => x.code === B.code), 'logoff removes from list');
// expiry
const mp = new P.MemPresence({ now: () => T }); var T = 0; await mp.upsert('X1', { code: 'X1' }, ['friends']); T = P.PRESENCE_TTL_MS + 1; assert((await mp.list()).length === 0, 'silent rows expire after TTL');
// gates at the single entry
sig.setRecord(C.code, { level: 5, strikes: 5, reason: 'spam' });
assert((await call('GET', { code: C.code })).s === 403, 'banned: GET refused'); assert((await call('POST', {}, { op: 'heartbeat', code: C.code, row: C.row(G.GLOBAL) })).s === 403 && !(await call('GET', { code: A.code })).b.list.some(x => x.code === C.code), 'banned: heartbeat refused AND removed from server list');
sig.setRecord('WARNED00000000W', { level: 2, strikes: 2, reason: 'spam' }); const Wm = mk('WARNED00000000W', ['friends']); await claimFor(Wm);
r = await call('POST', {}, { op: 'login', code: Wm.code, row: Wm.row(G.GLOBAL), modes: ['friends'] }); assert(r.s === 200 && r.b.level === 2, 'warning level: allowed in, level returned');
assert((await call('GET', { code: 'NEWCA000000000Q' }, null, { 'x-vercel-ip-country': 'CA' })).s === 451, 'non-US refused at entry');
sig.setHalt(K.sign(K.makeMsg({ type: 'kill', scope: 'all', reason: 'test halt' }), kp.privateKey));
assert((await call('GET', { code: A.code })).s === 503 && (await call('POST', {}, { op: 'heartbeat', code: A.code, row: A.row(G.GLOBAL) })).s === 503, 'global halt: entry + heartbeat refused');
sig.setHalt(null);
// Supabase adapter (fake REST)
const calls = []; const ss = new SIG.SupabaseSignal({ url: 'https://p.supabase.co', srk: 'k' }, async (u, o = {}) => { calls.push({ u, m: o.method || 'GET', b: o.body }); return { ok: true, json: async () => [{ row: { code: 'R1' } }] }; });
await ss.presenceUpsert('AAAA', { code: 'AAAA' }, ['gaming', 'bogus']); assert(calls[0].u.includes('/rest/v1/presence?on_conflict=code') && JSON.parse(calls[0].b).modes.join() === 'gaming', 'supabase: presence upsert (modes cleaned)');
const L = await ss.presenceList({ mode: 'gaming', exclude: 'AAAA' }); assert(L[0].code === 'R1' && /seen_at=gt\./.test(calls[1].u) && /modes=cs\.%7Bgaming%7D/.test(calls[1].u) && /code=neq\.AAAA/.test(calls[1].u), 'supabase: list with TTL, mode and self-exclusion');
await ss.presenceRemove('AAAA'); assert(calls[2].m === 'DELETE', 'supabase: logoff deletes');
assert(/create table if not exists public\.presence/.test(fs.readFileSync('supabase/schema.sql', 'utf8')), 'schema.sql: presence table');
// removed entry routes
const src = ['src/app-mesh.js', 'api/_fn/bootstrap.js', 'src/membership.js', 'src/checkin.js'].map(f => fs.readFileSync(f, 'utf8')).join('\n');
assert(!fs.existsSync('src/snapshot.js') && !fs.existsSync('src/activelist.js') && !/snap-req|SnapshotCache|snapshotPush|saveActiveList|loadActiveList|useCache/.test(src), 'removed: phone snapshots, persisted active list, cached-list jump-start');
assert(/SERVER UNREACHABLE · NO NEW ENTRY/.test(fs.readFileSync('src/app-mesh.js', 'utf8')), 'no server -> no new entry');
delete process.env.CM_SIGNAL; delete process.env.KILL_PUBKEY; console.log('ALL OK smoke-presence');
