// ROUND-ROBIN CONNECT (YouMingle-style random video/voice). STRICT 18+.
//  - Hidden entirely for under-18 users (UI never renders the tab; setOn() throws for minors).
//  - Receiver side refuses minors too: a ring/offer is dropped when either side is a minor, either side is not in
//    roulette mode (mutual opt-in), the caller is blocked/banned, or the pair is inside the 24 h cooldown.
//  - Matching pool = online peers from the joined mesh that broadcast {rl:on, adult:true} within RL_FRESH_MS.
//  - 24 h cooldown list of peer network IDs (ID key) lives in the encrypted vault (p.roulette[owner].cooldown) and is
//    pruned on the 24 h sweep (and on every load). Never sent anywhere.
//  - Media rides the existing DirectLink (src/call.js) — P2P WebRTC, STUN by default; real devices behind NAT need TURN.
//  Limit: "adult" is the self-declared setup age (same as Dating); a peer can lie about its flag. Receiver-side checks
//  stop honest-client minors, not a modified client. See README "Round-robin connect".
import { isMinor } from './discovery.js';
export const COOLDOWN_MS = 24 * 3600e3, RL_FRESH_MS = 60e3;
export const SAFETY_NOTICE = '18+ only. You will be connected to random adults by video/voice. Never share personal info. Tap ⚑ Report for anything abusive or illegal, Skip to move on — you can block on skip. Calls are peer-to-peer and not recorded by Cybermates.';
export const isAdult = me => !!me && !isMinor(me) && me.age != null && me.age !== '' && Number(me.age) >= 18;
export const visibleFor = me => isAdult(me); // tab shown only for adults

export class Cooldown { // vault-backed: { read(), use(fn) }
  constructor(vault, owner, { now = () => Date.now(), ms = COOLDOWN_MS } = {}) { Object.assign(this, { vault, owner, now, ms }); this.m = new Map(); }
  async load() { const p = await this.vault.read(); this.m = new Map(Object.entries(p?.roulette?.[this.owner]?.cooldown || {})); if (this.prune(false)) await this._save(); return this; }
  async _save() { const o = Object.fromEntries(this.m); await this.vault.use(p => { ((p.roulette ||= {})[this.owner] ||= {}).cooldown = o; }); }
  async add(id) { if (!id) return; this.m.set(String(id), this.now()); await this._save(); }
  has(id) { const t = this.m.get(String(id)); return t != null && this.now() - t < this.ms; }
  prune(save = true) { let n = 0; for (const [id, t] of [...this.m]) if (this.now() - t >= this.ms) { this.m.delete(id); n++; } if (n && save) this._save().catch(() => {}); return n; }
  list() { return [...this.m.keys()]; }
}
// Can I be matched with this peer? peer = { code, adult, rl, at }
export function eligible(me, peer, { cooldown, isBlocked = () => false, isBanned = () => false, now = Date.now(), myCode } = {}) {
  if (!isAdult(me) || !peer || peer.code === myCode) return false;
  if (peer.adult !== true || peer.minor || !peer.rl) return false;            // peer must be adult AND in roulette mode
  if (now - (peer.at || 0) > RL_FRESH_MS) return false;                       // stale opt-in
  if (isBlocked(peer.code) || isBanned(peer.code)) return false;
  if (cooldown?.has(peer.code)) return false; return true;
}
// Receiver-side gate for an incoming roulette ring/offer.
export function receiverAccept(me, { from, adult }, { on, cooldown, isBlocked = () => false, isBanned = () => false } = {}) {
  if (!isAdult(me)) return { ok: false, reason: 'minor' };
  if (!on) return { ok: false, reason: 'not-opted-in' };
  if (adult !== true) return { ok: false, reason: 'peer-not-adult' };
  if (isBlocked(from) || isBanned(from)) return { ok: false, reason: 'blocked' };
  if (cooldown?.has(from)) return { ok: false, reason: 'cooldown' }; return { ok: true };
}
export const pick = (list, rng = Math.random) => list.length ? list[Math.floor(rng() * list.length)] : null;
// Session state machine. deps: { me, myCode, pool(): peers[], cooldown, connect(code) -> Promise<{hangup()}>, block(code), report(code), isBlocked, isBanned, rng }
export class Roulette {
  constructor(deps) { this.d = deps; this.on = false; this.peer = null; this.link = null; this.state = 'idle'; this.blockOnSkip = false; this.onState = deps.onState || (() => {}); }
  enter() { if (!isAdult(this.d.me)) throw new Error('18+ only'); this.on = true; this.state = 'searching'; this.onState(this.state); return this; }
  candidates() { const { me, myCode, cooldown, isBlocked, isBanned } = this.d; return (this.d.pool() || []).filter(p => eligible(me, p, { cooldown, isBlocked, isBanned, myCode, now: this.d.now?.() ?? Date.now() })); }
  async next() { if (!this.on) return null; await this._drop(); const p = pick(this.candidates(), this.d.rng);
    if (!p) { this.state = 'searching'; this.onState(this.state); return null; }
    this.peer = p.code; await this.d.cooldown.add(p.code); this.state = 'connecting'; this.onState(this.state, p.code);
    try { this.link = await this.d.connect(p.code); this.state = 'connected'; } catch { this.state = 'searching'; this.peer = null; } this.onState(this.state, this.peer); return this.peer; }
  async skip({ block = this.blockOnSkip } = {}) { const c = this.peer; if (c && block) await this.d.block?.(c); return this.next(); }
  async report() { const c = this.peer; if (!c) return null; const r = await this.d.report?.(c); return r; }
  async _drop() { try { this.link?.hangup?.('skip'); } catch {} this.link = null; this.peer = null; }
  async leave() { await this._drop(); this.on = false; this.state = 'idle'; this.onState(this.state); }
}
