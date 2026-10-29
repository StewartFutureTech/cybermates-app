// HOST ROTATION + JOIN-ANYTIME over the arcade mesh ('arc' envelopes, op 'hr' / 'join').
// Signing cost: tweetnacl Ed25519 is ~17 ms per signature on a mid phone, so per-message signing at 1 Hz heartbeat +
// every state commit would eat a big slice of the frame budget. Two fixes, both here:
//  1. COMPACT payloads: short keys, metrics quantised (ping ms int, loss in 1/1000, battery in %), and heartbeats drop the
//     snapshot when it has not changed since the last one we sent (receivers already hold it; seq still travels).
//  2. BATCHING: messages queued within FLUSH_MS go out as ONE envelope with ONE signature over the whole batch
//     ({f, n, b:[...]}); n is a per-sender batch counter so a replayed batch is dropped. Verification is once per batch.
// Result: <= 1 signature per FLUSH_MS window per node instead of one per message (smoke-hostrot2 measures this).
import nacl from 'tweetnacl';
import { b64, unb64 } from '../vault.js';
import { HostRotation, readBattery } from './host-rotation.js';
import { band, gband, gameCompat } from './proximity.js';
import { isRealtime } from './join-anytime.js';
export const FLUSH_MS = 250;
const LONG = { t: 't', q: 'seq', s: 'snap', e: 'epoch', h: 'host', f: 'from', m: 'metrics', p: 'prev' };
const SHORT = Object.fromEntries(Object.entries(LONG).map(([k, v]) => [v, k]));
const qm = m => m && { p: Math.round(m.ping ?? 0), l: Math.round((m.loss ?? 0) * 1000), ...(m.battery != null ? { b: Math.round(m.battery * 100), c: m.charging ? 1 : 0 } : {}) };
const um = m => m && { ping: m.p, loss: m.l / 1000, ...(m.b != null ? { battery: m.b / 100, charging: !!m.c } : {}) };
export function pack(m) { const o = {}; for (const [k, v] of Object.entries(m)) { if (v === undefined) continue; o[SHORT[k] || k] = k === 'metrics' ? qm(v) : v; } return o; }
export function unpack(o) { const m = {}; for (const [k, v] of Object.entries(o)) m[LONG[k] || k] = k === 'm' ? um(v) : v; return m; }
const te = new TextEncoder(), canon = (f, n, b) => te.encode(JSON.stringify([f, n, b]));
export class BatchSigner {
  constructor({ id, secretKey, send, flushMs = FLUSH_MS, timers = globalThis }) { Object.assign(this, { id, secretKey, send, flushMs, timers }); this.q = []; this.n = 0; this.signs = 0; this.msgs = 0; this.lastSnapKey = null; this.t = null; }
  queue(m) { const c = pack(m); delete c.f; // from = batch sender
    if (c.t === 'hb' && 's' in c) { const k = JSON.stringify(c.s); if (k === this.lastSnapKey) delete c.s; else this.lastSnapKey = k; }
    else if ('s' in c) this.lastSnapKey = JSON.stringify(c.s);
    this.q.push(c); this.msgs++; if (c.t === 'handoff' || c.t === 'claim') return this.flush(); // authority changes go out immediately
    if (!this.t && this.timers?.setTimeout) this.t = this.timers.setTimeout(() => this.flush(), this.flushMs); return null; }
  flush() { if (this.t) { this.timers.clearTimeout?.(this.t); this.t = null; } if (!this.q.length) return null; const b = this.q; this.q = []; const n = ++this.n;
    const env = { op: 'hr', f: this.id, n, b, sig: b64(nacl.sign.detached(canon(this.id, n, b), this.secretKey)) }; this.signs++; this.send(env); return env; }
}
export class BatchVerifier { constructor(pubOf) { this.pubOf = pubOf; this.last = new Map(); this.verifies = 0; }
  open(env) { const pub = this.pubOf(env?.f); if (!pub || !Array.isArray(env.b) || !Number.isInteger(env.n)) return null; if (env.n <= (this.last.get(env.f) || 0)) return null; // replay
    this.verifies++; let ok = false; try { ok = nacl.sign.detached.verify(canon(env.f, env.n, env.b), unb64(env.sig), unb64(pub)); } catch {} if (!ok) return null;
    this.last.set(env.f, env.n); return env.b.map(c => ({ ...unpack(c), from: env.f })); } }
