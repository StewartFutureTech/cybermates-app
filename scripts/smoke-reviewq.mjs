// v39 REPORTS -> TEAM REVIEW BUCKET (Supabase, DB-enforced).
//  Part 1 (static): migration 20261027000007_report_review.sql - RLS on moderators/report_actions, no client write grants,
//    anon revoked, adult-only moderators, lead-only dismissal of P1, conflict-of-interest check, 'serious' bucket rule, nothing dropped.
//  Part 2 (node): SupabaseStore.amModerator/modQueue/modClaim/modResolve/modActions call the right RPCs/tables and surface
//    server refusals (42501) instead of deciding access themselves.
//  Part 3 (real browser, Playwright): src/reports.js modQueueView + teamReviewView against a fake store that mirrors the DB
//    rules: non-moderators get no team bucket, moderators see Serious abuse (P1 first, minor flagged, law-enforcement note),
//    claim / action / escalate / refused dismiss (server message shown), bucket switching, HTML escaped, 320 + 390 px no overflow.
//  The live DB half (24 checks, rolled back) is supabase/tests/report_review_rls.sql (run via SQL editor / MCP execute_sql).
//  node scripts/smoke-reviewq.mjs
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { SupabaseStore, ADAPTER_METHODS } from '../src/backend/supabase-store.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail = 1; };
const root = new URL('..', import.meta.url).pathname;
// ---------------- Part 1: static migration checks
const sql = readFileSync(join(root, 'supabase/migrations/20261027000007_report_review.sql'), 'utf8'), code = sql.replace(/--.*$/gm, '');
ok(/alter table public\.moderators enable row level security/.test(code) && /alter table public\.report_actions enable row level security/.test(code), 'sql: RLS enabled on moderators + report_actions');
ok(!/grant\s+(insert|update|delete|all)[^;]*on public\.(moderators|report_actions)/i.test(code), 'sql: no client insert/update/delete grants on moderators or report_actions');
ok(/revoke all on public\.moderators from anon, authenticated/.test(code) && /revoke all on public\.report_actions from anon, authenticated/.test(code), 'sql: table privileges reset for anon/authenticated');
ok(/moderators_select_own[^;]*user_id = \(select auth\.uid\(\)\)/.test(code), 'sql: a user can only see their own moderator row');
ok(/report_actions_mod_select[^;]*app\.is_moderator\(\)/.test(code), 'sql: audit trail readable by moderators only');
ok(/'adult'[\s\S]*moderators must be adult accounts/.test(code) && /age_band from public\.profiles p where p\.id = m\.user_id\) = 'adult'/.test(code), 'sql: moderators must be adults (insert guard + checked again at use)');
ok(/priority = 1 and role <> 'lead'/.test(code), 'sql: only a lead may dismiss a priority-1 report');
ok(/conflict of interest/.test(code) && /r\.reporter_id = \(select auth\.uid\(\)\) or r\.reported_id = \(select auth\.uid\(\)\)/.test(code), 'sql: moderators cannot act on reports they filed or are named in');
ok(/when 'serious'\s+then r\.status in \('open','escalated','in_review'\) and \(r\.priority <= 2 or r\.escalation_level >= 1/.test(code), "sql: 'serious' bucket = unresolved and (P1/P2 or escalated)");
ok((code.match(/if not app\.is_moderator\(\) then raise exception 'moderators only' using errcode = '42501'/g) || []).length >= 2 && /role is null then raise exception 'moderators only'/.test(code), 'sql: every mod RPC refuses non-moderators with 42501');
ok(/revoke execute on function public\.am_moderator\(\), public\.mod_queue\(text, int\), public\.mod_claim\(uuid\), public\.mod_resolve\(uuid, text, text\) from public, anon/.test(code), 'sql: RPCs revoked from public/anon');
ok(!/\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b/i.test(code), 'sql: never drops or deletes data');
ok(/security definer set search_path = ''/.test(code) && !/security definer(?![^\n]*search_path)/.test(code.replace(/security definer set search_path = ''/g, '')), "sql: every security definer has search_path = ''");
ok(existsSync(join(root, 'supabase/tests/report_review_rls.sql')) && /V39RESULT/.test(readFileSync(join(root, 'supabase/tests/report_review_rls.sql'), 'utf8')), 'sql: live RLS test file present (rolls back)');
// ---------------- Part 2: adapter
{ const calls = []; const res = (data, error = null) => ({ data, error });
  const fake = { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    rpc: async (fn, args) => { calls.push([fn, args]); if (fn === 'am_moderator') return res('reviewer'); if (fn === 'mod_queue') return res([{ id: 'r1' }]);
      if (fn === 'mod_resolve' && args.p_status === 'dismissed') return res(null, { message: 'priority-1 reports can only be dismissed by a lead', code: '42501' }); return res(args.p_status || 'in_review'); },
    from: t => { const q = { t, ops: [], select(c) { q.ops.push(['select', c]); return q; }, eq(a, b) { q.ops.push(['eq', a, b]); return q; }, order(c) { q.ops.push(['order', c]); calls.push(['from', t, q.ops]); return Promise.resolve(res([])); } }; return q; } };
  const s = new SupabaseStore(fake);
  for (const m of ['amModerator', 'modQueue', 'modClaim', 'modResolve', 'modActions']) ok(ADAPTER_METHODS.includes(m) && typeof s[m] === 'function', 'adapter: SupabaseStore.' + m);
  ok(await s.amModerator() === 'reviewer', 'adapter: amModerator -> rpc am_moderator');
  ok((await s.modQueue()).length === 1 && JSON.stringify(calls.at(-1)) === JSON.stringify(['mod_queue', { p_bucket: 'serious', p_limit: 50 }]), 'adapter: modQueue defaults to the serious bucket');
  ok(await s.modClaim('r1') === 'in_review' && calls.at(-1)[0] === 'mod_claim' && calls.at(-1)[1].p_report === 'r1', 'adapter: modClaim -> rpc mod_claim');
  ok(await s.modResolve('r1', 'actioned', 'n') === 'actioned' && calls.at(-1)[1].p_note === 'n', 'adapter: modResolve passes status + note');
  let e = null; try { await s.modResolve('r1', 'dismissed'); } catch (x) { e = x; } ok(e?.code === '42501' && /lead/.test(e.message), 'adapter: server refusal surfaces as an error (42501), client never overrides');
  await s.modActions('r1'); ok(calls.at(-1)[1] === 'report_actions' && calls.at(-1)[2].some(o => o[0] === 'eq' && o[2] === 'r1'), 'adapter: modActions reads report_actions (RLS: moderators only)');
  const bad = new SupabaseStore({ ...fake, rpc: async () => res(null, { message: 'x', code: '42501' }) }); ok(await bad.amModerator() === null, 'adapter: amModerator is null when the server refuses'); }
// ---------------- Part 3: browser UI
const pick = async (...ids) => { for (const id of ids) try { return await import(id); } catch {} throw new Error('missing ' + ids[0]); };
const { chromium } = await pick('playwright-core', '/workspace/wk/node_modules/playwright-core/index.mjs', 'playwright');
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' };
const srv = createServer((q, r) => { if (q.url === '/t.html') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end('<!doctype html><meta name=viewport content="width=device-width"><link rel=stylesheet href="/src/style.css"><body><div id=v></div></body>'); }
  const p = normalize(join(root, decodeURIComponent(q.url.split('?')[0]))); if (!p.startsWith(join(root, 'src')) || !existsSync(p)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); r.end(readFileSync(p)); });
