// v37 DEVICE LINKING UI (Profile -> 📱 Linked devices). Real app (public build in dist/, vite preview), Playwright with
// isolated browser contexts = separate phones. A test relay stands in for the network between them (__cmLinkTest.bus).
//  1) A "Link a new device": QR renders + decodes (jsQR) to the signed offer, 8-char code, 5-min countdown
//  2) B "Link to an existing profile" -> camera scan (BarcodeDetector polyfill fed by a fake camera showing A's QR)
//     -> request -> A approve prompt with matching check code -> grant -> B shares A's network ID; A shows 2 of 5
//  3) C short code: bad format / unknown code / deny / expired (A side and C side)
//  4) device cap: approve at 5 of 5 refused on both sides; a full profile shows the cap message + disabled button
//  Run after `npm run build`. node scripts/smoke-linking-ui.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { qrMatrix } from '../src/qr.js';
import * as L from '../src/linking.js';
const req = createRequire(import.meta.url), pick = async (...ids) => { for (const id of ids) try { return await import(id); } catch {} throw new Error('missing ' + ids[0] + ' (npm i -D playwright-core jsqr, or /workspace/wk)'); };
const { chromium } = await pick('playwright-core', '/workspace/wk/node_modules/playwright-core/index.mjs', 'playwright');
const jsQR = (await pick('jsqr', '/workspace/wk/node_modules/jsqr/dist/jsQR.js')).default;
const JSQR_PATH = (() => { try { return req.resolve('jsqr/dist/jsQR.js'); } catch { return '/workspace/wk/node_modules/jsqr/dist/jsQR.js'; } })();
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail = 1; };
const wait = ms => new Promise(r => setTimeout(r, ms));
// ---- pure: encoder round-trips through an independent decoder; crypto flow + cap + expiry
for (const t of ['A', 'CML1~' + 'X'.repeat(170), 'y'.repeat(300)]) { const q = qrMatrix(t), s = 4, m = 4, W = (q.size + 2 * m) * s, d = new Uint8ClampedArray(W * W * 4).fill(255);
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.get(x, y)) for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) { const o = (((y + m) * s + dy) * W + (x + m) * s + dx) * 4; d[o] = d[o + 1] = d[o + 2] = 0; }
  ok(jsQR(d, W, W)?.data === t, `qr.js: ${t.length}-byte payload (v${q.version}) decodes with jsQR`); }
{ const nacl = (await import('tweetnacl')).default, B = x => Buffer.from(x).toString('base64'), k = nacl.sign.keyPair(), pk = { pub: B(k.publicKey), sec: B(k.secretKey) };
  const off = L.makeOffer({ pid: 'PID', profileKeys: pk, now: 0 }); let threw = false; try { L.makeRequest(off, { devKeys: pk, boxKeys: { xpub: B(nacl.box.keyPair().publicKey) }, hash: 'h', now: L.LINK_TTL_MS + 1 }); } catch { threw = true; }
  ok(threw && L.LINK_TTL_MS === 300e3 && L.MAX_DEVICES === 5, 'linking.js: offer expires after 5 min; cap is 5'); }

