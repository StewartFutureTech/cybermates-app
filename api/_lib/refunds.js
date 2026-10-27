// Boost refund ledger for the MESH path (server side; boost credits only, NO Stripe / real-money calls).
// A boost is refunded only when the recipient's SIGNED delivery receipt is ABSENT after RCPT_TIMEOUT_MS. A relay's claim counts
// for nothing; only the recipient's Ed25519 receipt (verified against the recipient's key from the server super list) blocks a
// refund. v41 makes it CONSERVATIVE and shared:
//   * idempotent per message id; unknown / someone else's message -> no refund; delivered -> no refund
//   * per-sender caps: REFUND_DAILY_CAP refunds and REGISTER_DAILY_CAP registrations per rolling 24 h (over the cap -> 'capped')
//   * shared by every Vercel instance through the service-role RPC public.mesh_refund (migration 20261027000009) when
//     SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set; user codes are HMAC-hashed before they leave this process
//   * FAIL CLOSED: if that shared store is slow/unreachable the answer is 'unavailable' (no refund), never a free credit
//   * without Supabase env (dev / preview today) an in-memory store with the same rules is used (per instance)
// The Supabase account path (public.boost_ledger) refunds inside the database instead: app.boost_refund_decide.
import nacl from 'tweetnacl';
import { createHmac } from 'node:crypto';
export const RCPT_TIMEOUT_MS = 8000, REFUND_DAILY_CAP = 10, REGISTER_DAILY_CAP = 300, RETAIN_MS = 8 * 864e5, DAY_MS = 864e5, MEM_MAX = 50000, DB_TIMEOUT_MS = 1500;
const stable = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : 1)) : x);
const u = s => new Uint8Array(Buffer.from(s, 'base64'));
export const verifyReceipt = (r, pub) => { try { return nacl.sign.detached.verify(new TextEncoder().encode(stable({ rcpt: r.msgId, from: r.from, to: r.to })), u(r.sig), u(pub)); } catch { return false; } };
export const MSG_RE = /^[A-Za-z0-9+/=_-]{6,40}$/, CODE_RE = /^[A-Za-z0-9+/=_-]{3,64}$/;

// Same rules as public.mesh_refund, in memory (one instance). now() is injectable for tests.
export class MemRefundStore {
  constructor({ now = () => Date.now(), cap = REFUND_DAILY_CAP, regCap = REGISTER_DAILY_CAP, max = MEM_MAX } = {}) { Object.assign(this, { now, cap, regCap, max }); this.kind = 'memory'; this.m = new Map(); }
  prune(t) { if (this.m.size < this.max) return; for (const [k, e] of this.m) if (t - e.at > RETAIN_MS) this.m.delete(k); if (this.m.size >= this.max) for (const k of [...this.m.keys()].slice(0, Math.ceil(this.max / 10))) this.m.delete(k); }
  count(from, f) { let n = 0; for (const e of this.m.values()) if (e.from === from && f(e)) n++; return n; }
  async op(op, { msgId, from, to, minAgeMs = RCPT_TIMEOUT_MS }) {
    const t = this.now();
    if (op === 'register') { this.prune(t); if (!to || to === from) return { ok: false, reason: 'bad request' };
      if (this.count(from, e => t - e.at < DAY_MS) >= this.regCap) return { ok: false, reason: 'register cap' };
      if (this.m.has(msgId)) return { ok: false, reason: 'dup' }; this.m.set(msgId, { from, to, at: t, rcpt: null, refunded: null }); return { ok: true }; }
    const e = this.m.get(msgId); if (!e || e.from !== from || (op === 'receipt' && e.to !== to)) return { ok: false, reason: 'unknown' };
    if (op === 'receipt') { e.rcpt ??= t; return { ok: true }; }
    if (op !== 'claim') return { ok: false, reason: 'bad op' };
    if (e.refunded != null) return { ok: true, already: true }; if (e.rcpt != null) return { ok: false, reason: 'delivered' };
    if (t - e.at < Math.max(minAgeMs, 1000)) return { ok: false, reason: 'too early' };
    if (this.count(from, x => x.refunded != null && t - x.refunded < DAY_MS) >= this.cap) return { ok: false, reason: 'capped' };
    e.refunded = t; return { ok: true, refunded: true };
  }
}

