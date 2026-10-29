// Tiered enforcement: escalation 1->5, suspension expiry (->3), warnings don't boot, level 5 instant boot, gossip only 4-5.
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
globalThis.localStorage ||= (() => { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k, v) => m[k] = String(v), removeItem: k => delete m[k], _m: m }; })();
const K = ({ ...(await import('../src/killswitch.js')), ...(await import('./lib/sign.mjs')) }), T = await import('../src/tiers.js'), B = await import('../src/ban.js'), V = await import('../src/vault.js');
const BL = await import('../src/banlist.js'), M = await import('../api/_lib/mod.js'), C = await import('../src/checkin.js');
const k = K.keygen(), pub = k.publicKey, ME = 'CY7DKH9FANQBZXJS';
// fake Supabase REST (blocklist + mod_actions + realtime)
const db = new Map(), log = [], casts = [];
const fake = async (u, o = {}) => { const url = new URL(u), path = url.pathname, code = (url.searchParams.get('code') || '').replace(/^eq\./, ''), ok = (b = []) => ({ ok: true, status: 200, json: async () => b });
  if (path.endsWith('/broadcast')) { casts.push(JSON.parse(o.body)); return ok(); }
  if (path.endsWith('/mod_actions')) { log.push(JSON.parse(o.body)); return ok(); }
  if (path.endsWith('/blocklist')) { const m = o.method || 'GET';
    if (m === 'GET') return ok(code ? (db.has(code) ? [db.get(code)] : []) : [...db.values()]);
    if (m === 'POST') { const r = JSON.parse(o.body); db.set(r.code, r); return ok(); }
    if (m === 'PATCH') { Object.assign(db.get(code), JSON.parse(o.body)); return ok(); }
    if (m === 'DELETE') { db.delete(code); return ok(); } }
  return { ok: false, status: 404 }; };
const cfg = { url: 'https://x.supabase.co', srk: 'srk', pub };
const strike = async (opts = {}, now = Date.now()) => { const plan = T.nextOffense(await M.getRecord(cfg, ME, fake), { now, ...opts });
  const msg = K.sign(K.makeMsg({ type: plan.level >= 4 ? 'kill' : 'warn', scope: 'user:' + ME, reason: 'spam', ttlMs: plan.ttlMs, level: plan.level, strikes: plan.strikes, now }), k.privateKey);
  assert(!(await M.verifyAdminMsg(msg, pub, now)), `signed level ${plan.level} msg accepted by server`);
  return { plan, msg, r: await M.ban(cfg, { msg, code: ME, category: 'spam/scam', reason: 'spam' }, fake) }; };
