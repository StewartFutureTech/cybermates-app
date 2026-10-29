// Stripe webhook: verifies signature, records payment/subscription state, issues signed receipts. Never trusts the client.
import { withGuards } from './_lib/guard.js';
import { SKUS, verifyStripeSig, issueReceipt, sb, notConfigured, stripeReq } from './_lib/receipt.js';
export const config = { api: { bodyParser: false } };
const raw = req => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });
export function receiptFromEvent(ev) {
  const o = ev.data?.object || {};
  if (ev.type === 'checkout.session.completed' && o.payment_status === 'paid' && o.mode === 'payment') { const s = SKUS[o.metadata?.sku] || {}; return { user_code: o.client_reference_id, sku: o.metadata.sku, status: 'paid', boosts: s.boosts || 0, starters: s.starters || 0, ...(s.voice_cap_ms ? { voice_cap_ms: s.voice_cap_ms, voice_used_ms: 0 } : {}), stripe_ref: o.id }; }
  if (ev.type.startsWith('customer.subscription.')) return { user_code: o.metadata?.user_code, sku: 'plus1m', status: o.status === 'active' || o.status === 'trialing' ? 'active' : 'inactive', period_end: (o.current_period_end || 0) * 1000, stripe_ref: o.id };
  return null;
}
// US-only: card issuing country AND billing country must both be 'US', read from Stripe (never from the client).
// Non-US: refund the payment / cancel the subscription, and issue NO receipt. get/act are injectable for tests.
export async function usCheck(ev, get = p => stripeReq('GET', p), act = (m, p, f) => stripeReq(m, p, f)) {
  const o = ev.data?.object || {}; let card = null, billing = o.customer_details?.address?.country || null, undo = null;
  if (ev.type === 'checkout.session.completed' && o.payment_intent) { const pi = await get(`payment_intents/${o.payment_intent}?expand[]=latest_charge`); const ch = pi.latest_charge || {}; card = ch.payment_method_details?.card?.country || null; billing ||= ch.billing_details?.address?.country || null; undo = () => act('POST', 'refunds', { payment_intent: o.payment_intent, reason: 'requested_by_customer', 'metadata[why]': 'non-us' }); }
  else if (ev.type === 'checkout.session.completed' && o.subscription || ev.type.startsWith('customer.subscription.')) {
    const subId = o.subscription || o.id; const sub = ev.type.startsWith('customer.subscription.') ? o : await get(`subscriptions/${subId}`);
    const pmId = typeof sub.default_payment_method === 'string' ? sub.default_payment_method : sub.default_payment_method?.id;
    if (pmId) { const pm = await get(`payment_methods/${pmId}`); card = pm.card?.country || null; billing ||= pm.billing_details?.address?.country || null; }
    undo = () => act('DELETE', `subscriptions/${subId}`); }
  else return { ok: true, skipped: true };
  const ok = card === 'US' && billing === 'US'; if (!ok && ev.type !== 'customer.subscription.deleted') await undo?.();
  return { ok, card, billing };
}
async function handler(req, res) {
  const body = await raw(req), secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return notConfigured(res, new Error('STRIPE_WEBHOOK_SECRET missing'));
  if (!verifyStripeSig(body, req.headers['stripe-signature'], secret)) return res.status(400).json({ error: 'bad-signature' });
  const ev = JSON.parse(body); const r = receiptFromEvent(ev); if (!r?.user_code) return res.json({ ignored: true });
  if (r.status !== 'inactive') { const us = await usCheck(ev).catch(e => ({ ok: false, err: e.message })); if (us.err) return res.status(500).json({ error: 'us-check failed, retry' }); if (!us.ok) return res.json({ ignored: 'non-us', ...us }); }
  try { const { stripe_ref, ...f } = r; const rc = issueReceipt(f); await sb('entitlements?on_conflict=stripe_ref', { method: 'POST', headers: { prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ user_code: r.user_code, stripe_ref, receipt: rc, status: r.status }) }); res.json({ ok: true }); }
  catch (e) { notConfigured(res, e); }
}

export default withGuards(handler, { name: 'stripe-webhook', perMin: 300, maxBody: 0 }); // rate limits / size cap / geo / halt (api/_lib/guard.js)
