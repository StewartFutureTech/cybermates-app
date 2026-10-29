// Friends tab: "Create friend link" panel + friends search bar that also accepts a friend code. Logic: src/friend-link.js
import { mesh } from './app-mesh.js';
import * as FL from './friend-link.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const per = new WeakMap(); let ui = { minutes: FL.DEFAULT_EXPIRY_MIN, msg: '', q: '' }, rerender = null, timer = null;
export function linksFor(m = mesh(), me) { if (!m) return null; let L = per.get(m);
  if (!L) { L = new FriendLinks0(m, me); per.set(m, L); } L.api.me = me || L.api.me; return L; }
function FriendLinks0(m, me) { return new FL.FriendLinks({ node: m.node, me, requestFriend: c => m.requestFriend(c), isBlocked: c => m.blocklist?.isBlocked?.(c), isBanned: c => m.banlist?.isBanned?.(c),
  onEvent: (e, c) => { if (e === 'flink-joined') ui.msg = 'Code matched — you are now connected.'; if (e === 'flink-age-refused') ui.msg = 'That code can’t be used (age groups don’t match).'; soon(); } }).install(); }
const soon = () => { const a = globalThis.document?.activeElement; if (a && /INPUT|SELECT/.test(a.tagName) && a.value) return; rerender?.(); };
export function leave() { const L = per.get(mesh()); if (L?.host) L.close(); clearInterval(timer); timer = null; } // leaving the page burns the code
const fmt = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export function section(st) { const m = mesh(); if (!m) return `<div class="card glass fl-search" data-flconnecting><input type="search" placeholder="Search friends or type a friend code" disabled aria-label="Search friends or enter a friend code (connecting)"><p class="small muted">Connecting to the mesh… friend codes work as soon as you're connected.</p></div><div class="row gap fl-create"><button class="primary" disabled>🔗 Create friend link</button></div>`; /* v56: visible while connecting */ const L = linksFor(m, st.me), h = L.status(), name = c => esc(m.node.view?.(c)?.profile?.name || m.node.view?.(c)?.name || c);
  const search = `<div class="card glass fl-search"><input type="search" data-flq placeholder="Search friends or type a friend code" value="${esc(ui.q)}" autocomplete="off" autocapitalize="characters" aria-label="Search friends or enter a friend code">
    <button class="primary small" data-fljoin ${FL.looksLikeCode(ui.q) ? '' : 'hidden'}>Add with code</button>${ui.msg ? `<p class="small muted" data-flmsg>${esc(ui.msg)}</p>` : ''}</div>`;
  const panel = h ? `<div class="card glass fl-host" data-flhost><h3>🔗 Your friend link</h3><div class="fl-code" data-flcode aria-live="polite">${esc(h.code)}</div>
      <p class="small muted">Have them type this into their Friends search. Works for several people while this stays open. Expires in <b data-flleft>${fmt(h.exp - Date.now())}</b>. Closing burns it.</p>
      ${h.added.length ? `<p class="small">Added: ${h.added.map(name).join(', ')}</p>` : ''}<button class="ghost small" data-flclose>Close &amp; burn code</button></div>`
    : `<div class="row gap fl-create"><button class="primary" data-flcreate>🔗 Create friend link</button><label class="small muted">expires <select data-flexp>${FL.EXPIRY_CHOICES.map(n => `<option value="${n}" ${n === ui.minutes ? 'selected' : ''}>${n} min</option>`).join('')}</select></label></div>`;
  return search + panel; }
export function wire(root, st, render) { const m = mesh(); if (!m) return; const L = linksFor(m, st.me); rerender = () => st.tab === 'friends' && render();
  const q = root.querySelector('[data-flq]'), jb = root.querySelector('[data-fljoin]');
  const filter = () => { const t = q.value.trim().toLowerCase(); jb.hidden = !FL.looksLikeCode(q.value); root.querySelectorAll('[data-fopen]').forEach(r => { r.hidden = !!t && !FL.looksLikeCode(q.value) && !r.textContent.toLowerCase().includes(t); }); };
  if (q) { q.oninput = () => { ui.q = q.value; filter(); }; filter(); q.onkeydown = e => { if (e.key === 'Enter' && FL.looksLikeCode(q.value)) jb.click(); }; }
  if (jb) jb.onclick = async () => { const r = await L.join(q.value); ui.msg = r.ok ? 'Looking for that code on the mesh…' : 'That doesn’t look like a friend code.'; ui.q = ''; render(); };
  const sel = root.querySelector('[data-flexp]'); if (sel) sel.onchange = () => { ui.minutes = +sel.value; };
  const cb = root.querySelector('[data-flcreate]'); if (cb) cb.onclick = async () => { await L.open({ minutes: ui.minutes }); ui.msg = ''; render(); };
  const cl = root.querySelector('[data-flclose]'); if (cl) cl.onclick = () => { L.close(); render(); };
  clearInterval(timer); timer = null; if (L.host) timer = setInterval(() => { const left = root.querySelector('[data-flleft]'), h = L.status(); if (!h || !left?.isConnected) { clearInterval(timer); timer = null; if (!h) rerender?.(); return; } left.textContent = fmt(h.exp - Date.now()); }, 1000);
  globalThis.addEventListener?.('pagehide', leave, { once: true }); }
globalThis.__cmFlink = () => per.get(mesh()); // test hook (read-only inspection for E2E)
