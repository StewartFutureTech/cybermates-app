// Screenshots: JACK IN hue pulse (3 frames) + laser edges on main screen (iPhone 13). node scripts/shots-lasers.mjs
import { spawn } from 'node:child_process'; import puppeteer, { KnownDevices } from 'puppeteer-core';
const OUT = '/workspace/cybermates-shots', w = ms => new Promise(r => setTimeout(r, ms));
const srv = spawn('npx', ['vite', 'preview', '--port', '4198', '--strictPort'], { stdio: 'pipe', detached: true }); await new Promise(r => srv.stdout.on('data', d => /localhost/.test(d) && r()));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage(); await p.emulate(KnownDevices['iPhone 13']);
await p.goto('http://localhost:4198/?loaderMin=0'); await p.waitForSelector('#ag-dob'); await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.tap('#ag-go');
await p.waitForSelector('#tm-ok'); await p.tap('#tm-ok'); await p.tap('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); await p.waitForFunction(() => document.querySelector('nav') && !document.getElementById('jackin'), { timeout: 30000 });
await p.goto('http://localhost:4198/?loaderMin=1500&jackbtn=1'); await p.waitForSelector('#jb-go', { visible: true });
const frames = []; for (const t of [0, 850, 850]) { await w(t); frames.push(await p.screenshot({ encoding: 'base64', clip: { x: 0, y: 260, width: 390, height: 320 } })); }
await p.tap('#jb-go'); await p.waitForFunction(() => document.querySelector('nav') && !document.getElementById('jackin'), { timeout: 30000 }); await w(1200);
await p.screenshot({ path: `${OUT}/laser-edges-main.png` });
await p.tap('nav [data-tab=profile]'); await w(1500); await p.screenshot({ path: `${OUT}/laser-edges-profile.png` });
const q = await b.newPage(); await q.setViewport({ width: 1190, height: 340 });
await q.setContent(`<body style="margin:0;background:#000;display:flex;gap:10px;padding:10px">${frames.map(f => `<img style="width:390px" src="data:image/png;base64,${f}">`).join('')}</body>`); await q.screenshot({ path: `${OUT}/jackin-pulse-frames.png` });
console.log('shots ok'); await b.close(); process.kill(-srv.pid);
