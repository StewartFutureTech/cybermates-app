# Cybermates (prototype)

Mobile-first PWA for **dating, friends and gaming** (18+, global) where people only match when they share something real — games, platforms, anime, shows, teams, interests.

Live demo: https://cybermates-stewart-future-tech.vercel.app (data lives only in your browser; Dev tab → switch between 30 fake test users).

## Run
```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # -> dist/ (static)
npm run smoke      # logic smoke test (seed, matching, voice parsing, starters/boosts)
node scripts/inline.mjs   # optional: dist-single/index.html with JS/CSS inlined
```
Deploy: any static host. Vercel: `vercel.json` included (build `npm run build`, output `dist`). GitHub Pages / Netlify / Cloudflare Pages: publish `dist/`.

## Architecture
Plain JS + Vite, no framework, ~30 KB JS.

| File | Role |
|---|---|
| `src/data.js` | Option catalogs (platforms, socials, streaming, games, anime, teams…), OkCupid-style questions, deterministic generator of 30 **fake** seed profiles |
| `src/store.js` | **Data adapter** (`db`). `LocalAdapter` = localStorage. Messaging rules + mock wallet live here |
| `src/match.js` | Matching: hard filters (mode, 18+, gender/age prefs, distance) → **must share ≥1 item** → score = 60% OkCupid question score (geometric mean of mutual weighted satisfaction, importance 0/1/10/50/250) + 40% shared-item density |
| `src/voice.js` | Web Speech API: `speechSynthesis` reads questions, `SpeechRecognition` captures answers; parsers for lists, numbers, single choice, "my Xbox is X and Steam is Y" handles |
| `src/main.js` | UI: Discover (mode tabs + match cards with % and shared items), Inbox/chat, Voice setup, Profile editor, Shop (mock), Dev panel |
| `public/sw.js`, `manifest.webmanifest` | PWA install + offline shell |

**Voice onboarding:** each step is spoken aloud; user answers by mic (Chrome/Edge/Safari) or types a free sentence; the parse fills a structured field that is always manually editable. Browsers without SpeechRecognition (e.g. Firefox) get typing mode automatically.

**Messaging economy:** replies in existing conversations are unlimited and always deliver. Starting a *new* conversation uses 1 of 5 free daily starters (resets daily), then purchased starters. 🚀 Boost pins the message to the top of the recipient's inbox until read. Shop is **mock only** — no payments.

**Modes:** Dating, Friends, Gaming. Gaming matches on games/platforms (and esports); Dating also applies mutual gender/age filters.

**Global location & per-mode distance:** profiles carry `city`, `region`, `countryCode`, `lat/lng` (📍 Use my location = GPS + free BigDataCloud client reverse-geocode). Each mode has its own range (`distPrefs`): radius (mi or km), same city, same state/region, same country, or global. Defaults: Dating 50 mi (80 km outside US/UK), Friends same region, Gaming global. **Both** people's ranges must include each other. Seed spans US, UK, CA, DE, JP, AU, BR, PH, MX.

**Handoff hub (`src/handoff.js`):** Cybermates doesn't replace Discord/Steam/Instagram — it holds your tags and hands off. Every visible account has 📋 copy and ↗ open (Steam, Xbox, PSN, Twitch, Kick, YouTube, Instagram, TikTok, X, Snapchat, Reddit, Threads, Bluesky). Copy-only platforms (Discord username, Riot ID, Nintendo code, Battle.net…) show "how to add" instructions. Optional Discord server invite. Per-account privacy: 🌐 Everyone / 🤝 After mutual match (both have messaged) / 🙈 Hidden. After a mutual match you can send your linked-accounts card in chat. In Supabase mode accounts live in `linked_accounts`, protected by RLS (`is_mutual`). Research: `RESEARCH.md`.

## Wiring Supabase (free tier) for real multi-user use
**Implemented:** `supabase/schema.sql` (tables, RLS, `send_message`/`inbox`/`get_wallet`/`mark_read`/`mock_purchase`/`credit_wallet` RPCs) and `src/store.supabase.js`. Run the SQL, enable Anonymous sign-ins, set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in `.env.local`; without them the app uses localStorage. Pricing/Stripe plan: `MONETIZATION.md`.

Original sketch:
1. Create a Supabase project; `npm i @supabase/supabase-js`; set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
2. Schema:
```sql
create table profiles (id uuid primary key references auth.users, data jsonb not null, lat float, lng float, updated_at timestamptz default now());
create table messages (id uuid primary key default gen_random_uuid(), sender uuid references profiles, recipient uuid references profiles,
  body text not null, boosted bool default false, read bool default false, created_at timestamptz default now());
create table wallets (user_id uuid primary key references profiles, day date, starters_used int default 0, extra_starters int default 0, boosts int default 0);
alter table profiles enable row level security; alter table messages enable row level security; alter table wallets enable row level security;
create policy "read profiles" on profiles for select using (auth.role() = 'authenticated');
create policy "own profile" on profiles for all using (auth.uid() = id);
create policy "my messages" on messages for select using (auth.uid() in (sender, recipient));
create policy "mark read" on messages for update using (auth.uid() = recipient);
create policy "own wallet read" on wallets for select using (auth.uid() = user_id);
-- inserts into messages and wallet changes go through an RPC so clients can't bypass the starter limit:
create function send_message(to_user uuid, body text, boost bool) returns messages ... security definer
```
3. Add `SupabaseAdapter` in `src/store.js` implementing the same methods (`listProfiles`, `getProfile`, `upsertProfile`, `listMessages`, `sendMessage`→`rpc('send_message')`, `markRead`, `getWallet`, `mockPurchase`, `getCurrentUserId`→`auth.getUser()`), and export it as `db` when env vars are set. Use `supabase.channel(...).on('postgres_changes', …)` for live inbox updates.
4. Move matching server-side (SQL/Edge Function with PostGIS `ST_DWithin`) once user count grows; never ship all profiles to the client.
5. Payments: Stripe Checkout + webhook (Edge Function) crediting `wallets`.

