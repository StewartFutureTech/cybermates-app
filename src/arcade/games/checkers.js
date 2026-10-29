// Checkers / English draughts (1v1). 8x8, men move diagonally forward, kings both ways; captures are MANDATORY and
// multi-jumps must be completed; reaching the far row crowns (and ends the move). Seat 0 = red 'r' (moves first, up), seat 1 = black 'b'.
// Win: opponent has no pieces or no legal move. Draw: 80 plies without a capture or crowning.
const on = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8, sideOf = p => p && p.toLowerCase();
export function init() { const b = Array(64).fill(null); for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2) { if (r < 3) b[r * 8 + c] = 'b'; if (r > 4) b[r * 8 + c] = 'r'; } return { b, turn: 'r', quiet: 0 }; }
const dirsOf = p => p === 'r' ? [[-1, -1], [-1, 1]] : p === 'b' ? [[1, -1], [1, 1]] : [[-1, -1], [-1, 1], [1, -1], [1, 1]];
function jumps(b, from, p, path = [from], caps = []) { const [r, c] = [from >> 3, from & 7], out = [];
  for (const [dr, dc] of dirsOf(p)) { const mr = r + dr, mc = c + dc, tr = r + 2 * dr, tc = c + 2 * dc; if (!on(tr, tc)) continue; const mid = mr * 8 + mc, to = tr * 8 + tc;
    if (b[mid] && sideOf(b[mid]) !== sideOf(p) && !b[to] && !caps.includes(mid)) { const crown = (p === 'r' && tr === 0) || (p === 'b' && tr === 7);
      const nb = b.slice(); nb[from] = null; nb[to] = p; const more = crown ? [] : jumps(nb, to, p, [...path, to], [...caps, mid]); if (more.length) out.push(...more); else out.push({ path: [...path, to], caps: [...caps, mid] }); } }
  return out; }
export function moves(st) { const { b, turn } = st, caps = [], steps = [];
  for (let i = 0; i < 64; i++) { const p = b[i]; if (sideOf(p) !== turn) continue; caps.push(...jumps(b, i, p)); const [r, c] = [i >> 3, i & 7];
    for (const [dr, dc] of dirsOf(p)) if (on(r + dr, c + dc) && !b[(r + dr) * 8 + c + dc]) steps.push({ path: [i, (r + dr) * 8 + c + dc], caps: [] }); }
  return caps.length ? caps : steps; }
export const legal = (st, m, seat) => (seat !== (st.turn === 'r' ? 0 : 1) || !m?.path) ? null : moves(st).find(a => a.path.join() === m.path.join()) || null;
export function apply(st, m) { const b = st.b.slice(), f = m.path[0], t = m.path[m.path.length - 1]; let p = b[f]; b[f] = null; for (const x of m.caps) b[x] = null;
  const crowned = (p === 'r' && t >> 3 === 0) || (p === 'b' && t >> 3 === 7); if (crowned) p = p.toUpperCase(); b[t] = p;
  return { b, turn: st.turn === 'r' ? 'b' : 'r', quiet: m.caps.length || crowned ? 0 : st.quiet + 1 }; }
export function result(st) { if (!moves(st).length) return { winner: st.turn === 'r' ? 1 : 0, how: st.b.some(p => sideOf(p) === st.turn) ? 'no moves' : 'all captured' }; if (st.quiet >= 80) return { draw: true, how: '80 quiet plies' }; return null; }
export function ai(st, seat, rng) { const ms = moves(st); if (!ms.length) return null; const top = Math.max(...ms.map(m => m.caps.length)); const c = ms.filter(m => m.caps.length === top); return c[Math.floor(rng() * c.length)]; }
export const turnSeat = st => (st.turn === 'r' ? 0 : 1);
export const meta = { id: 'checkers', name: 'Checkers', modes: ['1v1'], kind: 'turn', focus: true };
