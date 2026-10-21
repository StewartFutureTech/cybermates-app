# Cybermates recovery inventory (2026-10-21, ~01:25 CDT)

## Sources checked
| Source | Result |
|---|---|
| Box `/workspace/cybermates` | **Newest base.** Has arcade, roulette, match games, terms `2026-10-20.3`, audio fix (`kickInGesture`/`revive` in src/sfx.js). File mtimes were reset by the restore (all 01:53 CDT), so content markers were used, not dates. Newer than `cybermates-backup-pre-arcade-20261021-001541.tgz` (adds src/arcade/, arcade-ui, match-ui, roulette*). |
| Box `/workspace/cm-live-hotfix` | Older line (no arcade/roulette/identity.js); source of the audio fix, already ported into box cybermates. |
| Vercel prod dpl_DnEq3hmJDyLJ6FwwxQAgGhfjt1RK | Only `src/index.html` (single-file bundle) + public assets; no sourcemaps. Bundle has terms `2026-10-20.2`, no roulette/arcade. **Older than box.** Earlier deployments (E5tx…, 5tCj…) predate it. |
| GitHub (dstewart3919) | No prior Cybermates repo. |
| Google Drive | Only "Law bot — Cybermates App Review" doc; no source. |
| Parent transcript | **Not available**: no ReadTranscript tool exists in any namespace for this subagent. Specs below are taken from the parent's task brief + in-code comments (e.g. "David, 2026-10-20" notes). |

Safety snapshot: `/workspace/recovery-snapshot-20261021-022102.tgz` (box clock label).
Off-box backup: https://github.com/dstewart3919/cybermates-app (private), `archive/src.b64.part00-03` = full source tarball (`cat archive/src.b64.part* | base64 -d | tar xz`), excludes .env*, node_modules, dist*, android/local.properties.

## Feature inventory (box = /workspace/cybermates; GitHub = archive commit d747fc8)
Legend: ✅ present · 🟡 partial/verify · ❌ missing. Live Vercel has only the pre-arcade subset.

