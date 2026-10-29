// Single lazily-created supabase-js client. Pass {storage, transport: WebSocket impl} for Node < 22 (tests).
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';
let shared = null;
export async function makeClient({ url = SUPABASE_URL, key = SUPABASE_PUBLISHABLE_KEY, storage, persist = true, transport } = {}) {
  if (/service_role|sb_secret_/.test(key) || /^service_role$/.test(jwtRole(key) || '')) throw new Error('refusing to use a service_role key in the client');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: persist, autoRefreshToken: persist, detectSessionInUrl: !!globalThis.location, flowType: 'pkce', ...(storage ? { storage } : {}) }, ...(transport ? { realtime: { transport } } : {}) });
}
export async function getClient(opts) { return shared ||= await makeClient(opts); }
export function jwtRole(k) { try { return JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role; } catch { return null; } }
// supabase-js returns {data,error}; adapters throw instead so callers get one error path.
export function unwrap({ data, error }) { if (error) { const e = new Error(error.message || String(error)); e.code = error.code; e.status = error.status; throw e; } return data; }