## Why not pure P2P?
WebRTC still needs a **signaling server** to introduce peers (plus STUN/TURN for NAT traversal), and a dating app needs **offline delivery** (recipient's phone is asleep), **discovery/search over everyone's profiles**, moderation/blocking/reporting, and **enforceable limits** (5 starters/day, paid boosts) — none of which work when each client is its own authority. A free-tier backend (Supabase) is simpler, cheaper and safer.

## Known gaps / next steps
- Local-only data: users on different devices can't see each other until the Supabase adapter is written.
- No auth, photos, blocking/reporting, moderation, real age/ID verification, or push notifications.
- Typed-city geocoding only knows the seed city list; other cities need the 📍 GPS button (or a geocoding API later).
- Voice parsing is keyword-based; an LLM parse step would handle free-form answers better.
- Seed profiles are random-generated and clearly marked `(TEST)`.

## Onboarding (scripted, no AI)
One question per screen with a progress bar, Back / Skip / "Review all". Each question is read aloud (Web Speech) and can be answered by 🎙️ voice, big tap-chips (popular picks first, "More…" for the rest), or typing "like you'd say it". Parsing is keyword + synonym based (`src/voice.js` `SYNONYMS`, `smartList`, `crossPick`): "I play Halo and cod on xbox" fills **games** (Halo, Call of Duty) *and* **platforms** (Xbox) and tells you what it also added. Dating-only questions (who you date, age range) appear only if Dating is picked. Gamer-tag inputs show only the platforms you chose. ~14 core steps → review screen (tap any row to edit) → optional "Add more" (shows, teams, lifestyle, compatibility questions).

## Photos
Optional. No photo = colorful initials avatar. Up to 3 photos (downscaled to 480px in-browser). Per-user setting: show photos to everyone, or **only after a mutual match** (default). Supabase mode: photos currently ride in `profiles.data` — move them to Storage with signed URLs gated by `is_mutual` before launch.

## Verified badge (placeholder) — roadmap
The ✔ badge (seed flag `verified`) and the "Get verified — coming soon" card are **UI previews only; nothing is verified**. Roadmap:
1. Selfie liveness + AI real-photo check (compare live selfie to profile photos; vendor e.g. AWS Rekognition / Persona / Yoti).
2. Optional government-ID verification + age assurance (18+) for markets that require it.
3. Badge levels (photo-verified, ID-verified), re-check on photo change, and a "verified only" filter (Cybermates+).

## P2P peer network + kill switch

**Files:** `src/p2p.js` (consent, handshake, WebRTC, transports), `src/killswitch.js` (Ed25519 verify/sign), `src/p2p-ui.js` (consent dialog, Dev-tab panel, kill banner), `scripts/kill-switch.mjs`, `scripts/smoke-p2p.mjs`, `supabase/schema.sql` (`kill_switch`, `p2p_consents`).

- **Consent first.** Nobody joins presence or opens WebRTC until they tick the P2P notice (`CONSENT_VERSION` in `src/p2p.js`). It covers: peers may see your IP, TURN relay is on by default, central moderation/kill switch, and your device is never used as a relay or compute for others. Version + timestamp are saved locally (and in `p2p_consents` in Supabase mode). Bumping the version asks everyone again.
- **Handshake.** Every signaling message carries `{userId, consent_version, consented_at, relay_only}`. A peer is refused if this attestation is missing or out of date, or if the two users aren't a mutual match.
- **ICE.** Relay only (`iceTransportPolicy: 'relay'`). The TURN server is a placeholder until you set `VITE_TURN_URLS`, `VITE_TURN_USERNAME` and `VITE_TURN_CREDENTIAL`, so **real connections won't work until a TURN provider is set up**.
- **Kill switch.** The message is `{type:'kill'|'clear', scope:'all'|'user:<id>'|'session:<id>', reason, issued_at, expires_at, nonce, sig}` (ms timestamps; Ed25519 over the canonical fields). Clients check the signature against `VITE_KILL_PUBKEY` (the **DEV-ONLY** key in `src/killswitch.js` is used only on the dev server or with `VITE_ALLOW_DEV_KILL_KEY=1`; production builds without the env var trust **no** key), the window (live broadcasts must be under 10 min old, nothing past `expires_at`, at most 2 min of clock skew allowed) and the nonce, which must not have been seen before. A valid kill closes every RTCPeerConnection, leaves presence, saves the kill state, blocks rejoining and shows a red banner. Live delivery is over the Realtime channel `control`. On startup each client also reads the signed `kill_switch` row so devices that were offline still honor it. Only the service role can write that row. Local mode simulates the channel with BroadcastChannel (Dev tab → Peer network → paste a signed message).

### How David triggers it
```bash
node scripts/mod.mjs keygen                    # once. Writes a passphrase-encrypted keyfile to ~/.cybermates/kill.key (outside the repo); prints VITE_KILL_PUBKEY for Vercel env
export SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=...   # the kill key is NEVER an env var; mod.mjs prompts for the keyfile passphrase
node scripts/kill-switch.mjs trigger --scope all --reason "Legal hold" [--ttl-hours 720]
node scripts/kill-switch.mjs trigger --scope user:<uuid> --reason "Abuse report"
node scripts/kill-switch.mjs clear              # lifts it (sends a signed 'clear' and replaces the record)
node scripts/kill-switch.mjs trigger --dry-run  # or leave the Supabase env unset: prints the signed message and sends nothing
```
Never commit private keys. The dev private key lives outside the repo, and the build only contains public keys.

## Device gate (Android emulator check)

- `src/device-gate.js` — `checkDevice()` / `assertRealDevice()`. Android native → calls the custom Capacitor plugin `EmulatorCheck` (`{isEmulator, reasons}`); if emulator, **finishing signup/onboarding** and **joining the peer network** are blocked with a friendly message. iOS native → allowed (no simulator check). Web → allowed. Plugin missing/error → fails open (logged in `reasons`).
- Dev toggle: Dev tab → "Simulate emulator", or `localStorage.cm_sim_emulator = '1'`, or `?simEmulator=1`.
- The gate is a yes/no check only. Network identity is the **ID key** (see *Two-key design*); attestation hooks live in `src/attest.js` / `api/_fn/attest.js`.
- Plugin source: `android/app/src/main/java/com/cybermates/app/EmulatorCheckPlugin.java` (registered in `MainActivity.java`). Checks ro.kernel.qemu, ro.hardware, Build.FINGERPRINT/MODEL/MANUFACTURER/BRAND+DEVICE/PRODUCT/HARDWARE, BlueStacks/Nox/LDPlayer tells. Heuristic, not anti-tamper.
- Smoke: `scripts/smoke-gate.mjs` (run by `npm run smoke`).

### Build the Android app
Needs JDK 17 + Android SDK (Android Studio). Capacitor 6 is in devDependencies; `android/` is committed.
```
npm install
npm run build && npx cap sync android
npx cap open android          # or: cd android && ./gradlew assembleDebug
```
APK: `android/app/build/outputs/apk/debug/app-debug.apk`. Verify: on an Android Studio emulator, onboarding "Start matching" and Dev → Join peer network should show the emulator message; on a real phone they proceed.
iOS: `npm i -D @capacitor/ios@6 && npx cap add ios` (Mac/Xcode) — no native gate there.

## Architecture (security, social mesh, payments) — added 2026-10-16

| Module | Purpose |
|---|---|
| `src/vault.js` | Device-bound encryption at rest. Key = PBKDF2_v(SHA-256(SHA-256(HMAC(install secret, device info)))). Install secret = random **non-extractable** HMAC CryptoKey in IndexedDB. Profile blob: outer AES-GCM + per-field envelope (random data key per field, wrapped by device key, field name bound as AAD). `vault.use(fn)` decrypts in memory, re-encrypts after. |
| `src/appconfig.js` | Version rotation: `APP_VERSION` = KDF version. Two-version window (N, N-1). Handshake (`p2p.js` attestation `app_version`) rejects older peers with "please update". Min version can be raised via signed `app_config` record (Ed25519, same key/style as kill switch; kill switch code untouched). |
| `src/transfer.js` + `src/settings-ui.js` | "Transfer to new device" (Advanced settings). 6-digit code, 10-min TTL, PBKDF2(code, salt) → AES-GCM + HMAC proofs; sender burns code after 5 wrong proofs; receiver re-encrypts with its own device key; old device wipes after authenticated confirmation. |
| `src/mesh.js` | Presence-gated starters (≤500 chars, text only; offline ⇒ "Offline, try later", no starter consumed), block-by-user-code (dropped at destination, sender gets "You've been blocked" + refund), ephemeral chat, opt-in encrypted save, mutual burn mode, mutual friends with Ed25519-signed profile updates, 50-profile gossip cache with recency buckets (online ≤5 min / ~2h / ~4h / ~6h+ / drop after 2 days). `SimMesh` is an in-memory flooding mesh for tests. |
| `src/entitlements.js`, `api/*` | Stripe Checkout (test mode) via `api/_fn/checkout.js`; `api/stripe-webhook.js` verifies Stripe signature and stores Ed25519 server-signed receipts; `api/_fn/entitlement.js` returns them on login; `api/_fn/cancel.js` (in-app cancel); `api/_fn/cron-inactive.js` daily job cancels subs after `INACTIVE_DAYS` (default 30). All return 501 until env keys are set. |

Network identity = the **ID key** (`src/identity.js`, stable device data only), **not** the private vault hash key, which is only an encryption key and never leaves the device. Legacy random 10-char codes are migrated (see *Two-key design*).

Env (server only): `STRIPE_SECRET_KEY` (sk_test_…), `STRIPE_WEBHOOK_SECRET`, `RECEIPT_SIGNING_SEED`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `INACTIVE_DAYS`, optional `ID_BIND_SEED` (32-byte hex/base64, generated offline: v43 server-signed ID binding certs; the app then needs `VITE_ID_BIND_PUBKEY`) / `ID_BIND_SALT` / `ID_REBIND_IDLE_DAYS` (v43), optional `RL_KEY_SALT` / `CM_GLOBAL_RL=off` (v40 global rate limits), optional `REFUND_KEY_SALT` / `CM_REFUND_STORE=memory` (v41 refund ledger). Client: `VITE_RECEIPT_PUBKEY`. Replace the `price_*_TEST` ids in `api/_lib/receipt.js`.

### Honest security limits
- **Client-side checks are bypassable.** Emulator gate, starter counters, receipt verification, block/refund and burn mode all run on a device the user controls; a modified/rooted client can skip them. Anything worth money must be enforced server-side (e.g. server-counted starters/boosts). The server must verify every payment via the Stripe webhook — never trust the app.
- Encryption at rest stops casual file/memory value scanners and copying the blob to another phone. It does **not** stop an attacker with code execution on the unlocked device (the non-extractable key can still be *used*). Install secret is in IndexedDB, not Android Keystore / iOS Keychain (gap: add a secure-storage plugin). Android 10+ and iOS block serial/IMEI, so device info is low-entropy; strength comes from the random install secret. `@capacitor/device` is used if installed, otherwise a web fallback string.
- Transfer is "PAKE-lite", not a real PAKE: whoever records relay traffic can brute-force the 6-digit code offline (10^6 × PBKDF2). Rate limiting only stops online guessing.
- Burn/ephemeral: the other person can screenshot or run a modified client. "Deleted" is best-effort.
- Blocked notice intentionally reveals the block (product requirement).
- Gossip profiles are self-signed with TOFU pinning; the user code is not cryptographically bound to the key (a squatter could claim an unseen code first). Mesh envelope payloads are not yet sealed per-recipient on the relay path (WebRTC data channels are DTLS; Supabase broadcast is not E2E) — gap.
- `api/_fn/entitlement.js` / `api/_fn/cancel.js` take a user code with no auth — must add Supabase JWT auth before production.
- Version window and kill/config records rely on the signing key staying secret.

### App Store / Play billing rules
Apple (App Store Guideline 3.1.1) and Google Play (Payments policy) generally require **in-app purchase / Play Billing for digital goods** like boosts, starters and subscriptions consumed in the app. Stripe Checkout is fine for the web PWA; native store builds must use IAP/Play Billing (or qualify for an exception, e.g. US external-link entitlements / Play user-choice billing programs — check current rules before shipping). Deleting the app does **not** cancel a Stripe subscription; the in-app "Cancel subscription" button does (at period end). Unpaid renewal ⇒ feature removed on next entitlement refresh, account untouched.

## Wallet security, twins, voice product, terms — added 2026-10-16 (follow-up)

- **Encrypted wallet (`src/wallet.js`)**: boost/starter/voice counters exist only in an encrypted vault blob (`cybermates:wallet:*` in localStorage, key from the device vault). Legacy plaintext `LocalAdapter` wallets are migrated in and deleted. Plaintext exists only in memory inside a locked spend. The UI only gets a frozen, sanitized display value (`getWalletView` / `subscribeWallet`) and cannot write it back.
- **Guarded spend**: read (decrypt) → check ≥1 → deduct → re-encrypt → commit → re-read & verify `after == before − 1` → on mismatch roll back and abort the send. Applies to boosts and starters (both or nothing). Used by the real chat send path (`db.sendMessage`).
- **Atomicity**: `navigator.locks.request('cm-wallet')` across tabs/instances when available, plus an optimistic compare-and-swap on a version counter on every commit (retries on conflict) — correct even without Web Locks. Tested: balance 1 + 2 concurrent spends ⇒ exactly 1 succeeds; balance 5 ⇒ 3.
- **Twins**: same profile on the same device (same install secret) ⇒ same `twinHash` = SHA-256(SHA-256(AES-GCM_deviceKey(fixed IV, constant))), which doesn't reveal the key. Announced on BroadcastChannel `cm-twins` and in mesh `ping` presence. After a spend, the spender broadcasts the new count encrypted with the device key; twins decrypt and refresh. Limit: iOS Safari tab vs installed PWA vs the Capacitor app have **separate storage**, so they are *not* twins (separate caches). The server stays canonical for them. A transferred device is never a twin (different secret; old device wiped).
- **Wallet authority**: superseded by the local-first architecture below. There is no server wallet; the encrypted local vault is the only balance.
- **Grok voice setup** ($4.99 one-time, SKU `voice30`): 30-minute cap per purchase (Grok Voice ~$0.08/min ⇒ ≤ ~$2.40 cost). Mock shop item, `voice_cap_ms`/`voice_used_ms` receipt fields, `src/voice-session.js` timer hard-stops at the remaining cap, `api/_fn/voice-session.js` would mint an ephemeral token (501 without `XAI_API_KEY`; the endpoint must be checked against current xAI docs, and server-side entitlement checks are still TODO). The free scripted browser voice stays the default. Real purchases arrive as signed `voice30` receipts redeemed into the local wallet.
- **Terms acknowledgement (`src/terms.js`)**: a first-launch screen (checkbox + Accept) stores the accepted version and timestamp in the encrypted vault, and shows again when `TERMS_VERSION` changes. The P2P consent stays a separate dialog. Fine print: changing hardware or resetting the device/app data may lose access to the account on that device and require re-sync or transfer.
- **Device-bound purchases**: on transfer, profile, friends, settings and subscriptions move. Boost/starter/voice balances are stripped (reset to 0) and the old device is wiped. This is shown in the terms, the transfer screen and the shop. **Risk:** non-transferable paid consumables can conflict with consumer-protection law (e.g. EU/UK digital-content rules, US state laws) and with App Store / Play refund expectations. Users may get chargebacks or refund requests, and stores may reject the app. Consider server-side balances that follow the account, or prorated refunds, before charging real money.
- **Scale/ops**: Supabase free tier allows roughly **200 concurrent Realtime connections** (presence and broadcast), so a beta past ~200 simultaneous users needs a paid plan or a different relay. The signed **kill switch** (`src/killswitch.js`, `scripts/kill-switch.mjs`) can shut the peer network down for everyone, a user or a session.

## Architecture v2: local-first mesh (supersedes the central Supabase data model)

- **No central data**: profiles, messages, friends, block list and wallet are stored **only on the device**: LocalAdapter, plus the encrypted vault for identity, wallet, saved chats and terms. Chat goes only over the mesh (WebRTC data channels / relay signaling, `src/mesh.js`).
- **The server only does**:
  - ephemeral signaling and presence (Supabase Realtime presence and broadcast; nothing persisted);
  - Stripe Checkout, webhook and Ed25519-signed purchase receipts (`api/*`, tables `entitlements` and `app_users.last_seen` for the inactivity auto-cancel);
  - signed kill switch and `app_config` records;
  - a minimal write-only `reports` table.
- `supabase/schema.sql` is now v2. The v1 tables (`profiles`, `messages`, `wallets`, `purchases`, `linked_accounts`) and the RPCs (`send_message`, `inbox`, `get_wallet`, …) are deprecated, with DROP statements in the migration notes. The full v1 file is kept in `supabase/legacy/schema-v1-central.sql`. `src/store.supabase.js` is kept only for its Realtime client.
- **Wallet**: credited only by redeeming server-signed receipts (`SecureWallet.redeem`: signature checked, bound to user code, each `receipt_id` once per device). Spent via Web Locks + CAS + before/after re-read check. Subscriptions (Cybermates+) are checked from receipts (`activeFeatures`), not credited.

### Honest limits of v2
- **No offline delivery.** A message only arrives if the recipient is online. There's no store-and-forward, push or inbox on a server.
- **No server backup.** Losing or resetting the phone, clearing app data, or changing hardware loses everything not transferred. Transfer needs the old device working.
- **Local balances can be tampered with on rooted/jailbroken or modified clients.** The receipt-ID once-per-device rule can be defeated by wiping local state and re-redeeming. Without a server ledger nothing can prevent this: boosts and starters are honour-system enforced by honest peers. Peers can't verify a sender's balance either.
- Abuse handling is limited: the server has no content, so reports only contain what the reporter chooses to send.
- Presence/signaling metadata (who is online, who signals whom) is visible to the relay operator, even though content isn't stored.

## Presence-first storage (latest; overrides the 50-full-profile cache and the long-term chat save)
- **Online ⇒ full profile, offline ⇒ stub.** A peer's full signed profile is held **in memory only** (`MeshNode.live`) while they are online (presence ≤ 5 min). `purgeOffline()` drops it when they go offline. After that, `view(code)` returns only a **stub**: a tiny pixelated JPEG thumbnail (32×32, ≤ 4 KB, made by the owner in `src/thumb.js` and shipped with presence), display name, user code and last-seen bucket.
- **Persistence**: the 50-entry cache and friends now keep **stubs only**. Friends keep the relationship, their public signing key and a stub (`persistable()`). Stranger stubs follow the recency ladder and are dropped after 2 days; friend stubs are kept. Full profiles and full images of other people are never persisted.
- **UX: "Connect now, make plans for tomorrow."** Discover shows **Online now** first, with stub cards for recently online people (the local demo rotates seed presence every 10 min). Chat retention follows the three bubbles both people agree on: "Keep forever", "Keep for a while + 7-day safety copy" and "Hide instantly, kept 7 days for safety reports"; under-18 chats are always retained. No user-facing text promises a fixed deletion time. A single short-lived **plans note** per person (≤ 280 chars, encrypted in the vault).
- Limits: a peer can screenshot or record your full profile while you're online. "Purged" means removed from our app's memory/storage, not from someone else's device or a modified client.

## On-phone peer discovery: gossip membership (`src/membership.js`)
**Design: every phone keeps the FULL active list** (one `global` list) as long as there are fewer than **100,000 active users**. The threshold can be changed through the signed `app_config` field `shard_threshold`. Above it, phones switch automatically to sharded lists, with **±10% hysteresis** so they don't flip back and forth: they go sharded above 110k and back to global below 90k. Sharding is a **dormant fallback**: it's tested but not tuned. **At large scale, the planned path is a server-based directory/profile service**, not tuning the gossip further.

- **Rows** (signed by their owner with Ed25519, key pinned on first sight): user code, coarse cell (geohash level 3, about 156 km), shard, game tags, incarnation, last-seen, public key and state. There is **no IP/ICE data**; that is exchanged only at connect time over signaling, and rows with extra fields are rejected.
- **Bootstrap** (`Rendezvous`): a tiny in-memory server holding up to 8 recent seeds **per requested shard**, refreshed by check-ins and expired after 10 minutes. Nothing durable is stored. A seed returns its active-list slice. The joiner sends a signed `join` to its seeds, and every node forwards it **once** to 5 random peers (fanout 5, TTL 8, dedupe by message id). Periodic **anti-entropy** pulls from a random peer send a compact version vector (one number per known code) and get back only newer or missing rows.
- **Leave**: a signed `leave` is sent on `pagehide` or when the app is hidden; the phone re-joins with a higher incarnation when it becomes visible again. Forged leaves fail the signature or key-pin check.
- **Dead phones** (SWIM-style, lazy): a failed contact makes the phone a signed `suspect`. It is marked offline only after **2 distinct reporters**, or after a 30-second timeout once someone suspects it. A live phone **refutes** a suspicion by raising its incarnation number and gossiping `alive`. Offline users move to the inactive list (stubs only) and are dropped after 2 days.
- **Silo/partition resistance** (kept because it's cheap): each phone keeps 4 random **cross-shard long links**, refreshed by shuffling, and can **look up a shard** it lacks by forwarding the request over long links. Phones with fewer than 3 peers in a shard re-bootstrap. Pulls over long links merge partitioned clusters.

**Simulation numbers** (`scripts/smoke-membership.mjs`, deterministic, 20–120 ms latency; the 1,000-node run is a single list, the same thing as the global mode):
| Scenario | Result |
|---|---|
| Join into 1,000 phones | push reaches 99.5% (99% within 430 ms, quiet at 560 ms); about **4.7 messages per phone** (max 6) per join event, so roughly the fanout per event with log₅N ≈ 4–5 hops; 100% after 2 anti-entropy rounds |
| Leave | 100% moved to inactive (about 8.9 messages per phone including the anti-entropy pulls) |
| Dead phone (2 reporters) | 97.8% remove it by push; the rest remove it lazily on their own failed contact plus the timeout, giving 100% |
| False suspicion | refuted (incarnation 0→1); still active at ≥99% of phones |
| Cold bootstrap, 200 phones joining one by one | 200/200 full views; about 506 messages per phone in total |
| Gamer bootstrapping through a sports-only cluster | finds 40/40 of its game shard after 1 maintenance round via long-link shard lookup |
| Two disjoint 60-phone clusters, 1 link each way | 119/120 full views after 8 rounds (smallest view 113/119); dormant path, not tuned |
| Adaptive switch | thresholds 21/23/19 → exactly 1 switch to sharded; dropping below threshold−10% → back to full global lists |

Limits: the per-phone cost of a full list grows with N: about 200 bytes per row, so roughly 20 MB at 100k users, and every join or leave reaches every phone. Anti-entropy version vectors are O(N) per pull. The simulation shares a signature-verification cache across simulated phones and uses node:crypto Ed25519 for speed; real phones verify every row themselves with tweetnacl, at roughly 5–15 ms per verify on slow devices. The rendezvous server is trusted not to censor seeds; long links and peer lookups reduce that dependence.

## App wiring (local first, Supabase-ready)
- `src/net.js` is the transport abstraction: **LocalBus** (BroadcastChannel across tabs) by default, **SupabaseBus** (Realtime broadcast channel `mesh`, ephemeral) when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set. Mesh chat envelopes are relayed over that channel. WebRTC (`src/p2p.js`, TURN relay-only) remains the direct peer-connection layer; moving chat onto WebRTC data channels is a TODO.
- `src/app-mesh.js` + `src/mesh-ui.js` wire gossip membership, mesh messaging, presence stubs, friends, block, burn mode and plans notes into **Discover** (Live now / Recently online), **Chats** (live chats, burn, plans), **Profile** (friends, requests, blocked) and **Dev** (mesh status/log). Each profile gets its own user code and Ed25519 keys, stored in the encrypted vault; `?as=<seedId>` makes a tab act as a different demo user.
- ~~**Warm-start snapshots**~~ (removed 2026-10-20, single entry) (`src/snapshot.js`, `api/_fn/bootstrap.js`): the bootstrap function keeps no durable state. When its cached snapshot is older than about 90 s, it broadcasts `snap-req` on the Realtime channel. About 3 random phones answer (each checks `hash(code+nonce) < p`, so the server tracks no one) by POSTing a gzip snapshot of their owner-signed rows. The server verifies and merges them (rejecting tampered rows, rows with IPs, non-alive rows and unsolicited pushes) and gives new joiners the merged list for an instant warm start. Joiners then gossip as usual. Measured: 300 rows ≈ 42 KB (≈141 B/row). Limit: each serverless instance has its own memory cache.
- **E2E**: `npm run build && npm run e2e` runs headless Chrome with 3 tabs: join, full profile visible, message, friend request + accept, block notice + refund, third tab sees logoff (stub only).
- Setup checklist for production: `scripts/setup-supabase.md`.

## Legal / safety fixes (2026-10-17, from legal review items 3–6)
- **18+ age gate** (DOB at first launch, under-18 blocked; only adult flag stored), UK age-assurance placeholder, region-based dating-safety notices for NJ/IL/TX/NY in Discover (placeholder wording, UNVERIFIED).
- **Voice:** AI disclosure + explicit consent before browser mic or Grok voice; no recording/voiceprints; xAI ZDR noted in `api/_fn/voice-session.js`; typed path always free.
- **Safety:** Report on profiles and chats → `reports` table → moderators' 🛡️ Team review bucket (v39: `mod_queue` Serious abuse / All open / Resolved, DB-enforced moderator access + audit log); block; safety contact placeholder in Terms/Settings; CSAM/NCMEC escalation in `docs/trust-safety.md`.
- **API rate limits (v40):** every `api/` route is limited per IP (and per ID) in two layers: in memory per serverless instance, then a GLOBAL counter shared by all Vercel instances (Supabase `rl_hit`, migration 20261027000008, service-role only). If the server Supabase env is missing or the DB is slow/down (>350 ms), it falls back to the per-instance limit and never blocks requests.
- **Boost refunds (v41, boost credits only - no Stripe calls):** decided server-side and conservatively. Supabase path: `app.boost_refund_decide` in the DB (expired unread / recipient blocked you / recipient deleted their account; never for a read or purged message; only for a real spend; once per message; max 10 automatic refunds per sender per 24 h, the rest held for support review; append-only audit; support RPCs service-role only). Mesh path: `api/refund` uses the shared service-role RPC `mesh_refund` (same caps, hashed codes, fail closed) or an in-memory store with the same rules when the server Supabase env is missing. Real-money refunds stay manual in Stripe. Tests: `scripts/smoke-refunds.mjs`, `supabase/tests/boost_refunds.sql`.
- **Realtime join gate + per-user limits (v46):** the shared Supabase Realtime topic `mesh` (used when `VITE_SUPABASE_*` are set; the preview still runs the local bus) only lets a signed-in, age-checked user join or send after the database ADMITS them: a fresh proof of work bound to their user id, mesh ID, key and a 10-minute window (`public.mesh_admit`, checked in SQL), or a server-side attestation (`public.mesh_admit_service`, service role only; the hook for Play Integrity / App Attest). Per user: 6 attempts/hour, 24/day, admission lifetime 12 h, suspensions by moderators (`mod_mesh_suspend` / `mod_mesh_lift`) or the server. Anon is never allowed; `control` is read-only. Client: `src/mesh-admit.js` + `SupabaseBus` (fails closed, backs off, renews). Migrations 20261027000013/14; tests `smoke-rtgate`, `e2e-rtgate` (live Realtime), `supabase/tests/realtime_gate.sql`.
- **CSAM reporting + evidence preservation (v45, technical side only):** a report under *illegal content (incl. child abuse)* carries no plaintext excerpt. Instead the reporter's phone gathers what it already holds from that person (chat messages incl. attachments/media, the 7-day safety copy, the profile view it loaded) and seals it on the phone to the safety team's PUBLIC key (`src/evidence.js`, nacl.box). It then uploads the ciphertext in ≤1 MB parts to a server evidence hold (migrations 20261027000011/12). The server checks SHA-256 per part and for the whole bundle, and it can never read the bundle. Holds sit outside every auto-delete (`purge_expired` is unchanged, so everything else still lives only on phones and expires). They keep a snapshot of the report, the reported account and our own copies of that conversation's server ciphertext, so they survive account deletion and the 7-day purge. They are kept 1 year, or 1 year after a recorded CyberTip, plus any 18 U.S.C. §2703(f) legal hold (1–90 days per request, renewable). Only active adult moderators can open a hold (no conflict of interest allowed), and every list, view, packet, preservation and CyberTip record is logged (`app.evidence_access_log` + `report_actions`). In 🛡️ Team review, the CSAM report is first in Serious abuse. **🔒 Evidence & preservation** decrypts in memory with the pasted team secret key (never saved; images stay blurred until tapped) and assembles a **CyberTipline-ready packet** with per-file SHA-256. The app never sends that packet anywhere. With no account, key or network, the bundle waits in the encrypted device vault (max 5 bundles, 30 days) and uploads later. Team key: `node scripts/evidence-key.mjs gen --out <offline file>` (prints the SQL to register the public half). **Still needed from David:** counsel review, the real safety contact, the NCMEC ESP registration/submission, and generating and registering the team key. Until a key is registered, bundles stay on the phones.
- **Religion/orientation:** separate opt-in, hidden by default, on-device only, never in mesh/server/analytics/xAI; warning for criminalizing countries (`CRIMINALIZING_COUNTRIES` config).

## Build flavors (public vs admin)
| Command | Output | Contents |
|---|---|---|
| `npm run build` | `dist/` | **Public** app store build. No Dev tab, no `?as=` multi-profile switching, no admin kill button, no sim hook (`__cmDev`). Still contains the kill-switch **listener** (disclosed in Terms / to Apple). |
| `npm run build:admin` | `dist-admin/` | Owner/dev build (`--mode admin` → `.env.admin` sets `VITE_ADMIN=1`). Adds the Dev tab (profile switcher), `?as=<id>` tabs, and **🛑 Admin · Network kill switch**. |
| `npm run build:all` | both | `npm run smoke` then greps both bundles (`scripts/smoke-flavors.mjs`) to prove admin markers are absent from `dist/` and present in `dist-admin/`. |

`ADMIN` is a build-time constant (`import.meta.env.VITE_ADMIN === '1'`), so Rollup drops every admin branch and the `src/admin.js` module from the public bundle. Vercel's `buildCommand` stays `npm run build` (public). E2E runs against `dist-admin/` because it drives several `?as=` users in tabs.

**Admin kill button: how the key is handled.** No private key ever enters the browser. The owner signs offline with `node scripts/mod.mjs halt --reason "…" --out halt.json` (or `resume`, `strike`, `ban`, `unban`). The key is read from a passphrase-encrypted keyfile outside the repo, and a halt needs `--reason` plus typing `HALT`. The owner then pastes the signed JSON into the admin panel. The panel only verifies it against `VITE_KILL_PUBKEY` and delivers it: over BroadcastChannel locally, or to `api/_fn/kill.js` / `api/_fn/ban.js`. Those routes hold only the public key and reject unsigned, wrong-key, stale, replayed and reasonless messages. `scripts/kill-switch.mjs` now forwards to `mod.mjs`.

## AI help desk
The **🤖 Help** tab is clearly labeled *"AI assistant (not a human)"*. It answers offline from `docs/help-kb.md`, which is bundled; edit that file to change answers. Optional online answers come from `api/_fn/help.js`, which calls xAI Grok with server-side `XAI_API_KEY` (optional `XAI_MODEL`, default `grok-3-mini`). The route is rate-limited to 6 per minute and 60 per day per IP (global across server instances since v40). Only the typed question is sent, after removing emails, phone numbers and @handles. No profile data is sent. On any failure it falls back to the KB. The tab always shows **Contact safety team (human)** (mailto `SAFETY_CONTACT`) and **Report a user** (the `submitReport` flow).

## Simulated test users (dev only)
`scripts/sim-users.mjs` runs N headless "bot phones" (Chrome via puppeteer-core). Each bot gets a profile named **`TEST·<name>`** with `test: true`, spread across Friends/Gaming/Dating. Bots join the mesh, go offline for 30–120 s now and then, accept friend requests, accept starters, and reply with canned lines (no AI).
```bash
npm run build:admin
node scripts/sim-users.mjs --n 6                 # local: serves dist-admin on :4190; bots + your own tabs in the same Chrome
node scripts/sim-users.mjs --n 2 --probe         # self-test: a probe phone messages bot-1 and waits for its reply
# With your real phone: deploy an admin build WITH Supabase env to a DEV/preview URL, open it on the phone, then:
node scripts/sim-users.mjs --url https://<dev-preview>.vercel.app --dev --n 8 --near "41.88,-87.63,Chicago,IL,US"
```
Options: `--minutes N` (auto-stop), `--offline 0..1` (chance per minute of dropping offline), `--headful`.
Safety: any non-localhost URL needs `--dev` (or `CM_SIM_DEV=1`). Hosts in `CM_PROD_HOSTS` (default: the production demo host plus cybermates.app) are **always refused**. Bots also refuse public builds (they need the admin-only `__cmDev` hook). In local mode the transport is a BroadcastChannel, so only tabs in the bots' own Chrome can see them. To test from a phone, use a Supabase-backed dev deployment.

## Moderation: ban / unban, targeted kill, mesh-wide shutdown
These controls exist only in the admin build. You get there through Dev tab → *Admin · Ban / unban user* and *Admin · Network kill switch*, or the CLIs `scripts/mod.mjs` and `scripts/kill-switch.mjs`. Every action is a fresh message signed offline with the kill-switch private key (`scripts/mod.mjs`, encrypted keyfile outside the repo). The routes verify it against `VITE_KILL_PUBKEY`; holding the key is the authorization, and the key is never bundled or sent.

**Order (server state first, then broadcast)** is in `api/_lib/mod.js`:
1. **Mesh-wide kill:** first the `kill_switch` record is written, so `/api/bootstrap` starts refusing every join (503). Then the Realtime `control` broadcast goes out (P2P layer). Then mesh gossip `{k:'ctl', msg}` on the `mesh` channel. Phones verify it, forward it once and shut down.
2. **Ban:** first a `blocklist` row is written, so bootstrap refuses that code (403) and it gets no peers. Then a `mod_actions` log row. Then a signed kill scoped to `user:<code>` is broadcast and gossiped.
3. **Unban:** the blocklist row is deleted, the action is logged, and a signed `clear` scoped to `user:<code>` is broadcast.

`supabase/schema.sql` adds `blocklist` and `mod_actions`. RLS is on, there are no policies, and anon/authenticated access is revoked, so only the service role can touch them.

**Client handling (both builds, `src/ban.js`):** only validly signed, fresh, non-replayed messages are accepted. Unsigned, forged and tampered messages are rejected.
- On a mesh-wide kill or a kill aimed at my code, the phone wipes its cached online/peer list, stubs and active list, closes the mesh and relay, and persists a killed flag. The app then stops reconnecting.
- A targeted kill (ban) also wipes stored friend stubs, shows a ban notice, refuses transfers, and writes a `ban` marker into the device vault. That vault is encrypted (AES-GCM) with the device-derived key, so a copied vault won't decrypt on another phone, and the app refuses to rejoin.
- **Limits:** clearing app data, reinstalling, or using a new device evades the local marker. The **server blocklist is the real gate**. `blocklist.device_hash` is reserved for a future device-fingerprint hash.

**CSAM bans:** pick the `csam` category. The log row gets `preserve_until` = +1 year (an evidence-preservation hold, per `docs/trust-safety.md`). The admin UI and CLI then show the NCMEC CyberTipline reminder. Staff fill `mod_actions.ncmec_report_id`. The ban log itself never stores the content, and the reason field is a short label only. Since v45 the reported material reaches the team only as a sealed evidence hold, attached to the user's child-safety report (see Legal / safety above). A lead records the CyberTip report ID on the hold with `mod_cybertip_recorded`.

Local demo, no Supabase: admin actions go over BroadcastChannel + mesh gossip, and a simulated local blocklist is kept in localStorage. There is no bootstrap server locally, so the "server first" step only applies with Supabase.

**Active connection list file.** Each phone keeps its gossip active list plus cached online peer codes (codes and signed rows only; no IPs, since connections are relay-only) in `localStorage['cybermates:active-list:<id>']`. It is stored **only as ciphertext**, sealed with the device-derived vault key (`src/activelist.js`: per-field AES-GCM), so a copied file won't decrypt on another device. It's saved every 20 s and on leave, and decrypted on startup to warm-restart the mesh. On any valid kill (targeted or mesh-wide), the file is overwritten with random bytes and deleted, the in-memory list is cleared, and the phone disconnects. Secure delete is best-effort: the WebView storage engine may keep old pages until compaction, but those pages are ciphertext. The server blocklist is separate.

**Gossiped signed ban list (`src/banlist.js`).** Each entry *is* a mod-key-signed control message scoped to one user: a ban is `kill user:<code>`, a lift is `clear user:<code>`. The latest entry per code wins, and expired bans drop out. Signatures are checked lazily, on the first merge of each entry, and the result is cached. Forged entries and forged lifts are ignored.
- **At rest:** sealed with the device key (`cybermates:ban-list`).
- **Spreading:** a ~7-byte hash rides on the existing membership anti-entropy `pull`. Only when hashes differ do phones swap an index and then the missing entries. There are no extra periodic messages.
- **Joiners:** `/api/bootstrap` also returns the signed entries (`blocklist.entry`), in the same request as the existing blocklist check.
- **Enforcement:** a hello, membership or mesh message from a banned code is refused. The banned code is removed from active lists and presence and never relayed. It is also sent the stored signed targeted kill (`{k:'ctl', src:'ban-list'}`, accepted as a standing record), which wipes its encrypted active list and disconnects it.
- **Publishing:** admin ban/unban (UI, `scripts/mod.mjs`) writes to the server first, then broadcasts and gossips the signed entry, which phones merge into their list.
- **Size:** about 160 B per entry. 1k bans ≈ 156 KB (90 KB gzip); 10k ≈ 1.5 MB (0.9 MB gzip), and the diff index for 10k is 254 KB. Normally only deltas move.

**Cursor & touch effects (`src/fx-pointer.js`).** On a mouse or pen there is a neon ring/crosshair with a short trail. It grows over clickable elements, and the native cursor stays over text fields. Taps and clicks get a shockwave plus chromatic glitch slices, and drags leave a fading light trail. Everything draws on one overlay canvas (`pointer-events:none`, passive listeners), and rAF runs only while something is animating. Theme colors come from CSS vars. It's off under reduced motion, when Glow effects is off, or with the Profile → Look & sound "Cursor & touch effects" toggle.

## Audio, themes & touch FX (round 9)
- Sound & music default **on**; no loader toggle. The AudioContext is created/resumed *inside* the first `touchend`/`pointerup`/`click`/`keydown` (iOS Safari requirement), then the boot sound plays and an original 112 BPM synthwave loop fades in (procedural WebAudio, `src/sfx.js`). It fades out and suspends when the app is hidden. Mute is in Settings › Look & sound only. **iPhone note:** the hardware silent switch mutes WebAudio; device volume controls loudness.
- 11 themes: Neon Cyan, Synth Pink, Deep Blue, Acid Green, Crimson Red, Ultra Violet, Sunset Orange, Gold, Ice Silver, Toxic Teal, Light. Each one has its own code-rain palette and cursor/FX colours.
- Tap shockwave: `#fxcanvas` is sized and positioned to `visualViewport` (width/height/offsets, backing store × min(2, dpr)) and fed `clientX/Y − vv.offset`. This fixes the offset after scrolling, rubber-band scrolling and the iOS dynamic toolbar. Pixel distortion uses an SVG `feDisplacementMap` on the tapped card (~320 ms) plus a WebGL refraction ring; if WebGL is unavailable, only the 2D ring is drawn. Off under reduced motion / low FX.
- Tests: `node scripts/shots-ios.mjs` (iPhone 13 touch emulation: scroll, tap, assert ripple centroid ≤ 6 px from the tap, audio unlocked). `node scripts/shots-themes.mjs` writes the theme grid.

## Two-key design (private encryption key vs shareable ID key)

| | **Encryption key** (private hash key) | **ID key** (shareable identity) |
|---|---|---|
| Where | `src/vault.js` (unchanged) | `src/identity.js` |
| Derivation | `PBKDF2_v(SHA256(SHA256(HMAC(installSecret, deviceInfo))), salt_v)` → AES-GCM-256, non-extractable | `SHA-256("cybermates-id-v1" \| platform \| stable device fields)` → 16 chars (~80 bits) |
| Inputs | random install secret (IndexedDB) + device info + KDF version salt | **only** stable device data: Capacitor `Device.getId()` (+manufacturer/model) on native; best-effort browser fingerprint (UA, platform, language, cores, memory, screen, timezone) on web. No install secret, no app version, no randomness |
| Used for | encrypting vault, active list, ban list, block list at rest | network identity: mesh addressing, presence, membership rows, bans, blocks, ban list, active list, server blocklist/bootstrap, reports |
| Leaves device? | **Never** (enforced by the never-send guard) | Yes, it is the public address |

The ID key is never used as or mixed into an encryption key. `?as=<persona>` demo tabs (admin/dev flavor) add a `|persona:` suffix so several demo users on one browser stay distinct.

**Migration:** on first mesh start after upgrade, each stored identity (`vault.meshIds[x]`) gets `code = ID key`. The old random code is kept as `legacyCode`, and signing keys, friends and blocks are kept. Bootstrap/check-in also send `&legacy=<old code>`, so server bans on the old code still apply, and signed bans addressed to either code are honoured locally. If the device fields drift (for example a web fingerprint change), the previous ID is appended to `priorIds`. Peers that cached the old code see the user come back under the new ID, and friendships re-pin when they meet again (TOFU on the same signing key). Payments/receipts still use the vault `userCode` (unchanged API format `[A-Z0-9]{10}`).

**Never-send list** (`src/never-send.js`, `guardOutgoing`). Every mesh bus post (`src/net.js` LocalBus + SupabaseBus), P2P signaling (`src/p2p.js`), app-mesh HTTP (`guardedFetch`) and Supabase profile upsert goes through it:
1. any `CryptoKey` (vault AES key, install-secret HMAC key) → **rejected**
2. the KDF input string (device info, registered by `Vault.key()`) anywhere in a payload → **rejected**
3. a vault ciphertext blob (`{kdf, iv, ct}`) → **rejected**
4. fields named `installSecret`, `devKey`, `deviceKey`, `vaultKey`, `encKey`, `encryptionKey`, `kdfInput`, `deviceInfo`, `hashKey`, `privateKey`, `secretKey`, `sec` → **stripped**

Test: `scripts/smoke-twokey.mjs` (also run by `npm run smoke`).

**Attestation.** `src/attest.js` requests a token bound to the ID (nonce = SHA-256 of `cybermates-attest-v1|id|5-min bucket`). It uses Google Play Integrity on Android (needs a `PlayIntegrity` Capacitor plugin, TODO) and Apple App Attest on iOS (needs an `AppAttest` plugin, TODO). The web has no attestation. `api/_fn/attest.js` is a verification stub: it checks the nonce binding, and the real Google decode and Apple CBOR/cert-chain checks are TODOs. Credentials come only from env vars (`PLAY_INTEGRITY_SA_JSON`, `GOOGLE_CLOUD_PROJECT_NUMBER`, `ANDROID_PACKAGE_NAME`, `ANDROID_CERT_SHA256`, `APPLE_TEAM_ID`, `IOS_BUNDLE_ID`, `APP_ATTEST_ENV`), and nothing is bundled. `api/bootstrap` reads header `x-cm-attest` and **does not refuse** unattested IDs. It returns `{attested:false, flags:['unattested']}` instead. Until verification is implemented, every ID is flagged unattested.

**Tradeoffs:** the web ID is weak: browser updates change it, it can be spoofed, and identical machines collide. A new phone means a new ID, and bans don't follow the person. An Android factory reset (or a different app-signing key) changes `ANDROID_ID`. iOS `identifierForVendor` changes if all the vendor's apps are removed. Without real attestation a modified client can claim any ID. The ID is stable across reinstall on native, so a banned user can't just reinstall, but a reinstall still loses the private key and the encrypted data.

### ID ↔ key binding (v43) — `src/idbind.js`, `api/_lib/idbind.js`
- The device-derived ID is public (and weak on the web), so v43 **binds each ID to one Ed25519 signing key**. A ping, advert, membership row, gossiped stub or server call that claims an ID must use the key that ID is bound to. An ID can't be claimed by a different key, and a key can't hold two IDs.
- **Join cost (web/unattested):** each client signs a one-time *claim* `{code, pub, iat, proof of work}`: 10 sub-puzzles of 16 leading zero bits over SHA-256 (~655k hashes). That takes ~0.35 s in desktop node, ~0.5-0.7 s in desktop Chrome and ~2 s at 4x CPU throttle (our normal-phone stand-in), and the UI yields while it runs. Verifying takes 10 hashes + 1 signature. The claim is cached in the vault, so the PoW is paid once per (ID, key).
- **Peers** (`IdBinder` in `src/app-mesh.js`): the first valid proof pins ID↔key. A different key for a pinned ID is dropped *before* its key is learned (E2E ping gate), and so are pings with no proof. Living-mesh adverts, membership rows and gossiped stubs with the wrong key are dropped too. A **server cert** (when `ID_BIND_SEED` / `VITE_ID_BIND_PUBKEY` are set) beats a claim, and a newer cert can rebind.
- **Server** (`api/_fn/bootstrap.js`): login/heartbeat need the claim (428 without, 400 if invalid). The registry keeps one key per ID (409 `id-bound` / `key-bound`). Logoff/delete must come from the bound key (before v43 an unsigned logoff could remove anyone). Rebinding is allowed via a rotation signed by the old key, via verified attestation (hook only), or after `ID_REBIND_IDLE_DAYS` (default 14) of silence plus a heavier PoW (reinstall on the same phone). Store: in memory, or the service-role RPC `public.id_bind` (migration `20261027000010_id_bindings.sql`, hashed IDs/keys, fail closed) when the server Supabase env is set.
- **Attestation:** Play Integrity / App Attest verification is still a stub (`api/_fn/attest.js` never reports `attested:true`). The nonce now also binds the key, and `isAttestedFor` is the hook that would give attested phones a lighter PoW and instant rebinds. Nothing is faked.
- Tests: `scripts/smoke-idbind.mjs`, `scripts/e2e-idbind.mjs`, `supabase/tests/id_bindings.sql` (29 live checks, rolled back).

## The three lists a phone keeps

| List | File | What | Who controls | Shared? | At rest |
|---|---|---|---|---|---|
| **Active / online list** | `src/activelist.js` (+ `sweep.js`) | rolling list of recently seen peers (gossip rows + cached peer IDs), entries >24h stale are skipped/swept | automatic | built from gossip; your copy is local | sealed with vault key |
| **Ban list** | `src/banlist.js` | mod-signed (Ed25519) ban/lift entries per ID, server-enforced (blocklist + bootstrap), gossiped across the mesh | moderators/server | yes, gossiped + from bootstrap | sealed with vault key |
| **Block list** | `src/blocklist.js` | your personal blocks, per local profile, keyed by ID key; add/remove/list/isBlocked; blocked IDs are hidden from discovery, their presence is ignored, and their messages are dropped (sender told + refunded) | you | **never** sent | inside the encrypted vault |

The block list and the ban list are fully separate code. A block never reports or bans anyone.

> ⚠️ **Before connecting Supabase:** all Supabase traffic (chat, starter envelopes, everything on the `mesh` channel) must be E2E encrypted and signed on-device (Ed25519 + AES-GCM, with per-chat keys from an X25519 exchange). **Today these envelopes are plain-text JSON protected only by TLS**, so Supabase or anyone with the anon key on the `mesh` channel can read them. See docs/AUDIT-2026-10-19.md checklist.

## Tiered enforcement (ban levels 1-5)

All enforcement is keyed by the **ID key**. The logic lives in `src/tiers.js` and is shared by the client, `api/` and the admin tools.

| Level | Meaning | Effect | Delivered via |
|---|---|---|---|
| 1-2 | warning | notice on next contact/check-in; user keeps using the app; offense reason recorded (e.g. spam) | server only (bootstrap / 24h check-in returns `{level, warning}`) |
| 3 | final warning | same, notice says the next offense suspends | server only |
| 4 | suspension (default 7 days, `--suspend-days` / admin field) | booted (friends kept), bootstrap returns `403 {suspended, until}` until expiry, then it reads as **level 3** | signed targeted kill `level:4`, `expires_at` = end of suspension; server blocklist + mesh gossip |
| 5 | ban | instant boot, wipe, permanent vault marker (unchanged behaviour) | signed targeted kill `level:5` (legacy entries without a level = 5); server blocklist + mesh gossip |

- **Strikes:** every new offense escalates one level, capped at 5. The admin can also pick a level directly, lower it (`unban --to-level 1-3`, which keeps the record and lifts the signed entry with a signed clear), or remove it entirely (`unban`).
- **Signed fields:** entries carry `level`, `reason`, `strikes` and `expires_at`. `level`/`strikes` are added to the signed canonical form only when present, so old signatures still verify. The compact ban-list encoding is 9 elements for tiered entries and 7 for legacy ones.
- **Mesh:** gossip only propagates and enforces levels 4-5. Phones ignore warning-level messages (`warning-only`) and the ban list rejects them.
- **Server:** `blocklist.level`, `strikes` and `suspended_until` (schema.sql). `isBlocked` means effective level ≥ 4. Bootstrap checks both the ID and `legacy` codes. `mod_actions.level` is logged.
- **Tools:** `node scripts/mod.mjs strike <id> --category spam/scam --reason "..." [--level N] [--suspend-days 7]`, `ban <id>` (= level 5), `unban <id> [--to-level N]`. The admin panel has an Auto/1-5 level picker, suspension days, and lower-to. `/api/ban` takes `{status:true}` for the current standing.
- **Tests:** `scripts/smoke-tiers.mjs` (in `npm run smoke`) covers escalation 1→5, suspension expiry back to 3, warnings not booting, level 5 instant boot, and gossip of 4-5 only.
- **Limits:** in local/demo mode (no server) warnings are recorded but never shown, because check-in is a no-op locally. A suspended user on a new phone gets a new ID. Level 4 relies on the device clock for the local expiry, but the server is authoritative.

> **Planned (awaiting approval):** random 2-3 hop relay rotation with onion encryption, padding and cover traffic. This needs WebRTC/TURN relaying first, since today all traffic goes via Supabase with no peer relaying. See docs/AUDIT-2026-10-19.md.
> **Planned (awaiting approval):** a Dating age gate, where under-18 users never see the Dating tab or send/receive dating profiles. Today the whole app is 18+ (a self-reported DOB gate), and there is no Dating-specific check.
> **Planned (awaiting approval):** minimize background traffic: mode-filtered discovery (only the current mode's profiles), relaying only while actively searching, no idle relay duty. The tradeoff is more direct/Supabase fallback at quiet times. See docs/AUDIT-2026-10-19.md.

## Status 2026-10-20 (done vs planned)
**Done in code (local/mock transport, tested):** two-key ID, tiered bans 1-5, signed network halt/resume (newer-timestamp only, admin build only, offline signing via `scripts/mod.mjs halt|resume --out`), E2E-signed+AES-GCM mesh envelopes (plaintext chat/starter refused), onion relay rotation (2-3 hops, padding, jitter, online+searching only), mode-filtered discovery, under-18 Dating gate, sweep of banned users, bootstrap warm start without Supabase (`CM_SIGNAL=mock|supabase`; mock is the default when Supabase env is absent. Swap step: set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` + `VITE_KILL_PUBKEY`).
**Blocked on accounts/keys:** Supabase, TURN, Play Integrity / App Attest, Stripe, xAI, production kill key.
> **Planned (awaiting approval):** Parent controls for under-18 users (PIN as a PBKDF2 hash in the vault, never sent, lockout after 5 tries). Also "Accept before any message": no messages, not even starters, before acceptance, with only a bare connection request allowed. This supersedes paid starters; decision pending. See docs/AUDIT-2026-10-19.md.
> **Planned (awaiting approval):** delivery failure returns the message along the reverse relay path (no store-and-forward). Boosts/payments are refunded only when no signed delivery receipt arrives in time, verified server-side and idempotent per message ID.
> **Planned (awaiting approval):** US-only enforcement through US store territories, `x-vercel-ip-country` checks at first launch and each 24h check-in, US-only Stripe cards, VPN/proxy detection (needs a service), and an optional SIM/location signal. Not enforced today, and a determined spoofer can still bypass it.
> **Planned (awaiting approval):** a mode-filtered inbox (items tagged by starting mode, unread badges on the other modes, no dating inbox for minors). Today the inbox is not filtered by mode.
> **Planned (awaiting approval, Law-bot review):** retention bubbles (keep, temporary, hide instantly). There is always a 7-day encrypted safety copy for reports, disclosed on the labels themselves, and none of these options is ever called "delete".
> **Planned (awaiting approval):** a default seed list pinned by Ed25519 key (stored encrypted, rolling, owner seeds never dropped), a per-phone connection cap of about 2,000 max, and a 5-device e2e test target.
> **Wired v38 (2026-10-27), see docs/LIVING-MESH.md:** broadcast discovery using an active-mode interest vector, threshold dot-product replies, TTL plus dedupe, rate limits, and an ephemeral reply token (no ID). The legacy ID-carrying `disc` query is retired.
> **Planned (awaiting approval):** relay paths prefer already-open friend links, but always include at least one random non-friend hop (TODO hook in `src/relay.js`).
> **Wired v38 (2026-10-27), receive side:** DoS "cheap shield". Fixed-size packets, signature/size checks first, no state for strangers, per-sender/ID rate limits feeding tier strikes, Vercel WAF plus server rate limits, and a smaller snapshot POST limit.
> **Planned (awaiting approval) — Device linking (corrected):** each device has its own private encryption key, and all linked devices share ONE profile network ID, received by signed QR/code linking. A ban covers every linked device. Per-device fingerprints would be kept server-side, with a cap on linked devices.

**Single entry (2026-10-20):** the server (`api/_fn/bootstrap.js`) is the only way into the network. It keeps a super list of
online profiles (ID key + signed row + modes, no IPs), and halt, bans and US-only are all checked there. Removed: phone
snapshot warm start, persisted active-list file, cached-list jump-start, and the seed-list notes. Tradeoff: no new connections while the server is down.
**Supabase day:** see `docs/SUPABASE-DAY-CHECKLIST.md`. **Planned:** scaling to 20k+ (sharded list + edge cache first, signed peer slices later).

## Update 2026-10-20 (night)
- **Single inbox:** one inbox for all modes. Requests on top, then chats; each row shows an animated neon mode icon (controller / heart / handshake, reduced-motion safe) and a 👥 friend badge. Under-18 users never see dating rows. The per-mode inbox plan is superseded.
- **Mood:** after JACK IN you can pick a session mood (skippable); it rides in your signed presence row, shows as a badge, and clears when you log off. Never saved.
- **Recently online:** Discover lists people seen in the last while ("Active Xh ago", never "live") from the server's rolling list of 500 public cards. Connecting still needs an accepted request.
- **Store-and-forward:** messages/requests to someone offline wait encrypted on your phone (⏳) for up to 7 days; ✓ only after a signed receipt; expired boosts are refunded.
- **Calls:** voice/video between friends over a direct WebRTC link. Not verified here (no ICE in the headless box); needs TURN + a real-device test.
- Tests: `bash scripts/runall.sh` (builds + all smokes + e2e-mesh with 5 tabs + iOS checks).

## Round-robin connect (18+) — `src/roulette.js`, `src/roulette-ui.js`
YouMingle-style random video/voice with adults from the joined mesh, over the existing `DirectLink` WebRTC layer (`src/call.js`).
- **Strict 18+.** The **Connect** nav tab only renders for adults (self-declared setup age ≥ 18; unknown age = hidden). `setOn()` throws for minors, and the **receiver** refuses too (`receiverAccept`): a minor never answers, and a ring from a peer that did not advertise `adult:true` is declined.
- **Mutual opt-in.** Only peers that broadcast `rl {on:true, adult:true}` in the last 60 s are in the pool, and the receiver must be in roulette mode itself.
- **24 h cooldown.** Each matched peer's network ID (ID key) goes into a cooldown list inside the encrypted vault (`p.roulette[owner].cooldown`), so you are not rematched within 24 h. It is pruned on load and on the 24 h sweep (`sweepStale({cooldowns})`). It is never sent anywhere.
- **Blocks and bans** are respected on both sides. There is a visible **⚑ Report** button (the existing report flow), **Skip / Next**, a **Block people I skip** option, and a one-time safety notice on first entry.
- **Limits.** Age is self-declared, and a modified client can lie about its `adult` flag. Real-device media needs TURN (`VITE_TURN_*`); headless Chrome here gathers no ICE candidates, so a live peer-to-peer call is **not verified**.

## Arcade — `src/arcade/*`, `src/arcade-ui.js` (all ages)
Two games, **Snake** (eat nodes, grow, eat other snakes' segments, head-on kills, self-bite kills) and **Light cycles / Tron** (leave your land to lay a trail, close the loop to claim the trail plus the enclosed area, cutting a trail kills its owner, head-on kills both, the round resets at 50 % of the map or on a timer). Both run on a shared engine.
- `engine.js`: the world is made of 16×16-cell **tiles**. Each human brings one tile, and the side length is `ceil(sqrt(max(humans,4)))`, so the map grows as a bigger square. Ticks are deterministic: a seeded mulberry32 PRNG per tick, with lockstep **input relay** (`{tick: now+2, code, dir}`). Each tile has an **owner** whose collision verdicts are final (`authoritative()`, `applyVerdict()`). Respawn is **instant** (no wait screen). The map edges wrap.
- `instance.js`: **sub-maps** with a hard cap of **50 players each, bots included**. Bots are evicted first when a human needs the slot. When every sub-map is full, a new one is created. `rebalance()` runs between rounds (never mid-round). It spreads humans evenly across `ceil(H/50)` sub-maps, giving roughly 30–50 each, and merges sub-maps that have emptied. Sibling sub-maps are linked (`links`), and the UI lets you hop between them. This replaces the earlier 200-player instance cap.
- `bots.js`: **natural AI players**. Personalities are aggressive (chases, holds long grudges), cautious (groups up with other cautious bots) and show-off (feints). Each bot has a skill level that sets a reaction delay plus jitter and a mistake rate (about 2–10 %; misjudged turns can crash them into their own trail or body). Bots hold grudges against whoever killed them, then die and respawn like humans. Their trash talk is short canned **PG-only** lines (`gg`, `nooo`, `come here`, `lag!!`, `ez`…) shown as **text speech bubbles only, never synthesized voice**. It is rate-limited per bot (40 ticks) and per map (8 ticks), and hidden when you tick **Mute bot chat** or mute that bot. Every bot is labelled **"· AI"** on the canvas and in the player list. Bots fill the map to 8 players and step aside as humans join.
- Mesh: `'arc'` broadcast envelopes carry join, leave, input and voice-flag messages. Blocked and banned senders are dropped.

### Arcade networking tradeoffs
- **Lockstep plus input delay** keeps every peer identical with tiny packets (one turn per message). The costs are a fixed ~240 ms input latency (2 ticks × 120 ms) and that one slow peer's late input is applied on arrival, which counts as `desync`.
- **Per-tile owner authority** spreads the arbitration load and needs no host. The costs are that a dishonest tile owner can rule unfairly *inside its own tile* (mitigation, not built: rotate owners, cross-check with neighbours), and that when an owner leaves, its tile falls back to the lowest-code human (re-layout).
- Bot simulation is deterministic (the seeded RNG drives bots), so bots cost no bandwidth. Bot state does diverge if peers miss inputs. A periodic snapshot or checksum from the tile owner is **not built yet**.
- All peers on a sub-map receive every input broadcast. At a cap of 50 that is fine; it would not scale to 200, which is one reason for the 50 cap.

### Networked Brawl (v42) — `src/arcade/brawl-net.js`
- Brawl (6-player FFA) now plays with several humans over the mesh, on the same host-rotation + join-anytime layer as the match games (`hostrot-net.js`). Picking Brawl drops you into a running Brawl table in your age band if one is advertised (it takes an AI seat at once); otherwise your own table is advertised and others drop in. Two solo tables merge into the lower id.
- **Host authority:** the rotation host runs the real sim (AI seats, physics, hit proposals) and streams compact signed snapshots ('bs', 10 Hz). Other humans predict locally and send signed inputs ('bi'); hits on a remote human are still signed by that human ('bh') and the host only applies hits it actually proposed. Host leaves -> planned hand-off; host crash -> failover from the freshest snapshot; a player who leaves or vanishes is replaced by an AI.
- **Bounds:** snapshot <= 4 KB, input <= 400 B, hit <= 600 B, per-sender buckets (15 inputs/s, 30 hits/s), ~28 msgs/s/sender max, all under the RxGate budget.
- Gameplay, visuals, glass/glow, sound and fullscreen are unchanged; players sharing a theme get distinct shades. Tests: `scripts/smoke-brawlnet.mjs`, `scripts/e2e-brawlnet.mjs`.

## Proximity voice (arcade) — `src/arcade/proximity.js`
- You hear players **inside your own viewport** (32×24 cells around you), with linear distance falloff (`gainFor`). Nobody off-screen is heard.
- **Default OFF for everyone.** For **minors** it stays locked until a parent enables *Arcade proximity voice* in 👪 parent controls (PIN). The change is written to the parent log, and older stored settings without the key default to OFF.
- **SAFETY: the adult/minor separation is kept.** `canHear()` never pairs an adult with a minor (the bands must match), so no proximity link is ever opened across that line, even if they stand side by side.
- Per-player **Mute** (local) and **Block** (the existing block list) are available, plus **Mute bot chat**.
- **Per-peer audio transport (v44, `src/rtc-voice.js`):** turning Proximity voice on starts a `VoiceHub` (mic, push-to-talk) and `ProximityVoice.attach(hub)`. Each nearby player gets one WebRTC audio link, signaled over the mesh ('vrtc'). Their audio goes through **their own Web Audio GainNode**, set to the distance gain every frame. A link opens only when **both** sides have the other in range (nearest 8, `MAX_LINKS`), in the same age band, not blocked and not muted. It closes on both sides ('bye') when either side leaves range, leaves the map, mutes or blocks, and redials with back-off when it comes back. Proximity hubs refuse everyone until attached (fail closed), and links start silent.
- Robustness: session ids, buffered early ICE, a 15 s connect timeout and ICE-failed close with exponential back-off (2–32 s), signal shape/size checks plus a per-sender rate cap, and a clean teardown of links, audio nodes and mic.
- ICE uses STUN/host candidates by default. `VITE_TURN_URLS` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` add a TURN relay when set (none bundled). Without TURN, strict/carrier NAT pairs won't connect.
- Known limit (game networking, unchanged): in the mass arena a newcomer doesn't learn players who were already on the map, so that pair stays silent until both worlds see each other.
- Tests: `scripts/smoke-proxvoice.mjs`, `scripts/e2e-proxvoice.mjs`. The box's managed Chrome policy blocks UDP ICE candidates, so the connected/RTP checks auto-skip in the box and run where candidates exist.

Tests: `scripts/smoke-arcade.mjs` (in `runall.sh`). Screenshots: `scripts/shots-arcade.mjs` → `/workspace/cybermates-shots/{roulette,roulette-notice,arcade-snake,arcade-tron}.png`.
