// UX §2 + §3 browser checks (cm-v32): acknowledgement countdown/checklist with the REAL timer (no test hook) at phone widths
// 320-430, reduced motion, Read-to-me at the very top; forced profile completion in onboarding + nav lock; starter
// characters in the photo step; rolling photos rotate each login. Needs a build. node scripts/shots-ack.mjs
import { spawn } from 'node:child_process'; import puppeteer from 'puppeteer-core'; import fs from 'node:fs';
const PORT = Number(process.env.PORT || 4199), U = process.env.BASE || `http://localhost:${PORT}/`, OUT = (process.env.SHOTS || '/workspace/cybermates-shots') + '/v32-ack'; fs.mkdirSync(OUT, { recursive: true });
let srv; if (!process.env.BASE) { srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true }); await new Promise(r => setTimeout(r, 2500)); }
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'], protocolTimeout: 180000 });
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail++; }; const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = async (w, { hook = null, reduced = false, init = null } = {}) => { const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); p.setDefaultTimeout(30000); await p.setViewport({ width: w, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); if (reduced) await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await p.evaluateOnNewDocument((hook, init) => { if (hook) globalThis.__cmAckTest = hook; localStorage.setItem('cm.sound', 'off'); if (init && !sessionStorage.getItem('cm-init')) { sessionStorage.setItem('cm-init', '1'); for (const [k, v] of Object.entries(init)) localStorage.setItem(k, v); } }, hook, init); p.errs = errs; return p; };
const toAck = async p => { await p.goto(U + '?jackbtn=1&ftue=reset'); await p.waitForSelector('#ag-dob'); await p.$eval('#ag-dob', e => e.value = '1992-03-03'); await p.$eval('#ag-go', e => e.click()); await p.waitForSelector('#tm-scroll'); await sleep(400); };
const pass = async p => { await p.$eval('#tm-ok', e => e.click()); await p.$eval('#tm-scroll', e => { e.scrollTop = e.scrollHeight; e.dispatchEvent(new Event('scroll')); }); await p.waitForFunction(() => !document.querySelector('#tm-yes').disabled, { timeout: 40000 }); await p.$eval('#tm-yes', e => e.click());
  if (await p.waitForSelector('#losswarn', { timeout: 6000 }).catch(() => null)) await p.$eval('#loss-ok', e => e.click()); if (await p.waitForSelector('#jb-go', { timeout: 20000 }).catch(() => null)) await p.$eval('#jb-go', e => e.click());
  await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('#view'), { timeout: 60000 }); await sleep(800); };
