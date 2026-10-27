// REAL VOICE (and optional video) for games: WebRTC peer-to-peer, signaled over the existing mesh ('vrtc' envelopes, see
// app-mesh.js). Used for PROXIMITY voice (arcade worlds: gain = distance falloff from src/arcade/proximity.js) and ROOM voice
// (Draw & Guess / party rooms / match tables: everyone in the room at gain 1).
// TALK LIMITS (both modes): a talk turn lasts at most TURN_MS = 10 s, and nobody talks more than BUDGET_MS = 10 s within any
// rolling 60 s window. Enforced on the SPEAKER (mic track disabled) AND on every LISTENER (that speaker's audio is gated to 0
// once their signalled talk time is over), so a modified client cannot hog the room.
// SAFETY: links only ever open between the same age band (canLink); blocked / muted peers are never linked; minors need the
// parent toggle (checked by the callers' ProximityVoice / room gate). No media server: audio flows phone-to-phone (a TURN
// relay, when configured in rtc-config.js, only forwards encrypted SRTP).
// v44 PER-PEER AUDIO TRANSPORT (proximity): every link has a session id ('s'); 'bye' tears the far side down too; only a fresh
// offer from a peer that passes the gate (band / block / mute) AND that I currently want (proximity: in my range, top MAX_LINKS)
// opens a link; proximity links start SILENT (gain 0) until ProximityVoice sets the distance gain. Early ICE is buffered (before
// the link / remote description exists); dead links (failed / no connect within CONNECT_MS) are closed and retried after a
// back-off; signals are shape/size checked and rate capped per sender. Works with STUN / host candidates only; VITE_TURN_* (see
// rtc-config.js) adds a relay when David configures one.
import { iceServers } from './rtc-config.js';
export const TURN_MS = 10e3, BUDGET_MS = 10e3, WINDOW_MS = 60e3;
export class TalkLimiter {
  constructor({ turnMs = TURN_MS, budgetMs = BUDGET_MS, windowMs = WINDOW_MS, now = () => Date.now() } = {}) { Object.assign(this, { turnMs, budgetMs, windowMs, now }); this.spans = []; this.start = null; }
  used(t = this.now()) { const from = t - this.windowMs; let u = 0; for (const [a, b] of this.spans) u += Math.max(0, Math.min(b, t) - Math.max(a, from)); if (this.start != null) u += t - Math.max(this.start, from); return u; }
  left(t = this.now()) { return Math.max(0, this.budgetMs - this.used(t)); }
  press(t = this.now()) { if (this.start != null) return { ok: true, already: true }; const l = this.left(t); if (l <= 0) return { ok: false, reason: 'budget', retryIn: this.retryIn(t) }; this.start = t; return { ok: true, maxMs: Math.min(this.turnMs, l) }; }
  release(t = this.now()) { if (this.start == null) return 0; const d = t - this.start; this.spans.push([this.start, t]); this.start = null; this.spans = this.spans.filter(([, b]) => b > t - this.windowMs); return d; }
  // call often: cuts the turn at 10 s or when the rolling budget runs out
  tick(t = this.now()) { if (this.start == null) return null; if (t - this.start >= this.turnMs) { this.release(this.start + this.turnMs); return 'turn-over'; } if (this.left(t) <= 0) { this.release(t); return 'budget'; } return null; }
  get talking() { return this.start != null; }
  retryIn(t = this.now()) { // time until 1 s of budget frees up
    for (let d = 0; d <= this.windowMs; d += 250) if (this.left(t + d) >= Math.min(1000, this.budgetMs)) return d; return this.windowMs; }
}
const band = p => (p?.minor || (p?.age != null && p.age < 18) ? 'minor' : 'adult');
export const canLink = (me, peer, { blocked = false, muted = false } = {}) => !!peer && !blocked && !muted && band(me) === band(peer);
export const MAX_LINKS = 8, RETRY_MS = 2000, CONNECT_MS = 15000, SIG_MAX = 8192, ICE_BUF = 24, SIG_BURST = 60, SIG_RATE = 6; // SIG_RATE msgs/s refill
const sid = () => Math.random().toString(36).slice(2, 10);
const isId = x => typeof x === 'string' && x.length > 0 && x.length <= 16;
// inbound signal shape check (anything else is dropped before it reaches an RTCPeerConnection)
export function validSignal(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return false; if (m.s != null && !isId(m.s)) return false; if (m.r != null && !isId(m.r)) return false;
  let n; try { n = JSON.stringify(m).length; } catch { return false; } if (n > SIG_MAX) return false;
  if (m.t === 'bye') return true;
  if (m.t === 'sdp') return !!m.d && typeof m.d === 'object' && (m.d.type === 'offer' || m.d.type === 'answer') && typeof m.d.sdp === 'string';
  if (m.t === 'ice') return !!m.c && typeof m.c === 'object' && typeof (m.c.candidate ?? '') === 'string';
  return false; }
