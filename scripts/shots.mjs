// Screenshot capture (not part of CI): npm run build && node scripts/shots.mjs [outdir]
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const OUT = process.argv[2] || '/workspace/cybermates-shots', PORT = 4181, U = `http://localhost:${PORT}/`;
const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => srv.stdout.on('data', d => /localhost/.test(d) && r()));
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function page(q, { reduced = false } = {}) {
  const p = await b.newPage(); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (reduced) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  p.on('dialog', d => d.accept()); await p.goto(U + q);
  const ag = await p.waitForSelector('#ag-dob', { timeout: 6000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
  const t = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (t) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  return p;
}
let p = await page('?as=seed-1&loaderMin=20000&loaderMax=20000'); await p.waitForSelector('#jackin'); await wait(1800); await p.screenshot({ path: `${OUT}/01-loader-code-rain.png` });
await wait(2500); await p.screenshot({ path: `${OUT}/02-loader-status.png` }); await p.close();
p = await page('?as=seed-1&loaderMin=20000', { reduced: true }); await p.waitForSelector('#jackin'); await wait(1500); await p.screenshot({ path: `${OUT}/03-loader-reduced-motion.png` }); await p.close();
for (const [i, th] of ['cyan', 'pink', 'blue', 'acid', 'light'].entries()) {
  p = await page(`?as=seed-1&loaderMin=0&theme=${th}`); await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('.modes')); await wait(600);
  await p.screenshot({ path: `${OUT}/1${i}-discover-${th}.png` }); await p.close();
}
p = await page('?as=seed-1&loaderMin=0'); await p.waitForFunction(() => !document.getElementById('jackin')); await p.click('nav [data-tab=profile]'); await p.waitForSelector('#look');
await p.$eval('#look', e => e.scrollIntoView({ block: 'center' })); await wait(300); await p.screenshot({ path: `${OUT}/20-settings-theme-picker.png` });
await p.$eval('input[type=text], input:not([type])', e => e.scrollIntoView({ block: 'center' })); await p.focus('input[type=text], input:not([type])'); await p.keyboard.type('neon', { delay: 60 }); await wait(80);
await p.screenshot({ path: `${OUT}/21-typing-glow.png` }); await p.close();
await b.close(); process.kill(-srv.pid); console.log('shots done');