// Shared store: Supabase RPC public.mesh_refund (service role). Codes are HMAC-SHA256'd here, never stored raw.
export function refundCfg(e = process.env) {
  if (/^(memory|mem|off)$/i.test(String(e.CM_REFUND_STORE || ''))) return null;
  const url = String(e.SUPABASE_URL || '').replace(/\/+$/, ''), srk = e.SUPABASE_SERVICE_ROLE_KEY;
  return /^https?:\/\//.test(url) && srk ? { url, srk, salt: e.REFUND_KEY_SALT || e.RL_KEY_SALT || srk, timeoutMs: +e.CM_REFUND_TIMEOUT_MS || DB_TIMEOUT_MS } : null;
}
export const codeHash = (code, salt) => 'r1' + createHmac('sha256', String(salt)).update('refund|' + String(code)).digest('base64url').slice(0, 40);
const headers = srk => ({ apikey: srk, 'Content-Type': 'application/json', ...(/^eyJ/.test(srk) ? { Authorization: 'Bearer ' + srk } : {}) });
export class DbRefundStore {
  constructor(cfg, f = globalThis.fetch) { this.cfg = cfg; this.f = f; this.kind = 'supabase'; }
  async op(op, { msgId, from, to, minAgeMs = RCPT_TIMEOUT_MS }) {
    const { url, srk, salt, timeoutMs } = this.cfg, ac = typeof AbortController === 'function' ? new AbortController() : null; let timer;
    const timeout = new Promise(r => { timer = setTimeout(() => { ac?.abort(); r(null); }, timeoutMs || DB_TIMEOUT_MS); });
    const call = (async () => {
      const r = await this.f(`${url}/rest/v1/rpc/mesh_refund`, { method: 'POST', headers: headers(srk), signal: ac?.signal,
        body: JSON.stringify({ p_op: op, p_msg: msgId, p_from: codeHash(from, salt), p_to: to ? codeHash(to, salt) : null, p_min_age_ms: Math.max(1000, Math.floor(minAgeMs)) }) });
      if (!r?.ok) return null; const j = await r.json(); return j && typeof j.ok === 'boolean' ? j : null;
    })().catch(() => null);
    const res = await Promise.race([call, timeout]); clearTimeout(timer);
    return res || { ok: false, reason: 'unavailable' }; // fail CLOSED: no shared ledger answer -> no refund
  }
}
export const makeRefundStore = ({ cfg = refundCfg(), f = globalThis.fetch, now } = {}) => cfg ? new DbRefundStore(cfg, f) : new MemRefundStore({ now });

export class RefundLedger {
  constructor({ pubOf = async () => null, now = () => Date.now(), pay = async () => ({ ok: true, stub: true }), store = null } = {}) {
    Object.assign(this, { pubOf, now, pay }); this.store = store || new MemRefundStore({ now }); }
  static valid({ msgId, from, to } = {}, needTo = false) { return MSG_RE.test(msgId || '') && CODE_RE.test(from || '') && (!needTo || CODE_RE.test(to || '')); }
  async register(b = {}) { if (!RefundLedger.valid(b, true)) return { ok: false, reason: 'bad request' }; return this.store.op('register', b); }
  async receipt({ msgId, from, to, sig } = {}) { if (!RefundLedger.valid({ msgId, from, to }, true) || typeof sig !== 'string') return { ok: false, reason: 'bad receipt' };
    const pub = await this.pubOf(to); if (!pub || !verifyReceipt({ msgId, from, to, sig }, pub)) return { ok: false, reason: 'bad receipt' };
    return this.store.op('receipt', { msgId, from, to }); }
  async claim({ msgId, from } = {}) { if (!RefundLedger.valid({ msgId, from })) return { ok: false, reason: 'unknown' };
    const r = await this.store.op('claim', { msgId, from, minAgeMs: RCPT_TIMEOUT_MS }); if (!r.ok || r.already || !r.refunded) return r;
    const p = await this.pay({ refund: 'boost', msgId, to: from }); return { ok: !!p.ok, refunded: true }; } // pay = boost-credit stub (no Stripe)
}
