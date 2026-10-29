// WebKit iPhone 14 emulation: run 3D games 32 s with forced slow frames; bloom must stay enabled (needs playwright: /workspace/wk).
// DIST=<built dir> GAMES=a,b SHOTS=<dir>. node scripts/glow-webkit.mjs (copy/run from /workspace/wk for module resolution)
import { webkit, devices } from 'playwright'; import fs from 'fs'; import path from 'path';
const DIST = process.env.DIST, SH = process.env.SHOTS, GAMES = (process.env.GAMES || 'tron,chess,pong').split(','), BASE = 'https://cm.local/';
const Q = { snake: '&arcmode=mass&arcgame=snake', tron: '&arcmode=mass&arcgame=tron', megaship: '&arcmode=mass&arcgame=megaship', brawl: '&arcmode=mass&arcgame=brawl', chess: '&arcmode=1v1&arcgame=chess', connect4: '&arcmode=1v1&arcgame=connect4', pong: '&arcmode=2v2&arcgame=pong', airhockey: '&arcmode=1v1&arcgame=pong', checkers: '&arcmode=1v1&arcgame=checkers', ttt: '&arcmode=1v1&arcgame=ttt', uttt: '&arcmode=1v1&arcgame=uttt', battleship: '&arcmode=1v1&arcgame=battleship', trivia: '&arcmode=1v1&arcgame=trivia', tronduel: '&arcmode=1v1&arcgame=tronduel', snakebattle: '&arcmode=2v2&arcgame=snakebattle', drawguess: '&arcmode=mass&arcgame=drawguess' };
const b = await webkit.launch(); let fail = 0; if (SH) fs.mkdirSync(SH, { recursive: true });
for (const g of GAMES) { const c = await b.newContext({ ...devices['iPhone 14'] });
  await c.route(BASE + '**', r => { let u = new URL(r.request().url()).pathname; if (u === '/' || !fs.existsSync(DIST + u)) u = '/index.html'; const ct = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' }[path.extname(u)] || 'application/octet-stream'; r.fulfill({ body: fs.readFileSync(DIST + u), contentType: ct }); });
  await c.addInitScript(() => { localStorage.setItem('cm.sound', 'off'); localStorage.setItem('cm.arc.3d', 'on'); localStorage.setItem('cybermates:perf-skipgates', '1'); globalThis.__cmAckTest = { minMs: 0, noScroll: true };
    const raf = globalThis.requestAnimationFrame.bind(globalThis); globalThis.requestAnimationFrame = f => raf(t => { if (globalThis.__cm3d) { const e = performance.now() + 35; while (performance.now() < e); } f(t); }); });
  const p = await c.newPage(); let row;
  try { await p.goto(BASE + '?loaderMin=0&force3d=1' + Q[g]);
    if (await p.waitForSelector('#ag-dob', { timeout: 30000 }).catch(() => null)) { await p.fill('#ag-dob', '1995-05-05'); await p.click('#ag-go'); }
    if (await p.waitForSelector('#tm-ok', { timeout: 20000 }).catch(() => null)) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.click('#loss-ok')).catch(() => {}); }
    await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'), null, { timeout: 90000 }); await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Skip')?.click());
    await p.$eval('nav [data-tab=arcade]', e => e.click()); await p.waitForFunction(() => globalThis.__cm3d, null, { timeout: 90000 }); await p.waitForTimeout(+(process.env.DUR || 32000));
    row = await p.evaluate(() => { const c = globalThis.__cm3d; return { bloom: c.bloom ?? null, tier: c.tier, scale: c.scale, fps: +c.fps.toFixed(1) }; }); if (SH) await p.screenshot({ path: `${SH}/webkit-${g}-30s.png` });
    row.pass = !!(row.bloom?.enabled && row.bloom.inComposer && row.bloom.strength > 0.2); } catch (e) { row = { pass: false, err: e.message.slice(0, 100) }; }
  console.log((row.pass ? 'ok ' : 'FAIL ') + g + ' ' + JSON.stringify(row)); if (!row.pass) fail = 1; await c.close(); }
await b.close(); console.log(fail ? 'WEBKIT GLOW: FAIL' : 'WEBKIT GLOW: ALL PASS'); process.exit(fail);
