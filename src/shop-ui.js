// Shop tab v2 + bottom banner ad slot (house ads only). Logic: src/shop.js. Prices: docs/SHOP-PRICING.md.
import * as S from './shop.js';
import { db } from './store.js';
import { mesh } from './app-mesh.js';
import { isMinor } from './discovery.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// House ads: in-app promos only (no ad network, no tracking, no keys). Safe for every age.
export const HOUSE_ADS = ['🔗 Add friends instantly — Friends → Create friend link', '🕹 Challenge a friend in the Arcade', '🎨 New neon emoji packs in the Shop', '🛡 You can block anyone, anytime — Settings'];
const shops = new Map();
export function shopFor(me) { if (!me) return null; const k = me.id; let s = shops.get(k); if (!s) { s = new S.Shop({ wallet: db._w(), uid: me.id }); shops.set(k, s); } s.minor = isMinor(me); s.parent = mesh()?.parent || null; return s; }
let adI = 0;
export async function mountBanner(app, me) { const s = shopFor(me); if (!s || !app) return; if (!(await s.showBanner().catch(() => false))) return; const nav = app.querySelector('nav'); if (!nav || app.querySelector('#adslot')) return;
  const d = document.createElement('aside'); d.id = 'adslot'; d.className = 'adslot glass'; d.setAttribute('aria-label', 'Advertisement'); d.innerHTML = `<span class="adtag">AD</span><span class="grow">${esc(HOUSE_ADS[adI++ % HOUSE_ADS.length])}</span><button class="ghost small" data-adrm>Remove ads ${S.price(S.bySku('noads').cents)}</button>`;
  nav.before(d); document.body.classList.add('has-ad'); d.querySelector('[data-adrm]').onclick = () => { const b = app.querySelector('nav button[data-tab="shop"]'); b?.click(); }; }
export function unmountBanner() { document.getElementById('adslot')?.remove(); document.body.classList.remove('has-ad'); }
const card = (it, s, owned) => `<div class="card glass row shopitem ${it.best ? 'best' : ''}" data-sku="${it.sku}"><div class="grow"><b>${esc(it.title)}</b>${it.best ? ' <span class="tag hot">BEST VALUE</span>' : ''}${it.preview ? `<div class="emo">${it.preview}</div>` : ''}<div class="muted small">${esc(it.desc)}</div></div>
  <button class="primary" data-buy2="${it.sku}" ${owned ? 'disabled' : ''}>${owned ? 'Owned' : S.price(it.cents)}</button></div>`;
