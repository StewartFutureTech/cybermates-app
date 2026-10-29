// Tron Duel (1v1/2v2/4v4) and Snake Battle (2v2/4v4): team rounds on a SMALL fixed arena using the shared engine
// (src/arcade/engine.js lockstep tick + per-tile authority). No respawn within a round: last team with a living player
// wins the round; best of 3. Friendly trails/bodies still kill (no friendly-fire exemption — keeps rules simple & fair).
import { World } from '../engine.js';
import { tron } from '../tron.js';
import { snake } from '../snake.js';
export const ARENA_TILES = { '1v1': 2, '2v2': 3, '4v4': 4 }, BEST_OF = 3;
export function makeArena(kind, mode, seats, seed = 1) { const w = new World({ seed, game: kind === 'tron' ? tron : snake, id: `${kind}-duel` }); w.side = ARENA_TILES[mode] || 3; w.fixed = true; w.noFill = true; w.respawn = null; w.cap = seats.length;
  w.layout = () => { const hs = seats.filter(s => !s.ai).map(s => s.code).sort(); w.tileOwners = Array.from({ length: w.side * w.side }, (_, i) => hs[i % Math.max(1, hs.length)] || 'local'); return false; }; w.layout(); w.game.onGrow?.(w);
  seats.forEach((s, i) => { const p = w.add(s.code, { bot: !!s.ai, name: s.name }); p.team = s.team; const ang = (i / seats.length) * Math.PI * 2, r = w.size * 0.33; p.x = Math.round(w.size / 2 + Math.cos(ang) * r); p.y = Math.round(w.size / 2 + Math.sin(ang) * r); w.game.spawn(w, p); });
  w.rounds = [0, 0]; return w; }
export function roundResult(w) { const alive = new Set([...w.players.values()].filter(p => p.alive).map(p => p.team)); if (alive.size > 1) return null; const t = alive.size ? [...alive][0] : null; return { winner: t, draw: t == null }; }
export const metaTron = { id: 'tronduel', name: 'Tron Duel', modes: ['1v1', '2v2', '4v4'], kind: 'realtime' };
export const metaSnake = { id: 'snakebattle', name: 'Snake Battle', modes: ['2v2', '4v4'], kind: 'realtime' };
