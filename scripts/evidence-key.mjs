// v45 SAFETY-TEAM EVIDENCE KEY (run OFFLINE by the owner; never in CI, never committed).
//   node scripts/evidence-key.mjs gen --out /secure/place/cm-evidence-team.key [--kid team-2026a]
//     -> writes the SECRET key (base64, file mode 600) to --out, prints the kid + PUBLIC key and the one SQL line to register
//        the public half (run it in the Supabase SQL editor as the owner; deactivate the old row first when rotating).
//   node scripts/evidence-key.mjs open <hold.json> --key /secure/place/cm-evidence-team.key
//     -> hold.json = {"env":{...}, "parts":["...","..."]} (from mod_evidence_get); prints a SUMMARY only (counts, per-file
//        SHA-256 for the CyberTip packet). It never writes media to disk.
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import nacl from 'tweetnacl';
import { toB64, openEvidence, fileList } from '../src/evidence.js';
const [cmd, ...rest] = process.argv.slice(2); const arg = k => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : null; };
const die = m => { console.error(m); process.exit(2); };
if (cmd === 'gen') {
  const out = arg('--out'); if (!out) die('usage: gen --out <secret-key-file> [--kid id]'); if (existsSync(out)) die('refusing to overwrite ' + out);
  const kid = arg('--kid') || 'team-' + new Date().toISOString().slice(0, 10).replace(/-/g, ''); if (!/^[A-Za-z0-9_-]{4,32}$/.test(kid)) die('bad kid');
  const kp = nacl.box.keyPair(); writeFileSync(out, toB64(kp.secretKey) + '\n', { mode: 0o600 }); kp.secretKey.fill(0);
  const pub = toB64(kp.publicKey);
  console.log(`kid ${kid}\npublic ${pub}\nsecret written to ${out} (mode 600) - keep it offline; moderators paste it only when opening evidence.\n`);
  console.log(`-- register (Supabase SQL editor, owner):\nupdate app.evidence_keys set active = false where active;\ninsert into app.evidence_keys (kid, pub) values ('${kid}', '${pub}');`);
} else if (cmd === 'open') {
  const f = rest[0], kf = arg('--key'); if (!f || !kf) die('usage: open <hold.json> --key <secret-key-file>');
  const h = JSON.parse(readFileSync(f, 'utf8')); const b = await openEvidence(h.env, h.parts, readFileSync(kf, 'utf8').trim());
  console.log(JSON.stringify({ reported: b.reported?.code, reason: b.reason, collectedAt: b.collectedAt, items: b.items.length, truncated: !!b.truncated, files: await fileList(b) }, null, 2));
} else die('usage: node scripts/evidence-key.mjs gen --out <file> [--kid id] | open <hold.json> --key <file>');