export async function shopView(v, st, render) { const me = st.me, s = shopFor(me), minor = isMinor(me), stt = await s.state(), wv = await db.getWalletView(me.id);
  const own = it => [].concat(it.unlock || []).length > 0 && [].concat(it.unlock).every(u => u === 'noads' ? stt.noads : stt.unlocks.has(u));
  const group = g => S.CATALOG.filter(i => i.group === g && (!minor || S.allowedForMinor(i)));
  v.innerHTML = `<div data-shop2><div class="card glass warn small">🧪 TEST STORE — payments are stubbed (Stripe not connected). Nothing is charged.</div>
  <div class="wallet glass neon-edge"><b>💎 ${wv.boosts}</b> boosts${wv.plus ? ' · ⭐ Cybermates+' : ''} ${stt.ok ? '<span class="tag">ledger ✓</span>' : '<span class="tag hot">ledger tampered — purchases paused</span>'}</div>
  ${minor ? `<p class="small muted">Under 18: purchases need a parent's PIN. Dating features aren't sold to under-18s.</p>` : ''}
  <h3>🎬 Watch &amp; earn</h3><div class="card glass row"><div class="grow"><b>Watch 2 short ads in a row → 1 free boost</b><div class="muted small">${s.streak.n}/${S.REWARD_STREAK} watched · up to ${S.REWARD_DAILY_CAP} free boosts a day (${stt.rewardsToday} today)</div><div class="streak">${Array.from({ length: S.REWARD_STREAK }, (_, i) => `<i class="${i < s.streak.n ? 'on' : ''}"></i>`).join('')}</div></div><button class="primary" data-reward>▶ Watch</button></div>
  <h3>🚀 Boosted messages</h3><p class="muted small">A boost highlights your connection request. Never delivered = automatically refunded.</p>${group('boosts').map(i => card(i, s, false)).join('')}
  <h3>🚫 Ads</h3>${group('ads').map(i => card(i, s, own(i))).join('')}
  <h3>✨ Cosmetics</h3>${group('cosmetic').map(i => card(i, s, own(i))).join('')}
  ${minor ? '' : `<h3>⭐ Cybermates+</h3>${group('plus').map(i => `<div class="card glass row"><div class="grow"><b>${esc(i.title)}</b><div class="muted small">${esc(i.desc)}</div></div><button class="primary" data-plus="${i.sku}" ${wv.plus ? 'disabled' : ''}>${wv.plus ? 'Active' : S.price(i.cents)}</button></div>`).join('')}${wv.plus ? '<button class="ghost small" data-pluscancel>Cancel Cybermates+ (test)</button>' : ''}`}
  <h3 class="small">Purchase history</h3>${stt.entries.slice().reverse().slice(0, 12).map(e => `<div class="row small ledger"><span class="grow">${e.type === 'refund' ? '↩ refund' : e.type === 'reward' ? '🎬 reward' : '🧾'} ${esc(S.bySku(e.sku)?.title || e.sku)}</span><span class="muted">${e.cents ? S.price(e.cents) : 'free'}</span>${e.type === 'purchase' && !stt.entries.some(x => x.type === 'refund' && x.ref === e.id) ? `<button class="ghost small" data-refund="${e.id}">Refund (test)</button>` : ''}</div>`).join('') || '<p class="muted small">No purchases yet.</p>'}
  <p class="muted small">Prices in USD, set below half of typical competitor prices (see in-app pricing notes). Messages in existing conversations are always free.</p></div>`;
  const msg = r => r.message || ({ 'already-owned': 'You already own this.', 'ledger-tampered': 'Purchase history failed its integrity check.', 'minor-dating': 'Not available under 18.', 'daily-cap': 'Daily free boost limit reached.', 'not-watched': 'Watch the whole ad to count it.' })[r.reason] || r.reason;
  const pin = async r => { if (r.reason !== 'parent-locked' || !s.parent) return false; const p = prompt('Parent PIN'); if (!p) return false; return (await s.parent.unlock(p)).ok; };
  v.querySelectorAll('[data-buy2]').forEach(b => b.onclick = async () => { let r = await s.buy(b.dataset.buy2); if (!r.ok && await pin(r)) r = await s.buy(b.dataset.buy2); if (!r.ok) alert(msg(r)); render(); });
  v.querySelectorAll('[data-plus]').forEach(b => b.onclick = async () => { if (minor) return; await db.mockPurchase(me.id, b.dataset.plus); render(); });
  v.querySelector('[data-pluscancel]')?.addEventListener('click', async () => { await db.mockPurchase(me.id, 'plus_cancel'); render(); });
  v.querySelectorAll('[data-refund]').forEach(b => b.onclick = async () => { const r = await s.refund(b.dataset.refund, { reason: 'test' }); if (!r.ok) alert(msg(r)); else if (r.shortfall) alert(`Refunded. ${r.shortfall} boost(s) were already used.`); render(); });
  v.querySelector('[data-reward]').onclick = () => rewardedModal(s, render); }
// Rewarded video PLACEHOLDER: a 15 s house "ad" with a countdown. Closing early cancels (and breaks the streak).
export function rewardedModal(s, render, secs = Math.ceil(S.AD_MIN_WATCH_MS / 1000)) { s.startRewarded(); const d = document.createElement('div'); d.className = 'modal rewarded'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Rewarded video');
  d.innerHTML = `<div class="card glass neon-edge"><span class="adtag">AD · placeholder</span><div class="advideo"><b>${esc(HOUSE_ADS[Math.floor(Math.random() * HOUSE_ADS.length)])}</b></div><p class="small">Reward in <b data-left>${secs}</b>s</p><button class="ghost small" data-close>Close</button></div>`;
  document.body.append(d); let left = secs; const t = setInterval(async () => { left--; const l = d.querySelector('[data-left]'); if (l) l.textContent = left; if (left <= 0) { clearInterval(t); const r = await s.completeRewarded(); d.querySelector('.card').innerHTML = `<p>${r.earned ? '🎉 +1 boost!' : r.ok ? `Nice — ${r.streak}/${S.REWARD_STREAK}. Watch one more for a free boost.` : 'No reward: ' + esc(r.reason)}</p><button class="primary" data-close>OK</button>`; d.querySelector('[data-close]').onclick = () => { d.remove(); render(); }; } }, 1000);
  d.querySelector('[data-close]').onclick = () => { clearInterval(t); s.cancelRewarded(); d.remove(); render(); }; return d; }
