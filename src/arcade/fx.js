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
// SAME-THEME SHADES: the first player of a theme gets the pure theme colour; every further same-theme player in the game
// gets a deterministic, perceptually distinct SHADE of that hue family (OKLCH: lightness / chroma / small hue offsets, e.g.
// green -> lime, emerald, mint), each at least MIN_DE (OKLab ΔE) from every colour already handed out — 100 guaranteed.
// Different themes whose hues clash still get the old golden-angle hue shift + outline.
export const MIN_DE = 0.025;
const srgbToLin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4), linToSrgb = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
export function hexToOklab(hex) { const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16), [r, g, b] = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => srgbToLin(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s2 = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s2, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s2, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s2]; }
function oklabToRgb([L, a, b]) { const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s2 = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s2, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s2, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s2].map(linToSrgb); }
const inGamut = rgb => rgb.every(v => v >= -1e-4 && v <= 1 + 1e-4);
const rgbHex = rgb => '#' + rgb.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
export const deltaE = (x, y) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
// k-th shade (k >= 1) of a base colour, avoiding everything in `taken` (OKLab triples). Deterministic.
export function themeShade(baseHex, k, taken = []) { const [L0, a0, b0] = hexToOklab(baseHex), C0 = Math.hypot(a0, b0), H0 = Math.atan2(b0, a0);
  for (let t = 0; t < 4000; t++) { const q = k * 7 + t, u = (q * 0.6180339887) % 1, v = (q * 0.7548776662) % 1, w = (q * 0.5698402910) % 1; // low-discrepancy (R3) sequence
    const L = 0.36 + u * 0.58, C = 0.02 + v * Math.max(C0 * 1.3, 0.16), H = H0 + (w - 0.5) * 1.1; const lab = [L, C * Math.cos(H), C * Math.sin(H)], rgb = oklabToRgb(lab); if (!inGamut(rgb)) continue;
    const hex = rgbHex(rgb), real = hexToOklab(hex); if (taken.every(x => deltaE(x, real) >= MIN_DE)) return hex; }
  return baseHex; }
export function distinctColors(players) { const out = [], used = [], taken = [], groups = new Map();
  for (const p of [...players].sort((a, b) => (a.code < b.code ? -1 : 1))) { const base = toHex(p.color || palette().cy).toLowerCase(), k = groups.get(base) || 0; groups.set(base, k + 1);
    if (k > 0) { const c = themeShade(base, k, taken); taken.push(hexToOklab(c)); out.push({ code: p.code, color: c, hue: hexToHsl(c)[0], outline: false, shifted: false, shade: k }); continue; }
    let [h, s, l] = hexToHsl(base), shifted = false, n = 0; while (used.some(u => hueDist(u, h) < CLASH_DEG) && n++ < 12) { h = (h + 137.508) % 360; shifted = true; }
    used.push(h); const c = shifted ? hsl(h, Math.max(s, 0.65), Math.min(Math.max(l, 0.5), 0.68)) : base; taken.push(hexToOklab(toHex(c))); out.push({ code: p.code, color: c, hue: h, outline: shifted, shifted, shade: 0 }); }
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
