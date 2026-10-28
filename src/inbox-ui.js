// Single inbox (all modes), mood picker/badge, parent controls, Recently online, chat extras (retention, calls, ✓).
import { mesh } from './app-mesh.js';
import { MODE_ICON } from './nav-icons.js';
import { MOODS, moodsFor, badge, shouldAsk } from './mood.js';
import { makeOrder } from './inbox-order.js';
import { RETENTION, effective, minorLocked } from './retention.js';
import { TOGGLES } from './parental.js';
import { isMinor } from './discovery.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const av = (p, n = 40) => p?.thumb ? `<img src="${esc(p.thumb)}" width="${n}" height="${n}" alt="" style="border-radius:50%">` : `<div class="av" style="width:${n}px;height:${n}px;font-size:${Math.round(n * .38)}px">${esc((p?.name || '?').slice(0, 2).toUpperCase())}</div>`;
export const modeIcon = md => `<span class="mode-ic" role="img" aria-label="${esc((md || 'friends') + ' chat')}">${MODE_ICON[md] || MODE_ICON.friends}</span>`;
export const agoLabel = (t, now = Date.now()) => { const h = Math.floor((now - t) / 36e5); return h < 1 ? 'Active <1h ago' : 'Active ' + h + 'h ago'; };

// Rows: pending requests first (boosted highlighted), then chats/friends. Minors never get dating rows.
const ago = t => { const s2 = (Date.now() - t) / 1000; return s2 < 60 ? 'now' : s2 < 3600 ? Math.floor(s2 / 60) + 'm' : s2 < 86400 ? Math.floor(s2 / 3600) + 'h' : new Date(t).toLocaleDateString(); };
export function inboxRows(m, me) {
  const n = m.node, minor = isMinor(me), now = Date.now(); const viewOf = c => n.view(c) || { code: c, name: c, status: 'offline' };
  const modeOf = c => n.chats.get(c)?.mode || 'friends'; const okMode = c => !(minor && modeOf(c) === 'dating');
  const reqs = [...n.pendingIn.keys()].filter(okMode).map(c => ({ kind: 'req', code: c, v: viewOf(c), mode: modeOf(c), boosted: !!n.boosted?.has(c), at: n.reqAt?.get(c) || now }))
    .sort((a, b) => (b.boosted - a.boosted) || (b.at - a.at));
  const codes = new Set([...n.chats.keys(), ...n.friends.keys()]); for (const r of reqs) codes.delete(r.code);
  const chats = [...codes].filter(c => !n.blocked.has(c) && okMode(c)).map(c => { const ch = n.chats.get(c); const last = ch?.msgs.at(-1);
    return { kind: 'chat', code: c, v: viewOf(c), mode: modeOf(c), friend: n.friends.has(c), last, at: last?.at || 0, pending: (ch?.msgs || []).filter(x => x.state === 'pending').length, mood: m.moodOf?.(c), boostId: [...(ch?.msgs || [])].reverse().find(x => x.boost && x.from !== n.code)?.id || null }; });
  const ordered = (inboxRows.order ||= makeOrder()).apply(chats); chats.length = 0; chats.push(...ordered);
  return { reqs, chats, blocked: [...n.blocked] };
}
export function inboxSection(me) {
  const m = mesh(); if (!m) return '<div class="card small muted">Live mesh is starting…</div>';
  const { reqs, chats, blocked } = inboxRows(m, me); const nm = v => esc(v.full ? v.profile.name : v.name);
  return `<div data-mesh="inbox"><h2>Inbox</h2>
    ${reqs.length ? `<h3 class="small">Requests (${reqs.length})</h3>${reqs.map(r => `<div class="card row req ${r.boosted ? 'boosted' : ''}" data-req="${r.code}">${av(r.v.full ? r.v.profile : r.v)}<div class="grow"><b>${nm(r.v)}</b>${r.boosted ? ' <span class="tag hot">⚡ boosted</span>' : ''}<div class="muted small">Wants to connect · no messages until you accept</div></div><button class="primary" data-maccept="${r.code}">Accept</button><button class="ghost" data-mdecline="${r.code}">Decline</button>${modeIcon(r.mode)}</div>`).join('')}` : ''}
    ${chats.map(c => `<div class="card row conv" data-mopen="${c.code}">${av(c.v.full ? c.v.profile : c.v)}<div class="grow"><b>${nm(c.v)}</b>${c.friend ? ' <span class="fbadge" aria-label="Friend">👥 friend</span>' : ''} ${c.mood ? badge(c.mood) : ''}<div class="muted small">${c.v.full ? '🟢 online' : esc(c.v.status || '')}${c.pending ? ` · ${c.pending} pending` : ''}${c.last ? ' · ' + esc(c.last.text?.slice(0, 50) || '') : ''}</div></div>${c.last?.at ? `<time class="muted small" datetime="${new Date(c.last.at).toISOString()}">${ago(c.last.at)}</time>` : ''}${modeIcon(c.mode)}</div>`).join('') || (reqs.length ? '' : '<p class="muted small">No chats yet. Find people in Discover and send a connection request.</p>')}
    ${blocked.length ? `<details class="card small"><summary>Blocked (${blocked.length})</summary>${blocked.map(c => `<div class="row gap"><span class="muted">#${esc(c)}</span><button data-munblock="${c}">Unblock</button></div>`).join('')}</details>` : ''}</div>`;
}
export function wireInbox(root, st, render) {
  const m = mesh(); if (!m) return;
  root.querySelectorAll('[data-maccept]').forEach(b => b.onclick = async e => { e.stopPropagation(); await m.accept(b.dataset.maccept); render(); });
  root.querySelectorAll('[data-mdecline]').forEach(b => b.onclick = e => { e.stopPropagation(); m.decline(b.dataset.mdecline); render(); });
  root.querySelectorAll('[data-munblock]').forEach(b => b.onclick = async () => { await m.unblock(b.dataset.munblock); render(); });
  root.querySelectorAll('[data-mopen]').forEach(e => e.onclick = () => { st.meshChat = e.dataset.mopen; render(); });
}

