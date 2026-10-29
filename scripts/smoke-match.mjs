// Arcade MATCH MODES smoke: per-game rules + win detection, team sizes, matchmaking (band separation, AI fill, blocks),
// signed move exchange (both peers validate), rematch, round chat toggle. node scripts/smoke-match.mjs
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const nacl = (await import('tweetnacl')).default, M = await import('../src/arcade/match.js'), { b64 } = await import('../src/vault.js'), E = await import('../src/arcade/engine.js');
const G = n => M.GAMES[n].mod, rng = E.mulberry32(5);
const kp = () => { const k = nacl.sign.keyPair(); return { pub: b64(k.publicKey), sec: k.secretKey }; };
// ---- registry / team sizes
assert(Object.keys(M.GAMES).length === 11, '11 match games registered (incl. tic-tac-toe)');
assert(M.gamesFor('1v1').length === 9 && M.gamesFor('2v2').map(g => g.id).sort().join() === 'battleship,connect4,pong,snakebattle,trivia,tronduel' && M.gamesFor('4v4').map(g => g.id).sort().join() === 'snakebattle,trivia,tronduel' && M.GAMES.drawguess.modes.join() === 'mass' && M.MASS.includes('drawguess'), 'modes per game match the spec');
assert(M.MODES['1v1'] === 2 && M.MODES['2v2'] === 4 && M.MODES['4v4'] === 8, 'team sizes 1/2/4 per side');
// ---- chess
const C = G('chess'); let s = C.init(); assert(C.perft(s, 3) === 8902, 'chess: perft(3)=8902 (move generator correct)');
for (const [f, t] of [[53, 45], [12, 28], [54, 38], [3, 39]]) s = C.apply(s, C.legal(s, { f, t }, C.turnSeat(s))); assert(C.result(s)?.how === 'checkmate' && C.result(s).winner === 1, 'chess: fool\'s mate detected (black wins)');
s = C.init(); assert(!C.legal(s, { f: 52, t: 28 }, 0) && !C.legal(s, { f: 52, t: 44 }, 1), 'chess: illegal move + wrong side rejected');
// ---- checkers
const K = G('checkers'); let k = K.init(); assert(K.moves(k).length === 7, 'checkers: 7 opening moves');
k.b = Array(64).fill(null); k.b[5 * 8 + 2] = 'r'; k.b[4 * 8 + 3] = 'b'; k.b[2 * 8 + 5] = 'b'; k.b[0] = null;
const jm = K.moves(k); assert(jm.length === 1 && jm[0].caps.length === 2, 'checkers: forced multi-jump');
k = K.apply(k, jm[0]); assert(K.result(k)?.winner === 0, 'checkers: all captured = win');
// ---- connect four (1v1 + 2v2 alternating)
const F = G('connect4'); let f = F.init({ seats: 4 }); const order = []; for (const c of [0, 1, 0, 1, 0, 1, 0]) { order.push(F.turnSeat(f)); f = F.apply(f, F.legal(f, { col: c }, F.turnSeat(f))); }
assert(order.join() === '0,1,2,3,0,1,2' && F.result(f)?.winner === 0 && F.result(f).line.length >= 4, 'connect4: 2v2 seats alternate A1,B1,A2,B2; vertical four wins');
f = F.init(); assert(!F.legal(f, { col: 9 }, 0) && !F.legal(f, { col: 0 }, 1), 'connect4: bad column / wrong seat rejected');
// ---- battleship
const B = G('battleship'); let bs = B.init({ seats: 4, rng, ai: [false, true, true, true] }); assert(bs.phase === 'place' && !('ships' in bs) && !JSON.stringify(bs).includes('"ships"') && bs.keeper.join() === '0,1', 'battleship: no ship positions in the shared state; placement phase first; human keeps team A fleet');
{ const myShips = B.randomShips(rng), grid = B.gridOf(myShips), salt = B.newSalt(); assert(B.validShips(myShips) && grid.filter(x => x >= 0).length === 17, 'battleship: placed fleet = 17 cells');
  assert(!B.legal(bs, { cell: 3 }, 0) && B.turnSeat(bs) === 0, 'battleship: no firing during placement'); bs = B.apply(bs, B.legal(bs, { commit: B.commitOf(grid, salt) }, 0)); bs = B.apply(bs, B.legal(bs, B.ai(bs, 1, rng), 1)); assert(bs.phase === 'fire' && bs.commits.every(c => /^[0-9a-f]{64}$/.test(c)), 'battleship: both fleets committed (hash only) -> fire phase');
  const eg = B.aiGrid(bs, 1), tgt = eg.map((x, i) => x >= 0 ? i : -1).filter(i => i >= 0); bs = B.apply(bs, B.legal(bs, { cell: tgt[0] }, 0)); assert(bs.pending?.cell === tgt[0] && B.turnSeat(bs) === 1, 'battleship: shot is pending until the defending keeper answers');
  bs = B.apply(bs, B.legal(bs, B.ai(bs, 1, rng), 1)); assert(bs.seat === 0 && bs.lastHit && bs.shots[1][tgt[0]] === 2, 'battleship: honest AI answer = hit, hit keeps the turn');
  for (const c of tgt.slice(1)) { bs = B.apply(bs, B.legal(bs, { cell: c }, 0)); bs = B.apply(bs, B.legal(bs, B.ai(bs, 1, rng), 1)); } assert(B.result(bs)?.winner === 0 && bs.sunk[1].length === 5 && !B.legal(bs, { cell: tgt[0] }, 0), 'battleship: all 5 ships reported sunk = win; no moves after');
  assert(B.audit(bs, 1, eg, 'ai:' + bs.aiSeed + ':1').ok && !B.audit(bs, 1, eg, 'x').ok, 'battleship: audit checks the commitment and every answer');
  let b2 = B.apply(B.apply(B.init({ seats: 2, rng }), { commit: 'f'.repeat(64) }), { commit: B.commitOf(grid, salt) }); b2 = B.apply(b2, { cell: grid.indexOf(0) }); assert(!B.legal(b2, { hit: true, sunk: [1, 2] }, 1) && B.legal(b2, { hit: true }, 1), 'battleship: bogus sunk report rejected');
  const lie = B.apply(b2, { hit: false }); assert(B.audit(b2, 1, grid, salt).ok && !B.audit(lie, 1, grid, salt).ok, 'battleship: a false "miss" is caught by audit'); }
{ const s = [{ len: 5, r: 0, c: 0, h: true }, { len: 4, r: 2, c: 0, h: true }, { len: 3, r: 4, c: 0, h: true }, { len: 3, r: 6, c: 0, h: true }, { len: 2, r: 8, c: 8, h: true }]; assert(B.validShips(s) && !B.canPlace(s, 4, { len: 2, r: 0, c: 4, h: false }) && B.canPlace(s, 4, { len: 2, r: 8, c: 0, h: true }), 'battleship: overlap + bounds checks');
  const r = B.rotated(s, 4); assert(r && !r.h && r.c === 8 && r.r === 8, 'battleship: rotate turns a ship (slides back inside the board)'); assert(B.rotated([{ len: 5, r: 9, c: 5, h: true }], 0)?.r === 5, 'battleship: rotate at the bottom edge slides up'); }
