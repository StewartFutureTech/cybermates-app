// Connect Four (1v1, 2v2). 7 columns x 6 rows, gravity drop, four in a row (any direction) wins; full board = draw.
// 2v2: seats alternate between teams in order [A1, B1, A2, B2] — team = seat % 2, each seat takes a turn.
export const COLS = 7, ROWS = 6;
export function init({ seats = 2 } = {}) { return { g: Array(COLS * ROWS).fill(null), seat: 0, seats, last: -1 }; }
export const team = seat => seat % 2;
export function legal(st, m, seat) { if (seat !== st.seat || !m || !(m.col >= 0 && m.col < COLS)) return null; return st.g[m.col] == null ? { col: m.col } : null; }
export function apply(st, m) { const g = st.g.slice(); let r = ROWS - 1; while (g[r * COLS + m.col] != null) r--; g[r * COLS + m.col] = team(st.seat); return { ...st, g, seat: (st.seat + 1) % st.seats, last: r * COLS + m.col }; }
export function line(g, i) { const t = g[i]; if (t == null) return null; const r = Math.floor(i / COLS), c = i % COLS;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) { const cells = [i]; for (const s of [1, -1]) { let rr = r + dr * s, cc = c + dc * s; while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && g[rr * COLS + cc] === t) { cells.push(rr * COLS + cc); rr += dr * s; cc += dc * s; } } if (cells.length >= 4) return cells; } return null; }
export function result(st) { if (st.last >= 0) { const l = line(st.g, st.last); if (l) return { winner: st.g[st.last], line: l, how: 'four in a row' }; } return st.g.every(x => x != null) ? { draw: true, how: 'board full' } : null; }
export function ai(st, seat, rng) { const cols = [...Array(COLS).keys()].filter(c => st.g[c] == null); const me = team(seat);
  for (const want of [me, 1 - me]) for (const c of cols) { const n = apply({ ...st, seat: want === me ? seat : (seat + 1) % st.seats }, { col: c }); if (n.g[n.last] === want && line(n.g, n.last)) return { col: c }; } // win, else block
  const mid = cols.sort((a, b) => Math.abs(a - 3) - Math.abs(b - 3) + (rng() - 0.5) * 2); return { col: mid[0] }; }
export const turnSeat = st => st.seat;
export const meta = { id: 'connect4', name: 'Connect Four', modes: ['1v1', '2v2'], kind: 'turn', focus: true };
