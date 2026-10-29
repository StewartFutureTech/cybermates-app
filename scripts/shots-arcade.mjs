// Arcade + round-robin screenshots: npm run build && node scripts/shots-arcade.mjs [outdir]
// 3D shots use SwiftShader WebGL2 in headless Chrome (&force3d=1 skips the low-end gate; the 2D fallback is shot too).
import { spawn } from 'node:child_process'; import puppeteer from 'puppeteer-core';
const OUT = process.argv[2] || '/workspace/cybermates-shots', PORT = 4197, U = `http://localhost:${PORT}/`;
const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true }); srv.stderr.on('data', d => /in use/.test(d) && (console.error('FAIL preview port busy'), process.exit(1))); await new Promise(r => srv.stdout.on('data', d => /localhost/.test(d) && r()));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
process.on('exit', () => { try { process.kill(-srv.pid); } catch {} }); process.on('unhandledRejection', e => { if (/closeTarget|Target closed/.test(e.message)) return; console.error('FAIL', e.message); process.exit(1); });
const wait = ms => new Promise(r => setTimeout(r, ms)); let fail = 0; const errs = [];
const click = (p, s) => p.$eval(s, e => e.click());
async function page(q = '', ls = {}) { const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); p.on('dialog', d => d.accept()); p.on('console', m => /3D fallback|WebGL/i.test(m.text()) && console.log('console:', m.text().slice(0, 200))); p.on('pageerror', e => { errs.push(e.message); fail++; });
  await p.evaluateOnNewDocument(o => { for (const [k, v] of Object.entries(o)) localStorage.setItem(k, v); localStorage.setItem('cm.sound', 'off'); }, ls);
  await p.goto(U + '?loaderMin=0' + q); const ag = await p.waitForSelector('#ag-dob', { timeout: 6000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await click(p, '#ag-go'); }
  const t = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (t) { await click(p, '#tm-ok'); await click(p, '#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'), { timeout: 30000 }); await wait(1200); await p.evaluate(() => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Skip')?.click()); await wait(300); return p; }
const p = await page();
const hasRl = await p.$('nav [data-tab=roulette]'); console.log(hasRl ? 'ok roulette tab shown for adult' : 'FAIL roulette tab missing'); if (!hasRl) fail++;
await click(p, 'nav [data-tab=roulette]'); await p.waitForSelector('#rl-ok'); await wait(300); await p.screenshot({ path: `${OUT}/roulette-notice.png` });
await click(p, '#rl-ok'); await p.waitForSelector('#rl-start'); await click(p, '#rl-start'); await wait(600); await p.screenshot({ path: `${OUT}/roulette.png` }); await p.close();
async function arcade(name, q, { ls = {}, ms = 3000, act = null, three = false } = {}) { const pg = await page(q, three ? { 'cm.arc.3d': 'on', ...ls } : ls); await click(pg, 'nav [data-tab=arcade]'); await pg.waitForSelector('#arc-cv, #m-cv', { timeout: 10000 }); if (act) await act(pg); await wait(ms);
  if (three) { const on = await pg.evaluate(() => { const c = document.querySelector('#arc-3d-cv, #m-3d-cv'); return !!c && !c.hidden && c.width > 0; }); console.log(on ? `ok ${name}: 3D (WebGL2) rendered` : `note ${name}: 3D unavailable here -> 2D glow fallback shot`); }
  await pg.$eval('.arc-stage', e => e.scrollIntoView({ block: 'start' })); await wait(200); await pg.screenshot({ path: `${OUT}/${name}.png` }); console.log('shot', name); return pg; }
let pg = await arcade('arcade-snake', '&arcmode=mass&arcgame=snake', { ls: { 'cm.arc.3d': 'off' } }); await pg.close();
(await arcade('arcade-snake-3d', '&arcmode=mass&arcgame=snake&force3d=1', { ms: 6000, three: true })).close();
pg = await arcade('arcade-tron', '&arcmode=mass&arcgame=tron', { ls: { 'cm.arc.3d': 'off' }, act: async x => { for (const d of ['up', 'right', 'down']) { await click(x, `[data-dir=${d}]`); await wait(500); } } });
const vd = await pg.$eval('#arc-voice', e => e.checked); console.log(!vd ? 'ok adult proximity voice default off' : 'FAIL voice default'); if (vd) fail++; await pg.close();
(await arcade('arcade-tron-3d', '&arcmode=mass&arcgame=tron&force3d=1', { ms: 6000, three: true })).close();
(await arcade('arcade-tron-3d-fighter', '&arcmode=mass&arcgame=tron&force3d=1', { ls: { 'cm.arc.vehicle': 'fighter' }, ms: 6000, three: true })).close().catch(() => {});
if (process.env.BATCH === '1') { await b.close(); process.kill(-srv.pid); if (errs.length) console.log('page errors:', [...new Set(errs)].slice(0, 5).join(' | ')); console.log(fail ? 'SHOTS FAIL ' + fail : 'batch 1 shots done'); process.exit(fail ? 1 : 0); }
(await arcade('arcade-drawguess', '&arcmode=mass&arcgame=drawguess', { ms: 5000 })).close();
(await arcade('arcade-chess-3d', '&arcmode=1v1&arcgame=chess&force3d=1', { ms: 9000, three: true })).close();
(await arcade('arcade-chess-2d', '&arcmode=1v1&arcgame=chess', { ls: { 'cm.arc.3d': 'off' }, ms: 4000 })).close();
(await arcade('arcade-checkers-3d', '&arcmode=1v1&arcgame=checkers&force3d=1', { ms: 9000, three: true })).close();
(await arcade('arcade-connect4-3d', '&arcmode=2v2&arcgame=connect4&force3d=1', { ms: 9000, three: true })).close();
(await arcade('arcade-airhockey-3d', '&arcmode=1v1&arcgame=pong&force3d=1&style=airhockey', { ms: 6000, three: true })).close();
(await arcade('arcade-pong-3d', '&arcmode=2v2&arcgame=pong&force3d=1&style=pong', { ms: 6000, three: true })).close();
(await arcade('arcade-battleship', '&arcmode=2v2&arcgame=battleship', { ms: 6000 })).close();
(await arcade('arcade-uttt', '&arcmode=1v1&arcgame=uttt', { ms: 6000 })).close();
(await arcade('arcade-trivia', '&arcmode=4v4&arcgame=trivia', { ms: 3000 })).close();
(await arcade('arcade-tronduel', '&arcmode=4v4&arcgame=tronduel', { ls: { 'cm.arc.3d': 'off' }, ms: 3000 })).close();
(await arcade('arcade-snakebattle', '&arcmode=2v2&arcgame=snakebattle', { ms: 3000 })).close();
(await arcade('arcade-modes', '&arcmode=2v2', { ms: 500 })).close();
await b.close(); process.kill(-srv.pid); if (errs.length) console.log('page errors:', [...new Set(errs)].slice(0, 5).join(' | ')); console.log(fail ? 'SHOTS FAIL ' + fail : 'shots done'); process.exit(fail ? 1 : 0);
