// E2E sealing for server-relayed messages (public.messages). The server stores only ciphertext. Plaintext never leaves a device.
//  v1 boxSealer: static nacl.box between the two profiles' e2e_pubkey (src/e2e.js newBoxKeys()). Kept for legacy peers and so
//     old v1 rows still open. No forward secrecy: anyone who later gets either long-term secret opens every recorded v1 row.
//  v48 fsSealer: FORWARD SECRECY + MULTI-DEVICE. Every device publishes a bundle in public.e2e_devices (migration
//     20261028000015): ik (X25519 identity), sk_pub (Ed25519), and a SIGNED PREKEY spk (rotated every 24 h, spk_sig = Ed25519 over
//     'cm-dev-v1' | uid | device | ik | sk_pub | spk_id | spk). A message is sealed ONCE with a random content key (secretbox) and
//     that key is wrapped for every target device: all fresh devices of the recipient AND the sender's own devices (so the
//     sender's other phones and its own history can read it). Wrap key per device =
//       SHA-512("cm-supa-v2" | conv | from | fromDev | to | who | targetDev | spk_id | epk | X25519(eph, spk) | X25519(myIk, targetIk))[0..32]
//     with a fresh ephemeral per message (secret zeroed at once). The static-static term authenticates the sending device; the
//     ephemeral-prekey term gives forward secrecy: prekey secrets are erased PREKEY_KEEP_MS (8 days, > the 7-day server hold) after
//     a newer prekey replaced them, so a recorded row can't be opened later even with the device's long-term keys and vault.
//     Device keys are pinned per (uid, device) on first sight: a different ik / sk_pub for a known device id is refused.
//     Body = 'cm2:' + base64(JSON {v:2, sd, e, c, w:[[who('r'|'s'), device, spk_id, wrapped]...]}), nonce = content nonce.
import nacl from 'tweetnacl';
const b64 = u8 => { let s = ''; for (const c of u8) s += String.fromCharCode(c); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const te = new TextEncoder(), td = new TextDecoder();
export const V2_PREFIX = 'cm2:', MAX_DEVICES = 5, PREKEY_ROTATE_MS = 24 * 3600e3, PREKEY_KEEP_MS = 8 * 24 * 3600e3, DEVICE_FRESH_MS = 30 * 864e5, MAX_PINS = 2000;
export const isV2 = body => typeof body === 'string' && body.startsWith(V2_PREFIX);
export class SealError extends Error { constructor(r) { super('e2e: ' + r); this.code = 'E2E_' + r.toUpperCase().replace(/-/g, '_'); } }
export function boxSealer({ xsec }) {
  const sk = unb64(xsec);
  return {
    kind: 'static',
    seal(peerPub, text) { const n = nacl.randomBytes(24); return { body: b64(nacl.box(te.encode(text), n, unb64(peerPub), sk)), nonce: b64(n) }; },
    open(peerPub, body, nonce) { const r = nacl.box.open(unb64(body), unb64(nonce), unb64(peerPub), sk); if (!r) throw new Error('e2e: cannot decrypt'); return td.decode(r); },
  };
}
const B64K = /^[A-Za-z0-9+/]{43}=$/, DEV_RE = /^[A-Za-z0-9_-]{8,32}$/, SPKID_RE = /^[A-Za-z0-9+/_=-]{4,24}$/;
export const newDeviceId = () => b64(nacl.randomBytes(12)).replace(/\+/g, '-').replace(/\//g, '_');
const devMsg = (uid, r) => te.encode(['cm-dev-v1', uid, r.device_id, r.ik, r.sk_pub, r.spk_id, r.spk].join('|'));
const okPre = x => x && typeof x.id === 'string' && SPKID_RE.test(x.id) && typeof x.xpub === 'string' && (x.xsec === null || typeof x.xsec === 'string') && Number.isFinite(x.t);
// box = {xpub, xsec} (X25519, base64) and sign = {pub, sec} (Ed25519 nacl.sign, base64) are this DEVICE's long-term keys.
// prekeys/pins: persisted state from onPrekeys/onPins (store them in the encrypted vault).
export function fsSealer({ box, sign, deviceId, prekeys = null, pins = null, onPrekeys = null, onPins = null, now = () => Date.now() }) {
  if (!box?.xsec || !box?.xpub || !sign?.sec || !sign?.pub) throw new SealError('need-device-keys');
  if (!DEV_RE.test(deviceId || '')) throw new SealError('bad-device-id');
  const ikSec = unb64(box.xsec), sgSec = unb64(sign.sec);
  let pre = (Array.isArray(prekeys) ? prekeys.filter(okPre).map(x => ({ ...x })) : []).sort((a, b) => a.t - b.t);
  const pin = new Map(pins && typeof pins === 'object' ? Object.entries(pins).slice(-MAX_PINS) : []);
  const stats = { v2out: 0, v1out: 0, v2in: 0, v1in: 0, erased: 0, pinRefused: 0, badSig: 0, notForMe: 0, devicesWrapped: 0 };
  const save = () => { try { onPrekeys?.(pre.map(({ id, xpub, xsec, t }) => ({ id, xpub, xsec, t }))); } catch {} };
  function rotate() { const t = now(); let ch = false, cur = pre[pre.length - 1];
    if (!cur || !cur.xsec || t - cur.t >= PREKEY_ROTATE_MS || cur.t > t + 3600e3) { const k = nacl.box.keyPair(); cur = { id: b64(nacl.randomBytes(9)), xpub: b64(k.publicKey), xsec: b64(k.secretKey), t }; k.secretKey.fill(0); pre.push(cur); ch = true; }
    // erase a prekey once its successor has been current for PREKEY_KEEP_MS (any row sealed to it has expired by then)
    while (pre.length > 1 && t - pre[1].t > PREKEY_KEEP_MS) { const gone = pre.shift(); gone.xsec = null; ch = true; }
    if (ch) save(); return cur; }
  const kdf = (ctx, a, b) => { if (a.every(x => x === 0) || b.every(x => x === 0)) throw new SealError('low-order-key'); const h = nacl.hash(new Uint8Array([...te.encode(ctx), ...a, ...b])); a.fill(0); b.fill(0); const k = h.slice(0, 32); h.fill(0); return k; };
  const ctxOf = (conv, from, fromDev, to, who, dev, spkId, epk) => ['cm-supa-v2', conv, from, fromDev, to, who, dev, spkId, epk, ''].join('|');
  const ZN = new Uint8Array(24); // every wrap key is used exactly once (fresh ephemeral per message)
  const S = {
    kind: 'fs', deviceId, ik: box.xpub, signPub: sign.pub, stats,
    // ---- v1 compat (legacy peers without a device bundle, and old rows) ----
    ...(() => { const v1 = boxSealer({ xsec: box.xsec }); return { seal: (p, t) => { stats.v1out++; return v1.seal(p, t); }, open: (p, b, n) => { const r = v1.open(p, b, n); stats.v1in++; return r; } }; })(),
    rotate, prekeyList: () => pre.map(({ id, xpub, xsec, t }) => ({ id, xpub, xsec, t })), pins: () => Object.fromEntries(pin),
    currentPrekeyId: () => rotate().id,
    // public row for public.e2e_devices (signed); call on sign-in and whenever currentPrekeyId() changed
    bundle(uid) { const c = rotate(); const r = { device_id: deviceId, ik: box.xpub, sk_pub: sign.pub, spk_id: c.id, spk: c.xpub }; return { ...r, spk_sig: b64(nacl.sign.detached(devMsg(uid, r), sgSec)) }; },
    // a device row is usable if well-formed, its prekey signature verifies, and its keys match the pin for (uid, device)
    verifyDevice(uid, r) {
      if (!r || !DEV_RE.test(r.device_id || '') || !B64K.test(r.ik || '') || !B64K.test(r.sk_pub || '') || !B64K.test(r.spk || '') || !SPKID_RE.test(r.spk_id || '')) return false;
      try { if (!nacl.sign.detached.verify(devMsg(uid, r), unb64(r.spk_sig || ''), unb64(r.sk_pub))) { stats.badSig++; return false; } } catch { stats.badSig++; return false; }
      const k = uid + '|' + r.device_id, p = pin.get(k);
      if (p) { if (p.ik !== r.ik || p.sk !== r.sk_pub) { stats.pinRefused++; return false; } return true; }
      pin.set(k, { ik: r.ik, sk: r.sk_pub }); while (pin.size > MAX_PINS) pin.delete(pin.keys().next().value); try { onPins?.(Object.fromEntries(pin)); } catch {}
      return true; },
    forgetPin(uid, dev) { pin.delete(uid + '|' + dev); try { onPins?.(Object.fromEntries(pin)); } catch {} },
    // seal text from (me, this device) to `to`; toDevs / myDevs = VERIFIED device rows. Returns {body, nonce}.
    seal2({ conv, from, to, toDevs, myDevs = [], text }) {
      if (!conv || !from || !to) throw new SealError('need-context');
      const targets = [...toDevs.slice(0, MAX_DEVICES).map(d => ['r', d]), ...myDevs.slice(0, MAX_DEVICES).map(d => ['s', d])];
      if (!targets.some(([w]) => w === 'r')) throw new SealError('no-recipient-device');
      if (!targets.some(([w, d]) => w === 's' && d.device_id === deviceId)) { const me = S.bundle(from); targets.push(['s', me]); } // own copy (history)
      const cek = nacl.randomBytes(32), n = nacl.randomBytes(24), eph = nacl.box.keyPair(), epk = b64(eph.publicKey);
      const c = b64(nacl.secretbox(te.encode(text), n, cek));
      const w = targets.map(([who, d]) => { const k = kdf(ctxOf(conv, from, deviceId, to, who, d.device_id, d.spk_id, epk), nacl.scalarMult(eph.secretKey, unb64(d.spk)), nacl.scalarMult(ikSec, unb64(d.ik)));
        const wk = b64(nacl.secretbox(cek, ZN, k)); k.fill(0); return [who, d.device_id, d.spk_id, wk]; });
      eph.secretKey.fill(0); cek.fill(0); stats.v2out++; stats.devicesWrapped += w.length;
      return { body: V2_PREFIX + btoa(JSON.stringify({ v: 2, sd: deviceId, e: epk, c, w })), nonce: b64(n) };
    },
    header(body) { if (!isV2(body)) return null; try { const h = JSON.parse(atob(body.slice(V2_PREFIX.length))); return h?.v === 2 && typeof h.sd === 'string' && typeof h.e === 'string' && typeof h.c === 'string' && Array.isArray(h.w) && h.w.length <= 2 * MAX_DEVICES + 1 ? h : null; } catch { return null; } },
    // open a v2 row. me = my uid; senderDev = the VERIFIED device row of (from, h.sd).
    open2({ conv, from, to, me, body, nonce, senderDev }) {
      const h = S.header(body); if (!h) throw new SealError('bad-header');
      if (!senderDev || senderDev.device_id !== h.sd) throw new SealError('unknown-sender-device');
      const who = me === to ? 'r' : me === from ? 's' : null; if (!who) throw new SealError('not-a-party');
      const ent = h.w.find(x => Array.isArray(x) && x[0] === who && x[1] === deviceId); if (!ent) { stats.notForMe++; throw new SealError('not-for-this-device'); }
      const mine = pre.find(x => x.id === ent[2]); if (!mine || !mine.xsec) { stats.erased++; throw new SealError('prekey-erased'); }
      const k = kdf(ctxOf(conv, from, h.sd, to, who, deviceId, ent[2], h.e), nacl.scalarMult(unb64(mine.xsec), unb64(h.e)), nacl.scalarMult(ikSec, unb64(senderDev.ik)));
      const cek = nacl.secretbox.open(unb64(ent[3]), ZN, k); k.fill(0); if (!cek) throw new SealError('cannot-decrypt');
      const pt = nacl.secretbox.open(unb64(h.c), unb64(nonce || ''), cek); cek.fill(0); if (!pt) throw new SealError('cannot-decrypt');
      stats.v2in++; return td.decode(pt);
    },
  };
  rotate(); return S;
}
