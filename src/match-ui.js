import * as PM from './player-menu.js';
import { bsController } from './battleship-ui.js';
import { matchWatcher } from './game-audio.js';
// Match modes UI (1v1 / 2v2 / 4v4). Shared framework: src/arcade/match.js (seats, teams, AI fill, signed moves, rematch,
// per-round chat toggle). 3D views (lazy three.js): chess + checkers (board3d), Connect Four (c4-3d), Air Hockey / Pong
// (paddle3d), Tron Duel (tron3d). Everything else — and every 3D fallback — renders through the 2D glow layer (fx.js).
import nacl from 'tweetnacl';
import { Matchmaker, gamesFor, GAMES, FILL_MS, BOT_START_MS, INVITE_MS } from './arcade/match.js';
import { b64 } from './vault.js';
import * as FX from './arcade/fx.js';
import { TICK_MS, mulberry32 } from './arcade/engine.js';
import { cellAt, normFromClient, utttMove } from './arcade/pick.js';
import { botLabel } from './arcade/bots.js';
import { band } from './arcade/proximity.js';
import { roundResult } from './arcade/games/duel.js';
import { isMinor } from './discovery.js';
import { mesh } from './app-mesh.js';
import { THEMES, theme } from './theme.js';
import { bindMatch, TableBoard, joinTable, tableQuery } from './arcade/hostrot-net.js';
import { Match } from './arcade/match.js';
import { isRealtime } from './arcade/join-anytime.js';
import { pttHTML } from './voice-ui.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON = { chess: '♞', checkers: '⛀', connect4: '◉', battleship: '⚓', uttt: '#', ttt: '✕', tronduel: '🏍', snakebattle: '🐍', pong: '🏒', trivia: '❓' };
const THREE_D = { chess: 'board', checkers: 'board', connect4: 'c4', pong: 'paddle', tronduel: 'tron', uttt: 'grid', ttt: 'grid', trivia: 'trivia', battleship: 'grid', snakebattle: 'snake' }; // every duel game is true 3D; 2D canvas is only the silent no-WebGL fallback
let variant = 'flat'; // 'v36' = original-name 3D game, 'flat' = current version ("… Flat")
let loop = null, view3d = null, keys = null, hr = null, mv = null; const mutedSeats = new Set(); const mm = new Matchmaker({ isBlocked: (a, b) => !!mesh()?.blocklist?.isBlocked(b), isBanned: c => !!mesh()?.banlist?.isBanned?.(c), idTag: () => mesh()?.code || '' });
// JOIN-ANYTIME: running tables advertised on the mesh ('tbl'); picking a game drops you into a matching open table first.
const board = new TableBoard(); let boardArc = null, boardUnsub = null; let hooks = {};
const ensureBoard = () => { const a = mesh()?.arcade; if (a && a !== boardArc) { boardUnsub?.(); boardArc = a; boardUnsub = a.sub?.((f, b) => board.seen(f, b)); } return a; };
globalThis.addEventListener?.('pagehide', () => { hr?.leave(); hr = null; });
export function stopMatch(keep) { clearInterval(loop); loop = null; if (!keep || hr?.match !== keep) { hr?.leave(); hr = null; } mv?.stop(); mv = null; view3d?.dispose?.(); view3d = null; }
const q = new URLSearchParams(globalThis.location?.search || '');
if (import.meta.env?.MODE === 'admin' || import.meta.env?.DEV) globalThis.__cmMM = () => mm; // v55 join-invite e2e hook (admin/dev builds only)
export function matchView(v, me, mode) {
  const list = gamesFor(mode);
  // v54 (David): the v36 3D games come back under their ORIGINAL names ("<id>@3d"); the current versions stay, renamed "… Flat".
  // Both variants share the same game logic, matchmaking queue, tables, presence, bot hold/swap and join invite (queue key = base id).
  const card = (g, v3) => `<button class="arc-game" data-mg="${g.id}${v3 ? '@3d' : ''}"><span class="ic">${ICON[g.id] || '•'}</span><b>${esc(v3 || !THREE_D[g.id] ? g.name : g.name + ' Flat')}</b><small>${g.kind === 'realtime' ? 'real-time' : 'turn-based'}${THREE_D[g.id] ? ' · 3D' : ''}</small></button>`;
  v.innerHTML = `<div class="arc-games">${list.map(g => (THREE_D[g.id] ? card(g, true) : '') + card(g, false)).join('')}</div>
    <p class="muted small">Matched from the mesh with players in your age group only. After ${BOT_START_MS / 1000}s a bot match starts while still seeking humans; Join invite (~${INVITE_MS / 1000}s) to swap in. Empty seats show "· AI". Blocks and bans respected.</p>`;
  const go = mg => { variant = /@3d$/.test(mg) ? 'v36' : 'flat'; start(v, me, mode, mg.replace(/@3d$/, '')); };
  ensureBoard(); v.querySelectorAll('[data-mg]').forEach(b => b.onclick = () => go(b.dataset.mg));
  const auto = q.get('arcgame'); if (auto && list.some(g => g.id === auto.replace(/@3d$/, ''))) go(auto);
}
function start(v, me, mode, gid, asked = false) { stopMatch(); const k = nacl.sign.keyPair(), code = mesh()?.code || 'ME';
  const arc = ensureBoard(), find = () => arc && board.find(gid, mode, band(me), { isBlocked: c => !!mesh()?.blocklist?.isBlocked(c) }); let t = find();
  if (!t && arc && !asked) { tableQuery(arc, gid, mode); v.innerHTML = '<p class="muted small">Looking for a table…</p>'; return setTimeout(() => v.isConnected && start(v, me, mode, gid, true), 700); } // running tables answer at once
  if (t) { const p = { code, name: me?.name || 'you', minor: isMinor(me), age: me?.age, pub: b64(k.publicKey) }; v.innerHTML = `<p class="muted small">Joining a ${esc(GAMES[gid]?.name || gid)} table in progress…</p>`;
    joinTable({ arcade: arc, table: t, p }).then(r => { if (!v.isConnected) return; if (!r) { board.t.delete(t.mid); return start(v, me, mode, gid, true); } // refused / no answer -> own table
      const M = new Match({ id: t.mid, game: gid, mode, seats: r.snap.seats }); M.restoreAuth(r.snap); play(v, me, M, k.secretKey, code, { roster: r.roster, initial: r }); }); return; }
  const r = mm.tryForm(mm.key(gid, mode, me), gid, mode) || (mm.enqueue({ code, name: me?.name || 'you', minor: isMinor(me), age: me?.age, pub: b64(k.publicKey), timer: q.get('timer') === '1' }, gid, mode), mm.tryForm(mm.key(gid, mode, me), gid, mode, true)); // local: fill now (mesh queue: see README)
  const M = r.match; mesh()?.arcade?.send({ op: 'mq', g: gid, mode, band: band(me) }); play(v, me, M, k.secretKey, code); }
