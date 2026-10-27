// PROXIMITY VOICE inside arcade games. You hear players physically near you on the map; voice only reaches players inside
// the same screen/viewport (VIEW_W x VIEW_H cells centred on the listener), with linear distance falloff to the edge.
// Defaults: OFF for everyone until toggled on. Minors: OFF and the toggle is locked until a parent enables
// 'proximityVoice' in parent controls (PIN; logged by ParentControls.set). SAFETY: the adult/minor separation is kept —
// canHear() never pairs an adult with a minor, so no proximity link is ever opened across that line (both sides check).
// Mute-a-player (local, session) and block (the existing user block list) are both honoured.
import { isMinor } from '../discovery.js';
export const VIEW_W = 32, VIEW_H = 24;
export const RANGE = Math.hypot(VIEW_W / 2, VIEW_H / 2);
export const band = p => (p?.minor || isMinor(p) || p?.adult === false ? 'minor' : 'adult');
export function inView(a, b, size = Infinity) { const d = (u, v) => { let x = Math.abs(u - v); if (size !== Infinity) x = Math.min(x, size - x); return x; };
  return d(a.x, b.x) <= VIEW_W / 2 && d(a.y, b.y) <= VIEW_H / 2; }
export function gainFor(a, b, size = Infinity) { if (!inView(a, b, size)) return 0; const dx = Math.min(Math.abs(a.x - b.x), size - Math.abs(a.x - b.x)), dy = Math.min(Math.abs(a.y - b.y), size - Math.abs(a.y - b.y)); return Math.max(0, 1 - Math.hypot(dx, dy) / RANGE); }
export function canHear(me, peer, { enabled, peerEnabled, muted = new Set(), isBlocked = () => false, sameInstance = true } = {}) {
  if (!enabled || !peerEnabled || !sameInstance || !peer || peer.bot) return false;
  if (band(me) !== band(peer)) return false;                 // NEVER adult <-> minor
  if (muted.has(peer.code) || isBlocked(peer.code)) return false; return true;
}
export const MAX_HEARD = 8; // per-peer audio links kept open at once (closest first); matches rtc-voice MAX_LINKS
export class ProximityVoice {
  // parent: ParentControls (minors only). connect(code) -> {setGain(g), close()}; links are opened lazily for in-range peers.
  // attach(hub) (v44): wires a real VoiceHub (src/rtc-voice.js) — the hub then only accepts / keeps links for peers that are in
  // my range right now (inRange, nearest MAX_HEARD), and every link's Web Audio gain follows gainFor() each frame.
  constructor({ me, parent = null, isBlocked = () => false, connect = null, maxHeard = MAX_HEARD }) { Object.assign(this, { me, parent, isBlocked, connect, maxHeard }); this.enabled = false; this.muted = new Set(); this.muteBots = false; this.links = new Map(); this.inRange = new Set(); this.gains = new Map(); this.hub = null; }
  attach(hub) { this.hub = hub; if (!hub) { this.connect = null; return; } hub.wants = c => this.enabled && this.inRange.has(c) && !this.muted.has(c) && !this.isBlocked(c); this.connect = c => hub.connect(c); }
  detach() { this.closeAll(); if (this.hub) this.hub.wants = () => false; this.hub = null; this.connect = null; }
  // Bot trash-talk = TEXT bubbles only (never synthesized voice). Shown for bots inside my viewport unless I muted bots/that bot.
  // Works with voice off too (it is text); still subject to mute.
  bubbles(world, myCode) { const self = world.players.get(myCode); if (!self || this.muteBots) return []; return (world.bubbles || []).filter(b => { const p = world.players.get(b.who); return p?.bot && !this.muted.has(b.who) && inView(self, p, world.size); }); }
  async canEnable() { if (!isMinor(this.me)) return { ok: true }; return (await this.parent?.allowed('proximityVoice')) ? { ok: true } : { ok: false, reason: 'parent-disabled' }; }
  async setEnabled(on) { if (on) { const g = await this.canEnable(); if (!g.ok) return g; } this.enabled = !!on; if (!on) this.closeAll(); return { ok: true, enabled: this.enabled }; }
  mute(code, on = true) { if (on) { this.muted.add(code); this.inRange.delete(code); this._close(code); } else this.muted.delete(code); }
  _close(code) { this.links.get(code)?.close?.(); this.links.delete(code); const H = this.hub?.links?.get(code); if (H && !H.closed) H.close?.(); }
  // world: engine World, myCode, voiceOn: code -> bool (peer advertised its toggle). Returns [{code, gain}] (the peers I hear)
  update(world, myCode, voiceOn = () => false) { const self = world.players.get(myCode);
    if (!this.enabled || !self) { this.closeAll(); return []; }
    const cand = []; for (const p of world.players.values()) { if (p.code === myCode) continue;
      const ok = canHear({ ...this.me, ...self, minor: isMinor(this.me) }, p, { enabled: this.enabled, peerEnabled: voiceOn(p.code), muted: this.muted, isBlocked: this.isBlocked });
      const g = ok ? gainFor(self, p, world.size) : 0; if (g > 0) cand.push({ code: p.code, gain: g }); }
    const out = cand.sort((a, b) => b.gain - a.gain).slice(0, this.maxHeard); this.inRange = new Set(out.map(o => o.code)); this.gains = new Map(out.map(o => [o.code, o.gain]));
    for (const { code, gain } of out) { let L = this.links.get(code); if (L?.closed) { this.links.delete(code); L = null; } // the far side said bye / link died: reconnect (hub backs off)
      if (!L && this.connect) { L = this.connect(code); if (L) this.links.set(code, L); } L?.setGain?.(gain); }
    for (const code of [...this.links.keys()]) if (!this.inRange.has(code)) this._close(code); // left range / left the map / muted / blocked
    if (this.hub) for (const [code, H] of [...this.hub.links]) if (!this.inRange.has(code) && !H.closed) H.close?.(); // links the hub accepted that I no longer want
    return out; }
  closeAll() { for (const L of this.links.values()) try { L.close?.(); } catch {} this.links.clear(); this.inRange = new Set(); this.gains = new Map(); if (this.hub) for (const H of [...this.hub.links.values()]) try { H.close?.(); } catch {} }
}
