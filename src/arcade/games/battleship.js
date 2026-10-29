// UI name: "Star Fleet" (space re-theme of Battleship).
// Battleship (1v1, 2v2 shared team boards), fleet [5,4,3,3,2] on a 10x10 grid. Cell index = r * N + c (row-major,
// r = row top->bottom, c = column left->right) everywhere: rules, 2D and 3D views, tests.
// HIDDEN FLEETS (v36): ship positions are NEVER in the shared/signed match state. Flow:
//  1. PLACEMENT: each team's keeper (its first human seat; an all-AI team uses its first seat) places ships locally
//     (drag / tap-to-rotate / random) and presses Ready, which publishes only a COMMITMENT = sha512(grid|salt) (hex, 64 chars).
//  2. FIRE: the shooter sends {cell}; the state now holds `pending`, and the DEFENDING keeper answers {hit, sunk?} from its
//     private grid (sunk = that ship's cells, revealed only once the ship is fully hit). Hit = shooter keeps the turn.
//  3. AUDIT: audit(st, team, grid, salt) re-checks the commitment and every answer, so a lying client is detectable when the
//     grid is revealed after the game. AI fleets derive from st.aiSeed (needed so every peer's AI answers identically).
import nacl from 'tweetnacl';
import { mulberry32 } from '../engine.js';
export const N = 10, SHIPS = [5, 4, 3, 3, 2], TOTAL = SHIPS.reduce((a, b) => a + b, 0);
export const team = seat => seat % 2;
// ---- placement helpers (ships = [{ len, r, c, h }], h = horizontal)
export const shipCells = s => Array.from({ length: s.len }, (_, k) => (s.r + (s.h ? 0 : k)) * N + s.c + (s.h ? k : 0));
export const inBounds = s => s.r >= 0 && s.c >= 0 && (s.h ? s.c + s.len <= N && s.r < N : s.r + s.len <= N && s.c < N);
export function canPlace(ships, i, s) { if (!inBounds(s)) return false; const taken = new Set(ships.flatMap((o, j) => (j === i ? [] : shipCells(o)))); return shipCells(s).every(x => !taken.has(x)); }
export function gridOf(ships) { const g = Array(N * N).fill(-1); for (const [id, s] of ships.entries()) for (const x of shipCells(s)) { if (g[x] >= 0) return null; g[x] = id; } return g; }
export const validShips = ships => Array.isArray(ships) && ships.length === SHIPS.length && ships.every((s, i) => s.len === SHIPS[i] && inBounds(s)) && !!gridOf(ships);
export function randomShips(rng = Math.random) { for (;;) { const out = []; let ok = true;
  for (const len of SHIPS) { let placed = false; for (let t = 0; t < 300 && !placed; t++) { const h = rng() < 0.5, s = { len, h, r: Math.floor(rng() * (h ? N : N - len + 1)), c: Math.floor(rng() * (h ? N - len + 1 : N)) }; if (canPlace(out, -1, s)) { out.push(s); placed = true; } } if (!placed) { ok = false; break; } }
  if (ok) return out; } }
export const place = rng => gridOf(randomShips(rng)); // legacy helper: random grid (ship ids by index)
// rotate around the ship's anchor; if it would leave the board, slide it back inside; null if there is no room
export function rotated(ships, i) { const s = ships[i]; for (let k = 0; k < s.len; k++) { const n = { ...s, h: !s.h, r: s.h ? s.r - k : s.r, c: s.h ? s.c : s.c - k }; if (canPlace(ships, i, n)) return n; } return null; }
export const shipAt = (ships, cell) => ships.findIndex(s => shipCells(s).includes(cell));
// ---- commitment
const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
export const commitOf = (grid, salt) => hex(nacl.hash(new TextEncoder().encode(grid.join(',') + '|' + salt)).slice(0, 32));
export const newSalt = () => hex(nacl.randomBytes(16));
export const aiGrid = (st, t) => gridOf(randomShips(mulberry32((st.aiSeed + t * 7919) >>> 0)));
const aiSalt = (st, t) => 'ai:' + st.aiSeed + ':' + t;
// answer a shot from a private grid: { hit, sunk? }
export function answer(grid, shotsOnMe, cell) { const id = grid[cell]; if (id < 0) return { hit: false }; const cells = grid.map((v, i) => (v === id ? i : -1)).filter(i => i >= 0);
  return cells.every(i => i === cell || shotsOnMe[i] === 2) ? { hit: true, sunk: cells } : { hit: true }; }
// ---- rules
export function init({ seats = 2, rng = Math.random, ai = null } = {}) {
  const keeper = [0, 1].map(t => { const mine = [...Array(seats).keys()].filter(i => i % 2 === t); return mine.find(i => !ai?.[i]) ?? mine[0]; });
  return { phase: 'place', commits: [null, null], shots: [Array(N * N).fill(0), Array(N * N).fill(0)], hits: [0, 0], sunk: [[], []], seat: 0, seats, keeper, aiSeed: Math.floor(rng() * 2 ** 31), pending: null }; } // shots[t] = shots ON team t's board: 1 miss, 2 hit
