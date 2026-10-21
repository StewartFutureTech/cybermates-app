// BRAWL: 6-player free-for-all 2D energy brawler (David: "tap to teleport or punch if close, hold to charge a blast and
// early release to shoot an energy ball. 6 players free for all."). Approved extras: original characters/names (no
// third-party IP), a FULL charge fires a BEAM, knockback, health bars, instant respawn, short-round scoreboard, AI fill,
// victim-resolves hits with signed inputs.
//
// Model (deterministic, fixed 30 Hz tick, seeded RNG only; floats are fine because every peer runs the same JS):
//  - Arena Wd x Hd sim units, side view, fighters float (no gravity) and drift with damping. Walls bounce.
//  - Input actions (per seat): {op:'tap', x, y} | {op:'charge', x, y} | {op:'release', x, y}.
//      tap: if the nearest enemy to the tap point is within PUNCH_R of me -> PUNCH it (melee, knockback);
//           otherwise TELEPORT to the tap point (cooldown TP_CD, short afterimage = speed lines in the renderer).
//      charge: start charging (charge counter grows each tick, capped at FULL).
//      release: charge < FULL -> ENERGY BALL toward (x,y), damage/size scale with charge (early release = small ball);
//               charge == FULL -> BEAM: a wide ray from me toward (x,y) live for BEAM_T ticks.
//  - Hits are only PROPOSED by step() (st.pending). The VICTIM's owner resolves them (victimResolve -> signed hit), and
//    every peer applies a hit only if it carries a valid signature from the victim's key (applyHit). An attacker can
//    therefore never award itself damage on someone else; a victim can only lie in its own disfavour or skip a hit,
//    which the 'resolve deadline' bounds (unacked proposals older than ACK_T ticks are reported as 'dodged-unacked'
//    so moderation can flag chronic non-ackers; they are not applied).
//  - KO at hp <= 0: attacker (last valid hitter) +1 KO, victim +1 death, INSTANT respawn at its spawn with SPAWN_SHIELD
//    ticks of invulnerability. Short round: ROUND_T ticks; result() returns the scoreboard (KOs desc, deaths asc).
import nacl from 'tweetnacl';
import { b64, unb64 } from '../../vault.js';
import { mulberry32, hashStr } from '../engine.js';

export const TICK_HZ = 30, Wd = 200, Hd = 120, SEATS = 6, HP = 100, ROUND_T = 75 * TICK_HZ;
export const PUNCH_R = 16, PUNCH_DMG = 9, PUNCH_KB = 3.2, PUNCH_CD = 9, TP_CD = 14, FULL = 36, MIN_BALL = 3;
export const BALL_SPEED = 3.4, BALL_LIFE = 90, BEAM_T = 10, BEAM_W = 7, BEAM_DMG = 30, BEAM_KB = 6, SPAWN_SHIELD = 30, ACK_T = 15, FR = 4;
// Original characters (names, looks and stats are ours). pow: damage multiplier, chg: charge speed, tp: teleport cooldown mult.
export const ROSTER = [
  { id: 'volt', name: 'Volt Ronin', tag: 'Storm-step swordless samurai', pow: 1.0, chg: 1.0, tp: 1.0 },
  { id: 'nova', name: 'Nova Vex', tag: 'Star-forged blaster', pow: 1.15, chg: 0.9, tp: 1.1 },
  { id: 'kiro', name: 'Kiro Flux', tag: 'Phase-runner', pow: 0.9, chg: 1.0, tp: 0.7 },
  { id: 'ember', name: 'Ember Lyn', tag: 'Plasma monk', pow: 1.05, chg: 1.15, tp: 1.0 },
  { id: 'quill', name: 'Quill Shade', tag: 'Shadow-glass duelist', pow: 0.95, chg: 1.1, tp: 0.85 },
  { id: 'raze', name: 'Raze Orbit', tag: 'Gravity bruiser', pow: 1.25, chg: 0.85, tp: 1.25 },
];
export const SPAWNS = [[30, 30], [100, 20], [170, 30], [30, 90], [100, 100], [170, 90]];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function init({ seed = 1, chars, roundT = ROUND_T } = {}) {
  const f = Array.from({ length: SEATS }, (_, s) => { const c = ROSTER.find(r => r.id === chars?.[s]) || ROSTER[s % ROSTER.length];
    return { seat: s, char: c.id, x: SPAWNS[s][0], y: SPAWNS[s][1], vx: 0, vy: 0, hp: HP, charge: 0, charging: false, aim: [Wd / 2, Hd / 2], tpCd: 0, punchCd: 0, shield: SPAWN_SHIELD, ko: 0, deaths: 0, lastHit: -1, fx: null, face: s < 3 ? 1 : -1 }; });
  return { tick: 0, roundT, f, balls: [], beams: [], pending: [], resolved: new Set(), events: [], unacked: [], seed, nid: 0, over: false }; }

