// Tron "laser edge" trace: CSS draws it (::after conic gradient masked to a 1.5px ring); this only toggles .lz-off on offscreen
// elements actually on screen (IntersectionObserver) and pauses everything while the page is hidden. No listeners on
// touch, no transforms, nothing on scroll containers' layout.
const SEL = '.card,.modes,button.primary,.jb-btn,nav';
export function initLasers() {
  if (!('IntersectionObserver' in globalThis)) return;
  const io = new IntersectionObserver(es => es.forEach(e => e.target.classList.toggle('lz-off', !e.isIntersecting)), { rootMargin: '40px' });
  const seen = new WeakSet(), scan = root => { (root.matches?.(SEL) ? [root] : []).concat([...(root.querySelectorAll?.(SEL) || [])]).forEach(el => { if (!seen.has(el)) { seen.add(el); io.observe(el); } }); };
  scan(document.body);
  // Re-render remounts DOM (app.innerHTML). Give new subtrees a negative animation-delay = page clock, so every looping
  // animation (laser trace, nav icon idles, glitch) continues in phase instead of restarting = no 'flash' on tap.
  const sync = n => n.style?.setProperty('--syncd', `-${(performance.now() / 1000).toFixed(3)}s`);
  document.querySelectorAll('body > *').forEach(sync);
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 && sync(n)))).observe(document.body, { childList: true, subtree: true });
  let q = 0; new MutationObserver(ms => { if (q) return; q = requestAnimationFrame(() => { q = 0; ms.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 && scan(n))); }); }).observe(document.body, { childList: true, subtree: true });
  const vis = () => document.documentElement.classList.toggle('cm-hidden', document.hidden); document.addEventListener('visibilitychange', vis); vis();
}
