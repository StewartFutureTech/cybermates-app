// Approved items 2026-10-20: global halt/resume, E2E packet layer, relay rotation, mode-filtered discovery, under-18 gate, sweep of banned.
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
globalThis.localStorage ||= (() => { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k, v) => m[k] = String(v), removeItem: k => delete m[k], _m: m }; })();
const K = ({ ...(await import('../src/killswitch.js')), ...(await import('./lib/sign.mjs')) }), B = await import('../src/ban.js'), V = await import('../src/vault.js'), M = await import('../api/_lib/mod.js');
const E = await import('../src/e2e.js'), R = await import('../src/relay.js'), D = await import('../src/discovery.js'), SW = await import('../src/sweep.js'), MS = await import('../src/mesh.js');
const kp = K.keygen(), pub = kp.publicKey;
// ---------- 1. global halt / resume ----------
localStorage.removeItem('cybermates:kill'); localStorage.removeItem('cybermates:last-resume'); localStorage.removeItem('cybermates:mesh-kill-nonces');
const vault = await new V.Vault({ info: 'dev|halt|android' }).load(); await vault.init({ meshIds: {} });
const mesh = () => { const S = () => new Map([['a', 1]]); const m = { stopped: false, node: { presence: S(), live: S(), cache: S(), friends: S(), chats: S() }, member: { active: S() }, async stop() { m.stopped = true; } }; return m; };
const st2 = (() => { const _m = {}; return { _m, getItem: k => _m[k] ?? null, setItem: (k, v) => _m[k] = String(v), removeItem: k => delete _m[k] }; })(); st2.setItem('cybermates:active-list:me', 'CIPHERTEXT');
const t0 = Date.now(), halt = K.sign(K.makeMsg({ type: 'kill', scope: 'all', reason: 'halt', ttlMs: 3600e3, now: t0 }), kp.privateKey);
const m1 = mesh(); let r = await B.applyControl(halt, { code: 'ME', vault, pubkey: pub, mesh: m1, storage: st2 });
assert(r.applied === 'kill' && r.forward && m1.stopped && !st2.getItem('cybermates:active-list:me'), 'halt: verified, gossip-forwardable, disconnected, active list wiped');
assert(B.killState(t0 + 30 * 864e5)?.scope === 'all', 'halt persists past expires_at (refuses reconnect/jump-start until resume)');
const forged = { ...halt, type: 'clear', nonce: 'n2' }; r = await B.applyControl(forged, { code: 'ME', vault, pubkey: pub }); assert(!r.ok && B.killState(), 'forged resume ignored');
const oldResume = K.sign(K.makeMsg({ type: 'clear', scope: 'all', reason: 'r', now: t0 - 60e3 }), kp.privateKey);
r = await B.applyControl(oldResume, { code: 'ME', vault, pubkey: pub, source: 'record' }); assert(!r.ok && r.reason === 'stale-resume' && B.killState(), 'resume older than the halt (replay) refused');
const resume = K.sign(K.makeMsg({ type: 'clear', scope: 'all', reason: 'r', now: t0 + 1000 }), kp.privateKey);
r = await B.applyControl(resume, { code: 'ME', vault, pubkey: pub, now: t0 + 2000 }); assert(r.ok && !B.killState(), 'newer signed resume lifts the halt');
r = await B.applyControl(halt, { code: 'ME', vault, pubkey: pub, seen: new Set(), source: 'record' }); assert(!r.ok && r.reason === 'stale-halt' && !B.killState(), 'replayed old halt after resume ignored');
// server: halt flag first, all routes refuse, resume must be newer
const db = { rec: null }, calls = []; const f = async (u, o = {}) => { calls.push(u); if (u.includes('kill_switch') && (o.method || 'GET') === 'GET') return { ok: true, json: async () => db.rec ? [{ msg: db.rec }] : [] }; if (u.includes('kill_switch')) db.rec = JSON.parse(o.body).msg; return { ok: true, json: async () => [] }; };
const cfg = { url: 'https://x', srk: 's', pub }; await M.meshKill(cfg, halt, f);
assert(calls.findIndex(u => u.includes('kill_switch?on_conflict')) < calls.findIndex(u => u.includes('broadcast')), 'server: halted flag written BEFORE broadcast');
let err = null; try { await M.meshKill(cfg, oldResume, f); } catch (e) { err = e; } assert(err?.status === 409, 'server: resume older than halt rejected (409)');
process.env.SUPABASE_URL = cfg.url; process.env.SUPABASE_SERVICE_ROLE_KEY = 's'; process.env.VITE_KILL_PUBKEY = pub; const realFetch = globalThis.fetch; globalThis.fetch = f;
const res = () => { const o = { s: 200, status(c) { o.s = c; return o; }, json(b) { o.b = b; return o; }, end() { return o; } }; return o; };
for (const name of ['ban', 'attest', 'help']) { const h = (await import(`../api/_fn/${name}.js`)).default, o = res(); await h({ method: 'POST', headers: {}, body: {} }, o); assert(o.s === 503 && o.b?.halted, `api/${name} refuses while halted`); }
{ const SIG = await import('../api/_lib/signal.js'); const sg = new SIG.MockSignal({ pub }); sg.setHalt(halt); const o = res(); await (await import('../api/_fn/bootstrap.js')).default({ method: 'GET', query: { code: 'X' }, headers: {} }, o, sg); assert(o.s === 503, 'api/bootstrap refuses while halted'); }
await M.meshKill(cfg, resume, f); { const o = res(); await (await import('../api/_fn/help.js')).default({ method: 'POST', headers: {}, body: {} }, o); assert(o.s !== 503 || !o.b?.halted, 'after newer resume routes stop refusing for halt'); }
globalThis.fetch = realFetch; delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
{ const fs = await import('node:fs'); const pubJs = fs.readdirSync('dist/assets').filter(x => x.endsWith('.js')).map(x => fs.readFileSync('dist/assets/' + x, 'utf8')).join('');
  assert(!pubJs.includes('ak-send-signed') && !pubJs.includes('KILL NETWORK'), 'kill/halt admin UI stripped from the public build'); }
