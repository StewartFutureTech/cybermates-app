// MATCH MODES framework for the Arcade: 1v1 / 2v2 / 4v4 (+ Mass Arena = the existing snake/tron sub-maps).
//  - Matchmaking from the mesh: players queue per (game, mode, AGE BAND). Adults and minors are NEVER seated together
//    (queue key includes the band). Blocked/banned peers are skipped both ways. When a queue has enough humans a match
//    is formed. After BOT_START_MS (15s) a lonely waiter starts a bot match but KEEPS seeking humans; a found human
//    match opens a Join invite (INVITE_MS ~20s accept/decline). Empty seats in a formed match still use AI (honest "· AI" tag).
//  - Teams: seat i -> team i % 2 (turn order alternates teams: A1, B1, A2, B2 …).
//  - Turn-based games: SIGNED MOVE EXCHANGE. Each move = {mid, seq, seat, move, prev} signed (Ed25519, tweetnacl) by the
//    seat's key; prev = hash of the previous signed move (hash chain). Every peer verifies signature, seq, chain, seat to
//    move, and re-validates the move with the game's own legal() before applying — so an illegal or forged move is
//    rejected on BOTH sides. (Draw & Guess is a Mass Arena game: games/drawguess.js DrawRoom in InstanceManager sub-maps.) Real-time games reuse the lockstep engine (engine.js / pong.js) with input relay.
//  - Round chat/voice toggle: per round, easy to flip. Default OFF for chess and the focus games, ON for Draw & Guess
//    (text chat is REQUIRED there and cannot be disabled; voice is optional). Minors' voice is always OFF by default and
//    needs the parent 'proximityVoice' toggle (same gate as arcade proximity voice). Mute / block / report per seat.
//  - Rematch: same seats, colours/sides swapped, fresh state; AI seats re-filled.
import nacl from 'tweetnacl';
import { b64, unb64 } from '../vault.js';
import { band } from './proximity.js';
import * as chess from './games/chess.js';
import * as checkers from './games/checkers.js';
import * as connect4 from './games/connect4.js';
import * as battleship from './games/battleship.js';
import * as uttt from './games/uttt.js';
import * as ttt from './games/ttt.js';
import * as trivia from './games/trivia.js';
import * as drawguess from './games/drawguess.js';
import * as pong from './games/pong.js';
import * as duel from './games/duel.js';
import { mulberry32, hashStr } from './engine.js';
import { HostRotation } from './host-rotation.js';
import { isRealtime } from './join-anytime.js';
export const MODES = { '1v1': 2, '2v2': 4, '4v4': 8 }, FILL_MS = 15000, BOT_START_MS = 15000, INVITE_MS = 20000, CHESS_CLOCK_MS = 5 * 60e3; // v51: 15s bot start (FILL_MS alias), 20s invite timeout
export const GAMES = {
  chess: { mod: chess, ...chess.meta }, checkers: { mod: checkers, ...checkers.meta }, connect4: { mod: connect4, ...connect4.meta }, battleship: { mod: battleship, ...battleship.meta },
  uttt: { mod: uttt, ...uttt.meta }, ttt: { mod: ttt, ...ttt.meta }, tronduel: { mod: duel, ...duel.metaTron }, snakebattle: { mod: duel, ...duel.metaSnake }, pong: { mod: pong, ...pong.meta },
  trivia: { mod: trivia, ...trivia.meta }, drawguess: { mod: drawguess, ...drawguess.meta } };
