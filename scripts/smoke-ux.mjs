// UX-WALKTHROUGH §1-14 smoke (pure node): storage adapter, login sequence, photos, matching v2, discover deck,
// failed-delivery notice + boost refund, reports bucket + mute, LFG / favorite games / events, real-voice talk limits,
// TURN slot empty, age-band rules. node scripts/smoke-ux.mjs
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const fs = await import('node:fs'); const src = f => fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
const store = new Map(); globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const KV = await import('../src/kv-store.js');
// ---- storage adapter
{ const a = KV.kv('t1'); await a.put({ id: 'x', v: 1 }); ok((await a.get('x')).v === 1 && (await a.list()).length === 1 && store.has('cybermates:kv:t1'), 'LocalKV put/get/list persisted to localStorage');
  const wire = []; const subs = []; const tA = { send: b => wire.push(['A', b]), sub: f => { subs.push(['A', f]); return () => {}; } }, tB = { send: b => wire.push(['B', b]), sub: f => { subs.push(['B', f]); return () => {}; } };
  const A = new KV.MeshKV('gos', { transport: tA, validate: (r, from) => r.owner === from }), B = new KV.MeshKV('gos2', { transport: tB, validate: (r, from) => r.owner === from }); B.ns = 'gos';
  await A.put({ id: 'p1', owner: 'A', t: 'hi' }); await A.put({ id: 'p2', owner: 'Z', t: 'spoof' }, { share: true });
  for (const [from, b] of wire) for (const [who, f] of subs) if (who !== from) f(from, b);
  ok((await B.get('p1'))?._from === 'A' && !(await B.get('p2')), 'MeshKV gossip: valid record kept, spoofed owner rejected');
  let threw = null; try { await new KV.SupabaseKV('reports').put({ id: 1 }); } catch (e) { threw = e.code; } ok(threw === 'supabase-not-configured', 'SupabaseKV slot: same interface, inert until configured (no keys bundled)');;
  const got = []; const be = { kind: 'supabase', client: { from: () => ({}) }, store: { report: async o => { got.push(o); return { id: 'srv1' }; }, listMyReports: async () => [{ id: 'srv1', reason: 'other' }] } };
  KV.useSupabaseBackend(be); const sk = KV.kv('reports', { backend: 'supabase' }); const put = await sk.put({ id: 'rp1', reporter: 'me', reported: 'XYZ', reason: 'other', excerpt: 'e' });
  ok(put.remoteId === 'srv1' && got[0].reason === 'other' && got[0].reported === null && got[0].evidence.reported_code === 'XYZ' && (await sk.list()).length === 1, 'Supabase adapter plugs into the kv slot: reports -> SupabaseStore.report()/listMyReports()');
  KV.useSupabaseBackend(null); KV._resetKv(); }
// ---- login sequence
const L = await import('../src/login-seq.js');
ok(L.LOGIN_STEPS.join('>') === 'age>ack>devicekey>profile' && L.ACK_MIN_MS === 30000, 'login order: age > acknowledgement > device key > profile; ack minimum 30 s');
{ let t = 0; const g = new L.AckGate({ minMs: 30000, now: () => t, noScroll: false }); g.checked = true;
  ok(!g.canAccept() && /Scroll/.test(g.reason()), 'ack: Accept locked until scrolled to the end');
  g.onScroll({ scrollTop: 900, clientHeight: 100, scrollHeight: 1000 }); t = 29000; ok(!g.canAccept() && /1s|2s/.test(g.reason()), 'ack: still locked before 30 s even after scrolling');
  t = 30000; ok(g.canAccept(), 'ack: unlocked after scroll + 30 s + tick'); g.checked = false; ok(!g.canAccept(), 'ack: checkbox required'); }
{ ok(L.ackMinFor('word '.repeat(20)) === 20000 && L.ackMinFor('word '.repeat(70)) === Math.round(70 / 2.7 * 1000) && L.ackMinFor('word '.repeat(5000)) === 30000, 'ack minimum sized to the read-aloud length, clamped 20-30 s');
  let t = 0; const g = new L.AckGate({ minMs: 25000, now: () => t }); ok(/Scroll/.test(g.reason()) && /25s/.test(g.reason()), 'ack: countdown visible even before scrolling');
  ok(g.steps().map(x => x.k).join() === 'scroll,timer,tick' && g.steps().every(x => !x.done), 'ack: three-step checklist (scroll, timer, tick)');
  t = 25000; g.scrolled = true; g.checked = true; ok(g.steps().every(x => x.done) && g.canAccept() && g.secs() === 0, 'ack: all steps done -> Accept'); }
