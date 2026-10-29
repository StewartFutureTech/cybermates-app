// v55: the ORIGINAL-NAME 3D games (data-mg "<id>@3d": Chess / Connect Four / Air Hockey, frozen v36 look) use the SAME mesh
//  joining + matchmaking as the "… Flat" games. Real tabs (admin/dev flavor, BroadcastChannel mesh). Run after build:admin.
//  - Air Hockey (real-time): A starts vs AI and hosts; B picks the same game -> drops into A's table NOW, AI hands over its seat.
//  - Chess + Connect Four (turn-based): B joins A's running table, watches the same board, queued for the next round; at the
//    next round (host rematch) B REPLACES the bot. Both tabs keep the 3D variant across the mesh-driven rebuild.
//  - Mixed: a "Chess Flat" player drops into a "Chess" (3D) table (one shared queue/table) — each keeps its own look.
//  - Join pop-up: in a 3D bot match, a human searching the same queue opens the "Join human match?" invite; Accept swaps the
//    bot for the human and the new match is still the original 3D variant (board3d-v36 renderer).
//  node scripts/e2e-joinanytime3d.mjs
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const PORT = 4195, URL0 = `http://localhost:${PORT}/`;
let browser, errs = [], known = [], curGame = ''; // known: PRE-EXISTING battleship watcher error (same in Battleship Flat, see v55 notes)
const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-admin', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
const cleanup = async code => { try { await browser?.close(); } catch {} try { process.kill(-srv.pid); } catch {} process.exit(code); };
const assert = (c, m) => { if (!c) { console.error('E2E FAIL', m); cleanup(1); throw new Error('fail'); } else console.log('ok', m); };
setTimeout(() => { console.error('E2E FAIL global timeout'); cleanup(1); }, 900e3);
await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost/.test(d) && res()); setTimeout(() => rej(new Error('preview timeout')), 15000); });
browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, { timeout: ms, polling: 250 }, arg).catch(e => { throw new Error(e.message + ' :: ' + String(fn).slice(0, 140)); });
const wait = ms => new Promise(r => setTimeout(r, ms));
let ctx = null; // sweep: fresh storage context per game (many same-origin tabs otherwise stall IndexedDB at boot step 'device-key')
const open = async (as, game, mode = '1v1') => { const p = await (ctx || browser).newPage(); await p.setViewport({ width: 390, height: 844, isMobile: true });
  await p.evaluateOnNewDocument(() => { globalThis.__cmAckTest = { minMs: 0, noScroll: true }; localStorage.setItem('cm.sound', 'off'); }); p.on('dialog', d => d.accept());
  p.on('pageerror', e => { if (curGame === 'battleship' && /reading '0'/.test(e.message)) { known.push(e.message); return; } errs.push(`[${as}] ${e.message}`); console.log(`[${as}] pageerror`, e.message); });
  await p.goto(URL0 + '?as=' + as + '&loaderMin=300&arcmode=' + mode + '&arcgame=' + encodeURIComponent(game));
  const ag = await p.waitForSelector('#ag-dob', { timeout: 15000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
  const terms = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (terms) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  await until(p, () => globalThis.__cmMesh?.()?.code, null, 60000); /* slow after many tabs */ await until(p, () => !document.getElementById('jackin')); if (await p.$('#moodskip')) await p.click('#moodskip').catch(() => {});
  await p.evaluate(() => document.getElementById('moodpick')?.remove()); await p.$eval('nav [data-tab=arcade]', e => e.click());
  await until(p, () => globalThis.__cmMatch?.()?.id, null, 30000); return p; };
const M = p => p.evaluate(() => globalThis.__cmMatch());
const v36Loaded = p => p.evaluate(() => performance.getEntriesByType('resource').some(e => /board3d-v36/.test(e.name)));
const title = p => p.evaluate(() => document.querySelector('.mhead b')?.textContent || '');
const is3d = p => p.evaluate(() => { const c = document.querySelector('#m-3d-cv'); return !!c && !c.hidden && c.width > 0; });
try {
  if (!process.env.ONLY_REST) { // ONLY_REST=1: just the per-game sweep below
  // ---- real-time: Air Hockey (pong@3d)
  { const A = await open('seed-2', 'pong@3d'); const a0 = await M(A);
    assert(a0.view === 'v36' && a0.seats.filter(s => s.ai).length === 1 && a0.host === a0.me, `Air Hockey (3D): A started ${a0.id} vs AI and hosts it`);
    await wait(2500); const B = await open('seed-5', 'pong@3d');
    await until(B, id => globalThis.__cmMatch()?.id === id, a0.id, 15000); await until(A, () => globalThis.__cmMatch().seats.every(s => !s.ai), null, 15000);
    const a1 = await M(A), b1 = await M(B);
    assert(a1.seats.map(s => s.code).join() === b1.seats.map(s => s.code).join() && a1.seats.some(s => s.code === b1.me), 'Air Hockey (3D): B joined A\'s running table NOW, the AI gave up its seat');
    assert(a1.host === b1.host && a1.roster.length === 2 && b1.roster.length === 2, 'Air Hockey (3D): both tabs agree on host + roster');
    assert(b1.view === 'v36' && (await is3d(B)) && /^Air Hockey · /.test(await title(B)), 'Air Hockey (3D): joiner renders the original-name 3D table');
    await A.close(); await until(B, () => { const m = globalThis.__cmMatch(); return m.host === m.me && m.roster.length === 1 && m.seats.some(s => s.ai); }, null, 15000);
    assert(true, 'Air Hockey (3D): A left -> B hosts, a bot refills the empty seat'); await B.close(); }
  // ---- turn-based: Chess + Connect Four (3D)
  for (const [game, name, seedA, seedB] of [['chess', 'Chess', 'seed-7', 'seed-8'], ['connect4', 'Connect Four', 'seed-9', 'seed-10']]) {
    const C = await open(seedA, game + '@3d'); const c0 = await M(C); assert(c0.view === 'v36' && c0.seats.some(s => s.ai), `${name} (3D): A in a bot-filled table ${c0.id}`);
    await wait(2500); const D = await open(seedB, game + '@3d');
    await until(D, id => globalThis.__cmMatch()?.id === id, c0.id, 15000); await until(C, () => globalThis.__cmMatch().pending.length === 1, null, 15000);
    const c1 = await M(C), d1 = await M(D);
    assert(c1.pending[0] === d1.me && c1.seats.some(s => s.ai) && d1.head === c1.head, `${name} (3D): joiner watches the same board, queued for the next round (bot keeps its seat mid-round)`);
    await C.evaluate(() => document.getElementById('m-rematch').click()); // host starts the next round
    await until(C, () => globalThis.__cmMatch().seats.every(s => !s.ai), null, 15000); await until(D, () => globalThis.__cmMatch().seats.every(s => !s.ai), null, 15000);
    const c2 = await M(C), d2 = await M(D);
    assert(c2.seats.some(s => s.code === d2.me) && c2.round === d2.round && c2.head === d2.head, `${name} (3D): next round -> the person REPLACED the bot; both tabs in sync`);
    assert(c2.view === 'v36' && d2.view === 'v36' && (await is3d(C)) && (await is3d(D)) && new RegExp('^' + name + ' · ').test(await title(D)), `${name} (3D): both stay on the original-name 3D variant after the mesh rebuild`);
    if (game === 'chess') assert((await v36Loaded(C)) && (await v36Loaded(D)), 'Chess (3D): frozen board3d-v36 renderer in both tabs');
    await C.close(); await D.close(); }
  // ---- mixed: Flat player joins a 3D table (one shared queue)
  { const E = await open('seed-11', 'chess@3d'); const e0 = await M(E); await wait(2500); const F = await open('seed-12', 'chess');
    await until(F, id => globalThis.__cmMatch()?.id === id, e0.id, 15000); const f1 = await M(F);
    assert(f1.view === 'flat' && e0.view === 'v36' && /Chess Flat/.test(await title(F)), 'mixed: a "Chess Flat" player joined the "Chess" (3D) table; each keeps its own look');
    await E.close(); await F.close(); }
  // ---- join pop-up (bot match -> human invite) in a 3D game
  { const G = await open('seed-13', 'chess@3d'); const g0 = await M(G); assert(g0.seats.some(s => s.ai), 'pop-up: 3D chess bot match running');
    await G.evaluate(() => { globalThis.__cmMM().enqueue({ code: 'PEER-X', name: 'peer x', age: 30, adult: true }, 'chess', '1v1'); });
    await until(G, () => { const el = document.getElementById('m-invite'); return el && !el.hidden; }, null, 10000);
    if (process.env.SHOT) await G.screenshot({ path: process.env.SHOT });
    assert(/Join human match\?/.test(await G.evaluate(() => document.getElementById('m-invite').textContent)), 'pop-up: "Join human match?" invite shown in the 3D game');
    await G.click('#m-inv-yes'); await until(G, id => { const m = globalThis.__cmMatch(); return m && m.id !== id; }, g0.id, 10000);
    const g1 = await M(G); assert(g1.seats.every(s => !s.ai) && g1.seats.some(s => s.code === 'PEER-X') && g1.view === 'v36' && (await is3d(G)) && /^Chess · /.test(await title(G)), 'pop-up: Accept -> human replaced the bot, still the original 3D Chess');
    await G.close(); }
  }
  // ---- every other original-name 3D game: a second player drops into the running table (seated now or queued for next round)
  const SUF = process.env.SUFFIX ?? '@3d'; for (const game of (process.env.REST || 'checkers,ttt,uttt,battleship,tronduel,snakebattle,trivia').split(',').filter(Boolean)) {
    ctx = await browser.createBrowserContext(); curGame = game; const md = game === 'snakebattle' ? '2v2' : '1v1'; // Snake Battle has no 1v1
    const A = await open('seed-2', game + SUF, md); const a0 = await M(A); await wait(2500); const B = await open('seed-5', game + SUF, md);
    await until(B, id => globalThis.__cmMatch()?.id === id, a0.id, 15000);
    await until(A, me => { const m = globalThis.__cmMatch(); return m.seats.some(s => s.code === me) || m.pending.includes(me); }, await B.evaluate(() => globalThis.__cmMatch().me), 15000);
    const a1 = await M(A), b1 = await M(B); assert(a1.view === (SUF ? 'v36' : 'flat') && b1.view === a1.view && a1.host === b1.host && (a1.seats.some(s => s.code === b1.me) ? a1.seats.filter(s => s.ai).length < a0.seats.filter(s => s.ai).length : a1.pending.includes(b1.me)), `${game} (3D): joiner ${a1.seats.some(s => s.code === b1.me) ? 'took a bot seat NOW' : 'queued for the next round'}, same table + host`);
    await A.close(); await B.close(); await ctx.close(); ctx = null; curGame = ''; }
  if (known.length) console.log(`note: ${known.length} known pre-existing battleship watcher page error(s) (also in Battleship Flat):`, known[0]);
  assert(errs.length === 0, 'no page errors in any tab' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log('ALL OK e2e-joinanytime3d'); await cleanup(0);
} catch (e) { console.error('E2E FAIL', e.message); await cleanup(1); }
