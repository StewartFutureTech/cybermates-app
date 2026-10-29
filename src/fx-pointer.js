// Tron-style cursor (fine pointers only) + tap shockwave/glitch + drag light-trail. One fixed overlay canvas,
// pointer-events:none, passive listeners (never blocks input/scroll), rAF only while something is animating.
// Off under prefers-reduced-motion, when Glow effects is off, or when "Cursor & touch effects" is off.
import { fx } from './theme.js';
import { shock } from './fx-shock.js';
const LS = globalThis.localStorage;
export const pointerFxOn = () => LS?.getItem('cm.cursorfx') !== 'off';
export const setPointerFx = on => { LS?.setItem('cm.cursorfx', on ? 'on' : 'off'); syncPointerFx(); };
const CLICKABLE = 'a,button,select,summary,label,[role=button],[role=radio],[data-tab],.chip,input[type=checkbox],input[type=radio]';
const TEXTY = 'input:not([type=checkbox]):not([type=radio]):not([type=range]),textarea,[contenteditable=""],[contenteditable=true]';
let cv, cx, raf = 0, on = false, fine = false, col = { a: '#19e6ff', b: '#ff2bd6', c: '#39ff9c' };
const P = { x: -99, y: -99, seen: false, hot: false, text: false, down: false }, trail = [], waves = [];
const rm = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'), fineQ = globalThis.matchMedia?.('(pointer: fine)');
const enabled = () => pointerFxOn() && fx() && !rm?.matches;
function colors() { const s = getComputedStyle(document.documentElement); col = { a: s.getPropertyValue('--cy').trim() || col.a, b: s.getPropertyValue('--hot').trim() || col.b, c: s.getPropertyValue('--acid').trim() || col.c }; }
// Overlay = exactly the VISUAL viewport (iOS dynamic toolbar / keyboard / pinch), CSS size == backing size / dpr, so a
// point at clientX/Y lands where it was touched (old bug: 100vh CSS height vs innerHeight backing stretched the canvas).
const VV = { x: 0, y: 0, w: 0, h: 0 };
function size() { const v = globalThis.visualViewport, d = Math.min(2, devicePixelRatio || 1);
  VV.w = Math.round(v?.width ?? innerWidth); VV.h = Math.round(v?.height ?? innerHeight); VV.x = v?.offsetLeft || 0; VV.y = v?.offsetTop || 0;
  cv.width = VV.w * d; cv.height = VV.h * d; cv.style.width = VV.w + 'px'; cv.style.height = VV.h + 'px'; cv.style.transform = `translate(${VV.x}px,${VV.y}px)`; cx.setTransform(d, 0, 0, d, 0, 0); }
const lx = e => e.clientX - VV.x, ly = e => e.clientY - VV.y;
function kick() { if (!raf && on) raf = requestAnimationFrame(frame); }
function frame(t) {
  raf = 0; cx.clearRect(0, 0, VV.w, VV.h); const now = performance.now(); let busy = false;
  // light trail (drag on touch / mouse button held, and a short tail behind the custom cursor)
  while (trail.length && now - trail[0].t > 350) trail.shift();
  if (trail.length > 1) { busy = true; cx.lineCap = 'round'; for (let i = 1; i < trail.length; i++) { const a = trail[i - 1], b = trail[i], k = 1 - (now - b.t) / 350; cx.strokeStyle = b.drag ? col.b : col.a; cx.globalAlpha = k * (b.drag ? .9 : .45); cx.lineWidth = (b.drag ? 6 : 2.5) * k + .5; cx.shadowColor = cx.strokeStyle; cx.shadowBlur = b.drag ? 14 : 8; cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x, b.y); cx.stroke(); } }
  // shockwaves + chromatic glitch slices
  for (let i = waves.length - 1; i >= 0; i--) { const w = waves[i], k = (now - w.t) / 450; if (k >= 1) { waves.splice(i, 1); continue; } busy = true; const r = 6 + k * 46;
    cx.shadowBlur = 16; cx.lineWidth = 2.5 * (1 - k) + .5;
    for (const [dx, c] of [[-2 * (1 - k), col.b], [2 * (1 - k), col.c], [0, col.a]]) { cx.globalAlpha = (1 - k) * (c === col.a ? 1 : .6); cx.strokeStyle = cx.shadowColor = c; cx.beginPath(); cx.arc(w.x + dx, w.y, r, 0, 7); cx.stroke(); }
    if (k < .35) { cx.shadowBlur = 0; for (let s = 0; s < 4; s++) { const y = w.y - 18 + w.s[s] * 36, h = 2 + w.s[s + 4] * 3, off = (w.s[s + 8] - .5) * 14; cx.globalAlpha = .5 * (1 - k / .35); cx.fillStyle = s % 2 ? col.b : col.a; cx.fillRect(w.x - 26 + off, y, 52, h); } } }
  // cursor (fine pointers only; native cursor kept over text fields)
  if (fine && P.seen && !P.text) { cx.globalAlpha = 1; cx.shadowBlur = 10; cx.shadowColor = cx.strokeStyle = P.hot ? col.b : col.a; cx.lineWidth = 1.6;
    const r = P.hot ? 14 : 9 + (P.down ? -3 : 0); cx.beginPath(); cx.arc(P.x, P.y, r, 0, 7); cx.stroke();
    cx.beginPath(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { cx.moveTo(P.x + dx * (r + 2), P.y + dy * (r + 2)); cx.lineTo(P.x + dx * (r + 7), P.y + dy * (r + 7)); } cx.stroke();
    cx.fillStyle = col.c; cx.beginPath(); cx.arc(P.x, P.y, 1.6, 0, 7); cx.fill(); }
  cx.globalAlpha = 1; cx.shadowBlur = 0;
  if (busy) kick(); // cursor alone redraws only on pointer moves
}
const onMove = e => { if (!on) return; if (T && e.pointerId === T.id && Math.hypot(e.clientX - T.x, e.clientY - T.y) > 10) T = null; const drag = e.pointerType === 'touch' || (e.buttons & 1); P.x = lx(e); P.y = ly(e); P.seen = e.pointerType === 'mouse' || e.pointerType === 'pen';
  if (fine && P.seen) { const el = e.target instanceof Element ? e.target : null; P.text = !!el?.closest(TEXTY); P.hot = !P.text && !!el?.closest(CLICKABLE); }
  if (drag || (fine && P.seen && !P.text)) trail.push({ x: P.x, y: P.y, t: performance.now(), drag: !!drag }); if (trail.length > 40) trail.shift(); kick(); };
