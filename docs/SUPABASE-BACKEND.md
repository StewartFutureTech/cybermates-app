# Cybermates central Supabase backend (v3)

Project `dapocxyyrexemnmpzzsr` (us-east-1). Migrations: `supabase/migrations/2026102100000{1..5}_*.sql` (already applied live).
Client: `src/backend/supabase-{config,client,auth,store,realtime,e2e,backend}.js`, behind the same async adapter
method names as `LocalAdapter` (see `ADAPTER_METHODS` in supabase-store.js). Nothing in the app imports it yet; features swap by
using `createSupabaseBackend()` instead of the local/mesh adapter.

## Invariant: minor/adult separation
* `profiles.age_band` is set only by `submit_age_check(birthdate)` (first call wins, birth date not stored, <13 rejected).
  Column privileges make it non-writable by clients; changing it needs the service role.
* Every social read/write goes through `app.same_band()` / `app.can_interact()` (same band AND not blocked) in RLS:
  profiles, interests, games, prefs, photos (+Storage objects), friends, conversations (band frozen + re-checked), messages,
  LFG, events, roulette, `find_matches()`. Realtime private channels: `presence:<band>` only for your own band,
  `conv:<id>` (typing/voice signaling) only for members.
* Minors: trigger rejects `dating`/`roulette` modes and dating prefs; `roulette_queue` is adult-only.
* Reports are the one deliberate cross-band write (e.g. an adult in minor space), write-only to the reporter.

## Team review bucket (v39, migration 20261027000007)
* `public.moderators(user_id, role reviewer|lead, active)`: written ONLY with the service role/dashboard; trigger requires an adult profile;
  clients can read only their own row. `public.report_actions`: append-only audit (no client writes; moderators can read).
* RPCs (authenticated only, checks inside `app.*`): `am_moderator()`, `mod_queue(p_bucket 'serious'|'open'|'resolved'|'all', p_limit)` (includes
  evidence + moderator_note + both bands), `mod_claim(id)`, `mod_resolve(id, status, note)`. Non-moderators get 42501; P1 dismiss = lead only;
  conflict of interest (you filed it / you are named) refused. Reporter view unchanged (status only, no note/evidence).
* Live test: `supabase/tests/report_review_rls.sql` (24 checks in one transaction that always rolls back).

## Global rate limits (v40, migration 20261027000008)
* `app.rate_limit_buckets(key, window_start, expires_at, count)`: private schema (not exposed by PostgREST), RLS on with no
  policies, no grants to anon/authenticated. Keys arrive HMAC-SHA256-hashed from the server (`route|ip|<hash>`), never raw IPs/IDs.
* `public.rl_hit(p_key, p_limit, p_window_secs default 60) -> {allowed, count, limit, reset_ms}`: SECURITY DEFINER, `search_path=''`,
  fixed window, one `INSERT .. ON CONFLICT DO UPDATE count = count + 1` (concurrent instances serialize on the row lock, no lost
  increments). EXECUTE for **service_role only** (anon/authenticated get 42501). ~2% of calls run `app.rl_cleanup()` (deletes
  windows that ended over a minute ago). Core `app.rl_hit_at(..., p_at)` takes an explicit time for tests; not client-callable.
* Server side: `api/_lib/globalrl.js` + `api/_lib/guard.js` (layer 1 in-memory per instance, layer 2 this RPC). Fail safe: env
  missing, `CM_GLOBAL_RL=off`, RPC error or >350 ms -> per-instance limiter only, DB skipped for 30 s.
* Live test: `supabase/tests/global_rate_limits.sql` (26 checks, rolls back). Advisors: one INFO `rls_enabled_no_policy` on
  `app.rate_limit_buckets` - intentional (deny-all; only the definer RPC touches it).

## Messages
Body = nacl box ciphertext sealed to the peer's `profiles.e2e_pubkey` (public half of the device-key vault keys; secret never
leaves the device). 7-day hold (`expires_at`, hidden by RLS, hourly pg_cron purge). Status sent→delivered→read, recipient-only,
monotonic. Boosts: `boost_ledger` (grants = service role/purchase webhook); a boosted message costs 1, refunded once if it expires
unread, the recipient blocks the sender, or (v41) the recipient deletes their account - decided by `app.boost_refund_decide` (below).

