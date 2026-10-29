import { guardOutgoing } from './never-send.js';
// P2P layer: consent gate + peer handshake + WebRTC (TURN relay only) + kill-switch enforcement.
// Transports: LocalTransport (BroadcastChannel, same-browser tabs; testable without Supabase)
// and SupabaseTransport (Realtime presence 'peers' + broadcast 'control' + polled kill_switch table).
import { checkControl, KILL_PUBKEY } from './killswitch.js';
import { APP_VERSION, checkVersion } from './appconfig.js';

export const CONSENT_VERSION = '2026-10-16.1';
export const CONSENT_NOTICE = [
  'Joining the peer network connects your device directly to matched people for voice/video/data.',
  'Peers may be able to see your IP address. By default all traffic is relayed through our TURN servers, which hides your IP from peers but means the relay sees connection metadata.',
  'Cybermates can centrally moderate the network and shut it down for everyone, a user, or a session at any time (kill switch). When that happens your connections close immediately.',
  'Your device is never used as a relay or for computing on behalf of other users.',
  'Only people you have mutually matched with can connect to you. You can leave at any time.'
];
// Placeholder ICE config. Replace urls/credentials with your TURN provider (e.g. coturn, Twilio, Cloudflare)
// via VITE_TURN_URLS (comma-separated), VITE_TURN_USERNAME, VITE_TURN_CREDENTIAL. Relay-only by default.
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
export const ICE_CONFIG = {
  iceServers: [{ urls: (env.VITE_TURN_URLS || 'turns:turn.example.invalid:5349?transport=tcp').split(','), username: env.VITE_TURN_USERNAME || 'PLACEHOLDER', credential: env.VITE_TURN_CREDENTIAL || 'PLACEHOLDER' }],
  iceTransportPolicy: 'relay' // never expose host/srflx candidates (IP) to peers
};

const CK = 'cybermates:p2p-consent', KK = 'cybermates:kill', NK = 'cybermates:kill-nonces';
const ls = () => globalThis.localStorage;
export const getConsent = () => { try { const c = JSON.parse(ls().getItem(CK)); return c?.version === CONSENT_VERSION ? c : null; } catch { return null; } };
export const giveConsent = (userId, now = Date.now()) => { const c = { version: CONSENT_VERSION, at: now, userId }; ls().setItem(CK, JSON.stringify(c)); return c; };
export const revokeConsent = () => ls().removeItem(CK);
export const attestation = (userId, c = getConsent()) => c && { userId, consent_version: c.version, consented_at: c.at, relay_only: true, app_version: APP_VERSION };
// Peer acceptance rule: valid current-version attestation AND mutual match.
export function acceptPeer(att, { isMutual }) {
  if (!att || att.consent_version !== CONSENT_VERSION || !Number.isFinite(att.consented_at) || att.relay_only !== true) return { ok: false, reason: 'no-consent' };
  const v = checkVersion(att.app_version); if (!v.ok) return { ok: false, reason: v.reason, message: v.message };
  if (!isMutual(att.userId)) return { ok: false, reason: 'not-mutual' };
  return { ok: true };
}
class NonceSet { // persisted replay cache
  constructor() { try { this.s = new Set(JSON.parse(ls().getItem(NK)) || []); } catch { this.s = new Set(); } }
  has(n) { return this.s.has(n); }
  add(n) { this.s.add(n); ls().setItem(NK, JSON.stringify([...this.s].slice(-500))); }
}
export const getKillState = (now = Date.now()) => { try { const k = JSON.parse(ls().getItem(KK)); return k && k.expires_at > now ? k : null; } catch { return null; } };

export class LocalTransport {
  constructor(name = 'cybermates') { this.p = new BroadcastChannel(name + ':peers'); this.c = new BroadcastChannel(name + ':control'); }
  async join(att, onMsg) { this.p.onmessage = e => onMsg(e.data); this.send({ kind: 'hello', att }); }
  send(m) { this.p.postMessage(m); }
  async leave() { this.p.onmessage = null; }
  onControl(fn) { this.c.onmessage = e => fn(e.data); }
  async fetchRecord() { return null; }
  close() { this.p.close(); this.c.close(); }
}
export class SupabaseTransport {
  constructor(client) { this.c = client; this.ch = null; this.ctl = null; }
  async join(att, onMsg) {
    this.ch = this.c.channel('peers', { config: { presence: { key: att.userId } } });
    this.ch.on('broadcast', { event: 'p2p' }, ({ payload }) => onMsg(payload))
      .on('presence', { event: 'join' }, ({ newPresences }) => newPresences.forEach(p => onMsg({ kind: 'hello', att: p.att })));
    await new Promise(r => this.ch.subscribe(s => { if (s === 'SUBSCRIBED') { this.ch.track({ att }); r(); } }));
  }
  send(m) { this.ch?.send({ type: 'broadcast', event: 'p2p', payload: guardOutgoing(m) }); }
  async leave() { if (this.ch) { await this.ch.untrack(); await this.c.removeChannel(this.ch); this.ch = null; } }
  onControl(fn) { this.ctl = this.c.channel('control').on('broadcast', { event: 'kill' }, ({ payload }) => fn(payload)).subscribe(); }
  async fetchRecord() { const { data } = await this.c.from('kill_switch').select('msg').eq('id', 'current').maybeSingle(); return data?.msg || null; }
  close() { if (this.ctl) this.c.removeChannel(this.ctl); }
}