try {
  if (process.env.ONLY_LATE) { } else for (const _ of [0]) {
  // 1. real timer at phone widths: countdown starts at 30 s (full terms read-aloud is minutes long, clamp = 30 s)
  for (const w of [320, 360, 390, 430]) { const p = await page(w); await toAck(p);
    const s = await p.evaluate(() => { const r = q => document.querySelector(q)?.getBoundingClientRect(); const vw = document.documentElement.clientWidth;
      return { n: +document.querySelector('#tm-cd-n').textContent, why: document.querySelector('#tm-why').textContent, read: r('#tm-read').top, scroll: r('#tm-scroll').top, h3: r('.tm-card h3').top, over: [...document.querySelectorAll('#termsgate *')].some(e => e.getBoundingClientRect().right > vw + 1), dis: document.querySelector('#tm-yes').disabled }; });
    ok(s.n >= 28 && s.n <= 30 && /Scroll/.test(s.why) && s.dis, `${w}px: countdown starts at ${s.n}s, Accept locked`); ok(s.read < s.h3 && s.read < s.scroll, `${w}px: Read to me at the very top`); ok(!s.over, `${w}px: no horizontal overflow`);
    await p.screenshot({ path: `${OUT}/ack-top-${w}.png` }); await p.$eval('#tm-scroll', e => { e.scrollTop = e.scrollHeight; e.dispatchEvent(new Event('scroll')); }); await p.$eval('#termsgate', e => e.scrollTop = e.scrollHeight); await sleep(1300);
    const s2 = await p.evaluate(() => ({ steps: [...document.querySelectorAll('#tm-steps li')].map(l => l.className), n: +document.querySelector('#tm-cd-n').textContent, lbl: document.querySelector('#tm-yes').textContent, dis: document.querySelector('#tm-yes').disabled }));
    ok(s2.steps[0] === 'done' && s2.steps[1] === '' && s2.dis && /Accept \(\d+s\)/.test(s2.lbl), `${w}px: scrolled -> step 1 done, timer still running (${s2.lbl})`); await p.screenshot({ path: `${OUT}/ack-bottom-${w}.png` });
    if (w === 390) { await p.$eval('#tm-ok', e => e.click()); const t0 = Date.now(); await p.waitForFunction(() => !document.querySelector('#tm-yes').disabled, { timeout: 40000 }); const el = (Date.now() - t0) / 1000 + 1.7;
      ok(el >= 27 && el <= 33, `real minimum timer ~30 s (unlocked after ~${el.toFixed(1)}s)`); ok(await p.$eval('#tm-cd', e => e.hidden) && (await p.$eval('#tm-yes', e => e.textContent)) === 'Accept', 'countdown hides at 0, label = Accept'); await p.screenshot({ path: `${OUT}/ack-unlocked-390.png` }); }
    ok(!p.errs.length, `${w}px: no page errors ${p.errs.slice(0, 2).join(' | ')}`); await p.close(); }
  // 2. reduced motion: static ring
  { const p = await page(375, { reduced: true }); await toAck(p); const r = await p.evaluate(() => ({ rm: document.querySelector('#termsgate').classList.contains('tm-rm'), tr: getComputedStyle(document.querySelector('#tm-cd')).transitionDuration })); ok(r.rm && /^0s/.test(r.tr), 'reduced motion: countdown ring has no transition'); await p.screenshot({ path: `${OUT}/ack-reduced-375.png` }); await p.close(); }
  // 3. fresh user: onboarding cannot finish incomplete; photo step shows the six starter characters
  { const p = await page(390, { hook: { minMs: 0, noScroll: true }, init: { 'cybermates:v2': JSON.stringify({ profiles: [], messages: [], currentUser: null }) } }); await toAck(p); await pass(p);
    ok(!!(await p.$('.onb')), 'fresh user lands in onboarding'); await p.$eval('#f_name', e => e.value = 'Nova'); await p.$eval('#next', e => e.click()); await sleep(300); await p.$eval('#f_age', e => e.value = '24'); await p.$eval('#toreview', e => e.click()); await sleep(300);
    await p.$eval('#finish', e => e.click()); await sleep(600); const r = await p.evaluate(() => ({ onb: !!document.querySelector('.onb #pf-required'), q: document.querySelector('.q')?.textContent, note: document.querySelector('#pf-required')?.textContent, nav: !!document.querySelector('nav') }));
    ok(r.onb && /gender|interests/.test(r.note) && !r.nav, `incomplete profile cannot finish: stays in setup at "${r.q}" (${r.note})`); await p.screenshot({ path: `${OUT}/onb-blocked-390.png` });
    const idx = await p.evaluate(() => [...document.querySelectorAll('.revrow')].length); void idx;
    await p.$eval('#toreview', e => e.click()); await sleep(300); const ph = await p.$$eval('.revrow', bs => bs.findIndex(x => /Photos/.test(x.textContent))); await p.$$eval('.revrow', (bs, i) => bs[i].click(), ph); await sleep(400);
    ok((await p.$$('#fld [data-preset]')).length === 6, 'photo step offers the six starter characters (goth/jock/gamer x boy/girl)'); await p.$eval('#fld [data-preset="gamer-girl"]', e => e.click()); await sleep(300);
    ok(await p.$eval('#fld [data-preset="gamer-girl"]', e => e.classList.contains('on')), 'starter character selectable'); await p.screenshot({ path: `${OUT}/onb-presets-390.png` }); ok(!p.errs.length, 'onboarding: no page errors ' + p.errs.slice(0, 2).join(' | ')); await p.close(); }
  }
  // 4. existing user with an incomplete profile: nav is locked to Profile
  { const p = await page(360, { hook: { minMs: 0, noScroll: true } }); await toAck(p); await pass(p); await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('cybermates:v2')); const me = s.profiles.find(x => x.id === s.currentUser); delete me.gender; localStorage.setItem('cybermates:v2', JSON.stringify(s)); }); await p.reload();
    await p.waitForSelector('#ag-dob'); await p.$eval('#ag-dob', e => e.value = '1992-03-03'); await p.$eval('#ag-go', e => e.click()); await p.waitForSelector('#tm-scroll'); await pass(p);
    await p.$$eval('nav button', bs => bs.find(x => x.dataset.tab === 'arcade')?.click()); await sleep(800); const r = await p.evaluate(() => ({ tab: document.querySelector('nav button.on')?.dataset.tab, req: document.querySelector('#pf-required')?.textContent }));
    ok(r.tab === 'profile' && /gender/.test(r.req || ''), `incomplete profile: tapping Arcade stays on Profile (${r.req})`); await p.screenshot({ path: `${OUT}/profile-locked-360.png` }); await p.close(); }
  // 5. rolling photos: 6 photos -> 4 shown, window advances each login, notice shown
  { const px = c => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="${c}"/></svg>`)}`; const cols = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'].map(px);
    const p = await page(430, { hook: { minMs: 0, noScroll: true } }); await toAck(p); await pass(p); const id = await p.evaluate(cols => { const s = JSON.parse(localStorage.getItem('cybermates:v2')); const me = s.profiles.find(x => x.id === s.currentUser); me.photos = cols.slice(0, 4); localStorage.setItem('cybermates:v2', JSON.stringify(s)); localStorage.setItem('cybermates:kv:photos-extra', JSON.stringify({ [me.id]: { id: me.id, list: cols.slice(4), at: 1 } })); return me.id; }, cols);
    const login = async () => { await p.reload(); await p.waitForSelector('#ag-dob'); await p.$eval('#ag-dob', e => e.value = '1992-03-03'); await p.$eval('#ag-go', e => e.click()); await p.waitForSelector('#tm-scroll'); await pass(p); return p.evaluate(id => JSON.parse(localStorage.getItem('cybermates:v2')).profiles.find(x => x.id === id).photos, id); };
    const w1 = await login(), w2 = await login(); ok(w1.length === 4 && w2.length === 4 && w1.join() !== w2.join() && new Set([...w1, ...w2]).size === 6, 'rolling photos: 4 shown, window changes each login, all 6 covered');
    await p.$$eval('nav button', bs => bs.find(x => x.dataset.tab === 'profile')?.click()); await sleep(1000); const n = await p.$eval('[data-rolling]', e => e.hidden ? '' : e.textContent).catch(() => ''); ok(/4 shown \+ 2 more on this phone only/.test(n), 'profile tells the user extras stay on the phone and rotate');
    await p.$eval('[data-rolling]', e => e.scrollIntoView({ block: 'center' })); await p.screenshot({ path: `${OUT}/rolling-430.png` }); await p.close(); }
} catch (e) { ok(false, 'exception ' + e.message); }
await b.close(); if (srv) try { process.kill(-srv.pid); } catch {}
console.log(fail ? `ACK: ${fail} FAIL` : 'ALL ACK OK'); process.exit(fail ? 1 : 0);
