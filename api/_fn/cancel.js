// POST {user_code} -> cancel Stripe subscription at period end. (Needs auth in production; see README.)
import { withGuards } from '../_lib/guard.js';
import { sb, stripe, notConfigured } from '../_lib/receipt.js';
export async function cancelFor(user_code) {
  const rows = await sb(`entitlements?user_code=eq.${user_code}&status=eq.active&select=stripe_ref`);
  for (const r of rows) if (r.stripe_ref?.startsWith('sub_')) await stripe('subscriptions/' + r.stripe_ref, { cancel_at_period_end: 'true' });
  return rows.length;
}
async function handler(req, res) {
  const { user_code } = req.body || {}; if (!/^[A-Z0-9]{10}$/.test(user_code || '')) return res.status(400).json({ error: 'bad-request' });
  try { res.json({ cancelled: await cancelFor(user_code) }); } catch (e) { notConfigured(res, e); }
}

export default withGuards(handler, { name: 'cancel', perMin: 10, perIdPerMin: 5, geo: true, halt: true }); // rate limits / size cap / geo / halt (api/_lib/guard.js)
