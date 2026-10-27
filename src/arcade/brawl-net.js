// BRAWL NET (v42, NETWORKING ONLY): several humans play one Brawl free-for-all over the existing arcade mesh, reusing the
// v36 host-rotation + join-anytime layer (hostrot-net.js bindMatch: 'hr' batched signed heartbeats/handoff/claim, 'tbl'
// adverts, 'join'/'seat', 'leave', 'rm', RTT probes, vanished-player eviction). Gameplay rules, visuals and the solo
// game are untouched: this file only moves the existing BrawlMatch (games/brawl.js) state between peers.
//
// AUTHORITY: the current rotation HOST runs the real sim (BrawlMatch.tick: AI seats, physics, hit proposals, signing for
//   its local victims = AI seats + itself). Every other human is a REPLICA: it predicts with the same step() between host
//   snapshots, applies its own taps/charges at once (client prediction) and re-applies its not-yet-acked inputs on top of
//   each snapshot (reconciliation). Host hand-off / failover resumes from the freshest snapshot (handoff: getState();
//   failover: replicas keep rot.snap fresh from the fast lane), so the round goes on with the same scores.
// FAST LANE ('arc' envelopes with mid = match id, separate from the 250 ms 'hr' batches):
//   'bs' host -> all : compact quantised state snapshot every SNAP_EVERY ticks (10 Hz; 5 Hz without WebCrypto Ed25519),
//                      signed by the host's rotation key over [mid, epoch, round, s]; replicas accept only the CURRENT
//                      host of the CURRENT epoch, newest tick only.
//   'bi' human -> host: one signed input ({mid, seat, seq, tick, act}, games/brawl.js signInput body), strictly
//                      increasing seq per seat (carried across host rotation in the snapshot), seat must be the sender's.
//   'bh' victim -> host: victim-signed hit for a proposal the host made (games/brawl.js hitBody). The host only accepts
//                      a hit it actually proposed (same hid/att/vic/dmg/tick/knockback), from the victim seat's owner,
//                      within LATE_T ticks; an attacker can still never award itself damage.
// BOUNDS: every inbound fast-lane packet is size-capped (LIMITS) and per-sender token-bucketed (IN_RATE / HIT_RATE);
//   outbound snapshots are trimmed to LIMITS.snap (oldest balls/pending/events dropped from the WIRE copy only); arrays are
//   capped (CAPS); verification runs on one serial queue capped at 64 jobs. Well under the mesh RxGate game budget
//   (60 msgs/s/sender, 16 KB/packet). Never mixes age bands (bindMatch refuses cross-band joins).
import nacl from 'tweetnacl';
import { b64, unb64 } from '../vault.js';
import * as B from './games/brawl.js';
import { HostRotation } from './host-rotation.js';
import { bindMatch } from './hostrot-net.js';

export const GAME = 'brawl', MODE = 'ffa6';
export const SNAP_EVERY = 3, SNAP_EVERY_SLOW = 6, OVER_SNAPS = 5;
export const LIMITS = { snap: 4096, input: 400, hit: 600 }, CAPS = { balls: 32, beams: 12, pending: 36, events: 12, say: 6, resolved: 64, pend: 32 };
export const IN_RATE = { rate: 15, burst: 15 }, HIT_RATE = { rate: 30, burst: 30 }, LATE_T = B.ACK_T * 2, MAX_QUEUE = 64;
const te = new TextEncoder(), CH = B.ROSTER.map(r => r.id), FXK = ['tp', 'punch', 'ball', 'beam', 'spawn'], KIND = ['punch', 'ball', 'beam'], OPS = new Set(['tap', 'charge', 'release']);
const q2 = v => Math.round((+v || 0) * 100) / 100, q3 = v => Math.round((+v || 0) * 1000) / 1000, q4 = v => Math.round((+v || 0) * 1e4) / 1e4;
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0), int = v => Math.trunc(num(v)), seatOk = i => Number.isInteger(i) && i >= 0 && i < B.SEATS;
const clip = (s, n = 24) => String(s ?? '').slice(0, n), okTheme = t => (typeof t === 'string' && /^[a-z0-9-]{1,24}$/.test(t) ? t : null);
const rosterName = c => (B.ROSTER.find(r => r.id === c) || B.ROSTER[0]).name;
export const size = o => { try { return JSON.stringify(o).length; } catch { return Infinity; } };
const bucket = (clock = Date.now) => { const m = new Map(); return (k, { rate, burst }, t = clock()) => { let b = m.get(k); if (!b) { if (m.size > 256) m.delete(m.keys().next().value); b = { tok: burst, t }; m.set(k, b); } b.tok = Math.min(burst, b.tok + (t - b.t) * rate / 1000); b.t = t; if (b.tok < 1) return false; b.tok--; return true; }; };

