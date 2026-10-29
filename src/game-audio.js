// PER-GAME SOUND DESIGN: maps each game's state changes / events to distinct procedural effects (sfx.js LIB).
// Every game has its own voice (pitch profile + event→sound table), e.g. chess = low wooden set-down, checkers = lighter
// clack, Connect Four = falling disc + clunk, UTTT = glass ting, Star Fleet = sonar ping / torpedo / explosion / splash,
// Trivia = chimes, Air Hockey = puck + wall + goal, duels = kill/die/respawn, Brawl = punch/teleport/beam/KO,
// Draw & Guess = scribble + correct/wrong, Bingo = daub. Pure watchers: no game/network logic is touched.
import { sfx } from './sfx.js';
export const PITCH = { chess: 0.8, checkers: 1.25, connect4: 1, uttt: 1.15, battleship: 1, trivia: 1, pong: 1, tronduel: 0.9, snakebattle: 1.2, snake: 1.1, tron: 0.85, megaship: 1, brawl: 1, drawguess: 1, bingo: 1, ttt: 1.35 };
const play = (g, n, o = {}) => sfx(n, { pitch: (PITCH[g] || 1) * (o.p || 1), gain: o.v || 1 });
const later = (ms, f) => setTimeout(f, ms);
const pieces = b => (b || []).filter(x => x).length;
// Match games (match-ui): call tick() each render; diffs the lockstep state.
export function matchWatcher(g, M, mySeat) {
  let prev = null;
  const snap = st => ({ n: M.log?.length || 0, over: !!M.over, pcs: pieces(st.b), big: (st.big || []).filter(x => x != null).length, hits: st.shots ? st.shots.flat().filter(x => x === 2).length : 0, miss: st.shots ? st.shots.flat().filter(x => x === 1).length : 0,
    q: st.q, score: st.score ? [...st.score] : null, ans: st.ans ? mySeat() in st.ans : false, ball: st.ball ? [Math.sign(st.ball.vx || 0), Math.sign(st.ball.vy || 0)] : null,
    alive: st.players ? new Map([...st.players.values()].map(p => [p.code, !!p.alive])) : null, round: M.round });
  return { tick() { const st = M.state; if (!st) return; const s = snap(st); const p = prev; prev = s; if (!p || s.round !== p.round) { if (p) play(g, 'go'); return; }
    const team = M.seats[mySeat()]?.team ?? 0;
    if (s.over && !p.over) { const o = M.over; later(120, () => play(g, o.draw ? 'tick' : o.winner === team ? 'win' : 'lose')); }
    if (s.n > p.n) { // a move landed
      if (g === 'chess' || g === 'checkers') { const cap = s.pcs < p.pcs; play(g, 'pickup'); later(90, () => play(g, 'slide')); later(300, () => play(g, cap ? 'capture' : 'move')); } // cm-v35: pickup -> slide -> place
      else if (g === 'connect4') play(g, 'drop');
      else if (g === 'uttt' || g === 'ttt') { play(g, 'place'); if (s.big > p.big) later(140, () => play(g, 'claim')); }
      else if (g === 'battleship') { play(g, 'torpedo'); if (s.hits > p.hits) later(380, () => play(g, 'explosion')); else if (s.miss > p.miss) later(380, () => play(g, 'splash')); }
      else if (g === 'trivia' && s.ans && !p.ans) play(g, 'tick'); }
    if (g === 'trivia' && s.q !== p.q) { const mine = s.score?.[team] > (p.score?.[team] ?? 0); if (p.ans) play(g, mine ? 'correct' : 'wrong'); if (s.q < 10) later(500, () => play(g, 'ping', { p: 1.4 })); }
    if (g === 'pong' && s.score && p.score) { if (s.score[0] + s.score[1] > p.score[0] + p.score[1]) play(g, 'goal'); else if (s.ball && p.ball) { if (s.ball[0] !== p.ball[0]) { play(g, 'paddle'); play(g, 'puck', { v: .6 }); } else if (s.ball[1] !== p.ball[1]) play(g, 'wall'); else if (s.ball[0] && performance.now() - (this.gl || 0) > 380) { this.gl = performance.now(); play(g, 'glide', { v: .7 }); } } } // cm-v35: paddle hit / wall bounce / puck glide
    if (s.alive && p.alive) for (const [c, a] of s.alive) { const was = p.alive.get(c); if (was && !a) play(g, c === M.seats[mySeat()]?.code ? 'die' : 'kill'); else if (was === false && a && c === M.seats[mySeat()]?.code) play(g, 'respawn'); } } };
}
// Mass games (arcade-ui): events from World.step()
export function massEvents(g, evs, me, W) {
  for (const e of evs || []) { const mine = e.who === me;
    if (e.t === 'kill') { if (e.victim === me || (mine && !e.victim)) play(g, g === 'megaship' ? 'explosion' : 'die'); else if (e.by === me) play(g, g === 'megaship' ? 'explosion' : 'kill', { v: 0.8 }); }
    else if (e.t === 'respawn' && mine) play(g, 'respawn');
    else if (e.t === 'food' && mine) play(g, 'eat', { v: 0.6 });
    else if (e.t === 'eat' && mine) play(g, 'capture');
    else if (e.t === 'claim' && mine) play(g, 'claim');
    else if (e.t === 'cut' && mine) play(g, 'capture', { p: 0.8 });
    else if (e.t === 'boost' && mine) play(g, 'boost');
    else if (e.t === 'hit') { if (e.victim === me) play(g, 'hit'); else play(g, 'explosion', { v: 0.35, p: 1.6 }); }
    else if (e.t === 'reset') play(g, 'go'); }
  if (g === 'drawguess' && W?.state) dgTick(W.state, me);
}
let dgPrev = null;
function dgTick(st, me) { const L = st.log?.length || 0, S = st.strokes?.length || 0, R = st.round ?? st.word ?? null; const p = dgPrev; dgPrev = { L, S, R }; if (!p) return;
  if (R !== p.R) { play('drawguess', 'go'); return; }
  if (S > p.S) play('drawguess', 'scribble');
  if (L > p.L) for (const l of st.log.slice(p.L - L)) { if (/guessed it/.test(l.text)) play('drawguess', l.code === me ? 'correct' : 'place', { v: l.code === me ? 1 : 0.5 }); else if (l.code === me) play('drawguess', 'wrong', { v: 0.6 }); } }
export const shotFired = g => play(g, g === 'megaship' ? 'laser' : 'torpedo');
// Brawl
export function brawlEvent(e, mySeat = 0) { if (e.k === 'ko') play('brawl', e.vic === mySeat ? 'ko' : 'explosion', { v: e.att === mySeat || e.vic === mySeat ? 1 : 0.4 }); else if (e.k === 'hit') play('brawl', e.vic === mySeat ? 'hit' : 'punch', { v: e.att === mySeat || e.vic === mySeat ? 1 : 0.35 }); }
let brPrev = -1; export function brawlTick(st, mySeat = 0) { const f = st?.f?.[mySeat]?.fx; if (!f || f.t === brPrev) return; brPrev = f.t; play('brawl', { punch: 'punch', tp: 'teleport', beam: 'beam', ball: 'charge' }[f.k] || 'tick'); }