await new Promise(r => srv.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${srv.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } }); const errs = []; page.on('pageerror', e => errs.push(String(e)));
  await page.goto(base + '/t.html');
  await page.evaluate(async () => {
    const R = await import('/src/reports.js'); window.R = R;
    const now = Date.now(), iso = t => new Date(t).toISOString();
    window.mkStore = (role, me = 'mod-1') => { const rows = [
      { id: 'r-p3', reporter_id: 'a1', reported_id: 'a2', reason: 'harassment', details: 'mean <b>x</b><img src=x onerror=window.__xss=1>', status: 'open', priority: 3, escalation_level: 0, created_at: iso(now - 5e3), reporter_band: 'adult', reported_band: 'adult', reports_on_target: 1 },
      { id: 'r-p1', reporter_id: 'm1', reported_id: 'a1', reason: 'illegal content (incl. child abuse)', details: 'evidence excerpt', status: 'escalated', priority: 1, escalation_level: 1, created_at: iso(now - 3e3), reporter_band: 'minor', reported_band: 'adult', reports_on_target: 2 },
      { id: 'r-p2', reporter_id: 'a1', reported_id: 'm2', reason: 'sexual content', details: null, status: 'open', priority: 2, escalation_level: 0, created_at: iso(now - 4e3), reporter_band: 'adult', reported_band: 'minor', reports_on_target: 1 },
      { id: 'r-own', reporter_id: me, reported_id: 'a2', reason: 'spam/scam', status: 'escalated', priority: 3, escalation_level: 1, created_at: iso(now - 2e3), reporter_band: 'adult', reported_band: 'adult', reports_on_target: 3 }];
      const deny = m => { throw Object.assign(new Error(m), { code: '42501' }); }; const log = [];
      const B = { serious: r => ['open', 'escalated', 'in_review'].includes(r.status) && (r.priority <= 2 || r.escalation_level >= 1 || r.status === 'escalated'), open: r => ['open', 'escalated', 'in_review'].includes(r.status), resolved: r => ['actioned', 'dismissed'].includes(r.status) };
      const resolve = async (id, st, note) => { if (!role) deny('moderators only'); const r = rows.find(x => x.id === id); if (r.reporter_id === me || r.reported_id === me) deny('conflict of interest: you are part of this report');
        if (st === 'dismissed' && r.priority === 1 && role !== 'lead') deny('priority-1 reports can only be dismissed by a lead'); log.push([id, st, note]); r.status = st; if (note) r.moderator_note = note; return st; };
      return { log, rows, amModerator: async () => role, modQueue: async b => { if (!role) deny('moderators only'); return rows.filter(B[b]).sort((a, c) => a.priority - c.priority || c.escalation_level - a.escalation_level || a.created_at.localeCompare(c.created_at)); },
        modClaim: id => resolve(id, 'in_review'), modResolve: resolve }; };
  });
  // non-moderator: local queue only
  const n0 = await page.evaluate(async () => { const el = document.getElementById('v'); await R.modQueueView(el, { store: mkStore(null) }); return { team: !!el.querySelector('[data-team-review]'), local: /Reports queue/.test(el.textContent) }; });
  ok(!n0.team && n0.local, 'ui: non-moderator sees only the on-device queue (no team bucket)');
  const n1 = await page.evaluate(async () => { const el = document.getElementById('v'); await R.modQueueView(el, { store: mkStore(null), }); return !!el.querySelector('[data-team-review]'); });
  ok(!n1, 'ui: store without a moderator role never renders team rows');
  // reviewer
  await page.evaluate(async () => { window.S = mkStore('reviewer'); window.__ask = 'checked'; const el = document.getElementById('v'); await R.modQueueView(el, { store: S }); });
  let st = await page.evaluate(() => { const items = [...document.querySelectorAll('.mq-team-item')]; return { ids: items.map(i => i.dataset.rid), txt: document.querySelector('[data-team-review]')?.textContent || '', role: document.querySelector('[data-team-review] .chip')?.textContent, primary: document.querySelector('[data-bk].primary')?.dataset.bk }; });
  ok(st.role === 'reviewer' && st.primary === 'serious', 'ui: moderator gets the Team review card, Serious abuse bucket first');
  ok(JSON.stringify(st.ids) === JSON.stringify(['r-p1', 'r-p2', 'r-own']), 'ui: serious bucket = P1, P2, escalated; plain P3 excluded (' + st.ids.join(',') + ')');
  ok(/🚨 P1/.test(st.txt) && /law-enforcement eligible/.test(st.txt) && /reporter minor/.test(st.txt), 'ui: P1 flagged, law-enforcement note, minor reporter flagged');
  // claim P2
  await page.click('.mq-team-item[data-rid="r-p2"] [data-act="in_review"]'); await page.waitForTimeout(100);
  st = await page.evaluate(() => ({ s: S.rows.find(r => r.id === 'r-p2').status, chip: document.querySelector('.mq-team-item[data-rid="r-p2"] .chip')?.textContent }));
  ok(st.s === 'in_review' && /in_review/.test(st.chip), 'ui: Claim -> in_review and re-rendered');
  // reviewer dismiss P1 -> refused, message shown, status unchanged
  page.once('dialog', d => d.accept('not sure'));
  await page.click('.mq-team-item[data-rid="r-p1"] [data-act="dismissed"]'); await page.waitForTimeout(150);
  st = await page.evaluate(() => ({ s: S.rows.find(r => r.id === 'r-p1').status, out: document.querySelector('.mq-team-item[data-rid="r-p1"] [data-out]')?.textContent }));
  ok(st.s === 'escalated' && /only be dismissed by a lead/.test(st.out), 'ui: reviewer dismiss of P1 refused by server, message shown');
  // own report -> conflict
  page.once('dialog', d => d.accept(''));
  await page.click('.mq-team-item[data-rid="r-own"] [data-act="actioned"]'); await page.waitForTimeout(150);
  st = await page.evaluate(() => document.querySelector('.mq-team-item[data-rid="r-own"] [data-out]')?.textContent);
  ok(/conflict of interest/.test(st), 'ui: conflict-of-interest refusal shown');
  // action P2 with note -> leaves serious, appears in resolved with note
  page.once('dialog', d => d.accept('warned + content removed'));
  await page.click('.mq-team-item[data-rid="r-p2"] [data-act="actioned"]'); await page.waitForTimeout(150);
  st = await page.evaluate(() => ({ ids: [...document.querySelectorAll('.mq-team-item')].map(i => i.dataset.rid), log: S.log.at(-1) }));
  ok(!st.ids.includes('r-p2') && st.log[1] === 'actioned' && st.log[2] === 'warned + content removed', 'ui: Action taken with note -> leaves the serious bucket');
  await page.click('[data-bk="resolved"]'); await page.waitForTimeout(100);
  st = await page.evaluate(() => ({ ids: [...document.querySelectorAll('.mq-team-item')].map(i => i.dataset.rid), btns: document.querySelectorAll('.mq-team-item [data-act]').length, txt: document.querySelector('[data-team-review]').textContent }));
  ok(st.ids.join() === 'r-p2' && st.btns === 0 && /warned \+ content removed/.test(st.txt), 'ui: Resolved bucket shows it with the note, no action buttons');
  await page.click('[data-bk="open"]'); await page.waitForTimeout(100);
  st = await page.evaluate(() => ({ ids: [...document.querySelectorAll('.mq-team-item')].map(i => i.dataset.rid), xss: window.__xss, html: document.querySelector('.mq-team-item[data-rid="r-p3"] pre')?.innerHTML || '' }));
  ok(st.ids.includes('r-p3') && !st.xss && /&lt;img/.test(st.html), 'ui: All open includes P3; report text is HTML-escaped (no injection)');
  // lead can dismiss P1
  await page.evaluate(async () => { window.S = mkStore('lead'); await R.teamReviewView(document.getElementById('v'), S, { role: 'lead' }); });
  page.once('dialog', d => d.accept('duplicate, handled'));
  await page.click('.mq-team-item[data-rid="r-p1"] [data-act="dismissed"]'); await page.waitForTimeout(150);
  ok(await page.evaluate(() => S.rows.find(r => r.id === 'r-p1').status) === 'dismissed', 'ui: lead can dismiss P1');
  // escalate P3 via open bucket
  await page.click('[data-bk="open"]'); await page.waitForTimeout(100); page.once('dialog', d => d.accept(''));
  await page.click('.mq-team-item[data-rid="r-p3"] [data-act="escalated"]'); await page.waitForTimeout(150);
  ok(await page.evaluate(() => S.rows.find(r => r.id === 'r-p3').status) === 'escalated', 'ui: Escalate works');
  // server refuses queue (role revoked mid-session)
  const n2 = await page.evaluate(async () => { const s = mkStore('reviewer'); s.modQueue = async () => { throw Object.assign(new Error('moderators only'), { code: '42501' }); }; const el = document.getElementById('v'); await R.teamReviewView(el, s, { role: 'reviewer' }); return el.querySelector('[data-team-err]')?.textContent || ''; });
  ok(/Not a moderator/.test(n2), 'ui: server refusal of the queue shows a notice, no rows');
  for (const w of [320, 390]) { await page.setViewportSize({ width: w, height: 800 }); await page.evaluate(async () => { await R.modQueueView(document.getElementById('v'), { store: mkStore('reviewer') }); });
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(ov <= 1, `ui: no horizontal overflow at ${w}px (${ov})`); }
  ok(errs.length === 0, 'ui: no page errors' + (errs.length ? ' ' + errs[0] : ''));
} finally { await browser.close(); srv.close(); }
// ---------------- Part 4: built bundle carries the new code (lazy reports chunk)
{ const fs = await import('node:fs'); const hit = (d, re) => fs.readdirSync(join(d, 'assets')).some(f => f.endsWith('.js') && re.test(fs.readFileSync(join(d, 'assets', f), 'utf8')));
  for (const d of ['dist', 'dist-admin']) if (existsSync(join(root, d, 'assets'))) ok(hit(join(root, d), /mod_queue/) && hit(join(root, d), /data-team-review/), `build: ${d} bundle contains the team review RPCs + view`); }
console.log(fail ? 'SMOKE-REVIEWQ: FAIL' : 'SMOKE-REVIEWQ: ALL OK'); process.exit(fail);
