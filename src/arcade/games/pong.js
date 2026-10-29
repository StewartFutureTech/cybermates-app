// Air Hockey / Pong (1v1, 2v2). Deterministic fixed-step physics (integer-ish, no RNG except the seeded serve), so the
// engine's lockstep input relay keeps peers identical. Input per seat: -1/0/+1 (up/stop/down). 2v2: two paddles per side
// (front + back line). First to WIN points. Ball speeds up on each paddle hit.
export const Wd = 160, Hd = 100, PH = 18, WIN = 7;
export function init({ seats = 2, rng = Math.random } = {}) { const pads = Array.from({ length: seats }, (_, s) => ({ team: s % 2, x: s % 2 === 0 ? (s < 2 ? 6 : 34) : (s < 2 ? Wd - 6 : Wd - 34), y: Hd / 2, in: 0 }));
  return { pads, ball: serve(rng() < 0.5 ? 1 : -1), score: [0, 0], tick: 0, seed: Math.floor(rng() * 1e6) }; }
const serve = dir => ({ x: Wd / 2, y: Hd / 2, vx: 1.6 * dir, vy: 0.8 });
export function input(st, seat, d) { if (st.pads[seat]) st.pads[seat].in = Math.max(-1, Math.min(1, d | 0)); }
export function step(st) { st.tick++; for (const p of st.pads) p.y = Math.max(PH / 2, Math.min(Hd - PH / 2, p.y + p.in * 2.2));
  const b = st.ball; b.x += b.vx; b.y += b.vy; if (b.y < 2 || b.y > Hd - 2) { b.vy = -b.vy; b.y = Math.max(2, Math.min(Hd - 2, b.y)); }
  for (const p of st.pads) if (Math.abs(b.x - p.x) < 2.5 && Math.abs(b.y - p.y) < PH / 2 + 1 && Math.sign(b.vx) === (p.team === 0 ? -1 : 1)) { b.vx = -b.vx * 1.06; b.vy += (b.y - p.y) * 0.12; b.vx = Math.max(-4.5, Math.min(4.5, b.vx)); }
  if (b.x < 0) { st.score[1]++; st.ball = serve(1); } else if (b.x > Wd) { st.score[0]++; st.ball = serve(-1); } return st; }
export function ai(st, seat, rng, skill = 0.7) { const p = st.pads[seat], b = st.ball, coming = Math.sign(b.vx) === (p.team === 0 ? -1 : 1); const target = coming ? b.y + (rng() - 0.5) * (1 - skill) * 40 : Hd / 2; return Math.abs(target - p.y) < 3 ? 0 : target > p.y ? 1 : -1; }
export function result(st) { for (const t of [0, 1]) if (st.score[t] >= WIN) return { winner: t, how: `${st.score[0]}-${st.score[1]}` }; return null; }
export const meta = { id: 'pong', name: 'Air Hockey', modes: ['1v1', '2v2'], kind: 'realtime' };
