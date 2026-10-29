// TRON light-cycles (analog): free steering with a max turn rate, float positions, a BOUNDED arena (hitting the edge kills).
// Leaving your land lays a continuous ribbon trail (a polyline, one vertex per tick). Re-entering your land closes the loop:
// the polygon [trail..., re-entry point] is CLAIMED (true polygon fill, later claims sit on top). Ownership is also kept as
// a per-cell raster (w.land, cell centres point-in-polygon) so tiles/map chunks keep their authority + cheap ownerAt/score.
// Crossing ANY trail segment (segment-vs-segment intersection, spatial-hashed) cuts it: the trail's owner dies (your own:
// you die). Heads meeting: both die. Death clears your land + polygons. Round resets at WIN_SHARE of the map or ROUND_TICKS.
import { steer, hkey, segHit, pointInPoly, bboxOf, circlePoly, polyArea, angNorm, TAU } from './analog.js';
export const WIN_SHARE = 0.5, ROUND_TICKS = 9000, SPEED = 0.4, TURN = 0.12, HOME_R = 2.4, TICK = 40;
export const tron = {
  name: 'tron', analog: true, minSide: 3, wraps: false, tickMs: TICK, cutAhead: true,
  init(w) { if (!w.land || w.land.length !== w.size * w.size) { const old = w.land, os = old ? Math.round(Math.sqrt(old.length)) : 0; w.land = new Array(w.size * w.size).fill(null); if (old) for (let y = 0; y < os; y++) for (let x = 0; x < os; x++) w.land[y * w.size + x] = old[y * os + x]; }
    w.polys ||= []; w.segH ||= new Map(); w.polySeq ||= 0; },
  onGrow(w) { this.init(w); },
  own(w, x, y) { const n = w.size; if (x < 0 || y < 0 || x >= n || y >= n) return undefined; return w.land[Math.floor(y) * n + Math.floor(x)]; },
  spawn(w, p) { this.init(w); this.clear(w, p); const n = w.size, m = HOME_R + 2; p.x = Math.min(n - m, Math.max(m, p.x + 0.5)); p.y = Math.min(n - m, Math.max(m, p.y + 0.5));
    p.h = Math.atan2(n / 2 - p.y, n / 2 - p.x); p.aim = p.h; p.turnIn = 0; p.px = p.x; p.py = p.y; p.trail = []; p.exit = null; p.home = [p.x, p.y]; this.fill(w, p, circlePoly(p.x, p.y, HOME_R), true); },
  despawn(w, p) { this.clear(w, p); },
  clear(w, p) { if (!w.land) return; for (let i = 0; i < w.land.length; i++) if (w.land[i] === p.code) w.land[i] = null; w.polys = (w.polys || []).filter(g => g.o !== p.code); this.dropTrail(w, p); p.score = 0; },
  dropTrail(w, p) { for (const [k, list] of w.segH) { const f = list.filter(e => e[0] !== p); if (f.length) w.segH.set(k, f); else w.segH.delete(k); } p.trail = []; p.exit = null; },
  // raster + polygon claim. Returns cells gained.
  fill(w, p, pts, home = false) { const n = w.size, [x0, y0, x1, y1] = bboxOf(pts); let gained = 0;
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(n - 1, Math.floor(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(n - 1, Math.floor(x1)); x++) { const c = y * n + x; if (w.land[c] === p.code) continue;
      if (pointInPoly(x + 0.5, y + 0.5, pts)) { const prev = w.land[c], o = prev && w.players.get(prev); if (o) o.score--; w.land[c] = p.code; gained++; } }
    p.score += gained; w.polys.push({ o: p.code, pts, id: ++w.polySeq, home, area: polyArea(pts) }); if (w.polys.length > 1500) w.polys.splice(0, w.polys.length - 1500); return gained; },
  addSeg(w, p) { const t = p.trail, i = t.length - 1; if (i < 1) return; const [ax, ay] = t[i - 1], [bx, by] = t[i];
    for (const k of new Set([hkey(ax, ay), hkey(bx, by)])) { let b = w.segH.get(k); if (!b) w.segH.set(k, b = []); b.push([p, i]); } },
  // first trail segment the move a->b crosses: [owner, index] (own most-recent 2 segments ignored)
  crossed(w, p, ax, ay, bx, by) { const fx = Math.floor(bx), fy = Math.floor(by); let hit = null;
    for (let oy = -1; oy <= 1 && !hit; oy++) for (let ox = -1; ox <= 1 && !hit; ox++) for (const [q, i] of w.segH.get(hkey(fx + ox, fy + oy)) || []) { const t = q.trail; if (!t[i] || !t[i - 1]) continue; if (q === p && i >= t.length - 2) continue;
      if (segHit(ax, ay, bx, by, t[i - 1][0], t[i - 1][1], t[i][0], t[i][1])) { hit = [q, i]; break; } } return hit; },
  botAim(w, p, r) { const n = w.size, b = p.persona || {}; const lim = 8 + Math.floor((b.skill ?? .5) * 18);
    if (p.trail.length > lim || (p.trail.length > 6 && r() < 0.01)) { // head home: nearest own cell sampled on a coarse ring
      let best = null, bd = 1e9; for (let dy = -14; dy <= 14; dy += 2) for (let dx = -14; dx <= 14; dx += 2) { if (this.own(w, p.x + dx, p.y + dy) === p.code) { const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = [dx, dy]; } } }
      if (best) return Math.atan2(best[1], best[0]); if (p.home) return Math.atan2(p.home[1] - p.y, p.home[0] - p.x); }
    // out on a loop: lean into a steady curve (big loops claim more), drift toward the centre
    const toC = Math.atan2(n / 2 - p.y, n / 2 - p.x); return p.trail.length ? p.h + (p.hue & 1 ? 0.35 : -0.35) : angNorm(toC + (r() - 0.5) * 2); },
  escape(w, p) { const n = w.size, bad = (a, d) => { const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d; if (x < 0.6 || y < 0.6 || x > n - 0.6 || y > n - 0.6) return true; return !!this.crossed(w, p, p.x, p.y, x, y); };
    if (!bad(p.h, 1.2) && !bad(p.h, 2.6)) return null; for (const d of [0.7, -0.7, 1.4, -1.4, 2.2, -2.2]) { const a = p.h + ((p.hue & 1) ? -d : d); if (!bad(a, 2)) return a; } return p.h + Math.PI / 2; },
  safe() { return true; },
  step(w) { this.init(w); const n = w.size; const live = [...w.players.values()].filter(p => p.alive).sort((a, b) => a.code < b.code ? -1 : 1);
    const mv = []; for (const p of live) { p.px = p.x; p.py = p.y; steer(p, TURN); p.x += Math.cos(p.h) * SPEED; p.y += Math.sin(p.h) * SPEED; mv.push(p); }
    for (let a = 0; a < mv.length; a++) for (let b = a + 1; b < mv.length; b++) { const p = mv[a], q = mv[b]; const dx = p.x - q.x, dy = p.y - q.y; if (dx * dx + dy * dy < 0.36) { w.kill(p, q); w.kill(q, p); } }
    for (const p of mv) { if (!p.alive) continue;
      if (p.x < 0 || p.y < 0 || p.x >= n || p.y >= n) { p.x = Math.min(n - 0.01, Math.max(0, p.x)); p.y = Math.min(n - 0.01, Math.max(0, p.y)); w.kill(p, null); continue; }
      const hit = this.crossed(w, p, p.px, p.py, p.x, p.y); if (hit) { const [q] = hit; if (q === p) { w.kill(p, null); continue; } if (q.alive) { w.kill(q, p, p.x, p.y); w.events.push({ t: 'cut', who: p.code, victim: q.code, x: p.x, y: p.y, tick: w.tick }); } }
      const mine = this.own(w, p.x, p.y) === p.code;
      if (!mine) { if (!p.trail.length) { p.exit = [p.px, p.py]; p.trail.push([p.px, p.py]); } p.trail.push([p.x, p.y]); this.addSeg(w, p); }
      else if (p.trail.length) this.claim(w, p); }
    for (const p of live) if (!p.alive) this.clear(w, p);
    this.checkWin(w); },
  claim(w, p) { const pts = [...p.trail, [p.x, p.y]]; this.dropTrail(w, p); if (pts.length < 3) return; const gained = this.fill(w, p, pts);
    w.events.push({ t: 'claim', who: p.code, n: gained, x: p.x, y: p.y, tile: w.tileAt(p.x, p.y), authority: w.ownerAt(p.x, p.y), tick: w.tick }); },
  checkWin(w) { const top = [...w.players.values()].reduce((a, b) => (b.score > (a?.score || 0) ? b : a), null);
    if ((top && top.score >= w.land.length * WIN_SHARE) || (w.tick % ROUND_TICKS === 0)) { w.events.push({ t: 'reset', winner: top?.code || null, tick: w.tick }); w.land.fill(null); w.polys = []; w.segH.clear();
      for (const p of w.players.values()) { p.alive = true; p.score = 0; const [x, y] = w.spawnPoint(p); p.x = x; p.y = y; this.spawn(w, p); } } },
  cells(p) { return [...(p.trail || []), [p.x, p.y]]; },
};
