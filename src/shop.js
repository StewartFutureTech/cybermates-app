// Shop v2: catalog + prices (docs/SHOP-PRICING.md), house-ad slot state, rewarded-video streaks, stubbed checkout,
// tamper-evident local ledger, refunds. NO real payments: Stripe is not connected and no keys exist in this module.
// Ledger: entries live in the encrypted wallet vault (wallet.purchases, AES-GCM + CAS transactions, src/wallet.js), tagged
// shop:1 and hash-chained (h = SHA-256(prev | canonical entry)), so edits, deletions or re-ordering are detected by verify().
// Boost credits use the SAME wallet counter as the existing per-message boost refund logic (wallet.refund({boost})),
// so a delivery-failure refund and a purchase refund never conflict: refunds of purchases debit only what is unspent.
// Minors (under 18): no dating-related SKUs; every purchase needs the parent PIN (src/parental.js) to be unlocked.
import { sha256js } from './sha256.js';
export const AD_SLOT = 'house'; // placeholder / house ads only — no ad SDK, no ad keys, no tracking
export const REWARD_STREAK = 2, REWARD_GAP_MS = 10 * 60e3, REWARD_DAILY_CAP = 5, AD_MIN_WATCH_MS = 15e3;
// price in cents. kind: consumable (boosts) | nonconsumable (unlock) | sub (handled by legacy mock subscription path)
export const CATALOG = [
  { sku: 'boost1', title: '1 boosted message', cents: 49, kind: 'consumable', boosts: 1, group: 'boosts', desc: 'Highlights one connection request at the top of their inbox. Refunded automatically if it is never delivered.' },
  { sku: 'pack5', title: 'Starter pack: 5 boosted messages', cents: 199, kind: 'consumable', boosts: 5, group: 'boosts', best: true, desc: '5 initial messages, each boosted (the boost equivalent of 5 Super Likes / Roses). $0.40 each.' },
  { sku: 'boost15', title: '15 boosted messages', cents: 499, kind: 'consumable', boosts: 15, group: 'boosts', desc: '$0.33 each. Never expire.' },
  { sku: 'noads', title: 'Remove ads', cents: 149, kind: 'nonconsumable', unlock: 'noads', group: 'ads', desc: 'One-time. Hides the bottom banner forever on this device. Rewarded videos stay available (opt-in).' },
  { sku: 'emoji_neon', title: 'Neon emoji pack', cents: 99, kind: 'nonconsumable', unlock: 'emoji:neon', group: 'cosmetic', desc: '24 glowing reaction emoji.', preview: '⚡💠🔮🌐🛸🎛' },
  { sku: 'emoji_retro', title: 'Retro arcade emoji pack', cents: 99, kind: 'nonconsumable', unlock: 'emoji:retro', group: 'cosmetic', desc: '24 8-bit reaction emoji.', preview: '👾🕹🍒💾📼🏁' },
  { sku: 'frame_grid', title: 'Grid avatar frame', cents: 99, kind: 'nonconsumable', unlock: 'frame:grid', group: 'cosmetic', desc: 'Animated neon frame around your avatar.', preview: '🟦' },
  { sku: 'cosmetic_all', title: 'All cosmetics bundle', cents: 249, kind: 'nonconsumable', unlock: ['emoji:neon', 'emoji:retro', 'frame:grid'], group: 'cosmetic', desc: 'Every pack above, plus future packs this year.' },
  { sku: 'plus1m', title: 'Cybermates+ · 1 month', cents: 499, kind: 'sub', dating: true, group: 'plus', desc: 'See who liked you, advanced filters, incognito, 5 boosts each month.' },
  { sku: 'plus12m', title: 'Cybermates+ · 12 months', cents: 2999, kind: 'sub', dating: true, group: 'plus', desc: '$2.50/mo.' },
];
export const bySku = s => CATALOG.find(x => x.sku === s) || null;
export const price = c => '$' + (c / 100).toFixed(2);
export const allowedForMinor = it => !!it && !it.dating; // minors: nothing dating-related
const stable = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : 1)) : x);
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
export const entryHash = (prev, e) => { const { h, ...rest } = e; return hex(sha256js(new TextEncoder().encode((prev || 'genesis') + '|' + stable(rest)))); };
export const ledgerOf = w => (w?.purchases || []).filter(p => p && p.shop === 1);
export function verify(entries) { let prev = null; for (const e of entries) { if (e.prev !== (prev || 'genesis') || e.h !== entryHash(prev, e)) return { ok: false, at: e.id }; prev = e.h; } return { ok: true, head: prev }; }
export function entitlements(entries) { const v = verify(entries); const out = { noads: false, unlocks: new Set(), boostsBought: 0, rewardsToday: 0, ok: v.ok };
  if (!v.ok) return out; const day = new Date().toISOString().slice(0, 10); const refunded = new Set(entries.filter(e => e.type === 'refund').map(e => e.ref));
  for (const e of entries) { if (refunded.has(e.id)) continue; const it = bySku(e.sku);
    if (e.type === 'purchase' && it?.unlock) for (const u of [].concat(it.unlock)) u === 'noads' ? (out.noads = true) : out.unlocks.add(u);
    if (e.type === 'purchase' && it?.boosts) out.boostsBought += it.boosts; if (e.type === 'reward' && e.day === day) out.rewardsToday++; }
  return out; }
const rid = () => (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36));

