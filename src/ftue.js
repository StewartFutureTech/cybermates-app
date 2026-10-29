// FIRST-TIME EXPERIENCE (FTUE) control + app build version.
//  - APP_BUILD: stamped at build time (vite define). Terms acceptance is bound to it, so EVERY new app version re-prompts.
//  - TESTING RESET FLAG: build-time CM_FTUE_RESET=1 (-> __FTUE_RESET__) or ?ftue=reset in the URL clears every one-time flow on
//    every load (birthday/age gate, terms ack, mood picker, account-loss warning + login counter, P2P consent, roulette notice)
//    so the full first-time experience replays. PRODUCTION FINALIZATION: build without CM_FTUE_RESET (see docs/TODO.md).
//  - Account-loss warning: shown on first use, then about every 10 logins (login counter stored on this device).
/* global __APP_BUILD__, __FTUE_RESET__ */
export const APP_BUILD = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 'dev';
export const FTUE_RESET_BUILD = typeof __FTUE_RESET__ !== 'undefined' && !!__FTUE_RESET__;
export const ftueResetActive = (search = globalThis.location?.search || '') => FTUE_RESET_BUILD || new URLSearchParams(search).get('ftue') === 'reset';
export const ONE_TIME_KEYS = ['cybermates:p2p-consent', 'cm.rl.notice', 'cm.logins', 'cm.lossWarnAt'];
// clears the device-side one-time flags; the vault parts (age_gate, terms) are cleared by the caller via clearVaultFtue
export function resetLocalFtue(ls = globalThis.localStorage) { for (const k of ONE_TIME_KEYS) try { ls?.removeItem(k); } catch {} }
export const clearVaultFtue = vault => vault.use(p => { delete p.age_gate; delete p.terms; });
// login counter + account-loss cadence
export const LOSS_EVERY = 10;
export function countLogin(ls = globalThis.localStorage) { let n = 0; try { n = (parseInt(ls.getItem('cm.logins'), 10) || 0) + 1; ls.setItem('cm.logins', String(n)); } catch { n = 1; } return n; }
export const shouldWarnLoss = n => n === 1 || (n - 1) % LOSS_EVERY === 0; // logins 1, 11, 21, …
export const ACCOUNT_LOSS_TEXT = 'Your Cybermates account lives only on this device — there is no password and no server copy. If you delete the app, clear its data, reset or lose this phone before linking another device, your account, friends and chats are gone for good and cannot be recovered. Link a second device in Profile → Devices to keep a backup.';
export function accountLossWarning() { return new Promise(res => { const d = document.createElement('div'); d.id = 'losswarn'; d.className = 'modal'; d.setAttribute('role', 'alertdialog'); d.setAttribute('aria-label', 'Account loss warning');
  d.innerHTML = `<div class="card"><h3>⚠️ Don't lose your account</h3><p class="small">${ACCOUNT_LOSS_TEXT}</p><div class="row gap"><button id="loss-ok" class="primary">Got it</button></div></div>`;
  document.body.append(d); d.querySelector('#loss-ok').onclick = () => { d.remove(); res(true); }; }); }
// "Read to me": speechSynthesis read-aloud with pause/resume + stop (starts inside the user's tap, as iOS requires)
export function readAloud(text, { synth = globalThis.speechSynthesis, U = globalThis.SpeechSynthesisUtterance } = {}) { if (!synth || !U) return null;
  synth.cancel(); const chunks = String(text).match(/[^.!?]+[.!?]*/g) || [text]; let i = 0, stopped = false; const st = { speaking: true, paused: false, onend: null };
  const next = () => { if (stopped || i >= chunks.length) { st.speaking = false; st.onend?.(); return; } const u = new U(chunks[i++].trim()); u.rate = 1; u.onend = next; u.onerror = next; synth.speak(u); }; next();
  return Object.assign(st, { pause() { synth.pause(); st.paused = true; }, resume() { synth.resume(); st.paused = false; }, stop() { stopped = true; synth.cancel(); st.speaking = false; st.paused = false; } }); }
