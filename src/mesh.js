// Social mesh layer (items 4–8): presence-gated starters, ephemeral chat, burn mode, signed friend profiles,
// 50-profile gossip cache with recency buckets, block list keyed on stable user code.
// Transport-agnostic: `net.send(envelope)` floods to peers (Supabase broadcast / WebRTC data channels); call node.receive(env) on arrival.
import nacl from 'tweetnacl';
import { b64, unb64, rand } from './vault.js';
export const STARTER_MAX = 500, CACHE_MAX = 50, ONLINE_MS = 5 * 60e3, DROP_MS = 2 * 864e5, ACK_TIMEOUT_MS = 8000;
export const PLAN_TTL_MS = 48 * 3600e3, THUMB_MAX = 4096;
export const OFFLINE_MSG = 'Offline, try later', BLOCKED_MSG = "You've been blocked", LOGGED_OFF_MSG = 'They logged off to mesh'; // UX §9: failed delivery notice
const stable = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : 1)) : x);
const msgBytes = o => new TextEncoder().encode(stable(o));
export const newSigningKeys = () => { const k = nacl.sign.keyPair(); return { pub: b64(k.publicKey), sec: b64(k.secretKey) }; };
export const signProfile = (code, rev, profile, sec) => ({ code, rev, profile, sig: b64(nacl.sign.detached(msgBytes({ code, rev, profile }), unb64(sec))) });
// Every ping floods the mesh and each receiver re-verifies the same signed stub + profile (pure-JS ed25519, ~ms each),
// which made a few-hop exchange take hundreds of ms. Remember signatures that already verified (exact pub+sig+message
// key; only successes are cached, bounded), so a re-flooded identical profile costs a string compare, not a verify.
const VERIFIED = new Map(), VERIFIED_MAX = 2000;
export const verifyProfile = (sp, pub) => { try { const m = stable({ code: sp.code, rev: sp.rev, profile: sp.profile }), key = pub + '|' + sp.sig + '|' + m;
  if (VERIFIED.has(key)) return true;
  const okv = nacl.sign.detached.verify(new TextEncoder().encode(m), unb64(sp.sig), unb64(pub));
  if (okv) { if (VERIFIED.size >= VERIFIED_MAX) VERIFIED.delete(VERIFIED.keys().next().value); VERIFIED.set(key, true); } return okv; } catch { return false; } };
