// v52 Quiet safety number: same pair → identical number both code orderings; different key → different number;
 // verified flag clears when fingerprint changes; export helpers unit-tested. No banner / no strict gate.
import nacl from 'tweetnacl';
import { readFileSync } from 'node:fs';
import { b64 } from '../src/vault.js';
import * as SN from '../src/safety-number.js';

const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const kp = () => { const k = nacl.sign.keyPair(); return { pub: b64(k.publicKey), sec: b64(k.secretKey) }; };

const A = { code: 'AAAA1111BBBB2222', ...kp() };
const B = { code: 'CCCC3333DDDD4444', ...kp() };
const C = { code: 'EEEE5555FFFF6666', ...kp() };

// canonical order independent of argument order
const p1 = SN.canonicalPair(A, B), p2 = SN.canonicalPair(B, A);
assert(p1 && p2 && p1[0].code === p2[0].code && p1[1].code === p2[1].code, 'canonicalPair sorts by code both orderings');
assert(SN.canonicalString(A, B) === SN.canonicalString(B, A), 'canonicalString identical both orderings');
assert(SN.canonicalString(A, A) === null && SN.canonicalPair(A, { code: A.code, pub: B.pub }) === null, 'same code refused');
assert(!SN.canonicalString(A, { code: B.code, pub: '' }), 'missing pub refused');

const snAB = await SN.safetyNumber(A, B);
const snBA = await SN.safetyNumber(B, A);
assert(snAB && snBA && snAB.number === snBA.number && snAB.fp === snBA.fp, 'same pair → identical safety number both orderings');
assert(snAB.groups.length === 12 && snAB.digits.length === 60 && /^\d{5}( \d{5}){11}$/.test(snAB.number), '60 digits in 12 groups of 5');
assert(snAB.canon.startsWith('cm-sn-v1|') && snAB.qr === snAB.canon, 'canon/qr use cm-sn-v1 prefix');
assert(snAB.fp.length === 64 && /^[0-9a-f]+$/.test(snAB.fp), 'fp is 32-byte hex');

const snAC = await SN.safetyNumber(A, C);
assert(snAC && snAC.number !== snAB.number && snAC.fp !== snAB.fp, 'different peer key → different number');

const B2 = { code: B.code, ...kp() }; // same code, different key
const snAB2 = await SN.safetyNumber(A, B2);
assert(snAB2 && snAB2.fp !== snAB.fp, 'same codes, rotated profile key → different fp');

assert(await SN.safetyNumber(A, { code: B.code, pub: 'not-a-key!!!' }) === null, 'garbage pub → null');
assert(await SN.ownKeyHint(A.pub), 'ownKeyHint for valid pub');
assert(await SN.ownKeyHint('nope') === null, 'ownKeyHint rejects garbage');

// verified flag helpers
let map = {};
assert(SN.matchVerified(map, B.code, snAB.fp) === null, 'unverified initially');
map = SN.markVerified(map, B.code, snAB.fp, 1_700_000_000_000);
assert(SN.matchVerified(map, B.code, snAB.fp)?.at === 1_700_000_000_000, 'mark verified sticks');
assert(SN.matchVerified(map, B.code, snAB2.fp) === null, 'wrong fp → not verified');
map = SN.pruneVerified(map, B.code, snAB2.fp); // key changed → silent clear
assert(!map[B.code] && SN.matchVerified(map, B.code, snAB2.fp) === null, 'verified clears when fingerprint changes');
map = SN.markVerified(map, B.code, snAB2.fp);
map = SN.clearVerified(map, B.code);
assert(!map[B.code], 'clearVerified removes entry');

// peerProfilePub resolver
const fake = {
  node: { friends: new Map([[B.code, { pub: B.pub }]]), cache: new Map() },
  e2e: { peers: new Map([[C.code, { pub: C.pub }]]) },
};
assert(SN.peerProfilePub(fake, B.code) === B.pub, 'peerProfilePub from friends');
assert(SN.peerProfilePub(fake, C.code) === C.pub, 'peerProfilePub from e2e peers');
assert(SN.peerProfilePub(fake, 'ZZZZ') === null, 'peerProfilePub miss → null');

// Quiet: no banner / strict gate language in sources we touch
const ui = readFileSync(new URL('../src/mesh-ui.js', import.meta.url), 'utf8');
const snSrc = readFileSync(new URL('../src/safety-number.js', import.meta.url), 'utf8');
const am = readFileSync(new URL('../src/app-mesh.js', import.meta.url), 'utf8');
assert(/openSafetySheet|Safety number/.test(ui) && /safetyFor/.test(am), 'Quiet UI + mesh API wired');
assert(!/key changed|re-verify|untrusted key|warn-until-verified|strict.?verif/i.test(snSrc + ui.match(/openSafetySheet[\s\S]*$/)?.[0] || ''), 'no scare / nag copy in Quiet sheet');
assert(/cm-v55-2026-10-29/.test(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')), 'SW stamp cm-v55-2026-10-29');

console.log('ALL OK smoke-safety');
