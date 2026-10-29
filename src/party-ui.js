// PARTY GAMES UI (Mass Arena): Bingo + Mass Trivia. Separate from arcade-ui.js on purpose (keeps the host-rotation / shop
// merges clean). Rooms: InstanceManager with cap 200 (section 15: chat-style games may go to ~200; real-time caps unchanged),
// keyed by age band so adults and minors never share a room. 3D-only (grid3d bingo card / trivia3d pads). Global party
// voice (src/party/voice.js) = push-to-talk to the room, 10 s per minute budget, same-band only, parent rules apply.
import { InstanceManager } from './arcade/instance.js';
import { band, gband, gameCompat, xageOk } from './arcade/proximity.js';
import { isMinor } from './discovery.js';
import { mesh } from './app-mesh.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
import { nameAttrs } from './player-menu.js';
import { sfx, audioState } from './sfx.js';
import * as BG from './party/bingo.js';
import * as MT from './party/mtrivia.js';
import { PartyVoice } from './party/voice.js';
const lobbies = {}; let timer = null, view3d = null, pv = null, joined = null; const voiceOn = new Map(); const prefs = { speed: 'fast', caller: true };
export const partyLobby = (g, me) => { const k = g + '|' + gband(me); return lobbies[k] ||= new InstanceManager({ gameName: g, cap: g === 'bingo' ? BG.ROOM_CAP : MT.ROOM_CAP, factory: id => g === 'bingo' ? new BG.BingoRoom({ id, speed: prefs.speed }) : new MT.TriviaRoom({ id }) }); };
export const PARTY_GAMES = ['bingo', 'mtrivia'];
export function stopParty() { clearInterval(timer); timer = null; view3d?.dispose?.(); view3d = null; pv?.stop(); pv?.closeAll(); rh?.stop(); rh = null; if (pv) pv.connect = null; const m = mesh(); if (joined && m) m.arcade?.send({ g: joined, op: 'leave' }); joined = null; try { speechSynthesis.cancel(); } catch {} }
const say = t => { if (!prefs.caller || !audioState().sound) return; try { const u = new SpeechSynthesisUtterance(t); u.rate = 1.05; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch {} };
export async function partyView(v, me, g, tabs = '') { stopParty();
  const myCode = mesh()?.code || 'ME', L = partyLobby(g, me), R = L.join(myCode, { name: me?.name || 'you', minor: isMinor(me), xage: xageOk(me), adult: !isMinor(me) }); joined = g;
  pv ||= new PartyVoice({ me, parent: isMinor(me) ? mesh()?.parent : null, isBlocked: c => !!mesh()?.blocklist?.isBlocked(c) });
  const m = mesh(); m?.arcade?.listen((from, b) => { if (b.g !== g || !gameCompat(b, me)) return; /* v56: cross-age only when both allow it */ const LL = partyLobby(g, me);
    if (b.op === 'join' && !LL.where.has(from)) LL.join(from, { name: b.name || from.slice(0, 6), minor: !!b.minor, xage: !!b.xage, adult: !b.minor }); if (b.op === 'leave') LL.leave(from);
    const W = LL.where.get(from); if (b.op === 'daub') W?.daub?.(from, b.i); if (b.op === 'claim') W?.claim?.(from); if (b.op === 'ans') W?.answer?.(from, b.q, b.a); if ('voice' in b) voiceOn.set(from, !!b.voice); });
  const send = o => m?.arcade?.send({ g, minor: isMinor(me), xage: xageOk(me), ...o }); send({ op: 'join', sub: R.id, name: me?.name, voice: pv.enabled });
  v.innerHTML = `${tabs}<div class="card"><div class="row gap small" id="pt-status"></div>${g === 'bingo' ? `<div class="row gap small"><label>Caller speed <select id="bg-speed" style="width:auto"><option value="fast">every 10 s</option><option value="classic">every 1 min</option></select></label><label><input type="checkbox" id="bg-caller" style="width:auto" ${prefs.caller ? 'checked' : ''}> 🔊 Caller voice</label></div>` : ''}</div>
    <div class="arc-stage"><canvas id="pt-3d" class="arc-cv" style="width:100%;height:min(62vh,520px);touch-action:none"></canvas></div>
    ${g === 'bingo' ? '<div class="row gap"><button id="bg-claim" class="primary">BINGO!</button><span class="small" id="bg-msg"></span></div>' : '<div class="small" id="mt-msg"></div>'}
    <div id="pv-card"></div>
    <div class="card" id="pt-players"></div>`;
  const $ = s => v.querySelector(s);
  if (g === 'bingo') { $('#bg-speed').value = R.speed; $('#bg-speed').onchange = e => { prefs.speed = e.target.value; R.speed = prefs.speed; R.newRound(); R.lastN = null; }; $('#bg-caller').onchange = e => { prefs.caller = e.target.checked; };
    $('#bg-claim').onclick = () => { const r = R.claim(myCode); $('#bg-msg').textContent = r.ok ? '🎉 BINGO! You win this round.' : r.reason === 'no-bingo' ? 'Not yet — you need 5 daubed in a line.' : 'Round already won.'; if (r.ok) { sfx('win'); send({ op: 'claim' }); say('Bingo!'); } else sfx('wrong'); }; }
  const vb = mountVoice($('#pv-card'), me, send);
  const cv = $('#pt-3d'); cv.width = cv.clientWidth; cv.height = cv.clientHeight;
  try { if (g === 'bingo') { const G = await import('./arcade/grid3d.js'); view3d = await G.grid3d(cv, { boards: [{ id: 'bingo', n: 5, cx: 0, cz: 0.3, size: 6.4, label: 'B   I   N   G   O', nums: R.cardOf(myCode).map(n => n || 'FREE') }], R: 10.5, tilt: 1.2, orbitOn: false, onPick: (b, i) => { if (R.daub(myCode, i)) { sfx('daub'); send({ op: 'daub', i }); } else sfx('wrong', { gain: 0.4 }); } }); }
    else { const T = await import('./arcade/trivia3d.js'); view3d = await T.trivia3d(cv, { onPick: a => { const Q = R.question(); if (!Q) return; const r = R.answer(myCode, Q.q, a); if (r.ok) { sfx(r.correct ? 'correct' : 'wrong'); send({ op: 'ans', q: Q.q, a }); } } }); } }
  catch { cv.replaceWith(Object.assign(document.createElement('div'), { className: 'small muted', textContent: '3D is not available on this device.' })); }
  const render = () => { const now = Date.now(), lb = R.leaderboard(), mine = lb.find(r => r.code === myCode);
    if (g === 'bingo') { const called = R.called(now), c = R.cardOf(myCode), cur = R.current(now), p = R.players.get(myCode);
      $('#pt-status').innerHTML = `Room ${esc(R.id)} · ${R.players.size}/${BG.ROOM_CAP} · ball ${R.calledCount(now)}/75 · now: <b>${cur ? BG.label(cur) : '—'}</b>${R.winners.length ? ` · 🎉 winner: ${R.winners.map(w => esc(R.players.get(w)?.name || w)).join(', ')}` : ''}`;
      view3d?.setNums?.('bingo', c.map(n => n || 'FREE')); view3d?.set?.({ marks: [...(p?.daubed || [])].map(i => ({ b: 'bingo', c: i, k: 'daub' })), glow: { bingo: c.map((n, i) => (n && called.has(n) ? i : -1)).filter(i => i >= 0) } });
      $('#pt-players').innerHTML = '<h4 class="small">Wins</h4>' + lb.slice(0, 30).map(r => `<div class="row gap small"><b${nameAttrs(R.players.get(r.code), myCode)}>${esc(r.name)}</b>${r.bot ? ' 🤖' : ''}<span class="muted">${r.wins}</span></div>`).join(''); }
    else { const Q = R.question(now); $('#pt-status').innerHTML = `Room ${esc(R.id)} · ${R.players.size}/${MT.ROOM_CAP} · ${Q ? `Q${Q.q + 1}/${MT.QN} · ${Math.ceil(Q.left / 1000)} s` : '🏆 podium'}`;
      view3d?.set?.(Q ? { text: Q.text, choices: Q.choices, score: [mine?.pts || 0, '#' + (mine?.rank || '-')], answered: R.answered(myCode, now) } : { text: 'Podium: ' + lb.slice(0, 3).map(r => r.name + ' ' + r.pts).join(' · '), choices: [], score: [mine?.pts || 0, '#' + (mine?.rank || '-')] });
      $('#mt-msg').textContent = Q && R.answered(myCode, now) ? 'Answer locked in — waiting for the next question…' : '';
      $('#pt-players').innerHTML = '<h4 class="small">Leaderboard</h4>' + lb.slice(0, 30).map(r => `<div class="row gap small">#${r.rank} <b${nameAttrs(R.players.get(r.code), myCode)}>${esc(r.name)}</b>${r.bot ? ' 🤖' : ''}<span class="muted">${r.pts}</span></div>`).join(''); }
    vb.tick(R.players.values(), myCode); };
  timer = setInterval(() => { if (!v.isConnected) return stopParty(); const evs = R.step(Math.random); for (const e of evs) { if (e.t === 'call') { sfx('tick'); say(BG.label(e.n).replace('-', ' ')); } if (e.t === 'bingo') sfx('claim'); if (e.t === 'question') sfx('tick'); if (e.t === 'reset') sfx('go', { gain: 0.6 }); } render(); }, 250);
  render(); globalThis.__cmParty = { room: R, voice: pv, me: myCode, view: () => view3d };
}
// Room-voice bar shared by Bingo, Mass Trivia and Draw & Guess. send(o) broadcasts {op:'voice', voice}. Returns {tick(players, myCode)}.
let rh = null; const roomPeers = new Map(); // real WebRTC room voice (src/rtc-voice.js) behind the PartyVoice budget logic
export function mountVoice(el, me, send = () => {}, peers = voiceOn) {
  pv ||= new PartyVoice({ me, parent: isMinor(me) ? mesh()?.parent : null, isBlocked: c => !!mesh()?.blocklist?.isBlocked(c) });
  el.innerHTML = `<div class="card"><div class="row gap small"><label><input type="checkbox" id="pv-on" style="width:auto" ${pv.enabled ? 'checked' : ''}> 🎙 Room voice</label><button id="pv-ptt" class="ghost" ${pv.enabled ? '' : 'disabled'}>Hold to talk</button><span id="pv-left"></span></div><div class="small muted">Push-to-talk to everyone in this room · max 10 s talk time per minute · only players in your age group · mute or block anyone from the list.</div></div>`; const $ = s => el.querySelector(s);
  $('#pv-on').onchange = async e => { const r = await pv.setEnabled(e.target.checked); if (!r.ok) { e.target.checked = false; $('#pv-left').textContent = 'A parent has to allow voice (👪).'; }
    if (r.ok && pv.enabled && !rh) { const { startVoice } = await import('./voice-ui.js'); const x = await startVoice({ me, code: mesh()?.code || 'ME', mesh: mesh(), mode: 'room', peerInfo: c => roomPeers.get(c), isMuted: c => pv.muted.has(c) }); if (x.error) $('#pv-left').textContent = x.error + ' (voice stays local)'; else { rh = x; pv.connect = c => rh.hub.connect(c); } }
    if (!pv.enabled && rh) { rh.stop(); rh = null; pv.connect = null; } $('#pv-ptt').disabled = !pv.enabled; send({ op: 'voice', voice: pv.enabled }); };
  const ptt = $('#pv-ptt'); ptt.onpointerdown = e => { e.preventDefault(); const r = pv.start(); if (r.ok) rh?.hub.press(); if (!r.ok && r.reason === 'budget') { $('#pv-left').textContent = `Talk time used — back in ${Math.ceil(r.waitMs / 1000)} s`; hold = Date.now() + 1500; } };
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) ptt.addEventListener(ev, () => { pv.stop(); rh?.hub.release(); });
  let hold = 0;
  return { voice: pv, tick(players, myCode) { if (pv.tick() === 'cut') rh?.hub.release(); rh?.hub.tick(); for (const p of players) roomPeers.set(p.code, p); ptt.textContent = pv.talking ? '🔴 Talking…' : 'Hold to talk'; if (pv.enabled && Date.now() > hold) $('#pv-left').textContent = `${Math.ceil(pv.remaining() / 1000)} s left this minute`; pv.update(players, myCode, c => !!peers.get(c)); } };
}
