// v43 ID BINDING in real tabs (admin/dev flavor, BroadcastChannel mesh). Run after build:admin.
//  A and B join (each pays the one-time proof-of-work join cost, measured in the browser) and learn each other's key through
//  the binder. Then forged pings claiming B's ID are injected on the shared channel: no proof / the attacker's OWN valid PoW claim
//  / B's real claim replayed with the attacker's key -> all dropped by A BEFORE the key is learned; A still talks to B's real key.
//  A brand-new ID with a valid claim is accepted (join cost paid). C joins with 4x CPU throttling (normal-phone stand-in) and
//  its join cost is reported; A reloads and does NOT pay the PoW again (claim cached in the vault). No page errors.
//    node scripts/e2e-idbind.mjs
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import nacl from 'tweetnacl';
import { E2E } from '../src/e2e.js';
import { makeClaim } from '../src/idbind.js';
import { b64 } from '../src/vault.js';
const PORT = 4194, URL0 = `http://localhost:${PORT}/`;
let browser, errs = []; const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-admin', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
const cleanup = async code => { try { await browser?.close(); } catch {} try { process.kill(-srv.pid); } catch {} process.exit(code); };
const assert = (c, m) => { if (!c) { console.error('E2E FAIL', m); cleanup(1); } else console.log('ok', m); };
setTimeout(() => { console.error('E2E FAIL global timeout'); cleanup(1); }, 240e3);
await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost/.test(d) && res()); setTimeout(() => rej(new Error('preview timeout')), 15000); });
browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, { timeout: ms, polling: 250 }, arg).catch(e => { throw new Error(e.message + ' :: ' + String(fn).slice(0, 140)); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const boot = async (p, as) => { await p.goto(URL0 + '?as=' + as + '&loaderMin=300');
  const ag = await p.waitForSelector('#ag-dob', { timeout: 15000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
  const terms = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (terms) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  await until(p, () => globalThis.__cmMesh?.()?.code, null, 45000); };
const open = async (as, { cpu = 1 } = {}) => { const p = await browser.newPage(); await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: false });
  await p.evaluateOnNewDocument(() => { globalThis.__cmAckTest = { minMs: 0, noScroll: true }; localStorage.setItem('cm.sound', 'off'); }); p.on('dialog', d => d.accept());
  p.on('pageerror', e => { errs.push(`[${as}] ${e.message}`); console.log(`[${as}] pageerror`, e.message); });
  if (cpu > 1) { const s = await p.target().createCDPSession(); await s.send('Emulation.setCPUThrottlingRate', { rate: cpu }); p._cdp = s; }
  await boot(p, as); return p; };
const M = (p, fn, arg) => p.evaluate(fn, arg);
try {
  const A = await open('seed-2'), Bp = await open('seed-5');
  const a = await M(A, () => ({ code: __cmMesh().code, pub: __cmMesh().bindClaim.pub, t: globalThis.__cmBindTiming || [] })), b = await M(Bp, () => ({ code: __cmMesh().code, claim: __cmMesh().bindClaim, t: globalThis.__cmBindTiming || [] }));
  assert(a.t.length === 1 && b.t.length === 1 && a.code !== b.code, `both tabs paid the one-time join cost in the browser (A ${a.t[0]} ms, B ${b.t[0]} ms)`);
  await until(A, c => __cmMesh().e2e.peers.has(c) && __cmMesh().binder.level(c) === 'pow', b.code, 30000); await until(Bp, c => __cmMesh().e2e.peers.has(c), a.code, 30000);
  const realB = b.claim.pub; assert(await M(A, c => __cmMesh().e2e.peers.get(c).pub, b.code) === realB, 'A learned B through its binding proof (level pow) and pinned B\'s real key');
  // forged pings claiming B's ID (built here in node with an attacker key, injected on the shared BroadcastChannel)
  const ak = nacl.sign.keyPair(), keys = { pub: b64(ak.publicKey), sec: b64(ak.secretKey) }, att = new E2E({ code: b.code, keys });
  const own = await makeClaim({ code: b.code, keys });
  const forge = bd => { att.bindProof = bd; return { k: 'mesh', env: att.sealBroadcast({ id: 'f' + Math.random().toString(36).slice(2), from: b.code, to: '*', ttl: 3, type: 'ping', body: { pub: keys.pub } }) }; };
  const pk = [forge(null), forge(own), forge(b.claim)];
  const before = await M(A, () => ({ d: __cmMesh().e2e.bindDrops, s: { ...__cmMesh().binder.stats } }));
  await M(Bp, ps => { const ch = new BroadcastChannel('cm-mesh'); for (const m of ps) ch.postMessage(m); setTimeout(() => ch.close(), 500); }, pk); await wait(1500);
  const after = await M(A, c => ({ d: __cmMesh().e2e.bindDrops, s: { ...__cmMesh().binder.stats }, pub: __cmMesh().e2e.peers.get(c)?.pub, lvl: __cmMesh().binder.level(c) }), b.code);
  assert(after.d - before.d === 3 && after.pub === realB && after.lvl === 'pow', `3 forged pings for B's ID (no proof / attacker's own PoW claim / B's claim + attacker key) dropped by A (bindDrops ${before.d} -> ${after.d}); B still bound to its real key`);
  assert(after.s.idBound === before.s.idBound + 3 && after.s.pinned === before.s.pinned, `binder: all 3 refused as id-bound (B's ID already bound to another key), nothing re-pinned`);
  await wait(1200); assert(await M(A, c => __cmMesh().e2e.peers.get(c)?.pub === undefined ? false : __cmMesh().online().includes(c), b.code), 'A still sees the real B online after the spoof attempt');
  // a brand-new ID: no proof dropped, valid claim (join cost paid) accepted
  const zk = nacl.sign.keyPair(), zkeys = { pub: b64(zk.publicKey), sec: b64(zk.secretKey) }, Z = 'NEWSTRANGER23456', ze = new E2E({ code: Z, keys: zkeys }), zc = await makeClaim({ code: Z, keys: zkeys });
  const zp = bd => { ze.bindProof = bd; return { k: 'mesh', env: ze.sealBroadcast({ id: 'z' + Math.random().toString(36).slice(2), from: Z, to: '*', ttl: 3, type: 'ping', body: { pub: zkeys.pub } }) }; };
  await M(Bp, ps => { const ch = new BroadcastChannel('cm-mesh'); ch.postMessage(ps[0]); setTimeout(() => { ch.postMessage(ps[1]); setTimeout(() => ch.close(), 300); }, 400); }, [zp(null), zp(zc)]); await wait(1500);
  assert(await M(A, z => __cmMesh().binder.level(z) === 'pow' && __cmMesh().e2e.peers.get(z)?.pub, Z) === zkeys.pub, 'new ID: ping without proof dropped, then accepted with a valid PoW claim (join cost paid)');
  // phone stand-in: 4x CPU throttle
  const C = await open('seed-7', { cpu: 4 }); const ct = await M(C, () => globalThis.__cmBindTiming || []);
  assert(ct.length === 1 && ct[0] < 6000, `C (4x CPU throttle, normal-phone stand-in) join cost ${ct[0]} ms`);
  await until(A, () => { const m = __cmMesh(); return [...m.e2e.peers.keys()].length >= 3; }, null, 30000);
  // reload A: claim cached in the vault -> no PoW again
  await C._cdp?.send('Emulation.setCPUThrottlingRate', { rate: 1 }); await boot(A, 'seed-2');
  const a2 = await M(A, () => ({ code: __cmMesh().code, pub: __cmMesh().bindClaim.pub, t: globalThis.__cmBindTiming || [] }));
  assert(a2.code === a.code && a2.pub === a.pub && a2.t.length === 0, 'A reloaded: same ID + key, claim reused from the vault (no second PoW)');
  await until(Bp, c => __cmMesh().e2e.peers.get(c)?.pub === undefined ? false : true, a.code, 20000);
  assert(errs.length === 0, 'no page errors in any tab' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await cleanup(0);
} catch (e) { console.error('E2E FAIL', e.message); await cleanup(1); }
