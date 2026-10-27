// v38 BROADCAST DISCOVERY + DoS CHEAP SHIELD on the LIVE RECEIVE PATH (src/app-mesh.js bus.on -> RxGate -> bdisc/BDiscWire).
//  Part 1 (pure node): RxGate size caps, per-sender budget + strikes, separate game budget, stranger budget, known senders
//    exempt, anonymous budgets, bounded tracking state. BDiscWire with real LiveNodes over a simulated shared bus: anonymous
//    query (no code/from), band + mode gates, sealed soft-tag answer (no full profile), only the searcher can open it,
//    dedupe, staggered answer offsets, stale/over-cap answers ignored, minors never search dating.
//  Part 2 (real app, admin build, 3 tabs over BroadcastChannel): Discover sends an anonymous bdisc query, peers answer with
//    sealed soft tags, the searcher's bucket refills from answers alone (schedulers frozen), legacy 'disc' gets no full-profile
//    answer, a forged flood / oversize / fake-stranger burst is dropped by the shield before any verify, and normal traffic
//    is never dropped. Run after `npm run build:admin` (regress.sh builds first). node scripts/smoke-rxwire.mjs
import { spawn } from 'node:child_process';
import { RxGate, RX, PER_SENDER } from '../src/shield.js';
import { BDiscWire, REPLY_JITTER_MS, MAX_ANS, QUERY_TTL_MS } from '../src/bdisc.js';
import { LiveNode, decodeVec, pktBytes } from '../src/livemesh.js';
import { newSigningKeys } from '../src/mesh.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail = 1; };
// ---------------- Part 1: pure
let T = 1e6; const now = () => T;
{ const strikes = []; const g = new RxGate({ now, isKnown: c => c === 'K', onStrike: s => strikes.push(s) });
  ok(!g.admit({ k: 'mesh', env: { from: 'A', pad: 'x'.repeat(70000) } }, { sender: 'A' }).ok && g.stats.size === 1, 'shield: oversize mesh packet dropped before verify');
  ok(!g.admit({ k: 'hello', code: 'A', pad: 'x'.repeat(2000) }, { sender: 'A' }).ok, 'shield: oversize hello dropped'); ok(g.admit(null).reason === 'shape' && g.admit({ x: 1 }).reason === 'shape', 'shield: malformed packets dropped');
  let pass = 0; for (let i = 0; i < 100; i++) if (g.admit({ k: 'mesh', env: { from: 'K' } }, { sender: 'K' }).ok) pass++;
  ok(pass === PER_SENDER.burst && g.stats.rate === 100 - PER_SENDER.burst, 'shield: per-sender token bucket (' + pass + ' of 100 burst admitted)'); ok(strikes.length >= 20 && strikes[0].code === 'K' && strikes[0].reason === 'flood', 'shield: repeat flooding fires strikes (' + strikes.length + ')');
  T += 1000; ok(g.admit({ k: 'mesh', env: { from: 'K' } }, { sender: 'K' }).ok, 'shield: budget refills over time');
  let gp = 0; for (let i = 0; i < 150; i++) if (g.admit({ k: 'mesh', env: { from: 'K', type: 'arc' } }, { sender: 'K', game: true }).ok) gp++; ok(gp === RX.GAME.burst, 'shield: game broadcasts have their own larger budget (' + gp + ')');
  const g2 = new RxGate({ now, isKnown: c => c.startsWith('known') }); let st = 0; for (let i = 0; i < 300; i++) if (g2.admit({ k: 'mesh', env: {} }, { sender: 'fake' + i }).ok) st++;
  ok(st === RX.STRANGERS.burst && g2.stats.stranger === 300 - st, 'shield: 300 fake stranger IDs share one budget (' + st + ' admitted, rest never reach verify)');
  let kn = 0; for (let i = 0; i < 50; i++) if (g2.admit({ k: 'mesh', env: {} }, { sender: 'known' + i }).ok) kn++; ok(kn === 50, 'shield: known senders do not use the stranger budget');
  let an = 0; for (let i = 0; i < 40; i++) if (g2.admit({ k: 'bdisc', q: {} }).ok) an++; ok(an === RX.ANON.bdisc.burst, 'shield: anonymous bdisc queries have a global budget (' + an + ')');
  const g3 = new RxGate({ now, isKnown: () => true }); for (let i = 0; i < 10000; i++) g3.admit({ k: 'mesh', env: {} }, { sender: 's' + i }); ok(g3.per.size <= RX.TRACK_MAX, 'shield: tracking state bounded (' + g3.per.size + ' <= ' + RX.TRACK_MAX + ')'); }
