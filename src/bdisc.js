// Broadcast profile discovery. A search broadcasts a COARSE, quantized interest vector for the ACTIVE mode only, plus an
// ephemeral one-time reply token (X25519 public key). It carries NO ID key. Receivers compute a dot product against
// their own vector and reply (sealed to the token) only above THRESHOLD. Controls: TTL hop limit, dedupe by query id
// (never forwarded twice), per-forwarder rate limit, skip banned/blocked forwarders, minors never in dating.
import nacl from 'tweetnacl';
export const TTL = 3, THRESHOLD = 0.6, LEVELS = 4, DIM = 16, PER_SENDER_PER_MIN = 6;
const b = u => { let t = ''; for (const x of u) t += String.fromCharCode(x); return btoa(t); }, ub = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const quantize = v => v.slice(0, DIM).map(x => Math.max(0, Math.min(LEVELS - 1, Math.round(x * (LEVELS - 1)))));
export const dot = (a, c) => { let s = 0, na = 0, nc = 0; for (let i = 0; i < Math.min(a.length, c.length); i++) { s += a[i] * c[i]; na += a[i] * a[i]; nc += c[i] * c[i]; } return na && nc ? s / Math.sqrt(na * nc) : 0; };
// band ('m' | 'a', optional): the age band of the query (not an identity). Receivers with a band set never answer or forward
// a query from the other band (strict minor/adult separation, same rule as livemesh.js).
export function makeQuery(mode, vec, { minor = false, band = null } = {}) {
  if (minor && mode === 'dating') throw new Error('no dating discovery for minors');
  const kp = nacl.box.keyPair(); const q = { k: 'bdisc', id: b(nacl.randomBytes(12)), mode, v: quantize(vec), ttl: TTL, rt: b(kp.publicKey), ...(band ? { b: band } : {}) };
  return { q, open: z => { const m = nacl.box.open(ub(z.c), ub(z.n), ub(z.e), kp.secretKey); return m ? JSON.parse(new TextDecoder().decode(m)) : null; } }; // token is one-time: kp is dropped after the search
}
export class BDisc {
  constructor({ myVec, myModes, minor = false, band = null, neutralEmpty = false, isBanned = () => false, isBlocked = () => false, now = () => Date.now(), threshold = THRESHOLD, myStub }) { Object.assign(this, { myVec, myModes, minor, band, neutralEmpty, isBanned, isBlocked, now, threshold, myStub }); this.seen = new Set(); this.rate = new Map(); this.used = new Set(); }
  // via = forwarding peer code (transport-level). Returns { forward?: q', reply?: sealed } (either may be absent)
  onQuery(q, via) {
    if (!q || q.k !== 'bdisc' || typeof q.id !== 'string' || q.id.length > 64 || typeof q.mode !== 'string' || !Array.isArray(q.v) || q.v.length > 64 || !q.v.every(x => Number.isFinite(x)) || this.seen.has(q.id)) return {};
    { let rt = null; try { rt = ub(String(q.rt)); } catch {} if (!rt || rt.length !== 32) return {}; } // malformed reply token: dropped before any crypto
    this.seen.add(q.id); if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2500));
    if (via && (this.isBanned(via) || this.isBlocked(via))) return {};
    if (via) { const t = this.now(), h = (this.rate.get(via) || []).filter(x => t - x < 60e3); if (h.length >= PER_SENDER_PER_MIN) return {}; h.push(t); this.rate.set(via, h); }
    if ('code' in q || 'from' in q || 'id_key' in q) return {}; // a query must never carry an identity
    if (this.band && q.b !== this.band) return {}; // other age band (or no band): never answered, never forwarded
    const out = {}; if (q.ttl > 1) out.forward = { ...q, ttl: q.ttl - 1 };
    if (q.mode === 'dating' && this.minor) return out; // minors never answer dating
    if (!this.myModes.includes(q.mode) || this.used.has(q.rt)) return out;
    const mv = quantize(this.myVec), empty = !mv.some(x => x) || !q.v.some(x => x); // neutralEmpty: a blank interest vector is 'unknown', not 'no match'
    const score = empty && this.neutralEmpty ? this.threshold : dot(mv, q.v); if (score < this.threshold) return out;
    this.used.add(q.rt); const e = nacl.box.keyPair(), n = nacl.randomBytes(24), m = new TextEncoder().encode(JSON.stringify({ stub: this.myStub, score: Math.round(score * 100) / 100 }));
    out.reply = { k: 'bdisc-ans', id: q.id, z: { e: b(e.publicKey), n: b(n), c: b(nacl.box(m, n, ub(q.rt), e.secretKey)) } }; return out;
  }
}
// ---- v38: LIVE WIRING (app-mesh.js). Queries and answers ride the shared broadcast bus as bare {k:'bdisc'} / {k:'bdisc-ans'}
// packets: no envelope, no sender ID, no signature of the searcher (the envelope would carry `from`). Every phone on the
// channel already hears a query directly, so TTL forwarding is NOT re-posted here (dedupe by query id still applies; the
// forward hop is for multi-hop transports). Answers carry only the responder's SIGNED SOFT-TAG packet (livemesh.js pkt,
// ~300 B) sealed to the one-time token; the searcher feeds it to LiveNode.consider(), which re-checks size, band, block/ban,
// signature + TOFU pin and mode/score. The full profile still only moves on tap (pget -> pfull). Answers are sent after a
// random 0..REPLY_JITTER_MS offset (staggered, no burst at the searcher); the searcher opens at most MAX_ANS per query and
// drops the one-time key after QUERY_TTL_MS. No message of any kind is sent to anyone: a hit only enters the bucket.
export const REPLY_JITTER_MS = 1500, MAX_ANS = 200, QUERY_TTL_MS = 30e3;
export class BDiscWire {
  constructor({ post, live, vecOf, myModes, minor = false, band = null, now = () => Date.now(), rand = Math.random, delay = (f, ms) => setTimeout(f, ms), onHit = () => {} }) {
    Object.assign(this, { post, live, vecOf, myModes, minor, band, now, rand, delay, onHit }); this.pending = new Map(); this.stats = { queries: 0, answered: 0, opened: 0, hits: 0, stale: 0 };
    this.bd = new BDisc({ myVec: vecOf(), myModes: myModes(), minor, band, neutralEmpty: true, now, myStub: live.pkt }); }
  _expire() { const t = this.now(); for (const [id, p] of this.pending) if (t - p.at > QUERY_TTL_MS) this.pending.delete(id); }
  search(mode) { this._expire(); if (this.minor && mode === 'dating') return null; const { q, open } = makeQuery(mode, this.vecOf(), { minor: this.minor, band: this.band });
    this.bd.seen.add(q.id); this.pending.set(q.id, { open, mode, n: 0, at: this.now() }); this.stats.queries++; this.post({ k: 'bdisc', q }); return q.id; }
  onQuery(q) { this.bd.myStub = this.live.pkt; this.bd.myVec = this.vecOf(); this.bd.myModes = this.myModes(); let r = {}; try { r = this.bd.onQuery(q, null); } catch { return {}; }
    if (r.reply) { this.stats.answered++; this.delay(() => this.post(r.reply), Math.floor(this.rand() * REPLY_JITTER_MS)); } return r; }
  onAnswer(a) { const p = this.pending.get(a?.id); if (!p) return false; if (this.now() - p.at > QUERY_TTL_MS) { this.pending.delete(a.id); this.stats.stale++; return false; } if (p.n >= MAX_ANS) return false;
    let m = null; try { m = p.open(a.z); } catch {} if (!m?.stub) return false; p.n++; this.stats.opened++;
    const ok = p.mode === this.live.mode && this.live.consider(m.stub); if (ok) { this.stats.hits++; this.onHit(m.stub.sp.code, m.score); } return ok; }
}
