// ADMIN-BUILD ONLY (imported from main.js inside `if (ADMIN)` paths; absent from public bundles — see scripts/smoke-flavors.mjs).
// Kill / halt / ban panel. NO PRIVATE KEY EVER ENTERS THIS PAGE: there is no key input and no signing code here.
// The owner signs OFFLINE with `node scripts/mod.mjs halt|resume|strike|ban|unban ... --out msg.json` (key read from a
// passphrase-encrypted keyfile outside the repo) and pastes the resulting signed JSON. This page only verifies the
// signature against the build's PUBLIC key (VITE_KILL_PUBKEY) and delivers it (local bus or /api/kill, /api/ban).
import { verifySig, KILL_PUBKEY } from './killswitch.js';
import { BACKEND } from './store.js';
import { CATEGORIES, CSAM_REMINDER } from './modconst.js';
import { LEVELS } from './tiers.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Local backend: BroadcastChannel control (P2P layer) + app-mesh gossip {k:'ctl'} on the mesh bus. Supabase: server route,
// which flips server state FIRST (kill_switch record / blocklist) and only then broadcasts (api/_lib/mod.js).
export async function deliverControl(msg, backend = BACKEND, f = globalThis.fetch, extra = null) {
  if (backend === 'local') { if (msg.type === 'warn') { /* warnings: record only, never broadcast to the mesh */ } else { const bc = new BroadcastChannel('cybermates:control'); bc.postMessage(msg); bc.close(); const lb = new BroadcastChannel('cm-mesh'); lb.postMessage({ k: 'ctl', msg }); lb.close(); }
    if (extra?.code) { const bl = JSON.parse(localStorage.getItem('cybermates:local-blocklist') || '{}'); if (msg.type !== 'clear') bl[extra.code] = { category: extra.category, at: Date.now(), level: msg.level ?? 5, strikes: msg.strikes ?? 1, reason: msg.reason, suspended_until: msg.level === 4 ? msg.expires_at : null }; else if (extra.toLevel > 0 && bl[extra.code]) Object.assign(bl[extra.code], { level: extra.toLevel, suspended_until: null }); else delete bl[extra.code]; localStorage.setItem('cybermates:local-blocklist', JSON.stringify(bl)); }
    return { ok: true, via: 'BroadcastChannel + mesh gossip (local demo)' }; }
  const r = await f(extra ? '/api/ban' : '/api/kill', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ msg, ...(extra || {}) }) });
  return { ok: r.ok, via: extra ? '/api/ban' : '/api/kill', status: r.status, detail: await r.text().catch(() => '') };
}
// Current standing of a code (local demo: local blocklist; server: /api/ban status) -> used to auto-escalate.
// Parse + verify a pasted bundle: either a bare signed control message or {msg, code, category, reason, toLevel} from mod.mjs.
export async function verifyBundle(text, pub = KILL_PUBKEY) {
  let b; try { b = JSON.parse(text); } catch { throw new Error('Not valid JSON. Paste the file written by scripts/mod.mjs --out.'); }
  if (b && /seed|private|secret/i.test(Object.keys(b).join(' '))) throw new Error('That looks like key material. Never paste a private key here.');
  const msg = b?.msg || b; if (!msg?.sig) throw new Error('Unsigned message refused.');
  if (!pub || !(await verifySig(msg, pub))) throw new Error("Signature does not verify against this build's kill-switch public key (VITE_KILL_PUBKEY). Nothing sent.");
  const extra = msg.scope?.startsWith('user:') ? { code: b.code || msg.scope.slice(5), category: b.category || 'other', reason: b.reason || '', ...(b.toLevel != null ? { toLevel: b.toLevel } : {}) } : null;
  if (extra && msg.scope !== 'user:' + extra.code) throw new Error('Bundle code does not match the signed scope.');
  return { msg, extra };
}
export const describe = m => m.scope === 'all' ? (m.type === 'kill' ? 'NETWORK HALT' : 'NETWORK RESUME') : `${m.type === 'clear' ? 'unban/lower' : 'level ' + (m.level ?? 5) + ' (' + LEVELS[m.level ?? 5] + ')'} for ${m.scope}`;
export function adminKillPanel(el) {
  el.innerHTML = `<div class="card" data-admin="kill" style="border-color:#ff3355"><h3>🛑 Admin · Network halt / Warn / suspend / ban user</h3>
    <p class="muted small">No private key is ever entered here. Sign offline: <code>node scripts/mod.mjs halt --reason "…" --out halt.json</code> · <code>resume --out resume.json</code> · <code>strike &lt;ID&gt; --category … --reason "…" --out s.json</code> · <code>unban &lt;ID&gt; --out u.json</code>, then paste the file's JSON. Verified against public key <code>${esc((KILL_PUBKEY || 'NOT SET').slice(0, 12))}…</code>. Categories: ${CATEGORIES.map(esc).join(', ')}.</p>
    <textarea id="ak-signed" rows="4" spellcheck="false" autocomplete="off" placeholder="Signed message JSON from scripts/mod.mjs --out"></textarea>
    <div class="row gap"><button id="ak-send-signed" class="danger">Verify &amp; send signed message</button></div><div id="ab-csam" class="card warn small" hidden>⚠️ ${esc(CSAM_REMINDER)}</div><p id="ak-out" class="small"></p></div>`;
  const q = s => el.querySelector(s), out = t => q('#ak-out').textContent = t;
  q('#ak-send-signed').onclick = async () => { const ta = q('#ak-signed');
    try { const { msg, extra } = await verifyBundle(ta.value);
      if (msg.scope === 'all' && msg.type === 'kill' && prompt(`Signed NETWORK HALT (reason: "${msg.reason}"). Type HALT to deliver.`) !== 'HALT') return out('Cancelled.');
      if (!(msg.scope === 'all' && msg.type === 'kill') && !confirm(`Deliver signed ${describe(msg)}?`)) return out('Cancelled.');
      const r = await deliverControl(msg, BACKEND, globalThis.fetch, extra); ta.value = '';
      out(r.ok ? `✓ ${describe(msg)} sent via ${r.via}` : `✗ delivery failed (${r.status}) ${r.detail}`);
      if (r.ok && extra?.category === 'csam') q('#ab-csam').hidden = false; }
    catch (e) { out('✗ ' + e.message); } };
}
