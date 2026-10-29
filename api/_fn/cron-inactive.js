// Daily job stub (vercel.json crons): cancel subscriptions of users inactive > INACTIVE_DAYS (default 30).
import { withGuards } from '../_lib/guard.js';
import { sb, notConfigured } from '../_lib/receipt.js';
import { cancelFor } from './cancel.js';
async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).end();
  const days = +(process.env.INACTIVE_DAYS || 30), cutoff = new Date(Date.now() - days * 864e5).toISOString();
  try { const users = await sb(`app_users?last_seen=lt.${cutoff}&select=user_code`); let n = 0; for (const u of users) n += await cancelFor(u.user_code); res.json({ checked: users.length, cancelled: n }); }
  catch (e) { notConfigured(res, e); }
}

export default withGuards(handler, { name: 'cron', perMin: 5 }); // rate limits / size cap / geo / halt (api/_lib/guard.js)
