// Brawl smoke: controls (tap teleport / punch, hold charge, early-release ball, full-charge beam), knockback, HP, instant
// respawn, round scoreboard, AI fill, signed inputs, victim-resolved signed hits, determinism, original roster, PG taunts.
import nacl from 'tweetnacl';
import * as B from '../src/arcade/games/brawl.js';
import { b64 } from '../src/vault.js';
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const run = (st, n) => { for (let i = 0; i < n; i++) B.step(st); };
// roster
assert(B.ROSTER.length === 6 && new Set(B.ROSTER.map(r => r.name)).size === 6 && !B.ROSTER.some(r => /goku|vegeta|saiyan|dragon|kame|piccolo|frieza|gohan/i.test(r.name + r.tag)), 'six original characters, no third-party IP names');
// tap far = teleport
{ const st = B.init(); st.f.forEach(p => p.shield = 0); assert(B.input(st, 0, { op: 'tap', x: 100, y: 60 }) && st.f[0].x === 100 && st.f[0].y === 60 && st.f[0].fx.k === 'tp', 'tap far from enemies: teleport to tap point');
  assert(!B.input(st, 0, { op: 'tap', x: 10, y: 10 }), 'teleport cooldown enforced'); run(st, B.TP_CD + 1); assert(B.input(st, 0, { op: 'tap', x: 10, y: 10 }), 'teleport again after cooldown'); }
// tap near enemy = punch proposal (not applied until victim resolves)
{ const st = B.init(); st.f.forEach(p => p.shield = 0); Object.assign(st.f[1], { x: st.f[0].x + 8, y: st.f[0].y }); const x0 = st.f[0].x;
  assert(B.input(st, 0, { op: 'tap', x: st.f[1].x, y: st.f[1].y }) && st.f[0].x === x0 && st.pending.length === 1 && st.pending[0].kind === 'punch' && st.f[1].hp === B.HP, 'tap near enemy: punch proposed, attacker stays, no damage yet'); }
// hold charge -> early release = ball; full = beam
{ const st = B.init(); st.f.forEach(p => p.shield = 0); B.input(st, 0, { op: 'charge', x: 150, y: 30 }); run(st, 8); assert(st.f[0].charging && st.f[0].charge >= 8, 'hold: charge builds');
  B.input(st, 0, { op: 'release', x: 150, y: 30 }); assert(st.balls.length === 1 && st.beams.length === 0 && st.balls[0].dmg < 16, 'early release: energy ball (small)');
  B.input(st, 2, { op: 'charge', x: 30, y: 30 }); run(st, B.FULL + 2); assert(st.f[2].charge === B.FULL, 'charge caps at FULL'); B.input(st, 2, { op: 'release', x: 30, y: 30 }); assert(st.beams.length === 1, 'full charge: beam'); }
// signed victim-resolve: attacker cannot award its own hit; forged sig rejected; valid victim sig applies damage + knockback
{ const M = new B.BrawlMatch({ id: 'sm1', humans: [{ name: 'me', local: true }] }); const st = M.st; st.f.forEach(p => p.shield = 0); Object.assign(st.f[1], { x: st.f[0].x + 8, y: st.f[0].y }); M.seats.forEach(s => s.ai = false); // freeze AI for the check
  M.act(0, { op: 'tap', x: st.f[1].x, y: st.f[1].y }); const h = st.pending[0];
  const byAttacker = B.signHit(M.id, h, M.seats[0].sk); assert(!B.applyHit(st, byAttacker, M.pub(1)), 'hit signed by ATTACKER is rejected (victim key required)');
  const forged = { ...B.signHit(M.id, h, M.seats[1].sk), dmg: 99 }; assert(!B.applyHit(st, forged, M.pub(1)), 'tampered hit (damage changed) rejected');
  const ok = B.victimResolve(st, M.id, h, M.seats[1].sk), vx0 = st.f[1].vx; assert(ok && B.applyHit(st, ok, M.pub(1)) && st.f[1].hp === B.HP - h.dmg && st.f[1].vx > vx0, 'victim-signed hit applies damage and knockback');
  assert(!B.applyHit(st, ok, M.pub(1)), 'replayed hit ignored'); }
