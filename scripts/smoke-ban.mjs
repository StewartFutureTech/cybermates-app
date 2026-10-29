// Ban / kill enforcement: client (src/ban.js) + server order (api/_lib/mod.js, api/_fn/ban.js, api/_fn/kill.js, api/_fn/bootstrap.js). No browser.
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
globalThis.localStorage ||= (() => { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k, v) => m[k] = String(v), removeItem: k => delete m[k] }; })();
const K = ({ ...(await import('../src/killswitch.js')), ...(await import('./lib/sign.mjs')) }), B = await import('../src/ban.js'), V = await import('../src/vault.js');
const k = K.keygen(), pub = k.publicKey, ME = 'MECODE1234', OTHER = 'OTHER56789';
const signed = (o = {}) => K.sign(K.makeMsg({ type: 'kill', scope: 'all', reason: 'test', ...o }), k.privateKey);
const store = new V.MemorySecretStore(); let blob = null; const persist = { load: async () => blob, save: async b => { blob = b; } };
const vault = await new V.Vault({ store, persist, info: 'dev|Pixel|android' }).load(); await vault.init({ meshIds: { me: { code: ME, friends: { F1: { pub: 'x' } }, stubs: [1, 2] } } });
const fakeMesh = () => { const S = () => new Map([['a', 1]]); const m = { stopped: false, node: { presence: S(), live: S(), cache: S(), friends: S(), chats: S() }, member: { active: S() }, async stop() { m.stopped = true; } }; return m; };
const reset = () => { localStorage.removeItem('cybermates:last-resume'); localStorage.removeItem('cybermates:kill'); localStorage.removeItem('cybermates:mesh-kill-nonces'); };
const opts = (o = {}) => ({ code: ME, vault, pubkey: pub, ...o });
// forged / unsigned / tampered / stale / replay
reset();
assert(!(await B.applyControl({ type: 'kill', scope: 'all', reason: 'x', issued_at: Date.now(), expires_at: Date.now() + 1e6, nonce: 'n1' }, opts())).ok && !B.killState(), 'unsigned kill rejected, no kill flag');
assert((await B.applyControl(K.sign(K.makeMsg({}), K.keygen().privateKey), opts())).reason === 'bad-signature' && !B.killState(), 'kill signed by another key (forged) rejected');
assert((await B.applyControl({ ...signed(), scope: 'user:' + ME }, opts())).reason === 'bad-signature', 'tampered scope (all -> user:me) rejected');
assert((await B.applyControl(signed({ now: Date.now() - 3600e3 }), opts())).reason === 'stale', 'stale live broadcast rejected');
// targeted at someone else: not applied, but forwardable (valid signature)
{ const m = fakeMesh(); const r = await B.applyControl(signed({ scope: 'user:' + OTHER }), opts({ mesh: m })); assert(!r.ok && r.reason === 'out-of-scope' && r.forward && !m.stopped && !B.killState(), 'kill targeted at another code: ignored here, still gossiped on'); }
// targeted at me = ban
{ const m = fakeMesh(); let notice = null; const msg = signed({ scope: 'user:' + ME, reason: 'ban test' });
  const r = await B.applyControl(msg, opts({ mesh: m, onNotice: n => notice = n }));
  assert(r.applied === 'ban' && m.stopped && !m.node.cache.size && !m.node.presence.size && !m.member.active.size && !m.node.friends.size, 'targeted kill: mesh closed, online/peer caches wiped');
  const p = await vault.read(); assert(p.ban?.reason === 'ban test' && !p.meshIds.me.stubs && !Object.keys(p.meshIds.me.friends).length, 'targeted kill: stored stubs/friends wiped + encrypted ban marker in vault');
  assert(B.killState()?.targeted && notice?.banned, 'killed flag persisted (stop reconnecting) + banned notice');
  assert((await B.applyControl(msg, opts())).reason === 'replay', 'replayed ban message rejected');
  assert((await B.blockedReason(vault))?.banned, 'app refuses to rejoin: blockedReason = banned');
  // device-bound marker: same blob on another device can't be read
  const other = await new V.Vault({ store: new V.MemorySecretStore(), persist, info: 'dev|Pixel|android' }).load();
  assert((await B.banMarker(other)) === null && !!blob, 'ban marker is device-bound: copied vault blob does not decrypt elsewhere');
  localStorage.removeItem('cybermates:kill'); assert((await B.blockedReason(vault))?.banned, 'clearing the kill flag alone does not lift the vault ban marker');
  const un = await B.applyControl(K.sign(K.makeMsg({ type: 'clear', scope: 'user:' + ME, ttlMs: 3600e3 }), k.privateKey), opts());
  assert(un.applied === 'unban' && !(await B.blockedReason(vault)), 'signed user-scoped clear (unban) removes marker + flag'); }
