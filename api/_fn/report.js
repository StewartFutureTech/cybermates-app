// POST {reporter, reported, reason, sealed} -> stores the SEALED conversation (only the moderation key, held offline, opens it).
// Mock store in memory; TODO(Supabase day): table reports(sealed jsonb). Never logs plaintext.
import { withGuards } from '../_lib/guard.js';
const store = globalThis.__cmReports ||= [];
async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end(); const b = req.body || {};
  if (!b.sealed?.c || !b.sealed?.e || !b.sealed?.n || 'msgs' in b || 'text' in b) return res.status(400).json({ error: 'report must be sealed' });
  store.push({ reporter: String(b.reporter || '').slice(0, 16), reported: String(b.reported || '').slice(0, 16), reason: String(b.reason || '').slice(0, 200), sealed: b.sealed, at: Date.now() });
  res.json({ ok: true, id: store.length });
}
export default withGuards(handler, { name: 'report', perMin: 10, perIdPerMin: 5, maxBody: 256 * 1024 });
