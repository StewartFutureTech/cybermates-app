# Cybermates launch-readiness TODO (2026-10-21)
Priority: P0 = blocks any real launch, P1 = must fix before public beta, P2 = before scale.

## 1. Remaining build items (recovery)
- [x] 48h wording → three-bubble retention model (Step 1, smoke-legal asserts no 48-hour claim).
- [x] Test harness: imported suites only run inside smoke.mjs; `npm run regress` added (ALL PASS).
- [x] Colors: arcade/match code uses theme tokens only (fallbacks in theme.js THEME_FALLBACK; test added).
- [x] P1 Brawler (done 2026-10-21; networked multi-human brawl over the mesh still to wire, solo + AI works): 6-player FFA, tap teleport/punch, hold-charge blast, early release energy ball, full-charge beam, knockback, health bars, instant respawn, short-round scoreboard, neon glass bloom + speed lines + shake (off with reduced motion), theme colors, AI fill, victim-resolves hits with signed inputs, Brawl tab; original characters only.
- [ ] P2 Proximity voice: gain/range/UI done, per-peer audio transport not wired (`ProximityVoice.connect`).
- [ ] P2 Store/plans internal 48h TTL constants (store.js CHAT_TTL_MS, mesh.js PLAN_TTL_MS) should follow the chosen retention bubble once "saving based on that choice" ships.

## 2. Blocked setup (needs David's accounts/keys)
- [ ] P0 Supabase project: run supabase/schema.sql; set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY (docs/SUPABASE-DAY-CHECKLIST.md).
- [ ] P0 TURN provider (Cloudflare Calls/Twilio/coturn): VITE_TURN_URLS/USERNAME/CREDENTIAL. Calls, roulette video and P2P don't work live without it.
- [ ] P0 Production kill key: generate offline with scripts/mod.mjs, set VITE_KILL_PUBKEY (the repo ships DEV_KILL_PUBKEY), plan for key loss/rotation.
- [ ] P0 Stripe live: live keys, webhook secret, US-only cards; receipt signing seed.
- [ ] P1 xAI key for Grok voice/help (server-side only, ZDR).
- [ ] P1 Play Integrity (Android PlayIntegrity Capacitor plugin, TODO) + App Attest/DeviceCheck (iOS), verified server-side before bootstrap.

