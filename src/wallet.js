// Secure wallet (follow-up items 1–5). Counters live ONLY inside an encrypted vault blob; plaintext exists in memory
// only during a locked spend. UI gets a sanitized display copy via subscribe().
// Concurrency: Web Locks ('cm-wallet') across tabs/instances when available, PLUS optimistic compare-and-swap on a
// version counter (every commit carries the expected version and fails if it changed) — so it is safe even without locks.
// Local-first: this vault is the ONLY wallet. It is credited only by redeeming server-signed receipts (each receipt id once per device).
import { Vault, MemorySecretStore, IdbSecretStore, seal, open, gcm, ungcm, b64 } from './vault.js';
export const LOCK_NAME = 'cm-wallet', MAX_RETRIES = 8;
const enc = new TextEncoder(), dec = new TextDecoder();
const today = () => new Date().toISOString().slice(0, 10);
export const blankWallet = old => ({ day: today(), startersUsed: 0, extraStarters: old?.extraStarters || 0, boosts: old?.boosts || 0, plus: old?.plus || false, purchases: old?.purchases || [], voiceReceipts: old?.voiceReceipts || [], redeemed: old?.redeemed || [] });
// Sanitized display value (no purchases/receipts; numbers only). The UI can't write it back.
export const display = (w, dailyLimit) => Object.freeze({ startersLeft: Math.max(0, dailyLimit(w) - w.startersUsed), dailyLimit: dailyLimit(w), extraStarters: w.extraStarters, boosts: w.boosts, plus: !!w.plus, voiceMinutesLeft: Math.floor((w.voiceReceipts || []).reduce((a, r) => a + Math.max(0, r.capMs - r.usedMs), 0) / 60000) });

// Synchronous CAS storage (localStorage on web; in-memory map in tests).
export function casStore(ls = globalThis.localStorage, key = 'cybermates:wallet') {
  return {
    ver: () => +(ls.getItem(key + ':ver') || 0),
    blob: () => { try { return JSON.parse(ls.getItem(key + ':blob')); } catch { return null; } },
    commit(expected, blob) { if (this.ver() !== expected) return false; ls.setItem(key + ':blob', JSON.stringify(blob)); ls.setItem(key + ':ver', String(expected + 1)); return true; }, // sync => atomic within an event-loop turn
  };
}
const defaultLocks = () => globalThis.navigator?.locks;
export async function withLock(fn, locks = defaultLocks()) { return locks?.request ? locks.request(LOCK_NAME, { mode: 'exclusive' }, fn) : fn(); }

