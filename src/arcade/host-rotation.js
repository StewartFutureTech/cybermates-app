// HOST ROTATION for in-game sessions (match games + mass-arena sub-maps).
//  One node is HOST (authority: orders inputs/moves, publishes the authoritative state snapshot + sequence number).
//  After TERM_MS the host hands authority to the NEXT ELIGIBLE node in a deterministic order every peer computes the same
//  way (score desc, then id asc, cyclic after the current host). Eligibility skips nodes reporting high ping, packet
//  loss, or low battery (not charging) — metrics are self-reported in signed heartbeats so every peer sees the same view.
//  Every authority change bumps the EPOCH (term number). Messages from an older epoch, or from a node that is not the
//  host of the current epoch, are ignored -> a stale/partitioned ex-host cannot split the brain.
//  HANDOFF (planned): old host signs {epoch+1, to, seq, snap}; the new host resumes from exactly that snapshot/seq.
//  FAILOVER (unplanned): MISS_N missed heartbeats -> each peer deterministically computes the next eligible node after the
//  dead host; that node claims epoch+1 with the freshest snapshot it holds (host replicates state on every heartbeat).
//  All messages are Ed25519-signed (tweetnacl) with the node's existing signing key and verified against the roster pub.
// Transport-agnostic: pass send(msg) (broadcast) and call receive(msg) for inbound; call tick() periodically.
import nacl from 'tweetnacl';
import { b64, unb64 } from '../vault.js';
export const TERM_MS = 90e3, HB_MS = 1000, MISS_N = 3;
export const LIMITS = { maxPing: 250, maxLoss: 0.08, minBattery: 0.2 };
const te = new TextEncoder();
const body = m => { const { sig, ...rest } = m; return te.encode(JSON.stringify(rest, Object.keys(rest).sort())); };
export const signMsg = (m, sec) => ({ ...m, sig: b64(nacl.sign.detached(body(m), sec)) });
export const verifyMsg = (m, pub) => { try { return !!pub && nacl.sign.detached.verify(body(m), unb64(m.sig), unb64(pub)); } catch { return false; } };
export function eligible(mt, lim = LIMITS) { if (!mt) return false;
  if ((mt.ping ?? 0) > lim.maxPing || (mt.loss ?? 0) > lim.maxLoss) return false;
  if (mt.battery != null && !mt.charging && mt.battery < lim.minBattery) return false; return true; }
