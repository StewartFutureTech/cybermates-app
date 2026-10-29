// P2P + kill switch smoke (imported by smoke.mjs; relies on its localStorage shim).
import { makeMsg } from '../src/killswitch.js';
import { keygen, sign } from './lib/sign.mjs';
import * as P from '../src/p2p.js';
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const K = keygen(), EVIL = keygen();
class FakeRTC { static all = []; constructor(cfg) { this.cfg = cfg; this.closed = false; FakeRTC.all.push(this); }
  createDataChannel() {} async createOffer() { return { type: 'offer', sdp: 'x' }; } async createAnswer() { return { type: 'answer', sdp: 'y' }; }
  async setLocalDescription() {} async setRemoteDescription() {} async addIceCandidate() {} close() { this.closed = true; } }
const mutual = new Set(['alice', 'bob', 'nocon']);
let kills = 0;
const mk = (userId, name) => new P.P2P({ transport: new P.LocalTransport(name), userId, isMutual: id => mutual.has(id) && id !== userId, pubkey: K.publicKey, RTC: FakeRTC, onKill: () => kills++ });
const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));

// consent gate
P.revokeConsent(); const a = mk('alice', 't1');
let err; try { await a.join(); } catch (e) { err = e.message; } assert(/consent required/.test(err), 'join blocked without consent');
P.giveConsent('alice'); await a.start(); await a.join(); assert(a.joined, 'join after consent');
assert(P.ICE_CONFIG.iceTransportPolicy === 'relay', 'ICE defaults to TURN relay only');
// peers: valid bob connects; no-consent and non-mutual refused
await a.onSignal({ kind: 'hello', att: { userId: 'nocon' } });
await a.onSignal({ kind: 'hello', att: { userId: 'nocon', consent_version: 'old', consented_at: 1, relay_only: true, app_version: 2 } });
await a.onSignal({ kind: 'hello', att: { userId: 'stranger', consent_version: P.CONSENT_VERSION, consented_at: 1, relay_only: true, app_version: 2 } });
assert(a.peers.size === 0 && a.refused.map(r => r.reason).join() === 'no-consent,no-consent,not-mutual', 'no-consent / stale-consent / non-mutual peers refused');
await a.onSignal({ kind: 'hello', att: { userId: 'bob', consent_version: P.CONSENT_VERSION, consented_at: Date.now(), relay_only: true, app_version: 2 } });
assert(a.peers.size === 1 && a.peers.get('bob').cfg.iceTransportPolicy === 'relay', 'consented mutual peer connects (relay ICE)');

// kill switch rejections
const now = Date.now();
let r = await a.handleControl({ ...sign(makeMsg({ reason: 'x' }), EVIL.privateKey) }, 'broadcast'); assert(r.reason === 'bad-signature' && a.peers.size === 1, 'forged (wrong key) ignored');
const good = sign(makeMsg({ reason: 'tamper' }), K.privateKey); r = await a.handleControl({ ...good, scope: 'user:bob' }, 'broadcast'); assert(r.reason === 'bad-signature', 'tampered field ignored');
r = await a.handleControl(sign(makeMsg({ now: now - 2 * 864e5, ttlMs: 864e5 }), K.privateKey), 'broadcast'); assert(r.reason === 'expired' && a.joined, 'expired ignored');
r = await a.handleControl(sign(makeMsg({ now: now - 3600e3 }), K.privateKey), 'broadcast'); assert(r.reason === 'stale', 'stale broadcast ignored');
r = await a.handleControl(sign(makeMsg({ now: now + 3600e3 }), K.privateKey), 'broadcast'); assert(r.reason === 'future', 'future-dated ignored');
r = await a.handleControl(sign(makeMsg({ scope: 'user:someoneelse' }), K.privateKey), 'broadcast'); assert(r.reason === 'out-of-scope' && a.joined, 'other-user scope ignored');
// valid kill via BroadcastChannel (local simulation of the 'control' channel)
const valid = sign(makeMsg({ reason: 'legal hold' }), K.privateKey);
{ const bc = new BroadcastChannel('t1:control'); bc.postMessage(valid); await wait(); bc.close(); }
assert(kills === 1 && !a.joined && a.peers.size === 0 && FakeRTC.all.every(p => p.closed), 'valid signed kill (BroadcastChannel) tears down peers + leaves presence');
assert(P.getKillState()?.reason === 'legal hold', 'kill persisted locally');
err = null; try { await a.join(); } catch (e) { err = e.message; } assert(/disabled/.test(err), 'rejoin blocked while killed');
r = await a.handleControl(valid, 'broadcast'); assert(r.reason === 'replay' && kills === 1, 'replayed kill ignored');
// clear lifts it; offline device honors persistent record on startup
r = await a.handleControl(sign(makeMsg({ type: 'clear' }), K.privateKey), 'broadcast'); assert(r.ok && !P.getKillState(), 'signed clear lifts kill');
const rec = sign(makeMsg({ now: now - 3 * 864e5, ttlMs: 30 * 864e5, reason: 'standing' }), K.privateKey);
const off = new P.P2P({ transport: { onControl() {}, fetchRecord: async () => rec, join() {}, leave() {}, send() {} }, userId: 'carol', pubkey: K.publicKey, RTC: FakeRTC });
assert((await off.start()) === false && P.getKillState()?.reason === 'standing', 'offline device honors persistent signed record on startup (3-day-old, unexpired)');
const off2 = new P.P2P({ transport: { onControl() {}, fetchRecord: async () => ({ ...rec, nonce: 'n2', reason: 'forged' }), join() {}, leave() {}, send() {} }, userId: 'dave', pubkey: K.publicKey, RTC: FakeRTC });
localStorage.removeItem('cybermates:kill'); assert((await off2.start()) === true, 'forged persistent record ignored');
a.t.close();
