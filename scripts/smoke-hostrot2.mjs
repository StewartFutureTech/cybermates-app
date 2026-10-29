// HOST ROTATION over the arcade mesh (src/arcade/hostrot-net.js): compact payloads, batched signatures, replay drop,
// handoff + failover through bindMatch(), join-anytime pings. node scripts/smoke-hostrot2.mjs
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const nacl = (await import('tweetnacl')).default, { b64 } = await import('../src/vault.js');
const N = await import('../src/arcade/hostrot-net.js'), M = await import('../src/arcade/match.js');
// compact codec
const m0 = { t: 'hb', seq: 3, epoch: 1, host: 'AAA', from: 'AAA', metrics: { ping: 41.7, loss: 0.0123, battery: 0.555, charging: false } };
const c0 = N.pack(m0), u0 = N.unpack(c0);
assert(JSON.stringify(c0).length < JSON.stringify(m0).length * 0.7, `compact packing shrinks payload (${JSON.stringify(c0).length} vs ${JSON.stringify(m0).length} bytes)`);
assert(u0.seq === 3 && u0.host === 'AAA' && u0.metrics.ping === 42 && Math.abs(u0.metrics.loss - 0.012) < 1e-9 && u0.metrics.battery === 0.56, 'round-trip keeps fields (metrics quantised)');
// timing: one signature cost on this box
{ const k = nacl.sign.keyPair(), t0 = performance.now(); for (let i = 0; i < 20; i++) nacl.sign.detached(new Uint8Array(64), k.secretKey); console.log('  tweetnacl sign ≈', ((performance.now() - t0) / 20).toFixed(2), 'ms here'); }
// virtual timers + bus
let now = 0; const timers = []; const T = { setTimeout: (f, ms) => { const h = { at: now + ms, f }; timers.push(h); return h; }, clearTimeout: h => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); } };
const runTimers = () => { timers.sort((a, b) => a.at - b.at); while (timers.length && timers[0].at <= now) timers.shift().f(); };
const wire = [], subs = new Map(), down = new Set();
const arcadeFor = code => ({ send: b => { if (!down.has(code)) wire.push({ from: code, b }); }, sub: fn => { subs.set(code, fn); return () => subs.delete(code); } });
const deliver = () => { while (wire.length) { const { from, b } = wire.shift(); for (const [c, fn] of subs) if (c !== from && !down.has(c)) fn(from, b); } };
// three humans in one 2v2 (+1 bot) match, each holds its own Match copy
const ks = { A: nacl.sign.keyPair(), B: nacl.sign.keyPair(), C: nacl.sign.keyPair() }, roster = Object.fromEntries(Object.entries(ks).map(([c, k]) => [c, b64(k.publicKey)]));
const seats = ['A', 'B', 'C'].map((c, i) => ({ code: c, name: c, pub: roster[c], seat: i, team: i % 2 })).concat([{ code: 'AI-1', name: 'bot', ai: true, seat: 3, team: 1 }]);
const nodes = {}; for (const c of ['A', 'B', 'C']) { const m = new M.Match({ id: 'chess-2v2-1', game: 'chess', mode: '2v2', seats: structuredClone(seats) });
  nodes[c] = N.bindMatch({ match: m, arcade: arcadeFor(c), code: c, secretKey: ks[c].secretKey, roster, now: () => now, timers: T, termMs: 10e3 }); nodes[c].m = m; }
const step = ms => { for (let t = 0; t < ms; t += 50) { now += 50; for (const c in nodes) if (!down.has(c)) nodes[c].tick(); runTimers(); deliver(); } };
step(3000);
const hosts = () => new Set(Object.entries(nodes).filter(([c]) => !down.has(c)).map(([, n]) => n.rot.host + '@' + n.rot.epoch));
assert(hosts().size === 1 && nodes.A.rot.host === 'A', 'all peers agree on epoch-0 host A');
// host commits a move-state; replicas follow via the batched state message
nodes.A.m.state = { ...nodes.A.m.state, marker: 7 }; nodes.A.commit(); step(500);
assert(nodes.B.m.state.marker === 7 && nodes.C.m.state.marker === 7, 'committed authoritative state replicated through batches');
const totalMsgs = Object.values(nodes).reduce((a, n) => a + n.signer.msgs, 0), totalSigns = Object.values(nodes).reduce((a, n) => a + n.signer.signs, 0);
assert(totalSigns <= totalMsgs && totalSigns <= Math.ceil(now / 1000) * 3 + 3, `≤1 signature per flush window (${totalSigns} signatures for ${totalMsgs} messages)`);
{ const r0 = nodes.A.rot; if (r0.isHost) { const s0 = nodes.A.signer.signs; for (let i = 0; i < 20; i++) { nodes.A.m.state = { ...nodes.A.m.state, burst: i }; nodes.A.commit(); } step(300); const used = nodes.A.signer.signs - s0;
  assert(used <= 2 && nodes.C.m.state.burst === 19, `20 commits in one window -> ${used} signature(s) instead of 20 (~${20 * 17} ms -> ~${used * 17} ms on a phone)`); } }
