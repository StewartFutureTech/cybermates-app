// v41 SERVER-SIDE CONSERVATIVE BOOST REFUNDS (boost credits only; no Stripe / real-money calls).
//  Part 1 (static): migration 20261027000009_boost_refunds.sql - one decision function (idempotent, spend-bound, read never refunded,
//    cause must hold, per-sender 24 h cap -> held), append-only private audit, recipient-deleted trigger, support RPCs + mesh ledger
//    executable by service_role ONLY, definer + pinned search_path, existing callers (purge / block trigger) routed through it.
//  Part 2 (unit): api/_lib/refunds.js RefundLedger + MemRefundStore with REAL Ed25519 receipts: valid receipt blocks the refund,
//    forged/wrong-key receipt ignored, too early, unknown / someone else's message, idempotent, 10/24 h cap, 300/24 h register
//    cap, input validation, pay stub called once per refund, no Stripe anywhere in the refund path.
//  Part 3 (two real instances): fake PostgREST implementing public.mesh_refund; two node processes (= two serverless instances)
//    run api/_fn/refund.js: register on A + claim on B works, the cap is shared, codes reach the DB HMAC-hashed.
//  Part 4 (fail CLOSED): DB down / slow / 500 / bad JSON / 401 -> 'unavailable', no refund; env missing -> memory store.
//  Part 5: route validation, client wiring unchanged, server-only code never in the bundle, live anon refusal of the new RPCs.
//  The live DB half (66 checks, rolled back) is supabase/tests/boost_refunds.sql (SQL editor / MCP execute_sql).
//  node scripts/smoke-refunds.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import nacl from 'tweetnacl';
const root = new URL('..', import.meta.url).pathname, SELF = new URL(import.meta.url).pathname;
const TEST_KEY = 'smoke-test-key-not-a-secret';
const mkRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });

// ---------------- child mode: one simulated serverless instance running the real route
if (process.argv[2] === '--child') {
  const h = (await import('../api/_fn/refund.js')).default, ops = JSON.parse(process.argv[3]), out = [];
  for (const [i, b] of ops.entries()) { const res = mkRes(), t = Date.now(); await h({ method: 'POST', headers: { 'x-forwarded-for': '203.0.113.' + (i % 200 + 1) }, body: b, query: {} }, res); out.push({ code: res.code, ...(res.body || {}), ms: Date.now() - t }); }
  console.log(JSON.stringify(out)); process.exit(0);
}