ok(/new AckGate\(\{ minMs: ackMinMs\(fullText\) \}\)/.test(src('terms.js')) && /id="tm-cd"/.test(src('terms.js')) && /prefers-reduced-motion/.test(src('terms.js')), 'terms screen: timer sized to the full text, visible countdown, reduced motion respected');
ok(/<button id="tm-read"/.test(src('terms.js').split('tm-scroll')[0]), 'Read to me sits above the scrolling text (very top)');
ok(/missingProfile\(\{ \.\.\.p/.test(src('main.js')) && /st\.missNote/.test(src('main.js')), 'onboarding finish blocked until the profile is complete (jumps to the missing step)');
ok(/PH\.rotate\(p\)/.test(src('main.js')) && /UX\.presetsHTML\(\(st\.draft \|\| st\.me\)\?\.avatarPreset\)/.test(src('main.js')), 'starter characters in the photo step; rolling photos rotate each login');
ok(/new AckGate/.test(src('terms.js')) && /tm-scroll/.test(src('terms.js')) && /if \(!gate\.canAccept\(\)\) return/.test(src('terms.js')), 'terms screen enforces the gate (UI + click guard)');
{ const d = await L.deviceKey({ device: { platform: 'android', strong: true, fields: ['abc123', 'Pixel', '8'] } }), d2 = await L.deviceKey({ device: { platform: 'android', strong: true, fields: ['abc123', 'Pixel', '8'] } });
  const r = await L.deviceKey({ device: { platform: 'web', fields: ['', 0, ''] } });
  ok(d.key === d2.key && d.key.length === 16 && d.source === 'device', 'device key: stable hash of device fields');
  ok(r.source === 'random' && r.key.length === 16 && r.key !== d.key, 'device key: random fallback when device data is unavailable');
  let vault = {}; const V = { read: async () => vault, use: async f => f(vault) }; const k1 = await L.ensureDeviceKey(V, { device: { platform: 'x', strong: true, fields: ['q'] } }); const k2 = await L.ensureDeviceKey(V);
  ok(k1.key === k2.key && vault.deviceKey.key === k1.key, 'device key stored once in the vault'); }
ok(/needsTerms\(v\)\) await termsScreen\(v\); step\('device-key'\); await ensureDeviceKey/.test(src('main.js')), 'main: device key derived right after the acknowledgement');
ok(L.missingProfile({ name: 'A', age: 20, gender: 'Man', lookingFor: ['dating'], city: 'X', interests: ['a'], avatarHue: 1 }).includes('seekingGenders') && L.profileComplete({ name: 'K', age: 15, gender: 'Woman', lookingFor: ['friends'], city: 'X', interests: ['a'], avatarPreset: 'goth-girl' }), 'profile gate: dating fields only when dating on; preset counts as a picture');
ok(/!profileComplete\(st\.me\) && !\['profile', 'onboard', 'help'\]\.includes\(st\.tab\)\) st\.tab = 'profile'/.test(src('main.js')), 'main: forced profile setup until complete');
// ---- photos
const PH = await import('../src/photos.js');
{ ok(PH.PRESETS.length === 6 && PH.PRESETS.map(p => p.id).sort().join() === 'gamer-boy,gamer-girl,goth-boy,goth-girl,jock-boy,jock-girl' && PH.presetSVG('goth-girl').includes('radialGradient'), 'six glass starter characters (goth/jock/gamer x boy/girl)');
  const p = { id: 'me', photos: [] }; for (let i = 0; i < 4; i++) ok((await PH.addPhoto(p, 'img' + i)).placed === 'profile', `photo ${i + 1} on profile`);
  const r5 = await PH.addPhoto(p, 'img4'), r6 = await PH.addPhoto(p, 'img5'); ok(r5.placed === 'local-extra' && r5.notice === PH.ROLLING_NOTICE && p.photos.length === 4, 'photo 5+: stored on this phone only, user told about rolling');
  ok(PH.packetPhotos(p).length === 4 && !JSON.stringify(PH.packetPhotos(p)).includes('img4'), 'packet carries at most 4 photos, no extras');
  const w1 = [...await PH.rotate(p)], w2 = [...await PH.rotate(p)]; ok(w1.join() !== w2.join() && w1.length === 4 && new Set([...w1, ...w2]).size === 6, 'rolling window changes each login/logout and covers all 6'); }
