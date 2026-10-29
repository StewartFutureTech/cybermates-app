// STORAGE ADAPTER for features the UX walkthrough marks "blocked on Supabase" (reports bucket, LFG board, Friends events,
// rolling photos). One async interface, three backends:
//   LocalKV    - this device only (localStorage, namespaced). Used now.
//   MeshKV     - LocalKV + gossip of PUBLIC records over the mesh ('kv' envelopes); receivers validate + keep their own copy.
//   SupabaseKV - placeholder with the same interface; swap in on Supabase day (see docs/SUPABASE-DAY-CHECKLIST.md).
// Interface: get(id) · put(rec) · del(id) · list(filter?) · sub(fn). Records are plain JSON {id, ...}; every collection is
// its own namespace. Nothing secret is ever stored in a gossiped collection.
const P = 'cybermates:kv:'; const cache = new Map();
const mem = new Map(); const LS = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const read = k => { const ls = LS(); if (!ls) return mem.get(k) ?? null; try { return JSON.parse(ls.getItem(k)); } catch { return null; } };
const write = (k, v) => { const ls = LS(); if (!ls) return void mem.set(k, v); ls.setItem(k, JSON.stringify(v)); };
export class LocalKV {
  constructor(ns, { max = 500 } = {}) { this.ns = ns; this.key = P + ns; this.max = max; this.subs = new Set(); }
  _all() { return read(this.key) || {}; }
  _save(o) { const e = Object.entries(o); if (e.length > this.max) o = Object.fromEntries(e.sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, this.max)); write(this.key, o); }
  async get(id) { return this._all()[id] || null; }
  async put(rec) { if (!rec?.id) throw new Error('id required'); const o = this._all(); o[rec.id] = rec; this._save(o); this._emit('put', rec); return rec; }
  async del(id) { const o = this._all(); const had = id in o; delete o[id]; this._save(o); if (had) this._emit('del', { id }); return had; }
  async list(filter = () => true) { return Object.values(this._all()).filter(filter); }
  sub(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  _emit(op, rec) { for (const f of this.subs) try { f(op, rec); } catch {} }
}
// MeshKV: transport = { send(body), sub(fn(from, body)) } (mesh().arcade-style broadcast). validate(rec, from) must return
// true for a gossiped record to be kept (e.g. owner === from, same age band, not expired, size limits).
export class MeshKV extends LocalKV {
  constructor(ns, { transport = null, validate = () => false, ...o } = {}) { super(ns, o); this.validate = validate; this.attach(transport); }
  attach(t) { this.t = t; this.unsub?.(); this.unsub = t?.sub?.((from, b) => { if (b?.kv !== this.ns) return;
    if (b.op === 'put' && b.rec && this.validate(b.rec, from)) super.put({ ...b.rec, _from: from });
    if (b.op === 'del' && b.id) this.get(b.id).then(r => { if (r && r._from === from) super.del(b.id); }); }); return this; }
  async put(rec, { share = true } = {}) { const r = await super.put(rec); if (share) this.t?.send?.({ kv: this.ns, op: 'put', rec: (({ _from, ...x }) => x)(rec) }); return r; }
  async del(id, { share = true } = {}) { const r = await super.del(id); if (share) this.t?.send?.({ kv: this.ns, op: 'del', id }); return r; }
}
// Supabase backend slot: register the object from createSupabaseBackend() (src/backend/supabase-backend.js) once the user
// is signed in. SupabaseKV and compliance.submitReport() then use it; until then they stay inert / queue locally.
let supa = null;
export function useSupabaseBackend(be) { supa = be || null; cache.forEach((v, k) => { if (k.endsWith('|supabase')) cache.delete(k); }); return supa; }
export const supabaseBackend = () => supa;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const asUuid = v => (UUID.test(String(v ?? '')) ? String(v) : null);
export class SupabaseKV { // same interface; NOT active until a Supabase backend/client is supplied (no secret keys bundled)
  constructor(ns, clientOrBackend = null) { this.ns = ns; this.be = clientOrBackend?.store ? clientOrBackend : null; this.c0 = clientOrBackend?.store ? null : clientOrBackend; }
  get c() { return this.c0 || this.be?.client || null; }
  get store() { return this.be?.store || null; }
  _need() { if (!this.c) throw Object.assign(new Error('supabase-not-configured'), { code: 'supabase-not-configured' }); }
  async get(id) { this._need(); const { data } = await this.c.from(this.ns).select('*').eq('id', id).maybeSingle(); return data; }
  async put(rec) { this._need();
    if (this.ns === 'reports' && this.store?.report) { // reports go through the RLS-checked SupabaseStore.report()
      let reported = asUuid(rec.reported); if (!reported) { try { reported = await (await import('./signin.js')).resolveUid(rec.reported); } catch {} }
      const row = await this.store.report({ reported, reason: rec.reason, details: rec.excerpt || null, evidence: { reporter_code: rec.reporter, reported_code: rec.reported, context: rec.context || null, game: rec.game || null } });
      return { ...rec, remoteId: row?.id }; }
    await this.c.from(this.ns).upsert(rec); return rec; }
  async del(id) { this._need(); await this.c.from(this.ns).delete().eq('id', id); return true; }
  async list(filter = () => true) { this._need(); if (this.ns === 'reports' && this.store?.listMyReports) return (await this.store.listMyReports() || []).filter(filter); const { data } = await this.c.from(this.ns).select('*'); return (data || []).filter(filter); }
  sub() { return () => {}; }
}
// Factory: backend 'local' (default) | 'mesh' | 'supabase'. Callers never branch on backend.
export function kv(ns, { backend = 'local', ...o } = {}) { const k = ns + '|' + backend; if (cache.has(k)) return cache.get(k);
  const s = backend === 'mesh' ? new MeshKV(ns, o) : backend === 'supabase' ? new SupabaseKV(ns, o.backend || o.client || supa) : new LocalKV(ns, o); cache.set(k, s); return s; }
export const _resetKv = () => { cache.clear(); mem.clear(); };
