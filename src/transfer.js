// Transfer to new device (item 3). v47: a real PAKE (src/pake.js, CPace-style over X25519) replaces "key = PBKDF2(6-digit code)".
//  Before v47 anyone who recorded the relay traffic (incl. the relay operator) could brute-force all 10^6 codes offline, and the
//  rendezvous channel name was SHA-256 of the full code (the code fell out of ~10^6 hashes before any traffic was even sent).
//  Now: (1) the wire carries only PAKE shares + key-confirmation MACs that give an eavesdropper NOTHING to test a guess against;
//  (2) the rendezvous is one of 10 buckets (first digit only), so the channel name leaks at most that digit; (3) every share the
//  sender answers is one online guess for whoever sent it, so the sender answers at most MAX_ATTEMPTS shares, then burns the
//  code (10-min expiry as before). Best attacker odds: MAX_ATTEMPTS / 10^5 per code, and only while actively on the channel.
//  Flow (receiver-first so a wrong code or a neighbour in the same bucket never needs anyone's guess oracle):
//   R -> x2-req {rid, sid, Y_r}        S -> x2-ans {rid, Y_s, kc_s}     (kc = HMAC key confirmation)
//   R -> x2-proof {rid, kc_r}          S -> x2-data {rid, AES-GCM(profile), nonce, proof}     R -> x2-ok {rid, proof} -> S wipes.
//  x-err is unauthenticated, so a receiver only treats it as the reason AFTER no valid answer arrived (it can't burn your session).
import { rand, b64, unb64, gcm, ungcm } from './vault.js';
import { stripDeviceBound } from './terms.js';
import { share, isk } from './pake.js';
export const CODE_TTL_MS = 10 * 60 * 1000, MAX_ATTEMPTS = 5, SETTLE_MS = 700, XFER_PROTO = 2;
const S = () => globalThis.crypto.subtle, enc = new TextEncoder(), dec = new TextDecoder();
export const newCode = () => { const r = new Uint32Array(1); for (;;) { globalThis.crypto.getRandomValues(r); if (r[0] < 4_294_000_000) return String(r[0] % 1_000_000).padStart(6, '0'); } }; // rejection sampling: no modulo bias
// Bucket name: only the first digit is used (10 buckets), never the full code.
export const rendezvous = async code => b64(new Uint8Array(await S().digest('SHA-256', enc.encode('cm-xfer-rdv2:' + String(code).slice(0, 1))))).slice(0, 16);
async function keysFrom(bits) {
  const k = { enc: await S().importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']), mac: await S().importKey('raw', bits.slice(32, 64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']) };
  bits.fill(0); return k;
}
const proof = async (k, label, nonce) => b64(new Uint8Array(await S().sign('HMAC', k.mac, enc.encode(label + ':' + nonce))));
const vfy = async (k, label, nonce, p) => { try { return typeof p === 'string' && await S().verify('HMAC', k.mac, unb64(p), enc.encode(label + ':' + nonce)); } catch { return false; } };
const ub = s => { try { return typeof s === 'string' && s.length <= 64 ? unb64(s) : null; } catch { return null; } };
const okRid = r => typeof r === 'string' && r.length >= 8 && r.length <= 32;

