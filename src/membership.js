// On-phone peer discovery: sharded epidemic gossip membership (SWIM-style suspicion + incarnations).
// Server = tiny stateless rendezvous (Rendezvous below): hands out a few seed peer codes per shard; stores nothing durable.
// Rows carry NO IP/ICE data — those are exchanged only at connect time over signaling.
import nacl from 'tweetnacl';
import { b64, unb64 } from './vault.js';
export const LINKS = 4, MIN_SHARD_PEERS = 3, GLOBAL = 'global', DEFAULT_SHARD_THRESHOLD = 100_000, HYSTERESIS = 0.1;
// Tuned for 20k-user full lists (see scripts/sim-20k.mjs): lazy push (ids first, rows on request) lets fanout/TTL be high cheaply.
export const FANOUT = 5, TTL = 16, SUSPECT_REPORTS = 2, SUSPECT_TIMEOUT_MS = 30e3, INACTIVE_DROP_MS = 2 * 864e5;
// CFG: batchMs = gossip batching window (ids aggregated into one 'ihave' per window; leading edge flushes immediately when idle);
// settleMs = rows newer than this are left out of anti-entropy digests (they are still in flight via push); syncMs = catch-up interval;
// buckets = digest buckets; wantTimeoutMs = re-ask another announcer if a requested row didn't arrive.
import { decodeEntry } from './banlist.js';
export const CFG = { batchMs: 5e3, settleMs: 20e3, syncMs: 60e3, buckets: 128, wantTimeoutMs: 3e3, sliceTimeoutMs: 4e3, storeMs: 60e3, maxTags: 3 };
const ROW_FIELDS = ['code', 'shard', 'cell', 'tags', 'inc', 'ts', 'pub', 'state', 'mood']; // mood: session-only (src/mood.js)
// ---- shards ----
const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
export function geohash(lat, lng, prec = 3) { // prec 3 ≈ 156 km cells, 2 ≈ 1250 km
  let a = [-90, 90], o = [-180, 180], h = '', bit = 0, ch = 0, even = true;
  while (h.length < prec) { const r = even ? o : a, v = even ? lng : lat, m = (r[0] + r[1]) / 2; if (v >= m) { ch = ch * 2 + 1; r[0] = m; } else { ch *= 2; r[1] = m; } even = !even; if (++bit === 5) { h += B32[ch]; bit = 0; ch = 0; } }
  return h;
}
// Adaptive mode: below threshold everyone keeps the FULL list (one global shard); above it, sharded lists + long links.
// Hysteresis band (±10%) prevents flapping around the threshold.
export function nextMode(cur, activeEstimate, threshold = DEFAULT_SHARD_THRESHOLD, h = HYSTERESIS) {
  if (cur !== 'sharded' && activeEstimate > threshold * (1 + h)) return 'sharded';
  if (cur === 'sharded' && activeEstimate < threshold * (1 - h)) return 'global';
  return cur || (activeEstimate > threshold ? 'sharded' : 'global');
}
export function shardsFor(p, { prec = 3, mode = 'sharded' } = {}) {
  if (mode === 'global') return { shards: [GLOBAL], cell: Number.isFinite(p.lat) ? geohash(p.lat, p.lng, prec) : (p.countryCode || 'xx').toLowerCase() };
  const out = [], cell = Number.isFinite(p.lat) ? geohash(p.lat, p.lng, prec) : (p.countryCode || 'xx').toLowerCase();
  for (const m of p.lookingFor || []) {
    if (m === 'gaming') for (const g of p.games || []) out.push('gaming:' + String(g).toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    else out.push(`${m}:${cell}`);
  }
  return { shards: [...new Set(out)], cell };
}
// ---- signed rows / control messages ----
const canon = (o, f) => new TextEncoder().encode(JSON.stringify(f.map(k => [k, o[k] ?? null])));
const vcache = new Map(); // SIMULATION SPEED-UP ONLY (shared across simulated phones); real phones verify individually
// Ed25519 is pluggable: tweetnacl for sync paths; WebCrypto Ed25519 (Chrome 137+, Safari 17+, Node 20+) for lazy async verification
// when available (~50-100x faster than tweetnacl JS). Tests can inject node:crypto via setEd25519.
let ED = { sign: (msg, sec) => nacl.sign.detached(msg, sec), verify: (msg, sig, pub) => nacl.sign.detached.verify(msg, sig, pub), keyPair: () => nacl.sign.keyPair() }, custom = false;
export const setEd25519 = impl => { ED = impl; custom = true; vcache.clear(); };
let wc; // undefined = unknown, false = unsupported, else SubtleCrypto
async function webcrypto() {
  if (wc !== undefined) return wc; const sub = globalThis.crypto?.subtle; wc = false;
  try { const k = nacl.sign.keyPair(), m = new Uint8Array([1]), key = await sub.importKey('raw', k.publicKey, { name: 'Ed25519' }, false, ['verify']);
    if (await sub.verify({ name: 'Ed25519' }, key, nacl.sign.detached(m, k.secretKey), m)) wc = sub; } catch {}
  return wc;
}
export const hasWebCryptoEd25519 = async () => !!(await webcrypto());
function verify(o, f, pub) { const msg = canon(o, f), k = o.sig + '|' + pub + '|' + new TextDecoder().decode(msg); if (vcache.has(k)) return vcache.get(k); let ok = false; try { ok = ED.verify(msg, unb64(o.sig), unb64(pub)); } catch {} if (vcache.size > 2e5) vcache.clear(); vcache.set(k, ok); return ok; }
async function verifyAsync(o, f, pub) {
  const sub = custom ? null : await webcrypto(); if (!sub) return verify(o, f, pub);
  try { const key = await sub.importKey('raw', unb64(pub), { name: 'Ed25519' }, false, ['verify']); return await sub.verify({ name: 'Ed25519' }, key, unb64(o.sig), canon(o, f)); } catch { return false; }
}
const sign = (o, f, sec) => ({ ...o, sig: b64(ED.sign(canon(o, f), sec)) });
export const verifyRow = r => verify(r, ROW_FIELDS, r.pub);
export const verifyRowAsync = r => verifyAsync(r, ROW_FIELDS, r.pub);
export const validRow = r => r && Object.keys(r).every(k => ROW_FIELDS.includes(k) || k === 'sig') && /^[A-Z0-9]{4,16}$/.test(r.code);
const SUS_FIELDS = ['target', 'inc', 'reporter', 'shard', 'ts'];
const ver = r => r.inc * 1e13 + r.ts;
const t36 = t => Number.isInteger(t) ? t.toString(36) : t, p36 = t => typeof t === 'string' ? parseInt(t, 36) : t; // sim clocks are fractional
// compact wire encoding (positional arrays, base36 ts, 'global' shard as 0); pub omitted where the receiver must already have it pinned
export function encodeRow(r, omitPub = false) { return [r.code, r.shard === GLOBAL ? 0 : r.shard, r.cell, r.tags?.length ? r.tags : 0, r.inc, t36(r.ts), omitPub ? 0 : r.pub, r.state === 'alive' ? 0 : r.state === 'left' ? 1 : r.state, r.sig]; }
export function decodeRow(a, pubOf = () => null) { const [code, sh, cell, tags, inc, ts, pub, st, sig] = a; return { code, shard: sh === 0 ? GLOBAL : sh, cell, tags: tags === 0 ? [] : tags, inc, ts: p36(ts), pub: pub === 0 ? pubOf(code) : pub, state: st === 0 ? 'alive' : st === 1 ? 'left' : st, sig }; }
const encSus = s => [s.target, s.inc, s.reporter, s.shard === GLOBAL ? 0 : s.shard, t36(s.ts), s.sig];
const decSus = a => ({ target: a[0], inc: a[1], reporter: a[2], shard: a[3] === 0 ? GLOBAL : a[3], ts: p36(a[4]), sig: a[5] });
const fnv = (str, h = 0x811c9dc5) => { for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; };
export const itemId = sig => fnv(sig).toString(36).padStart(7, '0').slice(-6); // short gossip id (6 chars, ~31 bits; a rare collision is repaired by anti-entropy)

export class Member {
  constructor({ code, profile = {}, now, net, rng = Math.random, keys = ED.keyPair(), mode = 'global', later }) {
    Object.assign(this, { code, now, net, rng, keys }); this.pub = b64(keys.publicKey);
    this.later = later || (net?.push ? (ms, fn) => net.push(net.t + ms, fn) : (ms, fn) => setTimeout(fn, ms));
    this.profile = profile; this.mode = mode; this.links = new Set(); this.lookups = new Map();
    const { shards, cell } = shardsFor(profile, { mode }); this.shards = shards; this.cell = cell; this.tags = mode === 'global' ? [] : (profile.games || []).slice(0, CFG.maxTags); // tags only route sharded gaming lists; omitted in full-list mode
    this.inc = 0; this.active = new Map(); this.inactive = new Map(); this.seen = new Set(); this.suspects = new Map(); this.pins = new Map(); this.recvAt = new Map();
    this.verified = new WeakSet(); this.fallback = new Map(); this.prevVer = new Map(); // lazy verification state; digest versions for in-flight rows
    this.banlist = null; this.onBan = () => {}; // optional gossiped signed ban list (src/banlist.js); hash rides on 'pull'
    this.outbox = []; this.store = new Map(); this.wanted = new Map(); this.flushT = false; this.lastFlush = -Infinity; this.afterSlice = null;
    this.sent = 0; this.alive = true; this.lastSync = {};
  }
  row(shard, state = 'alive') { const o = { code: this.code, shard, cell: this.cell, tags: this.tags, inc: this.inc, ts: this.now(), pub: this.pub, state }; if (this.mood && state === 'alive') o.mood = this.mood; return sign(o, ROW_FIELDS, this.keys.secretKey); }
  key(shard, code) { return shard + '|' + code; }
  peers(shard, exclude = new Set()) { const out = []; for (const r of this.active.values()) if (r.shard === shard && r.code !== this.code && !exclude.has(r.code)) out.push(r.code); return out; }
  pick(arr, n) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); }
  targets(shard, n, exclude = new Set()) { return this.pick(this.peers(shard, exclude), n); }
  send(to, m) { this.sent++; this.net.deliver(this.code, to, m); }
  spread(m, exclude) { for (const p of this.targets(m.shard, FANOUT, exclude)) this.send(p, m); }
  // ---- lazy push gossip: new rows/suspicions are queued, ids announced in one batched 'ihave' per window, rows pulled by 'iwant' ----
  enqueue(kind, obj, shard, ttl) { const id = itemId(obj.sig); this.seen.add(id); this.store.set(id, { kind, obj, shard, at: this.now() }); if (ttl > 1) { this.outbox.push({ id, shard, ttl: ttl - 1 }); this.scheduleFlush(); } }
  scheduleFlush() { if (this.flushT) return; this.flushT = true; this.later(Math.max(0, this.lastFlush + CFG.batchMs - this.now()), () => this.flush()); }
  flush() {
    this.flushT = false; if (!this.alive) return; this.lastFlush = this.now(); const by = new Map();
    for (const o of this.outbox) { const g = by.get(o.shard) || {}; (g[o.ttl] ||= []).push(o.id); by.set(o.shard, g); } this.outbox = [];
    for (const [shard, ids] of by) for (const p of this.targets(shard, FANOUT)) this.send(p, { t: 'ihave', shard, ids, from: this.code });
    const old = this.now() - CFG.storeMs; for (const [id, e] of this.store) { if (e.at >= old) break; this.store.delete(id); }
    if (this.seen.size > 5e5) this.seen = new Set([...this.seen].slice(-2e5));
  }
  // ---- join: full list from ONE seed, bucket digest sync with the others, then epidemic 'join' ----
  async join(rendezvous) {
    for (const shard of this.shards) {
      const seeds = rendezvous.seeds(shard, this.code);
      if (seeds.length) { if (this.peers(shard).length >= MIN_SHARD_PEERS) for (const sd of seeds) this.syncWith(shard, sd); else this.askSlice(shard, seeds); } // from the server listrom a server snapshot: digest-sync only
      const own = this.row(shard); this.accept(own); this.store.set(itemId(own.sig), { kind: 'r', obj: own, shard, at: this.now() });
      const m = { t: 'join', id: itemId(own.sig), shard, row: own, ttl: TTL, from: this.code };
      this.seen.add(m.id); for (const s of this.pick(seeds, FANOUT)) this.send(s, m); // seeds are the first hop until we have a slice
      rendezvous.register(shard, this.code);
    }
  }
  askSlice(shard, seeds) { // full list from ONE seed; if it doesn't answer, try the next one
    (this.afterSlice ||= {})[shard] = seeds.slice(1); this.send(seeds[0], { t: 'slice-req', shard, from: this.code });
    this.later(CFG.sliceTimeoutMs, () => { const rest = this.afterSlice?.[shard]; if (rest?.length && this.alive) this.askSlice(shard, rest); });
  }
  leave() { for (const shard of this.shards) { const r = this.row(shard, 'left'); const m = { t: 'leave', id: itemId(r.sig), shard, row: r, ttl: TTL, from: this.code }; this.seen.add(m.id); this.spread(m, new Set()); } this.alive = false; } // eager first hop: we're gone and can't serve iwant
  // lazy failure detection: contact attempt got no answer
  contactFailed(code, shard) {
    const r = this.active.get(this.key(shard, code)); if (!r) return;
    const s = sign({ target: code, inc: r.inc, reporter: this.code, shard, ts: this.now() }, SUS_FIELDS, this.keys.secretKey);
    this.onSuspect(s); this.enqueue('s', s, shard, TTL + 1);
  }
  // ---- lazy verification: rows are accepted (and can be filtered/matched) unverified; verify on display/contact/state change ----
  check(r) { if (this.verified.has(r)) return true; const ok = verify(r, ROW_FIELDS, r.pub); if (ok) this.verified.add(r); return ok; } // keyed by row object (not sig: a copied sig must not inherit trust)
  isVerified(code, shard = this.shards[0]) { const r = this.active.get(this.key(shard, code)); return !!r && this.verified.has(r); }
  async ensureVerified(codes, shard = this.shards[0]) { // for Discover rows on screen, contact attempts; returns codes that verified
    const ok = [];
    for (const c of codes) { const k = this.key(shard, c), r = this.active.get(k); if (!r) continue; if (this.verified.has(r)) { ok.push(c); continue; }
      if (await verifyAsync(r, ROW_FIELDS, r.pub)) { this.verified.add(r); ok.push(c); continue; }
      if (this.active.get(k) !== r) continue; this.active.delete(k); const fb = this.fallback.get(k); this.fallback.delete(k); // forged: drop, restore last verified version
      if (fb) this.active.set(k, fb); else if (this.pins.get(c) === r.pub) this.pins.delete(c); }
    return ok;
  }
  accept(r, { verifyNow = false } = {}) { // newer incarnation wins; same inc: newer ts wins; 'left' beats 'alive' at same inc
    if (!validRow(r) || !r.pub || this.banlist?.isBanned(r.code)) return false; // banned codes are never (re)listed or relayed
    const bk = this.keyOf?.(r.code); if (bk && bk !== r.pub) return false; // v43: row must carry the key this ID is bound to (src/idbind.js)
    const pin = this.pins.get(r.code); if (pin && pin !== r.pub && !(bk && bk === r.pub)) return false; // key pinned on first sight (TOFU)
    const k = this.key(r.shard, r.code), cur = this.active.get(k) || this.inactive.get(k);
    if (cur && (r.inc < cur.inc || (r.inc === cur.inc && r.ts <= cur.ts && !(r.state === 'left' && cur.state !== 'left')))) return false;
    if ((verifyNow || r.state !== 'alive' || r.code === this.code) && !this.check(r)) return false; // state changes are verified now
    this.pins.set(r.code, r.pub);
    if (cur) { this.prevVer.set(k, this.prevVer.get(k) ?? ver(cur)); if (this.verified.has(cur)) this.fallback.set(k, cur); }
    if (r.state === 'left') { this.active.delete(k); this.toInactive(r); return true; }
    this.inactive.delete(k); this.active.set(k, r); this.recvAt.set(k, this.now());
    const s = this.suspects.get(k); if (s && r.inc > s.inc) this.suspects.delete(k); return true;
  }
  toInactive(r) { const k = this.key(r.shard, r.code); this.recvAt.set(k, this.now()); this.inactive.set(k, r.state === 'left' ? r : { code: r.code, shard: r.shard, cell: r.cell, inc: r.inc, ts: r.ts, pub: r.pub, state: 'offline' }); } // stub only (signed 'left' row kept so it can be re-gossiped)
  onSuspect(s) {
    const k = this.key(s.shard, s.target), r = this.active.get(k);
    if (s.target === this.code) { if (s.inc >= this.inc && this.alive) this.refute(s.shard); return; }
    if (!r || s.inc < r.inc) return;
    const e = this.suspects.get(k) || { inc: s.inc, reporters: new Set(), since: this.now() }; e.reporters.add(s.reporter); this.suspects.set(k, e);
    if (e.reporters.size >= SUSPECT_REPORTS) this.markOffline(k);
  }
  markOffline(k) { const r = this.active.get(k); if (r) { this.active.delete(k); this.toInactive(r); } this.suspects.delete(k); }
  refute(shard) { this.inc++; const r = this.row(shard); this.accept(r); const m = { t: 'alive', id: itemId(r.sig), shard, row: r, ttl: TTL, from: this.code }; this.seen.add(m.id); this.spread(m, new Set()); }
  tick() { // suspicion timeout + inactive expiry
    const n = this.now(); for (const [k, e] of this.suspects) if (n - e.since > SUSPECT_TIMEOUT_MS) this.markOffline(k);
    for (const [k, r] of this.inactive) if (n - r.ts > INACTIVE_DROP_MS) this.inactive.delete(k);
    for (const [k, v] of this.prevVer) { const r = this.active.get(k) || this.inactive.get(k); if (!r || n - r.ts > CFG.settleMs) this.prevVer.delete(k); }
  }
  // ---- adaptive mode switch: re-shard and re-join (old shard rows dropped) ----
  async setMode(mode, rendezvous) {
    if (mode === this.mode) return false; this.mode = mode; const { shards } = shardsFor(this.profile, { mode }); this.shards = shards; this.tags = mode === 'global' ? [] : (this.profile.games || []).slice(0, CFG.maxTags);
    for (const [k, r] of this.active) if (!shards.includes(r.shard)) this.active.delete(k);
    this.inc++; await this.join(rendezvous); return true;
  }
  // ---- long links: a few random cross-shard peers (random peer sampling) ----
  addLinks(codes) { for (const c of codes) if (c !== this.code) this.links.add(c); while (this.links.size > LINKS) this.links.delete(this.pick([...this.links], 1)[0]); }
  refreshLinks() { const l = this.pick([...this.links], 1)[0]; if (l) this.send(l, { t: 'shuffle', links: this.pick([...this.links, this.code], LINKS), from: this.code }); }
  lookup(shard, ttl = 6) { const id = this.code + ':' + shard + ':' + this.now(); this.seen.add(id); for (const l of this.links) this.send(l, { t: 'lookup', id, shard, origin: this.code, ttl, from: this.code }); }
  maintain(rendezvous) {
    for (const shard of this.shards) {
      if (this.peers(shard).length < MIN_SHARD_PEERS) { const seeds = rendezvous?.seeds(shard, this.code) || []; if (seeds.length) this.askSlice(shard, seeds); else this.lookup(shard); }
      for (const l of this.links) this.syncWith(shard, l);
      rendezvous?.checkIn(shard, this.code, this.now());
    }
    this.refreshLinks();
  }
  warmStart(rows) { let n = 0; for (const r of rows) if (this.shards.includes(r.shard) && this.accept(r)) n++; return n; }
  snapshotRows() { return [...this.active.values()]; }
  // ---- anti-entropy with compact digests: per-bucket hashes -> versions of mismatched buckets only -> exact rows ----
  // Rows changed within settleMs are hashed at their previous version (or skipped if new), so in-flight pushes don't cause diffs.
  digestEntries(shard) {
    const cut = this.now() - CFG.settleMs, out = new Map();
    for (const m of [this.active, this.inactive]) for (const [k, r] of m) { if (r.shard !== shard) continue;
      if (r.ts <= cut) out.set(r.code, ver(r)); else { const p = this.prevVer.get(k); if (p != null && p % 1e13 <= cut) out.set(r.code, p); } }
    return out;
  }
  bucketOf(code) { return fnv(code) % CFG.buckets; }
  buckets(entries) { const h = new Array(CFG.buckets).fill(0); for (const [c, v] of entries) { const b = this.bucketOf(c); h[b] = (h[b] + fnv(c + ':' + v)) >>> 0; } return h; }
  digest(shard) { return this.buckets(this.digestEntries(shard)).map(x => x.toString(36)); }
  syncWith(shard, to) { const p = to || this.targets(shard, 1)[0]; if (p) this.send(p, { t: 'pull', shard, h: this.digest(shard), ...(this.banlist ? { bh: this.banlist.hash() } : {}), from: this.code }); }
  rowsFor(shard, codes, omitPubLeft = false) { const out = []; for (const c of codes) { const k = this.key(shard, c), r = this.active.get(k) || this.inactive.get(k); if (r?.sig) out.push(['r', encodeRow(r, omitPubLeft && r.state === 'left')]); } return out; }
  takeBatch(items, ttlOf = () => 1) {
    for (const [kind, a] of items) {
      if (kind === 'r') { const r = decodeRow(a, c => this.pins.get(c)); if (!r.pub || !this.shards.includes(r.shard)) continue; const id = itemId(r.sig), ttl = ttlOf(id); this.wanted.delete(id); this.seen.add(id); if (this.accept(r)) this.enqueue('r', r, r.shard, ttl); }
      else if (kind === 's') { const s = decSus(a), id = itemId(s.sig), ttl = ttlOf(id); this.wanted.delete(id); if (this.seen.has(id) && ttl <= 1) continue; this.seen.add(id); const pub = this.pins.get(s.reporter);
        if (pub && this.shards.includes(s.shard) && verify(s, SUS_FIELDS, pub)) { this.onSuspect(s); this.enqueue('s', s, s.shard, ttl); } }
    }
  }
  async mergeBans(entries) { const n = await this.banlist.merge(entries); if (!n) return 0; for (const [k, r] of this.active) if (this.banlist.isBanned(r.code)) this.active.delete(k); this.onBanList?.(n); return n; }
  receive(m) {
    if (!this.alive) return; // dead/closed phone
    if (this.banlist && m.from && this.banlist.isBanned(m.from)) return this.onBan(m.from); // refuse banned peers (caller sends them the signed kill)
    if (this.banlist && m.t === 'pull' && m.bh && m.bh !== this.banlist.hash()) this.send(m.from, { t: 'bl-idx', idx: this.banlist.index(), from: this.code }); // hashes differ -> exchange index
    if (m.t === 'bl-idx' && this.banlist) { const { push, want } = this.banlist.diff(m.idx); if (push.length) this.send(m.from, { t: 'bl', e: push, from: this.code }); if (want.length) this.send(m.from, { t: 'bl-want', codes: want, from: this.code }); return; }
    if (m.t === 'bl-want' && this.banlist) { const e = this.banlist.encoded(m.codes); if (e.length) this.send(m.from, { t: 'bl', e, from: this.code }); return; }
    if (m.t === 'bl' && this.banlist) { this.mergeBans(m.e.map(decodeEntry)); return; }
    if (m.t === 'shuffle') { const mine = this.pick([...this.links, this.code], LINKS); this.addLinks(m.links); if (!m.reply) this.send(m.from, { t: 'shuffle', links: mine, reply: true, from: this.code }); return; }
    if (m.t === 'lookup') { if (this.seen.has(m.id)) return; this.seen.add(m.id);
      if (this.shards.includes(m.shard)) return this.send(m.origin, { t: 'seeds', shard: m.shard, seeds: [this.code, ...this.pick(this.peers(m.shard), 3)], from: this.code });
      if (m.ttl > 1) for (const l of this.links) if (l !== m.from) this.send(l, { ...m, ttl: m.ttl - 1, from: this.code }); return; }
    if (m.t === 'seeds') { if (this.shards.includes(m.shard)) { this.askSlice(m.shard, m.seeds); for (const s of m.seeds) { const r = this.row(m.shard); this.send(s, { t: 'join', id: itemId(r.sig), shard: m.shard, row: r, ttl: TTL, from: this.code }); } } return; }
    if (m.shard && !this.shards.includes(m.shard) && ['slice-req', 'pull', 'pull2', 'iwant', 'ihave', 'batch'].includes(m.t)) return;
    if (m.t === 'slice-req') { const rows = [...this.active.values()].filter(r => r.shard === m.shard).map(r => encodeRow(r)); return this.send(m.from, { t: 'slice', shard: m.shard, rows: [...rows, encodeRow(this.row(m.shard))], from: this.code }); }
    if (m.t === 'slice') { for (const a of m.rows) { const r = decodeRow(a); if (this.shards.includes(r.shard)) this.accept(r); }
      const rest = this.afterSlice?.[m.shard]; if (rest) { delete this.afterSlice[m.shard]; for (const s of rest) this.syncWith(m.shard, s); } return; }
    if (m.t === 'pull') { const mine = this.digest(m.shard), diff = []; for (let b = 0; b < mine.length; b++) if (mine[b] !== m.h?.[b]) diff.push(b); if (!diff.length) return;
      const D = new Set(diff), vv = []; for (const [c, v] of this.digestEntries(m.shard)) if (D.has(this.bucketOf(c))) vv.push([c, t36(v)]);
      return this.send(m.from, { t: 'pull2', shard: m.shard, b: diff, vv, from: this.code }); }
    if (m.t === 'pull2') { const D = new Set(m.b), theirs = new Map(m.vv.map(([c, v]) => [c, p36(v)])), mine = this.digestEntries(m.shard), push = [], want = [];
      for (const [c, v] of mine) if (D.has(this.bucketOf(c)) && !(theirs.get(c) >= v)) push.push(c);
      for (const [c, v] of theirs) if (!(mine.get(c) >= v)) want.push(c);
      const rows = this.rowsFor(m.shard, push); if (rows.length) this.send(m.from, { t: 'batch', shard: m.shard, items: rows, from: this.code });
      if (want.length) this.send(m.from, { t: 'iwant', shard: m.shard, codes: want, from: this.code }); return; }
    if (m.t === 'ihave') { const want = [], t = this.now();
      for (const [ttl, ids] of Object.entries(m.ids)) for (const id of ids) { if (this.seen.has(id)) continue; const w = this.wanted.get(id); if (w && t - w.at < CFG.wantTimeoutMs) continue; this.wanted.set(id, { ttl: +ttl, at: t }); want.push(id); }
      if (want.length) this.send(m.from, { t: 'iwant', shard: m.shard, ids: want, from: this.code }); return; }
    if (m.t === 'iwant') { const items = m.codes ? this.rowsFor(m.shard, m.codes) : [];
      for (const id of m.ids || []) { const e = this.store.get(id); if (!e) continue; items.push(e.kind === 'r' ? ['r', encodeRow(e.obj, e.obj.state === 'left')] : ['s', encSus(e.obj)]); }
      if (items.length) this.send(m.from, { t: 'batch', shard: m.shard, items, from: this.code }); return; }
    if (m.t === 'batch') return this.takeBatch(m.items, id => this.wanted.get(id)?.ttl ?? 1);
    // eager single-message forms (first hop of own join/leave/refute, legacy peers); forwarding continues lazily
    if (this.seen.has(m.id)) return; this.seen.add(m.id);
    if (!this.shards.includes(m.shard)) return; // not our shard
    if (m.t === 'join' || m.t === 'alive' || m.t === 'leave') { if (m.t === 'leave' && m.row?.code === this.code) return; if (this.accept(m.row, { verifyNow: m.t !== 'join' })) this.enqueue('r', m.row, m.shard, m.ttl); }
    if (m.t === 'suspect') { const pub = this.pins.get(m.sus?.reporter); if (pub && verify(m.sus, SUS_FIELDS, pub)) { this.onSuspect(m.sus); this.enqueue('s', m.sus, m.shard, m.ttl); } }
  }
}
// Stateless-ish rendezvous: bounded in-memory LRU of recent seeds per shard (no durable storage, no IPs).
// Seeds are returned PER REQUESTED SHARD only (never "any recent device"), refreshed by periodic check-ins, expired after SEED_TTL.
export const SEED_TTL_MS = 10 * 60e3;
export class Rendezvous {
  constructor(per = 8, now = () => Date.now()) { this.per = per; this.m = new Map(); this.now = now; this.down = new Set(); }
  seeds(shard, exclude, n = 3) { if (this.down.has(shard)) return []; const t = this.now(); return (this.m.get(shard) || []).filter(e => e.code !== exclude && t - e.at < SEED_TTL_MS).slice(-n).map(e => e.code); }
  checkIn(shard, code, at = this.now()) { const a = (this.m.get(shard) || []).filter(e => e.code !== code); a.push({ code, at }); this.m.set(shard, a.slice(-this.per)); }
  register(shard, code) { this.checkIn(shard, code); }
  estimate() { return [...this.m.values()].reduce((a, x) => a + x.length, 0); } // coarse; real estimate comes from signed app_config / server counters
}
// Discrete-event network for simulation (latency 20–120 ms).
export class SimNet {
  constructor(rng) { this.rng = rng; this.t = 0; this.q = []; this.nodes = new Map(); this.delivered = 0; }
  now = () => this.t;
  deliver(from, to, m) { const n = this.nodes.get(to); if (!n) return; this.push(this.t + 20 + this.rng() * 100, () => { this.delivered++; n.receive(m); }); }
  push(at, fn) { const q = this.q; q.push({ at, fn }); let i = q.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (q[p].at <= q[i].at) break; [q[p], q[i]] = [q[i], q[p]]; i = p; } }
  pop() { const q = this.q, top = q[0], last = q.pop(); if (q.length) { q[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < q.length && q[l].at < q[s].at) s = l; if (r < q.length && q[r].at < q[s].at) s = r; if (s === i) break; [q[s], q[i]] = [q[i], q[s]]; i = s; } } return top; }
  run(until = Infinity) { while (this.q.length && this.q[0].at <= until) { const e = this.pop(); this.t = e.at; e.fn(); } if (Number.isFinite(until) && until > this.t) this.t = until; }
}
export const seededRng = (s = 42) => () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
// Browser hook: signed leave on close/hidden.
export function wireLeave(member, rendezvous, target = globalThis) { const f = () => member.alive && member.leave(); target.addEventListener?.('pagehide', f);
  target.document?.addEventListener?.('visibilitychange', () => { if (target.document.visibilityState === 'hidden') f(); else if (!member.alive) { member.alive = true; member.inc++; member.join(rendezvous); } }); } // re-join with higher incarnation when visible again
