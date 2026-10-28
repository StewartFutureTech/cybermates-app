// SIGN-IN (optional). Email OTP via src/backend (SupabaseAuth). On sign-in the backend is registered with
// kv-store useSupabaseBackend() so reports/profiles go to Supabase; with no sign-in (or offline) the app stays mesh-only
// and everything keeps working from this device. Each mesh identity (device ID code) is linked to its Supabase user id:
// locally (kv 'id-links') and server-side (public.mesh_links, RLS: own rows; resolve_mesh_code() for report targets).
// AGE SEPARATION: the local adult/minor flag stays authoritative on-device. If the account already carries the OTHER
// age band, sign-in is refused (signed out) — an account can never bridge bands. A NEW account (no server age_band yet)
// gets its band from submit_age_check(birthdate): the date comes from the on-device age gate (memory only, this session)
// or, if the device only kept its adult/minor flag, is asked once in the sign-in card. The server derives the band, never
// stores the date, and treats the first answer as final. The date is never stored on the device either.
import { kv, useSupabaseBackend, supabaseBackend, asUuid } from './kv-store.js';
const links = () => kv('id-links', { max: 50 });
let be = null, pending = null;
async function backend() { if (be) return be; const { createSupabaseBackend } = await import('./backend/supabase-backend.js'); return (be = await createSupabaseBackend()); }
export const signedIn = () => !!supabaseBackend();
export async function linkedUid(code) { return code ? (await links().get(code))?.uid || null : null; }
// mesh code -> Supabase uid for report targets: already a uuid, a local link, or the server lookup (signed in only).
export async function resolveUid(code) { const u = asUuid(code); if (u) return u; const l = await linkedUid(code); if (l) return l;
  const b = supabaseBackend(); if (!b?.client || !code) return null;
  try { const { data } = await b.client.rpc('resolve_mesh_code', { p_code: String(code).slice(0, 16) }); return asUuid(data); } catch { return null; } }
// localMinor: boolean from compliance.ageStatus(); codes: this device's mesh identity codes (current first).
// band the server will derive (>=18 adult, 13-17 minor); null for invalid / under 13
export function bandFromDob(dob, now = new Date()) { const d = new Date(dob + 'T00:00:00'); if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '') || isNaN(d) || d > now || d.getFullYear() < 1900) return null;
  let a = now.getFullYear() - d.getFullYear(); const m = now.getMonth() - d.getMonth(); if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--; return a >= 18 ? 'adult' : a >= 13 ? 'minor' : null; }
export async function activate(b, { localMinor = null, codes = [], birthdate = null } = {}) {
  const uid = await b.auth.userId(); if (!uid) return { ok: false, reason: 'no-session' };
  let prof = null; try { prof = await b.store.getProfile(uid); } catch {}
  let band = prof?.age_band || null; const mine = localMinor == null ? null : localMinor ? 'minor' : 'adult';
  const refuse = async reason => { try { await b.auth.signOut(); } catch {} useSupabaseBackend(null); return { ok: false, reason }; };
  if (band && mine && band !== mine) return refuse('age-band-mismatch');
  if (!band) { // new account: set the server band once from the birth date
    const dob = /^\d{4}-\d{2}-\d{2}$/.test(birthdate || '') ? birthdate : null;
    if (!dob) return { ok: false, reason: 'need-birthdate' }; // session kept; the card asks for the date once
    const dobBand = bandFromDob(dob); if (!dobBand) return { ok: false, reason: 'bad-birthdate' };
    if (mine && dobBand !== mine) return refuse('age-band-mismatch'); // must agree with this device's own age check
    try { band = await b.store.submitAgeCheck(dob); } catch (e) { return refuse(/under 13/i.test(e?.message || '') ? 'under-13' : 'age-check-failed'); }
    finally { try { (await import('./compliance.js')).forgetDob(); } catch {} }
    if (band !== 'adult' && band !== 'minor') return refuse('age-check-failed');
    if (mine && band !== mine) return refuse('age-band-mismatch');
  }
  useSupabaseBackend(b);
  if (!prof) { try { await b.store.upsertProfile({}); } catch {} } // profile row keyed by the Supabase user id
  for (const code of codes.filter(Boolean)) { await links().put({ id: code, uid, at: Date.now() });
    try { await b.client.from('mesh_links').upsert({ code, user_id: uid }, { onConflict: 'code', ignoreDuplicates: true }); } catch {} }
  await flushReports(b);
  return { ok: true, uid, band };
}
export async function sendCode(email) { pending = String(email || '').trim(); await (await backend()).auth.sendEmailOtp(pending); return { ok: true }; }
export async function verifyCode(code, opts = {}, email = pending) { const b = await backend(); await b.auth.verifyEmailOtp(email, String(code).trim()); return activate(b, opts); }
// boot: restore an existing session if there is one; any failure (offline, no config) => stay mesh-only.
export async function restore(opts = {}) { try { const b = await backend(); if (!(await b.auth.session())) return { ok: false, reason: 'no-session' }; return await activate(b, opts); } catch (e) { return { ok: false, reason: 'offline', error: e.message }; } }
// second step for a new account when the device had no birth date in memory
export async function finishAge(birthdate, opts = {}) { const b = await backend(); return activate(b, { ...opts, birthdate }); }
export async function signOut() { const b = supabaseBackend(); useSupabaseBackend(null); try { await b?.auth.signOut(); } catch {} return { ok: true }; }
// reports queued while signed out (compliance.submitReport) are sent now, with the reported code resolved to a uid.
async function flushReports(b) { const K = 'cybermates:pending-reports', ls = globalThis.localStorage; if (!ls) return 0;
  let q = []; try { q = JSON.parse(ls.getItem(K) || '[]'); } catch {} const left = []; let sent = 0;
  for (const r of q) { try { const row = await b.store.report({ reported: await resolveUid(r.reported_code), reason: r.reason, details: r.excerpt, evidence: { reporter_code: r.reporter_code, reported_code: r.reported_code } }); sent++;
      if (r.evidence_ref) await import('./evidence.js').then(E => E.linkPending(r.evidence_ref, row?.id, b.store)).catch(() => {}); } catch { left.push(r); } } // v45: attach sealed child-safety evidence
  ls.setItem(K, JSON.stringify(left)); await import('./evidence.js').then(E => E.flushPending(b.store)).catch(() => {}); return sent; }
