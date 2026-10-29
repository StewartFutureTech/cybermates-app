// iPhone (touch) checks: shockwave lands on the tap point after scrolling, audio unlocks on first tap, shader caps.
// npm run build && node scripts/shots-ios.mjs
import { spawn } from 'node:child_process';
import puppeteer, { KnownDevices } from 'puppeteer-core';
const OUT = process.argv[2] || '/workspace/cybermates-shots';
const srv = spawn('npx', ['vite', 'preview', '--port', '4194', '--strictPort'], { stdio: 'pipe', detached: true }); await new Promise(r => srv.stdout.on('data', d => /localhost/.test(d) && r()));
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--autoplay-policy=user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage(); await p.emulate(KnownDevices['iPhone 13']); p.on('dialog', d => d.accept()); p.on('pageerror', e => console.log('pageerror', e.message));
await p.goto('http://localhost:4194/?loaderMin=0');
const ag = await p.waitForSelector('#ag-dob', { timeout: 6000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.tap('#ag-go'); }
const t = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (t) { await p.tap('#tm-ok'); await p.tap('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav')); await new Promise(r => setTimeout(r, 400));
console.log('audio after gestures:', JSON.stringify(await p.evaluate(() => globalThis.__cmAudio?.())));
await p.tap('nav [data-tab=profile]'); await p.waitForSelector('#look'); await new Promise(r => setTimeout(r, 300));
let worst = 0;
for (const sy of [0, 900, 2200]) {
  await p.evaluate(y => window.scrollTo(0, y), sy); await new Promise(r => setTimeout(r, 250));
  const [x, y] = [120 + (sy % 7) * 10, 420];
  await p.touchscreen.tap(x, y); await new Promise(r => setTimeout(r, 70));
  let r; for (let k = 0; k < 6; k++) { r = await p.evaluate(() => { const c = document.getElementById('fxcanvas'), g = c.getContext('2d'), d = c.width / parseFloat(c.style.width), im = g.getImageData(0, 0, c.width, c.height).data; let sx = 0, sy = 0, n = 0;
    for (let j = 0; j < c.height; j += 2) for (let i = 0; i < c.width; i += 2) { const a = im[(j * c.width + i) * 4 + 3]; if (a > 40) { sx += i; sy += j; n++; } }
    return { cx: sx / n / d, cy: sy / n / d, n, scroll: scrollY, fx: globalThis.__cmFx?.() }; }); if (r.n) break; await new Promise(r => setTimeout(r, 30)); } // rAF may lag a frame under load
  if (!r.n) console.log("DEBUG", JSON.stringify(r.fx), await p.evaluate((x, y) => { const e = document.elementFromPoint(x, y); return e?.outerHTML.slice(0, 120); }, x, y));
  const off = Math.hypot(r.cx - x, r.cy - y); worst = Math.max(worst, off);
  console.log(`scrollY=${r.scroll} tap=(${x},${y}) ripple centroid=(${r.cx.toFixed(1)},${r.cy.toFixed(1)}) offset=${off.toFixed(1)}px wave=${JSON.stringify(r.fx.waves.at(-1))} VV=${JSON.stringify(r.fx.VV)}`);
  if (sy === 900) await p.screenshot({ path: `${OUT}/shockwave-iphone-scrolled.png` });
  await new Promise(r => setTimeout(r, 500));
}
console.log(worst < 6 ? `PASS ripple offset after scrolling ≤ ${worst.toFixed(1)}px` : `FAIL ripple offset ${worst.toFixed(1)}px`);
console.log('webgl caps:', await p.evaluate(() => { const c = document.createElement('canvas'); return !!c.getContext('webgl'); }));
await b.close(); process.kill(-srv.pid);