// shared-bus simulation using the same relevance rule as app-mesh.js
const mk = (code, profile) => { const sent = []; const live = new LiveNode({ code, keys: newSigningKeys(), profile, full: profile, send: () => {}, now }); const n = { code, live, posts: [], delays: [] };
  n.wire = new BDiscWire({ post: m => { n.posts.push(m); bus(n, m); }, live, vecOf: () => decodeVec(live.tags.v).map(x => x / 3), myModes: () => (profile.lookingFor || []).filter(m => !(profile.age < 18 && m === 'dating')), minor: profile.age < 18, band: live.tags.b, now, rand: () => 0.5, delay: (f, ms) => { n.delays.push(ms); f(); } });
  n.gate = new RxGate({ now }); return n; };
const nodes = []; const seen = {}; const bus = (from, m) => { const raw = JSON.stringify(m); for (const n of nodes) { if (n === from) continue; const msg = JSON.parse(raw);
  const meta = msg.k === 'bdisc-ans' ? (n.wire.pending.has(msg.id) ? { sender: null } : null) : { sender: null }; (seen[n.code] ||= []).push(msg.k + (meta ? '' : ':ignored')); if (!meta || !n.gate.admit(msg, meta).ok) continue;
  if (msg.k === 'bdisc') n.wire.onQuery(msg.q); if (msg.k === 'bdisc-ans') n.wire.onAnswer(msg); } };
const gamer = { games: ['halo', 'chess'], platforms: ['pc'], interests: ['music'], sports: ['soccer'] };
const S = mk('S', { name: 'Sam', age: 25, lookingFor: ['friends', 'gaming'], ...gamer }), A = mk('A', { name: 'Ana', age: 27, lookingFor: ['friends'], ...gamer, bio: 'x'.repeat(400) }),
  M = mk('M', { name: 'Kid', age: 15, lookingFor: ['friends'], ...gamer }), X = mk('X', { name: 'Gio', age: 30, lookingFor: ['gaming'], ...gamer }), E = mk('E', { name: 'Eve', age: 29, lookingFor: ['friends'] });