// ---- keys: AI seat keys are deterministic from the match id (same derivation as BrawlMatch), so ANY peer that becomes host
// can drive + victim-sign for AI seats; human keys are per-match random seeds that never leave their device.
export const aiSeed = (id, s) => nacl.hash(te.encode(id + '|seat|' + s + '|')).slice(0, 32);
const PKCS8 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
const SUB = () => globalThis.crypto?.subtle || null, pubKeys = new Map();
async function wcPub(pub) { if (pubKeys.has(pub)) return pubKeys.get(pub); let k = null; try { k = await SUB().importKey('raw', unb64(pub), { name: 'Ed25519' }, false, ['verify']); } catch {} if (pubKeys.size > 64) pubKeys.delete(pubKeys.keys().next().value); pubKeys.set(pub, k); return k; }
export async function wcPair(seed, pub) { if (!SUB() || !seed) return null; try { const priv = await SUB().importKey('pkcs8', new Uint8Array([...PKCS8, ...seed]), { name: 'Ed25519' }, false, ['sign']), k = await wcPub(pub); return k ? { priv, pub: k } : null; } catch { return null; } }
export async function edSign(bytes, { priv = null, sk = null } = {}) { if (priv) try { return b64(new Uint8Array(await SUB().sign({ name: 'Ed25519' }, priv, bytes))); } catch {} return b64(nacl.sign.detached(bytes, sk)); }
export async function edVerify(bytes, sig, pub) { if (typeof sig !== 'string' || typeof pub !== 'string' || sig.length > 100) return false;
  try { const k = SUB() ? await wcPub(pub) : null; if (k) return await SUB().verify({ name: 'Ed25519' }, k, unb64(sig), bytes); } catch {}
  try { return nacl.sign.detached.verify(bytes, unb64(sig), unb64(pub)); } catch { return false; } }
export const snapBytes = (mid, e, r, s) => te.encode(JSON.stringify([mid, e, r, s]));

// ---- compact state (quantised; the host keeps full precision, replicas render the quantised copy)
export function encode(m, { trim = true } = {}) { const st = m.st, k = st.tick, keepFrom = k - B.ACK_T * 2;
  const res = []; for (const hid of st.resolved) if (parseInt(hid, 10) >= keepFrom) res.push(hid);
  const s = { k, rt: st.roundT, o: st.over ? 1 : 0, n: st.nid,
    f: st.f.map(p => [Math.max(0, CH.indexOf(p.char)), q2(p.x), q2(p.y), q2(p.vx), q2(p.vy), p.hp, q2(p.charge), p.charging ? 1 : 0, q2(p.aim?.[0]), q2(p.aim?.[1]), p.tpCd, p.punchCd, p.shield, p.ko, p.deaths, p.lastHit, p.face,
      p.fx ? [FXK.indexOf(p.fx.k), p.fx.t, p.fx.to ?? -1, q2(p.fx.from?.[0]), q2(p.fx.from?.[1])] : 0]),
    b: st.balls.slice(-CAPS.balls).map(b => [b.id, b.own, q2(b.x), q2(b.y), q2(b.vx), q2(b.vy), q2(b.r), b.dmg, q2(b.kb), b.life]),
    m: st.beams.slice(-CAPS.beams).map(x => [x.id, x.own, q2(x.x), q2(x.y), q4(x.dx), q4(x.dy), x.t, Object.keys(x.hit || {}).reduce((a, i) => a | (1 << +i), 0)]),
    p: st.pending.slice(-CAPS.pending).map(h => [h.hid, h.tick, h.att, h.vic, KIND.indexOf(h.kind), h.dmg, q3(h.kx), q3(h.ky)]),
    x: res.slice(-CAPS.resolved),
    e: (m.recent || []).slice(-CAPS.events).map(e => [e.k === 'ko' ? 1 : 0, e.t, e.att, e.vic, e.dmg || 0, clip(e.kind, 2)]),
    y: (m.say || []).slice(-CAPS.say).map(x => [x.seat, Math.max(0, B.TAUNTS.indexOf(x.text)), x.t]),
    q: m.seats.map(x => x.lastSeq || 0) };
  if (trim) for (const key of ['b', 'e', 'p', 'x', 'm']) while (size(s) > LIMITS.snap && s[key].length) s[key].shift(); // bounded wire size
  return s; }
