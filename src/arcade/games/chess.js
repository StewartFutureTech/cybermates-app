// Chess (1v1). Full legal-move rules: check/king safety, castling, en passant, promotion (default queen), checkmate,
// stalemate, 50-move and insufficient-material draws. Seat 0 = white, seat 1 = black. Optional clock lives in match.js.
const W = c => c && c === c.toUpperCase(), sideOf = c => (c ? (W(c) ? 'w' : 'b') : null);
const N = [-17, -15, -10, -6, 6, 10, 15, 17], K8 = [-9, -8, -7, -1, 1, 7, 8, 9];
const rc = i => [i >> 3, i & 7], on = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
export function init() { const b = Array(64).fill(null), back = 'rnbqkbnr'; for (let c = 0; c < 8; c++) { b[c] = back[c]; b[8 + c] = 'p'; b[48 + c] = 'P'; b[56 + c] = back[c].toUpperCase(); } return { b, turn: 'w', castle: 'KQkq', ep: -1, half: 0, full: 1, hist: [] }; }
function attacked(b, sq, by) { const [r, c] = rc(sq);
  const pr = by === 'w' ? 1 : -1; for (const dc of [-1, 1]) { const rr = r + pr, cc = c + dc; if (on(rr, cc) && b[rr * 8 + cc] === (by === 'w' ? 'P' : 'p')) return true; }
  for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) { const rr = r + dr, cc = c + dc; if (on(rr, cc) && b[rr * 8 + cc] === (by === 'w' ? 'N' : 'n')) return true; }
  for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) { let rr = r + dr, cc = c + dc, d = 1;
    while (on(rr, cc)) { const p = b[rr * 8 + cc]; if (p) { if (sideOf(p) === by) { const t = p.toLowerCase(), diag = dr && dc; if (t === 'q' || (t === 'k' && d === 1) || (t === 'b' && diag) || (t === 'r' && !diag)) return true; } break; } rr += dr; cc += dc; d++; } }
  return false; }
const kingSq = (b, s) => b.indexOf(s === 'w' ? 'K' : 'k');
export const inCheck = (st, s = st.turn) => attacked(st.b, kingSq(st.b, s), s === 'w' ? 'b' : 'w');
function pseudo(st) { const { b, turn: s } = st, out = [], opp = s === 'w' ? 'b' : 'w';
  for (let i = 0; i < 64; i++) { const p = b[i]; if (!p || sideOf(p) !== s) continue; const t = p.toLowerCase(), [r, c] = rc(i);
    const add = (j, x = {}) => out.push({ f: i, t: j, ...x });
    if (t === 'p') { const dr = s === 'w' ? -1 : 1, start = s === 'w' ? 6 : 1, last = s === 'w' ? 0 : 7, f1 = (r + dr) * 8 + c;
      const push = (j, x = {}) => ((j >> 3) === last ? ['q', 'r', 'b', 'n'].forEach(pr => add(j, { ...x, promo: pr })) : add(j, x));
      if (on(r + dr, c) && !b[f1]) { push(f1); if (r === start && !b[f1 + dr * 8]) add(f1 + dr * 8, { dbl: 1 }); }
      for (const dc of [-1, 1]) { if (!on(r + dr, c + dc)) continue; const j = (r + dr) * 8 + c + dc; if (b[j] && sideOf(b[j]) === opp) push(j); else if (j === st.ep) add(j, { ep: 1 }); } }
    else if (t === 'n') { for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) { const rr = r + dr, cc = c + dc; if (on(rr, cc) && sideOf(b[rr * 8 + cc]) !== s) add(rr * 8 + cc); } }
    else { const dirs = t === 'b' ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] : t === 'r' ? [[-1, 0], [1, 0], [0, -1], [0, 1]] : [[-1, -1], [-1, 1], [1, -1], [1, 1], [-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) { let rr = r + dr, cc = c + dc; while (on(rr, cc)) { const q = b[rr * 8 + cc]; if (sideOf(q) === s) break; add(rr * 8 + cc); if (q || t === 'k') break; rr += dr; cc += dc; } }
      if (t === 'k') { const row = s === 'w' ? 56 : 0, ks = s === 'w' ? 'K' : 'k', qs = s === 'w' ? 'Q' : 'q';
        if (i === row + 4 && !attacked(b, i, opp)) { if (st.castle.includes(ks) && !b[row + 5] && !b[row + 6] && !attacked(b, row + 5, opp)) add(row + 6, { castle: 'k' });
          if (st.castle.includes(qs) && !b[row + 3] && !b[row + 2] && !b[row + 1] && !attacked(b, row + 3, opp)) add(row + 2, { castle: 'q' }); } } } }
  return out; }
