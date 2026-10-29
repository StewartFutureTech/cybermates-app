// v36 Star Fleet + Mega Fleet browser test at 320 / 390 / 430 px (Chrome, SwiftShader WebGL): Star Fleet placement phase
// (drag, rotate, random, Ready), enemy fleet hidden, raycast tap -> exact (r,c) on all cells in both layouts + real taps
// firing at exactly the tapped cell; Mega Fleet arena (3D, bloom on 0.7x, fullscreen button, analog steer, fire + sfx,
// zoom-out with growth, leaderboard, no text selection). Screenshots: /workspace/cybermates-shots/battleship/
import puppeteer from 'puppeteer-core'; import { spawn } from 'node:child_process'; import fs from 'node:fs'; import net from 'node:net';
const OUT = (process.env.SHOTS || '/workspace/cybermates-shots') + '/battleship'; fs.mkdirSync(OUT, { recursive: true });
const PORT = await new Promise(r => { const n = net.createServer().listen(0, () => { const q = n.address().port; n.close(() => r(q)); }); }), U = process.env.BASE || `http://localhost:${PORT}/`;
let srv; if (!process.env.BASE) { srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true }); await new Promise(r => setTimeout(r, 2500)); }
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 300000, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
let fail = 0; const ok = (c, m) => { console.log(c ? 'ok' : 'FAIL', m); if (!c) fail = 1; }; const wait = ms => new Promise(r => setTimeout(r, ms));
async function open(q, [w, h]) { const p = await b.newPage(); p.setDefaultTimeout(120000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: true, hasTouch: false });
  await p.evaluateOnNewDocument(() => { localStorage.setItem('cm.sound', 'off'); globalThis.__cmSfxLog = []; globalThis.__cmAckTest = { minMs: 0, noScroll: true }; });
  await p.goto(U + '?loaderMin=0&ftue=reset&tier=0&force3d=1' + q); await p.waitForSelector('#ag-dob'); await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.$eval('#ag-go', e => e.click());
  await p.waitForSelector('#tm-ok'); await p.$eval('#tm-ok', e => e.click()); await p.$eval('#tm-yes', e => e.click());
  await p.waitForSelector('#losswarn', { timeout: 15000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {});
  await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'), { timeout: 120000 });
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Skip')?.click()); await wait(800); await p.evaluate(() => document.getElementById('moodpick')?.remove());
  const [, mode, gid] = q.match(/arcmode=([^&]+)&arcgame=([^&]+)/); await p.$eval('nav [data-tab=arcade]', e => e.click()); await wait(1500);
  await p.evaluate(m => [...document.querySelectorAll('.arc-tabs button')].find(x => x.textContent.trim().toLowerCase() === (m === 'mass' ? 'mass arena' : m))?.click(), mode); await wait(1000);
  await p.evaluate(g => (document.querySelector(`.arc-game[data-mg="${g}"]`) || document.querySelector(`[data-game="${g}"]`))?.click(), gid); await wait(1500);
  return { p, errs }; }