// One audio peer connection (perfect negotiation, polite = higher code). send(m) = mesh signal to that peer.
export class VoiceLink {
  constructor({ me, peer, send, RTC = globalThis.RTCPeerConnection, stream = null, video = false, gain = 1, AC = globalThis.AudioContext, onTrack = () => {}, onTalk = () => {}, onState = () => {}, onClose = () => {}, config = { iceServers: iceServers() } }) {
    Object.assign(this, { me, peer, onTrack, onTalk, onState, onClose, AC }); this.sid = sid(); this.rsid = null; this.send = m => send({ ...m, s: this.sid });
    this.polite = me > peer; this.making = false; this.ignore = false; this.remoteTalk = new TalkLimiter(); this.gain = Math.max(0, Math.min(1, gain)); this.applied = 0; this.localTalk = false; this.up = false; this.state = 'new'; this.iceq = [];
    const pc = this.pc = new RTC(config); this.dc = pc.createDataChannel?.('talk', { negotiated: true, id: 1 });
    if (this.dc) { this.dc.onmessage = e => { try { const o = JSON.parse(e.data); if (o.talk === 1) this.remoteTalk.press(); if (o.talk === 0) this.remoteTalk.release(); this.onTalk(o.talk === 1); this._apply(); } catch {} };
      this.dc.onopen = () => this.talk(this.localTalk); } // re-send my talk state when the channel opens (I may already be talking)
    this.ice = { sent: 0, added: 0, err: 0 };
    pc.onicecandidate = e => e.candidate && ++this.ice.sent && this.send({ t: 'ice', c: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate });
    pc.onnegotiationneeded = async () => { try { this.making = true; await pc.setLocalDescription(); this.send({ t: 'sdp', d: pc.localDescription?.toJSON ? pc.localDescription.toJSON() : pc.localDescription }); } catch {} finally { this.making = false; } };
    pc.ontrack = e => { this.remote = e.streams?.[0] || null; this._attach(e.track); this.onTrack(this.remote, e.track); };
    pc.onconnectionstatechange = () => { this.state = pc.connectionState; if (this.state === 'connected') this.up = true; this.onState(this.state); };
    if (stream) for (const tr of stream.getTracks()) if (tr.kind === 'audio' || video) pc.addTrack(tr, stream);
  }
  async onSignal(m) { if (this.closed) return; const pc = this.pc; if (m.s && !this.rsid) this.rsid = m.s;
    if (m.t === 'sdp') { const offer = m.d.type === 'offer', coll = offer && (this.making || pc.signalingState !== 'stable'); this.ignore = !this.polite && coll; if (this.ignore) return;
      await pc.setRemoteDescription(m.d); if (offer) { await pc.setLocalDescription(); this.send({ t: 'sdp', d: pc.localDescription?.toJSON ? pc.localDescription.toJSON() : pc.localDescription }); }
      const q = this.iceq; this.iceq = []; for (const c of q) await this._ice(c); }
    else if (m.t === 'ice') { if (!pc.remoteDescription) { if (this.iceq.length < ICE_BUF) this.iceq.push(m.c); return; } await this._ice(m.c); } }
  async _ice(c) { try { await this.pc.addIceCandidate(c); this.ice.added++; } catch (e) { this.ice.err++; if (!this.ignore) throw e; } }
  _attach(track) { if (track.kind !== 'audio') return; this.track = track; const AC = this.AC; if (!AC || !globalThis.MediaStream) return;
    try { const ac = VoiceLink.ac ||= new AC(); ac.resume?.()?.catch?.(() => {}); const ms = new MediaStream([track]);
      // Chrome only feeds remote WebRTC audio into Web Audio while the stream is also attached to a media element (kept muted:
      // the audible path is the per-peer GainNode, so distance falloff / gates always apply)
      if (globalThis.Audio) { const el = this.el = new Audio(); el.muted = true; el.srcObject = ms; el.play?.()?.catch?.(() => {}); }
      this.src = ac.createMediaStreamSource(ms); this.g = ac.createGain(); this.g.gain.value = 0; this.src.connect(this.g); this.g.connect(ac.destination);
      if (ac.createAnalyser) { this.an = ac.createAnalyser(); this.an.fftSize = 256; this.g.connect(this.an); } this._apply(); } catch {} }
  tick() { this.remoteTalk.tick(); this._apply(); }
  _apply() { const allowed = this.remoteTalk.talking ? 1 : 0, v = this.closed ? 0 : this.gain * allowed; this.applied = v; // listener-side gate
    if (!this.g) return; const p = this.g.gain, t = VoiceLink.ac?.currentTime; if (p.setTargetAtTime && t != null) { p.cancelScheduledValues?.(t); p.setTargetAtTime(v, t, 0.04); } else p.value = v; } // short ramp: no clicks as people move
  setGain(g) { this.gain = Math.max(0, Math.min(1, +g || 0)); this._apply(); }
  level() { if (!this.an) return 0; const a = new Float32Array(this.an.fftSize); this.an.getFloatTimeDomainData(a); let s = 0; for (const x of a) s += x * x; return Math.sqrt(s / a.length); } // RMS after the gain node
  async rx() { try { let b = 0, lvl = 0; (await this.pc.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && (r.kind || r.mediaType) === 'audio') { b += r.bytesReceived || 0; lvl = Math.max(lvl, r.audioLevel || 0); } }); return { bytes: b, level: lvl }; } catch { return { bytes: 0, level: 0 }; } }
  talk(on) { this.localTalk = !!on; try { if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify({ talk: on ? 1 : 0 })); } catch {} }
  close(reason = 'close', { bye = true } = {}) { if (this.closed) return; this.closed = true; this.reason = reason; if (bye) try { this.send({ t: 'bye' }); } catch {}
    try { this.pc.close(); } catch {} for (const n of [this.src, this.g, this.an]) try { n?.disconnect(); } catch {} if (this.el) { try { this.el.pause?.(); } catch {} this.el.srcObject = null; this.el = null; }
    this.g = this.src = this.an = null; this.applied = 0; try { this.onClose(reason); } catch {} }
}
// VoiceHub: owns the mic + all links for one session (room or proximity). signal = { send(to, m), on(fn(from, m)) }.
// wants(code): may this peer open / keep a link right now? Room: everyone in the room (default). Proximity: ONLY peers inside my
// range (ProximityVoice.attach sets it); until then proximity refuses every inbound offer (fail closed).
export class VoiceHub {
  constructor({ me, signal, mode = 'room', getUserMedia = c => globalThis.navigator?.mediaDevices?.getUserMedia(c), RTC = globalThis.RTCPeerConnection, AC = globalThis.AudioContext, isBlocked = () => false, isMuted = () => false, peerInfo = () => null, wants = null, maxLinks = MAX_LINKS, retryMs = RETRY_MS, connectMs = CONNECT_MS, now = () => Date.now() }) {
    Object.assign(this, { me, signal, mode, gum: getUserMedia, RTC, AC, isBlocked, isMuted, peerInfo, maxLinks, retryMs, connectMs, now }); this.wants = wants || (mode === 'proximity' ? () => false : () => true);
    this.links = new Map(); this.mine = new TalkLimiter({ now }); this.stream = null; this.backoff = new Map(); this.strikes = new Map(); this.early = new Map(); this.buckets = new Map();
    this.counts = { opened: 0, closed: 0, refused: 0, badSig: 0, rate: 0, bye: 0, timeout: 0, failed: 0 };
    this.off = signal?.on?.((from, m) => this._in(from, m)); }
  async start({ video = false } = {}) { if (this.stream) return { ok: true }; try { this.stream = await this.gum({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: !!video }); } catch (e) { return { ok: false, reason: 'mic-denied', message: e?.message }; }
    if (this.AC && globalThis.MediaStream) try { (VoiceLink.ac ||= new this.AC()).resume?.()?.catch?.(() => {}); } catch {} // created/resumed inside the user's tap (autoplay rules)
    this._mic(false); return { ok: true }; }
  _mic(on) { for (const t of this.stream?.getAudioTracks?.() || []) t.enabled = on; }
  _gate(code) { const p = this.peerInfo(code); return canLink(this.me, p, { blocked: this.isBlocked(code), muted: this.isMuted(code) }); }
  _live() { let n = 0; for (const L of this.links.values()) if (!L.closed) n++; return n; }
  _open(code) { const L = new VoiceLink({ me: this.me.code, peer: code, RTC: this.RTC, AC: this.AC, stream: this.stream, gain: this.mode === 'proximity' ? 0 : 1, send: m => this.signal.send(code, m),
      onState: s => { if (s === 'connected') this.strikes.delete(code); if (s === 'failed') { this.counts.failed++; this._kill(code, L, 'failed'); } }, onClose: () => { this.counts.closed++; if (this.links.get(code) === L) this.links.delete(code); } });
    L.born = this.now(); L.talk(this.mine.talking); this.links.set(code, L); this.counts.opened++; return L; }
  _kill(code, L, why, bye = true) { L.close(why, { bye }); const k = Math.min(4, this.strikes.get(code) || 0); this.strikes.set(code, k + 1); this.backoff.set(code, this.now() + this.retryMs * 2 ** k); } // 2, 4, 8, 16, 32 s after repeated refusals / failures; reset once a link connects
  // ProximityVoice.connect-compatible: returns {setGain, close} (null = not allowed / backing off / at the link cap)
  connect(code) { if (!this.stream || !this._gate(code) || !this.wants(code)) return null; const L = this.links.get(code); if (L && !L.closed) return L;
    if (this.now() < (this.backoff.get(code) || 0) || this._live() >= this.maxLinks) return null; return this._open(code); }
  _rate(from) { const t = this.now(), b = this.buckets.get(from) || { n: SIG_BURST, t }; b.n = Math.min(SIG_BURST, b.n + (t - b.t) / 1000 * SIG_RATE); b.t = t; this.buckets.set(from, b); if (this.buckets.size > 512) this.buckets.delete(this.buckets.keys().next().value); if (b.n < 1) return false; b.n--; return true; }
  _in(from, m) { if (typeof from !== 'string' || !from || from.length > 128) return; if (!validSignal(m)) { this.counts.badSig++; return; } if (!this._rate(from)) { this.counts.rate++; return; }
    let L = this.links.get(from); if (L?.closed) L = null;
    if (m.t === 'bye') { if (L && ((m.s && L.rsid === m.s) || (m.r && L.sid === m.r) || (!m.s && !m.r) || (!L.rsid && m.r == null))) { this.counts.bye++; this._kill(from, L, 'bye', false); } return; }
    if (!this.stream) return; // not started yet (mic not granted): ignore, the peer retries
    if (!this._gate(from) || !this.wants(from)) { this.counts.refused++; if (L) this._kill(from, L, 'gate'); else if (m.t === 'sdp' && m.d.type === 'offer') this.signal.send(from, { t: 'bye', r: m.s }); return; } /* re-checked on every signal: block/mute/band/range can change mid-session */
    if (L && L.rsid && m.s && L.rsid !== m.s) { if (m.t === 'sdp' && m.d.type === 'offer') { L.close('renew', { bye: false }); L = null; } else return this._buffer(from, m); } // new session from that peer (reload / re-entered range)
    if (!L) { if (m.t === 'ice') return this._buffer(from, m); if (m.d.type !== 'offer') return; // only a fresh offer opens a link
      if (this._live() >= this.maxLinks) { this.counts.refused++; this.signal.send(from, { t: 'bye', r: m.s }); return; } L = this._open(from); }
    const run = async () => { await L.onSignal(m); const q = this.early.get(from); if (q && m.s) { this.early.delete(from); for (const e of q) if (e.s === m.s) await L.onSignal(e); } };
    L.chain = (L.chain || Promise.resolve()).then(run).catch(() => {}); } // per-link order kept (offer before its trickled ICE)
  _buffer(from, m) { const q = this.early.get(from) || []; if (q.length < ICE_BUF) q.push(m); this.early.set(from, q); if (this.early.size > 64) this.early.delete(this.early.keys().next().value); }
  // push-to-talk
  press() { const r = this.mine.press(); if (!r.ok) return r; this._mic(true); for (const L of this.links.values()) L.talk(true); return r; }
  release() { this.mine.release(); this._mic(false); for (const L of this.links.values()) L.talk(false); }
  tick() { const cut = this.mine.tick(); if (cut) { this._mic(false); for (const L of this.links.values()) L.talk(false); } const t = this.now();
    for (const [c, L] of [...this.links]) { if (!L.up && t - L.born > this.connectMs) { this.counts.timeout++; this._kill(c, L, 'timeout'); continue; } L.tick(); } return cut; }
  drop(code) { const L = this.links.get(code); if (L) L.close('drop'); this.links.delete(code); }
  stats() { return [...this.links].map(([code, L]) => ({ code, state: L.state, up: L.up, gain: L.gain, applied: L.applied, talk: L.remoteTalk.talking, track: !!L.track, sid: L.sid, rsid: L.rsid, ice: { ...L.ice, conn: L.pc.iceConnectionState, gather: L.pc.iceGatheringState, q: L.iceq.length } })); }
  stop() { for (const L of [...this.links.values()]) L.close('stop'); this.links.clear(); for (const t of this.stream?.getTracks?.() || []) t.stop(); this.stream = null; this.off?.(); this.early.clear(); }
}
