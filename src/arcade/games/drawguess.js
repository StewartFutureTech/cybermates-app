// Draw & Guess — MASS ARENA game (one room of up to 100 players, sub-maps via InstanceManager). CHAT REQUIRED: guesses
// ride the room's text chat, which cannot be turned off here (safety rules unchanged: adult/minor rooms are separate,
// minors' voice OFF by default, mute/block/report, bans). Each round 1 drawer (+1 per 25 players, max 4) rotates through
// the room; everyone else guesses. Points: correct guessers get max(2, 10 - rank) by order; each drawer +1 per correct
// guesser. Round ends when everyone guessed, the drawer skips, or the clock (ROUND_MS) runs out. Live leaderboard.
export const WORDS = ['rocket', 'cat', 'pizza', 'castle', 'robot', 'rainbow', 'guitar', 'dragon', 'volcano', 'snowman', 'bicycle', 'octopus', 'tree', 'moon', 'controller', 'headphones', 'shark', 'cupcake', 'lighthouse', 'spaceship'];
export const ROUND_MS = 75e3, MAX_DRAWERS = 4;
// AI stroke library: a few normalized strokes per word (drawn one stroke per AI turn, like a person sketching).
const C = (cx, cy, r, n = 14) => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos(i / n * 6.283) * r, cy + Math.sin(i / n * 6.283) * r]);
export const STROKES = { rocket: [[[.5, .15], [.62, .35], [.62, .72], [.38, .72], [.38, .35], [.5, .15]], [[.38, .62], [.28, .8], [.38, .72]], [[.62, .62], [.72, .8], [.62, .72]], C(.5, .45, .06)],
  cat: [C(.5, .55, .2), [[.34, .42], [.36, .25], [.45, .37]], [[.66, .42], [.64, .25], [.55, .37]], [[.42, .58], [.3, .55]], [[.58, .58], [.7, .55]]], pizza: [[[.2, .25], [.8, .25], [.5, .85], [.2, .25]], C(.45, .4, .04, 8), C(.58, .45, .04, 8)],
  castle: [[[.2, .8], [.2, .35], [.8, .35], [.8, .8], [.2, .8]], [[.2, .35], [.2, .25], [.3, .25], [.3, .35]], [[.7, .35], [.7, .25], [.8, .25], [.8, .35]], [[.45, .8], [.45, .62], [.55, .62], [.55, .8]]],
  robot: [[[.35, .2], [.65, .2], [.65, .45], [.35, .45], [.35, .2]], [[.3, .5], [.7, .5], [.7, .8], [.3, .8], [.3, .5]], C(.43, .32, .03, 6), C(.57, .32, .03, 6)], moon: [C(.5, .5, .25), C(.6, .42, .2)],
  tree: [[[.5, .85], [.5, .55]], [[.25, .6], [.5, .15], [.75, .6], [.25, .6]]], snowman: [C(.5, .7, .18), C(.5, .4, .12), C(.5, .2, .07)], rainbow: [C(.5, .7, .35, 10).slice(5), C(.5, .7, .28, 10).slice(5), C(.5, .7, .21, 10).slice(5)] };
const SIMILAR = { rocket: ['spaceship', 'pencil', 'tower'], cat: ['dog', 'fox', 'tiger'], pizza: ['cheese', 'taco', 'cake'], castle: ['house', 'tower', 'fort'], robot: ['computer', 'box', 'tv'], moon: ['banana', 'sun', 'cookie'], tree: ['bush', 'mountain', 'arrow'], snowman: ['balloons', 'eight', 'bear'], rainbow: ['bridge', 'smile', 'arch'] };
const clampS = s => s.map(p => p.map(v => +Math.min(1, Math.max(0, v)).toFixed(3)));
const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
export const drawerCount = n => Math.min(MAX_DRAWERS, 1 + Math.floor(n / 25));
export function init({ codes = [], seed = 1 } = {}) { return { codes: [...codes], round: 0, seed, strokes: [], score: Object.fromEntries(codes.map(c => [c, 0])), solved: [], log: [] }; }
export const drawers = st => { const n = st.codes.length, k = drawerCount(n); return Array.from({ length: Math.min(k, n) }, (_, i) => st.codes[(st.round * k + i) % n]); };
export const word = st => WORDS[(st.seed + st.round * 7) % WORDS.length];
export function join(st, code) { if (!st.codes.includes(code)) { st.codes.push(code); st.score[code] ??= 0; } return st; }
export function leave(st, code) { st.codes = st.codes.filter(c => c !== code); return st; }
export function legal(st, m, code) { if (!m || !st.codes.includes(code)) return null; const isD = drawers(st).includes(code);
  if (m.stroke) return isD && Array.isArray(m.stroke) && m.stroke.length <= 64 && m.stroke.every(p => Array.isArray(p) && p.length === 2 && p.every(v => v >= 0 && v <= 1)) ? { stroke: m.stroke } : null;
  if (m.guess != null) return !isD && !st.solved.includes(code) && typeof m.guess === 'string' && m.guess.length <= 40 ? { guess: m.guess } : null;
  if (m.next) return isD ? { next: 1 } : null; return null; }
