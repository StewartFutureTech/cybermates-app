// Boost / subscription entitlements (item 9). The client ONLY trusts server-signed Ed25519 receipts
// (issued by api/stripe-webhook.js + api/_fn/entitlement.js after Stripe confirms payment). Receipts live inside the encrypted vault.
// Client-side checks are bypassable on a modified client; anything with real value must also be enforced server-side.
import nacl from 'tweetnacl';
import { b64, unb64 } from './vault.js';
export const DEV_RECEIPT_PUBKEY = 'REPLACE_WITH_VITE_RECEIPT_PUBKEY';
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
export const RECEIPT_PUBKEY = env.VITE_RECEIPT_PUBKEY || DEV_RECEIPT_PUBKEY;
export const RECEIPT_FIELDS = ['user_code', 'sku', 'status', 'boosts', 'starters', 'period_end', 'issued_at', 'receipt_id', 'voice_cap_ms', 'voice_used_ms'];
export const receiptBytes = r => new TextEncoder().encode(JSON.stringify(RECEIPT_FIELDS.map(k => [k, r[k] ?? null])));
export const signReceipt = (r, secB64) => ({ ...r, sig: b64(nacl.sign.detached(receiptBytes(r), unb64(secB64))) });
export function verifyReceipt(r, pub = RECEIPT_PUBKEY) { try { return !!r && nacl.sign.detached.verify(receiptBytes(r), unb64(r.sig), unb64(pub)); } catch { return false; } }
// Unpaid / expired => feature removed (account untouched).
export function activeFeatures(receipts, { userCode, pub = RECEIPT_PUBKEY, now = Date.now() } = {}) {
  const f = { plus: false, boosts: 0, starters: 0, voiceMs: 0 };
  for (const r of receipts || []) {
    if (!verifyReceipt(r, pub) || r.user_code !== userCode) continue;
    if (r.sku.startsWith('plus') && r.status === 'active' && r.period_end > now) f.plus = true;
    if (r.sku === 'voice30' && r.status === 'paid') { f.voiceMs += Math.max(0, (r.voice_cap_ms || 0) - (r.voice_used_ms || 0)); continue; }
    if (r.status === 'paid') { f.boosts += r.boosts || 0; f.starters += r.starters || 0; }
  }
  return f;
}
// Client calls (no keys in the app). On login: refreshEntitlements() replaces stored subscription receipts.
const api = (p, body) => fetch('/api/' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
export const startCheckout = (userCode, sku) => api('checkout', { user_code: userCode, sku }).then(r => { if (r.url) location.href = r.url; return r; });
export const refreshEntitlements = userCode => api('entitlement', { user_code: userCode });
export const cancelSubscription = userCode => api('cancel', { user_code: userCode });
export const CANCEL_NOTE = 'Deleting the app does NOT cancel your subscription. Use "Cancel subscription" here (or the Stripe receipt email link).';