export function turnSeat(st) { if (result(st)) return null; if (st.phase === 'place') return st.keeper[st.commits[0] ? 1 : 0]; return st.pending ? st.keeper[1 - team(st.pending.by)] : st.seat; }
export function legal(st, m, seat) { if (seat !== turnSeat(st) || !m) return null;
  if (st.phase === 'place') return typeof m.commit === 'string' && /^[0-9a-f]{64}$/.test(m.commit) ? { commit: m.commit } : null;
  if (st.pending) { if (typeof m.hit !== 'boolean') return null; const t = 1 - team(st.pending.by), cell = st.pending.cell;
    if (m.sunk != null) { const s = m.sunk; if (!m.hit || !Array.isArray(s) || !SHIPS.includes(s.length) || !s.includes(cell) || !s.every(i => Number.isInteger(i) && i >= 0 && i < N * N && (i === cell || st.shots[t][i] === 2))) return null; return { hit: true, sunk: [...s].sort((a, b) => a - b) }; }
    return { hit: m.hit }; }
  if (!(Number.isInteger(m.cell) && m.cell >= 0 && m.cell < N * N)) return null; return st.shots[1 - team(seat)][m.cell] ? null : { cell: m.cell }; }
export function apply(st, m) {
  if ('commit' in m) { const commits = st.commits.slice(); commits[st.commits[0] ? 1 : 0] = m.commit; return { ...st, commits, phase: commits[0] && commits[1] ? 'fire' : 'place' }; }
  if ('cell' in m) return { ...st, pending: { cell: m.cell, by: st.seat } };
  const { cell, by } = st.pending, t = 1 - team(by), shots = st.shots.map(s => s.slice()), hits = st.hits.slice(), sunk = st.sunk.map(s => s.slice());
  shots[t][cell] = m.hit ? 2 : 1; if (m.hit) hits[t]++; if (m.sunk) sunk[t].push(m.sunk);
  return { ...st, shots, hits, sunk, pending: null, seat: m.hit ? by : (by + 1) % st.seats, lastHit: m.hit, last: { cell, t, hit: m.hit } }; }
export const sunk = (st, t, cells) => cells.every(i => st.shots[t][i] === 2);
export function result(st) { for (const t of [0, 1]) if (st.hits[t] >= TOTAL) return { winner: 1 - t, how: 'fleet sunk' }; return null; }
// audit a revealed grid against the commitment and every answer given for that board
export function audit(st, t, grid, salt) { if (commitOf(grid, salt) !== st.commits[t]) return { ok: false, reason: 'commitment' }; if (!validShips(shipsFromGrid(grid))) return { ok: false, reason: 'fleet' };
  for (let i = 0; i < N * N; i++) { if (st.shots[t][i] === 2 && grid[i] < 0) return { ok: false, reason: 'false hit', cell: i }; if (st.shots[t][i] === 1 && grid[i] >= 0) return { ok: false, reason: 'false miss', cell: i }; } return { ok: true }; }
export function shipsFromGrid(g) { return SHIPS.map((len, id) => { const cs = g.map((v, i) => (v === id ? i : -1)).filter(i => i >= 0); if (cs.length !== len) return { len, r: -9, c: -9, h: true }; const h = cs.length < 2 || cs[1] - cs[0] === 1; return { len, h, r: Math.floor(cs[0] / N), c: cs[0] % N }; }); }
// AI: placement commit / honest answers from its derived grid / hunt-and-target firing (knows only hits, misses, sunk)
export function ai(st, seat, rng) { const tm = team(seat);
  if (st.phase === 'place') return { commit: commitOf(aiGrid(st, tm), aiSalt(st, tm)) };
  if (st.pending) { const t = 1 - team(st.pending.by); return answer(aiGrid(st, t), st.shots[t], st.pending.cell); }
  const t = 1 - tm, sh = st.shots[t], done = new Set(st.sunk[t].flat()), open = [...sh.keys()].filter(i => !sh[i]);
  const live = i => sh[i] === 2 && !done.has(i), nb = i => [i - N, i + N, i % N ? i - 1 : -1, i % N < N - 1 ? i + 1 : -1].filter(j => j >= 0 && j < N * N);
  const line = open.filter(i => { const r = Math.floor(i / N), c = i % N; return [[0, 1], [1, 0]].some(([dr, dc]) => [1, -1].some(sg => { const a = (r + dr * sg), b = (c + dc * sg), a2 = r + 2 * dr * sg, b2 = c + 2 * dc * sg; return a >= 0 && a < N && b >= 0 && b < N && a2 >= 0 && a2 < N && b2 >= 0 && b2 < N && live(a * N + b) && live(a2 * N + b2); })); });
  const hunt = line.length ? line : open.filter(i => nb(i).some(live));
  const pool = hunt.length ? hunt : open.filter(i => (Math.floor(i / N) + i) % 2 === 0); const p = pool.length ? pool : open; return { cell: p[Math.floor(rng() * p.length)] }; }
export const meta = { id: 'battleship', name: 'Star Fleet', modes: ['1v1', '2v2'], kind: 'turn', focus: true };