// Deterministic agreed order: score desc, then id asc.
export const rankOrder = nodes => [...nodes].sort((a, b) => (b.score || 0) - (a.score || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
// Next eligible after `cur` (cyclic). Falls back to any live node if nobody is eligible; never returns an excluded id.
export function nextHost(nodes, cur, { lim = LIMITS, exclude = new Set() } = {}) {
  const ord = rankOrder(nodes.filter(n => !exclude.has(n.id))); if (!ord.length) return null;
  const i = ord.findIndex(n => n.id === cur), n = ord.length;
  for (let k = 1; k <= n; k++) { const c = ord[(i + k + n) % n]; if (c.id !== cur && eligible(c, lim)) return c.id; }
  return ord.find(c => c.id === cur && !exclude.has(cur)) ? cur : ord[(i + 1 + n) % n].id; }
// Browser battery probe (navigator.getBattery is Chromium/Android only; others -> null = unknown, treated as OK).
export async function readBattery(nav = globalThis.navigator) { try { const b = await nav?.getBattery?.(); return b ? { battery: b.level, charging: b.charging } : {}; } catch { return {}; } }
export class HostRotation {
  constructor({ id, secretKey, roster, termMs = TERM_MS, hbMs = HB_MS, missN = MISS_N, limits = LIMITS, now = () => Date.now(), send = () => {}, out = null, getState = () => null, setState = () => {}, onHost = () => {} }) {
    Object.assign(this, { id, secretKey, termMs, hbMs, missN, limits, now, send, out, getState, setState, onHost }); // out(m): optional batch/compact signer (hostrot-net.js) replaces per-message signing
    this.roster = new Map(Object.entries(roster)); // id -> pub
    this.metrics = new Map(); this.seen = new Map(); this.dead = new Set();
    const t = now(); for (const k of this.roster.keys()) this.seen.set(k, t);
    this.epoch = 0; this.host = rankOrder([...this.roster.keys()].map(id => ({ id })))[0].id; // epoch 0: lowest id
    this.termStart = t; this.seq = 0; this.snap = null; this.lastHb = -Infinity; this.myMetrics = { ping: 0, loss: 0 }; this.log = [];
  }
  get isHost() { return this.host === this.id; }
  nodes() { return [...this.roster.keys()].map(id => ({ id, ...(this.metrics.get(id) || {}), ...(id === this.id ? this.myMetrics : {}) })); }
  setMetrics(m) { Object.assign(this.myMetrics, m); }
  addPeer(id, pub) { this.roster.set(id, pub); this.seen.set(id, this.now()); this.dead.delete(id); }
  removePeer(id) { this.roster.delete(id); this.metrics.delete(id); if (this.host === id) this._failover(); }
  // host API: commit a new authoritative state (bumps seq). Non-hosts must not commit.
  commit(snap) { if (!this.isHost) return false; this.seq++; this.snap = snap; this._out({ t: 'state', seq: this.seq, snap }); return true; }
  _out(m) { if (this.out) { const u = { ...m, from: this.id, epoch: m.epoch ?? this.epoch, host: m.host ?? this.host }; this.out(u); return u; } const s = signMsg({ ...m, from: this.id, epoch: m.epoch ?? this.epoch, host: m.host ?? this.host }, this.secretKey); this.send(s); return s; }
  _become(epoch, host, seq, snap, why) { this.epoch = epoch; this.host = host; this.termStart = this.now(); if (seq != null && seq >= this.seq) { this.seq = seq; this.snap = snap; this.setState(snap, seq); }
    this.seen.set(host, this.now()); this.log.push({ epoch, host, seq: this.seq, why }); this.onHost(host, epoch, why); }
  tick() { const t = this.now();
    if (t - this.lastHb >= this.hbMs) { this.lastHb = t; this._out({ t: 'hb', seq: this.seq, metrics: this.myMetrics, ...(this.isHost ? { snap: this.snap } : {}) }); }
    if (this.isHost && t - this.termStart >= this.termMs) return this.handoff('term');
    if (!this.isHost && t - (this.seen.get(this.host) ?? 0) > this.hbMs * this.missN) this._failover(); }
  handoff(why = 'term') { if (!this.isHost) return null; const to = nextHost(this.nodes(), this.id, { lim: this.limits, exclude: this.dead });
    if (!to || to === this.id) { this.termStart = this.now(); return null; } // nobody better: extend term
    const snap = this.getState() ?? this.snap, e = this.epoch + 1;
    this._out({ t: 'handoff', epoch: e, host: to, seq: this.seq, snap, prev: this.id }); this._become(e, to, this.seq, snap, why); return to; } // old host steps down
  _failover() { const old = this.host; if (old === this.id) return; this.dead.add(old);
    const pf = this.pendingFail; if (pf?.old === old) { if (this.now() - pf.at <= this.hbMs * this.missN) return; this.dead.add(pf.to); } // successor silent too -> skip it
    const to = nextHost(this.nodes(), old, { lim: this.limits, exclude: this.dead }); if (!to) return;
    if (to === this.id) { const e = this.epoch + 1; this._become(e, to, this.seq, this.snap, 'failover'); this._out({ t: 'claim', epoch: e, host: to, seq: this.seq, snap: this.snap, prev: old }); }
    else if (this.pendingClaim?.from === to) { const c = this.pendingClaim; this.pendingClaim = null; this._become(c.epoch, to, c.seq, c.snap, 'failover'); }
    else { this.seen.set(to, this.now()); this.pendingFail = { old, to, at: this.now() }; } } // wait for to's claim (if it also died, its silence fails over again)
  _hostTimedOut() { return this.now() - (this.seen.get(this.host) ?? 0) > this.hbMs * this.missN; }
  _beats(a, b) { const o = rankOrder(this.nodes().filter(n => n.id === a || n.id === b)); return o[0]?.id === a; } // same-epoch tie-break
  receive(m, { trusted = false } = {}) { const pub = this.roster.get(m?.from); if (!pub || (!trusted && !verifyMsg(m, pub))) return { ok: false, reason: 'signature' };
    if (m.from === this.id) return { ok: true, self: true };
    if (m.epoch < this.epoch) return { ok: false, reason: 'stale-epoch' }; // ex-host from an old term: ignored entirely
    if (m.metrics) this.metrics.set(m.from, m.metrics);
    if (m.t === 'handoff') { // planned: only the CURRENT host of epoch e may hand to epoch e+1
      if (m.epoch !== this.epoch + 1 || m.from !== this.host) return { ok: false, reason: m.from !== this.host ? 'not-host' : 'epoch-gap' };
      this.pendingFail = null; this._become(m.epoch, m.host, m.seq, m.snap, 'handoff'); return { ok: true, host: m.host }; }
    if (m.from === this.host && m.epoch > this.epoch && m.host !== m.from && m.t === 'hb') { // I lost the handoff packet; the old host's signed hb carries it
      this._become(m.epoch, m.host, null, null, 'handoff-late'); return { ok: true, host: m.host }; }
    const claimish = m.t === 'claim' || (m.host === m.from && m.epoch > this.epoch); // a hb from a newer-epoch host counts as a claim
    if (claimish) {
      if (m.host !== m.from) return { ok: false, reason: 'claim-not-self' };
      if (m.epoch === this.epoch) { if (m.from === this.host) return { ok: true }; // conflicting same-epoch claim (split brain)
        if (!this._beats(m.from, this.host)) return { ok: false, reason: 'split-brain-loser' }; }
      else if (m.prev === this.host || m.t !== 'claim') { if (!this._hostTimedOut() && m.from !== this.host) { this.pendingClaim = m; return { ok: false, reason: 'host-alive' }; } }
      this.seen.set(m.from, this.now()); this.dead.delete(m.from); if (this.host !== m.from) this.dead.add(this.host);
      this.pendingFail = this.pendingClaim = null; this._become(m.epoch, m.from, m.seq, m.snap, 'failover'); return { ok: true, host: m.from }; }
    this.seen.set(m.from, this.now()); this.dead.delete(m.from);
    if (m.epoch > this.epoch) return { ok: false, reason: 'future-epoch' };
    if (m.from !== this.host) return m.t === 'hb' ? { ok: true } : { ok: false, reason: 'not-host' };
    if ((m.t === 'state' || m.t === 'hb') && m.seq > this.seq && m.snap !== undefined) { this.seq = m.seq; this.snap = m.snap; this.setState(m.snap, m.seq); }
    return { ok: true }; }
}
