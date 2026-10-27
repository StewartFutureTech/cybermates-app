# Living mesh (UX-WALKTHROUGH §6-8, §12) — src/livemesh.js

## Gap list (audit 2026-10-21, before this change)
1. No bucket: mesh.js kept a 50-entry random gossip cache (CACHE_MAX), no match ranking, no ~200 best set.
2. Presence = fixed 20 s heartbeat ping flooded to everyone (ttl 6), carrying the FULL signed profile; no stagger, no adaptive interval, no piggyback.
3. No soft-tag packet: bdisc.js had a 16-dim quantized vector but only for one-off queries; discovery shipped full profiles.
4. No clumps / tentacles: nothing searched for better matches or evicted the weakest.
5. Swipe left = session-only `passed` set (app-mesh.js); peer not cut, could re-enter; no slot refill beyond re-running one discovery query.
6. Search: bdisc TTL-3 dot-product flood, mode only; no age group / gender (dating) / gaming / per-mode min %; no hop latency; no per-hop band check of the originator.
7. Tap-to-open had no "Loading their profile..." + online check; full profile already sat in memory from pings.
8. Constraints were spread out: ConnCap and Shield existed but weren't applied to discovery; no battery/data awareness anywhere.
9. Mesh-join buttons: present in Advanced settings — LEFT AS IS (§7).

## After
1-6, 8: built in src/livemesh.js (LiveNode), wired in app-mesh.js over E2E 'lm' envelopes. 7: discover-view.js loadingProfile(), used by Discover → "View profile" and the swipe card tap.
Still open: the legacy 20 s ping still carries the full signed profile (mesh.js view()/friends/Inbox depend on it), so the
"full profile only on tap" rule holds for the living mesh but not yet for the old ping path. See "Open questions".

## Tests
- scripts/sim-livemesh.mjs 300 1000 — convergence, bucket <= 200, zero cross-band edges, packet sizes, load, search hops, tap-to-open, swipe, ban, forged packet, power.
- scripts/e2e-livemesh.mjs — 4 real Chrome tabs.
Both are in scripts/regress.sh.

## v38 (2026-10-27): broadcast discovery + cheap shield on the live receive path
- Receive order in app-mesh.js bus.on: relevance (packets for other phones ignored) -> RxGate (shape, per-kind size cap,
  per-sender budget with strikes, separate game budget, shared stranger budget, anonymous budgets) -> existing ban/block checks
  -> e2e.open (signature BEFORE decrypt) -> MeshNode / LiveNode gates. Strikes are logged only (the claimed sender is unverified
  at that point, so nobody is muted or reported automatically).
- Discover (setDiscovery) now sends an anonymous bdisc query {mode, coarse 16-dim vector, age band, one-time reply token} as a
  bare bus packet (no envelope, no sender ID). Same-band peers with that mode answer after a random 0-1.5 s offset with their
  SIGNED SOFT-TAG packet sealed to the token; only the searcher can open it and LiveNode.consider() re-checks it. The full
  profile still only moves on tap. The legacy 'disc' query (sender ID + full-profile answer) is retired; older clients get no answer.
- On the shared broadcast channel every phone hears a query directly, so bdisc TTL forwarding is not re-posted (dedupe by id).
