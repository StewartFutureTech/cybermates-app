// Regression (8:32): fresh profile, iPhone 13 touch emulation: DOB → terms → touch-SCROLL terms (drags + taps) → accept.
// Asserts: terms overlay scrolls & keeps position (no reset/re-render), no filter ever applied, Accept reachable, app loads.
import { spawn } from 'node:child_process'; import puppeteer, { KnownDevices } from 'puppeteer-core';
const URL = process.argv[2] || null; let srv;
if (!URL) { srv = spawn('npx', ['vite', 'preview', '--port', '4196', '--strictPort'], { stdio: 'pipe', detached: true }); await new Promise(r => srv.stdout.on('data', d => /localhost/.test(d) && r())); }
const base = URL || 'http://localhost:4196/';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); await p.emulate(KnownDevices['iPhone 13']);
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail++; }; p.on('pageerror', e => ok(false, 'pageerror ' + e.message));
await p.goto(base + '?loaderMin=0');
await p.waitForSelector('#ag-dob', { timeout: 15000 }); await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.tap('#ag-go');
await p.waitForSelector('#termsgate', { timeout: 8000 }); await new Promise(r => setTimeout(r, 900)); await p.screenshot({ path: '/workspace/cybermates-shots/terms-rain-iphone.png' });
await p.evaluate(() => { window.__mut = 0; window.__filt = 0; const tg = document.getElementById('termsgate'); window.__tg = tg;
  new MutationObserver(m => m.forEach(r => { if (r.removedNodes.length && [...r.removedNodes].includes(tg)) window.__mut++; })).observe(document.body, { childList: true });
  new MutationObserver(m => m.forEach(r => { if (r.target.style?.filter) window.__filt++; })).observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true }); });
const c = await p.createCDPSession(); const drag = async (y0, y1) => { await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: y0 }] });
  for (let k = 1; k <= 8; k++) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: y0 + (y1 - y0) * k / 8 }] }); await new Promise(r => setTimeout(r, 16)); }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await new Promise(r => setTimeout(r, 120)); };
await p.touchscreen.tap(195, 300); await new Promise(r => setTimeout(r, 200)); // first gesture (audio unlock) on terms
{ const a = await p.evaluate(() => globalThis.__cmAudio?.()); ok(a && !a.playing, 'no music on terms screen after a tap ' + JSON.stringify(a)); }
await c.send('Input.synthesizeScrollGesture', { x: 195, y: 600, yDistance: -500, gestureSourceType: 'touch', speed: 1200 });
for (let i = 0; i < 4; i++) await drag(650, 250);
const st = await p.evaluate(() => ({ top: document.getElementById('termsgate')?.scrollTop, max: (t => t.scrollHeight - t.clientHeight)(document.getElementById('termsgate')), same: document.getElementById('termsgate') === window.__tg }));
ok(st.same && st.top > 0, `terms overlay touch-scrolled (scrollTop ${st.top}/${st.max}), same element (no re-render)`);
await p.touchscreen.tap(200, 200); await new Promise(r => setTimeout(r, 300));
const st2 = await p.evaluate(() => document.getElementById('termsgate').scrollTop); ok(Math.abs(st2 - st.top) < 2, `tap on terms keeps scroll position (${st2})`);
const vis = await p.$eval('#tm-yes', e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= (visualViewport?.height || innerHeight); }); ok(vis, 'Accept button visible on screen (sticky)');
await p.tap('#tm-ok'); await p.tap('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {});
const st3 = await p.evaluate(() => ({ mut: window.__mut, filt: window.__filt })); ok(st3.filt === 0, 'no CSS filter applied during onboarding');
await p.waitForFunction(() => !document.getElementById('termsgate') && document.querySelector('nav'), { timeout: 30000 }).then(() => ok(true, 'accepted → app loaded'), () => ok(false, 'app did not load after accept'));
await new Promise(r => setTimeout(r, 2500)); { const a = await p.evaluate(() => globalThis.__cmAudio?.()); ok(a?.playing, 'music plays once loader/app reached ' + JSON.stringify(a)); }
await p.screenshot({ path: '/workspace/cybermates-shots/ios-onboarding-after-accept.png' });
console.log(fail ? 'IOS ONBOARDING FAIL' : 'IOS ONBOARDING PASS'); await b.close(); srv && process.kill(-srv.pid); process.exit(fail ? 1 : 0);
