// v36 JOIN-ANYTIME + HOST ROTATION in real tabs (admin/dev flavor, BroadcastChannel mesh). Run after build:admin.
//  Tron Duel 1v1 (real-time): A starts vs AI -> B picks the same game -> joins A's table NOW (AI hands its seat over),
//  both tabs agree on table id + host; A closes its tab -> B takes over as host and an AI fills A's seat.
//  Chess 1v1 (turn-based): B joins A's running table as a watcher, queued for the next round, same board.
//  No page errors in any tab.  node scripts/e2e-joinanytime.mjs
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const PORT = 4191, URL0 = `http://localhost:${PORT}/`;
let browser, errs = []; const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-admin', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
const cleanup = async code => { try { await browser?.close(); } catch {} try { process.kill(-srv.pid); } catch {} process.exit(code); };
const assert = (c, m) => { if (!c) { console.error('E2E FAIL', m); cleanup(1); } else console.log('ok', m); };
setTimeout(() => { console.error('E2E FAIL global timeout'); cleanup(1); }, 240e3);
await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost/.test(d) && res()); setTimeout(() => rej(new Error('preview timeout')), 15000); });
browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, { timeout: ms, polling: 250 }, arg).catch(e => { throw new Error(e.message + ' :: ' + String(fn).slice(0, 120)); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const open = async (as, game) => { const p = await browser.newPage(); await p.setViewport({ width: 390, height: 844, isMobile: true });
  await p.evaluateOnNewDocument(() => { globalThis.__cmAckTest = { minMs: 0, noScroll: true }; localStorage.setItem('cm.sound', 'off'); }); p.on('dialog', d => d.accept());
  p.on('pageerror', e => { errs.push(`[${as}] ${e.message}`); console.log(`[${as}] pageerror`, e.message); });
  await p.goto(URL0 + '?as=' + as + '&loaderMin=300&arcmode=1v1&arcgame=' + game);
  const ag = await p.waitForSelector('#ag-dob', { timeout: 15000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
  const terms = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (terms) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  await until(p, () => globalThis.__cmMesh?.()?.code); await until(p, () => !document.getElementById('jackin')); if (await p.$('#moodskip')) await p.click('#moodskip').catch(() => {});
  await p.evaluate(() => document.getElementById('moodpick')?.remove()); await p.$eval('nav [data-tab=arcade]', e => e.click());
  await until(p, () => globalThis.__cmMatch?.()?.id, null, 30000); return p; };
const M = p => p.evaluate(() => globalThis.__cmMatch());
try {
  // ---- real-time: Tron Duel
  const A = await open('seed-2', 'tronduel'); const a0 = await M(A);
  assert(a0.seats.length === 2 && a0.seats.filter(s => s.ai).length === 1 && a0.host === a0.me, `A started ${a0.id} vs AI and hosts it`);
  await wait(2500); const B = await open('seed-5', 'tronduel');
  await until(B, id => globalThis.__cmMatch()?.id === id, a0.id, 15000); await until(A, () => globalThis.__cmMatch().seats.every(s => !s.ai), null, 15000);
  const a1 = await M(A), b1 = await M(B);
  assert(b1.id === a0.id && a1.seats.map(s => s.code).join() === b1.seats.map(s => s.code).join() && a1.seats.some(s => s.code === b1.me), 'B dropped into A\'s running Tron Duel NOW: AI gave up its seat, both tabs see the same seats');
  assert(a1.host === b1.host && a1.roster.length === 2 && b1.roster.length === 2, `both tabs agree on host ${a1.host.slice(0, 6)} and share the rotation roster`);
  const cv = await B.evaluate(() => { const c = document.querySelector('#m-3d-cv'); return c && !c.hidden && c.width > 0; }); assert(cv, 'joiner renders the 3D arena');
  await wait(3000); const a2 = await M(A), b2 = await M(B); assert(a2.host === b2.host && a2.epoch === b2.epoch, 'host/epoch still agreed after heartbeats + ping probes');
  await A.close(); // pagehide -> planned hand-off + leave
  await until(B, () => { const m = globalThis.__cmMatch(); return m.host === m.me && m.roster.length === 1 && m.seats.some(s => s.ai); }, null, 15000);
  assert(true, 'A left: B is host now and an AI took A\'s seat (round goes on)');
  await B.close();
  // ---- turn-based: Chess
  const C = await open('seed-7', 'chess'); const c0 = await M(C); await wait(2500); const D = await open('seed-8', 'chess');
  await until(D, id => globalThis.__cmMatch()?.id === id, c0.id, 15000); await until(C, () => globalThis.__cmMatch().pending.length === 1, null, 15000);
  const c1 = await M(C), d1 = await M(D);
  assert(c1.pending[0] === d1.me && d1.seats.every(s => s.code !== d1.me) && c1.seats.some(s => s.ai), 'chess: joiner queued for the next round, AI keeps its seat mid-round, joiner watches');
  assert(d1.head === c1.head && d1.seq === c1.seq, 'joiner holds the exact same board (hash-chain head)');
  await D.close(); await until(C, () => globalThis.__cmMatch().pending.length === 0 && globalThis.__cmMatch().roster.length === 1, null, 15000); assert(true, 'watcher left: dropped from queue + roster');
  assert(errs.length === 0, 'no page errors in any tab' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await cleanup(0);
} catch (e) { console.error('E2E FAIL', e.message); await cleanup(1); }
