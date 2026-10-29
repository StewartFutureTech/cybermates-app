// Mass-arena presence sync (v51): reply-to-join + prune silent peers.
// Problem (docs/TODO.md v44): a newcomer sends op:'join' once; peers already on the map never re-announce → asymmetric
// worlds (newcomer never sees them; proximity voice stays silent both ways).
// Design (David approved): when I receive a plain join from a same-band, not-blocked peer on my game/sub-map, I reply
// with my own presence after a small random stagger (avoid thundering herd; stay under RxGate game budget ~60/s).
// Replies carry hello:1 so they are NOT answered again (no ping-pong). Silent peers are pruned after SILENCE_MS.
// Bots stay local until a human's join arrives (World.fillBots / InstantManager already step a bot aside).
export const REPLY_MIN_MS = 40, REPLY_MAX_MS = 380, SILENCE_MS = 45_000, PRUNE_EVERY_MS = 5_000;
export const staggerMs = (rng = Math.random) => REPLY_MIN_MS + Math.floor(rng() * (REPLY_MAX_MS - REPLY_MIN_MS + 1));

export class PresenceSync {
  // send(pkt): broadcast presence; admit(from, opts): add peer to local world (returns player or null);
  // leave(code): remove; me(): {code,name,minor,sub,theme,voice}; sameBand(peer)/isBlocked(code): gates.
  constructor({ send, admit, leave, me, sameBand = () => true, isBlocked = () => false, timers = globalThis, rng = Math.random, now = () => Date.now(), silenceMs = SILENCE_MS } = {}) {
    Object.assign(this, { send, admit, leave, me, sameBand, isBlocked, timers, rng, now, silenceMs });
    this.lastSeen = new Map(); this.pending = new Map(); this.pruneT = null; this.stats = { joins: 0, hellos: 0, replies: 0, pruned: 0, skipped: 0 };
  }
  start() { if (!this.pruneT) this.pruneT = this.timers.setInterval?.(() => this.prune(), PRUNE_EVERY_MS); return this; }
  stop() { if (this.pruneT) this.timers.clearInterval?.(this.pruneT); this.pruneT = null; for (const t of this.pending.values()) this.timers.clearTimeout?.(t); this.pending.clear(); }
  touch(code, at = this.now()) { if (code) this.lastSeen.set(code, at); }
  announce({ hello = false } = {}) { const m = this.me?.(); if (!m?.code) return null;
    const pkt = { op: 'join', sub: m.sub, name: m.name, minor: !!m.minor, xage: !!m.xage, voice: !!m.voice, theme: m.theme, ...(hello ? { hello: 1 } : {}) };
    this.send?.(pkt); return pkt; }
  // Inbound join/hello from `from`. Returns {action:'admit'|'reply'|'skip', ...}.
  onPeer(from, b = {}) {
    if (!from || from === this.me?.()?.code) return { action: 'skip', reason: 'self' };
    if (this.isBlocked(from) || this.isBlocked?.(from)) { this.stats.skipped++; return { action: 'skip', reason: 'blocked' }; }
    if (!this.sameBand(b)) { this.stats.skipped++; return { action: 'skip', reason: 'band' }; }
    this.touch(from); const hello = !!b.hello;
    if (hello) this.stats.hellos++; else this.stats.joins++;
    const p = this.admit?.(from, { name: b.name || from.slice(0, 6), minor: !!b.minor, xage: !!b.xage, adult: !b.minor });
    // Reply only to a plain join (not a hello reply) so we don't ping-pong. Stagger avoids a herd when many are on the map.
    if (!hello && !this.pending.has(from)) {
      const wait = staggerMs(this.rng);
      const t = this.timers.setTimeout?.(() => { this.pending.delete(from); if (this.isBlocked(from) || !this.sameBand(b)) return;
        this.announce({ hello: true }); this.stats.replies++; }, wait);
      if (t) this.pending.set(from, t);
      return { action: 'reply', peer: p, wait };
    }
    return { action: 'admit', peer: p };
  }
  onActivity(from) { this.touch(from); } // inputs / voice / shots also keep the peer alive
  prune(at = this.now()) {
    const me = this.me?.()?.code; const dead = [];
    for (const [c, t] of this.lastSeen) { if (c === me) continue; if (at - t > this.silenceMs) dead.push(c); }
    for (const c of dead) { this.lastSeen.delete(c); this.leave?.(c); this.stats.pruned++;
      const p = this.pending.get(c); if (p) { this.timers.clearTimeout?.(p); this.pending.delete(c); } }
    return dead;
  }
}