nodes.push(S, A, M, X, E);
{ const id = S.wire.search('friends'); const q = S.posts.find(p => p.k === 'bdisc').q;
  ok(!('code' in q) && !('from' in q) && !JSON.stringify(q).includes('"S"') && q.b === 'a' && pktBytes({ k: 'bdisc', q }) <= RX.MAX.bdisc, 'bdisc: live query is anonymous, banded, tiny (' + pktBytes({ k: 'bdisc', q }) + ' B)');
  ok(A.wire.stats.answered === 1 && E.wire.stats.answered === 1, 'bdisc: same-band friends-mode peers answer (blank-interest peer treated as neutral)');
  ok(M.wire.stats.answered === 0, 'bdisc: minor never answers an adult query'); ok(X.wire.stats.answered === 0, 'bdisc: peer without that mode does not answer');
  const ans = A.posts.find(p => p.k === 'bdisc-ans'); ok(ans && !JSON.stringify(ans).includes('Ana') && pktBytes(ans) <= RX.MAX['bdisc-ans'], 'bdisc: answer is sealed (no readable name/ID on the wire), ' + pktBytes(ans) + ' B');
  ok(S.live.bucket.has('A') && S.live.bucket.has('E') && S.wire.stats.hits === 2, 'bdisc: searcher opens answers and LiveNode admits the signed soft tags into its bucket');
  ok(!('bio' in S.live.bucket.get('A').sp.profile) && !('name' in S.live.bucket.get('A').sp.profile), 'bdisc: only soft tags arrive (no name/bio/full profile until tap)');
  ok((seen.M || []).includes('bdisc-ans:ignored') && M.wire.stats.opened === 0, 'bdisc: other phones drop answers to queries they did not send, without any crypto');
  ok(A.delays.every(d => d >= 0 && d < REPLY_JITTER_MS), 'bdisc: answers sent after a random stagger offset (' + A.delays.join(',') + ' ms)');
  const before = A.wire.stats.answered; bus(S, { k: 'bdisc', q }); ok(A.wire.stats.answered === before, 'bdisc: replayed query id is not answered twice');
  ok(S.wire.onAnswer(ans) === false, 'bdisc: replayed answer gives no second hit'); ok(id === q.id, 'bdisc: search returns its query id'); }
{ const id = M.wire.search('friends'); ok(A.wire.stats.answered === 1 && E.wire.stats.answered === 1 && M.live.bucket.size === 0, 'bdisc: adults never answer a minor query (minor bucket stays minor-only)'); ok(M.wire.search('dating') === null, 'bdisc: minors never send a dating query'); }
{ S.live.bucket.clear(); const id = S.wire.search('friends'); const p = S.wire.pending.get(id); T += QUERY_TTL_MS + 1; const late = A.posts.filter(x => x.k === 'bdisc-ans').at(-1); S.live.bucket.clear(); ok(S.wire.onAnswer(late) === false && S.wire.stats.stale >= 1, 'bdisc: answers after the query lifetime are ignored (one-time key dropped)');
  const id2 = S.wire.search('friends'); S.wire.pending.get(id2).n = MAX_ANS; S.live.bucket.clear(); const a2 = { ...A.posts.filter(x => x.k === 'bdisc-ans').at(-1), id: id2 }; ok(S.wire.onAnswer(a2) === false, 'bdisc: at most ' + MAX_ANS + ' answers opened per query'); }
{ const tamper = JSON.parse(JSON.stringify(A.posts.filter(x => x.k === 'bdisc-ans').at(-1))); const id3 = S.wire.search('friends'); S.live.bucket.clear(); const fresh = A.posts.filter(x => x.k === 'bdisc-ans').at(-1); const z = JSON.parse(JSON.stringify(fresh)); z.z.c = z.z.c.slice(0, -8) + 'AAAAAAA='; ok(S.wire.onAnswer(z) === false, 'bdisc: tampered sealed answer rejected'); }
{ let threw = false; try { for (const q of [{ k: 'bdisc', id: 'm1', mode: 'friends', v: [3], ttl: 3, rt: 'AAAA', b: 'a' }, { k: 'bdisc', id: 'm2', mode: 'friends', v: ['x'], rt: 'AAAA', b: 'a' }, { k: 'bdisc', id: 'm3', mode: 'friends', v: [3], rt: '%%%', b: 'a' }, { k: 'bdisc' }]) A.wire.onQuery(q); } catch { threw = true; } ok(!threw, 'bdisc: malformed queries (bad reply token / vector) dropped without throwing'); }
console.log(fail ? 'PART 1 FAIL' : 'PART 1 OK');
// ---------------- Part 2: real app (admin build), 3 tabs
const puppeteer = (await import('puppeteer-core')).default; const PORT = 4187, URL0 = `http://localhost:${PORT}/`; let browser;
const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-admin', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
const cleanup = async () => { try { await browser?.close(); } catch {} try { process.kill(-srv.pid); } catch {} console.log(fail ? 'RXWIRE FAIL' : 'RXWIRE ALL OK'); process.exit(fail); };
const gt = setTimeout(() => { ok(false, 'global timeout'); cleanup(); }, 170e3);
try {
  await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost/.test(d) && res()); setTimeout(() => rej(new Error('preview timeout')), 15000); });
  browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, { timeout: ms, polling: 250 }, arg);
  const open = async as => { const p = await browser.newPage(); await p.evaluateOnNewDocument(() => { globalThis.__cmAckTest = { minMs: 0, noScroll: true }; }); p.on('dialog', d => d.accept()); p.on('pageerror', e => console.log(`[${as}] pageerror`, e.message)); await p.goto(URL0 + '?as=' + as + '&loaderMin=300');
    const ag = await p.waitForSelector('#ag-dob', { timeout: 15000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
    const terms = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (terms) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
    await until(p, () => globalThis.__cmMesh?.()?.code); await until(p, () => !document.getElementById('jackin')); if (await p.$('#moodskip')) await p.click('#moodskip').catch(() => {}); return p; };
  const Tb = []; for (const s of ['seed-2', 'seed-5', 'seed-7']) Tb.push(await open(s)); const [PA, PB, PC] = Tb; const codes = await Promise.all(Tb.map(p => p.evaluate(() => __cmMesh().code)));
  ok(await PA.evaluate(() => !!(__cmMesh().shield && __cmMesh().bdisc)), 'live mesh exposes the receive-path shield + broadcast discovery');
  for (const p of Tb) await until(p, () => __cmMesh().online().length >= 2, null, 30000).catch(() => {});
  // freeze living-mesh schedulers everywhere so ONLY bdisc answers can refill A's bucket
  for (const p of Tb) await p.evaluate(() => { const L = __cmMesh().live; L.nextAt = Infinity; L.tick = () => false; });
  await new Promise(r => setTimeout(r, 1500)); await PA.evaluate(() => __cmMesh().live.bucket.clear());
  const q0 = await PB.evaluate(() => __cmMesh().bdisc.stats.answered + __cmMesh().bdisc.stats.queries);
  const qa0 = await PA.evaluate(() => { const m = __cmMesh(); m.node.discAt = 0; m.node.discMode = null; return m.bdisc.stats.queries; }); // as if Discover opens for the first time now
  await PA.bringToFront(); await PA.evaluate(() => { document.querySelector('nav [data-tab=discover]').click(); });
  await until(PA, n => __cmMesh().bdisc.stats.queries > n, qa0, 10000).catch(() => {}); ok(await PA.evaluate(n => __cmMesh().bdisc.stats.queries > n, qa0), 'Discover tab sends an anonymous bdisc query (setDiscovery)');
  await until(PA, () => __cmMesh().bdisc.stats.hits >= 1, null, 15000).catch(() => {});
  const sa = await PA.evaluate(() => ({ st: __cmMesh().bdisc.stats, b: [...__cmMesh().live.bucket.keys()] })); const ansB = await PB.evaluate(() => __cmMesh().bdisc.stats.answered), ansC = await PC.evaluate(() => __cmMesh().bdisc.stats.answered);
  ok(ansB + ansC >= 1, 'peers answered the live query (B ' + ansB + ', C ' + ansC + ')');
  ok(sa.st.hits >= 1 && sa.b.length >= 1 && sa.b.every(c => codes.includes(c)), 'searcher bucket refilled from sealed soft-tag answers alone: ' + sa.b.length + ' peer(s), stats ' + JSON.stringify(sa.st));
  ok(await PA.evaluate(() => !__cmMesh().log.some(l => /disc-ans/.test(l))), 'no legacy full-profile disc-ans traffic');
  // legacy 'disc' from an older client: v38 phones no longer answer it with the full profile
  const legacyReplies = await PB.evaluate(async a => { const m = __cmMesh(); let n = 0; const o = m.node['on_disc-ans']; m.node['on_disc-ans'] = () => { n++; }; m.node.send(a, 'disc', { mode: 'friends' }); m.node.send('*', 'disc', { mode: 'friends' }); await new Promise(r => setTimeout(r, 2000)); m.node['on_disc-ans'] = o; return n; }, codes[0]);
  ok(legacyReplies === 0, 'legacy ID-carrying disc query gets no full-profile answer');
  // flood from tab B straight onto the channel: forged sender, oversize, many fake strangers, anonymous query spam
  const s0 = await PA.evaluate(() => ({ ...__cmMesh().shield.stats }));
  await PB.evaluate(a => { const ch = new BroadcastChannel('cm-mesh'); for (let i = 0; i < 200; i++) ch.postMessage({ k: 'mesh', env: { id: 'f' + i, from: 'FLOODER1', to: a, type: 'e2e', iv: 'x', ct: 'x', sig: 'x' } });
    ch.postMessage({ k: 'mesh', env: { id: 'big', from: 'BIG', to: '*', type: 'ping', body: { pad: 'x'.repeat(70000) }, sig: 'x' } });
    for (let i = 0; i < 300; i++) ch.postMessage({ k: 'mesh', env: { id: 's' + i, from: 'FAKE' + i, to: '*', type: 'ping', body: {}, sig: 'x' } });
    for (let i = 0; i < 100; i++) ch.postMessage({ k: 'bdisc', q: { k: 'bdisc', id: 'spam' + i, mode: 'friends', v: [3], ttl: 3, rt: 'AAAA', b: 'a' } }); ch.close(); }, codes[0]);
  await new Promise(r => setTimeout(r, 1500)); const s1 = await PA.evaluate(() => ({ ...__cmMesh().shield.stats, log: __cmMesh().log.slice(0, 20) }));
  ok(s1.rate - s0.rate >= 150, 'forged single-sender flood dropped by per-sender budget (' + (s1.rate - s0.rate) + ' of 200)'); ok(s1.strikes > s0.strikes && s1.log.some(l => /shield: flood dropped from FLOODER1/.test(l)), 'flood strikes logged');
  ok(s1.size - s0.size >= 1, 'oversize packet dropped before parse/verify'); ok(s1.stranger - s0.stranger >= 200, 'fake-stranger burst capped by the shared stranger budget (' + (s1.stranger - s0.stranger) + ' dropped)');
  ok(s1.anon - s0.anon >= 70, 'anonymous query spam capped (' + (s1.anon - s0.anon) + ' dropped)');
  // normal traffic still flows after the flood: chat-level presence is intact and nothing legit was dropped before it
  ok(s0.size === 0 && s0.rate === 0, 'normal traffic never hit the size/rate gates (before flood: ' + JSON.stringify(s0) + ')');
  for (const p of Tb) await p.evaluate(() => { const L = __cmMesh().live; delete L.tick; L.nextAt = 0; });
  await until(PA, () => __cmMesh().online().length >= 2, null, 30000).catch(() => {}); ok((await PA.evaluate(() => __cmMesh().online().length)) >= 2, 'peers still online after the flood');
} catch (e) { ok(false, 'part 2: ' + e.message); }
clearTimeout(gt); await cleanup();
