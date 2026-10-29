# Cybermates Monetization

*Scan date: Oct 15, 2026. US list prices from public reviews and App Store listings. These apps change prices by age, region and plan length, so treat each figure as a typical value.*

## Competitor scan (US, 1-month price unless noted)

| App | Subscription | Longer terms | À-la-carte |
|---|---|---|---|
| **Tinder** | Plus ~$24.99, Gold ~$39.99, Platinum ~$49.99 (store listings show Gold $13.99–$24.99) | big discounts on 6/12 mo | Boost ~$4–$12 each; Super Likes ~$1–$3 each in bundles |
| **Hinge** | Hinge+ $32.99, HingeX $49.99 | Hinge+ 6 mo $99.99 ($16.66/mo) | Boost $9.99–$19.99; Roses 3 for $9.99 / 12 for $29.99 |
| **Bumble** | Premium ~$39.99, Premium+ ~$79.99 | cheaper on longer terms | Boost $2.99–$12.99; BumbleCoins from $1.99 |
| **OkCupid** | Premium $44.99 | 3 mo $89.99; 6 mo $134.99 ($22.49/mo) | Boosts / SuperLikes in-app |
| **Feeld** | Majestic ~$29.99 (Premium ~$19.99) | 6 mo ~$14.99/mo, 12 mo ~$11.99/mo | Pings / profile boosts in-app |
| **Kippo** (gamer dating) | Infinity $13.99 | 6 mo $52.99, 12 mo $78.99 | none |
| Other gamer/geek apps (e.g. Gamer Dating / Discord-style matchers) | usually $5–$15/mo or free | — | rarely sold |

**Takeaways:** mainstream apps charge $30–$50/mo, and their add-ons (boosts) cost $4–$12 each. Gamer-focused apps cost about $10–$14/mo. Cybermates' audience (gamers, anime fans, younger users) sits closer to Kippo, so the price should start low. Cybermates already gives unlimited replies and 5 free new conversations a day, so the paid items should be **more reach** (starters) and **priority** (boosts), not "unlock basic chat."

## Recommended price list (USD)

**Starter packs** (new-conversation openers on top of the 5 free per day; they never expire)
| SKU | Pack | Price | Per starter |
|---|---|---|---|
| `starters5` | 5 starters | **$1.99** | $0.40 |
| `starters15` | 15 starters | **$4.99** | $0.33 |
| `starters40` | 40 starters | **$9.99** | $0.25 |

**Boosts** (pins your message at the top of the recipient's inbox until they read it)
| SKU | Pack | Price | Per boost |
|---|---|---|---|
| `boost1` | 1 boost | **$1.99** | $1.99 |
| `boost5` | 5 boosts | **$6.99** | $1.40 |
| `boost15` | 15 boosts | **$14.99** | $1.00 |

**Subscription: "Cybermates+"**
- **$9.99/mo**, **$44.99/6 mo** ($7.50/mo), or **$69.99/yr** ($5.83/mo). This undercuts Kippo ($13.99) and is about a quarter of Tinder Gold.
- Includes: 15 starters/day (instead of 5), 5 boosts each month, see who viewed or liked you, advanced filters (platform, rank, region, schedule), incognito mode, and read receipts.
- Optional later: a **Verified badge add-on (+$1.99–$4.99/mo)** to cover ID/selfie-verification costs.
- **Status (Oct 16, 2026):** all SKUs above are live in the in-app Shop as **mock** purchases (`starters5/15/40`, `boost1/5/15`, `plus1m/6m/12m`, `plus_cancel`).

Why boosts cost less than at the big apps: one Cybermates boost targets one person's inbox, while a Tinder boost puts your profile in front of many people for 30 minutes. Low unit prices encourage repeat purchases. Charge on the **web** through Stripe first. App-store in-app purchases carry a 15–30% fee, so app-store prices should be about 20–30% higher if you ship native apps.

## Stripe integration plan (no account needed until go-live)

1. **Catalog:** create one Stripe Product + Price per SKU above (one-time Prices for packs, recurring Prices for Cybermates+). Store the `price_id → sku` map in an Edge Function env var.
2. **Checkout:** the client calls Supabase Edge Function `create-checkout` with `{sku}` and the user's JWT. The function verifies the user and creates a Checkout Session (`mode: payment` or `subscription`, `client_reference_id = user.id`, `metadata.sku`). It returns `session.url` and the client redirects to it. Use the hosted Checkout page so card data never touches the app (PCI SAQ-A).
3. **Webhook:** Edge Function `stripe-webhook` verifies `Stripe-Signature` with the webhook secret.
   - `checkout.session.completed` (payment mode): call `credit_wallet(user_id, sku, session.id)` with the service role. `stripe_session_id` is unique, so Stripe retries are idempotent.
   - `customer.subscription.created/updated/deleted`: upsert a `subscriptions(user_id, status, current_period_end, stripe_customer_id)` table. `send_message` / `get_wallet` read it to apply the 15/day limit for active subscribers.
   - `invoice.paid`: grant the 5 monthly boosts (idempotent on invoice id).
   - `charge.refunded` / `charge.dispute.created`: claw back unspent credits and flag the account.
4. **Customer Portal:** a `create-portal` function returns a Billing Portal URL for cancelling or changing plans. Cancellation must be as easy as signup; the FTC "click-to-cancel" rules and Match Group's 2025 FTC settlement show the risk.
5. **Turn off mocks:** `update app_config set value='false' where key='allow_mock_purchases'` so the dev-only `mock_purchase` RPC stops working.
6. **Testing:** use Stripe test mode plus `stripe listen --forward-to <function-url>` and test cards. Check every webhook event for idempotent replay.
7. **Compliance:** sell only to verified 18+ users, show prices including tax (Stripe Tax), keep the refund policy and ToS on the shop page, and keep a receipt in `purchases`.
