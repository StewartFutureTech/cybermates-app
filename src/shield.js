// Cheap-shield DoS defense: make each phone expensive to overwhelm but cheap to run.
//  1) fixed-size packets (pad to buckets; anything above MAX is dropped before parsing)
//  2) size + signature checks BEFORE any other work (verify is the only crypto a stranger can make us do)
//  3) stateless cookie: a stranger must echo HMAC(secret, code|window) before we keep ANY state for it
//  4) per-sender token buckets; repeat offenders feed tier strikes (onStrike -> report, server decides level)
import nacl from 'tweetnacl';
export const BUCKETS = [512, 2048, 8192], MAX_PKT = 8192, PER_SENDER = { rate: 10, burst: 30 }, STRIKE_AFTER = 3;
export const fixedSize = s => { const n = BUCKETS.find(x => x >= s.length + 1); if (!n) return null; return s + '\u0000' + ' '.repeat(n - s.length - 1); };
export class Shield {
  constructor({ verify, secret = nacl.randomBytes(32), now = () => Date.now(), onStrike = () => {}, isKnown = () => false } = {}) { Object.assign(this, { verify, secret, now, onStrike, isKnown }); this.buckets = new Map(); this.over = new Map(); this.work = 0; }
  async cookie(code, w = Math.floor(this.now() / 60e3)) { const k = await crypto.subtle.importKey('raw', this.secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const s = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(code + '|' + w))); return btoa(String.fromCharCode(...s.slice(0, 12))); }
  async cookieOk(code, c) { const w = Math.floor(this.now() / 60e3); return c === await this.cookie(code, w) || c === await this.cookie(code, w - 1); }
  _rate(code) { const t = this.now(); let b = this.buckets.get(code); if (!b) { b = { tok: PER_SENDER.burst, t }; this.buckets.set(code, b); } b.tok = Math.min(PER_SENDER.burst, b.tok + (t - b.t) * PER_SENDER.rate / 1000); b.t = t; if (b.tok < 1) return false; b.tok--; return true; }
  // raw = string as received. Returns {ok, pkt} | {ok:false, reason, challenge?}
  async admit(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_PKT || !BUCKETS.includes(raw.length)) return { ok: false, reason: 'size' }; // cheapest check first
    let p; try { p = JSON.parse(raw.slice(0, raw.indexOf('\u0000'))); } catch { return { ok: false, reason: 'parse' }; }
    const code = String(p?.from || ''); if (!code) return { ok: false, reason: 'no-sender' };
    if (!this._rate(code)) { const n = (this.over.get(code) || 0) + 1; this.over.set(code, n); if (n % STRIKE_AFTER === 0) this.onStrike({ code, reason: 'flood', count: n }); return { ok: false, reason: 'rate' }; }
    if (!(await this.verify(p))) return { ok: false, reason: 'sig' }; this.work++;
    if (!this.isKnown(code) && !(await this.cookieOk(code, p.cookie))) { this.buckets.delete(code); return { ok: false, reason: 'cookie', challenge: await this.cookie(code) }; } // no state kept for strangers
    return { ok: true, pkt: p };
  }
}
// ---- v38: LIVE RECEIVE PATH (app-mesh.js bus.on). The bus hands us already-parsed packets, so the receive-side shield is:
//  1) shape + size cap per packet kind BEFORE anything else (no unpack, no verify, no decrypt for oversize packets);
//  2) per-claimed-sender token bucket (PER_SENDER; game broadcasts 'arc' get their own GAME budget so play never stalls);
//     over-limit packets are DROPPED (never queued) and every STRIKE_AFTER drops fires onStrike (logged; the claimed sender
//     is unverified at this point, so a strike never bans or mutes anyone by itself);
//  3) "no state for strangers": the FIRST packets from senders we have never verified share one global STRANGERS budget, so
//     a distributed flood (many fake IDs) can only buy a fixed amount of signature work per second; known senders don't use it;
//  4) anonymous kinds (bdisc queries/answers, onion hops) have global budgets; tracking maps are size-capped (TRACK_MAX).
// Signature checks stay where they were (e2e.open verifies BEFORE decrypting) but now only run on admitted packets.
export const RX = { MAX: { hello: 1024, bdisc: 512, 'bdisc-ans': 2048, ctl: 16384, mesh: 65536, onion: 65536, mem: 262144 }, DEFAULT_MAX: 16384,
  GAME: { rate: 60, burst: 120 }, STRANGERS: { rate: 40, burst: 80 }, ANON: { bdisc: { rate: 2, burst: 20 }, 'bdisc-ans': { rate: 50, burst: 200 }, onion: { rate: 50, burst: 100 } }, TRACK_MAX: 4096 };
export const rxSize = m => { try { return JSON.stringify(m).length; } catch { return Infinity; } };
export class RxGate {
  constructor({ now = () => Date.now(), isKnown = () => false, onStrike = () => {}, cfg = RX, perSender = PER_SENDER } = {}) { Object.assign(this, { now, isKnown, onStrike, cfg, perSender }); this.per = new Map(); this.game = new Map(); this.glob = new Map(); this.over = new Map(); this.stats = { in: 0, ok: 0, shape: 0, size: 0, rate: 0, stranger: 0, anon: 0, strikes: 0 }; }
  _take(map, key, { rate, burst }) { const t = this.now(); let b = map.get(key); if (!b) { if (map.size >= this.cfg.TRACK_MAX) map.delete(map.keys().next().value); b = { tok: burst, t }; map.set(key, b); } b.tok = Math.min(burst, b.tok + (t - b.t) * rate / 1000); b.t = t; if (b.tok < 1) return false; b.tok--; return true; }
  _drop(reason) { this.stats[reason]++; return { ok: false, reason }; }
  // msg = parsed bus packet; sender = CLAIMED sender code (unverified) or null for anonymous kinds; game = arcade broadcast
  admit(msg, { sender = null, game = false } = {}) { this.stats.in++;
    if (!msg || typeof msg !== 'object' || typeof msg.k !== 'string') return this._drop('shape');
    if (rxSize(msg) > (this.cfg.MAX[msg.k] ?? this.cfg.DEFAULT_MAX)) return this._drop('size'); // cheapest real check first
    if (sender) { sender = String(sender).slice(0, 64);
      if (!this._take(game ? this.game : this.per, sender, game ? this.cfg.GAME : this.perSender)) { const n = (this.over.get(sender) || 0) + 1; if (this.over.size >= this.cfg.TRACK_MAX && !this.over.has(sender)) this.over.delete(this.over.keys().next().value); this.over.set(sender, n);
        if (n % STRIKE_AFTER === 0) { this.stats.strikes++; try { this.onStrike({ code: sender, reason: 'flood', count: n }); } catch {} } return this._drop('rate'); }
      if (!this.isKnown(sender) && !this._take(this.glob, '*stranger', this.cfg.STRANGERS)) return this._drop('stranger'); }
    else if (this.cfg.ANON[msg.k] && !this._take(this.glob, msg.k, this.cfg.ANON[msg.k])) return this._drop('anon');
    this.stats.ok++; return { ok: true };
  }
}
