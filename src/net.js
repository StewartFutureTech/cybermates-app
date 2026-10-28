// Transport abstraction for the app mesh.
//  - LocalBus: BroadcastChannel (all tabs of this browser) — local demo / E2E tests.
//  - SupabaseBus: Supabase Realtime broadcast channel 'mesh' (ephemeral; nothing is stored) — used when
//    VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set. Envelopes are relayed by Realtime; WebRTC (src/p2p.js, TURN
//    relay-only) is used for direct peer connections. Moving chat envelopes onto WebRTC data channels is a TODO.
import { guardOutgoing } from './never-send.js';
import { assertSealed } from './e2e.js'; // refuses plaintext directed/chat/starter envelopes // every outgoing mesh packet is filtered here
// Client-side per-connection throttle (token bucket) on the broadcast channel: a buggy or hostile client can't flood the
// shared Supabase channel from this tab. Excess packets are DROPPED (counted), never queued. Server-side limits:
// v46 join gate + per-user limits (migration 20261027000013_realtime_gate.sql) + Supabase per-client quotas + Vercel Firewall.
export class Throttle {
  constructor({ rate = 20, burst = 40, now = () => Date.now() } = {}) { Object.assign(this, { rate, burst, now }); this.tokens = burst; this.t = now(); this.dropped = 0; }
  take() { const n = this.now(); this.tokens = Math.min(this.burst, this.tokens + (n - this.t) * this.rate / 1000); this.t = n; if (this.tokens < 1) { this.dropped++; return false; } this.tokens--; return true; }
}
export class LocalBus {
  constructor(name = 'cm-mesh', throttle = new Throttle({ rate: 200, burst: 400 })) { this.c = new BroadcastChannel(name); this.kind = 'local (BroadcastChannel)'; this.throttle = throttle; }
  on(fn) { this.c.onmessage = e => fn(e.data); }
  post(m) { m = guardOutgoing(assertSealed(m)); if (this.throttle.take()) this.c.postMessage(m); }
  close() { this.c.close(); }
}
// v46 JOIN GATE: with a MeshGate (src/mesh-admit.js) the bus first gets an ADMISSION (fresh proof of work / attestation,
// checked by the database) and only then joins the private 'mesh' topic; Realtime refuses unadmitted / suspended users
// (app.mesh_topic_ok). Refused -> nothing is sent (fail closed), retry after the server's retry time or an exponential
// back-off (2 s .. 2 min); the admission is renewed before it expires and the fresh token is pushed to Realtime.
export const JOIN_TIMEOUT_MS = 15000, BACKOFF_MIN_MS = 2000, BACKOFF_MAX_MS = 120000, MAX_WAITING_POSTS = 100;
export class SupabaseBus {
  constructor(client, throttle = new Throttle(), { gate = null, onGate = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => Date.now(), timers = globalThis } = {}) {
    this.cl = client; this.kind = 'supabase realtime'; this.fns = []; this.ready = null; this.throttle = throttle; // READY-TO-CONNECT
    Object.assign(this, { gate, onGate, sleep, now, timers }); this.state = 'idle'; this.backoff = BACKOFF_MIN_MS; this.waiting = 0; this.droppedGate = 0; this.joins = 0; this.closed = false; this.renewT = null;
  }
  start() { return this.ready ||= this._join(); }
  _status(state, extra = {}) { this.state = state; try { this.onGate({ state, ...extra }); } catch {} }
  async _wait(until) { const ms = Math.max(0, Math.min(BACKOFF_MAX_MS * 30, (until || 0) - this.now())) || this.backoff; this.backoff = Math.min(BACKOFF_MAX_MS, this.backoff * 2); await this.sleep(Math.max(BACKOFF_MIN_MS, ms)); }
  async _join() {
    while (!this.closed) {
      let adm = null;
      if (this.gate) { this._status('admitting'); try { adm = await this.gate.ensure(); } catch (e) { this._status('refused', { reason: e.gate || 'error', retryAt: e.retryAt || null }); await this._wait(e.retryAt); continue; } }
      if (this.closed) break;
      this._status('joining');
      const st = await new Promise(res => { let done = false; const fin = v => { if (!done) { done = true; this.timers.clearTimeout?.(t); res(v); } };
        const t = this.timers.setTimeout?.(() => fin('TIMED_OUT'), JOIN_TIMEOUT_MS);
        this.ch = this.cl.channel('mesh', { config: { private: true, broadcast: { self: false, ack: false } } }); /* private => Realtime Authorization (RLS on realtime.messages, v46 gate) */
        this.ch.on('broadcast', { event: 'm' }, ({ payload }) => this.fns.forEach(f => f(payload)))
          .subscribe((s, err) => { if (!done) return fin(s === 'SUBSCRIBED' ? s : s || 'CHANNEL_ERROR'); if (s !== 'SUBSCRIBED' && !this.closed && this.state === 'joined') this._lost(s); }); });
      if (st === 'SUBSCRIBED' && !this.closed) { this.joins++; this.backoff = BACKOFF_MIN_MS; this._status('joined', adm ? { expiresAt: adm.expiresAt } : {}); this._renewLater(adm); return true; }
      try { this.cl.removeChannel(this.ch); } catch {} this.ch = null; this.gate?.forget?.();
      this._status('refused', { reason: 'realtime:' + String(st).toLowerCase() }); await this._wait(0);
    }
    return false;
  }
  _lost(s) { try { this.cl.removeChannel(this.ch); } catch {} this.ch = null; this.ready = null; this.gate?.forget?.(); this._status('lost', { reason: 'realtime:' + String(s).toLowerCase() }); this.timers.clearTimeout?.(this.renewT); if (!this.closed) this.start(); }
  _renewLater(adm) {
    this.timers.clearTimeout?.(this.renewT); if (!this.gate || !adm?.expiresAt) return;
    const ms = Math.max(30e3, adm.expiresAt - this.now() - 5 * 60e3 - 5 * 60e3);
    this.renewT = this.timers.setTimeout?.(async () => { if (this.closed) return; this.gate.forget?.();
      try { const a = await this.gate.ensure(); this._status('joined', { expiresAt: a.expiresAt, renewed: true }); this._renewLater(a); }
      catch (e) { this._status('refused', { reason: e.gate || 'error', retryAt: e.retryAt || null }); this.closeChannel(); this.ready = null; this.start(); } }, ms);
  }
  closeChannel() { if (this.ch) { try { this.cl.removeChannel(this.ch); } catch {} this.ch = null; } }
  on(fn) { this.fns.push(fn); this.start(); }
  async post(m) {
    m = guardOutgoing(assertSealed(m)); if (!this.throttle.take()) return false;
    if (this.state !== 'joined') { // fail closed while refused; bounded wait while an admission/join is in progress
      this.start(); if (!['admitting', 'joining', 'idle'].includes(this.state) || this.waiting >= MAX_WAITING_POSTS) { this.droppedGate++; return false; }
      this.waiting++; try { await this.start(); } finally { this.waiting--; } if (this.state !== 'joined' || !this.ch) { this.droppedGate++; return false; } }
    this.ch.send({ type: 'broadcast', event: 'm', payload: m }); return true;
  }
  close() { this.closed = true; this.timers.clearTimeout?.(this.renewT); this.closeChannel(); }
}
// identity = { code, pub } of this phone's mesh ID (v46: the join admission is bound to it); onGate(state) for the status line.
export async function createBus(env = (typeof import.meta !== 'undefined' && import.meta.env) || {}, { identity = null, onGate } = {}) {
  // VITE_CM_TRANSPORT=mock|supabase (default: supabase only when VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set; else mock/local)
  const want = env.VITE_CM_TRANSPORT || (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY ? 'supabase' : 'mock');
  if (want === 'supabase' && env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) {
    const [{ getClient }, { MeshGate }] = await Promise.all([import('./backend/supabase-client.js'), import('./mesh-admit.js')]);
    const client = await getClient({ url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_ANON_KEY }); // shares the signed-in session
    return new SupabaseBus(client, new Throttle(), { gate: new MeshGate({ client, identity }), onGate }); }
  return new LocalBus();
}
