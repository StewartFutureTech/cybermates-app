// Device attestation hooks (client). Android: Google Play Integrity; iOS: Apple App Attest. Web: none (unattested).
import { sha256 } from './sha256.js';
// The token is bound to the ID key via a nonce = SHA-256("cybermates-attest-v1|" + id + "|" + serverChallenge or time bucket),
// so a token can't be replayed for another ID. Server-side verification: api/_fn/attest.js (stub, see TODOs there).
// Native side needs a Capacitor plugin exposing:
//   Plugins.PlayIntegrity.requestToken({ nonce, cloudProjectNumber }) -> { token }        (TODO: implement plugin; Play Integrity API
//     "standard" or "classic" request, com.google.android.play:integrity; cloud project number from VITE_PLAY_CLOUD_PROJECT)
//   Plugins.AppAttest.attest({ challenge }) -> { keyId, attestation }                     (TODO: implement plugin with DCAppAttestService
//     generateKey + attestKey; store keyId in Keychain; later use generateAssertion for per-request assertions)
// Missing plugin / web / error => { provider: 'none' } and bootstrap marks the ID unattested (fail open, flagged).
const enc = new TextEncoder();
// v43: pass the signing key (pub) too and the nonce also binds the token to THAT key (ID <-> key binding, api/_lib/idbind.js).
export async function attestNonce(id, challenge = String(Math.floor(Date.now() / 300e3)), pub = null) {
  const h = new Uint8Array(await sha256(enc.encode('cybermates-attest-v1|' + id + '|' + challenge + (pub ? '|key:' + pub : ''))));
  let s = ''; for (const c of h) s += String.fromCharCode(c); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function requestAttestation(id, { cap = globalThis.Capacitor, env = (typeof import.meta !== 'undefined' && import.meta.env) || {}, challenge, pub = null } = {}) {
  const platform = cap?.getPlatform?.() || 'web', nonce = await attestNonce(id, challenge, pub), withPub = pub ? { pub } : {};
  try {
    if (platform === 'android' && cap?.isNativePlatform?.()) { const P = cap.Plugins?.PlayIntegrity || cap.registerPlugin?.('PlayIntegrity'); const r = await P.requestToken({ nonce, cloudProjectNumber: env.VITE_PLAY_CLOUD_PROJECT || '' }); if (r?.token) return { provider: 'play-integrity', platform, id, ...withPub, nonce, token: r.token }; }
    if (platform === 'ios' && cap?.isNativePlatform?.()) { const P = cap.Plugins?.AppAttest || cap.registerPlugin?.('AppAttest'); const r = await P.attest({ challenge: nonce }); if (r?.attestation) return { provider: 'app-attest', platform, id, ...withPub, nonce, keyId: r.keyId, token: r.attestation }; }
  } catch (e) { return { provider: 'none', platform, id, ...withPub, nonce, error: String(e?.message || e) }; }
  return { provider: 'none', platform, id, ...withPub, nonce };
}
