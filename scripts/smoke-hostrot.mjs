// HOST ROTATION + JOIN-ANYTIME smoke: N simulated peers on a lossy/laggy network with a virtual clock.
// rotation order, skipping bad nodes, handoff continuity, crash failover, split-brain via epochs, join mid-game,
// turn-based queue + bot replacement. node scripts/smoke-hostrot.mjs
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const nacl = (await import('tweetnacl')).default, { b64 } = await import('../src/vault.js');
const R = await import('../src/arcade/host-rotation.js'), J = await import('../src/arcade/join-anytime.js'), M = await import('../src/arcade/match.js'), E = await import('../src/arcade/engine.js');
// ---- simulated network: per-node ping (one-way = ping/2) + loss, deterministic rng, virtual clock
function sim(specs, { termMs = 60e3, rng = E.mulberry32(7) } = {}) {
  let t = 0; const q = [], nodes = new Map(), keys = {}, roster = {}, down = new Set(), parts = { on: false, a: new Set() };
  for (const s of specs) { const k = nacl.sign.keyPair(); keys[s.id] = k; roster[s.id] = b64(k.publicKey); }
  for (const s of specs) { const n = new R.HostRotation({ id: s.id, secretKey: keys[s.id].secretKey, roster, termMs, now: () => t,
      send: m => { for (const o of specs) if (o.id !== s.id) { if (parts.on && parts.a.has(s.id) !== parts.a.has(o.id)) continue; if (rng() < Math.max(s.loss || 0, o.loss || 0)) continue; q.push({ at: t + ((s.ping || 20) + (o.ping || 20)) / 4, to: o.id, m }); } } });
    n.setMetrics({ ping: s.ping || 20, loss: s.loss || 0, ...(s.battery != null ? { battery: s.battery, charging: !!s.charging } : {}), score: s.score || 0 }); n.state = { n: 0 }; n.setState = snap => { n.state = snap; }; n.getState = () => n.state; nodes.set(s.id, n); }
  const run = ms => { const end = t + ms; while (t < end) { t += 50; q.sort((a, b) => a.at - b.at); while (q.length && q[0].at <= t) { const { to, m } = q.shift(); if (!down.has(to)) nodes.get(to).receive(m); }
      for (const [id, n] of nodes) if (!down.has(id)) { n.tick(); if (n.isHost && t % 1000 === 0) { n.state = { n: (n.state?.n || 0) + 1 }; n.commit(n.state); } } } };
  return { nodes, run, down, parts, keys, roster, get t() { return t; }, live: () => [...nodes].filter(([id]) => !down.has(id)).map(([, n]) => n) };
}
const agree = live => new Set(live.map(n => n.host + '@' + n.epoch)).size === 1;
// ---- pure order / eligibility
const ns = [{ id: 'c', score: 5 }, { id: 'a', score: 5 }, { id: 'b', score: 9 }, { id: 'd', score: 0, ping: 900 }, { id: 'e', battery: 0.1 }, { id: 'f', battery: 0.1, charging: true }];
assert(R.rankOrder(ns).map(n => n.id).join('') === 'bacdef', 'deterministic order: score desc, id asc');
assert(!R.eligible(ns[3]) && !R.eligible(ns[4]) && R.eligible(ns[5]) && !R.eligible({ loss: 0.2 }), 'eligibility skips high ping / lossy / low battery (unless charging)');
assert(R.nextHost(ns, 'c') === 'f' && R.nextHost(ns, 'f') === 'b' && R.nextHost(ns, 'b') === 'a', 'next eligible is cyclic and skips d,e');
assert(R.nextHost([{ id: 'x', ping: 999 }, { id: 'y', ping: 999 }], 'x') === 'x', 'no eligible node: falls back without throwing');
assert((await R.readBattery({ getBattery: async () => ({ level: 0.5, charging: false }) })).battery === 0.5 && Object.keys(await R.readBattery({})).length === 0, 'navigator.getBattery probe (+ absent API)');
// ---- signing
{ const k = nacl.sign.keyPair(), m = R.signMsg({ t: 'hb', from: 'a', epoch: 1 }, k.secretKey); assert(R.verifyMsg(m, b64(k.publicKey)) && !R.verifyMsg({ ...m, epoch: 2 }, b64(k.publicKey)), 'signed messages verify; tampering detected'); }
// ---- rotation across 6 peers with varied ping/loss; bad nodes never host
{ const S = sim([{ id: 'p1', ping: 30 }, { id: 'p2', ping: 60, loss: 0.02 }, { id: 'p3', ping: 400 }, { id: 'p4', ping: 40, loss: 0.15 }, { id: 'p5', ping: 80, battery: 0.1 }, { id: 'p6', ping: 50, loss: 0.03 }], { termMs: 12e3 });
  S.run(5e3); const n1 = S.nodes.get('p1'); assert(agree(S.live()) && n1.host === 'p1' && n1.epoch === 0, 'all peers agree on initial host p1 @ epoch 0');
  const hosts = []; for (let i = 0; i < 6; i++) { S.run(12e3); hosts.push(n1.host); }
  assert(agree(S.live()), 'after 6 terms all peers agree on host+epoch (' + n1.host + '@' + n1.epoch + ')');
  assert(hosts.every(h => ['p1', 'p2', 'p6'].includes(h)) && new Set(hosts).size === 3, 'round-robin only over eligible p1,p2,p6: ' + hosts.join(','));
  assert(n1.log.filter(l => l.why === 'term' || l.why === 'handoff').length >= 5 && n1.epoch >= 6, 'each handoff bumps the epoch (' + n1.epoch + ')');
  const seqs = S.live().map(n => n.seq), st = S.live().map(n => n.state.n); assert(Math.max(...seqs) - Math.min(...seqs) <= 3 && st.every((v, i) => v <= seqs[i] + 1), 'state seq continuous across handoffs (seqs ' + seqs.join('/') + ')');
  assert(n1.seq > 6 * 10, 'sequence never reset by a handoff (seq=' + n1.seq + ')'); }
