// (c) 3D-only: UTTT/Star Fleet raycast picking (every cell), Trivia pads, Draw & Guess easel UV, no 2D/3D toggles, duels 3D.
import puppeteer from 'puppeteer-core'; import { spawn } from 'node:child_process'; import fs from 'node:fs';
const PORT = 4219, U = process.env.BASE || `http://localhost:${PORT}/`, OUT = '/workspace/cybermates-shots/c3d'; fs.mkdirSync(OUT, { recursive: true });
let srv; if (!process.env.BASE) { srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true }); await new Promise(r => setTimeout(r, 2500)); }
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 240000, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
let fail = 0; const ok = (c, m) => { console.log(c ? 'ok' : 'FAIL', m); if (!c) fail = 1; }; const wait = ms => new Promise(r => setTimeout(r, ms));
async function open(q) { const p = await b.newPage(); p.setDefaultTimeout(120000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: false });
  await p.evaluateOnNewDocument(() => localStorage.setItem('cm.sound', 'off'));
  await p.goto(U + '?loaderMin=0&ftue=reset&tier=0&force3d=1' + q); await p.waitForSelector('#ag-dob'); await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.$eval('#ag-go', e => e.click());
  await p.waitForSelector('#tm-ok'); await p.$eval('#tm-ok', e => e.click()); await p.$eval('#tm-yes', e => e.click());
  await p.waitForSelector('#losswarn', { timeout: 15000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {});
  await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'), { timeout: 120000 });
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Skip')?.click()); await wait(800); await p.evaluate(() => document.getElementById('moodpick')?.remove());
  const [, mode, gid] = q.match(/arcmode=([^&]+)&arcgame=([^&]+)/); await p.$eval('nav [data-tab=arcade]', e => e.click()); await wait(1500);
  await p.evaluate(m => [...document.querySelectorAll('.arc-tabs button')].find(x => x.textContent.trim().toLowerCase() === (m === 'mass' ? 'mass arena' : m))?.click(), mode); await wait(1000);
  await p.evaluate(g => (document.querySelector(`.arc-game[data-mg="${g}"]`) || document.querySelector(`[data-game="${g}"]`))?.click(), gid); await wait(1500);
  return { p, errs }; }
const noToggle = p => p.evaluate(() => !document.querySelector('#m-3d, #arc-3d, #br-3d'));
// UTTT
{ const { p, errs } = await open('&arcmode=1v1&arcgame=uttt'); await p.waitForFunction(() => globalThis.__cmGrid, { timeout: 120000 }); await wait(1500); await p.evaluate(() => __cmGrid.freeze()); await wait(300);
  const bad = await p.evaluate(() => { const bad = []; for (let c = 0; c < 81; c++) { const s = __cmGrid.cellScreen('u', c), h = __cmGrid.pickAt(s.x, s.y); if (!h || h.c !== c) bad.push(c); } return bad; });
  ok(!bad.length, `UTTT: raycast hits the right cell for all 81 cells (bad: ${bad.join(',')})`);
  const before = await p.evaluate(() => __cmGrid.markCount); const s = await p.evaluate(() => __cmGrid.cellScreen('u', 40)); await p.mouse.click(s.x, s.y); await wait(1200);
  ok(await p.evaluate(n => __cmGrid.markCount > n, before), 'UTTT: real tap on centre cell places a 3D mark');
  ok(await noToggle(p), 'UTTT: no 2D/3D toggle'); ok(await p.evaluate(() => document.getElementById('m-cv').hidden && !document.getElementById('m-3d-cv').hidden), 'UTTT: 3D canvas shown, 2D hidden');
  await p.screenshot({ path: `${OUT}/uttt.png` }); ok(!errs.length, 'UTTT: no page errors ' + errs.slice(0, 2).join(' | ')); await p.close(); }
