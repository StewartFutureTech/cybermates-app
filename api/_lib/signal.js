import { RecentList } from './recent.js';
import { MemPresence, cleanModes, PRESENCE_TTL_MS, LIST_MAX } from './presence.js';
// Bootstrap signaling + moderation-lookup transport. Feature flag CM_SIGNAL = mock | supabase.
// Default: 'supabase' only when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set, else 'mock'.
//  - mock: in-memory moderation store + presence super list (MemPresence), so the single-entry gate runs with no accounts.

//  - supabase: READY FOR TOMORROW (untested against a live project): Realtime REST broadcast on topic 'mesh' + PostgREST
//    lookups via api/_lib/mod.js. Swap step: set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_KILL_PUBKEY (and optionally
//    CM_SIGNAL=supabase) in Vercel env; nothing else changes.
// Interface: { kind, broadcast(payload), standing(code) -> {level,...}, halted() -> signed halt msg|null, banEntries() -> encoded[] }
import { env, standing, killActive, banEntries } from './mod.js';
import { effectiveLevel, warningText } from '../../src/tiers.js';
import { verifySig, KILL_PUBKEY } from '../../src/killswitch.js';
import { encodeEntry } from '../../src/banlist.js';
export function signalKind(e = process.env) { const f = e.CM_SIGNAL; if (f === 'mock' || f === 'supabase') return f; return e.SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : 'mock'; }
export class MockSignal {
  constructor({ pub = process.env.KILL_PUBKEY || process.env.VITE_KILL_PUBKEY || KILL_PUBKEY } = {}) { this.kind = 'mock'; this.subs = new Set(); this.records = new Map(); this.halt = null; this.pub = pub; this.presence = new MemPresence(); this.recent = new RecentList(); }
  presenceUpsert(c, r, m) { return this.presence.upsert(c, r, m); } presenceRemove(c) { return this.presence.remove(c); } presenceList(o) { return this.presence.list(o); } presenceGet(c) { return this.presence.get(c); }
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); } // mock phones subscribe here
  async broadcast(payload) { for (const f of [...this.subs]) queueMicrotask(() => { try { f(payload); } catch {} }); }
  async standing(code, now = Date.now()) { const r = this.records.get(code); if (!r) return { level: 0 }; const level = effectiveLevel(r, now); return { level, strikes: r.strikes || 0, reason: r.reason || '', until: level === 4 ? +new Date(r.suspended_until) : null }; }
  async halted() { return this.halt && this.halt.type === 'kill' && this.halt.scope === 'all' && (await verifySig(this.halt, this.pub)) ? this.halt : null; }
  async banEntries(now = Date.now()) { return [...this.records.values()].map(r => r.entry).filter(e => e && (e.level ?? 5) >= 4 && e.expires_at > now).map(encodeEntry); }
  // test/admin helpers (local only)
  async lastUs(code) { return this.geo?.get(code) || 0; } async markUs(code, now = Date.now()) { (this.geo ||= new Map()).set(code, now); }
  setRecord(code, rec) { this.records.set(code, { code, ...rec }); } setHalt(msg) { this.halt = msg; }
}
export class SupabaseSignal { // ---- SUPABASE ADAPTER: READY-TO-CONNECT (unit-tested against a fake Supabase REST in scripts/smoke-supaday.mjs) ----
  constructor(cfg = env(), f = (...a) => fetch(...a)) { this.kind = 'supabase'; this.cfg = cfg; this.f = f; }
  H() { return { apikey: this.cfg.srk, authorization: `Bearer ${this.cfg.srk}`, 'content-type': 'application/json' }; }
  async lastUs(code) { const r = await this.f(`${this.cfg.url}/rest/v1/geo_seen?code=eq.${encodeURIComponent(code)}&select=last_us_at`, { headers: this.H() }); if (!r.ok) return 0; const x = (await r.json())[0]; return x ? +new Date(x.last_us_at) : 0; }
  async markUs(code, now = Date.now()) { await this.f(`${this.cfg.url}/rest/v1/geo_seen?on_conflict=code`, { method: 'POST', headers: { ...this.H(), prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ code, last_us_at: new Date(now).toISOString() }) }); }
  // presence super list (table public.presence). READY-TO-CONNECT; tested with a fake REST in smoke-presence.mjs
  async presenceUpsert(code, row, modes, now = Date.now()) { const r = await this.f(`${this.cfg.url}/rest/v1/presence?on_conflict=code`, { method: 'POST', headers: { ...this.H(), prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ code, row, modes: cleanModes(modes), seen_at: new Date(now).toISOString() }) }); return r.ok; }
  async presenceGet(code) { const r = await this.f(`${this.cfg.url}/rest/v1/presence?code=eq.${encodeURIComponent(code)}&select=row`, { headers: this.H() }); return r.ok ? (await r.json())[0]?.row || null : null; }
  async presenceRemove(code) { const r = await this.f(`${this.cfg.url}/rest/v1/presence?code=eq.${encodeURIComponent(code)}`, { method: 'DELETE', headers: this.H() }); return r.ok; }
  async presenceList({ mode = null, exclude = null, limit = LIST_MAX } = {}, now = Date.now()) {
    const q = [`select=row`, `seen_at=gt.${encodeURIComponent(new Date(now - PRESENCE_TTL_MS).toISOString())}`, mode ? `modes=cs.%7B${mode}%7D` : null, exclude ? `code=neq.${encodeURIComponent(exclude)}` : null, `order=seen_at.desc`, `limit=${limit}`].filter(Boolean).join('&');
    const r = await this.f(`${this.cfg.url}/rest/v1/presence?${q}`, { headers: this.H() }); return r.ok ? (await r.json()).map(x => x.row) : []; }
  async broadcast(payload) { const { url, srk } = this.cfg; await this.f(`${url}/realtime/v1/api/broadcast`, { method: 'POST', headers: { apikey: srk, authorization: `Bearer ${srk}`, 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ topic: 'mesh', event: 'm', payload }] }) }).catch(() => {}); }
  standing(code) { return standing(this.cfg, code, this.f); }
  async halted() { return this.cfg.pub ? killActive(this.cfg, this.f) : null; }
  banEntries() { return banEntries(this.cfg, this.f); }
}
export function getSignal(e = process.env) { if (signalKind(e) === 'supabase') return new SupabaseSignal(env(e)); return globalThis.__cmMockSignal ||= new MockSignal(); }
export { warningText };
