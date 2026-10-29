// Smoke for wallet follow-up (twins, guarded spend, atomic CAS/locks, view-only UI, voice). Imported by smoke.mjs.
import * as V from '../src/vault.js';
import * as W from '../src/wallet.js';
import * as M from '../src/mesh.js';
import { startVoiceSession } from '../src/voice-session.js';
import { db } from '../src/store.js';
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const memLS = () => { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k, v) => m[k] = String(v), removeItem: k => delete m[k], m }; };
const secrets = new V.MemorySecretStore(), ls = memLS();
// two "tabs" of the same profile on the same device: same install secret + device info, same storage, separate objects
const tab = (opts = {}) => new W.SecureWallet({ vault: new V.Vault({ store: secrets, info: 'same-device' }), store: W.casStore(ls), locks: null, ...opts });
const A = tab(), B = tab();
// 1. twins
{ const ha = await W.twinHash(A.vault), hb = await W.twinHash(B.vault), hc = await W.twinHash(new V.Vault({ store: new V.MemorySecretStore(), info: 'same-device' }));
  assert(ha === hb && ha !== hc && ha.length === 22, 'twin hash: same device+profile equal, other device (after transfer) differs');
  const ch = new BroadcastChannel('t-twins'), ch2 = new BroadcastChannel('t-twins');
  const ta = await new W.Twins({ vault: A.vault, channel: ch }).start(), tb = await new W.Twins({ vault: B.vault, channel: ch2 }).start();
  const tc = await new W.Twins({ vault: new V.Vault({ store: new V.MemorySecretStore(), info: 'x' }), channel: new BroadcastChannel('t-twins') }).start();
  await new Promise(r => setTimeout(r, 30)); assert(ta.peers.has(tb.instanceId) && tb.peers.has(ta.instanceId) && !ta.peers.has(tc.instanceId), 'twins recognize each other over BroadcastChannel; non-twin ignored');
  let got = null; tb.onCount = d => got = d; A.twins = ta; await A.credit('u1', w => { w.boosts = 3; }); await new Promise(r => setTimeout(r, 30));
  assert(got?.disp.boosts === 3, 'spender broadcasts encrypted count; twin decrypts & updates');
  const raw = JSON.stringify(ls.m); assert(!/"boosts"|startersUsed/.test(raw), 'stored wallet blob is encrypted (no counters)');
  ch.close(); ch2.close(); tc.ch.close(); A.twins = null;
  const n1 = new M.MeshNode({ code: 'SAMEUSER01', twin: ha, wallet: {} }), n2 = new M.MeshNode({ code: 'SAMEUSER01', twin: ha, wallet: {} }), n3 = new M.MeshNode({ code: 'SAMEUSER01', twin: hc, wallet: {} });
  n1.net = { send() {} }; n2.net = { send: e => n1.receive(e) }; n2.ping();
  n1.receive({ id: 'x3', from: 'SAMEUSER01', to: '*', ttl: 1, type: 'ping', body: { twin: hc, instance: n3.instance } });
  assert(n1.twinInstances.has(n2.instance) && !n1.twinInstances.has(n3.instance), 'twin hash in mesh presence; different device not a twin'); }
// 2. guarded spend
await A.credit('u1', w => { w.boosts = 2; w.startersUsed = 5; w.extraStarters = 1; });
let r = await A.spend('u1', { boost: true, starter: true }); assert(r.ok && (await A.view('u1')).boosts === 1 && (await A.view('u1')).extraStarters === 0, 'spend boost+starter: read, check, deduct, re-encrypt, verify');
r = await A.spend('u1', { boost: true, starter: true }); assert(!r.ok && r.reason === 'no-starters' && (await A.view('u1')).boosts === 1, 'insufficient starter => nothing deducted');
{ const evil = tab({ faults: { afterCommit: async st => { const t = tab(); const o = await t._read(); o.wallets.u1.boosts = 99; st.commit(st.ver(), await t._seal(o)); } } });
  r = await evil.spend('u1', { boost: true }); assert(r.reason === 'verify-failed' && (await A.view('u1')).boosts === 1, 'post-write re-read mismatch => rolled back, send aborted'); }
