import { logoHTML, markSVG } from './logo.js';
import './game-noselect.js'; // cm-v35: no long-press select/callout inside games
import { navIcon } from './nav-icons.js';
import * as C0 from './compliance.js';
import { checkDevice, setSimulateEmulator, isSimulatingEmulator } from './device-gate.js';
import './style.css';
import './neon.css'; // neon grid v2 (glass, theme-colored edges, animated grid; reduced-motion aware)
import { demoLastSeen, makeThumb } from './thumb.js';
const withThumb = async p => { try { p.thumb = p.photos?.[0] ? await makeThumb(p.photos[0]) : ''; } catch { p.thumb = ''; } return p; }; // stub thumb for presence
import { recency } from './mesh.js';
import * as D from './data.js';
import { db, DAILY_STARTERS, dailyLimit } from './store.js';
import { evaluate, prefFor, KM_PER_MI } from './match.js';
import { visibleAccounts, isMutual, linkFor, inviteUrl, HOW_TO, cardText, copy } from './handoff.js';
import { p2pPanel, bootP2P } from './p2p-ui.js';
import { startMesh, mesh } from './app-mesh.js';
import * as DISC from './discovery.js';
import * as MU from './mesh-ui.js';
import * as IU from './inbox-ui.js';
import * as FLUI from './friend-link-ui.js';
import * as SHOP from './shop-ui.js';
import { jackIn } from './loader.js';
import { killState, blockedReason, noticeBanner } from './ban.js';
import { helpView } from './help.js';
import { adminKillPanel } from './admin.js';
import { arcadeView, stopArcade } from './arcade-ui.js';
import { rouletteView } from './roulette-ui.js';
import { visibleFor as rouletteVisible } from './roulette.js';
import * as T from './theme.js';
import * as FS from './fullscreen.js';
import * as UX from './ux-ui.js';
import * as PH from './photos.js';
import * as MV from './match-v2.js';
import * as DV from './discover-view.js';
import { profileComplete, missingProfile, ensureDeviceKey } from './login-seq.js';
import * as PV from './profile-v57.js'; // v57 profile rework
if (typeof document !== 'undefined' && document.body) FS.install(); else if (typeof document !== 'undefined') addEventListener('DOMContentLoaded', () => FS.install());
T.applyLook(); T.initTypingGlow(); import('./fx-pointer.js').then(F => F.initPointerFx()); import('./sfx.js').then(S => S.initAudioUnlock()); import('./lasers.js').then(L => L.initLasers());
// Dev/testing: ?as=<seedId> makes THIS TAB act as that demo user (not persisted), so several tabs can be different people.
// ADMIN is a build-time constant (VITE_ADMIN=1 via `npm run build:admin`); public builds tree-shake every ADMIN branch.
const ADMIN = import.meta.env.VITE_ADMIN === '1';
const AS = ADMIN ? new URLSearchParams(location.search).get('as') : null;
if (ADMIN) globalThis.__cmDev = { db }; // admin/dev builds only: scripts/sim-users.mjs uses it to create TEST· bot profiles
if (ADMIN && AS) { db.getCurrentUserId = async () => AS; db.setCurrentUserId = async () => {}; }
const meshRefresh = () => { if (document.querySelector('.dv-loading, .dv-profile')) return; /* tap-to-open profile is showing: don't wipe it */ const a = document.activeElement; if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.value) return; if (['discover', 'inbox', 'profile', 'dev'].includes(st.tab)) render(); };
import { speak, listen, canListen, canSpeak, parseList, parseOne, parseNumber, parseHandles, crossPick } from './voice.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const st = { tab: 'discover', mode: 'friends', chatWith: null, step: 0, draft: null, me: null };
import('./player-menu.js').then(PM => PM.install({ mesh, getMe: () => st.me, report: (m, c) => MU.reportFlow(m, c) }));

// ---------- field definitions (used by voice onboarding AND manual editor) ----------
const dating = p => (p.lookingFor || []).includes('dating');
const POP = { games: ['Fortnite', 'Call of Duty', 'Minecraft', 'Valorant', 'League of Legends', 'Apex Legends', 'Halo', 'Elden Ring', 'Overwatch 2', 'FIFA/EA FC', 'Rocket League', 'Pokémon'],
  platforms: ['PlayStation', 'Xbox', 'Steam', 'Nintendo', 'Discord', 'Epic', 'Riot', 'Battle.net'], interests: ['anime', 'esports', 'gym', 'music festivals', 'cooking', 'hiking', 'travel', 'board games', 'horror movies', 'D&D', 'art', 'coding'],
  streaming: ['Netflix', 'Crunchyroll', 'YouTube', 'Twitch', 'Spotify', 'Disney+', 'Max', 'Prime Video'] };
// Scripted onboarding flow. core = asked during setup; the rest is offered as "add more" from the review screen.
const F = [
  { k: 'name', label: 'Display name', type: 'text', core: 1, ask: "Hey! I'm your Cybermates guide. What name should people see?", ph: 'e.g. Nova' },
  { k: 'age', label: 'Age', type: 'number', core: 1, ask: 'How old are you? Under 18s get a safe minor mode without dating: friends stay under-18 only; games can include 18+ players unless a parent turns that off.' },
  { k: 'lookingFor', label: 'What are you here for?', type: 'list', o: D.MODES, labels: D.MODE_LABEL, core: 1, ask: 'What are you here for? Friends, gaming, dating — pick as many as you like.' },
  { k: 'gender', label: 'Gender', type: 'one', o: D.GENDERS, core: 1, ask: 'What is your gender?' },
  { k: 'seekingGenders', label: 'Interested in dating', type: 'list', o: D.GENDERS, core: 1, when: dating, ask: 'Who are you interested in dating?' },
  { k: 'orientation', label: 'Orientation', type: 'one', o: D.ORIENTATIONS, when: d => dating(d) && d.sensitiveOptIn, sensitive: 1, ask: 'What is your orientation? You can skip this.' },
  { k: 'ageRange', label: 'Age range to date', type: 'range', core: 1, when: dating, ask: 'What age range do you want to date? For example, 21 to 35.' },
  { k: 'loc', label: 'Where are you?', type: 'location', core: 1, ask: 'Where are you? Tap use my location, or tell me your city and country.' },
  { k: 'platforms', label: 'Where do you play?', type: 'list', o: D.GAMER_PLATFORMS, pop: POP.platforms, core: 1, ask: 'Where do you play? Xbox, PlayStation, PC, Switch?' },
  { k: 'games', label: 'Favorite games', type: 'list', o: D.GAMES, pop: POP.games, core: 1, ask: 'What games are you playing lately?' },
  { k: 'gamertags', label: 'Your gamer tags', type: 'handles', o: D.GAMER_PLATFORMS, core: 1, ask: 'Add your gamer tags so matches can find you. For example: my Xbox is MasterChief117.' },
  { k: 'interests', label: 'Interests', type: 'list', o: D.INTERESTS, pop: POP.interests, core: 1, ask: 'What are you into outside of games?' },
  { k: 'streaming', label: 'What do you watch & stream?', type: 'list', o: D.STREAMING, pop: POP.streaming, core: 1, ask: 'Which streaming services do you use?' },
  { k: 'anime', label: 'Anime', type: 'list', o: D.ANIME, core: 1, ask: 'Any favorite anime? Skip if not your thing.' },
  { k: 'socials', label: 'Socials & streaming handles', type: 'handles', o: D.SOCIALS, core: 1, ask: 'Any socials or a stream channel? You choose who sees them later.' },
  { k: 'photos', label: 'Photos (optional)', type: 'photos', core: 1, ask: 'Photos are optional. Add some now or later — you can keep them hidden until you match.' },
  { k: 'bio', label: 'About you', type: 'textarea', core: 1, ask: 'Last one: say a little about yourself.', ph: 'Diamond Valorant support main, looking for a chill duo…' },
  { k: 'discordInvite', label: 'Discord server invite', type: 'text', ask: 'Got a Discord server to share with matches? Paste the invite.', ph: 'discord.gg/abc123' },
  { k: 'shows', label: 'TV shows', type: 'list', o: D.SHOWS, ask: 'Favorite TV shows?' },
  { k: 'movies', label: 'Movies', type: 'list', o: D.MOVIES, ask: 'Favorite movies?' },
  { k: 'teams', label: 'Sports teams', type: 'list', o: D.TEAMS, ask: 'Any sports teams you root for?' },
  { k: 'religion', label: 'Religion', type: 'one', o: D.RELIGIONS, when: d => d.sensitiveOptIn, sensitive: 1, ask: 'What is your religion, if any?' },
  { k: 'politics', label: 'Politics', type: 'one', o: D.POLITICS, ask: 'How would you describe your politics?' },
  { k: 'drinking', label: 'Drinking', type: 'one', o: D.YNS, ask: 'Do you drink?' },
  { k: 'smoking', label: 'Smoking', type: 'one', o: D.YNS, ask: 'Do you smoke?' },
  { k: 'kids', label: 'Kids', type: 'one', o: D.KIDS, ask: 'What about kids?' },
  { k: 'budget', label: 'Date budget', type: 'one', o: D.BUDGETS, when: dating, ask: 'Typical budget for a date?' },
  ...D.QUESTIONS.map(q => ({ k: 'answers.' + q.id, q, label: q.text, type: 'question', ask: q.text })),
];
const LISTS = F.filter(f => f.type === 'list');

