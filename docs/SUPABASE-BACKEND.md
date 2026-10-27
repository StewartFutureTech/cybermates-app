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

## Messages
Body = nacl box ciphertext sealed to the peer's `profiles.e2e_pubkey` (public half of the device-key vault keys; secret never
leaves the device). 7-day hold (`expires_at`, hidden by RLS, hourly pg_cron purge). Status sent→delivered→read, recipient-only,
monotonic. Boosts: `boost_ledger` (grants = service role/purchase webhook); a boosted message costs 1, refunded once if it expires
unread or the recipient blocks the sender.

## Tests
* `scripts/smoke-supa-adapter.mjs` (offline) and `scripts/smoke-supa-live.mjs` (live, 73 checks) run in `scripts/regress.sh`.
* Live test users: set `SUPA_TEST_USERS` (4 confirmed email/password users: adult1, adult2, minor1, minor2) or enable
  Anonymous sign-ins. The test deletes every user it used (`delete_my_account`). Without either it prints SKIP (SUPA_LIVE=1 → fail).

## Needs the project owner (dashboard)
* Auth > Sign In / Providers: enable **Anonymous sign-ins** (guest → linked upgrade; also lets the live test self-provision).
* Auth > URL Configuration: Site URL `https://cybermates-stewart-future-tech.vercel.app`, Redirect URLs add that origin `/**`,
  `http://localhost:5173/**`, and the Capacitor scheme if magic links should open the app.
* Auth > SMTP: custom SMTP (Resend/Postmark/SES). Built-in mailer is ~2 emails/hour and not for production.
* Auth > Email templates: put `{{ .Token }}` in the Magic Link template so OTP codes work in the PWA/Android WebView.
* Auth > Attack protection: CAPTCHA (Turnstile/hCaptcha) for signup/OTP; enable leaked-password protection if passwords are ever used.
* Service-role key: only in server envs (Vercel functions / Edge Functions) for purchase grants & moderation. Never VITE_*.