export function valid(s) { if (!s || typeof s !== 'object' || !Number.isInteger(s.k) || s.k < 0 || !Array.isArray(s.f) || s.f.length !== B.SEATS || !s.f.every(x => Array.isArray(x) && x.length === 18)) return false;
  for (const [key, cap] of [['b', CAPS.balls], ['m', CAPS.beams], ['p', CAPS.pending], ['x', CAPS.resolved], ['e', CAPS.events], ['y', CAPS.say]]) if (!Array.isArray(s[key]) || s[key].length > cap) return false;
  return Array.isArray(s.q) && s.q.length === B.SEATS && s.p.every(h => Array.isArray(h) && typeof h[0] === 'string' && h[0].length <= 40) && s.x.every(h => typeof h === 'string' && h.length <= 40); }
// decode INTO an existing state object (renderers hold references to st.f entries' fields only per frame, so in-place is fine)
export function decodeInto(st, s) { st.tick = s.k; st.roundT = int(s.rt) || st.roundT; st.over = !!s.o; st.nid = int(s.n);
  s.f.forEach((a, i) => { const p = st.f[i], fx = Array.isArray(a[17]) && FXK[a[17][0]] ? { k: FXK[a[17][0]], t: int(a[17][1]), ...(a[17][0] === 1 && seatOk(a[17][2]) ? { to: a[17][2] } : {}), ...(a[17][0] === 0 ? { from: [num(a[17][3]), num(a[17][4])] } : {}) } : null;
    Object.assign(p, { seat: i, char: CH[a[0]] || p.char, x: num(a[1]), y: num(a[2]), vx: num(a[3]), vy: num(a[4]), hp: num(a[5]), charge: num(a[6]), charging: !!a[7], aim: [num(a[8]), num(a[9])], tpCd: int(a[10]), punchCd: int(a[11]), shield: int(a[12]), ko: int(a[13]), deaths: int(a[14]), lastHit: seatOk(a[15]) ? a[15] : -1, face: a[16] < 0 ? -1 : 1, fx }); });
  st.balls = s.b.filter(b => Array.isArray(b) && seatOk(b[1])).map(b => ({ id: int(b[0]), own: b[1], x: num(b[2]), y: num(b[3]), vx: num(b[4]), vy: num(b[5]), r: num(b[6]), dmg: int(b[7]), kb: num(b[8]), life: int(b[9]) }));
  st.beams = s.m.filter(x => Array.isArray(x) && seatOk(x[1])).map(x => { const hit = {}; for (let i = 0; i < B.SEATS; i++) if (int(x[7]) & (1 << i)) hit[i] = 1; return { id: int(x[0]), own: x[1], x: num(x[2]), y: num(x[3]), dx: num(x[4]), dy: num(x[5]), t: int(x[6]), hit }; });
  st.pending = s.p.filter(h => seatOk(h[2]) && seatOk(h[3]) && KIND[h[4]]).map(h => ({ hid: h[0], tick: int(h[1]), att: h[2], vic: h[3], kind: KIND[h[4]], dmg: int(h[5]), kx: num(h[6]), ky: num(h[7]) }));
  st.resolved = new Set(s.x); st.events = []; st.unacked = []; return st; }

