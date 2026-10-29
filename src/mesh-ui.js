// Mesh-backed sections of Discover / Chats / Profile / Dev.
import { mesh } from './app-mesh.js';
import { retentionBar, callBar, wireChatExtras, tick } from './inbox-ui.js';
import { badge } from './mood.js';
import { STARTER_MAX } from './mesh.js';
import { REPORT_REASONS, submitReport, SAFETY_CONTACT } from './compliance.js';
import { supabaseBackend } from './kv-store.js';
const CSAM_REASON = 'illegal content (incl. child abuse)'; // = evidence.js CSAM_REASON (kept inline so evidence.js stays a lazy chunk)
// Report flow: reason + optional evidence (only what the reporter explicitly agrees to attach). Also blocks if asked.
export async function reportFlow(m, code, excerpt = '', context = excerpt ? 'chat' : 'profile', game = null) {
  const n = prompt('Report #' + code + ' — reason number:\n' + REPORT_REASONS.map((r, i) => `${i + 1}. ${r}`).join('\n'), '1'); const reason = REPORT_REASONS[Number(n) - 1]; if (!reason) return null;
  // v45: child-safety reports never carry a plaintext excerpt; the phone seals what it holds for the safety team instead (src/evidence.js)
  const csam = reason === CSAM_REASON, ev = !csam && excerpt && confirm('Attach the last messages from this chat as evidence? (only this excerpt is sent)') ? excerpt : '';
  const evRef = csam ? 'ev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) : null;
  const bundle = csam ? await import('./evidence.js').then(E => E.collectEvidence({ m, code, reason, context, game })).catch(() => null) : null;
  import('./reports.js').then(R => R.fileReport({ reporter: m.code, reported: code, reason, context, excerpt: ev, game })).catch(() => {}); // local reports bucket (moderation queue)
  const r = await submitReport({ reporter: m.code, reported: code, reason, excerpt: ev, evidenceRef: bundle ? evRef : null });
  let sealed = null; if (bundle) sealed = await import('./evidence.js').then(E => E.preserveForReport({ store: supabaseBackend()?.store, reportId: r.queued ? null : r.id, bundle, ref: evRef })).catch(() => null);
  if (r) r.evidence = sealed;
  alert((r.ok ? (r.queued ? 'Report saved (queued until the server is configured).' : 'Report sent.') : 'Report failed (' + r.status + ').')
    + (csam ? ` The messages and media this phone holds from #${code} were ${sealed?.ok ? 'sealed and sent to the safety team only' : 'sealed on this phone for the safety team and will be sent as soon as possible'} (nobody else can see them; please do not screenshot or forward anything).` : '')
    + (reason.startsWith('illegal') ? ' If a child is in danger call 911 / local police, and report to NCMEC CyberTipline: report.cybertip.org.' : '') + ' Contact: ' + SAFETY_CONTACT);
  if (confirm('Also block this person?')) await m.block(code); return r;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const av = (p, size = 44) => p?.thumb ? `<img src="${esc(p.thumb)}" width="${size}" height="${size}" style="image-rendering:pixelated;border-radius:50%">`
  : `<div class="av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;background:linear-gradient(135deg,hsl(${p?.avatarHue ?? 200} 85% 60%),hsl(${((p?.avatarHue ?? 200) + 60) % 360} 80% 45%))">${esc((p?.name || '?').slice(0, 2).toUpperCase())}</div>`;
const nameOf = v => v.full ? v.profile.name : v.name;
const notMesh = '<div class="card small muted">Live mesh is starting…</div>';

export function discoverSection() {
  const m = mesh(); if (!m) return notMesh;
  const ps = m.peers().filter(p => !m.passed?.has(p.code)); const on = ps.filter(p => p.full), off = ps.filter(p => !p.full);
  return `<div class="card" data-mesh="discover"><h3>🟢 Live now on the mesh (${on.length})</h3><p class="muted small">Real peers on ${esc(m.transport)}. Full profiles only while they're online.</p>${on.length ? '' : '<p class="small" data-mesh="node-online">🟢 You\'re online as a mesh node. No other peers yet — you\'ll see people here as soon as they join.</p>'}
    ${on.map(v => `<div class="card row" data-peer="${v.code}">${av(v.profile)}<div class="grow"><b>${esc(v.profile.name)}</b>${v.profile.age ? ', ' + v.profile.age : ''} ${badge(m.moodOf?.(v.code))} <span class="tag hot">online</span> <span class="muted small">#${v.code}</span>${v.unverified ? ' <span class="muted small" title="Signature check pending">· verifying…</span>' : ''}<div class="muted small">${esc([v.profile.city, v.profile.countryCode].filter(Boolean).join(', '))} · ${esc((v.profile.games || []).slice(0, 3).join(', '))}</div><div class="small">${esc(v.profile.bio || '')}</div></div>
      <div class="col gap"><button class="primary" data-mchat="${v.code}">Message</button><button data-mview="${v.code}">View profile</button><button class="ghost" data-mpass="${v.code}">✕ Pass</button>${m.node.friends.has(v.code) ? '<span class="small">👥 friend</span>' : `<button data-mfriend="${v.code}">Add friend</button>`}<button class="ghost" data-mreport="${v.code}">Report</button><button data-mblock="${v.code}" class="ghost">Block</button></div></div>`).join('') || '<p class="muted small">Nobody else online right now. Open another tab with <code>?as=seed-3</code> to test locally.</p>'}
    <div id="recentlist" data-mesh="recent"></div></div>`;
}
export function wireDiscover(root, st, render) {
  const m = mesh(); if (!m) return;
  root.querySelectorAll('[data-mchat]').forEach(b => b.onclick = () => { st.tab = 'inbox'; st.meshChat = b.dataset.mchat; render(); });
  root.querySelectorAll('[data-mfriend]').forEach(b => b.onclick = () => { m.requestFriend(b.dataset.mfriend); b.textContent = 'Requested'; b.disabled = true; });
  root.querySelectorAll('[data-mview]').forEach(b => b.onclick = async () => { const DV = await import('./discover-view.js'), c = b.dataset.mview, host = b.closest('[data-peer]'); await DV.loadingProfile(host, () => m.openProfile(c), { onBack: () => render(), onTalk: () => { m.like?.(c); st.tab = 'inbox'; st.meshChat = c; render(); } }); });
  root.querySelectorAll('[data-mpass]').forEach(b => b.onclick = () => { m.pass(b.dataset.mpass); render(); }); // swipe-left equivalent: off my network both ways
  root.querySelectorAll('[data-mreport]').forEach(b => b.onclick = async () => { await reportFlow(m, b.dataset.mreport); render(); });
  root.querySelectorAll('[data-mblock]').forEach(b => b.onclick = async () => { if (confirm('Block this person? Their messages will be dropped.')) { await m.block(b.dataset.mblock); render(); } });
}
export function chatsList() {
  const m = mesh(); if (!m) return '';
  const cs = [...m.node.chats.entries()]; if (!cs.length) return '';
  return `<h3>⚡ Live chats</h3>${cs.map(([c, ch]) => { const v = m.node.view(c) || { name: c, status: '?' }; const last = ch.msgs[ch.msgs.length - 1];
    return `<div class="card row conv" data-mopen="${c}">${av(v.full ? v.profile : v, 40)}<div class="grow"><b>${esc(nameOf(v))}</b> <span class="muted small">${v.full ? 'online' : esc(v.status)}</span><div class="muted small">${esc(last?.text?.slice(0, 60) || '')}</div></div></div>`; }).join('')}`;
}
export async function chatView(v, st, render, vault, me) {
  const m = mesh(), c = st.meshChat, node = m.node; const pv = node.view(c) || { full: false, name: c, status: 'unknown' };
  const ch = node.chat(c); node.markRead(c); const burn = node.burnActive(c), b = ch.burn; const plans = await node.getPlans(vault); node.chat(c); const friend = node.friends.has(c);
  v.innerHTML = `<div class="row gap"><button id="mback">← Back</button><b>${esc(nameOf(pv))}</b> <span class="muted small">#${esc(c)} · ${pv.full ? '🟢 online' : esc(pv.status)}</span></div>
    ${pv.full ? '' : '<div class="card warn small">Offline right now. Messages wait on this phone as ⏳ pending (encrypted) and send when they come back online, for up to 7 days. ✓ appears only after their phone confirms delivery.</div>'}
    <div class="chat" id="mmsgs">${ch.msgs.map(x => `<div class="bubble ${x.from === m.code ? 'mine' : ''}">${x.burn ? '🔥 ' : ''}${esc(x.text)}${x.attachment ? ' 📎' : ''}${x.from === m.code ? tick(x) : ''}${x.state === 'failed' ? `<div class="small warn">⚠ ${esc(x.notice || 'They logged off to mesh')}${x.refunded ? ' · boost refunded' : ''}</div>` : ''}</div>`).join('') || (friend ? '<p class="muted">Chats are live and not saved.</p>' : '<p class="muted">Messages open once they accept your connection request. Requests are free; a boost highlights yours.</p>')}</div>
    ${friend ? `<form id="msf" class="send"><input id="mtxt" maxlength="${STARTER_MAX}" placeholder="Message…" autocomplete="off"><button class="primary">Send</button></form>` : `<div class="row gap" id="mreq"><button class="primary" id="mreqgo" ${node.pendingOut.has(c) ? 'disabled' : ''}>${node.pendingOut.has(c) ? 'Request sent' : 'Send connection request'}</button><button id="mreqboost" ${node.pendingOut.has(c) ? 'disabled' : ''}>⚡ Boost request</button></div>`}
    <p id="mres" class="small"></p>
    ${friend ? callBar(m, c) + retentionBar(node, c, me) : ''}
    <div class="card small"><b>🔥 Burn mode</b> ${burn ? `ON (${burn / 1000}s after read)` : b.mine ? 'you proposed — waiting for them' : b.theirs ? 'they proposed' : 'off'}
      ${burn ? '<button id="mburnoff">Turn off</button>' : `<button id="mburn">${b.theirs ? 'Agree' : 'Propose'} (60s)</button>`}</div>
    <div class="card small"><b>📅 Plans note</b> (encrypted on this phone; short-lived, not a saved chat)<br><input id="mplan" maxlength="280" value="${esc(plans[c]?.text || '')}" placeholder="e.g. Halo tomorrow 8pm" style="width:70%"><button id="mplansave">Save</button>${plans[c] ? ` <span class="muted">expires ${new Date(plans[c].expires).toLocaleString()}</span>` : ''}</div>
    <div class="row gap">${friend ? '<span class="small">👥 Friends</span>' : `<button id="mfr">Add friend</button>`}<button id="msafety" class="ghost">Safety number</button><button id="mrep" class="ghost">Report</button><button id="mblk" class="ghost">Block</button></div>`;
  const q = s => v.querySelector(s), res = t => q('#mres').textContent = t;
  q('#mback').onclick = () => { st.meshChat = null; render(); };
  q('#msf') && (q('#msf').onsubmit = async e => { e.preventDefault(); const t = q('#mtxt').value.trim(); if (!t) return;
    const r = node.sendChat(c, t); if (!r.ok) return res(r.message || r.reason); render(); });
  const reqGo = async boost => { const p = m.requestFriend(c, { boost }); res('Request sent…'); const r = await p; if (r && r.ok === false) res((r.message || ({ 'no-boosts': 'Out of boosts — see Shop (mock).' }[r.reason] || r.reason)) + (r.refunded ? ' (boost refunded)' : '')); else if (r?.ok) res(boost ? 'Boosted request delivered.' : 'Request delivered.'); };
  q('#mreqgo') && (q('#mreqgo').onclick = () => reqGo(false)); q('#mreqboost') && (q('#mreqboost').onclick = () => reqGo(true));
  q('#mburn') && (q('#mburn').onclick = () => { node.proposeBurn(c, 60e3); render(); });
  q('#mburnoff') && (q('#mburnoff').onclick = () => { node.stopBurn(c); render(); });
  q('#mplansave').onclick = async () => { await node.setPlan(c, q('#mplan').value.trim(), vault); render(); };
  q('#mfr') && (q('#mfr').onclick = () => { m.requestFriend(c); q('#mfr').textContent = 'Requested'; q('#mfr').disabled = true; });
  q('#mrep').onclick = async () => { await reportFlow(m, c, ch.msgs.filter(x => x.from !== m.code).slice(-5).map(x => x.text).join('\n')); render(); };
  q('#mblk').onclick = async () => { if (confirm('Block?')) { await m.block(c); st.meshChat = null; render(); } };
  q('#msafety') && (q('#msafety').onclick = () => openSafetySheet(m, c, nameOf(pv), render));
  if (friend) wireChatExtras(v, m, c, render);
  q('#mtxt')?.focus();
}
export function friendsSection() {
  const m = mesh(); if (!m) return '';
  const fr = [...m.node.friends.keys()].map(c => m.node.view(c) || { code: c, name: c, status: 'offline' }), pend = [...m.node.pendingIn.keys()], bl = [...m.node.blocked];
  return `<div class="card" data-mesh="friends"><h3>👥 Friends</h3>${fr.map(v => `<div class="row gap" data-friend="${v.code}">${av(v.full ? v.profile : v, 32)}<b>${esc(nameOf(v))}</b><span class="muted small">${v.full ? '🟢 online' : esc(v.status)}</span><button data-mchat="${v.code}">Chat</button></div>`).join('') || '<p class="muted small">No friends yet — add people from Discover.</p>'}
    ${pend.length ? `<h4>Requests</h4>${pend.map(c => { const v = m.node.view(c); return `<div class="row gap">${esc(v ? nameOf(v) : c)} <span class="muted small">#${c}</span><button class="primary" data-maccept="${c}">Accept</button></div>`; }).join('')}` : ''}
    ${bl.length ? `<h4>Blocked</h4>${bl.map(c => `<div class="row gap"><span class="muted small">#${c}</span><button data-munblock="${c}">Unblock</button></div>`).join('')}` : ''}</div>`;
}
export function wireFriends(root, st, render) {
  const m = mesh(); if (!m) return;
  root.querySelectorAll('[data-maccept]').forEach(b => b.onclick = async () => { await m.accept(b.dataset.maccept); render(); });
  root.querySelectorAll('[data-munblock]').forEach(b => b.onclick = async () => { await m.unblock(b.dataset.munblock); render(); });
  root.querySelectorAll('[data-friend] [data-mchat]').forEach(b => b.onclick = () => { st.tab = 'inbox'; st.meshChat = b.dataset.mchat; render(); });
}
export function devSection() {
  const m = mesh(); if (!m) return notMesh;
  return `<div class="card" data-mesh="dev"><h3>🕸️ Mesh</h3><p class="small">You: <b id="mycode">${m.code}</b> · transport: ${esc(m.transport)} · active list: ${m.member.active.size} · online now: ${m.online().length} · cached stubs: ${m.node.cache.size} · friends: ${m.node.friends.size} · blocked: ${m.node.blocked.size}</p>
    <p class="muted small">Test locally: open more tabs with <code>?as=seed-3</code>, <code>?as=seed-5</code>… (each tab = different demo user).</p><pre class="small muted">${esc(m.log.slice(0, 12).join('\n'))}</pre></div>`;
}

// v52 Quiet safety number sheet (diggable; no banner / no nag).
export async function openSafetySheet(m, peer, peerName, render) {
  document.getElementById('snsheet')?.remove();
  const sn = await m.safetyFor?.(peer); const d = document.createElement('div'); d.id = 'snsheet'; d.className = 'modal'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Safety number');
  if (!sn) {
    d.innerHTML = `<div class="card"><h3>Safety number</h3><p class="small muted">Available once their profile key is known on this phone.</p><button id="snclose">Close</button></div>`;
    document.body.appendChild(d); d.querySelector('#snclose').onclick = () => d.remove(); d.onclick = e => { if (e.target === d) d.remove(); }; return;
  }
  const status = sn.verified ? `<span class="tag">Verified</span> <span class="muted small">· ${new Date(sn.verifiedAt).toLocaleDateString()}</span>` : `<span class="muted small">Not marked verified</span>`;
  d.innerHTML = `<div class="card"><h3>Safety number</h3>
    <p class="small">Compare with <b>${esc(peerName || peer)}</b> out-of-band. Both phones show the same number for the same pair.</p>
    <p class="mono" id="snnum" style="letter-spacing:.04em;line-height:1.6;word-break:break-word;user-select:all">${esc(sn.number)}</p>
    <p class="muted small">Your key hint: <code>${esc(sn.myHint || '—')}</code> · ${status}</p>
    <canvas id="snqr" width="180" height="180" style="display:block;margin:8px auto;background:#fff;border-radius:8px"></canvas>
    <div class="row gap" style="flex-wrap:wrap">
      <button id="sncopy" class="primary">Copy</button>
      ${sn.verified ? '<button id="snclear" class="ghost">Clear verified</button>' : '<button id="snmark" class="primary">Mark as verified</button>'}
      <button id="snclose" class="ghost">Close</button>
    </div>
    <p id="snres" class="small muted"></p></div>`;
  document.body.appendChild(d);
  try { const { drawQr } = await import('./qr.js'); drawQr(d.querySelector('#snqr'), sn.qr, { scale: 3, margin: 2 }); } catch { d.querySelector('#snqr')?.remove(); }
  const res = t => { const el = d.querySelector('#snres'); if (el) el.textContent = t; };
  d.querySelector('#snclose').onclick = () => d.remove();
  d.onclick = e => { if (e.target === d) d.remove(); };
  d.querySelector('#sncopy').onclick = async () => { try { await navigator.clipboard.writeText(sn.number); res('Copied.'); } catch { res('Select the number to copy.'); } };
  d.querySelector('#snmark') && (d.querySelector('#snmark').onclick = async () => { await m.markSafetyVerified(peer, sn.fp); res('Marked verified on this phone.'); d.remove(); render?.(); });
  d.querySelector('#snclear') && (d.querySelector('#snclear').onclick = async () => { await m.clearSafetyVerified(peer); res('Cleared.'); d.remove(); render?.(); });
}