// ---- handoff state continuity (exact)
{ const S = sim([{ id: 'a' }, { id: 'b' }, { id: 'c' }], { termMs: 10e3 }); S.run(9.9e3); const a = S.nodes.get('a'), seq = a.seq, snapN = a.state.n;
  S.run(300); const b = S.nodes.get('b'); assert(b.host === 'b' && b.epoch === 1 && !a.isHost, 'term expiry: a hands off to b; a steps down');
  assert(b.log.at(-1).seq >= seq && b.log.at(-1).seq <= seq + 3 && b.state.n >= snapN, 'new host resumes from handed-off snapshot + seq');
  assert(!a.commit({ n: -1 }), 'old host can no longer commit'); }
// ---- host crash failover
{ const S = sim([{ id: 'a' }, { id: 'b', ping: 30 }, { id: 'c', ping: 35, loss: 0.02 }, { id: 'd', ping: 500 }], { termMs: 120e3 }); S.run(5e3); const before = S.nodes.get('b').seq;
  S.down.add('a'); S.run(6e3); const live = S.live(); assert(agree(live) && live[0].host === 'b' && live[0].epoch === 1, 'host crash: missed heartbeats -> b elected @ epoch 1 (' + live.map(n => n.host).join() + ')');
  assert(S.nodes.get('b').seq >= before, 'failover keeps freshest replicated seq');
  S.down.add('b'); S.run(8e3); assert(agree(S.live()) && S.nodes.get('c').host === 'c' && S.nodes.get('c').epoch === 2, 'second crash: c takes over (d skipped, high ping) @ epoch 2'); }
// ---- split brain: partition then heal; stale ex-host ignored
{ const S = sim([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }], { termMs: 600e3 }); S.run(3e3);
  S.parts.on = true; S.parts.a = new Set(['a']); S.run(8e3); const [a, b] = ['a', 'b'].map(i => S.nodes.get(i));
  assert(a.host === 'a' && a.epoch === 0 && b.host === 'b' && b.epoch === 1, 'partition: majority side elects b @ epoch 1, isolated a still thinks epoch 0');
  S.parts.on = false; S.run(4e3); assert(agree(S.live()) && a.host === 'b' && !a.isHost, 'heal: stale epoch-0 host a sees epoch 1 and steps down');
  const bad = R.signMsg({ t: 'state', from: 'a', epoch: 0, host: 'a', seq: 1e9, snap: { n: -1 } }, S.keys.a.secretKey); const r = S.nodes.get('c').receive(bad);
  assert(r.reason === 'stale-epoch' && S.nodes.get('c').state.n !== -1, 'stale-epoch state from ex-host rejected');
  const forged = R.signMsg({ t: 'claim', from: 'd', epoch: 1, host: 'a', seq: 1, snap: {} }, S.keys.c.secretKey); assert(S.nodes.get('b').receive(forged).reason === 'signature', 'forged claim (wrong key) rejected');
  const early = R.signMsg({ t: 'claim', from: 'd', epoch: S.nodes.get('c').epoch + 1, host: 'd', prev: 'b', seq: 1, snap: {} }, S.keys.d.secretKey); assert(S.nodes.get('c').receive(early).reason === 'host-alive', 'premature claim while host is alive rejected');
  const hand = R.signMsg({ t: 'handoff', from: 'c', epoch: S.nodes.get('d').epoch + 1, host: 'c', seq: 1, snap: {} }, S.keys.c.secretKey); assert(S.nodes.get('d').receive(hand).reason === 'not-host', 'handoff from a non-host rejected'); }
