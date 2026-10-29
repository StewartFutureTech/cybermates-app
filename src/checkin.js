// 24-hour ban check-in. Single-entry design: every startup goes through the server (GET /api/bootstrap) — there is no
// cached-list jump-start any more. While the app stays open, the phone re-checks at least every 24h (?check=1):
// 403 banned/suspended / 503 halt / 451 non-US. Local mode (BroadcastChannel dev transport, no server): dev-only no-op.
// Banned → apply the kill locally (kill flag + encrypted vault ban marker + shred active list).
export const CHECKIN_MS = 24 * 3600e3, LK = 'cybermates:last-server-ok';
const ls = s => s || globalThis.localStorage;
export const lastServerOk = storage => { try { return +ls(storage).getItem(LK) || 0; } catch { return 0; } };
export const recordServerOk = (now = Date.now(), storage) => { try { ls(storage).setItem(LK, String(now)); } catch {} };
// Pure decision (fake-clock testable).
export function startPlan({ lastOk = 0, now = Date.now(), local = false } = {}) {
  if (local) return { check: false, pull: false, why: 'local dev mode (no server) — entry gate is a no-op' };
  const fresh = lastOk > 0 && now - lastOk <= CHECKIN_MS;
  return { check: !fresh, pull: true, why: 'single entry: server list is the only way in' + (fresh ? '' : ' (24h check-in due)') };
}
// fetchStatus(code) → {status} (HTTP status of the bootstrap gate) ; returns {ok, banned, killed, offline}
export async function checkIn({ code, fetchStatus, now = Date.now(), storage, local = false }) {
  if (local) return { ok: true, skipped: 'local' }; // TODO(server): real check once a server is configured in local/dev builds
  let st, body = {}; try { const r = await fetchStatus(code); st = r?.status; body = (await r?.json?.().catch(() => ({}))) || {}; } catch { st = 0; }
  // tiered: 403 {banned, level 5} | 403 {suspended, level 4, until} | 200 {level 1-3, warning} | 200 {level 0}
  if (st === 403 && body.suspended) return { ok: false, suspended: true, level: 4, until: body.until, reason: body.reason };
  if (st === 403) return { ok: false, banned: true, level: 5, reason: body.reason };
  if (st === 503) return { ok: false, killed: true };
  if (st === 451) return { ok: false, geo: true, notice: body.notice || 'Cybermates is US-only.' }; // US-only (x-vercel-ip-country), travel grace expired
  if (st >= 200 && st < 300) { recordServerOk(now, storage); return { ok: true, level: body.level || 0, warning: body.warning || null, geoWarning: body.geoWarning || null }; } // warnings don't boot
  return { ok: false, offline: true }; // unreachable: don't trust the cached list yet; retry when online
}
// Banned by the server (HTTPS, authoritative): apply the same local effects as a signed targeted kill.
// until = suspension end (level 4): kill flag + marker expire then; friends kept.
export async function applyServerBan({ vault, mesh = null, reason = 'banned (server check-in)', now = Date.now(), storage, onNotice = () => {}, wipePeers, until = null }) {
  const susp = until > now;
  try { ls(storage).setItem('cybermates:kill', JSON.stringify({ scope: 'user:self', reason, issued_at: now, expires_at: susp ? until : now + 3650 * 864e5, targeted: true, source: 'checkin' })); } catch {}
  if (vault) await vault.use(p => { p.ban = { reason, at: now, source: 'checkin', level: susp ? 4 : 5, ...(susp ? { until } : {}) }; }).catch(() => {});
  await wipePeers?.(mesh, vault, { full: !susp, storage });
  onNotice(susp ? { suspended: true, until, reason } : { banned: true, reason }); return { applied: susp ? 'suspend' : 'ban' };
}
