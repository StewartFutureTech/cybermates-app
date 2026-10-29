import { guardOutgoing } from './never-send.js';
// DEPRECATED (v1 central architecture). Profile/message/wallet methods target tables removed in supabase/schema.sql v2.
// Only _client() is still used, for Realtime signaling/presence (src/p2p-ui.js). Kept for reference/migration.
// Supabase adapter: same async interface as LocalAdapter in store.js.
// supabase-js is loaded lazily so local mode never pays for it.
const today = () => new Date().toISOString().slice(0, 10);
const toMsg = m => ({ id: m.id, from: m.sender, to: m.recipient, text: m.body, boosted: m.boosted, read: m.read, at: new Date(m.created_at).getTime() });
const toWallet = (w, purchases = []) => ({ day: w.day || today(), startersUsed: w.starters_used, extraStarters: w.extra_starters, boosts: w.boosts, plus: !!w.plus, purchases });

export class SupabaseAdapter {
  constructor(url, key) { this.url = url; this.key = key; this._c = null; }
  async _client() {
    if (!this._c) {
      const { createClient } = await import('@supabase/supabase-js');
      this._c = createClient(this.url, this.key, { auth: { persistSession: true, autoRefreshToken: true } });
    }
    return this._c;
  }
  _x({ data, error }) { if (error) throw error; return data; }
  async _uid() {
    const c = await this._client();
    let { data: { session } } = await c.auth.getSession();
    if (!session) session = this._x(await c.auth.signInAnonymously()).session; // requires Anonymous sign-ins enabled
    return session.user.id;
  }
  async reset() { console.warn('reset() is a no-op in Supabase mode'); }
  async getCurrentUserId() {
    const uid = await this._uid();
    // App treats "no profile" as onboarding; return uid regardless.
    return uid;
  }
  async setCurrentUserId() { console.warn('Switching users is dev-only (local mode). Sign out/in instead.'); }
  async signOut() { const c = await this._client(); await c.auth.signOut(); }
  async listProfiles() {
    const c = await this._client();
    const rows = this._x(await c.from('profiles').select('id,data,lat,lng').limit(1000));
    const acc = await this._accounts(rows.map(r => r.id));
    return rows.map(r => this._merge(r, acc));
  }
  async getProfile(id) {
    const c = await this._client();
    const r = this._x(await c.from('profiles').select('id,data,lat,lng').eq('id', id).maybeSingle());
    return r ? this._merge(r, await this._accounts([r.id])) : null;
  }
  // Linked accounts live in their own RLS-protected table; RLS only returns what the viewer may see.
  async _accounts(ids) {
    const c = await this._client(); if (!ids.length) return [];
    return this._x(await c.from('linked_accounts').select('*').in('user_id', ids));
  }
  _merge(r, acc) {
    const p = { ...r.data, id: r.id, lat: r.lat ?? r.data.lat, lng: r.lng ?? r.data.lng, gamertags: {}, socials: {}, reveal: {}, discordInvite: '' };
    for (const a of acc.filter(a => a.user_id === r.id)) {
      if (a.kind === 'discordInvite') { p.discordInvite = a.handle; p.reveal.discordInvite = a.reveal; }
      else { p[a.kind][a.platform] = a.handle; p.reveal[a.kind + '.' + a.platform] = a.reveal; }
    }
    return p;
  }
  async upsertProfile(p) {
    const c = await this._client(); const uid = await this._uid();
    const { gamertags = {}, socials = {}, discordInvite = '', reveal = {}, ...rest } = p;
    const row = { ...rest, id: uid };
    this._x(await c.from('profiles').upsert(guardOutgoing({ id: uid, data: row, lat: p.lat ?? null, lng: p.lng ?? null, city: p.city ?? null, region: p.region ?? null, country_code: p.countryCode ?? null, updated_at: new Date().toISOString() })));
    const accts = [];
    for (const kind of ['gamertags', 'socials']) for (const [platform, handle] of Object.entries(kind === 'gamertags' ? gamertags : socials)) if (handle) accts.push({ user_id: uid, kind, platform, handle, reveal: reveal[kind + '.' + platform] || 'match' });
    if (discordInvite) accts.push({ user_id: uid, kind: 'discordInvite', platform: 'Discord', handle: discordInvite, reveal: reveal.discordInvite || 'match' });
    this._x(await c.from('linked_accounts').delete().eq('user_id', uid));
    if (accts.length) this._x(await c.from('linked_accounts').insert(accts));
    return { ...row, gamertags, socials, discordInvite, reveal };
  }
  async listMessages() {
    const c = await this._client();
    return this._x(await c.rpc('inbox')).map(toMsg); // boosted+unread first
  }
  async getWallet() {
    const c = await this._client(); await this._uid();
    const w = this._x(await c.rpc('get_wallet'));
    const ps = this._x(await c.from('purchases').select('item,created_at,mock').order('created_at'));
    return toWallet(w, ps.map(p => ({ item: p.item, at: new Date(p.created_at).getTime(), mock: p.mock })));
  }
  async sendMessage(_from, to, text, { boost = false } = {}) {
    const c = await this._client(); await this._uid();
    const r = this._x(await c.rpc('send_message', { to_user: to, body: text, boost }));
    return r.ok ? { ok: true, msg: toMsg(r.msg), usedStarter: r.used_starter } : { ok: false, reason: r.reason };
  }
  async markRead(_uid, other) { const c = await this._client(); this._x(await c.rpc('mark_read', { other })); }
  async mockPurchase(_uid, item) { const c = await this._client(); this._x(await c.rpc('mock_purchase', { item })); return this.getWallet(); }
  // Live inbox: returns an unsubscribe function.
  async subscribe(onChange) {
    const c = await this._client(); const uid = await this._uid();
    const ch = c.channel('inbox:' + uid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `recipient=eq.${uid}` }, onChange)
      .subscribe();
    return () => c.removeChannel(ch);
  }
}
