// (c) 3D-only: UTTT/Star Fleet raycast picking (every cell), Trivia pads, Draw & Guess easel UV, no 2D/3D toggles, duels 3D.
import puppeteer from 'puppeteer-core'; import { spawn } from 'node:child_process'; import fs from 'node:fs';
const PORT = 4220, U = process.env.BASE || `http://localhost:${PORT}/`, OUT = '/workspace/cybermates-shots/d-sfx'; fs.mkdirSync(OUT, { recursive: true });
let srv; if (!process.env.BASE) { srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true }); await new Promise(r => setTimeout(r, 2500)); }
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 240000, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
let fail = 0; const ok = (c, m) => { console.log(c ? 'ok' : 'FAIL', m); if (!c) fail = 1; }; const wait = ms => new Promise(r => setTimeout(r, ms));
async function open(q, snd = 'on') { const p = await b.newPage(); p.setDefaultTimeout(120000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: false });
  await p.evaluateOnNewDocument(s => { localStorage.setItem('cm.sound', s); globalThis.__cmSfxLog = []; }, snd);
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

{ const { p, errs } = await open('&arcmode=1v1&arcgame=uttt'); await p.waitForFunction(() => globalThis.__cmGrid, { timeout: 120000 }); await wait(1500); await p.evaluate(() => __cmGrid.freeze()); await wait(300);
  ok(await p.evaluate(() => !document.querySelector('.cm-gate')), 'no gate open (no sfx on gates)');
  const s = await p.evaluate(() => __cmGrid.cellScreen('u', 40)); await p.mouse.click(s.x, s.y); await wait(2500);
  const r = await p.evaluate(() => ({ ready: __cmSfx.ready(), log: [...__cmSfxLog] })); ok(r.ready, 'audio unlocked by the tap (tap-to-resume)'); ok(r.log.includes('place'), 'UTTT tap → "place" sound ' + r.log.join(','));
  ok(await p.evaluate(() => __cmSfx.play('explosion')), 'effect actually rendered through WebAudio'); ok(!errs.length, 'no page errors ' + errs.slice(0, 2).join(' | ')); await p.close(); }
{ const { p, errs } = await open('&arcmode=1v1&arcgame=uttt', 'off'); await p.waitForFunction(() => globalThis.__cmGrid, { timeout: 120000 }); await wait(1500); await p.evaluate(() => __cmGrid.freeze());
  const s = await p.evaluate(() => __cmGrid.cellScreen('u', 40)); await p.mouse.click(s.x, s.y); await wait(1500);
  ok(await p.evaluate(() => !__cmSfx.ready() && !__cmSfx.play('explosion')), 'muted: no effects play'); await p.close(); }
{ const { p } = await open('&arcmode=1v1&arcgame=uttt'); await p.goto(p.url().split('?')[0] + '?loaderMin=0&ftue=reset'); await p.waitForSelector('#ag-dob'); await p.mouse.click(5, 5); await wait(800);
  ok(await p.evaluate(() => !__cmSfx.play('win')), 'age gate showing: effects blocked'); await p.close(); }
await b.close(); try { if (srv) process.kill(-srv.pid); } catch {} console.log(fail ? 'D SHOTS FAILED' : 'ALL D SHOTS OK'); process.exit(fail);
