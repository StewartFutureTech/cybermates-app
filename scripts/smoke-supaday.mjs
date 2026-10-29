// Supabase-day readiness with FAKES only (no accounts): transport adapter, signal adapter, guards, geo, snapshot cap,
// kill pubkey env, attestation config, Stripe US-only, grok-profile edge function core, bundle secret scan.
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
import fs from 'node:fs';
delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY; process.env.CM_SIGNAL = 'mock';
const NET = await import('../src/net.js');
// 1) transport
assert((await NET.createBus({})).kind.startsWith('local'), 'no env -> mock/local bus (default)');
assert((await NET.createBus({ VITE_SUPABASE_URL: 'u', VITE_SUPABASE_ANON_KEY: 'k', VITE_CM_TRANSPORT: 'mock' })).kind.startsWith('local'), 'VITE_CM_TRANSPORT=mock overrides env');
const sent = []; let chOpts; const fake = { channel(n, o) { chOpts = { n, o }; const ch = { on() { return ch; }, subscribe(cb) { cb('SUBSCRIBED'); return ch; }, send(x) { sent.push(x); return Promise.resolve('ok'); } }; return ch; } };
let t = 0; const sb = new NET.SupabaseBus(fake, new NET.Throttle({ rate: 1, burst: 3, now: () => t }));
const E2E = await import('../src/e2e.js');
let threw = false; try { await sb.post({ k: 'mesh', env: { to: 'X', type: 'chat', text: 'hi plain' } }); } catch { threw = true; }
assert(threw && sent.length === 0, 'Supabase bus refuses plaintext directed chat');
const sealed = { k: 'mesh', env: { v: 1, type: 'e2e', to: 'X', ct: 'abc', iv: 'x', from: 'Y', sig: 's' } };
let ok = 0; for (let i = 0; i < 10; i++) { try { if (await sb.post(sealed) !== false) ok++; } catch (e) { console.log(e.message); break; } }
assert(chOpts?.o?.config?.private === true, 'mesh channel joined as PRIVATE (Realtime Authorization)');
assert(sent.length > 0 && sent.length <= 3 && sb.throttle.dropped >= 7, `client throttle: burst ${sent.length} sent, ${sb.throttle.dropped} dropped`);
t += 2000; await sb.post(sealed); assert(sent.length >= 2, 'throttle refills over time');
// 2) Supabase signal adapter against fake REST
const SIG = await import('../api/_lib/signal.js'); const calls = [];
const ff = async (u, o = {}) => { calls.push({ u, m: o.method || 'GET', b: o.body }); const J = x => ({ ok: true, json: async () => x });
  if (u.includes('geo_seen?code')) return J([{ last_us_at: new Date(5e12).toISOString() }]);
  if (u.includes('blocklist?code')) return J([{ code: 'Z', level: 2, strikes: 2, reason: 'spam' }]);
  if (u.includes('blocklist?select')) return J([]); if (u.includes('kill_switch')) return J([]); return J({}); };
