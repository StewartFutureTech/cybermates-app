// v45 CSAM REPORTING DUTY + EVIDENCE PRESERVATION (node half; real browser half = scripts/e2e-csam.mjs; live DB half =
// supabase/tests/csam_evidence.sql, 45 checks, rolled back).
//  Part 1 (static): migrations 20261027000011/12 - private deny-all evidence tables, no client grants, anon revoked, purge_expired
//    untouched (phones-only/auto-delete stays), separate purge_evidence honours preservation + legal hold, CSAM first in the
//    Serious bucket, 2703(f) 1..90 days renewable, CyberTip packet never sends (no http/net calls), lead-only tip record.
//  Part 2 (node): src/evidence.js collect -> seal (team PUBLIC key) -> parts + SHA-256 -> upload against a fake store that
//    mirrors the DB rules; only moderators with the SECRET key can open it; wrong key / tamper refused; size caps; pending queue
//    (no account / no key / offline / queued report -> link -> flush, 30-day expiry, 5 max); normal reports unchanged.
//  node scripts/smoke-csam.mjs
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl';
import * as E from '../src/evidence.js';
import { SupabaseStore, ADAPTER_METHODS } from '../src/backend/supabase-store.js';
let fail = 0, n = 0; const ok = (c, m) => { n++; console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail = 1; };
const root = new URL('..', import.meta.url).pathname, rd = f => readFileSync(root + f, 'utf8');
const sha = s => createHash('sha256').update(s).digest('hex');
// ---------------- Part 1: static
const sql = rd('supabase/migrations/20261027000011_csam_evidence.sql'), code = sql.replace(/--.*$/gm, ''), sql2 = rd('supabase/migrations/20261027000012_csam_evidence_window.sql').replace(/--.*$/gm, '');
for (const t of ['evidence_keys', 'evidence_holds', 'evidence_parts', 'evidence_server_copies', 'evidence_access_log']) {
  ok(new RegExp(`alter table app\\.${t} enable row level security`).test(code) && new RegExp(`revoke all on app\\.${t} from public, anon, authenticated`).test(code), `sql: app.${t} RLS on + all client privileges revoked`);
  ok(!new RegExp(`grant[^;]*on app\\.${t}`, 'i').test(code) && !new RegExp(`create policy[^;]*on app\\.${t}`, 'i').test(code), `sql: app.${t} has no grants and no policies (deny-all)`); }