export const MASS = ['snake', 'tron', 'drawguess', 'megaship']; // megaship = 'Mega Fleet' in the UI // Mass Arena games (sub-maps of up to 100)
export const gamesFor = mode => Object.values(GAMES).filter(g => g.modes.includes(mode));
export const chatDefault = id => ({ text: !!GAMES[id]?.chatRequired, voice: !!GAMES[id]?.chatRequired });
// Per-round chat/voice toggle shared by match games and Mass Arena rooms (Draw & Guess).
export class RoundChat {
  constructor(gameId) { this.gameId = gameId; this.required = !!GAMES[gameId]?.chatRequired; Object.assign(this, chatDefault(gameId)); }
  set(kind, on) { if (kind === 'text' && this.required && !on) return { ok: false, reason: 'chat-required' }; this[kind] = !!on; return { ok: true }; }
  voiceAllowedFor(p, { parentAllows = false } = {}) { return this.voice && (band(p) === 'adult' || parentAllows); }
  // text chat between humans: same age band only (adult/minor separation); blocked/muted dropped; bots never chat freely.
  canMessage(from, to, { isBlocked = () => false, muted = new Set() } = {}) { return this.text && band(from) === band(to) && !isBlocked(from.code) && !muted.has(from.code); }
}
const te = new TextEncoder(), H = s => b64(nacl.hash(te.encode(s)).slice(0, 16));
const body = m => JSON.stringify([m.mid, m.seq, m.seat, m.move, m.prev]);
export function signMove(m, secretKey) { return { ...m, sig: b64(nacl.sign.detached(te.encode(body(m)), secretKey)) }; }
export const verifySig = (m, pub) => { try { return nacl.sign.detached.verify(te.encode(body(m)), unb64(m.sig), unb64(pub)); } catch { return false; } };
export class Match {
  constructor({ id, game, mode, seats, seed = hashStr(id), clockMs = null }) { Object.assign(this, { id, game, mode, seats, seed }); this.g = GAMES[game]; this.round = 0; this.wins = [0, 0]; this.clockMs = clockMs; this.newRound(); }
  get mod() { return this.g.mod; }
  newRound() { const rng = mulberry32(this.seed + this.round * 977), n = this.seats.length;
    this.state = this.g.id === 'tronduel' || this.g.id === 'snakebattle' ? duel.makeArena(this.g.id === 'tronduel' ? 'tron' : 'snake', this.mode, this.seats, this.seed + this.round) : this.mod.init({ seats: n, rng, ai: this.seats.map(s => !!s.ai) }); // ai flags: Star Fleet picks each team's fleet keeper
    this.log = []; this.head = 'genesis:' + this.id + ':' + this.round; this.seq = 0; this.over = null; const prev = this.chat; this.chat = prev ? { ...prev } : chatDefault(this.g.id);
    if (this.g.chatRequired) this.chat.text = true; this.clocks = this.clockMs ? [this.clockMs, this.clockMs] : null; this.turnAt = null; }
  setChat(kind, on) { if (kind === 'text' && this.g.chatRequired && !on) return { ok: false, reason: 'chat-required' }; this.chat[kind] = !!on; return { ok: true, chat: { ...this.chat } }; }
  voiceAllowedFor(seat, { parentAllows = false } = {}) { const s = this.seats[seat]; return this.chat.voice && (band(s) === 'adult' || parentAllows); }
  // --- turn-based: signed, validated, hash-chained
  makeMove(seat, move, secretKey) { return signMove({ mid: this.id, seq: this.seq + 1, seat, move, prev: this.head }, secretKey); }
  receive(sm, now = Date.now()) { if (this.over) return { ok: false, reason: 'over' }; const s = this.seats[sm?.seat]; if (!s) return { ok: false, reason: 'seat' };
    if (sm.mid !== this.id || sm.seq !== this.seq + 1 || sm.prev !== this.head) return { ok: false, reason: 'chain' };
    if (!s.ai && !verifySig(sm, s.pub)) return { ok: false, reason: 'signature' };
    const st = this.state, mod = this.mod; if (!mod.simultaneous && mod.turnSeat(st) !== sm.seat) return { ok: false, reason: 'not-your-turn' };
    const m = mod.legal(st, sm.move, sm.seat); if (!m) return { ok: false, reason: 'illegal' };
    if (this.clocks && this.turnAt != null) { const t = sm.seat % 2; this.clocks[t] -= now - this.turnAt; if (this.clocks[t] <= 0) { this.over = { winner: 1 - t, how: 'time' }; this.wins[1 - t]++; return { ok: false, reason: 'flag' }; } }
    this.turnAt = now; this.state = mod.apply(st, m, sm.seat); this.seq++; this.head = H(body(sm) + sm.sig); this.log.push(sm);
    const r = mod.result(this.state); if (r) { this.over = r; if (!r.draw) this.wins[r.winner]++; } return { ok: true, result: r }; }
  // AI seats: varied skill (seat.skill 0.3-0.9) with natural mistakes: with p = (1-skill)*0.45 the bot plays a random legal
  // move instead of its best one. Trivia: accuracy = skill (answers arrive with human-like delays in the UI loop).
  aiMove(seat, rng = mulberry32(this.seed ^ (this.seq + 1) * 31 ^ seat)) { const s = this.seats[seat], skill = s?.skill ?? 0.6; let mv = null;
    if (this.g.id === 'trivia') { const st = this.state; if (seat in st.ans || st.q >= 10) return null; const right = this.mod.BANK[st.qs[st.q]][2]; mv = { q: st.q, a: rng() < skill ? right : Math.floor(rng() * 4) }; }
    else if (rng() < (1 - skill) * 0.45) mv = randomLegal(this.g.id, this.mod, this.state, seat, rng); // natural mistake
    mv ||= this.mod.ai(this.state, seat, rng); if (!mv) return null; return this.receive({ mid: this.id, seq: this.seq + 1, seat, move: mv, prev: this.head, sig: 'ai' }); }
  // Real players replace AI at the NEXT ROUND (matches never swap mid-round): queueHuman(p) then rematch()/newRound.
  queueHuman(p) { (this.pendingHumans ||= []).push(p); }
  _swapIn() { for (const p of this.pendingHumans || []) { const i = this.seats.findIndex(s => s.ai && band(s) === band(p)); if (i >= 0) this.seats[i] = { ...p, seat: i, team: i % 2 }; } this.pendingHumans = []; }
  // JOIN-ANYTIME: real-time games seat the joiner NOW (takes over an AI seat in place, no protected round);
  // turn-based games queue the ping and seat at the round boundary (rematch/newRound), replacing an AI seat.
  join(p) { if (this.seats.some(s => s.code === p.code)) return { ok: true, already: true };
    if (isRealtime(this.g.id)) { const i = this.seats.findIndex(s => s.ai && band(s) === band(p)); if (i < 0) return { ok: false, reason: 'full' };
      this._reseat(i, p); return { ok: true, seated: 'now', seat: i }; }
    if (this.pendingHumans?.some(x => x.code === p.code)) return { ok: true, already: true, seated: 'next-round', queued: this.pendingHumans.length };
    this.queueHuman(p); return { ok: true, seated: 'next-round', queued: this.pendingHumans.length }; }
  // Seat hand-over in place (AI <-> human). Real-time arenas (World) re-key the SAME player body so the round goes on.
  _reseat(i, p) { const old = this.seats[i]; this.seats[i] = { ...p, seat: i, team: i % 2 }; const W = this.state;
    if (old && W?.players instanceof Map && old.code !== p.code) { const b = W.players.get(old.code); if (b) { W.players.delete(old.code); Object.assign(b, { code: p.code, bot: !!p.ai, name: p.name || p.code }); if (!p.ai) delete b.persona; W.players.set(p.code, b); } }
    return this.seats[i]; }
  // A human left: an AI takes the seat mid-round (game keeps going); a queued joiner is dropped.
  leaveSeat(code) { this.pendingHumans = (this.pendingHumans || []).filter(p => p.code !== code); const i = this.seats.findIndex(s => s.code === code && !s.ai); if (i < 0) return null;
    const s = this.seats[i], n = (this.botN = (this.botN || 0) + 1); return this._reseat(i, { code: `AI-${this.id}-${n}`, name: `bot ${n}`, ai: true, skill: 0.6, minor: band(s) === 'minor' }); }
  // HOST ROTATION: authoritative snapshot = {state, seq, head, round, over, wins}; the rotation layer moves it between hosts.
  // Real-time states (lockstep World / paddle sim) are NOT shipped: only seats/round/score metadata travel; each peer keeps
  // simulating locally (so a hand-off never freezes or rewinds the arena).
  snapshotAuth() { const rt = isRealtime(this.g.id); return JSON.parse(JSON.stringify({ ...(rt ? {} : { state: this.state, seq: this.seq, head: this.head }), round: this.round, over: this.over, wins: this.wins, seats: this.seats.map(({ sec, ...s }) => s) })); }
  restoreAuth(a) { if (!a) return; a = JSON.parse(JSON.stringify(a));
    if (Array.isArray(a.seats) && a.seats.length === this.seats.length) { if (a.round !== this.round) this.seats = a.seats.map((s, i) => ({ ...s, seat: i, team: i % 2 })); else a.seats.forEach((s, i) => { if (s.code !== this.seats[i]?.code) this._reseat(i, s); }); }
    if (a.round !== undefined && a.round !== this.round) { this.round = a.round; if (!('state' in a)) this.newRound(); }
    if ('state' in a) Object.assign(this, { state: a.state, seq: a.seq, head: a.head }); Object.assign(this, { over: a.over ?? null, wins: a.wins || this.wins }); }
  hostSession(opts) { const m = this; return (this.rot = new HostRotation({ ...opts, getState: () => m.snapshotAuth(), setState: (snap, seq) => { m.restoreAuth(snap); opts.onSync?.(snap, seq); } })); }
  rematch() { this._swapIn(); this.round++; this.seats = this.seats.map((s, i, a) => ({ ...a[(i + 1) % a.length], seat: i, team: i % 2 })); this.newRound(); return this; } // sides swap
}
// Matchmaker: queues per game|mode|band; seats humans; after BOT_START_MS starts a bot match but keeps seeking.
// v51 human-while-bot: invite bot-match players to a human table (one pending invite at a time); decline/timeout stays in bot match.
function randomLegal(id, mod, st, seat, rng) { const pick = a => (a.length ? a[Math.floor(rng() * a.length)] : null);
  if (mod.moves) { const ms = mod.moves(st); return pick(ms); }
  if (id === 'connect4') return pick([...Array(7).keys()].filter(c => st.g[c] == null).map(col => ({ col })));
  if (id === 'battleship') { if (st.phase !== 'fire' || st.pending) return null; const sh = st.shots[1 - seat % 2]; return pick([...sh.keys()].filter(i => !sh[i]).map(cell => ({ cell }))); } return null; }
