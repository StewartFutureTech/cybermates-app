// UX §6-8 + §12 THE LIVING MESH. Transport-agnostic (send(to, msg) / receive(from, msg)); used by app-mesh.js over the
// E2E mesh envelope type 'lm', and by scripts/sim-livemesh.mjs with 300-1000 simulated nodes.
//  - BUCKET: each node keeps <= BUCKET_MAX (~200) of its highest-match peers; the set keeps shifting (tentacles + presence).
//  - PRESENCE: signed SOFT-TAG packet (a few compact soft numbers, ~200-300 B). Rebroadcast forever to the bucket, staggered
//    (random start offset + jitter), adaptive interval (MIN when the bucket is churning, backs off to MAX when stable),
//    piggybacked onto any other packet already going to that peer in the current window.
//  - FULL PROFILE: never floods the mesh. Sent on request (pget -> pfull) when someone taps OR (v51) when soft match
//    clears BOTH sides' per-mode mins — then hard-checked locally before Discover may show them.
//  - TENTACLES: each tick a node asks one random bucket member (or a random rendezvous peer) for its best few peers; any that
//    beat the weakest bucket member are pulled in and the weakest dropped. Clumps of like-minded people form.
//  - SWIPE: left = pass(): drop from bucket, never re-admit, send 'cut' (they drop us too), tentacle refills the slot.
//    right = like(): wants to talk (app sends the bare connection request).
//  - SEARCH: multi-hop query into neighbouring buckets with criteria {mode, band, gender (dating only), gaming, min %}.
//  - GUARDS at EVERY hop: strict minor/adult band (a packet or query from the other band is dropped, never forwarded),
//    blocks + bans, signatures (mesh.js verified-signature cache), ConnCap, per-sender token bucket (shield.js PER_SENDER),
//    fixed-size check (shield.js fixedSize/MAX_PKT), battery/data-saver scaling.
import { signProfile, verifyProfile } from './mesh.js';
import { ConnCap } from './conncap.js';
import { PER_SENDER, fixedSize } from './shield.js';
import { minFor, DEFAULT_MIN, score as hardScore, fromPacket, matchPacket, compareFor } from './match-v2.js';
export { DEFAULT_MIN, minFor }; // v51: Discover / search share these
export const BUCKET_MAX = 200, TENT_K = 6, MIN_IV = 4e3, MAX_IV = 60e3, SEARCH_TTL = 4, SEARCH_FAN = 4, PGET_TIMEOUT = 4000, SOFT_PKT_MAX = 512;
export const DIMS = ['gamer', 'platforms', 'ballSports', 'outdoor', 'events', 'music', 'religious', 'job', 'drinks', 'smokes', 'kids', 'left', 'right', 'night', 'pets', 'travel'];
const W = { // per-mode weight of each soft dimension (UX §5: gaming = gaming fields; friends low religion; dating full)
  dating: [1, .6, 1, 1, .8, 1, 1, .8, .8, .9, 1, 1, 1, .6, .6, .8],
  friends: [.8, .5, .8, .8, .8, .8, .15, .1, .3, .3, 0, .2, .2, .6, .5, .6],
  gaming: [1, 1, 0, 0, 0, .2, 0, 0, 0, 0, 0, 0, 0, .8, 0, 0] };
