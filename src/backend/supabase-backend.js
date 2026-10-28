// Entry point: one object bundling auth + store + realtime. Usage:
//   const be = await createSupabaseBackend({ sealer: boxSealer(vaultKeys) });
//   v48 forward secrecy + every device: sealer: fsSealer({ box, sign, deviceId, prekeys, pins, onPrekeys, onPins }), then be.store.publishDevice().
//   await be.auth.sendEmailOtp(email); await be.auth.verifyEmailOtp(email, code); await be.store.submitAgeCheck('2001-05-04');
import { getClient, makeClient } from './supabase-client.js';
import { SupabaseAuth } from './supabase-auth.js';
import { SupabaseStore } from './supabase-store.js';
import { SupabaseRealtime } from './supabase-realtime.js';
export { ADAPTER_METHODS } from './supabase-store.js';
export { boxSealer, fsSealer, newDeviceId } from './supabase-e2e.js';
export async function createSupabaseBackend({ client, sealer, requireFs = false, ...clientOpts } = {}) {
  const c = client || (Object.keys(clientOpts).length ? await makeClient(clientOpts) : await getClient());
  return { kind: 'supabase', client: c, auth: new SupabaseAuth(c), store: new SupabaseStore(c, { sealer, requireFs }), realtime: new SupabaseRealtime(c) };
}
