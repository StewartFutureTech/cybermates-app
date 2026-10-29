// UX §6 DISCOVER: list mode (default, everybody) or swipe mode (one glass card at a time, 3D tilt while dragging).
// Swipe left / ← = pass: unlinks that node from your mesh slot and asks the mesh for a replacement. Swipe right / → = like
// (wants to talk). Tap a card = open their full profile ("Loading their profile…" + online check happens in the caller).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const SWIPE_PX = 90;
export const getMode = () => { try { return localStorage.getItem('cm.disc.view') || 'list'; } catch { return 'list'; } };
export const setMode = m => { try { localStorage.setItem('cm.disc.view', m); } catch {} };
export const toggleHTML = m => `<div class="row gap dv-toggle"><button data-dv="list" class="small ${m === 'list' ? 'on' : ''}" aria-pressed="${m === 'list'}">☰ List</button><button data-dv="swipe" class="small ${m === 'swipe' ? 'on' : ''}" aria-pressed="${m === 'swipe'}">⇆ Swipe</button></div>`;
export class SwipeDeck { // pure state; DOM layer below. cm-v35: a fixed number of mesh-bucket SLOTS over a ranked pool.
  // Pass (left) frees the slot and refills it with the next best match from the pool (highest pct, never a passed/seen one).
  constructor(items, { onPass = () => {}, onLike = () => {}, slots = Infinity, pool = [] } = {}) {
    Object.assign(this, { onPass, onLike, slots }); this.i = 0; this.passed = []; this.liked = []; this.gone = new Set();
    const all = [...items, ...pool].filter((x, k, a) => a.findIndex(y => y.profile?.id === x.profile?.id) === k);
    this.items = all.slice(0, slots); this.reserve = all.slice(this.items.length); }
  get top() { return this.items[this.i] || null; }
  nextBest() { if (!this.reserve.length) return null; let b = 0; this.reserve.forEach((x, k) => { if ((x.pct ?? 0) > (this.reserve[b].pct ?? 0)) b = k; }); return this.reserve.splice(b, 1)[0]; }
  swipe(dir) { const x = this.top; if (!x) return null; this.gone.add(x.profile?.id); (dir === 'right' ? this.liked : this.passed).push(x);
    if (dir === 'left') { const n = this.nextBest(); this.items.splice(this.i, 1); if (n) this.items.push(n); } else this.i++; // the passed slot is refilled
    (dir === 'right' ? this.onLike : this.onPass)(x); return { dir, item: x }; }
  refill(more) { const have = new Set([...this.items, ...this.reserve].map(x => x.profile?.id)); for (const m of more) if (!have.has(m.profile?.id) && !this.gone.has(m.profile?.id)) this.reserve.push(m);
    while (this.items.length - this.i < Math.min(this.slots, 1e9) && this.items.length < this.slots + this.i && this.reserve.length) this.items.push(this.nextBest()); }
}
export function swipeView(root, deck, { cardHTML, onOpen = () => {} }) {
  const draw = () => { const x = deck.top; root.innerHTML = x ? `<div class="dv-stage"><div class="dv-card glass3d" tabindex="0" role="group" aria-label="Swipe card">${cardHTML(x)}</div></div>
      <div class="row gap dv-btns"><button class="dv-pass" aria-label="Pass">✕ Pass</button><button class="dv-like primary" aria-label="Like">♥ Like</button></div><p class="muted small">Swipe left to pass (they leave your mesh, a new node fills the slot) · right to like · tap to open</p>`
      : '<div class="card">That\'s everyone nearby in your mesh for now — new nodes are being pulled in.</div>';
    const c = root.querySelector('.dv-card'); if (!c) return; let x0 = null, dx = 0;
    const go = dir => { c.style.transition = 'transform .25s, opacity .25s'; c.style.transform = `translateX(${dir === 'right' ? 140 : -140}%) rotateY(${dir === 'right' ? 25 : -25}deg)`; c.style.opacity = '0'; setTimeout(() => { deck.swipe(dir); draw(); }, 230); };
    c.onpointerdown = e => { x0 = e.clientX; dx = 0; c.setPointerCapture?.(e.pointerId); c.style.transition = 'none'; };
    c.onpointermove = e => { if (x0 == null) return; dx = e.clientX - x0; c.style.transform = `translateX(${dx}px) rotateY(${dx / 12}deg) rotateZ(${dx / 40}deg)`; };
    c.onpointerup = () => { if (x0 == null) return; x0 = null; if (Math.abs(dx) > SWIPE_PX) go(dx > 0 ? 'right' : 'left'); else { c.style.transition = 'transform .2s'; c.style.transform = ''; if (Math.abs(dx) < 6) onOpen(deck.top); } };
    c.onkeydown = e => { if (e.key === 'ArrowLeft') go('left'); if (e.key === 'ArrowRight') go('right'); if (e.key === 'Enter') onOpen(deck.top); };
    root.querySelector('.dv-pass').onclick = () => go('left'); root.querySelector('.dv-like').onclick = () => go('right'); };
  draw(); return { redraw: draw };
}
export { esc };
// UX §8 tap-to-open: the full profile travels ONLY now. Shows "Loading their profile..." while the same round trip checks
// whether they are online (src/livemesh.js openProfile). fetch() -> {online, profile?}. Uses existing card styles only.
export async function loadingProfile(root, fetch, { profileHTML = p => `<b>${esc(p?.name)}</b>${p?.age ? ' · ' + esc(p.age) : ''}<p>${esc(p?.bio || '')}</p>`, onTalk = () => {}, onBack = () => {} } = {}) {
  root.innerHTML = '<div class="card dv-loading" role="status" aria-live="polite">Loading their profile...<div class="muted small">Checking if they\'re online</div></div>';
  let r; try { r = await fetch(); } catch { r = { online: false }; }
  root.innerHTML = r?.online && r.profile ? `<div class="card dv-profile" data-online="1"><span class="muted small">🟢 online now</span><div>${profileHTML(r.profile)}</div><div class="row gap"><button class="dv-back small">← Back</button><button class="dv-talk primary">♥ Want to talk</button></div></div>`
    : `<div class="card dv-profile" data-online="0">They're offline right now. Their full profile is only shown while they're online.<div class="row gap"><button class="dv-back small">← Back</button></div></div>`;
  root.querySelector('.dv-back').onclick = () => onBack(); root.querySelector('.dv-talk')?.addEventListener('click', () => onTalk(r.profile)); return r;
}
