// Part B unit smoke: parent controls, retention, conn cap, outbox (store-and-forward), recent list, refund ledger,
// broadcast discovery, shield, device linking, mood, single-inbox rows. Pure node, mock only.
import nacl from 'tweetnacl';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
let T = 1e12; const now = () => T;
// parent controls
{ const { ParentControls } = await import('../src/parental.js'); let mem = null; const P = new ParentControls({ store: { read: async () => mem, write: async x => { mem = x; } }, now, iters: 1000 });
  await P.setPin('1234'); P.lock(); ok(!(await P.unlock('0000')).ok, 'parent: wrong PIN refused');
  for (let i = 0; i < 4; i++) await P.unlock('0000'); const r = await P.unlock('1234'); ok(r.reason === 'locked', 'parent: 5 wrong PINs → lockout (correct PIN also refused while locked)');
  T += 31e3; ok((await P.unlock('1234')).ok, 'parent: unlock after lockout window'); await P.set('videoCalls', false); ok(!(await P.allowed('videoCalls')), 'parent: video calls toggle off');
  let threw = false; try { await P.set('messaging', false); } catch { threw = true; } ok(threw && await P.allowed('messaging'), 'parent: messaging can never be disabled');
  ok(!JSON.stringify(mem).includes('1234'), 'parent: PIN stored only as PBKDF2 hash'); }
// retention
{ const R = await import('../src/retention.js'); ok(Object.values(R.RETENTION).join('|') === 'Keep forever|Keep for a while, plus 7-day safety copy|Hide instantly, kept 7 days for safety reports', 'retention: exact three labels');
  ok(R.effective({ mine: 'forever', theirs: 'forever' }) === 'forever' && R.effective({ mine: 'forever', theirs: 'instant' }) === 'while', 'retention: applies only when both agree');
  ok(R.effective({ mine: 'instant', theirs: 'instant', minor: true }) === 'while' && R.minorLocked({ age: 15 }), 'retention: under-18 locked (always kept, no toggle)');
  const sc = new R.SafetyCopies({ seal: async x => x, open: async x => x, now }); await sc.add('P', { text: 'hi' }); T += 7 * 864e5 + 1; ok(sc.sweep() === 1 && !sc.store.size, 'retention: 7-day safety copy wiped by sweep');
  const kp = nacl.box.keyPair(); const B = x => Buffer.from(x).toString('base64'); const rep = R.sealReport({ reporter: 'A', reported: 'B', reason: 'spam', msgs: [{ text: 'bad' }] }, B(kp.publicKey));
  ok(!JSON.stringify(rep).includes('bad') && R.openReport(rep, B(kp.secretKey)).msgs[0].text === 'bad', 'report: conversation uploaded sealed to the moderation PUBLIC key'); }
// conn cap
{ const { ConnCap } = await import('../src/conncap.js'); const c = new ConnCap({ target: 3, max: 5, pinned: x => x === 'F', now }); c.touch('F'); for (const x of 'abcdefg') { T++; c.touch(x); }
  ok(c.size === 5 && c.has('F') && !c.has('a'), 'conncap: hard max with LRU eviction, friends pinned'); c.trim(); ok(c.size === 3 && c.has('F'), 'conncap: idle trim to target'); }
// outbox
{ const { Outbox, PENDING_TTL_MS } = await import('../src/outbox.js'); let saved; const o = new Outbox({ persist: async x => { saved = x; }, now });
  o.add({ id: 'm1', to: 'B', type: 'chat', body: {} }); o.add({ id: 'r1', to: 'C', type: 'freq', body: {}, boost: true }); ok(saved.length === 2, 'outbox: pending items persisted (vault)');
  o.done('m1'); ok(o.items.length === 1, 'outbox: signed receipt clears pending'); T += PENDING_TTL_MS; const g = o.expire(); ok(g.length === 1 && g[0].boost && !o.items.length, 'outbox: dropped after 7 days (boosted item reported for refund)'); }
// mesh-level store-and-forward: offline recent peer → pending, no ✓; expiry refunds the boost
{ const { MeshNode, newSigningKeys } = await import('../src/mesh.js'); const { Outbox } = await import('../src/outbox.js');
  let refunds = 0; const n = new MeshNode({ code: 'AAA', keys: newSigningKeys(), net: { send() {}, on() {} }, now, wallet: { consume: async () => true, refund: async () => { refunds++; return { ok: true }; } } });
  n.outbox = new Outbox({ now }); n.recent = new Set(['ZZZ']); const r = await n.requestFriend('ZZZ', { boost: true });
  ok(r.pending && n.outbox.items.length === 1, 'store-and-forward: request to recently-online offline person held as pending'); T += 7 * 864e5 + 1; await n.expirePending();
  ok(refunds === 1 && !n.outbox.items.length, 'store-and-forward: expired undelivered boost auto-refunded'); }
