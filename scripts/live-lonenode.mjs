// v56: a LONE phone must become a mesh node (mesh() set, status online) against a deployed build (live Supabase + /api/bootstrap).
// Usage: node scripts/live-lonenode.mjs <url>   (default production). Reproduced v55 bug: TDZ in app-mesh => mesh() null forever.
import puppeteer from 'puppeteer-core';
const U = (process.argv[2] || 'https://cybermates.vercel.app/').replace(/\/?$/, '/');
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const p = await b.newPage(); p.on('pageerror', e => console.log('PAGEERR', e.message)); p.on('console', m => m.type() === 'error' && console.log('CERR', m.text().slice(0, 200))); await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true }); const errs = [];
p.on('console', async m => { if (m.text().startsWith('mesh')) { const a = m.args()[1]; errs.push(a ? await a.evaluate(e => String(e?.message || e)).catch(() => '?') : m.text()); } });
await p.evaluateOnNewDocument(() => { localStorage.setItem('cm.sound', 'off'); globalThis.__cmAckTest = { minMs: 0, noScroll: true }; });
if (process.argv[3]) await p.goto(process.argv[3]); // optional Vercel share link (sets the preview access cookie)
await p.goto(U + '?loaderMin=0');
if (await p.waitForSelector('#ag-dob', { timeout: 8000 }).catch(() => null)) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.$eval('#ag-go', e => e.click()); }
if (await p.waitForSelector('#tm-ok', { timeout: 5000 }).catch(() => null)) { await p.$eval('#tm-ok', e => { e.checked = true; e.dispatchEvent(new Event('change')); }); await new Promise(r => setTimeout(r, 500)); await p.$eval('#tm-yes', e => e.click()).catch(() => {}); await p.waitForSelector('#loss-ok', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
const ok = await p.waitForFunction(() => !!globalThis.__cmMesh?.()?.code, { timeout: 45000, polling: 500 }).then(() => true).catch(() => false);
const st = await p.evaluate(() => ({ code: globalThis.__cmMesh?.()?.code || null, peers: globalThis.__cmMesh?.()?.online?.().length ?? null, starting: document.body.innerText.includes('Live mesh is starting') }));
await p.evaluate(() => document.querySelector('nav [data-tab=friends]')?.click()); await new Promise(r => setTimeout(r, 800));
for (const s of ['#moodskip', '#loss-ok']) await p.$eval(s, e => e.click()).catch(() => {}); await p.evaluate(() => document.querySelector('nav [data-tab=friends]')?.click()); await new Promise(r => setTimeout(r, 1500));
const fl = await p.evaluate(() => !!document.querySelector('[data-flcreate], [data-flhost], [data-flconnecting]'));
if (!fl) console.log(await p.evaluate(() => (document.querySelector('#view')?.innerText || '').slice(0, 300) + ' || nav:' + !!document.querySelector('nav [data-tab=friends]')));
console.log(JSON.stringify({ url: U, meshNode: ok, ...st, friendLinkUI: fl, errors: [...new Set(errs)].slice(0, 3) }));
await b.close(); process.exit(ok && !st.starting && fl ? 0 : 1);
