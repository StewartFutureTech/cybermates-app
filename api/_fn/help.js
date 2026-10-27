// Help desk AI relay (optional). POST {q} -> {answer}. Uses XAI_API_KEY server-side; never receives profile data
// (client sends only the redacted question; we redact again). Grounded on docs/help-kb.md. Rate-limited per IP (per instance + global, v40).
// Env: XAI_API_KEY (required), XAI_MODEL (default 'grok-3-mini'). Without a key -> 503 and the app falls back to the offline KB.
import { withGuards } from '../_lib/guard.js';
import { readFileSync } from 'node:fs';
import { haltGuard } from '../_lib/mod.js';
import { globalHit } from '../_lib/globalrl.js';
import { join } from 'node:path';
let KB = ''; try { KB = readFileSync(join(process.cwd(), 'docs/help-kb.md'), 'utf8'); } catch {}
const hits = globalThis.__cmHelpHits ||= new Map(), PER_MIN = 6, PER_DAY = 60;
const redact = s => String(s).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/@\w{2,}/g, '[handle]').replace(/\+?\d[\d\s().-]{6,}\d/g, '[number]').slice(0, 500);
async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (await haltGuard(res)) return; // global halt: refuse
  const key = process.env.XAI_API_KEY; if (!key) return res.status(503).json({ error: 'help AI not configured' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'x', now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 864e5);
  if (h.filter(t => now - t < 60e3).length >= PER_MIN || h.length >= PER_DAY) return res.status(429).json({ error: 'rate limited' });
  hits.set(ip, [...h, now]); if (hits.size > 5000) hits.clear();
  const [gMin, gDay] = await Promise.all([globalHit('help-ai|min|' + ip, PER_MIN, 60), globalHit('help-ai|day|' + ip, PER_DAY, 86400)]); // v40: shared by all instances
  if (gMin === false || gDay === false) return res.status(429).json({ error: 'rate limited', global: true });
  const q = redact(req.body?.q || '').trim(); if (!q) return res.status(400).json({ error: 'empty' });
  const r = await fetch('https://api.x.ai/v1/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: process.env.XAI_MODEL || 'grok-3-mini', max_tokens: 300, temperature: 0.2, messages: [
      { role: 'system', content: 'You are the Cybermates in-app help assistant. You are an AI, not a human; say so if asked. Answer ONLY from the knowledge base below, in 1-4 short sentences. If the answer is not there, say you are not sure and suggest "Contact safety team" or "Report a user" in the Help tab. For danger, self-harm, threats, minors or illegal content, tell the user to contact local emergency services and the safety team and to use Report. Never ask for personal data.\n\n' + KB },
      { role: 'user', content: q }] }) }).catch(() => null);
  if (!r?.ok) return res.status(502).json({ error: 'upstream' });
  const j = await r.json(); const answer = String(j.choices?.[0]?.message?.content || '').slice(0, 1200);
  return res.json({ answer });
}

export default withGuards(handler, { name: 'help', perMin: 10 }); // rate limits / size cap / geo / halt (api/_lib/guard.js)
