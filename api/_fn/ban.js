// Admin ban / unban relay. POST {msg, code, category, reason, deviceHash?}
//  ban:   msg = signed {type:'kill', scope:'user:<code>'}  -> blocklist row FIRST, mod_actions log, then targeted kill broadcast
//  unban: msg = signed {type:'clear', scope:'user:<code>'} -> delete blocklist row, log, broadcast signed clear
// Authorization = a fresh message signed with the kill-switch private key (verified against VITE_KILL_PUBKEY).
// Never send or store illegal content here: `reason` is a short label, not evidence.
import { withGuards } from '../_lib/guard.js';
import { env, ADMIN_NONCES, verifyAdminMsg, ban, unban, standing, rateLimitGlobal, haltGuard } from '../_lib/mod.js';
// Tiered: msg.type 'warn' (level 1-3) | 'kill' (level 4 suspension / 5 ban; no level = 5) | 'clear' (+ body.toLevel 0-3 to unban or lower).
// body.status = true -> returns current standing {level, strikes, until} (admin tools compute the next escalation from it).
const hits = globalThis.__cmBanHits ||= new Map();
async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (await haltGuard(res)) return; // global halt: refuse
  if (!(await rateLimitGlobal(hits, 'ban-admin', String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'x', { perMin: 20 }))) return res.status(429).json({ error: 'rate limited' });
  const cfg = env(); if (!cfg.pub || !cfg.url || !cfg.srk) return res.status(503).json({ error: 'ban relay not configured' });
  const { msg, code, category, reason, deviceHash, toLevel = 0, status } = req.body || {};
  if (!/^[A-Za-z0-9-]{1,64}$/.test(code || '')) return res.status(400).json({ error: 'bad code' });
  const bad = await verifyAdminMsg(msg, cfg.pub, Date.now(), ADMIN_NONCES); if (bad) return res.status(bad === 'bad signature' ? 403 : 400).json({ error: bad });
  if (msg.scope !== 'user:' + code) return res.status(400).json({ error: 'message scope must be user:<code>' });
  if (status) { try { return res.json(await standing(cfg, code)); } catch (e) { return res.status(502).json({ error: e.message }); } }
  try { return res.json(msg.type !== 'clear' ? await ban(cfg, { msg, code, category, reason, deviceHash }) : await unban(cfg, { msg, code, reason, toLevel: Math.max(0, Math.min(3, +toLevel || 0)) })); }
  catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
}

export default withGuards(handler, { name: 'ban', perMin: 20 }); // rate limits / size cap / geo / halt (api/_lib/guard.js)