export function apply(st, m) { const b = st.b.slice(), p = b[m.f], s = st.turn; let cap = b[m.t]; b[m.t] = m.promo ? (s === 'w' ? m.promo.toUpperCase() : m.promo) : p; b[m.f] = null;
  if (m.ep) { const j = m.t + (s === 'w' ? 8 : -8); cap = b[j]; b[j] = null; }
  if (m.castle) { const row = s === 'w' ? 56 : 0; if (m.castle === 'k') { b[row + 5] = b[row + 7]; b[row + 7] = null; } else { b[row + 3] = b[row]; b[row] = null; } }
  let castle = st.castle; const strip = ch => { castle = castle.replace(ch, ''); };
  if (p === 'K') { strip('K'); strip('Q'); } if (p === 'k') { strip('k'); strip('q'); }
  for (const [sq, ch] of [[63, 'K'], [56, 'Q'], [7, 'k'], [0, 'q']]) if (m.f === sq || m.t === sq) strip(ch);
  return { b, turn: s === 'w' ? 'b' : 'w', castle, ep: m.dbl ? (m.f + m.t) / 2 : -1, half: p.toLowerCase() === 'p' || cap ? 0 : st.half + 1, full: st.full + (s === 'b'), hist: st.hist }; }
export function moves(st) { return pseudo(st).filter(m => { const n = apply(st, m); return !attacked(n.b, kingSq(n.b, st.turn), n.turn); }); }
const same = (a, m) => a.f === m.f && a.t === m.t && (a.promo || null) === (m.promo || (a.promo ? 'q' : null));
export function legal(st, m, seat) { if (!m || seat !== (st.turn === 'w' ? 0 : 1)) return null; return moves(st).find(a => same(a, { ...m, promo: m.promo || (a.promo ? 'q' : undefined) })) || null; }
export function result(st) { const ms = moves(st); if (!ms.length) return inCheck(st) ? { winner: st.turn === 'w' ? 1 : 0, how: 'checkmate' } : { draw: true, how: 'stalemate' };
  if (st.half >= 100) return { draw: true, how: '50-move' }; const pcs = st.b.filter(Boolean).map(x => x.toLowerCase()).sort().join(''); if (['kk', 'bkk', 'kkn'].includes(pcs)) return { draw: true, how: 'insufficient material' }; return null; }
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export function ai(st, seat, rng) { const ms = moves(st); if (!ms.length) return null; let best = [], bv = -1e9; // 1-ply greedy + randomness ("club player")
  for (const m of ms) { const n = apply(st, m); let v = (st.b[m.t] ? VAL[st.b[m.t].toLowerCase()] : 0) + (m.promo ? 8 : 0) + rng() * 0.6; if (!moves(n).length && inCheck(n)) v += 100; if (attacked(n.b, m.t, n.turn)) v -= VAL[st.b[m.f].toLowerCase()] * 0.9; if (v > bv) { bv = v; best = [m]; } else if (v === bv) best.push(m); }
  return best[Math.floor(rng() * best.length)]; }
export function perft(st, d) { if (!d) return 1; let n = 0; for (const m of moves(st)) n += perft(apply(st, m), d - 1); return n; }
export const turnSeat = st => (st.turn === 'w' ? 0 : 1);
export const meta = { id: 'chess', name: 'Chess', modes: ['1v1'], kind: 'turn', focus: true, timer: true };
