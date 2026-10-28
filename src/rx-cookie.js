// v51: stateless cookie challenge + cookied-stranger tracking for the live receive path (wraps RxGate).
// Protocol version PROTO: old clients omit pv / send 0 and keep the pre-v51 stranger budget (no break). New clients (pv>=1)
// must echo HMAC(secret, code|window) before we keep per-sender state beyond the shared stranger budget.
import { RxGate, RX, PER_SENDER, STRIKE_AFTER, rxSize } from './shield.js';

export const PROTO = 1;
export const cookiePkt = (to, ch, from) => ({ k: 'ck', to, from, ch, pv: PROTO });

export class CookieGate {
  constructor({ now = () => Date.now(), isKnown = () => false, onStrike = () => {}, onChallenge = null, secret = null, cfg = RX, perSender = PER_SENDER } = {}) {
    this.gate = new RxGate({ now, isKnown: c => isKnown(c) || this.isCookied(c), onStrike, cfg, perSender });
    this.now = now; this.onChallenge = onChallenge; this.isKnown0 = isKnown;
    this.secret = secret || (globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint8Array(32)) : Uint8Array.from({ length: 32 }, () => Math.floor(Math.random() * 256)));
    this.cookied = new Map(); this._ck = new Map();
    this.stats = this.gate.stats; this.stats.cookie = 0; this.stats.challenged = 0;
  }
  get per() { return this.gate.per; } get over() { return this.gate.over; }
  markCookied(code, ms = 120e3) { const c = String(code).slice(0, 64); this.cookied.set(c, this.now() + ms); if (this.cookied.size > RX.TRACK_MAX) this.cookied.delete(this.cookied.keys().next().value); }
  isCookied(code) { const u = this.cookied.get(code); if (!u) return false; if (this.now() > u) { this.cookied.delete(code); return false; } return true; }
  async cookie(code, w = Math.floor(this.now() / 60e3)) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) { let h = 2166136261; const s = code + '|' + w + '|' + [...this.secret].slice(0, 8).join(','); for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      return btoa(String.fromCharCode(...[0, 8, 16, 24, 4, 12, 20, 28].map(sh => (h >>> sh) & 255))); }
    const k = await subtle.importKey('raw', this.secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const s = new Uint8Array(await subtle.sign('HMAC', k, new TextEncoder().encode(code + '|' + w)));
    return btoa(String.fromCharCode(...s.slice(0, 12)));
  }
  async cookieOk(code, c) { if (!c) return false; const w = Math.floor(this.now() / 60e3); return c === await this.cookie(code, w) || c === await this.cookie(code, w - 1); }
  ensureChallenge(sender) {
    const hit = this._ck.get(sender); if (hit && this.now() - hit.at < 30e3 && hit.ch) return hit.p;
    const p = this.cookie(sender).then(async ch => { const prev = await this.cookie(sender, Math.floor(this.now() / 60e3) - 1).catch(() => null);
      this._ck.set(sender, { ch, prev, at: this.now() }); if (this._ck.size > 256) this._ck.delete(this._ck.keys().next().value);
      try { this.onChallenge?.({ to: sender, ch, pv: PROTO }); } catch {} return ch; }).catch(() => null);
    this._ck.set(sender, { ch: null, prev: null, at: this.now(), p }); return p;
  }
  admit(msg, opts = {}) {
    if (msg?.k === 'ck') { if (rxSize(msg) > 512) return this.gate._drop('size'); this.stats.ok++; return { ok: true, kind: 'ck' }; }
    const sender = opts.sender ? String(opts.sender).slice(0, 64) : null;
    const pv = Number(msg?.pv) || 0;
    if (sender && pv >= PROTO && !this.isKnown0(sender) && !this.isCookied(sender)) {
      const cached = this._ck.get(sender);
      if (msg.cookie && cached && (msg.cookie === cached.ch || msg.cookie === cached.prev)) this.markCookied(sender);
      else { this.stats.cookie++; this.stats.challenged++; this.ensureChallenge(sender);
        // Still run size/rate via underlying gate for the drop accounting, but force cookie refusal for pv>=1 strangers.
        const pre = this.gate.admit(msg, opts); if (!pre.ok && pre.reason !== 'stranger') return pre;
        return { ok: false, reason: 'cookie', challenge: cached?.ch || null, to: sender }; }
    }
    return this.gate.admit(msg, opts);
  }
  async acceptCookie(sender, c) { if (await this.cookieOk(sender, c)) { this.markCookied(sender); return true; } return false; }
}