// Mood: picker once per session after the first mesh join; session-only (never persisted).
export function maybeAskMood(me) { const m = mesh(); if (!m || m.mood() || document.getElementById('moodpick') || !shouldAsk()) return; openMoodPicker(me); }
export function openMoodPicker(me, after = () => {}) {
  const m = mesh(); if (!m) return; const d = document.createElement('div'); d.id = 'moodpick'; d.className = 'modal'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Pick your mood');
  const opts = moodsFor(isMinor(me)); // DROPDOWN (select): one compact control, keyboard/VoiceOver friendly
  d.innerHTML = `<div class="card"><h3>What's your mood?</h3><p class="muted small">Shown as a badge next to your name while you're online. Cleared when you log off.</p><label class="small" for="moodsel">Mood</label><select id="moodsel" aria-label="Mood"><option value="">— pick a mood —</option>${opts.map(x => `<option value="${x.id}"${m.mood() === x.id ? ' selected' : ''}>${x.icon} ${esc(x.label)}</option>`).join('')}</select><div class="row gap"><button id="moodok">Set mood</button><button id="moodskip" class="ghost">Skip</button>${m.mood() ? '<button id="moodclear" class="ghost">Clear mood</button>' : ''}</div></div>`;
  document.body.append(d); const close = () => { d.remove(); refreshHeaderMood(); after(); };
  const sel = d.querySelector('#moodsel'); d.querySelector('#moodok').onclick = () => { if (sel.value) m.setMood(sel.value); close(); };
  d.querySelector('#moodskip').onclick = close; d.querySelector('#moodclear')?.addEventListener('click', () => { m.setMood(null); close(); });
}
// header badge next to my name/avatar (updated whenever the mood changes)
export function headerMood() { const m = mesh(); return `<span id="hdr-mood">${m?.mood?.() ? badge(m.mood()) : ''}</span>`; }
export function refreshHeaderMood() { const el = document.getElementById('hdr-mood'); if (el) el.outerHTML = headerMood(); }
export function moodProfileCard() { const m = mesh(); if (!m) return ''; return `<div class="card row gap" data-moodcard><b>Mood</b> ${m.mood() ? badge(m.mood()) : '<span class="muted small">none</span>'}<button id="moodchange">Change</button></div>`; }

// Parent controls (minors): header button → PIN → toggles. Messaging can never be disabled.
export const parentButton = me => isMinor(me) && mesh() ? '<button id="parentbtn" class="parentbtn" aria-label="Parent controls">👪</button>' : '';
export async function openParent() {
  const m = mesh(); if (!m) return; const P = m.parent;
  if (!(await P.hasPin())) { const pin = prompt('Parent: set a 4-digit PIN for these controls'); if (!pin) return; try { await P.setPin(pin); P.unlockedUntil = Date.now() + 5 * 60e3; } catch (e) { return alert(e.message); } }
  else if (!P.isUnlocked()) { const r = await P.unlock(prompt('Parent PIN') || ''); if (!r.ok) return alert(r.reason === 'locked' ? 'Too many wrong PINs. Locked until ' + new Date(r.until).toLocaleTimeString() : 'Wrong PIN (' + r.left + ' tries left)'); }
  const d = document.createElement('div'); d.className = 'modal'; d.id = 'parentmodal';
  d.innerHTML = `<div class="card"><h3>👪 Parent controls</h3>${(await Promise.all(Object.entries(TOGGLES).map(async ([k, l]) => `<label class="row gap"><input type="checkbox" data-pt="${k}" ${await P.allowed(k) ? 'checked' : ''}> ${esc(l)}</label>`))).join('')}<p class="muted small">Messaging always stays on.</p><button id="ptclose" class="primary">Done</button></div>`;
  document.body.append(d); d.querySelectorAll('[data-pt]').forEach(c => c.onchange = () => P.set(c.dataset.pt, c.checked).catch(e => alert(e.message))); d.querySelector('#ptclose').onclick = () => { P.lock(); d.remove(); };
}