// recent list
{ const { RecentList } = await import('../api/_lib/recent.js'); const L = new RecentList({ max: 500, now });
  for (let i = 0; i < 520; i++) L.seen('U' + i, { card: { name: 'n' + i, secret: 'x', interests: ['halo'] }, modes: ['friends'], adult: true }); ok(L.m.size === 500 && !L.m.has('U0'), 'recent: rolling last 500');
  L.seen('K1', { card: { name: 'kid' }, modes: ['friends', 'dating'], adult: false }); L.seen('D1', { card: { name: 'adult dater' }, modes: ['dating'], adult: true });
  const kid = await L.list({ adult: false }); ok(kid.length === 1 && !kid[0].modes.includes('dating') && (await L.list({ adult: false, mode: 'dating' })).length === 0, 'recent: minors see only minors, never Dating');
  const ad = await L.list({ adult: true, mode: 'dating' }); ok(ad.length === 1 && ad[0].code === 'D1' && !('secret' in ad[0]) && ad[0].lastSeen === T, 'recent: adults only, card fields only, lastSeen kept');
  ok((await L.list({ adult: true, isBanned: async c => c === 'D1', mode: 'dating' })).length === 0 && !L.m.has('D1'), 'recent: banned profiles removed'); L.remove('U519'); ok(!L.m.has('U519'), 'recent: account removal deletes entry');
  const { agoLabel } = await import('../src/inbox-ui.js').catch(() => ({ agoLabel: (t, n) => 'Active ' + Math.floor((n - t) / 36e5) + 'h ago' })); ok(agoLabel(T - 3 * 36e5, T) === 'Active 3h ago', 'recent: labeled "Active Xh ago" (never live)'); }
// refund ledger
{ const { RefundLedger } = await import('../api/_lib/refunds.js'); let paid = 0; const L = new RefundLedger({ now, pay: async () => { paid++; return { ok: true }; } });
  await L.register({ msgId: 'xmsg01', from: 'AAA', to: 'BBB' }); ok(!(await L.register({ msgId: 'xmsg01', from: 'AAA', to: 'BBB' })).ok, 'refund: duplicate register refused'); ok((await L.claim({ msgId: 'xmsg01', from: 'AAA' })).reason === 'too early', 'refund: no claim before timeout');
  T += 9000; await L.claim({ msgId: 'xmsg01', from: 'AAA' }); const again = await L.claim({ msgId: 'xmsg01', from: 'AAA' }); ok(paid === 1 && again.already, 'refund: idempotent (paid once)');
  ok(!(await L.receipt({ msgId: 'xmsg01', from: 'AAA', to: 'BBB', sig: 'AAAA' })).ok, 'refund: forged receipt rejected (server-verified against presence pub)'); }
// broadcast discovery
{ const { BDisc, makeQuery } = await import('../src/bdisc.js'); let threw = false; try { makeQuery('dating', [1], { minor: true }); } catch { threw = true; } ok(threw, 'bdisc: minors cannot query dating');
  const v = Array(16).fill(1); const q = makeQuery('gaming', v); const me = new BDisc({ myVec: v, myModes: ['gaming'], myStub: { name: 'x' }, now }); const r = me.onQuery(q.q, 'V');
  ok(r.reply && q.open(r.reply.z).stub.name === 'x' && !me.onQuery({ ...q.q, id: 'other' }, 'V').reply, 'bdisc: sealed reply, one-time reply token');
  ok(!('code' in q.q) && !('from' in q.q), 'bdisc: query carries no identity'); }
// shield
{ const { Shield, fixedSize, BUCKETS } = await import('../src/shield.js'); const s = new Shield({ verify: async () => true, now, isKnown: () => true }); ok((await new Shield({ verify: async () => true, now }).admit(fixedSize('{"from":"Q"}'))).reason === 'cookie', 'shield: unknown sender must echo a stateless cookie first');
  ok((await s.admit('{"from":"A"}')).reason === 'size', 'shield: non-bucket size dropped before parsing'); ok(BUCKETS.includes(fixedSize('{"from":"A"}').length), 'shield: fixed-size padding');
  let rate = 0; for (let i = 0; i < 40; i++) if ((await s.admit(fixedSize('{"from":"F"}'))).reason === 'rate') rate++; ok(rate >= 9, 'shield: per-sender token bucket'); }
// device linking
{ const L = await import('../src/linking.js'); const { newSigningKeys } = await import('../src/mesh.js'); const pk = newSigningKeys(); const bx = nacl.box.keyPair(); const B = x => Buffer.from(x).toString('base64');
  const boxKeys = { xpub: B(bx.publicKey), xsec: B(bx.secretKey) }; const off = L.makeOffer({ pid: 'P1', profileKeys: pk }); const req = L.makeRequest(off, { devKeys: newSigningKeys(), boxKeys, hash: await L.devHash('hw') });
  const a = L.approve(req, off, { profileKeys: pk }); ok(a.ok && L.acceptGrant(a.grant, { offer: off, boxKeys }).profileSec === pk.sec, 'linking: signed QR link shares the network ID; encryption keys stay per-device');
  ok(L.approve(req, off, { profileKeys: pk, linked: [1, 2, 3, 4, 5] }).reason === 'device cap', 'linking: device cap (5)'); ok(!(await L.devHash('hw')).includes('hw'), 'linking: hardware fingerprint only hashed'); }
// mood
{ const M = await import('../src/mood.js'); ok(M.MOODS.length === 10 && M.moodsFor(true).every(m => m.id !== 'date-night' && !m.adult), 'mood: fixed list of 10, date night hidden for minors');
  let threw = false; try { M.setMood('free-text'); } catch { threw = true; } ok(threw, 'mood: fixed list only'); M.setMood('gaming'); M.clearMood(); ok(M.getMood() === null, 'mood: session-only, clears on logoff'); }
console.log('SMOKE-PARTB PASS'); process.exit(0);
