// v57 PROFILE REWORK (David, 2026-10-29). Pure helpers + small renderers used by main.js profile()/onboarding fieldHTML.
//  - typed lists: no preset pick-lists; each added entry is a selected (green) chip with ✕; default blank.
//  - single-choice lists get "Add something else" (text + Add) that appends to the list; no "More…" expanders.
//  - category sections (Anime / Sports / Esports / Outdoor) appear only when typed interests trigger them.
//  - every category: "Only after match" visibility + Importance (not for gamer tags / handles / links).
//  - location: GPS button kept + City / State / Country dropdowns; Discord invites (+ Add, ✕); Twitch + Kick links.
import { CITIES } from './data.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
export function addItem(list, s) { const v = clean(s); const L = [...(list || [])]; if (v && !L.some(x => x.toLowerCase() === v.toLowerCase())) L.push(v); return L; }
export const removeItem = (list, s) => (list || []).filter(x => x !== s);
// ---- birthday
export function ageFrom(dob, now = new Date()) { if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '')) return null; const d = new Date(dob + 'T00:00:00'); if (isNaN(d) || d > now) return null;
  let a = now.getFullYear() - d.getFullYear(); const m = now.getMonth() - d.getMonth(); if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--; return a; }
// ---- categories: keyword triggers on typed interests; items that clearly belong to a category move there
export const CATS = {
  anime: { label: '🍥 Anime', trig: /\banime|manga\b/i, items: [] },
  sports: { label: '🏈 Sports', trig: /\bsports?\b/i, items: ['football', 'soccer', 'baseball', 'basketball', 'hockey', 'tennis', 'golf', 'mma', 'boxing', 'racing', 'nfl', 'nba', 'mlb', 'nhl'] },
  esports: { label: '🎮 Esports', trig: /\besports?\b|e-sports?/i, items: ['lcs', 'lec', 'vct', 'cdl', 'rlcs', 'the international', 'worlds'] },
  outdoor: { label: '🏕️ Outdoor', trig: /\boutdoors?\b|fishing|camping|hiking|hunting|kayak/i, items: ['fishing', 'camping', 'hiking', 'hunting', 'kayaking', 'climbing', 'backpacking', 'boating'] },
};
export const catKey = c => 'cat_' + c; // profile field: p.cat_anime etc. (anime keeps legacy p.anime)
export const catField = c => (c === 'anime' ? 'anime' : catKey(c));
export function activeCats(p) { const words = [...(p.interests || []), ...Object.keys(CATS).flatMap(c => p[catField(c)] || [])].join(' | ');
  return Object.keys(CATS).filter(c => CATS[c].trig.test(words) || (p[catField(c)] || []).length > 0); }
// route typed interests: specific items (e.g. "fishing") go to their category list; trigger words stay in interests
export function routeInterests(p) { for (const c of Object.keys(CATS)) { const k = catField(c), its = CATS[c].items; if (!its.length) continue;
    const move = (p.interests || []).filter(x => its.includes(x.toLowerCase())); if (!move.length) continue;
    p.interests = p.interests.filter(x => !move.includes(x)); let L = p[k] || []; for (const m of move) L = addItem(L, m); p[k] = L; }
  return p; }
// ---- renderers
export function chipList(id, vals, ph = 'Type and tap Add') {
  return `<div class="tl" id="${id}" data-tl><div class="chips big tl-chips">${(vals || []).map(x => `<span class="chip on tl-chip" data-tlv="${esc(x)}"><span>${esc(x)}</span><button type="button" class="tl-x" data-tlx aria-label="Remove ${esc(x)}">✕</button></span>`).join('')}</div>
    <div class="row gap"><input data-tlin placeholder="${esc(ph)}" aria-label="${esc(ph)}" maxlength="60"><button type="button" data-tladd>Add</button></div></div>`; }
