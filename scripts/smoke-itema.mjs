// Item (a) quick wins: FTUE reset flag, login counter + account-loss cadence, terms re-accept per app version, Read to me,
// minor rules (no Dating/Roulette, features default ON, parent PIN can turn them off, no dating requests), voice never
// crosses age bands, inbox ordering (friends pinned; non-friends stable; boost bumps below friends), Friends tab rows.
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };
globalThis.localStorage = mem();
let fail = 0; const assert = (c, m) => { if (c) console.log('ok', m); else { console.log('FAIL', m); fail = 1; } };
const F = await import('../src/ftue.js');
// login counter + cadence
const ls = mem(); const shows = []; for (let i = 0; i < 31; i++) { const n = F.countLogin(ls); if (F.shouldWarnLoss(n)) shows.push(n); }
assert(JSON.stringify(shows) === '[1,11,21,31]', `account-loss warning on first use, then every ${F.LOSS_EVERY} logins (${shows})`);
ls.setItem('cybermates:p2p-consent', '1'); ls.setItem('cm.rl.notice', '1'); F.resetLocalFtue(ls); assert(!ls.getItem('cm.logins') && !ls.getItem('cybermates:p2p-consent') && !ls.getItem('cm.rl.notice'), 'FTUE reset clears device one-time flags (logins, P2P consent, roulette notice)');
assert(F.ftueResetActive('?ftue=reset') && !F.ftueResetActive('?x=1') === !F.FTUE_RESET_BUILD, '?ftue=reset activates the replay flag (build flag CM_FTUE_RESET too)');
const vault = p => ({ p, read: async () => p, use: async fn => fn(p) }); const v1 = vault({ age_gate: { adult: true }, terms: { version: 'x' } }); await F.clearVaultFtue(v1); assert(!v1.p.age_gate && !v1.p.terms, 'FTUE reset clears the birthday gate + terms acceptance (vault)');
// terms per version
const T = await import('../src/terms.js'); const v2 = vault({}); assert(await T.needsTerms(v2), 'fresh install: terms shown'); await T.acceptTerms(v2); assert(!(await T.needsTerms(v2)) && v2.p.terms.version.endsWith('@' + F.APP_BUILD), 'accepted for this app build');
v2.p.terms.version = T.TERMS_VERSION + '@older-build'; assert(await T.needsTerms(v2), 'new app version -> terms shown again before JACK IN');
// read aloud
const spoken = []; let paused = 0, resumed = 0, cancelled = 0; const synth = { speak: u => { spoken.push(u.text); setTimeout(() => u.onend?.(), 0); }, pause: () => paused++, resume: () => resumed++, cancel: () => cancelled++ };
function U(t) { this.text = t; } const rd = F.readAloud('First sentence. Second one! Third?', { synth, U }); await new Promise(r => setTimeout(r, 20));
assert(spoken.length === 3 && spoken[0] === 'First sentence.', `Read to me speaks the full text (${spoken.length} chunks)`); rd.pause(); rd.resume(); rd.stop(); assert(paused === 1 && resumed === 1 && cancelled >= 2 && !rd.speaking, 'pause / resume / stop work');
assert(F.readAloud('x', { synth: null, U: null }) === null, 'unsupported browser -> graceful null');
const ts = (await import('node:fs')).readFileSync('src/terms.js', 'utf8'); assert(/tm-card"><div class="row gap tm-read"><button id="tm-read"/.test(ts), "'Read to me' is the very first control on the acknowledgement screen");
const fu = (await import('node:fs')).readFileSync('src/ftue.js', 'utf8'); assert(!/tm-read|Read to me<\//.test(fu.slice(fu.indexOf('accountLossWarning'), fu.indexOf('// "Read to me"'))), 'account-loss warning has NO Read to me button');
// minors
const D = await import('../src/discovery.js'), R = await import('../src/roulette.js'), PX = await import('../src/arcade/proximity.js'), P = await import('../src/parental.js');
const kid = { age: 15, minor: true }, kid2 = { age: 16 }, adult = { age: 30 }, adult2 = { age: 44 };
assert(!D.visibleModes(kid).includes('dating') && D.visibleModes(adult).includes('dating') && !D.canQuery(kid, 'dating'), 'under-18: Dating tab + discovery removed');
assert(!R.visibleFor(kid) && !R.visibleFor(kid2) && R.visibleFor(adult), 'Roulette is 18+ only (hidden for minors)');
const opt = { enabled: true, peerEnabled: true }; const pairs = [[kid, adult], [adult, kid], [kid2, adult2], [adult2, kid2]];
assert(pairs.every(([a, b]) => !PX.canHear({ ...a, code: 'a' }, { ...b, code: 'b' }, opt)) && PX.canHear({ ...kid, code: 'a' }, { ...kid2, code: 'b' }, opt) && PX.canHear({ ...adult, code: 'a' }, { ...adult2, code: 'b' }, opt), 'voice: minor<->minor and adult<->adult only, never across bands');
const store = { v: null, read: async () => store.v, write: async x => { store.v = x; } }; const pc = new P.ParentControls({ store, iters: 1000 });
assert((await Promise.all(Object.keys(P.TOGGLES).map(k => pc.allowed(k)))).every(Boolean), 'minors: every feature (chat, photos, calls, proximity voice, …) DEFAULT ON');
await pc.setPin('1234'); await pc.set('photos', false); assert(!(await pc.allowed('photos')) && (await pc.allowed('proximityVoice')), 'parent PIN turns a specific feature off (others stay on)');
store.v = { ...store.v, toggles: { ...store.v.toggles, proximityVoice: false } }; assert(await pc.allowed('proximityVoice'), 'old-build default-off proximity voice now defaults ON unless a parent turned it off');
const { MeshNode } = await import('../src/mesh.js'); const nk = new MeshNode({ code: 'KID0000001', net: { send() {} }, isOnline: () => true }); nk.minor = true;
assert((await nk.requestFriend('ADULT00001', { mode: 'dating' })).reason === 'minor-no-dating', 'minor cannot send a dating request');
nk.on_freq('ADULT00002', { pub: 'x', mode: 'dating' }, {}); assert(!nk.pendingIn.has('ADULT00002'), 'minor never receives a dating request');
// inbox ordering
const { makeOrder } = await import('../src/inbox-order.js'); const o = makeOrder(mem()); const row = (code, friend, at, boostId = null) => ({ code, friend, at, boostId });
let r = o.apply([row('F1', true, 10), row('N1', false, 50), row('F2', true, 30), row('N2', false, 60)]); assert(r.map(x => x.code).join() === 'F2,F1,N1,N2', 'friends pinned on top by recency; non-friends after, in first-seen order');
r = o.apply([row('F1', true, 90), row('N1', false, 50), row('F2', true, 30), row('N2', false, 99)]); assert(r.map(x => x.code).join() === 'F1,F2,N1,N2', 'a new non-boosted message does NOT reorder non-friends (friends re-sort by recency)');
r = o.apply([row('F1', true, 90), row('N1', false, 50), row('F2', true, 30), row('N2', false, 99, 'b1')]); assert(r.map(x => x.code).join() === 'F1,F2,N2,N1', 'a boosted message moves the conversation to the top of the non-friend section, just below friends');
r = o.apply([row('F1', true, 90), row('N1', false, 120), row('F2', true, 30), row('N2', false, 99, 'b1')]); assert(r.map(x => x.code).join() === 'F1,F2,N2,N1', 'same boost is not re-applied; positions stay stable');
// friends tab rows
const IUsrc = (await import('node:fs')).readFileSync('src/inbox-ui.js', 'utf8'); assert(/st.tab = 'inbox'; st.meshChat = c/.test(IUsrc) && /data-finvite/.test(IUsrc) && /pendingOut/.test(IUsrc), 'Friends tab: tap opens Messages with that chat; message + invite actions; incoming/outgoing requests');
console.log(fail ? 'ITEM-A SMOKE FAILED' : 'ALL ITEM-A SMOKE OK'); process.exit(fail);
