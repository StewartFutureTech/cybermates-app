// cm-v33 UX §5 browser checks at 320/360/390/430 px: Matching card (per-mode age range / min % / soft-hard compare,
// deal breakers with accept lists), Dating toggle shows/hides dating-only fields live, saved values are clamped into the
// user's age band, Discover match bar + gender filter in Dating ONLY, minor sees no Dating anywhere. Needs a build.
import { spawn } from 'node:child_process'; import puppeteer from 'puppeteer-core'; import fs from 'node:fs';
const PORT = Number(process.env.PORT || 4198), U = process.env.BASE || `http://localhost:${PORT}/`, OUT = (process.env.SHOTS || '/workspace/cybermates-shots') + '/v33-match'; fs.mkdirSync(OUT, { recursive: true });
let srv; if (!process.env.BASE) { srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true }); await new Promise(r => setTimeout(r, 2500)); }
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'], protocolTimeout: 180000 });
let fail = 0, n = 0; const ok = (c, m) => { n++; console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail++; }; const sleep = ms => new Promise(r => setTimeout(r, ms));
const page = async w => { const ctx = await b.createBrowserContext(); const p = await ctx.newPage(); p.setDefaultTimeout(30000); await p.setViewport({ width: w, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); await p.evaluateOnNewDocument(() => { globalThis.__cmAckTest = { minMs: 0, noScroll: true }; localStorage.setItem('cm.sound', 'off'); }); p.errs = errs; return p; };
const login = async (p, dob = '1992-03-03', first = false) => { if (first) await p.goto(U + '?jackbtn=1&ftue=reset'); else await p.reload(); await p.waitForSelector('#ag-dob'); await p.$eval('#ag-dob', (e, d) => e.value = d, dob); await p.$eval('#ag-go', e => e.click());
  await p.waitForSelector('#tm-scroll'); await sleep(300); await p.$eval('#tm-ok', e => e.click()); await p.waitForFunction(() => !document.querySelector('#tm-yes').disabled, { timeout: 40000 }); await p.$eval('#tm-yes', e => e.click());
  if (await p.waitForSelector('#losswarn', { timeout: 6000 }).catch(() => null)) await p.$eval('#loss-ok', e => e.click()); if (await p.waitForSelector('#jb-go', { timeout: 20000 }).catch(() => null)) await p.$eval('#jb-go', e => e.click());
  await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('#view'), { timeout: 60000 }); await sleep(800);
  if (await p.waitForSelector('#moodskip', { timeout: 2500 }).catch(() => null)) { await p.$eval('#moodskip', e => e.click()); await sleep(300); } }; // first-time mood picker shows every load in testing
