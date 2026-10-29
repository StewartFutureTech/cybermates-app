// Loader screenshots per saved theme: npm run build && node scripts/shots-loader.mjs [outdir]
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const OUT = process.argv[2] || '/workspace/cybermates-shots', PORT = 4183, U = `http://localhost:${PORT}/`;
const srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
await new Promise(r => srv.stdout.on('data', d => /localhost/.test(d) && r()));
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const wait = ms => new Promise(r => setTimeout(r, ms));
for (const th of ['default', 'pink', 'blue', 'light']) {
  const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
  await p.evaluateOnNewDocument(t => { if (t !== 'default') localStorage.setItem('cm.theme', t); }, th);
  await p.goto(U + '?as=seed-1&loaderMin=20000&loaderMax=20000');
  const ag = await p.waitForSelector('#ag-dob', { timeout: 6000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
  const t = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (t) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  await p.waitForSelector('#jackin'); await wait(2500); await p.screenshot({ path: `${OUT}/loader-theme-${th}.png` }); await ctx.close();
}
await b.close(); process.kill(-srv.pid); console.log('done');
