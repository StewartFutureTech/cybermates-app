// Fullscreen button for every game stage (.arc-stage). Uses the Fullscreen API (with webkit prefix);
// where unavailable (iPhone Safari) falls back to a CSS "immersive" mode that pins the game to the viewport.
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
export const fsSupported = () => !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
export const targetOf = stage => stage.closest('#view') || stage.parentElement || stage;
export function isFull(t) { return fsEl() === t || t.classList.contains('cm-immersive'); }
export async function toggle(t) {
  if (isFull(t)) { if (t.classList.contains('cm-immersive')) t.classList.remove('cm-immersive'); else await (document.exitFullscreen || document.webkitExitFullscreen).call(document)?.catch?.(() => {}); }
  else {
    const req = t.requestFullscreen || t.webkitRequestFullscreen; let ok = false;
    if (req) { try { await req.call(t, { navigationUI: 'hide' }); ok = true; } catch { ok = false; } }
    if (!ok) t.classList.add('cm-immersive');
  }
  sync(); setTimeout(() => dispatchEvent(new Event('resize')), 60);
}
function sync() { for (const b of document.querySelectorAll('.cm-fs-btn')) { const t = targetOf(b.closest('.arc-stage')); const on = isFull(t); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? '⤡' : '⛶'; b.title = b.ariaLabel = on ? 'Exit fullscreen' : 'Fullscreen'; } }
export function decorate(root = document) {
  for (const s of root.querySelectorAll('.arc-stage')) {
    if (s.querySelector(':scope > .cm-fs-btn')) continue;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cm-fs-btn';
    b.addEventListener('click', e => { e.stopPropagation(); toggle(targetOf(s)); });
    s.appendChild(b);
  }
  sync();
}
export function install() {
  if (globalThis.__cmFs) return; globalThis.__cmFs = true;
  decorate(); new MutationObserver(() => { if (document.querySelector('.arc-stage:not(:has(> .cm-fs-btn))')) decorate(); }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener('fullscreenchange', sync); document.addEventListener('webkitfullscreenchange', sync);
  // leaving a game tab clears immersive mode
  document.addEventListener('click', e => { if (e.target.closest?.('nav [data-tab]')) document.querySelectorAll('.cm-immersive').forEach(x => x.classList.remove('cm-immersive')); }, true);
  addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.cm-immersive').forEach(x => { x.classList.remove('cm-immersive'); sync(); }); });
}