## 3. Open review risks (docs from cybermates-review/REVIEW-2026-10-20.md, audit)
- [ ] P0 CSAM reporting duty (18 U.S.C. §2258A): reconcile "media only on phones/auto-delete" with report evidence preservation + NCMEC CyberTipline process; §2703(f) preservation; real safety contact (placeholder today; Apple 1.2).
- [ ] P0 Refund gaming: "no signed receipt ⇒ refund" invites fraud; make refunds server-side and conservative; wallet balances are client state.
- [ ] P1 Per-instance rate limits: api/_lib/guard.js limiter is in-memory per Vercel instance; move to global storage (Upstash/Postgres) and gate join on attestation; Realtime per-user limits.
- [ ] P0 ID spoofing / identity binding: ID key public and not bound to a signing key; web ID spoofable; bind code↔key, attestation join cost, PoW for web.
- [ ] P1 Minors decision: app is 18+ but code has under-18 paths (parent PIN, minor voice separation, always-retained chats); pick one answer (COPPA/AADC).
- [ ] P1 "Mesh/P2P" claims: traffic is Supabase broadcast; fix wording or build transport (FTC §5 deception risk). Remove false ✅ claims (spam detection doesn't exist).
- [ ] P2 E2E: no forward secrecy; keys in IndexedDB not Keystore/Keychain; 6-digit transfer brute-forceable offline.

## 4. Real-device testing
- [ ] P0 Android build (Capacitor) on a physical phone: onboarding, emulator gate, audio resume, calls over TURN, roulette video, arcade performance (three.js bloom on low-end), proximity voice.
- [ ] P0 iOS Safari/PWA: audio any-tap resume, no-flash, onboarding (scripts/ios-*.mjs are simulations only).
- [ ] P1 Two-device mesh: accept-before-message, block, ban levels, kill switch, store-and-forward queue.

## 5. Pending from David
- [ ] Theme picks: 13 candidates in /workspace/cybermates-themes/list.txt (Midnight Ink, Carbon, Daylight Chrome, Paper Neon, Sunset Grid, Outrun, Arcade, Arctic, Gold Luxe, Toxic Waste, Ocean Deep, Sakura, Amber CRT), preview.png; current app has 11 themes.
- [ ] Approve "Planned (awaiting approval)" items in README: onion relay rotation, reverse-path failure refunds, full US-only enforcement (VPN detection), broadcast discovery vectors, DoS cheap shield.
- [x] v38 (2026-10-27) Broadcast discovery and DoS cheap shield wiring: `src/shield.js` RxGate + `src/bdisc.js` BDiscWire wired into the live receive path (`src/app-mesh.js` bus.on); legacy ID-carrying `disc` retired. Test: scripts/smoke-rxwire.mjs (in regress.sh). Not wired: stateless cookie challenge (needs a protocol round trip) and auto-filing flood reports to the server (strikes are logged only).

## Build queue (after Snake + Tron analog release, 2026-10-21)
- [ ] All games true 3D only (remove 2D/3D toggle; silent 2D fallback only without WebGL): Snake Battle, Star Fleet, Ultimate TTT, Trivia, Draw & Guess (3D glass easel), etc.
- [ ] Fullscreen on/off button in every game (Fullscreen API + webkit prefix; iOS fallback = CSS immersive mode hiding app chrome).
- [ ] UTTT: accurate raycast picking against cell meshes (DPR/canvas offset), hover/press highlight, test tapping every cell centre.
- [ ] Chess/checkers: smoky-black vs frosted-white glass pieces AND board squares, theme colour as rim/edge glow (implemented in board3d.js, shipped with the analog release; visual check pending).
- [ ] Distinct synthesized SFX per game (moves, captures, hits, boosts, torpedo/explosions, sensor ping, daub, correct/wrong, countdown, win/lose, respawn); respect mute + tap-to-resume; no music on gates.
- [ ] Mood picker at first login/JACK IN as a <select>; show mood badge next to name (header/profile) and on inbox/discovery cards.
- [ ] Same-theme colour collisions: first player gets the pure theme colour, others deterministic distinct shades in the hue family (OKLCH spread, min deltaE), up to 100; unit test with 100 same-theme players.
- [ ] Re-accept acknowledgement/terms on every new app version (store accepted version; show gate before JACK IN on change) + test.
- [ ] 'Read to me' button at the top of the acknowledgement screen (speechSynthesis, stop/pause, starts on tap) + test.
- [ ] Earlier queue: 3D models for the other games, Bingo (mass), regular tic-tac-toe, mass Trivia, global voice for party games, full perf fixes.
- [ ] Account-loss warning: show on first use, then remind about every 10 logins (login counter stored on the device). Periodic warning only; NO 'Read to me' button (that is only on the acknowledgement screen). + test.

## Item (a) — shipped 2026-10-21
- [x] UTTT picking fix (pick.js, board margin), hover/press highlight
- [x] Mood dropdown + badges (header/inbox/friends)
- [x] Same-theme distinct shades (OKLCH, 100 players tested)
- [x] Terms re-accept every app version + Read to me (top of screen)
- [x] Account-loss warning: first use, then every ~10 logins (no Read to me)
- [x] Friends tab (replaces Brawl slot), inbox ordering (friends pinned, boost below friends)
- [x] Minors: dating removed, roulette 18+, voice same age band only, features default ON with parent PIN controls
- [x] Arcade/phone overflow fix (320–430 verified)

## Production finalization
- [ ] REMOVE CM_FTUE_RESET build flag and ?ftue=reset; restore once-only first-time flows (age gate, terms per version stays, mood, loss warning cadence)
- [ ] Patch remaining browser scripts for #losswarn if any still click through terms by other means
- [ ] Launch: advertise parent controls on social

## Item (c) — 3D-only
- [x] 2D/3D toggles removed everywhere (mass, duels, Brawl); 2D canvas only as silent no-WebGL fallback
- [x] Ultimate TTT: true 3D grid (grid3d.js), raycast picking on instanced cells, hover/press feedback, all-81-cell test
- [x] Star Fleet: true 3D twin grids, ships/hit/miss meshes, raycast fire, all-200-cell test
- [x] Trivia Clash: 3D holo question panel + answer pads (raycast)
- [x] Draw & Guess: 3D easel with raycast drawing (UV → same stroke format)
- [x] Snake Battle / Tron Duel 3D-only; duel 2D render skipped while 3D is active (Tron Duel perf)

## Item (d) — per-game sound effects
- [x] sfx.js LIB: 35 procedural effects (move/place/capture/drop/puck/goal/torpedo/explosion/splash/ping/laser/daub/correct/wrong/countdown/go/win/lose/respawn/punch/teleport/beam/KO/scribble…)
- [x] game-audio.js: per-game watchers + pitch profiles (match games diff state; mass games use World events; Brawl events/fx)
- [x] Mute, gate (no audio on DOB/terms) and tap-to-resume rules respected; tests smoke-sfx + shots-d

## cm-v32 (2026-10-21, built, not deployed)
- [x] UX §2 acknowledgement: Accept needs scroll-to-end AND minimum timer (sized to read-aloud length, clamped 20-30 s; full terms = 30 s) AND the tick box; visible countdown ring + 3-step checklist + "Accept (Ns)" label; Read to me stays at the very top; reduced motion = static ring; re-accept on every app version (ACCEPT_ID = terms@build; sw cache cm-v32).
- [x] UX §2.5 forced profile: onboarding "Start matching" is blocked until missingProfile() is empty (jumps to the first missing step with a notice); existing incomplete profiles stay locked to Profile.
- [x] UX §3 starter characters offered in the onboarding photo step (6 glass presets) and used as the avatar when no photo; >4 photos: extras stay on the phone, notice shown (toast + persistent line), shown window rotates each login (PH.rotate wired at boot).
- Tests: smoke-ux (+8), smoke-ui (+2), new scripts/shots-ack.mjs (real 30 s timer, 320/360/390/430 px, reduced motion, onboarding block, nav lock, rolling photos) added to regress.

## cm-v33 (2026-10-21, built, not deployed)
- [x] UX §5 per-mode weights: Gaming now scores gaming fields only (interests weight 0); Friends/Dating unchanged; religion full in Dating, low in Friends, ~0 in Gaming/online.
- [x] Soft vs hard compare is a per-mode user setting (defaults Dating hard, Friends soft, Gaming hard); soft compare for interests/events now means "any shared item" instead of "both have any" (was always 100%).
- [x] Deal breakers: on/off toggle per field + optional "only match people who are…" accept bubbles (shown when the toggle is on; nothing picked = must match own answer). A deal breaker with no criteria no longer blocks everyone. Deal breakers on fields a mode ignores have no effect in that mode.
- [x] Hidden / "don't answer" fields vs the other side's deal breaker: never a block, silent 35% penalty per field (compounds), no reason exposed; hidden values never leave the phone (packet carries only the key).
- [x] Per-mode age ranges (Dating / Friends / Gaming) clamped into the user's own band (adult 18-99, minor 13-17), swapped if reversed, mutual; onboarding dating range (ageMin/ageMax) kept in sync with ageRanges.dating.
- [x] Per-mode minimum match % (defaults 50/40/40) now always applied in Discover (before: only if set); Discover uses MV.discoverList (legacy shared-items/distance + v2 score, both must allow).
- [x] Dating-only fields (who you date, dating age range/min %/compare, budget) shown only while Dating is enabled; toggling Dating hides/shows them live and syncs with "What are you here for"; dating range not sent in the match packet while Dating is off.
- [x] Discover match bar per mode (ages, min %, compare, Edit); gender filter chips ("Show me") appear in Dating only.
- [x] Minors: legacy evaluate no longer drops every under-18 user (minors' Discover was empty) - minors match minors only, never adults, never Dating; minor ranges capped at 17; no Dating toggle/fields; no Roulette tab.
- [x] Profile form novalidate: out-of-range ages are clamped on save instead of a silent browser block.
- [x] sw cache cm-v33. Tests: new scripts/smoke-matchprefs.mjs (46 checks), new scripts/shots-match.mjs (43 checks, 320/360/390/430 px + minor) in regress; screenshots /workspace/cybermates-shots/v33-match/.
- [ ] Open: mesh search (livemesh.search) is not yet called with the per-mode min % from the UI; gender in soft tags is one letter (Trans man/Trans woman collide) - fine for now, revisit with the mesh server.

## cm-v34 (2026-10-22)
- [x] Hidden / blank / "don't answer" field vs the viewer's deal breaker: compounding x0.75 per field (80 -> 60 -> 45), replaces flat 35%; score never reaches 0. Tests in smoke-matchprefs.
- [x] docs/UX-WALKTHROUGH.md: 'documentation only' header removed (David approved building from it).
- [x] sw cache cm-v34.
