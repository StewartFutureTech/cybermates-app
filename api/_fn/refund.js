// POST {op:'register'|'receipt'|'claim', msgId, from, to, sig?} -> boost refund ledger (api/_lib/refunds.js). Boost credits only:
// no Stripe / real-money calls (money refunds stay manual in the Stripe dashboard).
// v41: conservative + shared. With SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY the ledger is the service-role RPC public.mesh_refund
// (one ledger for every instance, per-sender caps, fail closed); without them an in-memory store with the same rules is used.
// The Supabase account path refunds inside the DB (app.boost_refund_decide, migration 20261027000009), not here.
import { withGuards, allow } from '../_lib/guard.js';
import { RefundLedger, makeRefundStore, MSG_RE, CODE_RE } from '../_lib/refunds.js';
import { getSignal } from '../_lib/signal.js';
const sig = getSignal();
const ledger = globalThis.__cmRefunds ||= new RefundLedger({ store: makeRefundStore(), pubOf: async c => (await Promise.resolve(sig.presenceGet?.(c)).catch(() => null))?.pub || null });
async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end(); const b = req.body || {};
  if (!MSG_RE.test(b.msgId || '')) return res.status(400).json({ error: 'bad msgId' });
  if (!CODE_RE.test(b.from || '')) return res.status(400).json({ error: 'bad from' });
  if (b.op === 'claim' && !(await allow(`refund|from|${b.from}`, 20))) return res.status(429).json({ error: 'rate limited (from)' });
  if (b.op === 'register') return res.json(await ledger.register(b));
  if (b.op === 'receipt') return res.json(await ledger.receipt(b));
  if (b.op === 'claim') return res.json(await ledger.claim(b));
  res.status(400).json({ error: 'bad op' });
}
export default withGuards(handler, { name: 'refund', perMin: 30, perIdPerMin: 20, halt: true });