export function input(st, seat, a) { const p = st.f[seat]; if (!p || st.over || !a) return false;
  const x = clamp(+a.x || 0, 0, Wd), y = clamp(+a.y || 0, 0, Hd);
  if (a.op === 'tap') { let best = null, bd = 1e9; for (const q of st.f) if (q !== p) { const d = Math.hypot(q.x - x, q.y - y); if (d < bd) { bd = d; best = q; } }
    if (best && dist(p, best) <= PUNCH_R && bd <= PUNCH_R) { if (p.punchCd > 0) return false; p.punchCd = PUNCH_CD; p.face = Math.sign(best.x - p.x) || p.face; p.fx = { k: 'punch', t: st.tick, to: best.seat };
      if (best.shield <= 0) st.pending.push({ hid: `${st.tick}:p:${seat}:${best.seat}`, tick: st.tick, att: seat, vic: best.seat, kind: 'punch', dmg: Math.round(PUNCH_DMG * pow(p)), kx: Math.sign(best.x - p.x || 1) * PUNCH_KB, ky: Math.sign(best.y - p.y || -1) * PUNCH_KB * 0.4 });
      return true; }
    if (p.tpCd > 0) return false; p.fx = { k: 'tp', t: st.tick, from: [p.x, p.y] }; p.x = x; p.y = y; p.vx = p.vy = 0; p.tpCd = Math.round(TP_CD * charOf(p).tp); p.charging = false; p.charge = 0; return true; }
  if (a.op === 'charge') { p.charging = true; p.aim = [x, y]; return true; }
  if (a.op === 'release') { if (!p.charging) return false; p.charging = false; const c = p.charge; p.charge = 0; p.aim = [x, y];
    let dx = x - p.x, dy = y - p.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L; p.face = Math.sign(dx) || p.face;
    if (c >= FULL) { st.beams.push({ id: ++st.nid, own: seat, x: p.x, y: p.y, dx, dy, t: BEAM_T, hit: {} }); p.fx = { k: 'beam', t: st.tick }; }
    else if (c >= MIN_BALL) { const k = c / FULL; st.balls.push({ id: ++st.nid, own: seat, x: p.x + dx * 4, y: p.y + dy * 4, vx: dx * BALL_SPEED * (1.2 - k * 0.3), vy: dy * BALL_SPEED * (1.2 - k * 0.3), r: 2 + k * 4, dmg: Math.round((6 + 12 * k) * pow(p)), kb: 1.5 + 3 * k, life: BALL_LIFE }); p.fx = { k: 'ball', t: st.tick }; }
    return true; }
  return false; }
const charOf = p => ROSTER.find(r => r.id === p.char) || ROSTER[0], pow = p => charOf(p).pow;

export function step(st) { if (st.over) return st; st.tick++;
  for (const p of st.f) { p.tpCd = Math.max(0, p.tpCd - 1); p.punchCd = Math.max(0, p.punchCd - 1); p.shield = Math.max(0, p.shield - 1);
    if (p.charging) p.charge = Math.min(FULL, p.charge + charOf(p).chg);
    p.x += p.vx; p.y += p.vy; p.vx *= 0.85; p.vy *= 0.85; if (Math.abs(p.vx) < 0.01) p.vx = 0; if (Math.abs(p.vy) < 0.01) p.vy = 0;
    if (p.x < FR || p.x > Wd - FR) { p.vx = -p.vx * 0.6; p.x = clamp(p.x, FR, Wd - FR); } if (p.y < FR || p.y > Hd - FR) { p.vy = -p.vy * 0.6; p.y = clamp(p.y, FR, Hd - FR); } }
  for (const b of st.balls) { b.x += b.vx; b.y += b.vy; b.life--; if (b.x < 0 || b.x > Wd || b.y < 0 || b.y > Hd) b.life = 0;
    for (const q of st.f) if (q.seat !== b.own && b.life > 0 && q.shield <= 0 && Math.hypot(q.x - b.x, q.y - b.y) <= b.r + FR) { const L = Math.hypot(b.vx, b.vy) || 1;
      st.pending.push({ hid: `${st.tick}:b${b.id}:${b.own}:${q.seat}`, tick: st.tick, att: b.own, vic: q.seat, kind: 'ball', dmg: b.dmg, kx: b.vx / L * b.kb, ky: b.vy / L * b.kb }); b.life = 0; } }
  st.balls = st.balls.filter(b => b.life > 0);
  for (const m of st.beams) { const o = st.f[m.own]; m.x = o.x; m.y = o.y; // beam follows its caster
    for (const q of st.f) { if (q.seat === m.own || q.shield > 0) continue; const rx = q.x - m.x, ry = q.y - m.y, along = rx * m.dx + ry * m.dy, perp = Math.abs(rx * m.dy - ry * m.dx);
      if (along > 0 && perp <= BEAM_W / 2 + FR && !m.hit[q.seat]) { m.hit[q.seat] = 1; // one hit per victim per beam (big, single knockback)
        st.pending.push({ hid: `${st.tick}:m${m.id}:${m.own}:${q.seat}`, tick: st.tick, att: m.own, vic: q.seat, kind: 'beam', dmg: Math.round(BEAM_DMG * pow(o)), kx: m.dx * BEAM_KB, ky: m.dy * BEAM_KB }); } }
    m.t--; }
  st.beams = st.beams.filter(m => m.t > 0);
  // proposals nobody acked in time are dropped (not applied) and reported
  st.pending = st.pending.filter(h => { if (st.tick - h.tick > ACK_T && !st.resolved.has(h.hid)) { st.unacked.push(h); return false; } return !st.resolved.has(h.hid); });
  if (st.tick >= (st.roundT || ROUND_T)) st.over = true; return st; }