ok(!/function app\.purge_expired/.test(code + sql2), 'sql: app.purge_expired() NOT changed (server messages still auto-delete after 7 days)');
ok(/function app\.purge_evidence[\s\S]*preserve_until < now\(\) and \(legal_hold_until is null or legal_hold_until < now\(\)\)/.test(code), 'sql: purge_evidence only removes holds past preservation AND legal hold');
ok(/cron\.schedule\('cybermates-purge-evidence'/.test(code), 'sql: daily evidence expiry cron');
ok(/order by r\.priority, app\.is_csam_reason\(r\.reason\) desc/.test(code), 'sql: CSAM first inside the Serious bucket');
ok(/update public\.reports set priority = 1, status = case when status = 'open' then 'escalated'/.test(code), 'sql: evidence upload re-asserts P1 + escalated');
ok(/not app\.is_csam_reason\(r\.reason\)[^;]*raise exception 'evidence upload is only for child-safety reports'/.test(code), 'sql: upload only for child-safety reports');
ok(/reporter_id = \(select auth\.uid\(\)\)/.test(code) && /evidence_holds where id = p_hold and reporter_id = \(select auth\.uid\(\)\)/.test(code), 'sql: only the reporter can upload to their hold');
ok(/encode\(sha256\(convert_to\(p_c, 'UTF8'\)\), 'hex'\)/.test(code) && /string_agg\(c, '' order by idx\)/.test(code), 'sql: server verifies SHA-256 per part and for the whole bundle');
ok((code.match(/if not app\.is_moderator\(\) then raise exception 'moderators only' using errcode = '42501'/g) || []).length >= 4, 'sql: moderator-only (42501) on evidence guard, list, preserve');
ok(/conflict of interest: you are part of this report/.test(code), 'sql: conflict of interest refused');
for (const a of ['view', 'server_copies', 'packet', 'preserve', 'cybertip_recorded', 'list']) ok(new RegExp(`app\\.evidence_log\\([^;]*'${a}'`).test(code), `sql: access '${a}' logged`);
ok(/p_days not between 1 and 90/.test(code) && /greatest\(coalesce\(hk\.legal_hold_until, now\(\)\), now\(\)\) \+ make_interval\(days => p_days\)/.test(code), 'sql: 2703(f) 1..90 days per request, renewals extend from the current end');
ok(/'sent', false/.test(code) && !/\bnet\.http|http_post|http_get|pg_net|extensions\.http/i.test(code), 'sql: CyberTip packet marked not-sent and NO outbound http in the migration');
ok(/app\.mod_role\(\) <> 'lead'[^;]*only a lead can record a CyberTip/.test(code) && /now\(\) \+ interval '365 days'/.test(code), 'sql: lead-only CyberTip record, preserved 1 year after');
ok(/revoke execute on function[^;]*app\.purge_evidence\(\) from authenticated/.test(code) && /revoke execute on function public\.evidence_pubkey\(\)[^;]*from public, anon/.test(code), 'sql: internal helpers + purge not callable by clients; RPCs revoked from anon');
ok(!/\bdrop\s+table\b|\btruncate\b/i.test(code + sql2) && !/delete from public\./i.test(code + sql2), 'sql: never drops tables or deletes public data');
ok(!/security definer(?![^\n]*search_path = '')/.test(code + sql2), "sql: every security definer has search_path = ''");
ok(/interval '30 days'/.test(sql2) && /report too old for evidence upload/.test(sql2), 'sql: upload window 30 days (follow-up migration)');
ok(existsSync(root + 'supabase/tests/csam_evidence.sql') && /V45RESULT/.test(rd('supabase/tests/csam_evidence.sql')), 'sql: live test file present (rolls back)');
// ---------------- Part 2: evidence.js
const team = nacl.box.keyPair(), B = x => Buffer.from(x).toString('base64'), KEY = { kid: 'smoke1', pub: B(team.publicKey) }, SEC = B(team.secretKey);
const png = 'data:image/png;base64,' + Buffer.from('fakepngbytes-0123456789').toString('base64');
const chats = new Map([['BAD1', { msgs: [{ from: 'BAD1', text: 'secret-bad-text', at: 1000, attachment: png }, { from: 'ME01', text: 'reply', at: 2000 }] }]]);
const m = { code: 'ME01', node: { chats, friends: new Map([['BAD1', { pub: 'pubBAD' }]]), view: c => c === 'BAD1' ? { full: true, profile: { name: 'Bad', bio: 'b', thumb: 'data:image/jpeg;base64,AAAA', religion: 'X', orientation: 'Y', photos: [png] } } : null },
  safetyConversation: async () => [{ from: 'BAD1', text: 'hidden-instantly', at: 1500 }, { from: 'BAD1', text: 'secret-bad-text', at: 1000 }] };
const bundle = await E.collectEvidence({ m, code: 'BAD1', reason: E.CSAM_REASON, now: 5000 });
ok(bundle.items.length === 3 && bundle.items.map(x => x.text).join() === 'secret-bad-text,hidden-instantly,reply', 'collect: chat + 7-day safety copy merged, deduped, time-ordered');
ok(bundle.items[0].attachment === png && E.countMedia(bundle) === 3, 'collect: attachment media + profile thumb/photos counted');
ok(!('religion' in bundle.reported.profile) && !JSON.stringify(bundle).includes('orientation'), 'collect: sensitive profile fields never leave the phone');
ok(bundle.reported.pub === 'pubBAD' && bundle.reporter.code === 'ME01', 'collect: reported key + reporter code');
const sealed = await E.sealEvidence(bundle, KEY);
ok(!JSON.stringify(sealed).includes('secret-bad-text') && !JSON.stringify(sealed).includes('fakepng'), 'seal: no plaintext or media in what is uploaded');
ok(sealed.env.kid === 'smoke1' && sealed.env.alg === 'nacl-box' && sealed.env.parts === 1 && sealed.env.sha256 === sha(sealed.parts.map(p => p.c).join('')) && sealed.parts.every(p => p.sha256 === sha(p.c)), 'seal: envelope + node SHA-256 agree with the browser-side hashes');
ok(/^[A-Za-z0-9+/]{43}=$/.test(sealed.env.e) && /^[A-Za-z0-9+/]{32}$/.test(sealed.env.n), 'seal: envelope fields match the server regexes');
const back = await E.openEvidence(sealed.env, sealed.parts.map(p => p.c), SEC);
ok(back.items[0].text === 'secret-bad-text' && back.items[0].attachment === png, 'open: team SECRET key decrypts the bundle');
let e1 = null; try { await E.openEvidence(sealed.env, sealed.parts.map(p => p.c), B(nacl.box.keyPair().secretKey)); } catch (x) { e1 = x; } ok(e1?.code === 'key', 'open: any other key refused');
let e2 = null; try { await E.openEvidence(sealed.env, [sealed.parts[0].c.slice(0, -4) + 'AAAA'], SEC); } catch (x) { e2 = x; } ok(e2?.code === 'hash', 'open: tampered ciphertext refused (hash)');
const files = await E.fileList(back); ok(files.length === 3 && files[0].sha256 === sha(Buffer.from('fakepngbytes-0123456789')) && files[0].mime === 'image/png', 'fileList: per-file SHA-256 of decoded media for the CyberTip packet');
// big bundle -> multiple parts; caps
const big = { ...bundle, items: [{ src: 'chat', from: 'BAD1', at: 1, text: 'x', attachment: 'data:image/jpeg;base64,' + 'A'.repeat(2_400_000) }] };
const sb = await E.sealEvidence(big, KEY); ok(sb.parts.length === 4 && sb.parts.slice(0, -1).every(p => p.c.length === E.PART_CHARS), 'seal: 3.2 MB ciphertext split into 1 MB parts');
const capped = E.capBundle({ items: [{ attachment: 'data:image/png;base64,' + 'A'.repeat(500) }, { text: 'keep' }], reported: { profile: { photos: [] } } }, 300);
ok(capped.items.length === 2 && capped.items[0].attachment.dropped && capped.truncated, 'cap: oldest attachments dropped first, text kept');
// fake store mirroring the DB rules
const mk = ({ key = KEY, me = 'u-rep', mod = false, failPut = false } = {}) => { const S = { reports: new Map(), holds: new Map(), log: [] };
  return { S, async report({ reported, reason, details }) { const id = 'r' + (S.reports.size + 1); S.reports.set(id, { id, reporter: me, reported, reason, details, priority: reason === E.CSAM_REASON ? 1 : 3 }); return { id, status: 'open' }; },
    async evidencePubkey() { return key; },
    async evidenceBegin(rid, env) { const r = S.reports.get(rid); if (!r || r.reporter !== me) throw Object.assign(new Error('report not found'), { code: '42501' }); if (r.reason !== E.CSAM_REASON) throw Object.assign(new Error('evidence upload is only for child-safety reports'), { code: '42501' });
      if (env.kid !== key.kid) throw new Error('bad evidence envelope'); const h = 'h-' + rid; if (S.holds.get(h)?.complete) throw new Error('evidence already received'); S.holds.set(h, { env, parts: [], complete: false, rid }); return h; },
    async evidencePut(h, i, c, s) { if (failPut) throw new Error('network'); const x = S.holds.get(h); if (sha(c) !== s) throw new Error('part hash mismatch'); x.parts[i] = c; const done = x.parts.filter(Boolean).length === x.env.parts;
      if (done && sha(x.parts.join('')) !== x.env.sha256) throw new Error('evidence hash mismatch'); x.complete = done; return { complete: done, received: x.parts.filter(Boolean).length }; },
    async modEvidenceGet(h, i) { if (!mod) throw Object.assign(new Error('moderators only'), { code: '42501' }); S.log.push(['view', h, i]); return { env: S.holds.get(h).env, c: S.holds.get(h).parts[i] }; } }; };
const st = mk(); const r1 = await st.report({ reported: 'u-bad', reason: E.CSAM_REASON }); const up = await E.preserveForReport({ store: st, reportId: r1.id, bundle });
ok(up.ok && st.S.holds.get(up.holdId).complete && (await E.pending()).length === 0, 'upload: sealed bundle uploaded, hashes verified, hold complete');
let e3 = null; try { await st.modEvidenceGet(up.holdId, 0); } catch (x) { e3 = x; } ok(e3?.code === '42501', 'access: the reporter (non-moderator) cannot read it back');
const r2 = await st.report({ reported: 'u-bad', reason: 'harassment', details: 'normal' }); let e4 = null; try { await E.uploadEvidence(st, r2.id, sealed); } catch (x) { e4 = x; }
ok(e4 && st.S.reports.get(r2.id).details === 'normal' && st.S.reports.get(r2.id).priority === 3, 'normal reports: unchanged and never take evidence');
ok((await E.preserveForReport({ store: st, reportId: r1.id, bundle })).duplicate, 'upload: completed evidence is not replaced (duplicate ok)');
// pending queue + persistence
const saved = []; E.setEvidencePersistence({ load: async () => saved.at(-1) || [], save: async l => { saved.push(JSON.parse(JSON.stringify(l))); } });
const p1 = await E.preserveForReport({ store: null, reportId: null, bundle, ref: 'ref-a' }); ok(p1.pending && p1.why === 'no-account' && saved.at(-1).length === 1 && saved.at(-1)[0].bundle.items.length === 3, 'pending: no account -> kept in the (vault) queue');
const nokey = mk({ key: null }); const r3 = await nokey.report({ reported: 'x', reason: E.CSAM_REASON });
ok((await E.preserveForReport({ store: nokey, reportId: r3.id, bundle, ref: 'ref-b' })).why === 'no-team-key', 'pending: no team key configured -> kept, never sent unsealed');
const flaky = mk({ failPut: true }); const r4 = await flaky.report({ reported: 'x', reason: E.CSAM_REASON });
ok((await E.preserveForReport({ store: flaky, reportId: r4.id, bundle, ref: 'ref-c' })).why === 'upload-failed', 'pending: network failure mid-upload -> kept for retry');
const st2 = mk(); const r5 = await st2.report({ reported: 'x', reason: E.CSAM_REASON }); const l = await E.linkPending('ref-a', r5.id, st2);
ok(l.ok && !(await E.pending()).some(x => x.ref === 'ref-a'), 'pending: queued report got its id -> linked + uploaded + removed');
ok((await E.flushPending(mk({ key: null }))) === 0 && (await E.pending()).length === 2, 'pending: flush without a key keeps them');
for (let i = 0; i < 6; i++) await E.queuePending({ ref: 'f' + i, reportId: null, bundle: { items: [] } }); ok((await E.pending()).length === E.PENDING_MAX, 'pending: capped at 5 bundles');
E.setEvidencePersistence({ load: async () => [{ ref: 'old', at: Date.now() - 31 * 864e5, bundle: {} }, { ref: 'new', at: Date.now(), bundle: {} }], save: async () => {} });
ok((await E.pending()).map(x => x.ref).join() === 'new', 'pending: dropped after 30 days (= server upload window)'); E._reset();
// adapter
{ const calls = []; const fake = { auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) }, rpc: async (fn, args) => { calls.push([fn, args]); return { data: fn === 'evidence_pubkey' ? [{ kid: 'k1', pub: 'P' }] : fn === 'mod_evidence_list' ? [] : 'x', error: null }; } };
  const s = new SupabaseStore(fake);
  for (const k of ['evidencePubkey', 'evidenceBegin', 'evidencePut', 'modEvidenceList', 'modEvidenceGet', 'modEvidenceServerCopies', 'modPreserve', 'modCybertipPacket', 'modCybertipRecorded']) ok(ADAPTER_METHODS.includes(k) && typeof s[k] === 'function', 'adapter: SupabaseStore.' + k);
  ok((await s.evidencePubkey()).kid === 'k1', 'adapter: evidencePubkey -> rpc evidence_pubkey (first row)');
  await s.evidencePut('h', 2, 'c', 'h2'); ok(JSON.stringify(calls.at(-1)) === JSON.stringify(['evidence_put', { p_hold: 'h', p_idx: 2, p_c: 'c', p_sha256: 'h2' }]), 'adapter: evidencePut args');
  await s.modPreserve({ reportId: 'r', ref: 'LE-1', agency: 'PD', days: 30 }); ok(JSON.stringify(calls.at(-1)) === JSON.stringify(['mod_preserve', { p_report: 'r', p_hold: null, p_ref: 'LE-1', p_agency: 'PD', p_days: 30 }]), 'adapter: modPreserve args');
  await s.modCybertipRecorded('h', 'T1'); ok(calls.at(-1)[0] === 'mod_cybertip_recorded' && calls.at(-1)[1].p_tip_id === 'T1', 'adapter: modCybertipRecorded'); }
