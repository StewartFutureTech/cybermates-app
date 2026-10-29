// Per-phone connection cap with LRU eviction: target a few hundred, HARD MAX 2,000 (never millions). Friends and open
// calls are pinned (never evicted). Ties into the 24h sweep (stale rows go first).
export const CAP_TARGET = 300, CAP_MAX = 2000;
export class ConnCap {
  constructor({ target = CAP_TARGET, max = CAP_MAX, pinned = () => false, now = () => Date.now() } = {}) { Object.assign(this, { target, max, pinned, now }); this.lru = new Map(); }
  touch(code) { this.lru.delete(code); this.lru.set(code, this.now()); return this.enforce(); }
  drop(code) { this.lru.delete(code); }
  has(code) { return this.lru.has(code); } get size() { return this.lru.size; }
  enforce(limit = this.max) { const out = []; for (const c of this.lru.keys()) { if (this.lru.size <= limit) break; if (this.pinned(c)) continue; this.lru.delete(c); out.push(c); } return out; }
  trim() { return this.enforce(this.target); } // idle/background: shrink to target
}