// Star Fleet
{ const { p, errs } = await open('&arcmode=1v1&arcgame=battleship'); await p.waitForFunction(() => globalThis.__cmGrid, { timeout: 120000 }); await wait(1500); await p.evaluate(() => __cmGrid.freeze()); await wait(300);
  const bad = await p.evaluate(() => { const bad = []; for (const b of ['mine', 'enemy']) for (let c = 0; c < 100; c++) { const s = __cmGrid.cellScreen(b, c), h = __cmGrid.pickAt(s.x, s.y); if (!h || h.c !== c || h.b !== b) bad.push(b + c); } return bad; });
  ok(!bad.length, `Star Fleet: raycast correct on all 200 cells (bad: ${bad.slice(0, 8).join(',')})`);
  const n0 = await p.evaluate(() => __cmGrid.markCount); const s = await p.evaluate(() => __cmGrid.cellScreen('enemy', 55)); await p.mouse.click(s.x, s.y); await wait(1200);
  ok(await p.evaluate(n => __cmGrid.markCount > n, n0), 'Star Fleet: tap on enemy waters fires (hit/miss orb appears)');
  ok(await noToggle(p), 'Star Fleet: no toggle'); await p.screenshot({ path: `${OUT}/starfleet.png` }); ok(!errs.length, 'Star Fleet: no page errors ' + errs.slice(0, 2).join(' | ')); await p.close(); }
// Trivia
{ const { p, errs } = await open('&arcmode=1v1&arcgame=trivia'); await p.waitForFunction(() => globalThis.__cmTrivia, { timeout: 120000 }); await wait(2000);
  const r = await p.evaluate(() => [0, 1, 2, 3].map(i => { const s = __cmTrivia.padScreen(i); return __cmTrivia.pickAt(s.x, s.y); })); ok(r.join() === '0,1,2,3', 'Trivia: each answer pad picks its own answer ' + r);
  ok(await p.evaluate(() => !document.getElementById('tv-ch')), 'Trivia: 2D answer buttons hidden in 3D');
  const s = await p.evaluate(() => __cmTrivia.padScreen(1)); await p.mouse.click(s.x, s.y); await wait(800); ok(/waiting|thinking|live|your move|·/i.test(await p.$eval('#m-status', e => e.textContent)), 'Trivia: answered via 3D pad, status shown');
  await p.screenshot({ path: `${OUT}/trivia.png` }); ok(!errs.length, 'Trivia: no page errors ' + errs.slice(0, 2).join(' | ')); await p.close(); }
// Draw & Guess
{ const { p, errs } = await open('&arcmode=mass&arcgame=drawguess'); await p.waitForFunction(() => globalThis.__cmDraw, { timeout: 120000 }); await wait(1500);
  let d; for (let k = 0; k < 4; k++) { d = await p.evaluate(() => [[0.2, 0.3], [0.5, 0.5], [0.85, 0.7]].map(([x, y]) => { const s = __cmDraw.toScreen(x, y); const uv = __cmDraw.uvAt({ clientX: s.x, clientY: s.y }); return uv ? Math.hypot(uv[0] - x, uv[1] - y) : 9; })); if (d.every(e => e < 0.02)) break; await wait(700); }
  ok(d.every(e => e < 0.02), 'Draw & Guess: pointer → easel UV mapping exact (err ' + d.map(x => x.toFixed(3)) + ')');
  ok(await noToggle(p) && await p.evaluate(() => document.getElementById('arc-cv').hidden), 'Draw & Guess: 3D easel, no toggle');
  await p.screenshot({ path: `${OUT}/drawguess.png` }); ok(!errs.length, 'D&G: no page errors ' + errs.slice(0, 2).join(' | ')); await p.close(); }
// Snake Battle, Tron Duel, Brawl: 3D on, no toggle
for (const [q, name, sel] of [['&arcmode=2v2&arcgame=snakebattle', 'Snake Battle', '#m-3d-cv'], ['&arcmode=1v1&arcgame=tronduel', 'Tron Duel', '#m-3d-cv'], ['&arcmode=mass&arcgame=brawl', 'Brawl', '#br-3d-cv']]) {
  const { p, errs } = await open(q); await wait(5000); ok(await p.evaluate(s => { const c = document.querySelector(s); return !!c && !c.hidden; }, sel) && await noToggle(p), `${name}: 3D, no toggle`);
  await p.screenshot({ path: `${OUT}/${name.replace(/ /g, '')}.png` }); ok(!errs.length, `${name}: no page errors ` + errs.slice(0, 2).join(' | ')); await p.close(); }
await b.close(); try { if (srv) process.kill(-srv.pid); } catch {} console.log(fail ? 'C SHOTS FAILED' : 'ALL C SHOTS OK'); process.exit(fail);
