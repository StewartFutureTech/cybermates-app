// SupabaseStore: central backend adapter. Same async method names as the local/mesh adapter (src/store.js LocalAdapter:
// getCurrentUserId/getProfile/upsertProfile/listProfiles/listMessages/sendMessage/markRead) plus the feature methods in
// ADAPTER_METHODS so features can swap backends. All authorization is server-side (RLS); this file never decides access.
import { unwrap } from './supabase-client.js';
import { MAX_PHOTOS } from './supabase-config.js';
export const ADAPTER_METHODS = [
  'getCurrentUserId', 'getProfile', 'upsertProfile', 'listProfiles', 'submitAgeCheck', 'setMood', 'acknowledge',
  'listInterests', 'setInterests', 'listFavoriteGames', 'setFavoriteGames', 'getMatchPrefs', 'setMatchPrefs', 'findMatches',
  'listPhotos', 'uploadPhoto', 'deletePhoto', 'photoUrl',
  'sendFriendRequest', 'respondFriendRequest', 'listFriendRequests', 'listFriends', 'unfriend',
  'getOrCreateConversation', 'listConversations', 'listMessages', 'sendMessage', 'markDelivered', 'markRead', 'boostBalance',
  'report', 'escalateReport', 'listMyReports', 'amModerator', 'modQueue', 'modClaim', 'modResolve', 'modActions', 'block', 'unblock', 'listBlocks', 'mute', 'unmute',
  'listLfg', 'postLfg', 'deleteLfg', 'listEvents', 'createEvent', 'joinEvent', 'leaveEvent',
  'getParentControls', 'setParentControls', 'clearParentControls', 'joinRoulette', 'leaveRoulette', 'deleteAccount',
];
const PROFILE_COLS = 'id,handle,display_name,bio,age_band,mood,mood_at,e2e_pubkey,ack_version,last_seen,created_at';
const toMsg = m => ({ id: m.id, conversationId: m.conversation_id, from: m.sender_id, to: m.recipient_id, body: m.body, nonce: m.nonce, boosted: m.boosted, status: m.status, read: m.status === 'read', at: Date.parse(m.created_at), expiresAt: Date.parse(m.expires_at) });

