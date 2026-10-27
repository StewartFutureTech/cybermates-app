#!/usr/bin/env bash
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
for s in flink shop party arcade analog pick shades itema pmenu sfx arcade-ai match megaship battleship partb calls supaday brawl imports bootfail hostrot hostrot2 hostrot3 ux ui v35 supa-adapter supa-live signin perf glow matchprefs linking-ui rxwire reviewq globalrl refunds brawlnet idbind; do [ -f scripts/smoke-$s.mjs ] && run smoke-$s node --no-warnings scripts/smoke-$s.mjs; done
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
[ -x "${JAVA_HOME:-/home/box/jdk17}/bin/java" ] && run android bash scripts/android-check.sh
[ $fail = 0 ] && echo "REGRESSION: ALL PASS" || echo "REGRESSION: FAILURES"; exit $fail