// 3. atomic: no locks (CAS) and with a lock manager
for (const locks of [null, (() => { let q = Promise.resolve(); return { request: (n, o, fn) => (q = q.then(fn, fn)) }; })()]) {
  const tag = locks ? 'Web Locks' : 'CAS fallback'; const a = tab({ locks }), b = tab({ locks });
  await a.credit('c', w => { w.boosts = 1; }); let rs = await Promise.all([a.spend('c', { boost: true }), b.spend('c', { boost: true })]);
  assert(rs.filter(x => x.ok).length === 1 && (await a.view('c')).boosts === 0, `${tag}: balance 1, 2 concurrent => exactly one succeeds`);
  await a.credit('c', w => { w.boosts = 5; }); rs = await Promise.all([a.spend('c', { boost: true }), b.spend('c', { boost: true })]);
  assert(rs.every(x => x.ok) && (await b.view('c')).boosts === 3, `${tag}: balance 5, 2 concurrent => 3`); }
// 4. view-only UI + LocalAdapter migration + chat path
{ const v = await A.view('u1'); assert(Object.isFrozen(v) && !('purchases' in v) && v.boosts === 1, 'UI gets frozen sanitized display value');
  let seen = []; const un = A.subscribe('u1', d => seen.push(d.boosts)); await A.credit('u1', w => { w.boosts = 4; }); await new Promise(r => setTimeout(r, 10)); un(); assert(seen.includes(4), 'UI subscription updates after spend'); }
{ await db.reset(); const s = JSON.parse(localStorage.getItem('cybermates:v2')); s.wallet = { 'seed-3': { day: new Date().toISOString().slice(0, 10), startersUsed: 0, extraStarters: 7, boosts: 2, plus: false, purchases: [] } }; localStorage.setItem('cybermates:v2', JSON.stringify(s)); db.migrated = false;
  const v = await db.getWalletView('seed-3'); assert(v.boosts === 2 && v.extraStarters === 7 && !JSON.parse(localStorage.getItem('cybermates:v2')).wallet, 'legacy plaintext wallet migrated into vault and removed');
  r = await db.sendMessage('seed-3', 'seed-4', 'hi', { boost: true }); assert(r.ok && (await db.getWalletView('seed-3')).boosts === 1, 'chat send path spends boost via guarded wallet');
  for (let i = 0; i < 4; i++) await db.sendMessage('seed-3', 'seed-' + (10 + i), 'hi'); await db.sendMessage('seed-3', 'seed-20', 'hi');
  assert((await db.getWalletView('seed-3')).extraStarters === 6, 'starters spent via guarded wallet (daily then bought)'); }
// 6. voice
{ await db.mockPurchase('seed-5', 'voice30'); const w = db._w(); assert((await w.view('seed-5')).voiceMinutesLeft === 30, 'Grok voice setup: 30 min credited');
  let t = 0, timer; const s = await startVoiceSession({ wallet: w, uid: 'seed-5', now: () => t, setT: (f, ms) => { timer = { f, ms }; return 1; }, clearT: () => {}, fetchToken: async () => ({ token: 'eph' }) });
  assert(s.ok && timer.ms === 30 * 60e3, 'session timer armed at 30-min cap'); t = 31 * 60e3; await timer.f(); 
  assert((await w.view('seed-5')).voiceMinutesLeft === 0 && !(await startVoiceSession({ wallet: w, uid: 'seed-5', fetchToken: async () => ({}) })).ok, 'hard stop at 30 min; no more credit');
  await db.mockPurchase('seed-6', 'voice30'); const n = await startVoiceSession({ wallet: w, uid: 'seed-6', fetchToken: async () => ({ error: 'not-configured' }) }); assert(!n.ok && /free browser voice/.test(n.message) && (await w.view('seed-6')).voiceMinutesLeft === 30, 'no XAI key => falls back to free voice, credit untouched');
  const h = (await import('../api/_fn/voice-session.js')).default; let code; delete process.env.XAI_API_KEY; await h({ method: 'POST', body: {} }, { status: c => (code = c, { json() {} , end() {} }) }); assert(code === 501, 'api/voice-session 501 without XAI_API_KEY'); }
