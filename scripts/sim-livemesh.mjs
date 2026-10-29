// LIVING MESH simulation (UX §6-8): N simulated nodes (default 300 and 1000) on a virtual clock. Checks: clumps converge to a
// higher average match, buckets <= 200, no cross-age-band edges ever, small packets, bounded broadcast load, multi-hop
// search latency (hops), full-profile fetch on open + offline detection, swipe-left cut, blocks/bans/forged packets dropped.
// node scripts/sim-livemesh.mjs [N ...]   (SIM_SECS overrides virtual duration)
import nacl from 'tweetnacl';
import { b64 } from '../src/vault.js';
import * as L from '../src/livemesh.js';
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const Ns = process.argv.slice(2).map(Number).filter(Boolean); if (!Ns.length) Ns.push(300, 1000);
const SECS = Number(process.env.SIM_SECS || 240);
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const summary = [];
for (const N of Ns) {
  const rnd = mulberry(N * 7 + 1); let now = 0; const q = new Map(); // virtual event queue: ms -> [fn]
  const at = (ms, fn) => { const k = Math.ceil(ms / 10) * 10; (q.get(k) || q.set(k, []).get(k)).push(fn); };
  const K = 14, centers = Array.from({ length: K }, () => L.DIMS.map(() => Math.floor(rnd() * 4)));
  const nodes = [], byCode = new Map(), offline = new Set(), banned = new Set(), stats = { msgs: 0, bytes: 0, crossBand: 0 };
  const kp = () => { const k = nacl.sign.keyPair(); return { pub: b64(k.publicKey), sec: b64(k.secretKey) }; };
  for (let i = 0; i < N; i++) { const minor = rnd() < .15, c = centers[Math.floor(rnd() * K)], v = c.map(x => Math.max(0, Math.min(3, x + Math.round((rnd() - .5) * 1.6))));
    const modes = ['friends', ...(rnd() < .5 ? ['gaming'] : []), ...(!minor && rnd() < .6 ? ['dating'] : [])], g = 'mfn'[Math.floor(rnd() * 3)], age = minor ? 13 + Math.floor(rnd() * 5) : 18 + Math.floor(rnd() * 40);
    const code = 'n' + i, tags = { b: minor ? 'm' : 'a', m: modes.reduce((s, m) => s | L.MODE_BIT[m], 0), g, a: L.ageBucket(age), o: v[0] > 1 ? 1 : 0, v: L.encodeVec(v) };
    const full = { name: 'User ' + i, age, gender: g, bio: 'x'.repeat(200), lookingFor: modes, games: ['halo', 'witcher'].slice(0, v[0]) };
    const n = new L.LiveNode({ code, keys: kp(), full, send: (to, m) => { stats.msgs++; stats.bytes += L.pktBytes(m); const dst = byCode.get(to); if (!dst || offline.has(to)) return; if (m.pres && m.pres.sp.profile.b !== dst.tags.b) stats.wouldCross = (stats.wouldCross || 0) + 1; at(now + 30 + rnd() * 90, () => dst.receive(code, m)); },
      now: () => now, rand: rnd, timer: (f, ms) => at(now + ms, f), isBanned: c2 => banned.has(c2), isOnline: c2 => !offline.has(c2),
      rendezvous: () => Array.from({ length: 4 }, () => 'n' + Math.floor(rnd() * N)) }); // server super list: random, ANY band (band filter is on the phone)
    n.tags = tags; n.sign(); nodes.push(n); byCode.set(code, n); }
  const edgesCrossBand = () => { let x = 0; for (const n of nodes) for (const c of n.bucket.keys()) if (byCode.get(c).tags.b !== n.tags.b) x++; return x; };
  const top20 = () => { const a = nodes.filter(n => n.bucket.size >= 20); return a.reduce((s, n) => s + [...n.bucket.values()].map(e => e.score).sort((x, y) => y - x).slice(0, 20).reduce((p, q) => p + q, 0) / 20, 0) / (a.length || 1); };
  const avg = () => { const a = nodes.filter(n => n.bucket.size); return a.reduce((s, n) => s + n.avgMatch(), 0) / (a.length || 1); };
  const ideal = n => { const s = []; for (const o of nodes) if (o !== n) { const x = L.softMatch(n.tags, o.tags, n.mode); if (x != null) s.push(x); } s.sort((a, b) => b - a); const t = s.slice(0, Math.max(1, n.bucket.size)); return t.reduce((a, b) => a + b, 0) / (t.length || 1); };
  const rndAvg = (() => { let s = 0, c = 0; for (let i = 0; i < 4000; i++) { const a = nodes[Math.floor(rnd() * N)], b = nodes[Math.floor(rnd() * N)]; const x = a !== b && L.softMatch(a.tags, b.tags, 'friends'); if (x != null && x !== false) { s += x; c++; } } return s / c; })();
  const run = secs => { const end = now + secs * 1000; while (now < end) { const fs = q.get(now); if (fs) { q.delete(now); for (const f of fs) f(); } if (now % 1000 === 0) { for (const n of nodes) if (!offline.has(n.code)) n.tick(); stats.maxBucket = Math.max(stats.maxBucket || 0, ...nodes.map(n => n.bucket.size)); if (now % 10000 === 0) { const x = edgesCrossBand(); stats.crossBand = Math.max(stats.crossBand, x); } } now += 10; } };
  const t0 = Date.now(), curve = [], c20 = []; const m0 = stats.msgs;
  let tPrev = 0; const marks = [3, 10, 30, 60, 120, SECS].filter((x, i, a) => x <= SECS && a.indexOf(x) === i); for (const tm of marks) { run(tm - tPrev); tPrev = tm; curve.push(Math.round(avg() * 10) / 10); c20.push(Math.round(top20() * 10) / 10); }
  const simMs = Date.now() - t0, msgsPerNodeSec = (stats.msgs - m0) / N / SECS;
  const lastWin = (() => { const m1 = stats.msgs; run(60); return (stats.msgs - m1) / N / 60; })();
  const perNode = nodes.map(n => n.stats.sent), maxPerNodeSec = Math.max(...perNode) / (SECS + 60);
  const idealAvg = nodes.slice(0, 40).reduce((s, n) => s + ideal(n), 0) / 40, nowAvg40 = nodes.slice(0, 40).reduce((s, n) => s + n.avgMatch(), 0) / 40;
  const maxPkt = Math.max(...nodes.map(n => n.stats.maxPkt)), drops = nodes.reduce((d, n) => { for (const [k, v] of Object.entries(n.stats.dropped)) d[k] = (d[k] || 0) + v; return d; }, {});
  console.log(`\n== N=${N}  virtual ${SECS + 60}s  wall ${simMs}ms`);
  const gap = (nowAvg40 - rndAvg) / (idealAvg - rndAvg);
  console.log(' at t(s)=' + marks.join('/'), 'avg bucket match:', curve.join(' -> '), '| top-20 of bucket:', c20.join(' -> '), '| random pair avg', rndAvg.toFixed(1), '| ideal best-|bucket| (40-node sample)', idealAvg.toFixed(1), 'actual', nowAvg40.toFixed(1), '| gap closed', (100 * gap).toFixed(0) + '%');
  assert(curve.at(-1) > rndAvg + 5 && c20.at(-1) >= c20[0] + 10 && gap >= 0.5, `N=${N}: clumps converge to higher average match (${curve[0]} -> ${curve.at(-1)}, random ${rndAvg.toFixed(1)})`);
  assert(stats.maxBucket <= L.BUCKET_MAX, `N=${N}: every bucket stays <= ${L.BUCKET_MAX} (max seen ${stats.maxBucket})`);
  const fullBuckets = nodes.filter(n => n.bucket.size >= Math.min(L.BUCKET_MAX, 0.9 * nodes.filter(o => o.tags.b === n.tags.b).length - 1)).length;
  console.log(' bucket sizes: mean', (nodes.reduce((s, n) => s + n.bucket.size, 0) / N).toFixed(1), 'max', stats.maxBucket, '| near-full', fullBuckets);
  assert(stats.crossBand === 0 && edgesCrossBand() === 0, `N=${N}: zero cross-age-band edges ever (cross-band presences offered via random rendezvous and dropped: ${drops.band})`);
  assert(maxPkt <= L.SOFT_PKT_MAX, `N=${N}: soft-tag presence packet small: ${maxPkt} B (<= ${L.SOFT_PKT_MAX}); full profile never in presence`);
  console.log(' load msgs/node/s: whole run', msgsPerNodeSec.toFixed(2), '| last 60s (stable)', lastWin.toFixed(2), '| busiest node', maxPerNodeSec.toFixed(2), '| piggybacked', nodes.reduce((s, n) => s + n.stats.piggy, 0));
  assert(maxPerNodeSec <= L.BUCKET_MAX / (L.MIN_IV / 1000) + 10 && lastWin < msgsPerNodeSec * 1.2, `N=${N}: broadcast load bounded (busiest ${maxPerNodeSec.toFixed(1)}/s <= ${L.BUCKET_MAX / (L.MIN_IV / 1000) + 10}/s; adapts down when stable)`);
  // search (hops)
  const searches = [['friends', { mode: 'friends', min: 60 }], ['gaming', { mode: 'gaming', gaming: 1, min: 70 }], ['dating', { mode: 'dating', gender: 'f', min: 55 }], ['age-group', { mode: 'friends', age: 3, min: 50 }]]; const sr = {};
  for (const [name, crit] of searches) { const hopsFirst = [], hops10 = [], found = [], remote = []; let bad = 0;
    for (let i = 0; i < 15; i++) { const s = nodes.filter(n => n.tags.m & L.MODE_BIT[crit.mode] && !offline.has(n.code))[Math.floor(rnd() * 50)]; if (!s) continue; const res = [];
      const prevMode = s.mode; s.setMode(crit.mode); s.search(crit, r => res.push(r)); run(3); s.setMode(prevMode);
      for (const r of res) { const o = byCode.get(r.code); if (o.tags.b !== s.tags.b || (crit.gender && o.tags.g !== crit.gender) || (crit.gaming && o.tags.o !== 1) || (crit.age != null && o.tags.a !== crit.age) || L.softMatch(s.tags, o.tags, crit.mode, crit.gender ? [crit.gender] : null) < crit.min) bad++; }
      const hs = res.map(r => r.hop).sort((a, b) => a - b); if (hs.length) hopsFirst.push(hs[0]); if (hs.length >= 10) hops10.push(hs[9]); found.push(res.length); remote.push(res.filter(r => r.hop > 0).length); }
    const mean = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : 'n/a';
    sr[name] = { found: mean(found), fromOtherBuckets: mean(remote), hopFirst: mean(hopsFirst), hop10th: mean(hops10), maxHop: L.SEARCH_TTL + 1 };
    console.log(` search ${name} ${JSON.stringify(crit)}: avg results ${mean(found)} (${mean(remote)} from neighbouring buckets), hops to 1st ${mean(hopsFirst)}, hops to 10th ${mean(hops10)}`);
    assert(bad === 0 && found.some(x => x > 0), `N=${N}: ${name} search returns only same-band results meeting criteria (bad=${bad})`); }
  // full profile on open
  const A = nodes.find(n => n.bucket.size > 5), peer = [...A.bucket.keys()][0]; let pr; A.openProfile(peer).then(r => pr = r); run(2); await new Promise(r => setImmediate(r));
  assert(pr?.online === true && pr.profile.name === byCode.get(peer).full.name && pr.profile.bio.length === 200, `N=${N}: tap-to-open fetches the signed FULL profile (${L.pktBytes({ p: pr?.profile })} B) and reports online`);
  const gone = [...A.bucket.keys()][1]; offline.add(gone); let po; A.openProfile(gone).then(r => po = r); run(6); await new Promise(r => setImmediate(r));
  assert(po?.online === false, `N=${N}: opening an offline person's profile -> offline after the online check`);
  // swipe left: thrown off both networks, never re-admitted
  const B = [...A.bucket.keys()][2]; A.pass(B); run(30); assert(!A.bucket.has(B) && !byCode.get(B).bucket.has(A.code), `N=${N}: swipe left cuts both ways and the pass is never re-admitted`);
  assert(A.like([...A.bucket.keys()][0]).wantsToTalk, `N=${N}: swipe right = wants to talk`);
  // ban + forged packet
  const V = [...A.bucket.keys()][3]; banned.add(V); A.sweep(); A.bucket.delete(V); run(15); assert(!A.bucket.has(V), `N=${N}: banned node never re-enters a bucket`); banned.delete(V);
  const forged = { sp: { ...A.sp, profile: { ...A.sp.profile, v: 'ffffffff' } }, k: A.keys.pub }, X = nodes.find(n => n.tags.b === A.tags.b && n !== A && !n.bucket.has(A.code)) || nodes[1];
  const before = X.stats.dropped.sig; X.consider(forged); assert(X.stats.dropped.sig === before + 1, `N=${N}: tampered soft-tag packet rejected by signature check`);
  // power
  const P = nodes[5]; P.setPower({ battery: .1 }); assert(P.power === 'critical' && P.P.iv === 6, `N=${N}: low battery stretches the broadcast interval x6 and narrows tentacles/search`);
  summary.push({ N, marks, curve, top20: c20, gapClosed: +gap.toFixed(2), rndAvg: +rndAvg.toFixed(1), ideal: +idealAvg.toFixed(1), maxBucket: stats.maxBucket, crossBand: 0, maxPkt, fullProfileBytes: L.pktBytes({ p: pr.profile }), msgsPerNodeSec: +msgsPerNodeSec.toFixed(2), stableMsgsPerNodeSec: +lastWin.toFixed(2), search: sr, bandDrops: drops.band, wallMs: simMs });
}
console.log('\nSIM SUMMARY ' + JSON.stringify(summary));
