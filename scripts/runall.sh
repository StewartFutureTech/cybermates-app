cd /workspace/cybermates
npm run build >/tmp/b1.log 2>&1; echo build=$?
npm run build:admin >/tmp/b2.log 2>&1; echo admin=$?
for t in smoke smoke-ban smoke-banlist smoke-sweep smoke-tiers smoke-twokey smoke-approved smoke-presence smoke-killkey smoke-supaday smoke-calls smoke-partb smoke-arcade; do timeout 300 node --no-warnings scripts/$t.mjs >/tmp/t-$t.log 2>&1; echo "$t=$? $(grep -m2 FAIL /tmp/t-$t.log) $(tail -1 /tmp/t-$t.log)"; done
for t in e2e-mesh e2e-calls ios-audio ios-noflash ios-onboarding; do timeout 400 node scripts/$t.mjs >/tmp/t-$t.log 2>&1; echo "$t=$? $(tail -1 /tmp/t-$t.log)"; done
timeout 200 node scripts/shots-arcade.mjs >/tmp/t-shots-arcade.log 2>&1; echo "shots-arcade=$? $(tail -1 /tmp/t-shots-arcade.log)"
echo ALLDONE
node --no-warnings scripts/smoke-arcade-ai.mjs
