// v46 REALTIME JOIN GATE + PER-USER LIMITS (node half; live Realtime half = scripts/e2e-rtgate.mjs; live DB half =
// supabase/tests/realtime_gate.sql, 58 checks, rolled back).
//  Part 1 (static): migrations 20261027000013/14 - mesh/control policies for `authenticated` only (no anon), 'control' read-only,
//    gate = admission + age check + not suspended + config switch; PoW verified in SQL; attempts logged + limited per user;
//    service-role-only attestation hook + service suspension; moderator suspension caps; public RPCs are invoker wrappers;
//    legacy schema.sql no longer re-opens 'mesh' to anon; presence:/conv: policies untouched.
//  Part 2 (node): src/mesh-admit.js PoW = the SQL puzzle (vectors from the SQL test), bound to uid/code/pub/window;
//    MeshGate (session / anon sign-in / gate_info / solve / admit / cache / renew / refusals + back-off / suspended / age check)
//    against a fake Supabase client that applies the DB rules; SupabaseBus joins only after admission, sends NOTHING while
//    refused (fail closed), rejoins after a lost channel, renews before expiry, close() stops; createBus wires the gate.
//  Part 3 (live, skips offline): the anon key cannot call mesh_admit / mesh_gate_info.
//  node scripts/smoke-rtgate.mjs
import { readFileSync, existsSync } from 'node:fs';
import * as G from '../src/mesh-admit.js';
import * as NET from '../src/net.js';
import { verifyPowSeed, sha256Bytes } from '../src/idbind.js';
import { createHash } from 'node:crypto';
let fail = 0, n = 0; const ok = (c, m) => { n++; console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail = 1; };
const root = new URL('..', import.meta.url).pathname, rd = f => readFileSync(root + f, 'utf8'), strip = s => s.replace(/--.*$/gm, '');
// ---------------- Part 1: static
const m13 = strip(rd('supabase/migrations/20261027000013_realtime_gate.sql')), m14 = strip(rd('supabase/migrations/20261027000014_realtime_gate_wrappers.sql'));
ok(/create policy realtime_mesh_read on realtime\.messages for select to authenticated\s+using \(app\.mesh_topic_ok\(\(select realtime\.topic\(\)\), realtime\.messages\.extension, false\)\)/.test(m13), 'sql: mesh read policy = authenticated + mesh_topic_ok(topic, extension, false)');
ok(/create policy realtime_mesh_write on realtime\.messages for insert to authenticated\s+with check \(app\.mesh_topic_ok\(\(select realtime\.topic\(\)\), realtime\.messages\.extension, true\)\)/.test(m13), 'sql: mesh write policy = authenticated + mesh_topic_ok(.., true)');
ok(!/create policy[^;]*to[^;]*\banon\b/i.test(m13 + m14), 'sql: no realtime policy for anon');
ok(/drop policy if exists "mesh broadcast read"/.test(m13) && /drop policy if exists "mesh broadcast write"/.test(m13) && /drop policy if exists "control read"/.test(m13), 'sql: legacy anon mesh/control policies dropped');
ok(/p_ext is distinct from 'broadcast' then return false/.test(m13) && /p_topic = 'control' then return not p_write/.test(m13) && /exception when others then return false/.test(m13), 'sql: broadcast only, control read-only, fail closed on error');
ok(/exists \(select 1 from app\.mesh_admissions a where a\.user_id = p_uid and a\.expires_at > now\(\)\)/.test(m13) && /not exists \(select 1 from app\.mesh_suspensions s where s\.user_id = p_uid and s\.until > now\(\)\)/.test(m13) && /age_band from public\.profiles p where p\.id = p_uid\) is not null/.test(m13) && /c\.enabled/.test(m13), 'sql: gate = admitted (unexpired) AND not suspended AND age-checked AND enabled');
ok(/sha256\(convert_to\(format\('cm-mesh-admit-v1\|%s\|%s\|%s\|%s\|%s\|%s', p_uid, p_code, p_pub, p_w, p_b, p_k\)/.test(m13) && /int4send\(i\) \|\| substring\(int8send/.test(m13), 'sql: PoW seed/sub-puzzle format matches src/mesh-admit.js');
ok(/p_w not in \(cw, cw - 1\)/.test(m13) && /floor\(extract\(epoch from p_at\) \/ 600\)/.test(m13), 'sql: proof must be for the current or previous 10-minute window');
ok(/pg_advisory_xact_lock\(hashtextextended\('mesh_admit\|'/.test(m13) && /nh >= cfg\.admit_per_hour or nd >= cfg\.admit_per_day/.test(m13) && /why not like 'suspended-by-%'/.test(m13), "sql: per-user attempts/hour+day limit (serialized; mod/service rows don't count)");
ok((m13.match(/insert into app\.mesh_admit_log/g) || []).length >= 8 && !/raise exception 'bad-proof'/.test(m13), 'sql: refusals are returned + logged (not raised, so they count)');
ok(/security definer set search_path = '' as \$\$ select app\.mesh_admit_at\(p_code, p_pub, p_w, p_b, p_k, p_n, now\(\)\)/.test(m14) && /create function public\.mesh_admit\([^)]*\) returns jsonb\s+language sql security invoker/.test(m14), 'sql: server clock only (definer app.mesh_admit_now), public.mesh_admit is an invoker wrapper');
ok(!/grant execute on function app\.mesh_admit_at/.test(m13 + m14) && /revoke execute on function app\.mesh_pow_ok[^;]*app\.mesh_admit_at\([^;]*from public, anon, authenticated/.test(m13), 'sql: app.mesh_admit_at (explicit clock) never granted to clients');
ok(/grant execute on function public\.mesh_admit_service\(uuid, text, text, integer\), public\.mesh_suspend_service\(uuid, integer, text\) to service_role/.test(m13) && /revoke execute on function public\.mesh_admit_service[^;]*from public, anon, authenticated/.test(m13), 'sql: attestation hook + service suspension = service_role only');
ok(/maxm := case when role = 'lead' then 43200 else 10080 end/.test(m13) && /'not on yourself'/.test(m13) && /'reason required'/.test(m13) && /delete from app\.mesh_admissions where user_id = p_user/.test(m13), 'sql: moderator suspension (reviewer 7 d / lead 30 d, not self, reason, admission removed at once)');
ok(/revoke all on app\.mesh_gate_config, app\.mesh_admissions, app\.mesh_attest, app\.mesh_suspensions, app\.mesh_admit_log from public, anon, authenticated/.test(m13), 'sql: gate tables private (no client grants)');
ok(/cybermates-purge-mesh-gate/.test(m13) && /delete from app\.mesh_admit_log where at < now\(\) - interval '7 days'/.test(m13), 'sql: daily purge (expired rows, 7-day log)');
ok(!/function app\.realtime_topic_ok|policy (if exists )?realtime_band_/.test(m13 + m14), 'sql: presence:/conv: function + policies untouched');
const schema = rd('supabase/schema.sql');
ok(!/create policy "mesh broadcast (read|write)"/.test(schema) && !/create policy "control read"/.test(schema), 'schema.sql: legacy file no longer re-opens mesh/control to anon');
ok(existsSync(root + 'supabase/tests/realtime_gate.sql') && /V46RESULT/.test(rd('supabase/tests/realtime_gate.sql')), 'sql: live rolled-back test present');
// ---------------- Part 2: PoW = the SQL puzzle
const U1 = '46464646-0000-4000-8000-000000000001', U2 = '46464646-0000-4000-8000-000000000002', code = 'TESTV46A', pub = 'A'.repeat(43) + '=', w = 2945000;
const vfull = [8248, 234520, 105102, 10770, 200365, 17417], vatt = [1501, 15];
ok(G.verifyAdmission({ uid: U1, code, pub, w, b: 16, k: 6, n: vfull }) && G.verifyAdmission({ uid: U1, code, pub, w, b: 12, k: 2, n: vatt }), 'pow: the SQL test vectors verify in JS (same puzzle)');
ok(!G.verifyAdmission({ uid: U2, code, pub, w, b: 16, k: 6, n: vfull }) && !G.verifyAdmission({ uid: U1, code: 'TESTV46B', pub, w, b: 16, k: 6, n: vfull }) && !G.verifyAdmission({ uid: U1, code, pub, w: w + 1, b: 16, k: 6, n: vfull }), 'pow: bound to uid, code and window');
{ // independent re-implementation with node:crypto (what Postgres sha256() computes)
  const seed = createHash('sha256').update(`cm-mesh-admit-v1|${U1}|${code}|${pub}|${w}|16|6`).digest();
  ok(Buffer.from(G.admitSeed({ uid: U1, code, pub, w, b: 16, k: 6 })).equals(seed), 'pow: seed = SHA-256(utf8 domain string)');
  const hit = (i, x) => { const m = Buffer.alloc(40); seed.copy(m); m.writeUInt32BE(i, 32); m.writeUInt32BE(x, 36); const h = createHash('sha256').update(m).digest(); return h[0] === 0 && h[1] === 0; };
  ok(vfull.every((x, i) => hit(i, x)), 'pow: sub-puzzle = SHA-256(seed | u32be i | u32be n) with 16 leading zero bits (node:crypto)'); }
{ const t0 = Date.now(), s = await G.solveAdmission({ uid: U2, code, pub, w: G.admitWindow(), pow: { b: 16, k: 6 } }), ms = Date.now() - t0;
  ok(G.verifyAdmission({ uid: U2, code, pub, w: G.admitWindow(), b: 16, k: 6, n: s.args.p_n }) && s.args.p_b === 16 && s.args.p_k === 6 && s.args.p_code === code && s.args.p_pub === pub, `pow: fresh web admission solves + verifies (${s.hashes} hashes, ${ms} ms)`);
  ok(ms < 20000, 'pow: web cost stays bounded (< 20 s in node)');
  const capped = await G.solveAdmission({ uid: U2, code, pub, w: 1, pow: { b: 99, k: 999 }, maxHashes: 1 }).catch(e => e);
  ok(capped instanceof Error, 'pow: absurd server demand is capped (b<=24, k<=32) and gives up instead of spinning'); }
ok(G.admitWindow(600e3 * 7 + 5) === 7 && G.WINDOW_SECS === 600, 'pow: 10-minute window');
// fake Supabase client applying the DB rules (same as app.mesh_admit_at, simplified)
function fakeSupa({ uid = 'u-1', anonOk = false, signedIn = true, age = true, cfg = { b: 12, k: 2, perHour: 6, ttl: 43200 }, now = () => Date.now() } = {}) {
  const st = { calls: [], admitted: null, suspended: null, attempts: [], authTokens: [], channels: [], removed: 0, joinsRefused: 0 };
  let session = signedIn ? { user: { id: uid }, access_token: 'tok-' + uid } : null;
  const client = {
    st, auth: { getSession: async () => ({ data: { session } }), signInAnonymously: async () => { st.calls.push('anon'); if (!anonOk) return { error: { message: 'Anonymous sign-ins are disabled' } }; session = { user: { id: uid }, access_token: 'tok-anon' }; return { data: { session } }; } },
    realtime: { setAuth: async t => st.authTokens.push(t) },
    async rpc(fn, a) { st.calls.push(fn); if (!session) return { error: { message: 'permission denied', code: '42501' } };
      const t = now(), cw = Math.floor(t / 600e3);
      if (fn === 'mesh_gate_info') return { data: { w: cw, pow: { b: cfg.b, k: cfg.k }, enabled: true, admitted: !!st.admitted && st.admitted > t, expires_at: st.admitted && st.admitted > t ? new Date(st.admitted).toISOString() : null, suspended_until: st.suspended && st.suspended > t ? new Date(st.suspended).toISOString() : null, age_checked: age } };
      if (fn === 'mesh_admit') { const recent = st.attempts.filter(x => x > t - 3600e3).length; if (recent >= cfg.perHour) return { data: { ok: false, error: 'rate', retry_after_secs: 3600 } }; st.attempts.push(t);
        if (st.suspended > t) return { data: { ok: false, error: 'suspended', until: new Date(st.suspended).toISOString() } };
        if (!age) return { data: { ok: false, error: 'age-check-required' } };
        const good = [cw, cw - 1].includes(a.p_w) && a.p_b * 1 >= Math.min(cfg.b, 12) && a.p_k * 2 ** a.p_b >= cfg.k * 2 ** cfg.b && G.verifyAdmission({ uid: session.user.id, code: a.p_code, pub: a.p_pub, w: a.p_w, b: a.p_b, k: a.p_k, n: a.p_n });
        if (!good) return { data: { ok: false, error: 'bad-proof' } };
        st.admitted = t + cfg.ttl * 1000; return { data: { ok: true, expires_at: new Date(st.admitted).toISOString(), ttl_secs: cfg.ttl, att: false, left_hour: cfg.perHour - recent - 1 } }; }
      return { error: { message: 'unknown rpc ' + fn } }; },
    channel(name, opts) { st.calls.push('channel:' + name); const ch = { name, opts, handlers: [], sent: [], cb: null, on(ev, f, h) { this.handlers.push(h || f); return this; },
        subscribe(cb) { this.cb = cb; const allowed = name === 'mesh' && opts?.config?.private && st.admitted > now() && !(st.suspended > now());
          setTimeout(() => { if (allowed) cb('SUBSCRIBED'); else { st.joinsRefused++; cb('CHANNEL_ERROR', new Error('Unauthorized')); } }, 1); return this; },
        send(m) { this.sent.push(m); }, deliver(p) { this.handlers.forEach(h => h({ payload: p })); } }; st.channels.push(ch); return ch; },
    removeChannel(ch) { st.removed++; ch.cb?.('CLOSED'); } };
  return client;
}
const ident = { code: 'TESTV46A', pub };
{ // gate: no session and anonymous sign-in disabled -> refused, nothing solved
  const c = fakeSupa({ signedIn: false, anonOk: false }), g = new G.MeshGate({ client: c, identity: ident });
  const e = await g.ensure().catch(x => x); ok(e instanceof G.GateError && e.gate === 'signin' && !c.st.calls.includes('mesh_admit'), 'gate: no session + anon sign-in off -> GateError signin, no admit call');
  const c2 = fakeSupa({ signedIn: false, anonOk: true }), g2 = new G.MeshGate({ client: c2, identity: ident }); const a2 = await g2.ensure().catch(x => x);
  ok(a2?.uid === 'u-1' && c2.st.calls[0] === 'anon' && c2.st.authTokens[0] === 'tok-anon', 'gate: anonymous sign-in used when allowed, token pushed to Realtime');
  const g3 = new G.MeshGate({ client: fakeSupa({ signedIn: true }), identity: null }); ok((await g3.ensure().catch(x => x)).gate === 'identity', 'gate: no mesh identity -> refused'); }
{ // happy path + cache + renew
  let t = Date.now(); const c = fakeSupa({ now: () => t }), g = new G.MeshGate({ client: c, identity: ident, now: () => t });
  const a = await g.ensure(); ok(a.expiresAt > t && c.st.calls.filter(x => x === 'mesh_admit').length === 1 && c.st.authTokens.includes('tok-u-1'), 'gate: signed-in -> gate_info -> solve -> admitted (fake DB verified the proof)');
  await g.ensure(); ok(c.st.calls.filter(x => x === 'mesh_admit').length === 1, 'gate: admission cached (no second admit)');
  const [p1, p2] = [g.ensure(), g.ensure()]; ok(p1 === p2 || (await p1) === (await p2), 'gate: concurrent ensure() share one admission');
  t += 43200e3 - 9 * 60e3; await g.ensure(); ok(c.st.calls.filter(x => x === 'mesh_admit').length === 2, 'gate: re-admits when < 10 min left');
  const g2 = new G.MeshGate({ client: c, identity: ident, now: () => t }); const r = await g2.ensure(); ok(r.reused && c.st.calls.filter(x => x === 'mesh_admit').length === 2, 'gate: an existing server admission is reused (no new PoW)'); }
{ // refusals
  let t = Date.now(); const c = fakeSupa({ now: () => t, cfg: { b: 12, k: 2, perHour: 2, ttl: 600 } }), g = new G.MeshGate({ client: c, identity: ident, now: () => t });
  await g.ensure(); t += 10 * 60e3; await g.ensure(); t += 10 * 60e3; const e = await g.ensure().catch(x => x);
  ok(e.gate === 'rate' && e.retryAt >= t + 3599e3, 'gate: per-user hourly limit -> GateError rate with retry time');
  const calls = c.st.calls.length; const e2 = await g.ensure().catch(x => x); ok(e2.gate === 'rate' && c.st.calls.length === calls, 'gate: backs off locally (no server calls until retry time)');
  const cs = fakeSupa(); cs.st.suspended = Date.now() + 3600e3; const gs = new G.MeshGate({ client: cs, identity: ident }); const es = await gs.ensure().catch(x => x);
  ok(es.gate === 'suspended' && !cs.st.calls.includes('mesh_admit') && es.retryAt > Date.now() + 3500e3, 'gate: suspended user -> refused until the suspension ends, no PoW spent');
  const ca = fakeSupa({ age: false }), ga = new G.MeshGate({ client: ca, identity: ident }); ok((await ga.ensure().catch(x => x)).gate === 'age-check-required', 'gate: no age check -> refused');
  // a gate_info that lies about the work (too little) -> the DB rejects -> bad-proof
  const cb = fakeSupa(); const orig = cb.rpc.bind(cb); cb.rpc = async (fn, a) => fn === 'mesh_gate_info' ? { data: { ...(await orig(fn, a)).data, pow: { b: 4, k: 1 } } } : orig(fn, a);
  ok((await new G.MeshGate({ client: cb, identity: ident }).ensure().catch(x => x)).gate === 'bad-proof', 'gate: too little work is refused by the server (bad-proof)'); }
// ---------------- Part 2b: SupabaseBus fail-closed join
const tick = () => new Promise(r => setTimeout(r, 5));
const fakeTimers = () => { const q = []; return { q, setTimeout: (f, ms) => { const h = { f, ms }; q.push(h); return h; }, clearTimeout: h => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); } }; };
{ const c = fakeSupa({ signedIn: false, anonOk: false }), states = [], sleeps = [];
  const bus = new NET.SupabaseBus(c, new NET.Throttle({ rate: 1000, burst: 1000 }), { gate: new G.MeshGate({ client: c, identity: ident }), onGate: s => states.push(s.state + (s.reason ? ':' + s.reason : '')), sleep: async ms => { sleeps.push(ms); if (sleeps.length > 3) bus.close(); await tick(); } });
  bus.on(() => {}); const sent = await bus.post({ type: 'ping', from: 'X', body: {} }); await new Promise(r => setTimeout(r, 60));
  ok(sent === false && c.st.channels.length === 0 && bus.droppedGate >= 1, 'bus: not admitted -> never joins the channel, post dropped (fail closed)');
  ok(states.includes('refused:signin') && sleeps.length >= 2 && sleeps[1] >= sleeps[0], 'bus: refused -> retries with back-off');
  ok(sleeps.every(ms => ms >= NET.BACKOFF_MIN_MS), 'bus: back-off >= 2 s'); }
{ const c = fakeSupa(), states = [], timers = fakeTimers();
  const bus = new NET.SupabaseBus(c, new NET.Throttle({ rate: 1000, burst: 1000 }), { gate: new G.MeshGate({ client: c, identity: ident }), onGate: s => states.push(s.state), sleep: async () => { await tick(); }, timers: { setTimeout: (f, ms) => ms === NET.JOIN_TIMEOUT_MS ? setTimeout(f, ms) : timers.setTimeout(f, ms), clearTimeout: h => { clearTimeout(h); timers.clearTimeout(h); } } });
  const got = []; bus.on(p => got.push(p)); const r = await bus.post({ type: 'ping', from: 'A', body: { x: 1 } });
  ok(r === true && states.join(',').startsWith('admitting,joining,joined') && c.st.calls.indexOf('mesh_admit') >= 0 && c.st.calls.indexOf('mesh_admit') < c.st.calls.indexOf('channel:mesh'), 'bus: admission happens BEFORE the join; post goes out once joined');
  const ch = c.st.channels.at(-1); ok(ch.name === 'mesh' && ch.opts.config.private === true && ch.sent.length === 1 && ch.sent[0].payload.from === 'A', "bus: joins the PRIVATE 'mesh' topic and sends on it");
  ch.deliver({ from: 'B' }); ok(got.length === 1 && got[0].from === 'B', 'bus: receives broadcasts');
  ok(timers.q.some(h => h.ms > 40000e3 && h.ms < 43200e3), 'bus: renewal scheduled before the admission expires');
  // lost channel (e.g. token refresh after a suspension) -> rejoin attempt goes through the gate again
  c.st.suspended = Date.now() + 3600e3; const joinsBefore = c.st.channels.length; ch.cb('CHANNEL_ERROR'); await new Promise(r => setTimeout(r, 40));
  ok(states.includes('lost') && states.at(-1) === 'refused' && c.st.channels.length === joinsBefore, 'bus: channel lost + now suspended -> no rejoin (gate refuses before joining)');
  const r2 = await bus.post({ type: 'ping', from: 'A', body: {} }); ok(r2 === false && ch.sent.length === 1, 'bus: nothing sent while refused');
  // renewal refused -> channel closed, no further sends
  bus.close(); ok(bus.closed && !bus.ch, 'bus: close() stops'); }
{ const c = fakeSupa(), timers = fakeTimers(), states = [];
  const bus = new NET.SupabaseBus(c, new NET.Throttle({ rate: 1000, burst: 1000 }), { gate: new G.MeshGate({ client: c, identity: ident }), onGate: s => states.push(s.state), sleep: async () => { await tick(); }, timers: { setTimeout: (f, ms) => ms === NET.JOIN_TIMEOUT_MS ? setTimeout(f, ms) : timers.setTimeout(f, ms), clearTimeout: h => { clearTimeout(h); timers.clearTimeout(h); } } });
  await bus.start(); const renew = timers.q.find(h => h.ms > 1e6); c.st.suspended = Date.now() + 3600e3; await renew.f(); await new Promise(r => setTimeout(r, 30));
  ok(states.includes('refused') && !bus.ch && (await bus.post({ type: 'ping', from: 'A', body: {} })) === false, 'bus: renewal refused (suspended) -> channel closed, sends stop');
  bus.close(); }
{ // a join refused by Realtime (e.g. policy says no) -> admission forgotten, retried with back-off; join timeout handled
  const c = fakeSupa(), sleeps = []; let flips = 0; const origCh = c.channel.bind(c); c.channel = (n, o) => { const ch = origCh(n, o); if (flips++ < 1) ch.subscribe = function (cb) { this.cb = cb; setTimeout(() => cb('CHANNEL_ERROR'), 1); return this; }; return ch; };
  const bus = new NET.SupabaseBus(c, new NET.Throttle(), { gate: new G.MeshGate({ client: c, identity: ident }), sleep: async ms => { sleeps.push(ms); await tick(); } });
  await bus.start(); ok(bus.state === 'joined' && sleeps.length === 1 && c.st.removed >= 1 && bus.joins === 1, 'bus: Realtime refusal -> channel removed, back-off, re-admit, joined');
  bus.close(); }
{ // legacy / no gate (tests) still works; waiting posts are bounded
  const c = fakeSupa(); c.st.admitted = Date.now() + 1e9; const bus = new NET.SupabaseBus(c, new NET.Throttle({ rate: 1, burst: 3 }));
  ok(await bus.post({ type: 'ping', from: 'Z', body: {} }) === true, 'bus: without a gate behaves as before (smoke-supaday fakes)');
  bus.close(); ok(NET.MAX_WAITING_POSTS === 100, 'bus: at most 100 posts wait for a join in progress'); }
{ globalThis.WebSocket ||= (await import('ws')).default; // Node 20 has no native WebSocket
  const bus = await NET.createBus({ VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_ANON_KEY: 'sb_publishable_test' }, { identity: ident });
  ok(bus.kind === 'supabase realtime' && bus.gate instanceof G.MeshGate && bus.gate.identity === ident && bus.state === 'idle', 'createBus: Supabase transport always carries the join gate (bound to this mesh ID)');
  bus.close();
  ok((await NET.createBus({})).kind.startsWith('local'), 'createBus: no env -> local bus (deployed preview today)'); }
ok(/createBus\(undefined, \{ identity: \{ code: id\.code, pub: id\.keys\.pub \}/.test(rd('src/app-mesh.js')), 'app-mesh: bus created with the mesh identity for the gate');
// ---------------- Part 3: live (anon key)
{ const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = await import('../src/backend/supabase-config.js');
  const call = (fn, body) => fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }).then(async x => ({ s: x.status, ok: x.ok, b: await x.text() })).catch(() => null);
  const r = await call('mesh_admit', { p_code: code, p_pub: pub, p_w: w, p_b: 16, p_k: 6, p_n: vfull });
  if (!r) console.log('SKIP live anon checks (offline)'); else {
    ok(!r.ok && [401, 403].includes(r.s) && !/"ok":true/.test(r.b), `live: anon key calling mesh_admit is refused (HTTP ${r.s} ${(/"code":"(\w+)"/.exec(r.b) || [])[1] || ''})`);
    const r2 = await call('mesh_gate_info', {}); ok(r2 && !r2.ok && [401, 403].includes(r2.s), `live: anon key calling mesh_gate_info is refused (HTTP ${r2?.s})`);
    const r3 = await call('mesh_admit_service', { p_user: U1, p_code: code, p_provider: 'x', p_days: 1 }); ok(r3 && !r3.ok, `live: anon key calling mesh_admit_service is refused (HTTP ${r3?.s})`); } }
console.log(fail ? `SMOKE-RTGATE: FAILURES (${n} checks)` : `SMOKE-RTGATE: ALL OK (${n} checks)`); process.exit(fail);
