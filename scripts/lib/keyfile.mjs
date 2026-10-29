// Kill-key file handling for scripts/mod.mjs. The private key is NEVER taken from argv or env (shell history), never
// stored in the repo, and refused if the keyfile is inside the project directory.
//   Key file: --keyfile <path> (path only, not the key) | env KILL_KEYFILE | default ~/.cybermates/kill.key
//   Format: passphrase-encrypted JSON {v:1, kdf:'scrypt', N, r, p, salt, iv, tag, ct} (AES-256-GCM), mode 0600.
//   Passphrase: typed at a hidden TTY prompt (env KILL_KEY_PASSPHRASE only for non-interactive tests/CI).
import { readFileSync, writeFileSync, mkdirSync, statSync, realpathSync, existsSync } from 'node:fs';
import { resolve, dirname, sep, join } from 'node:path';
import { homedir } from 'node:os';
import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const defaultKeyfile = () => process.env.KILL_KEYFILE || join(homedir(), '.cybermates', 'kill.key');
const real = p => { try { return realpathSync(p); } catch { return resolve(p); } };
export function assertOutsideProject(p, root = PROJECT_ROOT) {
  const a = real(existsSync(p) ? p : dirname(p)) + sep, r = real(root) + sep;
  if (a.startsWith(r)) throw new Error(`refusing keyfile inside the project directory (${root}). Keep it outside the repo, e.g. ~/.cybermates/kill.key`);
}
const S = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function encryptSeed(seedB64, pass) { const salt = randomBytes(16), iv = randomBytes(12), k = scryptSync(pass, salt, 32, S), c = createCipheriv('aes-256-gcm', k, iv); const ct = Buffer.concat([c.update(seedB64, 'utf8'), c.final()]);
  return { v: 1, kdf: 'scrypt', N: S.N, r: S.r, p: S.p, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') }; }
export function decryptSeed(j, pass) { const k = scryptSync(pass, Buffer.from(j.salt, 'base64'), 32, { N: j.N, r: j.r, p: j.p, maxmem: S.maxmem }), d = createDecipheriv('aes-256-gcm', k, Buffer.from(j.iv, 'base64')); d.setAuthTag(Buffer.from(j.tag, 'base64'));
  try { return Buffer.concat([d.update(Buffer.from(j.ct, 'base64')), d.final()]).toString('utf8'); } catch { throw new Error('wrong passphrase or corrupted keyfile'); } }
export async function promptHidden(q) {
  if (process.env.KILL_KEY_PASSPHRASE) return process.env.KILL_KEY_PASSPHRASE;
  if (!process.stdin.isTTY) throw new Error('passphrase needed: run in a terminal (hidden prompt)');
  process.stderr.write(q); const { stdin } = process; stdin.setRawMode(true); stdin.resume(); let s = '';
  return new Promise(res => stdin.on('data', function on(b) { for (const ch of b.toString('utf8')) { if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); process.stderr.write('\n'); return res(s); } if (ch === '\u0003') process.exit(130); if (ch === '\u007f') s = s.slice(0, -1); else s += ch; } }));
}
export async function promptLine(q) { if (!process.stdin.isTTY) return null; process.stderr.write(q); return new Promise(res => { process.stdin.resume(); process.stdin.once('data', b => { process.stdin.pause(); res(b.toString().trim()); }); }); }
export async function loadSeed(path = defaultKeyfile()) {
  assertOutsideProject(path); if (!existsSync(path)) throw new Error('keyfile not found: ' + path + ' (create one: node scripts/mod.mjs keygen)');
  const mode = statSync(path).mode & 0o077; if (mode) throw new Error(`keyfile ${path} is readable by group/others; run chmod 600`);
  let j; try { j = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('keyfile must be the passphrase-encrypted JSON written by mod.mjs keygen'); }
  return decryptSeed(j, await promptHidden('Kill-key passphrase: '));
}
export async function writeKeyfile(path, seedB64) {
  assertOutsideProject(path); if (existsSync(path)) throw new Error('keyfile exists, refusing to overwrite: ' + path);
  const p1 = await promptHidden('New passphrase (12+ chars): '); if (p1.length < 12) throw new Error('passphrase too short');
  if (!process.env.KILL_KEY_PASSPHRASE && (await promptHidden('Repeat passphrase: ')) !== p1) throw new Error('passphrases differ');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); writeFileSync(path, JSON.stringify(encryptSeed(seedB64, p1)), { mode: 0o600 });
}
