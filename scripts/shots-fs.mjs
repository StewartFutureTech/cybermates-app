// (b) Fullscreen button on every game: present, enters Fullscreen API on #view, exits; CSS immersive fallback when API missing.
import puppeteer from 'puppeteer-core'; import { spawn } from 'node:child_process'; import fs from 'node:fs';
const PORT = 4217, U = process.env.BASE || `http://localhost:${PORT}/`, OUT = '/workspace/cybermates-shots/fs'; fs.mkdirSync(OUT, { recursive: true });
let srv; if (!process.env.BASE) { srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true }); await new Promise(r => setTimeout(r, 2500)); }
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 240000, args: ['--no-sandbox'] });
let fail = 0; const ok = (c, m) => { console.log(c ? 'ok' : 'FAIL', m); if (!c) fail = 1; }; const wait = ms => new Promise(r => setTimeout(r, ms));
async function enter(noApi) {
  const p = await b.newPage(); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.evaluateOnNewDocument(n => { localStorage.setItem('cm.sound', 'off'); if (n) { delete Element.prototype.requestFullscreen; delete Element.prototype.webkitRequestFullscreen; Element.prototype.requestFullscreen = undefined; } }, noApi);
  await p.goto(U + '?loaderMin=0&ftue=reset'); await p.waitForSelector('#ag-dob'); await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.$eval('#ag-go', e => e.click());
  await p.waitForSelector('#tm-ok'); await p.$eval('#tm-ok', e => e.click()); await p.$eval('#tm-yes', e => e.click());
  await p.waitForSelector('#losswarn', { timeout: 15000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {});
  await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'), { timeout: 90000 });
  await p.evaluate(() => { [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Skip')?.click(); });
  await wait(800); await p.evaluate(() => document.getElementById('moodpick')?.remove());
  await p.$eval('nav [data-tab=arcade]', e => e.click()); await wait(1500); return { p, errs };
}
const state = p => p.evaluate(() => ({ btn: !!document.querySelector('.arc-stage .cm-fs-btn'), fs: document.fullscreenElement?.id || null, imm: !!document.querySelector('#view.cm-immersive') }));
async function check(p, name, noApi) {
  await p.waitForSelector('.arc-stage .cm-fs-btn', { timeout: 15000 }).catch(() => {}); let s = await state(p); ok(s.btn, `${name}: fullscreen button present`); if (!s.btn) return;
  await p.click('.arc-stage .cm-fs-btn'); await wait(500); s = await state(p);
  ok(noApi ? s.imm : s.fs === 'view', `${name}: enters ${noApi ? 'immersive fallback' : 'Fullscreen API'} ${JSON.stringify(s)}`);
  if (!noApi) await p.screenshot({ path: `${OUT}/${name}.png` });
  await p.click('.arc-stage .cm-fs-btn'); await wait(500); s = await state(p); ok(!s.fs && !s.imm, `${name}: exits fullscreen`);
}
{ const { p, errs } = await enter(false);
  for (const g of ['snake', 'tron', 'megaship', 'drawguess', 'brawl']) { await p.evaluate(g => document.querySelector(`[data-game=${g}]`)?.click(), g); await wait(1500); await check(p, g, false); }
  await p.evaluate(() => [...document.querySelectorAll('.arc-tabs button')].find(x => x.textContent.trim().toLowerCase() === '1v1')?.click()); await wait(800);
  const ids = await p.$$eval('.arc-game[data-mg]', l => l.map(x => x.dataset.mg)); ok(ids.length >= 4, `duel games listed: ${ids.join(',')}`);
  for (const id of ids) { await p.$eval(`.arc-game[data-mg="${id}"]`, e => e.click()); await wait(1500); await check(p, 'duel-' + id, false); await p.$eval('#m-back', e => e.click()).catch(() => {}); await wait(600); }
  ok(!errs.length, 'no page errors ' + errs.slice(0, 2).join(' | ')); await p.close(); }
{ const { p, errs } = await enter(true); await p.evaluate(() => document.querySelector('[data-game=snake]')?.click()); await wait(1500); await check(p, 'snake-noapi', true);
  ok(!errs.length, 'fallback: no page errors ' + errs.slice(0, 2).join(' | ')); await p.close(); }
await b.close(); if (srv) process.kill(-srv.pid); console.log(fail ? 'FS SHOTS FAILED' : 'ALL FS SHOTS OK'); process.exit(fail);
