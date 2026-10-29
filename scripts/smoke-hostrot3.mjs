// v36 HOST ROTATION + JOIN-ANYTIME wired into the match network flow (src/arcade/hostrot-net.js bindMatch + TableBoard/joinTable,
// src/arcade/match.js join/_reseat/leaveSeat/snapshotAuth). Simulated mesh with per-node link latency.
//  - measured (probe) ping drives eligibility: a bad-ping node is skipped at the term hand-off
//  - host leaving hands off (planned) and an AI takes its seat; host crash fails over
//  - non-host moves applied + committed by the host; all replicas agree on the hash chain
//  - join mid-match: table advert -> join ping -> seat reply; turn-based = next round (AI hands its seat over), real-time = now
//  - age bands never mixed.  node scripts/smoke-hostrot3.mjs
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const nacl = (await import('tweetnacl')).default, { b64 } = await import('../src/vault.js');
const N = await import('../src/arcade/hostrot-net.js'), M = await import('../src/arcade/match.js'), R = await import('../src/arcade/host-rotation.js');
let now = 0; const timers = []; const T = { setTimeout: (f, ms) => { const h = { at: now + ms, f }; timers.push(h); return h; }, clearTimeout: h => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); } };
const runTimers = () => { timers.sort((a, b) => a.at - b.at); while (timers.length && timers[0].at <= now) timers.shift().f(); };
// mesh: broadcast; a message from X to Y takes lat[X] + lat[Y] ms (bad link on either end slows it)
const lat = {}, wire = [], subs = new Map(), down = new Set();
const arcadeFor = code => ({ send: b => { if (!down.has(code)) for (const c of subs.keys()) if (c !== code) wire.push({ from: code, to: c, b: structuredClone(b), at: now + (lat[code] || 10) + (lat[c] || 10) }); },
  sub: fn => { (subs.get(code) || subs.set(code, new Set()).get(code)).add(fn); return () => subs.get(code)?.delete(fn); } });