function play(v, me, M, sec, code, net = null) { stopMatch(M); const g = M.g, mySeat = () => M.seats.findIndex(s => s.code === code), P = FX.palette();
  // v55: the renderer variant is pinned to THIS match, so every mesh-driven rebuild (live join, next-round seating from the
  // host, rematch, host hand-off) keeps the original-name 3D look; the networking below is identical for both variants.
  const view = M.view ||= variant;
  const use3d = !!THREE_D[g.id];
  v.innerHTML = `<div class="match"><div class="row gap mhead"><button id="m-back" class="small">‹ Games</button><b class="grow">${esc(view === 'v36' || !THREE_D[g.id] ? g.name : g.name + ' Flat')} · ${esc(M.mode)}</b></div><div id="m-status" class="small muted m-status" aria-live="polite"></div>
    <div id="m-invite" class="card warn" hidden role="dialog" aria-live="assertive"><b>Join human match?</b> <span id="m-inv-txt"></span>
      <div class="row gap"><button id="m-inv-yes" class="primary">Accept</button><button id="m-inv-no" class="small">Decline</button><span class="muted small" id="m-inv-cd"></span></div></div>
    <div class="arc-stage"><canvas id="m-cv" width="720" height="720"></canvas><canvas id="m-3d-cv" class="arc-3d" hidden></canvas></div>
    <div id="m-extra"></div>
    <div class="card row gap mchat"><label class="small"><input type="checkbox" id="m-text" style="width:auto"> 💬 Chat</label><label class="small"><input type="checkbox" id="m-voice" style="width:auto"> 🎙 Voice</label><span class="muted small grow">this round only</span><button id="m-rematch" class="small" hidden>↻ Rematch</button></div>${pttHTML('m-ptt')}
    <div id="m-chatbox" hidden class="card"><div id="m-log" class="dg-log"></div><form id="m-cf" class="row gap"><input id="m-cin" maxlength="200" placeholder="Message"><button>Send</button></form></div>
    <div class="card" id="m-seats"></div></div>`;
  const cv = v.querySelector('#m-cv'), ctx = cv.getContext('2d'), c3 = v.querySelector('#m-3d-cv'), $ = s => v.querySelector(s); let sel = null, msg = '', chatLog = [];
  $('#m-back').onclick = () => { stopMatch(); matchView(v, me, M.mode); };
  const syncChat = () => { $('#m-text').checked = M.chat.text; $('#m-voice').checked = M.chat.voice && (!isMinor(me)); $('#m-chatbox').hidden = !M.chat.text; };
  $('#m-text').onchange = e => { M.setChat('text', e.target.checked); syncChat(); };
  $('#m-voice').onchange = async e => { if (e.target.checked && isMinor(me) && !(await mesh()?.parent?.allowed('proximityVoice'))) { e.target.checked = false; msg = 'A parent has to allow voice (👪).'; return; } M.setChat('voice', e.target.checked); syncChat();
    if (M.chat.voice && !mv) { const { startVoice } = await import('./voice-ui.js'); const peers = new Map(M.seats.filter(s => !s.ai).map(s => [s.code, s])); const x = await startVoice({ me, code, mesh: mesh(), mode: 'room', peerInfo: c => peers.get(c), isMuted: c => mutedSeats.has(c), root: $('#m-ptt') });
      if (x.error) msg = x.error; else { mv = x; for (const c of peers.keys()) if (c !== code) mv.hub.connect(c); } }
    if (!M.chat.voice && mv) { mv.stop(); mv = null; } };
  $('#m-cf').onsubmit = e => { e.preventDefault(); const i = $('#m-cin'); if (i.value && M.chat.text) chatLog.push({ who: 'you', text: i.value }); i.value = ''; $('#m-log').innerHTML = chatLog.slice(-6).map(l => `<div class="small"><b>${esc(l.who)}:</b> ${esc(l.text)}</div>`).join(''); };
  $('#m-rematch').onclick = () => { if (hr && hr.rot.roster.size > 1) { if (hr.requestRematch() === 'local') play(v, me, M, sec, code); else msg = 'asked the host for a rematch'; } else { M.rematch(); play(v, me, M, sec, code); } };
  syncChat();
  const seats = () => { $('#m-seats').innerHTML = M.seats.map((s, i) => `<div class="row gap small"><b style="color:${s.team ? P.hot : P.cy}">${s.team ? 'B' : 'A'}${Math.floor(i / 2) + 1}</b><span class="grow"><span${PM.nameAttrs({ ...s, bot: s.ai, name: s.name || s.code }, code)}>${esc(botLabel({ name: s.code === code ? 'you' : s.name || s.code, bot: s.ai }))}</span></span>${!s.ai && s.code !== code ? `<button data-mute="${esc(s.code)}" class="small">Mute</button><button data-blk="${esc(s.code)}" class="small">Block</button><button data-rep="${esc(s.code)}" class="small">⚑ Report</button>` : ''}</div>`).join('') + `<div class="muted small">Score ${M.wins[0]}–${M.wins[1]} · moves are signed and checked on both sides</div>`;
    v.querySelectorAll('[data-blk]').forEach(b => b.onclick = () => mesh()?.block(b.dataset.blk)); v.querySelectorAll('[data-rep]').forEach(b => b.onclick = () => { const m = mesh(); if (m) import('./mesh-ui.js').then(U => U.reportFlow(m, b.dataset.rep, '', 'game', g.id)); });
    v.querySelectorAll('[data-mute]').forEach(b => b.onclick = async () => { const R = await import('./reports.js'); await R.mute(code, b.dataset.mute); mutedSeats.add(b.dataset.mute); mv?.hub.drop(b.dataset.mute); b.textContent = 'Muted'; b.disabled = true; }); };
  seats();
  // HOST ROTATION (src/arcade/hostrot-net.js): humans in this match share authority; batched compact signatures over 'arc'.
  // JOIN-ANYTIME: a 'join' ping seats a real-time joiner NOW (replaces a bot), turn-based joiners at the next round.
  let lastRound = M.round; hooks = { onHost: (h, e, why) => { msg = h === code ? `you are host (term ${e})` : `host → ${h.slice(0, 6)} (${why})`; },
    onJoin: (p, r) => { if (r.ok && !r.already) { msg = `${p.name || p.code.slice(0, 6)} ${r.seated === 'now' ? 'joined' : 'joins next round'}`; seats(); } },
    onLeave: c => { msg = `${(M.seats.find(s => s.code === c)?.name || c).slice(0, 12)} left · AI took the seat`; seats(); },
    onSync: () => { if (M.round !== lastRound) { lastRound = M.round; setTimeout(() => v.isConnected && play(v, me, M, sec, code), 0); } else seats(); } }; // next round from the host -> rebuild view
  if (!hr) { const roster = net?.roster || Object.fromEntries(M.seats.filter(s => !s.ai && s.pub).map(s => [s.code, s.pub])); if (!roster[code]) roster[code] = b64(nacl.sign.keyPair.fromSecretKey(sec).publicKey);
    hr = bindMatch({ match: M, arcade: mesh()?.arcade, code, secretKey: sec, roster, initial: net?.initial || null, onHost: (...a) => hooks.onHost?.(...a), onJoin: (...a) => hooks.onJoin?.(...a), onLeave: (...a) => hooks.onLeave?.(...a), onSync: (...a) => hooks.onSync?.(...a) }); }
  if (mySeat() < 0) msg = 'watching · you take a seat next round';
  globalThis.__cmMatch = () => hr && { id: M.id, game: g.id, view, seats: M.seats.map(s => ({ code: s.code, ai: !!s.ai })), host: hr.rot.host, epoch: hr.rot.epoch, roster: [...hr.rot.roster.keys()], pending: (M.pendingHumans || []).map(p => p.code), round: M.round, seq: M.seq, head: M.head, me: code }; // read-only test/diagnostic view
  M.joinPolicy = isRealtime(g.id) ? 'now' : 'next-round';
  const mine = () => M.mod.turnSeat?.(M.state) === mySeat();
  const doMove = mv => { const r = M.receive(M.makeMove(mySeat(), mv, sec)); if (!r.ok) msg = r.reason === 'illegal' ? 'Illegal move' : r.reason; else { msg = ''; mesh()?.arcade?.send({ op: 'mv', mid: M.id, sm: M.log[M.log.length - 1] }); hr?.commit(); } sel = null; return r.ok; };
  const BS = g.id === 'battleship' ? bsController({ M, mySeat, doMove, $ }) : null; if (BS) BS.mount2d(cv);
  // ---- 3D views
  const try3d = async () => { if (!use3d) return; const S = await import('./arcade/three-scene.js'); if (!S.can3D()) { msg = '2D mode (3D needs WebGL2)'; S.noteFallback(cv.parentElement, globalThis.__cm3dDiag?.fallback || 'no WebGL2'); return; }
    c3.hidden = false; cv.hidden = true; c3.width = c3.clientWidth; c3.height = c3.clientHeight; const kind = THREE_D[g.id];
    if (kind === 'board') { const B = view === 'v36' ? await import('./arcade/board3d-v36.js') : await import('./arcade/board3d.js'); view3d = await B.board3d(c3, { game: g.id, onPick: sq => pickSq(sq) }); }
    if (kind === 'c4') { const B = await import('./arcade/c4-3d.js'); view3d = await B.connect4_3d(c3, { onPick: col => mine() && doMove({ col }) }); }
    if (kind === 'paddle') { const B = await import('./arcade/paddle3d.js'); view3d = await B.paddle3d(c3, { style: localStorage.getItem('cm.arc.paddle') || (q.get('style') || 'airhockey') }); }
    if (kind === 'grid' && g.id === 'ttt') { const B = await import('./arcade/grid3d.js'); view3d = await B.grid3d(c3, { boards: [{ id: 't', n: 3, cx: 0, cz: 0, size: 6 }], R: 10, tilt: 1.1, onPick: (b, c) => { if (mine()) doMove({ k: c }); } }); }
    if (kind === 'grid' && g.id === 'uttt') { const B = await import('./arcade/grid3d.js'); view3d = await B.grid3d(c3, { boards: [{ id: 'u', n: 9, group: 3, cx: 0, cz: 0, size: 8 }], R: 12.5, tilt: 1.12, onPick: (b, c) => { if (mine()) { press = { c: [c % 9, Math.floor(c / 9)], t: performance.now() }; doMove(utttMove(c % 9, Math.floor(c / 9))); } } }); }
    if (g.id === 'battleship') view3d = await BS.mount3d(c3); // v36: fixed-camera Star Fleet view, placement phase, hidden enemy fleet
    if (kind === 'trivia') { const B = await import('./arcade/trivia3d.js'); view3d = await B.trivia3d(c3, { onPick: i => { const st = M.state; if (!(mySeat() in st.ans)) doMove({ q: st.q, a: i }); } }); $('#tv-ch')?.remove(); }
    if (kind === 'tron') { const B = await import('./arcade/tron3d.js'); view3d = await B.tron3d(c3); }
    if (kind === 'snake') { const B = await import('./arcade/snake3d.js'); view3d = await B.snake3d(c3); } };
  try3d().catch(e => { console.warn('3D fallback (2D view used):', e?.message || e); import('./arcade/three-scene.js').then(S => S.noteFallback(cv.parentElement, e?.message || e)); c3.hidden = true; cv.hidden = false; view3d = null; });
  // ---- input
  const pickSq = sq => { if (!mine()) return; const st = M.state;
    if (g.id === 'chess') { const ms = M.mod.moves(st); if (sel != null && ms.some(m => m.f === sel && m.t === sq)) { doMove({ f: sel, t: sq }); return; } sel = ms.some(m => m.f === sq) ? sq : null; }
    if (g.id === 'checkers') { const ms = M.mod.moves(st); if (sel != null) { const m = ms.find(m => m.path[0] === sel && m.path[m.path.length - 1] === sq); if (m) { doMove({ path: m.path }); return; } } sel = ms.some(m => m.path[0] === sq) ? sq : null; } };
  const nrm = e => e.nx != null ? [e.nx, e.ny] : normFromClient(cv, e.clientX, e.clientY);
  const boardCell = (e, n) => { const [nx, ny] = nrm(e); return cellAt(nx, ny, n, { W: cv.width, H: cv.height }); }; let hover = null, press = null;
  const cell = (e, n) => { if (e.nx != null) return [Math.floor(e.nx * n), Math.floor(e.ny * n)]; const b = cv.getBoundingClientRect(); return [Math.floor((e.clientX - b.left) / b.width * n), Math.floor((e.clientY - b.top) / b.height * n)]; };
  if (g.id === 'uttt') { cv.addEventListener('pointermove', e => { hover = boardCell(e, 9); }); cv.addEventListener('pointerleave', () => { hover = null; }); cv.addEventListener('pointerdown', e => { const h = boardCell(e, 9); if (h) press = { c: h, t: performance.now() }; }); }
  cv.onclick = e => { const st = M.state;
    if (g.id === 'chess' || g.id === 'checkers') { const h = boardCell(e, 8); if (h) pickSq(h[1] * 8 + h[0]); }
    else if (g.id === 'connect4' && mine()) { const [c] = cell(e, 7); doMove({ col: c }); }
    else if (g.id === 'uttt' && mine()) { const h = boardCell(e, 9); if (h) { press = { c: h, t: performance.now() }; doMove(utttMove(h[0], h[1])); } }
    /* battleship: pointer handling lives in battleship-ui.js (BS.mount2d) */ };
  if (g.id === 'trivia') { $('#m-extra').innerHTML = '<div class="trivia-ch row gap" id="tv-ch"></div>'; }
  let hold = 0; if (g.kind === 'realtime') { $('#m-extra').innerHTML = g.id === 'pong' ? '' /* cm-v35: up/down buttons removed; drag on the table moves your paddle */ : `<div class="row gap arc-pad">${['left', 'up', 'down', 'right'].map(d => `<button data-dir="${d}">${{ left: '◀', up: '▲', down: '▼', right: '▶' }[d]}</button>`).join('')}</div>`;
    v.querySelectorAll('[data-hold]').forEach(b => { b.onpointerdown = () => { hold = +b.dataset.hold; }; b.onpointerup = b.onpointerleave = () => { hold = 0; }; });
    if (g.id === 'pong') { let tgt = null; const pt = e => { let y = null; if (view3d?.padAt && !c3.hidden) y = view3d.padAt(e.clientX, e.clientY); else { const b = cv.getBoundingClientRect(), Y = (e.clientY - b.top) / b.height * cv.height; y = (Y - 160) / 4; } tgt = y; };
      for (const el of [cv, c3]) { el.style.touchAction = 'none'; el.addEventListener('pointerdown', e => { el.setPointerCapture?.(e.pointerId); pt(e); }); el.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') pt(e); }); el.addEventListener('pointerup', () => { tgt = null; hold = 0; }); el.addEventListener('pointercancel', () => { tgt = null; hold = 0; }); }
      globalThis.__cmPongHold = () => { const me = M.state?.pads?.[mySeat()]; if (tgt == null || !me) return hold; const d = tgt - me.y; return Math.abs(d) < 2 ? 0 : Math.sign(d); }; }
    const an = !!M.state.game?.analog; v.querySelectorAll('[data-dir]').forEach(b => { const d = b.dataset.dir; if (an && (d === 'left' || d === 'right')) { const t = d === 'left' ? -1 : 1; b.onpointerdown = () => M.state.input?.(code, { t }); b.onpointerup = b.onpointerleave = () => M.state.input?.(code, { t: 0 }); } else b.onclick = () => M.state.input?.(code, d); });
    if (an) { let down = false; const aim = e => { const me = M.state.players.get(code); if (!me) return; let a = null; if (view3d?.aimAt && !c3.hidden) a = view3d.aimAt(e.clientX, e.clientY); else { const b = cv.getBoundingClientRect(), s = 640 / M.state.size, X = (e.clientX - b.left) / b.width * cv.width, Y = (e.clientY - b.top) / b.height * cv.height; a = Math.atan2(Y - (50 + me.y * s), X - (40 + me.x * s)); } if (a != null) M.state.input(code, { a }); };
      for (const el of [cv, c3]) { el.style.touchAction = 'none'; el.addEventListener('pointerdown', e => { down = true; aim(e); }); el.addEventListener('pointermove', e => { if (down) aim(e); }); el.addEventListener('pointerup', () => { down = false; }); } } }
  const anK = { ArrowLeft: -1, ArrowRight: 1 }; let anHeld = 0;
  document.onkeydown = e => { if (!cv.isConnected) return; if (M.state.game?.analog && anK[e.key]) { e.preventDefault(); if (anHeld !== anK[e.key]) { anHeld = anK[e.key]; M.state.input(code, { t: anHeld }); } return; } if (g.id === 'pong') hold = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : hold; const d = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key]; if (d && M.state.input) { e.preventDefault(); M.state.input(code, d); } };
  document.onkeyup = e => { if (M.state.game?.analog && anK[e.key] === anHeld && anHeld) { anHeld = 0; M.state.input(code, { t: 0 }); } if (g.id === 'pong' && /Arrow(Up|Down)/.test(e.key)) hold = 0; };
  // ---- loop
  let n = 0; const rng = mulberry32(M.seed); const audio = matchWatcher(g.id, M, mySeat);
    // v51: Join invite when Matchmaker finds humans while we're in a bot match
  const invBox = () => { const el = $('#m-invite'), inv = mm.pendingInvite(code); if (!el) return;
    if (!inv) { el.hidden = true; return; }
    el.hidden = false; const left = Math.max(0, Math.ceil((inv.until - Date.now()) / 1000));
    const tx = $('#m-inv-txt'); if (tx) tx.textContent = `${inv.game} ${inv.mode} · ${inv.from.length} searching`;
    const cd = $('#m-inv-cd'); if (cd) cd.textContent = `${left}s`; };
  $('#m-inv-yes')?.addEventListener('click', () => { const r = mm.acceptInvite(code); if (r.ok && r.match) { stopMatch(); play(v, me, r.match, sec, code); } else invBox(); });
  $('#m-inv-no')?.addEventListener('click', () => { mm.declineInvite(code); invBox(); msg = 'stayed in bot match'; });
  loop = setInterval(() => { if (!v.isConnected) return stopMatch(); n++;
    if (n % 10 === 0) { mm.tick(); invBox(); }
    if (g.id === 'pong') { if (!M.over) { M.mod.input(M.state, mySeat(), globalThis.__cmPongHold ? globalThis.__cmPongHold() : hold); M.seats.forEach((s, i) => s.ai && M.mod.input(M.state, i, M.mod.ai(M.state, i, rng, 0.55))); M.mod.step(M.state); const r = M.mod.result(M.state); if (r) { M.over = r; M.wins[r.winner]++; } } }
    else if (g.kind === 'realtime') { if (!M.over && n % Math.max(1, Math.round((M.state.tickMs || TICK_MS) / 40)) === 0) { M.state.step(); const r = roundResult(M.state); if (r) { M.over = r; if (!r.draw) M.wins[r.winner]++; } } }
    else if (!M.over && n % 12 === 0 && (!hr || hr.rot.isHost)) { const ts = M.mod.turnSeat(M.state); let moved = false; if (M.mod.simultaneous) { M.seats.forEach((s, i) => { if (s.ai && rng() < 0.3 && M.aiMove(i)?.ok) moved = true; }); } else if (ts != null && M.seats[ts]?.ai) moved = !!M.aiMove(ts)?.ok; if (moved) hr?.commit(); } // bots: host only (replicas follow the commit)
    $('#m-rematch').hidden = !M.over; BS?.tick(); audio.tick(); render(); hr?.tick(); if (n % 25 === 0) seats(); }, 40);
  const render = () => { const st = M.state, W = cv.width, H = cv.height, now = performance.now(), Pp = FX.palette(); FX.background(ctx, W, H, Pp, 36);
    const status = M.over ? (M.over.draw ? `draw · ${M.over.how || ''}` : `${M.over.winner === M.seats[mySeat()]?.team ? 'you win' : 'you lose'} · ${M.over.how || ''}`) : (g.kind === 'turn' && !M.mod.simultaneous ? (mine() ? 'your move' : 'thinking…') : 'live');
    if (view3d) { if (g.id === 'chess' || g.id === 'checkers') { const ms = M.mod.moves(st); view3d.set(st.b, { highlight: sel != null ? (g.id === 'chess' ? ms.filter(m => m.f === sel).map(m => m.t) : ms.filter(m => m.path[0] === sel).map(m => m.path.at(-1))) : [] }); }
      if (g.id === 'connect4') view3d.set(st, { win: M.over }); if (g.id === 'pong') view3d.set(st); if (g.id === 'ttt') { const l = M.mod.line?.(st); view3d.set({ marks: st.c.map((v2, c) => v2 == null ? null : { b: 't', c, k: v2 ? 'o' : 'x' }).filter(Boolean), glow: { t: l || [] } }); } if (g.id === 'uttt') { const mk = []; for (let B2 = 0; B2 < 9; B2++) for (let k = 0; k < 9; k++) { const v2 = st.c[B2 * 9 + k]; if (v2 == null) continue; mk.push({ b: 'u', c: (Math.floor(B2 / 3) * 3 + Math.floor(k / 3)) * 9 + (B2 % 3) * 3 + k % 3, k: v2 ? 'o' : 'x' }); }
        const glow = []; if (st.force >= 0 && st.big[st.force] == null && !M.over) for (let k = 0; k < 9; k++) glow.push((Math.floor(st.force / 3) * 3 + Math.floor(k / 3)) * 9 + (st.force % 3) * 3 + k % 3); view3d.set({ marks: mk, glow: { u: glow } }); }
      if (g.id === 'battleship') BS.sync(view3d);
      if (g.id === 'trivia') { const Q = st.q < 10 ? M.mod.question(st) : null; view3d.set({ text: Q ? Q.text : 'Final score', choices: Q ? Q.choices : [], score: st.score, answered: mySeat() in st.ans }); }
      const se = $('#m-status'); if (se) se.textContent = `${status}${msg ? ' · ' + msg : ''}`;
      if (g.id === 'tronduel' || g.id === 'snakebattle') view3d.set(st, FX.distinctColors([...st.players.values()].map(p => ({ code: p.code, color: p.team ? Pp.hot : Pp.cy }))), code); }
    if (view3d && !c3.hidden) return; // 3D active: skip the (hidden) 2D glow render entirely — big perf win (Tron Duel)
    const B = (n2, x0, y0, sz) => { const s = sz / n2; ctx.save(); ctx.strokeStyle = Pp.cy; ctx.globalAlpha = .35 + .3 * FX.pulse(now); ctx.lineWidth = 1.5; ctx.beginPath(); for (let i = 0; i <= n2; i++) { ctx.moveTo(x0 + i * s, y0); ctx.lineTo(x0 + i * s, y0 + sz); ctx.moveTo(x0, y0 + i * s); ctx.lineTo(x0 + sz, y0 + i * s); } ctx.stroke(); ctx.restore(); FX.neonRect(ctx, x0, y0, sz, sz, Pp.cy, { r: 4, t: now }); return s; };
    if (g.id === 'chess' || g.id === 'checkers') { const s = B(8, 40, 50, 640); const GL = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
      for (let i = 0; i < 64; i++) { const x = 40 + (i & 7) * s, y = 50 + (i >> 3) * s; if (((i & 7) + (i >> 3)) % 2) { ctx.fillStyle = Pp.bg2; ctx.globalAlpha = .8; ctx.fillRect(x + 1, y + 1, s - 2, s - 2); ctx.globalAlpha = 1; } if (i === sel) FX.neonRect(ctx, x + 3, y + 3, s - 6, s - 6, Pp.hot, { t: now });
        const pc = st.b[i]; if (!pc) continue; const white = g.id === 'chess' ? pc === pc.toUpperCase() : pc.toLowerCase() === 'r', col = white ? Pp.cy : Pp.hot;
        if (g.id === 'chess') { ctx.font = `${s * .72}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = col; FX.glow(ctx, col, c => c.fillText(GL[pc], x + s / 2, y + s / 2 + 2), { blur: 8 }); ctx.textAlign = 'left'; }
        else { FX.neonCircle(ctx, x + s / 2, y + s / 2, s * .36, col, { fill: false, lw: 4 }); if (pc === pc.toUpperCase()) FX.neonCircle(ctx, x + s / 2, y + s / 2, s * .15, Pp.acid); } } }
    if (g.id === 'connect4') { const s = 640 / 7; FX.neonRect(ctx, 40, 90, 640, s * 6, Pp.cy, { t: now }); for (let i = 0; i < 42; i++) { const x = 40 + (i % 7) * s + s / 2, y = 90 + Math.floor(i / 7) * s + s / 2, t = st.g[i]; if (t == null) { ctx.strokeStyle = Pp.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, s * .38, 0, 7); ctx.stroke(); } else FX.neonCircle(ctx, x, y, s * .38 * (M.over?.line?.includes(i) ? 1 + .08 * FX.pulse(now) : 1), t ? Pp.hot : Pp.cy); } }
    if (g.id === 'uttt') { const s = B(9, 40, 50, 640); for (const [hc, a] of [[hover, .18], [press && now - press.t < 350 ? press.c : null, .45]]) if (hc) { ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = Pp.hot; ctx.fillRect(40 + hc[0] * s + 2, 50 + hc[1] * s + 2, s - 4, s - 4); ctx.restore(); FX.neonRect(ctx, 40 + hc[0] * s + 3, 50 + hc[1] * s + 3, s - 6, s - 6, Pp.hot, { t: now }); } // hover + press feedback ctx.lineWidth = 4; for (let k = 1; k < 3; k++) FX.neonPath(ctx, [[40 + k * 3 * s, 50], [40 + k * 3 * s, 690]], Pp.hot, { lw: 3 }), FX.neonPath(ctx, [[40, 50 + k * 3 * s], [680, 50 + k * 3 * s]], Pp.hot, { lw: 3 });
      for (let B2 = 0; B2 < 9; B2++) for (let k = 0; k < 9; k++) { const v2 = st.c[B2 * 9 + k]; if (v2 == null) continue; const c = (B2 % 3) * 3 + k % 3, r = Math.floor(B2 / 3) * 3 + Math.floor(k / 3), x = 40 + c * s + s / 2, y = 50 + r * s + s / 2; if (v2) FX.neonCircle(ctx, x, y, s * .3, Pp.hot, { fill: false, lw: 3 }); else FX.neonPath(ctx, [[x - s * .28, y - s * .28], [x + s * .28, y + s * .28]], Pp.cy, { lw: 3 }), FX.neonPath(ctx, [[x + s * .28, y - s * .28], [x - s * .28, y + s * .28]], Pp.cy, { lw: 3 }); }
      if (st.force >= 0 && st.big[st.force] == null && !M.over) FX.neonRect(ctx, 40 + (st.force % 3) * 3 * s + 3, 50 + Math.floor(st.force / 3) * 3 * s + 3, 3 * s - 6, 3 * s - 6, Pp.acid, { t: now }); }
    if (g.id === 'battleship') BS.draw2d(ctx, Pp, FX, B);
    if (g.id === 'trivia') { const Q = st.q < 10 ? M.mod.question(st) : null; ctx.fillStyle = Pp.fg; ctx.font = `600 28px ${Pp.mono}`; wrap(ctx, Q ? Q.text : 'Final score', 60, 160, 600, 38); ctx.font = `600 64px ${Pp.mono}`; ctx.fillStyle = Pp.cy; ctx.fillText(String(st.score[0]), 120, 520); ctx.fillStyle = Pp.hot; ctx.fillText(String(st.score[1]), 540, 520); FX.neonRect(ctx, 60, 420, 600, 140, Pp.cy, { t: now });
      const ch = $('#tv-ch'); const key = st.q + ':' + (mySeat() in st.ans); if (ch && ch.dataset.k !== key) { ch.dataset.k = key; ch.innerHTML = Q && !(mySeat() in st.ans) ? Q.choices.map((c, i) => `<button data-a="${i}">${esc(c)}</button>`).join('') : '<span class="muted small">waiting for the others…</span>'; ch.querySelectorAll('[data-a]').forEach(b => b.onclick = () => doMove({ q: st.q, a: +b.dataset.a })); } }
    if (g.id === 'pong') { const sx = 640 / 160, x0 = 40, y0 = 160; FX.neonRect(ctx, x0, y0, 640, 400, Pp.cy, { t: now }); FX.neonPath(ctx, [[x0 + 320, y0], [x0 + 320, y0 + 400]], Pp.hot, { lw: 1.5 });
      for (const p of st.pads) FX.neonPath(ctx, [[x0 + p.x * sx, y0 + (p.y - 9) * 4], [x0 + p.x * sx, y0 + (p.y + 9) * 4]], p.team ? Pp.hot : Pp.cy, { lw: 8 }); FX.neonCircle(ctx, x0 + st.ball.x * sx, y0 + st.ball.y * 4, 9, Pp.fg);
      ctx.font = `600 48px ${Pp.mono}`; ctx.fillStyle = Pp.cy; ctx.fillText(String(st.score[0]), 260, 130); ctx.fillStyle = Pp.hot; ctx.fillText(String(st.score[1]), 430, 130); }
    if (g.id === 'tronduel' || g.id === 'snakebattle') { const w = st, s = 640 / w.size; FX.neonRect(ctx, 40, 50, 640, 640, Pp.cy, { t: now }); ctx.save(); ctx.translate(40, 50);
      for (const poly of w.polys || []) { const o = w.players.get(poly.o); if (!o) continue; ctx.beginPath(); poly.pts.forEach(([x, y], i) => i ? ctx.lineTo(x * s, y * s) : ctx.moveTo(x * s, y * s)); ctx.closePath(); ctx.globalAlpha = .24; ctx.fillStyle = o.team ? Pp.hot : Pp.cy; ctx.fill(); ctx.globalAlpha = 1; } // true captured polygons
      for (const f of w.food || []) { ctx.fillStyle = Pp.acid; ctx.fillRect(f[0] * s - s / 6, f[1] * s - s / 6, s / 3, s / 3); }
      for (const p of w.players.values()) { if (!p.alive) continue; const col = p.team ? Pp.hot : Pp.cy, cells = g.id === 'snakebattle' ? p.body : [...(p.trail || []), [p.x, p.y]]; const segs = [[]]; let lp = null; for (const [x, y] of cells || []) { if (lp && (Math.abs(x - lp[0]) > 3 || Math.abs(y - lp[1]) > 3)) segs.push([]); segs[segs.length - 1].push([x * s, y * s]); lp = [x, y]; } for (const sg of segs) if (sg.length > 1) FX.neonPath(ctx, sg, col, { lw: s * .6 }); FX.neonCircle(ctx, p.x * s, p.y * s, s * .7, p.code === code ? Pp.fg : col); } ctx.restore(); }
    FX.frame(ctx, W, H, Pp, now); FX.hud(ctx, W, H, Pp, { title: `${g.name} · ${M.mode}`, right: status, bottom: msg || `round ${M.round + 1} · chat ${M.chat.text ? 'on' : 'off'} · voice ${M.chat.voice ? 'on' : 'off'}` }); };
  render();
}
function wrap(ctx, t, x, y, w, lh) { let line = ''; for (const word of t.split(' ')) { if (ctx.measureText(line + word).width > w) { ctx.fillText(line, x, y); line = ''; y += lh; } line += word + ' '; } ctx.fillText(line, x, y); }