const ss = new SIG.SupabaseSignal({ url: 'https://p.supabase.co', srk: 'srk', pub: null }, ff);
await ss.broadcast({ k: 'ctl' }); assert(calls[0].u.endsWith('/realtime/v1/api/broadcast') && calls[0].m === 'POST', 'signal.broadcast -> Realtime broadcast REST');
assert(await ss.lastUs('Z') === 5e12, 'signal.lastUs reads geo_seen'); await ss.markUs('Z', 1); assert(calls.at(-1).u.includes('geo_seen?on_conflict=code'), 'signal.markUs upserts geo_seen');
assert((await ss.standing('Z')).level === 2, 'signal.standing reads tiered blocklist'); assert(await ss.halted() === null, 'no pubkey -> halted() null (no crash)');
// 3) guard middleware
const GU = await import('../api/_lib/guard.js'); const mk = () => { const o = { s: 200, b: null, status(c) { o.s = c; return o; }, json(b) { o.b = b; return o; }, end() { return o; } }; return o; };
const h = GU.withGuards(async (q, r) => r.json({ ok: 1 }), { name: 't1', perMin: 3, perIdPerMin: 2, maxBody: 100, geo: true });
const R = async (hd = {}, body) => { const o = mk(); await h({ headers: { 'x-forwarded-for': '1.1.1.1', ...hd }, query: {}, body }, o); return o.s; };
assert(await R({}, { code: 'A' }) === 200 && await R({}, { code: 'A' }) === 200 && await R({}, { code: 'A' }) === 429, 'per-ID limit');
assert(await R({ 'x-forwarded-for': '2.2.2.2' }) === 200 && await R({ 'x-forwarded-for': '2.2.2.2' }) === 200 && await R({ 'x-forwarded-for': '2.2.2.2' }) === 200 && await R({ 'x-forwarded-for': '2.2.2.2' }) === 429, 'per-IP limit');
assert(await R({ 'x-forwarded-for': '3.3.3.3', 'content-length': '5000' }) === 413, 'body cap 413');
assert(await R({ 'x-forwarded-for': '4.4.4.4', 'x-vercel-ip-country': 'FR' }) === 451 && await R({ 'x-forwarded-for': '5.5.5.5', 'x-vercel-ip-country': 'US' }) === 200, 'geo: FR 451, US ok');
const routes = [...fs.readdirSync('api').filter(f => f.endsWith('.js') && f !== '[fn].js'), ...fs.readdirSync('api/_fn').filter(f => f.endsWith('.js')).map(f => '_fn/' + f)]; assert(routes.every(f => /export default withGuards\(/.test(fs.readFileSync('api/' + f, 'utf8'))), `every api route (${routes.length}) wrapped by withGuards`);
{ const fns = fs.readdirSync('api').filter(f => f.endsWith('.js')); assert(fns.length <= 12, `vercel functions ${fns.length} <= 12 (Hobby)`); const rt = fs.readFileSync('api/[fn].js', 'utf8'); const imp = [...rt.matchAll(/from '\.\/_fn\/([a-z-]+)\.js'/g)].map(m => m[1] + '.js').sort(); assert(JSON.stringify(imp) === JSON.stringify(fs.readdirSync('api/_fn').filter(f => f.endsWith('.js')).sort()), 'router dispatches to every api/_fn handler'); }
// 4) geo decision + bootstrap
const GEO = await import('../api/_lib/geo.js'); const now = Date.now();
assert(GEO.geoDecision({ country: 'DE', lastUsAt: now - 3 * 864e5, now, env: {} }).grace && !GEO.geoDecision({ country: 'DE', lastUsAt: now - 30 * 864e5, now, env: {} }).allow, 'travel grace 14d default');
assert(GEO.geoDecision({ country: 'DE', lastUsAt: now - 3 * 864e5, now, env: { CM_TRAVEL_GRACE_DAYS: '0' } }).allow === false && GEO.geoDecision({ country: 'DE', env: { CM_US_ONLY: '0' } }).allow, 'CM_TRAVEL_GRACE_DAYS / CM_US_ONLY configurable');
const boot = await import('../api/_fn/bootstrap.js'); const sig = SIG.getSignal();
const call = (method, q, body, hd = {}) => new Promise(res => { const o = { s: 200, status(c) { o.s = c; return o; }, json(b) { res({ s: o.s, b }); }, end() { res({ s: o.s }); } }; boot.default({ method, query: q, body, headers: { 'x-forwarded-for': '9.9.9.' + Math.random(), ...hd } }, o, sig); });
assert(boot.MAX_BODY === 8 * 1024, 'entry POST cap 8 KB (snapshot upload removed in single-entry design)');
assert((await call('POST', {}, { op: 'login', code: 'BIGBODY0000001', row: { x: 'a'.repeat(20000) } }, { 'content-length': '20000' })).s === 413, '20 KB entry POST -> 413');
assert((await call('GET', { code: 'GEONEW00000001' }, null, { 'x-vercel-ip-country': 'CA' })).s === 451, 'new non-US ID blocked at bootstrap with notice');
assert((await call('GET', { code: 'GEOUS000000001' }, null, { 'x-vercel-ip-country': 'US' })).s === 200, 'US ID ok (last-US recorded)');
const tr = await call('GET', { code: 'GEOUS000000001', check: '1' }, null, { 'x-vercel-ip-country': 'MX' }); assert(tr.s === 200 && /traveling/.test(tr.b.geoWarning || ''), '24h check-in abroad within grace: warning, not block');
sig.setRecord('WARN0000000001', { level: 2, strikes: 2, reason: 'spam' }); const ci = await call('GET', { code: 'WARN0000000001', check: '1' }); assert(ci.s === 200 && ci.b.level === 2 && ci.b.warning, '24h check-in carries strike level + warning');
const CI = await import('../src/checkin.js'); const g = await CI.checkIn({ code: 'X', fetchStatus: async () => ({ status: 451, json: async () => ({ notice: 'US only' }) }) }); assert(g.geo && g.notice, 'client check-in maps 451 to a US-only notice');
// 5) kill pubkey env
const MOD = await import('../api/_lib/mod.js'); assert(MOD.env({ KILL_PUBKEY: 'P' }).pub === 'P' && !('priv' in MOD.env({})), 'server reads KILL_PUBKEY (public only)');
const srv = fs.readdirSync('api', { recursive: true }).filter(f => String(f).endsWith('.js')).map(f => fs.readFileSync('api/' + f, 'utf8')).join('\n');
assert(!/KILL_PRIVATE|KILL_SEED|kill.*fromSeed/i.test(srv), 'no private kill key server-side (receipt signing seed is separate, see audit)');
// 6) attestation config
const AT = await import('../api/_fn/attest.js'); const c0 = AT.attestConfig({}); assert(!c0.playReady && !c0.appleReady, 'attest: not configured without env');
const c1 = AT.attestConfig({ GOOGLE_CLOUD_PROJECT: 'p', PLAY_INTEGRITY_SA_JSON: JSON.stringify({ client_email: 'a@b', private_key: 'x' }), ANDROID_PACKAGE_NAME: 'app.cybermates', APPLE_TEAM_ID: 'T', IOS_BUNDLE_ID: 'app.cybermates' });
assert(c1.playReady && c1.appleReady && c1.appId === 'T.app.cybermates', 'attest: env vars read (GOOGLE_CLOUD_PROJECT, SA JSON, APPLE_TEAM_ID, IOS_BUNDLE_ID)');
// 7) Stripe US-only
const W = await import('../api/stripe-webhook.js'); const acts = [];
const ev = c => ({ type: 'checkout.session.completed', data: { object: { mode: 'payment', payment_intent: 'pi_1', customer_details: { address: { country: c } } } } });
const getC = cc => async () => ({ latest_charge: { payment_method_details: { card: { country: cc } } } }); const act = async (...a) => acts.push(a);
assert((await W.usCheck(ev('US'), getC('US'), act)).ok && acts.length === 0, 'Stripe: US card + US billing accepted');
assert(!(await W.usCheck(ev('US'), getC('GB'), act)).ok && acts[0][1] === 'refunds', 'Stripe: non-US card -> refund, no receipt');
assert(!(await W.usCheck(ev('FR'), getC('US'), act)).ok, 'Stripe: non-US billing -> refused');
const sub = { type: 'customer.subscription.created', data: { object: { id: 'sub_1', default_payment_method: 'pm_1' } } };
assert(!(await W.usCheck(sub, async () => ({ card: { country: 'CA' }, billing_details: { address: { country: 'CA' } } }), act)).ok && acts.at(-1)[0] === 'DELETE', 'Stripe: non-US subscription cancelled');
const ck = fs.readFileSync('api/_fn/checkout.js', 'utf8'); assert(/billing_address_collection: 'required'/.test(ck) && /payment_method_types\[0\]': 'card'/.test(ck), 'checkout: card only + billing address required');
// 8) grok-profile edge function core
const GK = await import('../supabase/functions/_shared/grok-core.js'); let xs = null;
const deps = { key: 'xai-test', getUser: async a => a === 'Bearer good' ? { id: 'u1' } : null, limit: GK.makeLimiter({ ...GK.CAPS, perUserPerHour: 2 }), xai: async b => { xs = b; return { choices: [{ message: { content: JSON.stringify({ bio: 'hi', tags: ['a'] }) } }] }; } };
const body = JSON.stringify({ mode: 'gaming', answers: { fav: 'rpg', religion: 'x' } });
assert((await GK.handle({ method: 'POST', auth: '', body }, deps)).status === 401 && (await GK.handle({ method: 'POST', auth: 'Bearer bad', body }, deps)).status === 401, 'grok-profile: auth required');
assert((await GK.handle({ method: 'POST', auth: 'Bearer good', body }, { ...deps, key: undefined })).status === 501, 'grok-profile: 501 without XAI_API_KEY');
const r1 = await GK.handle({ method: 'POST', auth: 'Bearer good', body }, deps); assert(r1.status === 200 && r1.json.bio === 'hi' && !xs.messages[1].content.includes('religion'), 'grok-profile: ok; sensitive answers stripped');
assert((await GK.handle({ method: 'POST', auth: 'Bearer good', body: 'x'.repeat(20000) }, { ...deps, limit: () => true })).status === 413, 'grok-profile: input size cap');
assert((await GK.handle({ method: 'POST', auth: 'Bearer good', body: JSON.stringify({ mode: 'dating', answers: {} }) }, { ...deps, limit: () => true })).status === 403, 'grok-profile: dating needs adult');
await GK.handle({ method: 'POST', auth: 'Bearer good', body }, deps); assert((await GK.handle({ method: 'POST', auth: 'Bearer good', body }, deps)).status === 429, 'grok-profile: per-user rate limit');
assert(!/api\.x\.ai|XAI_API_KEY/.test(fs.readFileSync('src/grok-profile.js', 'utf8')), 'client grok-profile.js calls the function, never xAI directly');
// 9) bundles
for (const d of ['dist', 'dist-admin']) { if (!fs.existsSync(d)) continue; const txt = fs.readdirSync(d, { recursive: true }).filter(f => /\.(js|html|json|map)$/.test(f)).map(f => fs.readFileSync(d + '/' + f, 'utf8')).join('\n');
  assert(!/sk_(test|live)_[A-Za-z0-9]{8}|whsec_[A-Za-z0-9]{8}|xai-[A-Za-z0-9]{20}|SUPABASE_SERVICE_ROLE|service_role"|KILL_PRIVATE|api\.x\.ai\/v1\/chat/.test(txt), d + ': no Stripe/xAI/service-role/kill-private secrets in bundle'); }
delete process.env.CM_SIGNAL; console.log('ALL OK smoke-supaday'); process.exit(0);
