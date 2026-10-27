// Admin kill button logic + /api/kill relay (no browser, fetch mocked).
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const K = ({ ...(await import('../src/killswitch.js')), ...(await import('./lib/sign.mjs')) }); const A = await import('../src/admin.js'); const { default: kill } = await import('../api/_fn/kill.js');
const k = K.keygen();
assert(!('signControl' in A) && !('standingOf' in A), 'admin panel has no signing / key-accepting code path');
await A.verifyBundle(JSON.stringify(K.sign(K.makeMsg({ reason: 'x' }), k.privateKey))).then(() => assert(false, 'wrong key accepted'), e => assert(/does not verify/.test(e.message), 'admin: pre-signed JSON from another key refused'));
await A.verifyBundle(k.privateKey).then(() => assert(false, 'raw key'), e => assert(/JSON/.test(e.message), 'admin: pasting a raw private key is refused (not JSON, never used)'));
await A.verifyBundle(JSON.stringify({ privateKey: k.privateKey })).then(() => assert(false, 'key obj'), e => assert(/key material/.test(e.message), 'admin: key-material JSON refused'));
await A.verifyBundle(JSON.stringify(K.makeMsg({}))).then(() => assert(false, 'unsigned'), e => assert(/Unsigned/.test(e.message), 'admin: unsigned message refused'));
{ const dk = (await import('./lib/sign.mjs')); /* DEV test key: generated per run, never stored */ }
const res = () => { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, end() { return r; } }; return r; };
Object.assign(process.env, { VITE_KILL_PUBKEY: k.publicKey, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk' });
const calls = []; globalThis.fetch = async (u, o) => { if (String(u).includes('/rest/v1/rpc/rl_hit')) return { ok: true, status: 200, json: async () => ({ allowed: true }) }; /* v40 global rate-limit layer (not part of the kill order) */ calls.push([u, JSON.parse(o.body)]); return { ok: true, status: 200, text: async () => '' }; };
const good = K.sign(K.makeMsg({ type: 'kill', scope: 'all', reason: 't' }), k.privateKey);
let r = await kill({ method: 'POST', headers: { 'x-forwarded-for': '1.1.1.1' }, body: { msg: good } }, res());
assert(r.code === 200 && calls.length === 3 && calls[0][0].includes('/rest/v1/kill_switch') && calls[1][1].messages[0].topic === 'control' && calls[2][1].messages[0].payload.k === 'ctl', '/api/kill: valid signed kill -> record first, then control broadcast + mesh gossip');
r = await kill({ method: 'POST', headers: { 'x-forwarded-for': '2.2.2.2' }, body: { msg: { ...good, reason: 'tampered' } } }, res());
assert(r.code === 403 && calls.length === 3, '/api/kill: tampered message rejected, nothing written');
const forged = K.sign(K.makeMsg({ type: 'kill', scope: 'all', reason: 'forged' }), K.keygen().privateKey);
r = await kill({ method: 'POST', headers: { 'x-forwarded-for': '2.2.2.2' }, body: { msg: forged } }, res()); assert(r.code === 403, '/api/kill: message signed by another key rejected (' + r.code + ' ' + r.body?.error + ')');
const old = K.sign(K.makeMsg({ now: Date.now() - 3600e3 }), k.privateKey);
r = await kill({ method: 'POST', headers: { 'x-forwarded-for': '3.3.3.3' }, body: { msg: old } }, res()); assert(r.code === 400, '/api/kill: stale (replayed) message rejected');
for (let i = 0; i < 6; i++) r = await kill({ method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: {} }, res()); assert(r.code === 429, '/api/kill: rate limited');
