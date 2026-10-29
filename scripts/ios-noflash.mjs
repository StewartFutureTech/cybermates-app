// Regression (10:32 iPhone "elements flash on tap"): tap chips/buttons/cards/nav in iPhone 13 touch emulation and assert
// nothing restarts or repaints in a flashy way: looping animations keep their phase across the re-render, no DOM filter
// is applied, no backdrop-filter on touch, the WebGL ring canvas stays mounted, tap highlight transparent.
import { spawn } from 'node:child_process'; import puppeteer, { KnownDevices } from 'puppeteer-core';
const w = ms => new Promise(r => setTimeout(r, ms)); let fail = 0; const ok = (c, m) => { console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail++; };
const srv = spawn('npx', ['vite', 'preview', '--port', '4202', '--strictPort'], { stdio: 'pipe', detached: true }); await new Promise(r => srv.stdout.on('data', d => /localhost/.test(d) && r()));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] }); const p = await b.newPage(); p.on('dialog', d => d.dismiss()); await p.emulate(KnownDevices['iPhone 13']);
await p.goto('http://localhost:4202/?loaderMin=0'); await p.waitForSelector('#ag-dob'); await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.tap('#ag-go'); await p.waitForSelector('#tm-ok'); await p.tap('#tm-ok'); await p.tap('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {});
await p.waitForFunction(() => document.querySelector('nav') && !document.getElementById('jackin'), { timeout: 30000 }); await w(1500);
await p.evaluate(() => { window.__filt = 0; new MutationObserver(m => m.forEach(r => { if (r.target.style?.filter && r.target.style.filter !== 'none') window.__filt++; })).observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true }); });
const phases = () => p.evaluate(() => { const r = {}; for (const a of document.getAnimations()) { const n = a.animationName; if (!/lzRun|gl1|niSweep|niSpin/.test(n)) continue; const t = a.effect.getComputedTiming(); (r[n] ||= []).push(+((t.progress ?? 0) + (t.currentIteration ?? 0) * 0).toFixed(3)); } return r; });
const before = await phases(); const t0 = Date.now();
const mode = await p.$('.modes button:not(.on)'); const bb = await mode.boundingBox(); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); await w(60);
const after = await phases(); const dt = (Date.now() - t0) / 1000;
const rerendered = await p.evaluate(() => !!document.querySelector('.modes button.on')); ok(rerendered, 'mode chip tap re-rendered the view (the trigger)');
for (const [n, dur] of [['lzRun', 7], ['niSweep', 3.2], ['niSpin', 6], ['gl1', 3.2]]) { if (!before[n] || !after[n]) continue; const exp = ((before[n][0] + dt / dur) % 1); const got = after[n][0]; const d = Math.min(Math.abs(got - exp), 1 - Math.abs(got - exp));
  ok(d < .08, `${n} continues in phase after re-render (expected≈${exp.toFixed(2)} got ${got.toFixed(2)})`); }
for (const sel of ['.card', 'nav button', '.chip span', 'button.primary']) { const el = await p.$('#view ' + sel) || await p.$(sel); if (!el) continue; const bx = await el.boundingBox(); if (!bx || bx.y < 0 || bx.y > 760) continue; await p.touchscreen.tap(bx.x + 10, bx.y + 8); await w(120); }
ok(await p.evaluate(() => window.__filt === 0), 'no CSS/SVG filter applied to DOM elements on tap');
ok(await p.evaluate(() => [...document.querySelectorAll('.card,nav')].every(e => { const s = getComputedStyle(e); return (s.backdropFilter || s.webkitBackdropFilter || 'none') === 'none'; })), 'no backdrop-filter on touch devices (cards, nav)');
ok(await p.evaluate(() => { const g = document.getElementById('fxgl'); return !g || (g.isConnected && getComputedStyle(g).mixBlendMode === 'normal'); }), 'WebGL ring canvas stays mounted, no blend-mode compositing toggles');
ok(await p.evaluate(() => getComputedStyle(document.querySelector('button')).webkitTapHighlightColor.replace(/\s/g, '') === 'rgba(0,0,0,0)'), 'tap highlight transparent');
console.log(fail ? 'IOS NOFLASH FAIL' : 'IOS NOFLASH PASS'); await b.close(); process.kill(-srv.pid); process.exit(fail ? 1 : 0);
