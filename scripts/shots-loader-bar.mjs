import { spawn } from 'node:child_process'; import puppeteer, { KnownDevices } from 'puppeteer-core';
const srv = spawn('npx', ['vite', 'preview', '--port', '4199', '--strictPort'], { stdio: 'pipe', detached: true, cwd: '/workspace/cybermates' }); await new Promise(r => srv.stdout.on('data', d => /localhost/.test(d) && r()));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] }); const p = await b.newPage(); await p.emulate(KnownDevices['iPhone 13']);
await p.goto('http://localhost:4199/?loaderMin=0'); await p.waitForSelector('#ag-dob'); await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.tap('#ag-go'); await p.waitForSelector('#tm-ok'); await p.tap('#tm-ok'); await p.tap('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {});
await p.waitForFunction(() => document.querySelector('nav') && !document.getElementById('jackin'), { timeout: 30000 });
await p.goto('http://localhost:4199/?loaderMin=6000'); await p.waitForSelector('#jackin'); await new Promise(r => setTimeout(r, 1300));
await p.screenshot({ path: '/workspace/cybermates-shots/loader-dots-bar.png' }); await b.close(); process.kill(-srv.pid);
