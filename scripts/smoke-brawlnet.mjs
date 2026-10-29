// v42 NETWORKED BRAWL (src/arcade/brawl-net.js over hostrot-net.js bindMatch): simulated mesh with per-node latency,
// virtual clock + real awaits for WebCrypto Ed25519.
//  - compact snapshot codec: round-trips, validated, hard-capped wire size even with a flood of balls
//  - join mid-match: table advert -> join ping (theme + fighter) -> seat reply; the joiner replaces an AI seat NOW
//  - replica inputs: client prediction + host authority (host applies, replicas converge); signed, per-seat, replay-proof
//  - remote victim-signed hits: host applies only a hit it proposed, signed by the victim's owner (forgeries refused)
//  - bounded packets / rate: oversize + flood dropped; every sender stays far under the mesh RxGate game budget
//  - host leaves -> planned hand-off, AI takes the seat, scores carry over; host crash -> failover + eviction
//  - rematch from a replica, age bands never mixed.   node scripts/smoke-brawlnet.mjs
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const nacl = (await import('tweetnacl')).default, { b64 } = await import('../src/vault.js');
const B = await import('../src/arcade/games/brawl.js'), BN = await import('../src/arcade/brawl-net.js'), N = await import('../src/arcade/hostrot-net.js'), RX = await import('../src/shield.js');
// ---------- 1) codec
{ const m = await new B.BrawlMatch({ id: 'codec', humans: [{ name: 'me', local: true }] }).ready(); for (let i = 0; i < 200; i++) { m.tick(); await m.settle(); }
  const s = BN.encode(m); assert(BN.valid(s) && BN.size(s) <= BN.LIMITS.snap, `snapshot valid, ${BN.size(s)} B <= ${BN.LIMITS.snap}`);
  const st = B.init(); BN.decodeInto(st, JSON.parse(JSON.stringify(s)));
  assert(st.tick === m.st.tick && st.f.every((p, i) => Math.abs(p.x - m.st.f[i].x) < 0.01 && Math.abs(p.y - m.st.f[i].y) < 0.01 && p.hp === m.st.f[i].hp && p.ko === m.st.f[i].ko && p.char === m.st.f[i].char), 'decode reproduces fighters (pos <= 0.01, hp, KOs, chars)');
  for (let i = 0; i < 200; i++) m.st.balls.push({ id: 9000 + i, own: i % 6, x: 50.123, y: 60.456, vx: 1.111, vy: -2.222, r: 3.33, dmg: 9, kb: 2.5, life: 80 });
  const big = BN.encode(m); assert(BN.size(big) <= BN.LIMITS.snap && big.b.length <= BN.CAPS.balls && BN.valid(big), `ball flood: wire copy trimmed to ${BN.size(big)} B / ${big.b.length} balls (host keeps all ${m.st.balls.length})`);
  assert(!BN.valid({ ...s, f: s.f.slice(0, 5) }) && !BN.valid({ ...s, b: Array(99).fill(s.b[0] || [1, 0, 0, 0, 0, 0, 1, 1, 1, 1]) }) && !BN.valid(null), 'malformed snapshots rejected (seat count, array caps)'); }
// ---------- simulated mesh
let now = 0; const timers = []; const T = { setTimeout: (f, ms) => { const h = { at: now + ms, f }; timers.push(h); return h; }, clearTimeout: h => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); } };
const runTimers = () => { timers.sort((a, b) => a.at - b.at); while (timers.length && timers[0].at <= now) timers.shift().f(); };
const lat = {}, wire = [], subs = new Map(), down = new Set(), sent = new Map(), maxPkt = { n: 0 };
const arcadeFor = code => ({ send: b => { if (down.has(code)) return; const j = JSON.stringify(b); maxPkt.n = Math.max(maxPkt.n, j.length); const sec = Math.floor(now / 1000), k = code + '@' + sec; sent.set(k, (sent.get(k) || 0) + 1);
    for (const c of subs.keys()) if (c !== code) wire.push({ from: code, to: c, b: JSON.parse(j), at: now + (lat[code] || 15) + (lat[c] || 15) }); },
  sub: fn => { (subs.get(code) || subs.set(code, new Set()).get(code)).add(fn); return () => subs.get(code)?.delete(fn); } });
