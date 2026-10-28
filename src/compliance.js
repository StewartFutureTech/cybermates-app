import { supabaseBackend, asUuid } from './kv-store.js';
// Legal/safety features (per /workspace/legal-review/cybermates-review.md, items 3–6). Not legal advice; wording marked
// PLACEHOLDER/UNVERIFIED must be replaced with counsel-approved / statutory text before launch.
export const MIN_AGE = 18;
export const SAFETY_CONTACT = 'safety@cybermates.example (PLACEHOLDER — publish a real monitored address before launch)';
// ---- 5. age gate ----
export function ageFromDob(dob, now = new Date()) {
  const d = new Date(dob + 'T00:00:00'); if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || isNaN(d)) return null;
  let a = now.getFullYear() - d.getFullYear(); const m = now.getMonth() - d.getMonth(); if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--; return a;
}
export function checkAge(dob, now) { const a = ageFromDob(dob, now); if (a == null || a > 120) return { ok: false, reason: 'invalid' }; return a >= MIN_AGE ? { ok: true } : { ok: false, reason: 'under-18' }; }
// We store only {adult, checkedAt} — never the DOB. Self-declared DOB is bypassable; see UK note.
export const recordAge = (vault, res, now = Date.now()) => vault.use(p => { p.age_gate = res.ok ? { adult: true, at: now } : { adult: false, minor: res.reason === 'under-18', at: now }; });
// The birth date itself is held ONLY in memory for this app session (never written to the vault/storage), so a sign-in
// right after the age gate can hand it to the server's submit_age_check() once; the server derives the band and drops it.
let sessionDob = null;
export const rememberDob = dob => { sessionDob = /^\d{4}-\d{2}-\d{2}$/.test(dob || '') ? dob : null; };
export const sessionBirthdate = () => sessionDob;
export const forgetDob = () => { sessionDob = null; };
export async function ageStatus(vault) { const p = await vault.read(); return p?.age_gate || null; }
// UK Online Safety Act: "highly effective age assurance" needed if sexual content is possible. Vendor integration TBD.
export function ukAgeAssurance(country) { return country === 'GB' ? { required: true, status: 'PLACEHOLDER: integrate Ofcom-compliant age-assurance vendor (e.g. facial age estimation / ID check) before UK launch' } : { required: false }; }
// ---- 5. state dating-safety notices (UNVERIFIED wording — copy statutory text: NJ 56:8-171, NY GBL 394-cc, IL 815 ILCS 518, TX Bus.&Com. ch.106) ----
export const BACKGROUND_CHECK_DISCLOSURE = 'Cybermates does NOT conduct criminal background checks or identity verification on its members.';
const SAFETY_TIPS = 'Safety tips: meet first in a public place, tell a friend where you are going, arrange your own transport, never send money or financial information, and report anyone who asks for it.';
export const DATING_SAFETY = {
  NJ: `New Jersey: ${BACKGROUND_CHECK_DISCLOSURE} ${SAFETY_TIPS} [PLACEHOLDER — replace with N.J.S.A. 56:8-171 required text]`,
  NY: `New York: ${BACKGROUND_CHECK_DISCLOSURE} ${SAFETY_TIPS} [PLACEHOLDER — replace with GBL §394-cc required text]`,
  IL: `Illinois: ${BACKGROUND_CHECK_DISCLOSURE} ${SAFETY_TIPS} [PLACEHOLDER — replace with 815 ILCS 518 required text]`,
  TX: `Texas: ${BACKGROUND_CHECK_DISCLOSURE} ${SAFETY_TIPS} [PLACEHOLDER — replace with Tex. Bus. & Com. Code ch. 106 required text]`,
};
const STATE_CODES = { 'new jersey': 'NJ', nj: 'NJ', 'new york': 'NY', ny: 'NY', illinois: 'IL', il: 'IL', texas: 'TX', tx: 'TX' };
// Region placeholder: profile region/state (user-entered) → notice. TODO: also use coarse IP/locale at signup.
export function safetyNoticeFor(p) { if ((p?.countryCode || '').toUpperCase() !== 'US') return null; const s = STATE_CODES[String(p.region || '').toLowerCase()]; return s ? DATING_SAFETY[s] : null; }
// ---- 3. sensitive fields ----
export const SENSITIVE_FIELDS = ['religion', 'orientation'];
// Countries criminalizing consensual same-sex acts — CONFIG, must be kept in sync with ILGA World database
// (https://database.ilga.org/criminalisation-consensual-same-sex-sexual-acts). Partial example list, UNVERIFIED.
export const CRIMINALIZING_COUNTRIES = ['AF', 'BN', 'IR', 'MR', 'NG', 'QA', 'SA', 'SO', 'YE', 'AE', 'UG', 'PK', 'MY', 'EG', 'KE', 'TZ', 'ZM', 'GH', 'SN', 'DZ', 'MA', 'TN', 'LY', 'SD', 'SS', 'ET', 'ER', 'CM', 'TD', 'GN', 'LR', 'SL', 'MW', 'TG', 'BI', 'KW', 'OM', 'LB', 'SY', 'IQ', 'BD', 'LK', 'MV', 'MM', 'TM', 'UZ', 'JM', 'GY', 'GD', 'LC', 'VC', 'DM', 'KN', 'TO', 'WS', 'TV', 'KI', 'SB', 'PG'];
export const orientationRisk = cc => CRIMINALIZING_COUNTRIES.includes(String(cc || '').toUpperCase());
export const ORIENTATION_WARNING = 'Warning: in your country same-sex relationships may be criminalized. Sharing your orientation could put you at risk if your phone is seized or others see your profile. We recommend leaving this field off.';
// Anything leaving the device (mesh, server, analytics, xAI) must pass through this.
export function stripSensitive(obj) { const o = { ...obj }; for (const k of SENSITIVE_FIELDS) delete o[k]; delete o.sensitiveOptIn; delete o.showSensitive; return o; }
// ---- 4. voice consent / AI disclosure ----
export const VOICE_DISCLOSURE_FREE = 'Voice setup uses your browser/phone speech recognition to turn your words into text. Cybermates never records or stores audio and never creates a voiceprint; only the text answers are kept on your phone. Note: your browser or OS vendor (e.g. Google, Apple) may process the audio under their own terms. You can always tap or type instead.';
export const VOICE_DISCLOSURE_GROK = 'You will be talking to an AI (Grok by xAI), not a person. Your voice is streamed to xAI for transcription and replies under xAI Zero Data Retention; audio is not stored by Cybermates or xAI, no voiceprint is created, and only the resulting text answers are saved on your phone. Do not share religion, orientation or health information. You can stop at any time and use the free typed setup instead.';
export const voiceConsent = (vault, kind, now = Date.now()) => vault.use(p => { p.voiceConsent ||= {}; p.voiceConsent[kind] = now; });
export async function hasVoiceConsent(vault, kind) { const p = await vault.read(); return !!p?.voiceConsent?.[kind]; }
// ---- 6. reports (minimal server table `reports`; evidence only what the reporter chooses) ----
export const REPORT_REASONS = ['harassment', 'spam/scam', 'fake profile', 'underage user', 'sexual content', 'threats/violence', 'illegal content (incl. child abuse)', 'other'];
export function buildReport({ reporter, reported, reason, excerpt = '' }) {
  if (!REPORT_REASONS.includes(reason)) throw new Error('bad reason');
  return { reporter_code: String(reporter).slice(0, 16), reported_code: String(reported).slice(0, 16), reason: reason.slice(0, 64), excerpt: String(excerpt).slice(0, 1000) || null };
}
// Reports go through the Supabase adapter: store.report() (RLS: reporter_id = auth.uid()). store = opts.store, else the backend
// registered via kv-store useSupabaseBackend(). No signed-in backend (or a failed call) -> queued on this device, sent later.
export async function submitReport(r, opts = {}) {
  const row = buildReport(r); const store = opts.store || supabaseBackend()?.store; if (r.evidenceRef) row.evidence_ref = String(r.evidenceRef).slice(0, 40); // v45: sealed evidence waits on the phone until this report has a server id
  const queue = () => { const q = JSON.parse(globalThis.localStorage?.getItem('cybermates:pending-reports') || '[]'); q.push(row); globalThis.localStorage?.setItem('cybermates:pending-reports', JSON.stringify(q.slice(-50))); };
  if (!store?.report) { queue(); return { ok: true, queued: true }; }
  let reported = asUuid(r.reported); if (!reported) { try { reported = await (await import('./signin.js')).resolveUid(r.reported); } catch {} }
  try { const res = await store.report({ reported, reason: row.reason, details: row.excerpt, evidence: { reporter_code: row.reporter_code, reported_code: row.reported_code } }); return { ok: true, id: res?.id, status: res?.status }; }
  catch (e) { queue(); return { ok: true, queued: true, error: e.code || e.message }; }
}
// ---- UI: birthday/age gate (shown before Terms). Adults and under-18s both continue; under-18 = MINOR mode: Dating and Roulette
// are removed entirely, all other features default ON (a parent can turn specific ones off with the PIN on this device), and
// minors are never connected with adults (voice, dating, roulette). Only {adult|minor, at} is kept — never the birth date.
export function ageGateScreen(vault) {
  return new Promise(res => {
    const d = document.createElement('div'); d.id = 'agegate'; d.className = 'cm-gate cm-onb'; d.style.cssText = 'position:fixed;inset:0;background:#000e;z-index:102;display:flex;align-items:center;justify-content:center;padding:16px';
    d.innerHTML = `<div class="card" style="max-width:420px"><h3>🎂 When's your birthday?</h3><p class="small">We only keep an “adult / under 18” flag on this phone — not your birth date. Under 18: Dating and Roulette are not available, and you're only ever matched with other under-18s for voice.</p>
      <input type="date" id="ag-dob" max="${new Date().toISOString().slice(0, 10)}"><p id="ag-err" class="small"></p>
      <p class="muted small">UK users: additional age assurance will be required before launch (placeholder).</p><button id="ag-go" class="primary">Continue</button></div>`;
    document.body.append(d); import('./rain-bg.js').then(m => m.attachRain(d)).catch(() => {});
    d.querySelector('#ag-go').onclick = async () => {
      const r = checkAge(d.querySelector('#ag-dob').value);
      if (r.reason === 'invalid') { d.querySelector('#ag-err').textContent = 'Please enter a valid date.'; return; }
      await recordAge(vault, r); rememberDob(d.querySelector('#ag-dob').value); d.remove(); res(r.ok ? 'adult' : 'minor');
    };
  });
}
export const voiceConsentDialog = (text) => confirm(text + '\n\nOK = I consent to voice setup. Cancel = type instead.');
// ---- two-key identity + attestation fine print (startup agreement; shown via src/terms.js TERMS) ----
export const IDENTITY_NOTICE = 'Two keys: (1) a PRIVATE encryption key, made from this device plus a random secret stored in the app, encrypts your profile and never leaves this phone — the app refuses to send it anywhere; (2) a shareable ID, made only from stable device identifiers (Android/iOS device ID, or a browser fingerprint on the web), is your network identity and is used for messaging, blocks and bans. The ID is never used for encryption. A new phone gives you a new ID; an Android factory reset may change it; on the web the ID is weaker and can change when your browser changes.';
export const ATTESTATION_NOTICE = 'On Android and iOS the app may ask Google Play Integrity or Apple App Attest to confirm it is a genuine app on a real device; the result is sent to our server with your ID. Devices that cannot be checked (including the web version) may be marked "unattested". Bans apply to your device ID.';
