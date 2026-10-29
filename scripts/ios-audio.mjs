// iPhone 13 touch emulation, audio: (1) fresh profile: silent on DOB/terms, music after loader; (2) RETURNING profile
// (gates skipped, plus a stale cm.sound='off' from an old build → migrated): first tap ON THE LOADER → ctx running + boot
// + music; (3) returning, no tap on loader → first tap in main app starts music. Usage: node scripts/ios-audio.mjs [url]
import { spawn } from 'node:child_process'; import puppeteer, { KnownDevices } from 'puppeteer-core';
const URL = process.argv[2]; let srv;
if (!URL) { srv = spawn('npx', ['vite', 'preview', '--port', '4197', '--strictPort'], { stdio: 'pipe', detached: true }); await new Promise(r => srv.stdout.on('data', d => /localhost/.test(d) && r())); }
const base = URL || 'http://localhost:4197/';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--autoplay-policy=user-gesture-required'] });
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail++; };
const A = p => p.evaluate(() => globalThis.__cmAudio?.()), wait = ms => new Promise(r => setTimeout(r, ms));
const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); await p.emulate(KnownDevices['iPhone 13']);
await p.goto(base + '?loaderMin=0'); await p.waitForSelector('#ag-dob', { timeout: 15000 });
await p.touchscreen.tap(195, 200); await wait(200); let a = await A(p); ok(!a.playing, 'fresh: no music on DOB screen after tap ' + JSON.stringify(a));
await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.tap('#ag-go'); await p.waitForSelector('#termsgate'); await p.tap('#tm-ok'); await wait(200);
a = await A(p); ok(!a.playing, 'fresh: no music on terms screen'); await p.tap('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {});
await p.waitForFunction(() => document.querySelector('nav') && !document.getElementById('jackin'), { timeout: 30000 }); await wait(1500);
a = await A(p); ok(a.state === 'running' && a.playing, 'fresh: music after loader → app ' + JSON.stringify(a));
// returning user: stale mute from an old build, fresh page load (no gesture yet)
await p.evaluate(() => { localStorage.setItem('cm.sound', 'off'); localStorage.removeItem('cm.soundPrefV'); });
await p.goto(base + '?loaderMin=3000&jackbtn=1'); await p.waitForSelector('#jb-go', { visible: true, timeout: 15000 }); await wait(300);
ok(!await p.$('#agegate,#termsgate'), 'returning: DOB/terms skipped'); a = await A(p); ok(a.sound, 'returning: stale mute migrated to ON ' + JSON.stringify(a));
ok(!a.playing && !await p.$('#jackin'), 'returning: big JACK IN button shown first, no sync/music yet ' + JSON.stringify(a));
await p.screenshot({ path: '/workspace/cybermates-shots/jackin-button-iphone.png' });
await p.tap('#jb-go'); await wait(500); a = await A(p); ok(a.dialing, 'JACK IN → plug + dial-up handshake playing during sync ' + JSON.stringify(a));
ok(!!await p.$('#jackin') && a.state === 'running' && !a.playing, 'returning: JACK IN tap → loader/rain + ctx running, music waits for connect ' + JSON.stringify(a));
const t0 = Date.now(); await p.waitForFunction(() => document.querySelector('nav') && !document.getElementById('jackin'), { timeout: 30000 }); ok(Date.now() - t0 >= 2000, 'loader min time kept after tap (' + (Date.now() - t0 + 500) + ' ms)'); await wait(300);
a = await A(p); ok(a.state === 'running' && a.playing && !a.dialing, 'connected → dial-up cut, chime, music in main app ' + JSON.stringify(a));
// lock screen / reopen
const vis = h => p.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => h ? 'hidden' : 'visible' }); document.dispatchEvent(new Event('visibilitychange')); }, h);
await vis(true); await wait(600); a = await A(p); ok(a.state === 'suspended', 'lock: ctx suspended ' + JSON.stringify(a));
await vis(false); await wait(900); a = await A(p); ok(a.state === 'running' && a.playing, 'unlock: visible → resumed + music ' + JSON.stringify(a));
await p.evaluate(() => globalThis.__cmAudioCtx().suspend()); await wait(300); await p.touchscreen.tap(195, 400); await wait(900); a = await A(p); ok(a.state === 'running' && a.playing, 'interruption (ctx suspended while visible) → next tap resumes (audio-fix model) ' + JSON.stringify(a));
await vis(true); await wait(300); await p.evaluate(() => globalThis.__cmAudioCtx().close()); await vis(false); await wait(300); await p.touchscreen.tap(195, 400); await wait(900); a = await A(p); ok(a.state === 'running' && a.playing, 'closed ctx → rebuilt synchronously on the next tap (no rebuild-on-timeout) ' + JSON.stringify(a));
await p.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))); await wait(300); a = await A(p); ok(a.playing, 'pageshow keeps music ' + JSON.stringify(a));
// Settings > Look & sound toggle: tap OFF stops now, tap ON (as the gesture) starts now, label reflects real state
await p.tap('nav [data-tab=profile]'); await p.waitForSelector('#lk-snd'); await p.$eval('#lk-snd', e => e.scrollIntoView({ block: 'center' })); await wait(200);
await p.tap('#lk-snd'); await wait(400); a = await A(p); ok(!a.playing && !a.sound, 'toggle OFF stops music immediately ' + JSON.stringify(a) + ' label=' + await p.$eval('#lk-snd-st', e => e.textContent));
await p.tap('#lk-snd'); await wait(400); a = await A(p); ok(a.playing && a.state === 'running' && a.sound, 'toggle ON starts music immediately ' + JSON.stringify(a) + ' label=' + await p.$eval('#lk-snd-st', e => e.textContent));
ok(await p.$eval('#lk-snd', e => e.checked) === true && await p.$eval('#lk-snd-st', e => e.textContent) === 'playing', 'toggle reflects real state');
// explicit mute (new build) persists
await p.evaluate(() => localStorage.setItem('cm.sound', 'off')); await p.goto(base + '?loaderMin=0'); await p.waitForFunction(() => document.querySelector('nav'), { timeout: 30000 });
await p.touchscreen.tap(195, 300); await wait(300); a = await A(p); ok(!a.playing && !a.sound, 'user mute set in this build is respected ' + JSON.stringify(a));
console.log(fail ? 'IOS AUDIO FAIL' : 'IOS AUDIO PASS'); await b.close(); srv && process.kill(-srv.pid); process.exit(fail ? 1 : 0);
