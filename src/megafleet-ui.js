// MEGA FLEET tab (Mass Arena, Mega Battleship): king-of-the-hill space arena (sim: arcade/megaship.js FleetRoom, 3D view:
// arcade/megafleet3d.js, silent 2D fallback without WebGL). Controls: drag/hold anywhere (or move the mouse) = steer toward
// that point (free analog heading), tap = one shot, hold the FIRE button (or Space) = auto-fire, ←/→ or A/D = turn.
// No camera drag: the camera follows you and zooms out as you grow. Leaderboard = biggest ships in the room.
// Rooms: InstanceManager sub-maps (cap 100) of FleetRooms; bots fill rooms without enough humans (existing pattern).
import { InstanceManager } from './arcade/instance.js';
import * as MS from './arcade/megaship.js';
import * as FX from './arcade/fx.js';
import { THEMES, theme } from './theme.js';
import { botLabel } from './arcade/bots.js';
import { sfx } from './sfx.js';
import { mesh } from './app-mesh.js';
import { hashStr } from './arcade/engine.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CLASS = m => (m < 40 ? 'scout' : m < 150 ? 'corvette' : m < 500 ? 'frigate' : m < 1500 ? 'cruiser' : m < 4000 ? 'capital' : 'dreadnought');
let lobby = null, run = null;
export function stopMegaFleet() { if (!run) return; const r = run; run = null; clearInterval(r.loop); r.unsub?.(); r.view?.dispose?.(); document.removeEventListener('keydown', r.kd); document.removeEventListener('keyup', r.ku); try { r.L.leave(r.me); mesh()?.arcade?.send({ g: 'megaship', op: 'mfl' }); } catch {} }
const css = `.mf-stage{position:relative;height:min(74vh,640px);min-height:360px;border-radius:14px;overflow:hidden;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.mf-stage canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}.mf-lb{position:absolute;left:10px;top:10px;z-index:2;font:600 12px ui-monospace,monospace;background:color-mix(in srgb,var(--bg) 62%,transparent);border:1px solid color-mix(in srgb,var(--cy) 35%,transparent);border-radius:10px;padding:6px 8px;min-width:132px;max-width:46%;pointer-events:none}
.mf-lb b{color:var(--cy)}.mf-lb .me{color:var(--acid)}.mf-lb div{display:flex;gap:6px;justify-content:space-between;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.mf-hud{position:absolute;left:10px;bottom:10px;right:96px;z-index:2;font:600 12px ui-monospace,monospace;color:var(--fg);pointer-events:none;text-shadow:0 0 6px var(--bg)}
.mf-bar{height:5px;border-radius:3px;background:color-mix(in srgb,var(--fg) 18%,transparent);margin-top:4px;overflow:hidden}.mf-bar i{display:block;height:100%;background:var(--acid)}
.mf-fire{position:absolute;right:12px;bottom:12px;z-index:3;width:74px;height:74px;border-radius:50%;font:700 13px ui-monospace,monospace;background:color-mix(in srgb,var(--hot) 28%,transparent);border:2px solid var(--hot);color:var(--fg);touch-action:none;box-shadow:0 0 16px color-mix(in srgb,var(--hot) 60%,transparent)}
.mf-fire.on{background:color-mix(in srgb,var(--hot) 60%,transparent)}.mf-dead[hidden]{display:none}.mf-dead{position:absolute;inset:0;display:grid;place-items:center;z-index:2;font:700 18px ui-monospace,monospace;color:var(--hot);pointer-events:none}`;
export function megaFleetView(v, me, { tabs = '' } = {}) { stopMegaFleet(); if (!document.getElementById('mf-css')) { const s = document.createElement('style'); s.id = 'mf-css'; s.textContent = css; document.head.append(s); }
  const myCode = mesh()?.code || 'ME', minor = !!me?.minor;
  lobby ||= new InstanceManager({ gameName: 'megaship', factory: id => new MS.FleetRoom({ id, seed: hashStr(id) }) });
  const L = lobby, room = L.join(myCode, { name: me?.name || 'you', minor });
  v.innerHTML = `${tabs}<p class="muted small">Steer: drag or hold anywhere · tap = shoot · hold FIRE = auto-fire. Shoot asteroids to grow (max ${MS.MAX_MASS}), shoot ships down to steal their mass.</p>
    <div class="arc-stage mf-stage" id="mf-stage"><canvas id="mf-3d" class="arc-3d" aria-label="Mega Fleet 3D"></canvas><canvas id="mf-cv" width="720" height="720" hidden aria-label="Mega Fleet"></canvas><div class="mf-lb" id="mf-lb"></div><div class="mf-hud" id="mf-hud"></div><div class="mf-dead" id="mf-dead" hidden>DESTROYED · respawning…</div><button class="mf-fire" id="mf-fire" aria-label="Fire">FIRE</button></div>`;
  const stageEl = v.querySelector('#mf-stage'), c3 = v.querySelector('#mf-3d'), cv = v.querySelector('#mf-cv'), lb = v.querySelector('#mf-lb'), hud = v.querySelector('#mf-hud'), dead = v.querySelector('#mf-dead'), fireB = v.querySelector('#mf-fire');
  const ids = THEMES.map(t => t[0]).filter(t => t !== 'light'), colorCache = new Map();
  const colorOf = code => { if (colorCache.has(code)) return colorCache.get(code); const c = code === myCode ? FX.themeAccent(theme()) : FX.themeAccent(ids[hashStr(code) % ids.length]); colorCache.set(code, c); return c; };
  const R = run = { L, me: myCode, room, view: null, loop: 0 };
  // ---- 3D (or 2D fallback)
  import('./arcade/three-scene.js').then(async S => { if (!S.can3D()) throw new Error('no WebGL2'); const V = await import('./arcade/megafleet3d.js'); const view = await V.megafleet3d(c3, { colorOf }); if (run !== R) return view.dispose(); R.view = view; view.frame(room, myCode); })
    .catch(e => { console.warn('Mega Fleet 2D fallback:', e?.message || e); c3.hidden = true; cv.hidden = false; });
  // ---- input
  const self = () => room.players.get(myCode); let down = null, mouseSteer = false;
  const aimFrom = e => { const p = self(); if (!p) return null; if (R.view && !c3.hidden) return R.view.aimAt(e.clientX, e.clientY, p); const b = cv.getBoundingClientRect(); return Math.atan2(e.clientY - (b.top + b.height / 2), e.clientX - (b.left + b.width / 2)); };
  const steer = e => { const a = aimFrom(e); if (a != null) { room.input(myCode, { a }); net.aim = a; } };
  const shoot1 = () => { const p = self(); if (p?.alive && p.cd <= 0) { p.cd = MS.FIRE_CD; room.fireShot(p); } };
  for (const el of [c3, cv]) { el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); down = { x: e.clientX, y: e.clientY, t: performance.now() }; steer(e); });
    el.addEventListener('pointermove', e => { if (down || (e.pointerType === 'mouse' && mouseSteer)) steer(e); if (e.pointerType === 'mouse') mouseSteer = true; });
    const up = e => { if (down && performance.now() - down.t < 240 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 14) shoot1(); down = null; }; el.addEventListener('pointerup', up); el.addEventListener('pointercancel', () => { down = null; }); }
  const setFire = on => { room.input(myCode, { fire: on }); fireB.classList.toggle('on', on); };
  fireB.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); fireB.setPointerCapture?.(e.pointerId); setFire(true); }); for (const k of ['pointerup', 'pointercancel', 'lostpointercapture']) fireB.addEventListener(k, () => setFire(false));
  const keyT = { ArrowLeft: -1, a: -1, A: -1, ArrowRight: 1, d: 1, D: 1 };
  R.kd = e => { if (!stageEl.isConnected || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '')) return; if (keyT[e.key]) { e.preventDefault(); room.input(myCode, { t: keyT[e.key] }); } if (e.key === ' ') { e.preventDefault(); setFire(true); } };
  R.ku = e => { if (keyT[e.key]) room.input(myCode, { t: 0 }); if (e.key === ' ') setFire(false); };
  document.addEventListener('keydown', R.kd); document.addEventListener('keyup', R.ku);
  // ---- network glue (victim-authoritative hits; see megaship.js header)
  const net = { aim: null, last: 0 }, send = b => mesh()?.arcade?.send({ g: 'megaship', sub: room.id, ...b });
  R.unsub = mesh()?.arcade?.sub?.((from, b) => { if (b?.g !== 'megaship' || from === myCode) return; const W = L.where.get(from);
    if (b.op === 'mfj' && !W) L.join(from, { name: String(b.name || from).slice(0, 24), minor: !!b.minor, remote: true });
    const w = L.where.get(from); if (!w) return; if (b.op === 'mfl') L.leave(from);
    if (b.op === 'mfs') w.remoteState(from, b.s || {}); if (b.op === 'mfx' && b.s) w.remoteShot(from, b.s); if (b.op === 'mfr' && typeof b.key === 'string') w.killRock(b.key);
    if (b.op === 'mfk' && b.to === myCode) { const p = w.players.get(myCode); if (p?.alive) { p.kills++; w.grow(p, Math.min(MS.MAX_MASS, +b.loot || 0)); } } });
  send({ op: 'mfj', name: me?.name, minor });
  // ---- sim loop + sounds
  let lbAt = 0, prevMass = 0;
  R.loop = setInterval(() => { if (!stageEl.isConnected) return stopMegaFleet(); const W = L.where.get(myCode) || room; const evs = W.step(MS.DT), p = W.players.get(myCode), V = R.view;
    for (const e of evs) { const mine = e.by === myCode;
      if (e.t === 'shot' && e.who === myCode) { sfx('laser', { gain: 0.45, pitch: 1.25 - Math.min(0.6, MS.radius(p?.mass || 10) / 140) }); send({ op: 'mfx', s: { n: e.shot.n, x: e.shot.x, y: e.shot.y, vx: e.shot.vx, vy: e.shot.vy, life: e.shot.life, r: e.shot.r, dmg: e.shot.dmg } }); }
      if (e.t === 'rockhit') { V?.flash(e.key); if (mine) sfx('hit', { gain: 0.35, pitch: 1.5 - e.tier * 0.18 }); }
      if (e.t === 'rock') { V?.burst(e.x, e.y, 8 + e.tier * 5, null, 2 + e.tier * 1.5); if (mine) { sfx('explosion', { gain: 0.3 + e.tier * 0.12, pitch: 1.6 - e.tier * 0.2 }); send({ op: 'mfr', key: e.key }); } }
      if (e.t === 'hit' && (mine || e.victim === myCode)) sfx('hit', { gain: e.victim === myCode ? 0.8 : 0.5, pitch: e.victim === myCode ? 0.7 : 1.1 });
      if (e.t === 'kill') { V?.burst(e.x, e.y, 30, e.victim, 3 + MS.radius(e.mass) / 8); if (mine || e.victim === myCode) sfx(e.victim === myCode ? 'die' : 'explosion', { gain: 1 }); if (e.victim === myCode && W.players.get(e.by)?.remote) send({ op: 'mfk', to: e.by, loot: e.loot }); }
      if (e.t === 'grow' && e.who === myCode) sfx('claim', { gain: 0.7, pitch: 0.8 + Math.log2(e.mass / 10) * 0.06 });
      if (e.t === 'respawn' && e.who === myCode) sfx('respawn', { gain: 0.6 }); }
    if (p && performance.now() - net.last > 150) { net.last = performance.now(); send({ op: 'mfs', s: { x: Math.round(p.x), y: Math.round(p.y), h: +p.h.toFixed(3), mass: Math.round(p.mass), hp: Math.round(p.hp), alive: p.alive, score: p.score, kills: p.kills } }); }
    if (cv.hidden === false) draw2d(cv, W, myCode, colorOf);
    dead.hidden = !!p?.alive;
    if (performance.now() - lbAt > 300) { lbAt = performance.now(); const top = W.leaderboard(5), meIn = top.some(r => r.code === myCode), all = W.leaderboard(W.players.size), mine = all.find(r => r.code === myCode);
      lb.innerHTML = `<div><b>🏆 BIGGEST</b><span class="muted">${W.players.size}</span></div>` + top.map(r => `<div class="${r.code === myCode ? 'me' : ''}"><span>${r.rank}. ${esc(r.code === myCode ? 'you' : botLabel(W.players.get(r.code) || r))}</span><span>${r.mass}</span></div>`).join('') + (meIn || !mine ? '' : `<div class="me"><span>${mine.rank}. you</span><span>${mine.mass}</span></div>`);
      if (p) { const n = [0, 1, 2, 3, 4].map(k => MS.shotsNeeded(p.mass, k)); hud.innerHTML = `<div>${CLASS(p.mass)} · mass ${Math.round(p.mass)}/${MS.MAX_MASS} · hull ${Math.max(0, Math.round(p.hp))}/${Math.round(MS.shipHp(p.mass))} · ⚔ ${p.kills}</div><div class="muted">shots per rock S→XL: ${n.join(' · ')}</div><div class="mf-bar"><i style="width:${(p.mass / MS.MAX_MASS * 100).toFixed(1)}%"></i></div>`; if (p.mass > prevMass) prevMass = p.mass; } }
  }, MS.DT * 1000);
  globalThis.__cmMega = { get room() { return L.where.get(myCode); }, me: myCode, get view() { return R.view; }, L, shoot1, setFire };
}
// silent 2D fallback (no WebGL): top-down glow circles, camera on you, zoom by size
function draw2d(cv, W, myCode, colorOf) { const ctx = cv.getContext('2d'), P = FX.palette(), cw = cv.width, ch = cv.height, p = W.players.get(myCode); FX.background(ctx, cw, ch, P, 36); if (!p) return;
  const k = cw / (MS.viewRadius(p.mass) * 2.2), X = x => cw / 2 + (x - p.x) * k, Y = y => ch / 2 + (y - p.y) * k;
  for (const a of W.rocksNear(p.x, p.y, MS.viewRadius(p.mass) * 1.3)) { const [x, y] = MS.rockPos(a, W.t); ctx.fillStyle = P.mut; ctx.globalAlpha = 0.5 + a.tier * 0.1; ctx.beginPath(); ctx.arc(X(x), Y(y), a.r * k, 0, 7); ctx.fill(); } ctx.globalAlpha = 1;
  for (const s of W.shots) FX.neonCircle(ctx, X(s.x), Y(s.y), Math.max(1.5, s.r * k), colorOf(s.by));
  for (const q of W.players.values()) if (q.alive) { const r = MS.radius(q.mass) * k; ctx.save(); ctx.translate(X(q.x), Y(q.y)); ctx.rotate(q.h); ctx.strokeStyle = colorOf(q.code); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(-r * 0.7, r * 0.6); ctx.lineTo(-r * 0.4, 0); ctx.lineTo(-r * 0.7, -r * 0.6); ctx.closePath(); ctx.stroke(); ctx.restore(); }
  FX.frame(ctx, cw, ch, P, performance.now()); }
