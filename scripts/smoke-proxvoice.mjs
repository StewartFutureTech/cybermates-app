// v44 PROXIMITY VOICE AUDIO TRANSPORT (node, fake WebRTC + fake Web Audio): per-peer links over a fake mesh signal, driven by
// ProximityVoice.update() on a shared world. Range-gated connect / disconnect (both sides, 'bye'), distance gain per peer on the
// Web Audio GainNode, talk gate, link cap, cross-age refused (both directions + forged offers), block / mute, early-ICE buffering,
// session renew, connect timeout + failed retry with back-off, signal validation + rate cap, clean teardown, TURN env slot,
// room mode unchanged, arcade wiring + no secrets.   node --no-warnings scripts/smoke-proxvoice.mjs
import { readFileSync } from 'node:fs';
const RV = await import('../src/rtc-voice.js'), PX = await import('../src/arcade/proximity.js'), RC = await import('../src/rtc-config.js');
let n = 0, bad = 0; const ok = (c, m) => { n++; if (c) console.log('ok', m); else { bad++; console.error('FAIL', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms)), settle = async (k = 8) => { for (let i = 0; i < k; i++) await sleep(2); };
const src = f => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
// ---- fake WebRTC (pairs by the creator id carried in the SDP; "connects" once both descriptions are stable + ICE arrived)
class FakePC { static all = []; static byId = new Map(); static block = false; static seq = 0;
  constructor(cfg) { this.cfg = cfg; this.id = 'pc' + ++FakePC.seq; FakePC.byId.set(this.id, this); FakePC.all.push(this); this.signalingState = 'stable'; this.connectionState = 'new'; this.tracks = []; this.cands = []; this.localDescription = null; this.remoteDescription = null; }
  createDataChannel() { const pc = this; return this.dc = { readyState: 'connecting', sent: [], send(m) { this.sent.push(m); pc.other?.dc?.onmessage?.({ data: m }); } }; }
  addTrack(t) { this.tracks.push(t); if (!this._nn) { this._nn = 1; setTimeout(() => this.onnegotiationneeded?.(), 0); } }
  async setLocalDescription() { if (this.closed) throw new Error('closed'); const type = this.signalingState === 'have-remote-offer' ? 'answer' : 'offer'; this.localDescription = { type, sdp: 'v=0 ' + this.id };
    this.signalingState = type === 'offer' ? 'have-local-offer' : 'stable'; setTimeout(() => this.onicecandidate?.({ candidate: { candidate: 'candidate:' + this.id + ' typ host', toJSON() { return { candidate: this.candidate, sdpMid: '0' }; } } }), 1); this._check(); }
  async setRemoteDescription(d) { if (this.closed) throw new Error('closed'); this.remoteDescription = d; this.other = FakePC.byId.get(d.sdp.split(' ')[1]); this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable'; this._check(); }
  async addIceCandidate(c) { if (!this.remoteDescription) throw new Error('no remote description'); this.cands.push(c); this._check(); }
  _check() { if (FakePC.block || this.closed || this.connectionState === 'connected' || !this.localDescription || !this.remoteDescription || this.signalingState !== 'stable' || !this.cands.length) return;
    this.connectionState = 'connected'; this.onconnectionstatechange?.(); this.dc.readyState = 'open'; this.dc.onopen?.(); const o = this.other; if (o) for (const t of o.tracks) this.ontrack?.({ track: { kind: t.kind, remoteOf: t }, streams: [{ id: o.id }] }); }
  fail() { this.connectionState = 'failed'; this.onconnectionstatechange?.(); }
  close() { this.closed = true; this.connectionState = 'closed'; } }
// ---- fake Web Audio + MediaStream + Audio element (records gain values; analyser connected after the gain)
class FakeParam { constructor() { this.value = 1; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} }
class FakeNode { constructor(k) { this.k = k; this.out = []; this.gain = new FakeParam(); this.fftSize = 2048; } connect(x) { this.out.push(x); if (x.k === 'an') x.src = this; return x; } disconnect() { this.out = []; this.gone = true; } getFloatTimeDomainData(a) { a.fill(0.5 * (this.src?.gain.value ?? 0)); } }
class FakeAC { static made = 0; constructor() { FakeAC.made++; this.currentTime = 0; this.destination = new FakeNode('dest'); this.state = 'suspended'; } resume() { this.state = 'running'; return Promise.resolve(); }
  createMediaStreamSource(ms) { const n = new FakeNode('src'); n.ms = ms; return n; } createGain() { return new FakeNode('gain'); } createAnalyser() { const a = new FakeNode('an'); this._lastAn = a; return a; } }
globalThis.MediaStream = class { constructor(t) { this.tracks = t; } getTracks() { return this.tracks; } };
const els = []; globalThis.Audio = class { constructor() { els.push(this); } play() { this.playing = true; return Promise.resolve(); } pause() { this.playing = false; } };
// ---- fake mesh signal
const sig = {}, wire = []; const mk = code => ({ send: (to, m) => { wire.push({ from: code, to, m }); queueMicrotask(() => sig[to]?.(code, m)); }, on: f => { sig[code] = f; return () => delete sig[code]; } });
const track = () => ({ kind: 'audio', enabled: true, stop() { this.stopped = true; } }); const gum = async () => { const t = track(); return { getTracks: () => [t], getAudioTracks: () => [t] }; };
let T = 1e6; const now = () => T;
const people = { AD1: { code: 'AD1', age: 30 }, AD2: { code: 'AD2', age: 33 }, AD3: { code: 'AD3', age: 41 }, KD1: { code: 'KD1', age: 15, minor: true }, KD2: { code: 'KD2', age: 14, minor: true } };
for (let i = 0; i < 12; i++) people['AX' + i] = { code: 'AX' + i, age: 25 + i };
const blocked = new Set();
const node = (code, extra = {}) => { const me = people[code]; const px = new PX.ProximityVoice({ me, isBlocked: c => blocked.has(code + '>' + c) });
  const hub = new RV.VoiceHub({ me, signal: mk(code), mode: 'proximity', RTC: FakePC, AC: FakeAC, getUserMedia: gum, peerInfo: c => people[c], isMuted: c => px.muted.has(c), isBlocked: c => blocked.has(code + '>' + c), now, ...extra });
  return { code, me, px, hub }; };
// shared world (both tabs agree on positions; the test moves people)
const world = { size: Infinity, players: new Map() }; const put = (c, x, y) => world.players.set(c, { code: c, x, y, minor: !!people[c]?.minor, adult: !people[c]?.minor });
const voice = new Set(); const upd = (...ns) => { for (const N of ns) N.px.update(world, N.code, c => voice.has(c)); };
const L = (A, B) => A.hub.links.get(B.code);

// 1) signal validation
ok(RV.validSignal({ t: 'sdp', s: 'abc', d: { type: 'offer', sdp: 'x' } }) && RV.validSignal({ t: 'ice', c: { candidate: 'c' } }) && RV.validSignal({ t: 'bye', r: 'q1' }), 'valid offer / ice / bye accepted');
ok(![null, 5, [], { t: 'sdp' }, { t: 'sdp', d: { type: 'pranswer', sdp: 'x' } }, { t: 'sdp', d: { type: 'offer', sdp: 1 } }, { t: 'ice' }, { t: 'zap' }, { t: 'bye', s: 'x'.repeat(40) }, { t: 'sdp', d: { type: 'offer', sdp: 'x'.repeat(9000) } }].some(RV.validSignal), 'malformed / unknown / oversize (> 8 KB) signals refused');

// 2) two adults: connect when in range, audio track flows, gain = distance falloff on each side's GainNode
const A = node('AD1'), B = node('AD2'); await A.hub.start(); await B.hub.start(); A.px.enabled = B.px.enabled = true; A.px.attach(A.hub); B.px.attach(B.hub); voice.add('AD1'); voice.add('AD2');
ok(FakeAC.made === 1 && RV.VoiceLink.ac.state === 'running', 'AudioContext created + resumed inside start() (the user\'s tap)');
ok(!A.hub.stream.getAudioTracks()[0].enabled, 'mic muted until push-to-talk');
put('AD1', 0, 0); put('AD2', 40, 0); upd(A, B); await settle(); ok(!L(A, B) && !L(B, A) && A.px.inRange.size === 0, 'out of view (40 cells): no link either side');
put('AD2', 6, 0); upd(A, B); await settle(12);
ok(L(A, B)?.up && L(B, A)?.up && A.hub.links.size === 1 && B.hub.links.size === 1, 'both entered range: one link each side, negotiated over the mesh signal and connected');
ok(L(A, B).track && L(B, A).track && L(A, B).pc.tracks.length === 1, 'mic track sent, remote audio track received on both sides');
ok(L(A, B).g?.gain && L(A, B).src.out[0] === L(A, B).g && L(A, B).g.out.includes(RV.VoiceLink.ac.destination) && L(A, B).g.out.includes(L(A, B).an), 'Web Audio graph per peer: source -> GainNode -> speakers (+ analyser)');
ok(els.length >= 2 && els.every(e => e.muted && e.playing && e.srcObject), 'remote stream also on a MUTED media element (Chrome needs it to feed Web Audio; the audible path is the gain node)');
const g6 = PX.gainFor({ x: 0, y: 0 }, { x: 6, y: 0 }); ok(Math.abs(L(A, B).gain - g6) < 1e-9 && Math.abs(L(B, A).gain - g6) < 1e-9, `per-peer gain = distance falloff ${g6.toFixed(3)} on both sides`);
ok(L(A, B).applied === 0 && L(A, B).g.gain.value === 0, 'listener gate: silent while the far side is not talking');
B.hub.press(); await settle(); ok(L(A, B).remoteTalk.talking && Math.abs(L(A, B).g.gain.value - g6) < 1e-9 && B.hub.stream.getAudioTracks()[0].enabled, 'B talks: B mic on, A hears B at the distance gain');
put('AD2', 14, 0); upd(A, B); const g14 = PX.gainFor({ x: 0, y: 0 }, { x: 14, y: 0 }); ok(g14 < g6 && Math.abs(L(A, B).g.gain.value - g14) < 1e-9, `B moved away (6 -> 14 cells): A's gain for B drops ${g6.toFixed(3)} -> ${g14.toFixed(3)}`);
put('AD2', 2, 1); upd(A, B); ok(L(A, B).g.gain.value > g6 && L(A, B).level() > 0, 'B moved close: louder; analyser sees signal after the gain');
B.hub.release(); await settle(); ok(L(A, B).g.gain.value === 0, 'B released push-to-talk: gated to 0 again');
// talk state re-sent when the channel opens
const C3 = node('AD3'); await C3.hub.start(); C3.px.enabled = true; C3.px.attach(C3.hub); voice.add('AD3'); put('AD3', 0, 3); C3.hub.press(); upd(A, B, C3); await settle(12);
ok(L(A, C3)?.up && L(A, C3).remoteTalk.talking, 'link opened while the far side was already talking: talk state re-sent on channel open');
C3.hub.release();
// 3) leave range -> both sides torn down (bye), re-enter -> reconnect after back-off
const before = { a: A.hub.counts.closed, b: B.hub.counts.bye }; put('AD2', 30, 0); upd(A); await settle();
ok(!L(A, B) && !L(B, A) && B.hub.counts.bye > before.b, 'A saw B leave range: A closed + sent bye, B tore its side down too');
put('AD2', 5, 0); upd(B); await settle(); ok(!L(B, A), 'B re-enters range on its side but A has not yet: A refuses, nothing opens');
const bo = B.hub.backoff.get('AD1') - T; ok(bo > 0 && B.hub.connect('AD1') === null, `refused dialer backs off (${bo} ms), no redial storm`);
upd(A); await settle(12); ok(L(A, B)?.up && L(B, A)?.up, 'A now sees B in range too: A dials, B accepts -> reconnected (no wait for the far side\'s back-off)');
// 4) inbound from a peer outside MY range is refused (no silent eavesdrop link), sender backs off
put('AD2', 30, 0); upd(A, B); await settle(); T += RV.RETRY_MS + 1;
const X = B.hub.connect('AD1'); ok(X === null, 'my own hub will not dial someone outside my range (wants gate)');
const r0 = A.hub.counts.refused; B.hub.wants = () => true; const Y = B.hub.connect('AD1'); await settle(12); ok(Y && Y.closed && !L(A, B) && A.hub.counts.refused > r0, 'modified client dials me from outside my range: refused with bye, its link closed');
B.px.attach(B.hub);
// 5) cross-age: adult + minor in range never link (both directions, forged offers too)
const K = node('KD1'); await K.hub.start(); K.px.enabled = true; K.px.attach(K.hub); voice.add('KD1'); put('KD1', 1, 1); upd(A, K); T += RV.RETRY_MS + 1; upd(A, K); await settle(12);
ok(!L(A, K) && !L(K, A) && !A.px.inRange.has('KD1') && !K.px.inRange.has('AD1'), 'adult + minor side by side: never in each other\'s range, no link');
ok(A.hub.connect('KD1') === null && K.hub.connect('AD1') === null, 'hub refuses adult -> minor and minor -> adult dials');
const rf = A.hub.counts.refused; sig.AD1('KD1', { t: 'sdp', s: 'forge1', d: { type: 'offer', sdp: 'v=0 pcX' } }); A.px.inRange.add('KD1'); sig.AD1('KD1', { t: 'sdp', s: 'forge2', d: { type: 'offer', sdp: 'v=0 pcX' } }); await settle();
ok(!L(A, K) && A.hub.counts.refused === rf + 2, 'forged minor offers to an adult refused even if the range set is tampered');
A.px.inRange.delete('KD1');
const K2 = node('KD2'); await K2.hub.start(); K2.px.enabled = true; K2.px.attach(K2.hub); voice.add('KD2'); put('KD2', 2, 2); upd(K, K2); await settle(12);
ok(L(K, K2)?.up && L(K2, K)?.up, 'minor <-> minor in range: link opens (same band)');
// 6) mute + block
K.px.mute('KD2'); upd(K, K2); await settle(); ok(!L(K, K2) && !L(K2, K), 'mute: link closed on both sides');
T += RV.RETRY_MS + 1; upd(K2); await settle(12); ok(!L(K, K2), 'muted peer re-dials: refused');
K.px.mute('KD2', false); T += RV.RETRY_MS + 1; upd(K, K2); await settle(12); ok(L(K, K2)?.up, 'unmute: reconnects');
blocked.add('KD1>KD2'); upd(K, K2); await settle(); T += RV.RETRY_MS + 1; upd(K, K2); await settle(12); ok(!L(K, K2) && !L(K2, K) && !K.px.inRange.has('KD2'), 'block: link closed, never reopened');
blocked.delete('KD1>KD2');
// 7) link cap: 12 adults around A -> only the nearest MAX_HEARD
const many = []; for (let i = 0; i < 12; i++) { const N = node('AX' + i); await N.hub.start(); N.px.enabled = true; N.px.attach(N.hub); voice.add(N.code); put(N.code, 1 + (i % 6), 1 + Math.floor(i / 6) * 2); many.push(N); }
world.players.delete('AD2'); world.players.delete('AD3'); world.players.delete('KD1'); world.players.delete('KD2'); T += RV.RETRY_MS + 1; upd(A, ...many); await settle(20);
const nearest = many.map(N => [N.code, PX.gainFor({ x: 0, y: 0 }, world.players.get(N.code))]).sort((a, b) => b[1] - a[1]).slice(0, PX.MAX_HEARD).map(x => x[0]);
ok(A.px.inRange.size === PX.MAX_HEARD && [...A.hub.links.keys()].every(c => nearest.includes(c)) && A.hub.links.size <= RV.MAX_LINKS, `link cap: A wants its nearest ${PX.MAX_HEARD}, ${A.hub.links.size} open (a link needs BOTH sides to have the other in their nearest ${RV.MAX_LINKS})`);
ok(!L(A, C3), 'departed player (left the map): link closed');
T += RV.RETRY_MS + 1; upd(A, ...many); await settle(20); ok([...A.hub.backoff.values()].some(t => t - T > RV.RETRY_MS) && A.hub.links.size <= RV.MAX_LINKS, 'peers that keep refusing (their nearest-8 is full): exponential back-off (2 s -> 4 s ...), not a fixed redial loop');
for (const N of many) N.hub.stop(); world.players.clear(); upd(A); await settle();
// 8) early ICE (before the offer / before the remote description) is buffered, not lost
{ const P = node('AD2'); sig.AD2 = null; const Q = node('AD3'); const fresh = RV.VoiceLink; await P.hub.start(); await Q.hub.start(); P.hub.wants = Q.hub.wants = () => true;
  const s = 'early1', ice = { t: 'ice', s, c: { candidate: 'candidate:pcE typ host' } }; Q.hub._in('AD2', ice); Q.hub._in('AD2', ice); ok(Q.hub.early.get('AD2')?.length === 2 && !Q.hub.links.size, 'ICE before any offer: buffered (no link opened by ICE)');
  const pcE = new FakePC({}); pcE.addTrack(track()); await pcE.setLocalDescription(); FakePC.byId.set('pcE', pcE); Q.hub._in('AD2', { t: 'sdp', s, d: { type: 'offer', sdp: 'v=0 pcE' } }); await settle();
  ok(Q.hub.links.get('AD2')?.pc.cands.length === 2, 'offer arrives: buffered ICE replayed after the remote description'); P.hub.stop(); Q.hub.stop(); }
// 9) session renew (peer reloaded: new session id) + stale answer ignored
{ const P = node('AD2'), Q = node('AD3'); await P.hub.start(); await Q.hub.start(); P.hub.wants = Q.hub.wants = () => true; P.hub.connect('AD3'); await settle(12); const old = Q.hub.links.get('AD2');
  ok(old?.up, 'link up'); P.hub.links.get('AD3').closed = true; P.hub.links.delete('AD3'); const P2 = P.hub._open('AD3'); await settle(12);
  ok(old.closed && Q.hub.links.get('AD2') !== old && Q.hub.links.get('AD2')?.rsid === P2.sid && Q.hub.links.get('AD2').up, 'peer reloaded (new session offer): old link replaced, new one connects'); P.hub.stop(); Q.hub.stop(); }
// 10) connect timeout + failed -> closed and retried after the back-off
{ FakePC.block = true; const P = node('AD2'), Q = node('AD3'); await P.hub.start(); await Q.hub.start(); P.hub.wants = Q.hub.wants = () => true; const l = P.hub.connect('AD3'); await settle(12);
  T += RV.CONNECT_MS + 1; P.hub.tick(); ok(l.closed && P.hub.counts.timeout === 1 && P.hub.connect('AD3') === null, 'no connection within 15 s (no TURN, strict NAT): closed + back-off, no redial storm');
  FakePC.block = false; T += RV.RETRY_MS + 1; const l2 = P.hub.connect('AD3'); await settle(12); ok(l2 && l2.up, 'retry after the back-off connects');
  l2.pc.fail(); await settle(); ok(l2.closed && P.hub.counts.failed === 1 && !Q.hub.links.has('AD2'), 'ICE failed: link closed on both sides (bye), back-off set'); P.hub.stop(); Q.hub.stop(); }
// 11) flood: per-sender rate cap + junk counted
{ const Q = node('AD3'); await Q.hub.start(); for (let i = 0; i < 200; i++) Q.hub._in('AD2', { t: 'ice', s: 'f', c: { candidate: 'x' } }); for (let i = 0; i < 5; i++) Q.hub._in('AD2', { t: 'zzz' });
  ok(Q.hub.counts.rate >= 100 && Q.hub.counts.badSig === 5 && (Q.hub.early.get('AD2')?.length || 0) <= RV.ICE_BUF && Q.hub.links.size === 0, `flood of 200 signals: ${Q.hub.counts.rate} rate-dropped, junk refused, buffers capped`); Q.hub.stop(); }
// 12) teardown: toggle off / stop closes every link, stops the mic, far sides torn down
{ upd(A); const P = node('AD2'); await P.hub.start(); P.px.enabled = true; P.px.attach(P.hub); put('AD1', 0, 0); put('AD2', 3, 0); T += RV.RETRY_MS + 1; upd(A, P); await settle(12); ok(L(A, P)?.up, 'link up before teardown');
  const lk = L(A, P); await A.px.setEnabled(false); upd(A); await settle(); ok(lk.closed && !L(P, A) && A.hub.links.size === 0 && !lk.g && lk.applied === 0, 'voice toggled off: links closed both sides, audio nodes disconnected');
  A.px.enabled = true; T += RV.RETRY_MS + 1; upd(A, P); await settle(12); const tr = A.hub.stream.getAudioTracks()[0]; A.px.detach(); A.hub.stop(); await settle();
  ok(tr.stopped && A.hub.links.size === 0 && !L(P, A) && A.hub.wants('AD2') === false, 'hub.stop(): mic track stopped, far side closed, detached hub wants nobody'); P.hub.stop(); }
// 13) proximity hub without ProximityVoice attached: fail closed; room mode unchanged
{ const P = node('AD2'), Q = new RV.VoiceHub({ me: people.AD3, signal: mk('AD3'), RTC: FakePC, AC: FakeAC, getUserMedia: gum, peerInfo: c => people[c], now }); await P.hub.start(); await Q.start();
  ok(P.hub.connect('AD3') === null && P.hub.wants('AD3') === false, 'proximity hub refuses everyone until ProximityVoice attaches (fail closed)');
  const l = Q.connect('AD2'); ok(l && l.gain === 1, 'room mode: links at gain 1, everyone in the room wanted (unchanged)'); P.hub.stop(); Q.stop(); }
// 14) ICE config: STUN/host only by default; VITE_TURN_* adds a relay; no TURN secret bundled
ok(RC.TURN_SERVERS.length === 0 && RC.iceServers({}).length === 1 && /^stun:/.test(RC.iceServers({})[0].urls[0]), 'default ICE: STUN only (host + srflx candidates)');
const te = RC.iceServers({ VITE_TURN_URLS: 'turn:t.example:3478,turns:t.example:443', VITE_TURN_USERNAME: 'u', VITE_TURN_CREDENTIAL: 'p' }); ok(te.length === 2 && te[1].urls.length === 2 && te[1].username === 'u' && RC.hasTurn({ VITE_TURN_URLS: 'turn:x' }, []), 'VITE_TURN_URLS / _USERNAME / _CREDENTIAL add a TURN relay when present');
ok(FakePC.all.some(p => p.cfg?.iceServers?.length >= 1), 'every voice peer connection gets the iceServers() config');
// 15) wiring + hygiene
const au = src('arcade-ui.js'); ok(/px\.attach\(vh\.hub\)/.test(au) && /px\.detach\(\); vh\.stop\(\)/.test(au) && /px\?\.detach\(\); vh\?\.stop\(\)/.test(au), 'arcade-ui: proximity toggle attaches the hub, toggle-off / leaving the arcade detaches + stops it');
ok(/MODE === 'admin' \|\| import\.meta\.env\?\.DEV\) globalThis\.__cmVoiceLab/.test(src('app-mesh.js')), 'e2e lab hook only in admin/dev builds');
for (const f of ['rtc-voice.js', 'arcade/proximity.js', 'voice-lab.js', 'rtc-config.js']) ok(!/(sk_live|sk_test|service_role|eyJhbGciOi|-----BEGIN|password\s*[:=]\s*['"][^'"]+)/i.test(src(f)), `no secrets in src/${f}`);
console.log(bad ? `smoke-proxvoice: ${bad} FAILED of ${n}` : `smoke-proxvoice: ALL OK (${n} checks)`); process.exit(bad ? 1 : 0);
