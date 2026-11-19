// v58 live-UX-review fixes E2E. Public flavor (dist): a brand-new device starts blank (no "Tox (TEST)" demo profile); no placeholder/
// debug copy (UK placeholder, seed-3, TEST STORE, pricing notes); nav buttons take a normal click and the nav node survives a
// same-tab re-render; header avatar opens Profile; page content clears the ad + nav bars on every tab. Admin flavor (dist-admin,
// ?arcmode=1v1): Tron Duel / Snake Battle match screens have no ◀▲▼▶ pad; Air Hockey still has none.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const PORT = 4197, PORTA = 4198, URL0 = `http://localhost:${PORT}/`, URLA = `http://localhost:${PORTA}/`;
let browser; const srv = [];
const serve = (dir, port) => new Promise((res, rej) => { const s = spawn('npx', ['vite', 'preview', '--outDir', dir, '--port', String(port), '--strictPort'], { stdio: 'pipe', detached: true }); srv.push(s); s.stdout.on('data', d => /localhost/.test(d) && res()); setTimeout(() => rej(new Error('preview timeout')), 15000); });
const cleanup = async code => { try { await browser?.close(); } catch {} for (const s of srv) try { process.kill(-s.pid); } catch {} process.exit(code); };
const assert = (c, m) => { if (!c) { console.error('E2E FAIL', m); cleanup(1); } else console.log('ok', m); };
setTimeout(() => { console.error('E2E FAIL global timeout'); cleanup(1); }, 240e3);
process.on('unhandledRejection', e => { console.error('E2E FAIL', e?.message || e); cleanup(1); }); process.on('uncaughtException', e => { console.error('E2E FAIL', e?.message || e); cleanup(1); });
await serve('dist', PORT); await serve('dist-admin', PORTA);
browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const wait = ms => new Promise(r => setTimeout(r, ms));
const BAD = /PLACEHOLDER|\(placeholder\)|seed-3|TEST STORE|pricing notes|MESH GATE|815 ILCS/;
const page = async (w = 390, h = 844) => { const p = await (await browser.createBrowserContext()).newPage(); p.on('dialog', d => d.accept()); p.on('pageerror', e => console.log('pageerror', e.message)); await p.setViewport({ width: w, height: h });
  await p.evaluateOnNewDocument(() => { globalThis.__cmAckTest = { minMs: 0, noScroll: true }; localStorage.setItem('cm.sound', 'off'); }); return p; };
const gate = async p => { if (await p.waitForSelector('#ag-dob', { timeout: 6000 }).catch(() => null)) { const t = await p.evaluate(() => document.body.innerText); assert(!BAD.test(t), 'birthday gate: no placeholder copy'); await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
  if (await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null)) { await p.click('#tm-ok'); await wait(300); await p.click('#tm-yes').catch(() => {}); await p.waitForSelector('#loss-ok', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); } };
