// Build-flavor check: public bundle (dist/) must not contain admin/dev tooling; admin bundle (dist-admin/) must.
// Both must keep the kill-switch LISTENER (disclosed to Apple). Run after `npm run build:all`; skips a flavor whose dist is missing.
// v57: Profile no longer embeds the Peer network panel, so the literal 'cybermates:control' left the public bundle; the listener (src/p2p.js BroadcastChannel(name + ':control')) is still there.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const bundle = d => readdirSync(d + '/assets').filter(f => f.endsWith('.js')).map(f => readFileSync(`${d}/assets/${f}`, 'utf8')).join('\n');
const ADMIN_MARKERS = ['data-admin="kill"', 'Warn / suspend / ban user', '/api/ban', 'Admin · Network halt', 'ak-send-signed', '/api/kill', '🛠 Dev panel', 'Reset all data (re-seed)', 'Simulate broadcast', '__cmDev', 'Create new user (voice onboarding)'];
const LISTENER = [':control', 'kill_switch', 'Peer network disabled by Cybermates'];
for (const [d, admin] of [['dist', false], ['dist-admin', true]]) {
  if (!existsSync(d + '/assets')) { console.log(`skip ${d} (not built — run npm run build:all)`); continue; }
  const js = bundle(d);
  for (const m of ADMIN_MARKERS) assert(js.includes(m) === admin, `${d}: admin marker ${JSON.stringify(m)} ${admin ? 'present' : 'absent'}`);
  for (const m of LISTENER) assert(js.includes(m), `${d}: kill-switch listener marker ${JSON.stringify(m)} present`);
  assert(js.includes('AI assistant (not a human)'), `${d}: help desk labeled AI assistant`);
  assert(!/KILL_PRIVATE_KEY=|xai-[A-Za-z0-9]{20,}|service_role"/.test(js), `${d}: no server secrets (private key / xAI key / service-role JWT) in bundle`);
}