// wiring (static)
const mu = rd('src/mesh-ui.js'), cp = rd('src/compliance.js'), si = rd('src/signin.js'), am = rd('src/app-mesh.js'), rp = rd('src/reports.js');
ok(/csam = reason === CSAM_REASON, ev = !csam && excerpt/.test(mu) && /preserveForReport\(/.test(mu), 'wiring: CSAM report -> no plaintext excerpt, sealed evidence preserved');
ok(/row\.evidence_ref = /.test(cp) && /linkPending\(r\.evidence_ref/.test(si) && /flushPending\(b\.store\)/.test(si), 'wiring: queued report keeps its evidence ref; sign-in flush links + retries');
ok(/evidencePending = l;/.test(am) && !/safety\.sweep[^\n]*evidence/.test(am), 'wiring: pending evidence in the encrypted vault, not in the 7-day safety sweep');
ok(/MODE === 'admin' \|\| import\.meta\.env\?\.DEV\) globalThis\.__cmEvidence/.test(am), 'wiring: e2e hook admin/dev builds only');
ok(/store\.modEvidenceList \?/.test(rp) && /filter:blur\(24px\)/.test(rp) && /never saved/.test(rp) && /Nothing was sent/.test(rp), 'wiring: moderator panel (DB-gated), blurred media, key never saved, packet not sent');
console.log(fail ? `SMOKE-CSAM FAIL (${n} checks)` : `SMOKE-CSAM ALL OK (${n} checks)`); process.exit(fail);
