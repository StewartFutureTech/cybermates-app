// Offline checks for src/backend/supabase-*.js: adapter surface, public-only keys, migrations present with RLS on every table.
import fs from 'node:fs';
import { SupabaseStore, ADAPTER_METHODS } from '../src/backend/supabase-store.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../src/backend/supabase-config.js';
import { makeClient, jwtRole } from '../src/backend/supabase-client.js';
import { boxSealer } from '../src/backend/supabase-e2e.js';
import nacl from 'tweetnacl';
let f = 0; const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL ') + m); if (!c) f++; };
for (const m of ADAPTER_METHODS) ok(typeof SupabaseStore.prototype[m] === 'function', 'SupabaseStore.' + m);
for (const m of ['getCurrentUserId', 'getProfile', 'upsertProfile', 'listProfiles', 'listMessages', 'sendMessage', 'markRead']) ok(ADAPTER_METHODS.includes(m), 'LocalAdapter-compatible ' + m);
ok(/^https:\/\/dapocxyyrexemnmpzzsr\.supabase\.co$/.test(SUPABASE_URL), 'project URL');
ok(/^sb_publishable_/.test(SUPABASE_PUBLISHABLE_KEY) || jwtRole(SUPABASE_PUBLISHABLE_KEY) === 'anon', 'client key is publishable/anon');
let refused = false; try { await makeClient({ key: 'sb_secret_xxx' }); } catch { refused = true; } ok(refused, 'makeClient refuses secret keys');
// no service-role material anywhere in shipped source / bundles
const scan = d => fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).filter(p => /\.(js|mjs|html|json)$/.test(p)).map(p => d + '/' + p) : [];
const bad = [...scan('src'), ...scan('dist'), ...scan('dist-single')].filter(p => { const s = fs.readFileSync(p, 'utf8'); return /sb_secret_[A-Za-z0-9]/.test(s) || /SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*['"]ey/.test(s) || [...s.matchAll(/eyJ[\w-]+\.(eyJ[\w-]+)\.[\w-]+/g)].some(m => jwtRole('x.' + m[1]) === 'service_role'); });
ok(!bad.length, 'no service_role/secret keys in src/ or dist ' + bad.join(','));
// E2E sealer round-trip
const a = nacl.box.keyPair(), b = nacl.box.keyPair(), B64 = u => Buffer.from(u).toString('base64');
const sa = boxSealer({ xsec: B64(a.secretKey) }), sb = boxSealer({ xsec: B64(b.secretKey) });
const { body, nonce } = sa.seal(B64(b.publicKey), 'hello'); ok(body !== 'hello' && sb.open(B64(a.publicKey), body, nonce) === 'hello', 'E2E box round-trip');
// migrations: every created table has RLS enabled
const sql = fs.readdirSync('supabase/migrations').sort().map(p => fs.readFileSync('supabase/migrations/' + p, 'utf8')).join('\n');
const tables = [...sql.matchAll(/create table (public\.\w+)/g)].map(m => m[1]);
ok(tables.length >= 19, tables.length + ' tables in migrations');
for (const t of tables) ok(sql.includes(`alter table ${t} enable row level security`) || new RegExp(`alter table ${t.replace('.', '\\.')} enable row level security`).test(sql) || sql.includes(`${t} enable row level security`), 'RLS on ' + t);
ok(!/to anon/.test(sql), 'no policy/grant targets anon');
console.log(f ? `supa-adapter: ${f} FAILED` : 'supa-adapter: all ok'); process.exit(f ? 1 : 0);
