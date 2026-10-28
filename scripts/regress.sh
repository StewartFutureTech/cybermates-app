#!/usr/bin/env bash
# v52: smoke-safety (Quiet safety number: pair fingerprint identical both orderings; verified clears on key change; no banner).
# v51: smoke-v51 (PresenceSync reply-to-join + silence prune; Matchmaker BOT_START/INVITE; soft→hard mins + softClearsBoth;
#      CookieGate/FloodReporter PROTO=1). Soft→hard Discover wired in livemesh/app-mesh/main. Preview only.
# v49: smoke-mdmesh (multi-device delivery on the MESH path for v37-linked devices: per-ID device sets + sibling devices, v3
#      envelopes with a per-device wrapped content key (forward secret), sent copies, one-device types, single-device wire
#      unchanged, compat against a FROZEN v48 client both ways, devsync friends/block LWW, mesh sentCopy, wiring) + e2e-mdmesh
#      (3 isolated browser contexts: real v37 short-code link, both devices get messages, request + dsync, sent copies, wire).
# v48: smoke-supafs (forward secrecy + multi-device for the server-relayed Supabase chat path: signed uid-bound device bundles,
#      pins, per-message ephemeral + per-device wrapped key, prekey rotation/erase + seized-phone, v1 compat, SupabaseStore vs a
#      DB-rule fake, vault wiring; live DB half = supabase/tests/e2e_devices.sql, rolls back) + e2e-supafs (5 real tabs; LIVE
#      sign-in/Realtime part needs SUPA_TEST_USERS, else SKIP).
# v47: smoke-e2efs (E2E hardening: PAKE device transfer (CPace X25519 / Elligator2) + forward-secret v2 mesh envelopes with rotating
#      signed prekeys, erase-after-grace, seized-phone test, old-client compat) + e2e-e2efs (2 real tabs: v2-only chat, prekeys
#      restored from the vault after reload, real Settings-UI transfer wrong/right code).
# v46: smoke-rtgate (Realtime join gate + per-user limits: migration static checks, JS<->SQL PoW vectors, MeshGate vs a DB-rule
#      fake, SupabaseBus fail-closed join/back-off/renew, live anon refusals; live DB half = supabase/tests/realtime_gate.sql, rolls
#      back) + e2e-rtgate (LIVE Realtime: anon private 'mesh'/'control' join refused; signed-in admit/join/suspend/limit part needs
#      SUPA_TEST_USERS, else SKIP).
# v45: smoke-csam (CSAM reporting duty + evidence preservation: migration static checks, evidence.js collect/seal/parts/SHA-256/
#      upload/pending queue against a DB-rule fake store, adapter RPCs; live DB half = supabase/tests/csam_evidence.sql, rolls back)
#      + e2e-csam (2 real tabs: real report flow seals B's message + image, normal report unchanged, vault pending survives reload,
#      moderator panel open/blur/packet/2703(f)/CyberTip id).
# v44: smoke-proxvoice (proximity voice per-peer audio transport: fake WebRTC + Web Audio; range-gated connect/disconnect both sides,
#      distance gain per peer, talk gate, link cap, cross-age refused, block/mute, early ICE, renew, timeout/failed back-off, flood cap,
#      teardown, TURN env slot) + e2e-proxvoice (3 real tabs over the real mesh signal; ICE/RTP checks auto-skip when box Chrome policy
#      blocks UDP candidates).
# v43: smoke-idbind (ID spoofing / identity binding: PoW claims + certs + rotation, peer binder, live receive path gates, server
#      registry incl. 2 node instances on a fake PostgREST, bootstrap spoofed login/logoff, live anon refusal; live DB half =
#      supabase/tests/id_bindings.sql, rolls back) + e2e-idbind (real tabs: forged pings for another ID dropped, join cost timing).
# v42: smoke-brawlnet (networked multi-human Brawl over the mesh: snapshot codec + caps, join mid-match, prediction + host
#      authority, remote victim-signed hits, forged/flood/oversize drops, hand-off + failover, rematch, age bands) +
#      e2e-brawlnet (3 real tabs: join NOW, same-theme distinct shades, inputs reach the host, 3rd joiner, host leaves).
# v41: smoke-refunds (server-side conservative boost refunds: migration static checks, ledger unit with real Ed25519 receipts,
#      2 real node instances sharing the mesh ledger via a fake PostgREST mesh_refund, fail-closed, live anon refusal;
#      live DB half = supabase/tests/boost_refunds.sql, rolls back).
# v40: smoke-globalrl (global API rate limits: migration static checks, 2-3 real node instances sharing one counter via a fake
#      PostgREST rl_hit, fail-safe fallbacks, live anon refusal; live DB half = supabase/tests/global_rate_limits.sql, rolls back).
# v39: smoke-reviewq (reports -> team review bucket: migration static checks, SupabaseStore mod RPCs, real-browser review UI;
#      live DB half = supabase/tests/report_review_rls.sql, run via SQL editor / MCP, rolls back).
# v38: smoke-rxwire (broadcast discovery + DoS cheap shield on the live receive path: pure checks + 3 real tabs incl. a forged flood).
# v37: smoke-linking-ui (device linking QR screen, two Playwright contexts: offer -> request -> approve -> grant, expired, cap).
# Full regression: build both flavors, then smoke.mjs (imports p2p/gate/secure/wallet/membership/legal/flavors/help/admin/
# twokey/tiers/approved/presence/killkey/ban/banlist/sweep with its localStorage shim) + every standalone suite.
# smoke-supa-live hits the LIVE Supabase project (needs SUPA_TEST_USERS or Anonymous sign-ins; else SKIP, or FAIL with SUPA_LIVE=1).
# Note: the imported suites are NOT meant to be run on their own (they rely on smoke.mjs's shim).
set -u; cd "$(dirname "$0")/.."; fail=0; out=${SHOTS:-/workspace/cybermates-shots}/test-logs; mkdir -p "$out"
run(){ n=$1; shift; if "$@" > "$out/$n.log" 2>&1; then echo "PASS $n"; else echo "FAIL $n (see $out/$n.log)"; fail=1; fi; }
run build npm run build:all
run smoke node --no-warnings scripts/smoke.mjs
for s in flink shop party arcade analog pick shades itema pmenu sfx arcade-ai match megaship battleship partb calls supaday brawl imports bootfail hostrot hostrot2 hostrot3 ux ui v35 supa-adapter supa-live signin perf glow matchprefs linking-ui rxwire reviewq globalrl refunds brawlnet idbind proxvoice csam rtgate e2efs supafs mdmesh v51 safety; do [ -f scripts/smoke-$s.mjs ] && run smoke-$s node --no-warnings scripts/smoke-$s.mjs; done
run shots-ack node --no-warnings scripts/shots-ack.mjs                # UX §2/§3 (v32): real 30 s ack timer + countdown at 320-430 px, forced profile, starter characters, rolling photos
run shots-match node --no-warnings scripts/shots-match.mjs            # UX §5 (v33): per-mode ranges/min %/compare, deal breakers, dating-only fields, Dating-only gender filter, minors, 320-430 px
run shots-discover node --no-warnings scripts/shots-discover.mjs      # UX §6 (v35): list/swipe, pass refills slot, like, tap loads profile, 320/390/430 px
run shots-battleship node --no-warnings scripts/shots-battleship.mjs  # v36: Star Fleet placement/hidden fleet/exact tap->cell + Mega Fleet arena, 320/390/430 px
run shots-logo-v35 node --no-warnings scripts/shots-logo-v35.mjs   # v35 jack-in logo glow + continuous tracers, 320/390/430 px
run e2e-flink node scripts/e2e-flink.mjs
run sim-livemesh node --no-warnings scripts/sim-livemesh.mjs 300 1000   # UX §6-8 living mesh, 300 + 1000 simulated nodes
run e2e-livemesh node scripts/e2e-livemesh.mjs                          # living mesh, 4 real tabs
run e2e-brawlnet node scripts/e2e-brawlnet.mjs                          # v42 networked Brawl, 3 real tabs
run e2e-idbind node scripts/e2e-idbind.mjs                              # v43 ID binding, 3 real tabs + forged pings
run e2e-proxvoice node scripts/e2e-proxvoice.mjs                        # v44 proximity voice transport, 3 real tabs + fake mic
run e2e-csam node scripts/e2e-csam.mjs                                  # v45 CSAM evidence preservation, 2 real tabs + moderator panel
run e2e-rtgate node scripts/e2e-rtgate.mjs                              # v46 Realtime join gate, LIVE Realtime (anon refused; signed-in part needs SUPA_TEST_USERS)
run e2e-e2efs node scripts/e2e-e2efs.mjs                              # v47 forward secrecy + PAKE transfer, 2 real tabs
run e2e-supafs node scripts/e2e-supafs.mjs                            # v48 FS + multi-device on the Supabase chat path, 5 real tabs (live part needs SUPA_TEST_USERS)
run e2e-mdmesh node scripts/e2e-mdmesh.mjs                            # v49 multi-device delivery on the mesh path, 3 isolated phones (real v37 link)
[ -x "${JAVA_HOME:-/home/box/jdk17}/bin/java" ] && run android bash scripts/android-check.sh
[ $fail = 0 ] && echo "REGRESSION: ALL PASS" || echo "REGRESSION: FAILURES"; exit $fail