export class SecureWallet {
  constructor({ vault, store = casStore(), locks = defaultLocks(), dailyLimit = w => w?.plus ? 15 : 5, twins = null, faults = {} } = {}) {
    this.vault = vault || new Vault({ store: globalThis.indexedDB ? new IdbSecretStore() : new MemorySecretStore() });
    Object.assign(this, { store, locks, dailyLimit, twins, faults }); this.subs = new Set();
  }
  async _read() { const b = this.store.blob(); return b ? open(await this.vault.key(b.kdf), b) : { wallets: {} }; }
  async _seal(obj) { return seal(await this.vault.key(2), obj); }
  // Core transaction: decrypt -> mutate -> re-encrypt -> CAS commit -> re-read & verify -> rollback on mismatch.
  async tx(uid, mutate, verify) {
    return withLock(async () => {
      for (let i = 0; i < MAX_RETRIES; i++) {
        const ver = this.store.ver(), oldBlob = this.store.blob();
        let obj = await this._read(); obj.wallets ||= {};
        let w = obj.wallets[uid]; if (!w || w.day !== today()) w = blankWallet(w);
        const before = structuredClone(w), r = mutate(w);
        if (!r.ok) { obj = w = null; return r; }
        obj.wallets[uid] = w; if (this.faults.beforeCommit) await this.faults.beforeCommit(w);
        const nb = await this._seal(obj); obj = null;
        if (!this.store.commit(ver, nb)) continue; // someone else spent first: retry with fresh state
        if (this.faults.afterCommit) await this.faults.afterCommit(this.store);
        const check = (await this._read()).wallets?.[uid];
        if (!check || (verify && !verify(before, check))) { // re-read mismatch => roll back, abort
          this.store.commit(this.store.ver(), oldBlob ?? await this._seal({ wallets: {} }));
          return { ok: false, reason: 'verify-failed' };
        }
        this._publish(uid, check); w = null;
        return { ...r, ok: true };
      }
      return { ok: false, reason: 'contention' };
    }, this.locks);
  }
  // Spend for a message: optional new-conversation starter + optional boost. Both or nothing.
  spend(uid, { starter = false, boost = false } = {}) {
    let kind = null;
    return this.tx(uid, w => {
      if (starter) { if (w.startersUsed < this.dailyLimit(w)) { w.startersUsed++; kind = 'daily'; } else if (w.extraStarters >= 1) { w.extraStarters--; kind = 'extra'; } else return { ok: false, reason: 'no-starters' }; }
      if (boost) { if (!(w.boosts >= 1)) return { ok: false, reason: 'no-boosts' }; w.boosts--; }
      return { ok: true, usedStarter: !!kind };
    }, (b, a) => (!boost || a.boosts === b.boosts - 1) && (!starter || (kind === 'daily' ? a.startersUsed === b.startersUsed + 1 : a.extraStarters === b.extraStarters - 1)));
  }
  refund(uid, { starter = false, boost = false } = {}) { return this.tx(uid, w => { if (starter) { if (w.startersUsed > 0) w.startersUsed--; else w.extraStarters++; } if (boost) w.boosts++; return { ok: true }; }); }
  credit(uid, fn) { return this.tx(uid, w => { fn(w); return { ok: true }; }); }
  async view(uid) { let obj = await this._read(); const w = obj.wallets?.[uid]; obj = null; return display(!w || w.day !== today() ? blankWallet(w) : w, this.dailyLimit); }
  async raw(uid) { const obj = await this._read(); const w = obj.wallets?.[uid]; return !w || w.day !== today() ? blankWallet(w) : w; } // in-memory copy for adapters; don't persist
  // Redeem a server-signed purchase receipt (Stripe webhook -> api/entitlement). Verified, bound to userCode, once per device.
  async redeem(uid, receipt, { userCode, pub } = {}) {
    const { verifyReceipt } = await import('./entitlements.js');
    if (!verifyReceipt(receipt, pub) || receipt.user_code !== userCode) return { ok: false, reason: 'bad-receipt' };
    if (receipt.status !== 'paid') return { ok: false, reason: 'not-consumable' }; // subscriptions are checked via activeFeatures, not credited
    return this.tx(uid, w => {
      w.redeemed ||= []; if (w.redeemed.includes(receipt.receipt_id)) return { ok: false, reason: 'already-redeemed' };
      w.redeemed.push(receipt.receipt_id); w.boosts += receipt.boosts || 0; w.extraStarters += receipt.starters || 0;
      if (receipt.voice_cap_ms) w.voiceReceipts = [...(w.voiceReceipts || []), { id: receipt.receipt_id, capMs: receipt.voice_cap_ms, usedMs: receipt.voice_used_ms || 0 }];
      return { ok: true };
    });
  }
  subscribe(uid, fn) { const s = { uid, fn }; this.subs.add(s); this.view(uid).then(fn); return () => this.subs.delete(s); }
  async _publish(uid, w) { const d = display(w, this.dailyLimit); for (const s of this.subs) if (s.uid === uid) s.fn(d); await this.twins?.announceCount(uid, d, this.store.ver()); }
  async onTwinUpdate(uid) { const d = await this.view(uid); for (const s of this.subs) if (s.uid === uid) s.fn(d); }
}

// Twin detection: instances of the same profile on the same device share the install secret => same device key.
// twinHash = SHA-256(SHA-256(AES-GCM_deviceKey(fixed IV, constant))) — deterministic, doesn't reveal the key.
// Note: iOS Safari tab vs installed PWA vs Capacitor app have SEPARATE storage, so they get different install secrets and
// are NOT twins (each has its own wallet cache; server is canonical). Same-origin tabs / Android Chrome + its PWA are twins.
export async function twinHash(vault) {
  const k = await vault.key(2); if (k?.nacl) { const { default: nacl } = await import('tweetnacl'); return b64(nacl.hash(new Uint8Array([...k.nacl, ...enc.encode('cybermates-twin-id')])).slice(0, 32)).slice(0, 22); }
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, k, enc.encode('cybermates-twin-id'));
  const h = await crypto.subtle.digest('SHA-256', await crypto.subtle.digest('SHA-256', ct)); return b64(new Uint8Array(h)).slice(0, 22);
}
export class Twins {
  constructor({ vault, channel = globalThis.BroadcastChannel ? new BroadcastChannel('cm-twins') : null, instanceId = b64(crypto.getRandomValues(new Uint8Array(6))) }) {
    Object.assign(this, { vault, ch: channel, instanceId }); this.peers = new Map(); this.onCount = () => {};
  }
  async start() { this.hash = await twinHash(this.vault); if (this.ch) { this.ch.onmessage = e => this.receive(e.data); this.ch.postMessage({ t: 'hello', twin: this.hash, id: this.instanceId }); } return this; }
  isTwin(h) { return h === this.hash; }
  async receive(m) {
    if (!m || m.id === this.instanceId || !this.isTwin(m.twin)) return;
    this.peers.set(m.id, Date.now());
    if (m.t === 'hello') this.ch?.postMessage({ t: 'here', twin: this.hash, id: this.instanceId });
    if (m.t === 'count') { try { const d = JSON.parse(dec.decode(await ungcm(await this.vault.key(2), m.box, 'twin-count'))); this.onCount(d); } catch {} } // only same-key twins can read it
  }
  async announceCount(uid, disp, ver) { if (!this.hash) return; const box = await gcm(await this.vault.key(2), enc.encode(JSON.stringify({ uid, disp, ver })), 'twin-count'); this.ch?.postMessage({ t: 'count', twin: this.hash, id: this.instanceId, box }); }
}
