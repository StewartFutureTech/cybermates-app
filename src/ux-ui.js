// UI for the UX-walkthrough features (§3 presets, §5 match prefs, §13 LFG + favorite games, §14 Friends events, reports
// queue). Logic lives in photos.js / match-v2.js / lfg.js / reports.js; this file only renders glass cards and reads them.
import * as MV from './match-v2.js';
import * as PH from './photos.js';
import * as LF from './lfg.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const minorOf = p => !!p?.minor || (p?.age != null && p.age < 18);
const IMP_L = { dontcare: "I don't care", low: 'A little', mid: 'Somewhat', high: 'Very', make: 'Make or break' };
const SPORTS = ['football', 'soccer', 'baseball', 'basketball', 'hockey', 'tennis', 'golf', 'MMA', 'racing', 'esports'];
// field -> [label, input kind, options]. Big lists = dropdown, small sets = tappable bubbles.
export const PREF_FIELDS = { sports: ['Sports', 'bubbles', SPORTS], politics: ['Politics', 'bubbles1', MV.POLITICS4], hand: ['Left / right handed', 'bubbles1', MV.HANDS], glasses: ['Glasses', 'bubbles1', ['yes', 'no']],
  job: ['Job status', 'select', MV.JOB], income: ['Income (optional)', 'select', ['<25k', '25-50k', '50-100k', '100-200k', '200k+']], religion: ['Religion', 'select', ['Agnostic', 'Atheist', 'Christian', 'Catholic', 'Jewish', 'Muslim', 'Hindu', 'Buddhist', 'Spiritual', 'Other']],
  drinking: ['Drinking', 'bubbles1', ['yes', 'sometimes', 'no']], smoking: ['Smoking', 'bubbles1', ['yes', 'sometimes', 'no']], kids: ['Kids', 'select', ['have', 'want', "don't want", 'open']] };