// ---- the Match-shaped adapter bindMatch (hostrot-net.js) drives: seats, join/leave, auth snapshot/restore, rematch.
export class BrawlTable {
  constructor({ match, code, me = {}, theme = null, mySeed = null }) { Object.assign(this, { m: match, code, mySeed, game: GAME, mode: MODE }); this.myTheme = okTheme(theme);
    this.me = { name: clip(me.name) || 'You', minor: !!me.minor || (me.age != null && me.age !== '' && Number(me.age) < 18), age: me.age ?? null }; this.round = 0; this.pendingHumans = []; this.props = new Map(); this.pend = []; this.seen = new Set(); this.lastK = -1; this.aiWc = []; this.myWc = null; this.onSeats = null; this.onEvent = null; }
  get id() { return this.m.id; } get seats() { return this.m.seats; } get st() { return this.m.st; } get over() { return !!this.m.st.over; }
  mySeat() { return this.m.seats.findIndex(s => !s.ai && s.code === this.code); }
  myKeys() { return this.mySeed ? nacl.sign.keyPair.fromSeed(this.mySeed) : null; }
  myPub() { const k = this.myKeys(); return k ? b64(k.publicKey) : null; }
  seatKey() { return this.m.seats.map(s => s.ai ? '-' : `${s.code}:${s.theme || ''}:${s.name}`).join('|'); }
  // solo start: seat 0 is me (BrawlMatch already made its key from mySeed)
  claimSeat0() { Object.assign(this.m.seats[0], { code: this.code, name: this.me.name, minor: this.me.minor, age: this.me.age, theme: this.myTheme, local: true }); return this; }
  async ready() { if (SUB()) { this.aiWc = await Promise.all(this.m.seats.map((_, s) => { const seed = aiSeed(this.id, s); return wcPair(seed, b64(nacl.sign.keyPair.fromSeed(seed).publicKey)); })); if (this.mySeed) this.myWc = await wcPair(this.mySeed, this.myPub()); } this._wc(); return this; }
  _wc() { if (!this.aiWc.length) { if (this.m.seats.some(s => !s.ai && !s.local)) this.m.wc = null; return; } // no WebCrypto: tweetnacl path (seat sk)
    const w = this.m.seats.map((s, i) => s.ai ? this.aiWc[i] : (s.code === this.code ? this.myWc : null)); this.m.wc = w.every((k, i) => k || !this.m.seats[i].local) ? w : null; }
  _setAI(i) { const s = this.m.seats[i], seed = aiSeed(this.id, i), kp = nacl.sign.keyPair.fromSeed(seed);
    Object.assign(s, { seat: i, ai: true, code: undefined, minor: undefined, age: undefined, theme: undefined, name: rosterName(this.m.st.f[i].char), pub: b64(kp.publicKey), sk: kp.secretKey, seed, seq: 0, lastSeq: 0, local: true, skill: 0.5 + ((seed >> i) & 7) / 16 }); }
  _setHuman(i, p) { const s = this.m.seats[i], mine = p.code === this.code, kp = mine ? this.myKeys() : null, same = !s.ai && s.code === p.code;
    Object.assign(s, { seat: i, ai: false, code: clip(p.code, 64), name: mine ? this.me.name : clip(p.name) || 'Player', minor: mine ? this.me.minor : !!p.minor, age: mine ? this.me.age : (p.age ?? null), theme: mine ? this.myTheme : okTheme(p.theme), pub: kp ? b64(kp.publicKey) : clip(p.pub, 64), sk: kp?.secretKey || null, seed: mine ? this.mySeed : null, local: mine, lastSeq: same ? s.lastSeq || 0 : 0, seq: same || mine ? s.seq || 0 : 0 }); }
  _spawn(i, char) { const st = this.m.st, f = st.f[i]; // a joiner takes the AI's fighter as a fresh spawn (same rule as a respawn)
    if (CH.includes(char) && char !== f.char) { const j = st.f.findIndex(x => x.char === char); if (j >= 0 && this.m.seats[j].ai) { st.f[j].char = f.char; this.m.seats[j].name = rosterName(f.char); f.char = char; } }
    const [x, y] = B.SPAWNS[i]; Object.assign(f, { x, y, vx: 0, vy: 0, hp: B.HP, charge: 0, charging: false, shield: B.SPAWN_SHIELD, ko: 0, deaths: 0, lastHit: -1, fx: { k: 'spawn', t: st.tick } }); }
  _changed(before) { this._wc(); if (before !== this.seatKey()) this.onSeats?.(); }
  join(p) { const S = this.m.seats; if (!p?.code) return { ok: false, reason: 'bad' }; if (S.some(s => !s.ai && s.code === p.code)) return { ok: true, already: true };
    if (this.over) return { ok: false, reason: 'over' }; const i = S.findIndex(s => s.ai); if (i < 0) return { ok: false, reason: 'full' };
    const before = this.seatKey(); this._setHuman(i, p); this._spawn(i, p.char); this._changed(before); return { ok: true, seated: 'now', seat: i }; }
  leaveSeat(code) { const i = this.m.seats.findIndex(s => !s.ai && s.code === code); if (i < 0) return null; const before = this.seatKey(); this._setAI(i); this._changed(before); return i; } // AI takes over the fighter mid-round
  receive() { return { ok: false, reason: 'realtime' }; } // Brawl inputs use the 'bi' fast lane, not 'mv'
  snapshotAuth() { return JSON.parse(JSON.stringify({ r: this.round, s: this.m.seats.map(s => s.ai ? { ai: 1 } : { code: s.code, name: s.name, minor: !!s.minor, age: s.age ?? null, theme: s.theme || null, pub: s.pub }), g: encode(this.m) })); }
  restoreAuth(a) { if (!a || !Array.isArray(a.s) || a.s.length !== B.SEATS) return false; const before = this.seatKey(), newRound = Number.isInteger(a.r) && a.r !== this.round;
    if (newRound) this._newRound(a.r, a.g);
    a.s.forEach((x, i) => { const s = this.m.seats[i]; if (x?.ai) { if (!s.ai) this._setAI(i); } else if (x && typeof x.code === 'string' && typeof x.pub === 'string') { if (s.ai || s.code !== x.code || (x.code !== this.code && s.pub !== x.pub)) this._setHuman(i, x); else if (x.code !== this.code) Object.assign(s, { name: clip(x.name) || s.name, theme: okTheme(x.theme) }); } });
    if (a.g && valid(a.g)) this.applyState(a.g, { force: newRound }); this._changed(before); return true; }
  _newRound(r, g) { const m = this.m, chars = g?.f?.map(x => CH[x[0]]) || m.st.f.map(p => p.char);
    m.st = B.init({ seed: m.st.seed, chars, roundT: int(g?.rt) || m.st.roundT }); m.signed = new Map(); m.inflight = new Map(); m.say = []; m.recent = []; this.round = r; this.props.clear(); this.pend = []; this.lastK = -1;
    m.seats.forEach((s, i) => { if (s.ai) s.name = rosterName(m.st.f[i].char); }); }
  rematch() { this._newRound(this.round + 1, null); return this; }
  hostSession(opts) { const t = this; return (this.rot = new HostRotation({ ...opts, getState: () => t.snapshotAuth(), setState: (snap, seq) => { t.restoreAuth(snap); opts.onSync?.(snap, seq); } })); }
  // replica: newest host snapshot wins; then my unacked inputs are re-applied on top (client prediction)
  applyState(s, { force = false } = {}) { if (!valid(s) || (!force && s.k <= this.lastK)) return false; const m = this.m; decodeInto(m.st, s); this.lastK = s.k;
    s.q.forEach((q, i) => { const x = m.seats[i]; if (!x.ai && Number.isInteger(q)) { x.lastSeq = Math.max(x.lastSeq || 0, q); if (x.code === this.code) x.seq = Math.max(x.seq || 0, q); } });
    m.say = s.y.filter(y => seatOk(y?.[0])).map(y => ({ seat: y[0], text: B.TAUNTS[y[1]] || B.TAUNTS[0], t: int(y[2]) }));
    for (const e of s.e) { if (!Array.isArray(e) || !seatOk(e[2]) || !seatOk(e[3])) continue; const ev = e[0] ? { k: 'ko', t: int(e[1]), att: e[2], vic: e[3] } : { k: 'hit', t: int(e[1]), att: e[2], vic: e[3], dmg: int(e[4]), kind: clip(e[5], 2) }, key = `${ev.k}:${ev.t}:${ev.att}:${ev.vic}`;
      if (this.seen.has(key)) continue; this.seen.add(key); if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value); m.recent.push(ev); this.onEvent?.(ev); }
    m.recent = m.recent.filter(e => s.k - e.t < 30);
    const me = this.mySeat(), acked = me >= 0 ? s.q[me] || 0 : Infinity; this.pend = this.pend.filter(x => x.seq > acked && s.k - x.tick < 60);
    for (const x of this.pend) B.input(m.st, me, x.act); return true; }
  predict() { const m = this.m, st = m.st; if (st.over) return st; const keep = st.pending, res = st.resolved; B.step(st); st.pending = keep; st.resolved = res; st.unacked = []; st.events = [];
    m.say = m.say.filter(x => st.tick - x.t < 75); m.recent = m.recent.filter(e => st.tick - e.t < 30); return st; }
  // host bookkeeping: proposals we made (to check victims' 'bh'), and drop signed hits that are not ours any more (new round/host)
  record() { const st = this.m.st; for (const h of st.pending) if (!this.props.has(h.hid)) this.props.set(h.hid, h); if (this.props.size > 160 || st.tick % 15 === 0) for (const [k, h] of this.props) if (st.tick - h.tick > LATE_T + 2) this.props.delete(k); }
  purge() { for (const k of this.m.signed.keys()) if (!this.props.has(k)) this.m.signed.delete(k); }
}

