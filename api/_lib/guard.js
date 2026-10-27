// Middleware for EVERY api/ route: per-IP and per-ID rate limits, body-size cap, optional US-only gate, global-halt guard.
//   export default withGuards(handler, { name, perMin, perIdPerMin, maxBody, geo, halt })
// Rate limits are TWO layers (v40):
//   1) per-instance in-memory sliding window (hit(): cheap, always on, refuses floods before any network call)
//   2) GLOBAL fixed window shared by every serverless instance: Supabase RPC public.rl_hit (api/_lib/globalrl.js,
//      migration 20261027000008). Fails safe to layer 1 if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing or the DB is
//      slow (>350 ms) / unreachable. Vercel Firewall rate-limit rules in front are still recommended (docs/SUPABASE-DAY-CHECKLIST.md).
import { geoOf, geoDecision } from './geo.js';
import { haltGuard } from './mod.js';
import { globalHit } from './globalrl.js';
const STORE = globalThis.__cmRate ||= new Map();
export function hit(key, perMin, now = Date.now(), store = STORE, windowMs = 60e3) {
  const h = (store.get(key) || []).filter(t => now - t < windowMs); if (h.length >= perMin) { store.set(key, h); return false; }
  h.push(now); store.set(key, h); if (store.size > 20000) for (const k of [...store.keys()].slice(0, 5000)) store.delete(k); return true;
}
// Both layers for one key: false = refuse (429). Global layer unavailable (null) -> the local result stands.
export async function allow(key, perWindow, { windowSecs = 60, now = Date.now(), store = STORE, gHit = globalHit } = {}) {
  if (!hit(key, perWindow, now, store, windowSecs * 1000)) return false;
  return (await gHit(key, perWindow, windowSecs)) !== false;
}
export const ipOf = req => String(req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'] || '').split(',')[0].trim() || 'unknown';
export const idOf = req => { const b = req.body && typeof req.body === 'object' ? req.body : {}; const v = req.query?.code || b.code || b.user_code; return v ? String(v).slice(0, 64) : null; };
export function withGuards(handler, { name = 'api', perMin = 30, perIdPerMin = null, maxBody = 64 * 1024, geo = false, halt = false } = {}) {
  return async function guarded(req, res, ...rest) {
    const ip = ipOf(req), id = idOf(req), now = Date.now();
    const ipKey = `${name}|ip|${ip}`, idKey = id && perIdPerMin ? `${name}|id|${id}` : null;
    if (!hit(ipKey, perMin, now)) return res.status(429).json({ error: 'rate limited' }); // layer 1: this instance
    if (idKey && !hit(idKey, perIdPerMin, now)) return res.status(429).json({ error: 'rate limited (id)' });
    const [gIp, gId] = await Promise.all([globalHit(ipKey, perMin, 60), idKey ? globalHit(idKey, perIdPerMin, 60) : null]); // layer 2: all instances
    if (gIp === false) return res.status(429).json({ error: 'rate limited', global: true });
    if (gId === false) return res.status(429).json({ error: 'rate limited (id)', global: true });
    const len = +(req.headers?.['content-length'] || 0) || (req.body && typeof req.body === 'object' ? JSON.stringify(req.body).length : typeof req.body === 'string' ? req.body.length : 0);
    if (maxBody && len > maxBody) return res.status(413).json({ error: 'payload too large', max: maxBody });
    if (halt && await haltGuard(res)) return;
    if (geo) { const g = geoDecision({ country: geoOf(req) }); if (!g.allow) return res.status(451).json({ geo: 'non-us', notice: g.notice }); }
    return handler(req, res, ...rest);
  };
}