// Bind a Match (src/arcade/match.js) to the mesh: host rotation among the HUMAN seats + join-anytime pings.
// arcade = mesh().arcade ({send, sub}); roster = {code: pub(b64)} of human seats (pubs come from the signed seat records).
// NETWORK FLOW (all 'arc' envelopes carry mid = match id):
//  - 'hr'    batched signed host-rotation traffic (heartbeats with metrics, state commits, handoff, claim).
//  - 'mv'    a human's signed move; every peer verifies + applies it, the HOST commits the result (authoritative snapshot).
//  - 'rp'/'ro' RTT probe / echo -> my ping + loss (+ battery) go into my signed heartbeat, so every peer skips a bad-ping host.
//  - 'tbl'   the host advertises the table (game, mode, age band, AI seats open) every ADV_MS; 'tblx' = table closed.
//  - 'join'  a newcomer's ping; the host seats it (real-time: takes an AI seat NOW; turn-based: next round) and replies
//            'seat' {to, r, snap, roster, epoch, host} so the newcomer adopts the exact table state and current host term.
//  - 'leave' a human left: everyone drops it from the roster (host leaving = planned handoff first); the host puts an AI
//            in the seat and commits. 'rm' = rematch request from a non-host (only the host starts the next round).
// AI seats are driven by the host only (match-ui), so replicas never race the bots.
export const ADV_MS = 2000, PROBE_MS = 2000, PROBE_WIN = 10, BATT_MS = 30e3;
const median = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[b.length >> 1]; };
const lowMedian = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[(b.length - 1) >> 1]; }; // one slow PEER must not make MY link look bad
export function bindMatch({ match, arcade, code, secretKey, roster, now = () => Date.now(), onHost = () => {}, onJoin = () => {}, onSync = () => {}, onMove = () => {}, onLeave = () => {}, timers = globalThis, termMs, hbMs, battery = readBatt, initial = null }) {
  const send = env => arcade?.send?.({ ...env, mid: match.id });
  const bs = new BatchSigner({ id: code, secretKey, send, timers });
  let rot; const addSeatPeers = () => { for (const s of match.seats) if (!s.ai && s.pub && s.code !== code && !rot.roster.has(s.code)) rot.addPeer(s.code, s.pub); };
  rot = match.hostSession({ id: code, secretKey, roster, now, out: m => bs.queue(m), onHost, onSync: (snap, seq) => { addSeatPeers(); onSync(snap, seq); }, ...(termMs ? { termMs } : {}), ...(hbMs ? { hbMs } : {}) });
  if (initial) { rot.epoch = initial.epoch ?? 0; rot.host = rot.roster.has(initial.host) ? initial.host : rot.host; rot.seq = initial.seq ?? 0; rot.snap = initial.snap ?? null; rot.termStart = now(); for (const k of rot.roster.keys()) rot.seen.set(k, now()); }
  const bv = new BatchVerifier(c => rot.roster.get(c));
  const probes = [], rtts = new Map(); let pn = 0, lastProbe = -Infinity, lastAdv = -Infinity, lastBatt = -Infinity, closed = false;
  const commit = () => rot.isHost && rot.commit(match.snapshotAuth());
  const humansOk = p => match.seats.filter(s => !s.ai).every(s => gameCompat(s, p));
  const advertise = () => { const open = match.seats.filter(s => s.ai).length; send({ op: 'tbl', g: match.game, mode: match.mode, band: match.seats.filter(s => !s.ai).some(s => gband(s) === 'minor') ? 'minor' : gband(match.seats.find(s => !s.ai) || match.seats[0]), open, host: code, epoch: rot.epoch, rt: isRealtime(match.game) ? 1 : 0 }); };
  const onMsg = (from, b) => { if (closed || from === code) return; if (b?.op === 'tq' && rot.isHost && b.g === match.game && b.mode === match.mode && match.seats.some(s => s.ai)) { lastAdv = now(); return advertise(); } // 'who has a table?' -> advertise now
    if (b?.mid !== match.id) return;
    if (b.op === 'hr' && b.f === from) { const ms = bv.open(b); if (ms) for (const m of ms) { if (m.snap === undefined && m.t === 'hb') delete m.snap; rot.receive(m, { trusted: true }); } }
    if (b.op === 'join' && b.p?.code === from) { const p = { ...b.p, ai: false };
      if (!humansOk(p)) { if (rot.isHost) send({ op: 'seat', to: from, r: { ok: false, reason: 'band' } }); return; } // never mix adults and minors
      const r = match.join(p); if (r.ok && !r.already && b.p.pub) rot.addPeer(from, b.p.pub);
      if (rot.isHost) { if (r.ok) { commit(); bs.flush(); } send({ op: 'seat', to: from, r, snap: match.snapshotAuth(), roster: Object.fromEntries(rot.roster), epoch: rot.epoch, host: rot.host, seq: rot.seq }); }
      onJoin(b.p, r); }
    if (b.op === 'mv' && b.sm) { const s = match.seats[b.sm.seat]; if (s && !s.ai && s.code === from) { const r = match.receive(b.sm); if (r.ok) { commit(); onMove(from, r); } } }
    if (b.op === 'leave' && rot.roster.has(from)) { rot.removePeer(from); if (rot.isHost) { match.leaveSeat(from); commit(); } else match.pendingHumans = (match.pendingHumans || []).filter(p => p.code !== from); onLeave(from); }
    if (b.op === 'rm' && rot.isHost && rot.roster.has(from) && match.over) { match.rematch(); commit(); onSync(match.snapshotAuth(), rot.seq); }
    if (b.op === 'rp' && rot.roster.has(from)) send({ op: 'ro', to: from, n: b.n });
    if (b.op === 'ro' && b.to === code && rot.roster.has(from)) { const pr = probes.find(x => x.n === b.n); if (pr && !pr.got.has(from) && now() - pr.at <= PROBE_MS) { pr.got.add(from); const a = rtts.get(from) || rtts.set(from, []).get(from); a.push(now() - pr.at); if (a.length > PROBE_WIN) a.shift(); } } };
  const unsub = arcade?.sub?.(onMsg);
  // my link quality = lower median over peers of (per-peer median RTT, per-peer probe loss); a reply later than PROBE_MS counts as lost.
  const measure = () => { const done = probes.filter(x => now() - x.at > PROBE_MS); if (!done.length) return; const peers = [...rot.roster.keys()].filter(c => c !== code); if (!peers.length) return;
    const pings = peers.map(c => rtts.get(c)?.length ? median(rtts.get(c)) : null).filter(x => x != null), losses = peers.map(c => 1 - done.filter(x => x.got.has(c)).length / done.length);
    rot.setMetrics({ ping: pings.length ? lowMedian(pings) : PROBE_MS, loss: lowMedian(losses) }); };
  const tick = () => { if (closed) return; const t = now(), solo = rot.roster.size < 2;
    if (rot.isHost && t - lastAdv >= ADV_MS && match.seats.some(s => s.ai)) { lastAdv = t; advertise(); }
    if (solo) { rot.termStart = t; rot.host = code; return; } // alone with bots: nothing to rotate, no heartbeat traffic
    if (t - lastProbe >= PROBE_MS) { lastProbe = t; probes.push({ n: ++pn, at: t, exp: rot.roster.size - 1, got: new Set() }); if (probes.length > PROBE_WIN + 1) probes.shift(); send({ op: 'rp', n: pn }); measure(); }
    if (battery && t - lastBatt >= BATT_MS) { lastBatt = t; Promise.resolve(battery()).then(m => m && rot.setMetrics(m)).catch(() => {}); }
    rot.tick();
    if (rot.isHost) for (const c of [...rot.roster.keys()]) if (c !== code && t - (rot.seen.get(c) ?? t) > rot.hbMs * rot.missN * 2) { rot.removePeer(c); match.leaveSeat(c); commit(); onLeave(c); } }; // crashed / vanished player -> AI takes the seat
  return { rot, signer: bs, verifier: bv, onMsg, tick, commit, advertise, match,
    requestRematch() { if (rot.isHost || rot.roster.size < 2) { match.rematch(); commit(); return 'local'; } send({ op: 'rm' }); return 'asked'; },
    leave() { if (closed) return; if (rot.isHost && rot.roster.size > 1) rot.handoff('leave'); bs.flush(); if (rot.roster.size > 1) send({ op: 'leave' }); send({ op: 'tblx' }); this.stop(); },
    stop() { if (closed) return; bs.flush(); closed = true; unsub?.(); } };
}
const readBatt = () => readBattery();
// Table board (joiner side): remembers fresh 'tbl' adverts so a player can drop into a running match.
export class TableBoard { constructor(now = () => Date.now(), ttl = ADV_MS * 3) { Object.assign(this, { now, ttl }); this.t = new Map(); }
  seen(from, b) { if (b?.op === 'tblx') { this.t.delete(b.mid); return; } if (b?.op !== 'tbl' || b.host !== from || !b.mid) return; this.t.set(b.mid, { ...b, from, at: this.now() }); }
  find(game, mode, bnd, { isBlocked = () => false, exclude = new Set() } = {}) { const t = this.now();
    return [...this.t.values()].filter(x => t - x.at <= this.ttl && x.g === game && x.mode === mode && x.band === bnd && x.open > 0 && !isBlocked(x.from) && !exclude.has(x.mid)).sort((a, b) => b.at - a.at)[0] || null; } }
// Joiner: ping a table and wait for the host's 'seat' reply (null on timeout / refusal -> caller starts its own table).
export function joinTable({ arcade, table, p, timeoutMs = 3000, timers = globalThis }) { return new Promise(res => { let done = false, unsub = null, h = null;
  const fin = v => { if (done) return; done = true; unsub?.(); if (h) timers.clearTimeout?.(h); res(v); };
  unsub = arcade?.sub?.((from, b) => { if (b?.op === 'seat' && b.mid === table.mid && b.to === p.code && from === table.from) fin(b.r?.ok ? b : null); });
  h = timers.setTimeout?.(() => fin(null), timeoutMs); joinPing(arcade, table.mid, p); }); }
export const tableQuery = (arcade, g, mode) => arcade?.send?.({ op: 'tq', g, mode });
export const joinPing = (arcade, mid, p) => arcade?.send?.({ op: 'join', mid, p: { code: p.code, name: p.name, minor: !!p.minor, xage: !!p.xage, age: p.age, pub: p.pub } });
export { HostRotation };
