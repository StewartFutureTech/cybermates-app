// Per-game perf on a mid-range mobile profile: iPhone viewport (390x844 @3x), CPU throttle 4x (CDP), SwiftShader WebGL.
// Measures load (navigation -> first game frame), FPS and frame-time p50/p95 over a window, for each game URL.
// Usage: node scripts/perf-games.mjs [label] [games,comma,sep]   (BASE env = deployed URL; default: vite preview of dist/)
// NOTE: software WebGL on a shared box is far slower than a phone GPU; compare runs on the same box (before/after), not absolutes.
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import puppeteer from 'puppeteer-core';
const label = process.argv[2] || 'run', only = process.argv[3]?.split(','), PORT = Number(process.env.PORT || 4211), U = process.env.BASE || `http://localhost:${PORT}/`;
let srv; if (!process.env.BASE) { srv = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore', detached: true }); await new Promise(r => setTimeout(r, 2500)); }
const GAMES = { snake: '&arcmode=mass&arcgame=snake', tron: '&arcmode=mass&arcgame=tron', megaship: '&arcmode=mass&arcgame=megaship', brawl: '&arcmode=mass&arcgame=brawl', drawguess: '&arcmode=mass&arcgame=drawguess',
  chess: '&arcmode=1v1&arcgame=chess', connect4: '&arcmode=1v1&arcgame=connect4', pong: '&arcmode=2v2&arcgame=pong', tronduel: '&arcmode=2v2&arcgame=tronduel', snakebattle: '&arcmode=2v2&arcgame=snakebattle', uttt: '&arcmode=1v1&arcgame=uttt' };
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, protocolTimeout: 240000, args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const out = []; const WIN = Number(process.env.WIN || 6000);
for (const [name, q] of Object.entries(GAMES)) { if (only && !only.includes(name)) continue;
  const p = await b.newPage(); p.setDefaultTimeout(120000); await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const cdp = await p.createCDPSession(); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p.evaluateOnNewDocument(() => { localStorage.setItem('cm.sound', 'off'); localStorage.setItem('cm.arc.3d', 'on'); localStorage.setItem('cybermates:perf-skipgates', '1'); globalThis.__cmAckTest = { minMs: 0, noScroll: true }; });
  const t0 = Date.now(); await p.goto(U + '?loaderMin=0&force3d=1' + q);
  const ag = await p.waitForSelector('#ag-dob', { timeout: 30000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.$eval('#ag-go', e => e.click()); }
  const tm = await p.waitForSelector('#tm-ok', { timeout: 20000 }).catch(() => null); if (tm) { await p.$eval('#tm-ok', e => e.click()); await p.$eval('#tm-yes', e => e.click()); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'), { timeout: 90000 }); await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Skip')?.click());
  const tApp = Date.now(); await p.$eval('nav [data-tab=arcade]', e => e.click());
  await p.waitForFunction(() => [...document.querySelectorAll('canvas')].some(c => c.offsetParent && c.width > 0 && /arc|m-|br/.test(c.id)), { timeout: 60000 }).catch(() => null);
  await new Promise(r => setTimeout(r, 2500)); const tGame = Date.now() - tApp;
  const r = await p.evaluate(ms => new Promise(res => { const ft = []; let last = performance.now(); const end = last + ms; const f = t => { ft.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else res(ft); }; requestAnimationFrame(f); }), WIN);
  const s = [...r].sort((a, c) => a - c), pct = k => s[Math.min(s.length - 1, Math.floor(s.length * k))];
  const three = await p.evaluate(() => { const c = [...document.querySelectorAll('canvas')].find(x => !x.hidden && /3d/.test(x.id)); return !!c; });
  const row = { game: name, fps: +(r.length / (WIN / 1000)).toFixed(1), p50: +pct(0.5).toFixed(1), p95: +pct(0.95).toFixed(1), loadMs: tGame, three }; out.push(row); console.log(JSON.stringify(row));
  await p.close(); }
await b.close(); if (srv) try { process.kill(-srv.pid); } catch {}
fs.mkdirSync('/workspace/cybermates-shots/perf', { recursive: true }); fs.writeFileSync(`/workspace/cybermates-shots/perf/${label}.json`, JSON.stringify(out, null, 1)); console.log('saved', label);