// wallet: SecureWallet (tx/raw), parent: ParentControls | null, minor: bool, checkout: stub (never charges)
export class Shop {
  constructor({ wallet, uid, minor = false, parent = null, now = Date.now, checkout = stubCheckout }) { Object.assign(this, { wallet, uid, minor, parent, now, checkout }); this.streak = { n: 0, at: 0 }; this.adView = null; }
  async entries() { return ledgerOf(await this.wallet.raw(this.uid)); }
  async state() { const e = await this.entries(); const w = await this.wallet.raw(this.uid); return { ...entitlements(e), boosts: w.boosts, entries: e, streak: this.streak.n }; }
  // append one hash-chained entry + apply its wallet effect atomically (CAS tx; retried if another tab appended first)
  async append(entry, effect = () => ({ ok: true })) {
    for (let i = 0; i < 5; i++) { const cur = await this.entries(); const v = verify(cur); if (!v.ok) return { ok: false, reason: 'ledger-tampered' };
      const e = { ...entry, shop: 1, id: entry.id || rid(), at: this.now(), prev: v.head || 'genesis' }; e.h = entryHash(v.head, e);
      const r = await this.wallet.tx(this.uid, w => { const l = ledgerOf(w); if ((l.at(-1)?.h || null) !== (v.head || null)) return { ok: false, reason: 'retry' }; const x = effect(w, l); if (!x.ok) return x; w.purchases = [...(w.purchases || []), e]; return { ...x, ok: true }; });
      if (r.reason === 'retry') continue; return r.ok ? { ...r, entry: e } : r; }
    return { ok: false, reason: 'contention' }; }
  async gate(it) { if (!it) return { ok: false, reason: 'unknown-sku' };
    if (this.minor && !allowedForMinor(it)) return { ok: false, reason: 'minor-dating', message: 'Not available under 18.' };
    if (this.minor) { if (!this.parent || !(await this.parent._s?.())?.pinHash) return { ok: false, reason: 'parent-pin-required', message: 'Ask a parent to set a PIN in Parent controls first.' };
      if (!this.parent.isUnlocked()) return { ok: false, reason: 'parent-locked', message: 'Parent PIN needed to buy.' }; }
    return { ok: true }; }
  async buy(sku) { const it = bySku(sku), g = await this.gate(it); if (!g.ok) return g;
    if (it.kind === 'sub') return { ok: false, reason: 'use-subscription-flow' };
    if (it.kind === 'nonconsumable') { const s = await this.state(); const have = [].concat(it.unlock).every(u => u === 'noads' ? s.noads : s.unlocks.has(u)); if (have) return { ok: false, reason: 'already-owned' }; }
    const pay = await this.checkout({ sku, cents: it.cents, uid: this.uid }); if (!pay.ok) return { ok: false, reason: pay.reason || 'payment-failed' };
    const r = await this.append({ type: 'purchase', sku, cents: it.cents, pay: pay.ref }, w => { if (it.boosts) w.boosts += it.boosts; return { ok: true }; });
    if (this.minor) this.parent?.lock?.(); return r; } // one purchase per PIN entry
  // Refund (store/Stripe refund webhook or support). Idempotent. Boosts: debit only what is still unspent.
  async refund(id, { reason = 'requested' } = {}) { const cur = await this.entries(), p = cur.find(e => e.id === id && e.type === 'purchase'); if (!p) return { ok: false, reason: 'not-found' };
    if (cur.some(e => e.type === 'refund' && e.ref === id)) return { ok: false, reason: 'already-refunded' }; const it = bySku(p.sku); let debited = 0;
    return this.append({ type: 'refund', ref: id, sku: p.sku, cents: p.cents, reason }, w => { if (it?.boosts) { debited = Math.min(w.boosts, it.boosts); w.boosts -= debited; } return { ok: true, debited, shortfall: (it?.boosts || 0) - debited }; }); }
  // ---- ads ----
  async showBanner() { return !(await this.state()).noads; }
  startRewarded() { this.adView = { at: this.now() }; return this.adView; }
  cancelRewarded() { this.adView = null; this.streak = { n: 0, at: 0 }; } // skipping breaks the "in a row" streak
  async completeRewarded() { const v = this.adView; this.adView = null; if (!v || this.now() - v.at < AD_MIN_WATCH_MS) { this.streak = { n: 0, at: 0 }; return { ok: false, reason: 'not-watched' }; }
    if (this.streak.n && this.now() - this.streak.at > REWARD_GAP_MS) this.streak = { n: 0, at: 0 };
    this.streak = { n: this.streak.n + 1, at: this.now() }; if (this.streak.n < REWARD_STREAK) return { ok: true, earned: 0, streak: this.streak.n, need: REWARD_STREAK };
    this.streak = { n: 0, at: 0 }; const s = await this.state(); if (s.rewardsToday >= REWARD_DAILY_CAP) return { ok: false, reason: 'daily-cap' };
    const r = await this.append({ type: 'reward', sku: 'reward_boost', day: new Date(this.now()).toISOString().slice(0, 10) }, w => { w.boosts += 1; return { ok: true }; });
    return r.ok ? { ok: true, earned: 1, streak: 0 } : r; }
}
// Checkout STUB: no network, no keys. Production: Stripe Checkout session + webhook → server-signed receipt (src/entitlements.js).
export async function stubCheckout({ sku, cents }) { if (!bySku(sku) || bySku(sku).cents !== cents) return { ok: false, reason: 'price-mismatch' }; return { ok: true, ref: 'stub_' + rid(), stub: true }; }
