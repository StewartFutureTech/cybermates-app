// LIVING MESH browser test (admin/dev flavor, BroadcastChannel transport, 4 real tabs): buckets fill via soft-tag presence +
// tentacles, tap "View profile" shows "Loading their profile..." then the FULL profile (online), pass cuts both ways,
// closed tab -> offline on open, multi-hop search returns peers. Run after build:admin. node scripts/e2e-livemesh.mjs
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const PORT = 4183, URL0 = `http://localhost:${PORT}/`;
let browser; const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-admin', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
const cleanup = async code => { try { await browser?.close(); } catch {} try { process.kill(-srv.pid); } catch {} process.exit(code); };
const assert = (c, m) => { if (!c) { console.error('E2E FAIL', m); cleanup(1); } else console.log('ok', m); };
setTimeout(() => { console.error('E2E FAIL global timeout'); cleanup(1); }, 180e3);
await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost/.test(d) && res()); setTimeout(() => rej(new Error('preview timeout')), 15000); });
browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, { timeout: ms, polling: 250 }, arg).catch(e => { throw new Error(e.message + ' :: ' + String(fn).slice(0, 90)); });
const open = async as => { const p = await browser.newPage(); await p.evaluateOnNewDocument(() => { globalThis.__cmAckTest = { minMs: 0, noScroll: true }; }); p.on('dialog', d => d.accept()); p.on('pageerror', e => console.log(`[${as}] pageerror`, e.message)); p.on('console', m => /warn|error/.test(m.type()) && console.log(`[${as}]`, m.text().slice(0, 200))); await p.goto(URL0 + '?as=' + as + '&loaderMin=300');
  const ag = await p.waitForSelector('#ag-dob', { timeout: 15000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
  const terms = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (terms) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  await until(p, () => globalThis.__cmMesh?.()?.code); await until(p, () => !document.getElementById('jackin')); if (await p.$('#moodskip')) await p.click('#moodskip').catch(() => {}); return p; };
try {
  const T = []; for (const s of ['seed-2', 'seed-5', 'seed-7', 'seed-8'] /* all have Friends mode on */) T.push(await open(s)); const [A, B, C, D] = T; console.log('4 tabs open');
  const codes = await Promise.all(T.map(p => p.evaluate(() => __cmMesh().code)));
  if (process.env.DBG) await new Promise(r2 => setTimeout(r2, 12000)); if (process.env.DBG) for (const p of T) console.log(await p.evaluate(() => JSON.stringify({ on: __cmMesh().online().length, b: __cmMesh().live.bucket.size, st: __cmMesh().live.stats, pins: __cmMesh().live.pins.size, tags: __cmMesh().live.tags, log: __cmMesh().log.slice(0, 5) })));
  for (const p of T) await until(p, () => __cmMesh().live.bucket.size >= 2, null, 60000);
  const sizes = await Promise.all(T.map(p => p.evaluate(() => __cmMesh().live.bucket.size)));
  assert(sizes.every(n => n >= 2 && n <= 200), 'every tab has a live bucket from soft-tag presence + tentacles: ' + sizes.join(','));
  const pk = await A.evaluate(() => __cmMesh().live.stats.maxPkt); assert(pk > 0 && pk <= 512, 'soft-tag presence packet ' + pk + ' B (full profile not in it)');
  const b = await A.evaluate(() => __cmMesh().bucket()[0].code);
  const r = await A.evaluate(c => __cmMesh().openProfile(c), b); assert(r.online && r.profile?.name, 'openProfile: full profile of ' + r.profile?.name + ' fetched on demand, online');
  await A.bringToFront(); await A.evaluate(() => document.querySelector('nav [data-tab=discover]').click()); await until(A, c => document.querySelector(`[data-mview="${c}"]`), b);
  const sawLoading = await A.evaluate(c => { document.querySelector(`[data-mview="${c}"]`).click(); return new Promise(r2 => setTimeout(() => r2(/Loading their profile/.test(document.body.innerText)), 0)); }, b);
  await until(A, () => document.querySelector('.dv-profile')); const on = await A.$eval('.dv-profile', e => e.dataset.online + '|' + e.innerText);
  assert(on.startsWith('1|') , 'View profile -> "Loading their profile..." (' + sawLoading + ') then full profile card, online');
  const results = await A.evaluate(() => new Promise(res => { const out = []; __cmMesh().search({ mode: 'friends', min: 0 }, x => out.push(x)); setTimeout(() => res(out), 3000); }));
  assert(results.length >= 1 && results.every(x => x.hop >= 0), 'search returned ' + results.length + ' peer(s), hops ' + results.map(x => x.hop).join(','));
  const pB = T[codes.indexOf(b)]; await A.evaluate(c => __cmMesh().pass(c), b);
  await until(pB, a => !__cmMesh().live.bucket.has(a), codes[0], 10000); await new Promise(r2 => setTimeout(r2, 6000));
  assert(!(await A.evaluate(c => __cmMesh().live.bucket.has(c), b)), 'pass (swipe left): gone from both buckets and not re-admitted');
  const others = codes.slice(1).filter(c => c !== b); const dC = others[others.length - 1], pD = T[codes.indexOf(dC)]; await pD.close();
  await new Promise(r2 => setTimeout(r2, 500)); const off = await A.evaluate(c => __cmMesh().openProfile(c), dC);
  assert(off.online === false, 'closed tab: opening their profile reports offline');
  await cleanup(0);
} catch (e) { console.error('E2E FAIL', e.message); cleanup(1); }