const get = (p, k) => k.startsWith('answers.') ? p.answers?.[k.slice(8)] : k === 'ageRange' ? [p.ageMin, p.ageMax] : k === 'loc' ? p : p[k];
const set = (p, k, v) => { if (k === 'ageRange') { [p.ageMin, p.ageMax] = v; p.ageRanges = { ...(p.ageRanges || {}), dating: MV.clampRange(p, v) }; } else if (k === 'loc') Object.assign(p, v); else if (k.startsWith('answers.')) { p.answers = p.answers || {}; p.answers[k.slice(8)] = v; } else p[k] = v; };

function fieldHTML(f, v) {
  const id = 'f_' + f.k.replace('.', '_');
  if (f.type === 'text') return `<input id="${id}" value="${esc(v)}">`;
  if (f.type === 'textarea') return `<textarea id="${id}" rows="3">${esc(v)}</textarea>`;
  if (f.type === 'number') return `<input id="${id}" type="number" value="${esc(v)}">`;
  if (f.type === 'one') return PV.oneWithAdd(id, f.o, [], v); // v57: 'Add something else' appends to the list
  if (f.type === 'list') {
    if (f.labels) { const vals = v || []; return `<div class="chips big" id="${id}">${f.o.map(o => `<label class="chip"><input type="checkbox" value="${esc(o)}" ${vals.includes(o) ? 'checked' : ''}><span>${esc(f.labels[o] || o)}</span></label>`).join('')}</div>`; }
    return PV.chipList(id, v || [], 'Type ' + f.label.toLowerCase().replace(/\?$/, '') + ' and tap Add'); // v57: no preset pick-lists, typed entries
  }
  if (f.type === 'handles') { const plats = f.k === 'gamertags' && st.draft?.platforms?.length ? [...new Set([...st.draft.platforms, ...Object.keys(v || {})])] : f.o;
    return `<div class="handles" id="${id}">${plats.map(o => `<label>${esc(o)}<input data-p="${esc(o)}" value="${esc(v?.[o] || '')}" placeholder="${o === 'Discord' ? 'username' : o === 'Riot' ? 'name#tag' : '@handle'}"></label>`).join('')}</div>${f.k === 'gamertags' && plats !== f.o ? '<p class="muted small">Showing the platforms you picked. Add others in Profile later.</p>' : ''}`; }
  if (f.type === 'range') return `<div class="row gap" id="${id}"><input type="number" min="18" max="99" data-r="0" value="${esc(v?.[0] ?? 18)}"><span>to</span><input type="number" min="18" max="99" data-r="1" value="${esc(v?.[1] ?? 40)}"></div>`;
  if (f.type === 'location') return PV.locationHTML(id, v); // v57: GPS + City / State / Country dropdowns
  if (f.type === 'photos') { const ph = v || [];
    return `<div id="${id}"><div class="photos">${ph.map((u, i) => `<div class="ph"><img src="${u}" alt=""><button type="button" data-del="${i}">✕</button></div>`).join('')}<label class="ph add">＋<input type="file" accept="image/*" hidden></label></div>
      <p class="muted small" data-rolling hidden></p>${UX.presetsHTML((st.draft || st.me)?.avatarPreset)}
      <p class="muted small">No photo? Pick a starter character above, or you'll get a colorful initials avatar. Who sees photos: <select data-photoreveal><option value="match" ${(st.draft || st.me)?.photoReveal !== 'public' ? 'selected' : ''}>🤝 Only after a match</option><option value="public" ${(st.draft || st.me)?.photoReveal === 'public' ? 'selected' : ''}>🌐 Everyone</option></select></p></div>`; }
  if (f.type === 'question') {
    const a = v || { answer: '', accept: [], importance: 10 };
    return `<div id="${id}" class="qbox"><label>My answer<select data-r="answer"><option value=""></option>${f.q.options.map((o, i) => `<option value="${i}" ${a.answer === i ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
      <div>Answers I'll accept: ${f.q.options.map((o, i) => `<label class="chip"><input type="checkbox" data-r="accept" value="${i}" ${a.accept?.includes(i) ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}</div>
      <label>Importance<select data-r="importance">${Object.entries(D.IMPORTANCE).map(([w, n]) => `<option value="${w}" ${+w === a.importance ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>`;
  }
}
function readField(f, root = document) {
  const id = 'f_' + f.k.replace('.', '_'); const el = $('#' + id, root); if (!el) return undefined;
  if (f.type === 'number') return el.value === '' ? null : +el.value;
  if (f.type === 'one') return el.querySelector('input:checked')?.value ?? '';
  if (f.type === 'range') { const a = [...el.querySelectorAll('input')].map(i => +i.value || null); return [Math.max(18, a[0] || 18), a[1] || 99]; }
  if (f.type === 'location') { const o = {}; el.querySelectorAll('[data-l]').forEach(i => o[i.dataset.l] = i.value.trim()); return o; }
  if (f.type === 'photos') return undefined; // photos save immediately on upload
  if (f.type === 'list') return el.matches('[data-tl]') ? PV.readChipList(el) : [...el.querySelectorAll('input:checked')].map(i => i.value);
  if (f.type === 'handles') { const o = {}; el.querySelectorAll('input').forEach(i => { if (i.value.trim()) o[i.dataset.p] = i.value.trim(); }); return o; }
  if (f.type === 'question') {
    const ans = el.querySelector('[data-r=answer]').value; if (ans === '') return undefined;
    let accept = [...el.querySelectorAll('[data-r=accept]:checked')].map(i => +i.value); if (!accept.length) accept = [+ans];
    return { answer: +ans, accept, importance: +el.querySelector('[data-r=importance]').value };
  }
  return el.value;
}
function parseSpoken(f, text) {
  if (f.type === 'number') return parseNumber(text);
  if (f.type === 'range') { const n = (text.match(/\d+/g) || []).map(Number); return n.length >= 2 ? [n[0], n[1]] : undefined; }
  if (f.type === 'location') { const c = D.CITIES.find(c => text.toLowerCase().includes(c[0].toLowerCase())); return c ? { city: c[0], region: c[1], countryCode: c[3] } : { city: text.trim() }; }
  if (f.type === 'photos') return undefined;
  if (f.type === 'text' && f.k === 'name') return text.replace(/^(my name is|i'm|i am|call me|it's)\s+/i, '').trim();
  if (f.type === 'one') return parseOne(text, f.o);
  if (f.type === 'list') return parseList(text, f.o);
  if (f.type === 'handles') return parseHandles(text, f.o);
  if (f.type === 'question') { const i = f.q.options.indexOf(parseOne(text, f.q.options)); return i < 0 ? undefined : { answer: i, accept: [i], importance: 10 }; }
  return text;
}

// Offline city lookup from the seed city table; GPS button does real coordinates.
function geocodeLocal(p) {
  const c = D.CITIES.find(c => c[0].toLowerCase() === String(p.city || '').trim().toLowerCase());
  if (c) { p.region = p.region || c[1]; p.country = c[2]; p.countryCode = p.countryCode || c[3]; if (!p.lat) { p.lat = c[4]; p.lng = c[5]; } }
  p.location = [p.city, p.region, p.countryCode].filter(Boolean).join(', ');
}
// ---------- rendering ----------
// Photo if allowed (self / public / after mutual match), else a friendly initials avatar.
const initials = n => esc(String(n || '?').replace(/\(TEST\)/, '').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase());
const avatar = (p, size = 48, { self = false, mutual = false } = {}) => {
  const photo = (p?.photos?.[0] && (self || mutual || p.photoReveal === 'public') ? p.photos[0] : null) || (p?.avatarPreset && PH.PRESETS.some(x => x.id === p.avatarPreset) ? PH.presetURL(p.avatarPreset) : null); // starter character = generic, always shown
  const h = p?.avatarHue ?? 200;
  return `<div class="av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;background:${photo ? `center/cover url(${photo})` : `linear-gradient(135deg,hsl(${h} 85% 60%),hsl(${(h + 60) % 360} 80% 45%))`}">${photo ? '' : initials(p?.name)}</div>`;
};
const verified = p => p?.verified ? '<span class="vbadge" title="Verified (preview — real checks coming soon)">✔</span>' : '';

async function render() {
  st.me = await db.getProfile(await db.getCurrentUserId());
  if (!st.me) { st.tab = 'onboard'; }
  else if (!profileComplete(st.me) && !['profile', 'onboard', 'help'].includes(st.tab)) st.tab = 'profile'; // UX §2.5: forced profile setup until complete
  if (st.tab !== 'discover') mesh()?.setDiscovery?.(null, false); // not searching: no relay duty, no discovery queries
  const app = $('#app');
  const unread = st.me ? (await db.listMessages(st.me.id)).filter(m => m.to === st.me.id && !m.read).length : 0;
  app.innerHTML = `<header><b class="logo">${logoHTML()}<small>social mesh</small></b>${T.headerToggles()}${IU.parentButton(st.me)}<span class="who">${st.me ? IU.headerMood() + avatar(st.me, 30, { self: true }) : ''}</span></header>
  <main id="view"></main>
  <nav>${[['discover', '🔥', 'Discover'], ['inbox', '💬', 'Inbox' + (unread ? ` (${unread})` : '')], ['arcade', '🕹', 'Arcade'], ['friends', '👥', 'Friends'], ...(st.me && rouletteVisible(st.me) ? [['roulette', '🎲', 'Connect']] : []), ['profile', '👤', 'Profile'], ['shop', '💎', 'Shop'], ['help', '🤖', 'Help'], ...(ADMIN ? [['dev', '🛠', 'Dev']] : [])].map(([t, i, l]) => `<button data-tab="${t}" class="${st.tab === t ? 'on' : ''}">${navIcon(t, st.tab === t)}${l}</button>`).join('')}</nav>`;
  if (st.me && !['onboard', 'arcade'].includes(st.tab)) SHOP.mountBanner(app, st.me).catch(() => {}); else SHOP.unmountBanner(); // bottom house-ad slot (hidden after Remove ads)
  T.wireHeader(app); app.querySelector('#parentbtn')?.addEventListener('click', () => IU.openParent());
  app.querySelectorAll('nav button').forEach(b => b.onclick = () => { st.tab = b.dataset.tab; st.chatWith = null; st.meshChat = null; render(); });
  const v = $('#view'); if (st.tab !== 'arcade') stopArcade(); if (st.tab !== 'friends') FLUI.leave(); // friend link burns when its page closes
  if (st.tab === 'roulette' && !rouletteVisible(st.me)) st.tab = 'discover'; // 18+ only
  await ({ discover, friends: fv => { fv.innerHTML = FLUI.section(st) + IU.friendsSection(); IU.wireFriends(fv, st, render); FLUI.wire(fv, st, render); }, arcade: av => arcadeView(av, st.me), roulette: rv => rouletteView(rv, st.me), inbox, onboard, profile, shop: sv => SHOP.shopView(sv, st, render), help: hv => helpView(hv, st.me), ...(ADMIN ? { dev } : {}) })[st.tab]?.(v);
}

const unitOf = p => prefFor(p, 'dating').unit || D.unitFor(p.countryCode);
const fmtDist = (mi, u) => u === 'km' ? `${Math.round(mi * KM_PER_MI)} km` : `${Math.round(mi)} mi`;
function distControl(p, mode) {
  const pr = prefFor(p, mode); const u = pr.unit || D.unitFor(p.countryCode);
  return `<span class="row gap distctl" data-mode="${mode}"><select data-d="scope">${Object.entries(D.DIST_SCOPES).map(([k, l]) => `<option value="${k}" ${pr.scope === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <input data-d="value" type="number" min="1" style="width:80px;${pr.scope === 'radius' ? '' : 'display:none'}" value="${esc(pr.value ?? (u === 'km' ? 80 : 50))}"><select data-d="unit" style="${pr.scope === 'radius' ? '' : 'display:none'}">${['mi', 'km'].map(x => `<option ${x === u ? 'selected' : ''}>${x}</option>`).join('')}</select></span>`;
}
function readDist(root) {
  const out = {};
  root.querySelectorAll('.distctl').forEach(c => { const g = k => c.querySelector(`[data-d=${k}]`).value; out[c.dataset.mode] = g('scope') === 'radius' ? { scope: 'radius', value: +g('value') || 50, unit: g('unit') } : { scope: g('scope') }; });
  return out;
}

// v33 Discover header for the current mode: age range, minimum %, compare style; gender filter chips ONLY in Dating.
function matchBar(me, mode) { const r = MV.ageRangeFor(me, mode) || MV.clampRange(me, [null, null]), how = MV.compareFor(me, mode);
  const gf = MV.GENDER_FILTER_MODES.includes(mode) && MV.datingOn(me) ? `<div class="row gap gfilter" data-gender-filter role="group" aria-label="Show me">${D.GENDERS.map(g => `<button type="button" class="chip small ${(me.seekingGenders || []).includes(g) ? 'on' : ''}" data-gf="${esc(g)}" aria-pressed="${(me.seekingGenders || []).includes(g)}">${esc(g)}</button>`).join('')}</div>` : '';
  return `<div class="card small matchbar" data-matchbar="${mode}"><div class="row gap"><span class="grow">🎯 Ages ${r[0]}–${r[1]} · min ${MV.minFor(me, mode)}% · ${how === 'soft' ? 'soft' : 'hard'} compare</span><button type="button" class="small ghost" id="mb-edit">Edit</button></div>${gf ? `<div class="muted small">Show me (dating only):</div>${gf}` : ''}</div>`; }
async function discover(v) {
  const me = st.me;
  const modes = DISC.visibleModes(me, D.MODES); // under 18: Dating tab not rendered at all
  const all = (await db.listProfiles()).filter(o => st.mode !== 'dating' || !DISC.isMinor(o)); // adult dating never shows minors
  if (!modes.includes(st.mode)) st.mode = 'friends';
  mesh()?.setDiscovery?.(st.mode, true); // mode-tagged discovery + relay duty only while searching
  const sn = st.mode === 'dating' && C0.safetyNoticeFor(me);
  const notIn = (sn ? `<div class="card warn small" data-safety-notice>🛡️ ${esc(sn)}</div>` : '') + (!me.lookingFor?.includes(st.mode) ? `<div class="card">You haven't enabled <b>${st.mode}</b> mode. <button id="enable">Enable it</button></div>` : '');
  // v51: merge live-mesh soft→hard fullCache (hardReady) into Discover — local db list + peers that cleared both soft mins then hardScore
  let ms = !me.lookingFor?.includes(st.mode) ? [] : MV.discoverList(me, all, st.mode, p => evaluate(me, p, st.mode, D.QUESTIONS)); // UX §5 (v33)
  if (me.lookingFor?.includes(st.mode)) { const seen = new Set(ms.map(x => x.profile?.code || x.profile?.id));
    for (const h of (mesh()?.hardReady?.() || [])) { const id = h.code || h.profile?.code || h.profile?.id; if (!id || seen.has(id)) continue;
      const e = evaluate(me, h.profile, st.mode, D.QUESTIONS); if (!e) continue; const pct = Math.round(((e.pct ?? h.pct) + (h.pct ?? e.pct)) / 2);
      if (pct < MV.minFor(me, st.mode)) continue; seen.add(id); ms.push({ ...e, v2: h.pct, pct, how: h.how || MV.compareFor(me, st.mode), live: 1 }); }
    ms.sort((a, b) => b.pct - a.pct); }
  const dvMode = DV.getMode();
  const now = Date.now(), isOn = p => recency(demoLastSeen(p.id, now), now) === 'online';
  const online = ms.filter(x => isOn(x.profile)), offline = ms.filter(x => !isOn(x.profile) && recency(demoLastSeen(x.profile.id, now), now));
  v.innerHTML = MU.discoverSection() + `<div class="modes">${modes.map(m => `<button data-m="${m}" class="${st.mode === m ? 'on' : ''}">${D.MODE_LABEL[m]}</button>`).join('')}</div>
  <div class="card small row gap">📍 ${esc(me.city || '?')}${me.region ? ', ' + esc(me.region) : ''} ${esc(me.countryCode || '')} · Range for ${st.mode}: ${distControl(me, st.mode)}</div>
  ${notIn}${me.lookingFor?.includes(st.mode) ? matchBar(me, st.mode) : ''}
  <p class="banner">⚡ Connect now, make plans for tomorrow. Full profiles are visible only while people are online.</p>
  ${ms.length ? '' : (!me.lookingFor?.includes(st.mode) ? '' : '<div class="card">No matches yet in this mode. Add more games/interests to your profile, or widen your range above.</div>')}
  ${me.lookingFor?.includes(st.mode) ? DV.toggleHTML(dvMode) : ''}<div id="dv-swipe"></div>${st.mode === 'gaming' ? '<div id="lfg"></div>' : ''}${st.mode === 'friends' ? '<div id="events"></div>' : ''}
  ${dvMode === 'swipe' ? '' : online.length ? `<h3>🟢 Online now (${online.length})</h3>${online.map(x => card(x, unitOf(me))).join('')}` : ms.length ? '<div class="card">Nobody from your matches is online right now — check back soon.</div>' : ''}
  ${offline.length ? `<h3 class="muted">Recently online</h3>${offline.map(x => stubCard(x.profile)).join('')}` : ''}`;
  v.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { st.mode = b.dataset.m; render(); });
  v.querySelectorAll('[data-gf]').forEach(b => b.onclick = async () => { if (st.mode !== 'dating') return; const g = b.dataset.gf, cur = new Set(me.seekingGenders || []); cur.has(g) ? cur.delete(g) : cur.add(g); if (!cur.size) return toast('Pick at least one'); me.seekingGenders = D.GENDERS.filter(x => cur.has(x)); await db.upsertProfile(me); render(); });
  $('#mb-edit', v)?.addEventListener('click', () => { st.tab = 'profile'; render(); setTimeout(() => document.getElementById('mprefs')?.scrollIntoView({ block: 'start' }), 300); });
  v.querySelectorAll('[data-dv]').forEach(b => b.onclick = () => { DV.setMode(b.dataset.dv); render(); });
  if (dvMode === 'swipe') { st.dvSeen ||= new Set(); const deck = new DV.SwipeDeck(online.filter(x => !st.dvSeen.has(x.profile.id)), { slots: 8, pool: ms.filter(x => !st.dvSeen.has(x.profile.id) && !isOn(x.profile)), // cm-v35: pass refills the slot with the next best match
      onPass: x => { st.dvSeen.add(x.profile.id); mesh()?.pass?.(x.profile.code || x.profile.id); }, onLike: x => { st.dvSeen.add(x.profile.id); if (x.profile.code) mesh()?.like?.(x.profile.code); st.tab = 'inbox'; st.chatWith = x.profile.id; render(); } });
    DV.swipeView($('#dv-swipe', v), deck, { cardHTML: x => card(x, unitOf(me)), onOpen: x => { const c = x.profile.code, m = mesh(); if (!c || !m?.openProfile) { st.tab = 'inbox'; st.chatWith = x.profile.id; return render(); } // UX §8: full profile only on tap, behind "Loading their profile..." + online check
      DV.loadingProfile($('#dv-swipe', v), () => m.openProfile(c), { onBack: () => render(), onTalk: () => { m.like?.(c); st.tab = 'inbox'; st.chatWith = x.profile.id; render(); } }); } }); }
  { const meC = { ...me, code: mesh()?.code || me.id }, tr = mesh()?.arcade; if ($('#lfg', v)) UX.lfgSection($('#lfg', v), meC, tr).catch(() => {}); if ($('#events', v)) UX.eventsSection($('#events', v), meC, tr).catch(() => {}); }
  v.querySelectorAll('[data-chat]').forEach(b => b.onclick = () => { st.tab = 'inbox'; st.chatWith = b.dataset.chat; render(); });
  wireHandoff(v); MU.wireDiscover(v, st, render); IU.recentSection(v.querySelector('#recentlist'), st.me, st.mode).catch(() => {});
  v.querySelectorAll('.distctl select, .distctl input').forEach(el => el.onchange = async () => { me.distPrefs = { ...(me.distPrefs || D.defaultDist(me.countryCode)), ...readDist(v) }; await db.upsertProfile(me); render(); });
  $('#enable', v)?.addEventListener('click', async () => { me.lookingFor = [...(me.lookingFor || []), st.mode]; await db.upsertProfile(me); render(); });
}
function accountChips(accts) {
  return accts.filter(a => a.shown).map(a => { const url = linkFor(a.platform, a.handle);
    return `<span class="tag acct"><b>${esc(a.platform)}</b> ${esc(a.handle)} <button class="mini" data-copy="${esc(a.handle)}" data-plat="${esc(a.platform)}" title="Copy">📋</button>${url ? `<a class="mini" href="${esc(url)}" target="_blank" rel="noopener" data-open="${esc(a.platform)}" data-h="${esc(a.handle)}" title="Open">↗</a>` : ''}</span>`; }).join('');
}
function wireHandoff(root) {
  root.querySelectorAll('[data-copy]').forEach(b => b.onclick = async e => { e.preventDefault(); await copy(b.dataset.copy); b.textContent = '✓'; const t = HOW_TO[b.dataset.plat]; if (t) toast(t); });
  root.querySelectorAll('[data-open=Discord]').forEach(a => a.onclick = () => { copy(a.dataset.h); toast(HOW_TO.Discord); });
}
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.append(d); setTimeout(() => d.remove(), 3500); }
// Offline => stub only: tiny thumb + name + user code + last-seen bucket. Nothing else.
function stubCard(p) { const now = Date.now(); return `<div class="card row">${p.thumb ? `<img src="${esc(p.thumb)}" width="40" height="40" style="image-rendering:pixelated;border-radius:50%">` : avatar({ name: p.name, avatarHue: p.avatarHue }, 40)}<div class="grow"><b>${esc(p.name)}</b> <span class="muted small">#${esc(p.code || p.id)}</span><div class="muted small">${esc(recency(demoLastSeen(p.id, now), now))}</div></div></div>`; }
function card({ profile: p, pct, shared, dist }, unit = 'mi') {
  const accts = visibleAccounts(p, { mutual: false }); const locked = accts.filter(a => !a.shown && a.level === 'match').length;
  const tags = accountChips(accts) + (locked ? `<span class="tag">🔒 ${locked} account${locked > 1 ? 's' : ''} unlock after you both message</span>` : '');
  return `<div class="card match">
    <div class="row">${avatar(p, 60)}<div class="grow"><h3>${esc(p.name)}, ${p.age} ${verified(p)}</h3><div class="muted small">📍 ${esc([p.city, p.countryCode].filter(Boolean).join(', ') || p.location)}${dist != null ? ` · ${fmtDist(dist, unit)}` : ''} · ${esc(p.gender)}</div>${p.photos?.length && p.photoReveal !== 'public' ? '<div class="muted small">📷 Photos unlock after you match</div>' : ''}</div><div class="pct"><b>${pct}%</b><span>match</span></div></div>
    <div class="shared"><b>You both:</b> ${shared.slice(0, 10).map(s => `<span class="tag hot">${esc(s.label)}: ${esc(s.item)}</span>`).join('')}</div>
    <p>${esc(p.bio)}</p><div class="tags">${tags}</div>
    <div class="muted small">Streams: ${esc((p.streaming || []).join(', '))} · Budget: ${esc(p.budget)} ${p.showSensitive && p.religion ? '· ' + esc(p.religion) + ' ' : ''}· Drinks ${esc(p.drinking)} · Smokes ${esc(p.smoking)} · Kids: ${esc(p.kids)} · ${esc(p.politics)}</div>
    <button class="primary" data-chat="${p.id}">Message</button></div>`;
}

async function inbox(v) {
  if (st.meshChat && mesh()) { const { getVault } = await import('./settings-ui.js'); return MU.chatView(v, st, render, await getVault(), st.me); }
  const me = st.me; const msgs = await db.listMessages(me.id); const w = await db.getWalletView(me.id); // display-only view
  const all = await db.listProfiles(); const byId = Object.fromEntries(all.map(p => [p.id, p]));
  const wallet = `<div class="wallet">Connection requests are free · ⚡ Boosts: <b>${w.boosts}</b></div>`;
  if (st.chatWith) {
    const o = byId[st.chatWith]; await db.markRead(me.id, o.id);
    const conv = msgs.filter(m => m.from === o.id || m.to === o.id).sort((a, b) => a.at - b.at);
    const ev = D.MODES.map(m => evaluate(me, o, m, D.QUESTIONS)).filter(Boolean)[0];
    const allMsgs = await db.listMessages(me.id); const mutual = isMutual(allMsgs, me.id, o.id);
    const theirs = visibleAccounts(o, { mutual }); const locked = theirs.filter(a => !a.shown && a.level === 'match').length;
    const mine = visibleAccounts(me, { mutual });
    const linked = `<details class="card linked" ${mutual ? 'open' : ''}><summary>🔗 Linked accounts ${mutual ? '— mutual match ✅' : '— 🔒 more unlock when you both message'}</summary>
      <div class="tags">${accountChips(theirs) || '<span class="muted small">Nothing shared yet.</span>'}${locked ? `<span class="tag">🔒 ${locked} more after mutual match</span>` : ''}${o.discordInvite && o.reveal?.discordInvite !== 'hidden' && (mutual || o.reveal?.discordInvite === 'public') ? `<a class="tag acct" href="${esc(inviteUrl(o.discordInvite))}" target="_blank" rel="noopener">🎮 Join their Discord server ↗</a>` : ''}</div>
      <div class="row gap"><button id="sharecard" ${mutual ? '' : 'disabled'}>📤 Send my linked-accounts card</button><span class="muted small">Shares only accounts they can see (${mine.filter(a => a.shown).length}). Edit in Profile → Privacy.</span></div></details>`;
    v.innerHTML = `${wallet}<div class="row chathead"><button id="back">←</button>${avatar(o, 40, { mutual })}<b class="grow">${esc(o.name)} ${verified(o)}</b>${ev ? `<span class="pct sm">${ev.pct}%</span>` : ''}</div>
      ${ev ? `<div class="shared small">${ev.shared.slice(0, 6).map(s => `<span class="tag hot">${esc(s.item)}</span>`).join('')}</div>` : ''}
      ${linked}
      <div class="chat">${conv.map(m => `<div class="bubble ${m.from === me.id ? 'mine' : ''}">${m.boosted ? '🚀 ' : ''}${esc(m.text)}</div>`).join('') || `<p class="muted">New conversation — sending uses 1 conversation starter. ${ev ? 'Icebreaker: ask about ' + esc(ev.shared[0].item) + '!' : ''}</p>`}</div>
      <form id="sf" class="send"><input id="txt" placeholder="Message…" autocomplete="off"><label class="chip"><input type="checkbox" id="boost"><span>🚀 Boost</span></label><button class="primary">Send</button></form>`;
    $('#back').onclick = () => { st.chatWith = null; render(); };
    wireHandoff(v);
    $('#sharecard')?.addEventListener('click', async () => { const r = await db.sendMessage(me.id, o.id, '🔗 ' + cardText(me, mine)); if (!r.ok) alert('Could not send: ' + r.reason); render(); });
    $('#sf').onsubmit = async e => {
      e.preventDefault(); const t = $('#txt').value.trim(); if (!t) return;
      const r = await db.sendMessage(me.id, o.id, t, { boost: $('#boost').checked });
      if (!r.ok) { if (confirm(r.reason === 'no-starters' ? "You're out of conversation starters today. Go to Shop for more (mock)?" : 'No boosts left. Buy some in Shop (mock)?')) { st.tab = 'shop'; st.chatWith = null; } }
      render();
    };
    return;
  }
  const convs = {};
  for (const m of msgs) { const other = m.from === me.id ? m.to : m.from; (convs[other] = convs[other] || []).push(m); }
  const list = Object.entries(convs).map(([id, ms]) => {
    ms.sort((a, b) => a.at - b.at); const last = ms[ms.length - 1];
    const boostedUnread = ms.some(m => m.to === me.id && m.boosted && !m.read);
    const unread = ms.filter(m => m.to === me.id && !m.read).length;
    return { id, last, boostedUnread, unread };
  }).sort((a, b) => (b.boostedUnread - a.boostedUnread) || (b.last.at - a.last.at)); // boosted float to top
  v.innerHTML = `${wallet}${IU.inboxSection(st.me)}<p class="muted small" data-chatshint>Messages are stored on this device with no fixed deletion time. Chat-saving options you both agree on control visible history; every option keeps an encrypted 7-day safety copy.</p>${list.map(c => { const p = byId[c.id]; return `<div class="card row conv ${c.boostedUnread ? 'boosted' : ''}" data-c="${c.id}">${avatar(p, 44)}<div class="grow"><b>${esc(p?.name)}</b> ${verified(p)}${c.boostedUnread ? ' <span class="tag hot">🚀 Boosted</span>' : ''}<div class="muted small">${esc(c.last.text.slice(0, 60))}</div></div>${c.unread ? `<span class="badge">${c.unread}</span>` : ''}${IU.modeIcon(p?.mode || 'friends')}</div>`; }).join('')}`;
  v.querySelectorAll('[data-c]').forEach(e => e.onclick = () => { st.chatWith = e.dataset.c; render(); });
  IU.wireInbox(v, st, render);
}

const flow = d => F.filter(f => (f.core || st.extras) && (!f.when || f.when(d)));
const show = (f, v) => { if (v == null || v === '' || (Array.isArray(v) && !v.filter(x => x != null).length)) return '<span class="muted">—</span>';
  if (f.type === 'handles') return esc(Object.entries(v).map(([k, x]) => k + ': ' + x).join(', ') || '—');
  if (f.type === 'location') return esc([v.city, v.region, v.countryCode].filter(Boolean).join(', ') || '—');
  if (f.type === 'range') return esc(v.join('–')); if (f.type === 'photos') return v.length + ' photo(s)';
  if (f.type === 'question') return esc(f.q.options[v.answer] ?? '—'); return esc(Array.isArray(v) ? v.map(x => f.labels?.[x] || x).join(', ') : v); };

// Downscale to ≤480px JPEG so photos fit in local storage.
function toThumb(file) { return new Promise(res => { const img = new Image(); img.onload = () => { const k = Math.min(1, 480 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.72)); URL.revokeObjectURL(img.src); }; img.src = URL.createObjectURL(file); }); }
// v57: location dropdowns update in place (no re-render, unsaved edits stay)
function wireLoc(root, p) { PV.wireLocation(root, o => { Object.assign(p, o); { const c = D.CITIES.find(c => c[0] === p.city && c[3] === p.countryCode); if (c) { p.lat = c[4]; p.lng = c[5]; } } geocodeLocal(p); const w = root.querySelector('[data-loc]'); if (!w) return; const host = w.parentElement; w.outerHTML = PV.locationHTML(w.id, p); wireLoc(host, p); host.querySelectorAll('[data-gps]').forEach(b => b.onclick = () => { b.textContent = '📍 Locating…'; locate(p).then(() => { const x = host.querySelector('[data-loc]'); x.outerHTML = PV.locationHTML(x.id, p); wireLoc(host, p); }, e => { b.textContent = '📍 ' + e; }); }); }); }
function wireExtras(root, p, rerender) {
  PV.wireLists(root); wireLoc(root, p);
  root.querySelector('input[type=file]')?.addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; const r = await PH.addPhoto(p, await toThumb(f)); if (r.notice) { st.rollingNotice = r.notice; toast('📸 ' + r.notice); } rerender(); });
  { const el = root.querySelector('[data-rolling]'); if (el) PH.allPhotos(p).then(all => { const extra = all.length - (p.photos || []).length; if (extra > 0) { el.hidden = false; el.textContent = `📸 ${(p.photos || []).length} shown + ${extra} more on this phone only. ${PH.ROLLING_NOTICE}`; } }).catch(() => {}); }
  root.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => { p.avatarPreset = b.dataset.preset; p.thumb = PH.presetURL(b.dataset.preset); rerender(); });
  root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { p.photos.splice(+b.dataset.del, 1); rerender(); });
  root.querySelectorAll('[data-photoreveal]').forEach(s => s.onchange = () => p.photoReveal = s.value);
  root.querySelectorAll('[data-gps]').forEach(b => b.onclick = () => { b.textContent = '📍 Locating…'; locate(p).then(() => rerender(), e => { b.textContent = '📍 ' + e; }); });
}
function locate(p) {
  return new Promise((res, rej) => { if (!navigator.geolocation) return rej('Location not supported — type it below');
    navigator.geolocation.getCurrentPosition(async pos => { p.lat = pos.coords.latitude; p.lng = pos.coords.longitude;
      try { const r = await (await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${p.lat}&longitude=${p.lng}&localityLanguage=en`)).json();
        p.city = r.city || r.locality || p.city; p.region = (r.principalSubdivisionCode || '').split('-')[1] || r.principalSubdivision || p.region; p.countryCode = r.countryCode || p.countryCode; p.country = r.countryName || p.country; } catch { }
      p.location = [p.city, p.region, p.countryCode].filter(Boolean).join(', '); res(p); }, () => rej('Location denied — type it below'), { timeout: 10000 }); });
}

async function onboard(v) {
  if (!st.draft) st.draft = st.me ? structuredClone(st.me) : { id: 'user-' + Date.now(), name: '', answers: {}, lookingFor: [], platforms: [], gamertags: {}, socials: {}, photos: [], photoReveal: 'match', reveal: {}, avatarHue: Math.floor(Math.random() * 360), createdAt: Date.now() };
  const d = st.draft, steps = flow(d);
  if (st.step >= steps.length) return review(v, steps);
  const f = steps[st.step], pct = Math.round(100 * st.step / steps.length);
  v.innerHTML = `<div class="onb">
    <div class="progress"><i style="width:${pct}%"></i></div>
    <div class="row between muted small"><span>${st.step + 1} of ${steps.length}</span><button class="link" id="toreview">Review all</button></div>
    ${st.missNote ? `<div class="card warn small" id="pf-required">${esc(st.missNote)}</div>` : ''}<h2 class="q">${esc(f.label)}</h2><p class="ask">${esc(f.ask)}</p>
    <div class="voice row gap"><button id="say" class="ghost" title="Read aloud">🔊</button>${canListen ? '<button id="mic" class="mic">🎙️ Tap & speak</button>' : '<span class="muted small">Voice input isn’t supported in this browser — tap or type.</span>'}</div>
    <p id="heard" class="heard"></p>
    <div id="fld" class="fld">${fieldHTML(f, get(d, f.k))}</div>
    ${['text', 'textarea', 'number'].includes(f.type) ? '' : `<div class="row gap"><input id="free" class="grow" placeholder="Or type it like you'd say it…"><button id="parse">Fill</button></div>`}
    <div class="onbnav"><button id="prev" ${st.step ? '' : 'disabled'}>Back</button><button id="skip" class="ghost">Skip</button><button id="next" class="primary">Next</button></div></div>`;
  const redraw = () => { $('#fld').innerHTML = fieldHTML(f, get(d, f.k)); wireExtras($('#fld'), d, redraw); };
  wireExtras($('#fld'), d, redraw);
  const apply = text => {
    const val = parseSpoken(f, text); let note = [];
    if (val !== undefined && val !== null && val !== '' && !(Array.isArray(val) && !val.length)) set(d, f.k, f.type === 'handles' ? { ...(get(d, f.k) || {}), ...val } : f.type === 'list' ? [...new Set([...(get(d, f.k) || []), ...val])] : val);
    // cross-field pickup: "I play Halo on Xbox" also fills platforms
    for (const [k, vals] of Object.entries(crossPick(text, LISTS.filter(x => x.k !== f.k)))) { const before = d[k] || []; const add = vals.filter(x => !before.includes(x)); if (add.length) { d[k] = [...before, ...add]; note.push(add.join(', ') + ' → ' + (F.find(x => x.k === k).label)); } }
    $('#heard').innerHTML = '“' + esc(text) + '”' + (note.length ? `<br><b>Also added:</b> ${esc(note.join(' · '))}` : '');
    redraw();
  };
  $('#say').onclick = () => speak(f.ask);
  $('#parse')?.addEventListener('click', () => apply($('#free').value));
  $('#free')?.addEventListener('keydown', e => { if (e.key === 'Enter') apply($('#free').value); });
  $('#mic')?.addEventListener('click', async () => { { const C = await import('./compliance.js'); const { getVault } = await import('./settings-ui.js'); const vv = await getVault(); if (!(await C.hasVoiceConsent(vv, 'free'))) { if (!C.voiceConsentDialog(C.VOICE_DISCLOSURE_FREE)) { $('#heard').textContent = 'No problem — tap or type your answer.'; return; } await C.voiceConsent(vv, 'free'); } } const m = $('#mic'); m.classList.add('live'); m.textContent = '🎙️ Listening…'; try { apply(await listen()); } catch (e) { $('#heard').textContent = 'Didn’t catch that (' + e.message + ') — tap or type instead.'; } m.classList.remove('live'); m.textContent = '🎙️ Tap & speak'; });
  const save = () => { const val = readField(f, v); if (val !== undefined) set(d, f.k, val); };
  $('#toreview').onclick = () => { save(); st.step = flow(d).length; render(); };
  $('#prev').onclick = () => { save(); st.step--; render(); };
  $('#skip').onclick = () => { st.step++; render(); };
  $('#next').onclick = () => { save(); st.missNote = null;
    if (f.k === 'name' && !d.name) return alert('Pick a name to continue.');
    if (f.k === 'age' && d.age != null && d.age < 18) return alert('Cybermates is 18+ only.');
    st.step = flow(d).indexOf(f) + 1; render(); };
  if (canSpeak && st.autoSpeak !== f.k) { st.autoSpeak = f.k; speak(f.ask); }
}
async function review(v, steps) {
  const d = st.draft;
  v.innerHTML = `<div class="onb"><div class="progress"><i style="width:100%"></i></div><h2 class="q">Looking good, ${esc(d.name || 'friend')}! 🎉</h2><p class="muted">Tap anything to change it.</p>
    <div class="avbig">${avatar(d, 88, { self: true })}</div>
    ${steps.map((f, i) => `<button class="revrow" data-go="${i}"><span class="muted small">${esc(f.label)}</span><span>${show(f, get(d, f.k))}</span></button>`).join('')}
    ${st.extras ? '' : '<button id="more" class="wide ghost">＋ Add more (shows, teams, lifestyle, compatibility questions)</button>'}
    <button id="finish" class="primary wide">${st.me ? 'Save changes' : 'Start matching →'}</button></div>`;
  v.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { st.step = +b.dataset.go; render(); });
  $('#more')?.addEventListener('click', () => { st.extras = true; st.step = flow(d).findIndex(f => !f.core); render(); });
  $('#finish').onclick = async () => {
    const gate = await checkDevice(); if (!gate.allowed) { alert(gate.message); return; }
    const p = d; if (!p.name) { st.step = 0; return render(); }
    if (p.age == null || p.age < 18) { alert('Cybermates is 18+ only — please add your age.'); st.step = flow(d).findIndex(f => f.k === 'age'); return render(); }
    if (!p.lookingFor?.length) p.lookingFor = ['friends', 'gaming'];
    geocodeLocal(p);
    { const miss = missingProfile({ ...p, countryCode: p.countryCode || (p.city ? 'US' : '') }); if (miss.length) { // UX §2.5: cannot proceed until the profile is complete
      const STEP = { name: 'name', age: 'age', gender: 'gender', lookingFor: 'lookingFor', location: 'loc', interests: 'interests', photo: 'photos', seekingGenders: 'seekingGenders' };
      st.extras = st.extras || false; const i = flow(d).findIndex(f => f.k === STEP[miss[0]]); st.missNote = 'Finish your profile to continue: ' + miss.join(', '); st.step = i >= 0 ? i : 0; return render(); } }
    p.countryCode = (p.countryCode || 'US').toUpperCase().slice(0, 2); p.distPrefs = p.distPrefs || D.defaultDist(p.countryCode);
    p.reveal = p.reveal || {};
    await db.upsertProfile(await withThumb(p)); await db.setCurrentUserId(p.id); st.draft = null; st.step = 0; st.extras = false; st.tab = 'discover'; render();
  };
}

// v57 profile layout helpers
const PROFILE_SKIP = new Set(['name', 'age', 'photos', 'discordInvite', 'religion', 'politics', 'drinking', 'smoking', 'kids', 'orientation', 'anime', 'teams']); // shown in the top card / categories / newer Matching rows
function topCard(p) { const bd = p.birthday || C0.sessionBirthdate?.() || ''; const a = PV.ageFrom(bd) ?? p.age;
  return `<div class="card" id="pf-top"><h4>👤 You</h4>${fieldHTML(F.find(f => f.k === 'photos'), p.photos)}
    <label class="small">Display name <input id="f_name" value="${esc(p.name)}" maxlength="40"></label>
    <label class="small">Birthday <input id="f_birthday" type="date" value="${esc(bd)}" max="${new Date().toISOString().slice(0, 10)}"></label> <span class="small" id="pf-age">${a != null ? 'Age ' + a : ''}</span>${PV.catControls('birthday', p)}</div>`; }
function catCards(p) { const on = new Set(PV.activeCats(p));
  return Object.entries(PV.CATS).map(([c, d]) => { const k = PV.catField(c), extra = c === 'sports' ? `<h4>Teams</h4>${fieldHTML(F.find(f => f.k === 'teams'), p.teams)}` : '';
    return `<div class="card" data-cat="${c}" ${on.has(c) ? '' : 'hidden'}><h4>${d.label}</h4>${PV.chipList('f_' + k, p[k] || [], 'Add to ' + d.label.replace(/^\S+\s/, ''))}${extra}${PV.catControls(k, p)}</div>`; }).join(''); }
function wireCats(v) { const upd = () => { const tmp = { interests: PV.readChipList(v.querySelector('#f_interests')) }; for (const c of Object.keys(PV.CATS)) tmp[PV.catField(c)] = PV.readChipList(v.querySelector('#f_' + PV.catField(c)));
    const on = new Set(PV.activeCats(tmp)); v.querySelectorAll('[data-cat]').forEach(e => { e.hidden = !on.has(e.dataset.cat); }); };
  v.addEventListener('tl-change', upd); const b = v.querySelector('#f_birthday'); if (b) b.oninput = () => { const a = PV.ageFrom(b.value); v.querySelector('#pf-age').textContent = a != null ? 'Age ' + a : ''; }; }
async function profile(v) {
  const p = structuredClone(st.me);
  const accts = visibleAccounts(p, { isSelf: true });
  const lvl = (key, cur) => `<select data-rv="${esc(key)}">${[['public', '🌐 Everyone'], ['match', '🤝 After mutual match'], ['hidden', '🙈 Hidden']].map(([k, l]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  v.innerHTML = IU.moodProfileCard() + `<div class="card"><div class="row">${avatar(p, 72, { self: true })}<div class="grow"><h2>${esc(p.name)} ${verified(p)}</h2><div class="muted small">📍 ${esc(p.location || 'No location yet')}</div><div class="row gap"><button type="button" id="geo">📍 Update location</button><button type="button" id="guided" class="ghost">✨ Guided edit</button></div></div></div></div>
  <div class="card verify"><b>✔ Get verified</b> <span class="tag">Coming soon</span><p class="muted small">Verified badges will mean a real-photo selfie check (AI liveness) and optional ID verification. Preview only — nothing is checked yet.</p></div>
  <form id="pf" novalidate>
  <div class="card"><h4>📏 Distance per mode</h4>${D.MODES.map(m => `<div class="row gap"><b style="width:90px">${D.MODE_LABEL[m]}</b>${distControl(p, m)}</div>`).join('')}<p class="muted small">Defaults: Friends same state/region, Gaming global, Dating 50 mi (80 km outside US/UK). Both people's ranges must include each other.</p></div>
  <div class="card"><h4>🔒 Privacy: who sees each account</h4>${accts.map(a => `<div class="row gap"><span class="grow">${esc(a.platform)}: ${esc(a.handle)}</span>${lvl(a.kind + '.' + a.platform, a.level)}</div>`).join('') || '<p class="muted small">Add gamer tags / socials below first.</p>'}
    ${p.discordInvite ? `<div class="row gap"><span class="grow">Discord server invite</span>${lvl('discordInvite', p.reveal?.discordInvite || 'match')}</div>` : ''}</div>
  ${topCard(p)}${F.filter(f => f.k !== 'ageRange' && !PROFILE_SKIP.has(f.k) && (f.when === dating ? !DISC.isMinor(p) : !f.when || f.when(p))).map(f => `<div class="card" data-fk="${esc(f.k)}"${f.when === dating ? ` data-dating-only${MV.datingOn(p) ? '' : ' hidden'}` : ''}><h4>${esc(f.label)}</h4>${fieldHTML(f, get(p, f.k))}${PV.catControls(f.k, p)}</div>${f.k === 'socials' ? PV.linksHTML(p) : ''}${f.k === 'interests' ? catCards(p) : ''}`).join('')}${UX.prefsCard(p)}${UX.favGamesHTML(p)}<button class="primary wide">Save profile</button></form>
  <div class="card"><button type="button" id="modq" class="ghost">⚑ Reports & moderation queue</button><div id="modq-v"></div></div>`;
  { const miss = missingProfile(st.me); if (miss.length) v.insertAdjacentHTML('afterbegin', `<div class="card warn" id="pf-required">Finish your profile to continue: <b>${miss.map(esc).join(', ')}</b></div>`); }
  UX.wirePrefs(v); wireCats(v); UX.wireFavGames(v, st.me, async () => { await db.upsertProfile(st.me); profile(v); });
  $('#modq').onclick = async () => { const R = await import('./reports.js'); R.modQueueView($('#modq-v'), { onBlock: c => mesh()?.block?.(c) }); };
  v.querySelectorAll('.distctl [data-d=scope]').forEach(sel => sel.onchange = () => sel.parentElement.querySelectorAll('[data-d=value],[data-d=unit]').forEach(x => x.style.display = sel.value === 'radius' ? '' : 'none'));
  $('#geo').onclick = () => locate(st.me).then(async me => { await db.upsertProfile(me); toast('Location saved: ' + me.location); render(); }, e => alert(e));
  $('#guided').onclick = () => { st.draft = null; st.step = 0; st.tab = 'onboard'; render(); };
  wireExtras(v, st.me, async () => { await db.upsertProfile(st.me); profile(v); }); // photos/location save instantly
  $('#pf').onsubmit = async e => {
    e.preventDefault(); F.forEach(f => { const val = readField(f, v); if (val !== undefined) set(p, f.k, val); });
    p.photos = st.me.photos || []; p.photoReveal = st.me.photoReveal || 'match'; if (p.lat !== st.me.lat) Object.assign(p, { lat: st.me.lat, lng: st.me.lng });
    p.reveal = { ...(p.reveal || {}) }; v.querySelectorAll('[data-rv]').forEach(s => p.reveal[s.dataset.rv] = s.value);
    p.distPrefs = { ...(p.distPrefs || {}), ...readDist(v) }; if (p.countryCode) p.countryCode = p.countryCode.toUpperCase().slice(0, 2);
    { const bd = $('#f_birthday')?.value || ''; const a = PV.ageFrom(bd); if (bd && a != null) { if ((a < 18) !== DISC.isMinor(st.me)) { alert('That birthday changes your age group (under 18 / 18+). Age group changes are not allowed from the profile.'); return; } p.birthday = bd; p.age = a; } }
    for (const c of Object.keys(PV.CATS)) if (c !== 'anime') { const el = v.querySelector('#f_' + PV.catKey(c)); if (el) p[PV.catKey(c)] = PV.readChipList(el); }
    PV.routeInterests(p); PV.readCatControls(v, p); { const r = PV.readLinks(v, p); if (r.badInvites || r.badStreams) toast(`${r.badInvites + r.badStreams} link(s) skipped: use discord.gg/…, twitch.tv/… or kick.com/…`); }
    { const r = UX.readPrefs(v, p); if (r.droppedInterests) toast(`Interests are capped at ${MV.INTEREST_CAP} — ${r.droppedInterests} removed`); p.favGames = st.me.favGames || []; p.avatarPreset = st.me.avatarPreset; if (st.me.avatarPreset && !(st.me.photos || []).length) p.thumb = st.me.thumb; }
    geocodeLocal(p); await db.upsertProfile(await withThumb(p)); toast('Saved ✓'); render();
  };
  v.append(T.lookPanel());
  // v57: 'Peer network (beta)' section removed from Profile (David). Admin builds still show it in Dev.
}

async function shop(v) {
  const w = await db.getWalletView(st.me.id); const daily = w.dailyLimit; // display-only view
  const packs = [['Starter packs', 'New-conversation openers on top of your free daily ones. Never expire.', [['starters5', '5 starters', '$1.99', '$0.40 each'], ['starters15', '15 starters', '$4.99', '$0.33 each'], ['starters40', '40 starters', '$9.99', '$0.25 each']]],
    ['Inbox Boosts', 'Pins your message at the top of their inbox until they read it.', [['boost1', '1 boost', '$1.99', ''], ['boost5', '5 boosts', '$6.99', '$1.40 each'], ['boost15', '15 boosts', '$14.99', '$1.00 each']]],
    ['Cybermates+', '15 starters/day (instead of 5), 5 boosts every month, see who liked you, advanced filters, incognito, read receipts. Cancel anytime in one tap.', [['plus1m', '1 month', '$9.99/mo', ''], ['plus6m', '6 months', '$44.99', '$7.50/mo'], ['plus12m', '12 months', '$69.99', '$5.83/mo']]],
    ['Grok voice setup', 'Optional premium voice onboarding with Grok Voice. One-time; up to 30 minutes per purchase (hard stop). The free browser voice setup stays the default.', [['voice30', '30 min voice setup', '$4.99', 'one-time']]]];
  v.innerHTML = `<div class="card warn">🧪 MOCK STORE — no real payments are taken. Buttons just credit your wallet.</div><p class="small warn">⚠️ Boosts, starter packs and voice minutes are device-bound: they do not carry over when you transfer to a new device.</p>
   <div class="wallet">${w.plus ? '⭐ Cybermates+ active · ' : ''}Starters left today: ${w.startersLeft}/${daily}${w.voiceMinutesLeft ? ` · Grok voice: ${w.voiceMinutesLeft} min` : ''} · Bought starters: ${w.extraStarters} · Boosts: ${w.boosts}</div>
   ${packs.map(([h, d, items]) => `<h3>${h}</h3><p class="muted small">${d}</p>${items.map(([id, l, pr, per]) => `<div class="card row"><div class="grow"><b>${l}</b><div class="muted">${pr}${per ? ' · ' + per : ''}</div></div><button class="primary" data-buy="${id}" ${id.startsWith('plus') && w.plus ? 'disabled' : ''}>${id.startsWith('plus') && w.plus ? 'Active' : 'Buy (mock)'}</button></div>`).join('')}`).join('')}
   ${w.voiceMinutesLeft ? '<button id="grokvoice">🎙️ Start Grok voice setup</button> ' : ''}${w.plus ? '<button id="cancelplus">Cancel Cybermates+ (mock)</button>' : ''}
   <p class="muted small">Messages in existing conversations are always free and always delivered. Every user gets ${DAILY_STARTERS} free new-conversation starters per day. Prices in USD.</p>`;
  v.querySelectorAll('[data-buy]').forEach(b => b.onclick = async () => { await db.mockPurchase(st.me.id, b.dataset.buy); render(); });
  $('#grokvoice')?.addEventListener('click', async () => { { const C = await import('./compliance.js'); const { getVault } = await import('./settings-ui.js'); const vv = await getVault(); if (!(await C.hasVoiceConsent(vv, 'grok'))) { if (!C.voiceConsentDialog(C.VOICE_DISCLOSURE_GROK)) return; await C.voiceConsent(vv, 'grok'); } } const { startVoiceSession } = await import('./voice-session.js'); const r = await startVoiceSession({ wallet: db._w?.(), uid: st.me.id, onStop: () => render() }); if (!r.ok) alert(r.message || r.reason); });
  $('#cancelplus')?.addEventListener('click', async () => { await db.mockPurchase(st.me.id, 'plus_cancel'); render(); });
}

async function dev(v) {
  const all = await db.listProfiles();
  v.innerHTML = MU.devSection() + `<div class="card"><h3>🛠 Dev panel</h3><p class="muted small">Switch the active user to test both sides of matching/messaging. All seed profiles are fake.</p>
    <div class="row gap"><button id="reset" class="danger">Reset all data (re-seed)</button><button id="new">Create new user (voice onboarding)</button><label class="small"><input type="checkbox" id="simemu" ${isSimulatingEmulator() ? 'checked' : ''}> Simulate emulator (device gate test)</label></div></div><div id="p2p"></div>
    ${all.map(p => `<div class="card row ${p.id === st.me?.id ? 'boosted' : ''}">${avatar(p, 36)}<div class="grow"><b>${esc(p.name)}</b> <span class="muted small">${p.age} · ${esc(p.gender)} · ${esc(p.city || '')} ${esc(p.countryCode || '')} · ${esc((p.lookingFor || []).join('/'))}</span><div class="muted small">${esc(Object.keys(p.gamertags || {}).join(', '))} · ${esc((p.games || []).slice(0, 3).join(', '))}</div></div><button data-u="${p.id}">Use</button></div>`).join('')}`;
  if (st.me) p2pPanel($('#p2p'), st.me); $('#p2p').before(T.lookPanel()); { const k = document.createElement('div'); $('#p2p').before(k); adminKillPanel(k); }
  $('#reset').onclick = async () => { if (confirm('Wipe local data and reseed 30 test profiles?')) { await db.reset(); st.tab = 'discover'; render(); } };
  $('#simemu').onchange = e => setSimulateEmulator(e.target.checked);
  $('#new').onclick = () => { st.me = null; st.draft = null; st.step = 0; st.tab = 'onboard'; db.setCurrentUserId('__none__').then(render); };
  v.querySelectorAll('[data-u]').forEach(b => b.onclick = async () => { await db.setCurrentUserId(b.dataset.u); st.tab = 'discover'; render(); });
}

// new user flow: when current user is missing, onboarding renders without st.me
const _render = render; let termsOk = false, gateMinor = false, jacked = false, joiningAs = null, noticeShown = false, rotated = false;
render = async function () {
  const step = n => globalThis.__cmStep?.(n);
  if (!termsOk) { step('load-settings'); const { getVault } = await import('./settings-ui.js'); { step('load-compliance'); const C = await import('./compliance.js'); const v0 = await getVault(); step('age-status'); const F = await import('./ftue.js'); if (F.ftueResetActive()) { F.resetLocalFtue(); await F.clearVaultFtue(v0); } /* TESTING: replay every first-time flow */ const ag = await C.ageStatus(v0); step('age-gate'); if (!ag) await C.ageGateScreen(v0); gateMinor = !!(await C.ageStatus(v0))?.minor; } step('terms'); const { needsTerms, termsScreen } = await import('./terms.js'); const v = await getVault(); if (await needsTerms(v)) await termsScreen(v); step('device-key'); await ensureDeviceKey(v).catch(e => console.warn('device key', e)); termsOk = true; { const F = await import('./ftue.js'); if (F.shouldWarnLoss(F.countLogin())) await F.accountLossWarning(); } }
  step('profile-load'); const id = await db.getCurrentUserId(); const p = await db.getProfile(id);
  if (p && gateMinor && !DISC.isMinor(p)) { p.minor = true; await db.upsertProfile(p); }
  if (p && !rotated) { rotated = true; try { const before = (p.photos || []).join('|'), win = await PH.rotate(p); if (win && win.join('|') !== before) { await db.upsertProfile(await withThumb(p)); } } catch (e) { console.warn('photo rotate', e); } } // UX §3: rolling photos advance each login // birthday gate said under 18 -> minor mode (no Dating/Roulette)
  if (!p) { st.me = null; st.tab = 'onboard'; const app = $('#app'); app.innerHTML = `<header><b class="logo">${logoHTML()}<small>social mesh</small></b>${T.headerToggles()}<span class="who">Let's set you up</span></header><main id="view"></main>`; T.wireHeader(app); return onboard($('#view')); }
  step('p2p'); try { bootP2P(id); } catch (e) { console.warn('p2p boot', e); }
  step('app');
  if (!noticeShown) { noticeShown = true; import('./settings-ui.js').then(async S => noticeBanner(await blockedReason(await S.getVault()))); }
  if ((!mesh() || mesh().asKey !== p.id) && joiningAs !== p.id && !killState()) {
    joiningAs = p.id;
    const go = (status = () => {}) => startMesh({ me: p, asKey: p.id, db, onChange: meshRefresh, onStatus: status, onNotice: noticeBanner }).then(async m => { meshRefresh(); if (navigator.onLine !== false) import('./signin.js').then(async S => S.restore(await S.deviceCtx())).catch(() => {}); /* optional sign-in: restore session; none/offline => mesh-only */ status('SCANNING FOR PEERS'); { let n = 0; const t = setInterval(() => { if (++n > 120) return clearInterval(t); if (document.getElementById('jackin') || document.getElementById('tm-ok') || document.getElementById('ag-dob')) return; clearInterval(t); IU.maybeAskMood(p); }, 500); } for (let i = 0; i < 15 && !m.online().length; i++) await new Promise(r => setTimeout(r, 100)); status(m.online().length ? m.online().length + ' PEER(S) ONLINE' : 'NO PEERS YET · LISTENING'); return m; }).finally(() => { joiningAs = null; });
    if (!jacked) { jacked = true; jackIn(go, { onTimeout: () => { if (!killState() && !document.getElementById('bannotice')) toast('⚠️ Offline — mesh not reachable yet. Retrying in the background…'); } }).catch(e => console.warn('mesh', e)); }
    else go().catch(e => console.warn('mesh', e));
  }
  return _render();
};
render().catch(e => { globalThis.__cmBootFail?.(e); console.error('boot', e); });
// SW is optional: in-app webviews may reject registration (or lack navigator.serviceWorker entirely).
try { if ('serviceWorker' in navigator && import.meta.env.PROD) navigator.serviceWorker.register('/sw.js').catch(e => console.warn('sw register', e)); } catch (e) { console.warn('sw', e); }
