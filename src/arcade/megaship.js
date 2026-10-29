// UI name: "Mega Fleet" (Mega Battleship) — v36 redesign: KING-OF-THE-HILL SPACE ARENA (snake.io-style growth).
// Every player flies one ship on a giant square map (MAP units), steering freely (analog heading, always moving) and
// shooting. Shooting ASTEROIDS makes you grow (mass); shooting other SHIPS down steals a share of their mass. The biggest
// ship is king (leaderboard). Mass is capped at MAX_MASS = 5000.
// DAMAGE SCALING: a shot deals dmg(mass) = 1 .. 60 (grows with ship mass), an asteroid of tier k has TIERS[k].hp, so
// shotsNeeded(mass, k) = ceil(hp / dmg): a tiny ship one-shots small rocks, needs dozens of shots for the huge ones, and a
// max-size ship one-shots even the biggest (dmg(5000) = 60 = hp of the largest tier).
// STREAMING: the map is split into CHUNK x CHUNK cells; each chunk's asteroids are generated deterministically from
// (seed, chunk) and only exist while a player (human or bot) is near it (ACTIVE_PAD around their view), so the live
// asteroid count stays modest no matter how big the map is. Destroyed asteroids respawn after RESPAWN_S.
// ROOMS: FleetRoom has the InstanceManager room interface (players, humans(), bots(), add, remove, fillBots, links):
// bots fill the room up to MIN_POP when there aren't enough humans and step aside when a human joins.
// NETWORK (megafleet-ui.js): each client simulates its room locally; humans broadcast their own ship (pos/heading/mass)
// and their shots; the VICTIM's client decides hits on itself (and reports the kill to the shooter for the mass reward);
// asteroid destruction is broadcast so every peer drops the same rock. Asteroid layout is seed-deterministic.
import { mulberry32, hashStr } from './engine.js';
export const MAP = 6000, CHUNK = 300, MIN_MASS = 10, MAX_MASS = 5000, MIN_POP = 10, DT = 1 / 30, RESPAWN_S = 40, SHIP_RESPAWN_S = 1.5, FIRE_CD = 0.22;
export const TIERS = [{ r: 6, hp: 1, gain: 2 }, { r: 12, hp: 4, gain: 5 }, { r: 22, hp: 12, gain: 14 }, { r: 40, hp: 30, gain: 36 }, { r: 70, hp: 60, gain: 90 }];
export const DECAY = 0.0025; // per second, above DECAY_FROM: big ships slowly shed mass, so the hill stays contested
const DECAY_FROM = 150;
const TIER_W = [0.42, 0.28, 0.16, 0.09, 0.05];
export const clampMass = m => Math.max(MIN_MASS, Math.min(MAX_MASS, m));
export const radius = m => 3 + 1.05 * Math.sqrt(m);                                 // 10 -> 6.3, 5000 -> 77
export const speed = m => 95 - 45 * Math.log(m / MIN_MASS) / Math.log(MAX_MASS / MIN_MASS); // units/s: 95 -> 50
export const turnRate = m => 4.2 - 2.2 * Math.log(m / MIN_MASS) / Math.log(MAX_MASS / MIN_MASS); // rad/s
export const dmg = m => 1 + 59 * Math.pow((clampMass(m) - MIN_MASS) / (MAX_MASS - MIN_MASS), 0.55);
export const shotsNeeded = (m, tier) => Math.ceil(TIERS[tier].hp / dmg(m) - 1e-9);
export const shipHp = m => 3 + m / 10;
export const viewRadius = m => 240 + radius(m) * 7;                                   // camera zooms out as you grow
export const shotSpeed = m => 330 + radius(m) * 2.5, shotLife = m => 1.1 + radius(m) / 90, shotR = m => 1.6 + radius(m) * 0.09;
export const SPAWN_SHIELD_S = 3; const ACTIVE_PAD = 200, wrapA = a => Math.atan2(Math.sin(a), Math.cos(a));
// deterministic chunk content: 1..3 asteroids per chunk
export function chunkRocks(seed, cx, cy) { const r = mulberry32((hashStr(seed + ':' + cx + ':' + cy)) >>> 0), n = 1 + Math.floor(r() * 3), out = [];
  for (let i = 0; i < n; i++) { let u = r(), k = 0; while (k < 4 && u > TIER_W[k]) { u -= TIER_W[k]; k++; } const T = TIERS[k];
    out.push({ key: cx + ',' + cy + ',' + i, tier: k, bx: cx * CHUNK + T.r + r() * (CHUNK - 2 * T.r), by: cy * CHUNK + T.r + r() * (CHUNK - 2 * T.r), ph: r() * 6.283, w: 0.05 + r() * 0.12, amp: 8 + r() * 22, spin: (r() - 0.5) * 1.2, hp: T.hp, r: T.r }); }
  return out; }
