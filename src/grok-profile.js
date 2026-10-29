// Client for Grok profile setup. Calls the Supabase Edge Function `grok-profile`; the xAI key is NEVER in this bundle.
// Needs VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY; signs in anonymously to get a user JWT the function verifies.
import { guardedFetch } from './never-send.js';
export async function grokProfile({ mode, answers, adult }, env = (typeof import.meta !== 'undefined' && import.meta.env) || {}, client = null) {
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) return { ok: false, reason: 'not-configured' };
  let cl = client; if (!cl) { const { createClient } = await import('@supabase/supabase-js'); cl = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY); }
  let { data } = await cl.auth.getSession(); if (!data?.session) ({ data } = await cl.auth.signInAnonymously());
  const tok = data?.session?.access_token; if (!tok) return { ok: false, reason: 'auth' };
  const r = await guardedFetch(`${env.VITE_SUPABASE_URL}/functions/v1/grok-profile`, { method: 'POST', headers: { authorization: 'Bearer ' + tok, apikey: env.VITE_SUPABASE_ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ mode, answers, adult: !!adult }) });
  const j = await r.json().catch(() => ({})); return r.ok ? { ok: true, ...j } : { ok: false, reason: j.error || r.status };
}
