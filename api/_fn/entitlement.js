// POST {user_code} -> current signed receipts (app refreshes on login; inactive subscriptions come back status:'inactive' => feature removed).
// Also bumps last_seen for the inactivity auto-cancel job. NOTE: user_code is not a secret — production must authenticate (Supabase JWT).
import { withGuards } from '../_lib/guard.js';
import { sb, notConfigured } from '../_lib/receipt.js';
async function handler(req, res) {
  const { user_code } = req.body || {}; if (!/^[A-Z0-9]{10}$/.test(user_code || '')) return res.status(400).json({ error: 'bad-request' });
  try { await sb('app_users?on_conflict=user_code', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ user_code, last_seen: new Date().toISOString() }) });
    const rows = await sb(`entitlements?user_code=eq.${user_code}&select=receipt`); res.json({ receipts: rows.map(r => r.receipt) }); }
  catch (e) { notConfigured(res, e); }
}

export default withGuards(handler, { name: 'entitlement', perMin: 30, perIdPerMin: 10, halt: true }); // rate limits / size cap / geo / halt (api/_lib/guard.js)
