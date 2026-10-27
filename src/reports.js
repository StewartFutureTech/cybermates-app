// UX §12 + step 4: REPORTS BUCKET + local moderation queue + mute.
// Reports from a profile, a chat or a game land in the 'reports' bucket (kv-store; LocalKV now, SupabaseKV 'reports' table
// later — the existing compliance.submitReport() server path stays). Child-safety reasons are flagged URGENT and marked
// law-enforcement-eligible (team can hand the record to police). Evidence = only the excerpt the reporter chose to attach.
// MUTE is local and silent (they are not told); BLOCK uses the existing BlockList (they are told they were blocked).
import { kv, supabaseBackend } from './kv-store.js';
import { REPORT_REASONS } from './compliance.js';
export const CONTEXTS = ['profile', 'chat', 'game', 'voice', 'lfg', 'event'];
export const STATUSES = ['open', 'reviewing', 'actioned', 'dismissed'];
export const URGENT = new Set(['illegal content (incl. child abuse)', 'threats/violence', 'underage user']);
const bucket = () => kv('reports', { max: 2000 });
const clip = (s, n) => String(s ?? '').slice(0, n);
export async function fileReport({ reporter, reported, reason, context = 'profile', excerpt = '', game = null, band = null }, now = Date.now()) {
  if (!REPORT_REASONS.includes(reason)) return { ok: false, reason: 'bad-reason' }; if (!CONTEXTS.includes(context)) return { ok: false, reason: 'bad-context' };
  if (!reported || reported === reporter) return { ok: false, reason: 'bad-target' };
  const dup = (await bucket().list(r => r.reporter === reporter && r.reported === reported && r.reason === reason && now - r.at < 3600e3))[0]; if (dup) return { ok: true, rec: dup, duplicate: true };
  const urgent = URGENT.has(reason), rec = { id: `rp-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, reporter: clip(reporter, 16), reported: clip(reported, 16), reason, context, game: game && clip(game, 32), band,
    excerpt: clip(excerpt, 1000), at: now, status: 'open', priority: urgent ? 'urgent' : 'normal', lawEnforcement: reason.startsWith('illegal'), log: [{ at: now, s: 'open' }] };
  return { ok: true, rec: await bucket().put(rec) }; }
export async function queue({ status = null } = {}) { const rank = r => (r.priority === 'urgent' ? 0 : 1); return (await bucket().list(r => !status || r.status === status)).sort((a, b) => rank(a) - rank(b) || a.at - b.at); }
export async function setStatus(id, s, note = '', now = Date.now()) { if (!STATUSES.includes(s)) return null; const r = await bucket().get(id); if (!r) return null; r.status = s; r.log.push({ at: now, s, note: clip(note, 200) }); return bucket().put(r); }
export async function countsByUser() { const m = {}; for (const r of await bucket().list()) m[r.reported] = (m[r.reported] || 0) + 1; return m; }
// ---- mute (local only, silent)
const mutes = () => kv('mutes');
export async function mute(owner, code) { const r = (await mutes().get(owner)) || { id: owner, list: [] }; if (!r.list.includes(code)) r.list.push(code); return mutes().put(r); }
export async function unmute(owner, code) { const r = (await mutes().get(owner)) || { id: owner, list: [] }; r.list = r.list.filter(x => x !== code); return mutes().put(r); }
export async function isMuted(owner, code) { return !!(await mutes().get(owner))?.list.includes(code); }
export async function mutedSet(owner) { return new Set((await mutes().get(owner))?.list || []); }
// ---- moderation queue view (admin build / Advanced → Reports). Renders into el.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function modQueueView(el, { onBlock = null, store = supabaseBackend()?.store } = {}) { const items = await queue(), counts = await countsByUser();
  const role = store?.amModerator ? await store.amModerator().catch(() => null) : null; // only real moderators get the team bucket (DB-enforced)
  el.innerHTML = (role ? '<div id="mq-team"></div>' : '') + `<div class="card glass3d"><h3>⚑ Reports queue <span class="muted small">(${items.filter(r => r.status === 'open').length} open · stored on this device until the reports server is live)</span></h3>
  ${items.length ? items.map(r => `<div class="card mq-item ${r.priority}" data-id="${esc(r.id)}"><div class="row gap"><b class="grow">${r.priority === 'urgent' ? '🚨 ' : ''}${esc(r.reason)}</b><span class="chip small">${esc(r.context)}${r.game ? ' · ' + esc(r.game) : ''}</span><span class="small muted">${new Date(r.at).toLocaleString()}</span></div>
    <div class="small">Reported <b>#${esc(r.reported)}</b> (${counts[r.reported] || 1} report${(counts[r.reported] || 1) > 1 ? 's' : ''}) by #${esc(r.reporter)}${r.lawEnforcement ? ' · <b class="warn">law-enforcement eligible</b>' : ''}</div>
    ${r.excerpt ? `<pre class="small mq-ex">${esc(r.excerpt)}</pre>` : ''}<div class="row gap small"><span class="grow">Status: <b>${esc(r.status)}</b></span>${STATUSES.filter(s => s !== r.status).map(s => `<button class="small" data-st="${s}">${s}</button>`).join('')}${onBlock ? '<button class="small" data-blk>Block</button>' : ''}</div></div>`).join('') : '<p class="muted">No reports.</p>'}</div>`;
  el.querySelectorAll('.mq-item').forEach(c => { const id = c.dataset.id; c.querySelectorAll('[data-st]').forEach(b => b.onclick = async () => { await setStatus(id, b.dataset.st); modQueueView(el, { onBlock }); });
    const bb = c.querySelector('[data-blk]'); if (bb) bb.onclick = async () => { const r = await bucket().get(id); await onBlock(r.reported); bb.textContent = 'Blocked'; bb.disabled = true; }; });
  if (role) await teamReviewView(el.querySelector('#mq-team'), store, { role });
  return items.length; }
// ---- v39 TEAM REVIEW BUCKET (Supabase). Rows come from public.mod_queue(); the database decides who may read/act (moderators
// table + RLS + security-definer RPCs, adults only, conflict-of-interest and lead-only dismissal of priority-1 checks), so this
// view only renders and relays. 'serious' = unresolved child safety / threats / underage / sexual content / minor involved /
// repeat target / escalated.
export const TEAM_BUCKETS = { serious: 'Serious abuse', open: 'All open', resolved: 'Resolved' };
export const TEAM_ACTIONS = { in_review: 'Claim', actioned: 'Action taken', escalated: 'Escalate', dismissed: 'Dismiss' };
const pri = p => (p <= 1 ? '🚨 P1' : p === 2 ? '⚠️ P2' : 'P' + p);
export async function teamReviewView(el, store, { role = null, bucket = 'serious', ask = q => globalThis.prompt?.(q, '') } = {}) {
  if (!el || !store?.modQueue) return 0; let rows = [], err = '';
  try { rows = await store.modQueue(bucket, 100); } catch (e) { err = e.code === '42501' ? 'Not a moderator (access is enforced by the server).' : 'Could not load the review queue.'; }
  el.innerHTML = `<div class="card glass3d" data-team-review><h3>🛡️ Team review <span class="chip small">${esc(role || '')}</span></h3>
  <div class="row gap small">${Object.entries(TEAM_BUCKETS).map(([k, v]) => `<button class="small${k === bucket ? ' primary' : ''}" data-bk="${k}">${v}</button>`).join('')}</div>
  ${err ? `<p class="warn small" data-team-err>${esc(err)}</p>` : rows.length ? rows.map(r => `<div class="card mq-team-item${r.priority <= 1 ? ' urgent' : ''}" data-rid="${esc(r.id)}">
    <div class="row gap"><b class="grow">${pri(r.priority)} ${esc(r.reason)}</b><span class="chip small">${esc(r.status)}${r.escalation_level ? ' · esc ' + r.escalation_level : ''}</span><span class="small muted">${esc(new Date(r.created_at).toLocaleString())}</span></div>
    <div class="small">Reported ${esc(r.reported_id ? String(r.reported_id).slice(0, 8) : 'unknown')} (${r.reports_on_target || 1} report${(r.reports_on_target || 1) > 1 ? 's' : ''}${r.reported_band === 'minor' ? ', <b class="warn">minor</b>' : ''}) · reporter ${r.reporter_band === 'minor' ? '<b class="warn">minor</b>' : esc(r.reporter_band || '?')}${String(r.reason).startsWith('illegal') ? ' · <b class="warn">law-enforcement eligible — preserve, do not delete</b>' : ''}</div>
    ${r.details ? `<pre class="small mq-ex">${esc(r.details)}</pre>` : ''}${r.moderator_note ? `<div class="small muted">Note: ${esc(r.moderator_note)}</div>` : ''}
    ${['actioned', 'dismissed'].includes(r.status) ? '' : `<div class="row gap small">${Object.entries(TEAM_ACTIONS).filter(([s]) => s !== r.status).map(([s, l]) => `<button class="small" data-act="${s}">${l}</button>`).join('')}</div>`}<p class="small" data-out></p></div>`).join('') : '<p class="muted">Nothing in this bucket.</p>'}</div>`;
  el.querySelectorAll('[data-bk]').forEach(b => b.onclick = () => teamReviewView(el, store, { role, bucket: b.dataset.bk, ask }));
  el.querySelectorAll('.mq-team-item').forEach(c => c.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => {
    const st = b.dataset.act, note = st === 'in_review' ? null : (ask('Note for the team (optional):') ?? null);
    try { st === 'in_review' ? await store.modClaim(c.dataset.rid) : await store.modResolve(c.dataset.rid, st, note || null); await teamReviewView(el, store, { role, bucket, ask }); }
    catch (e) { c.querySelector('[data-out]').textContent = '✗ ' + (e.message || 'refused by server'); } }));
  return rows.length; }
