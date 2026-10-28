import { APP_BUILD, readAloud } from './ftue.js';
import { SAFETY_CONTACT, IDENTITY_NOTICE, ATTESTATION_NOTICE } from './compliance.js';
import { AckGate, ackMinMs } from './login-seq.js'; // UX §2: forced scroll to the end + 20-30 s minimum (sized to the read-aloud length) before Accept
// First-launch Terms / README acknowledgement. Accepted version + timestamp are stored in the encrypted vault;
// a new TERMS_VERSION re-prompts. The P2P consent dialog stays separate (shown when joining the peer network).
export const TERMS_VERSION = '2026-10-28.1';
export const DEVICE_BOUND_NOTICE = 'Boosts, starter packs and Grok voice minutes are tied to this device. If you transfer or re-sync to a new device, your profile, friends and settings move, but boost / starter / voice balances do NOT carry over: they reset to 0 on the new device and the old device is wiped. Subscriptions (Cybermates+) are tied to your account and are restored on the new device.';
export const TERMS = [
  'Cybermates is a beta app for meeting people for dating, friends and gaming. Dating and Roulette are 18+ only. Under-18 accounts get friends, chat and games, are only ever matched with other minors, and parents can turn features off with a PIN on the device.',
  'Cybermates does NOT conduct criminal background checks or identity verification. Meet in public, never send money, and use Report / Block on any profile or chat. Safety contact: ' + SAFETY_CONTACT + '.',
  'Voice setup is optional and needs your separate consent: audio is transcribed and immediately discarded, never stored, and no voiceprint is created. The paid Grok voice option is an AI (xAI) and runs under xAI Zero Data Retention. Typed setup is always free.',
  'Religion and sexual orientation are optional, off by default, stay on this device only and are never sent to our servers, analytics or AI providers.',
  'Your profile is encrypted on this device with a key derived from this device and a random secret stored in the app. Changing device hardware, resetting the device, or clearing app/browser data may permanently lose access to the account on that device; you would need to re-sync or use "Transfer to new device" from a working device.',
  IDENTITY_NOTICE,
  ATTESTATION_NOTICE,
  DEVICE_BOUND_NOTICE,
  `Chats have no fixed deletion time. Chat saving has three options both people agree on: "Keep forever", "Keep for a while, plus 7-day safety copy" and "Hide instantly, kept 7 days for safety reports". When you both pick the same option, this phone follows it for the visible chat history (forever = keep; for a while ≈ about 30 days on screen; hide instantly = hide from the chat view right away). Every option also keeps an encrypted 7-day safety copy of recent messages on this phone so you can report abuse; that copy is wiped after 7 days. Under-18 chats will always be kept, with no option. Messages to someone who is offline wait on your phone, encrypted, for up to 7 days. Burn mode is best-effort: the other person can still screenshot.`,
  'Blocking someone drops their messages; they are told they were blocked.',
  'Deleting the app does NOT cancel a subscription — use "Cancel subscription" in Advanced settings.',
  'Cybermates can disable the peer network for everyone, a user or a session at any time (kill switch). Joining the peer network needs a separate consent.',
  'Security checks on your phone can be bypassed by modified apps; payments are verified by our server.',
];
// acceptance is bound to the terms text version AND the app build: every new app version re-prompts before JACK IN
export const ACCEPT_ID = `${TERMS_VERSION}@${APP_BUILD}`;
export async function needsTerms(vault) { const p = await vault.read(); return p?.terms?.version !== ACCEPT_ID; }
export const acceptTerms = (vault, now = Date.now()) => vault.use(p => { p.terms = { version: ACCEPT_ID, terms: TERMS_VERSION, build: APP_BUILD, at: now }; });
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
    d.innerHTML = `<div class="card tm-card"><div class="row gap tm-read"><button id="tm-read" aria-label="Read the terms aloud">🔊 Read to me</button><button id="tm-pause" hidden>⏸ Pause</button><button id="tm-stop" hidden>⏹ Stop</button></div><h3>Welcome to Cybermates</h3><p class="muted small">Terms v${TERMS_VERSION} · app ${APP_BUILD} — please read before continuing. New app versions ask again.</p><div class="tm-scroll" id="tm-scroll" tabindex="0" aria-label="Terms text, scroll to the end"><ul>${TERMS.map(t => `<li class="small">${esc(t)}</li>`).join('')}</ul><p class="small muted" id="tm-end">— end of terms —</p></div>
      <label class="small"><input type="checkbox" id="tm-ok"> I have read and accept these terms, including that boosts/starters are device-bound and don't transfer.</label>
      <div class="tm-actions"><ol class="tm-steps small" id="tm-steps" aria-label="Before you can accept"></ol><div class="tm-cd" id="tm-cd" role="timer" aria-label="Seconds left before Accept"><span id="tm-cd-n"></span><small>s</small></div><span class="small muted" id="tm-why" aria-live="polite"></span><button id="tm-yes" class="primary" disabled>Accept</button></div></div>`;
    document.body.append(d);
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) d.classList.add('tm-rm'); // reduced motion: static countdown ring; rain draws one still frame
    import('./rain-bg.js').then(m => m.attachRain(d)).catch(() => {});
    const btR = d.querySelector('#tm-read'), btP = d.querySelector('#tm-pause'), btS = d.querySelector('#tm-stop'); let rd = null;
    const ui = on => { btP.hidden = btS.hidden = !on; btR.hidden = on; btP.textContent = '⏸ Pause'; };
    btR.onclick = () => { const text = [...d.querySelectorAll('.tm-card h3, .tm-card li, .tm-card label')].map(e => e.textContent.trim()).join('. '); rd = readAloud(text); if (!rd) { btR.textContent = '🔇 Read-aloud not supported here'; btR.disabled = true; return; } rd.onend = () => ui(false); ui(true); };
    btP.onclick = () => { if (!rd) return; if (rd.paused) { rd.resume(); btP.textContent = '⏸ Pause'; } else { rd.pause(); btP.textContent = '▶ Resume'; } };
    btS.onclick = () => { rd?.stop(); ui(false); };
    const fullText = [...d.querySelectorAll('.tm-card li')].map(e => e.textContent).join(' ');
    const gate = new AckGate({ minMs: ackMinMs(fullText) }), yes = d.querySelector('#tm-yes'), why = d.querySelector('#tm-why'), sc = d.querySelector('#tm-scroll');
    const stepsEl = d.querySelector('#tm-steps'), cd = d.querySelector('#tm-cd'), cdN = d.querySelector('#tm-cd-n'); let lastSteps = '';
    const upd = () => { const ok = gate.canAccept(), left = gate.secs(); yes.disabled = !ok; why.textContent = gate.reason();
      yes.textContent = left ? `Accept (${left}s)` : 'Accept'; cdN.textContent = left; cd.hidden = !left; cd.style.setProperty('--p', String(gate.minMs ? left * 1000 / gate.minMs : 0));
      const html = gate.steps().map(x => `<li class="${x.done ? 'done' : ''}" data-step="${x.k}">${x.done ? '✓' : '○'} ${x.label}</li>`).join(''); if (html !== lastSteps) stepsEl.innerHTML = lastSteps = html;
      if (ok) clearInterval(iv); };
    const iv = setInterval(() => { if (!d.isConnected) return clearInterval(iv); upd(); }, 250);
    sc.addEventListener('scroll', () => { gate.onScroll(sc); upd(); }, { passive: true }); gate.onScroll(sc);
    d.querySelector('#tm-ok').onchange = e => { gate.checked = e.target.checked; upd(); }; upd();
    d.querySelector('#tm-yes').onclick = async () => { if (!gate.canAccept()) return upd(); rd?.stop(); await acceptTerms(vault); d.remove(); res(true); };
  });
}