// ---- public flavor: fresh device
const p = await page(); await p.goto(URL0 + '?loaderMin=0'); await gate(p); await wait(1500);
{ const cu = await p.evaluate(() => JSON.parse(localStorage.getItem('cybermates:v2') || '{}').currentUser ?? null); const t = await p.$eval('#app', e => e.innerText);
  assert(cu === null && /Let's set you up/.test(t) && !/\(TEST\)|Tox|Chicago/.test(t), 'fresh device: blank onboarding, no demo profile (Tox (TEST), Chicago)');
  assert(await p.$eval('#fld input, #fld textarea', e => e.value === '').catch(() => true), 'onboarding name field starts empty'); }
// existing-user session (seed profile) for the rest of the public checks
await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('cybermates:v2')); s.currentUser = 'seed-1'; localStorage.setItem('cybermates:v2', JSON.stringify(s)); });
await p.reload(); await gate(p); await p.waitForFunction(() => document.querySelector('nav [data-tab=profile]') && !document.getElementById('jackin'), { timeout: 40000 });
await p.$eval('#moodskip', e => e.click()).catch(() => {}); await wait(800);
for (const t of ['discover', 'inbox', 'arcade', 'friends', 'profile', 'shop', 'help']) {
  await p.click(`nav [data-tab=${t}]`); await wait(900); // a normal (non-forced) click must switch tabs
  assert(await p.$eval('nav button.on', e => e.dataset.tab) === t, `nav: normal click opens ${t}`);
  const txt = await p.$eval('#view', e => e.innerText); assert(!BAD.test(txt), `${t}: no placeholder/debug copy`);
  const c = await p.evaluate(async () => { const s = document.scrollingElement; s.scrollTop = s.scrollHeight; await new Promise(r => setTimeout(r, 150)); const v = document.getElementById('view'), nav = document.querySelector('#app > nav'), ad = document.getElementById('adslot');
    const kids = [...v.querySelectorAll(':scope > *')].filter(e => e.offsetParent && e.getBoundingClientRect().height); const bottom = Math.max(...kids.map(e => e.getBoundingClientRect().bottom));
    const cover = Math.min(nav.getBoundingClientRect().top, ad ? ad.getBoundingClientRect().top : 1e9); const adOk = !ad || Math.abs(ad.getBoundingClientRect().bottom - nav.getBoundingClientRect().top) < 2; return { bottom, cover, adOk }; });
  assert(c.bottom <= c.cover + 1 && c.adOk, `${t}: content clears the ad + nav bars ${JSON.stringify(c)}`);
}
{ await p.click('nav [data-tab=discover]'); await wait(800); const same = await p.evaluate(async () => { const n = document.querySelector('#app > nav'); n.__k = 1; document.querySelector('nav [data-tab=discover]').click(); await new Promise(r => setTimeout(r, 600)); return document.querySelector('#app > nav').__k === 1; });
  assert(same, 'nav node is kept across a same-tab re-render (a click mid-refresh is not lost)'); }
{ await p.click('nav [data-tab=shop]'); await wait(800); const t = await p.$eval('#view', e => e.innerText); assert(/about \$0\.40 each/.test(t) && !/TEST STORE/.test(t), 'shop: pricing copy consistent (about $0.40 each for $1.99 / 5), no TEST STORE banner');
  const ad = await p.$eval('#adslot', e => e.innerText).catch(() => ''); assert(!/— Settings/.test(ad), 'ad bar tip does not point to a Settings page'); }
{ await p.click('nav [data-tab=discover]'); await wait(600); await p.click('header .who .av'); await wait(900); assert(await p.$eval('nav button.on', e => e.dataset.tab) === 'profile' && await p.$('#pf-top'), 'header avatar opens Profile'); }
{ const t = await p.$eval('#view', e => e.innerText); assert(!/Peer network|Status: offline/i.test(t), 'Profile has no separate offline status that contradicts Discover'); }
// ---- admin flavor: 1v1 real-time match screens
for (const [game, mode] of [['tronduel', '1v1'], ['snakebattle', '4v4'], ['tronduel', '4v4'], ['pong', '1v1']]) { const q = await page(); await q.goto(URLA + `?as=seed-3&loaderMin=0&arcmode=${mode}&arcgame=${game}`); await gate(q);
  await q.waitForFunction(() => globalThis.__cmMesh?.()?.code && document.querySelector('nav [data-tab=arcade]') && !document.getElementById('jackin'), { timeout: 40000 }); await q.$eval('#moodskip', e => e.click()).catch(() => {});
  await q.evaluate(() => document.getElementById('moodpick')?.remove()); await q.$eval('nav [data-tab=arcade]', e => e.click());
  await q.waitForSelector(`[data-mg="${game}@3d"], .match`, { timeout: 15000 }); await q.$eval(`[data-mg="${game}@3d"]`, e => e.click()).catch(() => {});
  await q.waitForFunction(() => document.querySelector('.match #m-extra') && document.querySelector('.match canvas'), { timeout: 30000 }).catch(async e => { console.log('DBG', await q.evaluate(() => document.getElementById('view')?.innerText.slice(0, 500))); throw e; }); await wait(800);
  assert(!(await q.$('#m-extra .arc-pad, #m-extra [data-dir]')), `${game} ${mode}: no ◀▲▼▶ pad`); await q.close(); }
console.log('E2E V58 PASS'); cleanup(0);
