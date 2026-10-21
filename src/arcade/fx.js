// Shared CYBERPUNK render layer for every arcade game (Mass Arena + match games).
//  - Theme colours from CSS vars (--bg --line --cy --hot --acid --fg --mut), so all 11 themes apply.
//  - Dark background + subtle grid; bloom glow via canvas shadowBlur with a CAPPED number of glow passes
//    (MAX_GLOW_PASSES = 2; 1 on low-power / lowfx; 0 blur with reduced motion off-pulse still drawn sharp).
//  - Pulsing neon edge glow (slow sine) — disabled under prefers-reduced-motion (static glow instead).
//  - Sleek minimal HUD: thin caps text, hairline dividers, no chrome (Tesla/SpaceX-like).
export const MAX_GLOW_PASSES = 2;
const mq = q => !!globalThis.matchMedia?.(q)?.matches;
export const reducedMotion = () => mq('(prefers-reduced-motion: reduce)');
export const lowPower = () => !!globalThis.document?.documentElement?.classList.contains('lowfx') || (globalThis.navigator?.hardwareConcurrency || 8) <= 2;
export const glowPasses = () => lowPower() ? 1 : MAX_GLOW_PASSES;
export function palette() { const cs = globalThis.getComputedStyle?.(document.documentElement); const g = (n, d) => (cs?.getPropertyValue(n) || '').trim() || d;
  const F = THEME_FALLBACK; return { bg: g('--bg', F.bg), bg2: g('--bg2', F.bg2), line: g('--line', F.line), cy: g('--cy', F.cy), hot: g('--hot', F.hot), acid: g('--acid', F.acid), fg: g('--fg', F.fg), mut: g('--mut', F.mut), mono: g('--mono', 'ui-monospace,monospace') }; }
export const pulse = (t = performance.now(), period = 2600) => reducedMotion() ? 0.75 : 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t / period * Math.PI * 2));
export function background(ctx, w, h, P, cell = 24) { ctx.save(); ctx.fillStyle = P.bg; ctx.fillRect(0, 0, w, h);
  const gr = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7); gr.addColorStop(0, P.bg2); gr.addColorStop(1, P.bg); ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = P.line; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.beginPath(); for (let x = 0.5; x < w; x += cell) { ctx.moveTo(x, 0); ctx.lineTo(x, h); } for (let y = 0.5; y < h; y += cell) { ctx.moveTo(0, y); ctx.lineTo(w, y); } ctx.stroke(); ctx.restore(); }
// draw(fn) with bloom: passes of decreasing blur, then a sharp core pass. fn(ctx) must only issue path/fill/stroke calls.
export function glow(ctx, color, fn, { blur = 14, strength = 1 } = {}) { ctx.save(); const n = glowPasses();
  for (let i = n; i >= 1; i--) { ctx.shadowColor = color; ctx.shadowBlur = blur * i * strength; ctx.globalAlpha = 0.55; fn(ctx); }
  ctx.shadowBlur = 0; ctx.globalAlpha = 1; fn(ctx); ctx.restore(); }
export function neonRect(ctx, x, y, w, h, color, { r = 6, lw = 1.5, t } = {}) { const p = pulse(t); ctx.lineWidth = lw; ctx.strokeStyle = color; glow(ctx, color, c => { c.beginPath(); c.roundRect(x, y, w, h, r); c.stroke(); }, { blur: 10, strength: p }); }
export function neonCircle(ctx, x, y, r, color, { fill = true, lw = 2 } = {}) { ctx.fillStyle = ctx.strokeStyle = color; ctx.lineWidth = lw; glow(ctx, color, c => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); fill ? c.fill() : c.stroke(); }, { blur: 8 }); }
export function neonPath(ctx, pts, color, { lw = 3 } = {}) { if (pts.length < 2) return; ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = ctx.lineJoin = 'round'; glow(ctx, color, c => { c.beginPath(); c.moveTo(...pts[0]); for (const p of pts.slice(1)) c.lineTo(...p); c.stroke(); }, { blur: 10 }); }
// Minimal HUD: top-left title, top-right status, hairline under it. Bottom line small caps.
export function hud(ctx, w, h, P, { title = '', right = '', bottom = '' } = {}) { ctx.save(); ctx.font = `600 11px ${P.mono}`; ctx.letterSpacing = '2px'; ctx.fillStyle = P.fg; ctx.globalAlpha = 0.92; ctx.textBaseline = 'top';
  ctx.fillText(title.toUpperCase(), 12, 10); const rw = ctx.measureText(right.toUpperCase()).width; ctx.fillStyle = P.cy; ctx.fillText(right.toUpperCase(), w - 12 - rw, 10);
  ctx.globalAlpha = 0.35; ctx.fillStyle = P.cy; ctx.fillRect(12, 28, w - 24, 1); if (bottom) { ctx.globalAlpha = 0.7; ctx.fillStyle = P.mut; ctx.font = `500 10px ${P.mono}`; ctx.textBaseline = 'bottom'; ctx.fillText(bottom.toUpperCase(), 12, h - 8); } ctx.restore(); }
