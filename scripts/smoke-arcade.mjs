// Roulette (18+) + Arcade engine + proximity voice smoke test. node scripts/smoke-arcade.mjs
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
process.env.CM_SIGNAL = 'mock';
const R = await import('../src/roulette.js'), E = await import('../src/arcade/engine.js'), I = await import('../src/arcade/instance.js');
const { snake } = await import('../src/arcade/snake.js'), { tron } = await import('../src/arcade/tron.js'), PX = await import('../src/arcade/proximity.js');
const { Vault } = await import('../src/vault.js'), { ParentControls } = await import('../src/parental.js'), { sweepStale } = await import('../src/sweep.js');
const adult = { age: 25 }, minor = { age: 15 };
// ---- age gates
assert(R.visibleFor(adult) && !R.visibleFor(minor) && !R.visibleFor({}) && !R.visibleFor({ age: 30, minor: true }), 'roulette tab: adults only (unknown age hidden)');
const v = new Vault({ info: 'test-device' }); await v.init({});
let T = 1e12; const cd = await new R.Cooldown(v, 'me', { now: () => T }).load();
assert((() => { try { new R.Roulette({ me: minor, pool: () => [], cooldown: cd }).enter(); return false; } catch { return true; } })(), 'minor cannot enter roulette');
assert(R.receiverAccept(minor, { from: 'X', adult: true }, { on: true }).reason === 'minor', 'receiver: minor refuses');
assert(R.receiverAccept(adult, { from: 'X', adult: false }, { on: true }).reason === 'peer-not-adult', 'receiver: refuses minor caller');
assert(R.receiverAccept(adult, { from: 'X', adult: true }, { on: false }).reason === 'not-opted-in', 'receiver: both must opt in');
assert(R.receiverAccept(adult, { from: 'X', adult: true }, { on: true, isBlocked: c => c === 'X' }).reason === 'blocked', 'receiver: blocked refused');
const peer = (code, o = {}) => ({ code, adult: true, rl: true, at: T, ...o });
assert(!R.eligible(adult, peer('M', { adult: false, minor: true }), { now: T }) && !R.eligible(adult, peer('N', { rl: false }), { now: T }) && R.eligible(adult, peer('A'), { now: T }), 'pool: adult + opted-in only');
assert(!R.eligible(adult, peer('B'), { now: T, isBanned: c => c === 'B' }) && !R.eligible(adult, peer('S', { at: T - 2 * R.RL_FRESH_MS }), { now: T }), 'pool: banned + stale opt-in excluded');
// ---- cooldown 24h in vault, pruned by sweep
const blocked = new Set(); let connects = [];
const rl = new R.Roulette({ me: adult, myCode: 'me', now: () => T, rng: () => 0, cooldown: cd, pool: () => ['A', 'B', 'C'].map(c => peer(c)), connect: async c => { connects.push(c); return { hangup() {} }; }, block: async c => blocked.add(c), report: async c => ({ ok: true, c }), isBlocked: c => blocked.has(c) }).enter();
await rl.next(); await rl.next(); await rl.skip({ block: true });
assert(new Set(connects).size === 3 && blocked.has(connects[2]) === false && blocked.has(connects[1]), 'next/skip: 3 distinct peers, block-on-skip blocked the skipped one');
assert(await rl.next() === null && rl.state === 'searching', 'all peers in cooldown -> no rematch');
const enc = JSON.stringify(v.blob); assert(!enc.includes('"A"') && (await v.read()).roulette.me.cooldown.A === T, 'cooldown stored inside the encrypted vault');
T += R.COOLDOWN_MS - 1000; assert(cd.has('A'), 'still cooling down at 23h59m');
T += 2000; const sw = sweepStale({ cooldowns: [cd] }); assert(sw.cooldown === 3 && !cd.has('A'), 'sweep prunes expired cooldown entries');
await new Promise(r => setTimeout(r, 50)); assert(Object.keys((await v.read()).roulette.me.cooldown).length === 0, 'pruned list persisted');
await rl.next(); assert(rl.peer && (await rl.report()).c === rl.peer, 'Report button reports the current peer');
// ---- tile growth + bot fill
const w = new E.World({ seed: 7, game: snake }); w.fillBots();
assert(w.humans().length === 0 && w.bots().length === E.MIN_POP, 'bots fill an empty map');
for (let i = 0; i < 5; i++) w.add('H' + i); assert(w.side === 3 && w.size === 3 * E.TILE, '5 humans -> 3x3 tiles (map grows as a square)');
assert(w.bots().length === E.MIN_POP - 5, 'bots step aside as humans join');
for (let i = 5; i < 10; i++) w.add('H' + i); assert(w.side === 4 && w.bots().length === 0, '10 humans -> 4x4, no bots');
assert(w.ownerAt(0, 0) === 'H0' && w.ownerAt(E.TILE, 0) === 'H1' && w.tileOwners.length === 16, 'each tile has an authoritative owner');
// deterministic lockstep
const mk = () => { const x = new E.World({ seed: 42, game: snake }); x.fillBots(); x.add('P1'); x.add('P2'); return x; };
const a = mk(), b = mk(); const inp = a.input('P1', 'down'); b.input(inp.code, inp.dir, inp.tick);
for (let i = 0; i < 300; i++) { a.step(); b.step(); }
const sig = x => JSON.stringify([...x.players.values()].map(p => [p.code, p.alive, p.body?.slice(0, 3), p.score]));
assert(sig(a) === sig(b), 'deterministic tick + input relay: two peers agree after 300 ticks');
const ev = { t: 'kill', who: 'P2', by: 'P1', tile: 0, tick: 1 }; assert(!b.applyVerdict(ev, 'P2') && b.applyVerdict(ev, b.tileOwners[0]), 'only the tile owner verdict is accepted');
// snake rules (analog: float path, max turn rate, spatial-hash body collision)
const s = new E.World({ seed: 1, game: snake }); const p1 = s.add('S1'), p2 = s.add('S2'); s.fillBots(0); s.food = [];
const line = (x, y, h, k) => Array.from({ length: k }, (_, i) => [x - Math.cos(h) * snake.SPEED_ * i, y - Math.sin(h) * snake.SPEED_ * i]);
p1.h = 0; p1.aim = 0; p1.turnIn = 0; p1.body = line(10, 10.6, 0, 6); p1.len = 6; p1.x = 10; p1.y = 10.6;
p2.h = Math.PI / 2; p2.aim = p2.h; p2.turnIn = 0; p2.body = line(10.6, 14, Math.PI / 2, 30); p2.len = 30; p2.x = 10.6; p2.y = 14;
s.step(); assert(p1.alive && p2.alive && p2.body.length < 30 && p1.len > 6 && p1.score > 0, `snake: biting another snake's body cuts it and grows you (${p2.body.length} left, len ${p1.len})`);
p1.body = line(20, 20, 0, 4); p1.len = 4; p1.x = 20; p1.y = 20; p1.h = 0; p1.aim = 0; p2.body = line(20.9, 20, Math.PI, 4); p2.len = 4; p2.x = 20.9; p2.y = 20; p2.h = Math.PI; p2.aim = Math.PI; const d0 = [p1.deaths, p2.deaths]; s.step(); assert(p1.deaths === d0[0] + 1 && p2.deaths === d0[1] + 1, 'snake: head-on collision kills both');
for (let i = 0; i < 40 && !(p1.alive && p2.alive); i++) s.step(); assert(p1.alive && p2.alive && p1.body.length > 0, 'respawn: quick (<1.6 s), fresh snake');
// tron rules (analog: ribbon polyline trail, segment intersection, polygon land capture)
const t = new E.World({ seed: 3, game: tron }); const c1 = t.add('T1'), c2 = t.add('T2'); t.fillBots(0);
c1.x = 10; c1.y = 10; tron.spawn(t, c1); const n = t.size;
c2.x = 38; c2.y = 38; tron.spawn(t, c2); const own0 = c1.score; const keep = c2; t.players.delete('T2');
c1.h = 0; c1.aim = null; c1.turnIn = 1; let left = false, k = 0; for (; k < 400; k++) { t.step(); if (c1.trail.length) left = true; if (left && !c1.trail.length) break; }
assert(left && c1.alive && c1.trail.length === 0 && c1.score > own0 + 15, `tron: holding a turn drives a true circle; closing the loop claims the polygon (${own0} -> ${c1.score} cells, ${k} ticks)`);
assert(t.polys.filter(g => g.o === 'T1').length === 2 && t.polys.at(-1).pts.length > 20, 'tron: claimed land is a real polygon (smooth outline), home disc + claim');
t.players.set('T2', keep); c1.turnIn = 0; c1.aim = 0; c1.h = 0; for (let i = 0; i < 40 && c1.trail.length < 12; i++) t.step(); const tr = c1.trail[6];
c2.x = tr[0]; c2.y = tr[1] - 0.25; c2.px = c2.x; c2.py = c2.y; c2.h = Math.PI / 2; c2.aim = c2.h; c2.turnIn = 0; c2.trail = []; const cd1 = c1.deaths, cd2 = c2.deaths; t.step();
assert(c1.deaths === cd1 + 1 && c2.deaths === cd2, 'tron: crossing a trail segment kills its owner');
for (let i = 0; i < 40 && !c1.alive; i++) t.step();
assert(c1.alive && c1.trail.length === 0 && t.land.filter(x => x === 'T1').length >= 12 && t.land.filter(x => x === 'T1').length <= 24, 'tron: quick respawn with a fresh home disc');
// ---- sub-maps: hard cap 100 (bots count, evicted first), split at 100, rebalance, linked siblings
const im = new I.InstanceManager({ game: snake, gameName: 'snake' }); assert(I.CAP === 100, 'cap is 100 per Mass Arena sub-map');
im.join('U0'); assert(im.list[0].players.size === E.MIN_POP && im.list[0].bots().length === E.MIN_POP - 1, 'bots count toward the map population');
for (let i = 1; i < 100; i++) im.join('U' + i);
let st = im.stats(); assert(st.length === 1 && st[0].humans === 100 && st[0].bots === 0 && st[0].total === 100, '100 humans: bots evicted, hard cap 100');
const big = new E.World({ seed: 1, game: snake }); big.cap = 100; for (let i = 0; i < 95; i++) big.add('Q' + i); big.fillBots(200); assert(big.players.size === 100, 'bot fill never exceeds the cap');
im.join('U100'); st = im.stats(); assert(st.length === 2 && st[1].humans === 1 && st.every(x => x.total <= 100), 'split at 100: 101st player opens a new sub-map');
assert(st[0].links.includes('snake-2') && st[1].links.includes('snake-1'), 'sibling sub-maps linked on the mesh');
for (let i = 101; i < 150; i++) im.join('U' + i); const rb = im.rebalance(); st = im.stats();
assert(rb.maps === 2 && st.every(x => x.humans >= I.SPLIT_MIN && x.humans <= 100) && st[0].humans + st[1].humans === 150, `rebalance: 150 humans -> ${st.map(x => x.humans).join('/')}`);
for (let i = 0; i < 80; i++) im.leave('U' + i); const rb2 = im.rebalance(); assert(rb2.maps === 1 && im.list[0].humans().length === 70 && im.list[0].links.length === 0, 'rebalance merges sub-maps when people leave');
assert(im.hop('U120', 'nope') === false, 'hop to unknown sibling refused');
const tw = new I.InstanceManager({ game: tron, gameName: 'tron' }); for (let i = 0; i < 101; i++) tw.join('R' + i); assert(tw.list.length === 2 && tw.list[0].players.size === 100, 'tron mass arena: same 100 cap + split');
// ---- natural bots
const B = await import('../src/arcade/bots.js');
const bw = new E.World({ seed: 9, game: tron }); bw.fillBots(); for (let i = 0; i < 2000; i++) bw.step();
const bots = bw.bots(), dec = bots.reduce((s, p) => s + p.persona.decisions, 0), mis = bots.reduce((s, p) => s + (p.persona.mistakes || 0), 0), rate = mis / dec;
assert(rate > 0.01 && rate < 0.15, `bot mistake rate ${(rate * 100).toFixed(1)}% (human-like, not perfect, not suicidal)`);
assert(new Set(bots.map(p => p.persona.kind)).size >= 2 && bots.every(p => p.persona.react >= 1), 'varied personalities + reaction delay');
assert(bots.some(p => p.deaths > 0) && bots.every(p => p.alive), 'bots die and respawn instantly like humans');
const said = bw.events; let lines = 0; const lw = new E.World({ seed: 4, game: snake }); lw.fillBots(); const seenSay = [];
for (let i = 0; i < 1500; i++) { for (const e of lw.step()) if (e.t === 'say') seenSay.push(e); }
const allLines = Object.values(B.LINES).flat(); assert(seenSay.length > 0 && seenSay.every(e => allLines.includes(e.text)), `bot trash talk: ${seenSay.length} canned PG lines`);
const gaps = seenSay.slice(1).map((e, i) => e.tick - seenSay[i].tick); assert(gaps.every(g => g >= B.SAY_MAP_TICKS), 'trash talk rate-limited per map');
assert(B.botLabel(lw.bots()[0]).endsWith('· AI') && B.botLabel({ name: 'Sam' }) === 'Sam', 'bots carry an honest AI tag');
const g1 = lw.bots()[0], g2 = lw.bots()[1]; lw.kill(g1, g2); assert(g1.persona.grudge === g2.code, 'grudge against the killer');
// ---- proximity voice
const me = { code: 'P1', x: 50, y: 50 };
assert(PX.gainFor(me, { x: 50, y: 50 }) === 1 && PX.gainFor(me, { x: 58, y: 50 }) > 0 && PX.gainFor(me, { x: 58, y: 50 }) < 1, 'proximity: distance falloff');
assert(PX.gainFor(me, { x: 50 + PX.VIEW_W / 2 + 1, y: 50 }) === 0 && PX.gainFor(me, { x: 50, y: 50 + PX.VIEW_H / 2 + 1 }) === 0, 'proximity: nothing outside the viewport');
assert(!PX.canHear({ age: 30 }, { code: 'K', minor: true }, { enabled: true, peerEnabled: true }) && !PX.canHear({ age: 14 }, { code: 'A', adult: true }, { enabled: true, peerEnabled: true }), 'proximity: never adult <-> minor');
assert(PX.canHear({ age: 14 }, { code: 'K', minor: true }, { enabled: true, peerEnabled: true }) && !PX.canHear({ age: 30 }, { code: 'A' }, { enabled: true, peerEnabled: true, muted: new Set(['A']) }), 'proximity: same band ok, muted silent');
const pv = new PX.ProximityVoice({ me: { age: 30 } }); assert(pv.enabled === false, 'proximity: adult default OFF');
const pstore = { x: null, read: async () => pstore.x, write: async o => { pstore.x = o; } }, par = new ParentControls({ store: pstore, iters: 1000 });
const kid = new PX.ProximityVoice({ me: { age: 13 }, parent: par });
assert(kid.enabled === false && (await par.allowed('proximityVoice')) && (await kid.setEnabled(true)).ok, 'proximity: allowed for minors by default (feature default ON; minor<->minor only)');
await kid.setEnabled(false); await par.setPin('1234'); await par.set('proximityVoice', false); assert((await kid.setEnabled(true)).reason === 'parent-disabled', 'proximity: a parent can turn it off with the PIN'); await par.set('proximityVoice', true);
assert((await kid.setEnabled(true)).ok && kid.enabled && (await par.log()).some(l => /proximity voice allowed/i.test(l.what)), 'proximity: parent PIN enables it, change logged');
const pw = new E.World({ seed: 5, game: tron }); pw.fillBots(0); const k1 = pw.add('K1', { minor: true }), k2 = pw.add('K2', { minor: true }), ad = pw.add('AD', { adult: true });
k2.x = k1.x + 3; k2.y = k1.y; ad.x = k1.x + 2; ad.y = k1.y; const heard = kid.update(pw, 'K1', () => true);
assert(heard.length === 1 && heard[0].code === 'K2', 'proximity: minor hears nearby minor only, not the adult beside them');
kid.mute('K2'); assert(kid.update(pw, 'K1', () => true).length === 0, 'proximity: mute a player');
const bw2 = new E.World({ seed: 2, game: snake }); bw2.fillBots(); const hm = bw2.add('HM'); const bb = bw2.bots()[0]; bb.x = hm.x + 1; bb.y = hm.y; bw2.bubbles = [{ who: bb.code, text: 'gg', until: 1e9 }];
const viewer = new PX.ProximityVoice({ me: { age: 13 } }); assert(viewer.bubbles(bw2, 'HM').length === 1, 'bot bubbles visible nearby (text only, minors too)'); viewer.muteBots = true; assert(viewer.bubbles(bw2, 'HM').length === 0, 'muting bots drops their bubbles');
console.log('ALL ARCADE SMOKE OK');