// ---------- 6. E2E packet layer ----------
const ka = MS.newSigningKeys(), kb = MS.newSigningKeys(), ke = MS.newSigningKeys();
const A = new E.E2E({ code: 'AAAA', keys: ka }), Bn = new E.E2E({ code: 'BBBB', keys: kb }), Ev = new E.E2E({ code: 'EVE1', keys: ke });
const pingA = A.sealBroadcast({ id: 'p1', from: 'AAAA', to: '*', ttl: 6, type: 'ping', body: { pub: ka.pub } }), pingB = Bn.sealBroadcast({ id: 'p2', from: 'BBBB', to: '*', ttl: 6, type: 'ping', body: { pub: kb.pub } });
assert(await Bn.open(pingA) && await A.open(pingB) && await Ev.open(pingA), 'pings signed; X25519 keys learned (TOFU, xsig-verified)');
const chat = await A.seal({ id: 'c1', from: 'AAAA', to: 'BBBB', ttl: 6, type: 'starter', body: { text: 'secret hello' } });
assert(chat.type === 'e2e' && !JSON.stringify(chat).includes('secret hello') && !JSON.stringify(chat).includes('starter'), 'starter on the wire: AES-GCM ciphertext, type hidden');
const got = await Bn.open(chat); assert(got?.type === 'starter' && got.body.text === 'secret hello', 'recipient decrypts with per-chat X25519 key');
assert(!(await Ev.open({ ...chat, to: 'EVE1' })) && !(await Ev.open(chat)), 'eavesdropper (has A\'s ping) cannot read it');
assert(!(await Bn.open({ ...chat, ct: chat.ct.slice(0, -4) + 'AAAA' })) && !(await Bn.open({ ...chat, from: 'EVE1' })), 'tampered / spoofed sender rejected (signature)');
const thr = fn => { try { fn(); return null; } catch (e) { return e; } };
assert(thr(() => E.assertSealed({ k: 'mesh', env: { id: 'x', from: 'A', to: 'B', type: 'chat', body: { text: 'hi' } } }))?.code === 'E2E_PLAINTEXT_DIRECTED', 'plaintext chat envelope refused by transport');
assert(thr(() => E.assertSealed({ k: 'mesh', env: { id: 'x', from: 'A', to: '*', type: 'starter', body: {}, sig: 's' } })), 'plaintext starter (even broadcast) refused');
assert(!thr(() => E.assertSealed({ k: 'mesh', env: chat })) && !thr(() => E.assertSealed({ k: 'mesh', env: pingA })), 'sealed envelopes + signed pings pass');
{ const { LocalBus } = await import('../src/net.js'); let posted = 0; const { Throttle } = await import('../src/net.js'); const lb = Object.create(LocalBus.prototype); lb.c = { postMessage: () => posted++ }; lb.throttle = new Throttle();
  assert(thr(() => lb.post({ k: 'mesh', env: { id: 'x', from: 'A', to: 'B', type: 'chat', body: {} } })) && posted === 0, 'local/mock transport refuses to post plaintext chat'); lb.post({ k: 'mesh', env: chat }); assert(posted === 1, 'local transport posts sealed chat'); }
