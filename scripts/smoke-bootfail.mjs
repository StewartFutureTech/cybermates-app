// Boot resilience: IndexedDB, Cache Storage, SW registration and every crypto.subtle call reject with UnknownError
// (as in some in-app WKWebViews). The app must still show the age gate, terms, JACK IN and the app, with no watchdog.
// Needs a build (npm run build). Uses vite preview unless BASE is set.
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import puppeteer from 'puppeteer-core';
const PORT = Number(process.env.PORT || 4199), U = process.env.BASE || `http://localhost:${PORT}/`;
let srv; if (!process.env.BASE) { srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true }); await new Promise(r => setTimeout(r, 2500)); }
const INJ = fs.readFileSync(new URL('./inject-bootfail.js', import.meta.url), 'utf8');
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'], protocolTimeout: 120000 });
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail++; };
try {
 for (const MODE of ['cryptokey-idb', 'all']) { console.log('-- scenario', MODE);
  const p = await b.newPage(); p.setDefaultTimeout(60000); await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.evaluateOnNewDocument(m => { globalThis.__cmFailMode = m; globalThis.__cmAckTest = { minMs: 0, noScroll: true }; }, MODE); await p.evaluateOnNewDocument(INJ); await p.evaluateOnNewDocument(() => localStorage.setItem('cm.sound', 'off'));
  await p.goto(U + '?jackbtn=1');
  ok(await p.evaluate(() => window.__cmInjected), 'failures injected: ' + MODE);
  const subtleDead = await p.evaluate(() => crypto.subtle.digest('SHA-256', new Uint8Array(1)).then(() => false, () => true)); if (MODE === 'all') ok(subtleDead, 'crypto.subtle rejects');
  ok(!!(await p.waitForSelector('#ag-dob', { timeout: 20000 }).catch(() => null)), 'age gate renders');
  await p.$eval('#ag-dob', e => e.value = '1990-05-05'); await p.$eval('#ag-go', e => e.click());
  ok(!!(await p.waitForSelector('#tm-ok', { timeout: 20000 }).catch(() => null)), 'terms gate renders');
  await p.$eval('#tm-ok', e => e.click()); await p.$eval('#tm-yes', e => e.click());
  if (await p.waitForSelector('#losswarn', { timeout: 8000 }).catch(() => null)) await p.$eval('#loss-ok', e => e.click()); // first-use account-loss warning
  ok(!!(await p.waitForSelector('#jb-go', { timeout: 20000 }).catch(() => null)), 'JACK IN screen after terms');
  await p.$eval('#jb-go', e => e.click());
  ok(!!(await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav, #view'), { timeout: 60000 }).catch(() => null)), 'app renders after JACK IN');
  await new Promise(r => setTimeout(r, 10000));
  ok(!(await p.$('#cm-bootfail')), 'no boot watchdog');
  const d = await p.evaluate(() => ({ mode: localStorage.getItem('cybermates:vmode'), diag: localStorage.getItem('cm.bootdiag') })); console.log('   diag', MODE, JSON.stringify(d));
  if (MODE === 'all') ok(d.mode === 'nacl', 'vault fell back to nacl mode'); else ok(d.mode === 'raw' && /idb-raw/.test(d.diag), 'CryptoKey-in-IDB failure -> raw secret kept in IndexedDB (on-device persistence)');
  await p.reload(); if (process.env.CM_FTUE_RESET === '1') ok(!!(await p.waitForSelector('#ag-dob', { timeout: 30000 }).catch(() => null)), 'reload: FTUE reset build replays age gate'); else ok(!!(await p.waitForSelector('#jb-go, nav', { timeout: 30000 }).catch(() => null)), 'reload: gates remembered (vault readable in fallback mode)');
  ok(!errs.length, 'no uncaught page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
 await p.close(); }
} finally { await b.close(); if (srv) try { process.kill(-srv.pid); } catch {} }
console.log(fail ? `smoke-bootfail: ${fail} FAIL` : 'PASS smoke-bootfail'); process.exit(fail ? 1 : 0);
