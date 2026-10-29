// Browser: tap a real player's name in the Snake scoreboard -> menu with Add friend/Report/Block; AI names not tappable.
import puppeteer from 'puppeteer-core'; import { spawn } from 'node:child_process'; import fs from 'node:fs';
const PORT = 4218, U = process.env.BASE || `http://localhost:${PORT}/`, OUT = '/workspace/cybermates-shots/pmenu'; fs.mkdirSync(OUT, { recursive: true });
let srv; if (!process.env.BASE) { srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true }); await new Promise(r => setTimeout(r, 2500)); }
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 240000, args: ['--no-sandbox'] });
let fail = 0; const ok = (c, m) => { console.log(c ? 'ok' : 'FAIL', m); if (!c) fail = 1; }; const wait = ms => new Promise(r => setTimeout(r, ms));
const p = await b.newPage(); p.setDefaultTimeout(90000); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.evaluateOnNewDocument(() => localStorage.setItem('cm.sound', 'off'));
await p.goto(U + '?loaderMin=0&ftue=reset'); await p.waitForSelector('#ag-dob'); await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.$eval('#ag-go', e => e.click());
await p.waitForSelector('#tm-ok'); await p.$eval('#tm-ok', e => e.click()); await p.$eval('#tm-yes', e => e.click());
await p.waitForSelector('#losswarn', { timeout: 15000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {});
await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'), { timeout: 90000 });
await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Skip')?.click()); await wait(800); await p.evaluate(() => document.getElementById('moodpick')?.remove());
await p.$eval('nav [data-tab=arcade]', e => e.click()); await wait(2500);
await p.evaluate(() => { const w = __cmArc.world(); w.add('HUMAN1', { name: 'Ann' }); w.add('KID1', { name: 'Kid', minor: true }); }); await wait(1500);
const st = await p.evaluate(() => ({ real: [...document.querySelectorAll('#arc-players [data-pcode]')].map(e => e.dataset.pcode), botTagged: [...document.querySelectorAll('#arc-players [data-pcode]')].some(e => /AI/.test(e.textContent)) }));
ok(st.real.includes('HUMAN1') && !st.botTagged, `only real players tappable ${JSON.stringify(st)}`);
await p.$eval('#arc-players [data-pcode="HUMAN1"]', e => e.click()); await wait(300);
const acts = await p.$$eval('#pmenu [data-pact]', l => l.map(x => x.dataset.pact)); ok(acts.join() === 'add,report,block', 'menu: Add friend / Report / Block → ' + acts);
await p.screenshot({ path: `${OUT}/menu.png` });
await p.$eval('#pmenu [data-pact=add]', e => e.click()); await wait(600); ok(await p.$eval('#pmenu [data-pact=add]', e => e.disabled && /sent/i.test(e.textContent)).catch(() => false), 'Add friend sends connection request');
await p.mouse.click(5, 5); await wait(200);
if (st.real.includes('KID1')) { await p.$eval('#arc-players [data-pcode="KID1"]', e => e.click()); await wait(300); const a2 = await p.$$eval('#pmenu [data-pact]', l => l.map(x => x.dataset.pact)); ok(a2.includes('report') && !a2.includes('add'), 'adult → minor: no Add friend ' + a2); await p.mouse.click(5, 5); }
else ok(true, 'minor not placed in adult world (band separation)');
await p.$eval('#arc-players [data-pcode="HUMAN1"]', e => e.click()); await wait(300); await p.$eval('#pmenu [data-pact=block]', e => e.click()); await wait(800);
await p.$eval('#arc-players [data-pcode="HUMAN1"]', e => e.click()).catch(() => {}); await wait(300); ok(!(await p.$('#pmenu')), 'after Block: no menu for that player');
await p.evaluate(() => __cmArc.world().add('HUMAN2', { name: 'Bo' })); await wait(1500); await p.$eval('#arc-players [data-pcode="HUMAN2"]', e => e.click()).catch(() => {}); await wait(300); ok(!!(await p.$('#pmenu')), 'control: unblocked player still opens menu');
ok(!errs.length, 'no page errors ' + errs.slice(0, 2).join(' | '));
await b.close(); if (srv) process.kill(-srv.pid); console.log(fail ? 'PMENU SHOTS FAILED' : 'ALL PMENU SHOTS OK'); process.exit(fail);
