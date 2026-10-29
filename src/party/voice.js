// GLOBAL (room-wide) PARTY VOICE for chat-style mass games (Bingo, Mass Trivia, Draw & Guess). Push-to-talk to the whole room.
// Talk budget "10s/1min": each press is cut at MAX_PRESS_MS (10 s) and a speaker gets at most BUDGET_MS (10 s) of talk time
// in any rolling WINDOW_MS (60 s), so 200 people can share one channel. SAFETY = the same rules as proximity voice:
// OFF until toggled; minors need the parent's 'proximityVoice' (Arcade voice) permission; canHear() never pairs adult<->minor
// (rooms are band-split anyway); muted / blocked players and bots are never linked. connect(code) -> {setGain, close}.
import { canHear } from '../arcade/proximity.js';
import { isMinor } from '../discovery.js';
export const MAX_PRESS_MS = 10e3, BUDGET_MS = 10e3, WINDOW_MS = 60e3;
export class PartyVoice {
  constructor({ me, parent = null, isBlocked = () => false, connect = null, now = () => Date.now() }) { Object.assign(this, { me, parent, isBlocked, connect, now }); this.enabled = false; this.muted = new Set(); this.links = new Map(); this.spans = []; this.talkingSince = null; }
  async setEnabled(on) { if (on && isMinor(this.me) && !(await this.parent?.allowed('proximityVoice'))) return { ok: false, reason: 'parent-disabled' }; this.enabled = !!on; if (!on) { this.stop(); this.closeAll(); } return { ok: true, enabled: this.enabled }; }
  used(t = this.now()) { let u = 0; for (const [a, b] of this.spans) u += Math.max(0, Math.min(b, t) - Math.max(a, t - WINDOW_MS)); if (this.talkingSince != null) u += t - Math.max(this.talkingSince, t - WINDOW_MS); return u; }
  remaining(t = this.now()) { return Math.max(0, BUDGET_MS - this.used(t)); }
  start() { const t = this.now(); if (!this.enabled) return { ok: false, reason: 'off' }; if (this.talkingSince != null) return { ok: true }; if (this.remaining(t) < 250) return { ok: false, reason: 'budget', waitMs: this.nextFree(t) }; this.talkingSince = t; this.cutAt = t + Math.min(MAX_PRESS_MS, this.remaining(t)); return { ok: true, maxMs: this.cutAt - t }; }
  stop() { if (this.talkingSince == null) return; const t = Math.min(this.now(), this.cutAt); this.spans.push([this.talkingSince, t]); this.talkingSince = null; this.spans = this.spans.filter(([, b]) => b > t - WINDOW_MS); }
  tick() { if (this.talkingSince != null && this.now() >= this.cutAt) { this.stop(); return 'cut'; } return this.talkingSince != null ? 'talking' : 'idle'; }
  nextFree(t = this.now()) { const s = this.spans.find(([, b]) => b > t - WINDOW_MS); return s ? s[1] + WINDOW_MS - t : 0; }
  get talking() { return this.talkingSince != null; }
  mute(code, on = true) { if (on) { this.muted.add(code); this.links.get(code)?.close?.(); this.links.delete(code); } else this.muted.delete(code); }
  // players: iterable of {code, bot, minor/adult}; voiceOn(code) = peer advertised its toggle. Returns codes I hear.
  update(players, myCode, voiceOn = () => false) { const out = []; if (!this.enabled) { this.closeAll(); return out; }
    const me = { ...this.me, code: myCode, minor: isMinor(this.me) };
    for (const p of players) { if (p.code === myCode) continue; const ok = canHear(me, p, { enabled: true, peerEnabled: voiceOn(p.code), muted: this.muted, isBlocked: this.isBlocked });
      if (ok) { out.push(p.code); if (!this.links.has(p.code) && this.connect) { const L = this.connect(p.code); if (L) { this.links.set(p.code, L); L.setGain?.(1); } } }
      else if (this.links.has(p.code)) { this.links.get(p.code).close?.(); this.links.delete(p.code); } }
    return out; }
  closeAll() { for (const L of this.links.values()) try { L.close?.(); } catch {} this.links.clear(); }
}
