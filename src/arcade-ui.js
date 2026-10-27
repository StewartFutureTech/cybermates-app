import * as PM from './player-menu.js';
// ARCADE section UI (open to all ages). Mode tabs: 1v1 · 2v2 · 4v4 (match games, src/match-ui.js) · Mass Arena (snake,
// Tron, Draw & Guess; sub-maps of up to 100). Shared cyberpunk render layer: src/arcade/fx.js (2D) and
// src/arcade/three-scene.js (3D, lazy-loaded). Mesh glue: 'arc' broadcast envelopes {g, sub, op, dir, tick, voice}.
import { InstanceManager, CAP } from './arcade/instance.js';
import { TICK_MS } from './arcade/engine.js';
import { gameFx } from './sfx.js';
import * as GA from './game-audio.js';
import { snake } from './arcade/snake.js';
import { tron } from './arcade/tron.js';
import { megaship, signShot, MAX_SHOTS, VISION } from './arcade/megaship.js';
import nacl from 'tweetnacl';
import { botLabel } from './arcade/bots.js';
import { ProximityVoice, VIEW_W, VIEW_H, band } from './arcade/proximity.js';
import * as FX from './arcade/fx.js';
import * as DG from './arcade/games/drawguess.js';
import { RoundChat } from './arcade/match.js';
import { matchView, stopMatch } from './match-ui.js';
import { brawlView, stopBrawl } from './brawl-ui.js';
import { partyView, stopParty, mountVoice } from './party-ui.js';
import { isMinor } from './discovery.js';
import { mesh } from './app-mesh.js';
import { THEMES, theme } from './theme.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MASS_GAMES = [['snake', '🐍 Snake'], ['tron', '🏍 Light cycles'], ['megaship', '🚀 Mega Fleet'], ['drawguess', '✏️ Draw & Guess'], ['brawl', '💥 Brawl'], ['bingo', '🎱 Bingo'], ['mtrivia', '❓ Mass Trivia']];
const GAMES = { snake, tron, megaship }, lobbies = {}, voiceOn = new Map();
let timer = null, rafGen = 0, px = null, vh = null; const vPeers = new Map();
globalThis.__cmProx = () => px && { enabled: px.enabled, inRange: [...px.inRange], gains: Object.fromEntries(px.gains), hub: vh ? vh.hub.stats() : null, counts: vh ? { ...vh.hub.counts } : null }; // v44 test hook (read-only)
import { pttHTML, startVoice } from './voice-ui.js';
let cur = { tab: new URLSearchParams(globalThis.location?.search || '').get('arcmode') || 'mass', game: new URLSearchParams(globalThis.location?.search || '').get('arcgame') || 'snake' }, t3 = null;
// Draw & Guess rooms are split by AGE BAND (text chat between humans); snake/tron rooms are shared (no human text chat; proximity voice is band-gated).
const lobby = (g, me) => { const k = g === 'drawguess' ? g + '|' + band(me) : g; return lobbies[k] ||= g === 'drawguess' ? new InstanceManager({ gameName: 'drawguess', factory: id => new DG.DrawRoom({ id }) }) : new InstanceManager({ game: GAMES[g], gameName: g }); };
const remoteTheme = new Map(); // code -> theme id announced in 'arc' join
export const themeHex = code => FX.themeAccent(remoteTheme.get(code) || THEMES[[...String(code)].reduce((a, c) => a + c.charCodeAt(0), 0) % THEMES.length][0]); // remote players' own theme (bots: pseudo-random theme)
let stopMega = null; // set once megafleet-ui.js is loaded
export function stopArcade() { stopMega?.(); px?.detach(); vh?.stop(); vh = null; clearInterval(timer); timer = null; t3?.dispose?.(); t3 = null; stopMatch(); stopBrawl(); stopParty(); const m = mesh(); if (m && cur.joined) m.arcade?.send({ g: cur.game, op: 'leave' }); }
export function arcadeView(v, me) { stopArcade();
  v.innerHTML = `<div class="arcade"><div class="modes arc-tabs">${[['1v1', '1v1'], ['2v2', '2v2'], ['4v4', '4v4'], ['mass', 'Mass Arena']].map(([k, l]) => `<button data-arctab="${k}" class="${cur.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="arc-body"></div></div>`;
  v.querySelectorAll('[data-arctab]').forEach(b => b.onclick = () => { cur.tab = b.dataset.arctab; arcadeView(v, me); });
  const body = v.querySelector('#arc-body'); if (cur.tab === 'mass') massView(body, me); else matchView(body, me, cur.tab); }
