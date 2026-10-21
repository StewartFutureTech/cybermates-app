// Arcade + round-robin screenshots: npm run build && node scripts/shots-arcade.mjs [outdir]
// 3D shots use SwiftShader WebGL2 in headless Chrome (&force3d=1 skips the low-end gate; the 2D fallback is shot too).
import { spawn } from 'node:child_process'; import puppeteer from 'puppeteer-core';
const OUT = process.argv[2] || '/workspace/cybermates-shots', PORT = 4197, U = 'https://cybermates-stewart-future-tech.vercel.app/';
const srv = { pid: 0 };
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
process.on('exit', () => { try { 0; } catch {} }); process.on('unhandledRejection', e => { if (/closeTarget|Target closed/.test(e.message)) return; console.error('FAIL', e.message); process.exit(1); });
const wait = ms => new Promise(r => setTimeout(r, ms)); let fail = 0; const errs = [];
const click = (p, s) => p.$eval(s, e => e.click());
async function page(q = '', ls = {}) { const p = await b.newPage(); p.setDefaultTimeout(120000); p.setDefaultNavigationTimeout(120000); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); p.on('dialog', d => d.accept()); p.on('console', m => /3D fallback|WebGL/i.test(m.text()) && console.log('console:', m.text().slice(0, 200))); p.on('console', m => m.type() === 'error' && errs.push('console: ' + m.text().slice(0,160))); p.on('pageerror', e => { errs.push(e.message); fail++; });
  await p.evaluateOnNewDocument(o => { for (const [k, v] of Object.entries(o)) localStorage.setItem(k, v); localStorage.setItem('cm.sound', 'off'); }, ls);
  await p.goto(U + '?loaderMin=0' + q); const ag = await p.waitForSelector('#ag-dob', { timeout: 6000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await click(p, '#ag-go'); }
  const t = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (t) { await click(p, '#tm-ok'); await click(p, '#tm-yes'); }
  await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'), { timeout: 30000 }); await wait(1200); await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Skip')?.click()); await wait(300); return p; }
async function arcade(name, q, { ls = {}, ms = 3000, act = null, three = false } = {}) { const pg = await page(q, three ? { 'cm.arc.3d': 'on', ...ls } : ls); await click(pg, 'nav [data-tab=arcade]'); await pg.waitForSelector('#arc-cv, #m-cv', { timeout: 10000 }); if (act) await act(pg); await wait(ms);
  if (three) { const on = await pg.evaluate(() => { const c = document.querySelector('#arc-3d-cv, #m-3d-cv'); return !!c && !c.hidden && c.width > 0; }); console.log(on ? `ok ${name}: 3D (WebGL2) rendered` : `note ${name}: 3D unavailable here -> 2D glow fallback shot`); }
  await pg.$eval('.arc-stage', e => e.scrollIntoView({ block: 'start' })); await wait(200); await pg.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot', name); return pg; }
(await arcade('arcade-airhockey-3d', '&arcmode=1v1&arcgame=pong&force3d=1&style=airhockey', { ms: 6000, three: true })).close();
(await arcade('arcade-pong-3d', '&arcmode=2v2&arcgame=pong&force3d=1&style=pong', { ms: 6000, three: true })).close();
(await arcade('arcade-battleship', '&arcmode=2v2&arcgame=battleship', { ms: 6000 })).close();
(await arcade('arcade-uttt', '&arcmode=1v1&arcgame=uttt', { ms: 6000 })).close();
(await arcade('arcade-trivia', '&arcmode=4v4&arcgame=trivia', { ms: 3000 })).close();
(await arcade('arcade-tronduel', '&arcmode=4v4&arcgame=tronduel', { ls: { 'cm.arc.3d': 'off' }, ms: 3000 })).close();
(await arcade('arcade-snakebattle', '&arcmode=2v2&arcgame=snakebattle', { ms: 3000 })).close();
await b.close(); 0; if (errs.length) console.log('page errors:', [...new Set(errs)].slice(0, 5).join(' | ')); console.log(fail ? 'SHOTS FAIL ' + fail : 'shots done'); process.exit(fail ? 1 : 0);
