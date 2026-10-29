// Passive, dimmed, theme-tinted code-rain background for starter pages (DOB/age, terms, consent, JACK IN).
// Canvas sits behind the page content (z-index:-1 inside the overlay's stacking context), pointer-events:none, no
// listeners except resize; stops itself when its overlay leaves the DOM. Reduced motion → one still frame.
import { rainPalette } from './theme.js';
export function attachRain(host) {
  try {
    const P = rainPalette(), cv = document.createElement('canvas'); cv.className = 'onb-rain'; cv.setAttribute('aria-hidden', 'true'); host.prepend(cv);
    const cx = cv.getContext('2d'), fs = 16, G = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF<>/{}#$%';
    const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; let cols = [], raf = 0, last = 0;
    const size = () => { cv.width = innerWidth; cv.height = innerHeight; cols = Array(Math.ceil(cv.width / fs)).fill(0).map(() => Math.random() * -40); cx.fillStyle = P.bg; cx.fillRect(0, 0, cv.width, cv.height); cx.font = fs + 'px ui-monospace,monospace'; };
    const h = P.bg.slice(1), fade = `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},.12)`;
    const draw = ts => { if (!cv.isConnected) { removeEventListener('resize', size); return; } raf = requestAnimationFrame(draw); if (ts - last < 60) return; last = ts;
      cx.fillStyle = fade; cx.fillRect(0, 0, cv.width, cv.height);
      cols.forEach((y, i) => { cx.fillStyle = Math.random() < .07 ? P.head : i % 5 ? P.a : P.b; cx.fillText(G[(Math.random() * G.length) | 0], i * fs, y * fs); cols[i] = y * fs > cv.height && Math.random() > .975 ? 0 : y + 1; }); };
    size(); addEventListener('resize', size, { passive: true });
    if (reduce) { cx.fillStyle = P.still || P.a; for (let i = 0; i < cols.length; i++) for (let j = 1; j < cv.height / fs; j += 3) cx.fillText(G[(i * 7 + j) % G.length], i * fs, j * fs); }
    else raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); cv.remove(); };
  } catch { return () => {}; }
}
