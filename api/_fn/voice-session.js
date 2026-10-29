// POST {user_code, max_ms} -> ephemeral Grok voice token (501 without XAI_API_KEY).
// Production TODO: authenticate the user and check a server-side voice entitlement (receipt sku 'voice30', remaining minutes)
// BEFORE minting; never expose XAI_API_KEY to the client. Endpoint/params below must be checked against current xAI docs.
// PRIVACY / LEGAL (legal review items 4): the xAI organization must have Zero Data Retention (ZDR) enabled under the xAI
// DPA before this ships — confirm in writing; voice audio and transcripts must not be retained by xAI. Client must have
// shown the AI disclosure (EU AI Act Art. 50) and recorded explicit consent before calling this (src/compliance.js).
// Raw audio is never stored by us: it streams to xAI, the text answer is kept on-device, audio is discarded.
// No voiceprints / speaker identification (BIPA / CUBI). Never send religion, orientation or profile data in the session.
import { withGuards } from '../_lib/guard.js';
async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const key = process.env.XAI_API_KEY; if (!key) return res.status(501).json({ error: 'not-configured' });
  const maxMs = Math.min(+req.body?.max_ms || 0, 30 * 60e3); if (maxMs <= 0) return res.status(402).json({ error: 'no-voice-credit' });
  try {
    const r = await fetch('https://api.x.ai/v1/realtime/client_secrets', { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify({ expires_after: { seconds: Math.ceil(maxMs / 1000) } }) });
    res.status(r.ok ? 200 : 502).json(r.ok ? { ...(await r.json()), max_ms: maxMs } : { error: 'upstream', status: r.status });
  } catch (e) { res.status(502).json({ error: 'upstream', detail: e.message }); }
}

export default withGuards(handler, { name: 'voice', perMin: 10, perIdPerMin: 5, geo: true, halt: true }); // rate limits / size cap / geo / halt (api/_lib/guard.js)
