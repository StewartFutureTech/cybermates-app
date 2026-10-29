// POST {user_code, sku} -> Stripe Checkout session URL (test mode only; 501 until keys are set).
import { withGuards } from '../_lib/guard.js';
import { SKUS, stripe, notConfigured } from '../_lib/receipt.js';
async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { user_code, sku } = req.body || {}; const s = SKUS[sku];
  if (!s || !/^[A-Z0-9]{10}$/.test(user_code || '')) return res.status(400).json({ error: 'bad-request' });
  try {
    const origin = req.headers.origin || 'https://cybermates.vercel.app';
    // US-only: card payments only, billing address REQUIRED (country checked again in the webhook, which refunds/cancels non-US).
    // Also add Stripe Radar rules in the dashboard: "Block if :card_country: != 'US'" and "Block if :billing_address_country: != 'US'".
    const session = await stripe('checkout/sessions', { mode: s.mode, 'payment_method_types[0]': 'card', billing_address_collection: 'required', 'metadata[us_only]': '1', 'line_items[0][price]': s.price, 'line_items[0][quantity]': '1', client_reference_id: user_code, 'metadata[sku]': sku, 'metadata[user_code]': user_code, ...(s.mode === 'subscription' ? { 'subscription_data[metadata][user_code]': user_code } : {}), success_url: origin + '/?paid=1', cancel_url: origin + '/?paid=0' });
    res.json({ url: session.url });
  } catch (e) { notConfigured(res, e); }
}

export default withGuards(handler, { name: 'checkout', perMin: 10, perIdPerMin: 5, geo: true, halt: true }); // rate limits / size cap / geo / halt (api/_lib/guard.js)
