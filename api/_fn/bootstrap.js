// SINGLE ENTRY POINT (2026-10-20 design). Every phone enters the network ONLY through here; there is no other route
// (no master/owner phone fallback, no jump-start from a cached list, no seed list, no snapshot pushes from phones).
// Every call is gated, in order: global halt (signed, 503) -> ban/suspension tiers (403) -> US-only (451, travel grace).
// GET  ?code=&legacy=[&mode=][&check=1] -> { list: [owner-signed presence rows], bans, level, warning, ... }  (login / 24h check-in)
// POST { op: 'login'|'heartbeat'|'logoff', code, row, modes, bind, rot? } -> upsert/remove this phone in the server super list.
// v43 ID BINDING (api/_lib/idbind.js): login/heartbeat need `bind` = the self-signed proof-of-work claim for (code, row.pub);
// the registry keeps ONE key per ID (409 id-bound / key-bound otherwise), logoff/delete must come from the bound key, and the
// reply carries a server cert when ID_BIND_SEED is set. Optional header x-cm-attest feeds the attestation hook.
// The list holds ID key + signed presence row + mode tags only; NO IPs. Silent rows expire (api/_lib/presence.js).
import { withGuards, allow, ipOf } from '../_lib/guard.js';
import { geoOf, geoDecision } from '../_lib/geo.js';
import { getSignal, warningText } from '../_lib/signal.js';
import { checkRow, LIST_MAX } from '../_lib/presence.js';
import { RecentList } from '../_lib/recent.js';
const recentStore = globalThis.__cmRecent ||= new RecentList();
export { recentStore };
import { verifyAttestation } from './attest.js';
import { bannedHashes } from './link.js';
import { bindGate, boundOrFree, makeBindStore, bindCfg, bindStatus } from '../_lib/idbind.js';
export const MAX_BODY = 8 * 1024; // one presence row; was a 5 MB (then 512 KB) snapshot upload
export async function attestationOf(req) { try { const h = req.headers?.['x-cm-attest']; if (!h) return { attested: false, reason: 'no-token' }; return await verifyAttestation(JSON.parse(Buffer.from(String(h), 'base64').toString())); } catch { return { attested: false, reason: 'malformed' }; } }
// shared gate: returns null to continue, or a response already sent
async function gate(req, res, sig, codes) {
  const k = await Promise.resolve(sig.halted?.()).catch(() => null); if (k) { res.status(503).json({ killed: true, halted: true, reason: k.reason }); return 'sent'; }
  const dh = String(req.headers?.['x-cm-device'] || ''); if (dh && bannedHashes.has(dh)) { res.status(403).json({ banned: true, level: 5, reason: 'device banned' }); return 'sent'; } // hashed hardware fingerprint of a banned linked device
  let worst = { level: 0 }; for (const c of codes) if (c) { const s = await sig.standing(c).catch(() => null); if (s && s.level > worst.level) worst = s; }
  if (worst.level === 5) { res.status(403).json({ banned: true, level: 5, reason: worst.reason, strikes: worst.strikes }); return 'sent'; }
  if (worst.level === 4) { res.status(403).json({ suspended: true, level: 4, until: worst.until, reason: worst.reason, strikes: worst.strikes }); return 'sent'; }
  let geo = null; if (codes[0]) { const g = geoDecision({ country: geoOf(req), lastUsAt: (await Promise.resolve(sig.lastUs?.(codes[0])).catch(() => 0)) || 0 });
    if (!g.allow) { res.status(451).json({ geo: 'non-us', country: g.country, notice: g.notice }); return 'sent'; }
    if (g.markUs) await Promise.resolve(sig.markUs?.(codes[0])).catch(() => {}); geo = g.grace ? { geoWarning: g.notice, graceUntil: g.graceUntil } : null; }
  return { standing: worst.level ? { level: worst.level, strikes: worst.strikes, warning: warningText(worst.level, worst.reason, worst.strikes) } : { level: 0 }, geo };
}
async function handler(req, res, sig = getSignal(), bindStore = null) {
  if (req.method === 'GET') {
    const code = String(req.query?.code || ''), legacy = String(req.query?.legacy || '');
    const g = await gate(req, res, sig, [code, legacy]); if (g === 'sent') return res;
    if (!/^[A-Z0-9]{4,16}$/.test(code)) return res.status(400).json({ error: 'code required' });
    if (req.query?.check) return res.json({ ...g.standing, ...(g.geo || {}) });
    if (req.query?.bindinfo) return res.json(bindStatus()); // public: PoW parameters + cert public key (no secrets)
    if (req.query?.recent) { if (!(await allow('recent|ip|' + ipOf(req), 10)) || !(await allow('recent|id|' + code, 6))) return res.status(429).json({ error: 'rate limited' });
      const mode = ['friends', 'gaming', 'dating'].includes(req.query?.mode) ? req.query.mode : null, adult = req.query?.adult === '1';
      const recent = await (sig.recent || recentStore).list({ mode, adult, exclude: code, isBanned: async c => ((await sig.standing(c).catch(() => null))?.level || 0) >= 4 });
      return res.json({ recent, note: 'display only: Active Xh ago, not live' }); }
    const mode = ['friends', 'gaming', 'dating'].includes(req.query?.mode) ? req.query.mode : null;
    const list = await Promise.resolve(sig.presenceList?.({ mode, exclude: code, limit: LIST_MAX })).catch(() => []) || [];
    const bans = await sig.banEntries().catch(() => []), att = await attestationOf(req);
    return res.json({ list, bans, signal: sig.kind, attested: !!att.attested, flags: att.attested ? [] : ['unattested'], attest_reason: att.reason || null, ...g.standing, ...(g.geo || {}) });
  }
  if (req.method === 'POST') {
    const b = req.body || {}, code = String(b.code || ''); if (!/^[A-Z0-9]{4,16}$/.test(code) || !['login', 'heartbeat', 'logoff', 'delete'].includes(b.op)) return res.status(400).json({ error: 'bad request' });
    if (!checkRow(code, b.row)) return res.status(400).json({ error: 'presence row must be owner-signed for this ID' }); // v43: logoff too (was: any row naming the code)
    const store = bindStore || makeBindStore();
    if (b.op === 'delete' || b.op === 'logoff') { // only the key this ID is bound to may remove it (no spoofed logoffs)
      if (!(await boundOrFree({ code, pub: b.row.pub, store }).catch(() => false))) return res.status(409).json({ error: 'id-bound', note: 'this ID is bound to another signing key' });
      await Promise.resolve(sig.presenceRemove?.(code)).catch(() => {});
      if (b.op === 'delete') { (sig.recent || recentStore).remove(code); return res.json({ ok: true, deleted: true }); } // account removal also removes the Recent entry
      return res.json({ ok: true, removed: true }); }
    const g = await gate(req, res, sig, [code, String(b.legacy || '')]); if (g === 'sent') { await Promise.resolve(sig.presenceRemove?.(code)).catch(() => {}); (sig.recent || recentStore).remove(code); return res; }
    const bd = await bindGate({ code, pub: b.row.pub, claim: b.bind, rot: b.rot || null, att: await attestationOf(req), store, cfg: bindCfg() });
    if (!bd.ok) return res.status(bd.http).json({ error: bd.error, ...(bd.note ? { note: bd.note } : {}), ...(bd.idleRebindDays != null ? { idleRebindDays: bd.idleRebindDays, rebindPow: bd.rebindPow } : {}) });
    const ok = await Promise.resolve(sig.presenceUpsert?.(code, b.row, b.modes)).catch(() => false);
    if (ok) (sig.recent || recentStore).seen(code, { card: b.card, modes: Array.isArray(b.modes) ? b.modes : [], adult: b.adult === true });
    return res.status(ok ? 200 : 503).json({ ok: !!ok, bind: bd.status, ...(bd.cert ? { cert: bd.cert } : {}), ...g.standing, ...(g.geo || {}) });
  }
  res.status(405).end();
}
export default withGuards(handler, { name: 'bootstrap', perMin: 60, perIdPerMin: 30, maxBody: MAX_BODY }); // rate limits / size cap (api/_lib/guard.js)
