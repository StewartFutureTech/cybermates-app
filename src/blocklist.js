// BLOCK LIST — user-controlled, per-user (per local profile), LOCAL ONLY. Keyed by the ID key (src/identity.js).
// Separate from the BAN LIST (src/banlist.js: server-enforced, mod-signed, gossiped) and from the ACTIVE LIST
// (in-memory active list from the server super list). Never sent to the server or mesh.
// Stored inside the encrypted vault (p.blocklists[owner] = {<id>: {at, legacy?}}), so at rest it is AES-GCM ciphertext.
export class BlockList {
  constructor(vault, owner) { this.vault = vault; this.owner = owner; this.m = new Map(); }
  async load() { const p = await this.vault.read(); this.m = new Map(Object.entries(p?.blocklists?.[this.owner] || {})); return this; }
  async _save() { const o = Object.fromEntries(this.m); await this.vault.use(p => { (p.blocklists ||= {})[this.owner] = o; }); }
  async add(id, meta = {}) { if (!id || id === this.owner) return false; this.m.set(String(id), { at: Date.now(), ...meta }); await this._save(); return true; }
  async remove(id) { const had = this.m.delete(String(id)); if (had) await this._save(); return had; }
  list() { return [...this.m].map(([id, v]) => ({ id, ...v })); }
  isBlocked(id) { return !!id && this.m.has(String(id)); }
  filter(items, idOf = x => x?.code ?? x) { return items.filter(x => !this.isBlocked(idOf(x))); } // discovery results
  allowInbound(env) { return !this.isBlocked(env?.from) && !this.isBlocked(env?.code); }          // inbound packets
  // one-time import of the legacy per-identity `blocked` array (meshIds[x].blocked)
  async importLegacy(arr = []) { let n = 0; for (const c of arr) if (!this.m.has(c)) { this.m.set(c, { at: Date.now(), imported: true }); n++; } if (n) await this._save(); return n; }
}
