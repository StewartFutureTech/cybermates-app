// Gossip membership simulation (1,000+ simulated phones). Imported by smoke.mjs; prints numbers used in README.
import * as G from '../src/membership.js';
import nodeCrypto from 'node:crypto';
G.setEd25519({ // node:crypto Ed25519 for simulation speed; keys as {publicKey: raw32, secretKey: KeyObject}
  keyPair: () => { const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ed25519'); return { publicKey: new Uint8Array(publicKey.export({ format: 'der', type: 'spki' }).subarray(12)), secretKey: privateKey }; },
  sign: (m, sk) => new Uint8Array(nodeCrypto.sign(null, m, sk)),
  verify: (m, sig, pub) => nodeCrypto.verify(null, m, nodeCrypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pub)]), format: 'der', type: 'spki' }), sig),
});
G.CFG.settleMs = 0; // sim compresses minutes into ms: no in-flight settle window for digests
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const rng = G.seededRng(7), net = new G.SimNet(rng), rv = new G.Rendezvous();
const N = 1000, SH = 'gaming:halo', prof = { lookingFor: ['gaming'], games: ['Halo'] };
const mk = (i, p = prof) => { const m = new G.Member({ mode: 'sharded', code: 'P' + String(i).padStart(6, '0'), profile: p, now: net.now, net, rng }); net.nodes.set(m.code, m); return m; };
// shards
{ const s = G.shardsFor({ lookingFor: ['dating', 'gaming'], games: ['Halo', 'Apex Legends'], lat: 30.27, lng: -97.74 });
  assert(s.shards.join() === 'dating:9v6,gaming:halo,gaming:apex-legends', 'shards: mode+geohash cell for dating, game tags (global) for gaming'); }
// warm network: 1,000 phones that already know each other (equivalent to a converged state)
const t0 = Date.now(); const nodes = Array.from({ length: N }, (_, i) => mk(i));
const rows = nodes.map(n => n.row(SH)); const t1 = Date.now(); for (const r of rows) nodes[0].accept(r); console.log(`  sign ${N} rows ${t1 - t0} ms, verify ${N} rows ${Date.now() - t1} ms`);
for (const n of nodes) for (const r of rows) { n.pins.set(r.code, r.pub); n.active.set(SH + '|' + r.code, r); } // converged starting state (rows already verified once above)
for (const n of nodes.slice(-8)) rv.register(SH, n.code);
console.log(`  warm ${N} nodes in ${Date.now() - t0} ms`);
assert(!G.validRow({ ...rows[0], ip: '1.2.3.4' }) && Object.keys(rows[0]).every(k => !/^(ip|ice|candidate|addr)/i.test(k)), 'rows carry no IP/ICE fields (rejected if present)');
const live = () => nodes.filter(n => n.alive);
const coverage = (pred) => live().filter(pred).length / live().length;
const resetSent = () => nodes.forEach(n => n.sent = 0);
const stats = () => { const s = live().map(n => n.sent); return { avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(2), max: Math.max(...s) }; };
const antiEntropy = rounds => { for (let r = 0; r < rounds; r++) { live().forEach(n => n.syncWith(SH)); net.run(net.t + 500); } };
// JOIN
resetSent(); const j = mk(N); nodes.push(j); const start = net.t; await j.join(rv); 
let t99 = null; while (net.q.length) { net.run(net.t + 10); if (t99 === null && coverage(n => n.active.has(SH + '|' + j.code)) >= 0.99) t99 = net.t - start; }
const pushCov = coverage(n => n.active.has(SH + '|' + j.code)), joinStats = stats(), tEnd = net.t - start;
antiEntropy(2); const aeCov = coverage(n => n.active.has(SH + '|' + j.code));
console.log(`  JOIN N=${N + 1}: push coverage ${(pushCov * 100).toFixed(1)}% (99% at ${t99} ms, quiet at ${Math.round(tEnd)} ms), msgs/node avg ${joinStats.avg} max ${joinStats.max}; after 2 anti-entropy rounds ${(aeCov * 100).toFixed(1)}%`);
assert(pushCov >= 0.98 && aeCov === 1, 'join converges (epidemic push + anti-entropy pull)');
assert(joinStats.avg <= G.FANOUT + 2 && j.active.size >= N, 'join costs ~fanout msgs per node; joiner got full slice from seeds');
// LEAVE
resetSent(); const lv = nodes[10]; lv.leave(); net.run(); antiEntropy(2);
assert(coverage(n => !n.active.has(SH + '|' + lv.code) && n.inactive.get(SH + '|' + lv.code)?.state === 'left') === 1, 'signed leave: everyone moved it to inactive');
console.log(`  LEAVE msgs/node avg ${stats().avg}`);
// forged leave (attacker signs with own key claiming victim's code/pub) rejected
{ const victim = nodes[20], atk = nodes[21]; const forged = { ...victim.row(SH, 'left') }; const bad = atk.row(SH, 'left'); forged.sig = bad.sig;
  nodes[30].receive({ t: 'leave', id: 'forged1', shard: SH, row: forged, ttl: 8, from: atk.code });
  const fake = { ...bad, code: victim.code }; nodes[30].receive({ t: 'leave', id: 'forged2', shard: SH, row: fake, ttl: 8, from: atk.code }); net.run();
  assert(nodes[30].active.has(SH + '|' + victim.code) && coverage(n => n.active.has(SH + '|' + victim.code)) === 1, 'forged leave rejected (bad signature / key-pin mismatch)'); }
