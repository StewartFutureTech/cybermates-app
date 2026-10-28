// Data layer. All app code talks to `db` (async interface) so the backend is swappable.
// LocalAdapter = demo (localStorage, single browser). SupabaseAdapter = src/store.supabase.js (enabled by VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY).
import { makeSeed } from './data.js';
import { SupabaseAdapter } from './store.supabase.js';
import { SecureWallet, Twins } from './wallet.js';
import { WHILE_MS, DEFAULT as RET_DEFAULT, ttlMs as retTtl } from './retention.js';
export const DAILY_STARTERS = 5;
export const PLUS_DAILY_STARTERS = 15;
export const dailyLimit = w => w?.plus ? PLUS_DAILY_STARTERS : DAILY_STARTERS;
export const CHAT_TTL_MS = WHILE_MS; // v51: follows default retention bubble ('while' ≈ 30d), not a fixed 48h
export const VOICE_CAP_MS = 30 * 60 * 1000; // 'Grok voice setup' $4.99 one-time, 30-min cap (~$2.40 at ~$0.08/min)
export const CREDITS = { starters5: [5, 0], starters15: [15, 0], starters40: [40, 0], boost1: [0, 1], boost5: [0, 5], boost15: [0, 15] };
const K = 'cybermates:v2'; // v2: 3 modes, global locations, per-mode distance, privacy
const today = () => new Date().toISOString().slice(0, 10);

class LocalAdapter {
  _load() { try { return JSON.parse(localStorage.getItem(K)) || null; } catch { return null; } }
  _save(s) { localStorage.setItem(K, JSON.stringify(s)); }
  _s() { let s = this._load(); if (!s) { s = this._fresh(); this._save(s); } const cut = Date.now() - CHAT_TTL_MS, n = s.messages.length; s.messages = s.messages.filter(m => m.at > cut); if (s.messages.length !== n) this._save(s); return s; } // v51: cut by CHAT_TTL_MS (= while/DEFAULT retention window)
  _fresh() { return { profiles: makeSeed(), messages: [], currentUser: 'seed-26' }; }
  async reset() { this._save(this._fresh()); this.migrated = false; const s = this._s(); delete s.wallet; this._save(s); const st = this._w().store; st.commit(st.ver(), await this._w()._seal({ wallets: {} })); }
  async getCurrentUserId() { return this._s().currentUser; }
  async setCurrentUserId(id) { const s = this._s(); s.currentUser = id; this._save(s); }
  async listProfiles() { return this._s().profiles; }
  async getProfile(id) { return this._s().profiles.find(p => p.id === id) || null; }
  async upsertProfile(p) { const s = this._s(); const i = s.profiles.findIndex(x => x.id === p.id); i >= 0 ? s.profiles[i] = p : s.profiles.push(p); this._save(s); return p; }
  async listMessages(uid) { return this._s().messages.filter(m => m.from === uid || m.to === uid); }
  // Wallet counters live ONLY in the encrypted vault (src/wallet.js). Legacy plaintext s.wallet is migrated then deleted.
  _w() {
    if (!this.sw) { this.sw = new SecureWallet({ dailyLimit }); if (globalThis.BroadcastChannel && globalThis.document) { this.sw.twins = new Twins({ vault: this.sw.vault }); this.sw.twins.start().then(t => t.onCount = d => this.sw.onTwinUpdate(d.uid)).catch(() => {}); } }
    return this.sw;
  }
  async _migrate() {
    if (this.migrated) return; const s = this._s(); this.migrated = true;
    if (s.wallet && Object.keys(s.wallet).length) { for (const [uid, w] of Object.entries(s.wallet)) await this._w().credit(uid, x => Object.assign(x, w)); }
    if (s.wallet) { delete s.wallet; this._save(s); }
  }
  async getWallet(uid) { await this._migrate(); return this._w().raw(uid); } // in-memory copy (tests/adapters); UI uses getWalletView
  async getWalletView(uid) { await this._migrate(); return this._w().view(uid); }
  subscribeWallet(uid, fn) { return this._w().subscribe(uid, fn); }
  // Messages ALWAYS deliver. Starting a NEW conversation consumes a daily starter (or a purchased one); boost consumes a boost.
  // Spend is locked + CAS + re-read verified; on any failure nothing is sent.
  async sendMessage(from, to, text, { boost = false } = {}) {
    await this._migrate();
    const existing = this._s().messages.some(m => (m.from === from && m.to === to) || (m.from === to && m.to === from));
    const r = await this._w().spend(from, { starter: !existing, boost });
    if (!r.ok) return r;
    const s2 = this._s(), msg = { id: crypto.randomUUID?.() || String(Math.random()), from, to, text, boosted: boost, at: Date.now(), read: false };
    s2.messages.push(msg); this._save(s2);
    return { ok: true, msg, usedStarter: r.usedStarter };
  }
  async markRead(uid, other) { const s = this._s(); s.messages.forEach(m => { if (m.to === uid && m.from === other) m.read = true; }); this._save(s); }
  // MOCK purchase – no real payment. Replace with Stripe Checkout + webhook in production.
  async mockPurchase(uid, item) {
    await this._migrate(); let out;
    await this._w().credit(uid, w => {
    if (CREDITS[item]) { w.extraStarters += CREDITS[item][0]; w.boosts += CREDITS[item][1]; }
    if (item.startsWith('plus') && item !== 'plus_cancel' && !w.plus) { w.plus = item; w.boosts += 5; } // +5 boosts (first month)
    if (item === 'plus_cancel') w.plus = false;
    if (item === 'voice30') w.voiceReceipts = [...(w.voiceReceipts || []), { id: crypto.randomUUID?.() || String(Math.random()), capMs: VOICE_CAP_MS, usedMs: 0, mock: true }];
    w.purchases.push({ item, at: Date.now(), mock: true }); out = structuredClone(w); });
    return out;
  }
}

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
// Local-first: profiles, messages and wallet live ONLY on this device (LocalAdapter + encrypted vault).
// Supabase (if configured) is used only for ephemeral signaling/presence, signed control records and receipts.
export const BACKEND = env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY ? 'supabase' : 'local'; // signaling backend
export const signal = BACKEND === 'supabase' ? new SupabaseAdapter(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY) : null; // only ._client() is used
export const db = new LocalAdapter();
