// v40 GLOBAL RATE LIMITS (shared by every Vercel instance, not per instance).
//  Part 1 (static): migration 20261027000008_global_rate_limits.sql - private app table, RLS on, no client grants, atomic
//    upsert-increment, fixed window, auto-cleanup, SECURITY DEFINER + pinned search_path, EXECUTE for service_role only.
//  Part 2 (two real instances): a local fake PostgREST implements public.rl_hit with the same fixed-window semantics; two separate
//    node processes (= two serverless instances, each with its own in-memory Map) run api/_lib/guard.js withGuards against it
//    and must share ONE counter (sequential + simultaneous rounds). Keys reach the DB HMAC-hashed (no raw IP).
//  Part 3 (fail safe): env missing / CM_GLOBAL_RL=off / DB down / DB slow (timeout) / HTTP 500 / bad JSON -> per-instance limiter
//    still enforces, requests are not blocked, cooldown skips the DB after a failure.
//  Part 4: kill/ban (mod.rateLimitGlobal), help (min + day), bootstrap ?recent, header handling for sb_secret_ vs JWT keys,
//    and the server-only module never reaches the app bundle.
//  The live DB half (26 checks, rolled back) is supabase/tests/global_rate_limits.sql (SQL editor / MCP execute_sql).
//  node scripts/smoke-globalrl.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
const root = new URL('..', import.meta.url).pathname, SELF = new URL(import.meta.url).pathname;
const TEST_KEY = 'smoke-test-key-not-a-secret';

// ---------------- child mode: one simulated serverless instance
if (process.argv[2] === '--child') {
  const { withGuards } = await import('../api/_lib/guard.js');
  const { RL_STATE } = await import('../api/_lib/globalrl.js');
  const h = withGuards(async (req, res) => res.status(200).json({ ok: true }), { name: 'smk', perMin: +process.env.PERMIN || 10, perIdPerMin: 4 });
  const n = +process.argv[3] || 1, ip = process.argv[4] || '203.0.113.7', startAt = +process.argv[5] || 0, code = process.argv[6] || null;
  if (startAt) await new Promise(r => setTimeout(r, Math.max(0, startAt - Date.now())));
  const out = [];
  for (let i = 0; i < n; i++) {
    const res = { code: 0, status(c) { this.code = c; return this; }, json() { return this; }, end() { return this; } }, t = Date.now();
    await h({ headers: { 'x-forwarded-for': ip }, query: code ? { code } : {}, body: {} }, res); out.push([res.code, Date.now() - t]);
  }
  console.log(JSON.stringify({ out, state: RL_STATE })); process.exit(0);
}

