// BINGO — mass party game (one room up to ROOM_CAP = 200 players; section 15: chat/sketch-style games may go to ~200).
// 75-ball US bingo: card columns B 1-15, I 16-30, N 31-45 (free centre), G 46-60, O 61-75. A caller draws one ball every
// CALL_MS (room setting: 10 s "fast" or 60 s "classic"); the sequence is a deterministic shuffle of the room id + round so
// every peer agrees. Players daub called numbers on their own card (tap); a BINGO claim is checked against the called set
// (row, column or diagonal). First valid claimers on the same call all win; the next round starts NEXT_MS later.
export const ROOM_CAP = 200, SPEEDS = { fast: 10e3, classic: 60e3 }, NEXT_MS = 8e3;
export const LETTERS = 'BINGO';
const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const rng32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const shuffle = (a, r) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const label = n => `${LETTERS[Math.floor((n - 1) / 15)]}-${n}`;
// card: 25 numbers row-major, centre (12) = 0 (FREE)
export function card(code, round = 0) { const r = rng32(hash(code + ':' + round)); const cols = [0, 1, 2, 3, 4].map(c => shuffle(Array.from({ length: 15 }, (_, i) => c * 15 + i + 1), r).slice(0, 5)); const out = [];
  for (let row = 0; row < 5; row++) for (let c = 0; c < 5; c++) out.push(row === 2 && c === 2 ? 0 : cols[c][row]); return out; }
export const sequence = (roomId, round) => shuffle(Array.from({ length: 75 }, (_, i) => i + 1), rng32(hash(roomId + '#' + round)));
export const LINES = [...[0, 1, 2, 3, 4].map(r => [0, 1, 2, 3, 4].map(c => r * 5 + c)), ...[0, 1, 2, 3, 4].map(c => [0, 1, 2, 3, 4].map(r => r * 5 + c)), [0, 6, 12, 18, 24], [4, 8, 12, 16, 20]];
export function winningLine(cardNums, called, daubed = null) { const ok = i => cardNums[i] === 0 || (called.has(cardNums[i]) && (!daubed || daubed.has(i))); return LINES.find(l => l.every(ok)) || null; }
export function canDaub(cardNums, called, i) { return cardNums[i] !== 0 && called.has(cardNums[i]); }
export class BingoRoom {
  constructor({ id = 'bingo-1', speed = 'fast', now = Date.now() } = {}) { Object.assign(this, { id, speed }); this.players = new Map(); this.waiting = []; this.links = []; this.botN = 0; this.round = 0; this.start = now; this.winners = []; this.wonAt = null; this.log = []; }
  get callMs() { return SPEEDS[this.speed] || SPEEDS.fast; }
  humans() { return [...this.players.values()].filter(p => !p.bot); } bots() { return [...this.players.values()].filter(p => p.bot); }
  // v51: mid-round human joiners are queued (bot-held) and seated from the start of the NEXT round. Bots / pre-round joins seat now.
  add(code, o = {}) { if (this.players.has(code)) return this.players.get(code); if ((this.waiting || []).some(w => w.code === code)) return this.waiting.find(w => w.code === code);
    const p = { code, name: o.name || code, bot: !!o.bot, minor: !!o.minor, adult: !o.minor, daubed: new Set([12]), wins: 0, queued: false };
    const mid = !p.bot && this.calledCount(o.now ?? Date.now()) > 1; // round already calling balls
    if (mid) { p.queued = true; (this.waiting ||= []).push(p); this.fillBots(); return p; }
    this.players.set(code, p); if (!p.bot) this.fillBots(); return p; }
  remove(code) { this.waiting = (this.waiting || []).filter(w => w.code !== code); const p = this.players.get(code); if (!p) return; this.players.delete(code); if (!p.bot) this.fillBots(); }
  fillBots(minPop = 8) { const want = Math.max(0, Math.min(minPop - this.humans().length, (this.cap ?? ROOM_CAP) - this.humans().length)); while (this.bots().length > want) this.remove(this.bots().pop().code); while (this.bots().length < want) this.add('BOT-' + (++this.botN), { bot: true, name: 'bot ' + this.botN }); return this.bots().length; }
  calledCount(now = Date.now()) { if (this.wonAt != null) return this.frozen; return Math.min(75, 1 + Math.floor((now - this.start) / this.callMs)); }
  called(now = Date.now()) { return new Set(sequence(this.id, this.round).slice(0, this.calledCount(now))); }
  current(now = Date.now()) { const s = sequence(this.id, this.round); return s[this.calledCount(now) - 1]; }
  cardOf(code) { return card(code, this.round); }
  daub(code, i, now = Date.now()) { const p = this.players.get(code); if (!p || this.wonAt != null) return false; if (!canDaub(this.cardOf(code), this.called(now), i)) return false; p.daubed.add(i); return true; }
  claim(code, now = Date.now()) { const p = this.players.get(code); if (!p) return { ok: false, reason: 'not-in-room' }; if (this.wonAt != null && !this.winners.includes(code) && now - this.wonAt > 1500) return { ok: false, reason: 'round-over' };
    const l = winningLine(this.cardOf(code), this.called(now), p.daubed); if (!l) return { ok: false, reason: 'no-bingo' };
    if (this.wonAt == null) { this.frozen = this.calledCount(now); this.wonAt = now; } if (!this.winners.includes(code)) { this.winners.push(code); p.wins++; this.log.push({ code, text: '🎉 BINGO!' }); } return { ok: true, line: l }; }
  newRound(now = Date.now()) { this.round++; this.start = now; this.winners = []; this.wonAt = null; this.frozen = 0; this.lastN = null;
    // Seat queued mid-round joiners (replace a bot first) so they start the new round from the beginning.
    for (const w of [...(this.waiting || [])]) { this.waiting = this.waiting.filter(x => x.code !== w.code); delete w.queued; w.daubed = new Set([12]);
      if (this.players.size >= (this.cap ?? ROOM_CAP)) { const b = this.bots().pop(); if (b) this.players.delete(b.code); }
      this.players.set(w.code, w); }
    for (const p of this.players.values()) p.daubed = new Set([12]); this.fillBots(); }
  step(rng = Math.random, now = Date.now()) { const ev = []; const n = this.calledCount(now);
    if (this.wonAt != null) { if (now - this.wonAt > NEXT_MS) { this.newRound(now); ev.push({ t: 'reset' }); } return ev; }
    if (n !== this.lastN) { this.lastN = n; ev.push({ t: 'call', n: this.current(now) }); }
    if (n >= 75 && now - this.start > 75 * this.callMs + NEXT_MS) { this.newRound(now); ev.push({ t: 'reset' }); return ev; }
    const called = this.called(now);
    for (const b of this.bots()) { const c = this.cardOf(b.code); c.forEach((v, i) => { if (v && called.has(v) && !b.daubed.has(i) && rng() < 0.5) b.daubed.add(i); }); if (winningLine(c, called, b.daubed) && rng() < 0.35) { const r = this.claim(b.code, now); if (r.ok) ev.push({ t: 'bingo', who: b.code }); } }
    return ev; }
  leaderboard() { const seated = [...this.players.values()].sort((a, b) => b.wins - a.wins).map((p, i) => ({ rank: i + 1, code: p.code, name: p.name, bot: p.bot, wins: p.wins })); const wait = (this.waiting || []).map(p => ({ rank: null, code: p.code, name: p.name, bot: false, wins: p.wins || 0, queued: true })); return seated.concat(wait); }
}
export const meta = { id: 'bingo', name: 'Bingo', modes: ['mass'], kind: 'mass', cap: ROOM_CAP };