// ---- victim-resolves hits with signatures
const te = new TextEncoder(), hitBody = h => JSON.stringify([h.mid, h.hid, h.att, h.vic, h.dmg, +h.kx.toFixed(3), +h.ky.toFixed(3), h.tick]);
const inBody = m => JSON.stringify([m.mid, m.seat, m.seq, m.tick, m.act]);
export function signHit(mid, h, victimSecret) { const s = { mid, hid: h.hid, att: h.att, vic: h.vic, dmg: h.dmg, kx: h.kx, ky: h.ky, tick: h.tick }; return { ...s, sig: b64(nacl.sign.detached(te.encode(hitBody(s)), victimSecret)) }; }
export const verifyHit = (h, victimPub) => { try { return nacl.sign.detached.verify(te.encode(hitBody(h)), unb64(h.sig), unb64(victimPub)); } catch { return false; } };
// Victim's own client: re-checks the proposal against ITS state (still alive, not shielded, plausible range) before signing.
export function victimResolve(st, mid, h, victimSecret, checkOnly = false) { const v = st.f[h.vic], a = st.f[h.att]; if (!v || !a || v.shield > 0 || st.resolved.has(h.hid)) return null;
  if (h.kind === 'punch' && dist(a, v) > PUNCH_R + 6) return null; if (h.dmg <= 0 || h.dmg > 40) return null; return checkOnly ? true : signHit(mid, h, victimSecret); }
export function applyHit(st, sh, victimPub) { if (!sh || st.resolved.has(sh.hid) || !verifyHit(sh, victimPub)) return false; return applyVerified(st, sh); }
// apply a hit whose victim signature was ALREADY verified (by applyHit or the WebCrypto fast path)
export function applyVerified(st, sh) { if (st.resolved.has(sh.hid)) return false; const v = st.f[sh.vic]; if (!v || sh.att === sh.vic) return false;
  st.resolved.add(sh.hid); v.hp -= sh.dmg; v.vx += sh.kx; v.vy += sh.ky; v.lastHit = sh.att; v.charging = false; v.charge = 0; st.events.push({ k: 'hit', t: st.tick, att: sh.att, vic: sh.vic, dmg: sh.dmg, kind: (sh.hid.split(':')[1] || '?')[0] });
  if (v.hp <= 0) { const a = st.f[sh.att]; if (a) a.ko++; v.deaths++; st.events.push({ k: 'ko', t: st.tick, att: sh.att, vic: sh.vic });
    const [sx, sy] = SPAWNS[v.seat]; Object.assign(v, { x: sx, y: sy, vx: 0, vy: 0, hp: HP, charge: 0, charging: false, shield: SPAWN_SHIELD, fx: { k: 'spawn', t: st.tick } }); } // INSTANT respawn
  return true; }
// Victim checked the proposal and refused it (shielded / out of range / already respawned): drop it, it is not 'unacked'.
export function declineHit(st, h) { st.resolved.add(h.hid); st.pending = st.pending.filter(x => x.hid !== h.hid); }
// ---- signed inputs
export function signInput(m, secret) { return { ...m, sig: b64(nacl.sign.detached(te.encode(inBody(m)), secret)) }; }
export const verifyInput = (m, pub) => { try { return nacl.sign.detached.verify(te.encode(inBody(m)), unb64(m.sig), unb64(pub)); } catch { return false; } };

