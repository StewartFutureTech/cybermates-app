// OFFLINE SIGNING ONLY (owner CLI + tests). Never imported by src/ or api/, so it never reaches a bundle or the server.
// The server and phones hold only the PUBLIC key (VITE_KILL_PUBKEY) and verify (src/killswitch.js verifySig).
import nacl from 'tweetnacl';
import { canonical, b64, unb64 } from '../../src/killswitch.js';
import { canon as cfgCanon } from '../../src/appconfig.js';
const FIELDS = ['type', 'scope', 'reason', 'issued_at', 'expires_at', 'nonce'], EXT = ['level', 'strikes'];
export function sign(msg, seedB64) {
  const kp = nacl.sign.keyPair.fromSeed(unb64(seedB64)); const m = Object.fromEntries(FIELDS.concat(EXT.filter(k => msg[k] != null)).map(k => [k, msg[k]]));
  return { ...m, sig: b64(nacl.sign.detached(new TextEncoder().encode(canonical(m)), kp.secretKey)) };
}
export function keygen() { const seed = nacl.randomBytes(32); return { privateKey: b64(seed), publicKey: b64(nacl.sign.keyPair.fromSeed(seed).publicKey) }; }
export const pubOf = seedB64 => b64(nacl.sign.keyPair.fromSeed(unb64(seedB64)).publicKey);
export const signConfig = (m, seedB64) => ({ ...m, sig: b64(nacl.sign.detached(cfgCanon(m), nacl.sign.keyPair.fromSeed(unb64(seedB64)).secretKey)) });
