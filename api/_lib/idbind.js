// v43 SERVER ID BINDING REGISTRY: one signing key per public ID (and one ID per key), enforced at the single entry point
// (api/_fn/bootstrap.js login / heartbeat / logoff / delete). Proof formats + PoW live in src/idbind.js (shared with phones).
//   bindGate({ code, pub, claim, rot, attested }) -> { ok:true, status:'new'|'same'|'rebound', cert? } | { ok:false, http, error }
// Rules (decided here, stored atomically by the store):
//   * first valid CLAIM (self-signed + proof of work, POW for web / ATTESTED_POW once attestation is real) binds code<->pub;
//   * the same pub again = 'same' (heartbeats); the claim is re-verified every call (k hashes + 1 signature, cheap);
//   * a DIFFERENT pub for a bound ID is refused (409 id-bound) unless
//       - rot: a rotation statement signed by the CURRENT key (src/idbind.js makeRotation) -> instant rebind, or
//       - attested: platform attestation for this ID (HOOK ONLY: api/_fn/attest.js never reports attested yet), or
//       - the current key has been silent for ID_REBIND_IDLE_DAYS (default 14) AND the claim carries the heavier REBIND_POW
//         (same phone after a reinstall: the vault and the old key are gone, the device-derived ID is the same);
//   * a pub already bound to another ID is refused (409 key-bound);
//   * logoff / delete must come from the bound key (no more unsigned logoffs of someone else's presence).
// Stores: MemBindStore (one instance, default) or DbBindStore = service-role RPC public.id_bind (migration
// 20261027000010_id_bindings.sql) when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set. Codes and keys are HMAC-hashed here
// (ID_BIND_SALT, else RL_KEY_SALT, else the service key), never stored raw. DB errors FAIL CLOSED (503: no new entry), the
// same as "server unreachable" for the single entry design.
// Certs: with ID_BIND_SEED (32-byte hex/base64, generate offline, Vercel env only) the server signs {code,pub,att,iat,exp};
// phones verify them with VITE_ID_BIND_PUBKEY. Without it: no certs, peers rely on claims (PoW) + first-seen pins.
// Server-only: never import from src/ (the service key must never reach the app bundle).
import { createHmac } from 'node:crypto';
import { verifyClaim, verifyRotation, makeCert, serverKeysFromSeed, POW, REBIND_POW, ATTESTED_POW } from '../../src/idbind.js';
export const DB_TIMEOUT_MS = 1500, IDLE_DAYS_DEFAULT = 14;
export function bindCfg(e = process.env) {
  const url = String(e.SUPABASE_URL || '').replace(/\/+$/, ''), srk = e.SUPABASE_SERVICE_ROLE_KEY;
  let server = null; try { server = e.ID_BIND_SEED ? serverKeysFromSeed(String(e.ID_BIND_SEED).trim()) : null; } catch { server = null; }
  const idle = Number(e.ID_REBIND_IDLE_DAYS); const idleDays = Number.isFinite(idle) && idle >= 0 ? Math.min(365, idle) : IDLE_DAYS_DEFAULT;
  return { db: /^https?:\/\//.test(url) && srk ? { url, srk, salt: e.ID_BIND_SALT || e.RL_KEY_SALT || srk, timeoutMs: +e.CM_ID_BIND_TIMEOUT_MS || DB_TIMEOUT_MS } : null, server, idleMs: idleDays * 864e5 };
}
export const bindHash = (kind, v, salt) => 'b1' + createHmac('sha256', String(salt)).update('idbind|' + kind + '|' + String(v)).digest('base64url').slice(0, 40);
// op: 'claim' | 'rotate' (old = current pub) | 'idle' | 'attested' | 'check' (no write: 'same'|'unbound'|'other') | 'touch'
export class MemBindStore {
  constructor({ now = () => Date.now(), max = 500_000 } = {}) { Object.assign(this, { now, max }); this.byCode = new Map(); this.byKey = new Map(); this.log = []; }
  async bind({ code, pub, op = 'claim', old = null, idleMs = IDLE_DAYS_DEFAULT * 864e5, att = false }) {
    const t = this.now(), cur = this.byCode.get(code), other = this.byKey.get(pub);
    if (op === 'check' || op === 'touch') { if (!cur) return { status: 'unbound' }; if (cur.pub !== pub) return { status: 'other' }; if (op === 'touch') cur.seen = t; return { status: 'same' }; }
    if (cur && cur.pub === pub) { cur.seen = t; if (att) cur.att = true; return { status: 'same', since: cur.at }; }
    if (other && other !== code) return { status: 'key-bound' };
    if (!cur) { if (this.byCode.size >= this.max) return { status: 'full' }; this.byCode.set(code, { pub, at: t, seen: t, att: !!att, rebinds: 0 }); this.byKey.set(pub, code); return { status: 'new', since: t }; }
    const why = op === 'rotate' && old === cur.pub ? 'rotate' : op === 'attested' && att ? 'attested' : op === 'idle' && t - cur.seen >= idleMs ? 'idle' : null;
    if (!why) return { status: 'id-bound', idleFor: t - cur.seen };
    this.byKey.delete(cur.pub); this.byCode.set(code, { pub, at: t, seen: t, att: !!att, rebinds: cur.rebinds + 1 }); this.byKey.set(pub, code); this.log.push({ code, why, at: t }); if (this.log.length > 1000) this.log.shift();
    return { status: 'rebound', why, since: t };
  }
}
const headers = srk => ({ apikey: srk, 'Content-Type': 'application/json', ...(/^eyJ/.test(srk) ? { Authorization: 'Bearer ' + srk } : {}) });
export class DbBindStore {
  constructor(cfg, { f = globalThis.fetch } = {}) { this.cfg = cfg; this.f = f; this.kind = 'db'; }
  async bind({ code, pub, op = 'claim', old = null, idleMs = IDLE_DAYS_DEFAULT * 864e5, att = false }) {
    const { url, srk, salt, timeoutMs } = this.cfg, ac = typeof AbortController === 'function' ? new AbortController() : null; let timer;
    const timeout = new Promise(r => { timer = setTimeout(() => { ac?.abort(); r({ status: 'error', error: 'timeout' }); }, timeoutMs); });
    const call = (async () => { const r = await this.f(`${url}/rest/v1/rpc/id_bind`, { method: 'POST', headers: headers(srk), signal: ac?.signal,
        body: JSON.stringify({ p_code: bindHash('code', code, salt), p_pub: bindHash('key', pub, salt), p_op: op, p_old: old ? bindHash('key', old, salt) : null, p_idle_secs: Math.max(0, Math.floor(idleMs / 1000)), p_att: !!att }) });
      if (!r?.ok) return { status: 'error', error: 'http ' + (r?.status ?? '?') }; const j = await r.json(); return typeof j?.status === 'string' ? j : { status: 'error', error: 'bad response' }; })().catch(e => ({ status: 'error', error: e?.name || 'fetch' }));
    const res = await Promise.race([call, timeout]); clearTimeout(timer); return res;
  }
}
export const makeBindStore = (cfg = bindCfg()) => cfg.db ? new DbBindStore(cfg.db) : (globalThis.__cmBindMem ||= new MemBindStore());
// ATTESTATION HOOK: returns true only when platform attestation (api/_fn/attest.js verifyAttestation) verified THIS ID.
// Today verifyAttestation always says attested:false (Play Integrity / App Attest need David's Google/Apple accounts), so
// every client pays the web PoW. Do not fake it: plug real verification into api/_fn/attest.js and this starts working.
export const isAttestedFor = (att, code, pub = null) => !!(att && att.attested === true && att.id === code && (!pub || !att.pub || att.pub === pub));
export async function bindGate({ code, pub, claim, rot = null, att = null, store = makeBindStore(), cfg = bindCfg(), now = Date.now() }) {
  const attested = isAttestedFor(att, code, pub), base = attested ? ATTESTED_POW : POW;
  if (!claim) return { ok: false, http: 428, error: 'id binding proof required (bind)' };
  if (!verifyClaim(claim, { code, pub, min: base, now })) return { ok: false, http: 400, error: 'bad id binding proof' };
  let r = await store.bind({ code, pub, op: 'claim', att: attested });
  if (r.status === 'id-bound') { // a different key holds this ID: rotation (old key signed) > attestation > idle + heavier PoW
    if (rot && verifyRotation(rot, { code, pub, now })) r = await store.bind({ code, pub, op: 'rotate', old: rot.old });
    else if (attested) r = await store.bind({ code, pub, op: 'attested', att: true });
    else if (verifyClaim(claim, { code, pub, min: REBIND_POW, now })) r = await store.bind({ code, pub, op: 'idle', idleMs: cfg.idleMs });
  }
  if (r.status === 'error') return { ok: false, http: 503, error: 'id registry unavailable', detail: r.error };
  if (r.status === 'full') return { ok: false, http: 503, error: 'id registry full' };
  if (r.status === 'id-bound') return { ok: false, http: 409, error: 'id-bound', note: 'this ID is bound to another signing key', idleRebindDays: Math.round(cfg.idleMs / 864e5), rebindPow: REBIND_POW };
  if (r.status === 'key-bound') return { ok: false, http: 409, error: 'key-bound', note: 'this signing key is bound to another ID' };
  const out = { ok: true, status: r.status, ...(r.why ? { why: r.why } : {}) };
  if (cfg.server) out.cert = makeCert({ code, pub, att: attested, now }, cfg.server.sec);
  return out;
}
// logoff / delete: only the bound key (or an ID nobody bound yet, e.g. a pre-v43 session) may remove the presence row.
export async function boundOrFree({ code, pub, store = makeBindStore() }) { const r = await store.bind({ code, pub, op: 'check' }); return r.status === 'same' || r.status === 'unbound'; }
export const bindStatus = (cfg = bindCfg()) => ({ store: cfg.db ? 'db' : 'memory', certs: !!cfg.server, certPub: cfg.server?.pub || null, idleRebindDays: Math.round(cfg.idleMs / 864e5), pow: POW, rebindPow: REBIND_POW, attestedPow: ATTESTED_POW });