// MESH HUBS: match lobbies (1v1/2v2/4v4 keep their fixed team sizes) are grouped in hubs of up to HUB_CAP = 100 players;
// a full hub opens a new one, hubs are linked (siblings) so players can browse/hop. Matchmaking happens inside a hub.
export const HUB_CAP = 100;
export class Hubs { constructor(cap = HUB_CAP) { this.cap = cap; this.list = []; this.of = new Map(); }
  join(code) { if (this.of.has(code)) return this.of.get(code); let h = this.list.find(h => h.members.size < this.cap); if (!h) { h = { id: 'hub-' + (this.list.length + 1), members: new Set(), links: [] }; this.list.push(h); for (const o of this.list) o.links = this.list.filter(x => x !== o).map(x => x.id); } h.members.add(code); this.of.set(code, h); return h; }
  leave(code) { this.of.get(code)?.members.delete(code); this.of.delete(code); } }
export class Matchmaker {
  constructor({ isBlocked = () => false, isBanned = () => false, now = () => Date.now(), idTag = () => '' } = {}) { Object.assign(this, { isBlocked, isBanned, now, idTag }); this.q = new Map(); this.n = 0; this.matches = new Map(); this.hubs = new Hubs(); this.seeking = new Map(); this.invites = new Map(); }
  key(game, mode, p) { const h = p?.code ? this.hubs.join(p.code).id : 'hub-1'; return `${game}|${mode}|${band(p)}|${h}`; }
  _compat(a, b) { return !this.isBlocked(a.code, b.code) && !this.isBlocked(b.code, a.code) && !this.isBanned(a.code) && !this.isBanned(b.code); }
  enqueue(p, game, mode) { if (!GAMES[game]?.modes.includes(mode) || this.isBanned(p.code)) return { ok: false, reason: 'not-allowed' }; const k = this.key(game, mode, p); const q = this.q.get(k) || this.q.set(k, []).get(k);
    if (!q.some(x => x.code === p.code)) q.push({ ...p, at: this.now(), status: 'searching' }); this.seeking.set(p.code, { game, mode, band: band(p), k, at: this.now() });
    return this.tryForm(k, game, mode) || { ok: true, queued: q.length, status: 'searching' }; }
  dequeue(code) { for (const [k, q] of this.q) this.q.set(k, q.filter(p => p.code !== code)); this.seeking.delete(code); const inv = this.invites.get(code); if (inv) this.invites.delete(code); this.hubs.leave(code); }
  // Build a compatible group from the queue (and optional extra seekers still in bot matches).
  _group(k, need, extra = []) { const q = this.q.get(k) || []; const pool = [...q, ...extra.filter(p => !q.some(x => x.code === p.code))];
    const group = []; for (const p of pool) if (group.every(g => this._compat(g, p))) group.push(p); return group; }
  tryForm(k, game, mode, force = false) { const need = MODES[mode]; const q = this.q.get(k) || [];
    const group = this._group(k, need); const oldest = q.length ? Math.min(...q.map(p => p.at)) : 0;
    const botDue = !!(q.length && this.now() - oldest >= BOT_START_MS);
    if (group.length < need && !(force || botDue)) return null;
    const humans = group.slice(0, Math.min(need, group.length)); if (!humans.length && !force && !botDue) return null;
    // Full human match: only when we have `need` compatible humans (not a forced/bot fill of a loner).
    const fullHuman = humans.length >= need;
    if (!fullHuman && !(force || botDue)) return null;
    this.q.set(k, q.filter(p => !humans.includes(p)));
    const seats = Array.from({ length: need }, (_, i) => humans[i] ? { ...humans[i], seat: i, team: i % 2, status: undefined } : { code: `AI-${++this.n}`, name: `bot ${this.n}`, ai: true, skill: +(0.3 + ((this.n * 0.618) % 1) * 0.6).toFixed(2), seat: i, team: i % 2, minor: band(humans[0] || { age: 30 }) === 'minor' });
    const tag = this.idTag?.() || '', id = `${game}-${mode}-${++this.n}${tag ? '.' + tag : ''}`, m = new Match({ id, game, mode, seats, clockMs: game === 'chess' && humans[0]?.timer ? CHESS_CLOCK_MS : null }); this.matches.set(id, m);
    // Bot match: humans stay seeking so a later human can invite them. Full human match: clear seeking.
    for (const h of humans) { if (fullHuman) this.seeking.delete(h.code); else { const s = this.seeking.get(h.code); if (s) { s.botMatchId = id; s.status = 'bot'; } } }
    return { ok: true, match: m, bot: !fullHuman, seeking: !fullHuman }; }
  // While bot-matched humans are seeking, propose a human invite when enough other searchers appear.
  tick() { const out = { matches: [], invites: [], expired: [] };
    for (const k of [...this.q.keys()]) { const [g, mode] = k.split('|'); const r = this.tryForm(k, g, mode); if (r) out.matches.push(r); }
    // Expire invites
    for (const [code, inv] of [...this.invites]) { if (this.now() >= inv.until) { this.invites.delete(code); out.expired.push(inv); /* decliner stays in bot; others keep searching */ } }
    // Try to invite bot-match seekers when a searching peer is waiting for the same key
    for (const [code, s] of this.seeking) { if (s.status !== 'bot' || !s.botMatchId || this.invites.has(code)) continue;
      const q = this.q.get(s.k) || []; if (!q.length) continue;
      const need = MODES[s.mode]; const botP = { code, ...(this.matches.get(s.botMatchId)?.seats.find(x => x.code === code) || { code }) };
      const group = this._group(s.k, need, [botP]); if (group.length < need) continue;
      // Prefer inviting the bot-match player(s); one pending invite at a time
      const inv = { to: code, game: s.game, mode: s.mode, from: q.map(p => p.code), until: this.now() + INVITE_MS, seats: group.slice(0, need).map(p => p.code), k: s.k };
      this.invites.set(code, inv); out.invites.push(inv); }
    return out; }
  pendingInvite(code) { return this.invites.get(code) || null; }
  acceptInvite(code) { const inv = this.invites.get(code); if (!inv) return { ok: false, reason: 'no-invite' }; this.invites.delete(code);
    // Remove invitees from queue / seeking and form the human match from inv.seats
    const humans = []; const q = this.q.get(inv.k) || [];
    for (const c of inv.seats) { const fromQ = q.find(p => p.code === c); const fromM = this.matches.get(this.seeking.get(c)?.botMatchId)?.seats.find(s => s.code === c);
      const p = fromQ || fromM || { code: c }; if (humans.every(h => this._compat(h, p))) humans.push({ ...p, code: c }); }
    if (humans.length < MODES[inv.mode]) return { ok: false, reason: 'seat-filled' }; // race: seats already taken
    this.q.set(inv.k, q.filter(p => !inv.seats.includes(p.code)));
    for (const c of inv.seats) this.seeking.delete(c);
    const need = MODES[inv.mode];
    const seats = Array.from({ length: need }, (_, i) => humans[i] ? { ...humans[i], seat: i, team: i % 2 } : { code: `AI-${++this.n}`, name: `bot ${this.n}`, ai: true, skill: 0.6, seat: i, team: i % 2 });
    const tag = this.idTag?.() || '', id = `${inv.game}-${inv.mode}-${++this.n}${tag ? '.' + tag : ''}`, m = new Match({ id, game: inv.game, mode: inv.mode, seats }); this.matches.set(id, m);
    return { ok: true, match: m, leftBot: this.seeking.get(code)?.botMatchId || inv.to }; }
  declineInvite(code) { const inv = this.invites.get(code); if (!inv) return { ok: false, reason: 'no-invite' }; this.invites.delete(code);
    // Others keep searching without this player (they're still in q if they were only searching)
    return { ok: true, declined: inv }; }
  peerGone(code) { // queue peer disconnect → reform
    this.dequeue(code); for (const [c, inv] of [...this.invites]) if (inv.from.includes(code) || inv.seats.includes(code) || inv.to === code) this.invites.delete(c);
    return this.tick(); }
}