// Terms acknowledgement
{ const T = await import('../src/terms.js'); const v = new V.Vault({ store: new V.MemorySecretStore(), info: 't' }); await v.init({ name: 'x' });
  assert(await T.needsTerms(v), 'first launch requires terms'); await T.acceptTerms(v, 123); const p = await v.read();
  assert(!(await T.needsTerms(v)) && p.terms.at === 123 && !JSON.stringify(v.blob).includes(T.TERMS_VERSION), 'acceptance (version+time) stored encrypted in vault');
  await v.use(q => { q.terms.version = 'old'; }); assert(await T.needsTerms(v), 're-prompt when terms version changes');
  assert(T.TERMS.some(t => /hardware/.test(t)) && T.TERMS.includes(T.DEVICE_BOUND_NOTICE), 'fine print: hardware change + device-bound balances');
  const s = T.stripDeviceBound({ name: 'n', friends: { a: 1 }, wallet: { boosts: 9, extraStarters: 4 }, receipts: [{ sku: 'plus1m' }, { sku: 'boost5' }] });
  assert(s.name === 'n' && s.friends.a === 1 && s.wallet.boosts === 0 && s.receipts.length === 1, 'strip keeps profile/friends/subscription, zeroes boosts/starters'); }
// Receipt redemption (local-first wallet credited only by server-signed receipts, once per device)
{ const { issueReceipt, keyFromSeed } = await import('../api/_lib/receipt.js'); const seed = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'), pub = Buffer.from(keyFromSeed(seed).publicKey).toString('base64');
  const w = tab(); await w.credit('rx', x => { x.boosts = 0; });
  const rc = issueReceipt({ user_code: 'ALICE00001', sku: 'boost5', status: 'paid', boosts: 5 }, seed);
  let r = await w.redeem('rx', rc, { userCode: 'ALICE00001', pub }); assert(r.ok && (await w.view('rx')).boosts === 5, 'signed receipt redeemed into encrypted wallet');
  r = await w.redeem('rx', rc, { userCode: 'ALICE00001', pub }); assert(r.reason === 'already-redeemed' && (await w.view('rx')).boosts === 5, 'receipt id redeemable once per device');
  r = await w.redeem('rx', { ...rc, boosts: 50, receipt_id: 'x' }, { userCode: 'ALICE00001', pub }); assert(r.reason === 'bad-receipt', 'tampered receipt rejected');
  r = await w.redeem('rx', issueReceipt({ user_code: 'EVE0000001', sku: 'boost5', status: 'paid', boosts: 5 }, seed), { userCode: 'ALICE00001', pub }); assert(r.reason === 'bad-receipt', "someone else's receipt rejected");
  const vr = issueReceipt({ user_code: 'ALICE00001', sku: 'voice30', status: 'paid', voice_cap_ms: 30 * 60e3, voice_used_ms: 0 }, seed);
  await w.redeem('rx', vr, { userCode: 'ALICE00001', pub }); assert((await w.view('rx')).voiceMinutesLeft === 30, 'voice30 receipt grants 30 min');
  const { BACKEND, db: d2 } = await import('../src/store.js'); assert(d2.constructor.name === 'LocalAdapter', 'profiles/messages always local (no central data store)'); void BACKEND; }
{ const { db: d, CHAT_TTL_MS } = await import('../src/store.js'); const s = JSON.parse(localStorage.getItem('cybermates:v2')); s.messages.push({ id: 'old', from: 'seed-1', to: 'seed-2', text: 'old', at: Date.now() - CHAT_TTL_MS - 1 }); localStorage.setItem('cybermates:v2', JSON.stringify(s));
  assert(!(await d.listMessages('seed-1')).some(m => m.id === 'old') && !localStorage.getItem('cybermates:v2').includes('"id":"old"'), 'no long-term threads: messages older than 48h purged'); }