// ---------- 3. relay rotation ----------
const nodes = {}; for (const c of ['AAAA', 'BBBB', 'R1', 'R2', 'R3', 'BAN1', 'BLK1', 'UNAT']) { const k = MS.newSigningKeys(); nodes[c] = new E.E2E({ code: c, keys: k }); }
const xp = c => nodes[c].box.xpub; let now = 1e6;
const mk = (me, o = {}) => new R.RelayRouter({ me, xsec: nodes[me].box.xsec, xpubOf: xp, candidates: () => Object.keys(nodes), isBanned: c => c === 'BAN1', isBlocked: c => c === 'BLK1', isAttested: c => c !== 'UNAT', requireAttested: true, now: () => now, ...o });
const ra = mk('AAAA'); for (const c of Object.keys(nodes)) ra.noteRelayer(c, true);
const elig = ra.eligible(['BBBB']); assert(elig.sort().join() === 'R1,R2,R3', 'eligible relays exclude banned, blocked, unattested, self and destination');
const p1 = ra.path('BBBB'); assert(p1.length >= 2 && p1.length <= 3 && p1.every(h => elig.includes(h)), `path of ${p1.length} hops from the active list`);
assert(ra.path('BBBB').join() === p1.join(), 'path stable within rotation window'); now += R.ROTATE_MS + 1; for (const c of Object.keys(nodes)) ra.noteRelayer(c, true); let rotated = false; for (let i = 0; i < 10 && !rotated; i++) { ra.paths.clear(); rotated = ra.path('BBBB').join() !== p1.join(); } assert(rotated, 'path rotates');
const routers = Object.fromEntries(Object.keys(nodes).map(c => [c, mk(c)])); Object.values(routers).forEach(x => x.active = true);
let pkt = ra.route(chat).pkt; const sizes = []; const seenBy = [];
while (pkt.k === 'onion') { sizes.push(JSON.stringify(pkt.z).length); seenBy.push(pkt.hop); const out = routers[pkt.hop].onPacket(pkt); assert(out && out.delay >= R.JITTER_MS[0] && out.delay <= R.JITTER_MS[1], `hop ${pkt.hop} unwraps one layer (jitter ${out.delay} ms), knows only next hop`); pkt = out.pkt; }
assert(pkt.k === 'mesh' && pkt.env.ct === chat.ct && (await Bn.open(pkt.env)).body.text === 'secret hello', 'exit hands the still-encrypted envelope to the destination');
{ const a = R.boxTo(xp('R1'), { p: 'x' }), b = R.boxTo(xp('R1'), { p: 'y'.repeat(1500) }); assert(a.c.length === b.c.length && R.pad('abc').length % R.PAD_BUCKET === 0, 'layers padded to fixed-size buckets (short and long payloads look identical)'); }
{ const idle = mk('R1'); idle.active = false; const pk = ra.route(chat).pkt; assert(pk.k !== 'onion' || routers[pk.hop] && mk(pk.hop).onPacket(pk) === null, 'idle phone (not online+searching) does not relay'); }
{ const lone = mk('AAAA', { candidates: () => ['AAAA', 'BBBB', 'R1'] }); lone.noteRelayer('R1', true); const x = lone.route(chat); assert(x.via === null && x.pkt.k === 'mesh', 'too few relays -> direct fallback over current transport'); }
// ---------- 4/5. discovery + under 18 ----------
const adult = { age: 25, lookingFor: ['friends', 'dating'] }, teen = { age: 16, lookingFor: ['friends', 'dating'] };
assert(D.visibleModes(teen, ['friends', 'gaming', 'dating']).join() === 'friends,gaming' && D.visibleModes(adult, ['friends', 'gaming', 'dating']).length === 3, 'under 18: Dating tab not rendered');
assert(!D.publishProfile(teen, { lookingFor: ['friends', 'dating'] }).lookingFor.includes('dating') && !D.canQuery(teen, 'dating') && D.discQuery(teen, 'dating') === null, 'under 18: no dating vectors sent or requested');
assert(!D.shouldAnswer(teen, { mode: 'dating' }) && D.shouldAnswer(adult, { mode: 'dating' }) && !D.shouldAnswer(adult, { mode: 'gaming' }), 'answers only for own modes; minors never answer dating');
assert(!D.acceptVector(adult, 'dating', { age: 17, lookingFor: ['dating'] }) && !D.acceptVector(adult, 'dating', { minor: true, lookingFor: ['dating'] }) && D.acceptVector(adult, 'dating', { age: 30, lookingFor: ['dating'] }), 'adult dating discovery excludes minors');
assert(D.filterForMode(adult, 'gaming', [{ lookingFor: ['gaming'] }, { lookingFor: ['dating'] }]).length === 1, 'only the current mode\'s vectors processed');
{ const src = (await import('node:fs')).readFileSync('src/main.js', 'utf8'); assert(/DISC\.visibleModes\(me, D\.MODES\)/.test(src) && /modes\.map\(m =>/.test(src), 'Discover renders tabs from visibleModes (Dating absent for minors)'); }
// ---------- 2. sweep clears banned users + their queued messages ----------
{ const node = { presence: new Map([['BAD', Date.now()], ['OK', Date.now()]]), cache: new Map([['BAD', { lastSeen: Date.now() }]]), live: new Map([['BAD', 1]]), chats: new Map([['BAD', {}]]), pendingOut: new Set(['BAD']), outq: [{ to: 'BAD', env: {} }, { to: 'OK', env: {} }], relayq: [{ to: 'BAD' }] };
  const out = SW.sweepStale({ node, isBanned: c => c === 'BAD' }); assert(out.banned === 1 && !node.presence.has('BAD') && node.presence.has('OK') && node.outq.length === 1 && !node.relayq.length && !node.pendingOut.has('BAD'), '24h sweep also clears banned users and their queued messages'); }
localStorage.removeItem('cybermates:last-resume'); localStorage.removeItem('cybermates:kill');
console.log('ALL OK smoke-approved');