import { assertRealDevice } from './device-gate.js';

export class P2P {
  constructor({ transport, userId, sessionId = Math.random().toString(36).slice(2), isMutual = () => false, pubkey = KILL_PUBKEY, RTC = globalThis.RTCPeerConnection, onKill = () => {}, onEvent = () => {}, now = () => Date.now(), deviceGate = assertRealDevice }) {
    Object.assign(this, { t: transport, userId, sessionId, isMutual, pubkey, RTC, onKill, onEvent, now, deviceGate });
    this.peers = new Map(); this.joined = false; this.seen = new NonceSet(); this.refused = [];
    this.t.onControl(m => this.handleControl(m, 'broadcast'));
  }
  async start() { // startup poll so offline devices honor a standing kill
    const rec = await this.t.fetchRecord().catch(() => null);
    if (rec) await this.handleControl(rec, 'record');
    return !getKillState(this.now());
  }
  async join() {
    if (getKillState(this.now())) throw new Error('Peer network is disabled (kill switch active)');
    await this.deviceGate(); // emulator gate (Android); throws friendly message
    const att = attestation(this.userId); if (!att) throw new Error('P2P consent required');
    this.att = att; this.joined = true;
    await this.t.join(att, m => this.onSignal(m));
  }
  async onSignal(m) {
    if (!this.joined || !m || m.att?.userId === this.userId || (m.to && m.to !== this.userId)) return;
    const a = acceptPeer(m.att, { isMutual: this.isMutual });
    if (!a.ok) { this.refused.push({ peer: m.att?.userId, reason: a.reason }); this.onEvent('refused', m.att?.userId, a.reason); return; }
    const id = m.att.userId;
    if (m.kind === 'hello') { if (!this.peers.has(id)) this.t.send({ kind: 'hello', att: this.att, to: id }); if (this.userId < id) await this.connect(id); return; }
    const pc = this.peers.get(id) || this.pc(id);
    if (m.kind === 'offer') { await pc.setRemoteDescription(m.sdp); const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); this.t.send({ kind: 'answer', att: this.att, to: id, sdp: ans }); }
    else if (m.kind === 'answer') await pc.setRemoteDescription(m.sdp);
    else if (m.kind === 'ice' && m.cand) await pc.addIceCandidate(m.cand).catch(() => {});
  }
  pc(id) {
    const pc = new this.RTC(ICE_CONFIG); this.peers.set(id, pc);
    pc.onicecandidate = e => e.candidate && this.t.send({ kind: 'ice', att: this.att, to: id, cand: e.candidate });
    this.onEvent('peer', id); return pc;
  }
  async connect(id) {
    if (this.peers.has(id)) return; const pc = this.pc(id);
    pc.createDataChannel?.('chat');
    const off = await pc.createOffer(); await pc.setLocalDescription(off);
    this.t.send({ kind: 'offer', att: this.att, to: id, sdp: off });
  }
  async teardown() {
    for (const pc of this.peers.values()) try { pc.close(); } catch {}
    this.peers.clear(); if (this.joined) { this.joined = false; await this.t.leave(); }
  }
  async handleControl(msg, source) {
    const r = await checkControl(msg, { pubkey: this.pubkey, now: this.now(), seen: this.seen, userId: this.userId, sessionId: this.sessionId, source });
    this.onEvent('control', msg?.type, r.ok ? 'accepted' : r.reason);
    if (!r.ok) return r;
    if (msg.type === 'clear') { ls().removeItem(KK); return r; }
    ls().setItem(KK, JSON.stringify({ scope: msg.scope, reason: msg.reason, issued_at: msg.issued_at, expires_at: msg.expires_at }));
    await this.teardown(); this.onKill(msg);
    return r;
  }
}