// UI card (Advanced settings). getCtx() -> { localMinor, codes }.
export function signInPanel(el, getCtx) {
  const d = document.createElement('div'); d.id = 'signin'; el.append(d);
  const draw = () => { d.innerHTML = signedIn() ? `<h4>Account</h4><p class="small">✓ Signed in — reports and profile sync to your account.</p><button id="si-out">Sign out</button><p id="si-msg" class="small"></p>`
    : `<h4>Sign in (optional)</h4><p class="muted small">Without an account Cybermates works mesh-only on this device.</p><div class="row gap"><input id="si-email" type="email" placeholder="email" autocomplete="email"><button id="si-send">Send code</button></div><div class="row gap"><input id="si-code" inputmode="numeric" maxlength="6" placeholder="6-digit code" style="width:8em"><button id="si-go">Sign in</button></div><p id="si-msg" class="small"></p>`;
    const msg = t => d.querySelector('#si-msg').textContent = t, q = s => d.querySelector(s);
    if (q('#si-out')) q('#si-out').onclick = async () => { await signOut(); draw(); };
    if (q('#si-send')) q('#si-send').onclick = async () => { try { await sendCode(q('#si-email').value); msg('Code sent — check your email.'); } catch (e) { msg('Could not send code (' + e.message + '). The app keeps working offline.'); } };
    const result = r => { if (r.ok) return draw(); if (r.reason === 'need-birthdate') return askDob();
      msg({ 'age-band-mismatch': 'This account belongs to a different age group and cannot be used on this device.', 'under-13': 'Cybermates accounts need you to be 13 or older.', 'bad-birthdate': 'Please enter a valid date.', 'age-check-failed': 'Could not confirm your age group — signed out. Please try again.' }[r.reason] || 'Sign-in failed.'); };
    // asked once, only when the account has no age group yet and this device kept just its adult/minor flag
    const askDob = () => { if (q('#si-dob')) return; const w = document.createElement('div'); w.className = 'row gap'; w.id = 'si-dobrow';
      w.innerHTML = `<input id="si-dob" type="date" max="${new Date().toISOString().slice(0, 10)}"><button id="si-dobgo">Confirm</button>`; q('#si-msg').before(w);
      msg('One-time check: enter your birth date to set this account’s age group. Only the age group is saved — never the date.');
      q('#si-dobgo').onclick = async () => { try { const r = await finishAge(q('#si-dob').value, await getCtx()); if (r.reason !== 'bad-birthdate') w.remove(); result(r); } catch (e) { msg('Sign-in failed (' + e.message + ').'); } }; };
    if (q('#si-go')) q('#si-go').onclick = async () => { try { result(await verifyCode(q('#si-code').value, await getCtx())); } catch (e) { msg('Sign-in failed (' + e.message + ').'); } }; };
  draw(); return d;
}
// context from the vault (age flag) + running mesh identity; used by boot restore and the panel.
export async function deviceCtx() { const out = { localMinor: null, codes: [] };
  try { const C = await import('./compliance.js'), S = await import('./settings-ui.js'); const a = await C.ageStatus(await S.getVault()); if (a) out.localMinor = !!a.minor; out.birthdate = C.sessionBirthdate?.() || null; } catch {}
  try { const { mesh } = await import('./app-mesh.js'); const c = mesh()?.code; if (c) out.codes.push(c); } catch {}
  return out; }