// DEAD PHONE: crashes silently; lazy suspicion needs >=2 distinct reporters
{ resetSent(); const dead = nodes[40]; dead.alive = false; const k = SH + '|' + dead.code;
  nodes[41].contactFailed(dead.code, SH); net.run(); 
  assert(coverage(n => n.active.has(k)) > 0.95 && coverage(n => n.suspects.has(k)) > 0.95, '1 failure report => suspect only, still listed');
  nodes[42].contactFailed(dead.code, SH); net.run(); antiEntropy(1);
  const cov = coverage(n => !n.active.has(k)); console.log(`  DEAD removal coverage ${(cov * 100).toFixed(1)}%, msgs/node avg ${stats().avg}`);
  assert(cov >= 0.97, 'dead phone removed after 2 distinct reporters (rest removed lazily below)');
  const lag = live().filter(n => n.active.has(k)); lag.forEach(n => n.contactFailed(dead.code, SH)); net.run(); net.t += G.SUSPECT_TIMEOUT_MS + 1; live().forEach(n => n.tick());
  assert(coverage(n => !n.active.has(k)) === 1, 'stragglers drop it lazily on their own failed contact + suspicion timeout'); }
// FALSE SUSPICION refuted by incarnation bump
{ const y = nodes[50], k = SH + '|' + y.code; nodes[51].contactFailed(y.code, SH); net.run();
  nodes[52].receive({ t: 'suspect', id: 'late', shard: SH, sus: { target: y.code, inc: 0, reporter: nodes[53].code, shard: SH, ts: net.t }, ttl: 8, from: nodes[53].code }); net.run(); // unsigned => ignored
  antiEntropy(1);
  assert(y.inc === 1 && coverage(n => n.active.get(k)?.inc === 1 && !n.suspects.has(k)) >= 0.99, 'live phone refutes suspicion (inc 0->1), stays active'); }
// shard isolation + inactive expiry
{ const d = mk(9999, { lookingFor: ['dating'], lat: 51.5, lng: -0.12 }); await d.join(rv); net.run();
  assert(![...d.active.values()].some(r => r.shard === SH) && !nodes[0].active.has('dating:gcp|' + d.code), 'phones only join/learn shards matching their modes');
  const n0 = nodes[0]; net.t += G.INACTIVE_DROP_MS + 1; n0.tick(); assert(n0.inactive.size === 0, 'inactive stubs dropped after 2 days'); }
// full protocol bootstrap (no warm state): 200 phones join one by one through rendezvous
{ const net2 = new G.SimNet(G.seededRng(3)), rv2 = new G.Rendezvous(), ns = [];
  for (let i = 0; i < 200; i++) { const m = new G.Member({ mode: 'sharded', code: 'B' + String(i).padStart(6, '0'), profile: prof, now: net2.now, net: net2, rng: G.seededRng(i + 1) }); net2.nodes.set(m.code, m); ns.push(m); await m.join(rv2); net2.run(net2.t + 300); }
  net2.run(); for (let r = 0; r < 2; r++) { ns.forEach(n => n.syncWith(SH)); net2.run(); }
  const full = ns.filter(n => n.active.size === 200).length; console.log(`  BOOTSTRAP 200 sequential joins: ${full}/200 full views, avg msgs/node total ${(ns.reduce((a, n) => a + n.sent, 0) / 200).toFixed(0)}`);
  assert(full === 200, 'cold bootstrap via rendezvous seeds converges to full views'); }