const bubbles = (k, opts, cur, one) => `<div class="row gap bub" data-bub="${k}" data-one="${one ? 1 : ''}">${opts.map(o => `<button type="button" class="chip ${[].concat(cur ?? []).includes(o) ? 'on' : ''}" data-v="${esc(o)}" aria-pressed="${[].concat(cur ?? []).includes(o)}">${esc(o)}</button>`).join('')}</div>`;
export function prefsCard(p) { const minor = minorOf(p), datingOn = MV.datingOn(p);
  const modes = minor ? ['friends', 'gaming'] : ['dating', 'friends', 'gaming']; const ML = { dating: '❤️ Dating', friends: '🤝 Friends', gaming: '🎮 Gaming' };
  const dOnly = m => m === 'dating' ? ` data-dating-only${datingOn ? '' : ' hidden'}` : '';
  const row = (k, [label, kind, opts]) => { if (minor && ['income', 'kids'].includes(k)) return ''; const cur = p.f?.[k] ?? p[k];
    const input = kind === 'select' ? `<select data-pf="${k}" aria-label="${esc(label)}"><option value="">—</option>${opts.map(o => `<option ${cur === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : bubbles(k, opts, cur, kind === 'bubbles1');
    const acc = [].concat(p.accept?.[k] ?? []);
    return `<div class="card pf-row" data-k="${k}"><div class="row gap"><b class="grow">${esc(label)}</b><label class="small"><input type="checkbox" data-skip="${k}" ${p.skip?.[k] ? 'checked' : ''} style="width:auto"> I don't want to answer this</label></div>${input}
      <div class="row gap small"><label>Importance <select data-imp="${k}">${Object.entries(IMP_L).map(([v, l]) => `<option value="${v}" ${(p.importance?.[k] ?? 'mid') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label><input type="checkbox" data-db="${k}" ${p.dealBreakers?.[k] ? 'checked' : ''} style="width:auto"> Deal breaker</label><label><input type="checkbox" data-aftermatch="${k}" ${p.reveal?.['field.' + k] === 'match' ? 'checked' : ''} style="width:auto"> Only after match</label><label><input type="checkbox" data-hide="${k}" ${p.hidden?.[k] ? 'checked' : ''} style="width:auto"> Hide on my profile</label></div>
      <div class="pf-acc" data-accwrap="${k}" ${p.dealBreakers?.[k] ? '' : 'hidden'}><div class="muted small">Deal breaker — only match people who are:</div>${bubbles('acc-' + k, opts, acc, false).replace('data-bub="acc-' + k + '"', 'data-bub="acc-' + k + '" data-acc="' + k + '"')}<div class="muted small">Nothing picked = must match your own answer.</div></div></div>`; };
  const ar = m => MV.ageRangeFor(p, m) || MV.clampRange(p, [null, null]), [B0, B1] = minor ? MV.BAND.minor : MV.BAND.adult;
  const modeBox = m => `<div class="card mode-prefs" data-modeprefs="${m}"${dOnly(m)}><b>${ML[m]}</b>
      <div class="row gap small"><label>Ages <input type="number" data-ar="${m}.0" min="${B0}" max="${B1}" value="${ar(m)[0]}" style="width:4.6em" aria-label="${m} minimum age"></label><label>to <input type="number" data-ar="${m}.1" min="${B0}" max="${B1}" value="${ar(m)[1]}" style="width:4.6em" aria-label="${m} maximum age"></label>
      <label>Min match <input type="number" data-mm="${m}" min="0" max="100" value="${MV.minFor(p, m)}" style="width:4.6em">%</label></div>
      <div class="row gap small cmp" role="radiogroup" aria-label="${m} compare style">${['soft', 'hard'].map(h => `<label class="chip"><input type="radio" name="cmp-${m}" data-cmp="${m}" value="${h}" ${MV.compareFor(p, m) === h ? 'checked' : ''}><span>${h === 'soft' ? 'Soft compare (categories)' : 'Hard compare (exact + partial)'}</span></label>`).join('')}</div>
      ${m === 'dating' ? '<p class="muted small">Dating only: who you want to date (gender) and this age range. Friends and Gaming have no gender filter.</p>' : ''}</div>`;
  return `<div class="card glass3d" id="mprefs"><h4>🎯 Matching</h4>
    ${minor ? '<p class="muted small" data-minor-note>Under 18: Dating isn\'t available, and Friends only ever match you with other teens (13–17). Games can include 18+ players (no chat or voice across ages) unless a parent turns that off.</p>' : `<label class="small"><input type="checkbox" id="dating-on" ${datingOn ? 'checked' : ''} style="width:auto"> ❤️ Dating enabled (turn off anytime)</label>`}
    ${modes.map(modeBox).join('')}
    <p class="muted small">Soft compare matches categories (both religious = match). Hard compare scores each item with partial credit, plus bonus points for the same specific games.</p>
    <p class="muted small">Interests: ${(p.interests || []).length}/${MV.INTEREST_CAP} max · type to add, ✕ to remove. Deal breakers are on/off. Hidden answers stay private.</p>
    ${Object.entries(PREF_FIELDS).map(([k, d]) => row(k, d)).join('')}</div>`; }
export function wirePrefs(root) { root.querySelectorAll('[data-bub]').forEach(g => g.querySelectorAll('button').forEach(b => b.onclick = () => { if (g.dataset.one) g.querySelectorAll('button').forEach(x => x !== b && x.classList.remove('on')); b.classList.toggle('on'); b.setAttribute('aria-pressed', b.classList.contains('on')); }));
  root.querySelectorAll('[data-db]').forEach(c => c.onchange = () => { const w = root.querySelector(`[data-accwrap="${c.dataset.db}"]`); if (w) w.hidden = !c.checked; });
  const d = root.querySelector('#dating-on'), lf = root.querySelector('#f_lookingFor input[value="dating"]'); // the two Dating switches stay in sync
  const show = on => root.querySelectorAll('[data-dating-only]').forEach(e => e.hidden = !on); // dating-only fields appear/disappear live
  if (d) d.onchange = () => { show(d.checked); if (lf) lf.checked = d.checked; }; if (lf && d) lf.addEventListener('change', () => { d.checked = lf.checked; show(lf.checked); }); }
export function readPrefs(root, p) { const q = s => [...root.querySelectorAll(s)]; p.f ||= {}; p.importance ||= {}; p.dealBreakers ||= {}; p.hidden ||= {}; p.skip ||= {}; p.accept ||= {};
  for (const k of Object.keys(PREF_FIELDS)) { const sel = root.querySelector(`[data-pf="${k}"]`), bg = root.querySelector(`[data-bub="${k}"]`);
    if (sel) p.f[k] = sel.value || null; if (bg) { const on = [...bg.querySelectorAll('button.on')].map(b => b.dataset.v); p.f[k] = bg.dataset.one ? on[0] || null : on; }
    const im = root.querySelector(`[data-imp="${k}"]`); if (im) p.importance[k] = im.value; const db = root.querySelector(`[data-db="${k}"]`); if (db) { if (db.checked) p.dealBreakers[k] = true; else delete p.dealBreakers[k]; }
    const ac = root.querySelector(`[data-acc="${k}"]`); if (ac) { const on = [...ac.querySelectorAll('button.on')].map(b => b.dataset.v); if (on.length && p.dealBreakers[k]) p.accept[k] = on; else delete p.accept[k]; }
    const hd = root.querySelector(`[data-hide="${k}"]`); if (hd) p.hidden[k] = hd.checked; const sk = root.querySelector(`[data-skip="${k}"]`); if (sk) p.skip[k] = sk.checked; }
  p.ageRanges ||= {}; q('[data-ar]').forEach(i => { const [m, j] = i.dataset.ar.split('.'); (p.ageRanges[m] ||= [null, null])[+j] = i.value === '' ? null : +i.value; });
  for (const m of Object.keys(p.ageRanges)) p.ageRanges[m] = MV.clampRange(p, p.ageRanges[m]); // v33: always inside the user's own age band, low<=high
  if (p.ageRanges.dating && !minorOf(p)) [p.ageMin, p.ageMax] = p.ageRanges.dating; // keep the onboarding (legacy) dating range in sync
  p.minMatch ||= {}; q('[data-mm]').forEach(i => p.minMatch[i.dataset.mm] = Math.max(0, Math.min(100, Math.round(+i.value || 0))));
  p.compare ||= {}; q('[data-cmp]:checked').forEach(i => p.compare[i.dataset.cmp] = i.value === 'soft' ? 'soft' : 'hard');
  const d = root.querySelector('#dating-on'); if (d && !minorOf(p)) { p.datingOff = !d.checked; if (d.checked && !(p.lookingFor || []).includes('dating')) p.lookingFor = [...(p.lookingFor || []), 'dating']; if (!d.checked) p.lookingFor = (p.lookingFor || []).filter(m => m !== 'dating'); }
  if (minorOf(p)) { p.lookingFor = (p.lookingFor || []).filter(m => m !== 'dating'); delete p.seekingGenders; delete p.orientation; delete p.ageRanges.dating; delete p.minMatch.dating; delete p.compare.dating; delete p.ageMin; delete p.ageMax; }
  const c = MV.capInterests(p.interests); p.interests = c.list; return { droppedInterests: c.dropped }; }
// ---- §3 starter characters
export const presetsHTML = cur => `<div class="card"><h4>Starter characters</h4><div class="preset-grid">${PH.PRESETS.map(x => `<button type="button" data-preset="${x.id}" class="${cur === x.id ? 'on' : ''}" aria-label="${esc(x.label)}"><img src="${PH.presetURL(x.id)}" alt=""><span class="small">${esc(x.label)}</span></button>`).join('')}</div><p class="muted small">Up to 4 photos are shown. Add more and they rotate each login/logout — extras stay on this phone.</p></div>`;
// ---- §13 favorite games + LFG board, §14 events
export function favGamesHTML(p) { return `<div class="card"><h4>🎮 Favorite multiplayer games</h4><div id="fg-list">${(p.favGames || []).map((f, i) => `<span class="chip">${esc(f.console)} · ${esc(f.game)} <button type="button" data-fgdel="${i}" aria-label="remove">✕</button></span>`).join('') || '<span class="muted small">none yet</span>'}</div>
  <div class="row gap"><select id="fg-c">${LF.CONSOLES.map(c => `<option>${esc(c)}</option>`).join('')}</select><select id="fg-g">${LF.MP_GAMES.map(g => `<option>${esc(g)}</option>`).join('')}</select><button type="button" id="fg-add">Add</button></div></div>`; }
export function wireFavGames(root, p, save) { root.querySelector('#fg-add')?.addEventListener('click', async () => { LF.setFavorites(p, [...(p.favGames || []), { console: root.querySelector('#fg-c').value, game: root.querySelector('#fg-g').value }]); await save(); });
  root.querySelectorAll('[data-fgdel]').forEach(b => b.onclick = async () => { p.favGames.splice(+b.dataset.fgdel, 1); await save(); }); }
export async function lfgSection(el, me, transport) { const store = LF.lfgStore(transport, me), list = await LF.boardFor(store, me);
  el.innerHTML = `<div class="card glass3d"><h3>📣 Looking for group</h3><form id="lfg-f" class="row gap"><select id="lfg-g">${LF.MP_GAMES.map(g => `<option>${esc(g)}</option>`).join('')}</select><select id="lfg-c">${LF.CONSOLES.map(c => `<option>${esc(c)}</option>`).join('')}</select><input id="lfg-n" type="number" min="1" max="10" value="2" style="width:4em" aria-label="players needed"><label class="small"><input id="lfg-mic" type="checkbox" style="width:auto"> mic</label><input id="lfg-note" maxlength="200" placeholder="Note (rank, region…)"><button class="primary">Post</button></form>
  ${list.map(r => `<div class="card row gap small"><b class="grow">${esc(r.title)}</b><span>${esc(r.console || '')}</span>${r.mic ? '🎙' : ''}<span class="muted">${esc(r.name)}</span>${r.owner === me.code ? '' : `<button data-lfgrep="${esc(r.owner)}" class="small">⚑</button>`}</div>${r.note ? `<div class="muted small">${esc(r.note)}</div>` : ''}`).join('') || '<p class="muted small">No groups posted in your age group right now. Posts expire after 6 h.</p>'}</div>`;
  el.querySelector('#lfg-f').onsubmit = async e => { e.preventDefault(); await LF.postLFG(store, me, { game: el.querySelector('#lfg-g').value, console: el.querySelector('#lfg-c').value, need: +el.querySelector('#lfg-n').value, mic: el.querySelector('#lfg-mic').checked, note: el.querySelector('#lfg-note').value }); lfgSection(el, me, transport); };
  return list.length; }
export async function eventsSection(el, me, transport) { const store = LF.eventStore(transport, me), list = await LF.eventsFor(store, me);
  el.innerHTML = `<div class="card glass3d"><h3>🎟 Events</h3><form id="ev-f" class="row gap"><input id="ev-t" maxlength="80" placeholder="e.g. Neon Lights concert" required><select id="ev-ty">${LF.EVENT_TYPES.map(t => `<option>${esc(t)}</option>`).join('')}</select><input id="ev-w" type="datetime-local" required><input id="ev-c" maxlength="60" placeholder="City"><button class="primary">Create event</button></form>
  ${list.map(r => `<div class="card small row gap ${r.match ? 'boosted' : ''}"><b class="grow">${esc(r.title)}</b><span class="chip">${esc(r.type)}</span><span>${new Date(r.when).toLocaleString()}</span><span class="muted">${esc(r.city)} · ${esc(r.name)}</span></div>`).join('') || '<p class="muted small">No events yet. Events are shown to people who like that kind of event.</p>'}</div>`;
  el.querySelector('#ev-f').onsubmit = async e => { e.preventDefault(); const r = await LF.createEvent(store, me, { title: el.querySelector('#ev-t').value, type: el.querySelector('#ev-ty').value, when: el.querySelector('#ev-w').value, city: el.querySelector('#ev-c').value }); if (!r.ok) alert('Event needs a title, type and a future date (max 60 days).'); eventsSection(el, me, transport); };
  return list.length; }
