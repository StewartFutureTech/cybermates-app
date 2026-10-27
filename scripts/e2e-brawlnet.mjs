// v42 NETWORKED BRAWL in real tabs (admin/dev flavor, BroadcastChannel mesh). Run after build:admin.
//  A starts Brawl (solo vs 5 AI, advertises its table) -> B opens Brawl -> drops into A's running match NOW (an AI hands
//  its seat over); both tabs agree on table id, seats, host + epoch and colours (same theme -> two distinct shades).
//  B's taps reach the host (A sees B's fighter where B put it); B follows the host's snapshots; C joins mid-match (3 humans);
//  A (host) closes its tab -> planned hand-off, an AI takes A's fighter and the round goes on; packets stay bounded;
//  no page errors in any tab.   node scripts/e2e-brawlnet.mjs
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const PORT = 4193, URL0 = `http://localhost:${PORT}/`;
let browser, errs = []; const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-admin', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
const cleanup = async code => { try { await browser?.close(); } catch {} try { process.kill(-srv.pid); } catch {} process.exit(code); };
const assert = (c, m) => { if (!c) { console.error('E2E FAIL', m); cleanup(1); } else console.log('ok', m); };
setTimeout(() => { console.error('E2E FAIL global timeout'); cleanup(1); }, 300e3);
await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost/.test(d) && res()); setTimeout(() => rej(new Error('preview timeout')), 15000); });
browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, { timeout: ms, polling: 250 }, arg).catch(e => { throw new Error(e.message + ' :: ' + String(fn).slice(0, 140)); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const open = async (as, q = '') => { const p = await browser.newPage(); await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: false });
  await p.evaluateOnNewDocument(() => { globalThis.__cmAckTest = { minMs: 0, noScroll: true }; localStorage.setItem('cm.sound', 'off'); localStorage.setItem('cm.theme', 'cyan'); }); p.on('dialog', d => d.accept());
  p.on('pageerror', e => { errs.push(`[${as}] ${e.message}`); console.log(`[${as}] pageerror`, e.message); });
  await p.goto(URL0 + '?as=' + as + '&loaderMin=300&arcmode=mass&arcgame=brawl' + q);
  const ag = await p.waitForSelector('#ag-dob', { timeout: 15000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
  const terms = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (terms) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  await until(p, () => globalThis.__cmMesh?.()?.code); await until(p, () => !document.getElementById('jackin')); if (await p.$('#moodskip')) await p.click('#moodskip').catch(() => {});
  await p.evaluate(() => document.getElementById('moodpick')?.remove()); await p.$eval('nav [data-tab=arcade]', e => e.click());
  await until(p, () => globalThis.__cmBrawl?.()?.id, null, 30000); return p; };
const S = p => p.evaluate(() => globalThis.__cmBrawl());
const humans = s => s.seats.filter(x => !x.ai).map(x => x.code).sort().join();
try {
  const A = await open('seed-2', '&force3d=0'); const a0 = await S(A);
  assert(a0.seats.filter(s => s.ai).length === 5 && a0.isHost && a0.mySeat === 0, `A started ${a0.id.slice(0, 18)}… vs 5 AI and hosts it`);
  const hud0 = await A.evaluate(() => [...document.querySelectorAll('#br-hud .br-nm')].filter(e => /· AI/.test(e.textContent)).length); assert(hud0 === 5, 'solo HUD unchanged: 6 rows, 5 tagged AI');
  await wait(2500); const Bp = await open('seed-5', '&force3d=1');
  await until(Bp, id => globalThis.__cmBrawl()?.id === id, a0.id, 20000); await until(A, () => globalThis.__cmBrawl().seats.filter(s => !s.ai).length === 2, null, 15000);
  let a1 = await S(A), b1 = await S(Bp);
  assert(b1.id === a0.id && humans(a1) === humans(b1) && humans(a1).split(',').length === 2 && a1.seats.map(s => s.code).join() === b1.seats.map(s => s.code).join(), 'B dropped into A\'s running Brawl NOW (AI gave up its seat); both tabs see the same seats');
  assert(a1.host === b1.host && a1.epoch === b1.epoch && a1.roster.length === 2 && b1.roster.length === 2 && !b1.isHost, `both agree on host ${a1.host.slice(0, 6)} (epoch ${a1.epoch}), B is a replica`);
  assert(JSON.stringify(a1.colors) === JSON.stringify(b1.colors) && a1.colors[a1.mySeat] !== a1.colors[b1.mySeat] && new Set(a1.colors).size === 6, `same theme (cyan) -> two distinct shades ${a1.colors[a1.mySeat]} / ${a1.colors[b1.mySeat]}, identical on both tabs`);
  const hudB = await Bp.evaluate(() => [...document.querySelectorAll('#br-hud .br-nm')].map(e => e.textContent)); assert(hudB.length === 6 && hudB.filter(t => /· AI/.test(t)).length === 4, 'B\'s HUD: 6 rows, 2 humans + 4 AI');
  const on3d = await Bp.evaluate(() => !document.querySelector('#br-3d-cv').hidden); assert(on3d, 'joiner B renders the 3D glass arena (fresh canvas after the switch)');
  await wait(2000); b1 = await S(Bp); assert(b1.stats.snapsApplied >= 15 && b1.tick > 0, `B follows host snapshots (${b1.stats.snapsApplied} applied, tick ${b1.tick})`);
  // B taps: input -> host
  const tapB = async (fx, fy) => { const r = await Bp.evaluate(() => { const c = [...document.querySelectorAll('.br-stage canvas')].find(x => !x.hidden); c.scrollIntoView({ block: 'center' }); const b = c.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; }); await Bp.mouse.move(r[0] + r[2] * fx, r[1] + r[3] * fy); await Bp.mouse.down(); await wait(50); await Bp.mouse.up(); };
  const i0 = (await S(A)).stats.inputsApplied; let applied = false; for (let k = 0; k < 6 && !applied; k++) { await tapB(0.1 + 0.15 * k, 0.15 + 0.12 * (k % 3)); await wait(900); applied = (await S(A)).stats.inputsApplied > i0; }
  assert(applied, 'B\'s taps (signed inputs) are applied by the host');
  await wait(600); a1 = await S(A); b1 = await S(Bp); const d = Math.hypot(a1.f[b1.mySeat].x - b1.f[b1.mySeat].x, a1.f[b1.mySeat].y - b1.f[b1.mySeat].y);
  assert(d < 25, `A sees B's fighter where B has it (Δ ${d.toFixed(1)} arena units, latency-bound)`);
  // C joins mid-match
  const C = await open('seed-7', '&force3d=0'); await until(C, id => globalThis.__cmBrawl()?.id === id, a0.id, 20000); await until(A, () => globalThis.__cmBrawl().seats.filter(s => !s.ai).length === 3, null, 15000);
  const a2 = await S(A), b2 = await S(Bp), c2 = await S(C);
  assert(humans(a2) === humans(b2) && humans(b2) === humans(c2) && humans(a2).split(',').length === 3 && a2.host === c2.host && b2.host === c2.host, 'C joined mid-match: 3 humans + 3 AI, one host, all tabs agree');
  assert(a2.stats.maxOut <= 4400 && b2.stats.maxIn <= 4400, `packets bounded (host largest ${a2.stats.maxOut} B)`);
  // host leaves
  const hostCode = a2.host; assert(hostCode === a2.me, 'A is still host');
  await A.close(); await until(Bp, () => { const s = globalThis.__cmBrawl(); return s.host !== s.seats.find(x => x.code)?.code || true; });
  await until(Bp, h => { const s = globalThis.__cmBrawl(); return s.host !== h && s.roster.length === 2 && s.seats.filter(x => !x.ai).length === 2; }, hostCode, 20000);
  await until(C, h => { const s = globalThis.__cmBrawl(); return s.host !== h && s.seats.filter(x => !x.ai).length === 2; }, hostCode, 20000);
  const b3 = await S(Bp), c3 = await S(C); assert(b3.host === c3.host && b3.epoch === c3.epoch && b3.epoch >= 1 && b3.seats[0].ai, `A (host) left: hand-off to ${b3.host.slice(0, 6)} (epoch ${b3.epoch}), AI took A's fighter`);
  const t0 = c3.tick; await wait(1500); const c4 = await S(C); assert(c4.tick > t0 && !c4.over, `round goes on (tick ${t0} -> ${c4.tick})`);
  assert(errs.length === 0, 'no page errors in any tab' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await cleanup(0);
} catch (e) { console.error('E2E FAIL', e.message); await cleanup(1); }