// ---- matching v2
const MV = await import('../src/match-v2.js');
{ const A = { id: 'a', age: 28, sports: ['soccer', 'baseball'], games: ['Halo'] }, B = { id: 'b', age: 30, sports: ['football'], games: ['Halo'] };
  ok(MV.compareField('sports', A.sports, B.sports, 'hard') === 0.5 && MV.compareField('sports', A.sports, B.sports, 'soft') === 1, 'soft = same category match; hard = partial credit (soccer+baseball vs football)');
  ok(MV.compareField('religion', 'Christian', 'Catholic', 'soft') === 1 && MV.compareField('religion', 'Christian', 'Atheist', 'soft') === 0, 'soft compare religion by category (both religious)');
  const g1 = MV.score({ ...A, games: ['Witcher', 'Halo'] }, { ...B, games: ['Witcher', 'Halo'] }, 'dating'), g0 = MV.score({ ...A, games: ['Witcher'] }, { ...B, games: ['Zelda'] }, 'dating'); ok(g1 > g0, `hard compare: matching specific games earn extra points (${g1} vs ${g0})`);
  for (const s of [MV.score({ id: 1, age: 20, games: ['x'] }, { id: 2, age: 20, games: ['x'] }, 'dating'), MV.score({ id: 1, age: 20, sports: ['golf'] }, { id: 2, age: 20, sports: ['chess'] }, 'dating')]) ok(s >= 0 && s <= 100, 'score clamped 0..100 (' + s + ')');
  const rel = (r1, r2, mode) => MV.score({ id: 1, age: 25, religion: r1, sports: ['soccer'], f: {}, importance: { religion: 'make' } }, { id: 2, age: 25, religion: r2, sports: ['soccer'], importance: { religion: 'make' } }, mode);
  ok(rel('Christian', 'Atheist', 'dating') < rel('Christian', 'Atheist', 'friends') && rel('Christian', 'Atheist', 'gaming') === rel('Christian', 'Christian', 'gaming'), 'mode weights: religion heavy in dating, light in friends, ignored in gaming');
  const db = { id: 1, age: 25, sports: ['soccer'], f: { smoking: 'no' }, dealBreakers: { smoking: true } };
  ok(MV.score(db, { id: 2, age: 25, sports: ['soccer'], f: { smoking: 'yes' } }, 'dating') === null, 'deal breaker (on/off): mismatch blocks the match');
  const vis = MV.score(db, { id: 2, age: 25, sports: ['soccer'], f: { smoking: 'no' } }, 'dating'), hid = MV.score(db, { id: 2, age: 25, sports: ['soccer'], f: { smoking: 'yes' }, hidden: { smoking: true } }, 'dating');
  ok(hid != null && hid < vis && hid >= Math.floor(vis * (1 - MV.HIDDEN_PENALTY)) - 1, `hidden field vs deal breaker: never a block, silent penalty (${vis} -> ${hid})`);
  const skip = MV.score(db, { id: 2, age: 25, sports: ['soccer'], skip: { smoking: true } }, 'dating'); ok(skip != null && skip < vis, '"don\'t answer" removes the field from comparison (deal breaker -> same silent penalty, no block)');
  const pk = MV.matchPacket({ f: { smoking: 'yes', glasses: 'no' }, hidden: { smoking: true }, religion: 'Muslim', dealBreakers: { glasses: true } });
  ok(!('smoking' in pk.f) && pk.h.includes('smoking') && !JSON.stringify(pk).includes('Muslim') && pk.db.includes('glasses'), 'match packet: hidden value never leaves the phone, religion never sent');
  const c = MV.capInterests(Array.from({ length: 25 }, (_, i) => 'i' + i)); ok(c.list.length === 20 && c.dropped === 5 && MV.INTEREST_CAP === 20, 'interests hard cap 20');
  const adult = { id: 'ad', age: 30, lookingFor: ['friends', 'dating'] }, kid = { id: 'k', age: 15, minor: true }, kid2 = { id: 'k2', age: 16, minor: true };
  ok(MV.score(adult, kid, 'friends') === null && MV.score(kid, adult, 'gaming') === null, 'adults and minors are never compared (any mode)');
  ok(MV.score(kid, kid2, 'dating') === null && MV.score(kid, kid2, 'friends') != null, 'no dating for minors; minor<->minor friends ok');
  ok(MV.score({ id: 1, age: 30, seekingGenders: ['Woman'] }, { id: 2, age: 30, gender: 'Man' }, 'friends') != null && MV.score({ id: 1, age: 30, seekingGenders: ['Woman'] }, { id: 2, age: 30, gender: 'Man' }, 'dating') === null, 'gender filter applies to dating only');
  ok(MV.score({ id: 1, age: 30, ageRanges: { friends: [25, 35] } }, { id: 2, age: 40 }, 'friends') === null && MV.score({ id: 1, age: 30, ageRanges: { friends: [25, 35] } }, { id: 2, age: 40 }, 'gaming') != null, 'separate age range per mode');
  ok(MV.score({ id: 1, age: 30, datingOff: true }, { id: 2, age: 30 }, 'dating') === null, 'dating can be turned off');
  const me = { id: 'm', age: 25, sports: ['soccer'], minMatch: { friends: 99 } }; ok(MV.rank(me, [{ id: 'x', age: 25, sports: ['golf'] }], 'friends').length === 0, 'per-mode minimum match %'); }