const patchMe = (p, o) => p.evaluate(o => { const s = JSON.parse(localStorage.getItem('cybermates:v2')); const me = s.profiles.find(x => x.id === s.currentUser); Object.assign(me, o); for (const k of Object.keys(o)) if (o[k] === null) delete me[k]; localStorage.setItem('cybermates:v2', JSON.stringify(s)); }, o);
const meNow = p => p.evaluate(() => { const s = JSON.parse(localStorage.getItem('cybermates:v2')); return s.profiles.find(x => x.id === s.currentUser); });
const tab = async (p, t) => { await p.$$eval('nav button', (bs, t) => bs.find(x => x.dataset.tab === t)?.click(), t); await sleep(900); };
const overflow = (p, sel) => p.evaluate(sel => { const vw = document.documentElement.clientWidth; return [...document.querySelectorAll(sel + ' *')].filter(e => e.getClientRects().length && e.getBoundingClientRect().right > vw + 1).map(e => e.tagName + '.' + e.className).slice(0, 3); }, sel);
const ADULT = { age: 28, minor: false, lookingFor: ['friends', 'gaming', 'dating'], datingOff: false, seekingGenders: ['Woman', 'Man', 'Non-binary'], minMatch: { dating: 0, friends: 0, gaming: 0 }, ageRanges: null, ageMin: 18, ageMax: 99 };
try {
  for (const w of [320, 360, 390, 430]) { const p = await page(w); await login(p, '1992-03-03', true); await patchMe(p, ADULT); await login(p);
    await tab(p, 'profile'); await p.waitForSelector('#mprefs');
    const r = await p.evaluate(() => ({ boxes: [...document.querySelectorAll('[data-modeprefs]')].map(e => e.dataset.modeprefs + (e.hidden ? ':h' : '')), dOnly: [...document.querySelectorAll('[data-dating-only]')].filter(e => !e.hidden).length, cmp: document.querySelectorAll('[data-cmp]').length }));
    ok(r.boxes.join() === 'dating,friends,gaming' && r.dOnly >= 2 && r.cmp === 6, `${w}px: per-mode boxes ${r.boxes} (dating-only visible: ${r.dOnly}), soft/hard per mode`);
    const of = await overflow(p, '#mprefs'); ok(!of.length, `${w}px: matching card fits (no horizontal overflow) ${of.join(' ')}`);
    await p.$eval('#mprefs', e => e.scrollIntoView({ block: 'start' })); await sleep(200); await p.screenshot({ path: `${OUT}/v33-prefs-${w}.png` });
    await p.$eval('#dating-on', e => { e.checked = false; e.dispatchEvent(new Event('change')); }); await sleep(150);
    const off = await p.evaluate(() => ({ vis: [...document.querySelectorAll('[data-dating-only]')].filter(e => !e.hidden && e.offsetParent).length, lf: document.querySelector('#f_lookingFor input[value="dating"]')?.checked }));
    ok(off.vis === 0 && off.lf === false, `${w}px: Dating off hides every dating-only field live (and syncs "here for")`); await p.screenshot({ path: `${OUT}/v33-dating-off-${w}.png` });
    await p.$eval('#dating-on', e => { e.checked = true; e.dispatchEvent(new Event('change')); }); await sleep(150); ok(await p.evaluate(() => [...document.querySelectorAll('[data-dating-only]')].every(e => !e.hidden)), `${w}px: Dating on shows them again`);
    if (w === 390) { // save + clamp
      await p.$eval('[data-ar="friends.0"]', e => e.value = '5'); await p.$eval('[data-ar="friends.1"]', e => e.value = '300'); await p.$eval('[data-ar="dating.0"]', e => e.value = '40'); await p.$eval('[data-ar="dating.1"]', e => e.value = '30');
      await p.$eval('[data-mm="gaming"]', e => e.value = '95'); await p.$eval('[data-cmp="friends"][value="hard"]', e => e.click()); await p.$eval('[data-db="glasses"]', e => { e.checked = true; e.dispatchEvent(new Event('change')); });
      ok(!(await p.$eval('[data-accwrap="glasses"]', e => e.hidden)), 'deal-breaker toggle reveals the accept bubbles'); await p.$eval('[data-acc="glasses"] [data-v="no"]', e => e.click());
      await p.$eval('[data-accwrap="glasses"]', e => e.scrollIntoView({ block: 'center' })); await p.screenshot({ path: `${OUT}/v33-dealbreaker-${w}.png` });
      await p.$eval('#pf', f => f.requestSubmit()); await sleep(1200); const me = await meNow(p);
      ok(me.ageRanges?.friends?.join() === '18,99' && me.ageRanges?.dating?.join() === '30,40' && me.ageMin === 30 && me.ageMax === 40, `saved ranges clamped to the adult band + swapped (friends ${me.ageRanges?.friends}, dating ${me.ageRanges?.dating}, legacy ${me.ageMin}-${me.ageMax})`);
      ok(me.minMatch?.gaming === 95 && me.compare?.friends === 'hard' && me.dealBreakers?.glasses && me.accept?.glasses?.join() === 'no', 'saved: min % per mode, compare style per mode, deal breaker + accept list');
      await patchMe(p, { minMatch: { dating: 0, friends: 0, gaming: 0 }, ageRanges: null, ageMin: 18, ageMax: 99, dealBreakers: {}, accept: {}, compare: {} }); await login(p); }
    // Discover: match bar everywhere, gender filter in Dating only
    await tab(p, 'discover'); const seen = {};
    for (const m of ['dating', 'friends', 'gaming']) { await p.$$eval('[data-m]', (bs, m) => bs.find(x => x.dataset.m === m)?.click(), m); await sleep(700);
      seen[m] = await p.evaluate(() => ({ bar: !!document.querySelector('[data-matchbar]'), gf: !!document.querySelector('[data-gender-filter]'), txt: document.querySelector('[data-matchbar]')?.textContent || '' }));
      await p.$eval('[data-matchbar]', e => e.scrollIntoView({ block: 'center' })).catch(() => {}); await sleep(150);
      if (m !== 'gaming' || w === 390) await p.screenshot({ path: `${OUT}/v33-discover-${m}-${w}.png` }); }
    ok(seen.dating.bar && seen.dating.gf && !seen.friends.gf && !seen.gaming.gf && seen.friends.bar, `${w}px: gender filter shown in Dating only; match bar in every mode (${seen.friends.txt.trim().slice(0, 50)})`);
    ok(/hard compare/.test(seen.dating.txt) && /soft compare/.test(seen.friends.txt) && /min 0%/.test(seen.friends.txt) && /Ages 18–99/.test(seen.friends.txt), `${w}px: match bar shows per-mode age range, compare style + min %`);
    const of2 = await overflow(p, '#view'); ok(!of2.length, `${w}px: Discover fits ${of2.join(' ')}`);
    if (w === 360) { await p.$$eval('[data-m]', bs => bs.find(x => x.dataset.m === 'dating')?.click()); await sleep(600); await p.$eval('[data-gf="Man"]', e => e.click()); await sleep(800); const me = await meNow(p);
      ok(!me.seekingGenders.includes('Man') && me.seekingGenders.includes('Woman'), 'tapping a gender chip in Dating updates the dating filter'); }
    ok(!p.errs.length, `${w}px: no page errors ${p.errs.slice(0, 2).join(' | ')}`); await p.close(); }
  // Minor: no Dating tab, no Roulette, no dating prefs, ages 13-17
  for (const w of [320, 390]) { const p = await page(w); await login(p, '1992-03-03', true); await patchMe(p, { ...ADULT, age: 15, minor: true, lookingFor: ['friends', 'gaming'], seekingGenders: null, ageMin: null, ageMax: null }); await login(p, '2011-02-02');
    const nav = await p.$$eval('nav button', bs => bs.map(x => x.dataset.tab)); await tab(p, 'discover'); const modes = await p.$$eval('[data-m]', bs => bs.map(x => x.dataset.m));
    ok(!nav.includes('roulette') && !modes.includes('dating') && !(await p.$('[data-gender-filter]')), `${w}px minor: no Roulette tab (${nav}), no Dating mode (${modes}), no gender filter`); await p.screenshot({ path: `${OUT}/v33-minor-discover-${w}.png` });
    await tab(p, 'profile'); await p.waitForSelector('#mprefs'); const r = await p.evaluate(() => ({ dt: !!document.querySelector('#dating-on'), boxes: [...document.querySelectorAll('[data-modeprefs]')].map(e => e.dataset.modeprefs), max: document.querySelector('[data-ar="friends.1"]')?.max, dOnly: document.querySelectorAll('[data-dating-only]').length }));
    ok(!r.dt && r.boxes.join() === 'friends,gaming' && r.max === '17' && r.dOnly === 0, `${w}px minor: no Dating toggle/fields, ranges capped at 17 (${r.boxes})`); await p.$eval('#mprefs', e => e.scrollIntoView({ block: 'start' })); await p.screenshot({ path: `${OUT}/v33-minor-prefs-${w}.png` });
    if (w === 390) { await p.$eval('[data-ar="friends.1"]', e => e.value = '40'); await p.$eval('#pf', f => f.requestSubmit()); await sleep(1200); const me = await meNow(p); ok(me.ageRanges?.friends?.[1] === 17 && !me.ageRanges?.dating && !(me.lookingFor || []).includes('dating'), `minor save: friends range clamped to ${me.ageRanges?.friends}, no dating data`); }
    ok(!p.errs.length, `${w}px minor: no page errors ${p.errs.slice(0, 2).join(' | ')}`); await p.close(); }
} catch (e) { ok(false, 'exception ' + e.message); }
await b.close(); if (srv) try { process.kill(-srv.pid); } catch {}
console.log(fail ? `MATCH SHOTS: ${fail}/${n} FAIL` : `ALL MATCH SHOTS OK (${n})`); process.exit(fail ? 1 : 0);
