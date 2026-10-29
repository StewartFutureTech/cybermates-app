// Arcade lobby → SUB-MAPS. Hard cap CAP = 100 players per sub-map (all mass games: snake, tron, Draw & Guess) (bots COUNT toward the 50, and are evicted first when a
// human needs the slot). When every sub-map has 50 humans a new sub-map is created. rebalance() (run by the lobby between
// rounds, never mid-round) evens humans across ceil(H/100) sub-maps so they sit at ~50-100 each (SPLIT_MIN..CAP) and drops
// empty extras. Sub-maps are LINKED on the mesh (`links` = sibling ids; full mesh within a lobby) so the UI can show
// siblings and hop. Ids are deterministic (game-index) so every peer agrees.
import { World, hashStr } from './engine.js';
export const CAP = 100, SPLIT_MIN = 60;
export class InstanceManager {
  constructor({ game, gameName = 'snake', cap = CAP, factory = null } = {}) { Object.assign(this, { game, gameName, cap, factory }); this.list = []; this.where = new Map(); this.n = 0; }
  relink() { for (const w of this.list) w.links = this.list.filter(o => o !== w).map(o => o.id); }
  create() { const id = `${this.gameName}-${++this.n}`; const w = this.factory ? this.factory(id) : new World({ seed: hashStr(id), game: this.game, id }); w.cap = this.cap; w.fillBots(); this.list.push(w); this.relink(); return w; }
  open() { return this.list.find(w => w.humans().length < this.cap) || this.create(); }
  _place(w, code, opts) { if (w.players.size >= this.cap) { const b = w.bots().pop(); if (b) w.remove(b.code); } // evict a bot first
    w.add(code, opts); w.fillBots(); this.where.set(code, w); }
  join(code, opts = {}) { if (this.where.has(code)) return this.where.get(code); const w = this.open(); this._place(w, code, opts); return w; }
  leave(code) { const w = this.where.get(code); if (!w) return; w.remove(code); this.where.delete(code); }
  hop(code, id) { const to = this.list.find(w => w.id === id), from = this.where.get(code); if (!to || to === from || to.humans().length >= this.cap) return false; const p = from.players.get(code); this.leave(code); this._place(to, code, { name: p?.name, minor: p?.minor, adult: p?.adult }); return true; }
  rebalance() { const humans = this.list.flatMap(w => w.humans().map(p => [w, p])); const k = Math.max(1, Math.ceil(humans.length / this.cap));
    while (this.list.length < k) this.create();
    const target = i => Math.floor(humans.length / k) + (i < humans.length % k ? 1 : 0); let moved = 0;
    const keep = this.list.slice().sort((a, b) => b.humans().length - a.humans().length).slice(0, k);
    for (const w of this.list) if (!keep.includes(w)) for (const p of w.humans()) { this.leave(p.code); this._move(p, keep); moved++; }
    for (;;) { const sorted = keep.slice().sort((a, b) => b.humans().length - a.humans().length), big = sorted[0], small = sorted[sorted.length - 1];
      if (big.humans().length - small.humans().length <= 1) break; const p = big.humans().pop(); this.leave(p.code); this._place(small, p.code, { name: p.name, minor: p.minor, adult: p.adult }); moved++; }
    this.list = this.list.filter(w => keep.includes(w)); this.relink(); return { moved, maps: this.list.length, sizes: this.list.map(w => w.humans().length), targets: keep.map((_, i) => target(i)) }; }
  _move(p, keep) { const w = keep.slice().sort((a, b) => a.humans().length - b.humans().length)[0]; this._place(w, p.code, { name: p.name, minor: p.minor, adult: p.adult }); }
  stats() { return this.list.map(w => ({ id: w.id, humans: w.humans().length, bots: w.bots().length, total: w.players.size, links: [...w.links] })); }
}
