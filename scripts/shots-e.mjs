// (e) Bingo (3D card daub + claim), Mass Trivia (3D pads), Tic-tac-toe (3D grid), room voice bar, Mega Fleet firing.
import puppeteer from 'puppeteer-core'; import { spawn } from 'node:child_process'; import fs from 'node:fs';
const PORT = 4223, U = process.env.BASE || `http://localhost:${PORT}/`, OUT = '/workspace/cybermates-shots/e'; fs.mkdirSync(OUT, { recursive: true });
let srv; if (!process.env.BASE) { srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true }); await new Promise(r => setTimeout(r, 2500)); }
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 240000, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
let fail = 0; const ok = (c, m) => { console.log(c ? 'ok' : 'FAIL', m); if (!c) fail = 1; }; const wait = ms => new Promise(r => setTimeout(r, ms));
async function open(q) { const p = await b.newPage(); p.setDefaultTimeout(120000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: false });
  await p.evaluateOnNewDocument(() => localStorage.setItem('cm.sound', 'off'));
  await p.goto(U + '?loaderMin=0&ftue=reset&tier=0&force3d=1' + q); await p.waitForSelector('#ag-dob'); await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.$eval('#ag-go', e => e.click());
  await p.waitForSelector('#tm-ok'); await p.$eval('#tm-ok', e => e.click()); await p.$eval('#tm-yes', e => e.click());
  await p.waitForSelector('#losswarn', { timeout: 15000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {});
  await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'), { timeout: 120000 });
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Skip')?.click()); await wait(800); await p.evaluate(() => document.getElementById('moodpick')?.remove());
  const [, mode, gid] = q.match(/arcmode=([^&]+)&arcgame=([^&]+)/); await p.$eval('nav [data-tab=arcade]', e => e.click()); await wait(1500);
  await p.evaluate(m => [...document.querySelectorAll('.arc-tabs button')].find(x => x.textContent.trim().toLowerCase() === (m === 'mass' ? 'mass arena' : m))?.click(), mode); await wait(1000);
  await p.evaluate(g => (document.querySelector(`.arc-game[data-mg="${g}"]`) || document.querySelector(`[data-game="${g}"]`))?.click(), gid); await wait(1500);
  return { p, errs }; }

// Tic-tac-toe
{ const { p, errs } = await open('&arcmode=1v1&arcgame=ttt'); await p.waitForFunction(() => globalThis.__cmGrid, { timeout: 120000 }); await wait(1500); await p.evaluate(() => __cmGrid.freeze()); await wait(300);
  const bad = await p.evaluate(() => [...Array(9).keys()].filter(c => { const s = __cmGrid.cellScreen('t', c), h = __cmGrid.pickAt(s.x, s.y); return !h || h.c !== c; })); ok(!bad.length, 'TTT: raycast on all 9 cells ' + bad);
  const s = await p.evaluate(() => __cmGrid.cellScreen('t', 4)); await p.mouse.click(s.x, s.y); await wait(1500); ok(await p.evaluate(() => __cmGrid.markCount >= 1), 'TTT: tap places X in 3D');
  await p.screenshot({ path: `${OUT}/ttt.png` }); ok(!errs.length, 'TTT: no page errors ' + errs.slice(0, 2).join(' | ')); await p.close(); }
// Bingo
{ const { p, errs } = await open('&arcmode=mass&arcgame=bingo'); await p.waitForFunction(() => globalThis.__cmParty?.view(), { timeout: 120000 }); await wait(2500);
  ok(await p.evaluate(() => __cmParty.room.players.size >= 8 && /\/200/.test(document.getElementById('pt-status').textContent)), 'Bingo: room filled, cap 200 shown');
  const i = await p.evaluate(() => { const R = __cmParty.room, c = R.cardOf(__cmParty.me), called = R.called(); return c.findIndex(n => n && called.has(n)); });
  if (i >= 0) { const s = await p.evaluate(i => __cmParty.view().cellScreen('bingo', i), i); await p.mouse.click(s.x, s.y); await wait(800); ok(await p.evaluate(i => __cmParty.room.players.get(__cmParty.me).daubed.has(i), i), 'Bingo: tap daubs a called number'); }
  else ok(true, 'Bingo: (no called number on card yet)');
  await p.evaluate(() => { const R = __cmParty.room; const c = R.cardOf(__cmParty.me), seq = R.called ? null : 0; const p = R.players.get(__cmParty.me); R.start -= 75 * R.callMs; [0, 1, 2, 3, 4].forEach(i => R.daub(__cmParty.me, i)); });
  await p.$eval('#bg-claim', e => e.click()); await wait(600); ok(/BINGO/.test(await p.$eval('#bg-msg', e => e.textContent)), 'Bingo: claim validated');
  ok(await p.evaluate(() => !!document.querySelector('#pv-on') && !!document.querySelector('#pv-ptt')), 'Bingo: room voice bar'); ok(await p.evaluate(() => !!document.querySelector('.arc-stage .cm-fs-btn')), 'Bingo: fullscreen button');
  await p.screenshot({ path: `${OUT}/bingo.png` }); ok(!errs.length, 'Bingo: no page errors ' + errs.slice(0, 2).join(' | ')); await p.close(); }
// Mass Trivia
{ const { p, errs } = await open('&arcmode=mass&arcgame=mtrivia'); await p.waitForFunction(() => globalThis.__cmTrivia && globalThis.__cmParty, { timeout: 120000 }); await wait(2500);
  const s = await p.evaluate(() => __cmTrivia.padScreen(2)); await p.mouse.click(s.x, s.y); await wait(800); ok(await p.evaluate(() => __cmParty.room.answered(__cmParty.me)), 'Mass Trivia: answered via 3D pad');
  await p.screenshot({ path: `${OUT}/mtrivia.png` }); ok(!errs.length, 'Mass Trivia: no page errors ' + errs.slice(0, 2).join(' | ')); await p.close(); }
// Draw & Guess voice bar + Mega Fleet firing
{ const { p, errs } = await open('&arcmode=mass&arcgame=drawguess'); await wait(3000); ok(await p.evaluate(() => !!document.querySelector('#dg-pv #pv-ptt')), 'Draw & Guess: room voice push-to-talk bar'); ok(!errs.length, 'D&G no errors ' + errs.slice(0, 2).join(' | ')); await p.close(); }
{ const { p, errs } = await open('&arcmode=mass&arcgame=megaship'); await wait(5000); const c = await p.$('#arc-3d-cv:not([hidden])') || await p.$('#arc-cv'); const bb = await c.boundingBox(); await p.mouse.click(bb.x + bb.width * 0.7, bb.y + bb.height * 0.3); await wait(1500);
  ok(!errs.some(e => /shotKey|shotSeq/.test(e)), 'Mega Fleet: firing works (no shotKey error) ' + errs.slice(0, 2).join(' | ')); await p.close(); }
await b.close(); try { if (srv) process.kill(-srv.pid); } catch {} process.exit(fail);
