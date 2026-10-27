// Shared moderation helpers for serverless routes + scripts (service-role only; never bundled into the app).
// Order for every enforcement action is SERVER STATE FIRST, then broadcast:
//   mesh-wide kill: 1) kill_switch record (bootstrap starts refusing all joins) 2) Realtime 'control' 3) mesh gossip {k:'ctl'}
//   ban:            1) blocklist row (bootstrap refuses that code)            2) mod_actions log 3) 'control' + mesh gossip (targeted kill)
//   unban:          1) delete blocklist row 2) log 3) broadcast signed user-scoped 'clear'
import { verifySig, MAX_LIFETIME_MS, BROADCAST_MAX_AGE_MS, CLOCK_SKEW_MS } from '../../src/killswitch.js';
import { CATEGORIES, CSAM_REMINDER } from '../../src/modconst.js';
import { levelOf, effectiveLevel, enforced } from '../../src/tiers.js';
import { globalHit } from './globalrl.js';
export { effectiveLevel };
export { CATEGORIES, CSAM_REMINDER };
export const CSAM_PRESERVE_DAYS = 365; // docs/trust-safety.md: preserve report data 1 year after CyberTip (UNVERIFIED legal basis)
// Server holds ONLY the kill-switch PUBLIC key: KILL_PUBKEY (preferred) or VITE_KILL_PUBKEY. The private key never lives server-side.
export function env(e = process.env) { return { url: e.SUPABASE_URL, srk: e.SUPABASE_SERVICE_ROLE_KEY, pub: e.KILL_PUBKEY || e.VITE_KILL_PUBKEY }; }
const H = srk => ({ apikey: srk, Authorization: 'Bearer ' + srk, 'Content-Type': 'application/json' });
async function call(f, u, o, what) { const r = await f(u, o); if (!r.ok) throw Object.assign(new Error(`${what} failed: ${r.status}`), { status: 502 }); return r; }
// Fresh, validly signed control message (holding the private key is the authorization for every admin action).
// Server holds ONLY the public key (env VITE_KILL_PUBKEY). seen = per-instance nonce cache (pass ADMIN_NONCES from routes).
export const ADMIN_NONCES = globalThis.__cmAdminNonces ||= new Map();
export async function verifyAdminMsg(msg, pub, now = Date.now(), seen = null) {
  if (!pub) return 'server has no public key';
  if (msg?.type === 'kill' && msg.scope === 'all' && !String(msg.reason || '').trim()) return 'halt needs an explicit reason';
  if (!msg || !['kill', 'clear', 'warn'].includes(msg.type) || !/^(all|user:[A-Za-z0-9-]{1,64}|session:.+)$/.test(msg.scope || '')) return 'malformed';
  if (msg.level != null && !(Number.isInteger(msg.level) && msg.level >= 1 && msg.level <= 5)) return 'bad level';
  if (msg.type === 'warn' && !(msg.level >= 1 && msg.level <= 3)) return 'warn needs level 1-3';
  if (msg.type === 'kill' && levelOf(msg) < 4) return 'kill needs level 4-5 (use warn for 1-3)';
  if (!(await verifySig(msg, pub))) return 'bad signature';
  const { issued_at: ia, expires_at: ea } = msg;
  if (!(ea > ia) || ea - ia > MAX_LIFETIME_MS || ia > now + CLOCK_SKEW_MS || now - ia > BROADCAST_MAX_AGE_MS) return 'stale or bad window';
  if (seen) { for (const [n, t] of seen) if (now - t > BROADCAST_MAX_AGE_MS + CLOCK_SKEW_MS) seen.delete(n); if (seen.has(msg.nonce)) return 'replayed nonce'; seen.set(msg.nonce, now); } // replay within the freshness window
  return null;
}
export async function broadcastControl({ url, srk }, msg, f = fetch) {
  await call(f, `${url}/realtime/v1/api/broadcast`, { method: 'POST', headers: H(srk), body: JSON.stringify({ messages: [{ topic: 'control', event: 'kill', payload: msg }] }) }, 'control broadcast');
  await call(f, `${url}/realtime/v1/api/broadcast`, { method: 'POST', headers: H(srk), body: JSON.stringify({ messages: [{ topic: 'mesh', event: 'm', payload: { k: 'ctl', msg } }] }) }, 'mesh gossip broadcast');
}
export async function writeKillRecord({ url, srk }, msg, f = fetch) {
  await call(f, `${url}/rest/v1/kill_switch?on_conflict=id`, { method: 'POST', headers: { ...H(srk), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ id: 'current', msg, updated_at: new Date().toISOString() }) }, 'kill_switch record write');
}
// Global halt / resume. Halt flag (kill_switch record) FIRST, then broadcast. A resume must be newer than the current halt.
export async function currentHalt({ url, srk }, f = fetch) { const r = await f(`${url}/rest/v1/kill_switch?id=eq.current&select=msg`, { headers: H(srk) }); if (!r.ok) return null; return (await r.json())[0]?.msg || null; }
export async function meshKill(cfg, msg, f = fetch) {
  const cur = await currentHalt(cfg, f).catch(() => null);
  if (cur && msg.issued_at <= cur.issued_at) throw Object.assign(new Error(msg.type === 'clear' ? 'resume must be newer than the halt' : 'older than the current record'), { status: 409 });
  await writeKillRecord(cfg, msg, f); await broadcastControl(cfg, msg, f); }
