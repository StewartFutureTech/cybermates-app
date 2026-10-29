// Shop v2: pricing rules, stub checkout, hash-chained ledger + tamper detection, rewarded streak, refunds compatible with
// the existing boost refund, minors (no dating SKUs, parent PIN gate), ad removal. Uses the real SecureWallet (memory vault).
import { SecureWallet, casStore } from '../src/wallet.js';
import { Vault, MemorySecretStore } from '../src/vault.js';
import * as S from '../src/shop.js';
import { ParentControls } from '../src/parental.js';
import fs from 'fs';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const mkWallet = () => new SecureWallet({ vault: new Vault({ store: new MemorySecretStore() }), store: casStore(mem()), locks: null });
let T = Date.now(); const now = () => T;
// pricing: under half typical competitors (docs/SHOP-PRICING.md)
const COMP = { perBoostedMsg: 100 /* Tinder 5 Super Likes $4.99 → $1.00 */, removeAds: 299, plusMonthly: 999 /* Tinder Plus */, cosmeticMonthly: 299 /* Discord Nitro Basic */ };
ok(S.bySku('pack5').cents === 199 && S.bySku('pack5').boosts === 5, 'shop: $1.99 pack = 5 boosted initial messages');
ok(S.CATALOG.filter(i => i.boosts).every(i => i.cents / i.boosts < COMP.perBoostedMsg / 2), 'shop: every boost SKU < half the cheapest competitor per-message price');
ok(S.bySku('noads').cents < COMP.removeAds / 2 && S.bySku('plus1m').cents < COMP.plusMonthly / 2 && S.CATALOG.filter(i => i.group === 'cosmetic').every(i => i.cents < COMP.cosmeticMonthly), 'shop: ad removal, Cybermates+ under half; cosmetics under one month of Nitro Basic');
const doc = fs.readFileSync('docs/SHOP-PRICING.md', 'utf8'); ok(S.CATALOG.every(i => doc.includes(i.sku) && doc.includes(S.price(i.cents))), 'shop: every SKU + price documented in docs/SHOP-PRICING.md');
ok(!/sk_live|pk_live|ca-app-pub|stripe\.com\/v1/i.test(fs.readFileSync('src/shop.js', 'utf8') + fs.readFileSync('src/shop-ui.js', 'utf8')), 'shop: no live keys / ad SDK ids in shop code');
// adult purchases + ledger
const w = mkWallet(), shop = new S.Shop({ wallet: w, uid: 'u1', now });
let r = await shop.buy('pack5'); ok(r.ok && (await w.raw('u1')).boosts === 5, 'shop: stub checkout credits 5 boosts');
r = await shop.buy('noads'); ok(r.ok && !(await shop.showBanner()), 'shop: Remove ads hides the banner');
ok((await shop.buy('noads')).reason === 'already-owned', 'shop: non-consumable not sold twice');
ok((await shop.buy('plus1m')).reason === 'use-subscription-flow' && (await shop.buy('nope')).reason === 'unknown-sku', 'shop: subs go through subscription flow; unknown SKU refused');
ok((await S.stubCheckout({ sku: 'pack5', cents: 1 })).reason === 'price-mismatch', 'shop: checkout stub refuses tampered price');
let e = await shop.entries(); ok(e.length === 2 && S.verify(e).ok, 'shop: ledger hash chain verifies');
// existing boost refund logic (undelivered request) still works on the same counter
await w.spend('u1', { boost: true }); await w.refund('u1', { boost: true }); ok((await w.raw('u1')).boosts === 5, 'shop: message-boost spend+refund (existing logic) unchanged');
// purchase refund: debits only unspent boosts
await w.spend('u1', { boost: true }); await w.spend('u1', { boost: true }); await w.spend('u1', { boost: true });
const pid = e.find(x => x.sku === 'pack5').id; r = await shop.refund(pid); ok(r.ok && r.debited === 2 && r.shortfall === 3 && (await w.raw('u1')).boosts === 0, 'shop: refund debits only the 2 unspent boosts (3 already used)');
ok((await shop.refund(pid)).reason === 'already-refunded', 'shop: refund idempotent');
const nid = (await shop.entries()).find(x => x.sku === 'noads').id; await shop.refund(nid); ok(await shop.showBanner(), 'shop: refunded Remove ads → banner back');
// rewarded: 2 in a row → 1 boost; skip resets; too-short view refused; daily cap
shop.startRewarded(); T += 16e3; r = await shop.completeRewarded(); ok(r.ok && r.earned === 0 && r.streak === 1, 'rewarded: first ad → 1/2');
shop.startRewarded(); shop.cancelRewarded(); shop.startRewarded(); T += 16e3; r = await shop.completeRewarded(); ok(r.streak === 1 && r.earned === 0, 'rewarded: skipping breaks the streak');
shop.startRewarded(); T += 16e3; r = await shop.completeRewarded(); ok(r.earned === 1 && (await w.raw('u1')).boosts === 1, 'rewarded: 2 ads in a row → 1 boost');
shop.startRewarded(); T += 2e3; ok((await shop.completeRewarded()).reason === 'not-watched', 'rewarded: closing early does not count');
for (let i = 0; i < 2 * S.REWARD_DAILY_CAP; i++) { shop.startRewarded(); T += 16e3; r = await shop.completeRewarded(); }
ok(r.reason === 'daily-cap' && (await w.raw('u1')).boosts === S.REWARD_DAILY_CAP, 'rewarded: daily cap ' + S.REWARD_DAILY_CAP);
ok((await shop.state()).rewardsToday === S.REWARD_DAILY_CAP, 'rewarded: rewards recorded in ledger');
// tamper detection
await w.tx('u1', x => { const l = x.purchases.find(p => p.shop === 1 && p.sku === 'pack5'); l.sku = 'boost15'; return { ok: true }; });
ok(!S.verify(await shop.entries()).ok && (await shop.buy('boost1')).reason === 'ledger-tampered' && !(await shop.state()).ok, 'shop: edited ledger entry detected; further purchases refused');
// minors
const kw = mkWallet(); let pm = null; const P = new ParentControls({ store: { read: async () => pm, write: async x => { pm = x; } }, now, iters: 1000 });
const kid = new S.Shop({ wallet: kw, uid: 'k', minor: true, parent: P, now });
ok((await kid.buy('plus1m')).reason === 'minor-dating', 'minor: dating-related SKU refused');
ok((await kid.buy('pack5')).reason === 'parent-pin-required', 'minor: no parent PIN set → purchase refused');
await P.setPin('4321'); P.lock(); ok((await kid.buy('pack5')).reason === 'parent-locked', 'minor: PIN set but locked → refused');
await P.unlock('4321'); r = await kid.buy('emoji_neon'); ok(r.ok && !P.isUnlocked(), 'minor: parent unlocks → one purchase, then re-locks');
ok(S.CATALOG.filter(i => i.dating).every(i => !S.allowedForMinor(i)) && S.allowedForMinor(S.bySku('boost1')), 'minor: catalog flags');
console.log('PASS smoke-shop'); process.exit(0);
