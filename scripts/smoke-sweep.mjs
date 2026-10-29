// 24h offline sweep + 24h ban check-in gate (src/sweep.js, src/checkin.js). Fake clock, no network.
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const mem = (() => { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k, v) => m[k] = String(v), removeItem: k => delete m[k] }; })();
globalThis.localStorage ||= mem;
const S = await import('../src/sweep.js'), C = await import('../src/checkin.js');
const H = 3600e3, NOW = 1_800_000_000_000, sh = 's0';
const row = (code, age) => ({ code, shard: sh, ts: NOW - age });
const member = { code: 'ME', active: new Map(), inactive: new Map(), recvAt: new Map(), suspects: new Map(), store: new Map(), outbox: [] };
for (const [c, a] of [['ME', 50 * H], ['FRESH', 2 * H], ['STALE', 30 * H], ['OLDOFF', 40 * H]]) (c === 'OLDOFF' ? member.inactive : member.active).set(sh + '|' + c, row(c, a));
member.recvAt.set(sh + '|STALE', NOW - 26 * H);
member.active.set(sh + '|HEARD', row('HEARD', 30 * H)); member.recvAt.set(sh + '|HEARD', NOW - 1 * H); // old row, but heard recently
member.store.set('g1', { kind: 'r', obj: { code: 'STALE' } }); member.store.set('g2', { kind: 'r', obj: { code: 'FRESH' } }); member.outbox = [{ id: 'g1' }, { id: 'g2' }];
const node = { presence: new Map([['FRESH', NOW - H], ['STALE', NOW - 25 * H]]), live: new Map([['STALE', 1]]), cache: new Map([['FRESH', { lastSeen: NOW - H }], ['STALE', { lastSeen: NOW - 30 * H }], ['GONE', { lastSeen: NOW - 48 * H }]]),
  pendingOut: new Set(['STALE', 'FRESH']), outq: [{ to: 'STALE', env: 1 }, { to: 'FRESH', env: 2 }, { to: 'OLDOFF', env: 3 }, { to: 'FRESH', env: 4, queuedAt: NOW - 25 * H }], relayq: [{ to: 'GONE' }, { to: 'FRESH' }] };
const r = S.sweepStale({ member, node, now: NOW });
assert(!member.active.has(sh + '|STALE') && !member.inactive.has(sh + '|OLDOFF') && !member.recvAt.has(sh + '|STALE'), 'stale peers (>24h) removed from active/inactive list');
assert(member.active.has(sh + '|FRESH') && member.active.has(sh + '|HEARD') && member.active.has(sh + '|ME'), 'fresh peers (and self) kept; recently-heard peer kept');
assert(!node.cache.has('STALE') && !node.cache.has('GONE') && node.cache.has('FRESH') && !node.presence.has('STALE') && !node.live.has('STALE'), 'stale peer cache/presence dropped, fresh kept');
assert(node.outq.map(e => e.env).join() === '2' && node.relayq.length === 1 && node.relayq[0].to === 'FRESH', 'queued outbound + relay messages to stale peers dropped (and >24h-old queued items)');
assert(!node.pendingOut.has('STALE') && node.pendingOut.has('FRESH') && !member.store.has('g1') && member.store.has('g2') && member.outbox.length === 1, 'pending friend req + gossip items for stale peers dropped');
assert(r.peers === 2 && r.queued === 4, 'sweep report counts');
// check-in gate (fake clock)
let p = C.startPlan({ lastOk: 0, now: NOW }); assert(p.check && p.pull && !('useCache' in p), 'never checked -> server entry + check (no cache path exists)');
p = C.startPlan({ lastOk: NOW - 23 * H, now: NOW }); assert(!p.check && p.pull, 'checked <24h ago -> still enters via server (single entry)');
p = C.startPlan({ lastOk: NOW - 25 * H, now: NOW }); assert(p.check && p.pull, 'checked >24h ago -> check-in due');
p = C.startPlan({ lastOk: 0, now: NOW, local: true }); assert(!p.check && !p.pull, 'local dev bus -> no server (dev only)');
const st = s => async () => ({ status: s });
mem.removeItem(C.LK);
assert((await C.checkIn({ code: 'ME', fetchStatus: st(200), now: NOW, storage: mem })).ok && C.lastServerOk(mem) === NOW, 'successful check-in records last server contact');
assert((await C.checkIn({ code: 'ME', fetchStatus: async () => { throw 0; }, now: NOW + 30 * H, storage: mem })).offline && C.lastServerOk(mem) === NOW, 'offline check does not refresh the timestamp');
assert(C.startPlan({ lastOk: C.lastServerOk(mem), now: NOW + 30 * H }).check, '30h later still owes a check-in');
assert((await C.checkIn({ code: 'ME', fetchStatus: st(403), now: NOW, storage: mem })).banned, '403 → banned');
assert((await C.checkIn({ code: 'ME', fetchStatus: st(503), now: NOW, storage: mem })).killed, '503 → killed');
assert((await C.checkIn({ code: 'ME', fetchStatus: st(200), local: true, storage: mem })).skipped === 'local', 'local checkIn is a no-op');
{ const B = await import('../src/ban.js'); let p0 = {}; const vault = { use: async f => f(p0) }; let wiped = 0, notice = null;
  await C.applyServerBan({ vault, now: NOW, storage: globalThis.localStorage, wipePeers: async () => { wiped++; }, onNotice: n => notice = n });
  assert(p0.ban && wiped === 1 && notice?.banned && B.killState(NOW + H)?.targeted, 'banned at check-in → kill applied locally (flag + vault marker + wipe)'); globalThis.localStorage.removeItem('cybermates:kill'); }
console.log('smoke-sweep OK');
