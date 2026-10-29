// Ultimate Tic-tac-toe (1v1). 9 small boards; your move's cell index picks the board the opponent must play in (if that
// board is won or full they may play anywhere). Win a small board with 3-in-a-row; win the game with 3 small boards in a row.
const L = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
export const win3 = a => { for (const [x, y, z] of L) if (a[x] != null && a[x] !== 'D' && a[x] === a[y] && a[y] === a[z]) return a[x]; return null; };
export function init() { return { c: Array(81).fill(null), big: Array(9).fill(null), force: -1, seat: 0 }; }
const open = (st, B) => st.big[B] == null;
export function moves(st) { const bs = st.force >= 0 && open(st, st.force) ? [st.force] : [...Array(9).keys()].filter(B => open(st, B)); const out = []; for (const B of bs) for (let k = 0; k < 9; k++) if (st.c[B * 9 + k] == null) out.push({ b: B, k }); return out; }
export const legal = (st, m, seat) => (seat !== st.seat || !m) ? null : moves(st).find(a => a.b === m.b && a.k === m.k) || null;
export function apply(st, m) { const c = st.c.slice(), big = st.big.slice(); c[m.b * 9 + m.k] = st.seat; const sm = c.slice(m.b * 9, m.b * 9 + 9); const w = win3(sm); if (w != null) big[m.b] = w; else if (sm.every(x => x != null)) big[m.b] = 'D'; return { c, big, force: m.k, seat: 1 - st.seat }; }
export function result(st) { const w = win3(st.big); if (w != null) return { winner: w, how: 'three boards' }; return moves(st).length ? null : { draw: true, how: 'no moves' }; }
export function ai(st, seat, rng) { const ms = moves(st); for (const m of ms) { const n = apply(st, m); if (n.big[m.b] === seat) return m; } return ms[Math.floor(rng() * ms.length)]; }
export const turnSeat = st => st.seat;
export const meta = { id: 'uttt', name: 'Ultimate Tic-tac-toe', modes: ['1v1'], kind: 'turn', focus: true };
