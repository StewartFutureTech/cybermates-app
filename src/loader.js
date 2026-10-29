// "Jacking in" loader shown while joining the mesh. Min display time (default 3 s), then waits for the
// join (spinner + live status) up to a timeout (default 20 s) and lets the user in with an offline notice.
// Test flag: ?loaderMin=<ms>&loaderMax=<ms> (or localStorage cm.loaderMin / cm.loaderMax).
import * as S from './sfx.js';
import { markSVG } from './logo.js';
import { rainPalette, savedTheme } from './theme.js';
const q = new URLSearchParams(globalThis.location?.search || '');
const num = (k, d) => { const v = q.get(k) ?? globalThis.localStorage?.getItem('cm.' + k); return v != null && v !== '' && !isNaN(+v) ? +v : d; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Big glowing JACK IN button first (the tap is the audio gesture), then sync + rain + boot sound + music. Skipped when
// audio already runs in a native Capacitor WebView (autoplay allowed), or in tests (?loaderMin=… without &jackbtn=1).
export function jackIn(join, opts = {}) {
  const testSkip = q.has('loaderMin') && q.get('jackbtn') !== '1';
  const nativeAuto = !!globalThis.Capacitor?.isNativePlatform?.() && S.audioState().state === 'running';
  if (testSkip || nativeAuto || q.get('jackbtn') === '0') return jackInRun(join, opts);
  return new Promise(res => {
    const g = document.createElement('div'); g.id = 'jackbtn'; g.className = 'cm-gate jb-gate'; const P = rainPalette(); g.style.background = P.bg;
    g.innerHTML = `<div class="jb-box">${markSVG(92, 'lg-intro lg-big')}<button type="button" id="jb-go" class="jb-btn" data-text="JACK IN">JACK IN</button><p class="jb-sub">CYBERMATES · SOCIAL MESH</p></div>`;
    document.body.appendChild(g); document.body.classList.add('jacking'); import('./rain-bg.js').then(m => m.attachRain(g)).catch(() => {});
    const b = g.querySelector('#jb-go'); b.focus?.({ preventScroll: true });
    b.addEventListener('click', () => { S.unlockNow(); S.plugIn(); let fin = false; S.dialStart(() => fin); g.remove(); res(jackInRun(join, opts).then(r => { fin = true; S.dialEnd(r.offline); return r; })); }, { once: true }); // sync, inside the gesture
  });
}
function jackInRun(join, { minMs = num('loaderMin', 3000), maxMs = num('loaderMax', 20000), onTimeout } = {}) {
  const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const el = document.createElement('div'); el.id = 'jackin';
  el.innerHTML = `<canvas aria-hidden="true"></canvas>
    <div class="ji-box" role="status" aria-live="polite">${markSVG(78, 'lg-big')}
    <h1><span class="glitch" data-text="JACKING IN">JACKING IN</span><span class="ji-dots" aria-hidden="true"></span></h1><div class="ji-sub"><span class="glitch ji-subt" data-text="SYNCING MESH">SYNCING MESH</span><span class="ji-dots" aria-hidden="true"></span></div>
    <div class="ji-bar"><i></i></div><ul class="ji-log"></ul><div class="ji-wait" hidden><span class="spin" aria-hidden="true"></span> <span>Waiting for peers…</span></div></div>`;
  document.body.appendChild(el); document.body.classList.add('jacking');
  const log = el.querySelector('.ji-log'), bar = el.querySelector('.ji-bar i'); let pct = 0;
  const line = t => { const li = document.createElement('li'); li.innerHTML = `<b>&gt;</b> ${esc(t)}`; log.appendChild(li); while (log.children.length > 6) log.firstChild.remove(); pct = Math.min(95, pct + 12); bar.style.width = pct + '%'; };
  S.boot(); globalThis.__cmAudioKick?.(); S.audioHint?.(); // plays only if audio is already unlocked by a gesture; otherwise the first tap starts boot + music (sfx.initAudioUnlock)
  // animated "…" tied to progress: dots cycle . .. ... faster as the bar advances; brightest dot = newest; static if reduced motion
  const dotEls = el.querySelectorAll('.ji-dots'); let dn = 0, dotT = 0;
  const dots = () => { if (!el.isConnected) return; dn = dn % 3 + 1; dotEls.forEach(d => d.innerHTML = [0, 1, 2].map(i => `<i class="${i < dn ? (i === dn - 1 ? 'on hot' : 'on') : ''}">.</i>`).join(''));
    const p = parseFloat(bar.style.width) || 0; dotT = setTimeout(dots, Math.max(110, 480 - p * 3.8)); };
  if (reduce) dotEls.forEach(d => d.textContent = '…'); else dots();
  ['BOOT SEQUENCE INIT', 'LOADING NEURAL INTERFACE'].forEach(line);
  // Code rain: glyphs pre-rendered once into a white atlas, then tinted per palette color (source-in) → drawImage per frame.
  const P = rainPalette(); el.style.background = P.bg; el.dataset.rain = savedTheme() || 'default';
  const cv = el.querySelector('canvas'), cx = cv.getContext('2d'); let raf = 0, cols = [], last = 0; const fs = 16;
  const G = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF<>/{}#$%', N = G.length;
  const atlas = document.createElement('canvas'); atlas.width = fs * N; atlas.height = fs + 4; const ax = atlas.getContext('2d');
  ax.font = fs + 'px ui-monospace,monospace'; ax.textBaseline = 'top'; ax.fillStyle = '#fff'; for (let i = 0; i < N; i++) ax.fillText(G[i], i * fs, 2);
  const tint = c => { const t = document.createElement('canvas'); t.width = atlas.width; t.height = atlas.height; const tx = t.getContext('2d'); tx.drawImage(atlas, 0, 0); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = c; tx.fillRect(0, 0, t.width, t.height); return t; };
  const TA = tint(P.a), TB = tint(P.b), TH = tint(P.head), TS = tint(P.still);
  const glyph = (src, g, x, y) => cx.drawImage(src, g * fs, 0, fs, fs + 4, x, y - fs, fs, fs + 4);
  const fade = (() => { const h = P.bg.slice(1); return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},.14)`; })();
  const size = () => { cv.width = innerWidth; cv.height = innerHeight; cols = Array(Math.ceil(cv.width / fs)).fill(0).map(() => Math.random() * -50); cx.fillStyle = P.bg; cx.fillRect(0, 0, cv.width, cv.height); };
  const draw = ts => { raf = requestAnimationFrame(draw); if (ts - last < 45) return; last = ts; // ~22 fps: cheap on phones
    cx.fillStyle = fade; cx.fillRect(0, 0, cv.width, cv.height);
    cols.forEach((y, i) => { glyph(Math.random() < .08 ? TH : i % 5 ? TA : TB, (Math.random() * N) | 0, i * fs, y * fs); cols[i] = y * fs > cv.height && Math.random() > .975 ? 0 : y + 1; }); };
  size(); addEventListener('resize', size);
  if (reduce) { el.classList.add('still'); for (let i = 0; i < cols.length; i++) for (let j = 1; j < cv.height / fs; j += 3) glyph(TS, (i * 7 + j) % N, i * fs, j * fs); } else raf = requestAnimationFrame(draw);
  const t0 = Date.now(); let done = false, failed = false;
  const joined = Promise.resolve().then(() => join(line)).then(r => { done = true; line('LINK ESTABLISHED'); return r; }, e => { failed = true; line('JOIN ERROR · ' + (e?.message || e)); });
  const min = new Promise(r => setTimeout(r, minMs));
  const waitUI = setTimeout(() => { if (!done) { el.querySelector('.ji-wait').hidden = false; const s = el.querySelector('.ji-subt'); s.textContent = s.dataset.text = 'STILL SYNCING MESH'; } }, minMs);
  const timeout = new Promise(r => setTimeout(() => r('timeout'), Math.max(minMs, maxMs)));
  return Promise.all([min, Promise.race([joined.then(() => 'ok'), timeout])]).then(([, res]) => {
    clearTimeout(waitUI); clearTimeout(dotT); if (!reduce) dotEls.forEach(d => d.innerHTML = '<i class="on">.</i><i class="on">.</i><i class="on hot">.</i>'); const offline = res === 'timeout' || failed; bar.style.width = '100%';
    cancelAnimationFrame(raf); removeEventListener('resize', size); el.classList.add('out'); document.body.classList.remove('jacking');
    setTimeout(() => el.remove(), reduce ? 0 : 350);
    if (offline) onTimeout?.(); return { offline, ms: Date.now() - t0 };
  });
}
