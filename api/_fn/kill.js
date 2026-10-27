// Admin mesh-wide kill relay. Accepts ONLY an already-signed control message whose Ed25519 signature verifies against
// VITE_KILL_PUBKEY (the private key never reaches the server or the bundle — possession of it is the authorization).
// Order: 1) kill_switch record (bootstrap refuses all joins from now on) 2) Realtime 'control' 3) mesh gossip. See api/_lib/mod.js.
import { withGuards } from '../_lib/guard.js';
import { env, ADMIN_NONCES, verifyAdminMsg, meshKill, rateLimitGlobal } from '../_lib/mod.js';
const hits = globalThis.__cmKillHits ||= new Map();
async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!(await rateLimitGlobal(hits, 'kill-admin', String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'x'))) return res.status(429).json({ error: 'rate limited' });
  const cfg = env(); if (!cfg.pub || !cfg.url || !cfg.srk) return res.status(503).json({ error: 'kill relay not configured (VITE_KILL_PUBKEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)' });
  const msg = req.body?.msg, bad = await verifyAdminMsg(msg, cfg.pub, Date.now(), ADMIN_NONCES);
  if (bad) return res.status(bad === 'bad signature' ? 403 : 400).json({ error: bad });
  try { await meshKill(cfg, msg); return res.json({ ok: true }); } catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
}

export default withGuards(handler, { name: 'kill', perMin: 30 }); // rate limits / size cap / geo / halt (api/_lib/guard.js)
