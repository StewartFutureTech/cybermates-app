// Analog steering smoke (Snake + Tron): max turn rate, true circles, keyboard fallback, aim smoothing, input validation,
// lockstep determinism with analog inputs, natural bots, 100-player tick cost, polygon capture, 3D/feel modules present.
import fs from 'node:fs';
let fail = 0; const assert = (c, m) => { if (c) console.log('ok', m); else { console.log('FAIL', m); fail = 1; } };
const E = await import('../src/arcade/engine.js'), A = await import('../src/arcade/analog.js'), { snake, SPEED, TURN } = await import('../src/arcade/snake.js'), T = await import('../src/arcade/tron.js');
// steering math
const p = { h: 0, aim: Math.PI, turnIn: 0 }; const dh = A.steer(p, 0.13); assert(Math.abs(Math.abs(dh) - 0.13) < 1e-9, 'aim far away: turns at exactly the max turn rate');
const q = { h: 0, aim: 0.05, turnIn: 0 }; A.steer(q, 0.13); assert(Math.abs(q.h - 0.05) < 1e-9, 'aim close: snaps onto it (no overshoot/oscillation)');
const k = { h: 0, aim: null, turnIn: -1 }; A.steer(k, 0.13); assert(Math.abs(k.h + 0.13) < 1e-9, 'keyboard ← rotates left at the max rate');
assert(A.validInput({ a: 1.2 }) && A.validInput({ t: -1 }) && A.validInput('up') && !A.validInput({ a: NaN }) && !A.validInput({ t: 3 }) && !A.validInput('sideways'), 'input validation: {a}, {t:-1|0|1}, compass only');
assert(A.segHit(0, 0, 2, 2, 0, 2, 2, 0) && !A.segHit(0, 0, 1, 0, 0, 1, 1, 1), 'segment intersection');
assert(Math.abs(A.polyArea(A.circlePoly(0, 0, 2, 64)) - Math.PI * 4) < 0.1 && A.pointInPoly(0, 0, A.circlePoly(0, 0, 1)) && !A.pointInPoly(2, 0, A.circlePoly(0, 0, 1)), 'polygon area + point-in-polygon');
// true circle: hold a turn in an empty snake world -> closed loop of radius SPEED/TURN
const w = new E.World({ seed: 5, game: snake }); const me = w.add('ME'); w.food = []; w.fillBots(0); const x0 = me.x, y0 = me.y; let minD = 1e9, maxR = 0;
w.input('ME', { t: 1 }, w.tick); const steps = Math.round(2 * Math.PI / TURN); const cx = [], cy = [];
for (let i = 0; i < steps; i++) { w.step(); cx.push(me.x); cy.push(me.y); }
const mx = cx.reduce((a, b) => a + b) / cx.length, my = cy.reduce((a, b) => a + b) / cy.length, rs = cx.map((x, i) => Math.hypot(x - mx, cy[i] - my)), R = SPEED / (2 * Math.sin(TURN / 2));
assert(Math.max(...rs) - Math.min(...rs) < 0.05 && Math.abs(rs[0] - R) < 0.1, `held turn traces a true circle (r ${rs[0].toFixed(2)} ≈ ${R.toFixed(2)}, spread ${(Math.max(...rs) - Math.min(...rs)).toFixed(3)})`);
assert(Math.hypot(me.x - x0, me.y - y0) < SPEED * 1.5, 'full circle returns to the start point');
// world input path
assert(w.input('ME', { a: 2 }) && !w.input('ME', { a: 'x' }), 'World.input accepts analog objects and rejects junk');
// determinism with analog inputs on both games
for (const G of [snake, T.tron]) { const mk = () => { const x = new E.World({ seed: 11, game: G }); x.fillBots(); x.add('P1'); return x; }; const a = mk(), b = mk();
  for (let i = 0; i < 400; i++) { if (i % 37 === 0) { const r = a.input('P1', { a: (i * 0.731) % 6.28 - 3.14 }); b.input(r.code, r.dir, r.tick); } if (i % 91 === 0) { const r = a.input('P1', { t: i % 2 ? 1 : -1 }); b.input(r.code, r.dir, r.tick); } a.step(); b.step(); }
  const sig = x => JSON.stringify([...x.players.values()].map(p => [p.code, p.alive, +p.x.toFixed(6), +p.y.toFixed(6), +p.h.toFixed(6), p.score]));
  assert(sig(a) === sig(b), `${G.name}: lockstep peers agree after 400 analog ticks`); }