const noSel = p => p.evaluate(sel => { const el = document.querySelector(sel); if (!el) return false; const ev = new Event('selectstart', { bubbles: true, cancelable: true }); el.dispatchEvent(ev); return getComputedStyle(el).userSelect === 'none' && ev.defaultPrevented; }, '.arc-stage');
const noOverflow = (p, w) => p.evaluate(w => document.documentElement.scrollWidth <= w + 1, w);
const allCells = (p, boards) => p.evaluate(bs => { const V = __cmBS3d, bad = []; for (const bd of bs) for (let c = 0; c < 100; c++) { const s = V.cellScreen(bd, c), h = V.pickAt(s.x, s.y); if (!h || h.b !== bd || h.c !== c) bad.push(bd + c); } return bad; }, boards);
for (const size of [[320, 640], [390, 844], [430, 932]]) { const W = size[0];
  // ---------------- Star Fleet
  { const { p, errs } = await open('&arcmode=1v1&arcgame=battleship', size); await p.waitForFunction(() => globalThis.__cmBS3d && globalThis.__cmBS, { timeout: 120000 }); await wait(1500);
    await p.evaluate(() => document.getElementById('m-3d-cv')?.scrollIntoView({ block: 'start' })); await wait(400);
    ok(await p.evaluate(() => __cmBS3d.mode === 'place' && !!document.getElementById('bs-ready') && !!document.getElementById('bs-rnd') && !!document.getElementById('bs-rot') && __cmBS.M.state.phase === 'place'), `${W}px Star Fleet: placement phase with Rotate / Random / Ready`);
    let bad = await allCells(p, ['mine']); ok(!bad.length, `${W}px Star Fleet: placement board raycast exact on all 100 cells ${bad.slice(0, 6)}`);
    await p.screenshot({ path: `${OUT}/starfleet-place-${W}.png` });
    // real drag of the destroyer (ship 4) to a free cell
    const drag = await p.evaluate(() => { const B = __cmBS.ctl, sh = B.ships[4], cells = (s => Array.from({ length: s.len }, (_, k) => (s.r + (s.h ? 0 : k)) * 10 + s.c + (s.h ? k : 0))); const taken = new Set(B.ships.flatMap((s, j) => j === 4 ? [] : cells(s)));
      const to = [...Array(100).keys()].find(c => { const n = { ...sh, r: Math.floor(c / 10), c: c % 10 }; return c !== cells(sh)[0] && (n.h ? n.c + n.len <= 10 : n.r + n.len <= 10) && cells(n).every(x => !taken.has(x)); }); return { from: __cmBS3d.cellScreen('mine', cells(sh)[0]), to: __cmBS3d.cellScreen('mine', to), cell: to }; });
    await p.mouse.move(drag.from.x, drag.from.y); await p.mouse.down(); for (let k = 1; k <= 8; k++) { await p.mouse.move(drag.from.x + (drag.to.x - drag.from.x) * k / 8, drag.from.y + (drag.to.y - drag.from.y) * k / 8); await wait(30); } await p.mouse.up(); await wait(300);
    ok(await p.evaluate(c => { const s = __cmBS.ctl.ships[4]; return s.r * 10 + s.c === c; }, drag.cell), `${W}px Star Fleet: drag moves a ship to the cell under the finger`);
    const h0 = await p.evaluate(() => __cmBS.ctl.ships[4].h); await p.click('#bs-rot'); await wait(200); ok(await p.evaluate(h => __cmBS.ctl.ships[4].h !== h, h0), `${W}px Star Fleet: Rotate turns the selected ship`);
    const before = await p.evaluate(() => JSON.stringify(__cmBS.ctl.ships)); await p.click('#bs-rnd'); await wait(200); ok(await p.evaluate(b => JSON.stringify(__cmBS.ctl.ships) !== b, before), `${W}px Star Fleet: Random re-deploys the fleet`);
    await p.click('#bs-ready'); await p.waitForFunction(() => __cmBS.M.state.phase === 'fire' && __cmBS3d.mode === 'battle', { timeout: 20000 }).catch(() => {});
    ok(await p.evaluate(() => __cmBS.M.state.phase === 'fire' && __cmBS3d.mode === 'battle'), `${W}px Star Fleet: Ready -> battle`);
    ok(await p.evaluate(() => !JSON.stringify(__cmBS.M.state).includes('"ships"') && !JSON.stringify(__cmBS.M.log).includes('"ships"') && __cmBS.M.state.commits.every(c => /^[0-9a-f]{64}$/.test(c))), `${W}px Star Fleet: no ship positions in the shared/signed state (commitments only)`);
    await wait(400); bad = await allCells(p, ['mine', 'enemy']); ok(!bad.length, `${W}px Star Fleet: battle boards raycast exact on all 200 cells ${bad.slice(0, 6)}`);
    let fired = 0, wrong = [];
    for (const [r, c] of [[0, 0], [0, 9], [9, 0], [9, 9], [4, 6], [7, 2]]) { const cell = r * 10 + c; await p.waitForFunction(() => { const s = __cmBS.M.state; return __cmBS.M.over || (s.phase === 'fire' && !s.pending && __cmBS.M.mod.turnSeat(s) === 0); }, { timeout: 30000 }).catch(() => {});
      if (await p.evaluate(c => __cmBS.M.over || __cmBS.M.state.shots[1][c], cell)) continue; const s = await p.evaluate(c => __cmBS3d.cellScreen('enemy', c), cell); await p.mouse.click(s.x, s.y); await wait(250);
      const got = await p.evaluate(() => __cmBS.M.log.filter(m => 'cell' in m.move).at(-1)?.move.cell); if (got === cell) fired++; else wrong.push(`(${r},${c})->${got}`); }
    ok(!wrong.length && fired >= 4, `${W}px Star Fleet: real taps fire at exactly the tapped cell (${fired} taps) ${wrong.join(' ')}`);
    await wait(1500); ok(await p.evaluate(() => { const s = __cmBS.M.state; return s.shots[1].filter(Boolean).length >= 1; }), `${W}px Star Fleet: shots resolved by the defender's answer (hit/miss marks)`);
    ok(await noSel(p), `${W}px Star Fleet: no text selection on the game screen`); ok(await noOverflow(p, W), `${W}px Star Fleet: no horizontal overflow`);
    await p.screenshot({ path: `${OUT}/starfleet-battle-${W}.png` }); ok(!errs.length, `${W}px Star Fleet: no page errors ${errs.slice(0, 2).join(' | ')}`); await p.close(); }
  // ---------------- Mega Fleet
  { const { p, errs } = await open('&arcmode=mass&arcgame=megaship', size); await p.waitForFunction(() => globalThis.__cmMega?.view, { timeout: 120000 }); await wait(2500);
    await p.evaluate(() => document.getElementById('mf-stage')?.scrollIntoView({ block: 'center' })); await wait(300);
    const st = await p.evaluate(() => ({ bloom: globalThis.__cm3d?.bloom, n: __cmMega.room.players.size, bots: __cmMega.room.bots().length, rocks: __cmMega.view.rockCount, fs: !!document.querySelector('#mf-stage > .cm-fs-btn'), lb: document.querySelectorAll('#mf-lb div').length }));
    ok(st.bloom?.enabled && st.bloom.inComposer && Math.abs(st.bloom.strength - 0.9 * 0.7) < 1e-6, `${W}px Mega Fleet: glow on at 0.7x (${st.bloom?.strength?.toFixed(3)})`);
    ok(st.bots >= 8 && st.rocks > 0 && st.rocks <= 480, `${W}px Mega Fleet: bots fill the room (${st.bots}), streamed instanced asteroids in view (${st.rocks})`);
    ok(st.fs, `${W}px Mega Fleet: fullscreen button`); ok(st.lb >= 5, `${W}px Mega Fleet: leaderboard of the biggest ships`);
    const bb = await (await p.$('#mf-3d')).boundingBox(); const h0 = await p.evaluate(() => __cmMega.room.players.get(__cmMega.me).h);
    await p.mouse.move(bb.x + bb.width * 0.5, bb.y + bb.height * 0.9); await p.mouse.down(); await wait(900); await p.mouse.up(); const h1 = await p.evaluate(() => __cmMega.room.players.get(__cmMega.me).h);
    ok(Math.abs(Math.sin(h1) - 1) < 0.35 || Math.abs(h1 - h0) > 0.2, `${W}px Mega Fleet: analog steering toward the finger (heading ${h0.toFixed(2)} -> ${h1.toFixed(2)})`);
    const fb = await (await p.$('#mf-fire')).boundingBox(); await p.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2); await p.mouse.down(); await wait(900); await p.mouse.up();
    ok(await p.evaluate(() => __cmSfxLog.includes('laser')), `${W}px Mega Fleet: hold FIRE shoots (laser sfx)`);
    const camA = await p.evaluate(() => __cmMega.view.camH); await p.screenshot({ path: `${OUT}/megafleet-${W}.png` });
    await p.evaluate(() => { const R = __cmMega.room, me = R.players.get(__cmMega.me); R.grow(me, 4000); me.spawnT = R.t + 30; }); await p.waitForFunction(a => __cmMega.view.camH > a * 1.8, { timeout: 15000 }, camA).catch(() => {}); const camB = await p.evaluate(() => __cmMega.view.camH);
    ok(camB > camA * 1.8, `${W}px Mega Fleet: camera zooms out as you grow (${camA.toFixed(0)} -> ${camB.toFixed(0)})`); ok(await p.evaluate(() => __cmSfxLog.includes('claim')), `${W}px Mega Fleet: growth sound`);
    ok(await p.evaluate(() => document.querySelector('#mf-lb .me') && /you/.test(document.querySelector('#mf-lb').textContent)), `${W}px Mega Fleet: you appear on the leaderboard`);
    ok(await noSel(p), `${W}px Mega Fleet: no text selection on the game screen`); ok(await noOverflow(p, W), `${W}px Mega Fleet: no horizontal overflow`);
    await p.screenshot({ path: `${OUT}/megafleet-big-${W}.png` }); ok(!errs.length, `${W}px Mega Fleet: no page errors ${errs.slice(0, 2).join(' | ')}`); await p.close(); } }
await b.close(); try { process.kill(-srv.pid); } catch {} console.log(fail ? 'SHOTS-BATTLESHIP: FAIL' : 'SHOTS-BATTLESHIP: ALL PASS'); process.exit(fail);