export const MODE_BIT = { friends: 1, gaming: 2, dating: 4 };
const clamp3 = x => Math.max(0, Math.min(3, Math.round(x)));
export const encodeVec = v => { let h = ''; for (let i = 0; i < DIMS.length; i += 2) h += ((clamp3(v[i] ?? 0) << 2) | clamp3(v[i + 1] ?? 0)).toString(16); return h; }; // 16 dims x 2 bits = 8 hex chars
export const decodeVec = h => { const o = []; for (let i = 0; i < 8; i++) { const n = parseInt(h[i] || '0', 16); o.push((n >> 2) & 3, n & 3); } return o; };
export const ageBucket = a => a < 18 ? 0 : a < 25 ? 1 : a < 35 ? 2 : a < 50 ? 3 : 4;
const lv = x => (Array.isArray(x) ? x.length : x ? 1 : 0);
// Profile -> soft tags (the only matching data that circulates during discovery). Religion is a single 0/3 soft bit, never the value.
export function softTags(p = {}) { const f = { ...p, ...(p.f || {}), ...(p.mp?.f || {}) }, sp = (f.sports || []).map(s => String(s).toLowerCase()), age = Number(p.age);
  const v = [Math.min(3, lv(f.games) + lv(f.favGames)), Math.min(3, lv(f.platforms)), sp.some(s => /ball|soccer|hockey/.test(s)) ? 3 : 0, sp.some(s => /hik|gym|run|skate|outdoor/.test(s)) ? 3 : 0, Math.min(3, lv(f.events)), Math.min(3, lv(f.interests)),
    /agnostic|atheist|^$|prefer/.test(String(f.religion || '').toLowerCase()) ? 0 : 3, f.job && f.job !== 'none' ? 3 : 0, f.drinking === 'yes' ? 3 : f.drinking === 'sometimes' ? 2 : 0, f.smoking === 'yes' ? 3 : 0, f.kids === 'yes' ? 3 : 0,
    f.politics === 'liberal' ? 3 : 0, f.politics === 'conservative' ? 3 : 0, 0, 0, 0];
  const minor = p.minor === true || (Number.isFinite(age) && age < 18), modes = (p.lookingFor || []).filter(m => !(minor && m === 'dating'));
  // v51: per-mode min % rides with soft tags so BOTH sides' mins can be checked before a full-profile exchange
  const n = [minFor(p, 'dating'), minFor(p, 'friends'), minFor(p, 'gaming')];
  return { b: minor ? 'm' : 'a', m: modes.reduce((s, m) => s | (MODE_BIT[m] || 0), 0), g: String(p.gender || '').slice(0, 1), a: Number.isFinite(age) ? ageBucket(age) : 2, o: lv(f.games) ? 1 : 0, v: encodeVec(v), n }; }
// Soft match 0..100, or null when they may never be matched (cross band, mode off, dating gender filter).
export const MODE_MIN_IDX = { dating: 0, friends: 1, gaming: 2 };
export function softMinOf(tags, mode) { const i = MODE_MIN_IDX[mode]; if (i == null) return DEFAULT_MIN[mode] ?? 0; const n = tags?.n; const v = Array.isArray(n) ? Number(n[i]) : Number(n?.[mode]); return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : (DEFAULT_MIN[mode] ?? 0); }
export function softClearsBoth(score, me, them, mode) { if (score == null) return false; return score >= softMinOf(me, mode) && score >= softMinOf(them, mode); }
export function softMatch(me, them, mode = 'friends', seek = null) {
  if (!me || !them || me.b !== them.b) return null; const bit = MODE_BIT[mode] || 1; if (!(me.m & bit) || !(them.m & bit)) return null;
  if (mode === 'dating' && (me.b === 'm' || (seek?.length && !seek.includes(them.g)))) return null;
  const a = decodeVec(me.v), c = decodeVec(them.v), w = W[mode] || W.friends; let s = 0, tot = 0;
  for (let i = 0; i < DIMS.length; i++) { s += w[i] * (1 - Math.abs(a[i] - c[i]) / 3); tot += w[i]; }
  return Math.round(100 * (s / (tot || 1)) ** 2); } // squared: spreads 'random stranger' (~35%) from 'same nest' (~75-95%)
