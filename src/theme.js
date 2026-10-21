// Look & sound prefs (local only): theme, glow effects, sound. Applied to <html> as data-theme / .lowfx.
export const THEMES = [['cyan', 'Neon Cyan', '#19e6ff'], ['pink', 'Synth Pink', '#ff5ec8'], ['blue', 'Deep Blue', '#3d8bff'], ['acid', 'Acid Green', '#39ff9c'], ['crimson', 'Crimson Red', '#ff3355'], ['violet', 'Ultra Violet', '#b26bff'], ['sunset', 'Sunset Orange', '#ff8a3d'], ['gold', 'Gold', '#ffd166'], ['ice', 'Ice Silver', '#cfe8ff'], ['teal', 'Toxic Teal', '#00f5d4'], ['light', 'Light', '#eef3fa']];
const LS = globalThis.localStorage, get = (k, d) => LS?.getItem('cm.' + k) ?? d, set = (k, v) => LS?.setItem('cm.' + k, v);
const META = { cyan: '#05060a', pink: '#0b0410', blue: '#02050f', acid: '#030803', light: '#eef3fa', crimson: '#0d0306', violet: '#07040f', sunset: '#0d0603', gold: '#0a0803', ice: '#05080c', teal: '#02090a' };
// Token fallbacks used only when CSS custom properties are unavailable (tests / headless). Single source: arcade code never hardcodes colors.
export const THEME_FALLBACK = { bg: '#05060a', bg2: '#0b0d16', line: '#1f2a44', cy: THEMES[0][2], hot: '#ff2bd6', acid: THEMES[3][2], fg: '#e8f6ff', mut: '#93a3c4' };
export const theme = () => { const q = new URLSearchParams(globalThis.location?.search || '').get('theme'); return THEMES.some(t => t[0] === q) ? q : get('theme', 'cyan'); };
export function lowPowerDefault() { const n = globalThis.navigator || {}; return !!(n.connection?.saveData || (n.hardwareConcurrency && n.hardwareConcurrency <= 2) || (n.deviceMemory && n.deviceMemory <= 1)); }
export const fx = () => get('fx', lowPowerDefault() ? 'off' : 'on') === 'on';
// One-time migration (v2): earlier builds defaulted sound OFF / saved 'off' from the removed loader toggle → reset once.
try { if (LS && LS.getItem('cm.soundPrefV') !== '2') { LS.removeItem('cm.sound'); LS.setItem('cm.soundPrefV', '2'); } } catch {}
export const sound = () => get('sound', 'on') === 'on'; // default ON; device volume controls loudness
export function applyLook() { const h = document.documentElement, t = theme(); h.dataset.theme = t; h.classList.toggle('lowfx', !fx()); document.querySelector('meta[name=theme-color]')?.setAttribute('content', META[t]); }
export function setTheme(t) { set('theme', t); applyLook(); }
export function cycleTheme() { const i = THEMES.findIndex(x => x[0] === theme()); setTheme(THEMES[(i + 1) % THEMES.length][0]); return theme(); }
export function setFx(on) { set('fx', on ? 'on' : 'off'); applyLook(); }
export function setSound(on) { set('sound', on ? 'on' : 'off'); set('soundPrefV', '2'); }
export const headerToggles = () => `<button type="button" class="hbtn" id="hdr-theme" aria-label="Change theme" title="Theme: ${THEMES.find(x => x[0] === theme())[1]}">🎨</button>`;
export function wireHeader(root) { const b = root.querySelector('#hdr-theme'); if (b) b.onclick = () => { const t = cycleTheme(); b.title = 'Theme: ' + THEMES.find(x => x[0] === t)[1]; }; }
export function lookPanel() {
  const d = document.createElement('div'); d.className = 'card'; d.id = 'look';
  const draw = () => { d.innerHTML = `<h4>🎨 Look &amp; sound</h4><div class="swatches" role="radiogroup" aria-label="Theme">${THEMES.map(([k, l, c]) => `<button type="button" role="radio" aria-checked="${theme() === k}" data-theme-pick="${k}" class="${theme() === k ? 'on' : ''}"><i style="background:${c}"></i>${l}</button>`).join('')}</div>
    <div class="row gap" style="margin-top:8px"><label class="small"><input type="checkbox" id="lk-fx" style="width:auto" ${fx() ? 'checked' : ''}> Glow effects</label><label class="small"><input type="checkbox" id="lk-cfx" style="width:auto" ${globalThis.localStorage?.getItem('cm.cursorfx') !== 'off' ? 'checked' : ''}> Cursor &amp; touch effects</label><label class="small"><input type="checkbox" id="lk-snd" style="width:auto" ${sound() ? 'checked' : ''}> Sound &amp; music <span class="muted" id="lk-snd-st"></span></label></div>
    <p class="muted small">Saved on this device only. Glow and animations also turn off when your system asks for reduced motion.</p>`;
    d.querySelectorAll('[data-theme-pick]').forEach(b => b.onclick = () => { setTheme(b.dataset.themePick); draw(); });
    d.querySelector('#lk-fx').onchange = e => { setFx(e.target.checked); import('./fx-pointer.js').then(F => F.syncPointerFx()); };
    d.querySelector('#lk-cfx').onchange = e => import('./fx-pointer.js').then(F => F.setPointerFx(e.target.checked));
    // Synchronous in the tap (no await/dynamic import before resume) — iOS Safari only allows audio start inside the gesture.
    const snd = d.querySelector('#lk-snd'), st = () => { const a = globalThis.__cmAudio?.(); snd.checked = sound(); const l = d.querySelector('#lk-snd-st'); if (l) l.textContent = !sound() ? 'muted' : a?.playing && a.state === 'running' ? 'playing' : a?.state === 'running' ? 'on' : 'tap anywhere to start'; };
    snd.onclick = () => { const on = snd.checked; if (globalThis.__cmSetSound) globalThis.__cmSetSound(on); else setSound(on); st(); setTimeout(st, 300); }; st(); };
  draw(); return d;
}
// Tron-style typing glow: each inserted char flashes at the caret then fades. Purely decorative (aria-hidden),
// skipped during IME composition, for password fields, and under reduced motion / low-fx.
export function initTypingGlow() {
  const rm = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)'); const ctx = document.createElement('canvas').getContext('2d');
  document.addEventListener('input', e => {
    const el = e.target; if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || e.isComposing || rm?.matches || !fx()) return;
    if (el.type === 'password' || !/^insert/.test(e.inputType || '')) return;
    el.classList.add('typing'); clearTimeout(el._tg); el._tg = setTimeout(() => el.classList.remove('typing'), 450);
    if (!(el instanceof HTMLInputElement) || !/^(text|search|email|url|tel|)$/.test(el.type) || !e.data) return;
    requestAnimationFrame(() => {
      const cs = getComputedStyle(el); ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const pos = el.selectionStart ?? el.value.length, ch = e.data.slice(-1), before = el.value.slice(0, Math.max(0, pos - 1));
      const x = parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth) + ctx.measureText(before).width - el.scrollLeft;
      if (x < 0 || x > el.clientWidth) return;
      const s = document.createElement('span'); s.className = 'tglow'; s.setAttribute('aria-hidden', 'true'); s.textContent = ch;
      s.style.cssText = `left:${el.offsetLeft + x}px;top:${el.offsetTop}px;height:${el.offsetHeight}px;line-height:${el.offsetHeight}px;font:${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const host = el.offsetParent; if (!host) return; if (getComputedStyle(host).position === 'static') host.classList.add('tglow-host');
      host.appendChild(s); setTimeout(() => s.remove(), 500);
    });
  }, true);
}
// Loader code-rain palette. No saved theme -> classic matrix green/cyan (unchanged look).
export const savedTheme = () => { const t = LS?.getItem('cm.theme'); return THEMES.some(x => x[0] === t) ? t : null; };
export const RAIN = {
  default: { bg: '#030507', a: '#39ff9c', b: '#19e6ff', head: '#d8fff4', still: '#39ff9c33' },
  cyan: { bg: '#03060a', a: '#19e6ff', b: '#39ff9c', head: '#e0fbff', still: '#19e6ff33' },
  pink: { bg: '#0b0410', a: '#ff5ec8', b: '#ff9be0', head: '#fff0fa', still: '#ff5ec833' },
  blue: { bg: '#02050f', a: '#4d95ff', b: '#7df9ff', head: '#e6f0ff', still: '#4d95ff33' },
  acid: { bg: '#030803', a: '#39ff9c', b: '#d4ff2a', head: '#efffe0', still: '#39ff9c33' },
  light: { bg: '#eef3fa', a: '#005fb0', b: '#08703c', head: '#0b1426', still: '#005fb033' },
  crimson: { bg: '#0d0306', a: '#ff3355', b: '#ff8a8a', head: '#fff0f2', still: '#ff335533' },
  violet: { bg: '#07040f', a: '#b26bff', b: '#e0a8ff', head: '#f6efff', still: '#b26bff33' },
  sunset: { bg: '#0d0603', a: '#ff8a3d', b: '#ff4f7b', head: '#fff3e8', still: '#ff8a3d33' },
  gold: { bg: '#0a0803', a: '#ffd166', b: '#ffb703', head: '#fffbea', still: '#ffd16633' },
  ice: { bg: '#05080c', a: '#cfe8ff', b: '#8fb8de', head: '#ffffff', still: '#cfe8ff33' },
  teal: { bg: '#02090a', a: '#00f5d4', b: '#9bff3b', head: '#eafffb', still: '#00f5d433' },
};
export const rainPalette = () => RAIN[savedTheme() || 'default'];
