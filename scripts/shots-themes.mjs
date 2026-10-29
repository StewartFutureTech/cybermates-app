// 11-theme grid screenshot: node scripts/shots-themes.mjs [outdir]
import { spawn } from 'node:child_process'; import puppeteer from 'puppeteer-core'; import { THEMES } from '../src/theme.js';
const OUT = process.argv[2] || '/workspace/cybermates-shots';
const srv = spawn('npx', ['vite', 'preview', '--port', '4195', '--strictPort'], { stdio: 'pipe', detached: true }); await new Promise(r => srv.stdout.on('data', d => /localhost/.test(d) && r()));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage(); await p.setViewport({ width: 390, height: 720 }); p.on('dialog', d => d.accept());
await p.goto('http://localhost:4195/?loaderMin=0');
const ag = await p.waitForSelector('#ag-dob', { timeout: 6000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
const t = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (t) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'));
const imgs = [];
for (const [id, name] of THEMES) { await p.evaluate(id => { localStorage.setItem('cm.theme', id); localStorage.setItem('cm.sound', 'off'); }, id);
  await p.goto('http://localhost:4195/?loaderMin=1200'); await new Promise(r => setTimeout(r, 700)); const rain = await p.screenshot({ encoding: 'base64' });
  await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'), { timeout: 25000 }); await new Promise(r => setTimeout(r, 300));
  imgs.push([name, rain, await p.screenshot({ encoding: 'base64' })]); }
await p.setViewport({ width: 1900, height: 1500 });
await p.setContent(`<body style="margin:0;background:#05070d;font:600 15px sans-serif;color:#cfe;display:grid;grid-template-columns:repeat(6,1fr);gap:10px;padding:10px">${imgs.map(([n, a, c]) => `<figure style="margin:0"><div style="display:flex;gap:3px"><img style="width:50%" src="data:image/png;base64,${a}"><img style="width:50%" src="data:image/png;base64,${c}"></div><figcaption style="text-align:center;padding:4px">${n}</figcaption></figure>`).join('')}</body>`);
await p.screenshot({ path: `${OUT}/themes-grid-11.png`, fullPage: true }); console.log('ok', imgs.length);
await b.close(); process.kill(-srv.pid);