// ---- partition / silo resistance ----
const cluster = (net, rv, prefix, n, p, rngSeed) => Array.from({ length: n }, (_, i) => { const m = new G.Member({ mode: 'sharded', code: prefix + String(i).padStart(5, '0'), profile: p, now: net.now, net, rng: G.seededRng(rngSeed + i) }); net.nodes.set(m.code, m); return m; });
const settle = (net, ms = 1000) => net.run(net.t + ms);
// gamer bootstraps via a sports-only cluster; the rendezvous has no live seeds for the gamer's shard
{ const net3 = new G.SimNet(G.seededRng(11)), rv3 = new G.Rendezvous(8, net3.now);
  const sports = cluster(net3, rv3, 'S', 40, { lookingFor: ['gaming'], games: ['FIFA'] }, 100), halo = cluster(net3, rv3, 'H', 40, prof, 200);
  for (const c of [sports, halo]) for (const m of c) await m.join(rv3); settle(net3);
  // random peer sampling seeded with a couple of cross-cluster acquaintances, then shuffled
  for (const m of [...sports, ...halo]) m.addLinks(m.pick([...sports, ...halo].map(x => x.code), G.LINKS));
  for (let r = 0; r < 3; r++) { [...sports, ...halo].forEach(m => m.refreshLinks()); settle(net3); }
  rv3.down.add(SH); // bootstrap server can't help for halo (e.g. cold / unavailable)
  const g = new G.Member({ mode: 'sharded', code: 'GAMER00001', profile: prof, now: net3.now, net: net3, rng: G.seededRng(999) }); net3.nodes.set(g.code, g);
  g.addLinks(sports.slice(0, G.LINKS).map(s => s.code)); await g.join(rv3); settle(net3);
  assert(g.peers(SH).length === 0, 'gamer initially stuck in sports-only contacts');
  let rounds = 0; while (g.peers(SH).length < 30 && rounds < 6) { g.maintain(rv3); settle(net3); rounds++; }
  console.log(`  SILO: gamer found ${g.peers(SH).length}/40 halo peers after ${rounds} maintenance round(s) via long-link shard lookup`);
  assert(g.peers(SH).length >= 30 && rounds <= 3, 'gamer escapes sports-only cluster via long links + shard lookup');
  assert(!g.active.has('gaming:fifa|' + sports[0].code) && rv3.seeds('gaming:fifa', 'x').every(c => c.startsWith('S')), 'rendezvous seeds are per requested shard'); }
// two disjoint clusters of the SAME shard merge through a single long link
{ const net4 = new G.SimNet(G.seededRng(21)), rvA = new G.Rendezvous(8, net4.now), rvB = new G.Rendezvous(8, net4.now);
  const A = cluster(net4, rvA, 'A', 60, prof, 300), B = cluster(net4, rvB, 'B', 60, prof, 400);
  for (const m of A) await m.join(rvA); for (const m of B) await m.join(rvB); settle(net4); for (let r = 0; r < 2; r++) { [...A, ...B].forEach(m => m.syncWith(SH)); settle(net4); }
  assert(A.every(m => m.peers(SH).every(c => c.startsWith('A'))), 'clusters start disjoint (partition)');
  A[0].addLinks([B[0].code]); B[5].addLinks([A[7].code]);
  let rounds = 0; const merged = () => [...A, ...B].every(m => m.peers(SH).length === 119);
  while (!merged() && rounds < 8) { [...A, ...B].forEach(m => m.links.size && m.maintain(null)); settle(net4); [...A, ...B].forEach(m => m.syncWith(SH)); settle(net4); rounds++; }
  const full = [...A, ...B].filter(m => m.peers(SH).length === 119).length, minV = Math.min(...[...A, ...B].map(m => m.peers(SH).length));
  console.log(`  MERGE: 2×60 disjoint clusters: ${full}/120 full views after ${rounds} round(s), smallest view ${minV}/119, via 1 long link each way`);
  assert(full >= 118 && minV >= 110, 'disjoint clusters merge via long links (dormant sharded fallback; ≥98% full views)'); }