// Touch: never act on touchstart — a touch may become a scroll. Fire only on a real TAP (pointerup, moved ≤10px, <600ms);
// pointercancel (browser took over for scrolling) or >10px movement aborts. All listeners are passive (never preventDefault).
let T = null;
function fire(e) { if (!gated()) shock(e.clientX, e.clientY, e.target); waves.push({ x: lx(e), y: ly(e), t: performance.now(), s: Array.from({ length: 12 }, Math.random) }); if (waves.length > 6) waves.shift(); kick(); }
const gated = () => !!document.querySelector('.cm-gate,.cm-onb,#jackin') || document.body.classList.contains('jacking');
const onDown = e => { if (!on) return; P.down = true; if (e.pointerType === 'mouse' || e.pointerType === 'pen') { if (e.button === 0) fire(e); } else T = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }; kick(); };
const onUp = e => { P.down = false; if (T && e?.type === 'pointerup' && e.pointerId === T.id && Math.hypot(e.clientX - T.x, e.clientY - T.y) <= 10 && performance.now() - T.t < 600) fire(e); T = null; kick(); };
const onLeave = () => { P.seen = false; kick(); };
export function syncPointerFx() {
  const want = enabled(); fine = !!fineQ?.matches || LS?.getItem('cm.forceFinePointer') === '1'; // override for headless screenshots
  document.documentElement.classList.toggle('cfx', want && fine);
  if (want === on) { if (on) { colors(); kick(); } return; }
  on = want;
  if (on) { if (!cv) { cv = document.createElement('canvas'); cv.id = 'fxcanvas'; cv.setAttribute('aria-hidden', 'true'); cx = cv.getContext('2d'); } document.body.appendChild(cv); size(); colors(); kick(); }
  else { cancelAnimationFrame(raf); raf = 0; trail.length = waves.length = 0; cv?.remove(); }
}
export const __fxDebug = () => ({ VV: { ...VV }, waves: waves.map(w => ({ x: w.x, y: w.y })) }); // tests
export function initPointerFx() {
  globalThis.__cmFx = __fxDebug;
  addEventListener('pointermove', onMove, { passive: true }); addEventListener('pointerdown', onDown, { passive: true }); addEventListener('pointerup', onUp, { passive: true }); addEventListener('pointercancel', onUp, { passive: true });
  document.addEventListener('pointerleave', onLeave, { passive: true }); addEventListener('blur', onLeave);
  addEventListener('resize', () => cv && on && size()); globalThis.visualViewport?.addEventListener('resize', () => cv && on && size()); globalThis.visualViewport?.addEventListener('scroll', () => cv && on && size()); rm?.addEventListener?.('change', syncPointerFx); fineQ?.addEventListener?.('change', syncPointerFx);
  new MutationObserver(() => on && colors()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
  syncPointerFx();
}
