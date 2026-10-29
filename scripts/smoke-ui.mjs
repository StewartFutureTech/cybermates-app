// UX-walkthrough browser smoke (real Chrome, built app): age gate -> acknowledgement (forced scroll + minimum timer, the
// timer shortened via the test hook) -> device key in the vault -> app; Discover list/swipe toggle; profile matching card,
// starter characters, favorite games; Gaming LFG board; Friends events; reports queue; 3D glass + fullscreen untouched.
// Needs a build (npm run build). Uses vite preview unless BASE is set.
import { spawn } from 'node:child_process'; import puppeteer from 'puppeteer-core';
const PORT = Number(process.env.PORT || 4197), U = process.env.BASE || `http://localhost:${PORT}/`;
let srv; if (!process.env.BASE) { srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true }); await new Promise(r => setTimeout(r, 2500)); }
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], protocolTimeout: 120000 });
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const p = await b.newPage(); p.setDefaultTimeout(30000); await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true }); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.evaluateOnNewDocument(() => { globalThis.__cmAckTest = { minMs: 3000 }; localStorage.setItem('cm.sound', 'off'); });
  await p.goto(U + '?jackbtn=1');
  ok(!!(await p.waitForSelector('#ag-dob').catch(() => null)), '1. age check first'); await p.$eval('#ag-dob', e => e.value = '1992-03-03'); await p.$eval('#ag-go', e => e.click());
  ok(!!(await p.waitForSelector('#tm-scroll').catch(() => null)), '2. acknowledgement with scroll box'); ok(!!(await p.$('#tm-read')), 'Read-to-me button at the top');
  await p.$eval('#tm-ok', e => e.click()); await sleep(300);
  ok(await p.$eval('#tm-yes', e => e.disabled) && /Scroll/.test(await p.$eval('#tm-why', e => e.textContent)), 'Accept locked: must scroll to the end');
  await p.$eval('#tm-scroll', e => { e.scrollTop = e.scrollHeight; e.dispatchEvent(new Event('scroll')); }); await sleep(300);
  ok(await p.$eval('#tm-yes', e => e.disabled) && /keep reading/.test(await p.$eval('#tm-why', e => e.textContent)), 'Accept still locked until the minimum time');
  { const cd = await p.evaluate(() => ({ hidden: document.querySelector('#tm-cd')?.hidden, n: document.querySelector('#tm-cd-n')?.textContent, steps: document.querySelectorAll('#tm-steps li').length, lbl: document.querySelector('#tm-yes').textContent, top: document.querySelector('#tm-read').getBoundingClientRect().top < document.querySelector('#tm-scroll').getBoundingClientRect().top }));
    ok(cd.hidden === true && /^\d+$/.test(cd.n) && cd.steps === 2 && /Accept \(\d+s\)/.test(cd.lbl), 'v54: ring timer hidden, 2-step checklist (no timer step), countdown only on "Accept (Ns)"'); ok(cd.top, 'Read to me above the text'); }
  await p.$eval('#tm-yes', e => { e.disabled = false; e.click(); }); await sleep(200); ok(!!(await p.$('#tm-scroll')), 'forcing the button enabled in devtools does not bypass the gate');
  await p.waitForFunction(() => !document.querySelector('#tm-yes').disabled, { timeout: 8000 }); ok(true, 'Accept unlocks after scroll + minimum'); await p.$eval('#tm-yes', e => e.click());
  if (await p.waitForSelector('#losswarn', { timeout: 6000 }).catch(() => null)) await p.$eval('#loss-ok', e => e.click());
  if (await p.waitForSelector('#jb-go', { timeout: 20000 }).catch(() => null)) await p.$eval('#jb-go', e => e.click());
  ok(!!(await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'), { timeout: 60000 }).catch(() => null)), 'app renders after the sequence');
  // Discover list / swipe
  await sleep(1500); if (await p.$('#enable')) { await p.$eval('#enable', e => e.click()); await sleep(1500); }
  if (process.env.UI_DEBUG) console.log('   view:', (await p.$eval('#view', e => e.innerText.slice(0, 1200)).catch(() => '?')).replace(/\n/g, ' | '));
  ok(!!(await p.waitForSelector('[data-dv="list"]', { timeout: 15000 }).catch(() => null)), 'Discover: list / swipe toggle'); ok(await p.$eval('[data-dv="list"]', e => e.classList.contains('on')), 'default = list mode');
  await p.$eval('[data-dv="swipe"]', e => e.click()); ok(!!(await p.waitForSelector('.dv-card', { timeout: 8000 }).catch(() => null)), 'swipe mode shows a 3D glass card');
  const first = await p.$eval('.dv-card', e => e.textContent.slice(0, 40)); await p.$eval('.dv-pass', e => e.click()); await sleep(500); const second = await p.$eval('.dv-card', e => e.textContent.slice(0, 40)).catch(() => '');
  if (process.env.UI_DEBUG) console.log('   swipe', JSON.stringify([first, second])); ok(first !== second, 'swipe left (pass) advances to the next node'); await p.$eval('[data-dv="list"]', e => e.click()); await sleep(400);
  // Gaming LFG + Friends events
  await p.$$eval('[data-m]', bs => bs.find(b => b.dataset.m === 'gaming')?.click()); ok(!!(await p.waitForSelector('#lfg-f', { timeout: 8000 }).catch(() => null)), 'Gaming: Looking-for-group board');
  await p.$eval('#lfg-note', e => e.value = 'chill duo'); await p.$eval('#lfg-f button', e => e.click()); await sleep(600); ok(/need 2/.test(await p.$eval('#lfg', e => e.textContent)), 'LFG post appears on the board');
  await p.$$eval('[data-m]', bs => bs.find(b => b.dataset.m === 'friends')?.click()); ok(!!(await p.waitForSelector('#ev-f', { timeout: 8000 }).catch(() => null)), 'Friends: Create Event');
  await p.$eval('#ev-t', e => e.value = 'Synthwave concert'); await p.$eval('#ev-w', e => { const d = new Date(Date.now() + 2 * 864e5); e.value = d.toISOString().slice(0, 16); }); await p.$eval('#ev-f button', e => e.click()); await sleep(600);
  ok(/Synthwave concert/.test(await p.$eval('#events', e => e.textContent)), 'event posted alongside profiles');
  // Profile: matching card, presets, favorite games, reports queue
  await p.$$eval('nav button', bs => bs.find(b => b.dataset.tab === 'profile')?.click()); ok(!!(await p.waitForSelector('#mprefs', { timeout: 8000 }).catch(() => null)), 'Profile: matching card (importance, deal breakers, don\'t answer, hide)');
  ok((await p.$$('[data-preset]')).length === 6, 'six starter characters'); ok(!!(await p.$('[data-db="smoking"]')) && !!(await p.$('[data-skip="religion"]')) && !!(await p.$('[data-bub="sports"]')), 'deal-breaker toggles, "don\'t want to answer", sports bubbles');
  ok(!!(await p.$('#fg-add')), 'favorite games: console + game dropdowns');
  await p.$eval('#modq', e => e.click()); ok(!!(await p.waitForSelector('#modq-v h3', { timeout: 8000 }).catch(() => null)), 'reports & moderation queue view');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
} catch (e) { ok(false, 'exception ' + e.message); }
await b.close(); if (srv) try { process.kill(-srv.pid); } catch {}
console.log(fail ? `UI: ${fail} FAIL` : 'ALL UI OK'); process.exit(fail ? 1 : 0);
