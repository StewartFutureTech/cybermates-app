// ORIGINAL Cybermates mark + wordmark (inline SVG paths — no font, no third-party marks).
// Mark: angular light-line "C" on a circuit hexagon with node pins; wordmark: custom angular stencil lettering on a
// 10×14 grid. Colours come from CSS vars (--cy / --hot). Animations live in style.css (.lg-*):
// intro draw-on + racing light trail (first render only), then idle trace loop + rare glitch flicker; loops use
// --syncd so they continue in phase across re-renders (no restart flash).
const L = { // stroke paths per letter (grid 10w × 14h)
  C: 'M10 0H2L0 2V12L2 14H10', Y: 'M0 0L5 6L10 0M5 6V14', B: 'M0 14V0H8L10 2V5L8 7H1M8 7L10 9V12L8 14H0',
  E: 'M10 0H0V14H10M0 7H7', R: 'M0 14V0H8L10 2V5L8 7H0M5 7L10 14', M: 'M0 14V0L5 6L10 0V14',
  A: 'M0 14V3L3 0H7L10 3V14M0 8H10', T: 'M0 0H10M5 0V14', S: 'M10 0H2L0 2V5L2 7H8L10 9V12L8 14H0',
};
const word = (txt, x0) => [...txt].map((c, i) => `<path d="${L[c]}" transform="translate(${x0 + i * 14} 0)" pathLength="1"/>`).join('');
export const MARK_PATHS = `<path class="lg-hex" pathLength="1" d="M16 1.5 28.6 8.8V23.2L16 30.5 3.4 23.2V8.8Z"/>
  <path class="lg-c" pathLength="1" d="M21.5 10.2H13.2L10 13.4V18.6L13.2 21.8H21.5"/>
  <path class="lg-c2" pathLength="1" d="M21.5 14.2H15.4L14.2 15.4V16.6L15.4 17.8H21.5"/>
  <path class="lg-pin" d="M16 1.5V5M16 27V30.5M3.4 16H6.4M25.6 16H28.6"/>
  <circle class="lg-node" cx="21.5" cy="10.2" r="1.3"/><circle class="lg-node lg-node2" cx="21.5" cy="21.8" r="1.3"/>
  <path class="lg-trail" pathLength="1" d="M16 1.5 28.6 8.8V23.2L16 30.5 3.4 23.2V8.8Z"/>`;
export const markSVG = (size = 30, cls = '') => `<svg class="lg-mark ${cls}" viewBox="0 0 32 32" width="${size}" height="${size}" fill="none" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${MARK_PATHS}</svg>`;
export const wordSVG = (h = 15) => `<svg class="lg-word" viewBox="-2 -2 142 18" height="${h}" width="${Math.round(h * 142 / 18)}" fill="none" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">
  <defs><mask id="lg-stencil" maskUnits="userSpaceOnUse"><rect x="-2" y="-2" width="142" height="18" fill="#fff"/><rect x="-2" y="3.6" width="142" height=".9" fill="#000"/><rect x="-2" y="10.4" width="142" height=".9" fill="#000"/></mask></defs>
  <g mask="url(#lg-stencil)"><g class="lg-w1">${word('CYBER', 0)}</g><g class="lg-w2">${word('MATES', 70)}</g></g>
  <g class="lg-wtrail">${word('CYBERMATES', 0)}</g></svg>`;
let introDone = false; // intro draw-on only on the very first header render of this page load
export function logoHTML() { const intro = !introDone; if (!document.body.classList.contains('jacking') && !document.querySelector('.cm-gate')) introDone = true; // intro waits until loader/gates are gone
  return `<span class="lg${intro ? ' lg-intro' : ''}" role="img" aria-label="Cybermates">${markSVG(30)}${wordSVG(15)}</span>`; }