let fail = 0; const ok = (c, m) => { console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail = 1; };
// ---------------- Part 1: static migration checks
const sql = readFileSync(join(root, 'supabase/migrations/20261027000009_boost_refunds.sql'), 'utf8'), code = sql.replace(/--.*$/gm, '');
const fn = name => (code.match(new RegExp(`create or replace function ${name.replace('.', '\\.')}\\([\\s\\S]*?\\$\\$;`)) || [''])[0];
const decide = fn('app.boost_refund_decide');
ok(/where message_id = p_message and reason = 'refund'\) then return 'duplicate'/.test(decide) && /on conflict do nothing;\s*if not found then return 'duplicate'/.test(decide), 'sql: idempotent (checked before and after the lock + unique index)');
ok(/reason = 'spend' and l\.delta = -1/.test(decide) && /spender is null or \(m\.sender_id is not null and spender <> m\.sender_id\) then outcome := 'denied_no_spend'/.test(decide), 'sql: spend-bound (refund only for a real -1 spend by that sender)');
ok(/m\.status = 'read' then outcome := 'denied_read'/.test(decide) && /m\.id is null then outcome := 'denied_not_eligible'/.test(decide), 'sql: read messages and purged messages are never refunded');
ok(/p_cause = 'expired' and not \(m\.expires_at <= now\(\)\)/.test(decide) && /p_cause = 'blocked' and not exists \(select 1 from public\.blocks b where b\.blocker_id = m\.recipient_id and b\.blocked_id = m\.sender_id\)/.test(decide), 'sql: the cause must really hold (expired / recipient blocked sender)');
ok(/n >= app\.boost_refund_daily_cap\(\) then outcome := 'held'/.test(decide) && /select 10/.test(fn('app.boost_refund_daily_cap')), 'sql: per-sender cap 10 / 24 h -> held for review (no credit)');
ok(/pg_advisory_xact_lock\(hashtextextended\(coalesce\(spender, m\.sender_id\)::text, 0\)\)/.test(decide), 'sql: serialized per sender (same advisory lock as the spend path)');
ok(/p_cause = 'blocked' and m\.id is not null then[\s\S]*set boosted = false/.test(decide), 'sql: block refund un-pins the message');
ok(/before update or delete on app\.boost_refund_log/.test(code) && /append-only/.test(code) && !/references/.test(code.slice(code.indexOf('app.boost_refund_log ('), code.indexOf('boost_refund_log_sender_idx'))), 'sql: audit is append-only and has no FKs (survives account deletion)');
ok(/alter table app\.boost_refund_log enable row level security/.test(code) && /alter table app\.mesh_boost_refunds enable row level security/.test(code) && !/create policy/i.test(code), 'sql: both new tables RLS on, no policies');
ok(/revoke all on app\.boost_refund_log from public, anon, authenticated/.test(code) && /revoke all on app\.mesh_boost_refunds from public, anon, authenticated/.test(code) && !/grant[^;]*on app\./i.test(code), 'sql: no table grants to clients');
ok(/app\.boost_refund_decide\(m\.id, 'blocked', 'trigger'\)/.test(fn('app.blocks_refund')) && /app\.boost_refund_decide\(m\.id, 'expired', 'cron'\)/.test(fn('app.purge_expired')) && /boost_refund_decide\(p_message, 'expired'/.test(fn('app.refund_boost')), 'sql: purge, block trigger and legacy refund_boost all go through the decision function');
ok(/before delete on public\.profiles/.test(code) && /'recipient_deleted', 'trigger'/.test(fn('app.profile_delete_refunds')) && /when p_cause = 'recipient_deleted' then null/.test(decide), 'sql: recipient account deletion refunds first (no deleted-recipient id kept)');
ok(/grant execute on function public\.my_boost_refunds\(integer\) to authenticated;/.test(code) && /where l\.sender_id = \(select auth\.uid\(\)\)/.test(fn('public.my_boost_refunds')), 'sql: owner view limited to auth.uid()');
ok(/grant execute on function public\.boost_refund_admin\(uuid, text\), public\.boost_refund_release\(bigint, text\), public\.mesh_refund\(text, text, text, text, integer\) to service_role;/.test(code) && (code.match(/grant execute/g) || []).length === 2, 'sql: support + mesh RPCs executable by service_role ONLY');
ok(/a note is required/.test(fn('public.boost_refund_admin')) && /outcome = 'held'/.test(fn('public.boost_refund_release')) && /reason = 'spend' and delta = -1 and user_id = h\.sender_id/.test(fn('public.boost_refund_release')), 'sql: support refund needs a note; release only held + spend-bound');
const mesh = fn('public.mesh_refund');
ok(/n >= 300 then return jsonb_build_object\('ok', false, 'reason', 'register cap'\)/.test(mesh) && /n >= app\.boost_refund_daily_cap\(\) then return jsonb_build_object\('ok', false, 'reason', 'capped'\)/.test(mesh) && /'already', true/.test(mesh) && /'reason', 'delivered'/.test(mesh) && /'reason', 'too early'/.test(mesh), 'sql: mesh ledger caps + idempotent + delivered + too early');
ok((code.match(/security definer set search_path = ''/g) || []).length === 9 && (code.match(/security definer/g) || []).length === 9, 'sql: every definer function (9) pins an empty search_path');
ok(!/\bdrop\s+table\b|\btruncate\b|stripe/i.test(code), 'sql: never drops tables, no Stripe');
ok(existsSync(join(root, 'supabase/tests/boost_refunds.sql')) && /V41RESULT/.test(readFileSync(join(root, 'supabase/tests/boost_refunds.sql'), 'utf8')), 'sql: live rolled-back test present');

// ---------------- Part 2: ledger unit with real receipts
const R = await import('../api/_lib/refunds.js');
const stable = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : 1)) : x);
const kp = nacl.sign.keyPair(), other = nacl.sign.keyPair(), b64 = u => Buffer.from(u).toString('base64');
const sign = (msgId, from, to, k = kp) => b64(nacl.sign.detached(new TextEncoder().encode(stable({ rcpt: msgId, from, to })), k.secretKey));
let T = 1e12; const now = () => T; let paid = 0;
const L = new R.RefundLedger({ now, pay: async () => { paid++; return { ok: true }; }, pubOf: async c => c === 'BOB0000001' ? b64(kp.publicKey) : null, store: new R.MemRefundStore({ now }) });
ok((await L.register({ msgId: 'm00001', from: 'ALI0000001', to: 'BOB0000001' })).ok, 'unit: register');
ok((await L.register({ msgId: 'm00001', from: 'ALI0000001', to: 'BOB0000001' })).reason === 'dup', 'unit: duplicate register refused');
ok((await L.claim({ msgId: 'm00001', from: 'ALI0000001' })).reason === 'too early', 'unit: no claim before the receipt timeout');
T += R.RCPT_TIMEOUT_MS + 1;
ok((await L.claim({ msgId: 'm00001', from: 'EVE0000001' })).reason === 'unknown', "unit: someone else can't claim your message");
ok((await L.claim({ msgId: 'zz0000', from: 'ALI0000001' })).reason === 'unknown', 'unit: unknown message -> no refund');
ok(!(await L.receipt({ msgId: 'm00001', from: 'ALI0000001', to: 'BOB0000001', sig: sign('m00001', 'ALI0000001', 'BOB0000001', other) })).ok, 'unit: receipt signed by the wrong key ignored');
ok(!(await L.receipt({ msgId: 'm00001', from: 'ALI0000001', to: 'BOB0000001', sig: 'AAAA' })).ok, 'unit: forged receipt ignored');
let c = await L.claim({ msgId: 'm00001', from: 'ALI0000001' }); ok(c.ok && c.refunded && paid === 1, 'unit: no valid receipt after timeout -> refunded once');
ok((await L.claim({ msgId: 'm00001', from: 'ALI0000001' })).already && paid === 1, 'unit: idempotent (already, paid once)');
await L.register({ msgId: 'm00002', from: 'ALI0000001', to: 'BOB0000001' });
ok((await L.receipt({ msgId: 'm00002', from: 'ALI0000001', to: 'BOB0000001', sig: sign('m00002', 'ALI0000001', 'BOB0000001') })).ok, 'unit: valid recipient receipt recorded');
T += 9000; ok((await L.claim({ msgId: 'm00002', from: 'ALI0000001' })).reason === 'delivered' && paid === 1, 'unit: delivered (signed receipt) -> no refund');
for (let i = 0; i < 14; i++) await L.register({ msgId: 'cap' + String(i).padStart(4, '0'), from: 'ALI0000001', to: 'BOB0000001' });
T += 9000; let n = 0, last; for (let i = 0; i < 14; i++) { last = await L.claim({ msgId: 'cap' + String(i).padStart(4, '0'), from: 'ALI0000001' }); if (last.refunded) n++; }
ok(n === R.REFUND_DAILY_CAP - 1 && last.reason === 'capped' && paid === R.REFUND_DAILY_CAP, `unit: cap ${R.REFUND_DAILY_CAP} refunds / 24 h per sender (got ${paid})`);
T += R.DAY_MS + 1; ok((await L.claim({ msgId: 'cap0013', from: 'ALI0000001' })).refunded, 'unit: cap window rolls after 24 h');
{ const S = new R.MemRefundStore({ now }); let r; for (let i = 0; i <= R.REGISTER_DAILY_CAP; i++) r = await S.op('register', { msgId: 'reg' + String(i).padStart(4, '0'), from: 'SPAM000001', to: 'BOB0000001' });
  ok(r.reason === 'register cap' && S.m.size === R.REGISTER_DAILY_CAP, 'unit: register cap 300 / 24 h per sender');
  const P = new R.MemRefundStore({ now, max: 100 }); for (let i = 0; i < 150; i++) await P.op('register', { msgId: 'p' + String(i).padStart(6, '0'), from: 'S' + i + 'XX', to: 'BOB0000001' }); ok(P.m.size <= 100, 'unit: memory store bounded'); }
