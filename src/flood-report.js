// v51: auto-file flood reports from RxGate strikes. CLAIMED senders are unverified at the shield, so every report carries
// an anti-framing note and the server/moderator must NOT ban solely on these. Batched to avoid spam.
import { fileReport } from './reports.js';
import { submitReport } from './compliance.js';

export const PROTO = 1; // mesh protocol version (cookie challenge + flood reports). Old clients omit pv / send pv:0.
export const ANTI_FRAME = 'ANTI-FRAMING: claimed sender is UNVERIFIED at the cheap-shield (RxGate). Packets may be forged/spoofed. Do NOT ban or mute solely on this. Treat as a rate-drop signal from one observer; correlate across reporters and require a signed/bound identity before action.';
export const BATCH_MS = 30_000, BATCH_MIN = 3, BATCH_MAX = 40;

export class FloodReporter {
  // report(row) optional override; post(body) posts to /api/flood (or null to skip network).
  constructor({ reporter, now = () => Date.now(), timers = globalThis, post = null, batchMs = BATCH_MS } = {}) {
    Object.assign(this, { reporter, now, timers, post, batchMs });
    this.q = new Map(); // code -> {count, first, last, reasons}
    this.sent = []; this.flushT = null; this.stats = { strikes: 0, filed: 0, posted: 0, skipped: 0 };
  }
  onStrike({ code, reason = 'flood', count = 1 } = {}) {
    if (!code) return; this.stats.strikes++;
    const c = String(code).slice(0, 64); let e = this.q.get(c);
    if (!e) { e = { code: c, count: 0, first: this.now(), last: this.now(), reasons: {} }; this.q.set(c, e); }
    e.count = Math.max(e.count, count); e.last = this.now(); e.reasons[reason] = (e.reasons[reason] || 0) + 1;
    if (this.q.size >= BATCH_MAX) this.flush();
    else if (!this.flushT) this.flushT = this.timers.setTimeout?.(() => { this.flushT = null; this.flush(); }, this.batchMs);
  }
  async flush() {
    if (this.flushT) { this.timers.clearTimeout?.(this.flushT); this.flushT = null; }
    const items = [...this.q.values()].filter(e => e.count >= 1); this.q.clear();
    if (!items.length) return [];
    const out = [];
    for (const e of items) {
      const excerpt = `${ANTI_FRAME}\nObserver ${this.reporter || '?'} saw ${e.count} rate-limit drops from claimed id ${e.code} between ${new Date(e.first).toISOString()} and ${new Date(e.last).toISOString()}. Reasons: ${JSON.stringify(e.reasons)}. Protocol pv=${PROTO}.`;
      try {
        const local = await fileReport({ reporter: this.reporter || 'shield', reported: e.code.slice(0, 16), reason: 'spam/scam', context: 'voice', excerpt: excerpt.slice(0, 1000) });
        this.stats.filed++; out.push(local);
      } catch { this.stats.skipped++; }
      if (this.post) {
        try {
          await this.post({ kind: 'flood', pv: PROTO, reporter: this.reporter, claimed: e.code, count: e.count, first: e.first, last: e.last, reasons: e.reasons, note: ANTI_FRAME, antiFrame: true });
          this.stats.posted++;
        } catch { this.stats.skipped++; }
      } else {
        try { await submitReport({ reporter: this.reporter || 'shield', reported: e.code.slice(0, 16), reason: 'spam/scam', excerpt: excerpt.slice(0, 1000) }); this.stats.posted++; }
        catch { this.stats.skipped++; }
      }
    }
    this.sent.push(...out); if (this.sent.length > 100) this.sent.splice(0, this.sent.length - 100);
    return out;
  }
}

export const cookiePkt = (to, ch, from) => ({ k: 'ck', to, ch, from, pv: PROTO });
export const withCookie = (pkt, cookie) => (cookie ? { ...pkt, cookie, pv: PROTO } : { ...pkt, pv: PROTO });