const deliver = () => { wire.sort((a, b) => a.at - b.at); while (wire.length && wire[0].at <= now) { const { from, to, b } = wire.shift(); if (down.has(to)) continue; for (const fn of [...(subs.get(to) || [])]) fn(from, b); } };
const flush = () => new Promise(r => setTimeout(r, 1));
const nodes = {}, tables = {}; const step = async ms => { for (let t = 0; t < ms; t += 33) { now += 33; for (const c in nodes) if (!down.has(c)) nodes[c].tick(); runTimers(); deliver(); await flush(); } };
const board = {}; const boardFor = c => (board[c] ||= (() => { const tb = new N.TableBoard(() => now); arcadeFor(c).sub((f, b) => tb.seen(f, b)); return tb; })());
const seeds = {}; const seed = c => (seeds[c] ||= nacl.randomBytes(32));
const host = async (c, { theme = 'cyan', roundT, minor = false } = {}) => { const m = new B.BrawlMatch({ id: 'brawl-' + c + '-1', humans: [{ name: c, local: true, seed: seed(c) }], roundT }); await m.ready();
  const t = new BN.BrawlTable({ match: m, code: c, me: { name: c, minor }, theme, mySeed: seed(c) }).claimSeat0(); await t.ready(); tables[c] = t;
  nodes[c] = BN.bindBrawl({ table: t, arcade: arcadeFor(c), code: c, secretKey: t.myKeys().secretKey, roster: { [c]: t.myPub() }, timers: T, now: () => now, termMs: 600e3 }); return nodes[c]; };
const joiner = async (c, { theme = 'cyan', char = null, minor = false } = {}) => { boardFor(c); await step(2100); const tb = board[c].find('brawl', 'ffa6', minor ? 'minor' : 'adult'); if (!tb) return null;
  const kp = nacl.sign.keyPair.fromSeed(seed(c)), p = { code: c, name: c, minor, pub: b64(kp.publicKey), theme, char }; let r = null; BN.joinBrawl({ arcade: arcadeFor(c), table: tb, p, timers: T }).then(x => { r = x || 'refused'; });
  for (let i = 0; i < 40 && !r; i++) await step(33); if (!r || r === 'refused') return null;
  const m = new B.BrawlMatch({ id: tb.mid, chars: r.snap.g.f.map(x => B.ROSTER[x[0]].id), roundT: r.snap.g.rt }); await m.ready();
  const t = new BN.BrawlTable({ match: m, code: c, me: { name: c, minor }, theme, mySeed: seed(c) }); t.restoreAuth(r.snap); await t.ready(); tables[c] = t;
  nodes[c] = BN.bindBrawl({ table: t, arcade: arcadeFor(c), code: c, secretKey: t.myKeys().secretKey, roster: r.roster, initial: r, timers: T, now: () => now, termMs: 600e3 }); return nodes[c]; };