const deliver = () => { wire.sort((a, b) => a.at - b.at); while (wire.length && wire[0].at <= now) { const { from, to, b } = wire.shift(); if (down.has(to)) continue; for (const fn of [...(subs.get(to) || [])]) fn(from, b); } };
const ks = {}; const key = c => (ks[c] ||= nacl.sign.keyPair()); const pub = c => b64(key(c).publicKey);
const nodes = {}; const step = ms => { for (let t = 0; t < ms; t += 20) { now += 20; for (const c in nodes) if (!down.has(c)) nodes[c].tick(); runTimers(); deliver(); } };
const live = () => Object.entries(nodes).filter(([c]) => !down.has(c));
const agree = () => new Set(live().map(([, n]) => n.rot.host + '@' + n.rot.epoch));
const bind = (c, m, roster, extra = {}) => (nodes[c] = N.bindMatch({ match: m, arcade: arcadeFor(c), code: c, secretKey: key(c).secretKey, roster, now: () => now, timers: T, termMs: 10e3, battery: null, ...extra }));
// ---------- 1) 3 humans + 1 AI in a 2v2 Connect Four; B has a terrible link (400 ms each way)
lat.A = 10; lat.B = 400; lat.C = 10;
const seats0 = ['A', 'B', 'C'].map((c, i) => ({ code: c, name: c, pub: pub(c), seat: i, team: i % 2 })).concat([{ code: 'AI-1', name: 'bot', ai: true, seat: 3, team: 1, skill: 0.6 }]);
const roster0 = { A: pub('A'), B: pub('B'), C: pub('C') };
for (const c of ['A', 'B', 'C']) bind(c, new M.Match({ id: 'connect4-2v2-1.A', game: 'connect4', mode: '2v2', seats: structuredClone(seats0) }), roster0);
step(6000);
const mB = nodes.B.rot.myMetrics, mC = nodes.C.rot.myMetrics;
assert(mB.ping > R.LIMITS.maxPing && mC.ping < R.LIMITS.maxPing, `probe-measured ping: B ${mB.ping} ms (bad), C ${mC.ping} ms (good)`);
assert(!R.eligible(nodes.A.rot.metrics.get('B')) && R.eligible(nodes.A.rot.metrics.get('C')), 'peers see B ineligible from its own signed heartbeat metrics');
assert(agree().size === 1 && nodes.A.rot.host === 'A', 'epoch-0 host A agreed');
step(6000); // A's 10 s term ends -> next in order is B, but B has bad ping -> C
assert(agree().size === 1 && nodes.A.rot.host === 'C', `term hand-off skipped bad-ping B -> ${nodes.A.rot.host} (all agree, epoch ${nodes.A.rot.epoch})`);
// ---------- 2) moves: non-host A plays, host C commits, everyone holds the same chain
const mA = nodes.A.match; const seatA = mA.seats.findIndex(s => s.code === 'A');
const ts = mA.mod.turnSeat(mA.state); assert(ts === seatA, 'seat A to move');
const r = mA.receive(mA.makeMove(seatA, { col: 3 }, key('A').secretKey)); arcadeFor('A').send({ op: 'mv', mid: mA.id, sm: mA.log.at(-1) }); assert(r.ok, 'A move applied locally');
step(1500);
const heads = new Set(live().map(([, n]) => n.match.head)); assert(heads.size === 1 && nodes.C.match.seq === 1 && nodes.B.match.seq === 1, 'non-host move applied by host + replicated (one chain head everywhere)');
// forged move for someone else's seat is ignored
const seatB = mA.seats.findIndex(s => s.code === 'B'); const fake = mA.makeMove(seatB, { col: 0 }, key('A').secretKey); arcadeFor('A').send({ op: 'mv', mid: mA.id, sm: fake }); step(1500);
assert(nodes.C.match.seq === 1, 'move signed for another player\'s seat rejected');
// ---------- 3) host C leaves -> planned hand-off (skips bad-ping B -> A), AI takes C's seat
const epochBefore = nodes.A.rot.epoch; nodes.C.leave(); down.add('C'); step(3000);
assert(agree().size === 1 && nodes.A.rot.host === 'A' && nodes.A.rot.epoch === epochBefore + 1, `host left -> hand-off to A (epoch ${nodes.A.rot.epoch}), B skipped again`);
const cSeat = seats0.findIndex(s => s.code === 'C');
assert(nodes.A.match.seats[cSeat].ai && nodes.B.match.seats[cSeat].ai && nodes.B.match.seats[cSeat].code === nodes.A.match.seats[cSeat].code, 'AI took the leaver\'s seat on the host and the replica');
assert(!nodes.A.rot.roster.has('C') && !nodes.B.rot.roster.has('C'), 'leaver removed from rotation roster');
// ---------- 4) host crash (no goodbye): A dies -> B is the only one left and takes over
down.add('A'); step(6000); assert(nodes.B.rot.host === 'B', 'host crash -> failover to the remaining player');
step(4000); assert(!nodes.B.rot.roster.has('A') && nodes.B.match.seats[0].ai && nodes.B.match.seats.filter(s => !s.ai).length === 1, 'crashed host dropped after silence; AI took its seat');
// bots are host-driven: the host advances AI seats and commits
// ---------- 5) JOIN MID-MATCH, turn-based (chess 1v1: H + AI) -> joiner seated at the next round
for (const k of Object.keys(nodes)) { nodes[k].stop(); delete nodes[k]; } subs.clear(); wire.length = 0; down.clear(); for (const k in lat) delete lat[k];
const cs = [{ code: 'H', name: 'Host', pub: pub('H'), seat: 0, team: 0 }, { code: 'AI-7', name: 'bot 7', ai: true, skill: 0.6, seat: 1, team: 1 }];
const mH = new M.Match({ id: 'chess-1v1-3.H', game: 'chess', mode: '1v1', seats: cs }); bind('H', mH, { H: pub('H') });
mH.receive(mH.makeMove(0, mH.mod.moves ? mH.mod.moves(mH.state)[0] : null, key('H').secretKey)); mH.aiMove(1); nodes.H.commit(); // mid-round
const boardD = new N.TableBoard(() => now); arcadeFor('D').sub((f, b) => boardD.seen(f, b)); step(2500);
const tbl = boardD.find('chess', '1v1', 'adult'); assert(tbl && tbl.mid === mH.id && tbl.open === 1 && tbl.from === 'H', 'host advertises the running table (1 AI seat open)');
assert(!boardD.find('chess', '1v1', 'minor') && !boardD.find('checkers', '1v1', 'adult'), 'table not offered to another age band / game');
const pD = { code: 'D', name: 'Dee', pub: pub('D'), age: 30 }; let rep = null; N.joinTable({ arcade: arcadeFor('D'), table: tbl, p: pD, timers: T }).then(x => { rep = x; }); step(500); await null; await null;
assert(rep && rep.r.seated === 'next-round' && rep.snap.seq === mH.seq && rep.host === 'H', 'join ping -> host replies with seat (next round for turn-based) + live snapshot');
const mD = new M.Match({ id: tbl.mid, game: 'chess', mode: '1v1', seats: rep.snap.seats }); mD.restoreAuth(rep.snap); bind('D', mD, rep.roster, { initial: rep });
assert(mD.head === mH.head && mD.seq === mH.seq && mD.seats.every(s => s.code !== 'D'), 'joiner adopts the exact board, watches this round (AI keeps its seat mid-round)');
assert(nodes.H.rot.roster.has('D') && nodes.D.rot.host === 'H', 'joiner is in the rotation roster; joiner accepts the current host');
step(3000); assert(agree().size === 1, 'host + joiner agree on host/epoch');
mH.over = { winner: 0, how: 'test' }; nodes.H.requestRematch(); step(1000);
assert(mH.seats.some(s => s.code === 'D' && !s.ai) && !mH.seats.some(s => s.ai), 'round boundary: AI gave its seat to the real player (host)');
assert(mD.round === mH.round && mD.seats.map(s => s.code).join() === mH.seats.map(s => s.code).join() && mD.head === mH.head, 'joiner replica got the new round + seats from the host commit');
// joiner (non-host) plays its move on its own turn -> host applies & commits
{ const sD = mD.seats.findIndex(s => s.code === 'D'); const ts2 = mD.mod.turnSeat(mD.state);
  if (ts2 !== sD) { const sH = mH.seats.findIndex(s => s.code === 'H'); mH.receive(mH.makeMove(sH, mH.mod.moves(mH.state)[0], key('H').secretKey)); arcadeFor('H').send({ op: 'mv', mid: mH.id, sm: mH.log.at(-1) }); nodes.H.commit(); step(500); }
  const seq0 = mH.seq; mD.receive(mD.makeMove(sD, mD.mod.moves(mD.state)[0], key('D').secretKey)); arcadeFor('D').send({ op: 'mv', mid: mD.id, sm: mD.log.at(-1) }); step(800);
  assert(mH.seq === seq0 + 1 && mH.head === mD.head, 'joiner\'s move verified + applied by the host'); }
