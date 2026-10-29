// Kill-key safety: no private key in repo/bundles/admin path; keyfile outside repo + passphrase-encrypted; HALT confirm +
// reason; server (public key only) rejects unsigned / wrong-key / stale / replayed / reasonless halts. TEST KEYS: generated
// per run by scripts/lib/sign.mjs keygen() in memory (or a temp keyfile in os.tmpdir()), never committed, never bundled.
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { join } from 'node:path'; import { spawnSync } from 'node:child_process';
const KF = await import('./lib/keyfile.mjs'), SG = await import('./lib/sign.mjs'), K = await import('../src/killswitch.js'), M = await import('../api/_lib/mod.js');
const ROOT = KF.PROJECT_ROOT;
// keyfile location + encryption
let e = null; try { KF.assertOutsideProject(join(ROOT, 'kill.key')); } catch (x) { e = x; } assert(/inside the project/.test(e?.message), 'keyfile inside the project dir refused');
e = null; try { KF.assertOutsideProject(join(ROOT, 'scripts', 'x', 'k.key')); } catch (x) { e = x; } assert(e, 'nested path inside the project refused too');
const dir = mkdtempSync(join(tmpdir(), 'cmkey-')), kf = join(dir, 'kill.key'); process.env.KILL_KEY_PASSPHRASE = 'correct horse battery staple';
const kp = SG.keygen(); await KF.writeKeyfile(kf, kp.privateKey);
const raw = readFileSync(kf, 'utf8'); assert(!raw.includes(kp.privateKey) && JSON.parse(raw).kdf === 'scrypt' && (statSync(kf).mode & 0o777) === 0o600, 'keyfile is passphrase-encrypted (scrypt + AES-GCM), mode 0600, no plaintext seed');
assert((await KF.loadSeed(kf)) === kp.privateKey, 'right passphrase decrypts');
process.env.KILL_KEY_PASSPHRASE = 'wrong passphrase!!'; e = null; try { await KF.loadSeed(kf); } catch (x) { e = x; } assert(/wrong passphrase/.test(e?.message), 'wrong passphrase refused');
process.env.KILL_KEY_PASSPHRASE = 'correct horse battery staple'; chmodSync(kf, 0o644); e = null; try { await KF.loadSeed(kf); } catch (x) { e = x; } assert(/chmod 600/.test(e?.message), 'world-readable keyfile refused'); chmodSync(kf, 0o600);
// mod.mjs CLI: argv key refused, halt needs reason + HALT confirmation
const run = (...a) => spawnSync(process.execPath, ['scripts/mod.mjs', ...a], { cwd: ROOT, env: { ...process.env, KILL_KEYFILE: kf, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' }, encoding: 'utf8', input: '' });
assert(/command line/.test(run('halt', '--reason', 'x', kp.privateKey).stderr), 'mod.mjs refuses a key passed on argv');
assert(/explicit --reason/.test(run('halt', '--confirm', 'HALT').stderr), 'halt without --reason refused');
assert(/not confirmed/.test(run('halt', '--reason', 'drill').stderr) && /not confirmed/.test(run('halt', '--reason', 'drill', '--confirm', 'halt').stderr), 'halt without typing HALT exactly refused');
const out = join(dir, 'halt.json'), ok = run('halt', '--reason', 'drill', '--confirm', 'HALT', '--out', out);
const halt = JSON.parse(readFileSync(out, 'utf8')); assert(ok.status === 0 && halt.type === 'kill' && halt.scope === 'all' && halt.reason === 'drill' && await K.verifySig(halt, kp.publicKey), 'confirmed halt signed offline from keyfile → --out bundle verifies with the public key');
assert(!readFileSync(out, 'utf8').includes(kp.privateKey) && !ok.stdout.includes(kp.privateKey) && !ok.stderr.includes(kp.privateKey), 'signed bundle / output never contains the key');
assert(/inside the project/.test(spawnSync(process.execPath, ['scripts/mod.mjs', 'pubkey', '--keyfile', join(ROOT, 'k.key')], { cwd: ROOT, encoding: 'utf8' }).stderr), 'mod.mjs refuses --keyfile inside the project');
// server: public key only; rejects unsigned / wrong key / stale / replayed / reasonless
const pub = kp.publicKey, seen = new Map(), now = Date.now(), fresh = o => SG.sign(K.makeMsg({ type: 'kill', scope: 'all', reason: 'r', now, ...o }), kp.privateKey);
assert(await M.verifyAdminMsg(K.makeMsg({ reason: 'r' }), pub, now, seen) === 'bad signature', 'server rejects unsigned');
assert(await M.verifyAdminMsg(SG.sign(K.makeMsg({ reason: 'r' }), SG.keygen().privateKey), pub, now, seen) === 'bad signature', 'server rejects wrong key');
assert(await M.verifyAdminMsg(fresh({ now: now - 3600e3 }), pub, now, seen) === 'stale or bad window', 'server rejects stale (timestamp)');
const m1 = fresh(); assert(await M.verifyAdminMsg(m1, pub, now, seen) === null && await M.verifyAdminMsg(m1, pub, now + 1000, seen) === 'replayed nonce', 'server rejects replayed nonce within the window');
assert(await M.verifyAdminMsg(fresh({ reason: '' }), pub, now, seen) === 'halt needs an explicit reason', 'server rejects a halt with no reason');
assert(await M.verifyAdminMsg(fresh(), '', now, seen) === 'server has no public key', 'server with no public key configured refuses everything');
{ const src = readFileSync(join(ROOT, 'api/_lib/mod.js'), 'utf8') + readFileSync(join(ROOT, 'api/_fn/kill.js'), 'utf8') + readFileSync(join(ROOT, 'api/_fn/ban.js'), 'utf8');
  assert(!/KILL_PRIVATE|fromSeed|sign\.detached\(/.test(src), 'server routes contain no private-key / signing code (verify only)'); }
// scan repo (excluding node_modules/android/dist) + both builds for private key material
const walk = (d, acc = []) => { for (const n of readdirSync(d)) { if (['node_modules', '.git', 'android'].includes(n)) continue; const p = join(d, n); const st = statSync(p); if (st.isDirectory()) walk(p, acc); else if (st.size < 3e6) acc.push(p); } return acc; };
const files = walk(ROOT), bad = [];
const PAT = [/KILL_PRIVATE_KEY\s*=\s*[A-Za-z0-9+/]{40,}/, /RECEIPT_SIGNING_SEED\s*=\s*[A-Za-z0-9+/]{40,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /"privateKey"\s*:\s*"[A-Za-z0-9+/]{43}="/, /\b[0-9a-f]{64}\b/];
for (const f of files) { if (/\.(png|jpg|ico|webp|tgz|zip)$/.test(f)) continue; const t = readFileSync(f, 'utf8'); for (const p of PAT) if (p.test(t)) bad.push(f.replace(ROOT + '/', '') + ' ~ ' + p); }
const allowed = b => /^scripts\/.*(smoke|sim)/.test(b) && false; // no exceptions currently needed
const real = bad.filter(b => !allowed(b) && !/package-lock\.json/.test(b));
if (real.length) console.log('  findings:', real); assert(!real.length, `repo + dist + dist-admin scan: no private key material (${files.length} files)`);
for (const d of ['dist', 'dist-admin']) { const js = readdirSync(join(ROOT, d, 'assets')).filter(x => x.endsWith('.js')).map(x => readFileSync(join(ROOT, d, 'assets', x), 'utf8')).join('');
  assert(!/ak-key|KILL_PRIVATE_KEY|signControl|scripts\/lib\/sign/.test(js), `${d}: no signing / key-input code in bundle`); }
console.log('ALL OK smoke-killkey');
