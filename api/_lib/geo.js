// US-only gate (server). Country from Vercel's x-vercel-ip-country header (set by Vercel's edge; absent locally).
// Env: CM_US_ONLY ('1' default = enforce when the header is present; '0' = off), CM_TRAVEL_GRACE_DAYS (default 14):
// an ID last seen from the US within the grace window gets a warning instead of a block (travelers).
// Honest limit: VPNs / residential proxies bypass IP country; this is one layer (see audit "US-only enforcement").
export const geoOf = req => String(req.headers?.['x-vercel-ip-country'] || '').toUpperCase() || null;
export const NOTICE_BLOCK = 'Cybermates is only available in the United States. Your connection appears to be from outside the US, so you can\'t join the network right now.';
export const noticeGrace = days => `You appear to be outside the US. Cybermates is US-only; you can keep using it while traveling for up to ${days} days after your last US check-in.`;
export function geoDecision({ country, lastUsAt = 0, now = Date.now(), env = process.env } = {}) {
  if (env.CM_US_ONLY === '0' || !country) return { allow: true, country: country || 'unknown' };
  if (country === 'US') return { allow: true, country, markUs: true };
  const days = env.CM_TRAVEL_GRACE_DAYS != null ? +env.CM_TRAVEL_GRACE_DAYS : 14;
  if (lastUsAt && now - lastUsAt <= days * 864e5) return { allow: true, country, grace: true, notice: noticeGrace(days), graceUntil: lastUsAt + days * 864e5 };
  return { allow: false, country, notice: NOTICE_BLOCK };
}