// bots: alive, varied, they eat/claim, not suicidal
const bs = new E.World({ seed: 9, game: snake }); bs.fillBots(); let food = 0; for (let i = 0; i < 2500; i++) { bs.step(); food += bs.events.filter(e => e.t === 'food').length; bs.events.length = 0; }
const sd = bs.bots().reduce((s, p) => s + p.deaths, 0); assert(food > 100 && sd < bs.bots().length * 25, `snake bots hunt food (${food} eaten) and die at a human-ish rate (${sd} deaths/100 s)`);
const bt = new E.World({ seed: 9, game: T.tron }); bt.fillBots(); let cl = 0; for (let i = 0; i < 2500; i++) { bt.step(); cl += bt.events.filter(e => e.t === 'claim').length; bt.events.length = 0; }
assert(cl >= 20, `tron bots loop out and claim land (${cl} claims/100 s)`);
const mis = bt.bots().reduce((s, p) => s + (p.persona.mistakes || 0), 0) / bt.bots().reduce((s, p) => s + p.persona.decisions, 0); assert(mis > 0.003 && mis < 0.1, `bot heading mistakes ${(mis * 100).toFixed(1)}%`);
// 100 players: tick cost stays tiny
for (const G of [snake, T.tron]) { const big = new E.World({ seed: 1, game: G }); big.cap = 100; for (let i = 0; i < 30; i++) big.add('H' + i); big.fillBots(100); for (let i = 0; i < 50; i++) big.step(); const t0 = performance.now(); for (let i = 0; i < 300; i++) big.step(); const ms = (performance.now() - t0) / 300;
  assert(big.players.size === 100 && ms < 8, `${G.name}: 100 players, ${ms.toFixed(2)} ms/tick (budget 8 of ${G.tickMs} ms)`); }
// polygon capture override: later claim sits on top + steals cells
const tw = new E.World({ seed: 2, game: T.tron }); const a1 = tw.add('A1'), b1 = tw.add('B1'); tw.fillBots(0); const sA = a1.score; T.tron.fill(tw, b1, A.circlePoly(a1.x, a1.y, 1.5)); assert(a1.score < sA && tw.polys.at(-1).o === 'B1', 'later claims override earlier land (z-order + cell ownership)');
// renderers + feel present, colours from theme
for (const f of ['src/arcade/snake3d.js', 'src/arcade/tron3d.js', 'src/arcade/feel3d.js']) { const s = fs.readFileSync(f, 'utf8'); assert(!/['"`]#[0-9a-fA-F]{3,8}['"`]|\b0x[0-9a-fA-F]{6}\b/.test(s.replace(/\/\/.*$/gm, '')), `${f}: no hard-coded colours`); }
const t3 = fs.readFileSync('src/arcade/tron3d.js', 'utf8'), s3 = fs.readFileSync('src/arcade/snake3d.js', 'utf8'), sc = fs.readFileSync('src/arcade/three-scene.js', 'utf8'), ui = fs.readFileSync('src/arcade-ui.js', 'utf8');
assert(/ShapeGeometry/.test(t3) && /ribbon/.test(t3) && /panel/.test(t3) && /chase\(/.test(t3), 'tron 3D: polygon land, ribbon trails, panel lines, chase camera');
assert(/InstancedMesh/.test(s3) && /pupils/.test(s3) && /chase\(/.test(s3) && /particles\(/.test(s3), 'snake 3D: instanced glowing body, modelled head with eyes, chase camera, particles');
assert(/setTier/.test(sc) && /MAX_DPR/.test(sc) && /bp\.enabled/.test(sc), 'adaptive quality tier (pixel-ratio cap + bloom tiers)');
assert(/gameFx\(/.test(ui) && /onkeyup/.test(ui) && /pointermove/.test(ui) && /requestAnimationFrame/.test(ui), 'UI: sfx/haptics, key hold, pointer steering, interpolated rAF render');
assert(!/orbit\(/.test(t3) && !/orbit\(/.test(s3) && /snakebattle: 'snake'/.test(fs.readFileSync('src/match-ui.js', 'utf8')), 'Snake/Tron (mass + duels): no orbit/drag camera; drag = steering, chase camera auto-follows');
console.log(fail ? 'ANALOG SMOKE FAILED' : 'ALL ANALOG SMOKE OK'); process.exit(fail);