const seatsOf = c => tables[c].seats.map(s => s.ai ? 'AI' : s.code).join(',');
// ---------- 2) join mid-match
lat.A = 15; lat.B = 40; lat.C = 25;
const A = await host('A', { theme: 'cyan' }); await step(1500); const tick0 = tables.A.st.tick;
const Bn = await joiner('B', { theme: 'cyan', char: 'nova' }); assert(!!Bn, 'B found A\'s advertised table and was seated');
await step(500); assert(seatsOf('A') === 'A,B,AI,AI,AI,AI' && seatsOf('B') === seatsOf('A'), `B dropped in NOW, replacing an AI seat mid-round (tick ${tables.A.st.tick} > ${tick0}); both agree on seats`);
assert(Bn.rot.host === 'A' && A.rot.host === 'A' && Bn.rot.epoch === A.rot.epoch && A.peers() === 2 && Bn.peers() === 2, 'both agree on host A + epoch; rotation roster has both humans');
assert(tables.A.st.f[1].char === 'nova' && tables.B.st.f[1].char === 'nova' && tables.A.seats.filter(s => s.ai).every((s, i) => s.name) && new Set(tables.A.st.f.map(p => p.char)).size === 6, 'joiner got the fighter they picked (AI swapped), roster still 6 distinct fighters');
assert(tables.B.seats[1].theme === 'cyan' && tables.A.seats[0].theme === 'cyan' && tables.A.seats[1].theme === 'cyan', 'seat records carry each player\'s theme (same theme -> distinct shades in the UI)');
await step(1000); assert(Bn.stats.snapsApplied >= 12 && A.stats.snapsSent >= 12, `replica follows host snapshots (A sent ${A.stats.snapsSent}, B applied ${Bn.stats.snapsApplied})`);
const dpos = () => Math.max(...tables.A.st.f.map((p, i) => Math.hypot(p.x - tables.B.st.f[i].x, p.y - tables.B.st.f[i].y)));
assert(Math.abs(tables.A.st.tick - tables.B.st.tick) <= 6, `replica clock within ${Math.abs(tables.A.st.tick - tables.B.st.tick)} ticks of the host`);
// ---------- 3) replica input: prediction + host authority
tables.A.st.f[1].tpCd = 0; tables.B.st.f[1].tpCd = 0; const fB = () => tables.A.st.f[1];
for (const p of tables.A.st.f) p.shield = 99; // keep AIs from interfering with the check positions (shield only, host side)
await step(200); tables.B.st.f[1].tpCd = 0; let TX = 100, TY = 11, bestD = -1; for (let x = 10; x <= 190; x += 15) for (let y = 10; y <= 110; y += 15) { const d = Math.min(...tables.B.st.f.filter((_, i) => i !== 1).map(q => Math.hypot(q.x - x, q.y - y))); if (d > bestD) { bestD = d; TX = x; TY = y; } }
const ok1 = Bn.act({ op: 'tap', x: TX, y: TY });
assert(ok1 && Math.abs(tables.B.st.f[1].x - TX) < 0.01 && tables.B.st.f[1].y === TY, 'B\'s tap teleports B at once on B (client prediction)');
await step(500); assert(A.stats.inputsApplied >= 1 && (fB().fx?.k === 'tp' || Math.hypot(fB().x - TX, fB().y - TY) < 6), `host applied B\'s signed input (B at ${fB().x.toFixed(1)},${fB().y.toFixed(1)} on A)`);
await step(300); assert(Math.hypot(tables.B.st.f[1].x - fB().x, tables.B.st.f[1].y - fB().y) < 4, 'replica converged to the host state after the snapshot');
// forged / replayed / foreign inputs
const sB = tables.B.seats[1], before = A.stats.inputsApplied; const good = { mid: tables.A.id, seat: 1, seq: sB.seq + 1, tick: 0, act: { op: 'tap', x: 20, y: 20 } }; const goodSig = B.signInput(good, sB.sk);
arcadeFor('C').send({ op: 'bi', mid: tables.A.id, sm: goodSig }); // C replays B's signed input as its own
arcadeFor('B').send({ op: 'bi', mid: tables.A.id, sm: { ...goodSig, act: { op: 'tap', x: 190, y: 110 } } }); // tampered
arcadeFor('B').send({ op: 'bi', mid: tables.A.id, sm: B.signInput({ ...good, seat: 2 }, sB.sk) }); // someone else's (AI) seat
arcadeFor('B').send({ op: 'bi', mid: tables.A.id, sm: { ...B.signInput({ ...good, seq: 1 }, sB.sk) } }); // stale seq (replay)
arcadeFor('B').send({ op: 'bi', mid: tables.A.id, sm: { ...goodSig, pad: 'x'.repeat(500) } }); // oversize
await step(300); assert(A.stats.inputsApplied === before, `forged/tampered/foreign-seat/replayed/oversize inputs all dropped (dropped ${A.stats.inputsDropped})`);
arcadeFor('B').send({ op: 'bi', mid: tables.A.id, sm: goodSig }); await step(300); assert(A.stats.inputsApplied === before + 1, 'the genuine one is applied');
// flood: 100 inputs in 1 s from B's client -> client bucket + host bucket cap it
const f0 = A.stats.inputsApplied, s0 = Bn.stats.inputsSent; for (let i = 0; i < 100; i++) { Bn.act({ op: 'charge', x: 50, y: 50 }); if (i % 10 === 0) await step(100); } await step(400);
assert(Bn.stats.inputsSent - s0 <= BN.IN_RATE.burst + BN.IN_RATE.rate * 1.5 && A.stats.inputsApplied - f0 <= BN.IN_RATE.burst + BN.IN_RATE.rate * 1.5, `input flood capped (B sent ${Bn.stats.inputsSent - s0}, host applied ${A.stats.inputsApplied - f0} of 100)`);
Bn.act({ op: 'release', x: 50, y: 50 }); await step(300);
// ---------- 4) remote victim-signed hits
for (const p of tables.A.st.f) p.shield = 0; const hA = tables.A.st.f[0], hBv = tables.A.st.f[1]; Object.assign(hBv, { x: 60, y: 60, vx: 0, vy: 0, hp: B.HP }); Object.assign(hA, { x: 68, y: 60, vx: 0, vy: 0 }); hA.punchCd = 0; tables.A.seats.forEach((s, i) => { if (s.ai) Object.assign(tables.A.st.f[i], { shield: 99, x: 180 - (i % 2) * 170, y: 10 + (i % 3) * 50, vx: 0, vy: 0 }); }); // keep AIs away so the tap targets B (was flaky)
const hp0 = hBv.hp, ha0 = A.stats.hitsApplied; A.act({ op: 'tap', x: hBv.x, y: hBv.y }); const prop = tables.A.st.pending.find(h => h.vic === 1);
assert(prop && prop.kind === 'punch', 'host punches the remote human: hit only PROPOSED (needs B\'s signature)');
await step(150); assert(hBv.hp === hp0 || A.stats.hitsApplied > ha0, 'not applied by the host on its own');
await step(500); assert(A.stats.hitsApplied > ha0 && tables.A.st.f[1].hp < hp0 && Bn.stats.hitsSent >= 1, `B victim-signed it, host applied it (B hp ${hp0} -> ${tables.A.st.f[1].hp})`);
let same = false; for (let i = 0; i < 30 && !same; i++) { await step(66); same = tables.B.st.f[1].hp === tables.A.st.f[1].hp; } assert(same, 'B\'s replica shows the same HP as the host');
// forged hits: unproposed hid, wrong attacker, signed by someone else, sent by a non-victim
const added = [], sset = tables.A.m.signed.set.bind(tables.A.m.signed); tables.A.m.signed.set = (k, v) => { added.push(v); return sset(k, v); }; // watch what the host accepts
const fake = { mid: tables.A.id, hid: '999999:p:0:1', att: 0, vic: 1, dmg: 30, kx: 0, ky: 0, tick: tables.A.st.tick }; const h1 = A.stats.hitsApplied;
arcadeFor('B').send({ op: 'bh', mid: tables.A.id, sh: B.signHit(tables.A.id, fake, sB.sk) });
Object.assign(hA, { x: hBv.x + 8, y: hBv.y }); hA.punchCd = 0; for (const p of tables.A.st.f) if (p !== hA && p !== hBv) p.shield = 99; hBv.shield = 0; A.act({ op: 'tap', x: hBv.x, y: hBv.y }); const p2 = tables.A.st.pending.find(h => h.vic === 1 && h.att === 0 && h.kind === 'punch' && !tables.A.st.resolved.has(h.hid));
if (p2) { arcadeFor('B').send({ op: 'bh', mid: tables.A.id, sh: B.signHit(tables.A.id, { ...p2, att: 3 }, sB.sk) }); arcadeFor('C').send({ op: 'bh', mid: tables.A.id, sh: B.signHit(tables.A.id, p2, nacl.sign.keyPair().secretKey) }); }
await step(40); assert(A.stats.hitsDropped >= 2, `forged hits refused (unproposed hid / re-attributed attacker / foreign signer: ${A.stats.hitsDropped} dropped)`);
await step(600); assert(!added.some(x => x.hid === fake.hid) && !tables.A.st.resolved.has(fake.hid) && (!p2 || added.filter(x => x.hid === p2.hid).every(x => x.att === 0)), 'only genuine victim-signed proposals apply (fake hid never applied, attacker never re-attributed)');
// ---------- 5) third human joins mid-match; packet + rate bounds
const Cn = await joiner('C', { theme: 'pink' }); assert(!!Cn && seatsOf('A') === 'A,B,C,AI,AI,AI' && seatsOf('B') === seatsOf('A') && seatsOf('C') === seatsOf('A'), 'C joins the running 3-human match, all three agree on seats');
assert(A.peers() === 3 && Bn.peers() === 3 && Cn.peers() === 3 && new Set(['A', 'B', 'C'].map(c => nodes[c].rot.host)).size === 1, 'shared roster of 3, one host');
for (const p of tables.A.st.f) p.shield = 0; await step(4000);
const kos = tables.A.st.f.reduce((s, p) => s + p.ko, 0); assert(tables.A.st.tick > 300 && kos >= 0, `match keeps running with 3 humans + 3 AI (tick ${tables.A.st.tick}, ${kos} KOs)`);
const rates = [...sent.entries()].filter(([k]) => +k.split('@')[1] > 2).map(([, v]) => v), maxRate = Math.max(...rates);
assert(maxRate < RX.RX.GAME.rate, `per-sender rate max ${maxRate} msgs/s < RxGate game budget ${RX.RX.GAME.rate}/s`);
assert(maxPkt.n < RX.RX.DEFAULT_MAX && A.stats.maxOut <= BN.LIMITS.snap + 256, `largest packet ${maxPkt.n} B (snapshot ${A.stats.maxOut} B) < ${RX.RX.DEFAULT_MAX} B RxGate cap`);
// ---------- 6) host leaves -> planned hand-off, AI takes the seat, scores carry over
const pre = tables.B.st.f.map(p => p.ko + p.deaths), preTick = tables.B.st.tick; A.leave(); down.add('A'); await step(1500);
const nh = Bn.rot.host; assert((nh === 'B' || nh === 'C') && Cn.rot.host === nh && Bn.rot.epoch === Cn.rot.epoch && Bn.rot.epoch >= 1, `A left: planned hand-off to ${nh} (epoch ${Bn.rot.epoch}), B and C agree`);
assert(tables[nh].seats[0].ai && seatsOf('B') === seatsOf('C') && seatsOf('B') === 'AI,B,C,AI,AI,AI', 'AI took A\'s fighter mid-round');
const post = tables.B.st.f.map(p => p.ko + p.deaths); assert(tables.B.st.tick > preTick && post.every((v, i) => v >= pre[i]), `round goes on from the same state (tick ${preTick} -> ${tables.B.st.tick}, scores kept)`);
const sNew = nodes[nh].stats.snapsSent; await step(1000); const other = nh === 'B' ? Cn : Bn; assert(nodes[nh].stats.snapsSent > sNew && other.stats.snapsApplied > 0, 'new host streams snapshots, the other replica follows');
// ---------- 7) host crash -> failover + eviction
down.add(nh); await step(9000); const last = nh === 'B' ? 'C' : 'B';
assert(nodes[last].rot.host === last && nodes[last].isHost, `host ${nh} crashed: ${last} failed over and hosts`);
assert(tables[last].seats.filter(s => !s.ai).length === 1 && nodes[last].peers() === 1, `vanished ${nh} evicted, AI took its seat (${seatsOf(last)})`);
const tk = tables[last].st.tick; await step(500); assert(tables[last].st.tick > tk, 'solo survivor keeps playing with AI');
// ---------- 8) rematch requested by a replica + age bands
for (const c of Object.keys(nodes)) { nodes[c].stop?.(); } down.clear(); subs.clear(); wire.length = 0; for (const k of Object.keys(nodes)) delete nodes[k]; for (const k of Object.keys(board)) delete board[k];
const H = await host('H', { roundT: 150 }); await step(600); const J = await joiner('J', { theme: 'gold' }); assert(!!J, 'J joined H');
await step(2500); assert(tables.H.over && tables.J.over, 'short round over on host and replica');
const r1 = J.requestRematch(); await step(800); assert(r1 === 'asked' && tables.H.round === 1 && tables.J.round === 1 && !tables.H.over && !tables.J.over && tables.J.st.tick < 40, 'replica asked -> host started round 2 -> replica followed');
const Mn = await joiner('M', { minor: true }); assert(Mn === null, 'a minor never finds/joins an adult table (bands never mixed)');
const kp = nacl.sign.keyPair(); const tb = board.M?.t.get(tables.H.id) || { mid: tables.H.id, from: 'H' }; const rr = await new Promise(res => { BN.joinBrawl({ arcade: arcadeFor('M2'), table: tb, p: { code: 'M2', name: 'kid', minor: true, pub: b64(kp.publicKey) }, timers: T }).then(res); (async () => { for (let i = 0; i < 40; i++) await step(33); })(); });
assert(rr === null && seatsOf('H').split(',').filter(x => x !== 'AI').length === 2, 'a minor pinging the adult table directly is refused');
assert(BN.shouldJoin({ mid: 'b', open: 5 }, 'a') === false && BN.shouldJoin({ mid: 'a', open: 5 }, 'b') === true && BN.shouldJoin({ mid: 'z', open: 3 }, 'a') === true && BN.shouldJoin({ mid: 'a', open: 3 }, 'a') === false, 'join tie-break: two solo tables merge into the lower id; tables with humans always win');
console.log('ALL BRAWLNET SMOKE OK'); process.exit(0);
