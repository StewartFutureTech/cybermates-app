# Supabase day checklist (prepared 2026-10-20; nothing deployed, no accounts created)

The code runs on the mock/local transport by default. Each item below is labeled **READY-TO-CONNECT** (just add the
env vars / run the SQL) or **PARTIAL** (it works but needs a follow-up). The tests use fakes only: `scripts/smoke-supaday.mjs`
and `scripts/smoke-presence.mjs`.

> Design change, same day: the **server is the only entry point** (see audit, "Single-entry server"). The phone-snapshot
> warm start, the persisted active list, and the cached-list jump-start are removed. Item 2 below is now the server
> super list, not phone snapshots.

## Env vars (all set in Vercel project settings / Supabase secrets, never committed)
| Where | Var | Purpose |
|---|---|---|
| Vercel (client build) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Realtime mesh channel + anonymous auth. Setting both switches the bus from mock to Supabase |
| Vercel (client build) | `VITE_CM_TRANSPORT` = `mock` \| `supabase` | Optional override (force mock even with the vars set) |
| Vercel (client build) | `VITE_KILL_PUBKEY` | Kill-switch **public** key (production build fails closed without it) |
| Vercel (server) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server signal adapter (`api/_lib/signal.js`); `CM_SIGNAL=mock` forces the mock |
| Vercel (server) | `KILL_PUBKEY` (or `VITE_KILL_PUBKEY`) | **Public** key only. The private key stays offline in the `scripts/mod.mjs` keyfile |
| Vercel (server) | `CM_US_ONLY` (default on), `CM_TRAVEL_GRACE_DAYS` (default 14) | US-only gate |
| Vercel (server) | `GOOGLE_CLOUD_PROJECT`, `PLAY_INTEGRITY_SA_JSON`, `ANDROID_PACKAGE_NAME`, `ANDROID_CERT_SHA256` | Play Integrity |
| Vercel (server) | `APPLE_TEAM_ID`, `IOS_BUNDLE_ID`, `APP_ATTEST_ENV` | App Attest |
| Vercel (server) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe (the code accepts `sk_test_` keys only until it's switched to live) |
| Supabase secrets | `XAI_API_KEY`, `XAI_MODEL`, `CM_ALLOWED_ORIGIN` | grok-profile Edge Function only |

## Items
1. **Supabase client + adapter on the encrypted mesh path: READY-TO-CONNECT.** `src/net.js` `SupabaseBus`: joins `mesh` as a
   **private** channel, and every post passes through `assertSealed`, which refuses plaintext directed chat/starters and
   unsigned broadcasts. Then the never-send guard runs, then the throttle. E2E: `src/e2e.js` (Ed25519 signing, AES-GCM, per-chat X25519).
   *Swap:* set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` and rebuild. The mock stays the default without them.
2. **Server super list (replaces snapshot warm start): READY-TO-CONNECT.** `api/_fn/bootstrap.js` + `api/_lib/presence.js`;
   `SupabaseSignal.presenceUpsert/List/Remove` work against table `public.presence` and are tested with a fake REST.
   *Swap:* run `supabase/schema.sql`, set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, and add the pg_cron purge line (commented in the SQL).
3. **Flood defense: PARTIAL.** There's a client token bucket (`Throttle`, 20 msg/s, burst 40; excess dropped). RLS on
   `realtime.messages` is in `schema.sql`: only broadcast on `mesh` (read/write) and `control` (read). Every `api/` route
   is wrapped by `api/_lib/guard.js` (per-IP + per-ID limits, body cap, optional geo/halt).
   *Swap:* run the SQL, turn on "private channels only" and per-client limits in Realtime settings.
   *v46:* the `mesh`/`control` policies moved to migration 20261027000013 (+14): only `authenticated` users with a fresh
   ADMISSION (`public.mesh_admit`, proof of work in SQL; or `public.mesh_admit_service` from the server after attestation), an
   age-checked profile and no suspension may join/send `mesh`; `control` is read-only. Anon is refused (verified live). Per-user
   limits in `app.mesh_gate_config` (6 attempts/h, 24/day, 12 h lifetime, cost b16 x k6, attested b12 x k2, `enabled` switch):
   `update app.mesh_gate_config set admit_per_hour = 10 where id;`. Suspend one user: `select public.mesh_suspend_service('<uuid>', 60, 'why');`
   (moderators: `mod_mesh_suspend` / `mod_mesh_lift`). Mesh-only users then need a session WITH an age check (sign-in card).
   *v40:* the server limiter is now GLOBAL when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set on Vercel (Supabase RPC
   `public.rl_hit`, migration 20261027000008, applied to dev); without them, or if the DB is slow/down, it falls back to per instance.
   *v41:* the same env switches `api/refund` to the shared mesh refund ledger (`public.mesh_refund`, migration 20261027000009); if the
   DB is down a claim answers `unavailable` (no refund). Support (SQL editor, service role): held refunds =
   `select * from app.boost_refund_log where outcome = 'held' order by created_at;` release one = `select public.boost_refund_release(<id>, 'why');`
   goodwill refund of one unread boosted message = `select public.boost_refund_admin('<message uuid>', 'why');`. Stripe money refunds: dashboard only.
4. **Vercel Firewall/WAF: NOTES ONLY (no account changes).** In the dashboard, under Firewall: (a) rate-limit `/api/*` to 60 req/min
   per IP (deny 429); (b) `/api/bootstrap` POST at 10/min per IP; (c) `/api/kill` and `/api/ban` at 10/min per IP; (d) Bot
   Protection / Attack Challenge Mode on standby; (e) block methods other than GET/POST/OPTIONS on `/api/*`. `vercel.json`
   has no firewall syntax that I'm confident in, so the rules stay in the dashboard (or Vercel's firewall API later).
5. **Upload cap + rate limit: READY-TO-CONNECT.** The snapshot upload is gone. Entry POSTs are capped at 8 KB (one signed
   row), and bootstrap is limited to 60/min per IP and 30/min per ID. (The interim 512 KB snapshot cap is superseded.)
6. **US-only: READY-TO-CONNECT.** `api/_lib/geo.js` checks `x-vercel-ip-country` at entry, heartbeat and the 24h check-in.
   Non-US gets 451 with a clear notice (`src/ban.js` banner). A traveler last seen in the US within `CM_TRAVEL_GRACE_DAYS`
   gets a warning instead. The last US check-in is stored in `geo_seen`. Checkout and voice also refuse non-US.
7. **Server ban list with strike levels: READY-TO-CONNECT.** `blocklist.level/strikes/suspended_until` are in `schema.sql`.
   Bootstrap and the check-in return the level and warning; 403 for levels 4-5; the 24h check-in is wired in `src/app-mesh.js`.
8. **Kill key: READY-TO-CONNECT.** The server reads only `KILL_PUBKEY`. Signing happens offline (`scripts/mod.mjs`, encrypted
   keyfile outside the repo). The tests scan for private kill key material server-side and in the bundles.
9. **Play Integrity / App Attest: PARTIAL.** `api/_fn/attest.js` `attestConfig()` reads the env vars. The token decode/verify
   steps are TODOs listed inline. Until then IDs are flagged `unattested`, not refused.
10. **Stripe US-only: PARTIAL.** Checkout is card-only with a required billing address. The webhook `usCheck()` reads the card
    issuing country and billing country from Stripe: both must be `US`, otherwise it refunds or cancels and issues no receipt.
    Also add Radar rules (`:card_country: != 'US'`, `:billing_address_country: != 'US'`). *Partial because* `stripe()` only
    accepts `sk_test_` keys until live mode is approved.
11. **xAI via Edge Function: READY-TO-CONNECT.** `supabase/functions/grok-profile/index.ts` (+ `_shared/grok-core.js`, tested):
    requires a Supabase user JWT (enable Anonymous sign-ins), 10 requests/hour and 30/day per user (per isolate, so *partial*
    for global counts), 16 KB body, 40 answers × 500 chars, sensitive categories stripped, and dating requires an adult account.
    Client: `src/grok-profile.js`.
    *Swap:* `supabase functions deploy grok-profile` and `supabase secrets set XAI_API_KEY=...`. The xAI org needs Zero Data
    Retention (ZDR) confirmed.

## Order on the day
1. Create the project and run `supabase/schema.sql`. 2. Turn on Realtime private channels + limits, and Anonymous sign-ins.
3. Set the Vercel env vars. 4. Deploy the Edge Function and its secrets. 5. Add the Firewall rules. 6. Run `npm run smoke`, then a 2-phone test.

## Additions (2026-10-20 night)
- [ ] `recent_people` table (code pk, name, thumb, interests, modes, adult, last_seen), keep newest 500; wire `sig.recent` in SupabaseSignal (in-memory today).
- [ ] `refund_ledger` (msg_id pk, from, to, at, rcpt, refunded) for api/_fn/refund.js; Stripe refund in `pay()`.
- [ ] `reports` stores sealed blobs only; set `VITE_MOD_REPORT_PUBKEY` (public key only).
- [ ] `linked_devices` (pid, dev_hash, dev_pub, at), cap 5.
- [ ] TURN server (`VITE_TURN_URL/USER/CRED`) before calls can work across NATs.