// Recently online: from the server's rolling list. Display-only, honest "Active Xh ago" — never "live".
export async function recentSection(el, me, mode) {
  const m = mesh(); if (!m || !el) return; const live = new Set(m.online?.().map(x => x.code || x) || []);
  const list = (await m.recent(mode)).filter(e => !live.has(e.code));
  el.innerHTML = list.length ? `<h4>Recently online</h4>${list.slice(0, 30).map(e => `<div class="card row recent" data-recent="${esc(e.code)}">${av(e)}<div class="grow"><b>${esc(e.name)}</b> <span class="muted small">${agoLabel(e.lastSeen)}</span><div class="muted small">${esc(e.interests.join(', '))}</div></div><button data-mchat="${esc(e.code)}">View</button></div>`).join('')}<p class="muted small">Not live. Connecting still needs them to accept your request.</p>` : '';
}

// Chat extras: retention bubbles, call buttons, pending/✓.
export const tick = x => x.state === 'pending' ? ' <span class="pending" aria-label="pending">⏳</span>' : x.state === 'delivered' ? ' <span aria-label="delivered">✓</span>' : '';
export function retentionBar(node, c, me) {
  const minor = minorLocked(me) || isMinor(me); const r = node.chat(c).ret || {}; const eff = effective({ mine: r.mine, theirs: r.theirs, minor });
  if (minor) return `<div class="card small" data-ret>💾 Chat saving: <b>always kept</b> (under 18 — no option).</div>`;
  return `<div class="card small" data-ret>💾 Chat saving (both must pick the same): ${Object.entries(RETENTION).map(([k, l]) => `<button class="chip ${r.mine === k ? 'on' : ''}" data-ropt="${k}" aria-pressed="${r.mine === k}">${esc(l)}${r.theirs === k ? ' · they picked' : ''}</button>`).join(' ')}<div class="muted">Agreed: ${esc(RETENTION[eff])}. Visible history follows this choice. Every option keeps an encrypted 7-day safety copy for reports.</div></div>`;
}
export function callBar(m, c) { const L = m.links?.get(c); if (!m.node.friends.has(c)) return '';
  if (!L?.up) return `<div class="small muted" data-call>📞 Calls open once a direct link connects.</div>`;
  if (L.call?.state === 'ringing') return `<div class="card row gap" data-call>📞 Incoming ${L.call.video ? 'video' : 'voice'} call <button class="primary" id="cacc">Accept</button><button id="cdec">Decline</button></div>`;
  if (L.call) return `<div class="card row gap" data-call>📞 ${esc(L.call.state)} <button id="cmute">Mute</button><button id="chang" class="primary">Hang up</button><video id="cvid" autoplay playsinline style="max-width:120px"></video></div>`;
  return `<div class="row gap" data-call><button id="cvoice">📞 Voice</button><button id="cvideo">🎥 Video</button></div>`; }
export function wireChatExtras(v, m, c, render) { const q = s => v.querySelector(s), L = m.links?.get(c);
  v.querySelectorAll('[data-ropt]').forEach(b => b.onclick = () => { m.setRetention(c, b.dataset.ropt); render(); });
  const go = async video => { const g = await m.callGate(c, video); if (!g.ok) return alert('Call not available: ' + g.reason); await L.start({ video, gate: g }).catch(e => alert(e.message)); render(); };
  q('#cvoice') && (q('#cvoice').onclick = () => go(false)); q('#cvideo') && (q('#cvideo').onclick = () => go(true));
  q('#cacc') && (q('#cacc').onclick = async () => { await L.accept({ gate: await m.callGate(c, L.call.video) }); render(); }); q('#cdec') && (q('#cdec').onclick = () => { L.decline(); render(); });
  q('#chang') && (q('#chang').onclick = () => { L.hangup(); render(); }); q('#cmute') && (q('#cmute').onclick = e => { e.target.textContent = L.mute(e.target.textContent === 'Mute') ? 'Mute' : 'Unmute'; });
  if (q('#cvid') && L?.remote) q('#cvid').srcObject = L.remote;
  m.link(c); }
