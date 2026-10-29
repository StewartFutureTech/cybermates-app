#!/usr/bin/env node
// Owner moderation CLI — the ONLY place the kill-switch private key is used. Signs OFFLINE; can also send directly.
// The private key is read from a passphrase-encrypted KEYFILE outside the repo (never argv, never env, never a browser):
//   node scripts/mod.mjs keygen [--keyfile ~/.cybermates/kill.key]        → writes encrypted keyfile (0600), prints PUBLIC key
//   node scripts/mod.mjs pubkey [--keyfile …]                              → prints the public key (for VITE_KILL_PUBKEY)
//   node scripts/mod.mjs halt --reason "…" [--out halt.json] [--dry-run]   → network-wide halt; asks you to type HALT
//   node scripts/mod.mjs resume [--reason "…"] [--out resume.json]         → signed resume (always newer than the halt)
//   node scripts/mod.mjs strike <id> --category spam/scam --reason "…" [--level 1-5] [--suspend-days 7] [--current N] [--out f.json]
//   node scripts/mod.mjs ban <id> --category … --reason "…" [--out f.json]       (= strike --level 5)
//   node scripts/mod.mjs unban <id> [--to-level 0-3] [--reason "…"] [--out f.json]
// --out writes the signed bundle for pasting into the admin panel (it contains no key). Without SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY (or with --dry-run) nothing is sent. Keyfile: --keyfile <path> | env KILL_KEYFILE | ~/.cybermates/kill.key;
// refused if inside the project directory. Non-interactive halt (CI drills) needs --confirm HALT.
import { makeMsg, verifySig } from '../src/killswitch.js';
import { sign, keygen, pubOf } from './lib/sign.mjs';
import { loadSeed, writeKeyfile, defaultKeyfile, promptLine } from './lib/keyfile.mjs';
import { nextOffense } from '../src/tiers.js';
import { env, ban, unban, getRecord, meshKill, CATEGORIES, CSAM_REMINDER } from '../api/_lib/mod.js';
import { writeFileSync } from 'node:fs';
const argv = process.argv.slice(2), cmd = argv[0], NEEDS_ID = ['strike', 'ban', 'unban'].includes(cmd), code = NEEDS_ID ? argv[1] : 'all', rest = argv.slice(NEEDS_ID ? 2 : 1);
const arg = (n, d) => { const i = rest.indexOf('--' + n); return i < 0 ? d : rest[i + 1]; }, has = n => rest.includes('--' + n);
const die = m => { console.error('✗ ' + m); process.exit(1); };
if (rest.some(x => /^[A-Za-z0-9+/]{43}=$/.test(x))) die('a base64 key-like value was passed on the command line; keys are only read from the keyfile');
const keyfile = arg('keyfile', defaultKeyfile());
if (cmd === 'keygen') { const k = keygen(); try { await writeKeyfile(keyfile, k.privateKey); } catch (e) { die(e.message); } console.log(`VITE_KILL_PUBKEY=${k.publicKey}`); console.error(`✓ encrypted keyfile written to ${keyfile} (0600). Back it up offline; set VITE_KILL_PUBKEY in Vercel env.`); process.exit(0); }
if (!['pubkey', 'strike', 'ban', 'unban', 'halt', 'resume'].includes(cmd) || !/^[A-Za-z0-9-]{1,64}$/.test(code || '')) die('usage: mod.mjs keygen|pubkey|halt|resume|strike <id>|ban <id>|unban <id> [...] (see header)');
let seed; try { seed = await loadSeed(keyfile); } catch (e) { die(e.message); }
if (cmd === 'pubkey') { console.log(pubOf(seed)); process.exit(0); }
const category = arg('category', 'other'); if (['strike', 'ban'].includes(cmd) && !CATEGORIES.includes(category)) die('bad --category (' + CATEGORIES.join('|') + ')');
const cfg = env(), dry = has('dry-run') || !cfg.url || !cfg.srk, reason = arg('reason', '');
let msg, plan, bundle;
if (cmd === 'halt' || cmd === 'resume') {
  if (cmd === 'halt' && !String(reason).trim()) die('halt requires an explicit --reason "…" (shown to every user)');
  if (cmd === 'halt') { const typed = arg('confirm') ?? await promptLine('This halts the ENTIRE network for everyone. Type HALT to sign: '); if (typed !== 'HALT') die('not confirmed (type HALT exactly). Nothing signed.'); }
  msg = sign(makeMsg({ type: cmd === 'halt' ? 'kill' : 'clear', scope: 'all', reason: cmd === 'halt' ? reason.trim() : reason || 'resumed', ttlMs: cmd === 'halt' ? 365 * 864e5 - 60e3 : 3600e3 }), seed);
  bundle = msg;
} else if (cmd === 'unban') { msg = sign(makeMsg({ type: 'clear', scope: 'user:' + code, reason: +arg('to-level', 0) ? 'lowered to warning' : 'unbanned', ttlMs: 3600e3 }), seed); bundle = { msg, code, reason, toLevel: +arg('to-level', 0) }; }
else {
  const prev = dry ? (arg('current') ? { level: +arg('current'), strikes: +arg('current') } : null) : await getRecord(cfg, code);
  plan = nextOffense(prev, { set: cmd === 'ban' ? 5 : arg('level', null), reason, suspendMs: +arg('suspend-days', 7) * 864e5 });
  const label = plan.level === 5 ? 'Account banned' : plan.level === 4 ? 'Account suspended' : 'Warning';
  msg = sign(makeMsg({ type: plan.level >= 4 ? 'kill' : 'warn', scope: 'user:' + code, reason: `${label} (${category})`, ttlMs: plan.ttlMs, level: plan.level, strikes: plan.strikes }), seed);
  bundle = { msg, code, category, reason };
}
seed = null; // drop the key from memory as soon as signing is done
if (arg('out')) { writeFileSync(arg('out'), JSON.stringify(bundle)); console.error(`signed ${cmd} written to ${arg('out')} → paste into the admin panel (contains no key)`); }
if (dry) { console.log(JSON.stringify({ plan, bundle }, null, 2)); console.error('DRY RUN / offline: nothing sent.'); process.exit(0); }
if (cmd === 'halt' || cmd === 'resume') { await meshKill(cfg, msg); console.error('✓ ' + cmd + ' (server halt flag first, then broadcast)'); process.exit(0); }
const r = cmd === 'unban' ? await unban(cfg, { msg, code, reason, actor: 'cli', toLevel: +arg('to-level', 0) }) : await ban(cfg, { msg, code, category, reason, deviceHash: arg('device-hash', null), actor: 'cli' });
console.error(`✓ ${cmd} ${code} → level ${r.level}`); if (r.csam) console.error('\n⚠️  ' + CSAM_REMINDER);
