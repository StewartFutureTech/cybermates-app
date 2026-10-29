// 20k-peer simulation: gossip join convergence, list cost, verify cost, super-profile matching, churn.
// Standalone: imports src/membership.js, src/match.js, src/data.js. Simulated time (SimNet). Bytes = compact JSON wire size, gzip-deflated for messages >1 KB (as app-mesh does).
// Scale trick: 20k phones x 20k rows = 400M entries won't fit in one Node heap, so each simulated phone's
// active/pins maps are copy-on-write overlays over ONE shared converged base (semantics identical per phone).
import * as G from '../src/membership.js';
import * as M from '../src/match.js';
import * as D from '../src/data.js';
import nacl from 'tweetnacl';
import nodeCrypto from 'node:crypto';
import zlib from 'node:zlib';
const wire = m => { const j = JSON.stringify(m); return j.length > 1024 ? zlib.deflateRawSync(j).length : j.length; };
const N = +(process.env.N || 20000), CHURN_N = +(process.env.CHURN_N || 2000), CHURN_MIN = +(process.env.CHURN_MIN || 3);
const ED_NODE = {
  keyPair: () => { const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ed25519'); return { publicKey: new Uint8Array(publicKey.export({ format: 'der', type: 'spki' }).subarray(12)), secretKey: privateKey }; },
  sign: (m, sk) => new Uint8Array(nodeCrypto.sign(null, m, sk)),
  verify: (m, sig, pub) => nodeCrypto.verify(null, m, nodeCrypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pub)]), format: 'der', type: 'spki' }), sig),
};
G.setEd25519(ED_NODE);
const rng = G.seededRng(2026), R = () => rng();
const pick = a => a[Math.floor(R() * a.length)], some = (a, lo, hi) => { const n = lo + Math.floor(R() * (hi - lo + 1)); const c = a.slice(); for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c.slice(0, n); };
const T = [], row = (k, v) => { T.push([k, v]); console.log(`  ${k}: ${v}`); };
const mb = b => (b / 1048576).toFixed(2) + ' MB';
// ---------- profiles ----------
const EXTRA = [['Paris','IDF','France','FR',48.86,2.35],['Lyon','ARA','France','FR',45.76,4.84],['Madrid','MD','Spain','ES',40.42,-3.7],['Barcelona','CT','Spain','ES',41.39,2.17],['Rome','LZ','Italy','IT',41.9,12.5],['Milan','LM','Italy','IT',45.46,9.19],['Amsterdam','NH','Netherlands','NL',52.37,4.9],['Stockholm','AB','Sweden','SE',59.33,18.07],['Warsaw','MZ','Poland','PL',52.23,21.01],['Istanbul','IST','Turkey','TR',41.01,28.98],['Cairo','C','Egypt','EG',30.04,31.24],['Lagos','LA','Nigeria','NG',6.52,3.38],['Nairobi','NBO','Kenya','KE',-1.29,36.82],['Johannesburg','GP','South Africa','ZA',-26.2,28.05],['Mumbai','MH','India','IN',19.08,72.88],['Delhi','DL','India','IN',28.61,77.21],['Bangalore','KA','India','IN',12.97,77.59],['Seoul','Seoul','South Korea','KR',37.57,126.98],['Busan','Busan','South Korea','KR',35.18,129.08],['Jakarta','JK','Indonesia','ID',-6.21,106.85],['Bangkok','BKK','Thailand','TH',13.76,100.5],['Hanoi','HN','Vietnam','VN',21.03,105.85],['Singapore','SG','Singapore','SG',1.35,103.82],['Melbourne','VIC','Australia','AU',-37.81,144.96],['Auckland','AUK','New Zealand','NZ',-36.85,174.76],['Buenos Aires','BA','Argentina','AR',-34.6,-58.38],['Bogotá','DC','Colombia','CO',4.71,-74.07],['Lima','LIM','Peru','PE',-12.05,-77.04],['Santiago','RM','Chile','CL',-33.45,-70.67],['Rio de Janeiro','RJ','Brazil','BR',-22.91,-43.17],['Vancouver','BC','Canada','CA',49.28,-123.12],['Los Angeles','CA','United States','US',34.05,-118.24],['New York','NY','United States','US',40.71,-74.01],['Houston','TX','United States','US',29.76,-95.37],['Atlanta','GA','United States','US',33.75,-84.39],['Seattle','WA','United States','US',47.61,-122.33],['Manchester','England','United Kingdom','GB',53.48,-2.24],['Dublin','L','Ireland','IE',53.35,-6.26],['Riyadh','RD','Saudi Arabia','SA',24.71,46.68],['Dubai','DU','UAE','AE',25.2,55.27],['Osaka','Osaka','Japan','JP',34.69,135.5],['Taipei','TPE','Taiwan','TW',25.03,121.57]];
const CITIES = [...D.CITIES, ...EXTRA]; // weight US/Chicago-area heavier (launch market)
const cityPick = () => R() < 0.25 ? D.CITIES[Math.floor(R() * 7)] : pick(CITIES);
const MODESETS = [['dating'], ['friends'], ['gaming'], ['dating', 'gaming'], ['dating', 'friends'], ['friends', 'gaming'], ['dating', 'friends', 'gaming']];
const SPORTS = ['football', 'basketball', 'gym', 'skateboarding', 'hiking'];
function distPref(cc, mode) {
  const u = D.unitFor(cc), x = R();
  if (mode === 'dating') return x < .5 ? null : x < .75 ? { scope: 'radius', value: pick([10, 25, 50, 100]), unit: u } : x < .9 ? { scope: 'country' } : x < .95 ? { scope: 'city' } : { scope: 'global' };
  if (mode === 'friends') return x < .5 ? null : x < .7 ? { scope: 'city' } : x < .85 ? { scope: 'country' } : x < .93 ? { scope: 'radius', value: 25, unit: u } : { scope: 'global' };
  return x < .7 ? null : x < .85 ? { scope: 'country' } : { scope: 'region' };
}
function makeProfile(i) {
  const [city, region, , cc, lat, lng] = cityPick(), age = 18 + Math.floor(Math.pow(R(), 1.6) * 40), gender = R() < .46 ? 'Man' : R() < .85 ? 'Woman' : pick(D.GENDERS.slice(2));
  const seeking = gender === 'Man' ? (R() < .9 ? ['Woman'] : R() < .5 ? ['Man'] : []) : gender === 'Woman' ? (R() < .85 ? ['Man'] : R() < .5 ? ['Woman'] : []) : (R() < .5 ? [] : some(D.GENDERS, 1, 3));
  const p = { id: 'U' + i, code: 'U' + String(i).padStart(6, '0'), lookingFor: pick(MODESETS), age, gender, seekingGenders: seeking,
    ageMin: Math.max(18, age - 3 - Math.floor(R() * 8)), ageMax: age + 3 + Math.floor(R() * 12), city, region, countryCode: cc,
    lat: lat + (R() - .5) * .3, lng: lng + (R() - .5) * .3, games: some(D.GAMES, 0, 4), platforms: some(D.GAMER_PLATFORMS, 0, 2),
    interests: some(D.INTERESTS, 1, 5), anime: some(D.ANIME, 0, 2), shows: some(D.SHOWS, 0, 3), movies: some(D.MOVIES, 0, 3), teams: some(D.TEAMS, 0, 2), streaming: some(D.STREAMING, 0, 3) };
  if (p.lookingFor.includes('gaming') && !p.games.length) p.games = [pick(D.GAMES)];
  const dp = {}; for (const m of D.MODES) { const v = distPref(cc, m); if (v) dp[m] = v; } if (Object.keys(dp).length) p.distPrefs = { ...D.defaultDist(cc), ...dp };
  return p;
}
// ---------- copy-on-write overlay so 20k phones can each hold a 20k list ----------
class Overlay extends Map {
  constructor(base) { super(); this.base = base; this.del = new Set(); }
  has(k) { return super.has(k) || (!this.del.has(k) && this.base.has(k)); }
  get(k) { return super.has(k) ? super.get(k) : this.del.has(k) ? undefined : this.base.get(k); }
  set(k, v) { this.del.delete(k); return super.set(k, v); }
  delete(k) { const h = this.has(k); super.delete(k); if (this.base.has(k)) this.del.add(k); return h; }
  *entries() { for (const [k, v] of this.base) if (!this.del.has(k) && !super.has(k)) yield [k, v]; yield* super.entries(); }
  [Symbol.iterator]() { return this.entries(); }
  *values() { for (const [, v] of this.entries()) yield v; }
  *keys() { for (const [k] of this.entries()) yield k; }
  get size() { let s = this.base.size - this.del.size; for (const k of super.keys()) if (!this.base.has(k)) s++; return s; }
  ownKeys() { return [...super.keys()].filter(k => !this.base.has(k)); }
}
let BASE_CODES = [], CHURNING = false; const BYTYPE = {};
class SimMember extends G.Member {
  constructor(o) { super(o); this.bytes = 0; this.rx = 0; }
  send(to, m) { const w = wire(m); this.bytes += w; if (CHURNING) BYTYPE[m.t] = (BYTYPE[m.t] || 0) + w; super.send(to, m); }
  receive(m) { if (this.alive) this.rx += wire(m); return super.receive(m); }
  targets(shard, n, exclude = new Set()) { // same distribution as pick(peers) without copying 20k arrays per message
    if (!(this.active instanceof Overlay)) return super.targets(shard, n, exclude);
    const extra = this.active.ownKeys().map(k => k.split('|')[1]), pool = BASE_CODES.length + extra.length, out = new Set();
    for (let tries = 0; out.size < n && tries < n * 50; tries++) { const i = Math.floor(this.rng() * pool), c = i < BASE_CODES.length ? BASE_CODES[i] : extra[i - BASE_CODES.length];
      if (c !== this.code && !exclude.has(c) && this.active.has(shard + '|' + c)) out.add(c); }
    return [...out];
  }
}
const SH = G.GLOBAL;
function buildNet(n, seed) {
  const r = G.seededRng(seed), net = new G.SimNet(r), rv = new G.Rendezvous(8, () => net.t);
  const profiles = Array.from({ length: n }, (_, i) => makeProfile(i));
  const nodes = profiles.map(p => { const m = new SimMember({ code: p.code, profile: p, now: net.now, net, rng: r, mode: 'global' }); net.nodes.set(m.code, m); return m; });
  return { net, rv, nodes, profiles };
}
const live = nodes => nodes.filter(n => n.alive);
// =============== 1) 20k join convergence ===============
console.log(`\n== 1) ${N} active peers, full-list (global) mode ==`);
let t0 = performance.now();
const { net, rv, nodes, profiles } = buildNet(N, 7);
row('keygen (sim, node:crypto)', `${((performance.now() - t0) / 1e3).toFixed(1)} s`);
t0 = performance.now(); const rows = nodes.map(n => n.row(SH)); const tSign = performance.now() - t0;
t0 = performance.now(); const fresh = new SimMember({ code: 'VERIFY', net: { deliver() {} }, now: net.now, mode: 'global' }); let okc = 0; for (const r of rows) if (fresh.accept(r, { verifyNow: true })) okc++;
const tVerNode = performance.now() - t0;
// tweetnacl (what the WebView actually runs): measure real per-row verify on a sample with nacl keys
const NS = 400, nk = Array.from({ length: NS }, () => nacl.sign.keyPair()), nmsgs = nk.map((k, i) => { const m = new TextEncoder().encode(JSON.stringify(Object.entries(rows[i]).filter(([k]) => k !== 'sig'))); return [m, nacl.sign.detached(m, k.secretKey), k.publicKey]; });
t0 = performance.now(); let nok = 0; for (const [m, s, p] of nmsgs) nok += nacl.sign.detached.verify(m, s, p); const naclPer = (performance.now() - t0) / NS;
// WebCrypto Ed25519 (what phones now use when available)
const sub = globalThis.crypto.subtle, WS = 2000; t0 = performance.now(); let wok = 0;
for (let i = 0; i < WS; i++) { const [m, sg, pk] = nmsgs[i % NS]; const key = await sub.importKey('raw', pk, { name: 'Ed25519' }, false, ['verify']); wok += await sub.verify({ name: 'Ed25519' }, key, sg, m); }
const wcPer = (performance.now() - t0) / WS;
const lazyM = new SimMember({ code: 'LAZYJOIN', net: { deliver() {} }, now: net.now, mode: 'global' }); t0 = performance.now(); for (const r of rows) lazyM.accept(r); const tLazy = performance.now() - t0;
row('sign 20k rows (node:crypto)', `${(tSign / 1e3).toFixed(2)} s`);
row(`verify ${okc} rows (node:crypto, desktop)`, `${(tVerNode / 1e3).toFixed(2)} s`);
row('WebCrypto Ed25519 verify per row (this box)', `${(wcPer * 1000).toFixed(0)} µs → all 20k ${(wcPer * 20).toFixed(1)} s; Discover page of 60 rows ${(wcPer * 60).toFixed(0)} ms`);
row('lazy accept of 20k rows at join (no verify)', `${tLazy.toFixed(0)} ms CPU; rows verified on display/contact/state change only`);
row('tweetnacl verify per row (this box)', `${naclPer.toFixed(2)} ms → 20k rows ${(naclPer * 20000 / 1e3).toFixed(1)} s; mid phone ~3–5x slower ≈ ${(naclPer * 20000 * 3 / 1e3).toFixed(0)}–${(naclPer * 20000 * 5 / 1e3).toFixed(0)} s`);
// list size & memory per phone
const listJson = JSON.stringify(rows.map(r => G.encodeRow(r))), rowAvg = listJson.length / rows.length; // compact wire rows
row('row size avg (compact wire)', `${rowAvg.toFixed(0)} B`); row('full list per phone (JSON, 20k rows)', mb(listJson.length));
const gz = (await import('node:zlib')).gzipSync(listJson).length; row('full list gzipped', mb(gz));
global.gc?.(); const h0 = process.memoryUsage().heapUsed; const keep = new Map(JSON.parse(listJson).map(a => G.decodeRow(a)).map(r => [SH + '|' + r.code, r])); const pins = new Map([...keep.values()].map(r => [r.code, r.pub])); global.gc?.();
row('heap for one phone\'s list+pins (JS objects)', mb(process.memoryUsage().heapUsed - h0) + (global.gc ? '' : ' (approx, run with --expose-gc for exact)')); keep.clear();
// converged base
const base = new Map(rows.map(r => [SH + '|' + r.code, r])), basePins = new Map(rows.map(r => [r.code, r.pub])); BASE_CODES = rows.map(r => r.code);
for (const n of nodes) { n.active = new Overlay(base); n.pins = new Overlay(basePins); }
for (const n of nodes.slice(-8)) rv.register(SH, n.code);
// joiner (sim clock moved past the settle window so warm rows count as settled)
net.t = 120e3;
const jp = makeProfile(N), J = new SimMember({ code: jp.code, profile: jp, now: net.now, net, rng: G.seededRng(99), mode: 'global' }); net.nodes.set(J.code, J);
nodes.forEach(n => { n.sent = 0; n.bytes = 0; n.rx = 0; });
const knows = () => nodes.filter(n => n.active.has(SH + '|' + J.code)).length / nodes.length;
const start = net.t; await J.join(rv); const cov = {}; let t99 = null;
for (const ms of [250, 500, 750, 1000, 1500, 2000, 3000, 5000]) { net.run(start + ms); cov[ms] = knows(); if (t99 == null && cov[ms] >= .99) t99 = ms; }
net.run(); const pushCov = knows(), quiet = net.t - start;
const sent = nodes.map(n => n.sent), avgMsgs = sent.reduce((a, b) => a + b, 0) / sent.length, avgB = nodes.reduce((a, n) => a + n.bytes, 0) / N;
row('joiner coverage @0.5s / 1s / 5s', `${(cov[500] * 100).toFixed(1)}% / ${(cov[1000] * 100).toFixed(1)}% / ${(cov[5000] * 100).toFixed(2)}%`);
row('push phase quiet at', `${(quiet / 1e3).toFixed(2)} s sim, final push coverage ${(pushCov * 100).toFixed(3)}% (${Math.round((1 - pushCov) * N)} phones missed)`);
row('msgs sent per peer per join', `avg ${avgMsgs.toFixed(2)}, max ${Math.max(...sent)}; ≈ ${(avgB / 1024).toFixed(2)} KB/peer`);
row('time to 99% (one push round)', t99 == null ? '>5 s' : `${t99} ms`);
row('joiner gets full list', `${J.active.size} rows from 1 seed + digests from 2 (download ≈ ${mb(J.rx)}, gzip)`);
// catch-up: lagging phones pull (each pull reply = only rows the puller lacks)
net.run(net.t + G.CFG.settleMs + 1); // catch-up runs every syncMs; rows only enter digests once settled
for (let rd = 1; rd <= 3; rd++) { const lag = nodes.filter(n => !n.active.has(SH + '|' + J.code)); if (!lag.length) { row(`after catch-up round ${rd}`, '100% (nothing to do)'); break; }
  const b0 = lag.reduce((a, n) => a + n.bytes + n.rx, 0); lag.forEach(n => n.syncWith(SH)); net.run(net.t + 1000);
  row(`after catch-up round ${rd}`, `${(knows() * 100).toFixed(3)}% (${lag.length} lagging phones pulled; digest+reply ≈ ${((lag.reduce((a, n) => a + n.bytes + n.rx, 0) - b0) / lag.length / 1024).toFixed(0)} KB each)`); }
