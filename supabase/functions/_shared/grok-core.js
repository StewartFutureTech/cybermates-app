// Pure logic for the grok-profile Edge Function (plain JS so Node tests can import it; Deno imports it too).
// The xAI key lives ONLY in the function's secrets (supabase secrets set XAI_API_KEY=...). Never in the client bundle.
export const CAPS = { maxBodyBytes: 16 * 1024, maxAnswers: 40, maxAnswerChars: 500, maxKeyChars: 64, perUserPerHour: 10, perUserPerDay: 30 };
export const MODEL_DEFAULT = 'grok-3-mini'; // check current xAI model names before go-live
const SENSITIVE = /religio|orientation|sexual|health|ethnic|race|politic|union|biometric|precise.?location|address|phone|email|ssn/i;
// Validate + cap input. Returns { ok, answers } or { ok:false, status, error }.
export function capInput(raw, caps = CAPS) {
  if (typeof raw !== 'string' || raw.length > caps.maxBodyBytes) return { ok: false, status: 413, error: 'body too large' };
  let b; try { b = JSON.parse(raw); } catch { return { ok: false, status: 400, error: 'bad json' }; }
  const mode = ['friends', 'gaming', 'dating'].includes(b?.mode) ? b.mode : null; if (!mode) return { ok: false, status: 400, error: 'bad mode' };
  if (mode === 'dating' && b.adult !== true) return { ok: false, status: 403, error: 'dating profile requires an adult account' };
  const a = b.answers; if (!a || typeof a !== 'object' || Array.isArray(a)) return { ok: false, status: 400, error: 'answers must be an object' };
  const ents = Object.entries(a); if (ents.length > caps.maxAnswers) return { ok: false, status: 413, error: 'too many answers' };
  const answers = {};
  for (const [k, v] of ents) { if (typeof v !== 'string' && typeof v !== 'number') continue; if (SENSITIVE.test(k)) continue; // never send sensitive categories to xAI
    answers[String(k).slice(0, caps.maxKeyChars)] = String(v).replace(/[\u0000-\u001f]/g, ' ').slice(0, caps.maxAnswerChars); }
  return { ok: true, mode, answers };
}
export function makeLimiter(caps = CAPS, store = new Map()) {
  return (user, now = Date.now()) => { const h = (store.get(user) || []).filter(t => now - t < 864e5);
    if (h.length >= caps.perUserPerDay || h.filter(t => now - t < 36e5).length >= caps.perUserPerHour) { store.set(user, h); return false; }
    h.push(now); store.set(user, h); return true; };
}
export function xaiRequest(mode, answers, model = MODEL_DEFAULT) {
  return { model, temperature: 0.4, max_tokens: 400, response_format: { type: 'json_object' }, messages: [
    { role: 'system', content: 'You turn questionnaire answers into a short, friendly Cybermates profile. Reply ONLY with JSON {"bio": string <= 280 chars, "tags": string[] <= 8}. Do not infer religion, sexual orientation, health, ethnicity or politics. No contact details.' },
    { role: 'user', content: JSON.stringify({ mode, answers }) } ] };
}
export function shapeOutput(j) {
  let o = {}; try { o = JSON.parse(j?.choices?.[0]?.message?.content || '{}'); } catch { o = {}; }
  return { bio: String(o.bio || '').slice(0, 280), tags: (Array.isArray(o.tags) ? o.tags : []).slice(0, 8).map(t => String(t).slice(0, 32)) };
}
// deps: { getUser(authHeader) -> {id}|null, limit(userId) -> bool, xai(body) -> json, key }
export async function handle({ method, auth, body }, deps) {
  if (method === 'OPTIONS') return { status: 204, json: null };
  if (method !== 'POST') return { status: 405, json: { error: 'method' } };
  if (!deps.key) return { status: 501, json: { error: 'not-configured' } };
  if (!auth || !/^Bearer\s+\S+/.test(auth)) return { status: 401, json: { error: 'auth required' } };
  const user = await deps.getUser(auth).catch(() => null); if (!user?.id) return { status: 401, json: { error: 'bad token' } };
  if (!deps.limit(user.id)) return { status: 429, json: { error: 'rate limited' } };
  const c = capInput(body); if (!c.ok) return { status: c.status, json: { error: c.error } };
  try { return { status: 200, json: shapeOutput(await deps.xai(xaiRequest(c.mode, c.answers))) }; }
  catch { return { status: 502, json: { error: 'upstream' } }; }
}
