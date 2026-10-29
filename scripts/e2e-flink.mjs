// Local multi-tab E2E (headless Chrome, BroadcastChannel transport): 5 tabs join, mood, request→accept→message (✓ on receipt), block+refund, logoff.
// Run: npm run build:admin && npm run e2e (e2e uses ?as= multi-profile tabs, which exist only in the admin/dev flavor)   (needs Chrome; CHROME_PATH overrides /usr/bin/google-chrome)
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const PORT = 4193, URL0 = `http://localhost:${PORT}/`;
const assert = (c, m) => { if (!c) { console.error('E2E FAIL', m); cleanup(1); } console.log('ok', m); };
const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-admin', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
setTimeout(() => { console.error('E2E FAIL global timeout'); cleanup(1); }, 150e3);
let browser; const cleanup = async code => { try { await browser?.close(); } catch {} try { process.kill(-srv.pid); } catch {} process.exit(code); };
await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost/.test(d) && res()); setTimeout(() => rej(new Error('preview timeout')), 15000); });
console.log('preview up'); browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
console.log('chrome up');
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (page, fn, arg, ms = 15000) => page.waitForFunction(fn, { timeout: ms, polling: 200 }, arg);
const open = async as => { const p = await browser.newPage(); await p.evaluateOnNewDocument(() => { globalThis.__cmAckTest = { minMs: 0, noScroll: true }; }); /* UX §2 ack gate: 30 s + forced scroll (tested in smoke-ui) */ p.on('dialog', d => d.accept()); p.on('pageerror', e => console.log(`[${as}] pageerror`, e.message)); await p.goto(URL0 + '?as=' + as + '&loaderMin=300');
  const ag = await p.waitForSelector('#ag-dob', { timeout: 6000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
  const terms = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (terms) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  await until(p, () => globalThis.__cmMesh?.()?.code); await until(p, () => !document.getElementById('jackin')); return p; };

// Friend link E2E: seed-1 creates a link in Friends, seed-2 types it into the Friends search bar → mutual friends.
const A = await open('seed-1'), B = await open('seed-2'); await wait(2500);
const ca = await A.evaluate(() => __cmMesh().code), cb = await B.evaluate(() => __cmMesh().code);
const tab = (p, t) => p.$eval(`nav button[data-tab="${t}"]`, b => b.click());
await A.bringToFront(); await tab(A, 'friends'); await A.waitForSelector('[data-flcreate]', { timeout: 8000 }); await A.$eval('[data-flcreate]', b => b.click());
await A.waitForSelector('[data-flcode]'); const fcode = await A.$eval('[data-flcode]', e => e.textContent.trim()); assert(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(fcode), 'create page shows code ' + fcode);
if (process.env.FL_SHOT) { await A.setViewport({ width: 390, height: 844 }); await wait(300); await A.screenshot({ path: process.env.FL_SHOT }); }
await B.bringToFront(); await tab(B, 'friends'); await B.waitForSelector('[data-flq]'); await B.type('[data-flq]', fcode.toLowerCase()); await B.$eval('[data-fljoin]', b => b.click());
await until(B, c => __cmMesh().node.friends.has(c), ca, 25000); await until(A, c => __cmMesh().node.friends.has(c), cb, 25000); assert(true, 'both tabs auto-requested + auto-accepted (mutual friends)');
assert(await A.evaluate(c => __cmFlink().status()?.added.includes(c), cb), 'create page lists the added person and stays open');
await tab(A, 'discover'); await wait(300); assert(await A.evaluate(() => !__cmFlink().status()), 'leaving the Friends page burns the code');
console.log('PASS e2e-flink'); cleanup(0);
