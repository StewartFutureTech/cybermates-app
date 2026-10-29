// Server-side helpers. Env: RECEIPT_SIGNING_SEED (base64 32-byte Ed25519 seed), STRIPE_SECRET_KEY (sk_test_...), STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import nacl from 'tweetnacl';
import crypto from 'node:crypto';
import { signReceipt } from '../../src/entitlements.js';
export const SKUS = { plus1m: { mode: 'subscription', price: 'price_PLUS_1M_TEST' }, boost1: { mode: 'payment', price: 'price_BOOST1_TEST', boosts: 1 }, boost5: { mode: 'payment', price: 'price_BOOST5_TEST', boosts: 5 }, starters15: { mode: 'payment', price: 'price_STARTERS15_TEST', starters: 15 }, voice30: { mode: 'payment', price: 'price_VOICE30_499_TEST', voice_cap_ms: 30 * 60e3 } };
export const keyFromSeed = seedB64 => nacl.sign.keyPair.fromSeed(new Uint8Array(Buffer.from(seedB64, 'base64')));
export function issueReceipt(fields, seedB64 = process.env.RECEIPT_SIGNING_SEED) {
  const kp = keyFromSeed(seedB64); return signReceipt({ issued_at: Date.now(), receipt_id: crypto.randomUUID(), ...fields }, Buffer.from(kp.secretKey).toString('base64'));
}
// Stripe webhook signature: header "t=..,v1=.." ; v1 = HMAC_SHA256(secret, `${t}.${rawBody}`); 5-min tolerance.
export function verifyStripeSig(raw, header, secret, now = Date.now(), tol = 300) {
  const p = Object.fromEntries((header || '').split(',').map(x => x.split('=')));
  if (!p.t || !p.v1 || Math.abs(now / 1000 - +p.t) > tol) return false;
  const exp = crypto.createHmac('sha256', secret).update(`${p.t}.${raw}`).digest('hex');
  return exp.length === p.v1.length && crypto.timingSafeEqual(Buffer.from(exp), Buffer.from(p.v1));
}
export async function sb(path, init = {}) { // Supabase REST with service role (server only)
  const u = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!u || !k) throw new Error('supabase not configured');
  const r = await fetch(`${u}/rest/v1/${path}`, { ...init, headers: { apikey: k, authorization: `Bearer ${k}`, 'content-type': 'application/json', prefer: 'return=representation', ...init.headers } });
  return r.json();
}
export async function stripeReq(method, path, form) {
  const k = process.env.STRIPE_SECRET_KEY; if (!k?.startsWith('sk_test_')) throw new Error('stripe test key not configured');
  const r = await fetch('https://api.stripe.com/v1/' + path, { method, headers: { authorization: 'Bearer ' + k, 'content-type': 'application/x-www-form-urlencoded' }, ...(form ? { body: new URLSearchParams(form) } : {}) });
  return r.json();
}
export async function stripe(path, form) {
  const k = process.env.STRIPE_SECRET_KEY; if (!k?.startsWith('sk_test_')) throw new Error('stripe test key not configured');
  const r = await fetch('https://api.stripe.com/v1/' + path, { method: 'POST', headers: { authorization: 'Bearer ' + k, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  return r.json();
}
export const notConfigured = (res, e) => res.status(501).json({ error: 'not-configured', detail: e.message });