ok((await L.register({ msgId: 'bad id!', from: 'ALI0000001', to: 'BOB0000001' })).reason === 'bad request' && (await L.register({ msgId: 'm00009', from: 'ALI0000001', to: 'ALI0000001' })).reason === 'bad request' && (await L.register({ msgId: 'm00010', from: 'A', to: 'BOB0000001' })).reason === 'bad request', 'unit: bad msg id / self-addressed / bad code refused');
ok(!/stripe/i.test(readFileSync(join(root, 'api/_lib/refunds.js'), 'utf8').replace(/\/\/.*$/gm, '')) && !/stripe/i.test(readFileSync(join(root, 'api/_fn/refund.js'), 'utf8').replace(/\/\/.*$/gm, '')), 'unit: no Stripe / money call in the refund path');
ok(R.codeHash('ALI0000001', 's1') !== R.codeHash('ALI0000001', 's2') && R.codeHash('ALI0000001', 's1') === R.codeHash('ALI0000001', 's1') && R.codeHash('x'.repeat(64), 's').length <= 64, 'unit: code hash keyed, stable, <= 64 chars');

// ---------------- fake PostgREST mesh_refund (same semantics, its own clock skew)
let mode = 'ok', calls = 0, skew = 0; const seen = []; const FS = new R.MemRefundStore({ now: () => Date.now() + skew });
const srv = createServer((req, res) => { let b = ''; req.on('data', d => b += d); req.on('end', async () => {
  calls++; const send = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(typeof o === 'string' ? o : JSON.stringify(o)); };
  if (req.headers.apikey !== TEST_KEY) return send(401, '{}');
  if (req.url === '/rest/v1/rpc/rl_hit') return send(200, { allowed: true, count: 1 });
  if (req.url !== '/rest/v1/rpc/mesh_refund') return send(404, '{}');
  if (mode === '500') return send(500, '{"message":"boom"}'); if (mode === 'badjson') return send(200, 'not json');
  const j = JSON.parse(b); seen.push(j);
  const go = async () => send(200, await FS.op(j.p_op, { msgId: j.p_msg, from: j.p_from, to: j.p_to, minAgeMs: j.p_min_age_ms }));
  mode === 'slow' ? setTimeout(go, 3000) : go(); }); });
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const PORT = srv.address().port;
const child = (ops, env = {}) => new Promise(r => { const p = spawn(process.execPath, ['--no-warnings', SELF, '--child', JSON.stringify(ops)], { env: { PATH: process.env.PATH, CM_SIGNAL: 'mock', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = '', e = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => e += d); p.on('close', () => { try { r(JSON.parse(o.trim().split('\n').pop())); } catch { r([{ err: e || o }]); } }); });
const ENV = { SUPABASE_URL: `http://127.0.0.1:${PORT}`, SUPABASE_SERVICE_ROLE_KEY: TEST_KEY };
const reg = (id, from = 'ALI0000001', to = 'BOB0000001') => ({ op: 'register', msgId: id, from, to }), claim = (id, from = 'ALI0000001') => ({ op: 'claim', msgId: id, from });

// ---------------- Part 3: two instances share one ledger
let A = await child([reg('x00001'), claim('x00001')], ENV);
ok(A[0].ok && A[1].reason === 'too early', 'instance A: register ok, immediate claim too early');
skew = 9000; let B = await child([claim('x00001'), claim('x00001', 'EVE0000001')], ENV);
ok(B[0].ok && B[0].refunded && B[1].reason === 'unknown', 'instance B: claim of a message registered on A -> refunded (shared ledger); other sender unknown');
A = await child([claim('x00001')], ENV); ok(A[0].ok && A[0].already, 'instance A again: already refunded (idempotent across instances)');
ok(seen.length >= 5 && seen.every(j => /^r1/.test(j.p_from) && !JSON.stringify(j).includes('ALI0000001') && !JSON.stringify(j).includes('BOB0000001')), 'codes reach the DB HMAC-hashed (no raw user codes)');
skew = 0; A = await child(Array.from({ length: 12 }, (_, i) => reg('k' + String(i).padStart(5, '0'))), ENV); skew = 9000;
const [C1, C2] = await Promise.all([child(Array.from({ length: 12 }, (_, i) => claim('k' + String(i).padStart(5, '0'))), ENV), child(Array.from({ length: 12 }, (_, i) => claim('k' + String(11 - i).padStart(5, '0'))), ENV)]);
const got = [...C1, ...C2].filter(x => x.refunded).length;
ok(A.every(x => x.ok) && got === R.REFUND_DAILY_CAP - 1 && [...C1, ...C2].some(x => x.reason === 'capped'), `two simultaneous instances: cap shared (9 more + 1 earlier = 10 refunds total, got ${got + 1})`);

// ---------------- Part 4: fail closed
const down = await child([claim('x00001')], { ...ENV, SUPABASE_URL: 'http://127.0.0.1:9' }); ok(down[0].ok === false && down[0].reason === 'unavailable', 'DB unreachable -> unavailable, no refund (fail closed)');
mode = 'slow'; const slow = await child([claim('k00011')], ENV); ok(slow[0].reason === 'unavailable' && slow[0].ms < 2600, `DB slow -> timed out (${slow[0].ms} ms), no refund`);
mode = '500'; ok((await child([claim('k00011')], ENV))[0].reason === 'unavailable', 'DB HTTP 500 -> no refund');
mode = 'badjson'; ok((await child([claim('k00011')], ENV))[0].reason === 'unavailable', 'DB bad JSON -> no refund');
mode = 'ok'; ok((await child([claim('k00011')], { ...ENV, SUPABASE_SERVICE_ROLE_KEY: 'wrong' }))[0].reason === 'unavailable', 'wrong service key (401) -> no refund');
const mem = await child([reg('y00001'), claim('y00001')], {}); ok(mem[0].ok && mem[1].reason === 'too early', 'env missing -> in-memory store, same rules');
ok(R.refundCfg({}) === null && R.refundCfg({ ...ENV, CM_REFUND_STORE: 'memory' }) === null && R.refundCfg(ENV)?.url === ENV.SUPABASE_URL && R.makeRefundStore({ cfg: R.refundCfg(ENV) }).kind === 'supabase', 'store selection: env -> supabase, CM_REFUND_STORE=memory or no env -> memory');
srv.close();

// ---------------- Part 5: route validation, wiring, bundle, live
const H = (await import('../api/_fn/refund.js')).default; const call = async (b, method = 'POST') => { const res = mkRes(); await H({ method, headers: { 'x-forwarded-for': '192.0.2.200' }, body: b, query: {} }, res); return res; };
ok((await call({}, 'GET')).code === 405, 'route: GET -> 405');
ok((await call({ op: 'claim', msgId: 'no!' })).code === 400 && (await call({ op: 'claim', msgId: 'abcdef1', from: '' })).code === 400 && (await call({ op: 'nope', msgId: 'abcdef1', from: 'ALI0000001' })).code === 400, 'route: bad msgId / from / op -> 400');
const src = f => readFileSync(join(root, f), 'utf8');
ok(/if \(c\.ok && !c\.already\) await db\._w\(\)\.refund\(me\.id, \{ boost: true \}\)/.test(src('src/app-mesh.js')), 'client: local wallet credited only on a fresh server refund (capped/unavailable/already -> no credit)');
ok(/makeRefundStore\(\)/.test(src('api/_fn/refund.js')) && /allow\(`refund\|from\|\$\{b\.from\}`, 20\)/.test(src('api/_fn/refund.js')), 'route: shared store + per-sender claim limit (both limiter layers)');
const walk = d => existsSync(d) ? readdirSync(d).flatMap(f => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]) : [];
const bundle = [...walk(join(root, 'dist')), ...walk(join(root, 'dist-admin'))].filter(f => /\.(js|html)$/.test(f));
ok(bundle.length > 0 && !bundle.some(f => /mesh_refund|REFUND_KEY_SALT|boost_refund_admin|MemRefundStore/.test(readFileSync(f, 'utf8'))), `server-only refund code never in the app bundle (${bundle.length} files)`);
ok(!/import[^;]*_lib\/refunds/.test(walk(join(root, 'src')).filter(f => f.endsWith('.js')).map(f => readFileSync(f, 'utf8')).join('\n')), 'src/ never imports the server refund ledger');
{ const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = await import('../src/backend/supabase-config.js');
  const rpc = (name, body) => fetch(SUPABASE_URL + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }).then(async r => ({ s: r.status, ok: r.ok, b: await r.text() })).catch(() => null);
  const tests = [['mesh_refund', { p_op: 'register', p_msg: 'smoke01', p_from: 'smokehash01', p_to: 'smokehash02' }], ['boost_refund_admin', { p_message: '00000000-0000-0000-0000-000000000000', p_note: 'smoke' }], ['boost_refund_release', { p_log: 1 }], ['my_boost_refunds', { p_limit: 1 }]];
  const rs = []; for (const [nm, b] of tests) rs.push([nm, await rpc(nm, b)]);
  if (rs.some(([, r]) => !r)) console.log('SKIP live anon refund RPC checks (offline)');
  else for (const [nm, r] of rs) ok(!r.ok && [401, 403, 404].includes(r.s) && !/"refunded"|"ok":true/.test(r.b), `live: anon key calling ${nm} is refused (HTTP ${r.s} ${(/"code":"(\w+)"/.exec(r.b) || [])[1] || ''})`); }
console.log(fail ? 'SMOKE-REFUNDS: FAIL' : 'SMOKE-REFUNDS: ALL OK'); process.exit(fail);
