# Shop pricing (v2) — under half of typical competitor prices

*Research date: 2026-10-21 (America/Chicago). US list prices; competitors vary price by age, region and test cohort, so each figure is a typical value from the cited source. Implementation: `src/shop.js` (catalog/ledger), `src/shop-ui.js` (UI), test: `scripts/smoke-shop.mjs` (asserts every SKU below is < 50% of the comparison price and documented here).*

## Competitor scan

| Item | Competitor price (US) | Per unit | Source |
|---|---|---|---|
| Tinder Super Like (priority "notice me" message) | 5 for $4.99 · 3 for $9.99 | $1.00 – $3.33 | subscriptionrank.com/social-pricing/tinder (App Store, verified Oct 17 2026); hej.dating/compare/dating-app-prices-us (Oct 8 2026) |
| Tinder Boost (30 min visibility) | $3.99 · $6.99 · $7.99 | $3.99+ | same as above; help.tinder.com Boost article |
| Hinge Rose | 3 for $9.99 · 12 for $29.99 | $2.50 – $3.33 | help.hinge.co "Subscription and Purchase Benefits"; hej.dating (Oct 8 2026) |
| Hinge Boost | $9.99 · $19.99 | $9.99+ | hej.dating (Oct 8 2026); swipelexicon.com hinge-vs-bumble |
| Bumble Boost / BumbleCoins (SuperSwipe, Spotlight) | Boost $2.99–$12.99 · 1 coin $1.99 | ~$1.99 | support.bumble.com pricing; hej.dating (Oct 8 2026) |
| Tinder Plus (includes "hide ads") | $9.99/mo | — | subscriptionrank.com; help.tinder.com subscriptions |
| One-time "Remove ads" in mobile apps | $2.99 typical ($3.99 common) | — | apppricinglab.com (Going Balls $2.99); App Store listings (Spot It $2.99, Bhop Jump $3.99) |
| Cosmetic emoji/profile perks (Discord Nitro Basic) | $2.99/mo | — | discord.com/nitro; Discord blog "beginners guide to Nitro" |

**Comparison baseline used for the "< half" rule (cheapest typical value, so the rule is strict):** boosted message $1.00 (Tinder 5-pack Super Like) · remove ads $2.99 · subscription $9.99/mo (Tinder Plus) · cosmetics $2.99 (one month Nitro Basic).

## Cybermates prices

| SKU | Item | Price | Per unit | Baseline | % of baseline |
|---|---|---|---|---|---|
| `boost1` | 1 boosted message | **$0.49** | $0.49 | $1.00 | 49% |
| `pack5` | Starter pack: 5 boosted initial messages | **$1.99** | $0.40 | $1.00 | 40% |
| `boost15` | 15 boosted messages | **$4.99** | $0.33 | $1.00 | 33% |
| `noads` | Remove ads (one-time) | **$1.49** | — | $2.99 | 50% − 1¢ |
| `emoji_neon` | Neon emoji pack | **$0.99** | — | $2.99 | 33% |
| `emoji_retro` | Retro arcade emoji pack | **$0.99** | — | $2.99 | 33% |
| `frame_grid` | Grid avatar frame | **$0.99** | — | $2.99 | 33% |
| `cosmetic_all` | All cosmetics bundle | **$2.49** | — | 3 × $2.99 | 28% (one-time vs monthly) |
| `plus1m` | Cybermates+ 1 month (18+ only) | **$4.99** | $4.99/mo | $9.99/mo | 50% − 1¢ |
| `plus12m` | Cybermates+ 12 months (18+ only) | **$29.99** | $2.50/mo | $9.99/mo | 25% |
| (free) | Rewarded video: watch 2 ads in a row → 1 boost | **free** | max 5/day | — | — |

"$1.99 pack = 5 initial messages + boost equivalent" is implemented as 5 boosted initial messages (each = a connection request highlighted at the top of the recipient's inbox — the Super Like / Rose equivalent).
Cybermates+ was $9.99/mo in MONETIZATION.md (equal to Tinder Plus); v2 lowers it to $4.99. Legacy starter packs are retired (starters retired in mesh.js); Grok voice setup ($4.99) is unchanged and not part of the comparison.

## Rules
- Payments are **stubbed** (`stubCheckout`): no Stripe keys, no network. Production path: Stripe Checkout → webhook → server-signed receipt (`src/entitlements.js`, `wallet.redeem`).
- Ads: one bottom banner slot, **house ads only** (in-app promos; no ad SDK, no ad keys, no tracking). Hidden on onboarding and in the Arcade. Removed by `noads`.
- Ledger: entries stored inside the encrypted wallet vault, hash-chained; any edit/deletion/reorder ⇒ purchases paused.
- Refunds: idempotent; boost packs debit only unspent boosts (shortfall reported). Delivery-failure boost refunds (existing logic) use the same counter and are unaffected.
- Under 18: no dating-related SKUs (Cybermates+ hidden), parent PIN (`src/parental.js`) required for every purchase, re-locks after each purchase. House ads are age-safe.
