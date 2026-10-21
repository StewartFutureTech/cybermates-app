import { SAFETY_CONTACT, IDENTITY_NOTICE, ATTESTATION_NOTICE } from './compliance.js';
// First-launch Terms / README acknowledgement. Accepted version + timestamp are stored in the encrypted vault;
// a new TERMS_VERSION re-prompts. The P2P consent dialog stays separate (shown when joining the peer network).
export const TERMS_VERSION = '2026-10-20.3';
export const DEVICE_BOUND_NOTICE = 'Boosts, starter packs and Grok voice minutes are tied to this device. If you transfer or re-sync to a new device, your profile, friends and settings move, but boost / starter / voice balances do NOT carry over: they reset to 0 on the new device and the old device is wiped. Subscriptions (Cybermates+) are tied to your account and are restored on the new device.';
export const TERMS = [
  'Cybermates is a beta app for meeting people for dating, friends and gaming. You must be 18+.',
  'Cybermates does NOT conduct criminal background checks or identity verification. Meet in public, never send money, and use Report / Block on any profile or chat. Safety contact: ' + SAFETY_CONTACT + '.',
  'Voice setup is optional and needs your separate consent: audio is transcribed and immediately discarded, never stored, and no voiceprint is created. The paid Grok voice option is an AI (xAI) and runs under xAI Zero Data Retention. Typed setup is always free.',
  'Religion and sexual orientation are optional, off by default, stay on this device only and are never sent to our servers, analytics or AI providers.',
  'Your profile is encrypted on this device with a key derived from this device and a random secret stored in the app. Changing device hardware, resetting the device, or clearing app/browser data may permanently lose access to the account on that device; you would need to re-sync or use "Transfer to new device" from a working device.',
  IDENTITY_NOTICE,
  ATTESTATION_NOTICE,
  DEVICE_BOUND_NOTICE,
  `Chats have no fixed deletion time. Today, phone-to-phone (mesh) chats are kept only in memory and are gone when you close the app; your phone also keeps an encrypted 7-day safety copy so you can report abuse, wiped after 7 days. Messages in the Chats tab are stored on your device; how long they are kept follows the chat-saving option below, and there is no fixed deletion time. Until saving based on that choice is live, this beta may clear older Chats-tab messages from your device; the other person's device keeps its own copy. Messages to someone who is offline wait on your phone, encrypted, for up to 7 days. Chat saving with three options both people agree on: "Keep forever", "Keep for a while, plus 7-day safety copy" and "Hide instantly, kept 7 days for safety reports". You can already pick one in a friend's chat; saving based on that choice is coming soon. Under-18 chats will always be kept, with no option. Burn mode is best-effort: the other person can still screenshot.`,
  'Blocking someone drops their messages; they are told they were blocked.',
  'Deleting the app does NOT cancel a subscription — use "Cancel subscription" in Advanced settings.',
  'Cybermates can disable the peer network for everyone, a user or a session at any time (kill switch). Joining the peer network needs a separate consent.',
  'Security checks on your phone can be bypassed by modified apps; payments are verified by our server.',
];
export async function needsTerms(vault) { const p = await vault.read(); return p?.terms?.version !== TERMS_VERSION; }
export const acceptTerms = (vault, now = Date.now()) => vault.use(p => { p.terms = { version: TERMS_VERSION, at: now }; });
// Device-bound items are stripped before a profile leaves the device (transfer/re-sync).
export function stripDeviceBound(p) {
  const out = structuredClone(p);
  if (out.wallet) out.wallet = { ...out.wallet, boosts: 0, extraStarters: 0, startersUsed: 0, voiceReceipts: [] };
  if (out.receipts) out.receipts = out.receipts.filter(r => String(r.sku).startsWith('plus'));
  delete out.wallets; return out;
}
export function termsScreen(vault) {
  return new Promise(res => {
    const d = document.createElement('div'); d.id = 'termsgate'; d.className = 'cm-gate cm-gate-scroll cm-onb';
    const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    d.innerHTML = `<div class="card tm-card"><h3>Welcome to Cybermates</h3><p class="muted small">Terms v${TERMS_VERSION} — please read before continuing.</p><ul>${TERMS.map(t => `<li class="small">${esc(t)}</li>`).join('')}</ul>
      <label class="small"><input type="checkbox" id="tm-ok"> I have read and accept these terms, including that boosts/starters are device-bound and don't transfer.</label>
      <div class="tm-actions"><button id="tm-yes" class="primary" disabled>Accept</button></div></div>`;
    document.body.append(d); import('./rain-bg.js').then(m => m.attachRain(d)).catch(() => {});
    d.querySelector('#tm-ok').onchange = e => d.querySelector('#tm-yes').disabled = !e.target.checked;
    d.querySelector('#tm-yes').onclick = async () => { await acceptTerms(vault); d.remove(); res(true); };
  });
}