export const pktBytes = o => new TextEncoder().encode(JSON.stringify(o)).length;
export const POWER = { normal: { iv: 1, fan: 1, ttl: SEARCH_TTL }, saver: { iv: 3, fan: .5, ttl: 2 }, critical: { iv: 6, fan: .25, ttl: 1 } };
export function powerLevel({ battery = 1, charging = false, saveData = false, metered = false } = {}) { if (charging && !saveData) return 'normal'; if (battery < .15) return 'critical'; if (battery < .3 || saveData || metered) return 'saver'; return 'normal'; }
export class LiveNode {
  constructor({ code, keys, profile = {}, full = null, mode = 'friends', seek = null, send, now = () => Date.now(), rand = Math.random, isBanned = () => false, isBlocked = () => false, isOnline = () => true, bucketMax = BUCKET_MAX, rendezvous = () => [], capMax, onEvent = () => {}, timer = (f, ms) => setTimeout(f, ms) }) {
    Object.assign(this, { timer, code, keys, mode, seek, now, rand, isBanned, isBlocked, isOnline, bucketMax, rendezvous, onEvent, out: send });
    this.tags = softTags(profile); this.full = full || profile; this.rev = 0; this.sign();
    this.bucket = new Map(); // code -> { sp, pub, score, at }
    this.fullCache = new Map(); // code -> hard-checked full profile (v51 soft→hard)
    this.softPassed = new Set(); // codes whose soft score cleared both mins
    this.pins = new Map(); this.rejected = new Set(); this.liked = new Set(); this.waiters = new Map(); this.seenQ = new Set(); this.results = new Map();
    this.cap = new ConnCap({ target: bucketMax, max: capMax ?? bucketMax * 2, now, pinned: c => this.bucket.has(c) });
    this.rate = new Map(); this.stats = { sent: 0, bytes: 0, piggy: 0, maxPkt: 0, dropped: { band: 0, sig: 0, rate: 0, block: 0, size: 0 } };
    this.churn = 0; this.iv = MIN_IV; this.power = 'normal'; this.lastTo = new Map(); this.nextAt = now() + rand() * MIN_IV; // random stagger offset
  }
  sign() { this.sp = signProfile(this.code, this.rev, this.tags, this.keys.sec); this.pkt = { sp: this.sp, k: this.keys.pub }; }
  setMode(mode, seek = this.seek) { if (mode === this.mode && seek === this.seek) return; this.mode = mode; this.seek = seek; for (const [c, e] of this.bucket) { const s = softMatch(this.tags, e.sp.profile, mode, seek); if (s == null) this.bucket.delete(c); else e.score = s; } this.churn += 10; }
  setPower(st) { this.power = typeof st === 'string' ? st : powerLevel(st); }
  get P() { return POWER[this.power] || POWER.normal; }
  _send(to, msg) { const n = pktBytes(msg); this.stats.sent++; this.stats.bytes += n; if (msg.t === 'pres' || msg.t === 'tent') this.stats.maxPkt = Math.max(this.stats.maxPkt, n); if (n > (this.stats.maxAny || 0)) this.stats.maxAny = n; this.lastTo.set(to, this.now()); this.out(to, msg); }
  // piggyback: a peer we already sent something to inside this window gets the presence attached to that packet instead
  _withPres(to, msg) { const t = this.lastPres?.get(to) || 0; if (this.now() - t >= this.iv) { (this.lastPres ||= new Map()).set(to, this.now()); this.stats.piggy++; return { ...msg, pres: this.pkt }; } return msg; }
  // ---- admission (every packet, every hop): size, rate, block/ban, band, signature, TOFU pin
  _rateOk(c) { const t = this.now(); let b = this.rate.get(c); if (!b) this.rate.set(c, b = { tok: PER_SENDER.burst, t }); b.tok = Math.min(PER_SENDER.burst, b.tok + (t - b.t) * PER_SENDER.rate / 1000); b.t = t; if (b.tok < 1) return false; b.tok--; return true; }
  _admit(p) { const sp = p?.sp, c = sp?.code; if (!c || c === this.code) return null; const D = this.stats.dropped;
    if (pktBytes(p) > SOFT_PKT_MAX || !fixedSize(JSON.stringify(p))) { D.size++; return null; }
    if (this.isBanned(c) || this.isBlocked(c) || this.rejected.has(c)) { D.block++; return null; }
    if (sp.profile?.b !== this.tags.b) { D.band++; return null; } // strict minor/adult separation
    const bk = this.keyOf?.(c); if (bk && bk !== p.k) { D.sig++; this.bindDrops = (this.bindDrops || 0) + 1; return null; } // v43: advert must use the key this ID is bound to (src/idbind.js)
    const pin = this.pins.get(c); if (pin && pin !== p.k && !(bk && bk === p.k)) { D.sig++; return null; }
    if (!verifyProfile(sp, p.k)) { D.sig++; return null; } this.pins.set(c, p.k); return sp; }
  consider(p) { const sp = this._admit(p); if (!sp) return false; const c = sp.code, s = softMatch(this.tags, sp.profile, this.mode, this.seek); if (s == null) return false;
    if (softClearsBoth(s, this.tags, sp.profile, this.mode)) { this.softPassed.add(c); if (!this.fullCache.has(c) && !this._fullPending?.has(c)) this._requestFull(c); } // v51: soft→hard
    const cur = this.bucket.get(c); if (cur) { cur.at = this.now(); if (sp.rev >= cur.sp.rev) { cur.sp = sp; cur.score = s; } return false; }
    if (this.bucket.size >= this.bucketMax) { const w = this.weakest(); if (!w || w.score >= s) return false; this.bucket.delete(w.code); this.cap.drop(w.code); }
    this.bucket.set(c, { sp, pub: p.k, score: s, at: this.now() }); for (const x of this.cap.touch(c)) this.bucket.delete(x); this.churn++; return true; }
  _requestFull(c) { (this._fullPending ||= new Set()).add(c);
    this.openProfile(c).then(r => { this._fullPending.delete(c); if (!r?.online || !r.profile) return;
      // Hard check locally before Discover may show them (deal breakers / soft-vs-hard / hidden penalty).
      const full = { ...r.profile, id: c, code: c, age: r.profile.age ?? (this.bucket.get(c)?.sp?.profile?.a), minor: this.tags.b === 'm' || r.profile.minor };
      const meFull = this.full || {}; const how = compareFor(meFull, this.mode); const pct = hardScore(meFull, full, this.mode, { how });
      if (pct == null || pct < softMinOf(this.tags, this.mode)) return; // hard failed or below my min — do not surface
      this.fullCache.set(c, { profile: full, pct, how, at: this.now() }); this.onEvent('full', c, pct); }).catch(() => this._fullPending?.delete(c)); }
  weakest() { let w = null; for (const [code, e] of this.bucket) if (!w || e.score < w.score) w = { code, score: e.score }; return w; }
  avgMatch() { let s = 0; for (const e of this.bucket.values()) s += e.score; return this.bucket.size ? s / this.bucket.size : 0; }
  top(n = TENT_K, forTags = this.tags, mode = this.mode, seek = null, exclude) { const out = []; for (const e of this.bucket.values()) { if (e.sp.code === exclude) continue; const s = softMatch(forTags, e.sp.profile, mode, seek); if (s != null) out.push([s, e]); } return out.sort((a, b) => b[0] - a[0]).slice(0, n).map(x => ({ sp: x[1].sp, k: x[1].pub })); }
  // ---- scheduler: call tick() often (sim: every virtual 1s; app: from its heartbeat). Adaptive, staggered, power-scaled.
  tick() { const t = this.now(); if (t < this.nextAt) return false; this.broadcast(); this.tentacle(); this.sweep();
    const shifting = this.churn > Math.max(2, this.bucket.size * 0.03); this.iv = shifting ? MIN_IV : Math.min(MAX_IV, this.iv * 1.6); this.churn = 0;
    this.nextAt = t + this.iv * this.P.iv * (0.8 + 0.4 * this.rand()); return true; }
  broadcast() { const t = this.now(); for (const c of this.bucket.keys()) { if (t - (this.lastPres?.get(c) || 0) < this.iv / 2) continue; /* already rode on other traffic this window */ (this.lastPres ||= new Map()).set(c, t); this._send(c, { t: 'pres', pres: this.pkt }); } }
  tentacle() { const fan = Math.max(1, Math.round(2 * this.P.fan)), ks = [...this.bucket.keys()], rv = this.rendezvous(this) || [];
    for (let i = 0; i < fan; i++) { const pool = (this.bucket.size < this.bucketMax || this.rand() < .25) && rv.length ? rv : ks; const c = pool[Math.floor(this.rand() * pool.length)]; if (c && c !== this.code && !this.rejected.has(c)) this._send(c, this._withPres(c, { t: 'tent', pres: this.pkt })); } }
  sweep() { const t = this.now(); for (const [c, e] of this.bucket) if (t - e.at > MAX_IV * 6 || !this.isOnline(c)) { this.bucket.delete(c); this.cap.drop(c); this.churn++; } }
  // ---- swipe
  pass(c) { this.rejected.add(c); this.bucket.delete(c); this.cap.drop(c); this.churn += 3; this._send(c, { t: 'cut' }); this.nextAt = this.now(); this.onEvent('passed', c); }
  like(c) { this.liked.add(c); this.onEvent('liked', c); return { code: c, wantsToTalk: true }; }
  // ---- search: criteria { mode, gender (dating only), gaming (1|0), min }. Age band is always MY band (never selectable).
  search(crit = {}, onResult = () => {}) { const mode = crit.mode || this.mode; const min = crit.min != null ? crit.min : softMinOf(this.tags, mode); // v51: never default to 0 when profile/DEFAULT_MIN exists
    const q = { id: this.code + ':' + Math.floor(this.rand() * 1e9).toString(36), crit: { mode, min, ...(mode === 'dating' && crit.gender ? { g: crit.gender } : {}), ...(crit.gaming != null ? { o: crit.gaming ? 1 : 0 } : {}), ...(crit.age != null ? { a: crit.age } : {}) }, src: this.pkt, ttl: Math.min(SEARCH_TTL, this.P.ttl), hop: 0 };
    this.seenQ.add(q.id); this.results.set(q.id, { onResult, found: new Map() }); for (const m of this._local(q)) this._hit(q.id, m, 0); this._fwd(q); return q.id; }
  _match(q, e) { const cr = q.crit, tg = e.sp.profile, s = softMatch(q.src.sp.profile, tg, cr.mode, cr.g ? [cr.g] : null); if (s == null || s < cr.min) return null; if (cr.o != null && tg.o !== cr.o) return null; if (cr.a != null && tg.a !== cr.a) return null; return s; }
  _local(q) { const out = []; for (const e of this.bucket.values()) { if (e.sp.code === q.src.sp.code) continue; const s = this._match(q, e); if (s != null) out.push({ sp: e.sp, k: e.pub, s }); } return out.sort((a, b) => b.s - a.s).slice(0, 10); }
  _fwd(q) { if (q.ttl <= 0) return; const fan = Math.max(1, Math.round(SEARCH_FAN * this.P.fan)); for (const n of this.top(fan, q.src.sp.profile, q.crit.mode, q.crit.g ? [q.crit.g] : null, q.src.sp.code)) this._send(n.sp.code, { t: 'q', q: { ...q, ttl: q.ttl - 1, hop: q.hop + 1 } }); }
  _hit(id, m, hop) { const r = this.results.get(id); if (!r || r.found.has(m.sp.code) || m.sp.code === this.code) return; const sp = this._admit(m); if (!sp) return; r.found.set(sp.code, { code: sp.code, score: m.s, hop, tags: sp.profile }); r.onResult(r.found.get(sp.code)); }
  // ---- full profile on tap: request + online check in one round trip
  openProfile(c, timeout = PGET_TIMEOUT) { return new Promise(res => { if (this.rejected.has(c) || this.isBlocked(c) || this.isBanned(c)) return res({ online: false, reason: 'blocked' });
    const id = Math.floor(this.rand() * 1e9).toString(36), t = this.timer(() => { if (!this.waiters.has(id)) return; this.waiters.delete(id); res({ online: false, reason: 'offline' }); }, timeout); t?.unref?.();
    this.waiters.set(id, r => { this.waiters.delete(id); res(r); }); this._send(c, { t: 'pget', id, pres: this.pkt }); }); }
  // ---- receive
  receive(from, m) { if (!m || typeof m !== 'object' || from === this.code) return; if (!this._rateOk(from)) { this.stats.dropped.rate++; return; }
    if (this.isBanned(from) || this.isBlocked(from)) { this.stats.dropped.block++; return; }
    if (m.pres && m.pres.sp?.code !== from) return; // a presence must be the sender's own
    if (m.pres) this.consider(m.pres);
    if (this.rejected.has(from) && m.t !== 'cut') return;
    const known = this.bucket.get(from) || (m.pres && this.pins.get(from) === m.pres.k && m.pres.sp.profile.b === this.tags.b); // band known for this sender
    switch (m.t) {
      case 'tent': if (!known) return; this._send(from, this._withPres(from, { t: 'tent-ans', peers: this.top(TENT_K, m.pres.sp.profile, this.mode, null, from) })); break;
      case 'tent-ans': for (const p of (m.peers || []).slice(0, TENT_K)) this.consider(p); break;
      case 'cut': if (this.bucket.delete(from)) { this.cap.drop(from); this.churn++; } break;
      case 'q': { const q = m.q; if (!q?.id || this.seenQ.has(q.id) || !known) return; this.seenQ.add(q.id); if (this.seenQ.size > 4000) this.seenQ = new Set([...this.seenQ].slice(-2000));
        const src = this._admit(q.src); if (!src || src.code === this.code) return; // band + sig + block checked on the ORIGINATOR too, every hop
        const hits = this._local(q).filter(h => !this.rejected.has(h.sp.code)); if (hits.length) this._send(src.code, { t: 'qa', id: q.id, hop: q.hop, hits });
        this._fwd(q); break; }
      case 'qa': for (const h of (m.hits || []).slice(0, 10)) this._hit(m.id, h, (m.hop || 0) + 1); break;
      case 'pget': { if (!known || !this.isOnline(this.code)) return; const sp = signProfile(this.code, this.rev, this.full, this.keys.sec); this._send(from, { t: 'pfull', id: m.id, sp, k: this.keys.pub }); break; }
      case 'pfull': { const w = this.waiters.get(m.id); if (!w) return; const pin = this.pins.get(from); if (m.sp?.code !== from || (pin && pin !== m.k) || !verifyProfile(m.sp, m.k)) return w({ online: false, reason: 'bad-signature' }); w({ online: true, profile: m.sp.profile }); break; }
    }
  }
}
