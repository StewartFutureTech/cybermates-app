// Client-side kill / ban enforcement for the app mesh (both builds).
// - Valid signed control messages only (Ed25519, existing KILL_PUBKEY via checkControl). Unsigned/forged/stale/replayed are rejected.
// - kill (scope 'all' or 'user:<my mesh code>'): wipe cached peers/online list/stubs, close mesh + relay, persist killed flag
//   (same localStorage record the P2P layer uses), stop reconnecting.
// - targeted kill = ban: also stores an encrypted 'banned' marker INSIDE the device vault (AES-GCM with the device-derived key),
//   so a copied vault blob can't be decrypted on another device, and this app refuses to rejoin locally.
//   Limits: clearing app data / reinstalling / a new device evades the local marker — the server blocklist (bootstrap refuses
//   banned codes) is the real gate. A device-fingerprint hash column exists in public.blocklist for future use.
// - clear (scope 'all' or 'user:<me>'): lifts the kill flag; a user-scoped clear (unban) also removes the vault marker.
import { checkControl, KILL_PUBKEY } from './killswitch.js';
// Single-entry design: the active list lives ONLY in memory (never persisted). Kill/ban clears memory (wipePeers) and
// removes any leftover pre-2026-10-20 persisted list files (legacy key prefix) so old installs keep nothing on disk.
const LEGACY_AL = 'cybermates:active-list:';
function purgeLegacyActiveLists(storage) { const s = storage || globalThis.localStorage; if (!s) return 0; const keys = typeof s.length === 'number' && s.key ? Array.from({ length: s.length }, (_, i) => s.key(i)) : Object.keys(s._m || s); let n = 0; for (const k of keys.filter(k => k?.startsWith(LEGACY_AL))) { s.removeItem(k); n++; } return n; }
export { purgeLegacyActiveLists };
import { levelOf } from './tiers.js';
// Tiers: signed kill level 5 (or no level) = ban (marker never expires); level 4 = suspension (marker + kill flag expire at
// expires_at, friends kept); level 1-3 are never acted on from the mesh (warnings arrive via server check-in only).
const KK = 'cybermates:kill', NK = 'cybermates:mesh-kill-nonces';
const ls = () => globalThis.localStorage;
class Seen { constructor() { try { this.s = new Set(JSON.parse(ls()?.getItem(NK)) || []); } catch { this.s = new Set(); } } has(n) { return this.s.has(n); } add(n) { this.s.add(n); ls()?.setItem(NK, JSON.stringify([...this.s].slice(-500))); } }
// Global halt (scope 'all') is PERSISTENT: it ignores expires_at and lasts until a signed resume (clear, scope 'all') whose
// issued_at is newer than the halt. A replayed old halt (issued before the last resume) is ignored. RK = last resume time.
const RK = 'cybermates:last-resume';
export const lastResume = () => +ls()?.getItem(RK) || 0;
export const killState = (now = Date.now()) => { try { const k = JSON.parse(ls()?.getItem(KK)); return k && (k.scope === 'all' || k.expires_at > now) ? k : null; } catch { return null; } };
export async function banMarker(vault) { try { return (await vault?.read())?.ban || null; } catch { return null; } }
export async function blockedReason(vault, now = Date.now()) { const b = await banMarker(vault); if (b && !(b.until && b.until <= now)) return b.level === 4 ? { banned: false, suspended: true, until: b.until, reason: b.reason, at: b.at } : { banned: true, reason: b.reason, at: b.at }; const k = killState(now); return k ? { banned: !!k.targeted, killed: true, reason: k.reason, scope: k.scope } : null; }
// Wipe everything that lets this phone find peers again (cached online list, stubs, active list, stored friend stubs/addresses).
export async function wipePeers(m, vault, { full = false, storage } = {}) {
  try { purgeLegacyActiveLists(storage); } catch {} // legacy persisted list files (none written any more)
  if (m) { try { m.node.presence.clear(); m.node.live.clear(); m.node.cache.clear(); m.member?.active?.clear?.(); if (full) { m.node.friends.clear(); m.node.chats.clear(); } } catch {} try { await m.stop(); } catch {} }
  if (vault) await vault.use(p => { for (const id of Object.values(p.meshIds || {})) { delete id.stubs; delete id.peers; delete id.addresses; if (full) id.friends = {}; } delete p.peerCache; }).catch(() => {});
}
// Returns {ok, reason, applied:'kill'|'ban'|'clear'|'unban'|null, forward:boolean}. forward = signature valid (safe to gossip on).
export async function applyControl(msg, { code, vault, mesh = null, source = 'broadcast', pubkey = KILL_PUBKEY, now = Date.now(), seen = new Seen(), onNotice = () => {}, storage } = {}) {
  if (msg?.type === 'kill' && msg.level != null && levelOf(msg) < 4) return { ok: false, reason: 'warning-only', applied: null, forward: false }; // warnings never boot
  const r = await checkControl(msg, { pubkey, now, seen, userId: code, sessionId: null, source });
  const forward = r.ok || r.reason === 'out-of-scope';
  if (!r.ok) return { ...r, applied: null, forward };
  const targeted = msg.scope === 'user:' + code, level = levelOf(msg), susp = targeted && msg.type === 'kill' && level === 4;
  if (msg.scope === 'all') { const cur = killState(now);
    if (msg.type === 'clear' && cur?.scope === 'all' && !(msg.issued_at > cur.issued_at)) return { ok: false, reason: 'stale-resume', applied: null, forward: false }; // resume must be newer than the halt
    if (msg.type === 'kill' && msg.issued_at <= lastResume()) return { ok: false, reason: 'stale-halt', applied: null, forward: false }; // replayed old halt
    if (msg.type === 'clear') ls()?.setItem(RK, String(msg.issued_at)); }
  if (msg.type === 'clear') { if (msg.scope !== 'all' && killState(now)?.scope === 'all') return { ok: true, applied: targeted ? 'unban' : null, forward }; ls()?.removeItem(KK); if (targeted && vault) await vault.use(p => { delete p.ban; }).catch(() => {}); onNotice(null); return { ok: true, applied: targeted ? 'unban' : 'clear', forward }; }
  ls()?.setItem(KK, JSON.stringify({ scope: msg.scope, reason: msg.reason, issued_at: msg.issued_at, expires_at: msg.expires_at, targeted }));
  if (targeted && vault) await vault.use(p => { p.ban = { reason: msg.reason, at: msg.issued_at, nonce: msg.nonce, level, strikes: msg.strikes ?? null, ...(susp ? { until: msg.expires_at } : {}) }; });
  await wipePeers(mesh, vault, { full: targeted && !susp, storage }); // suspension: booted, friends kept
  onNotice(susp ? { suspended: true, until: msg.expires_at, reason: msg.reason, scope: msg.scope } : { banned: targeted, reason: msg.reason, scope: msg.scope });
  return { ok: true, applied: susp ? 'suspend' : targeted ? 'ban' : 'kill', level: targeted ? level : null, forward };
}
export function noticeBanner(n) {
  let el = document.getElementById('bannotice'); if (!n) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'bannotice'; el.setAttribute('role', 'alert'); el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:1001;background:#b00020;color:#fff;padding:12px;text-align:center;font-size:14px'; document.body.prepend(el); }
  if (n.geo && n.notice && !n.warning) { el.style.background = '#b00020'; el.textContent = '🇺🇸 ' + n.notice; return; }
  if (n.warning && n.geo) { el.style.background = '#8a6d00'; el.textContent = n.warning; return; }
  if (n.warning && !n.banned && !n.suspended) { el.style.background = '#8a6d00'; el.textContent = n.warning + ' You can keep using Cybermates.'; return; }
  el.style.background = '#b00020';
  if (n.suspended) { el.textContent = `⏸️ Your account is suspended until ${new Date(n.until).toLocaleString()}${n.reason ? ': ' + n.reason : ''}. You can't join the network until then.`; return; }
  el.textContent = n.banned ? `⛔ This account has been banned from Cybermates${n.reason ? ': ' + n.reason : ''}. You can't join the network from this device. Appeals: see Help → Contact safety team.` : `⚠️ Cybermates has shut down the peer network${n.reason ? ': ' + n.reason : ''}. Connections are closed; the app won't reconnect until it's lifted.`;
}
