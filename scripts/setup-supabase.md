# Cybermates: going live with Supabase (one-time setup, about 20 minutes)

Supabase is used **only** for ephemeral signaling and presence (Realtime), signed control records (kill switch, app_config), purchase receipts and minimal abuse reports. No profiles or messages are stored there.

## 1. Create the Supabase project (free tier)
1. https://supabase.com/dashboard/sign-in → **New project**. Name it `cybermates`, pick the region closest to your users, and save the DB password in your password manager.
2. **SQL Editor** → New query → paste all of [`supabase/schema.sql`](../supabase/schema.sql) (v2) → **Run**. Ignore the commented `drop` block at the bottom; that's only for migrating v1.
3. **Project Settings → API** (https://supabase.com/dashboard/project/_/settings/api) and copy:
   - Project URL → `VITE_SUPABASE_URL` and `SUPABASE_URL`
   - `anon` public key → `VITE_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**server only, never a VITE_ var**)
4. Realtime is on by default. Broadcast and presence channels (`mesh`, `peers`, `control`) need no tables. Free tier: ~200 concurrent Realtime connections.

## 2. TURN relay (WebRTC, needed for relay-only ICE)
Free option: **Metered "Open Relay" / free TURN tier**. Sign up at https://www.metered.ca/tools/openrelay/ (or https://dashboard.metered.ca/signup, free plan) and create a TURN credential. Then set:
```
VITE_TURN_URLS=turns:<your-subdomain>.metered.live:443?transport=tcp,turn:<your-subdomain>.metered.live:80
VITE_TURN_USERNAME=<from Metered dashboard>
VITE_TURN_CREDENTIAL=<from Metered dashboard>
```
Placeholders stay in place until you do this. Chat and presence still work without TURN, because mesh envelopes go over the Realtime broadcast relay; only direct WebRTC connections need TURN. Alternatives: Cloudflare Calls TURN (free tier), or self-hosted coturn.

## 3. Vercel environment variables
https://vercel.com/stewart-future-tech/cybermates/settings/environment-variables (Production)

| Name | Value | Where from |
|---|---|---|
| `VITE_SUPABASE_URL` | Project URL | step 1.3 |
| `VITE_SUPABASE_ANON_KEY` | anon key | step 1.3 |
| `VITE_KILL_PUBKEY` | `V+Znh5a3ITEmeH4WLu9OuMfeSi6qMcyeLtaoaqAXgwA=` | generated 2026-10-16; private key in `/workspace/cybermates-secrets/kill-switch-keys.txt` |
| `VITE_RECEIPT_PUBKEY` | `tJ336TkYFLbZjYjXdWlX/XHvpfn4eMWkrmpE1B08Ds8=` | private seed in `/workspace/cybermates-secrets/receipt-keys.txt` |
| `VITE_TURN_URLS`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` | see step 2 | Metered |
| `SUPABASE_URL` | Project URL | server functions |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key | server only |
| `RECEIPT_SIGNING_SEED` | from `receipt-keys.txt` | server only |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | later (sk_test_…, whsec_…) | Stripe test mode; leave unset for now |
| `XAI_API_KEY` | later | Grok voice; leave unset for now |
| `CRON_SECRET`, `INACTIVE_DAYS` | any random string, `30` | inactivity job |

`VITE_*` values are baked in at **build time**, so you need to rebuild after setting them. Move the kill key into an encrypted keyfile (`node scripts/mod.mjs keygen`, outside the repo) and move and `RECEIPT_SIGNING_SEED` into your password manager, then delete them from the box if you want.

## 4. Deploy
The current production deploy is a static single file, which can't include `api/*`, so the bootstrap snapshot, payments and voice functions are not live. Choose one:
- **(a) Full deploy (recommended):** connect the repo or upload the whole project with framework **Vite**, build `npm run build`, output `dist`. This deploys `api/*` too.
- **(b) Keep the single file:** build locally with a `.env.production` holding the `VITE_*` values, then run `node scripts/inline.mjs` and deploy `dist-single` as before (no server functions).

## 5. Smoke test after deploy
- Open the site on 2 phones (or 2 browsers). Accept terms, then Dev → Mesh should show `transport: supabase realtime` and the other phone online.
- Discover → **Live now**, message, add friend, block.
- Kill switch drill: `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/mod.mjs halt --reason "drill"` (type HALT; key from the encrypted keyfile), then `node scripts/mod.mjs resume`, then `… clear`.