// escalation 1 -> 5
const seen = [];
for (let i = 1; i <= 5; i++) { const { r } = await strike(); seen.push(r.level); assert(db.get(ME).strikes === i, `strike ${i} recorded (level ${r.level})`); }
assert(seen.join() === '1,2,3,4,5', 'repeat offenses escalate one level per strike: ' + seen.join('->'));
assert(casts.length === 2 * 2, 'only levels 4 and 5 broadcast (2 msgs each: control + mesh gossip)');
assert(T.nextOffense({ level: 5, strikes: 5 }).level === 5, 'level caps at 5');
assert(T.nextOffense({ level: 5, strikes: 5 }, { set: 2 }).level === 2 && T.nextOffense(null, { set: 4 }).level === 4, 'admin can set a level directly');
// unban / lower
await M.unban(cfg, { msg: K.sign(K.makeMsg({ type: 'clear', scope: 'user:' + ME, reason: 'lower' }), k.privateKey), code: ME, toLevel: 2 }, fake);
assert(db.get(ME).level === 2 && db.get(ME).entry === null && !(await M.isBlocked(cfg, ME, fake)), 'admin lowered 5 -> 2 (record kept, not blocked)');
await M.unban(cfg, { msg: K.sign(K.makeMsg({ type: 'clear', scope: 'user:' + ME, reason: 'unban' }), k.privateKey), code: ME }, fake);
assert(!db.has(ME), 'unban removes record');
// suspension expiry
const t0 = Date.now(); db.set(ME, { code: ME, level: 3, strikes: 3, reason: 'spam' });
const { msg: s4 } = await strike({ suspendMs: 7 * 864e5 }, t0);
assert(s4.level === 4 && s4.expires_at - t0 === 7 * 864e5, 'level 4 = 7-day suspension by default');
assert((await M.isBlocked(cfg, ME, fake, t0 + 6 * 864e5))?.level === 4, 'suspended: blocked during the 7 days');
const after = await M.standing(cfg, ME, fake, t0 + 7 * 864e5 + 1); assert(after.level === 3 && !(await M.isBlocked(cfg, ME, fake, t0 + 8 * 864e5)), 'after expiry: drops back to level 3, bootstrap allowed');
assert(T.nextOffense(db.get(ME), { now: t0 + 8 * 864e5 }).level === 4, 'next offense after expired suspension -> 4 again');
// bootstrap tiers
process.env.SUPABASE_URL = cfg.url; process.env.SUPABASE_SERVICE_ROLE_KEY = 'srk'; delete process.env.VITE_KILL_PUBKEY;
globalThis.fetch = fake; const boot = (await import('../api/_fn/bootstrap.js')).default;
const call = q => new Promise(res => { const o = { s: 200, status(c) { o.s = c; return o; }, json(b) { res({ s: o.s, b }); }, end() { res({ s: o.s }); } }; boot({ method: 'GET', query: q, headers: {} }, o); });
let b = await call({ code: ME, check: '1' }); assert(b.s === 403 && b.b.suspended && b.b.until === s4.expires_at, 'check-in during suspension: 403 suspended + until');
db.set(ME, { code: ME, level: 2, strikes: 2, reason: 'spam' }); b = await call({ code: ME, check: '1' });
assert(b.s === 200 && b.b.level === 2 && /Warning/.test(b.b.warning), '24h check-in returns current level + warning text (200)');
b = await call({ code: ME }); assert(b.s === 200 && b.b.level === 2 && b.b.warning, 'bootstrap (join) also carries the warning, does not refuse');
db.set(ME, { code: ME, level: 5, strikes: 5 }); b = await call({ code: ME, check: '1' }); assert(b.s === 403 && b.b.banned, 'level 5: bootstrap refuses');
db.set('OLDCODE123', { code: 'OLDCODE123', category: 'spam' }); db.delete(ME); b = await call({ code: ME, legacy: 'OLDCODE123' }); assert(b.s === 403 && b.b.banned, 'legacy row without level = ban (5)');
// client: checkIn
const r200 = await C.checkIn({ code: ME, fetchStatus: async () => ({ status: 200, json: async () => ({ level: 2, warning: 'W' }) }) });
assert(r200.ok && r200.level === 2 && r200.warning === 'W' && !r200.banned, 'client check-in: warning surfaced, not booted');
const r403 = await C.checkIn({ code: ME, fetchStatus: async () => ({ status: 403, json: async () => ({ suspended: true, until: Date.now() + 1e6 }) }) });
assert(r403.suspended && r403.level === 4, 'client check-in: suspension recognised');
// client: warnings don't boot; level 4 suspends w/ expiry; level 5 instant boot
const store = new V.MemorySecretStore(); let blob = null; const vault = await new V.Vault({ store, persist: { load: async () => blob, save: async x => { blob = x; } }, info: 'dev|Pixel|android' }).load(); await vault.init({ meshIds: { me: { code: ME, friends: { F1: { pub: 'x' } } } } });
const mesh = () => { const S = () => new Map([['a', 1]]); const m = { stopped: false, node: { presence: S(), live: S(), cache: S(), friends: S(), chats: S() }, member: { active: S() }, async stop() { m.stopped = true; } }; return m; };
const reset = () => { localStorage.removeItem('cybermates:kill'); localStorage.removeItem('cybermates:mesh-kill-nonces'); };
const sg = o => K.sign(K.makeMsg({ type: 'kill', scope: 'user:' + ME, reason: 'spam', ...o }), k.privateKey);
let m1 = mesh(), x = await B.applyControl(sg({ level: 2, strikes: 2 }), { code: ME, vault, pubkey: pub, mesh: m1 });
assert(!x.ok && x.reason === 'warning-only' && !m1.stopped && !B.killState() && !(await B.blockedReason(vault)), 'warning-level signed msg does NOT boot (mesh untouched)');
const warnMsg = K.sign(K.makeMsg({ type: 'warn', scope: 'user:' + ME, level: 1 }), k.privateKey); x = await B.applyControl(warnMsg, { code: ME, vault, pubkey: pub, mesh: m1 }); assert(!x.ok && !m1.stopped, "type 'warn' ignored by phones");
reset(); const now = Date.now(); m1 = mesh(); x = await B.applyControl(sg({ level: 4, strikes: 4, ttlMs: 7 * 864e5 }), { code: ME, vault, pubkey: pub, mesh: m1 });
assert(x.applied === 'suspend' && m1.stopped && (await B.blockedReason(vault))?.suspended && (await vault.read()).meshIds.me.friends.F1, 'level 4: booted + suspended, friends kept');
assert(!(await B.blockedReason(vault, now + 7 * 864e5 + 1)) && !B.killState(now + 7 * 864e5 + 1), 'level 4 local marker + kill flag expire with the suspension');
reset(); await vault.use(p => { delete p.ban; }); m1 = mesh(); const t = Date.now(); x = await B.applyControl(sg({ level: 5, strikes: 5, ttlMs: 365 * 864e5 - 6e4 }), { code: ME, vault, pubkey: pub, mesh: m1 });
assert(x.applied === 'ban' && m1.stopped && (await B.blockedReason(vault))?.banned && Date.now() - t < 2000, 'level 5: instant boot + permanent ban marker');
reset(); await vault.use(p => { delete p.ban; }); m1 = mesh(); x = await B.applyControl(sg({}), { code: ME, vault, pubkey: pub, mesh: m1 }); assert(x.applied === 'ban' && m1.stopped, 'legacy signed ban (no level) still = instant boot');
// gossip: ban list carries only 4-5; level/strikes survive compact encoding with valid signature
const list = new BL.BanList({ pubkey: pub });
const e4 = sg({ level: 4, strikes: 4, ttlMs: 864e5 }), e2 = { ...sg({ level: 2 }), scope: 'user:WARNED00000000' };
assert(await list.merge([BL.decodeEntry(BL.encodeEntry(e4))]) === 1 && list.level(ME) === 4 && list.isBanned(ME), 'level 4 entry gossips (encode/decode keeps level+signature)');
assert(await list.merge([BL.decodeEntry(BL.encodeEntry(e2))]) === 0, 'warning-level entries rejected from gossip ban list');
const later = new BL.BanList({ pubkey: pub, now: () => Date.now() + 2 * 864e5 }); await later.merge([e4]); assert(!later.isBanned(ME), 'gossiped suspension expires');
console.log('ALL OK smoke-tiers');
