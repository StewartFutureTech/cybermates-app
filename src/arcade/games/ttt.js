// Classic Tic-tac-toe (1v1). 3x3, X (seat 0) moves first; three in a row wins; full board = draw. Same module interface
// as the other match games (init/moves/legal/apply/result/ai/turnSeat/meta).
export const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export function init() { return { c: Array(9).fill(null), seat: 0 }; }
export const moves = st => st.c.map((v, k) => (v == null ? { k } : null)).filter(Boolean);
export const line = st => LINES.find(([a, b, c]) => st.c[a] != null && st.c[a] === st.c[b] && st.c[b] === st.c[c]) || null;
export const legal = (st, m, seat) => (seat !== st.seat || !m || line(st) || !(m.k >= 0 && m.k < 9) || st.c[m.k] != null) ? null : { k: m.k };
export function apply(st, m) { const c = st.c.slice(); c[m.k] = st.seat; return { c, seat: 1 - st.seat }; }
export function result(st) { const l = line(st); if (l) return { winner: st.c[l[0]], how: 'three in a row', line: l }; return st.c.every(v => v != null) ? { draw: true, how: 'board full' } : null; }
export function ai(st, seat, rng, skill = 0.7) { const ms = moves(st); if (!ms.length) return null;
  const wins = s => ms.find(m => { const c = st.c.slice(); c[m.k] = s; return LINES.some(([a, b, d]) => c[a] === s && c[b] === s && c[d] === s); });
  if (rng() < skill) { const w = wins(seat) || wins(1 - seat); if (w) return w; if (st.c[4] == null) return { k: 4 }; }
  return ms[Math.floor(rng() * ms.length)]; }
export const turnSeat = st => st.seat;
export const meta = { id: 'ttt', name: 'Tic-tac-toe', modes: ['1v1'], kind: 'turn', focus: true };
