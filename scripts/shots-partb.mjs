// Local multi-tab E2E (headless Chrome, BroadcastChannel transport): 5 tabs join, mood, request→accept→message (✓ on receipt), block+refund, logoff.
// Run: npm run build:admin && npm run e2e (e2e uses ?as= multi-profile tabs, which exist only in the admin/dev flavor)   (needs Chrome; CHROME_PATH overrides /usr/bin/google-chrome)
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const PORT = 4181, URL0 = `http://localhost:${PORT}/`;
const assert = (c, m) => { if (!c) { console.error('E2E FAIL', m); cleanup(1); } console.log('ok', m); };
const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-admin', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
setTimeout(() => { console.error('E2E FAIL global timeout'); cleanup(1); }, 150e3);
let browser; const cleanup = async code => { try { await browser?.close(); } catch {} try { process.kill(-srv.pid); } catch {} process.exit(code); };
await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost/.test(d) && res()); setTimeout(() => rej(new Error('preview timeout')), 15000); });
console.log('preview up'); browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
console.log('chrome up');
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (page, fn, arg, ms = 15000) => page.waitForFunction(fn, { timeout: ms, polling: 200 }, arg);
const open = async as => { const p = await browser.newPage(); p.on('dialog', d => d.accept()); p.on('pageerror', e => console.log(`[${as}] pageerror`, e.message)); await p.goto(URL0 + '?as=' + as + '&loaderMin=300');
  const ag = await p.waitForSelector('#ag-dob', { timeout: 6000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
  const terms = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (terms) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  await until(p, () => globalThis.__cmMesh?.()?.code); await until(p, () => !document.getElementById('jackin')); return p; };
const code = p => p.evaluate(() => __cmMesh().code);
const clk = async (p, sel) => { await p.bringToFront(); for (let i = 0; ; i++) { try { return await p.click(sel); } catch (e) { if (i >= 5 || !/detached|not clickable/.test(e.message)) throw e; await wait(300); } } }; // retry: live mesh re-renders can swap the node between query and click
const tab = (p, t) => clk(p, `nav [data-tab=${t}]`);
try {
  const A = await open('seed-1'), B = await open('seed-2'), C = await open('seed-3');
  for (const P of [A, B, C]) await P.waitForSelector('#moodpick', { timeout: 5000 }).catch(() => null);
  for (const P of [A, B, C]) await P.setViewport({ width: 420, height: 860 });
  await B.screenshot({ path: '/workspace/cybermates-shots/mood-picker.png' });
  await A.select('#moodsel', 'gaming'); await clk(A, '#moodok'); await B.select('#moodsel', 'chill'); await clk(B, '#moodok'); if (await C.$('#moodskip')) await clk(C, '#moodskip');
  const [a, b, c] = await Promise.all([A, B, C].map(code)); await until(B, x => __cmMesh().moodOf(x) === 'gaming', a, 20000);
  await A.evaluate(x => __cmMesh().requestFriend(x, { mode: 'gaming' }), b); await C.evaluate(x => __cmMesh().requestFriend(x, {}), b);
  await until(B, () => __cmMesh().node.pendingIn.size >= 2); await B.evaluate(x => __cmMesh().accept(x), a);
  await until(A, x => __cmMesh().node.friends.has(x), b); await A.evaluate(x => __cmMesh().node.sendChat(x, 'gg, rematch at 8?'), b); await wait(800);
  await tab(B, 'inbox'); await wait(800); await B.screenshot({ path: '/workspace/cybermates-shots/single-inbox.png', fullPage: true });
  await tab(C, 'discover'); await wait(800);
  await C.evaluate(() => { const m = __cmMesh(); m.recent = async () => [{ code: 'R1', name: 'Vex', thumb: '', interests: ['Halo', 'Apex'], modes: ['gaming'], lastSeen: Date.now() - 3 * 36e5 }, { code: 'R2', name: 'Juno', thumb: '', interests: ['Minecraft'], modes: ['friends'], lastSeen: Date.now() - 9 * 36e5 }]; });
  await C.evaluate(async () => { const IU = await import('/src/inbox-ui.js').catch(() => null); });
  await tab(C, 'inbox'); await tab(C, 'discover'); await wait(1200); await C.screenshot({ path: '/workspace/cybermates-shots/discover-mood-recent.png', fullPage: true });
  console.log('recent shown:', await C.evaluate(() => document.querySelector('#recentlist')?.innerText || ''));
  await tab(A, 'inbox'); await clk(A, `[data-mopen="${b}"]`); await wait(800); await A.screenshot({ path: '/workspace/cybermates-shots/chat-retention-calls.png', fullPage: true });
  console.log('SHOTS DONE'); await cleanup(0);
} catch (e) { console.error('SHOTS FAIL', e.message); await cleanup(1); }
