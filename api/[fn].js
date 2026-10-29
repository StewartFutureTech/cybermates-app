// Single router function (Vercel Hobby: max 12 functions). /api/<name> -> api/_fn/<name>.js default handler, unchanged.
// api/stripe-webhook.js stays its own function because it needs the raw body (bodyParser: false).
import attest from './_fn/attest.js'; import ban from './_fn/ban.js'; import bootstrap from './_fn/bootstrap.js';
import cancel from './_fn/cancel.js'; import checkout from './_fn/checkout.js'; import cronInactive from './_fn/cron-inactive.js';
import entitlement from './_fn/entitlement.js'; import help from './_fn/help.js'; import kill from './_fn/kill.js';
import link from './_fn/link.js'; import refund from './_fn/refund.js'; import report from './_fn/report.js';
import voiceSession from './_fn/voice-session.js';
export const ROUTES = { attest, ban, bootstrap, cancel, checkout, 'cron-inactive': cronInactive, entitlement, help, kill, link, refund, report, 'voice-session': voiceSession };
export default function router(req, res) {
  let name = req.query?.fn; if (Array.isArray(name)) name = name[0];
  if (!name) name = String(req.url || '').split('?')[0].replace(/^\/api\//, '').split('/')[0];
  const h = Object.hasOwn(ROUTES, name) ? ROUTES[name] : null;
  if (!h) return res.status(404).json({ error: 'not found' });
  return h(req, res);
}
