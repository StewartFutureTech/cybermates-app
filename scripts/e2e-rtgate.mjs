// v46 REALTIME JOIN GATE, LIVE against the Cybermates Supabase project (real Realtime websocket, real RLS, real RPCs).
//  Part A (always; SKIP offline): the anon key can NOT join the private 'mesh' / 'control' topics (CHANNEL_ERROR Unauthorized).
//  Part B (needs SUPA_TEST_USERS='[{"email","password"} x3]', pre-confirmed adults; user 3 = a lead moderator):
//    A and B pay the real fresh PoW through MeshGate -> public.mesh_admit -> join 'mesh' through SupabaseBus; A's broadcast reaches
//    B. C (signed in, age-checked, NOT admitted) is refused by Realtime and never sees the traffic. C (moderator) suspends B ->
//    B's next join is refused and B's gate reports 'suspended'; lift -> B can be admitted again. Per-user hourly limit -> 'rate'.
//    Users are throwaway (created/deleted by whoever runs it; see docs/TODO.md v46). Without SUPA_TEST_USERS Part B prints SKIP.
//  node scripts/e2e-rtgate.mjs
import { makeClient } from '../src/backend/supabase-client.js';
import { MeshGate } from '../src/mesh-admit.js';
import { SupabaseBus, Throttle } from '../src/net.js';
const transport = globalThis.WebSocket || (await import('ws')).default;
let fail = 0, n = 0; const ok = (c, m) => { n++; console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail = 1; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const join = (c, topic, ms = 12000) => new Promise(res => { const ch = c.channel(topic, { config: { private: true, broadcast: { self: false } } }); const t = setTimeout(() => res({ s: 'NONE', ch }), ms);
  ch.subscribe((s, e) => { if (s === 'SUBSCRIBED' || s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') { clearTimeout(t); res({ s, e: e?.message || '', ch }); } }); });
async function joinRetry(c, topic) { let r = await join(c, topic); if (/MissingPartition/.test(r.e)) { c.removeChannel(r.ch); await sleep(1500); r = await join(c, topic); } return r; }
// ---------------- Part A
{ const c = await makeClient({ persist: false, transport }).catch(() => null);
  const probe = c && await Promise.resolve(c.rpc('mesh_gate_info')).then(r => r, () => null);
  if (!probe || /fetch failed/i.test(probe?.error?.message || '')) console.log('SKIP live Realtime checks (offline)');
  else { for (const topic of ['mesh', 'control']) { const r = await joinRetry(c, topic); ok(r.s === 'CHANNEL_ERROR' && /Unauthorized|permission/i.test(r.e), `live anon: private '${topic}' join refused by Realtime (${r.s}: ${r.e.slice(0, 70)})`); c.removeChannel(r.ch); }
    c.removeAllChannels?.(); } }
// ---------------- Part B
let creds = null; try { creds = process.env.SUPA_TEST_USERS ? JSON.parse(process.env.SUPA_TEST_USERS) : null; } catch {}
if (!Array.isArray(creds) || creds.length < 3) console.log('SKIP Part B (signed-in users): set SUPA_TEST_USERS (3 pre-confirmed adult users, #3 a lead moderator)');
else {
  const users = [];
  for (const [i, cr] of creds.slice(0, 3).entries()) { const c = await makeClient({ persist: false, transport }); const r = await c.auth.signInWithPassword(cr); ok(!r.error && r.data?.session, `sign in user ${'ABC'[i]}${r.error ? ' (' + r.error.message + ')' : ''}`); users.push({ c, uid: r.data?.user?.id, code: 'V46E2E' + 'ABC'[i], pub: ('ABC'[i]).repeat(43) + '=' }); }
  const [A, B, C] = users;
  if (users.every(u => u.uid)) {
    // C: signed in + age-checked but NOT admitted -> Realtime refuses
    await C.c.realtime.setAuth((await C.c.auth.getSession()).data.session.access_token);
    const gi = await C.c.rpc('mesh_gate_info'); ok(!gi.error && gi.data.admitted === false && gi.data.age_checked === true && gi.data.pow.b === 16 && gi.data.pow.k === 6, 'C: gate_info -> not admitted, age-checked, web PoW b16 k6');
    const rc = await joinRetry(C.c, 'mesh'); ok(rc.s === 'CHANNEL_ERROR' && /Unauthorized/i.test(rc.e), `C (signed in, not admitted): Realtime refuses the 'mesh' join (${rc.s}: ${rc.e.slice(0, 60)})`); C.c.removeChannel(rc.ch);
    // A, B admitted through the real gate + bus
    const states = { A: [], B: [] }, got = { A: [], B: [] }, buses = {};
    for (const [k, u] of [['A', A], ['B', B]]) { u.gate = new MeshGate({ client: u.c, identity: { code: u.code, pub: u.pub }, anon: false });
      const t0 = Date.now(); u.adm = await u.gate.ensure().catch(e => e); ok(u.adm?.expiresAt > Date.now() + 11 * 3600e3, `${k}: admitted with a real fresh PoW (${u.adm?.hashes ?? '?'} hashes, ${Date.now() - t0} ms incl. RPCs) ${u.adm?.gate || ''}`);
      buses[k] = new SupabaseBus(u.c, new Throttle(), { gate: u.gate, onGate: s => states[k].push(s.state + (s.reason ? ':' + s.reason : '')) }); buses[k].on(p => got[k].push(p)); }
    await Promise.race([Promise.all([buses.A.start(), buses.B.start()]), sleep(20000)]);
    ok(buses.A.state === 'joined' && buses.B.state === 'joined', `A + B: joined the private 'mesh' topic through SupabaseBus (A ${states.A.join('>')}, B ${states.B.join('>')})`);
    // C listens with an unadmitted channel attempt meanwhile (already refused); A sends
    const sent = await buses.A.post({ type: 'ping', from: A.code, body: { v46: 'hello-' + Date.now() } });
    for (let i = 0; i < 40 && !got.B.length; i++) await sleep(250);
    ok(sent === true && got.B.length === 1 && got.B[0].from === A.code && /^hello-/.test(got.B[0].body?.v46), "A -> B: broadcast delivered over the gated Realtime 'mesh' topic");
    // C (lead moderator) suspends B -> B's next join refused, B's gate says suspended
    const s1 = await C.c.rpc('mod_mesh_suspend', { p_user: B.uid, p_minutes: 5, p_reason: 'v46 e2e flood test' }); ok(!s1.error && s1.data?.ok, 'C (moderator): suspends B for 5 min' + (s1.error ? ' (' + s1.error.message + ')' : ''));
    buses.B.close(); const rb = await joinRetry(B.c, 'mesh'); ok(rb.s === 'CHANNEL_ERROR' && /Unauthorized/i.test(rb.e), `B (suspended): Realtime refuses the re-join (${rb.s}: ${rb.e.slice(0, 60)})`); B.c.removeChannel(rb.ch);
    const g2 = new MeshGate({ client: B.c, identity: { code: B.code, pub: B.pub }, anon: false }); const e2 = await g2.ensure().catch(e => e); ok(e2?.gate === 'suspended', `B: gate reports suspended (no PoW spent) -> ${e2?.gate || 'admitted?!'}`);
    const s2 = await C.c.rpc('mod_mesh_lift', { p_user: B.uid }); ok(!s2.error && s2.data?.ok, 'C (moderator): lifts the suspension');
    const s3 = await B.c.rpc('mod_mesh_suspend', { p_user: A.uid, p_minutes: 5, p_reason: 'x' }); ok(s3.error && /moderators only/.test(s3.error.message), 'B (not a moderator): cannot suspend others (' + (s3.error?.code || '?') + ')');
    const g3 = new MeshGate({ client: B.c, identity: { code: B.code, pub: B.pub }, anon: false }); const a3 = await g3.ensure().catch(e => e); ok(a3?.expiresAt > Date.now(), 'B: admitted again after the lift ' + (a3?.gate || ''));
    const rb2 = await joinRetry(B.c, 'mesh'); ok(rb2.s === 'SUBSCRIBED', `B: Realtime join allowed again (${rb2.s})`); B.c.removeChannel(rb2.ch);
    // per-user limit: garbage attempts by C count; the 7th within the hour is 'rate'
    let last = null; for (let i = 0; i < 7; i++) last = (await C.c.rpc('mesh_admit', { p_code: C.code, p_pub: C.pub, p_w: 1, p_b: 16, p_k: 6, p_n: [1, 2, 3, 4, 5, 6] })).data;
    ok(last?.ok === false && last?.error === 'rate', `C: per-user hourly attempt limit -> ${JSON.stringify(last)}`);
    // control: admitted A may read but never write ('control' is the service role's kill/ban channel)
    const rA = await joinRetry(A.c, 'control'); ok(rA.s === 'SUBSCRIBED', `A (admitted): may listen on 'control' (${rA.s})`); A.c.removeChannel(rA.ch);
    buses.A.close(); for (const u of users) { u.c.removeAllChannels?.(); await u.c.auth.signOut().catch(() => {}); }
  }
}
console.log(fail ? `E2E-RTGATE: FAILURES (${n} checks)` : `E2E-RTGATE: ALL OK (${n} checks)`); process.exit(fail);