// ---- Match integration: rotation carries the authoritative game state
{ const kp = () => nacl.sign.keyPair(), A = kp(), B = kp(); const seats = [{ code: 'A', pub: b64(A.publicKey), adult: true }, { code: 'B', pub: b64(B.publicKey), adult: true }];
  const mA = new M.Match({ id: 'm1', game: 'connect4', mode: '1v1', seats: seats.map(s => ({ ...s })) }), mB = new M.Match({ id: 'm1', game: 'connect4', mode: '1v1', seats: seats.map(s => ({ ...s })) });
  let t = 0; const roster = { A: seats[0].pub, B: seats[1].pub }, ra = mA.hostSession({ id: 'A', secretKey: A.secretKey, roster, termMs: 5e3, now: () => t, send: m => rb.receive(m) }), rb = mB.hostSession({ id: 'B', secretKey: B.secretKey, roster, termMs: 5e3, now: () => t, send: m => ra.receive(m) });
  mA.receive(mA.makeMove(0, { col: 3 }, A.secretKey)); ra.commit(mA.snapshotAuth()); assert(mB.seq === 1 && mB.head === mA.head, 'host commit replicates signed-move state to peer');
  t = 5e3; ra.tick(); assert(rb.isHost && rb.epoch === 1 && mB.seq === 1, 'Match handoff: B becomes authority with identical seq/head');
  const mv = mB.makeMove(1, { col: 3 }, B.secretKey); assert(mB.receive(mv).ok, 'game continues on new host (hash chain intact)'); }
// ---- join anytime: real-time
{ const w = new E.World({ seed: 1, game: null }); w.fillBots(); for (let i = 0; i < 20; i++) w.step(); const bots = w.bots().length;
  const p = J.joinRealtime(w, 'NEW', { name: 'new' }); assert(p.alive && w.players.has('NEW') && w.bots().length === bots - 1, 'real-time join mid-game: spawns alive immediately, a bot steps aside');
  const m = new M.Matchmaker({ now: () => 1e9 }); const h1 = { code: 'H1', adult: true }; m.enqueue(h1, 'tronduel', '2v2'); const mt = m.tryForm(m.key('tronduel', '2v2', h1), 'tronduel', '2v2', true).match; const r = mt.join({ code: 'H2', adult: true });
  assert(r.seated === 'now' && mt.seats.filter(s => !s.ai).length === 2, 'tronduel: joiner takes an AI seat now (no protected round)'); }
// ---- turn-based queue + bot replacement
{ const T = new J.TurnTable({ seats: 2 }); assert(T.seats.every(s => s.ai), 'auto-fill: empty table seated with bots'); assert(T.ping({ code: 'H1', adult: true }).seated, 'between rounds: ping seats immediately (replacing a bot)');
  T.startRound(); const r = T.ping({ code: 'H2', adult: true }); assert(r.queued === 1 && T.seats.filter(s => s.ai).length === 1, 'mid-round ping: queued, bot keeps playing');
  T.endRound(); assert(T.seats.every(s => !s.ai) && T.waiting.length === 0, 'round boundary: queued player replaces the bot');
  T.startRound(); T.leave('H2'); assert(T.seats[1].ai, 'leaver mid-round: bot takes the seat');
  T.ping({ code: 'K', minor: true }); T.endRound(); assert(T.waiting.length === 1, 'minor not seated with adults (band separation)');
  const m = new M.Matchmaker({ now: () => 1e9 }); const h1 = { code: 'H1', adult: true }; m.enqueue(h1, 'chess', '1v1'); const mt = m.tryForm(m.key('chess', '1v1', h1), 'chess', '1v1', true).match;
  const jr = mt.join({ code: 'H9', adult: true }); assert(jr.seated === 'next-round' && mt.seats.some(s => s.ai), 'chess Match.join: queued, AI kept mid-round'); mt.rematch(); assert(mt.seats.every(s => !s.ai), 'chess rematch: AI replaced by real player'); }
console.log('HOSTROT: ALL PASS');
