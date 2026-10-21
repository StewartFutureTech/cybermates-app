#!/usr/bin/env bash
# Full regression: build both flavors, then smoke.mjs (imports p2p/gate/secure/wallet/membership/legal/flavors/help/admin/
# twokey/tiers/approved/presence/killkey/ban/banlist/sweep with its localStorage shim) + every standalone suite.
# Note: the imported suites are NOT meant to be run on their own (they rely on smoke.mjs's shim).
set -u; cd "$(dirname "$0")/.."; fail=0; out=${SHOTS:-/workspace/cybermates-shots}/test-logs; mkdir -p "$out"
run(){ n=$1; shift; if "$@" > "$out/$n.log" 2>&1; then echo "PASS $n"; else echo "FAIL $n (see $out/$n.log)"; fail=1; fi; }
run build npm run build:all
run smoke node --no-warnings scripts/smoke.mjs
for s in arcade arcade-ai match megaship partb calls supaday brawl; do [ -f scripts/smoke-$s.mjs ] && run smoke-$s node --no-warnings scripts/smoke-$s.mjs; done
[ $fail = 0 ] && echo "REGRESSION: ALL PASS" || echo "REGRESSION: FAILURES"; exit $fail