// ---- adaptive mode: global full list below threshold, sharded above, with hysteresis ----
{ assert(G.nextMode('global', 90_000) === 'global' && G.nextMode('global', 109_000) === 'global' && G.nextMode('global', 111_000) === 'sharded', 'below/near threshold: global; >threshold+10%: sharded');
  assert(G.nextMode('sharded', 95_000) === 'sharded' && G.nextMode('sharded', 89_000) === 'global', 'hysteresis: stays sharded until <threshold-10%');
  const A2 = await import('../src/appconfig.js'); const { keygen } = ({ ...(await import('../src/killswitch.js')), ...(await import('./lib/sign.mjs')) }); const K = keygen();
  const cfg = (await import('./lib/sign.mjs')).signConfig({ type: 'app_config', min_version: 1, issued_at: Date.now(), nonce: 'sh1', shard_threshold: 20 }, K.privateKey);
  assert(!A2.applyConfig({ ...cfg, shard_threshold: 5 }, K.publicKey) && A2.applyConfig(cfg, K.publicKey) && A2.getShardThreshold() === 20, 'shard threshold set via signed app_config'); 
  const thr = A2.getShardThreshold(); A2.resetConfig();
  const net5 = new G.SimNet(G.seededRng(5)), rv5 = new G.Rendezvous(8, net5.now);
  const mixed = Array.from({ length: 30 }, (_, i) => ({ lookingFor: ['gaming'], games: [i % 2 ? 'Halo' : 'FIFA'] }));
  const ms = mixed.map((p, i) => { const m = new G.Member({ code: 'M' + String(i).padStart(5, '0'), profile: p, now: net5.now, net: net5, rng: G.seededRng(50 + i), mode: G.nextMode(null, 10, thr) }); net5.nodes.set(m.code, m); return m; });
  for (const m of ms) { await m.join(rv5); settle(net5, 300); } for (let r = 0; r < 3; r++) { ms.forEach(m => m.syncWith(G.GLOBAL)); settle(net5); }
  assert(ms.every(m => m.shards[0] === G.GLOBAL && m.peers(G.GLOBAL).length === 29), 'global mode: every node holds the FULL active list');
  let mode = 'global', flips = 0; for (const est of [21, 23, 19, 25]) { const nm = G.nextMode(mode, est, thr); if (nm !== mode) { flips++; mode = nm; for (const m of ms) { await m.setMode(mode, rv5); settle(net5, 300); } } }
  for (let r = 0; r < 3; r++) { ms.forEach(m => m.syncWith(m.shards[0])); settle(net5); }
  console.log('  ADAPTIVE sharded views:', [...new Set(ms.map(m => m.peers(m.shards[0]).length + '/' + m.active.size))].join(' '), 'flips', flips, mode);
  assert(flips === 1 && mode === 'sharded' && ms.every(m => m.peers(m.shards[0]).length >= 13 && [...m.active.values()].every(r => r.shard === m.shards[0])), 'transition to sharded once (no flapping at 21/23/19); nodes keep only own shard');
  for (const est of [17]) { const nm = G.nextMode(mode, est, thr); if (nm !== mode) { mode = nm; for (const m of ms) { await m.setMode(mode, rv5); settle(net5, 300); } } }
  for (let r = 0; r < 3; r++) { ms.forEach(m => m.syncWith(G.GLOBAL)); settle(net5); }
  assert(mode === 'global' && ms.every(m => m.peers(G.GLOBAL).length === 29), 'drop below threshold-10% => back to global full list'); }
// ---- lazy verification + compact wire encoding ----
{ const net6 = new G.SimNet(G.seededRng(61)), a = new G.Member({ code: 'LAZY0001', profile: prof, now: net6.now, net: net6 }), b = new G.Member({ code: 'LAZY0002', profile: prof, now: net6.now, net: net6 });
  const good = b.row(G.GLOBAL), forged = { ...a.row(G.GLOBAL), code: 'LAZY0003', sig: good.sig };
  assert(a.accept(good) && a.accept(forged) && !a.isVerified('LAZY0002') && a.active.size === 2, 'alive rows accepted unverified (filterable/matchable, flagged)');
  const ok = await a.ensureVerified(['LAZY0002', 'LAZY0003']);
  assert(ok.join() === 'LAZY0002' && a.isVerified('LAZY0002') && !a.active.has(G.GLOBAL + '|LAZY0003'), 'verified on display/contact; forged row dropped');
  assert(!a.accept({ ...b.row(G.GLOBAL, 'left'), sig: good.sig }), 'state change (leave) verified immediately');
  const enc = G.encodeRow(good); assert(JSON.stringify(G.decodeRow(enc)) === JSON.stringify(good) && JSON.stringify(enc).length < JSON.stringify(good).length - 40, `compact row ${JSON.stringify(enc).length} B vs ${JSON.stringify(good).length} B`);
  console.log('  WebCrypto Ed25519 available here:', await G.hasWebCryptoEd25519()); }
