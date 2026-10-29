// Tiered enforcement (keyed by the ID key). Pure logic shared by client, api/ and admin tools.
//   1-3 WARNING   : server-only record; user sees a warning on next check-in/bootstrap and keeps using the app. Not gossiped.
//   4   SUSPENSION: signed targeted kill with level 4, expires_at = suspension end (default 7 days). Booted; bootstrap refuses
//                   until expiry; afterwards the record is treated as level 3 (warning).
//   5   BAN       : signed targeted kill (level 5 or legacy entries without a level): instant boot + gossip + server blocklist.
// Each new offense escalates one level (max 5). Admin may also set a level directly, lower it, or unban (clear).
export const LEVELS = { 1: 'warning', 2: 'warning', 3: 'final warning', 4: 'suspension', 5: 'ban' };
export const SUSPEND_MS = 7 * 864e5, BAN_TTL_MS = 365 * 864e5 - 60e3;
export const levelOf = e => (e && e.level != null ? +e.level : 5); // legacy signed bans (no level) = 5
// Effective level of a server/blocklist record at time `now` (suspension expiry drops it back to 3).
export function effectiveLevel(rec, now = Date.now()) {
  if (!rec) return 0; const l = levelOf(rec);
  if (l === 4) { const until = rec.suspended_until ? +new Date(rec.suspended_until) : rec.expires_at; if (!(until > now)) return 3; }
  return l;
}
// Next state for a new offense. set: explicit level (1-5) chosen by admin; lower: allowed only via set.
export function nextOffense(prev, { set = null, reason = '', now = Date.now(), suspendMs = SUSPEND_MS } = {}) {
  const cur = effectiveLevel(prev, now), strikes = (prev?.strikes || 0) + 1;
  const level = set != null ? Math.max(1, Math.min(5, +set)) : Math.min(5, cur + 1);
  return { level, strikes, reason, suspended_until: level === 4 ? now + suspendMs : null, ttlMs: level === 4 ? suspendMs : level === 5 ? BAN_TTL_MS : 24 * 3600e3 };
}
export const enforced = l => l >= 4; // only 4-5 need mesh propagation / boot
// Message shown on check-in/bootstrap for levels 1-3.
export const warningText = (level, reason, strikes) => `⚠️ Warning (level ${level}/5${strikes ? `, strike ${strikes}` : ''}): ${reason || 'community guidelines violation'}. ${level >= 3 ? 'One more offense will suspend your account for 7 days.' : 'Repeat offenses lead to suspension and a ban.'}`;