export function result(st) { if (!st.over) return null; const board = st.f.map(p => ({ seat: p.seat, char: p.char, ko: p.ko, deaths: p.deaths })).sort((a, b) => b.ko - a.ko || a.deaths - b.deaths || a.seat - b.seat); return { winner: board[0].seat, board }; }

// ---- natural AI: picks a target (grudge on whoever hit it last, else nearest/weakest), dodges incoming balls by
// teleporting, punches in range, otherwise charges (sometimes to a full beam) or teleports close with jitter.
export function ai(st, seat, rng, skill = 0.7) { const p = st.f[seat]; if (!p) return null; const foes = st.f.filter(q => q !== p);
  const grudge = p.lastHit >= 0 && p.lastHit !== seat ? st.f[p.lastHit] : null; const tgt = grudge && rng() < 0.6 ? grudge : foes.reduce((a, q) => (dist(p, q) + q.hp * 0.3 < dist(p, a) + a.hp * 0.3 ? q : a));
  if (rng() > 0.35 + skill * 0.55) return null; // reaction delay / hesitation
  const danger = st.balls.find(b => b.own !== seat && Math.hypot(b.x - p.x, b.y - p.y) < 22 && (b.x - p.x) * b.vx + (b.y - p.y) * b.vy < 0);
  if (danger && p.tpCd === 0 && rng() < skill) return { op: 'tap', x: clamp(p.x + (rng() - 0.5) * 70, 8, Wd - 8), y: clamp(p.y + (rng() < 0.5 ? -1 : 1) * (25 + rng() * 25), 8, Hd - 8) };
  const d = dist(p, tgt), jit = (1 - skill) * 6;
  if (p.charging) { const want = p.beamPlan ? FULL : p.ballPlan; if (p.charge >= want || d < PUNCH_R) { p.beamPlan = false; return { op: 'release', x: tgt.x + (rng() - 0.5) * jit, y: tgt.y + (rng() - 0.5) * jit }; } return null; }
  if (d <= PUNCH_R - 1 && p.punchCd === 0) return { op: 'tap', x: tgt.x, y: tgt.y };
  if (d > 45 && rng() < 0.45) { p.beamPlan = rng() < 0.25; p.ballPlan = MIN_BALL + Math.floor(rng() * 18); return { op: 'charge', x: tgt.x, y: tgt.y }; }
  if (p.tpCd === 0) { const ang = rng() * Math.PI * 2, r = PUNCH_R * (0.5 + rng() * 0.4); return { op: 'tap', x: clamp(tgt.x + Math.cos(ang) * r, 6, Wd - 6), y: clamp(tgt.y + Math.sin(ang) * r, 6, Hd - 6) }; }
  return null; }
// PG trash talk (shown as text bubbles with the AI tag). Never insults identity; just game banter.
export const TAUNTS = ['Too slow!', 'Teleport tag, you\'re it!', 'Was that a punch or a high five?', 'Charging... just kidding!', 'Nice beam. Wrong direction though.', 'GG! Again?', 'My grandma blasts faster!', 'Respawn and try again!', 'Zap! Gotcha.', 'Catch this!'];

