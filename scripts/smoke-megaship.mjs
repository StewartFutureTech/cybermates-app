// Mega Fleet (Mega Battleship, v36 king-of-the-hill space arena) smoke: damage scaling vs asteroid size, mass cap,
// camera zoom with size, asteroid streaming (in/out around players only, modest count), ship kills + respawn + loot,
// leaderboard order, bot fill + bots step aside, InstanceManager 100 cap. node scripts/smoke-megaship.mjs
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const MS = await import('../src/arcade/megaship.js'), I = await import('../src/arcade/instance.js');
const T = MS.TIERS.length - 1;
assert(MS.shotsNeeded(MS.MIN_MASS, 0) === 1 && MS.shotsNeeded(MS.MIN_MASS, 1) <= 4, 'tiny ship clears small asteroids easily (1 shot)');
assert(MS.shotsNeeded(MS.MIN_MASS, T) >= 30 && MS.shotsNeeded(60, T) > 10, `small ship cannot one-tap huge asteroids (${MS.shotsNeeded(MS.MIN_MASS, T)} shots)`);
assert(MS.TIERS.every((_, k) => MS.shotsNeeded(MS.MAX_MASS, k) === 1), 'max-size ship one-shots even the biggest asteroid');
let mono = true; for (let m = 10; m < 5000; m += 37) for (let k = 0; k <= T; k++) if (MS.shotsNeeded(m + 37, k) > MS.shotsNeeded(m, k)) mono = false; assert(mono, 'shots needed never rise as you grow');
assert(MS.TIERS.every((t, k) => !k || (t.r > MS.TIERS[k - 1].r && t.hp > MS.TIERS[k - 1].hp)), 'asteroid tiers: bigger = more hp');
assert(MS.viewRadius(5000) > MS.viewRadius(10) * 2.5 && MS.radius(5000) > MS.radius(10) * 8, 'camera zooms out as you grow; hull grows');
const r = new MS.FleetRoom({ id: 'mf-test', seed: 7 }); const me = r.add('ME', { name: 'me' });
assert(r.bots().length === MS.MIN_POP - 1 && r.humans().length === 1, `bots fill the room (${r.bots().length} bots)`);
r.add('H2'); assert(r.bots().length === MS.MIN_POP - 2, 'a joining human replaces a bot');
r.grow(me, 1e9); assert(me.mass === MS.MAX_MASS, 'mass capped at 5000'); me.mass = MS.MIN_MASS; me.hp = MS.shipHp(me.mass);
r.step(); const n0 = r.rocks().length, ch0 = r.chunks.size; assert(n0 > 0 && n0 < 400 && ch0 < (MS.MAP / MS.CHUNK) ** 2 / 2, `asteroids streamed only around players (${n0} rocks in ${ch0}/${(MS.MAP / MS.CHUNK) ** 2} chunks)`);
// stream out: move everyone to one corner
for (const p of r.players.values()) { p.x = 100; p.y = 100; } for (let i = 0; i < 16; i++) r.step(); const keys = [...r.chunks.keys()].map(k => k.split(',').map(Number)); assert(keys.every(([x, y]) => x < 6 && y < 6), 'chunks far from every player are streamed out');
assert(JSON.stringify(MS.chunkRocks(7, 3, 4)) === JSON.stringify(MS.chunkRocks(7, 3, 4)), 'chunk content is seed-deterministic (same rocks on every peer)');
// shooting an asteroid grows you; it respawns later
{ const q = new MS.FleetRoom({ id: 'mf-2', seed: 3, minPop: 0 }), p = q.add('P'); q.step(); const a = q.rocks().find(x => x.tier === 0) || q.rocks()[0]; const [ax, ay] = MS.rockPos(a, q.t);
  p.x = ax - 40; p.y = ay; p.h = 0; p.aim = 0; const m0 = p.mass, need = MS.shotsNeeded(p.mass, a.tier); let fired = 0; for (let i = 0; i < 200 && !q.dead.has(a.key); i++) { const [bx, by] = MS.rockPos(a, q.t); p.x = bx - 40; p.y = by; p.h = 0; if (i % 10 === 0) { q.fireShot(p); fired++; } q.step(); }
  assert(q.dead.has(a.key) && p.mass > m0 && fired === need, `asteroid destroyed after ${fired} shot(s) (needed ${need}), mass ${m0} -> ${p.mass.toFixed(1)}`);
  q.t += MS.RESPAWN_S + 1; q.stream(); assert(!q.dead.has(a.key), 'destroyed asteroid respawns'); }
// player kill: loot + respawn
{ const q = new MS.FleetRoom({ id: 'mf-3', seed: 5, minPop: 0 }), A = q.add('A'), B = q.add('B'); q.t = 10; A.mass = MS.MAX_MASS; B.mass = 200; B.hp = MS.shipHp(200); B.spawnT = 0;
  A.x = 3000; A.y = 3000; A.h = 0; B.x = 3000 + MS.radius(A.mass) + 30; B.y = 3000; q.chunks.clear(); q.stream = () => {}; let k = null; for (let i = 0; i < 60 && !k; i++) { if (i % 8 === 0) { A.h = Math.atan2(B.y - A.y, B.x - A.x); q.fireShot(A); } k = q.step().find(e => e.t === 'kill') || null; B.x = 3000 + MS.radius(A.mass) + 30; B.y = 3000; }
  assert(k && k.victim === 'B' && k.by === 'A' && !B.alive && B.mass === MS.MIN_MASS && A.kills === 1, 'players can shoot each other down (victim resets to min mass)');
  for (let i = 0; i < 60; i++) q.step(); assert(B.alive, 'shot-down player respawns'); const lb = q.leaderboard(); assert(lb[0].code === 'A' && lb[0].rank === 1, 'leaderboard ranks the biggest first'); }
// rooms: cap + bots
const L = new I.InstanceManager({ gameName: 'megaship', factory: id => new MS.FleetRoom({ id }) }); for (let i = 0; i < 101; i++) L.join('U' + i); assert(L.list.length === 2 && L.list[0].players.size <= 100, 'sub-maps cap at 100 and split');
let t0 = Date.now(); const big = new MS.FleetRoom({ id: 'perf' }); big.add('ME'); for (let i = 0; i < 900; i++) big.step(); const ms = (Date.now() - t0) / 900; assert(ms < 4, `sim step ${ms.toFixed(2)} ms (30 Hz budget ok)`);
assert(MS.meta.name === 'Mega Fleet', "UI name is 'Mega Fleet'");
console.log('MEGA FLEET SMOKE OK');