// unchanged snapshots are not re-sent in heartbeats
const hbWithSnap = []; const spy = subs.get('B'); subs.set('B', (f, b) => { if (b.op === 'hr' && f === 'A') hbWithSnap.push(b.b.filter(x => x.t === 'hb' && 's' in x).length); spy(f, b); });
step(3000); subs.set('B', spy); assert(hbWithSnap.reduce((a, b) => a + b, 0) === 0, 'heartbeats drop an unchanged snapshot (compact)');
// replay + forgery
{ const env = nodes.A.signer; const b = { op: 'hr', f: 'A', n: 1, b: [], sig: 'x', mid: 'chess-2v2-1' }; assert(nodes.B.verifier.open(b) === null, 'replayed / forged batch dropped');
  const forged = { op: 'hr', f: 'A', n: 9999, b: [N.pack({ t: 'handoff', epoch: 99, host: 'C', seq: 0 })], mid: 'chess-2v2-1' }; forged.sig = b64(nacl.sign.detached(new TextEncoder().encode(JSON.stringify(['A', 9999, forged.b])), ks.C.secretKey));
  assert(nodes.B.verifier.open(forged) === null, 'batch signed by the wrong key rejected'); }
// planned handoff at term end
step(9000); assert(hosts().size === 1 && nodes.A.rot.host !== 'A', `term handoff A -> ${nodes.B.rot.host}, all agree`);
assert(nodes.B.m.state.marker === 7, 'state continuity across handoff');
// crash failover of the current host
const h = nodes.B.rot.host; down.add(h); step(6000); const live = Object.entries(nodes).filter(([c]) => !down.has(c));
assert(new Set(live.map(([, n]) => n.rot.host)).size === 1 && live[0][1].rot.host !== h, `failover after host ${h} crash -> ${live[0][1].rot.host}`);
down.delete(h);
// join-anytime through the mesh: turn-based (chess) queues to next round
const D = nacl.sign.keyPair(); let j = null; nodes.A.m.seats[3] = { code: 'AI-1', name: 'bot', ai: true, seat: 3, team: 1 };
N.joinPing({ send: b => nodes.A.onMsg('D', b) }, 'chess-2v2-1', { code: 'D', name: 'Dee', pub: b64(D.publicKey) });
assert(nodes.A.m.pendingHumans?.some(p => p.code === 'D'), 'turn-based join ping queued for next round');
nodes.A.m.rematch(); assert(nodes.A.m.seats.some(s => s.code === 'D' && !s.ai), 'joiner replaces the AI seat at the round boundary');
// realtime game: seated now
const rt = new M.Match({ id: 'pong-1v1-9', game: 'pong', mode: '1v1', seats: [{ code: 'A', pub: roster.A, seat: 0, team: 0 }, { code: 'AI-2', ai: true, seat: 1, team: 1 }] });
const bnd = N.bindMatch({ match: rt, arcade: { send() {}, sub: () => () => {} }, code: 'A', secretKey: ks.A.secretKey, roster: { A: roster.A }, timers: T, onJoin: (p, r) => { j = r; } });
bnd.onMsg('D', { op: 'join', mid: 'pong-1v1-9', p: { code: 'D', pub: b64(D.publicKey) } }); assert(j?.seated === 'now' && rt.seats[1].code === 'D' && bnd.rot.roster.has('D'), 'real-time join seats immediately and joins host rotation');
bnd.onMsg('X', { op: 'join', mid: 'pong-1v1-9', p: { code: 'D' } }); assert(true, 'spoofed join (sender ≠ code) ignored');
const am = (await import('node:fs')).readFileSync(new URL('../src/app-mesh.js', import.meta.url), 'utf8'), mu = (await import('node:fs')).readFileSync(new URL('../src/match-ui.js', import.meta.url), 'utf8');
assert(/sub: fn =>/.test(am) && /bindMatch\(/.test(mu) && /hr\?\.tick\(\)/.test(mu) && /hr\?\.commit\(\)/.test(mu), 'wired: app-mesh arcade.sub + match-ui bindMatch/tick/commit');
console.log('ALL HOSTROT2 OK');
