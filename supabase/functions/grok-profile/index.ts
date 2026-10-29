// Supabase Edge Function: Grok profile setup proxy. Deploy: `supabase functions deploy grok-profile`
// Secrets (server-side ONLY): `supabase secrets set XAI_API_KEY=... XAI_MODEL=...` (SUPABASE_URL / SUPABASE_ANON_KEY are injected).
// Auth: caller must send a Supabase user JWT (anonymous sign-in is fine); verified via /auth/v1/user.
// Limits: per-user 10/hour, 30/day (per isolate; PARTIAL: move to a table for cross-isolate counts), 16 KB body, 40 answers x 500 chars.
// PRIVACY: xAI org must have Zero Data Retention under the DPA; sensitive-category answers are stripped before sending.
import { handle, makeLimiter, MODEL_DEFAULT } from '../_shared/grok-core.js';
const limit = makeLimiter();
const CORS = { 'access-control-allow-origin': Deno.env.get('CM_ALLOWED_ORIGIN') ?? 'https://cybermates.vercel.app', 'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
async function getUser(auth: string) {
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, { headers: { authorization: auth, apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '' } });
  return r.ok ? await r.json() : null;
}
async function xai(body: unknown) {
  const r = await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${Deno.env.get('XAI_API_KEY')}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...(body as object), model: Deno.env.get('XAI_MODEL') ?? MODEL_DEFAULT }) });
  if (!r.ok) throw new Error('upstream ' + r.status); return await r.json();
}
Deno.serve(async (req: Request) => {
  const body = req.method === 'POST' ? await req.text() : '';
  const out = await handle({ method: req.method, auth: req.headers.get('authorization') ?? '', body }, { key: Deno.env.get('XAI_API_KEY'), getUser, limit, xai });
  return new Response(out.json === null ? null : JSON.stringify(out.json), { status: out.status, headers: { ...CORS, 'content-type': 'application/json' } });
});
