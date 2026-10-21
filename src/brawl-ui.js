// BRAWL tab UI: 6-player free-for-all energy brawler (games/brawl.js). Solo-playable: empty seats are AI ("· AI" tag).
// Controls (touch or mouse): TAP = teleport there, or punch if an enemy is close; HOLD = charge (aura grows), release
// early = energy ball toward your finger, hold to FULL = beam. 3D neon glass view (brawl3d.js) when WebGL2 is available,
// otherwise the 2D glow renderer below. HP bars + KO counts in the DOM; short round then a scoreboard + rematch.
// Colours: your fighter uses your theme accent, AI fighters use other theme accents, de-clashed (fx.distinctColors).
// Reduced motion: no screen shake, no speed lines (both renderers).
import * as B from './arcade/games/brawl.js';
import * as FX from './arcade/fx.js';
import { THEMES, theme } from './theme.js';
import { can3D } from './arcade/three-scene.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS = globalThis.localStorage, HOLD_MS = 170;
let loop = null, raf = 0, view3d = null, match = null;
export function stopBrawl() { clearInterval(loop); loop = null; cancelAnimationFrame(raf); raf = 0; view3d?.dispose?.(); view3d = null; match = null; }
export const seatColors = (myTheme = theme()) => { const ids = THEMES.map(t => t[0]).filter(t => t !== myTheme && t !== 'light'), acc = [FX.themeAccent(myTheme), ...Array.from({ length: B.SEATS - 1 }, (_, i) => FX.themeAccent(ids[(i * 2) % ids.length]))];
  const d = FX.distinctColors(acc.map((c, i) => ({ code: 'S' + i, color: c }))); return acc.map((_, i) => d.find(x => x.code === 'S' + i).color); };
export function brawlView(v, me) { stopBrawl(); const pick = LS?.getItem('cm.brawl.char') || 'volt';
  const q = new URLSearchParams(globalThis.location?.search || ''), want3d = q.get('force3d') === '1' || (q.get('force3d') !== '0' && LS?.getItem('cm.arc.3d') !== 'off' && can3D());
  v.innerHTML = `<section class="card brawl"><h2>💥 Brawl <small class="muted">6-player free-for-all</small></h2>
    <p class="muted small">Tap: teleport, or punch if close. Hold: charge. Let go early: energy ball. Full charge: beam. Empty seats are AI.</p>
    <div class="br-pick">${B.ROSTER.map(r => `<button class="br-ch ${r.id === pick ? 'on' : ''}" data-ch="${r.id}" title="${esc(r.tag)}">${esc(r.name)}</button>`).join('')}</div>
    <div class="arc-stage br-stage"><canvas id="br-3d-cv" ${want3d ? '' : 'hidden'}></canvas><canvas id="br-cv" width="800" height="480" ${want3d ? 'hidden' : ''}></canvas><div id="br-say" class="br-say" aria-live="polite"></div><div id="br-over" class="br-over" hidden></div></div>
    <div id="br-hud" class="br-hud"></div><label class="small"><input type="checkbox" id="br-3d" ${want3d ? 'checked' : ''}> 3D</label> <span id="br-time" class="muted small"></span></section>`;
  v.querySelectorAll('.br-ch').forEach(b => b.onclick = () => { LS?.setItem('cm.brawl.char', b.dataset.ch); brawlView(v, me); });
  v.querySelector('#br-3d').onchange = e => { LS?.setItem('cm.arc.3d', e.target.checked ? 'on' : 'off'); const u = new URL(location.href); u.searchParams.delete('force3d'); history.replaceState(null, '', u); brawlView(v, me); };
  start(v, me, pick, want3d); }
