// MASS TRIVIA — party room up to 200 players (section 15 cap for chat-style games). Same PG local bank as Trivia Clash.
// A new question every Q_MS; everyone answers once; correct = 5 pts + speed bonus (up to 5, by order of correct answers).
// Live leaderboard; after QN questions the room shows the podium for PODIUM_MS and starts a fresh set.
import { BANK } from '../arcade/games/trivia.js';
export const ROOM_CAP = 200, Q_MS = 15e3, QN = 10, PODIUM_MS = 10e3;
const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
export const order = (id, set) => { const a = [...BANK.keys()]; let x = hash(id + '/' + set) || 1; for (let i = a.length - 1; i > 0; i--) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; const j = (x >>> 0) % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, QN); };
export class TriviaRoom {
  constructor({ id = 'mtrivia-1', now = Date.now() } = {}) { this.id = id; this.players = new Map(); this.links = []; this.botN = 0; this.set = 0; this.start = now; this.ans = new Map(); this.log = []; this.lastQ = -1; }
  humans() { return [...this.players.values()].filter(p => !p.bot); } bots() { return [...this.players.values()].filter(p => p.bot); }
  add(code, o = {}) { if (this.players.has(code)) return this.players.get(code); const p = { code, name: o.name || code, bot: !!o.bot, minor: !!o.minor, adult: !o.minor, pts: 0 }; this.players.set(code, p); if (!p.bot) this.fillBots(); return p; }
  remove(code) { const p = this.players.get(code); if (!p) return; this.players.delete(code); if (!p.bot) this.fillBots(); }
  fillBots(minPop = 8) { const want = Math.max(0, Math.min(minPop - this.humans().length, (this.cap ?? ROOM_CAP) - this.humans().length)); while (this.bots().length > want) this.remove(this.bots().pop().code); while (this.bots().length < want) this.add('BOT-' + (++this.botN), { bot: true, name: 'bot ' + this.botN }); return this.bots().length; }
  qIndex(now = Date.now()) { return Math.floor((now - this.start) / Q_MS); }
  question(now = Date.now()) { const q = this.qIndex(now); if (q >= QN) return null; const [text, choices, right] = BANK[order(this.id, this.set)[q]]; return { q, text, choices, right, left: Q_MS - ((now - this.start) % Q_MS) }; }
  answer(code, q, a, now = Date.now()) { const Q = this.question(now), p = this.players.get(code); if (!Q || !p || Q.q !== q || !(a >= 0 && a < 4)) return { ok: false, reason: 'closed' }; const key = q + ':' + code; if (this.ans.has(key)) return { ok: false, reason: 'answered' };
    const correct = a === Q.right; const rank = [...this.ans.entries()].filter(([k, v]) => k.startsWith(q + ':') && v.correct).length; this.ans.set(key, { a, correct }); if (correct) p.pts += 5 + Math.max(0, 5 - rank); return { ok: true, correct }; }
  answered(code, now = Date.now()) { const Q = this.question(now); return !!Q && this.ans.has(Q.q + ':' + code); }
  step(rng = Math.random, now = Date.now()) { const ev = []; const q = this.qIndex(now);
    if (q !== this.lastQ) { const prev = this.lastQ; this.lastQ = q; if (q < QN) ev.push({ t: 'question', q }); else if (prev < QN) ev.push({ t: 'podium' }); }
    if (q >= QN) { if (now - this.start > QN * Q_MS + PODIUM_MS) { this.set++; this.start = now; this.ans.clear(); this.lastQ = -1; for (const p of this.players.values()) p.pts = 0; ev.push({ t: 'reset' }); } return ev; }
    const Q = this.question(now); for (const b of this.bots()) if (!this.ans.has(q + ':' + b.code) && rng() < 0.08) this.answer(b.code, q, rng() < 0.6 ? Q.right : Math.floor(rng() * 4), now);
    return ev; }
  leaderboard() { return [...this.players.values()].sort((a, b) => b.pts - a.pts).map((p, i) => ({ rank: i + 1, code: p.code, name: p.name, bot: p.bot, pts: p.pts })); }
}
export const meta = { id: 'mtrivia', name: 'Mass Trivia', modes: ['mass'], kind: 'mass', cap: ROOM_CAP };