export const rockPos = (a, t) => [a.bx + Math.cos(t * a.w + a.ph) * a.amp, a.by + Math.sin(t * a.w * 0.8 + a.ph) * a.amp];
export class FleetRoom {
  constructor({ id = 'megaship-1', seed = 1, minPop = MIN_POP } = {}) { Object.assign(this, { id, seed, minPop }); this.players = new Map(); this.links = []; this.botN = 0; this.t = 0; this.tick = 0;
    this.chunks = new Map(); this.dead = new Map(); this.shots = []; this.events = []; this.rng = mulberry32((hashStr(id) ^ seed) >>> 0); this.shotN = 0; }
  humans() { return [...this.players.values()].filter(p => !p.bot); } bots() { return [...this.players.values()].filter(p => p.bot); }
  add(code, o = {}) { if (this.players.has(code)) return this.players.get(code); const p = { code, name: o.name || code, bot: !!o.bot, remote: !!o.remote, minor: !!o.minor, adult: !o.minor, score: 0, kills: 0, deaths: 0, hue: hashStr(code) % 360 };
    this.players.set(code, p); this.spawn(p, o.near); if (!p.bot) this.fillBots(); return p; }
  remove(code) { const p = this.players.get(code); if (!p) return; this.players.delete(code); if (!p.bot) this.fillBots(); }
  fillBots(minPop = this.minPop) { const want = Math.max(0, Math.min(minPop - this.humans().length, (this.cap ?? Infinity) - this.humans().length));
    while (this.bots().length > want) this.remove(this.bots().pop().code);
    while (this.bots().length < want) { const h = this.humans()[0]; this.add('BOT-' + (++this.botN), { bot: true, name: 'bot ' + this.botN, near: h && h.alive ? h : null }); } return this.bots().length; }
  spawn(p, near = null) { const r = this.rng; let x, y; if (near) { const a = r() * 6.283, d = 350 + r() * 900; x = near.x + Math.cos(a) * d; y = near.y + Math.sin(a) * d; } else { x = MAP * (0.3 + r() * 0.4); y = MAP * (0.3 + r() * 0.4); }
    Object.assign(p, { x: Math.max(50, Math.min(MAP - 50, x)), y: Math.max(50, Math.min(MAP - 50, y)), h: r() * 6.283, aim: null, turnIn: 0, fire: false, cd: 0, mass: p.bot ? MIN_MASS * (1 + Math.floor(r() * 40)) : MIN_MASS, alive: true, respawnAt: null, spawnT: this.t });
    p.hp = shipHp(p.mass); p.bot && (p.brain = { tgt: null, think: 0, wander: r() * 6.283 }); }
  input(code, i = {}) { const p = this.players.get(code); if (!p) return false; if (typeof i.a === 'number' && isFinite(i.a)) { p.aim = wrapA(i.a); p.turnIn = 0; } if (i.t === -1 || i.t === 0 || i.t === 1) { p.turnIn = i.t; if (i.t) p.aim = null; } if ('fire' in i) p.fire = !!i.fire; return true; }
  // remote human state (from their own client)
  remoteState(code, s) { const p = this.players.get(code); if (!p || !p.remote) return; for (const k of ['x', 'y', 'h', 'mass', 'hp', 'alive', 'score', 'kills']) if (k in s) p[k] = s[k]; p.seenAt = this.t; }
  remoteShot(code, s) { const p = this.players.get(code); if (!p) return; this.shots.push({ id: code + ':' + s.n, by: code, x: s.x, y: s.y, vx: s.vx, vy: s.vy, life: s.life, r: s.r, dmg: s.dmg, remote: true }); }
  // ---- asteroid streaming
  stream() { const want = new Set();
    for (const p of this.players.values()) { if (!p.alive) continue; const R = viewRadius(p.mass) + ACTIVE_PAD; const x0 = Math.max(0, Math.floor((p.x - R) / CHUNK)), x1 = Math.min(MAP / CHUNK - 1, Math.floor((p.x + R) / CHUNK)), y0 = Math.max(0, Math.floor((p.y - R) / CHUNK)), y1 = Math.min(MAP / CHUNK - 1, Math.floor((p.y + R) / CHUNK));
      for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) want.add(cx + ',' + cy); }
    for (const k of this.chunks.keys()) if (!want.has(k)) this.chunks.delete(k);                    // stream OUT
    for (const k of want) if (!this.chunks.has(k)) { const [cx, cy] = k.split(',').map(Number); this.chunks.set(k, chunkRocks(this.seed, cx, cy)); } // stream IN
    for (const [k, until] of this.dead) if (this.t >= until) this.dead.delete(k); }
  rocks() { const out = []; for (const list of this.chunks.values()) for (const a of list) if (!this.dead.has(a.key)) out.push(a); return out; }
  rocksNear(x, y, R) { const out = [], x0 = Math.max(0, Math.floor((x - R) / CHUNK)), x1 = Math.floor((x + R) / CHUNK), y0 = Math.max(0, Math.floor((y - R) / CHUNK)), y1 = Math.floor((y + R) / CHUNK);
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) for (const a of this.chunks.get(cx + ',' + cy) || []) if (!this.dead.has(a.key)) out.push(a); return out; }
  killRock(key) { this.dead.set(key, this.t + RESPAWN_S); }
  grow(p, by) { const before = p.mass; p.mass = clampMass(p.mass + by); const hp0 = shipHp(before); p.hp = Math.min(shipHp(p.mass), p.hp + (shipHp(p.mass) - hp0) + by * 0.05); p.score = Math.round(p.mass);
    if (Math.floor(Math.log2(p.mass / MIN_MASS)) > Math.floor(Math.log2(before / MIN_MASS))) this.emit({ t: 'grow', who: p.code, mass: p.mass }); }
  emit(e) { (this.inStep ? this.events : (this.carry ||= [])).push(e); } // events raised between steps (taps, net) surface on the next step
  fireShot(p) { const m = p.mass, R = radius(m), sp = shotSpeed(m), n = ++this.shotN; const s = { id: p.code + ':' + n, n, by: p.code, x: p.x + Math.cos(p.h) * R * 1.1, y: p.y + Math.sin(p.h) * R * 1.1, vx: Math.cos(p.h) * sp, vy: Math.sin(p.h) * sp, life: shotLife(m), r: shotR(m), dmg: dmg(m) };
    this.shots.push(s); this.emit({ t: 'shot', who: p.code, shot: s }); return s; }
  leaderboard(n = 10) { return [...this.players.values()].sort((a, b) => b.mass - a.mass || (a.code < b.code ? -1 : 1)).slice(0, n).map((p, i) => ({ rank: i + 1, code: p.code, name: p.name, bot: p.bot, mass: Math.round(p.mass) })); }
  step(dt = DT) { if (typeof dt !== 'number' || !(dt > 0)) dt = DT; this.t += dt; this.tick++; this.events = this.carry || []; this.carry = []; this.inStep = true; if (this.tick % 15 === 1) this.stream();
    for (const p of this.players.values()) { if (!p.alive) { if (!p.remote && p.respawnAt != null && this.t >= p.respawnAt) { const near = this.humans().find(h => h.alive && h !== p); this.spawn(p, p.bot ? near : null); this.events.push({ t: 'respawn', who: p.code }); } continue; }
      if (p.remote) continue; if (p.bot) this.think(p, dt); if (p.mass > DECAY_FROM) { p.mass = Math.max(DECAY_FROM, p.mass - p.mass * DECAY * dt); p.score = Math.round(p.mass); p.hp = Math.min(p.hp, shipHp(p.mass)); }
      const tr = turnRate(p.mass) * dt; if (p.turnIn) p.h = wrapA(p.h + p.turnIn * tr); else if (p.aim != null) { const d = wrapA(p.aim - p.h); p.h = wrapA(p.h + Math.max(-tr, Math.min(tr, d))); }
      const v = speed(p.mass); p.x += Math.cos(p.h) * v * dt; p.y += Math.sin(p.h) * v * dt; const R = radius(p.mass);
      if (p.x < R || p.x > MAP - R || p.y < R || p.y > MAP - R) { p.x = Math.max(R, Math.min(MAP - R, p.x)); p.y = Math.max(R, Math.min(MAP - R, p.y)); p.h = wrapA(Math.atan2(MAP / 2 - p.y, MAP / 2 - p.x)); } // soft wall: bounce toward the middle
      p.cd -= dt; if (p.fire && p.cd <= 0) { p.cd = FIRE_CD; this.fireShot(p); } }
    const keep = [];
    for (const s of this.shots) { s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt; if (s.life <= 0) continue; let used = false; const shooter = this.players.get(s.by);
      for (const a of this.rocksNear(s.x, s.y, 80)) { const [ax, ay] = rockPos(a, this.t); if ((ax - s.x) ** 2 + (ay - s.y) ** 2 > (a.r + s.r) ** 2) continue; used = true; a.hp -= s.dmg;
        this.events.push({ t: 'rockhit', by: s.by, key: a.key, tier: a.tier, x: ax, y: ay, left: Math.max(0, a.hp) });
        if (a.hp <= 1e-9) { this.killRock(a.key); this.events.push({ t: 'rock', by: s.by, key: a.key, tier: a.tier, x: ax, y: ay }); if (shooter && !shooter.remote && shooter.alive) this.grow(shooter, TIERS[a.tier].gain); } break; }
      if (!used) for (const q of this.players.values()) { if (!q.alive || q.code === s.by || q.remote || this.t - q.spawnT < SPAWN_SHIELD_S) continue; const R = radius(q.mass); if ((q.x - s.x) ** 2 + (q.y - s.y) ** 2 > (R + s.r) ** 2) continue; used = true; q.hp -= s.dmg;
        this.events.push({ t: 'hit', by: s.by, victim: q.code, x: s.x, y: s.y });
        if (q.hp <= 0) { q.alive = false; q.deaths++; q.respawnAt = this.t + SHIP_RESPAWN_S; const loot = 10 + q.mass * 0.4; this.events.push({ t: 'kill', by: s.by, victim: q.code, x: q.x, y: q.y, mass: q.mass, loot });
          if (shooter && !shooter.remote) { shooter.kills++; this.grow(shooter, loot); } q.mass = MIN_MASS; q.hp = shipHp(MIN_MASS); } break; }
      if (!used) keep.push(s); }
    this.shots = keep; this.inStep = false; return this.events; }
  // bot brain: farm asteroids it can clear quickly, hunt smaller ships, run from much bigger ones
  think(p, dt) { const b = p.brain, r = this.rng; b.think -= dt; const R = viewRadius(p.mass) * 0.9;
    if (b.think <= 0) { b.think = 0.35 + r() * 0.4; let best = null, bs = Infinity, threat = null;
      for (const q of this.players.values()) { if (q === p || !q.alive) continue; const d = Math.hypot(q.x - p.x, q.y - p.y); if (d > R) continue;
        if (q.mass > p.mass * 1.6 && d < R * 0.6) threat = q; else if (q.mass < p.mass * 0.8 && q.mass > p.mass * 0.12 && this.t - q.spawnT > SPAWN_SHIELD_S && d < bs * 0.7) { best = { ship: q }; bs = d * 0.7; } }
      for (const a of this.rocksNear(p.x, p.y, R)) { const [ax, ay] = rockPos(a, this.t), d = Math.hypot(ax - p.x, ay - p.y), cost = d * (0.6 + shotsNeeded(p.mass, a.tier) * 0.35) / (1 + a.tier * 0.3); if (cost < bs) { bs = cost; best = { rock: a }; } }
      b.tgt = best; b.flee = threat; b.wander += (r() - 0.5) * 1.4; }
    let tx = null, ty = null; if (b.flee?.alive) { p.aim = Math.atan2(p.y - b.flee.y, p.x - b.flee.x); p.fire = r() < 0.5; return; }
    if (b.tgt?.ship?.alive) { tx = b.tgt.ship.x; ty = b.tgt.ship.y; } else if (b.tgt?.rock && !this.dead.has(b.tgt.rock.key)) { [tx, ty] = rockPos(b.tgt.rock, this.t); }
    if (tx == null) { p.aim = b.wander; p.fire = false; return; } const a = Math.atan2(ty - p.y, tx - p.x), d = Math.hypot(tx - p.x, ty - p.y); p.aim = a + (p.persona ?? 0);
    p.fire = Math.abs(wrapA(a - p.h)) < 0.25 && d < shotSpeed(p.mass) * shotLife(p.mass) * 0.9; }
}
export const meta = { id: 'megaship', name: 'Mega Fleet', modes: ['mass'], kind: 'mass' };
// ---- legacy names kept so older imports (arcade-ui's grid-world path, space3d.js) still resolve; the grid Mega Fleet is retired.
export const MAX_SHOTS = 10, VISION = 7, signShot = s => s;
export const megaship = { name: 'megaship', spawn() {}, despawn() {}, step() {}, fire: () => false, receiveShot: () => ({ ok: false, reason: 'retired' }), visibleShips: () => [] };