let fail = 0; const ok = (c, m) => { console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail = 1; };
// ---------------- Part 1: static migration checks
const sql = readFileSync(join(root, 'supabase/migrations/20261027000008_global_rate_limits.sql'), 'utf8'), code = sql.replace(/--.*$/gm, '');
ok(/create table if not exists app\.rate_limit_buckets/.test(code), 'sql: counter table lives in the private app schema (not exposed by PostgREST)');
ok(/alter table app\.rate_limit_buckets enable row level security/.test(code) && !/create policy/i.test(code), 'sql: RLS on, no policies (deny-all to clients)');
ok(/revoke all on app\.rate_limit_buckets from public, anon, authenticated/.test(code) && !/grant[^;]*on app\.rate_limit_buckets/i.test(code), 'sql: no table grants to anon/authenticated');
ok(/primary key \(key, window_start\)/.test(code) && /on conflict \(key, window_start\) do update set count = least\(b\.count \+ 1/.test(code) && /returning b\.count into n/.test(code), 'sql: single-statement atomic upsert-increment');
ok(/floor\(extract\(epoch from p_at\) \/ p_window_secs\) \* p_window_secs/.test(code), 'sql: fixed window start');
ok(/delete from app\.rate_limit_buckets where expires_at < now\(\) - interval '1 minute'/.test(code) && /random\(\) < 0\.02 then perform app\.rl_cleanup\(\)/.test(code) && /rate_limit_buckets_expires_idx/.test(code), 'sql: auto-cleanup of old windows (indexed)');
ok((code.match(/security definer set search_path = ''/g) || []).length === 3, 'sql: all 3 functions SECURITY DEFINER with pinned empty search_path');
ok(/revoke all on function public\.rl_hit\(text, integer, integer\) from public, anon, authenticated/.test(code) && /grant execute on function public\.rl_hit\(text, integer, integer\) to service_role;/.test(code)
  && (code.match(/grant execute/g) || []).length === 1, 'sql: rl_hit executable by service_role ONLY');
ok(/revoke all on function app\.rl_hit_at[^;]*from public, anon, authenticated/.test(code) && /revoke all on function app\.rl_cleanup\(\) from public, anon, authenticated/.test(code), 'sql: helper functions revoked from clients');
ok(/not between 1 and 200/.test(code) && /not between 1 and 1000000/.test(code) && /not between 1 and 86400/.test(code), 'sql: key/limit/window validated');
ok(!/\bdrop\s+table\b|\btruncate\b/i.test(code), 'sql: never drops tables');
ok(existsSync(join(root, 'supabase/tests/global_rate_limits.sql')) && /V40RESULT/.test(readFileSync(join(root, 'supabase/tests/global_rate_limits.sql'), 'utf8')), 'sql: live rolled-back test present');

// ---------------- fake PostgREST rl_hit (same semantics as the migration)
const buckets = new Map(), seenKeys = []; let mode = 'ok', calls = 0;
const srv = createServer((req, res) => {
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    calls++;
    if (req.url !== '/rest/v1/rpc/rl_hit' || req.headers.apikey !== TEST_KEY) { res.writeHead(401); return res.end('{}'); }
    if (mode === '500') { res.writeHead(500); return res.end('{"message":"boom"}'); }
    if (mode === 'badjson') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('not json'); }
    const go = () => { const { p_key, p_limit, p_window_secs } = JSON.parse(b), now = Date.now(), ws = Math.floor(now / 1000 / p_window_secs) * p_window_secs, k = p_key + '@' + ws;
      seenKeys.push(p_key); const n = (buckets.get(k) || 0) + 1; buckets.set(k, n);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ allowed: n <= p_limit, count: n, limit: p_limit, reset_ms: (ws + p_window_secs) * 1000 - now })); };
    mode === 'slow' ? setTimeout(go, 2000) : go();
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const PORT = srv.address().port;
const child = (n, ip, env = {}, startAt = 0, idc = '') => new Promise(r => {
  const p = spawn(process.execPath, ['--no-warnings', SELF, '--child', String(n), ip, String(startAt), idc], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let o = '', e = ''; p.stdout.on('data', d => o += d); p.stderr.on('data', d => e += d);
  p.on('close', c => { try { r(JSON.parse(o.trim().split('\n').pop())); } catch { r({ out: [], err: e || o, exit: c }); } });
});
const ENV = { SUPABASE_URL: `http://127.0.0.1:${PORT}`, SUPABASE_SERVICE_ROLE_KEY: TEST_KEY, PERMIN: '10' };
const codes = r => r.out.map(x => x[0]); const cnt = (r, c) => codes(r).filter(x => x === c).length;
// avoid a minute rollover mid-test
{ const s = new Date().getSeconds(); if (s > 45) await new Promise(r => setTimeout(r, (61 - s) * 1000)); }

// ---------------- Part 2: two instances share one counter
let A = await child(6, '203.0.113.7', ENV), B = await child(6, '203.0.113.7', ENV);
ok(cnt(A, 200) === 6, 'instance A: 6/6 allowed (limit 10/min)');
ok(cnt(B, 200) === 4 && cnt(B, 429) === 2 && codes(B).slice(4).every(c => c === 429), 'instance B: only 4 more allowed, then 429 - ONE global counter (per-instance alone would allow 12)');
ok(A.state.ok >= 6 && B.state.ok >= 6 && A.state.fail === 0 && B.state.fail === 0, 'both instances reached the global layer, no failures');
ok(seenKeys.length > 0 && seenKeys.every(k => k.startsWith('smk|ip|') && !k.includes('203.0.113.7') && k.length <= 200), 'keys stored HMAC-hashed with route prefix (no raw IP)');
// simultaneous: 3 instances x 8 at the same moment, fresh IP -> exactly 10 allowed in total
const at = Date.now() + 700; const S = await Promise.all([0, 1, 2].map(() => child(8, '198.51.100.9', ENV, at)));
const tot = S.reduce((a, r) => a + cnt(r, 200), 0);
ok(tot === 10 && S.reduce((a, r) => a + cnt(r, 429), 0) === 14, `3 simultaneous instances x 8 hits -> exactly 10 allowed globally (got ${tot})`);
// per-ID global limit (4/min) across instances
const I1 = await child(3, '192.0.2.1', ENV, 0, 'ABCD1234'), I2 = await child(3, '192.0.2.2', ENV, 0, 'ABCD1234');
ok(cnt(I1, 200) === 3 && cnt(I2, 200) === 1 && cnt(I2, 429) === 2, 'per-ID limit is global too (same code from 2 instances/IPs: 4 allowed)');
// local first layer still refuses floods before any network call
const before = calls; const L = await child(14, '192.0.2.50', ENV);
ok(cnt(L, 200) === 10 && cnt(L, 429) === 4 && calls - before === 10, 'per-instance layer refuses over-limit hits without calling the DB');

// ---------------- Part 3: fail safe
const N = await child(12, '192.0.2.60', { PERMIN: '10' });
ok(cnt(N, 200) === 10 && cnt(N, 429) === 2 && N.state.ok === 0 && N.state.fail === 0, 'env missing -> in-memory limiter only, still enforced');
const OFF = await child(3, '192.0.2.61', { ...ENV, CM_GLOBAL_RL: 'off' }); ok(cnt(OFF, 200) === 3 && OFF.state.ok === 0, 'CM_GLOBAL_RL=off -> global layer skipped');
const DOWN = await child(12, '192.0.2.62', { ...ENV, SUPABASE_URL: 'http://127.0.0.1:9' });
ok(cnt(DOWN, 200) === 10 && cnt(DOWN, 429) === 2, 'DB unreachable -> requests still served, local limit still enforced');
ok(DOWN.state.fail === 1 && DOWN.state.downUntil > 0, 'DB unreachable -> one failed attempt, then cooldown (no retry per request)');
mode = 'slow'; const SLOW = await child(3, '192.0.2.63', ENV);
ok(cnt(SLOW, 200) === 3 && SLOW.out[0][1] < 900 && SLOW.out[1][1] < 150 && SLOW.state.fail === 1 && SLOW.state.last === 'timeout', `DB slow (2 s) -> timed out at ~350 ms (${SLOW.out[0][1]} ms), later requests skip the DB (${SLOW.out[1][1]} ms)`);
mode = '500'; const E5 = await child(2, '192.0.2.64', ENV); ok(cnt(E5, 200) === 2 && /^http 500/.test(E5.state.last || ''), 'DB HTTP 500 -> fail safe');
mode = 'badjson'; const BJ = await child(2, '192.0.2.65', ENV); ok(cnt(BJ, 200) === 2 && BJ.state.fail === 1, 'DB bad JSON -> fail safe');
const WK = await child(2, '192.0.2.66', { ...ENV, SUPABASE_SERVICE_ROLE_KEY: 'wrong' }); mode = 'ok';
ok(cnt(WK, 200) === 2 && /^http 401/.test(WK.state.last || ''), 'wrong key (401) -> fail safe');
srv.close();

// ---------------- Part 4: other limiters + headers + bundle
const G = await import('../api/_lib/globalrl.js'), M = await import('../api/_lib/mod.js'), GD = await import('../api/_lib/guard.js');
let hdr = null; const fk = async (u, o) => { hdr = o.headers; return { ok: true, json: async () => ({ allowed: true }) }; };
await G.globalHit('t|ip|x', 5, 60, { cfg: { url: 'https://p.supabase.co', srk: 'sb_secret_dummy', salt: 's' }, f: fk, state: { downUntil: 0, ok: 0, fail: 0 } });
ok(hdr.apikey === 'sb_secret_dummy' && !hdr.Authorization, 'sb_secret_ key -> apikey header only (no Bearer)');
await G.globalHit('t|ip|x', 5, 60, { cfg: { url: 'https://p.supabase.co', srk: 'eyJhbGciOiJIUzI1NiJ9.e30.x', salt: 's' }, f: fk, state: { downUntil: 0, ok: 0, fail: 0 } });
ok(hdr.Authorization === 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.x', 'legacy JWT service key -> apikey + Bearer');
ok(G.rlKey('a|ip|1.2.3.4', 's1') !== G.rlKey('a|ip|1.2.3.4', 's2') && G.rlKey('a|ip|1.2.3.4', 's1') === G.rlKey('a|ip|1.2.3.4', 's1') && G.rlKey('x'.repeat(500), 's').length <= 200, 'rlKey: keyed HMAC, stable, <= 200 chars');
ok((await M.rateLimitGlobal(new Map(), 'kill-admin', '1.1.1.1', { perMin: 5 }, Date.now(), async () => false)) === false, 'mod.rateLimitGlobal: global refusal -> 429 path');
ok((await M.rateLimitGlobal(new Map(), 'kill-admin', '1.1.1.1', { perMin: 5 }, Date.now(), async () => null)) === true, 'mod.rateLimitGlobal: global unavailable -> local decides');
{ const st = new Map(); for (let i = 0; i < 5; i++) await M.rateLimitGlobal(st, 'k', '2.2.2.2', { perMin: 5 }, Date.now(), async () => true);
  let gcalled = false; ok((await M.rateLimitGlobal(st, 'k', '2.2.2.2', { perMin: 5 }, Date.now(), async () => { gcalled = true; return true; })) === false && !gcalled, 'mod.rateLimitGlobal: local refusal first, no DB call'); }
ok((await GD.allow('r|ip|z', 3, { store: new Map(), gHit: async () => false })) === false && (await GD.allow('r|ip|z', 3, { store: new Map(), gHit: async () => null })) === true, 'guard.allow: global false refuses, null falls back');
const src = f => readFileSync(join(root, f), 'utf8');
ok(/rateLimitGlobal\(hits, 'kill-admin'/.test(src('api/_fn/kill.js')) && /rateLimitGlobal\(hits, 'ban-admin'/.test(src('api/_fn/ban.js')), 'kill + ban use the global limiter');
ok(/globalHit\('help-ai\|min\|' \+ ip, PER_MIN, 60\), globalHit\('help-ai\|day\|' \+ ip, PER_DAY, 86400\)/.test(src('api/_fn/help.js')), 'help AI: per-minute + per-day limits are global');
ok(/await allow\('recent\|ip\|'/.test(src('api/_fn/bootstrap.js')) && /await allow\('recent\|id\|'/.test(src('api/_fn/bootstrap.js')), 'bootstrap ?recent uses both layers');
ok(/globalHit\(ipKey, perMin, 60\)/.test(src('api/_lib/guard.js')) && /globalHit\(idKey, perIdPerMin, 60\)/.test(src('api/_lib/guard.js')), 'withGuards (every api route): per-IP + per-ID global');
// help route: global refusal -> 429 before any upstream call
{ process.env.XAI_API_KEY = 'x'; process.env.SUPABASE_URL = 'https://h.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = TEST_KEY; delete process.env.VITE_KILL_PUBKEY; delete process.env.KILL_PUBKEY;
  G.RL_STATE.downUntil = 0; const urls = []; const rf = globalThis.fetch;
  globalThis.fetch = async (u, o) => { urls.push(String(u)); const j = JSON.parse(o.body); return { ok: true, json: async () => ({ allowed: !String(j.p_key).startsWith('help-ai|day|') }) }; };
  const help = (await import('../api/_fn/help.js')).default; const res = { code: 0, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await help({ method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: { q: 'hi' }, query: {} }, res);
  ok(res.code === 429 && res.body?.global && !urls.some(u => u.includes('x.ai')), 'help: global day limit reached -> 429, x.ai never called');
  globalThis.fetch = rf; delete process.env.XAI_API_KEY; delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; }
const walk = d => existsSync(d) ? readdirSync(d).flatMap(f => statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]) : [];
const bundle = [...walk(join(root, 'dist')), ...walk(join(root, 'dist-admin'))].filter(f => /\.(js|html)$/.test(f));
ok(bundle.length > 0 && !bundle.some(f => /rl_hit|RL_KEY_SALT|CM_GLOBAL_RL|rate_limit_buckets/.test(readFileSync(f, 'utf8'))), `server-only limiter never in the app bundle (${bundle.length} files)`);
ok(!/import[^;]*globalrl/.test(walk(join(root, 'src')).filter(f => f.endsWith('.js')).map(f => readFileSync(f, 'utf8')).join('\n')), 'src/ never imports the server limiter');
// live: the public (publishable/anon) key must NOT be able to call rl_hit over PostgREST (SKIP if offline)
{ const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = await import('../src/backend/supabase-config.js');
  const r = await fetch(SUPABASE_URL + '/rest/v1/rpc/rl_hit', { method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_key: 'smoke|anon', p_limit: 5, p_window_secs: 60 }), signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r) console.log('SKIP live anon rl_hit check (offline)');
  else { const b = await r.text(); ok(!r.ok && [401, 403, 404].includes(r.status) && !/"allowed"/.test(b), `live: anon key calling rl_hit is refused (HTTP ${r.status} ${(/"code":"(\w+)"/.exec(b) || [])[1] || ''})`); } }
console.log(fail ? 'SMOKE-GLOBALRL: FAIL' : 'SMOKE-GLOBALRL: ALL OK'); process.exit(fail);