export class SupabaseStore {
  // sealer: optional boxSealer() from supabase-e2e.js; when present, text is sealed to the peer's e2e_pubkey.
  constructor(client, { sealer = null } = {}) { this.c = client; this.sealer = sealer; this.kind = 'supabase'; }
  from(t) { return this.c.from(t); }
  async uid() { const { data } = await this.c.auth.getSession(); const id = data?.session?.user?.id; if (!id) throw new Error('not signed in'); return id; }
  async getCurrentUserId() { try { return await this.uid(); } catch { return null; } }
  // ---- profile ----
  async getProfile(id) { id ||= await this.uid(); return unwrap(await this.from('profiles').select(PROFILE_COLS).eq('id', id).maybeSingle()); }
  async upsertProfile(p) { const me = await this.uid(); const row = { id: me }; for (const k of ['handle', 'display_name', 'bio', 'mood', 'e2e_pubkey']) if (k in p) row[k] = p[k]; return unwrap(await this.from('profiles').upsert(row, { onConflict: 'id' }).select(PROFILE_COLS).single()); }
  async listProfiles({ limit = 100 } = {}) { return unwrap(await this.from('profiles').select(PROFILE_COLS).order('last_seen', { ascending: false, nullsFirst: false }).limit(limit)); }
  async submitAgeCheck(birthdate) { return unwrap(await this.c.rpc('submit_age_check', { p_birthdate: birthdate })); } // returns 'adult'|'minor'; date not stored
  async setMood(mood) { return this.upsertProfile({ mood }); }
  async touch() { const me = await this.uid(); unwrap(await this.from('profiles').update({ last_seen: new Date().toISOString() }).eq('id', me)); }
  async acknowledge(version) { const me = await this.uid(); unwrap(await this.from('app_acknowledgements').upsert({ user_id: me, version }, { onConflict: 'user_id,version', ignoreDuplicates: true })); return version; }
  // ---- interests / games / prefs ----
  async listInterests(uid) { uid ||= await this.uid(); return unwrap(await this.from('interests').select('tag').eq('user_id', uid)).map(r => r.tag); }
  async setInterests(tags) { const me = await this.uid(); tags = [...new Set(tags)]; if (tags.length > 20) throw new Error('max 20 interests'); unwrap(await this.from('interests').delete().eq('user_id', me)); if (tags.length) unwrap(await this.from('interests').insert(tags.map(tag => ({ user_id: me, tag })))); return tags; }
  async listFavoriteGames(uid) { uid ||= await this.uid(); return unwrap(await this.from('favorite_games').select('game,rank').eq('user_id', uid).order('rank')); }
  async setFavoriteGames(games) { const me = await this.uid(); unwrap(await this.from('favorite_games').delete().eq('user_id', me)); if (games.length) unwrap(await this.from('favorite_games').insert(games.map((game, rank) => ({ user_id: me, game, rank })))); return games; }
  async getMatchPrefs() { const me = await this.uid(); return unwrap(await this.from('match_prefs').select('*').eq('user_id', me).maybeSingle()); }
  async setMatchPrefs(p) { const me = await this.uid(); return unwrap(await this.from('match_prefs').upsert({ ...p, user_id: me }, { onConflict: 'user_id' }).select().single()); }
  async findMatches(mode = 'friends', limit = 50) { return unwrap(await this.c.rpc('find_matches', { p_mode: mode, p_limit: limit })); }
  // ---- photos (bucket 'photos', path <uid>/<uuid>.<ext>, max 4) ----
  async listPhotos(uid) { uid ||= await this.uid(); return unwrap(await this.from('photos').select('id,path,position').eq('owner_id', uid).order('position')); }
  async uploadPhoto(file, { position = 0, contentType = file?.type || 'image/jpeg' } = {}) {
    const me = await this.uid(); if ((await this.listPhotos(me)).length >= MAX_PHOTOS) throw new Error(`max ${MAX_PHOTOS} photos`);
    const path = `${me}/${crypto.randomUUID()}.${contentType.split('/')[1] || 'jpg'}`;
    unwrap(await this.c.storage.from('photos').upload(path, file, { contentType, upsert: false }));
    try { return unwrap(await this.from('photos').insert({ owner_id: me, path, position }).select().single()); }
    catch (e) { await this.c.storage.from('photos').remove([path]); throw e; }
  }
  async deletePhoto(id) { const row = unwrap(await this.from('photos').delete().eq('id', id).select('path').single()); unwrap(await this.c.storage.from('photos').remove([row.path])); return true; }
  async photoUrl(path, ttl = 3600) { return unwrap(await this.c.storage.from('photos').createSignedUrl(path, ttl)).signedUrl; }
  // ---- friends ----
  async sendFriendRequest(to) { const me = await this.uid(); return unwrap(await this.from('friend_requests').insert({ from_id: me, to_id: to }).select().single()); }
  async respondFriendRequest(id, status) { return unwrap(await this.from('friend_requests').update({ status }).eq('id', id).select().single()); } // accepted|declined|cancelled
  async listFriendRequests() { return unwrap(await this.from('friend_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false })); }
  async listFriends() { const me = await this.uid(); return unwrap(await this.from('friendships').select('*')).map(f => f.user_a === me ? f.user_b : f.user_a); }
  async unfriend(other) { const me = await this.uid(); const [a, b] = [me, other].sort(); unwrap(await this.from('friendships').delete().eq('user_a', a).eq('user_b', b)); return true; }
  // ---- conversations + messages (7-day hold, delivery status, boosts) ----
  async getOrCreateConversation(other) {
    const me = await this.uid(); const [a, b] = [me, other].sort();
    const found = unwrap(await this.from('conversations').select('*').eq('user_a', a).eq('user_b', b).maybeSingle()); if (found) return found;
    const { data, error } = await this.from('conversations').insert({ user_a: a, user_b: b, created_by: me }).select().single();
    if (error?.code === '23505') return unwrap(await this.from('conversations').select('*').eq('user_a', a).eq('user_b', b).single());
    return unwrap({ data, error });
  }
  async listConversations() { return unwrap(await this.from('conversations').select('*').order('last_message_at', { ascending: false, nullsFirst: false })); }
  async listMessages(uidOrConv, { conversationId } = {}) {
    let q = this.from('messages').select('*').order('created_at'); if (conversationId) q = q.eq('conversation_id', conversationId);
    return Promise.all(unwrap(await q).map(m => this._open(toMsg(m))));
  }
  async _peerKey(id) { return (await this.getProfile(id))?.e2e_pubkey; }
  async _open(m) { if (!this.sealer || !m.nonce) return { ...m, text: m.body }; const me = await this.uid(); try { return { ...m, text: this.sealer.open(await this._peerKey(m.from === me ? m.to : m.from), m.body, m.nonce) }; } catch { return { ...m, text: null, undecryptable: true }; } }
  // LocalAdapter-compatible: sendMessage(from, to, text, {boost}) -> {ok, msg} | {ok:false, reason}
  async sendMessage(from, to, text, { boost = false } = {}) {
    try {
      const me = await this.uid(); if (from && from !== me) return { ok: false, reason: 'not-you' };
      const conv = await this.getOrCreateConversation(to);
      let body = text, nonce = null;
      if (this.sealer) { const pk = await this._peerKey(to); if (!pk) return { ok: false, reason: 'no-peer-key' }; ({ body, nonce } = this.sealer.seal(pk, text)); }
      const row = unwrap(await this.from('messages').insert({ conversation_id: conv.id, sender_id: me, body, nonce, boosted: boost }).select().single());
      return { ok: true, msg: { ...toMsg(row), text } };
    } catch (e) { return { ok: false, reason: /boost/.test(e.message) ? 'no-boosts' : (e.code === '42501' ? 'forbidden' : 'error'), error: e.message }; }
  }
  async _status(ids, status) { if (!ids.length) return []; return unwrap(await this.from('messages').update({ status }).in('id', ids).select('id,status')); }
  markDelivered(ids) { return this._status(ids, 'delivered'); }
  async markRead(uid, other) { const me = await this.uid(); const ids = unwrap(await this.from('messages').select('id').eq('recipient_id', me).eq('sender_id', other).neq('status', 'read')).map(r => r.id); return this._status(ids, 'read'); }
  async boostBalance() { return unwrap(await this.c.rpc('boost_balance')); }
  // ---- safety ----
  async report({ reported, reason, details = null, messageId = null, conversationId = null, evidence = null }) { const me = await this.uid(); return unwrap(await this.from('reports').insert({ reporter_id: me, reported_id: reported, reason, details, message_id: messageId, conversation_id: conversationId, evidence }).select('id,status,priority,escalation_level').single()); }
  async escalateReport(id, note) { return unwrap(await this.c.rpc('escalate_report', { p_report: id, p_note: note ?? null })); }
  async listMyReports() { return unwrap(await this.from('reports').select('id,reported_id,reason,status,priority,escalation_level,created_at').order('created_at', { ascending: false })); }
  // ---- v39 team review bucket (moderators only; the DB refuses everyone else with 42501 - see migration 20261027000007) ----
  async amModerator() { try { return unwrap(await this.c.rpc('am_moderator')) || null; } catch { return null; } } // 'reviewer'|'lead'|null
  async modQueue(bucket = 'serious', limit = 50) { return unwrap(await this.c.rpc('mod_queue', { p_bucket: bucket, p_limit: limit })) || []; }
  async modClaim(id) { return unwrap(await this.c.rpc('mod_claim', { p_report: id })); }
  async modResolve(id, status, note = null) { return unwrap(await this.c.rpc('mod_resolve', { p_report: id, p_status: status, p_note: note ?? null })); }
  async modActions(reportId) { return unwrap(await this.from('report_actions').select('id,report_id,moderator_id,action,from_status,to_status,note,at').eq('report_id', reportId).order('at')) || []; }
  async block(other) { const me = await this.uid(); unwrap(await this.from('blocks').upsert({ blocker_id: me, blocked_id: other }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true })); return true; }
  async unblock(other) { const me = await this.uid(); unwrap(await this.from('blocks').delete().eq('blocker_id', me).eq('blocked_id', other)); return true; }
  async listBlocks() { return unwrap(await this.from('blocks').select('blocked_id')).map(r => r.blocked_id); }
  async mute(other, until = null) { const me = await this.uid(); unwrap(await this.from('mutes').upsert({ muter_id: me, muted_id: other, until }, { onConflict: 'muter_id,muted_id' })); return true; }
  async unmute(other) { const me = await this.uid(); unwrap(await this.from('mutes').delete().eq('muter_id', me).eq('muted_id', other)); return true; }
  // ---- community ----
  async listLfg({ game } = {}) { let q = this.from('lfg_posts').select('*').order('created_at', { ascending: false }).limit(100); if (game) q = q.eq('game', game); return unwrap(await q); }
  async postLfg(p) { const me = await this.uid(); return unwrap(await this.from('lfg_posts').insert({ ...p, author_id: me }).select().single()); }
  async deleteLfg(id) { unwrap(await this.from('lfg_posts').delete().eq('id', id)); return true; }
  async listEvents() { return unwrap(await this.from('events').select('*, event_attendees(user_id)').gte('starts_at', new Date(Date.now() - 864e5).toISOString()).order('starts_at')); }
  async createEvent(e) { const me = await this.uid(); return unwrap(await this.from('events').insert({ ...e, host_id: me }).select().single()); }
  async joinEvent(id) { const me = await this.uid(); unwrap(await this.from('event_attendees').insert({ event_id: id, user_id: me })); return true; }
  async leaveEvent(id) { const me = await this.uid(); unwrap(await this.from('event_attendees').delete().eq('event_id', id).eq('user_id', me)); return true; }
  // ---- parent controls (code hashed server-side with bcrypt) ----
  async getParentControls() { return unwrap(await this.from('parent_controls').select('disabled_features,updated_at').maybeSingle()); }
  async setParentControls(code, disabled, oldCode = null) { return unwrap(await this.c.rpc('set_parent_controls', { p_code: code, p_disabled: disabled, p_old_code: oldCode })); }
  async clearParentControls(code) { return unwrap(await this.c.rpc('clear_parent_controls', { p_code: code })); }
  // ---- roulette (adults only, enforced by RLS) ----
  async joinRoulette(mode = 'roulette') { const me = await this.uid(); unwrap(await this.from('roulette_queue').upsert({ user_id: me, mode }, { onConflict: 'user_id', ignoreDuplicates: true })); return true; }
  async leaveRoulette() { const me = await this.uid(); unwrap(await this.from('roulette_queue').delete().eq('user_id', me)); return true; }
  // ---- account ----
  async deleteAccount() { const me = await this.uid(); const ps = await this.listPhotos(me).catch(() => []); if (ps.length) await this.c.storage.from('photos').remove(ps.map(p => p.path)); unwrap(await this.c.rpc('delete_my_account')); await this.c.auth.signOut().catch(() => {}); return true; }
}
