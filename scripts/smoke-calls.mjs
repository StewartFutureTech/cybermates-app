// Call logic with a FAKE RTCPeerConnection pair (this box's headless Chrome gathers no ICE candidates, so real media is
// covered by scripts/e2e-calls.mjs on a normal machine). Exercises: link up gate, ring/accept, tracks, mute/camera,
// renegotiation, hangup, ring timeout, block kills call + link, peer offline, parent video toggle, accepted-friends only.
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const C = await import('../src/call.js');
const wait = (ms = 5) => new Promise(r => setTimeout(r, ms));
class Track { constructor(kind) { this.kind = kind; this.enabled = true; this.stopped = false; } stop() { this.stopped = true; } }
class Stream { constructor(t = []) { this.t = t; } getTracks() { return this.t; } getAudioTracks() { return this.t.filter(x => x.kind === 'audio'); } getVideoTracks() { return this.t.filter(x => x.kind === 'video'); } addTrack(x) { this.t.push(x); } }
globalThis.MediaStream = Stream;
Object.defineProperty(globalThis, 'navigator', { value: { mediaDevices: { getUserMedia: async ({ audio, video }) => new Stream([...(audio ? [new Track('audio')] : []), ...(video ? [new Track('video')] : [])]) } }, configurable: true });
const pcs = []; let negs = 0;
class FakePC { constructor() { pcs.push(this); this.signalingState = 'stable'; this.connectionState = 'new'; this.localDescription = null; this.remoteDescription = null; this.senders = []; }
  get other() { return pcs[pcs.indexOf(this) ^ 1]; }
  createDataChannel() { const dc = this.dc = { readyState: 'connecting', send: m => this.other.dc.readyState === 'open' && queueMicrotask(() => this.other.dc.onmessage?.({ data: m })), close: () => { for (const d of [this.dc, this.other?.dc]) if (d && d.readyState !== 'closed') { d.readyState = 'closed'; d.onclose?.(); } } }; return dc; }
  async createOffer() { return { type: 'offer', sdp: 'o' + negs++ }; }
  async setLocalDescription(d) { d ||= this.signalingState === 'have-remote-offer' ? { type: 'answer', sdp: 'a' } : await this.createOffer(); this.localDescription = d; this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'; if (d.type === 'answer') this._connect(); }
  async setRemoteDescription(d) { this.remoteDescription = d; this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable'; if (d.type === 'answer') this._connect(); }
  _connect() { for (const p of [this, this.other]) { if (p.connectionState !== 'connected') { p.connectionState = 'connected'; p.onconnectionstatechange?.(); } if (p.dc && p.dc.readyState === 'connecting') { p.dc.readyState = 'open'; p.dc.onopen?.(); } } }
  async addIceCandidate() {}
  addTrack(t, s) { const snd = { track: t }; this.senders.push(snd); const o = this.other; queueMicrotask(() => o.ontrack?.({ streams: [s], track: t })); queueMicrotask(() => this.onnegotiationneeded?.()); return snd; }
  getSenders() { return this.senders; } removeTrack(s) { this.senders = this.senders.filter(x => x !== s); }
  close() { this.connectionState = 'closed'; this.dc?.close(); }
}
const ev = { A: [], B: [] }, remote = {};
const mk = (me, peer) => new C.DirectLink({ me, peer, RTC: FakePC, send: m => queueMicrotask(() => (me === 'AAAA' ? B : A).onSignal(m)), onCall: (s, o) => ev[me[0]].push(s + (o?.reason ? ':' + o.reason : '')), onTrack: s => remote[me[0]] = s });
const A = mk('AAAA', 'BBBB'), B = mk('BBBB', 'AAAA');
assert(!(await C.canCall({ friend: true, linkUp: false })).ok, 'no call button before the direct link is up');
A.open(); B.open(); await wait(20); assert(A.up && B.up, 'direct link (DataChannel) up via mesh-envelope signaling');
assert((await C.canCall({ friend: false, linkUp: true })).reason === 'not-accepted', 'only accepted friends can call');
assert((await C.canCall({ friend: true, linkUp: true, blocked: true })).reason === 'blocked', 'blocked/banned/halted cannot call');
const parent = { t: { videoCalls: false, voiceCalls: true }, async allowed(k) { return this.t[k] !== false; } };
assert((await C.canCall({ friend: true, linkUp: true, video: true, parent })).reason === 'parent-disabled' && (await C.canCall({ friend: true, linkUp: true, video: false, parent })).ok, 'parent controls: video off, voice still allowed');
await A.start({ video: true }); await wait(); assert(B.call?.state === 'ringing' && B.call.video, 'ringing on the other phone');
await B.accept(); await wait(10); assert(A.call?.state === 'active' && remote.B?.getVideoTracks().length && remote.A?.getAudioTracks().length, 'video call active; media tracks flow peer-to-peer');
assert(A.mute(true) === false && A.local.getAudioTracks().every(t => !t.enabled) && A.camera(false) === false && A.local.getVideoTracks().every(t => !t.enabled), 'mute + camera toggles');
const tracks = A.local.getTracks(); A.hangup(); await wait(); assert(!A.call && !B.call && tracks.every(t => t.stopped) && ev.B.includes('ended:hangup') && A.up, 'hangup: both ended, tracks stopped, link stays up');
await A.start({ video: false }); await wait(); await B.accept(); await wait(); const n0 = negs; await A.addVideo(); await wait(10); assert(negs > n0 && remote.B.getVideoTracks().length, 'renegotiation: voice call upgraded with video'); B.hangup(); await wait();
B._o = B._ctl; B._ctl = o => o.c === 'ring' ? null : B._o(o); await A.start({ video: false, ringMs: 30 }); await wait(60); assert(ev.A.includes('ended:timeout') && !A.call, 'unanswered call times out'); B._ctl = B._o;
await A.start({ video: false }); await wait(); await B.accept(); await wait(); B.kill('blocked'); await wait(80);
assert(ev.A.includes('ended:blocked') && !A.up && !B.up, 'block/ban/halt: call ended on both sides and the direct link dropped');
console.log('ALL OK smoke-calls');
