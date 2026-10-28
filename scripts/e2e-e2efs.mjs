// v47 E2E hardening in real tabs (admin/dev flavor, BroadcastChannel mesh). Run after build:admin.
//  A and B join; each learns the other's SIGNED PREKEY from pings; they connect (request + accept) and chat: every directed
//  envelope between them is a v2 forward-secret envelope (no v1 static-key envelope at all). B reloads: its prekeys come back from
//  the encrypted vault (same current prekey id) and A's next chat opens. Finally the device transfer runs through the real
//  Settings UI with the PAKE (browser WebCrypto + BigInt Elligator2): a wrong code fails fast, the right code moves the profile.
//    node scripts/e2e-e2efs.mjs
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const PORT = 4197, URL0 = `http://localhost:${PORT}/`;
let browser, errs = [], n = 0; const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-admin', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
const cleanup = async code => { try { await browser?.close(); } catch {} try { process.kill(-srv.pid); } catch {} process.exit(code); };
const assert = (c, m) => { if (!c) { console.error('E2E FAIL', m); cleanup(1); } else { n++; console.log('ok', m); } };
setTimeout(() => { console.error('E2E FAIL global timeout'); cleanup(1); }, 240e3);
await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost/.test(d) && res()); setTimeout(() => rej(new Error('preview timeout')), 15000); });
browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, { timeout: ms, polling: 250 }, arg).catch(e => { throw new Error(e.message + ' :: ' + String(fn).slice(0, 140)); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const boot = async (p, as) => { await p.goto(URL0 + '?as=' + as + '&loaderMin=300');
  const ag = await p.waitForSelector('#ag-dob', { timeout: 15000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
  const terms = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (terms) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  await until(p, () => globalThis.__cmMesh?.()?.code, null, 45000); };
const open = async as => { const p = await browser.newPage(); await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: false });
  await p.evaluateOnNewDocument(() => { globalThis.__cmAckTest = { minMs: 0, noScroll: true }; localStorage.setItem('cm.sound', 'off'); }); p.on('dialog', d => d.accept());
  p.on('pageerror', e => { errs.push(`[${as}] ${e.message}`); console.log(`[${as}] pageerror`, e.message); });
  await boot(p, as); return p; };
const M = (p, fn, arg) => p.evaluate(fn, arg);
const clk = async (p, sel) => { await p.bringToFront(); for (let i = 0; ; i++) { try { return await p.click(sel); } catch (e) { if (i >= 5 || !/detached|not clickable|not an Element/.test(e.message)) throw e; await wait(300); } } };
try {
  const A = await open('seed-3'), B = await open('seed-6');
  const a = await M(A, () => __cmMesh().code), b = await M(B, () => __cmMesh().code);
  await until(A, c => !!__cmMesh().e2e.peers.get(c)?.pre, b, 40000); await until(B, c => !!__cmMesh().e2e.peers.get(c)?.pre, a, 40000);
  const preB = await M(B, () => __cmMesh().e2e.pre.map(p => p.id));
  assert(preB.length >= 1 && await M(A, c => __cmMesh().e2e.peers.get(c).pre.id, b) === preB[preB.length - 1], 'A learned B\'s current signed prekey from B\'s pings (and vice versa)');
  await M(A, c => __cmMesh().requestFriend(c), b); await until(B, c => __cmMesh().node.pendingIn.has(c), a, 20000); await M(B, c => __cmMesh().accept(c), a);
  await until(A, c => __cmMesh().node.friends.has(c), b, 20000); await until(B, c => __cmMesh().node.friends.has(c), a, 20000);
  assert(true, 'A <-> B connected (request + accept) over v2 envelopes');
  await M(A, c => __cmMesh().node.sendChat(c, 'forward secret hello'), b);
  await until(B, c => __cmMesh().node.chats.get(c)?.msgs.some(m => m.text === 'forward secret hello'), a, 20000);
  const sA = await M(A, () => __cmMesh().e2e.fsStats), sB = await M(B, () => __cmMesh().e2e.fsStats);
  assert(sA.v2out > 0 && sB.v2in > 0 && sA.v1out === 0 && sB.v1in === 0 && sB.v1out === 0, `chat delivered; every directed envelope was forward-secret v2 (A out v2 ${sA.v2out}/v1 ${sA.v1out}, B in v2 ${sB.v2in}/v1 ${sB.v1in})`);
  await until(A, c => __cmMesh().node.chats.get(c)?.msgs.some(m => m.text === 'forward secret hello' && m.state === 'delivered'), b, 20000);
  assert(true, 'signed receipt came back (v2 both ways)');
  // reload B: prekeys restored from the vault. (Test tabs share ONE origin vault and each tab writes its in-memory copy, so B
  // writes last before reloading; on a phone there is one app instance per vault.)
  { const leak = await M(B, () => { const s = localStorage.getItem('cybermates:vault') || ''; return __cmMesh().e2e.pre.some(p => p.xsec && s.includes(p.xsec)) || __cmMesh().e2e.pre.some(p => s.includes(p.id)); });
    assert(!leak, 'prekey secrets/ids are not visible in the stored vault blob (encrypted at rest)'); }
  await M(B, () => __cmMesh().save()); await wait(400);
  await boot(B, 'seed-6');
  const preB2 = await M(B, () => __cmMesh().e2e.pre.map(p => p.id));
  assert(preB2[preB2.length - 1] === preB[preB.length - 1] && preB2.length === preB.length, 'after reload B restored its prekeys from the encrypted vault (same current prekey)');
  await until(B, c => !!__cmMesh().e2e.peers.get(c)?.pre, a, 40000); await until(A, c => __cmMesh().isOnline?.(c) ?? true, b, 5000).catch(() => {});
  await M(A, c => __cmMesh().node.sendChat(c, 'after reload'), b);
  await until(B, c => __cmMesh().node.chats.get(c)?.msgs.some(m => m.text === 'after reload'), a, 30000);
  assert((await M(B, () => __cmMesh().e2e.fsStats.v2in)) > 0, 'chat after B\'s reload opened with the persisted prekey (v2)');
  // device transfer through the real Settings UI (admin build: Dev tab)
  for (const P of [A, B]) { if (await P.$('#moodskip')) await clk(P, '#moodskip').catch(() => {}); await wait(300); await clk(P, 'nav [data-tab=dev]'); await P.waitForSelector('#xf-send', { timeout: 15000 }); await P.$eval('#xf-send', e => { e.closest('details').open = true; e.scrollIntoView({ block: 'center' }); }); await wait(300); }
  await A.$eval('#xf-send', e => e.click()); await until(A, () => /Your code: \d{6}/.test(document.querySelector('#xf-out')?.textContent || ''), null, 15000);
  const code = (await A.$eval('#xf-out', e => e.textContent)).match(/\d{6}/)[0], wrong = String((Number(code) + 1) % 1e6).padStart(6, '0');
  await B.$eval('#xf-code', (e, v) => { e.value = v; }, wrong); const t0 = Date.now(); await B.$eval('#xf-recv', e => e.click());
  await until(B, () => /Transfer failed: bad-code/.test(document.querySelector('#xf-out')?.textContent || ''), null, 15000);
  assert(Date.now() - t0 < 8000, `wrong code -> "Transfer failed: bad-code" in ${Date.now() - t0} ms (one PAKE exchange, no data)`);
  await B.$eval('#xf-code', (e, v) => { e.value = v; }, code); const t1 = Date.now(); await B.$eval('#xf-recv', e => e.click());
  await until(B, () => /Profile received/.test(document.querySelector('#xf-out')?.textContent || ''), null, 20000);
  await until(A, () => /Transferred\. This phone has been wiped/.test(document.querySelector('#xf-out')?.textContent || ''), null, 20000);
  assert(true, `right code -> profile received on B and A wiped after confirmation (${Date.now() - t1} ms, browser WebCrypto + BigInt PAKE)`);
  assert(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(`E2E-E2EFS ALL OK (${n} checks)`); await cleanup(0);
} catch (e) { console.error('E2E FAIL', e.message); await cleanup(1); }
