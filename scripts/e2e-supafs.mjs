// v48 FORWARD SECRECY + MULTI-DEVICE on the server-relayed chat path, in REAL Chrome tabs (vite dev + scripts/supafs-harness.html).
//  Part A (always, no network): 5 tabs = 5 devices (A phone 1/2, B phone 1/2, C). Bundles go tab -> node -> tab (node = the server).
//    A seals once; both B phones and A's other phone open it, C can't; B1 reloads (keys/prekeys from its vault) and still opens;
//    B1's clock moves past rotation + PREKEY_KEEP_MS: the recorded row no longer opens, not even after another reload (seized phone).
//  Part B (LIVE, needs SUPA_TEST_USERS='[{"email","password"} x3]' = adult A, adult B, minor M, pre-confirmed + age-checked; throwaway,
//    created/deleted by whoever runs it, see docs/TODO.md v48): real sign-in in every tab, publishDevice into public.e2e_devices,
//    A1 sends through SupabaseStore -> B1 gets it over REAL Realtime and opens it, B2 / A2 / A1 open it from listMessages, server row is
//    ciphertext, the minor sees no adult device (and vice versa), B2 signs out (removeDevice) -> the next message is not wrapped for B2.
//    Without SUPA_TEST_USERS Part B prints SKIP.
//  node scripts/e2e-supafs.mjs
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const PORT = 4198, U = `http://localhost:${PORT}/scripts/supafs-harness.html`;
let browser, errs = [], n = 0; const srv = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
const cleanup = async code => { try { await browser?.close(); } catch {} try { process.kill(-srv.pid); } catch {} process.exit(code); };
const ok = (c, m) => { if (!c) { console.error('E2E-SUPAFS FAIL', m); cleanup(1); } else { n++; console.log('ok', m); } };
setTimeout(() => { console.error('E2E-SUPAFS FAIL global timeout'); cleanup(1); }, 180e3);
await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost/.test(d) && res()); setTimeout(() => rej(new Error('vite timeout')), 20000); });
browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const open = async dev => { const p = await browser.newPage(); p.on('pageerror', e => { errs.push(`[${dev}] ${e.message}`); console.log(`[${dev}] pageerror`, e.message); });
  await p.goto(`${U}?dev=${dev}`); await p.waitForFunction(() => window.ready, { timeout: 60000 }); p.dev = dev; p.info = await p.evaluate(() => H.init()); return p; };
