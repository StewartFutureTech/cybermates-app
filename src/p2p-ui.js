// UI glue for the P2P layer: consent dialog, peer-network panel (Dev tab), kill notice banner.
import { db, BACKEND, signal } from './store.js';
import { isMutual } from './handoff.js';
import { settingsPanel } from './settings-ui.js';
import { P2P, LocalTransport, SupabaseTransport, CONSENT_NOTICE, CONSENT_VERSION, getConsent, giveConsent, revokeConsent, getKillState } from './p2p.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let net = null, log = [], netUser = null;

export function killBanner() {
  const k = getKillState(); let el = document.getElementById('killnotice');
  if (!k) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'killnotice'; el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99;background:#b00020;color:#fff;padding:10px;text-align:center;font-size:14px'; document.body.prepend(el); }
  el.textContent = `⚠️ Peer network disabled by Cybermates (${k.scope}): ${k.reason || 'no reason given'}. Direct connections have been closed.`;
}
async function ensureNet(userId) {
  if (net && netUser === userId) return net;
  if (net) await net.teardown();
  const transport = BACKEND === 'supabase' ? new SupabaseTransport(await signal._client()) : new LocalTransport();
  const msgs = await db.listMessages(userId);
  net = new P2P({ transport, userId, isMutual: id => isMutual(msgs, userId, id), onKill: () => { killBanner(); refresh?.(); }, onEvent: (...e) => { log.unshift(e.join(' · ')); log = log.slice(0, 8); refresh?.(); } });
  netUser = userId; await net.start(); killBanner(); return net;
}
export async function bootP2P(userId) { if (userId) await ensureNet(userId).catch(e => console.warn('p2p', e)); killBanner(); }

function consentDialog(userId) {
  return new Promise(res => {
    const d = document.createElement('div'); d.id = 'consentgate'; d.className = 'cm-gate-scroll cm-onb'; d.style.zIndex = '100';
    d.innerHTML = `<div class="card tm-card" style="max-width:480px"><h3>Peer network consent</h3><p class="muted small">Version ${CONSENT_VERSION}</p><ul>${CONSENT_NOTICE.map(l => `<li class="small">${esc(l)}</li>`).join('')}</ul>
      <label class="small"><input type="checkbox" id="pc-ok"> I have read and agree to the peer network notice.</label>
      <div class="row gap tm-actions"><button id="pc-no">Not now</button><button id="pc-yes" disabled>Agree &amp; join</button></div></div>`;
    document.body.append(d); import('./rain-bg.js').then(m => m.attachRain(d)).catch(() => {});
    d.querySelector('#pc-ok').onchange = e => d.querySelector('#pc-yes').disabled = !e.target.checked;
    d.querySelector('#pc-no').onclick = () => { d.remove(); res(false); };
    d.querySelector('#pc-yes').onclick = async () => { const c = giveConsent(userId); d.remove();
      if (BACKEND === 'supabase') { try { const cl = await signal._client(); await cl.from('p2p_consents').upsert({ user_id: userId, version: c.version, consented_at: new Date(c.at).toISOString() }); } catch (e) { console.warn(e); } }
      res(true); };
  });
}
let refresh = null;
export async function p2pPanel(el, me) {
  refresh = () => p2pPanel(el, me);
  const n = await ensureNet(me.id).catch(() => null); const c = getConsent(), k = getKillState();
  el.innerHTML = `<div class="card"><h3>🔗 Peer network (beta)</h3>
    <p class="muted small">Backend: ${BACKEND}${BACKEND === 'local' ? ' (simulated via BroadcastChannel across tabs)' : ''} · Consent: ${c ? 'v' + esc(c.version) + ' on ' + new Date(c.at).toLocaleString() : 'not given'} · Status: ${k ? '<b>DISABLED by kill switch</b>' : n?.joined ? `joined, ${n.peers.size} peer(s)` : 'offline'}</p>
    <div class="row gap">${n?.joined ? '<button id="p2p-leave">Leave</button>' : `<button id="p2p-join" ${k ? 'disabled' : ''}>Join peer network</button>`}${c ? '<button id="p2p-revoke">Withdraw consent</button>' : ''}</div>
    ${import.meta.env.VITE_ADMIN === '1' ? `<details style="margin-top:8px"><summary class="small">Test: paste a signed control message (from scripts/kill-switch.mjs)</summary><textarea id="p2p-msg" rows="4" style="width:100%"></textarea><button id="p2p-sim">Simulate broadcast</button></details>` : ''}
    ${log.length ? `<pre class="small muted">${esc(log.join('\n'))}</pre>` : ''}</div>`;
  settingsPanel(el, me);
  const q = s => el.querySelector(s);
  q('#p2p-join') && (q('#p2p-join').onclick = async () => { if (!getConsent() && !(await consentDialog(me.id))) return; try { await n.join(); } catch (e) { alert(e.message); } refresh(); });
  q('#p2p-leave') && (q('#p2p-leave').onclick = async () => { await n.teardown(); refresh(); });
  q('#p2p-revoke') && (q('#p2p-revoke').onclick = async () => { await n?.teardown(); revokeConsent(); refresh(); });
  if (q('#p2p-sim')) q('#p2p-sim').onclick = async () => { let m; try { m = JSON.parse(q('#p2p-msg').value); } catch { return alert('Invalid JSON'); } if (BACKEND === 'local') { const bc = new BroadcastChannel('cybermates:control'); bc.postMessage(m); bc.close(); } await n.handleControl(m, 'broadcast'); killBanner(); refresh(); };
}
