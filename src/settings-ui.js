// Tucked-away settings: Transfer to new device (item 3) + subscription cancel (item 9).
import { Vault, IdbSecretStore, MemorySecretStore, localPersist, newUserCode } from './vault.js';
import { startSender, receive, rendezvous, newCode, bcBus } from './transfer.js';
import { cancelSubscription, CANCEL_NOTE } from './entitlements.js';
import { DEVICE_BOUND_NOTICE } from './terms.js';
import { SAFETY_CONTACT } from './compliance.js';
let vault;
const FRESH = () => ({ userCode: newUserCode(), wallet: {}, receipts: [], friends: {}, blocked: [], savedChats: {} });
const step = n => globalThis.__cmStep?.(n);
// Boot-resilient vault: IndexedDB unavailable -> memory store; stored CryptoKey/WebCrypto rejected -> nacl mode (vault.js);
// a blob that can no longer be decrypted (key lost with the IndexedDB failure) -> start a fresh local profile instead of a blank app.
async function openVault() {
  step('vault-open'); let store; try { store = globalThis.indexedDB ? new IdbSecretStore() : new MemorySecretStore(); } catch { store = new MemorySecretStore(); }
  const v = await new Vault({ store, persist: localPersist() }).load();
  step('vault-read');
  try { if (!v.blob) await v.init(FRESH()); else await v.read(); }
  catch (e) { console.warn('vault unreadable, starting fresh', e); globalThis.__cmBootNote?.('vault-reset', e); v.blob = null; v.keys = {}; await v.init(FRESH()); }
  return v;
}
export async function getVault() {
  if (!vault) vault = openVault().catch(e => { vault = null; throw Object.assign(e, { cmStep: e.cmStep || globalThis.__cmLastStep }); });
  return vault;
}
export function settingsPanel(el) {
  const d = document.createElement('details'); d.className = 'card'; d.style.marginTop = '8px';
  d.innerHTML = `<summary class="small">⚙️ Advanced settings</summary>
    <p class="small">🛡️ Safety &amp; legal contact: ${SAFETY_CONTACT}. Use Report on any profile or chat.</p><h4>Transfer to new device</h4><p class="muted small">On the OLD phone tap "Send". On the NEW phone tap "Receive" and type the 6-digit code (valid 10 minutes). The old phone erases its copy after the new one confirms.</p><p class="small warn">⚠️ ${DEVICE_BOUND_NOTICE}</p>
    <div class="row gap"><button id="xf-send">Send from this phone</button><input id="xf-code" inputmode="numeric" maxlength="6" placeholder="6-digit code" style="width:8em"><button id="xf-recv">Receive on this phone</button></div><p id="xf-out" class="small"></p>
    <h4>Subscription</h4><p class="muted small">${CANCEL_NOTE}</p><button id="sub-cancel">Cancel subscription</button>`;
  el.append(d); const q = s => d.querySelector(s), out = t => q('#xf-out').textContent = t;
  q('#xf-send').onclick = async () => { const v = await getVault(), code = newCode(); if ((await v.read())?.ban) return out('Transfers are disabled for banned accounts.');
    await startSender({ bus: bcBus('cm-xfer:' + await rendezvous(code)), code, getProfile: () => v.read(), wipe: async () => { await v.wipe(); localStorage.removeItem('cybermates:wallet:blob'); localStorage.removeItem('cybermates:wallet:ver'); vault = null; out('Transferred. This phone has been wiped.'); }, onEvent: (e, n) => e === 'bad-code' && out(`Wrong code entered (${n}/5)`) });
    out(`Your code: ${code} — enter it on the new phone within 10 minutes.`); };
  q('#xf-recv').onclick = async () => { const code = q('#xf-code').value.trim();
    try { await receive({ bus: bcBus('cm-xfer:' + await rendezvous(code)), code, importProfile: async p => { const v = await getVault(); await v.init(p); } }); out('Profile received and encrypted for this phone.'); }
    catch (e) { out('Transfer failed: ' + e.message); } };
  q('#sub-cancel').onclick = async () => { const v = await getVault(); const code = (await v.read()).userCode; try { const r = await cancelSubscription(code); out(r.error ? 'Payments not configured yet.' : 'Subscription will end at period end.'); } catch { out('Could not reach server.'); } };
}