// joiner leaves -> AI takes the seat again (game keeps going)
nodes.D.leave(); down.add('D'); step(1000); assert(mH.seats.some(s => s.ai) && !mH.seats.some(s => s.code === 'D'), 'joiner left -> AI took the seat back');
// ---------- 6) band separation: a minor cannot join an adult table
down.delete('D'); const boardK = new N.TableBoard(() => now); arcadeFor('K').sub((f, b) => boardK.seen(f, b)); step(2500);
let repK = 'x'; N.joinTable({ arcade: arcadeFor('K'), table: boardK.find('chess', '1v1', 'adult'), p: { code: 'K', name: 'Kid', minor: true, age: 15, pub: pub('K') }, timers: T }).then(x => { repK = x; }); step(500); await null; await null;
assert(repK === null && !mH.seats.some(s => s.code === 'K') && !(mH.pendingHumans || []).some(p => p.code === 'K'), 'minor refused at an adult table (and not queued)');
// ---------- 7) JOIN MID-MATCH, real-time (Tron Duel 1v1: H2 + AI) -> seated NOW, AI hands over its live body
for (const k of Object.keys(nodes)) { nodes[k].stop(); delete nodes[k]; } subs.clear(); wire.length = 0;
const ts3 = [{ code: 'H2', name: 'Host2', pub: pub('H2'), seat: 0, team: 0 }, { code: 'AI-9', name: 'bot 9', ai: true, skill: 0.6, seat: 1, team: 1 }];
const mR = new M.Match({ id: 'tronduel-1v1-4.H2', game: 'tronduel', mode: '1v1', seats: ts3 }); bind('H2', mR, { H2: pub('H2') }); for (let i = 0; i < 5; i++) mR.state.step();
const body = mR.state.players.get('AI-9'), bx = body.x, by = body.y;
const boardE = new N.TableBoard(() => now); arcadeFor('E').sub((f, b) => boardE.seen(f, b)); step(2500);
let repE = null; N.joinTable({ arcade: arcadeFor('E'), table: boardE.find('tronduel', '1v1', 'adult'), p: { code: 'E', name: 'Eve', pub: pub('E'), age: 22 }, timers: T }).then(x => { repE = x; }); step(500); await null; await null;
assert(repE?.r.seated === 'now' && mR.seats[1].code === 'E' && !mR.seats[1].ai, 'real-time join: seated immediately in the AI seat');
const pe = mR.state.players.get('E'); assert(pe && !pe.bot && pe.x === bx && pe.y === by && !mR.state.players.has('AI-9'), 'AI stepped aside: joiner took over its live arena body (same spot, round continues)');
assert(!('state' in repE.snap) && repE.snap.seats.length === 2, 'real-time snapshot ships seats/score only (lockstep arena never serialised)');
mR.state.step(); assert(mR.state.tick > 5, 'arena keeps ticking after the hand-over');
// ---------- 8) solo table (me + bots) sends no heartbeat traffic, only the table advert
for (const k of Object.keys(nodes)) { nodes[k].stop(); delete nodes[k]; } subs.clear(); wire.length = 0;
const solo = new M.Match({ id: 'ttt-1v1-5.S', game: 'ttt', mode: '1v1', seats: [{ code: 'S', pub: pub('S'), seat: 0, team: 0 }, { code: 'AI-1', ai: true, seat: 1, team: 1 }] });
const ops = []; subs.set('W', new Set([(f, b) => ops.push(b.op)])); bind('S', solo, { S: pub('S') }); step(5000);
assert(ops.length > 0 && ops.every(o => o === 'tbl'), `solo vs AI: only table adverts on the wire (${ops.length} msgs, no hr/probe spam)`);
// wiring present in the UI
const fs = await import('node:fs'), mu = fs.readFileSync(new URL('../src/match-ui.js', import.meta.url), 'utf8');
assert(/TableBoard/.test(mu) && /joinTable\(/.test(mu) && /hr\.rot\.isHost/.test(mu) && /requestRematch/.test(mu) && /hr\?\.leave\(\)/.test(mu) && /idTag/.test(mu), 'match-ui wired: table board, join flow, host-only bots, host rematch, leave, mesh-unique ids');
console.log('ALL HOSTROT3 OK');