// signed inputs
{ const M = new B.BrawlMatch({ id: 'sm2', humans: [{ name: 'me', local: true }] }); const m = M.sign(0, { op: 'tap', x: 100, y: 60 });
  assert(!M.accept({ ...m, act: { op: 'tap', x: 5, y: 5 } }), 'tampered input rejected'); assert(M.accept(m), 'signed input accepted'); assert(!M.accept(m), 'replayed input (same seq) rejected');
  const kp = nacl.sign.keyPair(); const imp = B.signInput({ mid: 'sm2', seat: 0, seq: 99, tick: 0, act: { op: 'tap', x: 1, y: 1 } }, kp.secretKey); assert(!M.accept(imp), 'input signed by another key rejected');
  assert(!M.accept(M.sign(3, { op: 'tap', x: 1, y: 1 })), 'remote-style input for an AI seat is not accepted (AI runs on host)'); }
// KO -> instant respawn + scoring
{ const M = new B.BrawlMatch({ id: 'sm3', humans: [{ name: 'me', local: true }] }); const st = M.st; st.f.forEach(p => p.shield = 0); st.f[1].hp = 5; Object.assign(st.f[1], { x: 120, y: 70 });
  const h = { hid: 'x1', tick: 0, att: 0, vic: 1, kind: 'punch', dmg: 9, kx: 1, ky: 0 }; assert(B.applyHit(st, B.signHit(M.id, h, M.seats[1].sk), M.pub(1)), 'lethal hit applied');
  assert(st.f[1].hp === B.HP && st.f[1].x === B.SPAWNS[1][0] && st.f[1].shield === B.SPAWN_SHIELD && st.f[0].ko === 1 && st.f[1].deaths === 1, 'KO: instant respawn at spawn with shield, KO/death counted');
  st.pending.push({ hid: 'x2', tick: st.tick, att: 0, vic: 1, kind: 'ball', dmg: 9, kx: 0, ky: 0 }); assert(B.victimResolve(st, M.id, st.pending.at(-1), M.seats[1].sk) === null, 'spawn shield: victim refuses hits'); }
// full AI round: AI fills 5 seats, things happen, scoreboard, determinism, perf
{ const mk = () => new B.BrawlMatch({ id: 'det', humans: [{ name: 'me', local: true }] }); const a = await mk().ready(), b = await mk().ready(); assert(a.wc && a.wc.length === 6, 'WebCrypto Ed25519 fast path active for victim signing'); const t0 = performance.now(); let worst = 0;
  assert(a.seats.filter(s => s.ai).length === 5 && !a.seats[0].ai, 'solo: 5 AI seats fill the free-for-all');
  for (let i = 0; i < B.ROUND_T; i++) { const t1 = performance.now(); a.tick(); worst = Math.max(worst, performance.now() - t1); b.tick(); await a.settle(); await b.settle(); } const ms = (performance.now() - t0) / (2 * B.ROUND_T);
  const r = B.result(a.st); assert(a.st.over && r && r.board.length === 6 && r.board[0].ko >= r.board[5].ko, 'round ends with a sorted scoreboard');
  const kos = a.st.f.reduce((s, p) => s + p.ko, 0); assert(kos > 3, `AI actually fights (${kos} KOs in a round)`);
  assert(JSON.stringify(B.result(b.st)) === JSON.stringify(r), 'deterministic: same seed => same round'); assert(ms < 5 && worst < 25, `tick cost avg ${ms.toFixed(2)} ms, worst ${worst.toFixed(1)} ms (no per-hit hitches)`);
  assert(a.st.unacked.length === 0, 'every proposed hit was resolved or declined by its victim (no unacked)');
  const sh = [...a.st.resolved].length; assert(sh > 50, `victim-resolved hits recorded (${sh})`); }
// WebCrypto signatures interoperate with tweetnacl verification (remote peers may use either)
{ const M = await new B.BrawlMatch({ id: 'wc', humans: [{ name: 'me', local: true }] }).ready(); const st = M.st; st.f.forEach(p => p.shield = 0); M.seats.forEach(s => s.ai = false); Object.assign(st.f[2], { x: st.f[1].x + 8, y: st.f[1].y });
  M.act(1, { op: 'tap', x: st.f[2].x, y: st.f[2].y }); M.tick(); await M.settle(); const sh = [...M.signed.values()][0] || null; assert(sh && B.verifyHit(sh, M.pub(2)), 'WebCrypto-signed hit verifies with tweetnacl'); M.tick(); M.tick(); assert(st.f[2].hp < B.HP, 'signed hit applied after APPLY_DELAY ticks'); }
assert(B.TAUNTS.length >= 8 && !B.TAUNTS.some(t => /stupid|idiot|hate|kill yourself|loser|damn|hell/i.test(t)), 'AI trash talk is PG');
assert(B.meta.players === 6 && B.meta.id === 'brawl', 'meta: 6-player brawl');
console.log('ALL BRAWL SMOKE OK');
