// Logo frames (intro draw-on → idle) + JACK IN mark. node scripts/shots-logo.mjs
import { spawn } from 'node:child_process'; import puppeteer, { KnownDevices } from 'puppeteer-core';
const OUT = '/workspace/cybermates-shots', w = ms => new Promise(r => setTimeout(r, ms));
const srv = spawn('npx', ['vite', 'preview', '--port', '4203', '--strictPort'], { stdio: 'pipe', detached: true }); await new Promise(r => srv.stdout.on('data', d => /localhost/.test(d) && r()));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] }); const p = await b.newPage(); p.on('dialog', d => d.dismiss()); await p.emulate(KnownDevices['iPhone 13']);
await p.goto('http://localhost:4203/?loaderMin=0'); await p.waitForSelector('#ag-dob'); await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.tap('#ag-go'); await p.waitForSelector('#tm-ok'); await p.tap('#tm-ok'); await p.tap('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {});
await p.waitForFunction(() => document.querySelector('nav') && !document.getElementById('jackin'), { timeout: 30000 });
await p.goto('http://localhost:4203/?loaderMin=1500&jackbtn=1'); await p.waitForSelector('#jb-go', { visible: true }); await w(1600);
const jb = await p.screenshot({ encoding: 'base64', clip: { x: 60, y: 250, width: 270, height: 330 } });
await p.tap('#jb-go'); await p.waitForFunction(() => document.querySelector('.lg'), { timeout: 30000 });
const fr = []; const clip = { x: 0, y: 0, width: 260, height: 56 }; await p.waitForFunction(() => !document.getElementById('jackin'), { timeout: 30000 }); for (const t of [60, 250, 300, 450, 2500]) { await w(t); fr.push(await p.screenshot({ encoding: 'base64', clip })); }
const q = await b.newPage(); await q.setViewport({ width: 800, height: 400 });
await q.setContent(`<body style="margin:0;background:#000;display:flex;gap:12px;padding:12px;align-items:flex-start"><div style="display:flex;flex-direction:column;gap:6px">${fr.map(f => `<img style="width:520px" src="data:image/png;base64,${f}">`).join('')}</div><img style="width:230px" src="data:image/png;base64,${jb}"></body>`);
await q.screenshot({ path: `${OUT}/logo-frames.png`, fullPage: true }); console.log('ok');
await b.close(); process.kill(-srv.pid);
