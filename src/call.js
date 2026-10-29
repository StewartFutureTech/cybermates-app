// WebRTC direct link + voice/video calls between two DIRECTLY linked phones. Peer-to-peer media only: no server media relay
// (a TURN server only relays encrypted packets when NAT blocks a direct path). Signaling = `send(obj)` over the existing
// E2E-signed/encrypted mesh envelopes (type 'rtc', friends only); the harness/tests use a BroadcastChannel instead.
// ICE: STUN by default; TURN from VITE_TURN_URLS / VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL. Without TURN many NATs fail.
// Perfect negotiation (polite/impolite by code order) handles glare and renegotiation (e.g. adding video mid-call).
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
import { iceServers } from './rtc-config.js'; // TURN = empty config slot (src/rtc-config.js)
export function iceConfig(e = env) { return { iceServers: iceServers(e) }; }
export const RING_MS = 30e3, OFFLINE_GRACE_MS = 10e3;
// Who may call: accepted friends, direct link up, not blocked/banned/halted; parent toggles for minors (video / voice).
export async function canCall({ friend, linkUp, blocked, banned, halted, video, parent }) {
  if (!friend) return { ok: false, reason: 'not-accepted' }; if (blocked || banned || halted) return { ok: false, reason: 'blocked' }; if (!linkUp) return { ok: false, reason: 'no-direct-link' };
  if (parent && !(await parent.allowed(video ? 'videoCalls' : 'voiceCalls'))) return { ok: false, reason: 'parent-disabled' };
  return { ok: true };
}
const J = d => (d && d.toJSON ? d.toJSON() : d);
export class DirectLink {
  constructor({ me, peer, send, RTC = globalThis.RTCPeerConnection, config = iceConfig(), onState = () => {}, onTrack = () => {}, onCall = () => {} }) {
    Object.assign(this, { me, peer, send, onState, onTrack, onCall }); this.polite = me > peer; this.making = false; this.ignore = false; this.up = false; this.call = null; this.local = null;
    const pc = this.pc = new RTC(config);
    pc.onicecandidate = e => e.candidate && this.send({ t: 'ice', c: J(e.candidate) });
    pc.onnegotiationneeded = async () => { try { this.making = true; await pc.setLocalDescription(); this.send({ t: 'sdp', d: J(pc.localDescription) }); } catch {} finally { this.making = false; } };
    pc.ontrack = e => this.onTrack(e.streams[0] || new MediaStream([e.track]), e.track);
    pc.onconnectionstatechange = () => { const s = pc.connectionState; this.onState(s); if (s === 'failed' || s === 'closed') this._down('link-' + s);
      if (s === 'disconnected') { clearTimeout(this.dt); this.dt = setTimeout(() => pc.connectionState !== 'connected' && this._down('peer-offline'), OFFLINE_GRACE_MS); } };
  }
  open() { const dc = this.dc = this.pc.createDataChannel('link', { negotiated: true, id: 0 });
    dc.onopen = () => { this.up = true; this.onState('link-up'); }; dc.onclose = () => { this.up = false; this._down('peer-offline'); this.onState('link-down'); }; dc.onmessage = e => this._ctl(JSON.parse(e.data)); this.send({ t: 'hello' }); if (!this.polite) this._offer(); return this; }
  async _offer() { try { this.making = true; await this.pc.setLocalDescription(await this.pc.createOffer()); this.send({ t: 'sdp', d: J(this.pc.localDescription) }); } catch {} finally { this.making = false; } } // hello: a peer that came up later asks us to resend our pending offer
  async onSignal(m) { const pc = this.pc;
    if (m.t === 'hello') { if (!this.polite) { if (pc.signalingState === 'have-local-offer' && pc.localDescription) this.send({ t: 'sdp', d: J(pc.localDescription) }); else if (!pc.remoteDescription) this._offer(); } return; }
    if (m.t === 'sdp') { const offer = m.d.type === 'offer', collision = offer && (this.making || pc.signalingState !== 'stable'); this.ignore = !this.polite && collision; if (this.ignore) return;
      await pc.setRemoteDescription(m.d); if (offer) { await pc.setLocalDescription(); this.send({ t: 'sdp', d: J(pc.localDescription) }); } }
    else if (m.t === 'ice') { try { await pc.addIceCandidate(m.c); } catch (e) { if (!this.ignore) throw e; } } }
  ctl(o) { if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(o)); }
  _ctl(o) { // call control rides the (already peer-to-peer) data channel
    if (o.c === 'ring') { this.call = { state: 'ringing', video: !!o.video, dir: 'in' }; this.onCall('ringing', o); }
    else if (o.c === 'accept' && this.call?.dir === 'out') { clearTimeout(this.ringT); this.call.state = 'active'; this.onCall('active'); }
    else if (o.c === 'bye') this._end(o.reason || 'hangup');
    else if (o.c === 'decline') this._end('declined'); }
  async _media(video) { const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: !!video }); this.local = s; for (const t of s.getTracks()) this.pc.addTrack(t, s); return s; }
  async start({ video = false, gate = { ok: true }, ringMs = RING_MS } = {}) { if (!gate.ok) return gate; if (!this.up) return { ok: false, reason: 'no-direct-link' }; if (this.call) return { ok: false, reason: 'busy' };
    this.call = { state: 'calling', video, dir: 'out' }; await this._media(video); this.ctl({ c: 'ring', video });
    this.ringT = setTimeout(() => this.call?.state === 'calling' && this.hangup('timeout'), ringMs); this.onCall('calling'); return { ok: true }; }
  async accept({ gate = { ok: true } } = {}) { if (!this.call || this.call.dir !== 'in') return { ok: false };
    if (!gate.ok) { this.decline(); return gate; } await this._media(this.call.video); this.call.state = 'active'; this.ctl({ c: 'accept' }); this.onCall('active'); return { ok: true }; }
  decline() { this.ctl({ c: 'decline' }); this._end('declined'); }
  mute(on = true) { for (const t of this.local?.getAudioTracks() || []) t.enabled = !on; return !on; }
  camera(on) { for (const t of this.local?.getVideoTracks() || []) t.enabled = !!on; return !!on; }
  async addVideo() { if (!this.local || this.local.getVideoTracks().length) return false; const s = await navigator.mediaDevices.getUserMedia({ video: true }); const t = s.getVideoTracks()[0]; this.local.addTrack(t); this.pc.addTrack(t, this.local); return true; } // renegotiates
  hangup(reason = 'hangup') { this.ctl({ c: 'bye', reason }); this._end(reason); }
  kill(reason) { this.hangup(reason); setTimeout(() => this.close(), 50); } // block / ban / halt: end the call AND drop the link
  _end(reason) { clearTimeout(this.ringT); for (const t of this.local?.getTracks() || []) t.stop(); for (const s of this.pc.getSenders()) try { if (s.track) this.pc.removeTrack(s); } catch {} this.local = null; const had = this.call; this.call = null; if (had) this.onCall('ended', { reason }); }
  _down(reason) { if (this.call) this._end(reason); this.up = false; }
  close() { this._down('closed'); try { this.dc?.close(); } catch {} try { this.pc.close(); } catch {} }
}