export const readChipList = el => [...(el?.querySelectorAll('[data-tlv]') || [])].map(e => e.dataset.tlv);
export function oneWithAdd(id, opts, extra, v) { const all = [...opts, ...(extra || []).filter(x => !opts.includes(x))]; if (v && !all.includes(v)) all.push(v);
  return `<div class="chips big" id="${id}" data-onex>${all.map(o => `<label class="chip"><input type="radio" name="${id}" value="${esc(o)}" ${o === v ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div>
    <div class="row gap"><input data-oxin placeholder="Add something else" aria-label="Add something else" maxlength="40"><button type="button" data-oxadd="${id}">Add</button></div>`; }
export function wireLists(root) {
  root.querySelectorAll('[data-tl]').forEach(w => { const inp = w.querySelector('[data-tlin]'), box = w.querySelector('.tl-chips');
    const add = () => { for (const part of inp.value.split(',')) { const v = clean(part); if (!v || readChipList(w).some(x => x.toLowerCase() === v.toLowerCase())) continue;
        box.insertAdjacentHTML('beforeend', `<span class="chip on tl-chip" data-tlv="${esc(v)}"><span>${esc(v)}</span><button type="button" class="tl-x" data-tlx aria-label="Remove ${esc(v)}">✕</button></span>`); }
      inp.value = ''; w.dispatchEvent(new Event('tl-change', { bubbles: true })); };
    w.querySelector('[data-tladd]').onclick = add; inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
    box.onclick = e => { const x = e.target.closest('[data-tlx]'); if (!x) return; x.closest('[data-tlv]').remove(); w.dispatchEvent(new Event('tl-change', { bubbles: true })); }; });
  root.querySelectorAll('[data-oxadd]').forEach(b => { const box = root.querySelector('#' + b.dataset.oxadd), inp = b.parentElement.querySelector('[data-oxin]');
    const add = () => { const v = clean(inp.value).slice(0, 40); if (!v) return; let r = [...box.querySelectorAll('input')].find(i => i.value.toLowerCase() === v.toLowerCase());
      if (!r) { box.insertAdjacentHTML('beforeend', `<label class="chip"><input type="radio" name="${box.id}" value="${esc(v)}"><span>${esc(v)}</span></label>`); r = box.lastElementChild.querySelector('input'); }
      r.checked = true; inp.value = ''; };
    b.onclick = add; inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }; });
}
// visibility + importance per category (stored in p.reveal['field.<k>'] and p.importance[k])
export const NO_IMPORTANCE = new Set(['name', 'gamertags', 'socials', 'photos', 'bio', 'discordInvites', 'streams', 'loc', 'birthday']);
const IMP = [['dontcare', "I don't care"], ['low', 'A little'], ['mid', 'Somewhat'], ['high', 'Very'], ['make', 'Make or break']];
export function catControls(k, p) { const vis = p.reveal?.['field.' + k] || 'public';
  return `<div class="row gap small cat-ctl" data-catctl="${esc(k)}"><label><input type="checkbox" data-aftermatch="${esc(k)}" ${vis === 'match' ? 'checked' : ''} style="width:auto"> Only after match</label>${NO_IMPORTANCE.has(k) ? '' : `<label>Importance <select data-cimp="${esc(k)}">${IMP.map(([v, l]) => `<option value="${v}" ${(p.importance?.[k] ?? 'mid') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`}</div>`; }
export function readCatControls(root, p) { p.reveal ||= {}; p.importance ||= {};
  root.querySelectorAll('[data-aftermatch]').forEach(c => { p.reveal['field.' + c.dataset.aftermatch] = c.checked ? 'match' : 'public'; });
  root.querySelectorAll('[data-cimp]').forEach(s => { p.importance[s.dataset.cimp] = s.value; }); }
// location dropdowns (fallback / manual edit); options from the bundled city table + current values
export function locationHTML(id, v) { const countries = [...new Map(CITIES.map(c => [c[3], c[2]])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const cc = v?.countryCode || ''; const regions = [...new Set(CITIES.filter(c => !cc || c[3] === cc).map(c => c[1]))].sort(); if (v?.region && !regions.includes(v.region)) regions.unshift(v.region);
  const cities = [...new Set(CITIES.filter(c => (!cc || c[3] === cc) && (!v?.region || c[1] === v.region)).map(c => c[0]))].sort(); if (v?.city && !cities.includes(v.city)) cities.unshift(v.city);
  const sel = (k, label, opts, cur) => `<label class="small">${label}<select data-l="${k}" aria-label="${label}"><option value="">—</option>${opts.map(([val, txt]) => `<option value="${esc(val)}" ${val === cur ? 'selected' : ''}>${esc(txt)}</option>`).join('')}</select></label>`;
  if (cc && !countries.some(([c]) => c === cc)) countries.unshift([cc, cc]);
  return `<div id="${id}" data-loc><button type="button" class="primary wide" data-gps>📍 Use my location</button><p class="muted small center">or pick it</p>
    <div class="row gap wrap">${sel('countryCode', 'Country', countries, cc)}${sel('region', 'State / region', regions.map(r => [r, r]), v?.region || '')}${sel('city', 'City', cities.map(c => [c, c]), v?.city || '')}</div></div>`; }
export function wireLocation(root, onPick) { root.querySelectorAll('[data-loc] select[data-l]').forEach(s => s.onchange = () => { const w = s.closest('[data-loc]'), o = {}; w.querySelectorAll('[data-l]').forEach(i => o[i.dataset.l] = i.value);
  if (s.dataset.l === 'countryCode') { o.region = ''; o.city = ''; } if (s.dataset.l === 'region') o.city = '';
  if (s.dataset.l === 'city' && o.city) { const c = CITIES.find(c => c[0] === o.city && (!o.countryCode || c[3] === o.countryCode)); if (c) { o.region = c[1]; o.countryCode = c[3]; } }
  onPick(o); }); }
// Discord invites + Twitch / Kick
export const normInvite = s => { const v = clean(s).replace(/^https?:\/\//i, ''); const m = v.match(/^(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)?([A-Za-z0-9-]{2,32})$/); return m ? 'discord.gg/' + m[1] : null; };
export const normChannel = (site, s) => { const v = clean(s).replace(/^https?:\/\//i, '').replace(/^www\./i, ''); const m = v.match(new RegExp('^(?:' + site + '\\.(?:tv|com)/)?@?([A-Za-z0-9_]{2,25})/?$', 'i')); return m ? (site === 'twitch' ? 'twitch.tv/' : 'kick.com/') + m[1] : null; };
export function linksHTML(p) { const inv = p.discordInvites || (p.discordInvite ? [p.discordInvite] : []);
  return `<div class="card" id="pf-links"><h4>💬 Discord servers</h4>${chipList('f_discordInvites', inv, 'Server invite (discord.gg/abc123)').replace('data-tladd>Add', 'data-tladd>＋ Add')}
    <h4>📺 Live channels</h4><label class="small">Twitch <input id="f_twitch" placeholder="twitch.tv/yourchannel" value="${esc(p.streams?.twitch || '')}"></label><label class="small">Kick <input id="f_kick" placeholder="kick.com/yourchannel" value="${esc(p.streams?.kick || '')}"></label>
    ${catControls('discordInvites', p)}</div>`; }
export function readLinks(root, p) { const raw = readChipList(root.querySelector('#f_discordInvites')); const inv = [...new Set(raw.map(normInvite).filter(Boolean))];
  p.discordInvites = inv; p.discordInvite = inv[0] || ''; const tw = root.querySelector('#f_twitch')?.value || '', kk = root.querySelector('#f_kick')?.value || '';
  p.streams = { twitch: tw.trim() ? normChannel('twitch', tw) || '' : '', kick: kk.trim() ? normChannel('kick', kk) || '' : '' };
  return { badInvites: raw.length - inv.length, badStreams: (tw.trim() && !p.streams.twitch ? 1 : 0) + (kk.trim() && !p.streams.kick ? 1 : 0) }; }