async function start(v, me, pick, want3d) { stopBrawl();
  const chars = [pick, ...B.ROSTER.map(r => r.id).filter(id => id !== pick)].slice(0, B.SEATS), colors = seatColors();
  match = new B.BrawlMatch({ id: 'brawl-' + (me?.id || 'me') + '-' + Date.now(), humans: [{ name: me?.name || 'You', local: true }], chars, roundT: (n => n > 0 ? Math.max(5, n) * B.TICK_HZ : undefined)(+new URLSearchParams(location.search).get('brawlround') || 0) }); // ?brawlround=N: short test rounds
  const m = match; await m.ready(); if (match !== m) return; const cv = v.querySelector('#br-cv'), c3 = v.querySelector('#br-3d-cv'), hud = v.querySelector('#br-hud'), say = v.querySelector('#br-say'), over = v.querySelector('#br-over'), tEl = v.querySelector('#br-time');
  const names = m.seats.map((s, i) => (i === 0 ? (me?.name || 'You') : B.ROSTER.find(r => r.id === m.st.f[i].char).name) + (s.ai ? ' · AI' : ''));
  hud.innerHTML = m.st.f.map((p, i) => `<div class="br-row" data-s="${i}"><span class="br-dot" style="background:${colors[i]};box-shadow:0 0 8px ${colors[i]}"></span><span class="br-nm">${esc(names[i])}</span><span class="br-bar"><i style="background:${colors[i]}"></i></span><b class="br-ko">0</b></div>`).join('');
  if (want3d) import('./arcade/brawl3d.js').then(M => M.brawl3d(c3, { colors })).then(x => { if (match !== m) return x.dispose(); view3d = x; }).catch(e => { console.warn('3D fallback (2D view used):', e?.message || e); c3.hidden = true; cv.hidden = false; view3d = null; });
  // input: pointer -> arena coords (both canvases map linearly to the arena rectangle)
  let down = null, hold = null; const at = (e, el) => { const r = el.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width * B.Wd, y: (e.clientY - r.top) / r.height * B.Hd }; };
  for (const el of [cv, c3]) { el.style.touchAction = 'none';
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); down = { ...at(e, el), t: performance.now(), charged: false }; clearTimeout(hold); hold = setTimeout(() => { if (down) { down.charged = true; m.act(0, { op: 'charge', x: down.x, y: down.y }); } }, HOLD_MS); });
    el.addEventListener('pointermove', e => { if (down) Object.assign(down, at(e, el)); });
    const up = e => { if (!down) return; clearTimeout(hold); const p = at(e, el); m.act(0, down.charged ? { op: 'release', ...p } : { op: 'tap', ...p }); down = null; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', () => { clearTimeout(hold); down = null; }); }
  let shake = 0; const reduced = FX.reducedMotion();
  m.onEvent = e => { if (e.k === 'ko') shake = 10; else if (e.k === 'hit') shake = Math.max(shake, Math.min(7, e.dmg / 4)); };
  const draw = () => { if (match !== m) return; if (!cv.hidden) draw2d(cv, m, colors, reduced ? 0 : shake); shake *= 0.85; raf = requestAnimationFrame(draw); }; raf = requestAnimationFrame(draw);
  loop = setInterval(() => { if (match !== m) return; const st = m.tick(); view3d?.set({ ...st, events: m.recent });
    st.f.forEach((p, i) => { const r = hud.children[i]; r.querySelector('i').style.width = Math.max(0, p.hp) + '%'; r.querySelector('.br-ko').textContent = p.ko; r.classList.toggle('low', p.hp < 30); });
    say.innerHTML = m.say.map(x => `<div class="br-bubble"><b>${esc(names[x.seat])}</b> ${esc(x.text)}</div>`).join(''); tEl.textContent = `⏱ ${Math.max(0, Math.ceil(((st.roundT || B.ROUND_T) - st.tick) / B.TICK_HZ))}s`;
    if (st.over) { clearInterval(loop); loop = null; const r = B.result(st); over.hidden = false;
      over.innerHTML = `<h3>${r.winner === 0 ? '🏆 You win!' : esc(names[r.winner]) + ' wins'}</h3><table class="br-board"><tr><th>#</th><th>Fighter</th><th>KOs</th><th>Falls</th></tr>${r.board.map((b, i) => `<tr class="${b.seat === 0 ? 'me' : ''}"><td>${i + 1}</td><td>${esc(names[b.seat])}</td><td>${b.ko}</td><td>${b.deaths}</td></tr>`).join('')}</table><button id="br-again" class="primary">Rematch</button>`;
      over.querySelector('#br-again').onclick = () => { over.hidden = true; start(v, me, pick, !c3.hidden); }; } }, 1000 / B.TICK_HZ);
}
// ---- 2D glow fallback (fx.js): fighters as neon orbs with glass core, energy balls, beams, speed lines, punch arcs.
function draw2d(cv, m, colors, shake) { const ctx = cv.getContext('2d'), P = FX.palette(), W = cv.width, H = cv.height, sx = W / B.Wd, sy = H / B.Hd, st = m.st, t = performance.now();
  ctx.save(); if (shake) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); FX.background(ctx, W, H, P, 40); FX.frame(ctx, W, H, P, t);
  const reduced = FX.reducedMotion();
  for (const b of st.beams) { const L = Math.hypot(B.Wd, B.Hd); ctx.globalAlpha = 0.5 + b.t / 20; FX.neonPath(ctx, [[b.x * sx, b.y * sy], [(b.x + b.dx * L) * sx, (b.y + b.dy * L) * sy]], colors[b.own], { lw: B.BEAM_W * sy * (0.6 + b.t / 20) }); ctx.globalAlpha = 1; }
  for (const b of st.balls) FX.neonCircle(ctx, b.x * sx, b.y * sy, b.r * sy, colors[b.own]);
  st.f.forEach((p, i) => { const x = p.x * sx, y = p.y * sy, c = colors[i];
    if (!reduced && p.fx?.k === 'tp' && st.tick - p.fx.t < 6) { ctx.globalAlpha = 1 - (st.tick - p.fx.t) / 6; for (let k = -2; k <= 2; k++) FX.neonPath(ctx, [[p.fx.from[0] * sx, p.fx.from[1] * sy + k * 5], [x, y + k * 5]], c, { lw: 1.5 }); ctx.globalAlpha = 1; }
    if (p.charging) FX.neonCircle(ctx, x, y, (6 + 10 * p.charge / B.FULL) * sy, c, { fill: false, lw: 2 + 3 * p.charge / B.FULL });
    ctx.globalAlpha = p.shield > 0 && st.tick % 6 < 3 ? 0.4 : 1; FX.neonCircle(ctx, x, y, B.FR * sy, c); ctx.fillStyle = P.fg; ctx.globalAlpha *= 0.35; ctx.beginPath(); ctx.arc(x - 3, y - 3, B.FR * sy * 0.35, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    if (p.fx?.k === 'punch' && st.tick - p.fx.t < 5) { const q = st.f[p.fx.to]; FX.neonPath(ctx, [[x, y], [(p.x + (q.x - p.x) * 0.8) * sx, (p.y + (q.y - p.y) * 0.8) * sy]], c, { lw: 5 }); }
    ctx.fillStyle = P.fg; ctx.font = `600 ${11 * sx / 4}px ${P.mono}`; ctx.textAlign = 'center'; ctx.fillText(B.ROSTER.find(r => r.id === p.char).name.split(' ')[0] + (m.seats[i].ai ? ' · AI' : ''), x, y - B.FR * sy - 8);
    ctx.fillStyle = P.line; ctx.fillRect(x - 18, y + B.FR * sy + 5, 36, 4); ctx.fillStyle = c; ctx.fillRect(x - 18, y + B.FR * sy + 5, 36 * Math.max(0, p.hp) / B.HP, 4); });
  ctx.restore(); }
