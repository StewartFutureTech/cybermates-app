// v45 CSAM REPORTING DUTY + EVIDENCE PRESERVATION (technical side; counsel review / real NCMEC submission are the owner's).
// Messages and media normally live only on phones and auto-delete (retention.js, mesh.js sweep, server purge after 7 days).
// The one exception: when a report is filed under the child-exploitation category, the REPORTER's phone collects what it
// holds locally from the reported person (chat messages incl. attachments/media, the 7-day safety copy, the profile view it
// loaded), SEALS it on the phone to the safety team's PUBLIC key (nacl.box, X25519-XSalsa20-Poly1305, ephemeral sender key)
// and uploads the ciphertext to the server evidence hold (migration 20261027000011). The server verifies SHA-256 per part and
// for the whole bundle, can never read it, keeps it outside every auto-delete for the preservation period, and only active
// adult moderators can fetch it (each access logged). Nothing is shown to anyone else; the reporter cannot re-read it.
// No key / no account / offline -> the bundle waits in the encrypted device vault (exempt from the 7-day safety sweep,
// at most 5 bundles, 30 days = the server upload window) and is sent when possible.
import nacl from 'tweetnacl';
export const CSAM_REASON = 'illegal content (incl. child abuse)';
export const isCsam = reason => reason === CSAM_REASON;
export const PART_CHARS = 1_000_000, MAX_PARTS = 12, MAX_PLAIN = 8 * 1024 * 1024, MAX_ITEMS = 500, PENDING_MAX = 5, PENDING_MS = 30 * 864e5;
const enc = new TextEncoder(), dec = new TextDecoder();
export function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
export const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export async function sha256hex(data) { const u = typeof data === 'string' ? enc.encode(data) : data; const h = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', u)); return [...h].map(b => b.toString(16).padStart(2, '0')).join(''); }
const clip = (v, n) => String(v ?? '').slice(0, n);
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i;
const isMedia = v => typeof v === 'string' && DATA_URL.test(v);
// attachment shapes seen in chats: a data URL string or { type/mime, name, data|url|dataUrl }
export function mediaOf(att) { if (!att) return []; if (isMedia(att)) return [att]; if (typeof att !== 'object') return [];
  return ['data', 'url', 'dataUrl', 'src'].map(k => att[k]).filter(isMedia); }
// ---- collect (reporter's phone; reads only what this phone already holds) ----
export async function collectEvidence({ m, code, reason, context = 'chat', game = null, now = Date.now() }) {
  const node = m?.node || {}, chat = node.chats?.get?.(code)?.msgs || [], seen = new Set(), items = [];
  const push = (x, src) => { const k = `${x.from}|${x.at}|${x.text}`; if (seen.has(k)) return; seen.add(k);
    items.push({ src, from: clip(x.from, 16), at: Number(x.at) || null, text: clip(x.text, 4000), ...(x.attachment ? { attachment: x.attachment } : {}), ...(x.burn ? { burn: x.burn } : {}) }); };
  for (const x of chat) push(x, 'chat');
  let safety = []; try { safety = (await m?.safetyConversation?.(code)) || []; } catch {}
  for (const x of safety) if (x) push(x, 'safety-copy');
  items.sort((a, b) => (a.at || 0) - (b.at || 0)); const kept = items.slice(-MAX_ITEMS);
  const v = node.view?.(code), p = v?.profile || v || {};
  const profile = { name: clip(p.name ?? v?.name, 60), bio: clip(p.bio, 600), thumb: isMedia(p.thumb) ? p.thumb : null,
    photos: (Array.isArray(p.photos) ? p.photos : []).filter(isMedia).slice(0, 8) }; // only display fields; sensitive fields never leave the phone
  const pub = node.friends?.get?.(code)?.pub || node.cache?.get?.(code)?.pub || null;
  const bundle = { v: 1, kind: 'cybermates-evidence', reason: clip(reason, 64), context: clip(context, 16), game: game && clip(game, 32), collectedAt: new Date(now).toISOString(),
    reporter: { code: clip(m?.code, 16) }, reported: { code: clip(code, 16), pub, profile }, items: kept, truncated: items.length > kept.length };
  return capBundle(bundle); }
export const countMedia = b => (b.items || []).reduce((n, x) => n + mediaOf(x.attachment).length, 0) + (b.reported?.profile?.thumb ? 1 : 0) + (b.reported?.profile?.photos?.length || 0);
// keep the newest text; drop the OLDEST attachments first if the bundle is too big
export function capBundle(b, max = MAX_PLAIN) { let s = JSON.stringify(b);
  for (let i = 0; s.length > max && i < b.items.length; i++) if (b.items[i].attachment) { b.items[i].attachment = { dropped: 'too-large' }; b.truncated = true; s = JSON.stringify(b); }
  while (s.length > max && b.items.length) { b.items.shift(); b.truncated = true; s = JSON.stringify(b); }
  if (s.length > max) { b.reported.profile.photos = []; b.truncated = true; }
  return b; }
// ---- seal (to the team PUBLIC key) and split into parts the server can hash-check ----
export async function sealEvidence(bundle, { kid, pub }) {
  const e = nacl.box.keyPair(), n = nacl.randomBytes(24), msg = enc.encode(JSON.stringify(bundle));
  const c = toB64(nacl.box(msg, n, fromB64(pub), e.secretKey)); e.secretKey.fill(0);
  const parts = []; for (let i = 0; i * PART_CHARS < c.length; i++) { const ci = c.slice(i * PART_CHARS, (i + 1) * PART_CHARS); parts.push({ idx: i, c: ci, sha256: await sha256hex(ci) }); }
  if (parts.length > MAX_PARTS) throw Object.assign(new Error('evidence too large'), { code: 'too-large' });
  return { env: { v: 1, alg: 'nacl-box', kid, e: toB64(e.publicKey), n: toB64(n), parts: parts.length, sha256: await sha256hex(c), bytes: c.length, items: bundle.items.length, media: countMedia(bundle) }, parts }; }
// moderator side: decrypt in memory with the team SECRET key (never stored by the app)
export async function openEvidence(env, partsC, secB64) {
  const c = partsC.join(''); if (env.sha256 && (await sha256hex(c)) !== env.sha256) throw Object.assign(new Error('evidence hash mismatch'), { code: 'hash' });
  let sk; try { sk = fromB64(String(secB64 || '').trim()); } catch { sk = null; } if (!sk || sk.length !== 32) throw Object.assign(new Error('bad team key'), { code: 'key' });
  const m = nacl.box.open(fromB64(c), fromB64(env.n), fromB64(env.e), sk); sk.fill(0);
  if (!m) throw Object.assign(new Error('wrong team key (cannot decrypt)'), { code: 'key' }); return JSON.parse(dec.decode(m)); }
// per-file hashes for the CyberTip packet (hash of the decoded media bytes; no content leaves the moderator's screen)
export async function fileList(bundle) { const out = []; const add = async (u, where, at = null, from = null) => { const [, mime] = u.match(DATA_URL); const bytes = fromB64(u.slice(u.indexOf(',') + 1));
    out.push({ file_name: `${where}-${out.length + 1}.${(mime.split('/')[1] || 'bin').replace(/[^a-z0-9]/gi, '')}`, mime, bytes: bytes.length, sha256: await sha256hex(bytes), sent_at_utc: at ? new Date(at).toISOString() : null, from }); };
  for (const x of bundle.items || []) for (const u of mediaOf(x.attachment)) await add(u, 'chat-attachment', x.at, x.from);
  if (bundle.reported?.profile?.thumb) await add(bundle.reported.profile.thumb, 'profile-thumb'); for (const u of bundle.reported?.profile?.photos || []) await add(u, 'profile-photo');
  return out; }
// ---- upload ----
export async function uploadEvidence(store, reportId, sealed) {
  const holdId = await store.evidenceBegin(reportId, sealed.env); let r = { complete: false };
  for (const p of sealed.parts) r = await store.evidencePut(holdId, p.idx, p.c, p.sha256);
  return { ok: !!r?.complete, holdId, complete: !!r?.complete }; }
// ---- pending queue (encrypted device vault via setEvidencePersistence; memory otherwise) ----
let persist = { load: async () => [], save: async () => {} }, mem = null;
export function setEvidencePersistence(p) { persist = p || { load: async () => [], save: async () => {} }; mem = null; }
async function list(now = Date.now()) { if (!mem) mem = ((await persist.load().catch(() => [])) || []).filter(x => x && now - x.at < PENDING_MS); return mem; }
async function store_(l) { mem = l.slice(-PENDING_MAX); await persist.save(mem).catch(() => {}); }
export async function persisted() { return ((await persist.load().catch(() => [])) || []).map(x => x.ref); } // what the vault holds now (tests)
export async function pending() { return (await list()).map(x => ({ ref: x.ref, reportId: x.reportId || null, at: x.at, why: x.why || null })); }
export async function queuePending(entry, now = Date.now()) { const l = await list(now); const i = l.findIndex(x => x.ref === entry.ref); const e = { ...entry, at: entry.at || now }; if (i >= 0) l[i] = e; else l.push(e); await store_(l); }
// file -> seal -> upload, or keep pending. Returns { ok, holdId?, pending?, why? }
export async function preserveForReport({ store, reportId, bundle, ref = 'ev-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), now = Date.now() }) {
  const keep = async why => { await queuePending({ ref, reportId: reportId || null, bundle, why }, now); return { ok: false, pending: true, why, ref }; };
  if (!store?.evidenceBegin || !store?.evidencePubkey) return keep('no-account');
  if (!reportId) return keep('report-queued');
  let key = null; try { key = await store.evidencePubkey(); } catch { return keep('offline'); } if (!key) return keep('no-team-key');
  try { const r = await uploadEvidence(store, reportId, await sealEvidence(bundle, key)); if (!r.ok) return keep('incomplete');
    const l = await list(now); if (l.some(x => x.ref === ref)) await store_(l.filter(x => x.ref !== ref)); return { ok: true, holdId: r.holdId, ref }; }
  catch (e) { return /already received/.test(e?.message || '') ? { ok: true, duplicate: true, ref } : keep(e?.code === 'too-large' ? 'too-large' : 'upload-failed'); } }
// a queued report got its server id (signin flush) -> attach and try again
export async function linkPending(ref, reportId, store) { const l = await list(); const e = l.find(x => x.ref === ref); if (!e || !reportId) return null; e.reportId = reportId; await store_(l); return preserveForReport({ store, reportId, bundle: e.bundle, ref }); }
export async function flushPending(store) { let sent = 0; for (const e of [...(await list())]) if (e.reportId) { const r = await preserveForReport({ store, reportId: e.reportId, bundle: e.bundle, ref: e.ref }); if (r.ok) sent++; } return sent; }
export const _reset = () => { mem = null; persist = { load: async () => [], save: async () => {} }; };
