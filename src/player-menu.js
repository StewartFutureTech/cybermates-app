// In-game player menu: tap a REAL player's name in any game's player list / scoreboard -> Add friend / Report / Block.
// Hidden for AI seats (p.bot / s.ai / AI-* codes) and yourself. Respects blocks and age band; Add friend reuses the
// existing mesh connection-request flow (m.requestFriend), so all mesh-side guards (minor dating, blocks) still apply.
import { band } from './arcade/proximity.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const isAI = p => !p || !!(p.bot || p.ai) || /^AI-/.test(String(p.code || ''));
// attributes for a name element; empty for AI / self, so those names are plain text
export function nameAttrs(p, myCode) { if (isAI(p) || !p.code || p.code === myCode) return ''; return ` class="pname" role="button" tabindex="0" data-pcode="${esc(p.code)}" data-pname="${esc(p.name || p.code)}" data-pband="${band(p)}"`; }
// pure: which actions to show
export function menuActions({ target, me, friends = new Set(), pendingOut = new Set(), blocked = new Set() }) {
  if (isAI(target) || !target?.code || target.code === me?.code) return [];
  if (blocked.has(target.code)) return [];
  const same = (target.band || band(target)) === band(me); const a = [];
  if (friends.has(target.code)) a.push({ id: 'friend', label: '👥 Friends', disabled: true });
  else if (!same) {} // never connect across age bands
  else a.push(pendingOut.has(target.code) ? { id: 'add', label: 'Request sent', disabled: true } : { id: 'add', label: '➕ Add friend' });
  a.push({ id: 'report', label: '⚑ Report' }, { id: 'block', label: '⛔ Block' }); return a;
}
let ctx = { me: null, mesh: () => null, report: null };
export function close() { document.getElementById('pmenu')?.remove(); }
export function open(el) {
  close(); const m = ctx.mesh(), node = m?.node; const target = { code: el.dataset.pcode, name: el.dataset.pname, band: el.dataset.pband };
  const acts = menuActions({ target, me: { ...(ctx.getMe?.() || ctx.me || {}), code: m?.code }, friends: new Set(node?.friends?.keys?.() || []), pendingOut: node?.pendingOut || new Set(), blocked: new Set([...(node?.blocked || []), ...(m?.blocklist?.isBlocked?.(target.code) ? [target.code] : [])]) });
  if (!acts.length) return;
  const d = document.createElement('div'); d.id = 'pmenu'; d.className = 'pmenu'; d.setAttribute('role', 'menu');
  d.innerHTML = `<b class="small">${esc(target.name)}</b>${acts.map(a => `<button role="menuitem" data-pact="${a.id}" class="small" ${a.disabled ? 'disabled' : ''}>${a.label}</button>`).join('')}<p class="small muted" id="pm-res"></p>`;
  document.body.appendChild(d); const r = el.getBoundingClientRect(); d.style.left = Math.max(8, Math.min(innerWidth - d.offsetWidth - 8, r.left)) + 'px'; d.style.top = Math.min(innerHeight - d.offsetHeight - 8, r.bottom + 4) + 'px';
  const res = t => { d.querySelector('#pm-res').textContent = t; };
  d.onclick = async e => { const b = e.target.closest('[data-pact]'); if (!b || b.disabled) return; e.stopPropagation(); const id = b.dataset.pact;
    if (id === 'add') { b.disabled = true; b.textContent = 'Request sent'; const out = await m?.requestFriend?.(target.code); if (out && out.ok === false) res(out.message || out.reason); else res('Connection request sent.'); }
    if (id === 'report') { close(); await ctx.report?.(m, target.code); }
    if (id === 'block') { if (confirm(`Block ${target.name}?`)) { await m?.block?.(target.code); close(); document.dispatchEvent(new CustomEvent('cm-blocked', { detail: target.code })); } } };
}
export function install(o) { ctx = { ...ctx, ...o }; if (globalThis.__cmPm) return; globalThis.__cmPm = true;
  document.addEventListener('click', e => { const el = e.target.closest?.('[data-pcode]'); if (el) { e.stopPropagation(); open(el); return; } if (!e.target.closest?.('#pmenu')) close(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); const el = e.target.closest?.('[data-pcode]'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(el); } }); }
export const setMe = me => { ctx.me = me; };
