// Glow (bloom) must stay ON: every 3D game runs 30+ s with forced slow frames (~35 ms busy-wait per rAF => ~28 fps, worse than
// the 18.5 ms step-down threshold) and we assert the bloom pass is enabled, in the composer, strength > 0 (visible), plus a
// WebGL context loss/restore round-trip rebuilds the composer with the glow on. Chrome (SwiftShader) iPhone profile.
// Env: DIST (default dist), SHOTS dir for 30 s screenshots, NOASSERT=1 to only report (used for the "before" baseline), GAMES=a,b
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import net from 'node:net'; import puppeteer from 'puppeteer-core';
const DIST = process.env.DIST || 'dist', PORT = Number(process.env.PORT) || await new Promise(r => { const n = net.createServer().listen(0, () => { const q = n.address().port; n.close(() => r(q)); }); }), U = `http://localhost:${PORT}/`, SH = process.env.SHOTS, T = Number(process.env.SECS || 32) * 1000;
const srv = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true }); await new Promise(r => setTimeout(r, 2500)); { const h = await (await fetch(U)).text(), i0 = h.indexOf('assets/index-'), m = i0 < 0 ? '' : h.slice(i0, h.indexOf('.js', i0) + 3); if (!m || !fs.existsSync(DIST + '/' + m)) { console.error('FAIL wrong server on port ' + PORT); try { process.kill(-srv.pid); } catch {} process.exit(1); } }
const ALL = { snake: '&arcmode=mass&arcgame=snake', tron: '&arcmode=mass&arcgame=tron', megaship: '&arcmode=mass&arcgame=megaship', brawl: '&arcmode=mass&arcgame=brawl', drawguess: '&arcmode=mass&arcgame=drawguess',
  chess: '&arcmode=1v1&arcgame=chess', connect4: '&arcmode=1v1&arcgame=connect4', pong: '&arcmode=2v2&arcgame=pong', tronduel: '&arcmode=2v2&arcgame=tronduel', snakebattle: '&arcmode=2v2&arcgame=snakebattle', uttt: '&arcmode=1v1&arcgame=uttt' };
const only = process.env.GAMES?.split(','); const G = Object.entries(ALL).filter(([n]) => !only || only.includes(n));
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 300000, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
let fail = 0; const rows = []; if (SH) fs.mkdirSync(SH, { recursive: true });
const one = async ([name, q], ctxTest) => { const p = await b.newPage(); try { p.setDefaultTimeout(120000); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.evaluateOnNewDocument(() => { localStorage.setItem('cm.sound', 'off'); localStorage.setItem('cm.arc.3d', 'on'); localStorage.setItem('cybermates:perf-skipgates', '1'); globalThis.__cmAckTest = { minMs: 0, noScroll: true };
    const raf = globalThis.requestAnimationFrame.bind(globalThis); globalThis.requestAnimationFrame = f => raf(t => { if (globalThis.__cm3d) { const e = performance.now() + 35; while (performance.now() < e); } f(t); }); });
  await p.goto(U + '?loaderMin=0&force3d=1' + (process.env.EXTRAQ || '') + q);
  const ag = await p.waitForSelector('#ag-dob', { timeout: 30000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.$eval('#ag-go', e => e.click()); }
  const tm = await p.waitForSelector('#tm-ok', { timeout: 20000 }).catch(() => null); if (tm) { await p.$eval('#tm-ok', e => e.click()); await p.$eval('#tm-yes', e => e.click()); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'), { timeout: 90000 }); await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Skip')?.click());
  await p.$eval('nav [data-tab=arcade]', e => e.click()); await p.waitForFunction(() => globalThis.__cm3d, { timeout: 90000 });
  await new Promise(r => setTimeout(r, T));
  const st = await p.evaluate(() => { const c = globalThis.__cm3d; return { bloom: c.bloom ?? null, tier: c.tier, scale: c.scale, fps: +c.fps.toFixed(1) }; });
  if (SH) await p.screenshot({ path: `${SH}/${name}-30s.png` });
  let ctx = null; if (ctxTest) { ctx = await p.evaluate(async () => { const c = globalThis.__cm3d, x = c.renderer.getContext().getExtension('WEBGL_lose_context'); x.loseContext(); await new Promise(r => setTimeout(r, 800)); x.restoreContext(); await new Promise(r => setTimeout(r, 3000)); return { rebuilds: c.rebuilds, lost: c.lost, bloom: c.bloom }; }); }
  const okB = st.bloom ? st.bloom.enabled && st.bloom.inComposer && st.bloom.strength > 0.2 : false; const okC = !ctxTest || (ctx.rebuilds >= 1 && !ctx.lost && ctx.bloom.enabled);
  const row = { game: name, ...st, ctx, pass: okB && okC }; rows.push(row); console.log((row.pass ? 'ok ' : 'FAIL ') + JSON.stringify(row)); if (!row.pass) fail = 1; } finally { await p.close().catch(() => {}); } };
for (let i = 0; i < G.length; i += 3) await Promise.all(G.slice(i, i + 3).map(async (g, j) => { for (let k = 0; k < 2; k++) { try { return await one(g, !process.env.NOASSERT && i + j === 0); } catch (e) { console.log('retry', g[0], e.message.slice(0, 80)); } } rows.push({ game: g[0], pass: false, err: 'no 3D view' }); console.log('FAIL ' + g[0] + ' no 3D view'); fail = 1; }));
await b.close(); try { process.kill(-srv.pid); } catch {} if (SH) fs.writeFileSync(`${SH}/result.json`, JSON.stringify(rows, null, 1));
if (process.env.NOASSERT) process.exit(0); console.log(fail ? 'GLOW: FAIL' : 'GLOW: ALL PASS (bloom on in every game after 30 s of slow frames + context loss)'); process.exit(fail);
