// Parent controls (under 18). PIN: 4 digits, stored ONLY as a salted PBKDF2-SHA256 hash inside the device-key vault; never
// sent (field names 'pin', 'parentPin', 'pinHash' are on the never-send list). 5 wrong tries -> lockout with growing delay.
// Toggles cover features; MESSAGING CAN NEVER BE DISABLED. Every change is logged locally for the parent.
// Limits: a teen could change their birth date or switch devices; PIN recovery = reset that wipes parent settings.
export const TOGGLES = { photos: 'Photos & images', videoCalls: 'Video calls', voiceCalls: 'Voice calls', discoverGaming: 'Gaming discovery', voiceSetup: 'Grok voice setup', proximityVoice: 'Arcade proximity voice', crossAgeGaming: 'Games with 18+ players (matchmaking & lobbies only; no chat, friends or dating across ages)' };
// Toggles that start OFF for minors (parent must enable them with the PIN; the change is logged like every other toggle).
export const DEFAULT_OFF = []; // 2026-10-21 rule: every feature DEFAULT ON for minors; a parent turns specific ones off with the PIN
export const ALWAYS_ON = ['messaging'];
export const PBKDF2_ITERS = 210000, MAX_TRIES = 5, BASE_LOCK_MS = 30e3;
const b64 = u => btoa(String.fromCharCode(...u)), unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export async function hashPin(pin, salt, iters = PBKDF2_ITERS) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return b64(new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iters }, k, 256)));
}
const eq = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
// store: { read(): obj|null, write(obj) } — app passes a vault-backed store (encrypted at rest with the device key)
export class ParentControls {
  constructor({ store, now = () => Date.now(), iters = PBKDF2_ITERS }) { Object.assign(this, { store, now, iters }); this.unlockedUntil = 0; }
  async _s() { return (await this.store.read()) || { pinHash: null, salt: null, tries: 0, lockedUntil: 0, locks: 0, toggles: Object.fromEntries(Object.keys(TOGGLES).map(k => [k, !DEFAULT_OFF.includes(k)])), log: [] }; }
  async hasPin() { return !!(await this._s()).pinHash; }
  async setPin(pin) { if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be 4 digits'); const s = await this._s(); if (s.pinHash && !this.isUnlocked()) throw new Error('unlock first');
    const salt = crypto.getRandomValues(new Uint8Array(16)); s.salt = b64(salt); s.pinHash = await hashPin(pin, salt, this.iters); s.tries = 0; s.log.push({ at: this.now(), what: 'PIN set' }); await this.store.write(s); this.unlockedUntil = this.now() + 5 * 60e3; return true; }
  async unlock(pin) { const s = await this._s(); const t = this.now(); if (!s.pinHash) return { ok: false, reason: 'no-pin' };
    if (s.lockedUntil > t) return { ok: false, reason: 'locked', until: s.lockedUntil };
    if (/^\d{4}$/.test(pin) && eq(await hashPin(pin, unb64(s.salt), this.iters), s.pinHash)) { s.tries = 0; s.locks = 0; await this.store.write(s); this.unlockedUntil = t + 5 * 60e3; return { ok: true }; }
    s.tries++; if (s.tries >= MAX_TRIES) { s.locks++; s.lockedUntil = t + BASE_LOCK_MS * 2 ** (s.locks - 1); s.tries = 0; s.log.push({ at: t, what: 'locked out after 5 wrong PINs' }); }
    await this.store.write(s); return { ok: false, reason: s.lockedUntil > t ? 'locked' : 'wrong', until: s.lockedUntil || 0, left: MAX_TRIES - s.tries }; }
  isUnlocked() { return this.now() < this.unlockedUntil; } lock() { this.unlockedUntil = 0; }
  async set(key, on) { if (ALWAYS_ON.includes(key)) throw new Error('Messaging can never be disabled'); if (!(key in TOGGLES)) throw new Error('unknown toggle'); if (!this.isUnlocked()) throw new Error('locked');
    const s = await this._s(); s.toggles[key] = !!on; s.log.push({ at: this.now(), what: `${TOGGLES[key]} ${on ? 'allowed' : 'turned off'}` }); await this.store.write(s); return true; }
  async allowed(key) { if (ALWAYS_ON.includes(key)) return true; const s = await this._s(); const setByParent = (s.log || []).some(l => l.what?.startsWith(TOGGLES[key])); return key in (s.toggles || {}) && setByParent ? s.toggles[key] !== false : !DEFAULT_OFF.includes(key); } // only a PARENT's explicit change counts (old builds stored proximityVoice:false as a default) // stores from older builds lack new keys -> default
  async log() { return (await this._s()).log.slice(); }
  async resetWipe() { await this.store.write(null); this.unlockedUntil = 0; } // PIN recovery: wipes parent settings
}
