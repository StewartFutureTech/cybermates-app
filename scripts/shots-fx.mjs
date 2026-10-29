// Cursor / tap / drag effects screenshots (desktop, fine pointer). npm run build && node scripts/shots-fx.mjs
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const OUT = process.argv[2] || '/workspace/cybermates-shots';
const srv = spawn('npx', ['vite', 'preview', '--port', '4193', '--strictPort'], { stdio: 'pipe', detached: true }); await new Promise(r => srv.stdout.on('data', d => /localhost/.test(d) && r()));
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 900, height: 700 }); await p.evaluateOnNewDocument(() => localStorage.setItem('cm.forceFinePointer', '1')); p.on('dialog', d => d.accept()); await p.goto('http://localhost:4193/?loaderMin=0');
const ag = await p.waitForSelector('#ag-dob', { timeout: 6000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
const t = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (t) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('.modes')); await new Promise(r => setTimeout(r, 500));
console.log('dbg', await p.evaluate(() => [navigator.hardwareConcurrency, matchMedia('(pointer: fine)').matches, matchMedia('(prefers-reduced-motion: reduce)').matches, document.documentElement.className, localStorage.getItem('cm.fx')])); console.log('fx canvas:', await p.evaluate(() => !!document.getElementById('fxcanvas') && document.documentElement.classList.contains('cfx')));
const btn = await p.$('.modes [data-m=gaming]'); const bb = await btn.boundingBox();
await p.mouse.move(200, 600); for (let i = 0; i <= 10; i++) await p.mouse.move(200 + i * ((bb.x + bb.width / 2 - 200) / 10), 600 + i * ((bb.y + bb.height / 2 - 600) / 10));
await p.screenshot({ path: `${OUT}/fx-cursor-hover.png` });
await p.mouse.move(150, 300); await p.mouse.down(); for (let i = 0; i < 14; i++) { await p.mouse.move(150 + i * 35, 300 + Math.sin(i / 2) * 60); } await p.screenshot({ path: `${OUT}/fx-drag-trail.png` }); await p.mouse.up();
await p.mouse.move(600, 420); await p.mouse.down(); await new Promise(r => setTimeout(r, 90)); await p.screenshot({ path: `${OUT}/fx-tap-shockwave.png` }); await p.mouse.up();
await b.close(); process.kill(-srv.pid); console.log('done');