const E = (p, fn, a) => p.evaluate(fn, a);
const UA = '11111111-1111-4111-8111-111111111111', UB = '22222222-2222-4222-8222-222222222222', UC = '33333333-3333-4333-8333-333333333333', CONV = '99999999-9999-4999-8999-999999999999';
try {
  // ---------------- Part A
  const [A1, A2, B1, B2, C1] = [await open('A1'), await open('A2'), await open('B1'), await open('B2'), await open('C1')];
  ok(new Set([A1, A2, B1, B2, C1].map(p => p.info.deviceId)).size === 5 && [A1, B1].every(p => p.info.stored === 1), 'five tabs = five devices, keys + prekey stored in each device vault');
  const row = { A1: await E(A1, u => H.bundle(u), UA), A2: await E(A2, u => H.bundle(u), UA), B1: await E(B1, u => H.bundle(u), UB), B2: await E(B2, u => H.bundle(u), UB) };
  ok(await E(A1, r => [H.verify(r.u, r.B1), H.verify(r.u, r.B2)].every(Boolean), { u: UB, ...row }) && await E(B1, r => H.verify(r.u, r.A1), { u: UA, ...row }), 'bundles verify across tabs (browser Ed25519)');
  ok(!(await E(C1, r => H.verify(r.u, r.A1), { u: UB, ...row })), 'bundle copied to another account refused');
  const ctx = { conv: CONV, from: UA, to: UB }, TXT = 'tabs: duo at 9? ✨';
  const m = await E(A1, a => H.seal(a), { ...ctx, toDevs: [row.B1, row.B2], myDevs: [row.A1, row.A2], text: TXT });
  ok(m.body.startsWith('cm2:') && !m.body.includes('duo'), 'sealed in tab A1: cm2 body, no plaintext');
  const opn = (p, me, mm = m) => E(p, a => H.open(a), { ...ctx, me, body: mm.body, nonce: mm.nonce, senderDev: row.A1 });
  ok((await opn(B1, UB)).text === TXT && (await opn(B2, UB)).text === TXT, 'both B phones open it (multi-device)');
  ok((await opn(A2, UA)).text === TXT && (await opn(A1, UA)).text === TXT, "A's other phone + the sending phone open the sent copy");
  ok((await opn(C1, UB)).err === 'E2E_NOT_FOR_THIS_DEVICE', 'untargeted device cannot open');
  { const t = JSON.parse(Buffer.from(m.body.slice(4), 'base64')); const u = Buffer.from(t.c, 'base64'); u[3] ^= 1; t.c = u.toString('base64');
    ok((await opn(B1, UB, { body: 'cm2:' + Buffer.from(JSON.stringify(t)).toString('base64'), nonce: m.nonce })).err === 'E2E_CANNOT_DECRYPT', 'tampered ciphertext refused in the browser'); }
  await B1.reload(); await B1.waitForFunction(() => window.ready); const re = await E(B1, () => H.init());
  ok(re.deviceId === B1.info.deviceId && re.pre === B1.info.pre && (await opn(B1, UB)).text === TXT, 'B1 reloaded: same device + prekey from its vault, still opens');
  await E(B1, () => { H.skew = 24 * 3600e3 + 1000; return H.rotate(); }); ok((await opn(B1, UB)).text === TXT, 'after the 24 h rotation the old prekey still opens (keep window)');
  await E(B1, () => { H.skew = 24 * 3600e3 + 8 * 24 * 3600e3 + 3600e3; return H.rotate(); }); ok((await opn(B1, UB)).err === 'E2E_PREKEY_ERASED', 'after PREKEY_KEEP_MS the prekey secret is erased: recorded row unreadable');
  await B1.reload(); await B1.waitForFunction(() => window.ready); await E(B1, () => { H.skew = 24 * 3600e3 + 8 * 24 * 3600e3 + 3600e3; return H.init(); });
  ok((await opn(B1, UB)).err === 'E2E_PREKEY_ERASED', 'seized phone (reloaded from its own vault + long-term keys) still cannot open it');
  ok((await opn(B2, UB)).text === TXT, "B2 (its own schedule) unaffected");
  ok(!errs.length, '0 page errors (Part A)');

  // ---------------- Part B (live)
  let creds = null; try { creds = process.env.SUPA_TEST_USERS ? JSON.parse(process.env.SUPA_TEST_USERS) : null; } catch {}
  if (!Array.isArray(creds) || creds.length < 3) console.log('SKIP Part B (live): set SUPA_TEST_USERS (adult A, adult B, minor M; pre-confirmed, age-checked)');
  else {
    const [LA1, LA2, LB1, LB2, LM] = [await open('LA1'), await open('LA2'), await open('LB1'), await open('LB2'), await open('LM')];
    const si = (p, c) => E(p, c => H.signIn(c.email, c.password), c);
    const ua = await si(LA1, creds[0]); await si(LA2, creds[0]); const ub = await si(LB1, creds[1]); await si(LB2, creds[1]); const um = await si(LM, creds[2]);
    ok(ua && ub && um && ua !== ub, 'live sign-in in 5 tabs (A x2, B x2, minor)');
    for (const p of [LA1, LA2, LB1, LB2, LM]) await E(p, () => H.store.publishDevice());
    const devA = await E(LA1, u => H.devices(u), ua), devB = await E(LA1, u => H.devices(u), ub);
    ok(devA.length === 2 && devB.length === 2 && [...devA, ...devB].every(r => !Object.keys(r).some(k => /sec|xsec/.test(k)) && r.ik && r.spk && r.spk_sig), 'live: 2+2 device bundles in public.e2e_devices (public keys only)');
    ok((await E(LM, u => H.devices(u), ua)).length === 0 && (await E(LA1, u => H.devices(u), um)).length === 0, 'live RLS: minor sees no adult device bundle and vice versa');
    await E(LB1, () => H.listen()); await sleep(2500);
    const T1 = 'live v2: gg, rematch?';
    const s1 = await E(LA1, a => H.send(a.to, a.t), { to: ub, t: T1 }); ok(s1.ok && s1.fs === true, 'A1 -> B sent as v2 through SupabaseStore (' + (s1.reason || 'ok') + ')');
    const raw = await E(LB1, id => H.raw(id), s1.id); ok(raw?.body?.startsWith('cm2:') && !raw.body.includes('rematch') && raw.nonce, 'live server row = cm2 ciphertext');
    for (let i = 0; i < 40 && !(await E(LB1, id => H.got.some(m => m.id === id), s1.id)); i++) await sleep(300);
    ok(await E(LB1, a => H.got.find(m => m.id === a.id)?.text === a.t, { id: s1.id, t: T1 }), 'B1 got it over REAL Realtime and opened it');
    for (const [p, nm] of [[LB2, 'B phone 2'], [LA2, "A's other phone"], [LA1, 'A sending phone']]) ok(await E(p, async a => (await H.list()).find(m => m.id === a.id)?.text === a.t, { id: s1.id, t: T1 }), 'live: ' + nm + ' opens it');
    const r2 = await E(LB2, a => H.send(a.to, a.t), { to: ua, t: 'reply from B2' }); ok(r2.ok && r2.fs, 'B2 -> A v2');
    ok(await E(LA2, async id => (await H.list()).find(m => m.id === id)?.text === 'reply from B2', r2.id) && await E(LB1, async id => (await H.list()).find(m => m.id === id)?.text === 'reply from B2', r2.id), "A2 opens B2's reply; B1 opens B's own sent copy");
    await E(LB2, () => H.store.removeDevice()); ok((await E(LA1, u => H.devices(u), ub)).length === 1, 'B2 signed out of E2E (removeDevice): one B device left');
    const s3 = await E(LA1, a => H.send(a.to, a.t), { to: ub, t: 'after B2 left' });
    ok(await E(LB1, async id => (await H.list()).find(m => m.id === id)?.text === 'after B2 left', s3.id) && await E(LB2, async id => (await H.list()).find(m => m.id === id)?.why === 'E2E_NOT_FOR_THIS_DEVICE', s3.id), 'next message: B1 opens, removed B2 is not wrapped');
    const s4 = await E(LM, a => H.send(a.to, a.t), { to: ua, t: 'x' }); ok(!s4.ok, 'minor -> adult refused (' + (s4.reason || '') + ')');
    for (const p of [LA1, LA2, LB1, LB2, LM]) await E(p, () => H.signOut());
    ok(!errs.length, '0 page errors (Part B)');
  }
  console.log(`E2E-SUPAFS: ALL OK (${n} checks)`); await cleanup(0);
} catch (e) { console.error('E2E-SUPAFS FAIL', e.message); await cleanup(1); }
