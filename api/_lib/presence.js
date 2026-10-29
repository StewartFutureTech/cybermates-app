// SERVER "SUPER LIST" of online profiles — the ONLY entry point to the network (single-entry design, 2026-10-20).
// Row = { code (ID key), row (owner-signed presence row from src/membership.js; no IPs), modes[], seen_at }.
// Updated on login / heartbeat / logoff; rows silent longer than PRESENCE_TTL_MS expire. Mock store here; the Supabase
// adapter (api/_lib/signal.js SupabaseSignal.presence*) uses table public.presence (supabase/schema.sql).
import { verifyRow, validRow } from '../../src/membership.js';
import { validMood } from '../../src/mood.js';
export const PRESENCE_TTL_MS = 3 * 60e3, HEARTBEAT_MS = 60e3, LIST_MAX = 300, MODES = ['friends', 'gaming', 'dating'];
export function checkRow(code, row) { return !!(row && validRow(row) && row.code === code && row.state === 'alive' && validMood(row.mood) && verifyRow(row)); } // mood: fixed list only
export const cleanModes = m => (Array.isArray(m) ? m : []).filter(x => MODES.includes(x)).slice(0, 3);
export class MemPresence {
  constructor({ now = () => Date.now(), ttl = PRESENCE_TTL_MS, max = 200_000 } = {}) { Object.assign(this, { now, ttl, max }); this.m = new Map(); }
  expire() { const t = this.now(); for (const [k, v] of this.m) if (t - v.seen_at > this.ttl) this.m.delete(k); }
  async upsert(code, row, modes) { if (!this.m.has(code) && this.m.size >= this.max) this.expire(); if (this.m.size >= this.max && !this.m.has(code)) return false; this.m.set(code, { code, row, modes: cleanModes(modes), seen_at: this.now() }); return true; }
  async remove(code) { return this.m.delete(code); }
  async get(code) { this.expire(); return this.m.get(code)?.row || null; }
  async list({ mode = null, exclude = null, limit = LIST_MAX } = {}) { this.expire(); const out = []; for (const v of [...this.m.values()].reverse()) { if (v.code === exclude) continue; if (mode && !v.modes.includes(mode)) continue; out.push(v.row); if (out.length >= limit) break; } return out; }
  size() { this.expire(); return this.m.size; }
}