export function recency(lastSeen, now = Date.now()) {
  const d = now - lastSeen;
  if (d > DROP_MS) return null; if (d <= ONLINE_MS) return 'online';
  if (d <= 2 * 3600e3) return 'offline ~2h'; if (d <= 4 * 3600e3) return 'offline ~4h'; return 'offline ~6h+';
}
export function validateStarter(text, att) {
  if (typeof text !== 'string' || !text.trim()) return 'text-required';
  if (text.length > STARTER_MAX) return 'too-long';
  if (att) return 'no-attachments-until-friends';
  return null;
}
// Presence-first: a STUB {name, thumb} is all that survives a peer going offline. thumb = tiny (<=48px) pixelated JPEG data URL made by the owner.
export const makeStub = p => ({ name: String(p?.name || '').slice(0, 40), thumb: p?.thumb || '' });
export const validStub = s => s && typeof s.name === 'string' && Object.keys(s).every(k => k === 'name' || k === 'thumb') && (!s.thumb || (/^data:image\/jpeg;base64,/.test(s.thumb) && s.thumb.length <= THUMB_MAX));
// ACCEPT BEFORE ANY MESSAGE (David, 2026-10-20): from a sender we have NOT accepted (not a mutual friend) the receiving
// phone drops EVERYTHING except presence/control and a bare connection request. A request carries {pub, boost?} only:
// no text, no media. Requests are free; a paid boost only highlights the request. The 500-char paid starter is RETIRED.
export const STRANGER_OK = new Set(['ping', 'gossip', 'bye', 'freq', 'fok', 'blocked', 'ack', 'rcpt', 'disc', 'disc-ans', 'undeliv', 'arc', 'vrtc', 'lm']); // lm: living-mesh soft-tag presence / tentacles / search / tap-to-open (gated inside src/livemesh.js) // arc + vrtc: game rooms / game voice with strangers (receiver-gated: band, block, ban, voice toggle)
export const REQ_MODES = ['friends', 'gaming', 'dating'];
export const bareRequest = b => b && typeof b === 'object' && Object.keys(b).every(k => k === 'pub' || k === 'boost' || k === 'mode') && typeof b.pub === 'string' && (b.boost === undefined || typeof b.boost === 'boolean') && (b.mode === undefined || REQ_MODES.includes(b.mode));
export const RCPT_TIMEOUT_MS = 8000;
export const rcptBytes = (ref, from, to) => msgBytes({ rcpt: ref, from, to });
export const signRcpt = (ref, from, to, sec) => b64(nacl.sign.detached(rcptBytes(ref, from, to), unb64(sec)));
export const verifyRcpt = (r, pub) => { try { return nacl.sign.detached.verify(rcptBytes(r.ref, r.from, r.to), unb64(r.sig), unb64(pub)); } catch { return false; } };
export class MeshNode {
  constructor({ code, keys = newSigningKeys(), net, wallet, profile = {}, now = () => Date.now(), isOnline, onEvent = () => {}, twin = null, instance = b64(rand(6)) }) {
    Object.assign(this, { code, keys, net, wallet, now, onEvent, twin, instance }); this.twinInstances = new Set();
    this.isOnline = isOnline || (c => (now() - (this.presence.get(c) || 0)) <= ONLINE_MS);
    this.presence = new Map(); this.blocked = new Set(); this.friends = new Map(); // code -> {pub, profile:signed}
    this.outq = []; this.relayq = []; // queued outbound / relay items {to, env, queuedAt} (dropped by the 24h sweep, src/sweep.js)
    this.pendingOut = new Set(); this.pendingIn = new Map(); this.cache = new Map(); // code -> {sp(stub), pub, lastSeen}
    this.live = new Map(); // code -> signed FULL profile, memory only, only while that peer is online
    this.chats = new Map(); this.inbox = []; this.seen = new Set(); this.waiters = new Map();
    this.rev = 0; this._sign(profile);
  }
  _sign(profile) { this.myProfile = signProfile(this.code, this.rev, profile, this.keys.sec); this.myStub = signProfile(this.code, this.rev, makeStub(profile), this.keys.sec); }
  send(to, type, body = {}, id = b64(rand(9))) { this.seen.add(id); this.net.send({ id, from: this.code, to, ttl: 6, type, body }); return id; }
  ping() { this.send('*', 'ping', { stub: this.myStub, sp: this.myProfile, pub: this.keys.pub, twin: this.twin, instance: this.instance }); }
  receive(env) {
    if (!env || this.seen.has(env.id)) return; this.seen.add(env.id);
    if (env.to !== this.code && env.to !== '*') { if (env.ttl > 1) this.net.forward?.({ ...env, ttl: env.ttl - 1 }, this); return; } // relay; content opaque to us
    if (env.to === '*' && env.ttl > 1) this.net.forward?.({ ...env, ttl: env.ttl - 1 }, this);
    { const was = this.isOnline(env.from); this.presence.set(env.from, this.now()); if (!was && this.outbox?.for(env.from).length) queueMicrotask(() => this.flushPending(env.from)); } // retry held items when they show up again
    if (this.blocked.has(env.from)) { if (env.type === 'starter' || env.type === 'chat' || env.type === 'freq') this.send(env.from, 'blocked', { ref: env.id }); return; } // drop at destination (no receipt => boost refund)
    if (!this.friends.has(env.from) && env.from !== this.code && (!STRANGER_OK.has(env.type) || (env.type === 'freq' && !bareRequest(env.body)))) { this.dropped = (this.dropped || 0) + 1; this.onEvent('dropped-unaccepted', env.from, env.type); return; } // accept before any message
    (this['on_' + env.type] || (() => {})).call(this, env.from, env.body, env);
  }
  // ---- 4. starters ----
  async sendStarter(to, text, { attachment } = {}) { // RETIRED: strangers only get a bare connection request (requestFriend)
    if (this.friends.has(to)) return this.sendChat(to, text, { attachment });
    return { ok: false, reason: 'retired', message: 'Send a connection request first. Messages open once they accept.' };
    const bad = validateStarter(text, attachment); if (bad) return { ok: false, reason: bad };
    if (!this.isOnline(to)) return { ok: false, reason: 'offline', message: OFFLINE_MSG }; // no starter consumed
    if (!(await this.wallet.consume())) return { ok: false, reason: 'no-starters' };
    const id = this.send(to, 'starter', { text });
    const r = await new Promise(res => { const t = setTimeout(() => res({ type: 'timeout' }), ACK_TIMEOUT_MS); this.waiters.set(id, x => { clearTimeout(t); res(x); }); });
    this.waiters.delete(id);
    if (r.type === 'ack') { this.chat(to).msgs.push({ from: this.code, text, at: this.now() }); return { ok: true }; }
    await this.wallet.refund();
    return r.type === 'blocked' ? { ok: false, reason: 'blocked', message: BLOCKED_MSG, refunded: true } : { ok: false, reason: 'undelivered', message: LOGGED_OFF_MSG, refunded: true };
  }
  on_starter() {} // retired (accept before any message)
  on_ack(f, b) { this.waiters.get(b.ref)?.({ type: 'ack' }); }
  on_blocked(f, b) { this.waiters.get(b.ref)?.({ type: 'blocked' }); this.onEvent('blocked-by', f); }
  // ---- 5. chat (ephemeral; optional encrypted save; burn by mutual agreement) ----
  chat(peer) { if (!this.chats.has(peer)) this.chats.set(peer, { msgs: [], save: false, burn: { mine: 0, theirs: 0 } }); return this.chats.get(peer); }
  burnActive(peer) { const b = this.chat(peer).burn; return b.mine > 0 && b.theirs > 0 ? Math.min(b.mine, b.theirs) : 0; }
  sendChat(to, text, { attachment, boost = false } = {}) {
    if (!this.friends.has(to)) return { ok: false, reason: 'not-accepted', message: 'They need to accept your connection request first.' };
    if (attachment && !this.friends.has(to)) return { ok: false, reason: 'no-attachments-until-friends' };
    const burn = this.burnActive(to), id = b64(rand(9)), m = { from: this.code, text, attachment, at: this.now(), burn };
    const local = { ...m, id, state: 'pending' }; // no ✓ until the recipient's signed receipt comes back
    if (!this.isOnline(to)) { if (!this.outbox?.add({ id, to, type: 'chat', body: m })) return { ok: false, reason: 'offline', message: OFFLINE_MSG }; this.chat(to).msgs.push(local); return { ok: true, pending: true }; }
    this.outbox?.add({ id, to, type: 'chat', body: m, boost: !!boost }); this.send(to, 'chat', m, id); this.chat(to).msgs.push(local); this.keep(to, local); this._sendCheck(id, to, !!boost); return { ok: true, id };
  }
  // UX §9 SEND CHECK: every message sent to an online peer must get its signed receipt within RCPT_TIMEOUT_MS. If it does not
  // AND the peer has dropped off presence, the send failed: it is pulled from the outbox (so it can never show up in their box
  // later), marked failed locally with "They logged off to mesh", and any boost on it is refunded. If they are still online
  // (slow relay) it stays in the normal 7-day hold.
  _sendCheck(id, to, boost) { const ms = this.sendCheckMs ?? RCPT_TIMEOUT_MS; const t = setTimeout(async () => { this.waiters.delete(id); if (!this.outbox?.has(id) && this.outbox) return; // receipt arrived
      const msg = this.chats.get(to)?.msgs.find(x => x.id === id); if (msg?.state === 'delivered' || this.isOnline(to)) return;
      this.outbox?.done(id); if (msg) { msg.state = 'failed'; msg.notice = LOGGED_OFF_MSG; }
      let refunded = false; if (boost) { const c = this.refunds ? await this.refunds.claim({ msgId: id, from: this.code, to }).catch(() => ({ ok: false })) : { ok: (await this.wallet?.refund?.({ boost: true })) !== false }; refunded = !!c.ok; if (msg) msg.refunded = refunded; }
      this.onEvent('undelivered', to, { id, message: LOGGED_OFF_MSG, refunded }); }, ms); t?.unref?.(); }
  on_chat(from, m, env) { if (!this.friends.has(from)) return; if (env?.id) this.send(from, 'rcpt', { ref: env.id, sig: signRcpt(env.id, from, this.code, this.keys.sec), pub: this.keys.pub }); if (env?.id && this.chats.get(from)?.msgs.some(x => x.rid === env.id)) return; m = { ...m, rid: env?.id }; this.chat(from).msgs.push({ ...m, from }); this.keep(from, { ...m, from }); this.onEvent('chat', from); }
  // 7-day safety copy (kept inside the encrypted vault, wiped by the sweep) so 'Hide instantly' chats can still be reported
  keep(peer, m) { Promise.resolve(this.safety?.add(peer, { from: m.from, text: m.text, at: m.at || this.now() })).catch(() => {}); }
  // retention choice: each side says what it wants; effective() applies only when both agree (minors: always kept)
  setRetention(peer, opt) { if (!this.friends.has(peer)) return false; this.chat(peer).ret = { ...(this.chat(peer).ret || {}), mine: opt }; this.send(peer, 'ret', { opt }); return true; }
  on_ret(from, b) { if (!this.friends.has(from) || !['forever', 'while', 'instant'].includes(b?.opt)) return; this.chat(from).ret = { ...(this.chat(from).ret || {}), theirs: b.opt }; this.onEvent('ret', from); }
  proposeBurn(peer, ttlMs = 60e3) { this.chat(peer).burn.mine = ttlMs; this.send(peer, 'burn', { ttlMs }); }
  on_burn(from, b) { this.chat(from).burn.theirs = b.ttlMs; this.onEvent('burn-proposed', from, b.ttlMs); }
  stopBurn(peer) { this.chat(peer).burn.mine = 0; this.send(peer, 'burn', { ttlMs: 0 }); }
  markRead(peer) { const c = this.chat(peer); for (const m of c.msgs) if (m.burn && !m.readAt) m.readAt = this.now(); this.sweep(); }
  sweep() { const n = this.now(); for (const c of this.chats.values()) c.msgs = c.msgs.filter(m => !m.burn || !(m.readAt || m.from === this.code) || n - (m.readAt || m.at) < m.burn); }
  // ---- 6. friends (mutual) + signed profile sync ----
  // Free connection request. boost:true spends 1 boost (highlight). The boost is refunded when NO signed delivery receipt
  // from the recipient arrives within RCPT_TIMEOUT_MS (refund verified server-side & idempotent per message id: api/_fn/refund.js).
  async requestFriend(to, { boost = false, mode } = {}) {
    if (mode === 'dating' && this.minor) return { ok: false, reason: 'minor-no-dating' }; // under 18: no dating requests, ever
    const recent = this.outbox && (this.cache.has(to) || this.recent?.has?.(to));
    if (!this.isOnline(to) && !recent) return { ok: false, reason: 'offline', message: OFFLINE_MSG }; // unknown / long gone: nothing held
    if (boost && !(await this.wallet?.consume?.({ boost: true }))) return { ok: false, reason: 'no-boosts' };
    if (!this.isOnline(to)) { const id = b64(rand(9)), body = { pub: this.keys.pub, ...(boost ? { boost: true } : {}), ...(REQ_MODES.includes(mode) ? { mode } : {}) }; this.pendingOut.add(to); if (boost) await this.refunds?.register?.({ msgId: id, from: this.code, to });
      if (!this.outbox.add({ id, to, type: 'freq', body, boost })) { if (boost) await this.wallet?.refund?.({ boost: true }); return { ok: false, reason: 'queue-full' }; }
      return { ok: false, pending: true, reason: 'pending', message: 'They are offline. Your request is pending and will be delivered when they are back (up to 7 days).' }; }
    this.pendingOut.add(to); const body = { pub: this.keys.pub, ...(boost ? { boost: true } : {}), ...(REQ_MODES.includes(mode) ? { mode } : {}) }; if (body.mode) this.chat(to).mode ||= body.mode; const id = this.send(to, 'freq', body);
    if (boost) await this.refunds?.register?.({ msgId: id, from: this.code, to });
    const r = await new Promise(res => { const t = setTimeout(() => res({ type: 'timeout' }), RCPT_TIMEOUT_MS); this.waiters.set(id, x => { clearTimeout(t); res(x); }); }); this.waiters.delete(id);
    if (r.type === 'rcpt') return { ok: true, delivered: true, boosted: boost };
    let refunded = false; if (boost) { const c = this.refunds ? await this.refunds.claim({ msgId: id, from: this.code, to }).catch(() => ({ ok: false })) : { ok: (await this.wallet?.refund?.({ boost: true })) !== false }; refunded = !!c.ok; }
    return { ok: false, reason: r.type === 'blocked' ? 'blocked' : r.type === 'undeliv' ? 'undelivered' : 'no-receipt', message: r.type === 'blocked' ? BLOCKED_MSG : LOGGED_OFF_MSG, refunded };
  }
  on_rcpt(from, b) { const pub = this.cache.get(from)?.pub || this.friends.get(from)?.pub || b.pub; if (!pub || !verifyRcpt({ ref: b.ref, sig: b.sig, from: this.code, to: from }, pub)) return;
    this.waiters.get(b.ref)?.({ type: 'rcpt' }); this.outbox?.done(b.ref); const m = this.chats.get(from)?.msgs.find(x => x.id === b.ref); if (m) { m.state = 'delivered'; this.onEvent('delivered', from); } }
  // resend held items (same message id, so the receiver de-duplicates) once the recipient is online again
  flushPending(to) { if (!this.isOnline(to)) return 0; let n = 0; for (const it of this.outbox?.for(to) || []) { it.tries++; this.seen.delete(it.id); this.send(to, it.type, it.body, it.id); n++; } return n; }
  // 7-day window: drop silently; boosted items that never got a signed receipt are refunded (server-verified path)
  async expirePending() { const gone = this.outbox?.expire() || []; for (const it of gone) { if (it.type === 'freq') this.pendingOut.delete(it.to); const m = this.chats.get(it.to)?.msgs; if (m) { const i = m.findIndex(x => x.id === it.id); if (i >= 0) m.splice(i, 1); }
      if (it.boost) { if (this.refunds) await this.refunds.claim({ msgId: it.id, from: this.code, to: it.to }).catch(() => {}); else await this.wallet?.refund?.({ boost: true }); } } return gone.length; }
  on_undeliv(f, b) { this.waiters.get(b.ref)?.({ type: 'undeliv' }); }
  on_freq(from, b, env) { if (!bareRequest(b)) return; if (b.mode === 'dating' && this.minor) return; // minors never receive dating requests // signed delivery receipt (proves delivery; no receipt => refund)
    if (env?.id) { const sig = signRcpt(env.id, from, this.code, this.keys.sec); this.send(from, 'rcpt', { ref: env.id, sig, pub: this.keys.pub }); this.refunds?.receipt?.({ msgId: env.id, from, to: this.code, sig, pub: this.keys.pub }); }
    if (this.pendingOut.has(from)) return this.acceptFriend(from, b.pub); this.pendingIn.set(from, b.pub); (this.boosted ||= new Set())[b.boost ? 'add' : 'delete'](from); (this.reqAt ||= new Map()).set(from, this.now()); if (b.mode) this.chat(from).mode ||= b.mode; this.onEvent('friend-request', from); }
  declineFriend(from) { this.pendingIn.delete(from); this.boosted?.delete(from); }
  acceptFriend(from, pub = this.pendingIn.get(from)) { if (!pub) return false; this.boosted?.delete(from); this.pendingIn.delete(from); this.pendingOut.delete(from); this.friends.set(from, { pub, stub: null }); this.send(from, 'fok', { pub: this.keys.pub, sp: this.myProfile, stub: this.myStub }); return true; }
  on_fok(from, b) {
    if (this.pendingOut.has(from)) { this.pendingOut.delete(from); this.friends.set(from, { pub: b.pub, stub: null }); this.send(from, 'fok', { pub: this.keys.pub, sp: this.myProfile, stub: this.myStub }); }
    if (this.friends.has(from)) this.on_profile(from, { sp: b.sp, stub: b.stub });
  }
  updateProfile(profile) { this.rev++; this._sign(profile); for (const f of this.friends.keys()) this.send(f, 'profile', { sp: this.myProfile, stub: this.myStub }); }
  on_profile(from, { sp, stub }) { // friends: keep signed STUB persistently; full profile only in memory while online
    const f = this.friends.get(from); if (!f || !sp || sp.code !== from) return;
    if (!verifyProfile(sp, f.pub) || (stub && (!verifyProfile(stub, f.pub) || !validStub(stub.profile)))) return this.onEvent('bad-signature', from);
    if (stub && (!f.stub || stub.rev >= f.stub.rev)) f.stub = stub;
    if (this.live.get(from)?.rev > sp.rev) return; this.live.set(from, sp); this.onEvent('profile', from, sp.rev);
  }
  // What the UI may show: full profile only while online; otherwise stub (name, thumb, code, last-seen bucket) and nothing else.
  view(code) {
    this.purgeOffline();
    const full = this.live.get(code), last = this.presence.get(code) || this.cache.get(code)?.lastSeen || 0;
    if (full && this.isOnline(code)) return { full: true, code, status: 'online', profile: full.profile };
    const st = this.friends.get(code)?.stub || this.cache.get(code)?.sp; if (!st) return null;
    return { full: false, code, name: st.profile.name, thumb: st.profile.thumb, status: recency(last, this.now()) || 'offline' };
  }
  purgeOffline() { for (const c of [...this.live.keys()]) if (!this.isOnline(c)) this.live.delete(c); }
  // Only this is ever persisted (into the encrypted vault): friend relationship + pubkey + stub; cached stubs.
  persistable() { return { friends: Object.fromEntries([...this.friends].map(([c, f]) => [c, { pub: f.pub, stub: f.stub }])), stubs: [...this.cache.values()] }; }
  // 'Plans' note: short-lived note kept outside the chat (TTL = PLAN_TTL_MS; never promised to users as a fixed time).
  async setPlan(peer, text, vault, ttlMs = PLAN_TTL_MS) { await vault.use(p => { p.plans ||= {}; if (text) p.plans[peer] = { text: String(text).slice(0, 280), expires: this.now() + ttlMs }; else delete p.plans[peer]; delete p.savedChats; }); }
  async getPlans(vault) { return vault.use(p => { const n = this.now(); for (const [k, v] of Object.entries(p.plans || {})) if (v.expires <= n) delete p.plans[k]; return { ...(p.plans || {}) }; }); }
  unfriend(code) { this.friends.delete(code); }
  // ---- 7. profile cache + gossip ----
  on_ping(from, b) { if (from === this.code) { if (this.twin && b.twin === this.twin && b.instance !== this.instance) this.twinInstances.add(b.instance); return; } this.ingest([{ sp: b.stub, pub: b.pub, lastSeen: this.now() }]); this._live(from, b.sp, b.pub); }
  _live(from, sp, pub) { const pin = this.friends.get(from)?.pub || this.cache.get(from)?.pub; if (sp?.code === from && pub === pin && verifyProfile(sp, pub) && (!this.live.get(from) || this.live.get(from).rev <= sp.rev)) this.live.set(from, sp); }
  ingest(entries) {
    for (const e of entries || []) {
      if (!e?.sp?.code || e.sp.code === this.code || this.blocked.has(e.sp.code) || !validStub(e.sp.profile) || !verifyProfile(e.sp, e.pub)) continue; // stubs only
      const bk = this.keyOf?.(e.sp.code); if (bk && bk !== e.pub) continue; // v43: gossiped stub must use the ID's bound key (src/idbind.js)
      const cur = this.cache.get(e.sp.code); if (cur && cur.pub !== e.pub) continue; // TOFU pin
      if (cur && cur.lastSeen >= e.lastSeen && cur.sp.rev >= e.sp.rev) continue;
      this.cache.set(e.sp.code, { sp: e.sp, pub: e.pub, lastSeen: Math.max(e.lastSeen, cur?.lastSeen || 0) });
    }
    this.prune();
  }
  prune() {
    this.purgeOffline(); for (const [k, v] of this.cache) if (!recency(v.lastSeen, this.now())) this.cache.delete(k);
    while (this.cache.size > CACHE_MAX) { const ks = [...this.cache.keys()]; this.cache.delete(ks[rand(4).reduce((a, x) => a * 256 + x, 0) % ks.length]); }
  }
  gossip(n = 10) { const all = [...this.cache.values()].sort(() => rand(1)[0] - 128).slice(0, n); this.send('*', 'gossip', { entries: [...all, { sp: this.myStub, pub: this.keys.pub, lastSeen: this.now() }] }); }
  on_gossip(from, b) { this.ingest(b.entries); }
  listCache() { return [...this.cache.values()].map(v => ({ code: v.sp.code, profile: v.sp.profile, status: recency(v.lastSeen, this.now()) })).filter(x => x.status); }
  bye() { this.send('*', 'bye', {}); }
  on_bye(from) { this.presence.delete(from); this.live.delete(from); const c = this.cache.get(from); if (c) c.lastSeen = this.now() - ONLINE_MS - 1; this.onEvent('bye', from); }
  // ---- 8. block (by stable user code) ----
  block(code) { this.blocked.add(code); this.friends.delete(code); this.cache.delete(code); this.chats.delete(code); }
  unblock(code) { this.blocked.delete(code); }
}
// In-memory flooding mesh for tests / local demo. Nodes only see envelopes; relays can't read E2E content
// in production (data channels are DTLS; relay-broadcast payloads should be sealed per-recipient — gap, see README).
export class SimMesh {
  constructor() { this.nodes = new Map(); this.links = new Map(); this.queue = Promise.resolve(); }
  add(node, links = []) { this.nodes.set(node.code, node); this.links.set(node.code, new Set(links)); for (const l of links) this.links.get(l)?.add(node.code); node.net = { send: e => this.emit(node, e), forward: (e, n) => this.emit(n, e) }; return node; }
  emit(from, env) { for (const c of this.links.get(from.code) || []) { const n = this.nodes.get(c); if (n && !n.offline) queueMicrotask(() => n.receive(env)); } }
}