const nextRound = st => ({ ...st, round: st.round + 1, strokes: [], solved: [] });
export function apply(st, m, code) { if (m.stroke) return { ...st, strokes: [...st.strokes, m.stroke] }; if (m.next) return nextRound(st);
  const ok = norm(m.guess) === norm(word(st)), log = [...st.log, { code, text: ok ? '✔ guessed it!' : m.guess }].slice(-40); // the word itself is never echoed to chat
  if (!ok) return { ...st, log }; const score = { ...st.score }, rank = st.solved.length; score[code] = (score[code] || 0) + Math.max(2, 10 - rank); for (const d of drawers(st)) score[d] = (score[d] || 0) + 1;
  const n = { ...st, score, log, solved: [...st.solved, code] }; return n.solved.length >= st.codes.length - drawers(st).length ? nextRound(n) : n; }
export const timeout = nextRound;
export const leaderboard = st => Object.entries(st.score).filter(([c]) => st.codes.includes(c)).sort((a, b) => b[1] - a[1]).map(([code, pts], i) => ({ rank: i + 1, code, pts }));
export function ai(st, code, rng, skill = 0.6) { const w = word(st);
  if (drawers(st).includes(code)) { const lib = STROKES[w] || [C(.5, .5, .25), [[.3, .5], [.7, .5]]]; const k = st.strokes.length; if (k >= lib.length) return null; const j = (1 - skill) * 0.04; return { stroke: clampS(lib[k].map(([x, y]) => [x + (rng() - .5) * j, y + (rng() - .5) * j])) }; } // wobbly, human-ish
  if (st.solved.includes(code) || rng() > 0.06 || !st.strokes.length) return null; const p = Math.min(0.9, skill * st.strokes.length / 4); // more strokes -> better odds
  return { guess: rng() < p ? w : (SIMILAR[w] || WORDS)[Math.floor(rng() * (SIMILAR[w] || WORDS).length)] }; } // plausible wrong guesses
// Room = Mass Arena sub-map shape (same interface InstanceManager expects: players, humans(), bots(), add, remove, fillBots, links).
export class DrawRoom {
  constructor({ id = 'drawguess-1', seed = 1 } = {}) { this.id = id; this.seed = seed; this.players = new Map(); this.links = []; this.botN = 0; this.state = init({ seed }); }
  humans() { return [...this.players.values()].filter(p => !p.bot); } bots() { return [...this.players.values()].filter(p => p.bot); }
  add(code, o = {}) { if (this.players.has(code)) return this.players.get(code); const p = { code, name: o.name || code, bot: !!o.bot, minor: !!o.minor, adult: !o.minor }; this.players.set(code, p); join(this.state, code); if (!p.bot) this.fillBots(); return p; }
  remove(code) { const p = this.players.get(code); if (!p) return; this.players.delete(code); leave(this.state, code); if (!p.bot) this.fillBots(); }
  fillBots(minPop = 6) { const want = Math.max(0, Math.min(minPop - this.humans().length, (this.cap ?? Infinity) - this.humans().length)); while (this.bots().length > want) this.remove(this.bots().pop().code); while (this.bots().length < want) this.add('BOT-' + (++this.botN), { bot: true, name: 'bot ' + this.botN }); return this.bots().length; }
  move(code, m) { const v = legal(this.state, m, code); if (!v) return false; this.state = apply(this.state, v, code); return true; }
  step(rng, now = Date.now()) { if (this.roundAt == null || this.state.round !== this.lastRound) { this.roundAt = now; this.lastRound = this.state.round; } if (now - this.roundAt > ROUND_MS) this.state = timeout(this.state); for (const p of this.bots()) { const m = ai(this.state, p.code, rng); if (m) this.move(p.code, m); } return []; }
}
export const meta = { id: 'drawguess', name: 'Draw & Guess', modes: ['mass'], kind: 'mass', chatRequired: true };