// mesh-wide kill
{ reset(); const m = fakeMesh(); const r = await B.applyControl(signed(), opts({ mesh: m }));
  assert(r.applied === 'kill' && m.stopped && !m.node.cache.size && m.node.friends.size === 1 && B.killState() && !B.killState().targeted && !(await vault.read()).ban, 'mesh-wide kill: caches wiped + closed, friends kept, no ban marker');
  const forged = { ...K.sign(K.makeMsg({ type: 'clear', ttlMs: 3600e3 }), K.keygen().privateKey) }; await B.applyControl(forged, opts()); assert(B.killState(), 'forged clear cannot lift a kill');
  await B.applyControl(K.sign(K.makeMsg({ type: 'clear', ttlMs: 3600e3 }), k.privateKey), opts()); assert(!B.killState(), 'signed clear lifts mesh-wide kill'); }
// ---------- server side ----------
const M = await import('../api/_lib/mod.js');
const calls = []; const f = async (u, o = {}) => { calls.push({ u, m: o.method || 'GET', b: o.body ? JSON.parse(o.body) : null }); return { ok: true, status: 200, json: async () => db(u), text: async () => '' }; };
let BL = {}, KR = null; const db = u => u.includes('/blocklist?code=eq.') ? (BL[decodeURIComponent(u.split('code=eq.')[1].split('&')[0])] ? [BL[decodeURIComponent(u.split('code=eq.')[1].split('&')[0])]] : []) : u.includes('kill_switch?id=eq.current') ? (KR ? [{ msg: KR }] : []) : [];
const cfg = { url: 'https://x.supabase.co', srk: 'srk', pub };
const step = c => c.u.includes('/rest/v1/blocklist') ? (c.m === 'DELETE' ? 'blocklist-delete' : (c.m || 'GET') === 'GET' ? 'read' : 'blocklist') : c.u.includes('mod_actions') ? 'log' : c.u.includes('kill_switch') ? ((c.m || 'GET') === 'GET' ? 'read' : 'record') : c.b?.messages?.[0]?.topic === 'control' ? 'control' : c.b?.messages?.[0]?.topic === 'mesh' ? 'gossip' : c.u;
{ calls.length = 0; await M.meshKill(cfg, signed(), f); assert(calls.map(step).join() === 'read,record,control,gossip', 'mesh-wide kill order: (read current halt) server kill_switch record FIRST, then control broadcast, then mesh gossip'); }
{ calls.length = 0; const r = await M.ban(cfg, { msg: signed({ scope: 'user:' + OTHER }), code: OTHER, category: 'csam', reason: 'label' }, f);
  assert(calls.map(step).join() === 'read,blocklist,log,control,gossip', 'ban order: (read prior strikes) blocklist row FIRST, log, then targeted kill broadcast + gossip');
  const log = calls.find(c => step(c) === 'log').b; assert(r.csam && r.reminder.includes('NCMEC') && log.preserve_until && new Date(log.preserve_until) - Date.now() > 360 * 864e5, 'CSAM ban: 1-year preservation hold logged + NCMEC reminder returned');
  assert(calls[4].b.messages[0].payload.k === 'ctl' && calls[4].b.messages[0].payload.msg.scope === 'user:' + OTHER, 'gossip payload is the signed targeted kill'); }
{ calls.length = 0; await M.unban(cfg, { msg: K.sign(K.makeMsg({ type: 'clear', scope: 'user:' + OTHER }), k.privateKey), code: OTHER }, f); assert(calls.map(step).join() === 'blocklist-delete,log,control,gossip', 'unban: blocklist delete, log, broadcast signed clear'); }
// api/ban route auth
Object.assign(process.env, { VITE_KILL_PUBKEY: pub, SUPABASE_URL: cfg.url, SUPABASE_SERVICE_ROLE_KEY: 'srk' }); globalThis.fetch = f;
const res = () => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, end() { return r; } }; return r; };
const { default: banRoute } = await import('../api/_fn/ban.js');
const call = async body => banRoute({ method: 'POST', headers: { 'x-forwarded-for': '7.7.7.' + Math.random() }, body }, res());
calls.length = 0; assert((await call({ msg: K.sign(K.makeMsg({ scope: 'user:' + OTHER }), K.keygen().privateKey), code: OTHER, category: 'spam/scam' })).code === 403 && !calls.filter(c => c.m !== 'GET').length, 'api/ban: forged signature -> 403, nothing written');
assert((await call({ msg: signed({ scope: 'user:SOMEONE' }), code: OTHER, category: 'spam/scam' })).code === 400, 'api/ban: message scope must match the banned code');
assert((await call({ msg: signed({ scope: 'all' }), code: OTHER, category: 'spam/scam' })).code === 400, 'api/ban: mesh-wide message cannot be used as a ban');
assert((await call({ msg: signed({ scope: 'user:' + OTHER }), code: OTHER, category: 'spam/scam' })).code === 200 && calls.filter(c => !c.u.includes('kill_switch')).map(step).slice(0, 2).join() === 'read,blocklist', 'api/ban: valid signed ban accepted (prior strikes read, then blocklist first)');
// bootstrap first-contact gate
const { default: boot } = await import('../api/_fn/bootstrap.js');
BL = { [OTHER]: { code: OTHER, category: 'spam/scam' } };
assert((await boot({ method: 'GET', query: { code: OTHER } }, res())).code === 403, 'bootstrap: banned code refused (gets no peers)');
assert((await boot({ method: 'GET', query: { code: ME } }, res())).code === 200, 'bootstrap: non-banned code served');
KR = signed(); assert((await boot({ method: 'GET', query: { code: ME } }, res())).code === 503, 'bootstrap: active signed mesh-wide kill refuses ALL joins');
KR = K.sign(K.makeMsg({}), K.keygen().privateKey); assert((await boot({ method: 'GET', query: { code: ME } }, res())).code === 200, 'bootstrap: forged kill record ignored');
KR = null; reset();
// ---------- single-entry: active list in memory only; kill clears memory + purges any LEGACY persisted list file ----------
{ const LEG = 'cybermates:active-list:'; const disk = (() => { const m = {}; return { _m: m, getItem: k => m[k] ?? null, setItem: (k, v) => m[k] = String(v), removeItem: k => delete m[k] }; })();
  const src = (await import('node:fs')).readFileSync('src/app-mesh.js', 'utf8'); assert(!/saveActiveList|loadActiveList/.test(src), 'app-mesh never persists the active list');
  for (const [label, msg] of [['targeted', signed({ scope: 'user:' + ME, reason: 'x' })], ['mesh-wide', signed()]]) {
    reset(); disk.setItem(LEG + 'me', 'old-ciphertext');
    const m = fakeMesh(); const r = await B.applyControl(msg, opts({ mesh: m, storage: disk }));
    assert(r.ok && !Object.keys(disk._m).some(k => k.startsWith(LEG)) && !m.member.active.size && m.stopped, `${label} kill: in-memory list cleared, disconnected, legacy list file purged`);
    await B.applyControl(K.sign(K.makeMsg({ type: 'clear', scope: label === 'targeted' ? 'user:' + ME : 'all', ttlMs: 3600e3 }), k.privateKey), opts());
  }
  const m2 = fakeMesh(); await B.applyControl(K.sign(K.makeMsg({}), K.keygen().privateKey), opts({ mesh: m2 })); assert(m2.member.active.size && !m2.stopped, 'forged kill does NOT clear the list'); reset();
}
