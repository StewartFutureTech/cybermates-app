// Message retention, agreed by BOTH people per chat. Labels are exact (product copy):
export const RETENTION = {
  forever: 'Keep forever',
  while: 'Keep for a while, plus 7-day safety copy',
  instant: 'Hide instantly, kept 7 days for safety reports',
};
export const SAFETY_MS = 7 * 864e5, WHILE_MS = 30 * 864e5, DEFAULT = 'while';
// Under 18: no toggle; retention is always on (the 'while' option with its 7-day safety copy).
export const minorLocked = me => !!me && (me.age != null ? me.age < 18 : false);
// Agreement: effective option = the one both proposed; until both agree, DEFAULT. A minor on either side forces DEFAULT.
export function effective({ mine, theirs, minor = false }) { if (minor) return DEFAULT; return mine && mine === theirs ? mine : DEFAULT; }
export const visibleMs = opt => opt === 'forever' ? Infinity : opt === 'while' ? WHILE_MS : 0;
// v51: sweeps / plans / local Chats-tab TTL follow the effective bubble (default = while ≈ 30d). Never a fixed 48h.
export const ttlMs = (opt = DEFAULT) => { const v = visibleMs(opt); return v === Infinity ? null : v; }; // null = keep forever
export function keepMsg(at, opt, now = Date.now()) { const v = visibleMs(opt); if (v === Infinity) return true; if (v <= 0) return false; return (now - (at || 0)) < v; }
// Encrypted 7-day safety copy. seal/open = vault per-field AES-GCM (device key). Wiped by the sweep after SAFETY_MS.
export class SafetyCopies {
  constructor({ seal, open, store = new Map(), now = () => Date.now() }) { Object.assign(this, { seal, open, store, now }); }
  async add(peer, msg) { const l = this.store.get(peer) || []; l.push({ at: this.now(), z: await this.seal(msg) }); this.store.set(peer, l); }
  sweep() { let n = 0; const t = this.now(); for (const [p, l] of this.store) { const k = l.filter(x => t - x.at < SAFETY_MS); n += l.length - k.length; if (k.length) this.store.set(p, k); else this.store.delete(p); } return n; }
  async conversation(peer) { return Promise.all((this.store.get(peer) || []).map(x => this.open(x.z))); }
}
// Report: upload the conversation sealed (nacl.box, ephemeral key) to the moderation team's PUBLIC key. Server stores ciphertext.
import nacl from 'tweetnacl';
const b = u => { let t = ''; for (const x of u) t += String.fromCharCode(x); return btoa(t); }, ub = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export function sealReport({ reporter, reported, reason, msgs }, modPubB64) {
  const e = nacl.box.keyPair(), n = nacl.randomBytes(24), m = new TextEncoder().encode(JSON.stringify({ reporter, reported, reason, msgs, at: Date.now() }));
  return { reporter, reported, reason: String(reason || '').slice(0, 200), sealed: { e: b(e.publicKey), n: b(n), c: b(nacl.box(m, n, ub(modPubB64), e.secretKey)) } };
}
export function openReport(r, modSecB64) { const m = nacl.box.open(ub(r.sealed.c), ub(r.sealed.n), ub(r.sealed.e), ub(modSecB64)); return m ? JSON.parse(new TextDecoder().decode(m)) : null; }
