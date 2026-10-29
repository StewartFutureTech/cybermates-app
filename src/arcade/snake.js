// SNAKE (analog): free steering with a max turn rate (true circles), continuous float positions on a wrapping (torus) map.
// The body is the head's recent path, sampled once per tick (p.body[0] = head). Eat glowing nodes (food) to grow; run your
// head into another snake's BODY to bite it off from that point (you grow by what you bite, it is cut short); heads
// meeting (closer than HEAD_R*2) kills both; your head touching your own body (past the neck) kills you. Dead snakes burst
// into food. Instant respawn; the round resets after ROUND_TICKS. Collision uses a spatial hash of body points (1-cell
// buckets), so 100 snakes stay cheap. Deterministic: no Math.random; everything from the World's seeded PRNG.
import { steer, wd, hkey, TAU } from './analog.js';
export const START_LEN = 14, FOOD_PER_TILE = 6, ROUND_TICKS = 6000, SPEED = 0.34, TURN = 0.13, HEAD_R = 0.42, BODY_R = 0.38, NECK = 12, GROW_FOOD = 3, TICK = 40;
export const snake = {
  name: 'snake', SPEED_: SPEED, analog: true, minSide: 3, wraps: true, tickMs: TICK,
  spawn(w, p) { const r = w.rng(p.code.length * 31 + w.tick); p.h = (r() * TAU) - Math.PI; p.aim = p.h; p.turnIn = 0; p.x += 0.5; p.y += 0.5;
    p.body = Array.from({ length: START_LEN }, (_, i) => [w.wrap(p.x - Math.cos(p.h) * SPEED * i), w.wrap(p.y - Math.sin(p.h) * SPEED * i)]); p.len = START_LEN; p.px = p.x; p.py = p.y; },
  despawn(w, p) { this.burst(w, p); p.body = []; },
  burst(w, p) { w.food ||= []; for (let i = 0; i < (p.body || []).length; i += 3) w.food.push([p.body[i][0], p.body[i][1], 1]); },
  onGrow(w) { this.seedFood(w); },
  seedFood(w) { w.food ||= []; const want = w.side * w.side * FOOD_PER_TILE, r = w.rng(77); let g = 0; while (w.food.length < want && g++ < want * 2) w.food.push([r() * w.size, r() * w.size, 0]); },
  // bot intent: nearest food within ~12 cells (wrapped), else keep heading with a lazy wander
  botAim(w, p, r) { let best = null, bd = 144; for (const f of w.food || []) { const dx = wd(f[0] - p.x, w.size), dy = wd(f[1] - p.y, w.size), d = dx * dx + dy * dy; if (d < bd) { bd = d; best = [dx, dy]; } }
    return best ? Math.atan2(best[1], best[0]) : p.h + (r() - 0.5) * 0.6; },
  // reflex: a body point 1-2.5 cells straight ahead -> swerve to the freer side
  escape(w, p) { const H = w.bodyHash; if (!H) return null; const probe = (a, d) => { const x = w.wrap(p.x + Math.cos(a) * d), y = w.wrap(p.y + Math.sin(a) * d); for (const [q, i] of H.get(hkey(x, y)) || []) if (q !== p || i > NECK) return true; return false; };
    if (!probe(p.h, 1.2) && !probe(p.h, 2.4)) return null; const l = probe(p.h - 0.9, 1.6), rr = probe(p.h + 0.9, 1.6); return p.h + (l && !rr ? 1.4 : -1.4); },
  step(w) { if (!w.food) this.seedFood(w); const n = w.size;
    const live = [...w.players.values()].filter(p => p.alive && p.body?.length).sort((a, b) => a.code < b.code ? -1 : 1);
    for (const p of live) { p.px = p.x; p.py = p.y; steer(p, TURN); const h = p.body[0], nx = w.wrap(h[0] + Math.cos(p.h) * SPEED), ny = w.wrap(h[1] + Math.sin(p.h) * SPEED);
      p.body.unshift([nx, ny]); if (p.body.length > p.len) p.body.length = p.len; p.x = nx; p.y = ny; }
    // spatial hash of body points (skip heads)
    const H = new Map(); for (const p of live) for (let i = 1; i < p.body.length; i++) { const k = hkey(p.body[i][0], p.body[i][1]); let b = H.get(k); if (!b) H.set(k, b = []); b.push([p, i]); } w.bodyHash = H;
    const near = (x, y, R, fn) => { const fx = Math.floor(x), fy = Math.floor(y); for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) for (const e of H.get(hkey(((fx + ox) % n + n) % n, ((fy + oy) % n + n) % n)) || []) { const [q, i] = e, pt = q.body[i]; if (!pt) continue; const dx = wd(pt[0] - x, n), dy = wd(pt[1] - y, n); if (dx * dx + dy * dy < R * R && fn(q, i)) return true; } return false; };
    // head-on
    for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) { const p = live[a], q = live[b]; if (!p.alive || !q.alive) continue; const dx = wd(p.x - q.x, n), dy = wd(p.y - q.y, n); if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && dx * dx + dy * dy < (HEAD_R * 2) ** 2) { w.kill(p, q); w.kill(q, p); } }
    for (const p of live) { if (!p.alive) continue;
      let bite = null; near(p.x, p.y, HEAD_R + BODY_R, (q, i) => { if (q === p) { if (i > NECK) { bite = [q, i]; return true; } return false; } if (q.alive && (!bite || i < bite[1])) bite = [q, i]; return false; });
      if (bite) { const [q, i] = bite; if (q === p) { w.kill(p, null); continue; } const eaten = q.body.length - i; q.body.length = i; q.len = Math.max(i, 1); p.len += eaten; p.score += Math.ceil(eaten / 3);
        w.events.push({ t: 'eat', who: p.code, from: q.code, n: eaten, x: p.x, y: p.y, tile: w.tileAt(p.x, p.y), authority: w.ownerAt(p.x, p.y), tick: w.tick }); if (q.body.length < 4) w.kill(q, p); }
      const f = w.food; for (let k = f.length - 1; k >= 0; k--) { const dx = wd(f[k][0] - p.x, n), dy = wd(f[k][1] - p.y, n); if (dx * dx + dy * dy < 0.7 * 0.7) { p.len += GROW_FOOD; p.score++; w.events.push({ t: 'food', who: p.code, x: f[k][0], y: f[k][1], tick: w.tick }); f.splice(k, 1); } } }
    for (const p of live) if (!p.alive) { this.burst(w, p); p.body = []; }
    if (w.tick % 25 === 0) this.seedFood(w); },
  checkReset(w) { if (w.tick % ROUND_TICKS) return; w.events.push({ t: 'reset', tick: w.tick }); for (const p of w.players.values()) { p.score = 0; p.alive = true; const [x, y] = w.spawnPoint(p); p.x = x; p.y = y; this.spawn(w, p); } w.food = null; this.seedFood(w); },
  cells(p) { return p.body || []; },
};
