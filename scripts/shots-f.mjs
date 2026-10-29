// (f) models + perf pass: screenshot each target game in 3D. node scripts/shots-f.mjs before|after
import puppeteer from 'puppeteer-core'; import { spawn } from 'node:child_process'; import fs from 'node:fs';
const label = process.argv[2] || 'run', PORT = 4231, U = process.env.BASE || `http://localhost:${PORT}/`, OUT = '/workspace/cybermates-shots/f'; fs.mkdirSync(OUT, { recursive: true });
let srv; if (!process.env.BASE) { srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true }); await new Promise(r => setTimeout(r, 2500)); }
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 240000, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const wait = ms => new Promise(r => setTimeout(r, ms)); const res = [];
const G = { connect4: '1v1&arcgame=connect4', starfleet: '1v1&arcgame=battleship', trivia: '1v1&arcgame=trivia', ttt: '1v1&arcgame=ttt', drawguess: 'mass&arcgame=drawguess', brawl: 'mass&arcgame=brawl', bingo: 'mass&arcgame=bingo', mtrivia: 'mass&arcgame=mtrivia' };
const only = process.argv[3]?.split(',');
for (const [name, q0] of Object.entries(G)) { if (only && !only.includes(name)) continue; const q = '&arcmode=' + q0;
  const p = await b.newPage(); p.setDefaultTimeout(120000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: false });
  await p.evaluateOnNewDocument(() => { localStorage.setItem('cm.sound', 'off'); localStorage.setItem('cm.arc.3d', 'on'); globalThis.__cmAckTest = { minMs: 0, noScroll: true }; });
  await p.goto(U + '?loaderMin=0&ftue=reset&tier=2&force3d=1' + q); await p.waitForSelector('#ag-dob'); await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.$eval('#ag-go', e => e.click());
  await p.waitForSelector('#tm-ok'); await p.$eval('#tm-ok', e => e.click()); await p.$eval('#tm-yes', e => e.click());
  await p.waitForSelector('#losswarn', { timeout: 15000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {});
  await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'), { timeout: 120000 });
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Skip')?.click()); await wait(800); await p.evaluate(() => document.getElementById('moodpick')?.remove());
  const [, mode, gid] = q.match(/arcmode=([^&]+)&arcgame=([^&]+)/); await p.$eval('nav [data-tab=arcade]', e => e.click()); await wait(1500);
  await p.evaluate(m => [...document.querySelectorAll('.arc-tabs button')].find(x => x.textContent.trim().toLowerCase() === (m === 'mass' ? 'mass arena' : m))?.click(), mode); await wait(1000);
  await p.evaluate(g => (document.querySelector(`.arc-game[data-mg="${g}"]`) || document.querySelector(`[data-game="${g}"]`))?.click(), gid); await wait(9000);
  const info = await p.evaluate(() => ({ fs: !!document.querySelector('.cm-fs-btn'), three: [...document.querySelectorAll('canvas')].some(c => !c.hidden && c.offsetParent && c.getContext && /3d|pt-cv|cv/.test(c.id) && c.width > 0) , tier: globalThis.__cm3d?.tier, fps: Math.round(globalThis.__cm3d?.fps || 0), twoD: !!document.querySelector('.cm-3dnote') }));
  await p.screenshot({ path: `${OUT}/${label}-${name}.png` }); if (label !== 'before') { await p.evaluate(() => document.querySelector('.arc-stage')?.scrollIntoView({ block: 'center' })); await wait(1200); await p.screenshot({ path: `${OUT}/${label}-${name}-stage.png` }); } const row = { name, ...info, errs: errs.slice(0, 2) }; res.push(row); console.log(JSON.stringify(row)); await p.close(); }
await b.close(); try { if (srv) process.kill(-srv.pid); } catch {} fs.writeFileSync(`${OUT}/${label}.json`, JSON.stringify(res, null, 1));
