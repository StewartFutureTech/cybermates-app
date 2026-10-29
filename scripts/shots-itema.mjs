// Item (a) browser check at 320/375/390/430 px: FTUE replay (birthday gate -> terms with 'Read to me' first -> account-loss
// warning -> mood dropdown -> header mood badge), no horizontal overflow (page, bottom nav incl. Friends, arcade tabs/cards),
// Friends tab renders, and with the reset flag a reload replays the birthday gate. Screenshots in cybermates-shots/itema.
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import puppeteer from 'puppeteer-core';
const PORT = 4215, U = process.env.BASE || `http://localhost:${PORT}/`, OUT = '/workspace/cybermates-shots/itema'; fs.mkdirSync(OUT, { recursive: true });
let srv; if (!process.env.BASE) { srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true }); await new Promise(r => setTimeout(r, 2500)); }
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 240000, args: ['--no-sandbox'] });
let fail = 0; const ok = (c, m) => { console.log(c ? 'ok' : 'FAIL', m); if (!c) fail = 1; }; const wait = ms => new Promise(r => setTimeout(r, ms));
const overflow = p => p.evaluate(() => { const vw = document.documentElement.clientWidth, bad = []; const page = document.scrollingElement.scrollWidth > vw + 1;
  for (const el of document.querySelectorAll('nav, nav button, .arc-tabs, .arc-tabs button, .arc-game, #view .card')) { if (!el.offsetParent && el.tagName !== 'NAV') continue; const r = el.getBoundingClientRect(); if (r.right > vw + 1 || r.left < -1) bad.push((el.id || el.className || el.tagName) + ':' + Math.round(r.right)); }
  const nav = document.querySelector('nav'); return { page, nav: nav ? nav.scrollWidth > nav.clientWidth + 1 : false, bad: bad.slice(0, 5) }; });
for (const W of (process.env.WIDTHS || '320,375,390,430').split(',').map(Number)) { const p = await b.newPage(); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setViewport({ width: W, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.evaluateOnNewDocument(() => { localStorage.setItem('cm.sound', 'off'); globalThis.__spoken = []; const S = { speak: u => { __spoken.push(u.text); setTimeout(() => u.onend?.(), 5); }, pause() { __spoken.push('<pause>'); }, resume() { __spoken.push('<resume>'); }, cancel() {} };
    Object.defineProperty(globalThis, 'speechSynthesis', { value: S, configurable: true }); globalThis.SpeechSynthesisUtterance = function (t) { this.text = t; }; });
  await p.goto(U + '?loaderMin=0&ftue=reset');
  await p.waitForSelector('#ag-dob'); ok(true, `${W}px: birthday gate shown`); await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.$eval('#ag-go', e => e.click());
  await p.waitForSelector('#termsgate'); const first = await p.$eval('.tm-card', c => c.querySelector('button')?.id); ok(first === 'tm-read', `${W}px: 'Read to me' is the first control on the acknowledgement`);
  await p.$eval('#tm-read', e => e.click()); await wait(400); const sp = await p.evaluate(() => __spoken.length); await p.$eval('#tm-pause', e => e.click()); await p.$eval('#tm-pause', e => e.click()); await p.$eval('#tm-stop', e => e.click());
  ok(sp >= 5 && (await p.evaluate(() => __spoken.includes('<pause>') && __spoken.includes('<resume>'))), `${W}px: Read to me speaks the terms (${sp} chunks), pause/resume/stop`);
  await p.screenshot({ path: `${OUT}/terms-${W}.png` }); await p.$eval('#tm-ok', e => e.click()); await p.$eval('#tm-yes', e => e.click());
  const lw = await p.waitForSelector('#losswarn', { timeout: 15000 }).catch(() => null); ok(!!lw && !(await p.$('#losswarn #tm-read')), `${W}px: account-loss warning on first use (no Read to me)`); if (lw) await p.$eval('#loss-ok', e => e.click());
  await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'), { timeout: 90000 }); await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Skip')?.click());
  const mp = await p.waitForSelector('#moodpick', { timeout: 20000 }).catch(() => null); ok(!!mp && !!(await p.$('#moodpick select#moodsel')), `${W}px: mood picker is a dropdown`);
  if (mp) { await p.select('#moodsel', 'gaming'); await p.click('#moodok'); await wait(300); const hb = await p.$eval('#hdr-mood', e => e.textContent).catch(() => ''); ok(/Gaming/i.test(hb), `${W}px: chosen mood shown as a header badge (${hb.trim()})`); }
  let o = await overflow(p); ok(!o.page && !o.nav && !o.bad.length, `${W}px: home — no horizontal overflow ${JSON.stringify(o)}`);
  const tabs = await p.$$eval('nav button', bs => bs.map(x => x.dataset.tab)); ok(tabs.includes('friends') && tabs.indexOf('friends') === tabs.indexOf('arcade') + 1, `${W}px: Friends tab in the bottom nav after Arcade (${tabs.join(',')})`);
  await p.$eval('nav [data-tab=friends]', e => e.click()); await p.waitForSelector('[data-friends]', { timeout: 20000 }).catch(() => null); ok(!!(await p.$('[data-friends]')), `${W}px: Friends tab renders friends + requests`); await p.screenshot({ path: `${OUT}/friends-${W}.png` });
  await p.$eval('nav [data-tab=arcade]', e => e.click()); await wait(1500); o = await overflow(p); ok(!o.page && !o.bad.length, `${W}px: arcade mode tabs + game cards fit ${JSON.stringify(o)}`); await p.screenshot({ path: `${OUT}/arcade-${W}.png` });
  for (const md of ['1v1', '2v2']) { await p.evaluate(m => [...document.querySelectorAll('.arc-tabs button')].find(x => x.textContent.trim().toLowerCase() === m)?.click(), md); await wait(800); o = await overflow(p); ok(!o.page && !o.bad.length, `${W}px: arcade ${md} cards fit ${JSON.stringify(o)}`); }
  await p.screenshot({ path: `${OUT}/arcade-2v2-${W}.png` });
  if (W === 390) { await p.goto(U + '?loaderMin=0&ftue=reset'); const g2 = await p.waitForSelector('#ag-dob', { timeout: 30000 }).catch(() => null); ok(!!g2, 'reset flag: reload replays the birthday gate'); }
  ok(!errs.length, `${W}px: no page errors ${errs.slice(0, 2).join(' | ')}`); await p.close(); }
await b.close(); if (srv) try { process.kill(-srv.pid); } catch {} console.log(fail ? 'ITEM-A SHOTS FAILED' : 'ALL ITEM-A SHOTS OK'); process.exit(fail);
