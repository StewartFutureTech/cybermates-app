// Gossiped signed BAN LIST. Each entry IS a mod-key-signed control message scoped to one user:
//   ban  = {type:'kill',  scope:'user:<code>', ...sig}   lift = {type:'clear', scope:'user:<code>', ...sig}
// Latest issued_at per code wins; expired bans drop out. Signatures are verified lazily (on first merge of each entry,
// cached by sig); forged/tampered entries and lifts are ignored. hash() = short digest piggybacked on the membership
// anti-entropy 'pull' (no extra traffic); entries are exchanged only when hashes differ (index -> diff).
// At rest: sealed with the device-derived vault key (like the active list).
import { verifySig, KILL_PUBKEY, MAX_LIFETIME_MS } from './killswitch.js';
import { seal, open, KDF_VERSION } from './vault.js';
const fnv = (s, h = 0x811c9dc5) => { for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const t36 = n => Math.round(n).toString(36), p36 = s => parseInt(s, 36);
export const codeOf = e => /^user:([A-Za-z0-9-]{1,64})$/.exec(e?.scope || '')?.[1] || null;
// compact wire/disk form: [0 ban|1 lift, code, reason, issued36, expires36, nonce, sig]
// tiered entries append [level, strikes] (9 elements); legacy 7-element entries = level 5.
export const encodeEntry = e => { const a = [e.type === 'kill' ? 0 : 1, codeOf(e), e.reason || '', t36(e.issued_at), t36(e.expires_at), e.nonce, e.sig]; return e.level != null ? [...a, e.level, e.strikes ?? null] : a; };
export const decodeEntry = a => Array.isArray(a) && (a.length === 7 || a.length === 9) ? { type: a[0] === 0 ? 'kill' : 'clear', scope: 'user:' + a[1], reason: a[2], issued_at: p36(a[3]), expires_at: p36(a[4]), nonce: a[5], sig: a[6], ...(a.length === 9 ? { level: a[7], ...(a[8] != null ? { strikes: a[8] } : {}) } : {}) } : null;
export class BanList {
  constructor({ pubkey = KILL_PUBKEY, now = () => Date.now() } = {}) { this.pubkey = pubkey; this.now = now; this.m = new Map(); this.ok = new Set(); this._h = null; }
  async valid(e) {
    const code = codeOf(e); if (!code || !['kill', 'clear'].includes(e.type) || typeof e.sig !== 'string') return false;
    if (e.type === 'kill' && e.level != null && e.level < 4) return false; // only suspensions (4) and bans (5) are gossiped; warnings come via check-in
    if (this.ok.has(e.sig)) return true;
    if (!(e.expires_at > e.issued_at) || e.expires_at - e.issued_at > MAX_LIFETIME_MS || e.issued_at > this.now() + 120e3) return false;
    if (!(await verifySig(e, this.pubkey))) return false; this.ok.add(e.sig); return true;
  }
  newer(e) { const c = this.m.get(codeOf(e)); return !c || e.issued_at > c.issued_at || (e.issued_at === c.issued_at && e.sig > c.sig); }
  async merge(list) { let n = 0; for (const e of list || []) { if (!e || !codeOf(e) || !this.newer(e) || !(await this.valid(e))) continue; this.m.set(codeOf(e), e); n++; } if (n) this._h = null; this.prune(); return n; }
  prune() { const t = this.now(); for (const [c, e] of this.m) if (e.expires_at <= t) { this.m.delete(c); this._h = null; } }
  isBanned(code) { const e = this.m.get(code); return !!e && e.type === 'kill' && e.expires_at > this.now(); } // level 5, or level 4 until its suspension expiry
  level(code) { const e = this.m.get(code); return e && e.type === 'kill' && e.expires_at > this.now() ? (e.level ?? 5) : 0; }
  entry(code) { return this.m.get(code) || null; }
  hash() { return this._h ??= this.m.size ? fnv([...this.m.values()].map(e => e.sig).sort().join('|')).toString(36) : '0'; }
  index() { return [...this.m.values()].map(e => [codeOf(e), t36(e.issued_at)]); }
  diff(idx) { const theirs = new Map((idx || []).map(([c, t]) => [c, p36(t)])), push = [], want = [];
    for (const [c, e] of this.m) if (!theirs.has(c) || theirs.get(c) < e.issued_at) push.push(encodeEntry(e));
    for (const [c, t] of theirs) { const e = this.m.get(c); if (!e || e.issued_at < t) want.push(c); } return { push, want }; }
  encoded(codes) { return (codes ? codes.map(c => this.m.get(c)).filter(Boolean) : [...this.m.values()]).map(encodeEntry); }
  async save(vault, storage = globalThis.localStorage) { storage.setItem('cybermates:ban-list', JSON.stringify(await seal(await vault.key(KDF_VERSION), { e: this.encoded() }))); }
  async load(vault, storage = globalThis.localStorage) { try { const raw = storage.getItem('cybermates:ban-list'); if (!raw) return 0; const b = JSON.parse(raw); const o = await open(await vault.key(b.kdf ?? KDF_VERSION), b); return this.merge(o.e.map(decodeEntry)); } catch { return 0; } }
}