// ---- ultimate tic-tac-toe
const U = G('uttt'); let u = U.init(); u = U.apply(u, U.legal(u, { b: 4, k: 0 }, 0)); assert(U.moves(u).every(m => m.b === 0) && !U.legal(u, { b: 4, k: 1 }, 1), 'uttt: move sends opponent to the matching board');
u = U.init(); u.big = [0, 0, null, null, null, null, null, null, null]; u.c[2 * 9] = 0; u.c[2 * 9 + 1] = 0; u.force = 2; u.seat = 0; u = U.apply(u, { b: 2, k: 2 }); assert(U.result(u)?.winner === 0, 'uttt: three small boards in a row wins');
// ---- trivia
const T = G('trivia'); let tv = T.init({ seats: 4, rng }); const right = T.BANK[tv.qs[0]][2]; tv = T.apply(tv, T.legal(tv, { q: 0, a: right }, 1), 1); assert(tv.score[1] === 2 && !T.legal(tv, { q: 0, a: 0 }, 1), 'trivia: first correct +2, one answer per seat');
for (const st of [0, 2, 3]) tv = T.apply(tv, T.legal(tv, { q: 0, a: (right + 1) % 4 }, st), st); assert(tv.q === 1, 'trivia: next question after all seats answer');
while (!T.result(tv)) tv = T.timeout(tv); assert(T.result(tv).winner === 1 && T.BANK.length >= 20, 'trivia: win detection, local bank (no API)');
// ---- draw & guess (Mass Arena room)
const D = G('drawguess'); const codes = Array.from({ length: 30 }, (_, i) => 'P' + i); let d = D.init({ codes, seed: 3 });
const drs = D.drawers(d); assert(drs.length === 2 && D.drawerCount(100) === 4 && D.drawerCount(10) === 1, 'draw&guess: 1 drawer + 1 per 25 players (max 4), rotating');
const g1 = codes.find(c => !drs.includes(c)); assert(D.legal(d, { stroke: [[0.1, 0.1], [0.2, 0.2]] }, drs[0]) && !D.legal(d, { stroke: [[0, 0]] }, g1) && !D.legal(d, { guess: 'x' }, drs[0]), 'draw&guess: only drawers draw, drawers cannot guess');
d = D.apply(d, D.legal(d, { guess: D.word(d).toUpperCase() + '!' }, g1), g1); const g2 = codes.filter(c => !drs.includes(c))[1]; d = D.apply(d, D.legal(d, { guess: D.word(d) }, g2), g2);
assert(d.score[g1] === 10 && d.score[g2] === 9 && d.score[drs[0]] === 2 && !D.legal(d, { guess: 'again' }, g1) && !d.log.some(l => l.text === D.word(d)), 'draw&guess: ranked points, drawer +1 per solver, one solve each, word never echoed');
assert(D.leaderboard(d)[0].code === g1 && D.leaderboard(d)[0].rank === 1, 'draw&guess: leaderboard');
for (const c of codes.filter(c => !drs.includes(c)).slice(2)) d = D.apply(d, { guess: D.word(d) }, c); assert(d.round === 1 && JSON.stringify(D.drawers(d)) !== JSON.stringify(drs), 'draw&guess: round ends when all guessed, drawers rotate');
const I2 = await import('../src/arcade/instance.js'); const dl = new I2.InstanceManager({ gameName: 'drawguess', factory: id => new D.DrawRoom({ id }) });
dl.join('H0'); assert(dl.list[0].bots().length === 5, 'draw&guess room: bots fill an empty room'); for (let i = 1; i <= 100; i++) dl.join('H' + i);
assert(dl.list.length === 2 && dl.list[0].humans().length === 100 && dl.list[0].bots().length === 0 && dl.list[1].links.includes(dl.list[0].id), 'draw&guess: 100 cap, split + linked sub-rooms, bots evicted');
const rc = new M.RoundChat('drawguess'); assert(rc.text && rc.voice && rc.set('text', false).reason === 'chat-required', 'draw&guess: chat required (cannot disable text)');
assert(!rc.canMessage({ code: 'a', age: 30 }, { code: 'k', minor: true }) && rc.canMessage({ code: 'k', minor: true }, { code: 'k2', minor: true }) && !rc.canMessage({ code: 'b', age: 30 }, { code: 'c', age: 30 }, { isBlocked: c => c === 'b' }), 'draw&guess chat: adult/minor separated, blocked dropped');
assert(!rc.voiceAllowedFor({ minor: true }) && rc.voiceAllowedFor({ minor: true }, { parentAllows: true }) && rc.voiceAllowedFor({ age: 30 }), 'draw&guess voice: minors off unless parent allows');
// ---- pong
const P = G('pong'); let pg = P.init({ seats: 4, rng }); assert(pg.pads.length === 4 && pg.pads.filter(p => p.team === 0).length === 2, 'pong: 2v2 two paddles per side');
const sim = () => { const a = P.init({ seats: 2, rng: E.mulberry32(9) }); for (let i = 0; i < 4000 && !P.result(a); i++) { P.input(a, 0, P.ai(a, 0, E.mulberry32(i), 0.9)); P.input(a, 1, P.ai(a, 1, E.mulberry32(i + 1), 0.3)); P.step(a); } return a; };
const p1 = sim(), p2 = sim(); assert(JSON.stringify(p1.score) === JSON.stringify(p2.score) && P.result(p1), `pong: deterministic, first to 7 (${p1.score.join('-')})`);
// ---- duels (engine reuse)
const DU = G('tronduel'); for (const [mode, n] of [['1v1', 2], ['2v2', 4], ['4v4', 8]]) { const seats = Array.from({ length: n }, (_, i) => ({ code: 'S' + i, ai: true, team: i % 2 })); const w = DU.makeArena('tron', mode, seats, 3);
  assert(w.players.size === n && w.bots().length === n && w.side === DU.ARENA_TILES[mode], `tron duel ${mode}: ${n} seats, small ${w.side}x${w.side}-tile arena, no extra bots`);
  let r = null; for (let i = 0; i < 3000 && !(r = DU.roundResult(w)); i++) w.step(); assert(r && [...w.players.values()].every(p => p.respawnAt == null), `tron duel ${mode}: round ends by elimination (no respawn) -> ${r.draw ? 'draw' : 'team ' + r.winner}`); }
{ const seats = Array.from({ length: 4 }, (_, i) => ({ code: 'N' + i, ai: true, team: i % 2 })); const w = DU.makeArena('snake', '2v2', seats, 4); let r = null; for (let i = 0; i < 5000 && !(r = DU.roundResult(w)); i++) w.step(); assert(w.players.size === 4 && r, 'snake battle 2v2: team elimination round'); }
// ---- matchmaking: band separation, AI fill, blocks, bans
let T0 = 0; const mm = new M.Matchmaker({ now: () => T0, isBlocked: (a, b) => a === 'A2' && b === 'A3', isBanned: c => c === 'BAN' });
assert(mm.enqueue({ code: 'BAN', age: 30 }, 'chess', '1v1').ok === false, 'banned player cannot queue');
mm.enqueue({ code: 'A1', age: 30 }, 'chess', '1v1'); const r1 = mm.enqueue({ code: 'K1', age: 13, minor: true }, 'chess', '1v1'); assert(!r1.match, 'adult and minor never matched together');
const r2 = mm.enqueue({ code: 'K2', age: 14, minor: true }, 'chess', '1v1'); assert(r2.match && r2.match.seats.every(x => x.minor), 'two minors matched together');
mm.enqueue({ code: 'A2', age: 30 }, 'connect4', '2v2'); mm.enqueue({ code: 'A3', age: 30 }, 'connect4', '2v2'); T0 = M.FILL_MS + 1; const formed = mm.tick();
const c4m = formed.find(x => x.game === 'connect4'), chm = formed.find(x => x.game === 'chess'); assert(c4m && c4m.seats.filter(x => !x.ai).length === 1 && c4m.seats.filter(x => x.ai).length === 3, 'blocked pair not seated together; AI fills empty seats after the wait');
assert(chm && chm.seats.some(x => x.ai) && chm.seats.some(x => x.code === 'A1'), 'lonely adult gets an AI opponent');
assert(!mm.enqueue({ code: 'Z', age: 30 }, 'drawguess', '1v1').ok, 'game/mode mismatch refused');
// ---- signed move exchange validated on both peers
const ka = kp(), kb = kp(); const seats = [{ code: 'W', pub: ka.pub, team: 0 }, { code: 'B', pub: kb.pub, team: 1 }];
const A = new M.Match({ id: 'm1', game: 'chess', mode: '1v1', seats }), Bp = new M.Match({ id: 'm1', game: 'chess', mode: '1v1', seats });
const mv = A.makeMove(0, { f: 52, t: 36 }, ka.sec); assert(A.receive(mv).ok && Bp.receive(mv).ok && A.head === Bp.head, 'signed move applied identically on both peers (hash chain agrees)');
const forged = Bp.makeMove(1, { f: 12, t: 28 }, ka.sec); assert(A.receive(forged).reason === 'signature' && Bp.receive(forged).reason === 'signature', 'move signed with the wrong key rejected by both');
const illegal = A.makeMove(1, { f: 12, t: 36 }, kb.sec); assert(A.receive(illegal).reason === 'illegal' && Bp.receive(illegal).reason === 'illegal', 'illegal move rejected by both peers');
const ok2 = A.makeMove(1, { f: 12, t: 28 }, kb.sec); const tampered = { ...ok2, move: { f: 11, t: 27 } }; assert(Bp.receive(tampered).reason === 'signature' && Bp.receive(ok2).ok, 'tampered move rejected, original accepted');
assert(Bp.receive(ok2).reason === 'chain', 'replayed move rejected (hash chain)');
// chess clock
let now = 1000; const cm = new M.Match({ id: 'c2', game: 'chess', mode: '1v1', seats, clockMs: 1000 }); cm.receive(cm.makeMove(0, { f: 52, t: 36 }, ka.sec), now); now += 1500; assert(cm.receive(cm.makeMove(1, { f: 12, t: 28 }, kb.sec), now).reason === 'flag' && cm.over.how === 'time', 'optional chess timer: flag fall loses');
// AI plays a full game, then rematch swaps sides
const am = new M.Match({ id: 'ai1', game: 'connect4', mode: '1v1', seats: [{ code: 'x', ai: true, team: 0 }, { code: 'y', ai: true, team: 1 }] }); for (let i = 0; i < 50 && !am.over; i++) am.aiMove(am.mod.turnSeat(am.state));
assert(am.over, 'AI fill-in plays a connect4 game to the end: ' + (am.over.draw ? 'draw' : 'team ' + am.over.winner));
const before = am.seats.map(s => s.code).join(); am.rematch(); assert(!am.over && am.round === 1 && am.seats.map(s => s.code).join() !== before && am.seq === 0, 'rematch: fresh board, sides swapped');
for (const id of ['checkers', 'battleship', 'uttt', 'trivia', 'chess']) { const x = new M.Match({ id: 'ai-' + id, game: id, mode: '1v1', seats: [{ code: 'x', ai: true, team: 0 }, { code: 'y', ai: true, team: 1 }] }); let n = 0; for (; n < 600 && !x.over; n++) { const st = x.mod.turnSeat(x.state); if (st == null || !x.aiMove(st)) break; } assert(x.seq > 3, `AI plays ${id} (${x.seq} moves${x.over ? ', ' + (x.over.how || '') : ''})`); }
// ---- round chat / voice toggle
const ch = new M.Match({ id: 'q', game: 'chess', mode: '1v1', seats }); assert(!ch.chat.text && !ch.chat.voice, 'chat: chess defaults OFF');
for (const id of ['checkers', 'connect4', 'battleship', 'uttt']) assert(!new M.Match({ id: 'f' + id, game: id, mode: '1v1', seats }).chat.voice, 'chat: focus game ' + id + ' defaults OFF');
ch.setChat('voice', true); ch.rematch(); assert(ch.chat.voice === true && ch.setChat('voice', false).ok && !ch.chat.voice, 'chat: per-round toggle, easy to turn off');
const tv8 = new M.Match({ id: 'tv', game: 'trivia', mode: '4v4', seats: Array.from({ length: 8 }, (_, i) => ({ code: 'T' + i, ai: true, team: i % 2 })) }); assert(tv8.seats.length === 8 && !tv8.chat.voice, 'trivia 4v4: 8 seats, chat default off');
console.log('ALL MATCH SMOKE OK');
