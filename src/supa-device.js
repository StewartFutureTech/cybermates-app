// v48: this phone's DEVICE identity for the server-relayed chat path (public.messages): forward secrecy + delivery to every
// device (src/backend/supabase-e2e.js fsSealer, table public.e2e_devices). Keys live only in the encrypted vault (p.supaDevice:
// device id, X25519 box keys, Ed25519 signing keys, rotating prekeys, device pins); only PUBLIC keys are ever published.
// Separate from the mesh identities (one phone can hold several mesh IDs but is one account device).
import nacl from 'tweetnacl';
import { b64 } from './vault.js';
import { fsSealer, newDeviceId } from './backend/supabase-e2e.js';
export async function deviceSealer(v, opts = {}) {
  const rec = await v.use(p => { const d = (p.supaDevice ||= {}); d.id ||= newDeviceId();
    if (!d.box) { const k = nacl.box.keyPair(); d.box = { xpub: b64(k.publicKey), xsec: b64(k.secretKey) }; k.secretKey.fill(0); }
    if (!d.sign) { const k = nacl.sign.keyPair(); d.sign = { pub: b64(k.publicKey), sec: b64(k.secretKey) }; k.secretKey.fill(0); }
    return JSON.parse(JSON.stringify(d)); });
  let q = Promise.resolve(); const persist = (k, val) => { q = q.then(() => v.use(p => { if (p.supaDevice) p.supaDevice[k] = val; })).catch(() => {}); return q; };
  const s = fsSealer({ box: rec.box, sign: rec.sign, deviceId: rec.id, prekeys: rec.pre, pins: rec.pins, onPrekeys: l => persist('pre', l), onPins: m => persist('pins', m), ...opts });
  s.flush = () => q; return s;
}