// Every serverless route refuses while a global halt is active (bootstrap, ban, attest, help).
export async function haltGuard(res, cfg = env(), f = fetch) { if (!cfg.url || !cfg.srk || !cfg.pub) return false; const k = await killActive(cfg, f).catch(() => null); if (!k) return false; res.status(503).json({ killed: true, halted: true, reason: k.reason }); return true; }
export async function logAction({ url, srk }, row, f = fetch) {
  await call(f, `${url}/rest/v1/mod_actions`, { method: 'POST', headers: { ...H(srk), Prefer: 'return=minimal' }, body: JSON.stringify(row) }, 'mod_actions log');
}
// Tiered offense (1-5). warn (1-3): record + log only (delivered on check-in, never gossiped). kill level 4 (suspension until
// msg.expires_at) / 5 (ban): record FIRST, log, then signed targeted kill broadcast. strikes = previous strikes + 1.
export async function ban(cfg, { msg, code, category, reason = '', deviceHash = null, actor = 'admin' }, f = fetch) {
  if (!CATEGORIES.includes(category)) throw Object.assign(new Error('bad category'), { status: 400 });
  const csam = category === 'csam', now = new Date(), level = levelOf(msg), prev = await getRecord(cfg, code, f).catch(() => null);
  const strikes = msg.strikes ?? ((prev?.strikes || 0) + 1);
  await call(f, `${cfg.url}/rest/v1/blocklist?on_conflict=code`, { method: 'POST', headers: { ...H(cfg.srk), Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ code, category, reason: String(reason).slice(0, 500), entry: enforced(level) ? msg : null, level, strikes, suspended_until: level === 4 ? new Date(msg.expires_at).toISOString() : null, device_hash: deviceHash, created_at: now.toISOString(), created_by: actor }) }, 'blocklist insert');
  await logAction(cfg, { action: level === 5 ? 'ban' : level === 4 ? 'suspend' : 'warn', code, category, reason: String(reason).slice(0, 500), actor, level, preserve_until: csam ? new Date(+now + CSAM_PRESERVE_DAYS * 864e5).toISOString() : null, ncmec_report_id: null, at: now.toISOString() }, f);
  if (enforced(level)) await broadcastControl(cfg, msg, f);
  return { ok: true, level, strikes, csam, reminder: csam ? CSAM_REMINDER : null };
}
// Unban (toLevel 0: delete record) or lower to a warning level 1-3 (record kept, signed entry removed). Always broadcasts the
// signed clear so phones lift a gossiped suspension/ban.
export async function unban(cfg, { msg, code, reason = '', actor = 'admin', toLevel = 0 }, f = fetch) {
  if (toLevel > 0) await call(f, `${cfg.url}/rest/v1/blocklist?code=eq.${encodeURIComponent(code)}`, { method: 'PATCH', headers: H(cfg.srk), body: JSON.stringify({ level: Math.min(3, toLevel), entry: null, suspended_until: null }) }, 'blocklist lower');
  else await call(f, `${cfg.url}/rest/v1/blocklist?code=eq.${encodeURIComponent(code)}`, { method: 'DELETE', headers: H(cfg.srk) }, 'blocklist delete');
  await logAction(cfg, { action: toLevel > 0 ? 'lower' : 'unban', code, category: null, reason: String(reason).slice(0, 500), actor, level: toLevel, preserve_until: null, ncmec_report_id: null, at: new Date().toISOString() }, f);
  await broadcastControl(cfg, msg, f);
  return { ok: true, level: toLevel };
}
export async function getRecord({ url, srk }, code, f = fetch) {
  const r = await f(`${url}/rest/v1/blocklist?code=eq.${encodeURIComponent(code)}&select=code,category,reason,level,strikes,suspended_until`, { headers: H(srk) }); if (!r.ok) return null; return (await r.json())[0] || null;
}
// Bootstrap/check-in status for a code: {level, enforced, until?, reason, strikes}. Suspension past expiry reads as level 3.
export async function standing(cfg, code, f = fetch, now = Date.now()) {
  const rec = await getRecord(cfg, code, f); if (!rec) return { level: 0 };
  const level = effectiveLevel(rec, now);
  return { level, strikes: rec.strikes || 0, reason: rec.reason || rec.category || '', until: level === 4 ? +new Date(rec.suspended_until) : null };
}
// Blocked = effective level 4 (unexpired suspension) or 5. Warnings (1-3) and expired suspensions are NOT blocked.
export async function isBlocked(cfg, code, f = fetch, now = Date.now()) { const s = await standing(cfg, code, f, now); return s.level >= 4 ? { code, ...s } : null; }
// Current signed ban entries for joiners (same request as the blocklist check; compact encoded form).
export async function banEntries({ url, srk }, f = fetch) { const r = await f(`${url}/rest/v1/blocklist?select=entry&entry=not.is.null`, { headers: H(srk) }); if (!r.ok) return []; const { encodeEntry } = await import('../../src/banlist.js'); return (await r.json()).map(x => x.entry).filter(e => e && levelOf(e) >= 4 && e.expires_at > Date.now()).map(encodeEntry); } // only enforceable 4-5 go to the mesh
export async function killActive({ url, srk, pub }, f = fetch, now = Date.now()) {
  const r = await f(`${url}/rest/v1/kill_switch?id=eq.current&select=msg`, { headers: H(srk) }); if (!r.ok) return null; const m = (await r.json())[0]?.msg;
  return m && m.type === 'kill' && m.scope === 'all' && (await verifySig(m, pub)) ? m : null; // global halt persists until a newer signed resume replaces the record
}
export function rateLimit(store, ip, { perMin = 5 } = {}, now = Date.now()) { const h = (store.get(ip) || []).filter(t => now - t < 60e3); if (h.length >= perMin) return false; store.set(ip, [...h, now]); return true; }
// v40: same per-instance check, then the GLOBAL counter shared by all instances (api/_lib/globalrl.js; null = unavailable -> local only).
export async function rateLimitGlobal(store, name, ip, { perMin = 5 } = {}, now = Date.now(), gHit = globalHit) {
  if (!rateLimit(store, ip, { perMin }, now)) return false;
  return (await gHit(`${name}|ip|${ip}`, perMin, 60)) !== false;
}
