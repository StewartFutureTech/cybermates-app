// Local multi-tab E2E (headless Chrome, BroadcastChannel transport): 5 tabs join, mood, request→accept→message (✓ on receipt), block+refund, logoff.
// Run: npm run build:admin && npm run e2e (e2e uses ?as= multi-profile tabs, which exist only in the admin/dev flavor)   (needs Chrome; CHROME_PATH overrides /usr/bin/google-chrome)
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const PORT = +(process.env.PORT || 4195), URL0 = `http://localhost:${PORT}/`;
const assert = (c, m) => { if (!c) { console.error('E2E FAIL', m); cleanup(1); } console.log('ok', m); };
const srv = spawn('npx', ['vite', 'preview', '--outDir', process.env.DIST || 'dist-admin', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
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

// 390px screenshots of the main screens: SHOT_PREFIX=/workspace/cybermates-shots/ui-neon-before node scripts/shots-neon.mjs
const pre = process.env.SHOT_PREFIX || '/workspace/cybermates-shots/ui-neon-after'; const A = await open('seed-1'); await A.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 }); await wait(1500);
const skip = () => A.evaluate(() => { document.getElementById('moodpick')?.remove(); return [...document.querySelectorAll('button')].filter(b => /^(Skip|Not now|Later)$/i.test(b.textContent.trim())).forEach(b => b.click()); });
const tab = t => A.$eval(`nav button[data-tab="${t}"]`, b => b.click()).catch(() => {});
for (const t of ['discover', 'friends', 'inbox', 'profile', 'shop']) { await tab(t); await wait(700); await skip(); await wait(300); await A.evaluate(() => scrollTo(0, 0)); await skip(); await A.screenshot({ path: `${pre}-${t}.png` }); console.log('shot', `${pre}-${t}.png`); }
await tab('profile'); await wait(600); const lk = await A.$('#look'); if (lk) { await lk.evaluate(e => e.scrollIntoView({ block: 'center' })); await wait(400); await skip(); await A.screenshot({ path: `${pre}-settings.png` }); console.log('shot settings'); }
cleanup(0);