// ---- bind a BrawlTable to the mesh: rotation/join/leave via bindMatch + the brawl fast lane.
export function bindBrawl({ table, arcade, code, secretKey, roster, initial = null, timers = globalThis, now, hbMs, termMs, onHost = () => {}, onSeats = () => {}, onEvent = null }) {
  const m = table.m, take = bucket(now || Date.now), stats = { snapsSent: 0, snapsApplied: 0, snapsDropped: 0, inputsSent: 0, inputsApplied: 0, inputsDropped: 0, hitsSent: 0, hitsApplied: 0, hitsDropped: 0, maxOut: 0, maxIn: 0 };
  table.onSeats = onSeats; if (onEvent) table.onEvent = onEvent; let closed = false, n = 0, overSnaps = 0, snapBusy = false, chain = Promise.resolve(), queued = 0, outChain = Promise.resolve();
  const send = env => { if (closed) return; const e = { ...env, mid: table.id }; stats.maxOut = Math.max(stats.maxOut, size(e)); arcade?.send?.(e); };
  const hr = bindMatch({ match: table, arcade, code, secretKey, roster, initial, timers, ...(now ? { now } : {}), ...(hbMs ? { hbMs } : {}), ...(termMs ? { termMs } : {}),
    onHost: (h, e, why) => { if (h !== code) { m.signed = new Map(); m.inflight = new Map(); } else table.lastK = -1; onHost(h, e, why); }, onJoin: () => onSeats(), onLeave: () => onSeats(), onSync: () => {} });
  const serial = fn => { if (queued >= MAX_QUEUE) return false; queued++; chain = chain.then(fn).catch(() => {}).then(() => { queued--; }); return true; };
  const acked = new Set();
  const ackMine = () => { const me = table.mySeat(); if (me < 0) return; for (const h of m.st.pending) { if (h.vic !== me || acked.has(h.hid)) continue; acked.add(h.hid); if (acked.size > 256) acked.delete(acked.values().next().value);
      if (!B.victimResolve(m.st, table.id, h, null, true)) continue; const body = { mid: table.id, hid: h.hid, att: h.att, vic: h.vic, dmg: h.dmg, kx: h.kx, ky: h.ky, tick: h.tick };
      edSign(te.encode(B.hitBody(body)), { priv: table.myWc?.priv, sk: m.seats[me].sk }).then(sig => { send({ op: 'bh', sh: { ...body, sig } }); stats.hitsSent++; }).catch(() => {}); } };
  const onFast = (from, b) => { if (closed || from === code || b?.mid !== table.id || !['bi', 'bh', 'bs'].includes(b.op)) return; const r = hr.rot, sz = size(b); stats.maxIn = Math.max(stats.maxIn, sz);
    if (b.op === 'bi') { const sm = b.sm, s = m.seats[sm?.seat];
      if (!r.isHost) return; if (sz > LIMITS.input || !s || s.ai || s.code !== from || sm.mid !== table.id || !Number.isInteger(sm.seq) || !Number.isInteger(sm.tick) || !OPS.has(sm.act?.op) || !take('i:' + from, IN_RATE)) return void stats.inputsDropped++;
      const act = { op: sm.act.op, x: num(sm.act.x), y: num(sm.act.y) };
      if (!serial(async () => { const ok = await edVerify(te.encode(B.inBody(sm)), sm.sig, s.pub); if (!ok || s.ai || s.code !== from || sm.seq <= (s.lastSeq || 0)) return void stats.inputsDropped++; s.lastSeq = sm.seq; if (B.input(m.st, sm.seat, act)) stats.inputsApplied++; })) stats.inputsDropped++; return; }
    if (b.op === 'bh') { const sh = b.sh, s = m.seats[sh?.vic], h = sh && table.props.get(sh.hid);
      if (!r.isHost) return; if (sz > LIMITS.hit || !s || s.ai || s.code !== from || sh.mid !== table.id || !take('h:' + from, HIT_RATE) || !h || typeof sh.kx !== 'number' || typeof sh.ky !== 'number' || h.vic !== sh.vic || h.att !== sh.att || h.dmg !== sh.dmg || h.tick !== sh.tick || Math.abs(h.kx - sh.kx) > 0.002 || Math.abs(h.ky - sh.ky) > 0.002 || m.st.resolved.has(sh.hid) || m.st.tick - h.tick > LATE_T) return void stats.hitsDropped++;
      if (!serial(async () => { const ok = await edVerify(te.encode(B.hitBody(sh)), sh.sig, s.pub); if (!ok || s.code !== from || !r.isHost || m.st.resolved.has(sh.hid) || !table.props.has(sh.hid)) return void stats.hitsDropped++;
        m.signed.set(sh.hid, { mid: sh.mid, hid: sh.hid, att: h.att, vic: h.vic, dmg: h.dmg, kx: sh.kx, ky: sh.ky, tick: h.tick, sig: sh.sig }); stats.hitsApplied++; })) stats.hitsDropped++; return; }
    if (b.op === 'bs') { const pub = r.roster.get(from);
      if (r.isHost) return; if (from !== r.host || b.e !== r.epoch || !pub || sz > LIMITS.snap + 256 || !valid(b.s) || b.r !== table.round) return void stats.snapsDropped++;
      if (!serial(async () => { const ok = await edVerify(snapBytes(table.id, b.e, b.r, b.s), b.sig, pub); if (!ok || r.isHost || from !== r.host || b.e !== r.epoch || b.r !== table.round) return void stats.snapsDropped++;
        if (table.applyState(b.s)) { stats.snapsApplied++; r.snap = { ...(r.snap || table.snapshotAuth()), g: b.s }; ackMine(); } })) stats.snapsDropped++; } };
  const unsub = arcade?.sub?.(onFast);
  const sendSnap = () => { if (snapBusy) return; const s = encode(m), e = hr.rot.epoch, rd = table.round; snapBusy = true;
    edSign(snapBytes(table.id, e, rd, s), { priv: table.myWc?.priv, sk: secretKey }).then(sig => { snapBusy = false; if (hr.rot.isHost && hr.rot.epoch === e) { send({ op: 'bs', e, r: rd, s, sig }); stats.snapsSent++; } }).catch(() => { snapBusy = false; }); };
  const api = { hr, rot: hr.rot, table, stats,
    get isHost() { return hr.rot.isHost; }, peers: () => hr.rot.roster.size, soloHost: () => hr.rot.roster.size < 2 && m.seats.filter(s => !s.ai).length <= 1,
    tick() { if (closed) return m.st; const r = hr.rot; let st;
      if (r.isHost || r.roster.size < 2) { table.purge(); st = m.tick(); table.record();
        if (r.roster.size >= 2 && ++n % (table.myWc ? SNAP_EVERY : SNAP_EVERY_SLOW) === 0) { if (!st.over) overSnaps = 0; if (!st.over || overSnaps++ < OVER_SNAPS) sendSnap(); } }
      else st = table.predict();
      hr.tick(); return m.st; },
    act(a) { const me = table.mySeat(), r = hr.rot; if (closed || me < 0 || !a || !OPS.has(a.op)) return false;
      if (r.isHost || r.roster.size < 2) return m.act(me, a);
      if (!take('out', IN_RATE)) { stats.inputsDropped++; return false; }
      const s = m.seats[me], msg = { mid: table.id, seat: me, seq: ++s.seq, tick: m.st.tick, act: { op: a.op, x: q2(a.x), y: q2(a.y) } };
      B.input(m.st, me, msg.act); table.pend.push(msg); if (table.pend.length > CAPS.pend) table.pend.shift(); // predict now
      outChain = outChain.then(() => edSign(te.encode(B.inBody(msg)), { priv: table.myWc?.priv, sk: s.sk })).then(sig => { send({ op: 'bi', sm: { ...msg, sig } }); stats.inputsSent++; }).catch(() => {}); return true; },
    requestRematch: () => hr.requestRematch(),
    leave() { if (closed) return; hr.leave(); closed = true; unsub?.(); },
    stop() { if (closed) return; hr.stop(); closed = true; unsub?.(); } };
  return api;
}
// Joiner: like hostrot-net joinTable, plus my theme (so same-theme players get distinct shades) and fighter pick.
export function joinBrawl({ arcade, table, p, timeoutMs = 3000, timers = globalThis }) { return new Promise(res => { let done = false, unsub = null, h = null;
  const fin = v => { if (done) return; done = true; unsub?.(); if (h) timers.clearTimeout?.(h); res(v); };
  unsub = arcade?.sub?.((from, b) => { if (b?.op === 'seat' && b.mid === table.mid && b.to === p.code && from === table.from) fin(b.r?.ok && b.snap ? b : null); });
  h = timers.setTimeout?.(() => fin(null), timeoutMs);
  arcade?.send?.({ op: 'join', mid: table.mid, p: { code: p.code, name: clip(p.name), minor: !!p.minor, age: p.age ?? null, pub: p.pub, theme: okTheme(p.theme), char: CH.includes(p.char) ? p.char : null } }); }); }
// join-anytime tie-break between two tables: join a table that already has other humans, or (both solo) the lower id.
export const shouldJoin = (t, myId, seats = B.SEATS) => !!t && t.mid !== myId && (t.open < seats - 1 || t.mid < myId);