export { MOODS };
// profile "Change mood" (delegated so profile() needs no extra wiring)
globalThis.document?.addEventListener('click', e => { if (e.target?.id === 'moodchange') import('./store.js').then(async ({ db }) => openMoodPicker(await db.getProfile(await db.getCurrentUserId()), () => document.querySelector('nav button.on')?.click())).catch(() => openMoodPicker(null)); });
// ---- FRIENDS TAB: every accepted friend in one place (avatar, online / last active, mood, mode) + quick actions, and the
// pending incoming / outgoing requests. Reuses the mesh node's friends / pendingIn / pendingOut / cache (no new data).
const lastActive = t => { if (!t) return 'offline'; const s2 = (Date.now() - t) / 1000; return s2 < 120 ? 'active just now' : s2 < 3600 ? `active ${Math.floor(s2 / 60)}m ago` : s2 < 86400 ? `active ${Math.floor(s2 / 3600)}h ago` : `active ${Math.floor(s2 / 86400)}d ago`; };
export function friendRows(m) { const n = m.node, view = c => n.view(c) || { code: c, name: c, status: 'offline' }, mode = c => n.chats.get(c)?.mode || 'friends';
  const friends = [...n.friends.keys()].filter(c => !n.blocked.has(c)).map(c => { const v = view(c), seen = n.cache?.get(c)?.lastSeen || 0; return { code: c, v, online: !!v.full || (n.isOnline?.(c) ?? false), seen, mood: m.moodOf?.(c), mode: mode(c) }; })
    .sort((a, b) => (b.online - a.online) || (b.seen - a.seen) || (a.code < b.code ? -1 : 1));
  return { friends, incoming: [...n.pendingIn.keys()].map(c => ({ code: c, v: view(c), mode: mode(c), boosted: !!n.boosted?.has(c) })), outgoing: [...(n.pendingOut || [])].map(c => ({ code: c, v: view(c), mode: mode(c) })) }; }
export function friendsSection() { const m = mesh(); if (!m) return '<div class="card small muted">Live mesh is starting…</div>'; const { friends, incoming, outgoing } = friendRows(m), nm = v => esc(v.full ? v.profile.name : v.name);
  return `<div data-friends><h2>Friends (${friends.length})</h2>
    ${friends.map(f => `<div class="card row friend" data-fopen="${f.code}">${av(f.v.full ? f.v.profile : f.v)}<div class="grow"><b>${nm(f.v)}</b> ${f.mood ? badge(f.mood) : ''}<div class="muted small">${f.online ? '🟢 online' : '⚪ ' + lastActive(f.seen)}</div></div>${modeIcon(f.mode)}<button class="small" data-fmsg="${f.code}" aria-label="Message">💬</button><button class="small" data-finvite="${f.code}" aria-label="Invite to a game">🕹</button></div>`).join('') || '<p class="muted small">No friends yet — send connection requests from Discover.</p>'}
    <h3 class="small">Requests</h3>${incoming.map(r => `<div class="card row req ${r.boosted ? 'boosted' : ''}">${av(r.v.full ? r.v.profile : r.v)}<div class="grow"><b>${nm(r.v)}</b><div class="muted small">wants to connect</div></div>${modeIcon(r.mode)}<button class="primary small" data-maccept="${r.code}">Accept</button><button class="ghost small" data-mdecline="${r.code}">Decline</button></div>`).join('') || '<p class="muted small">No incoming requests.</p>'}
    ${outgoing.map(r => `<div class="card row">${av(r.v.full ? r.v.profile : r.v)}<div class="grow"><b>${nm(r.v)}</b><div class="muted small">request sent · waiting</div></div>${modeIcon(r.mode)}</div>`).join('')}</div>`; }
export function wireFriends(root, st, render) { const m = mesh(); if (!m) return;
  const open = c => { st.tab = 'inbox'; st.meshChat = c; render(); }; // tapping a friend opens Messages with that chat open
  root.querySelectorAll('[data-fopen]').forEach(e => e.onclick = () => open(e.dataset.fopen)); root.querySelectorAll('[data-fmsg]').forEach(b => b.onclick = e => { e.stopPropagation(); open(b.dataset.fmsg); });
  root.querySelectorAll('[data-finvite]').forEach(b => b.onclick = e => { e.stopPropagation(); try { m.node.sendChat(b.dataset.finvite, '🕹 Want to play? Join me in the Arcade!'); } catch {} open(b.dataset.finvite); });
  root.querySelectorAll('[data-maccept]').forEach(b => b.onclick = async e => { e.stopPropagation(); await m.accept(b.dataset.maccept); render(); }); root.querySelectorAll('[data-mdecline]').forEach(b => b.onclick = e => { e.stopPropagation(); m.decline(b.dataset.mdecline); render(); }); }