export function frame(ctx, w, h, P, t) { neonRect(ctx, 2, 2, w - 4, h - 4, P.cy, { r: 10, lw: 1.2, t }); }
// Player colours come from each player's APP THEME (no separate picker). When two opponents share a theme (or their hues
// are within CLASH_DEG) the later one (by code order) gets an automatic hue shift AND an outline flag, so every player stays
// distinguishable. Pure: hex in, {code, color, outline, shifted} out.
export const CLASH_DEG = 28;
export function hexToHsl(hex) { const n = parseInt(hex.replace('#', '').slice(0, 6), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [((h * 60) + 360) % 360, d ? d / (1 - Math.abs(2 * l - 1)) : 0, l]; }
export const hsl = (h, s, l) => `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`; // comma form: valid CSS AND parseable by THREE.Color
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
export function distinctColors(players) { const out = [], used = [];
  for (const p of [...players].sort((a, b) => (a.code < b.code ? -1 : 1))) { let [h, s, l] = hexToHsl(p.color || palette().cy); s = Math.max(s, 0.65); l = Math.min(Math.max(l, 0.5), 0.68); let shifted = false, k = 0;
    while (used.some(u => hueDist(u, h) < CLASH_DEG) && k++ < 12) { h = (h + 137.508) % 360; shifted = true; }
    used.push(h); out.push({ code: p.code, color: hsl(h, s, l), hue: h, outline: shifted, shifted }); }
  return out; }
// ---- SINGLE PALETTE SOURCE for every arcade game (2D + 3D). All colours derive from the active app theme tokens (CSS vars
// set by src/theme.js). Derived shades (hull, glass, smoke, star) are mixes of those tokens — no game hardcodes a colour.
// Each player's OWN objects use their own theme accent (themeAccent(themeId)); opponents use theirs, de-clashed by
// distinctColors(). onThemeChange(fn) fires when the user switches theme so games retint live.
import { THEMES, THEME_FALLBACK } from '../theme.js';
export const TOKENS = ['bg', 'bg2', 'line', 'cy', 'hot', 'acid', 'fg', 'mut'];
export const themeAccent = id => (THEMES.find(t => t[0] === id) || THEMES[0])[2];
export const mixHex = (a, b, t) => { const p = h => { const n = parseInt(String(h).replace('#', '').slice(0, 6).padEnd(6, '0'), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }; const x = p(a), y = p(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
const toHex = c => { c = String(c).trim(); if (c.startsWith('#')) return c.length === 4 ? '#' + [...c.slice(1)].map(x => x + x).join('') : c.slice(0, 7); const m = c.match(/\d+(\.\d+)?/g); return m ? '#' + m.slice(0, 3).map(v => (+v | 0).toString(16).padStart(2, '0')).join('') : themeAccent('cyan'); };
export function swatch() { const P = palette(), h = Object.fromEntries(TOKENS.map(k => [k, toHex(P[k])]));
  return { ...h, hull: mixHex(h.bg, h.line, 0.25), glass: mixHex(h.fg, h.cy, 0.1), smoke: mixHex(h.bg2, h.cy, 0.12), star: mixHex(h.fg, h.cy, 0.15), crown: h.acid, white: h.fg, ambient: mixHex(h.cy, h.fg, 0.5) }; }
const themeSubs = new Set(); let themeObs = null;
export function onThemeChange(fn) { themeSubs.add(fn); if (!themeObs && globalThis.MutationObserver && globalThis.document) { themeObs = new MutationObserver(() => { for (const f of themeSubs) try { f(swatch()); } catch {} }); themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] }); } return () => themeSubs.delete(fn); }