### (a) Core
| Feature | Status | Where |
|---|---|---|
| Two-key identity | ✅ | src/identity.js, smoke-twokey OK |
| never-send / attest / blocklist / sweep / checkin / relay / api/attest | ✅ | src/*.js, api/attest.js; smoke-sweep OK |
| Server single-entry super list | ✅ | api/bootstrap.js, api/_lib/signal.js |
| Tiered bans 1-5 | ✅ | src/tiers.js, ban.js, banlist.js; smoke-tiers/ban/banlist OK |
| Signed kill switch, admin never takes private key, mod.mjs signs offline | ✅ | src/admin.js, src/killswitch.js, scripts/mod.mjs; smoke-killkey/admin OK |
| Encrypted vault | ✅ | src/vault.js |
| X25519 per-chat keys | ✅ | src/e2e.js, relay.js |
| Under-18 Dating gate | ✅ | src/discovery.js, main.js, compliance.js |
| Parent controls with PIN | ✅ | src/parental.js |
| Retention bubbles | ✅ | src/retention.js, mesh-ui.js |
| Accept-before-message | ✅ | src/mesh.js (comment "David, 2026-10-20") |
| Free connection requests + boosts with refund | ✅ | src/wallet.js, outbox.js, api/refund.js, api/_lib/refunds.js |
| US-only gating | ✅ | api/_lib/geo.js, checkin.js |
| Single inbox with mode icons | ✅ | src/inbox-ui.js (shot single-inbox.png) |
| Mood | ✅ | src/mood.js |
| Recently-online list of 500 | ✅ | api/_lib/recent.js |
| Store-and-forward pending queue | ✅ | src/outbox.js |
| Audio any-tap resume fix | ✅ | src/sfx.js matches AUDIO-FIX-NOTES.md |
| Terms 2026-10-20.3, 48h promise removed | 🟡 | version ✅; terms text still says Chats-tab messages "are cleared ... more than 48 hours after they were sent" (+ Plans note 48h). Needs check against David's exact wording (transcript unavailable). |

### (b) Roulette
| 18+ video matching, Skip, 24h cooldown, report, block-on-skip | ✅ | src/roulette.js, roulette-ui.js (shots roulette*.png) |

### (c) Arcade
| Mass Arena snake + Tron, tiled growing maps, 100-player sub-maps auto-split, mesh-linked | ✅ (verify split/mesh-link in tests) | src/arcade/snake.js, tron.js, instance.js, engine.js |
| Instant respawn | ✅ | engine.js/snake.js/tron.js |
| Natural AI, PG trash-talk, AI tag | ✅ | src/arcade/bots.js; smoke-arcade-ai OK |
| Proximity voice, adult/minor separation, default off, parent enable | ✅ | src/arcade/proximity.js, parental.js |

### (d) Match games (1v1/2v2/4v4, three.js glass neon bloom, theme colors, AI fill)
| Chess, Checkers, Connect Four | ✅ | games/chess.js, checkers.js, connect4.js, board3d.js, c4-3d.js |
| Star Fleet | ✅ | games/battleship.js, space3d.js |
| Ultimate Tic-tac-toe | ✅ | games/uttt.js |
| Tron Duel, Snake Battle | ✅ | games/duel.js, tron3d.js |
| Air hockey / pong | ✅ | games/pong.js, paddle3d.js |
| Trivia Clash | ✅ | games/trivia.js |
| Draw & Guess (Mass Arena) | ✅ | games/drawguess.js |
| Mega Fleet (Mass Arena) | ✅ | arcade/megaship.js; smoke-megaship OK |
| **Brawler (6-player FFA, original characters)** | ❌ | not present anywhere (box, backups, Vercel) |
| No hardcoded colors | 🟡 | 1 hex in arcade/engine.js, 2 in arcade/fx.js (likely fallbacks; audit) |

## Test baseline (box, after `npm ci`, `npm run build:all` = OK)
Pass: smoke, admin, approved, arcade, arcade-ai, ban, banlist, calls, flavors, help, killkey, match, megaship, membership, partb, presence, supaday, sweep, tiers, twokey.
Fail: smoke-gate ("web dev toggle: simulated emulator blocked"); smoke-legal, smoke-p2p, smoke-secure, smoke-wallet crash on missing `localStorage` in Node (harness issue, not app regression; to fix).

## Lost
- Screenshots: 56 still exist in /workspace/cybermates-shots (including arcade-*, roulette*); no brawler shots. Not yet committed.

## Where the rebuild continues
1. Fix test harness (localStorage shim) + smoke-gate, confirm terms 48h wording → core milestone green.
2. Audit hardcoded colors in arcade/engine.js, fx.js.
3. **Build the brawler** (6-player FFA, original characters, 3D glass neon bloom, theme colors, AI fill) — the only missing feature.
4. Commit screenshots to repo.

## Log
- 2026-10-21 01:23 CDT: archive of box base pushed (commit d747fc8).

### Correction (01:30 CDT)
The 5 "failing" suites (gate, legal, p2p, secure, wallet) are submodules imported by `scripts/smoke.mjs` (which supplies the localStorage shim); they are not standalone. Inside smoke.mjs all pass. Added `npm run regress` (scripts/regress.sh) = build:all + smoke.mjs + all standalone suites.

- 2026-10-21 Step 1 (48h wording + regression runner): terms.js, help-kb.md, mesh-ui.js (Plans note), mesh.js comment, README rewritten to the three-bubble model + under-18 always kept; TERMS_VERSION stays 2026-10-20.3 (per David). smoke-legal now asserts no 48-hour claim in terms/help/UI/README and the three bubbles. Regression: ALL PASS (smoke.mjs 481 ok). Note: internal TTL constants (store.js CHAT_TTL_MS, mesh.js PLAN_TTL_MS = 48h) still exist in code; no user-facing text promises them.