// ---- discover
const DV = await import('../src/discover-view.js');
{ const passed = [], liked = []; const d = new DV.SwipeDeck([{ profile: { id: 1 } }, { profile: { id: 2 } }], { onPass: x => passed.push(x.profile.id), onLike: x => liked.push(x.profile.id) });
  d.swipe('left'); d.swipe('right'); ok(passed.join() === '1' && liked.join() === '2' && d.top === null, 'swipe deck: left = pass, right = like'); d.refill([{ profile: { id: 2 } }, { profile: { id: 3 } }]); ok(d.top?.profile.id === 3, 'deck refills with new nodes, no duplicates');
  ok(DV.getMode() === 'list', 'Discover defaults to list mode'); ok(/pass\(c\) \{/.test(src('app-mesh.js')) && /passedSet\.has\(from\)/.test(src('app-mesh.js')), 'swipe-left pass drops the node from discovery + refills the slot'); }
// ---- messaging: failed delivery
{ const M = await import('../src/mesh.js'), { Outbox } = await import('../src/outbox.js'); let online = true, refunds = 0; const ev = [];
  const n = new M.MeshNode({ code: 'ALICE00001', net: { send() {} }, wallet: { refund: async () => { refunds++; return true; } }, isOnline: () => online, onEvent: (...a) => ev.push(a) });
  n.outbox = new Outbox(); n.friends.set('BOB0000001', { pub: 'x' }); n.sendCheckMs = 30;
  const r = n.sendChat('BOB0000001', 'hey', { boost: true }); ok(r.ok && n.outbox.has(r.id), 'message sent, awaiting signed receipt'); online = false;
  await new Promise(res => setTimeout(res, 80)); const m = n.chat('BOB0000001').msgs.find(x => x.id === r.id);
  ok(m.state === 'failed' && m.notice === 'They logged off to mesh' && M.LOGGED_OFF_MSG === 'They logged off to mesh', 'no receipt + recipient gone: "they logged off to mesh"');
  ok(!n.outbox.has(r.id), 'failed message pulled from the outbox: never shows up in their box later'); ok(refunds === 1 && m.refunded && ev.some(e => e[0] === 'undelivered'), 'boost refunded on failed delivery');
  online = true; const r2 = n.sendChat('BOB0000001', 'plain'); online = false; await new Promise(res => setTimeout(res, 80)); ok(n.chat('BOB0000001').msgs.find(x => x.id === r2.id).state === 'failed' && refunds === 1, 'applies to every failed message (unboosted: no refund needed)');
  online = false; const r3 = n.sendChat('BOB0000001', 'later'); ok(r3.pending && n.outbox.has(r3.id || n.outbox.items.at(-1).id), 'offline-at-send keeps the existing 7-day hold');
  online = true; const r4 = n.sendChat('BOB0000001', 'slow'); await new Promise(res => setTimeout(res, 80)); ok(n.outbox.has(r4.id) && n.chat('BOB0000001').msgs.find(x => x.id === r4.id).state === 'pending', 'still online but slow: stays held, not failed'); }
// ---- reports + mute
const R = await import('../src/reports.js');
{ const a = await R.fileReport({ reporter: 'ME', reported: 'BAD', reason: 'spam/scam', context: 'chat', excerpt: 'buy coins' }), b = await R.fileReport({ reporter: 'ME', reported: 'BAD2', reason: 'illegal content (incl. child abuse)', context: 'game', game: 'chess' });
  ok(a.ok && b.ok && b.rec.priority === 'urgent' && b.rec.lawEnforcement, 'report bucket: child-safety reports urgent + law-enforcement eligible');
  ok((await R.queue())[0].id === b.rec.id, 'moderation queue: urgent first'); ok((await R.fileReport({ reporter: 'ME', reported: 'BAD', reason: 'spam/scam', context: 'chat' })).duplicate, 'duplicate report within 1 h folded');
  ok(!(await R.fileReport({ reporter: 'ME', reported: 'ME', reason: 'spam/scam' })).ok && !(await R.fileReport({ reporter: 'ME', reported: 'X', reason: 'nope' })).ok, 'self / unknown-reason reports refused');
  await R.setStatus(a.rec.id, 'actioned', 'banned'); ok((await R.queue({ status: 'actioned' }))[0].log.length === 2, 'status changes logged');
  await R.mute('ME', 'LOUD'); ok(await R.isMuted('ME', 'LOUD') && !(await R.isMuted('OTHER', 'LOUD')), 'mute: local, per owner'); await R.unmute('ME', 'LOUD'); ok(!(await R.isMuted('ME', 'LOUD')), 'unmute');
  ok(/fileReport\(\{ reporter: m\.code, reported: code, reason, context/.test(src('mesh-ui.js')) && /reportFlow\(m, b\.dataset\.rep, '', 'game', g\.id\)/.test(src('match-ui.js')), 'report from chat/profile (reportFlow) and from a game seat'); }
// ---- LFG / favorites / events
const LF = await import('../src/lfg.js');
{ const p = { }; LF.setFavorites(p, [{ console: 'PC', game: 'ARK: Survival Ascended' }, { console: 'PC', game: 'ARK: Survival Ascended' }, { console: 'Toaster', game: 'x' }]); ok(p.favGames.length === 1 && p.favGames[0].mp, 'favorite games: console + game, deduped, multiplayer-tagged');
  const s = KV.kv('lfg-test'); const ad = { code: 'AD', name: 'A', age: 30 }, kid = { code: 'KD', name: 'K', age: 14, minor: true };
  await LF.postLFG(s, ad, { game: 'Rust', console: 'PC', need: 3 }); await LF.postLFG(s, ad, { game: 'Halo Infinite', console: 'PC' }); await LF.postLFG(s, kid, { game: 'Minecraft', console: 'Mobile' });
  ok((await LF.boardFor(s, ad)).length === 1 && (await LF.boardFor(s, ad))[0].game === 'Halo Infinite', 'LFG: one active post per user (new replaces old)');
  ok((await LF.boardFor(s, kid)).every(r => r.band === 'minor') && (await LF.boardFor(s, ad)).every(r => r.band === 'adult'), 'LFG board split by age band');
  ok((await LF.boardFor(s, ad, {}, Date.now() + LF.LFG_TTL_MS + 1)).length === 0, 'LFG posts expire');
  const es = KV.kv('ev-test'); const w = Date.now() + 864e5; ok(!(await LF.createEvent(es, ad, { title: 't', type: 'rave', when: w })).ok, 'event type validated');
  await LF.createEvent(es, ad, { title: 'Neon concert', type: 'concert', when: w }); await LF.createEvent(es, ad, { title: 'Hike', type: 'hike', when: w - 1000 });
  const list = await LF.eventsFor(es, { ...ad, eventTypes: ['concert'] }); ok(list[0].title === 'Neon concert' && list[0].match === 1, 'events ranked to people who like that event type');
  ok((await LF.eventsFor(es, kid)).length === 0, 'adult events never shown to minors');
  const v = LF.lfgStore(null, kid).validate; ok(!v({ kind: 'lfg', owner: 'AD', band: 'adult', title: 'x' }, 'AD') && v({ kind: 'lfg', owner: 'K2', band: 'minor', title: 'x' }, 'K2'), 'gossiped LFG posts re-checked by the receiver (band + owner)'); }
// ---- real voice
const RV = await import('../src/rtc-voice.js'), RC = await import('../src/rtc-config.js');
{ let t = 0; const T = new RV.TalkLimiter({ now: () => t }); ok(T.press().ok, 'talk turn starts'); t = 10500; ok(T.tick() === 'turn-over' && !T.talking, 'turn cut at 10 s');
  t = 20000; ok(!T.press().ok, 'rolling budget: 10 s per minute used'); t = 70001; ok(T.press().ok, 'budget frees after the window'); t = 74000; T.release(); t = 75000; T.press(); t = 82000; ok(T.tick() === 'budget', 'budget can end a turn before 10 s');
  ok(RV.canLink({ age: 30 }, { age: 31 }) && !RV.canLink({ age: 30 }, { age: 15, minor: true }) && !RV.canLink({ age: 15 }, { age: 30 }) && !RV.canLink({ age: 30 }, { age: 30 }, { blocked: true }), 'voice links only within the same age band, never blocked');
  ok(RC.TURN_SERVERS.length === 0 && RC.iceServers({}).length === 1 && RC.iceServers({}, [{ urls: ['turn:x'] }]).length === 2, 'TURN is an empty config slot (STUN only until filled)');
  // fake WebRTC: two hubs over a fake mesh signal
  class FakePC { constructor() { this.signalingState = 'stable'; this.tracks = []; FakePC.all.push(this); } createDataChannel() { return { readyState: 'open', send: m => this.peer?.dc?.onmessage?.({ data: m }) }; } addTrack(t) { this.tracks.push(t); }
    async setLocalDescription() { this.localDescription = { type: this.remoteDescription?.type === 'offer' ? 'answer' : 'offer', sdp: 'x' }; } async setRemoteDescription(d) { this.remoteDescription = d; } async addIceCandidate() {} close() { this.closed = true; } }
  FakePC.all = [];
  const sig = {}; const mk = code => ({ send: (to, m) => queueMicrotask(() => sig[to]?.(code, m)), on: f => { sig[code] = f; return () => delete sig[code]; } });
  const track = () => ({ kind: 'audio', enabled: true, stop() { this.stopped = true; } }); const gum = async () => { const t = track(); return { getTracks: () => [t], getAudioTracks: () => [t] }; };
  const info = { AD1: { code: 'AD1', age: 30 }, AD2: { code: 'AD2', age: 33 }, KD1: { code: 'KD1', age: 15, minor: true } };
  const h1 = new RV.VoiceHub({ me: { code: 'AD1', age: 30 }, signal: mk('AD1'), RTC: FakePC, getUserMedia: gum, peerInfo: c => info[c] }), h2 = new RV.VoiceHub({ me: { code: 'AD2', age: 33 }, signal: mk('AD2'), RTC: FakePC, getUserMedia: gum, peerInfo: c => info[c] }), hk = new RV.VoiceHub({ me: { code: 'KD1', age: 15, minor: true }, signal: mk('KD1'), RTC: FakePC, getUserMedia: gum, peerInfo: c => info[c] });
  await h1.start(); await h2.start(); await hk.start(); ok(!h1.stream.getAudioTracks()[0].enabled, 'mic muted until push-to-talk');
  const L = h1.connect('AD2'); L.pc.onnegotiationneeded(); await new Promise(r => setTimeout(r, 20)); ok(h2.links.has('AD1') && L.pc.tracks.length === 1, 'adult<->adult: peer connection negotiated over mesh signaling, mic track attached');
  ok(h1.connect('KD1') === null, 'adult -> minor voice link refused'); sig.KD1 && sig.AD1('KD1', { t: 'sdp', d: { type: 'offer', sdp: 'x' } }); ok(!h1.links.has('KD1'), 'minor -> adult offer ignored by the receiver');
  ok(h1.press().ok && h1.stream.getAudioTracks()[0].enabled, 'push-to-talk opens the mic'); h1.release(); ok(!h1.stream.getAudioTracks()[0].enabled, 'release closes it');
  h1.stop(); ok(h1.links.size === 0, 'stop closes links + mic');
  ok(/voiceSignal/.test(src('app-mesh.js')) && /'vrtc'/.test(src('mesh.js')) && /startVoice/.test(src('arcade-ui.js')) && /startVoice/.test(src('party-ui.js')) && /startVoice/.test(src('match-ui.js')), 'wired: proximity voice (arcade), room voice (party / Draw & Guess / match tables)'); }
// ---- no secrets in new files
{ const files = ['kv-store.js', 'login-seq.js', 'photos.js', 'match-v2.js', 'discover-view.js', 'lfg.js', 'reports.js', 'rtc-config.js', 'rtc-voice.js', 'voice-ui.js', 'ux-ui.js', 'arcade/hostrot-net.js'];
  ok(files.every(f => !/(sk_live|sk_test|service_role|eyJhbGci|-----BEGIN|xai-[A-Za-z0-9]{10})/.test(src(f))), 'no secrets in the new modules'); }
console.log('ALL UX OK');