function massView(v, me) {
  const myCode = mesh()?.code || 'ME'; px ||= new ProximityVoice({ me, parent: isMinor(me) ? mesh()?.parent : null, isBlocked: c => !!mesh()?.blocklist?.isBlocked(c) });
  if (!['snake', 'tron', 'drawguess', 'megaship', 'brawl', 'bingo', 'mtrivia'].includes(cur.game)) cur.game = 'snake';
  if (cur.game === 'bingo' || cur.game === 'mtrivia') { // party games (cap 200, band-split) live in party-ui.js
    const tabs = `<div class="modes">${MASS_GAMES.map(([k, l]) => `<button data-game="${k}" class="${k === cur.game ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    partyView(v, me, cur.game, tabs).then(() => v.querySelectorAll('[data-game]').forEach(b => b.onclick = () => { stopArcade(); cur.game = b.dataset.game; massView(v, me); })); return; }
  if (cur.game === 'brawl') { // 6-player FFA brawler lives in the Mass Arena list; its own sim (AI fill, signed hits) runs in brawl-ui.js
    v.innerHTML = `<div class="modes">${MASS_GAMES.map(([k, l]) => `<button data-game="${k}" class="${k === 'brawl' ? 'on' : ''}">${l}</button>`).join('')}</div><div id="arc-brawl"></div>`;
    v.querySelectorAll('[data-game]').forEach(b => b.onclick = () => { stopArcade(); cur.game = b.dataset.game; massView(v, me); });
    return brawlView(v.querySelector('#arc-brawl'), me); }
  if (cur.game === 'megaship') { // v36 Mega Fleet: king-of-the-hill space arena (own sim + 3D view, bots fill) in megafleet-ui.js
    const tabs = `<div class="modes">${MASS_GAMES.map(([k, l]) => `<button data-game="${k}" class="${k === 'megaship' ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    return import('./megafleet-ui.js').then(MF => { stopMega = MF.stopMegaFleet; if (!v.isConnected) return; MF.megaFleetView(v, me, { tabs }); v.querySelectorAll('[data-game]').forEach(b => b.onclick = () => { stopArcade(); cur.game = b.dataset.game; massView(v, me); }); }); }
  const g = cur.game, L = lobby(g, me); const w = L.join(myCode, { name: me?.name || 'you', minor: isMinor(me), adult: !isMinor(me) }); cur.joined = true;
  const m = mesh(); m?.arcade?.listen((from, b) => { if (b.g !== cur.game) return; const LL = lobby(b.g, me); if (b.g === 'drawguess' && band(b) !== band(me)) return;
    if (b.op === 'join') vPeers.set(from, { code: from, minor: !!b.minor }); if (b.theme) remoteTheme.set(from, b.theme); if (b.op === 'join' && !LL.where.has(from)) LL.join(from, { name: b.name || from.slice(0, 6), minor: !!b.minor, adult: !b.minor }); if (b.op === 'leave') LL.leave(from);
    if (b.op === 'in') LL.where.get(from)?.input?.(from, b.dir, b.tick); if (b.op === 'dg') LL.where.get(from)?.move(from, b.m); if (b.op === 'shot' && b.s?.code === from) { const W = LL.where.get(from); if (W && W.ownerAt(b.s.x, b.s.y) === myCode) megaship.receiveShot(W, b.s, () => b.pub); } if ('voice' in b) voiceOn.set(from, !!b.voice); });
  m?.arcade?.send({ g, op: 'join', sub: w.id, name: me?.name, minor: isMinor(me), voice: px.enabled, theme: theme() });
  const want3d = true; /* 3D-only (silent 2D fallback without WebGL) */ const shotKey = nacl.sign.keyPair(); let shotSeq = 0;
  const voiceCardHtml = `<div class="card"><div class="row gap"><label class="small"><input type="checkbox" id="arc-voice" style="width:auto" ${px.enabled ? 'checked' : ''}> 🎙 ${g === 'drawguess' ? 'Room voice' : 'Proximity voice'}</label>${g !== 'drawguess' ? `<label class="small"><input type="checkbox" id="arc-mutebots" style="width:auto" ${px.muteBots ? 'checked' : ''}> Mute bot chat</label>` : ''}</div>
      ${pttHTML('arc-ptt')}<p class="muted small" id="arc-vnote">${isMinor(me) ? 'Voice needs a parent to turn it on (👪). You only ever hear players your own age group.' : 'Off until you turn it on. Adults and under-18s are never connected.'}</p></div>`;
  v.innerHTML = `<div class="modes">${MASS_GAMES.map(([k, l]) => `<button data-game="${k}" class="${k === g ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="row gap small arc-veh">${g === 'tron' ? '<select id="arc-vehicle"><option value="bike">Light-cycle</option><option value="fighter">Star fighter</option></select>' : ''}${g === 'megaship' ? '<span class="muted">tap space to fire · shots recharge (max 10)</span>' : ''}</div>
    <div class="arc-stage"><canvas id="arc-cv" width="720" height="720" aria-label="${g} game"></canvas><canvas id="arc-3d-cv" class="arc-3d" hidden></canvas></div>
    ${g === 'drawguess' ? `<div class="card"><div id="dg-word" class="small"></div><div class="dg-log" id="dg-log"></div><form id="dg-f" class="row gap"><input id="dg-in" maxlength="40" placeholder="Type your guess…" autocomplete="off"><button class="primary">Guess</button></form><p class="muted small">Chat is required for this game. Only players your age group are in this room. Tap a name to mute/block/report.</p></div>` : `<div class="row gap arc-pad">${['left', 'up', 'down', 'right'].map(d => `<button data-dir="${d}" aria-label="${d}">${{ left: '◀', up: '▲', down: '▼', right: '▶' }[d]}</button>`).join('')}</div>`}
    ${g === 'drawguess' ? '<div id="dg-pv"></div>' : voiceCardHtml}
    <div class="card"><h4>Sub-map <span id="arc-sub"></span></h4><div id="arc-subs" class="row gap"></div><div id="arc-players" class="arc-players"></div></div>`;
  const cv = v.querySelector('#arc-cv'), ctx = cv.getContext('2d'), c3 = v.querySelector('#arc-3d-cv');
  const send = d => { const W = L.where.get(myCode); const i = W?.input?.(myCode, d); if (i) mesh()?.arcade?.send({ g, op: 'in', dir: d, tick: i.tick }); };
  v.querySelectorAll('[data-dir]').forEach(b => b.onclick = () => send(b.dataset.dir));
  const analog = !!GAMES[g]?.analog; document.onkeyup = null;
  // FREE ANALOG STEERING (snake/tron): drag/hold a finger or the mouse = target heading (2D: from my head toward the pointer;
  // 3D: ray-cast onto the ground). Keyboard fallback: hold ←/→ (or A/D) to rotate at the max turn rate; ↑/↓ aim north/south.
  let lastAim = null, aimTick = -1, held = 0; const sendAim = a => { const W = L.where.get(myCode); if (a == null || !W) return; if (lastAim != null && Math.abs(Math.atan2(Math.sin(a - lastAim), Math.cos(a - lastAim))) < 0.035) return; if (aimTick === W.tick) return; aimTick = W.tick; lastAim = a; send({ a: +a.toFixed(4) }); };
  if (analog) { const keyT = { ArrowLeft: -1, a: -1, A: -1, ArrowRight: 1, d: 1, D: 1 };
    document.onkeydown = e => { if (!cv.isConnected) return; const t = keyT[e.key]; if (t) { e.preventDefault(); if (held !== t) { held = t; lastAim = null; send({ t }); } return; } const d = { ArrowUp: 'up', ArrowDown: 'down' }[e.key]; if (d) { e.preventDefault(); lastAim = null; send(d); } };
    document.onkeyup = e => { if (!cv.isConnected) return; const t = keyT[e.key]; if (t && held === t) { held = 0; send({ t: 0 }); } };
    let down = false; const aimFrom = e => { if (t3?.aimAt && !c3.hidden) return t3.aimAt(e.clientX, e.clientY); const b = cv.getBoundingClientRect(); return Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2)); };
    for (const el of [cv, c3]) { el.style.touchAction = 'none'; el.addEventListener('pointerdown', e => { down = true; el.setPointerCapture?.(e.pointerId); sendAim(aimFrom(e)); });
      el.addEventListener('pointermove', e => { if (down || e.pointerType === 'mouse' && e.buttons) sendAim(aimFrom(e)); }); for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, () => { down = false; }); } }
  else document.onkeydown = e => { const d = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key]; if (d && cv.isConnected && g !== 'drawguess') { e.preventDefault(); send(d); } };
  let t0 = null; if (!analog) for (const el of [cv, c3]) { el.ontouchstart = e => { t0 = e.touches[0]; }; el.ontouchend = e => { const t = e.changedTouches[0]; if (!t0 || g === 'drawguess') return; const dx = t.clientX - t0.clientX, dy = t.clientY - t0.clientY; if (Math.max(Math.abs(dx), Math.abs(dy)) > 20) send(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')); }; }
  v.querySelectorAll('[data-game]').forEach(b => b.onclick = () => { stopArcade(); lobby(cur.game, me).leave(myCode); cur.game = b.dataset.game; massView(v, me); });
  const dgVoice = g === 'drawguess' ? mountVoice(v.querySelector('#dg-pv'), me, o => m?.arcade?.send({ g, ...o }), voiceOn) : null;
  if (!dgVoice) v.querySelector('#arc-voice').onchange = async e => { const r = await px.setEnabled(e.target.checked); if (!r.ok) { e.target.checked = false; v.querySelector('#arc-vnote').textContent = 'A parent has to allow voice first (👪 parent controls).'; }
    if (r.ok && e.target.checked && !vh) { const x = await startVoice({ me, code: myCode, mesh: mesh(), mode: 'proximity', peerInfo: c => vPeers.get(c), isMuted: c => px.muted.has(c), root: v.querySelector('#arc-ptt') }); if (x.error) v.querySelector('#arc-vnote').textContent = x.error; else { vh = x; px.attach(vh.hub); } } // v44: per-peer audio transport (range-gated links, distance gain per peer)
    if (!e.target.checked && vh) { px.detach(); vh.stop(); vh = null; } mesh()?.arcade?.send({ g, op: 'voice', voice: px.enabled }); };
  v.querySelector('#arc-mutebots')?.addEventListener('change', e => { px.muteBots = e.target.checked; });
  if (g === 'tron') { const sel = v.querySelector('#arc-vehicle'); import('./arcade/tron3d.js').then(T => { sel.value = T.vehicle(); sel.onchange = () => T.setVehicle(sel.value); }); }
  const fireAt = (x, y) => { const W = L.where.get(myCode); if (!W) return; x = W.wrap(Math.round(x)); y = W.wrap(Math.round(y)); if (megaship.fire(W, myCode, x, y) && (GA.shotFired(g), true)) mesh()?.arcade?.send({ g, op: 'shot', s: signShot({ code: myCode, seq: ++shotSeq, tick: W.tick, x, y }, shotKey.secretKey), pub: btoa(String.fromCharCode(...shotKey.publicKey)) }); }; // signed; tile owner resolves
  const colors = W => FX.distinctColors([...W.players.values()].map(p => ({ code: p.code, color: p.code === myCode ? FX.swatch().cy : themeHex(p.code) })));
  if (want3d) import('./arcade/three-scene.js').then(async S => { if (!S.can3D()) return S.noteFallback(cv.parentElement, globalThis.__cm3dDiag?.fallback || 'no WebGL2'); c3.hidden = false; cv.hidden = true; c3.width = c3.clientWidth; c3.height = c3.clientHeight;
    if (g === 'tron') { const T = await import('./arcade/tron3d.js'); t3 = await T.tron3d(c3); }
    else if (g === 'snake') { const T = await import('./arcade/snake3d.js'); t3 = await T.snake3d(c3); }
    else if (g === 'megaship') { const T = await import('./arcade/space3d.js'); t3 = await T.space3d(c3, { onTap: fireAt }); }
    else if (g === 'drawguess') { const T = await import('./arcade/draw3d.js'); t3 = await T.draw3d(c3, cv, { onDown: p => dgDown(p), onMove: p => dgMove(p), onUp: () => dgUp() }); }
    else { const T = await import('./arcade/glass3d.js'); const gl = await T.glass3d(c3, cv, { onTap: (nx, ny) => tap2d(nx, ny) }); t3 = { set() {}, dispose: gl.dispose }; }
  }).catch(e => { console.warn('3D fallback (2D view used):', e?.message || e); import('./arcade/three-scene.js').then(S => S.noteFallback(cv.parentElement, e?.message || e)); c3.hidden = true; cv.hidden = false; t3 = null; }); // 2D glow fallback
  const tap2d = (nx, ny) => { const W = L.where.get(myCode), self = W?.players.get(myCode); if (g === 'megaship' && self) { const C = 40; fireAt(self.x - C / 2 + nx * C, self.y - C / 2 + ny * C); } };
  if (g === 'megaship') cv.onclick = e => { const b = cv.getBoundingClientRect(); tap2d((e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height); };
  // Draw & Guess: canvas strokes for drawers, chat guesses
  const chat = new RoundChat('drawguess'), muted = new Set(); let dgDown = () => {}, dgMove = () => {}, dgUp = () => {};
  if (g === 'drawguess') { let stroke = null; const pt = e => { const b = cv.getBoundingClientRect(); return [+((e.clientX - b.left) / b.width).toFixed(3), +((e.clientY - b.top) / b.height).toFixed(3)]; };
    dgDown = p => { if (DG.drawers(L.where.get(myCode).state).includes(myCode)) stroke = [p]; }; dgMove = p => { if (stroke && stroke.length < 64) stroke.push(p); };
    dgUp = () => { if (stroke?.length > 1) { const W = L.where.get(myCode); if (W.move(myCode, { stroke })) mesh()?.arcade?.send({ g, op: 'dg', m: { stroke } }); } stroke = null; };
    cv.onpointerdown = e => dgDown(pt(e)); cv.onpointermove = e => dgMove(pt(e)); cv.onpointerup = () => dgUp();
    v.querySelector('#dg-f').onsubmit = e => { e.preventDefault(); const i = v.querySelector('#dg-in'), W = L.where.get(myCode); if (i.value && W.move(myCode, { guess: i.value })) mesh()?.arcade?.send({ g, op: 'dg', m: { guess: i.value } }); i.value = ''; }; }
  const panel = () => { const W = L.where.get(myCode); if (!W) return; v.querySelector('#arc-sub').textContent = `${W.id} · ${W.players.size}/${CAP}`;
    v.querySelector('#arc-subs').innerHTML = W.links.map(id => `<button data-hop="${id}" class="small">↪ ${esc(id)}</button>`).join('') || '<span class="muted small">no sibling sub-maps yet</span>';
    v.querySelectorAll('[data-hop]').forEach(b => b.onclick = () => { if (L.hop(myCode, b.dataset.hop)) panel(); });
    const sc = g === 'drawguess' ? Object.fromEntries(DG.leaderboard(W.state).map(r => [r.code, r.pts])) : null;
    const ps = [...W.players.values()].sort((a, b) => (sc ? sc[b.code] - sc[a.code] : b.score - a.score)).slice(0, 12);
    v.querySelector('#arc-players').innerHTML = (g === 'drawguess' ? '<h4 class="small">Leaderboard</h4>' : '') + ps.map((p, i) => `<div class="row gap small"><b style="color:${colors(W).find(c => c.code === p.code)?.color}">${g === 'drawguess' ? '#' + (i + 1) : '●'}</b><span class="grow"><span${PM.nameAttrs(p, myCode)}>${esc(botLabel(p))}</span>${p.code === myCode ? ' (you)' : ''}</span><span>${sc ? sc[p.code] : p.score}</span>${!p.bot && p.code !== myCode ? `<button data-mute="${esc(p.code)}" class="small">${px.muted.has(p.code) || muted.has(p.code) ? 'Unmute' : 'Mute'}</button><button data-blk="${esc(p.code)}" class="small">Block</button><button data-rep="${esc(p.code)}" class="small">⚑</button>` : ''}</div>`).join('');
    v.querySelectorAll('[data-mute]').forEach(b => b.onclick = () => { const c = b.dataset.mute; const on = !(px.muted.has(c) || muted.has(c)); px.mute(c, on); on ? muted.add(c) : muted.delete(c); panel(); });
    v.querySelectorAll('[data-rep]').forEach(b => b.onclick = () => { const mm = mesh(); if (mm) import('./mesh-ui.js').then(U => U.reportFlow(mm, b.dataset.rep)); });
    v.querySelectorAll('[data-blk]').forEach(b => b.onclick = async () => { const c = b.dataset.blk; if (!confirm('Block this player everywhere?')) return; px.mute(c); await mesh()?.block(c); L.leave(c); panel(); });
    if (g === 'drawguess') dgVoice?.tick(W.players.values(), myCode);
    if (g === 'drawguess') { const st = W.state, isD = DG.drawers(st).includes(myCode); v.querySelector('#dg-word').innerHTML = isD ? `✏️ You're drawing: <b>${esc(DG.word(st))}</b>` : `Guess the drawing · drawers: ${DG.drawers(st).map(c => esc(botLabel(W.players.get(c) || { name: c }))).join(', ')}`;
      v.querySelector('#dg-log').innerHTML = st.log.slice(-8).filter(l => !muted.has(l.code) && chat.canMessage(W.players.get(l.code) || {}, { ...me, code: myCode }, { isBlocked: c => !!mesh()?.blocklist?.isBlocked(c), muted }) || W.players.get(l.code)?.bot).map(l => `<div class="small"><b>${esc(botLabel(W.players.get(l.code) || { name: l.code }))}:</b> ${esc(l.text)}</div>`).join(''); } };
  const draw = () => { const W = L.where.get(myCode); if (!W) return; const P = FX.palette(), cw = cv.width, ch = cv.height, now = performance.now(); FX.background(ctx, cw, ch, P, 36);
    if (g === 'drawguess') { const st = W.state; ctx.lineCap = 'round'; for (const s of st.strokes) FX.neonPath(ctx, s.map(([x, y]) => [x * cw, y * ch]), P.cy, { lw: 5 }); FX.frame(ctx, cw, ch, P, now); FX.hud(ctx, cw, ch, P, { title: 'Draw & Guess', right: `round ${st.round + 1}`, bottom: `${W.players.size} players · chat on` }); return; }
    const self = W.players.get(myCode), C = 40, s = cw / C, cx = (self?.x ?? 0) - C / 2, cy = (self?.y ?? 0) - C / 2, cols = new Map(colors(W).map(c => [c.code, c]));
    const sx = x => { let d = x - cx; const n = W.size; d = ((d % n) + n) % n; return d * s; }, sy = y => { let d = y - cy; const n = W.size; d = ((d % n) + n) % n; return d * s; };
    ctx.save(); ctx.strokeStyle = P.cy; ctx.globalAlpha = 0.25 * FX.pulse(now); ctx.lineWidth = 1.5; for (let i = 0; i <= C; i++) { const gx = Math.floor(cx) + i, gy = Math.floor(cy) + i; if (gx % 16 === 0) { ctx.beginPath(); ctx.moveTo(sx(gx), 0); ctx.lineTo(sx(gx), ch); ctx.stroke(); } if (gy % 16 === 0) { ctx.beginPath(); ctx.moveTo(0, sy(gy)); ctx.lineTo(cw, sy(gy)); ctx.stroke(); } } ctx.restore(); // tile seams
    if (g === 'megaship') { const vis = new Set(megaship.visibleShips(W, myCode).map(p => p.code)); ctx.save(); for (let i = 0; i < 160; i++) { const x = (i * 97 + Math.floor(cx * 3)) % cw, y = (i * 61 + Math.floor(cy * 3)) % ch; ctx.globalAlpha = 0.25 + (i % 5) / 10; ctx.fillStyle = P.fg; ctx.fillRect((x + cw) % cw, (y + ch) % ch, 1.5, 1.5); } ctx.restore(); // starfield
      for (const s2 of W.streaks || []) if (s2.victim === myCode) FX.neonPath(ctx, [[sx(s2.x0) + s / 2, sy(s2.y0) + s / 2], [sx(s2.x1) + s / 2, sy(s2.y1) + s / 2]], P.hot, { lw: 3 }); // incoming torpedo: direction only
      for (const sh of W.shells || []) if (sh.from === myCode) FX.neonPath(ctx, [[sx(sh.sx) + s / 2, sy(sh.sy) + s / 2], [sx(sh.x) + s / 2, sy(sh.y) + s / 2]], P.cy, { lw: 2.5 });
      for (const r of W.reveals || []) { const life = (r.until - W.tick) / 25; ctx.save(); ctx.globalAlpha = Math.max(0, life); ctx.strokeStyle = P.acid; ctx.lineWidth = 2; FX.glow(ctx, P.acid, c => { c.beginPath(); c.arc(sx(r.x) + s / 2, sy(r.y) + s / 2, (r.r + 1 - life) * s, 0, 7); c.stroke(); }, { blur: 10 }); ctx.restore(); } // sensor ping
      for (const p of W.players.values()) { if (!p.alive || !vis.has(p.code)) continue; const c = cols.get(p.code) || { color: P.hot }, X = sx(p.x) + s / 2, Y = sy(p.y) + s / 2, k = s * (0.6 + p.size * 0.45), a = { up: -Math.PI / 2, down: Math.PI / 2, left: Math.PI, right: 0 }[p.dir];
        ctx.save(); ctx.translate(X, Y); ctx.rotate(a); ctx.fillStyle = P.bg2; ctx.strokeStyle = c.color; ctx.lineWidth = 2; FX.glow(ctx, c.color, cc => { cc.beginPath(); cc.moveTo(k, 0); cc.lineTo(-k * .7, k * .6); cc.lineTo(-k * .4, 0); cc.lineTo(-k * .7, -k * .6); cc.closePath(); cc.fill(); cc.stroke(); }, { blur: 10 }); ctx.restore();
        if (p.code === myCode || p.hp < p.maxHp) { ctx.fillStyle = c.color; ctx.fillRect(X - k, Y + k + 4, 2 * k * (p.hp / p.maxHp), 3); } }
      // nebula fog of war outside vision + pings
      ctx.save(); ctx.fillStyle = P.bg; ctx.globalAlpha = 0.82; ctx.beginPath(); ctx.rect(0, 0, cw, ch); if (self) ctx.arc(sx(self.x) + s / 2, sy(self.y) + s / 2, (VISION + self.size) * s, 0, 7, true); for (const r of W.reveals || []) { ctx.moveTo(sx(r.x) + s / 2 + (r.r + 1) * s, sy(r.y) + s / 2); ctx.arc(sx(r.x) + s / 2, sy(r.y) + s / 2, (r.r + 1) * s, 0, 7, true); } ctx.fill('evenodd'); ctx.restore();
      FX.frame(ctx, cw, ch, P, now); FX.hud(ctx, cw, ch, P, { title: 'Mega Fleet', right: `${'▮'.repeat(self?.ledger?.avail(W.tick) || 0)}${'▯'.repeat(MAX_SHOTS - (self?.ledger?.avail(W.tick) || 0))}`, bottom: `${self ? ['scout', 'corvette', 'frigate', 'cruiser', 'capital'][Math.min(4, self.size - 1)] : ''} · lvl ${self?.lvl ?? 0} · hp ${self?.hp ?? 0}/${self?.maxHp ?? 0} · ${W.players.size}/${CAP}` }); t3?.set(W, colors(W), myCode); return; }
    if (analog) return drawAnalog(W, P, now);
    if (g === 'tron' && W.land) { ctx.save(); ctx.globalAlpha = .22; for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) { const wx = W.wrap(Math.floor(cx) + x), wy = W.wrap(Math.floor(cy) + y), o = W.land[wy * W.size + wx]; if (o && cols.get(o)) { ctx.fillStyle = cols.get(o).color; ctx.fillRect(sx(wx), sy(wy), s, s); } } ctx.restore(); }
    if (g === 'snake') for (const f of W.food || []) { const [x, y] = f.split(',').map(Number); if (sx(x) < cw && sy(y) < ch) FX.neonCircle(ctx, sx(x) + s / 2, sy(y) + s / 2, s / 3.2, P.acid); }
    const labels = []; for (const p of W.players.values()) { if (!p.alive) continue; const c = cols.get(p.code) || { color: P.hot };
      const cells = g === 'snake' ? p.body || [] : [...(p.trail || [])].concat([[p.x, p.y]]); let seg = []; const segs = [seg]; let last = null;
      for (const [x, y] of cells) { const X = sx(x) + s / 2, Y = sy(y) + s / 2; if (last && (Math.abs(X - last[0]) > s * 1.5 || Math.abs(Y - last[1]) > s * 1.5)) segs.push(seg = []); seg.push([X, Y]); last = [X, Y]; }
      for (const sg of segs) FX.neonPath(ctx, sg, c.color, { lw: g === 'snake' ? s * .7 : s * .38 }); FX.neonCircle(ctx, sx(p.x) + s / 2, sy(p.y) + s / 2, s * .55, c.color); if (c.outline) { ctx.strokeStyle = P.fg; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(sx(p.x) + s / 2, sy(p.y) + s / 2, s * .9, 0, 7); ctx.stroke(); }
      if (Math.abs(sx(p.x) - cw / 2) < cw / 2) { ctx.font = `500 ${Math.round(s * 1.1)}px ${P.mono}`; const t = botLabel(p).slice(0, 14), tw = ctx.measureText(t).width, h = s * 1.3; let lx = Math.max(4, Math.min(cw - tw - 4, sx(p.x) + s * 1.2)), ly = sy(p.y) - 2; for (let k = 0; k < 4 && labels.some(r => lx < r[0] + r[2] && lx + tw > r[0] && Math.abs(ly - r[1]) < h); k++) ly += (k % 2 ? -1 : 1) * h * (k + 1); labels.push([lx, ly, tw]); ctx.fillStyle = P.fg; ctx.globalAlpha = p.code === myCode ? .95 : .65; ctx.fillText(t, lx, ly); ctx.globalAlpha = 1; } /* name tags dodge overlaps */ }
    for (const b of px.bubbles(W, myCode)) { const p = W.players.get(b.who); ctx.font = `600 20px ${P.mono}`; const tw = ctx.measureText(b.text).width + 18, X = Math.max(tw / 2 + 4, Math.min(cw - tw / 2 - 4, sx(p.x))), Y = Math.max(20, sy(p.y) - 24); ctx.fillStyle = P.bg; ctx.beginPath(); ctx.roundRect(X - tw / 2, Y - 26, tw, 30, 10); ctx.fill(); FX.neonRect(ctx, X - tw / 2, Y - 26, tw, 30, P.hot, { r: 10, t: now }); ctx.fillStyle = P.hot; ctx.fillText(b.text, X - tw / 2 + 9, Y - 4); }
    const heard = px.update(W, myCode, c => !!voiceOn.get(c)); FX.frame(ctx, cw, ch, P, now);
    FX.hud(ctx, cw, ch, P, { title: g === 'tron' ? 'Light cycles' : 'Snake', right: `${W.players.size}/${CAP} · ${self?.score ?? 0} pts`, bottom: `tick ${W.tick} · view ${VIEW_W}x${VIEW_H} · voice ${px.enabled ? heard.length + ' in range' : 'off'}` });
    t3?.set(W, colors(W), myCode); };
  // ---- analog 2D renderer: interpolated between ticks (rAF), camera follows my head, particles + shake + haptics/sfx
  let stepT = performance.now(), shakeA = 0; const parts = [];
  const feel = (W, evs) => { const me = W.players.get(myCode), P = FX.palette(); for (const e of evs) { const mine = e.who === myCode;
      if (e.t === 'kill') { if (mine) { gameFx('die', { sound: false }); shakeA = 14; } else if (e.by === myCode) gameFx('kill', { sound: false }); } else if (e.t === 'food' && mine) gameFx('eat', { haptic: false, sound: false }); else if (e.t === 'eat' && mine) { gameFx('kill', { sound: false }); shakeA = Math.max(shakeA, 5); } else if (e.t === 'claim' && mine) gameFx('claim', { sound: false }); else if (e.t === 'cut' && mine) { gameFx('kill', { sound: false }); shakeA = Math.max(shakeA, 6); }
      if (t3 || !me || !['kill', 'eat', 'claim', 'cut'].includes(e.t)) continue; const x = e.x ?? W.players.get(e.who)?.x, y = e.y ?? W.players.get(e.who)?.y; if (x == null) continue; const c = colors(W).find(c => c.code === (e.victim || e.who))?.color || P.cy;
      for (let k = 0; k < (e.t === 'kill' ? 26 : 12); k++) { const a = Math.random() * 6.283, v = 0.05 + Math.random() * 0.2; parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c }); } } if (parts.length > 400) parts.splice(0, parts.length - 400); t3?.events?.(evs); };
  const wdd = (d, n) => (d > n / 2 ? d - n : d < -n / 2 ? d + n : d);
  function drawAnalog(W, P, now) { if (t3 && cv.hidden) return; const cw = cv.width, ch = cv.height, self = W.players.get(myCode), a = Math.min(1, (now - stepT) / (W.tickMs || 40)), n = W.size, wraps = GAMES[g].wraps !== false, C = 40, s = cw / C, cols = new Map(colors(W).map(c => [c.code, c]));
    const ip = p => [(p.px ?? p.x) + (wraps ? wdd(p.x - (p.px ?? p.x), n) : p.x - (p.px ?? p.x)) * a, (p.py ?? p.y) + (wraps ? wdd(p.y - (p.py ?? p.y), n) : p.y - (p.py ?? p.y)) * a];
    const [mx, my] = self ? ip(self) : [n / 2, n / 2]; const ox = shakeA ? (Math.random() - 0.5) * shakeA : 0, oy = shakeA ? (Math.random() - 0.5) * shakeA : 0; shakeA *= 0.85; if (shakeA < 0.3) shakeA = 0;
    const sx = x => (wraps ? wdd(x - mx, n) : x - mx) * s + cw / 2 + ox, sy = y => (wraps ? wdd(y - my, n) : y - my) * s + ch / 2 + oy;
    ctx.save(); ctx.strokeStyle = P.cy; ctx.globalAlpha = 0.18 * FX.pulse(now); ctx.lineWidth = 1; const g0x = Math.floor(mx - C), g0y = Math.floor(my - C); for (let i = 0; i <= 2 * C; i += 4) { const X = sx(g0x + i - (g0x % 4)), Y = sy(g0y + i - (g0y % 4)); ctx.beginPath(); ctx.moveTo(X, 0); ctx.lineTo(X, ch); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, Y); ctx.lineTo(cw, Y); ctx.stroke(); } ctx.restore();
    if (!wraps) { ctx.save(); ctx.strokeStyle = P.hot; ctx.lineWidth = 3; FX.glow(ctx, P.hot, c => c.strokeRect(sx(0), sy(0), n * s, n * s), { blur: 12 }); ctx.restore(); }
    if (g === 'tron') { ctx.save(); for (const poly of W.polys || []) { const c = cols.get(poly.o); if (!c) continue; ctx.beginPath(); poly.pts.forEach(([x, y], i) => i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))); ctx.closePath(); ctx.globalAlpha = 0.24; ctx.fillStyle = c.color; ctx.fill(); ctx.globalAlpha = 0.7; ctx.strokeStyle = c.color; ctx.lineWidth = 1.5; ctx.stroke(); } ctx.restore(); }
    if (g === 'snake') for (const f of W.food || []) { const X = sx(f[0]), Y = sy(f[1]); if (X > -10 && Y > -10 && X < cw + 10 && Y < ch + 10) FX.neonCircle(ctx, X, Y, s / 4, P.acid); }
    const labels = []; for (const p of W.players.values()) { if (!p.alive) continue; const c = cols.get(p.code) || { color: P.hot }, [hx, hy] = ip(p), HX = sx(hx), HY = sy(hy);
      const path = g === 'snake' ? (p.body || []).slice(1) : (p.trail || []); const segs = [[[HX, HY]]]; let lastP = [HX, HY];
      for (const [x, y] of g === 'snake' ? path : [...path].reverse()) { const X = sx(x), Y = sy(y); if (Math.abs(X - lastP[0]) > s * 3 || Math.abs(Y - lastP[1]) > s * 3) segs.push([]); segs[segs.length - 1].push([X, Y]); lastP = [X, Y]; }
      if (g === 'tron' && !(p.trail || []).length) segs.length = 0; const Rr = g === 'snake' ? s * (0.32 + Math.min(0.5, (p.len || 0) / 400)) : s * 0.2;
      for (const sg of segs) if (sg.length > 1) FX.neonPath(ctx, sg, c.color, { lw: Rr * 2 });
      ctx.save(); ctx.translate(HX, HY); ctx.rotate(p.h ?? 0); ctx.fillStyle = P.bg2; ctx.strokeStyle = c.color; ctx.lineWidth = 2;
      if (g === 'snake') { FX.glow(ctx, c.color, cc => { cc.beginPath(); cc.ellipse(0, 0, Rr * 1.5, Rr * 1.2, 0, 0, 7); cc.fill(); cc.stroke(); }, { blur: 12 }); ctx.fillStyle = P.fg; for (const e of [-1, 1]) { ctx.beginPath(); ctx.arc(Rr * 0.6, e * Rr * 0.55, Rr * 0.32, 0, 7); ctx.fill(); } }
      else { const k = s * 0.8; FX.glow(ctx, c.color, cc => { cc.beginPath(); cc.moveTo(k, 0); cc.lineTo(-k * .7, k * .45); cc.lineTo(-k * .4, 0); cc.lineTo(-k * .7, -k * .45); cc.closePath(); cc.fill(); cc.stroke(); }, { blur: 12 }); }
      ctx.restore(); if (c.outline) { ctx.strokeStyle = P.fg; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(HX, HY, s * 1.1, 0, 7); ctx.stroke(); }
      if (HX > 0 && HX < cw && HY > 0 && HY < ch) { ctx.font = `500 ${Math.round(s * 1.1)}px ${P.mono}`; const t = botLabel(p).slice(0, 14), tw = ctx.measureText(t).width, h = s * 1.3; let lx = Math.max(4, Math.min(cw - tw - 4, HX + s * 1.2)), ly = HY - s; for (let k = 0; k < 4 && labels.some(r => lx < r[0] + r[2] && lx + tw > r[0] && Math.abs(ly - r[1]) < h); k++) ly += (k % 2 ? -1 : 1) * h * (k + 1); labels.push([lx, ly, tw]); ctx.fillStyle = P.fg; ctx.globalAlpha = p.code === myCode ? .95 : .65; ctx.fillText(t, lx, ly); ctx.globalAlpha = 1; } }
    ctx.save(); for (const q of parts) { q.x += q.vx; q.y += q.vy; q.life -= 0.03; if (q.life <= 0) continue; ctx.globalAlpha = q.life; ctx.fillStyle = q.c; ctx.fillRect(sx(q.x) - 2, sy(q.y) - 2, 4, 4); } ctx.restore(); for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1);
    for (const b of px.bubbles(W, myCode)) { const p = W.players.get(b.who); if (!p) continue; ctx.font = `600 20px ${P.mono}`; const tw = ctx.measureText(b.text).width + 18, X = Math.max(tw / 2 + 4, Math.min(cw - tw / 2 - 4, sx(p.x))), Y = Math.max(20, sy(p.y) - 24); ctx.fillStyle = P.bg; ctx.beginPath(); ctx.roundRect(X - tw / 2, Y - 26, tw, 30, 10); ctx.fill(); FX.neonRect(ctx, X - tw / 2, Y - 26, tw, 30, P.hot, { r: 10, t: now }); ctx.fillStyle = P.hot; ctx.fillText(b.text, X - tw / 2 + 9, Y - 4); }
    const heard = px.update(W, myCode, c => !!voiceOn.get(c)); FX.frame(ctx, cw, ch, P, now);
    FX.hud(ctx, cw, ch, P, { title: g === 'tron' ? 'Light cycles' : 'Snake', right: `${W.players.size}/${CAP} · ${self?.score ?? 0} pts`, bottom: `drag/hold to steer · ←/→ rotate · voice ${px.enabled ? heard.length + ' in range' : 'off'}` }); }
  clearInterval(timer); let n = 0; const rng = Math.random; const stepMs = g === 'drawguess' ? 400 : (GAMES[g]?.tickMs || TICK_MS);
  globalThis.__cmArc = { world: () => L.where.get(myCode), me: myCode, game: g, t3: () => t3 }; // test/debug hook (read-only use)
  const gen = ++rafGen; if (analog) { const raf = () => { if (!v.isConnected || !timer || gen !== rafGen) return; const W = L.where.get(myCode); if (W) { const P = FX.palette(); FX.background(ctx, cv.width, cv.height, P, 36); if (!(t3 && cv.hidden)) drawAnalog(W, P, performance.now()); else px.update(W, myCode, c => !!voiceOn.get(c)); } requestAnimationFrame(raf); }; setTimeout(() => requestAnimationFrame(raf), 0); }
  timer = setInterval(() => { if (!v.isConnected) return stopArcade(); if (analog) { let rb = false; for (const W of [...L.list]) { const ev = W.step(rng) || []; if (ev.some?.(e => e.t === 'reset')) rb = true; if (W.players.has(myCode)) { GA.massEvents(g, ev, myCode, W); feel(W, ev); t3?.set(W, colors(W), myCode); } } stepT = performance.now(); if (rb) L.rebalance(); if (++n % 24 === 0) panel(); return; } if (!v.isConnected) return stopArcade(); let rb = false; for (const W of [...L.list]) { const ev = W.step(rng) || []; if (ev.some?.(e => e.t === 'reset')) rb = true; if (W.players.has(myCode)) GA.massEvents(g, ev, myCode, W); } if (rb) L.rebalance(); draw(); if (++n % 8 === 0) panel(); }, stepMs); panel(); if (!analog) draw();
}