// note: a full digest = 20k entries
row('catch-up request size (bucket digest)', `${(JSON.stringify({ t: 'pull', shard: SH, h: nodes[0].digest(SH), from: nodes[0].code }).length / 1024).toFixed(1)} KB per pull (was 0.23 MB full version list)`);
// =============== 2) super profile ===============
console.log(`\n== 2) super profile vs ${N} via match.evaluate ==`);
const SUPER = { id: 'SUPER', lookingFor: [...D.MODES], age: 28, gender: 'Woman', seekingGenders: [...D.GENDERS], ageMin: 18, ageMax: 99, city: 'Chicago', region: 'IL', countryCode: 'US', lat: 41.88, lng: -87.63,
  games: [...D.GAMES], platforms: [...D.GAMER_PLATFORMS], interests: [...D.INTERESTS], anime: [...D.ANIME], shows: [...D.SHOWS], movies: [...D.MOVIES], teams: [...D.TEAMS], streaming: [...D.STREAMING],
  distPrefs: { dating: { scope: 'global' }, friends: { scope: 'global' }, gaming: { scope: 'global' } } };
const same = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
function why(me, t, mode) { // mirrors evaluate()'s filter order to label the first failing rule
  if (!t.lookingFor.includes(mode)) return 'not in mode';
  if (mode === 'dating') { if (t.seekingGenders?.length && !t.seekingGenders.includes(me.gender)) return 'their gender pref excludes super';
    if (me.age < (t.ageMin || 18) || me.age > (t.ageMax || 99)) return 'their age range excludes super'; }
  const d = M.distanceMi(me, t); if (!M.locationOk(t, me, mode, d)) return `their distance pref (${M.prefFor(t, mode).scope}) excludes super`;
  if (!M.locationOk(me, t, mode, d)) return 'super distance'; if (!M.sharedItems(me, t, mode).length) return 'no shared item'; return 'other';
}
t0 = performance.now(); const perMode = {}, visible = new Set(), reasons = {};
for (const m of D.MODES) { const res = M.findMatches(SUPER, profiles, m, D.QUESTIONS); perMode[m] = { in: profiles.filter(p => p.lookingFor.includes(m)).length, match: res.length }; res.forEach(r => visible.add(r.profile.id)); }
const tMatch = performance.now() - t0;
for (const p of profiles) if (!visible.has(p.id)) { for (const k of new Set(p.lookingFor.map(m => why(SUPER, p, m)))) reasons[k] = (reasons[k] || 0) + 1; }
for (const m of D.MODES) row(`super ${m}`, `${perMode[m].match} / ${perMode[m].in} users in mode (${(perMode[m].match / perMode[m].in * 100).toFixed(1)}%)`);
row('super visible in ≥1 mode', `${visible.size} / ${N} (${(visible.size / N * 100).toFixed(1)}%); 3 modes x 20k evaluate() = ${tMatch.toFixed(0)} ms`);
for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1])) console.log(`    hidden users citing: ${k} — ${v} (${(v / (N - visible.size) * 100).toFixed(0)}% of hidden)`);
// =============== 3) churn ===============
console.log(`\n== 3) churn 5% leave + 5% join per minute, ${CHURN_N} phones, ${CHURN_MIN} sim minutes (real gossip, no overlay) ==`);
BASE_CODES = [];
const C = buildNet(CHURN_N, 11); const crows = C.nodes.map(n => n.row(SH));
for (const n of C.nodes) for (const r of crows) { n.pins.set(r.code, r.pub); n.active.set(SH + '|' + r.code, r); }
const all = C.nodes.slice(); let nextId = 100000; 
const accuracy = (settle = 0) => { // settle>0: ignore changes younger than `settle` ms (still propagating) and phones that joined <30 s ago
  const now = C.net.t, obs = live(all).filter(n => !settle || !(n.joinedAt > now - 30e3)), truth = live(all).filter(n => !(n.joinedAt > now - settle)).map(n => n.code);
  let fp = 0, fn = 0, exact = 0;
  for (const n of obs) { let miss = 0, stale = 0; for (const r of n.active.values()) { const x = C.net.nodes.get(r.code); if (!x.alive && x.goneAt <= now - settle) stale++; } for (const c of truth) if (!n.active.has(SH + '|' + c)) miss++; fp += stale; fn += miss; if (!miss && !stale) exact++; }
  return { stale: fp / obs.length, miss: fn / obs.length, exact: exact / obs.length, n: live(all).length }; };
