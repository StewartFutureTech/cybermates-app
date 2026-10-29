// JOIN-ANYTIME model. No lobby states / protected rounds.
//  - REAL-TIME games (snake, tron, tronduel, snakebattle, pong, megaship, brawl …): joinRealtime() spawns the player into the
//    running World immediately (a bot steps aside), no waiting screen.
//  - TURN-BASED games (chess, checkers, connect4, battleship, uttt, trivia …): a waiting player pings the table and is
//    queued; at the round boundary they are seated — replacing an AI auto-fill seat first, else an empty seat. Optional
//    AI auto-fill keeps tables playable; the bot is replaced by the real player at the boundary (never mid-round).
import { band } from './proximity.js';
export const REALTIME = new Set(['snake', 'tron', 'tronduel', 'snakebattle', 'pong', 'megaship', 'brawl', 'duel']);
export const isRealtime = game => REALTIME.has(game) || !!game?.realtime;
export function joinRealtime(world, code, opts = {}) { const p = world.add(code, opts); p.alive = true; p.respawnAt = null; return p; }
export class TurnTable {
  constructor({ seats = 2, autoFill = true, mkBot = i => ({ code: `AI-${i}`, name: `bot ${i}`, ai: true, skill: 0.6 }) } = {}) {
    Object.assign(this, { autoFill, mkBot }); this.seats = Array(seats).fill(null); this.waiting = []; this.round = 0; this.inRound = false; this.botN = 0;
    if (autoFill) this._fill(); }
  _fill() { this.seats = this.seats.map(s => s || (this.autoFill ? { ...this.mkBot(++this.botN) } : null)); }
  // waiting player pings: seated now if the round has not started and a seat is free/bot; else queued for the boundary.
  ping(p) { if (this.seats.some(s => s?.code === p.code) || this.waiting.some(w => w.code === p.code)) return { ok: true, already: true };
    if (!this.inRound && this._seat(p)) return { ok: true, seated: true }; this.waiting.push(p); return { ok: true, queued: this.waiting.length }; }
  _seat(p) { const humans = this.seats.filter(s => s && !s.ai); if (humans.length && humans.some(h => band(h) !== band(p))) return false; // never mix age bands
    let i = this.seats.findIndex(s => !s); if (i < 0) i = this.seats.findIndex(s => s?.ai); if (i < 0) return false; this.seats[i] = { ...p, seat: i }; return true; }
  leave(code) { this.waiting = this.waiting.filter(w => w.code !== code); const i = this.seats.findIndex(s => s?.code === code);
    if (i >= 0) this.seats[i] = this.inRound && this.autoFill ? { ...this.mkBot(++this.botN), seat: i } : null; } // bot takes over mid-round
  startRound() { if (!this.inRound) { this._fill(); this.inRound = true; } return this.seats; }
  endRound() { this.inRound = false; this.round++; const still = []; for (const p of this.waiting) if (!this._seat(p)) still.push(p); this.waiting = still; this._fill(); return { seats: this.seats, waiting: this.waiting.length }; }
}
