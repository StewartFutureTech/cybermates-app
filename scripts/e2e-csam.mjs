// v45 CSAM EVIDENCE in real tabs (admin/dev flavor, BroadcastChannel mesh). Run after build:admin.
//  A and B become mutual friends over the real mesh; B sends A a message plus an image attachment. A files a child-safety
//  report through the REAL report flow (src/mesh-ui.js reportFlow): no plaintext excerpt goes to the report row, the phone
//  collects what it holds (chat + attachment + 7-day safety copy + B's profile view), seals it to the team PUBLIC key and
//  uploads parts to a stand-in backend (the live DB rules are tested by supabase/tests/csam_evidence.sql). Node verifies the
//  per-part and whole SHA-256 and decrypts with the team SECRET key. A normal report still carries its chosen excerpt and no
//  evidence. Signed out, the bundle waits in the encrypted vault (survives reload, no plaintext in localStorage) and is
//  uploaded once the report has an id. The moderator panel: non-moderators get no team bucket; a lead opens the sealed
//  evidence with the pasted key (images blurred until tapped), wrong key refused, CyberTip packet with per-file hashes
//  (nothing sent), 2703(f) preservation, CyberTip id record, close & wipe; 390 px no overflow; no page errors.
//    node scripts/e2e-csam.mjs
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import puppeteer from 'puppeteer-core';
import nacl from 'tweetnacl';
import { openEvidence } from '../src/evidence.js';
const PORT = 4195, URL0 = `http://localhost:${PORT}/`;
let browser, errs = []; const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-admin', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
const cleanup = async code => { try { await browser?.close(); } catch {} try { process.kill(-srv.pid); } catch {} process.exit(code); };
const assert = (c, m) => { if (!c) { console.error('E2E FAIL', m); cleanup(1); throw new Error('stop'); } else console.log('ok', m); };
setTimeout(() => { console.error('E2E FAIL global timeout'); cleanup(1); }, 240e3);
await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost/.test(d) && res()); setTimeout(() => rej(new Error('preview timeout')), 15000); });
browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, { timeout: ms, polling: 250 }, arg).catch(e => { throw new Error(e.message + ' :: ' + String(fn).slice(0, 140)); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const sha = s => createHash('sha256').update(s).digest('hex');
const boot = async (p, as) => { await p.goto(URL0 + '?as=' + as + '&loaderMin=300');
  const ag = await p.waitForSelector('#ag-dob', { timeout: 15000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
  const terms = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (terms) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  await until(p, () => globalThis.__cmMesh?.()?.code, null, 45000); };
// dialogs: tests push answers for prompt/confirm; alerts are recorded
const open = async as => { const p = await browser.newPage(); await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: false });
  await p.evaluateOnNewDocument(() => { globalThis.__cmAckTest = { minMs: 0, noScroll: true }; localStorage.setItem('cm.sound', 'off'); });
  p._answers = []; p._alerts = [];
  p.on('dialog', d => { if (d.type() === 'alert') { p._alerts.push(d.message()); return d.accept(); } const a = p._answers.length ? p._answers.shift() : null;
    if (d.type() === 'prompt') return a == null ? d.accept() : d.accept(String(a)); return a === false ? d.dismiss() : d.accept(); });
  p.on('pageerror', e => { errs.push(`[${as}] ${e.message}`); console.log(`[${as}] pageerror`, e.message); });
  await boot(p, as); return p; };
const M = (p, fn, arg) => p.evaluate(fn, arg);
const team = nacl.box.keyPair(), B64 = x => Buffer.from(x).toString('base64'), PUB = B64(team.publicKey), SEC = B64(team.secretKey);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
// in-page stand-in backend (records everything; the real DB enforces the rules)
const installFake = (p, withKey = true) => M(p, async ({ pub, withKey }) => { const L = await globalThis.__cmEvidence(); const F = globalThis.__fake = globalThis.__fake || { reports: [], holds: {} };
  const store = { report: async row => { F.reports.push(row); return { id: 'srv-' + F.reports.length, status: 'escalated' }; },
    evidencePubkey: async () => (withKey ? { kid: 'e2e1', pub } : null),
    evidenceBegin: async (rid, env) => { F.holds[rid] = { env, parts: [] }; return 'hold-' + rid; },
    evidencePut: async (h, i, c, s) => { const x = F.holds[h.slice(5)]; x.parts[i] = { c, s }; return { complete: x.parts.filter(Boolean).length === x.env.parts }; } };
  globalThis.__fakeStore = store; L.useSupabaseBackend({ store }); return true; }, { pub: PUB, withKey });
try {
  const A = await open('seed-3'), Bp = await open('seed-6');
  const ca = await M(A, () => __cmMesh().code), cb = await M(Bp, () => __cmMesh().code);
  await until(A, c => __cmMesh().online().includes(c) && __cmMesh().e2e.peers.has(c), cb, 40000); await until(Bp, c => __cmMesh().e2e.peers.has(c), ca, 30000);
  const fr = await M(A, async c => { const r = await __cmMesh().requestFriend(c); return JSON.stringify(r); }, cb); console.log("requestFriend:", fr); await until(Bp, c => __cmMesh().node.pendingIn.has(c), ca, 30000); await M(Bp, c => __cmMesh().accept(c), ca);
  await until(A, c => __cmMesh().node.friends.has(c), cb, 30000); await until(Bp, c => __cmMesh().node.friends.has(c), ca, 30000);
  assert(true, `A (${ca}) and B (${cb}) are mutual friends over the real mesh`);
  await M(Bp, ({ c, png }) => { __cmMesh().node.sendChat(c, 'v45-evidence-text', { attachment: png }); __cmMesh().node.sendChat(c, 'v45-second-line'); }, { c: ca, png: PNG });
  await until(A, c => (__cmMesh().node.chats.get(c)?.msgs || []).filter(x => x.from === c).length >= 2, cb, 30000);
  assert(await M(A, c => __cmMesh().node.chats.get(c).msgs.some(x => x.attachment), cb), 'A received B\'s message with an image attachment');
  // ---- child-safety report through the real flow
  await installFake(A); A._answers.push(7, false); // reason 7 = illegal content (incl. child abuse); "Also block?" -> no
  const r = await M(A, async c => { const L = await __cmEvidence(); const x = await L.reportFlow(__cmMesh(), c, 'should-not-be-sent', 'chat'); return { ok: x.ok, id: x.id, ev: x.evidence }; }, cb);
  const F1 = await M(A, () => globalThis.__fake);
  assert(r.ok && r.id === 'srv-1' && r.ev?.ok && r.ev.holdId === 'hold-srv-1', 'CSAM report filed and sealed evidence uploaded (hold complete)');
  assert(F1.reports[0].reason === 'illegal content (incl. child abuse)' && F1.reports[0].details == null && !JSON.stringify(F1.reports[0]).includes('should-not-be-sent'), 'report row carries NO plaintext excerpt for child-safety reports');
  const h = F1.holds['srv-1'], cs = h.parts.map(p => p.c);
  assert(h.parts.every(p => sha(p.c) === p.s) && sha(cs.join('')) === h.env.sha256 && h.env.kid === 'e2e1' && h.env.media >= 1, `browser SHA-256 per part + whole bundle verified in node (${h.env.parts} part, ${h.env.bytes} B, ${h.env.items} items, ${h.env.media} media)`);
  assert(!JSON.stringify(h).includes('v45-evidence-text') && !JSON.stringify(h).includes('iVBORw0KGgo'), 'uploaded bytes contain no plaintext and no media');
  const bundle = await openEvidence(h.env, cs, SEC);
  assert(bundle.reported.code === cb && bundle.items.some(x => x.text === 'v45-evidence-text' && x.attachment === PNG) && bundle.items.some(x => x.text === 'v45-second-line'), 'team SECRET key decrypts: B\'s messages + image attachment + reported code');
  assert(bundle.items.some(x => x.src === 'safety-copy' || x.src === 'chat') && bundle.reporter.code === ca, 'bundle includes chat/safety-copy items and the reporter code');
  assert(A._alerts.at(-1).includes('sealed and sent to the safety team only') && A._alerts.at(-1).includes('CyberTipline'), 'reporter told the evidence went to the safety team only (+ 911 / CyberTipline)');
  // ---- normal report: unchanged
  A._answers.push(1, true, false); // harassment, attach excerpt yes, block no
  const r2 = await M(A, async c => { const L = await __cmEvidence(); const x = await L.reportFlow(__cmMesh(), c, 'normal-excerpt', 'chat'); return { ok: x.ok, id: x.id, ev: x.evidence ?? null }; }, cb);
  const F2 = await M(A, () => globalThis.__fake);
  assert(r2.ok && r2.ev === null && F2.reports[1].reason === 'harassment' && F2.reports[1].details === 'normal-excerpt' && Object.keys(F2.holds).length === 1, 'normal report unchanged: chosen excerpt, no evidence upload');
  assert(await M(A, c => __cmMesh().node.chats.get(c).msgs.length >= 2, cb), 'chat still on the phone (phones-only retention unchanged)');
  // ---- signed out: kept pending in the encrypted vault, survives reload, uploads after linking
  await M(A, async () => { const L = await __cmEvidence(); L.useSupabaseBackend(null); });
  A._answers.push(7, false); const r3 = await M(A, async c => { const L = await __cmEvidence(); const x = await L.reportFlow(__cmMesh(), c, '', 'chat'); return { queued: x.queued, ev: x.evidence }; }, cb);
  assert(r3.queued && r3.ev?.pending && r3.ev.why === 'no-account', 'signed out: report queued and evidence kept pending on the phone');
  assert(await M(A, () => JSON.stringify(JSON.parse(localStorage.getItem('cybermates:pending-reports') || '[]')).includes('evidence_ref')), 'queued report row carries only an evidence reference');
  await until(A, async () => (await (await __cmEvidence()).persisted()).length === 1, null, 15000); await A.reload(); await boot(A, 'seed-3');
  const pend = await M(A, async () => { const L = await __cmEvidence(); for (let i = 0; i < 40 && !(await L.persisted()).length; i++) await new Promise(r => setTimeout(r, 250)); await new Promise(r => setTimeout(r, 300)); return L.pending(); });
  assert(pend.length === 1 && pend[0].why === 'no-account', 'pending evidence survived a reload (encrypted device vault)');
  assert(await M(A, () => { let s = ''; for (let i = 0; i < localStorage.length; i++) s += localStorage.getItem(localStorage.key(i)); return !s.includes('v45-evidence-text') && !s.includes('iVBORw0KGgo'); }), 'no plaintext evidence or media in localStorage');
  await installFake(A); const lk = await M(A, async ref => { const L = await __cmEvidence(); return L.linkPending(ref, 'srv-9', globalThis.__fakeStore); }, pend[0].ref);
  const F3 = await M(A, () => globalThis.__fake);
  assert(lk?.ok && F3.holds['srv-9'] && (await M(A, async () => (await (await __cmEvidence()).pending()).length)) === 0, 'after sign-in the queued report id links the bundle -> uploaded, queue empty');
  const b3 = await openEvidence(F3.holds['srv-9'].env, F3.holds['srv-9'].parts.map(p => p.c), SEC); assert(b3.items.some(x => x.text === 'v45-evidence-text'), 'late upload decrypts to the same evidence');
  // ---- moderator panel
  const hold = { hold_id: 'hold-srv-1', report_id: 'srv-1', kind: 'csam', reason: 'illegal content (incl. child abuse)', parts_expected: h.env.parts, parts_received: h.env.parts, bytes: h.env.bytes, items: h.env.items, media: h.env.media, complete: true,
    created_at: new Date().toISOString(), preserve_until: new Date(Date.now() + 365 * 864e5).toISOString(), legal_hold_until: null, cybertip_report_id: null, server_copies: 0, views: 0 };
  const ui = await M(A, async ({ hold, h, role }) => { const L = await __cmEvidence(); const log = globalThis.__modlog = []; const answers = globalThis.__ask = [];
    const mk = r => ({ amModerator: async () => r, modQueue: async () => [{ id: 'srv-1', reason: 'illegal content (incl. child abuse)', priority: 1, status: 'escalated', escalation_level: 1, created_at: new Date().toISOString(), reporter_band: 'adult', reported_band: 'adult', reports_on_target: 1 },
        { id: 'srv-2', reason: 'harassment', priority: 3, status: 'open', escalation_level: 0, created_at: new Date().toISOString(), details: '<b>x</b>' }],
      modEvidenceList: async id => { log.push(['list', id]); return id === 'srv-1' ? [hold] : []; },
      modEvidenceGet: async (hid, i) => { log.push(['get', hid, i]); return { env: h.env, idx: i, c: h.parts[i].c }; },
      modCybertipPacket: async hid => { log.push(['packet', hid]); return { packet_version: 1, sent: false, uploaded_files: [{ sha256: h.env.sha256 }] }; },
      modPreserve: async a => { log.push(['preserve', a]); return new Date(Date.now() + a.days * 864e5).toISOString(); },
      modCybertipRecorded: async (hid, id) => { log.push(['tip', hid, id]); return new Date(Date.now() + 365 * 864e5).toISOString(); } });
    const d0 = document.createElement('div'); d0.id = 'v45nonmod'; document.body.append(d0); await L.modQueueView(d0, { store: mk(null) });
    const d = document.createElement('div'); d.id = 'v45mod'; d.style.cssText = 'position:fixed;inset:0;overflow:auto;z-index:9999;background:#000'; document.body.append(d);
    await L.teamReviewView(d, mk(role), { role, ask: q => answers.shift() ?? null });
    return { nonmodTeam: !!d0.querySelector('#mq-team, [data-team-review], [data-evbtn]'), evBtns: d.querySelectorAll('[data-evbtn]').length }; }, { hold, h, role: 'lead' });
  assert(!ui.nonmodTeam && ui.evBtns === 2, 'non-moderator: no team bucket / evidence buttons; moderator: evidence + preservation buttons');
  const click = sel => M(A, s => document.querySelector('#v45mod ' + s).click(), sel);
  await click('[data-rid="srv-1"] [data-evbtn]'); await until(A, () => document.querySelector('#v45mod [data-hold]'), null, 5000);
  await M(A, () => globalThis.__ask.push('AAAA')); await click('[data-evopen]'); await until(A, () => /bad team key|wrong team key/.test(document.querySelector('#v45mod [data-evout]').textContent), null, 8000);
  assert(await M(A, () => !document.querySelector('#v45mod [data-evitem]')), 'wrong team key -> refused, nothing shown');
  await M(A, k => globalThis.__ask.push(k), SEC); await click('[data-evopen]'); await until(A, () => document.querySelectorAll('#v45mod [data-evitem]').length >= 2, null, 8000);
  const shown = await M(A, () => { const v = document.querySelector('#v45mod [data-evbundle]'); const img = v.querySelector('[data-evimg]'); return { text: v.textContent, blur: img?.style.filter, gets: globalThis.__modlog.filter(x => x[0] === 'get').length }; });
  assert(shown.text.includes('v45-evidence-text') && shown.blur === 'blur(24px)' && shown.gets === h.env.parts * 2, 'lead opens sealed evidence with the pasted key: messages shown, images BLURRED, every part fetched via the logged RPC');
  await click('[data-evimg]'); assert(await M(A, () => document.querySelector('#v45mod [data-evimg]').style.filter === ''), 'tap reveals an image (moderator choice)');
  await click('[data-evpacket]'); await until(A, () => !document.querySelector('#v45mod [data-evpk]').hidden, null, 5000);
  const pk = JSON.parse(await M(A, () => document.querySelector('#v45mod [data-evpk]').textContent));
  const pngSha = sha(Buffer.from(PNG.split(',')[1], 'base64'));
  assert(pk.sent === false && pk.files?.some(f => f.sha256 === pngSha && f.mime === 'image/png') && (await M(A, () => document.querySelector('#v45mod [data-evout]').textContent)).includes('Nothing was sent'), 'CyberTip packet: not sent, includes per-file SHA-256 of the decrypted image');
  await M(A, () => globalThis.__ask.push('LE-2703F-777', 'Test PD', '90')); await click('[data-evpres]'); await until(A, () => /Preserved until/.test(document.querySelector('#v45mod [data-evout]').textContent), null, 5000);
  await M(A, () => globalThis.__ask.push('TIP-42')); await click('[data-evtip]'); await until(A, () => /CyberTip ID recorded/.test(document.querySelector('#v45mod [data-evout]').textContent), null, 5000);
  const log = await M(A, () => globalThis.__modlog);
  assert(log.some(x => x[0] === 'preserve' && x[1].holdId === 'hold-srv-1' && x[1].ref === 'LE-2703F-777' && x[1].days === 90) && log.some(x => x[0] === 'tip' && x[2] === 'TIP-42'), '2703(f) preservation + CyberTip id go to the DB RPCs');
  const ov = await M(A, () => ({ sw: document.querySelector('#v45mod').scrollWidth, cw: document.querySelector('#v45mod').clientWidth }));
  assert(ov.sw <= ov.cw + 1, `moderator panel fits 390 px (scrollWidth ${ov.sw} <= ${ov.cw})`);
  await click('[data-evclose]'); assert(await M(A, () => !document.querySelector('#v45mod [data-evbundle]') && document.querySelector('#v45mod [data-evpk]').hidden), 'close & wipe removes the decrypted view and packet');
  await click('[data-rid="srv-2"] [data-evbtn]'); await until(A, () => document.querySelector('#v45mod [data-rid="srv-2"] [data-evnone]'), null, 5000);
  assert(await M(A, () => !document.querySelector('#v45mod [data-rid="srv-2"] [data-evopen]') && !!document.querySelector('#v45mod [data-rid="srv-2"] [data-evpres]')), 'normal report: no evidence, 2703(f) preservation still available');
  assert(errs.length === 0, 'no page errors in any tab' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log('E2E-CSAM PASS'); await cleanup(0);
} catch (e) { if (e.message !== 'stop') { console.error('E2E FAIL', e.message); await cleanup(1); } }
