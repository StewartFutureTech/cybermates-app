// v40 GLOBAL rate limits: one counter shared by every Vercel serverless instance (not per instance).
// Backed by the Supabase RPC public.rl_hit (migration 20261027000008_global_rate_limits.sql): fixed window, atomic
// upsert-increment, service-role only, private table app.rate_limit_buckets with auto-cleanup.
//   globalHit(key, limit, windowSecs) -> true (allowed) | false (over the global limit) | null (global layer unavailable)
// FAIL SAFE: null when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing, CM_GLOBAL_RL=off, the RPC errors, or it takes
// longer than RL_TIMEOUT_MS. Callers then rely on the per-instance in-memory limiter (always applied first, api/_lib/guard.js).
// After a failure the DB is skipped for RL_COOLDOWN_MS so a down/slow database never adds latency to every request.
// Keys are HMAC-SHA256'd here (secret = RL_KEY_SALT, else the service key) so raw IPs / IDs are never stored in the table.
// Server-only: never import from src/ (the service key must never reach the app bundle).
import { createHmac } from 'node:crypto';
export const RL_TIMEOUT_MS = 350, RL_COOLDOWN_MS = 30e3;
export const RL_STATE = globalThis.__cmGlobalRl ||= { downUntil: 0, ok: 0, fail: 0, last: null };
export function rlCfg(e = process.env) {
  if (/^(0|off|false|no)$/i.test(String(e.CM_GLOBAL_RL || ''))) return null;
  const url = String(e.SUPABASE_URL || '').replace(/\/+$/, ''), srk = e.SUPABASE_SERVICE_ROLE_KEY;
  return /^https?:\/\//.test(url) && srk ? { url, srk, salt: e.RL_KEY_SALT || srk, timeoutMs: +e.CM_GLOBAL_RL_TIMEOUT_MS || RL_TIMEOUT_MS } : null;
}
// 'help|ip|1.2.3.4' -> 'help|ip|<hmac>' (readable route/kind prefix, hashed subject). Always <= 200 chars.
export function rlKey(key, salt) {
  const s = String(key), i = s.lastIndexOf('|'), prefix = i >= 0 ? s.slice(0, Math.min(i + 1, 80)) : '';
  return prefix + createHmac('sha256', String(salt)).update(s).digest('base64url').slice(0, 43);
}
const headers = srk => ({ apikey: srk, 'Content-Type': 'application/json', ...(/^eyJ/.test(srk) ? { Authorization: 'Bearer ' + srk } : {}) }); // sb_secret_ keys go in apikey only
export async function globalHit(key, limit, windowSecs = 60, { cfg = rlCfg(), f = globalThis.fetch, now = Date.now(), state = RL_STATE } = {}) {
  if (!cfg || typeof f !== 'function' || !(limit >= 1)) return null;
  if (now < state.downUntil) return null; // cooling down after a failure: local limiter only
  const ac = typeof AbortController === 'function' ? new AbortController() : null; let timer;
  const timeout = new Promise(r => { timer = setTimeout(() => { ac?.abort(); r('timeout'); }, cfg.timeoutMs || RL_TIMEOUT_MS); });
  const call = (async () => {
    const r = await f(`${cfg.url}/rest/v1/rpc/rl_hit`, { method: 'POST', headers: headers(cfg.srk), signal: ac?.signal,
      body: JSON.stringify({ p_key: rlKey(key, cfg.salt), p_limit: Math.min(1e6, Math.floor(limit)), p_window_secs: Math.max(1, Math.min(86400, Math.floor(windowSecs))) }) });
    if (!r?.ok) return 'http ' + (r?.status ?? '?');
    const j = await r.json(); return typeof j?.allowed === 'boolean' ? j : 'bad response';
  })().catch(e => 'error ' + (e?.name || 'fetch'));
  const res = await Promise.race([call, timeout]); clearTimeout(timer);
  if (res && typeof res === 'object') { state.ok++; state.last = null; return res.allowed; }
  state.fail++; state.last = res; state.downUntil = now + RL_COOLDOWN_MS; return null;
}
export const rlStatus = () => ({ configured: !!rlCfg(), ok: RL_STATE.ok, fail: RL_STATE.fail, coolingDown: Date.now() < RL_STATE.downUntil, last: RL_STATE.last });
