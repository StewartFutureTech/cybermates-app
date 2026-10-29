// 24-hour offline sweep (local only, no network). Peers not seen for >24h are dropped from this phone's active list
// (gossip rows active+inactive, peer cache/presence/live) and every queued/pending outbound item addressed to them is
// discarded: outbound message queue, pending friend requests, gossip store/outbox rows for them. Phones must not keep
// trying to forward to people who may never return (docs/AUDIT-2026-10-19.md, "Ban enforcement logic").
// Friends are kept (long-term relationship) but their queued messages are still dropped.
export const STALE_MS = 24 * 3600e3;
export function lastSeenOf(member, node, code, k) {
  const r = member?.active.get(k) || member?.inactive.get(k);
  return Math.max(r?.ts || 0, member?.recvAt?.get(k) || 0, node?.presence?.get(code) || 0, node?.cache?.get(code)?.lastSeen || 0);
}
// isBanned(code): banned users (gossiped ban list) are cleared like stale peers, including their queued messages.
// cooldowns: roulette 24 h cooldown lists (src/roulette.js Cooldown) — expired entries pruned here too.
export function sweepStale({ member, node, now = Date.now(), maxAgeMs = STALE_MS, isBanned = () => false, cooldowns = [] } = {}) {
  const stale = new Set(), out = { peers: 0, queued: 0, gossip: 0, friendReqs: 0, banned: 0, cooldown: 0, codes: stale };
  for (const cd of cooldowns) try { out.cooldown += cd?.prune?.() || 0; } catch {}
  const ban = c => { if (c && !stale.has(c) && isBanned(c)) { stale.add(c); out.banned++; } };
  if (member) for (const m of [member.active, member.inactive]) for (const [k, r] of [...m]) if (r.code !== member.code && isBanned(r.code)) { m.delete(k); member.recvAt?.delete(k); ban(r.code); }
  if (node) { for (const c of [...node.presence.keys(), ...node.cache.keys(), ...(node.outq || []).map(e => e.to), ...(node.relayq || []).map(e => e.to)]) ban(c); for (const c of stale) { node.presence.delete(c); node.cache.delete(c); node.live?.delete(c); node.chats?.delete(c); } }
  if (member) for (const m of [member.active, member.inactive]) for (const [k, r] of [...m]) {
    if (r.code === member.code) continue;
    if (now - lastSeenOf(member, node, r.code, k) > maxAgeMs) { m.delete(k); member.recvAt?.delete(k); member.suspects?.delete(k); stale.add(r.code); out.peers++; } }
  if (node) {
    for (const [c, v] of [...node.cache]) if (now - Math.max(v.lastSeen || 0, node.presence.get(c) || 0) > maxAgeMs) { node.cache.delete(c); stale.add(c); }
    for (const [c, t] of [...node.presence]) if (now - t > maxAgeMs) { node.presence.delete(c); node.live?.delete(c); stale.add(c); }
    for (const c of stale) { node.live?.delete(c); if (node.pendingOut?.delete(c)) out.friendReqs++; }
    if (Array.isArray(node.outq)) { const keep = node.outq.filter(e => !stale.has(e.to) && !(e.queuedAt && now - e.queuedAt > maxAgeMs)); out.queued += node.outq.length - keep.length; node.outq.splice(0, node.outq.length, ...keep); }
    if (Array.isArray(node.relayq)) { const keep = node.relayq.filter(e => !stale.has(e.to) && !(e.queuedAt && now - e.queuedAt > maxAgeMs)); out.queued += node.relayq.length - keep.length; node.relayq.splice(0, node.relayq.length, ...keep); }
  }
  if (member?.store) { const dropIds = new Set(); for (const [id, it] of [...member.store]) { const c = it.obj?.code || it.obj?.target; if (c && stale.has(c)) { member.store.delete(id); dropIds.add(id); out.gossip++; } }
    if (dropIds.size && Array.isArray(member.outbox)) member.outbox = member.outbox.filter(o => !dropIds.has(o.id)); }
  return out;
}
