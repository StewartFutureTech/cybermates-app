// Screenshots: help desk (public build) + admin kill panel (admin build). npm run build:all && node scripts/shots-admin-help.mjs
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const OUT = process.argv[2] || '/workspace/cybermates-shots';
const serve = (dir, port) => new Promise(r => { const s = spawn('npx', ['vite', 'preview', '--outDir', dir, '--port', String(port), '--strictPort'], { stdio: 'pipe', detached: true }); s.stdout.on('data', d => /localhost/.test(d) && r(s)); });
const [pub, adm] = [await serve('dist', 4191), await serve('dist-admin', 4192)];
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function open(url) { const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true }); p.on('dialog', d => d.accept(d.type() === 'prompt' ? 'KILL' : undefined).catch(() => {})); await p.goto(url);
  const ag = await p.waitForSelector('#ag-dob', { timeout: 6000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
  const t = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (t) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'), { timeout: 30000 }); return p; }
let p = await open('http://localhost:4191/?loaderMin=0');
const tabs = await p.$$eval('nav [data-tab]', x => x.map(e => e.dataset.tab).join(',')); console.log('public nav:', tabs);
await p.click('nav [data-tab=help]'); await p.waitForSelector('[data-help]');
for (const q of ['How do I cancel my subscription?', 'someone is harassing me']) { await p.type('#hq', q); await p.click('#hf button'); await wait(300); }
await p.click('#hreport'); await wait(300); await p.screenshot({ path: `${OUT}/help-desk.png` }); await p.screenshot({ path: `${OUT}/help-desk-full.png`, fullPage: true });
p = await open('http://localhost:4192/?loaderMin=0'); console.log('admin nav:', await p.$$eval('nav [data-tab]', x => x.map(e => e.dataset.tab).join(',')));
await p.click('nav [data-tab=dev]'); await p.waitForSelector('[data-admin=kill]'); await p.type('#ak-key', 'wrong-key-demo'); await p.$eval('[data-admin=kill]', e => e.scrollIntoView({ block: 'start' })); await wait(200);
await p.click('#ak-kill'); await wait(800); await p.$eval('[data-admin=kill]', e => e.scrollIntoView({ block: 'start' }));
console.log('kill result:', await p.$eval('#ak-out', e => e.textContent)); await p.screenshot({ path: `${OUT}/admin-kill-button.png` });
await p.select('#ab-cat', 'csam'); await p.type('#ab-code', 'BADCODE123'); await p.$eval('[data-admin=ban]', e => e.scrollIntoView({ block: 'start' })); await wait(300); await p.screenshot({ path: `${OUT}/admin-ban-csam.png` });
await b.close(); [pub, adm].forEach(s => process.kill(-s.pid)); console.log('done');
