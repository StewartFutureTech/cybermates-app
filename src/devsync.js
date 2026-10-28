// v49 LINKED-DEVICE SYNC over the mesh (no server). Devices linked by v37 share the network ID + profile signing key, but each
// keeps its own friends / block list in its own vault, so a friend's message that now reaches every device (src/e2e.js v3) would
// still be dropped by a device that never saw the friendship ("accept before any message"). A 'dsync' envelope goes ONLY to my
// own sibling devices (e2e v3, sealed per device, signed with the shared profile key) and carries:
//   f: { code: profileKey }   friends (union: a friend added on any device is a friend on all of them)
//   b: { code: [1|0, t] }     block / unblock decisions, last writer wins per code (so an unblock on one device sticks)
// Nothing else (no chats, no history, no wallet). Bounded: SYNC_MAX entries each; future timestamps clamped.
export const SYNC_MAX = 300, SKEW_MS = 3600e3;
const okCode = c => typeof c === 'string' && c.length >= 4 && c.length <= 64 && /^[A-Za-z0-9_+/=:-]+$/.test(c);
const okPub = p => typeof p === 'string' && p.length >= 40 && p.length <= 64;
export function buildSync({ friends, blockLog = {} }) {
  const f = {}, b = {};
  for (const [c, x] of [...friends].slice(-SYNC_MAX)) if (okCode(c) && okPub(x?.pub)) f[c] = x.pub;
  for (const [c, e] of Object.entries(blockLog).sort((p, q) => p[1][1] - q[1][1]).slice(-SYNC_MAX)) if (okCode(c) && Array.isArray(e)) b[c] = [e[0] ? 1 : 0, e[1]];
  return { f, b };
}
// Pure merge. Returns what to apply locally; `log` is the new block log. Never adds a friend that is blocked or banned here,
// and never re-keys a friend whose key this device already pinned differently.
export function mergeSync(remote, { friends, blockLog = {}, isBanned = () => false, isBlocked = () => false, pinned = () => null, now = Date.now() }) {
  const out = { addFriends: [], block: [], unblock: [], log: { ...blockLog }, changed: false };
  if (!remote || typeof remote !== 'object') return out;
  const rb = remote.b && typeof remote.b === 'object' ? Object.entries(remote.b).slice(0, SYNC_MAX) : [];
  for (const [c, e] of rb) { if (!okCode(c) || !Array.isArray(e) || !Number.isFinite(e[1])) continue; const t = Math.min(e[1], now + SKEW_MS), on = e[0] === 1;
    const mine = out.log[c]; if (mine && mine[1] >= t) continue; out.log[c] = [on ? 1 : 0, t]; out.changed = true; (on ? out.block : out.unblock).push(c); }
  const blockedNow = c => (out.log[c] ? out.log[c][0] === 1 : isBlocked(c));
  const rf = remote.f && typeof remote.f === 'object' ? Object.entries(remote.f).slice(0, SYNC_MAX) : [];
  for (const [c, pub] of rf) { if (!okCode(c) || !okPub(pub) || friends.has(c) || blockedNow(c) || isBanned(c)) continue; const pin = pinned(c); if (pin && pin !== pub) continue; out.addFriends.push([c, pub]); out.changed = true; }
  return out;
}
