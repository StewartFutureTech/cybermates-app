// FREE ANALOG STEERING shared by Snake + Tron (mass arena and duels). Continuous float positions (cell units), a heading
// p.h (radians, 0 = +x/right, +PI/2 = +y/down) and a MAX TURN RATE per tick, so a held turn traces a true circle of radius
// speed/turn. Input per player (lockstep, applied on its tick like every other input):
//   {a: radians}  touch/mouse: target heading; the head turns smoothly toward it (never faster than the max turn rate)
//   {t: -1|0|1}   keyboard fallback: rotate left / stop / right while held
//   'up'|'down'|'left'|'right'  legacy/compat: same as aiming at that compass direction
// Everything is deterministic (no Math.random; fixed float ops in a fixed order), so peers stay in lockstep.
export const TAU = Math.PI * 2;
export const COMPASS = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
export const angNorm = a => { a %= TAU; if (a > Math.PI) a -= TAU; else if (a < -Math.PI) a += TAU; return a; };
export const angDiff = (to, from) => angNorm(to - from);
export function applyInput(p, d) { if (typeof d === 'string') { if (d in COMPASS) { p.aim = COMPASS[d]; p.turnIn = 0; } return; }
  if (d && typeof d.a === 'number' && isFinite(d.a)) { p.aim = angNorm(d.a); p.turnIn = 0; } else if (d && (d.t === -1 || d.t === 0 || d.t === 1)) { p.turnIn = d.t; if (d.t) p.aim = null; } }
export const validInput = d => typeof d === 'string' ? d in COMPASS : !!d && ((typeof d.a === 'number' && isFinite(d.a)) || d.t === -1 || d.t === 0 || d.t === 1);
// one tick of steering: returns the heading change actually applied (|dh| <= maxTurn)
export function steer(p, maxTurn) { let dh = 0; if (p.turnIn) dh = p.turnIn * maxTurn; else if (p.aim != null) { const d = angDiff(p.aim, p.h); dh = Math.max(-maxTurn, Math.min(maxTurn, d)); }
  p.h = angNorm(p.h + dh); return dh; }
export const dirName = h => { const a = angNorm(h); return Math.abs(a) <= Math.PI / 4 ? 'right' : Math.abs(a) >= 3 * Math.PI / 4 ? 'left' : a > 0 ? 'down' : 'up'; };
// wrapped delta on a torus of size n
export const wd = (d, n) => (d > n / 2 ? d - n : d < -n / 2 ? d + n : d);
// spatial hash: integer cell -> list (rebuilt or patched by the game); key packs x,y (|coords| < 2^15)
export const hkey = (x, y) => ((Math.floor(x) & 0xffff) << 16) | (Math.floor(y) & 0xffff);
// segment intersection (proper, excluding touching at endpoints within eps)
export function segHit(ax, ay, bx, by, cx, cy, dx, dy) { const r1 = bx - ax, r2 = by - ay, s1 = dx - cx, s2 = dy - cy, den = r1 * s2 - r2 * s1; if (Math.abs(den) < 1e-9) return false;
  const t = ((cx - ax) * s2 - (cy - ay) * s1) / den, u = ((cx - ax) * r2 - (cy - ay) * r1) / den; return t > 1e-6 && t <= 1 && u >= 0 && u <= 1; }
export function pointInPoly(x, y, pts) { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; }
export function polyArea(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return Math.abs(a / 2); }
export const bboxOf = pts => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; } return [x0, y0, x1, y1]; };
export const circlePoly = (cx, cy, r, n = 18) => Array.from({ length: n }, (_, i) => [cx + Math.cos(i / n * TAU) * r, cy + Math.sin(i / n * TAU) * r]);
