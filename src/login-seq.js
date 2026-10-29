// UX §2 LOGIN / FIRST-RUN SEQUENCE (fixed order): 1 age check -> 2 acknowledgement (Read-to-me, forced scroll to the end,
// 30 s minimum before Accept) -> 3 device ID key (background; random fallback) -> 4 forced profile setup (cannot leave
// until complete). Pure logic here; UI lives in compliance.js (age), terms.js (ack), main.js (profile gate).
import { deriveIdKey, stableDeviceFields } from './identity.js';
export const LOGIN_STEPS = ['age', 'ack', 'devicekey', 'profile'];
export const ACK_MIN_MS = 30e3, ACK_FLOOR_MS = 20e3, READ_WPS = 2.7; // ~160 words/min = speechSynthesis at rate 1
// Minimum time sized to the "Read to me" length: words / 2.7 per second, clamped to 20-30 s (UX §2: "~30 s, or ~20 s,
// whatever fits the voice read length"). The full terms read aloud runs several minutes, so in practice this is 30 s.
export const readMs = text => Math.round(1000 * (String(text || '').trim().split(/\s+/).filter(Boolean).length / READ_WPS));
export const ackMinFor = text => Math.min(ACK_MIN_MS, Math.max(ACK_FLOOR_MS, readMs(text)));
// test hook (puppeteer only): globalThis.__cmAckTest = {minMs, noScroll}. Production never sets it.
export const ackMinMs = text => globalThis.__cmAckTest?.minMs ?? (text == null ? ACK_MIN_MS : ackMinFor(text));
export class AckGate { // Accept enabled only when: scrolled to the end AND min time elapsed AND box ticked
  constructor({ minMs = ackMinMs(), now = () => Date.now(), noScroll = !!globalThis.__cmAckTest?.noScroll } = {}) { Object.assign(this, { minMs, now }); this.t0 = now(); this.scrolled = noScroll; this.checked = false; }
  onScroll(el) { if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) this.scrolled = true; return this.scrolled; }
  left() { return Math.max(0, this.minMs - (this.now() - this.t0)); }
  canAccept() { return this.scrolled && this.checked && this.left() === 0; }
  secs() { return Math.ceil(this.left() / 1000); }
  reason() { return !this.scrolled ? 'Scroll to the end to continue' + (this.left() ? ` · ${this.secs()}s` : '') : this.left() ? `Please keep reading… ${this.secs()}s` : !this.checked ? 'Tick the box to accept' : ''; }
  steps() { return [{ k: 'scroll', done: this.scrolled, label: this.scrolled ? 'Read to the end' : 'Scroll to the end' }, { k: 'timer', done: !this.left(), label: this.left() ? `Wait ${this.secs()}s` : 'Time done' }, { k: 'tick', done: this.checked, label: 'Tick the box' }]; }
}
// Step 3: device ID key. Uses the stable device fields (identity.js); if unavailable (blocked/empty) -> random number.
export async function deviceKey({ device, rand = n => crypto.getRandomValues(new Uint8Array(n)) } = {}) {
  try { device ||= await stableDeviceFields(); if (device?.fields?.some(f => String(f || '').length > 0 && f !== 0)) return { key: await deriveIdKey({ device }), source: device.strong ? 'device' : 'web-fingerprint' }; } catch {}
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; return { key: [...rand(16)].map(x => A[x % A.length]).join(''), source: 'random' };
}
export async function ensureDeviceKey(vault, opts) { const p = await vault.read(); if (p?.deviceKey?.key) return p.deviceKey; const k = { ...(await deviceKey(opts)), at: Date.now() }; await vault.use(x => { x.deviceKey = k; }); return k; }
// Step 4: what still blocks the profile. Dating-only fields required only when dating is on (never for minors).
export function missingProfile(p) { const m = [], minor = !!p?.minor || (p?.age != null && p.age < 18), dating = !minor && (p?.lookingFor || []).includes('dating');
  if (!p) return ['profile']; if (!String(p.name || '').trim()) m.push('name'); if (!(p.age >= 13)) m.push('age'); if (!p.gender) m.push('gender');
  if (!(p.lookingFor || []).length) m.push('lookingFor'); if (!(p.city || p.lat != null || p.countryCode)) m.push('location');
  if (!(p.interests || []).length && !(p.games || []).length) m.push('interests');
  if (!(p.photos || []).length && !p.avatarPreset && p.avatarHue == null) m.push('photo');
  if (dating && !(p.seekingGenders || []).length) m.push('seekingGenders'); return m; }
export const profileComplete = p => missingProfile(p).length === 0;