// Sender: bus = {send(m), on(fn)} on the rendezvous channel. getProfile() returns plaintext (in memory only); wipe() runs after receiver confirms.
export async function startSender({ bus, getProfile, wipe, code = newCode(), now = () => Date.now(), onEvent = () => {} }) {
  const exp = now() + CODE_TTL_MS, pend = new Map(); let attempts = 0, state = 'waiting', sent = null;
  const s = { code, exp, get state() { return state; }, get attempts() { return attempts; } };
  bus.on(async m => {
    if (!m || typeof m !== 'object' || state === 'done') return;
    if (m.t === 'x2-req') {
      if (!okRid(m.rid)) return;
      if (now() > exp) { if (state !== 'sent') state = 'expired'; return bus.send({ t: 'x-err', rid: m.rid, reason: 'expired' }); }
      if (state === 'burned' || state === 'sent' || attempts >= MAX_ATTEMPTS) { if (state === 'waiting') state = 'burned'; return bus.send({ t: 'x-err', rid: m.rid, reason: 'too-many-attempts' }); }
      const sid = ub(m.sid), Yr = ub(m.Y); if (!sid || sid.length !== 16 || !Yr || pend.has(m.rid)) return;
      attempts++; onEvent('attempt', attempts); if (attempts >= MAX_ATTEMPTS) state = 'burned'; // every answered share = one guess for its sender
      const me = share(code, sid), bits = isk(me.y, Yr, sid, Yr, me.Y); me.y.fill(0); if (!bits) return;
      const k = await keysFrom(bits); pend.set(m.rid, k); while (pend.size > MAX_ATTEMPTS) pend.delete(pend.keys().next().value);
      return bus.send({ t: 'x2-ans', rid: m.rid, Y: b64(me.Y), kc: await proof(k, 'kc-send', m.rid) });
    }
    if (m.t === 'x2-proof' && pend.has(m.rid) && state !== 'sent') {
      const k = pend.get(m.rid);
      if (now() > exp) { state = 'expired'; return bus.send({ t: 'x-err', rid: m.rid, reason: 'expired' }); }
      if (!(await vfy(k, 'kc-recv', m.rid, m.kc))) { pend.delete(m.rid); onEvent('bad-code', attempts); return bus.send({ t: 'x-err', rid: m.rid, reason: attempts >= MAX_ATTEMPTS ? 'too-many-attempts' : 'bad-code', left: MAX_ATTEMPTS - attempts }); }
      let p = stripDeviceBound(await getProfile()); sent = { rid: m.rid, k, n: rand(16) }; const ct = await gcm(k.enc, enc.encode(JSON.stringify(p)), 'xfer2:' + m.rid); p = null; state = 'sent';
      for (const r of [...pend.keys()]) if (r !== m.rid) pend.delete(r);
      return bus.send({ t: 'x2-data', rid: m.rid, ...ct, nonce: b64(sent.n), proof: await proof(k, 'send', b64(sent.n)) });
    }
    if (m.t === 'x2-ok' && state === 'sent' && m.rid === sent.rid && await vfy(sent.k, 'confirm', b64(sent.n), m.proof)) { state = 'done'; pend.clear(); await wipe(); onEvent('wiped'); }
  });
  return s;
}
// Receiver: enters code; importProfile(obj) re-encrypts with the new device key (Vault.init).
export async function receive({ bus, code, importProfile, timeoutMs = 15000, settleMs = SETTLE_MS }) {
  if (!/^\d{6}$/.test(code)) throw new Error('Code must be 6 digits');
  const rid = b64(rand(12)), sid = rand(16), me = share(code, sid);
  return new Promise((res, rej) => {
    let chosen = null, settle = null, errs = new Set(), over = false;
    const end = (ok, e) => { if (over) return; over = true; clearTimeout(t); clearTimeout(settle); me.y.fill(0); ok ? res(true) : rej(Object.assign(new Error(e.reason), e)); };
    const t = setTimeout(() => end(false, { reason: errs.size ? pick() : 'No response from old device' }), timeoutMs);
    const pick = () => errs.has('too-many-attempts') ? 'too-many-attempts' : errs.has('expired') ? 'expired' : 'bad-code';
    const arm = () => { if (!settle && !chosen) settle = setTimeout(() => { if (!chosen) end(false, { reason: pick() }); }, settleMs); };
    bus.on(async m => {
      if (over || !m || m.rid !== rid) return;
      try {
        if (m.t === 'x-err') { if (!chosen) { errs.add(String(m.reason)); arm(); } return; }
        if (m.t === 'x2-ans' && !chosen) {
          const Ys = ub(m.Y), bits = Ys && isk(me.y, Ys, sid, me.Y, Ys); if (!bits) { errs.add('bad-code'); return arm(); }
          const k = await keysFrom(bits);
          if (!(await vfy(k, 'kc-send', rid, m.kc))) { errs.add('bad-code'); return arm(); } // other code (wrong code, or a neighbour's session)
          chosen = k; clearTimeout(settle); return bus.send({ t: 'x2-proof', rid, kc: await proof(k, 'kc-recv', rid) });
        }
        if (m.t === 'x2-data' && chosen) {
          if (!(await vfy(chosen, 'send', m.nonce, m.proof))) return end(false, { reason: 'bad-sender' });
          let p = JSON.parse(dec.decode(await ungcm(chosen.enc, m, 'xfer2:' + rid))); await importProfile(p); p = null;
          bus.send({ t: 'x2-ok', rid, proof: await proof(chosen, 'confirm', m.nonce) }); end(true);
        }
      } catch (e) { end(false, { reason: e.message }); }
    });
    bus.send({ t: 'x2-req', rid, sid: b64(sid), Y: b64(me.Y), v: XFER_PROTO });
  });
}
// Local bus helper (BroadcastChannel on web; Supabase broadcast channel `xfer:<rendezvous>` in production).
export const bcBus = name => { const c = new BroadcastChannel(name); return { send: m => c.postMessage(m), on: fn => { c.onmessage = e => fn(e.data); }, close: () => c.close() }; };