## Conservative boost refunds (v41, migration 20261027000009)
Boost credits only - no Stripe / real-money calls (money refunds stay manual in the Stripe dashboard).
* `app.boost_refund_decide(message, cause 'expired'|'blocked'|'recipient_deleted'|'admin', actor, note) -> outcome`, SECURITY DEFINER,
  `search_path=''`, not client-callable. Order: already refunded -> `duplicate`; no `spend` (-1) row by that sender -> `denied_no_spend`;
  message row gone -> `denied_not_eligible`; `read` -> `denied_read`; cause not true (not expired / no block / admin outside the service
  path) -> `denied_not_eligible`; sender already has `app.boost_refund_daily_cap()` (10) refunds in the last 24 h -> `held` (no credit);
  else +1 `refund` row (unique per message) -> `refunded` (+ un-pin on block). Per-sender advisory lock = same lock as the spend path.
* Callers: `app.purge_expired()` (hourly pg_cron), `blocks_refund` trigger, new `profile_delete_refunds` BEFORE DELETE on `profiles`
  (runs before the cascade), legacy `app.refund_boost(uuid)` (wrapper).
* `app.boost_refund_log`: append-only audit (UPDATE/DELETE raise 42501), private schema, RLS on / no policies / no client grants, no FKs.
* `public.my_boost_refunds(p_limit)` (authenticated; own rows only via `auth.uid()`), `public.boost_refund_admin(message, note)` and
  `public.boost_refund_release(log_id, note)` (service role ONLY; note required; spend-bound; bypass the cap; release only `held` rows).
* Mesh path ledger: `app.mesh_boost_refunds` + `public.mesh_refund(op, msg, from_hash, to_hash, min_age_ms)` (service role ONLY):
  register (300 / 24 h per sender) / receipt (Ed25519-verified by the API first) / claim (>= 8 s, no receipt, 10 refunds / 24 h per
  sender, idempotent). Codes arrive HMAC-hashed; rows older than 8 days are dropped by the purge.
* Live test: `supabase/tests/boost_refunds.sql` (66 checks, rolls back). Advisors: INFO `rls_enabled_no_policy` on the two new app
  tables (intentional deny-all) and WARN definer-callable on `my_boost_refunds` (intentional: read-only, own rows only).

## Tests
* `scripts/smoke-supa-adapter.mjs` (offline) and `scripts/smoke-supa-live.mjs` (live, 73 checks) run in `scripts/regress.sh`.
* Live test users: set `SUPA_TEST_USERS` (4 confirmed email/password users: adult1, adult2, minor1, minor2) or enable
  Anonymous sign-ins. The test deletes every user it used (`delete_my_account`). Without either it prints SKIP (SUPA_LIVE=1 → fail).

## Needs the project owner (dashboard)
* Vercel project env (server only, never `VITE_`): `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (+ optional `RL_KEY_SALT`) to switch on the
  v40 global rate limits and the v41 shared mesh refund ledger (and the server routes that already use them). Not set yet: the API runs
  per-instance limits and a per-instance refund ledger only. Optional `REFUND_KEY_SALT` (else `RL_KEY_SALT`) for the refund code hashes.
* Auth > Sign In / Providers: enable **Anonymous sign-ins** (guest → linked upgrade; also lets the live test self-provision).
* Auth > URL Configuration: Site URL `https://cybermates-stewart-future-tech.vercel.app`, Redirect URLs add that origin `/**`,
  `http://localhost:5173/**`, and the Capacitor scheme if magic links should open the app.
* Auth > SMTP: custom SMTP (Resend/Postmark/SES). Built-in mailer is ~2 emails/hour and not for production.
* Auth > Email templates: put `{{ .Token }}` in the Magic Link template so OTP codes work in the PWA/Android WebView.
* Auth > Attack protection: CAPTCHA (Turnstile/hCaptcha) for signup/OTP; enable leaked-password protection if passwords are ever used.
* Service-role key: only in server envs (Vercel functions / Edge Functions) for purchase grants & moderation. Never VITE_*.
