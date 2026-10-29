// v55: before/after visual check for the original-name 3D games (chess@3d, connect4@3d, pong@3d) + their Flat twins.
//  Reduced motion (static camera, no pulse) so frames are comparable; captures only the .arc-stage (game render), plus a
//  full-page shot. Usage: node scripts/shots-3dmesh.mjs <distDir> <outDir> [port]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const [DIST = 'dist-admin', OUT = '/workspace/cybermates-shots/v55', PORT = '4193'] = process.argv.slice(2); mkdirSync(OUT, { recursive: true });
const URL0 = `http://localhost:${PORT}/`;
const srv = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', PORT, '--strictPort'], { stdio: 'pipe', detached: true });
let browser; const cleanup = async c => { try { await browser?.close(); } catch {} try { process.kill(-srv.pid); } catch {} process.exit(c); };
setTimeout(() => { console.error('SHOTS FAIL timeout'); cleanup(1); }, 240e3);
await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost/.test(d) && res()); setTimeout(() => rej(new Error('preview timeout')), 15000); });
browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, { timeout: ms, polling: 250 }, arg);
const wait = ms => new Promise(r => setTimeout(r, ms));
for (const game of (process.env.GAMES || 'chess@3d,connect4@3d,pong@3d,chess,connect4,pong').split(',')) {
  const p = await browser.newPage(); await p.setViewport({ width: 390, height: 844, isMobile: true, deviceScaleFactor: 1 });
  await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await p.evaluateOnNewDocument(() => { globalThis.__cmAckTest = { minMs: 0, noScroll: true }; localStorage.setItem('cm.sound', 'off'); Math.random = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    // deterministic game clock for real-time games (Air Hockey): the 40 ms match loop is paused until the 3D canvas is up, then runs exactly 50 ticks
    const si = globalThis.setInterval; globalThis.setInterval = (fn, ms, ...a) => { if (ms !== 40) return si(fn, ms, ...a); let k = 0; return si(() => { const c = document.querySelector('#m-3d-cv'); if (!c || c.hidden || k >= 50) return; k++; fn(); }, ms, ...a); }; }); p.on('dialog', d => d.accept());
  await p.goto(URL0 + '?as=seed-3&loaderMin=300&arcmode=1v1&arcgame=' + encodeURIComponent(game));
  const ag = await p.waitForSelector('#ag-dob', { timeout: 15000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
  const terms = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (terms) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  await until(p, () => globalThis.__cmMesh?.()?.code); await until(p, () => !document.getElementById('jackin')); if (await p.$('#moodskip')) await p.click('#moodskip').catch(() => {});
  await p.evaluate(() => document.getElementById('moodpick')?.remove()); await p.$eval('nav [data-tab=arcade]', e => e.click());
  await until(p, () => globalThis.__cmMatch?.()?.id); await until(p, () => { const c = document.querySelector('#m-3d-cv'); return c && !c.hidden; });
  await wait(5000); if (await p.$('#moodskip')) { await p.click('#moodskip').catch(() => {}); } await p.evaluate(() => document.getElementById('moodpick')?.remove()); await wait(1500); const f = game.replace('@', '-at-');
  const st = await p.$('.arc-stage'); await st.screenshot({ path: `${OUT}/${f}-stage.png` }); await p.screenshot({ path: `${OUT}/${f}-page.png` });
  console.log('shot', game, await p.evaluate(() => document.querySelector('.mhead b')?.textContent)); await p.close();
}
await cleanup(0);