// ---- browser
const PORT = 4197, U = `http://localhost:${PORT}/`;
const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
let browser; const done = async c => { try { await browser?.close(); } catch {} try { process.kill(-srv.pid); } catch {} console.log(c ? 'LINKING UI SMOKE: FAIL' : 'LINKING UI SMOKE: PASS'); process.exit(c); };
setTimeout(() => { console.log('FAIL global timeout'); done(1); }, 420e3);
await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost/.test(d) && res()); setTimeout(() => rej(new Error('preview timeout')), 20000); });
browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
// relay: every device subscribes to channel names; a send is delivered to all OTHER devices on that channel
const devices = []; const subs = new Map(); // name -> Set(page)
async function device(tag, { cam = false, init = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: `Mozilla/5.0 (Linux; Android 14; Pixel ${tag}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36` }); // distinct phone => distinct device ID
  const p = await ctx.newPage(); p.setDefaultTimeout(60000); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.tag = tag; p.errs = errs;
  await p.exposeFunction('__cmRelaySend', (name, m) => { for (const o of subs.get(name) || []) if (o !== p) o.evaluate(([n, x]) => globalThis.__cmRelayRecv(n, x), [name, m]).catch(() => {}); });
  await p.exposeFunction('__cmRelaySub', name => { (subs.get(name) || subs.set(name, new Set()).get(name)).add(p); });
  await p.addInitScript(init => { localStorage.setItem('cm.sound', 'off'); globalThis.__cmAckTest = { minMs: 0, noScroll: true }; const fns = new Map();
    globalThis.__cmRelayRecv = (n, m) => (fns.get(n) || []).forEach(f => f(m));
    globalThis.__cmLinkTest = { timeoutMs: 3000, ...init, bus: name => { globalThis.__cmRelaySub(name); let mine = null; return { send: m => globalThis.__cmRelaySend(name, m), on: fn => { mine = fn; (fns.get(name) || fns.set(name, []).get(name)).push(fn); }, close: () => fns.set(name, (fns.get(name) || []).filter(f => f !== mine)) }; } }; }, init);
  if (cam) { await p.addInitScript({ path: JSQR_PATH }); await p.addInitScript(() => {
    // fake rear camera: a canvas stream showing whatever image the test puts up (A's QR); BarcodeDetector backed by jsQR
    globalThis.__camImg = null; const cv = document.createElement('canvas'); cv.width = cv.height = 360; const g = cv.getContext('2d');
    setInterval(() => { g.fillStyle = '#777'; g.fillRect(0, 0, 360, 360); if (globalThis.__camImg) g.drawImage(globalThis.__camImg, 40, 40, 280, 280); }, 100);
    navigator.mediaDevices.getUserMedia = async () => cv.captureStream(10);
    globalThis.BarcodeDetector = class { constructor(o) { this.o = o; } async detect(src) { const c = document.createElement('canvas'); c.width = src.videoWidth || 360; c.height = src.videoHeight || 360; const x = c.getContext('2d'); x.drawImage(src, 0, 0, c.width, c.height);
      const r = globalThis.jsQR(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height); return r ? [{ rawValue: r.data, format: 'qr_code' }] : []; } }; }); }
  const r = await p.goto(U + '?loaderMin=0&ftue=reset'); ok(r.status() === 200, `${tag}: app loads`);
  await p.waitForSelector('#ag-dob'); await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.$eval('#ag-go', e => e.click());
  await p.waitForSelector('#tm-ok'); await p.$eval('#tm-ok', e => e.click()); await p.$eval('#tm-yes', e => e.click());
  await p.waitForSelector('#losswarn', { timeout: 15000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {});
  await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'), null, { timeout: 120000 });
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Skip')?.click()); await wait(600); await p.evaluate(() => document.getElementById('moodpick')?.remove());
  await p.$eval('nav [data-tab=profile]', e => e.click()); await p.waitForSelector('#devlink', { timeout: 30000 });
  await p.$eval('#devlink', e => { e.open = true; e.scrollIntoView(); }); await p.waitForFunction(() => /of 5|linked/.test(document.querySelector('#dl-count')?.textContent || ''));
  devices.push(p); return p;
}
const S = p => p.evaluate(() => globalThis.__cmLink?.());
const errText = p => p.$eval('#dl-err', e => e.textContent);
const until = (p, fn, arg, ms = 20000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 200 }).then(() => true, () => false);
try {
  const A = await device('A'), B = await device('B', { cam: true });
  ok(/1 of 5/.test(await A.$eval('#dl-count', e => e.textContent)), 'A: linked devices list shows 1 of 5');
  await A.click('#dl-new'); await A.waitForSelector('#dl-qr');
  const a1 = await S(A); const qr = await A.$eval('#dl-qr', c => ({ w: c.width, h: c.height, px: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data), url: c.toDataURL() }));
  const dec = jsQR(Uint8ClampedArray.from(qr.px), qr.w, qr.h)?.data || '';
  ok(qr.w > 100 && dec.startsWith('CML1~' + a1.pid + '~'), `A: QR renders locally (${qr.w}px) and decodes to the signed offer for ${a1.pid}`);
  ok(/^[A-Z0-9]{8}$/.test(a1.code) && (await A.$eval('#dl-code', e => e.textContent.replace(/\s/g, ''))) === a1.code, 'A: 8-char short code shown ' + a1.code);
  const t0 = await A.$eval('#dl-timer', e => e.textContent); ok(/^[45]:\d\d$/.test(t0), 'A: 5-minute countdown ' + t0);
  await A.screenshot({ path: '/workspace/cm-v37-push/shots-A-offer.png' }).catch(() => {});
  // B scans with the camera
  await B.click('#dl-new'); await B.waitForSelector('#dl-qr'); const ownB = (await S(B)).pid; ok(ownB && ownB !== a1.pid, `B starts with its own device ID ${ownB} (A is ${a1.pid})`);
  await B.click('#dl-join'); await B.waitForSelector('#dl-scan'); await B.evaluate(u => new Promise(r => { const i = new Image(); i.onload = () => { globalThis.__camImg = i; r(); }; i.src = u; }), qr.url);
  await B.click('#dl-scan'); ok(await until(B, () => globalThis.__cmLink?.().state === 'waiting'), 'B: camera scan read the QR and sent a signed request');
  ok(await until(A, () => document.querySelector('#dl-ok')), 'A: approve/deny prompt appears');
  const [ca, cb] = [await A.$eval('#dl-check', e => e.textContent), await B.$eval('#dl-check', e => e.textContent)]; ok(ca && ca === cb, `check code matches on both devices (${ca})`);
  await A.screenshot({ path: '/workspace/cm-v37-push/shots-A-prompt.png' }).catch(() => {});
  await A.click('#dl-ok'); ok(await until(B, () => globalThis.__cmLink?.().state === 'done'), 'B: grant accepted');
  const b1 = await S(B); ok(b1.pid === a1.pid, 'B now shares A\'s profile network ID ' + b1.pid);
  ok(/linked to profile/.test(await B.$eval('#dl-list', e => e.textContent)), 'B: list says this device is linked');
  ok(await until(A, () => /2 of 5/.test(document.querySelector('#dl-count').textContent)) && /now linked/.test(await A.$eval('#dl-stage', e => e.textContent)), 'A: list shows 2 of 5 after approve');
  await B.screenshot({ path: '/workspace/cm-v37-push/shots-B-linked.png' }).catch(() => {});
  // C: short-code entry
  const C = await device('C');
  await C.click('#dl-join'); await C.fill('#dl-input', 'ZZZ'); await C.click('#dl-send'); ok(/8 letters or numbers/.test(await errText(C)), 'C: malformed code -> plain error');
  await C.fill('#dl-input', 'ZZZZ9999'); await C.click('#dl-send'); ok(await until(C, () => /No device answered/.test(document.querySelector('#dl-err').textContent), null, 8000), 'C: unknown code -> "No device answered" error');
  await A.click('#dl-new'); await A.waitForSelector('#dl-qr'); let a2 = await S(A);
  await C.fill('#dl-input', a2.code.toLowerCase().slice(0, 4) + ' ' + a2.code.slice(4)); await C.click('#dl-send');
  ok(await until(A, () => document.querySelector('#dl-no')), 'C: short code (spaces/lowercase ok) reached A -> prompt'); await A.click('#dl-no');
  ok(await until(C, () => /declined/.test(document.querySelector('#dl-err').textContent)), 'deny -> C shows "declined"');
  // expired on A's side (A clock +6 min): A shows expired; C typing the code gets the expired error
  await A.evaluate(() => { globalThis.__cmLinkTest.skew = 6 * 60e3; }); ok(await until(A, () => /expired/i.test(document.querySelector('#dl-err').textContent), null, 5000) && await A.$('#dl-again'), 'A: countdown hits 0 -> "expired" + Make a new code');
  await C.click('#dl-send'); ok(await until(C, () => /expired/.test(document.querySelector('#dl-err').textContent), null, 6000), 'C: code of an expired offer -> expired error');
  await A.evaluate(() => { globalThis.__cmLinkTest.skew = 0; });
  // expired on C's side (C clock +6 min, A fresh offer): C refuses before sending a request
  await A.click('#dl-again'); await A.waitForSelector('#dl-qr'); a2 = await S(A); await C.evaluate(() => { globalThis.__cmLinkTest.skew = 6 * 60e3; });
  await C.fill('#dl-input', a2.code); await C.click('#dl-send'); ok(await until(C, () => /expired/.test(document.querySelector('#dl-err').textContent), null, 6000) && (await S(A)).state === 'showing', 'C: expired offer refused locally, no request reaches A');
  await C.evaluate(() => { globalThis.__cmLinkTest.skew = 0; });
  // cap at approve time: A grows to 5 of 5 (seeded test devices) while C's request is pending
  await C.click('#dl-send'); ok(await until(A, () => document.querySelector('#dl-ok')), 'C: request pending on A');
  await A.evaluate(() => { globalThis.__cmLinkTest.seedLinked = 4; }); await A.click('#dl-ok');
  ok(await until(A, () => /maximum of 5/.test(document.querySelector('#dl-err').textContent)), 'A: approve at 5 of 5 -> cap error');
  ok(await until(C, () => /maximum of 5/.test(document.querySelector('#dl-err').textContent)), 'C: told the profile is at the device cap');
  ok(/5 of 5/.test(await A.$eval('#dl-count', e => e.textContent)) && !(await A.$eval('#dl-cap', e => e.hidden)) && await A.$eval('#dl-new', e => e.disabled), 'A: 5 of 5, cap message shown, "Link a new device" disabled');
  await A.screenshot({ path: '/workspace/cm-v37-push/shots-A-cap.png' }).catch(() => {});
  const D = await device('D', { init: { seedLinked: 4 } });
  ok(/5 of 5/.test(await D.$eval('#dl-count', e => e.textContent)) && /maximum of 5/.test(await D.$eval('#dl-cap', e => e.textContent)) && await D.$eval('#dl-new', e => e.disabled), 'D (full profile): cap message on open, button disabled');
  for (const p of devices) ok(p.errs.length === 0, `${p.tag}: no page errors${p.errs.length ? ' -> ' + p.errs.slice(0, 3).join(' | ') : ''}`);
} catch (e) { console.log('FAIL exception', e.message); fail = 1; }
await done(fail);