for (const n of all.slice(-8)) C.rv.register(SH, n.code);
CHURNING = true; C.net.t = 120e3; const AE = G.CFG.syncMs, SNAP = { rows: null, gz: 0 }, JOINDL = [];
const takeSnap = () => { const L = live(all), n = L[Math.floor(R() * L.length)]; SNAP.rows = n.snapshotRows(); SNAP.gz = zlib.gzipSync(JSON.stringify(SNAP.rows)).length; }; // server bootstrap snapshot (≤90 s old), served by the server, not phones
if (!process.env.NOSNAP) { takeSnap(); }
const AE0 = G.CFG.syncMs;
for (let min = 1; min <= CHURN_MIN; min++) {
  const L = live(all); L.forEach(n => { n.bytes = 0; n.rx = 0; });
  const nEv = +(process.env.EV_PER_MIN || 0) || Math.round(L.length * .05), t = C.net.t; // EV_PER_MIN: replay the 20k event rate on a smaller network (per-phone cost is per-event)
  if (!process.env.NOSNAP) { C.net.push(t + 30e3, takeSnap); C.net.push(t + 59e3, takeSnap); }
  for (let i = 0; i < nEv; i++) { // spread events across the minute
    const at = t + (i / nEv) * 60e3;
    C.net.push(at, () => { const lv = live(all).filter(n => n.code !== 'x'); const v = lv[Math.floor(R() * lv.length)]; v.goneAt = C.net.t; if (R() < 0.8) v.leave(); else { v.alive = false; v.crashed = C.net.t; } /* 20% crash silently */ });
    C.net.push(at + 1, async () => { const p = makeProfile(nextId++); const m = new SimMember({ code: 'J' + nextId, profile: p, now: C.net.now, net: C.net, rng: G.seededRng(nextId), mode: 'global' }); C.net.nodes.set(m.code, m); m.joinedAt = C.net.t; all.push(m); if (SNAP.rows) { m.warmStart(SNAP.rows); m.rx += SNAP.gz; JOINDL.push(SNAP.gz); } m.join(C.rv); });
  }
  for (const n of live(all)) C.net.push(t + R() * AE, () => { if (!n.alive) return; n.tick(); n.syncWith(SH); { // each phone: one catch-up per syncMs at a random phase // periodic anti-entropy + lazy failure detection on contact
    const rs = [...n.active.values()], r = rs[Math.floor(R() * rs.length)]; if (r && r.code !== n.code && !C.net.nodes.get(r.code)?.alive) n.contactFailed(r.code, SH); } }); // + contacts 1 random listed peer per round; no answer => signed suspect
  C.net.run(t + 60e3); const L2 = live(all); L2.forEach(n => n.tick());
  if (process.env.DIAG) { const L = live(all); let mNew = 0, mOld = 0, sCr = 0, sLeft = 0, newSelf = 0; for (const n of L) { const young = n.joinedAt && C.net.t - n.joinedAt < 30e3; for (const o of L) if (!n.active.has(SH + '|' + o.code)) { if (young) newSelf++; else if (o.joinedAt && C.net.t - o.joinedAt < 10e3) mNew++; else mOld++; } for (const r of n.active.values()) { const x = C.net.nodes.get(r.code); if (!x.alive) x.crashed ? sCr++ : sLeft++; } } console.log('   DIAG missing: by-young-phones', newSelf, 'recent-joiners', mNew, 'old', mOld, '| stale crashed', sCr, 'left', sLeft); }
  const a = accuracy(), up = L2.reduce((s, n) => s + n.bytes, 0) / L2.length, dn = L2.reduce((s, n) => s + n.rx, 0) / L2.length;
  const b = accuracy(20e3);
  row(`churn min ${min}`, `live ${a.n}; missing ${(a.miss / a.n * 100).toFixed(2)}%, stale ${(a.stale / a.n * 100).toFixed(2)}% (changes >20 s old: missing ${(b.miss / a.n * 100).toFixed(2)}%, stale ${(b.stale / a.n * 100).toFixed(2)}%, exact lists ${(b.exact * 100).toFixed(0)}%); per phone ↑${(up / 1024).toFixed(0)} KB ↓${(dn / 1024).toFixed(0)} KB /min`);
}
if (process.env.DIAG) console.log('   bytes by type (all phones, all minutes, KB):', Object.fromEntries(Object.entries(BYTYPE).map(([k, v]) => [k, Math.round(v / 1024)])));
if (JOINDL.length) console.log(`  joiner one-time download: snapshot ${mb(JOINDL.reduce((a, b) => a + b, 0) / JOINDL.length)} from server (not a phone), then digest-sync`);
console.log(`  (event traffic per phone ∝ events/min ∝ N → ×${(N / CHURN_N).toFixed(0)} at ${N}; the bucket digest is fixed-size)`);
console.log(`\nmemory rss ${mb(process.memoryUsage().rss)}, heap ${mb(process.memoryUsage().heapUsed)}`);