// ---- local controller (solo / host): owns AI seats + me, signs everything, runs victim-resolve locally for owned seats.
export class BrawlMatch {
  constructor({ id = 'brawl-' + Date.now(), seed = hashStr(String(id)), humans = [], chars, roundT } = {}) {
    this.id = id; this.rng = mulberry32(seed); this.st = init({ seed, chars, roundT }); this.seats = Array.from({ length: SEATS }, (_, s) => { const h = humans[s];
      const seed = h?.seed || (h?.secretKey ? null : nacl.hash(te.encode(id + '|seat|' + s + '|' + (h ? Math.random() : ''))).slice(0, 32)); // humans get a fresh per-match key
      const kp = h?.secretKey ? { publicKey: h.publicKey, secretKey: h.secretKey } : nacl.sign.keyPair.fromSeed(seed);
      return { seat: s, seed, ai: !h, name: h?.name || ROSTER[this.st.f[s].char === undefined ? s : ROSTER.findIndex(r => r.id === this.st.f[s].char)].name, pub: b64(kp.publicKey), sk: kp.secretKey, seq: 0, local: !h || !!h.local, skill: 0.5 + ((seed >> s) & 7) / 16 }; });
    this.say = []; this.recent = []; this.inflight = new Map(); this.signed = new Map(); }
  pub(seat) { return this.seats[seat].pub; }
  sign(seat, act) { const s = this.seats[seat]; return signInput({ mid: this.id, seat, seq: ++s.seq, tick: this.st.tick, act }, s.sk); }
  // Human inputs travel signed and are verified (sig, match id, seat key, strictly increasing seq). AI seats run on the
  // host and never cross the wire (same rule as match.js: AI moves are local), so they are applied directly — this keeps a
  // 30 Hz tick cheap on phones. Hits are ALWAYS victim-signed (AI victims are signed by the host-held AI seat key).
  accept(m) { const s = this.seats[m?.seat]; if (!s || s.ai || m.mid !== this.id || !verifyInput(m, s.pub) || m.seq <= (s.lastSeq || 0)) return false; s.lastSeq = m.seq; return input(this.st, m.seat, m.act); }
  act(seat, a) { const s = this.seats[seat]; return s?.ai ? input(this.st, seat, a) : this.accept(this.sign(seat, a)); }
  // Fast path for victim signing: native WebCrypto Ed25519 (~0.1 ms) instead of tweetnacl (~6 ms sign / ~14 ms verify,
  // which caused hitches on every hit). Signatures are standard Ed25519, so verifyHit (tweetnacl) still accepts them.
  // Hits are signed asynchronously and applied at the first tick >= proposal tick + APPLY_DELAY once signed+verified,
  // so the result is deterministic as long as signing finishes within the delay (settle() awaits it in tests).
  async ready() { this.wc = await webcryptoKeys(this.seats).catch(() => null); return this; }
  async settle() { await Promise.all([...this.inflight.values()]); }
  tick() { const st = this.st; if (st.over) return st;
    for (const s of this.seats) if (s.ai) { const a = ai(st, s.seat, this.rng, s.skill); if (a) this.act(s.seat, a); }
    step(st);
    for (const h of [...st.pending]) { const v = this.seats[h.vic]; if (!v.local || this.inflight.has(h.hid) || this.signed.has(h.hid)) continue;
      const ok = victimResolve(st, this.id, h, null, true); if (!ok) { declineHit(st, h); continue; }
      if (this.wc) { const body = { mid: this.id, hid: h.hid, att: h.att, vic: h.vic, dmg: h.dmg, kx: h.kx, ky: h.ky, tick: h.tick };
        this.inflight.set(h.hid, wcSignVerify(this.wc[h.vic], body).then(sh => { this.inflight.delete(h.hid); if (sh) this.signed.set(h.hid, sh); }).catch(() => this.inflight.delete(h.hid))); }
      else { const sh = signHit(this.id, h, v.sk); if (verifyHit(sh, v.pub)) this.signed.set(h.hid, sh); } }
    for (const sh of [...this.signed.values()].filter(x => st.tick >= x.tick + APPLY_DELAY).sort((a, b) => a.tick - b.tick || (a.hid < b.hid ? -1 : 1))) { this.signed.delete(sh.hid); applyVerified(st, sh); } // stable order
    for (const e of st.events.splice(0)) { this.onEvent?.(e); this.recent.push(e); if (e.k === 'ko' && this.seats[e.att]?.ai && this.rng() < 0.6) this.say.push({ seat: e.att, text: TAUNTS[Math.floor(this.rng() * TAUNTS.length)], t: st.tick }); }
    this.say = this.say.filter(x => st.tick - x.t < 75); this.recent = this.recent.filter(e => st.tick - e.t < 30); return st; }
}
export const APPLY_DELAY = 2;
const PKCS8 = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
async function webcryptoKeys(seats) { const C = globalThis.crypto?.subtle; if (!C) return null; const out = [];
  for (const s of seats) { if (!s.seed) return null; const priv = await C.importKey('pkcs8', new Uint8Array([...PKCS8, ...s.seed]), { name: 'Ed25519' }, false, ['sign']); const pub = await C.importKey('raw', unb64(s.pub), { name: 'Ed25519' }, false, ['verify']); out.push({ priv, pub }); }
  return out; }
async function wcSignVerify(k, body) { const C = crypto.subtle, data = te.encode(hitBody(body)); const sig = new Uint8Array(await C.sign({ name: 'Ed25519' }, k.priv, data));
  if (!(await C.verify({ name: 'Ed25519' }, k.pub, sig, data))) return null; return { ...body, sig: b64(sig) }; }
export const meta = { id: 'brawl', name: 'Brawl', modes: ['ffa6'], kind: 'realtime', players: SEATS };
