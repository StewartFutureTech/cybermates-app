// ARCADE shared engine: tiled, growing world + deterministic lockstep tick + per-tile authority + bot fill.
// WORLD: square of TILE x TILE-cell tiles. Every joined human "brings" one tile; side = ceil(sqrt(max(humans, MIN_TILES))),
//   so the map grows as a bigger square as players join (1→2x2→3x3 …; 200 players = 15x15 tiles = 240x240 cells).
// TICK: fixed TICK_MS step, everything driven by a seeded PRNG (mulberry32(seed ^ tick)), so every peer that has the same
//   inputs computes the same state. INPUT RELAY: a turn is broadcast as {tick: now+INPUT_DELAY, code, dir}; all peers apply
//   it on that tick (late inputs are applied on arrival tick + logged as a desync risk).
// AUTHORITY: each tile has an owner (the human who brought it; bot-only tiles → lowest-code human, or local when alone).
//   Collision/kill events are tagged with the tile where they happen; only that tile's owner's verdict is final
//   (applyVerdict overrides local guesses). Tradeoffs: see README "Arcade networking tradeoffs".
import * as BOT from './bots.js';
import { applyInput, validInput } from './analog.js';
export const TILE = 16, MIN_TILES = 4, TICK_MS = 120, INPUT_DELAY = 2, MIN_POP = 8, RESPAWN_TICKS = 0; // instant respawn, no wait screen
export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
export function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const hashStr = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
export const sideFor = (humans, min = 0) => Math.max(min, Math.ceil(Math.sqrt(Math.max(humans, MIN_TILES))));
export class World {
  constructor({ seed = 1, game, id = 'inst-1' } = {}) { Object.assign(this, { seed, game, id }); this.players = new Map(); this.tick = 0; this.pending = []; this.events = []; this.tileOwners = []; this.side = sideFor(0, game?.minSide || 0); this.botN = 0; this.desync = 0; this.layout(); }
  get size() { return this.side * TILE; }
  humans() { return [...this.players.values()].filter(p => !p.bot); }
  bots() { return [...this.players.values()].filter(p => p.bot); }
  rng(salt = 0) { return mulberry32((this.seed ^ Math.imul(this.tick + 1, 2654435761) ^ salt) >>> 0); }
  layout() { // grow (never shrink mid-round, so nobody falls off the edge) and re-assign tile owners
    const s = Math.max(this.side, sideFor(this.humans().length, this.game?.minSide || 0)); const grew = s !== this.side; this.side = s;
    const hs = this.humans().map(p => p.code).sort(), host = hs[0] || 'local';
    this.tileOwners = Array.from({ length: s * s }, (_, i) => hs[i] || host); for (const [i, c] of hs.entries()) this.players.get(c).tile = i;
    if (grew) this.game?.onGrow?.(this); return grew; }
  tileAt(x, y) { return Math.floor(y / TILE) * this.side + Math.floor(x / TILE); }
  ownerAt(x, y) { return this.tileOwners[this.tileAt(x, y)] || 'local'; }
  wrap(v) { const n = this.size; return ((v % n) + n) % n; }
  spawnPoint(p) { const r = this.rng(hashStr(p.code)); const t = p.tile ?? Math.floor(r() * this.side * this.side), tx = t % this.side, ty = Math.floor(t / this.side);
    return [tx * TILE + 2 + Math.floor(r() * (TILE - 4)), ty * TILE + 2 + Math.floor(r() * (TILE - 4))]; }
  add(code, { bot = false, name = code, minor = false, adult = !minor } = {}) { if (this.players.has(code)) return this.players.get(code);
    const p = { code, bot, name, minor: bot ? false : minor, adult, dir: 'right', alive: true, score: 0, deaths: 0, respawnAt: null, hue: hashStr(code) % 360 }; if (bot) p.persona = BOT.makePersona(mulberry32(hashStr(code) ^ this.seed)); this.players.set(code, p);
    if (!bot) { this.layout(); this.fillBots(); } const [x, y] = this.spawnPoint(p); p.x = x; p.y = y; this.game?.spawn?.(this, p); return p; }
  remove(code) { const p = this.players.get(code); if (!p) return; this.game?.despawn?.(this, p); this.players.delete(code); if (!p.bot) { this.layout(); this.fillBots(); } }
  // Bots fill the map while nobody (or few) is online / while connecting; one steps aside for each human who joins.
  fillBots(minPop = MIN_POP) { if (this.noFill) return this.bots().length; const want = Math.max(0, Math.min(minPop - this.humans().length, (this.cap ?? Infinity) - this.humans().length)); let b = this.bots();
    while (b.length > want) { this.remove(b.pop().code); }
    while (this.bots().length < want) this.add('BOT-' + (++this.botN), { bot: true, name: 'bot ' + this.botN }); return this.bots().length; }
  get tickMs() { return this.game?.tickMs || TICK_MS; }
  // analog games (snake/tron) take {a: heading} | {t: -1|0|1} | compass name; grid games take a compass name
  input(code, dir, tick = this.tick + INPUT_DELAY) { if (this.game?.analog ? !validInput(dir) : !DIRS[dir]) return false; if (tick < this.tick) { this.desync++; tick = this.tick; } this.pending.push({ tick, code, dir }); return { tick, code, dir }; }
  turn(p, dir) { if (this.game?.analog) return applyInput(p, dir); if (dir && dir !== OPP[p.dir]) p.dir = dir; }
  step() { this.tick++; const due = this.pending.filter(i => i.tick <= this.tick); this.pending = this.pending.filter(i => i.tick > this.tick);
    due.sort((a, b) => a.tick - b.tick || (a.code < b.code ? -1 : 1)); for (const i of due) { const p = this.players.get(i.code); if (p) this.turn(p, i.dir); }
    const r = this.rng(); for (const p of [...this.players.values()].sort((a, b) => a.code < b.code ? -1 : 1)) if (p.bot && p.alive) BOT.think(this, p, r);
    this.events = []; BOT.tickBubbles(this); this.game?.step?.(this, r);
    for (const p of this.players.values()) if (!p.alive && p.respawnAt != null && this.tick >= p.respawnAt) { p.alive = true; p.respawnAt = null; const [x, y] = this.spawnPoint(p); p.x = x; p.y = y; this.game?.spawn?.(this, p); }
    this.game?.checkReset?.(this); return this.events; }
  kill(p, by, x = p.x, y = p.y, respawnTicks = this.respawn === undefined ? Math.round(RESPAWN_TICKS * TICK_MS / this.tickMs) : this.respawn) { if (!p.alive) return; p.alive = false; p.deaths++; p.respawnAt = respawnTicks == null ? null : this.tick + respawnTicks; /* respawn=null: no respawn (duel rounds) */ BOT.onKill(this, p, by, this.rng(hashStr(p.code))); this.events.push({ t: 'kill', who: p.code, by: by?.code || null, tile: this.tileAt(x, y), authority: this.ownerAt(x, y), tick: this.tick }); this.game?.despawn?.(this, p); }
  // P2P: events this node must publish (it owns the tile); others are provisional until the owner's verdict arrives.
  authoritative(myCode, events = this.events) { return events.filter(e => e.authority === myCode || (e.authority === 'local')); }
  applyVerdict(v, from) { if (this.tileOwners[v.tile] !== from) return false; const p = this.players.get(v.who); if (!p) return false;
    if (v.t === 'kill' && p.alive) { this.kill(p, this.players.get(v.by)); } else if (v.t === 'alive' && !p.alive) { p.alive = true; p.respawnAt = null; } return true; }
  snapshot() { return { id: this.id, tick: this.tick, side: this.side, n: this.players.size, humans: this.humans().length, bots: this.bots().length }; }
}
