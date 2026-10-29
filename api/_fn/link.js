// POST {grant} -> records a linked device for the shared profile ID: hashed hardware fingerprint + device pubkey.
// Caps linked devices (MAX_DEVICES); refuses a device hash that belongs to a banned profile (so a banned device can't make a
// fresh profile); a ban on the profile ID covers every linked device (they all present the same ID at the single entry).
import { withGuards } from '../_lib/guard.js';
import { getSignal } from '../_lib/signal.js';
import { MAX_DEVICES, verifySigned } from '../../src/linking.js';
const sig = getSignal();
export const devices = globalThis.__cmDevices ||= new Map(); // pid -> [{devHash, devPub, at}]   TODO(Supabase): table linked_devices
export const bannedHashes = globalThis.__cmBannedDev ||= new Set();
export async function recordLink(grant, ppub, s = sig) {
  if (!grant || grant.t !== 'link-grant' || !verifySigned(grant, ppub)) return { status: 400, body: { error: 'bad grant' } };
  if (((await s.standing(grant.pid).catch(() => ({ level: 0 }))).level || 0) >= 4 || bannedHashes.has(grant.devHash)) return { status: 403, body: { error: 'banned' } };
  const l = devices.get(grant.pid) || []; if (l.some(d => d.devHash === grant.devHash)) return { status: 200, body: { ok: true, already: true } };
  if (l.length >= MAX_DEVICES) return { status: 409, body: { error: 'device cap', max: MAX_DEVICES } };
  l.push({ devHash: grant.devHash, devPub: grant.devPub, at: Date.now() }); devices.set(grant.pid, l); return { status: 200, body: { ok: true, count: l.length } };
}
export function banDevicesOf(pid) { for (const d of devices.get(pid) || []) bannedHashes.add(d.devHash); }
async function handler(req, res) { if (req.method !== 'POST') return res.status(405).end(); const r = await recordLink(req.body?.grant, req.body?.ppub); res.status(r.status).json(r.body); }
export default withGuards(handler, { name: 'link', perMin: 10, perIdPerMin: 5, halt: true, geo: true });
