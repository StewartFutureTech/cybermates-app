// POST {provider, id, nonce, token, keyId?} -> {attested:boolean, provider, reason}
// STUB. Real verification needs credentials supplied ONLY via env vars (never committed, never bundled into the app):
//   Play Integrity: GOOGLE_CLOUD_PROJECT (or GOOGLE_CLOUD_PROJECT_NUMBER), PLAY_INTEGRITY_SA_JSON (service-account JSON with playintegrity scope),
//                   ANDROID_PACKAGE_NAME, ANDROID_CERT_SHA256 (expected signing-cert digest)
//   App Attest:     APPLE_TEAM_ID, IOS_BUNDLE_ID, APP_ATTEST_ENV ('production'|'development')
// Until those are set and the TODOs are implemented, every token is reported attested:false (reason 'not-configured'),
// so bootstrap flags the ID as unattested instead of refusing it.
// v43 ID binding hook (api/_lib/idbind.js isAttestedFor): a REAL success must return { attested: true, id: b.id, pub: b.pub, ... }
// (id + key the nonce was bound to); only then does the binding registry give the lighter PoW / instant rebind.
import { withGuards } from '../_lib/guard.js';
import { attestNonce } from '../../src/attest.js';
import { haltGuard } from '../_lib/mod.js';
// Reads credentials from env only. Returns which provider is ready (READY-TO-CONNECT once real values are set).
export function attestConfig(e = process.env) {
  let sa = null; try { sa = e.PLAY_INTEGRITY_SA_JSON ? JSON.parse(e.PLAY_INTEGRITY_SA_JSON) : null; } catch { sa = null; }
  const play = { project: e.GOOGLE_CLOUD_PROJECT || e.GOOGLE_CLOUD_PROJECT_NUMBER || null, saEmail: sa?.client_email || null, hasKey: !!sa?.private_key, pkg: e.ANDROID_PACKAGE_NAME || null, certSha256: e.ANDROID_CERT_SHA256 || null };
  const apple = { teamId: e.APPLE_TEAM_ID || null, bundleId: e.IOS_BUNDLE_ID || null, env: e.APP_ATTEST_ENV === 'development' ? 'development' : 'production' };
  return { play, apple, playReady: !!(play.project && play.saEmail && play.hasKey && play.pkg), appleReady: !!(apple.teamId && apple.bundleId), appId: apple.teamId && apple.bundleId ? apple.teamId + '.' + apple.bundleId : null };
}
export async function verifyAttestation(b, e = process.env, now = Date.now()) {
  if (!b || typeof b.id !== 'string' || typeof b.nonce !== 'string') return { attested: false, reason: 'malformed' };
  const pub = typeof b.pub === 'string' ? b.pub : null; // v43: nonce also binds the signing key when the client sent one
  const ok = [await attestNonce(b.id, String(Math.floor(now / 300e3)), pub), await attestNonce(b.id, String(Math.floor(now / 300e3) - 1), pub)];
  if (!ok.includes(b.nonce)) return { attested: false, provider: b.provider, reason: 'nonce-mismatch' }; // nonce must bind this ID
  if (b.provider === 'play-integrity') {
    if (!attestConfig(e).playReady) return { attested: false, provider: b.provider, reason: 'not-configured' };
    // TODO: POST https://playintegrity.googleapis.com/v1/{ANDROID_PACKAGE_NAME}:decodeIntegrityToken {integrity_token: b.token}
    //       with an OAuth token minted from PLAY_INTEGRITY_SA_JSON (scope https://www.googleapis.com/auth/playintegrity).
    //       Check: requestDetails.nonce === b.nonce, requestPackageName, appIntegrity.appRecognitionVerdict === 'PLAY_RECOGNIZED',
    //       appIntegrity.certificateSha256Digest includes ANDROID_CERT_SHA256, deviceIntegrity.deviceRecognitionVerdict
    //       includes 'MEETS_DEVICE_INTEGRITY', requestDetails.timestampMillis fresh.
    return { attested: false, provider: b.provider, reason: 'not-implemented' };
  }
  if (b.provider === 'app-attest') {
    if (!attestConfig(e).appleReady) return { attested: false, provider: b.provider, reason: 'not-configured' };
    // TODO: decode CBOR attestation object (fmt 'apple-appattest'); verify x5c chain to Apple App Attestation Root CA;
    //       nonce = SHA256(authData || SHA256(b.nonce)) matches cert extension 1.2.840.113635.100.8.2; SHA256(publicKey) === keyId;
    //       rpIdHash === SHA256(APPLE_TEAM_ID + '.' + IOS_BUNDLE_ID); aaguid 'appattest' (prod) / 'appattestdevelop'; counter 0.
    //       Store keyId->publicKey for later assertion checks.
    return { attested: false, provider: b.provider, reason: 'not-implemented' };
  }
  return { attested: false, provider: b.provider || 'none', reason: 'no-token' };
}
async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (await haltGuard(res)) return; // global halt: refuse
  res.json(await verifyAttestation(req.body || {}));
}

export default withGuards(handler, { name: 'attest', perMin: 20, perIdPerMin: 10 }); // rate limits / size cap / geo / halt (api/_lib/guard.js)
