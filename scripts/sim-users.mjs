#!/usr/bin/env node
// DEV-ONLY simulated test users ("bot phones"). Runs N headless Chrome phones that join the mesh with clearly-flagged
// TEST profiles (name prefix "TEST·", profile.test = true), go online/offline, accept starters + friend requests, and reply
// with simple canned lines (no AI). Usage + safety rules: README → "Simulated test users".
//   npm run build:admin && node scripts/sim-users.mjs                    # local: serves dist-admin, bots in one Chrome
//   node scripts/sim-users.mjs --url https://<dev-preview>.vercel.app --dev --n 8 --near "41.88,-87.63,Chicago,IL,US"
// Options: --probe (self-test, then exit) --n <bots=6> --url <app> --dev --minutes <run time, default forever> --offline <0..1 chance per minute=0.25> --headful
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { makeSeed } from '../src/data.js';
const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; }, flag = k => argv.includes('--' + k);
const N = Math.min(+arg('n', 6), 20), MIN = +arg('minutes', 0), OFF = +arg('offline', 0.25), DEV = flag('dev') || process.env.CM_SIM_DEV === '1';
let URL0 = arg('url', '');
const PROD = (process.env.CM_PROD_HOSTS || 'cybermates-stewart-future-tech.vercel.app,cybermates.app,www.cybermates.app').split(',').map(s => s.trim()).filter(Boolean);
const die = m => { console.error('sim-users: ' + m); process.exit(2); };
// ---- safety gate: localhost is fine; anything else needs --dev / CM_SIM_DEV=1; production hosts are always refused ----
if (URL0) { const h = new URL(URL0).hostname;
  if (PROD.includes(h)) die(`refusing to run bots against production host ${h}. Use a dev/preview deployment.`);
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(h) && !DEV) die(`${h} is not localhost. Re-run with --dev (or CM_SIM_DEV=1) to confirm this is a DEV/preview deployment.`); }
let srv = null;
if (!URL0) { const PORT = 4190; srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-admin', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
  await new Promise((r, j) => { srv.stdout.on('data', d => /localhost/.test(d) && r()); setTimeout(() => j(new Error('preview timeout (did you run npm run build:admin?)')), 15000); }); URL0 = `http://localhost:${PORT}/`; }
const near = arg('near', ''); const [nlat, nlng, ncity, nreg, ncc] = near ? near.split(',') : [];
const MODES = [['friends'], ['gaming'], ['dating'], ['friends', 'gaming'], ['gaming', 'dating'], ['friends', 'gaming', 'dating']];
const seeds = makeSeed();
const profileFor = i => { const s = structuredClone(seeds[i % seeds.length]); const first = s.name.replace(/ \(TEST\)$/, '');
  Object.assign(s, { id: 'bot-' + (i + 1), seed: false, test: true, name: 'TEST·' + first, lookingFor: MODES[i % MODES.length], bio: `🤖 Simulated test user #${i + 1} (dev bot, not a real person). Into ${s.games[0] || 'games'} and ${s.interests[0] || 'music'}.` });
  if (near) Object.assign(s, { lat: +nlat + (Math.random() - .5) * .05, lng: +nlng + (Math.random() - .5) * .05, city: ncity, region: nreg, countryCode: ncc, location: `${ncity}, ${nreg}, ${ncc}` });
  return s; };
const REPLIES = ['hey! 👋 (test bot)', 'nice, what are you playing lately?', 'lol same', 'I\'m a simulated test user, but go on 🙂', 'sounds fun!', 'brb, queueing a match', 'gg', 'what city are you in?', 'that\'s cool — tell me more', '🤖 beep boop, message received'];
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: !flag('headful'), args: ['--no-sandbox', '--autoplay-policy=user-gesture-required'] });
const log = (i, ...m) => console.log(new Date().toLocaleTimeString(), `[TEST·bot-${i + 1}]`, ...m);
async function goOnline(bot) {
  const p = bot.page = await bot.ctx.newPage(); p.on('dialog', d => d.accept()); p.on('pageerror', e => log(bot.i, 'pageerror', e.message));
  const u = `${URL0}?as=${bot.profile.id}&loaderMin=0`; await p.goto(u);
  const ag = await p.waitForSelector('#ag-dob', { timeout: 6000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1990-01-01'); await p.click('#ag-go'); }
  const t = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (t) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  const hasDev = await p.waitForFunction(() => !!globalThis.__cmDev, { timeout: 8000 }).then(() => true, () => false);
  if (!hasDev) die('target is not an admin/dev build (no __cmDev hook). Build with npm run build:admin; bots never run against public builds.');
  if (!(await p.evaluate(id => __cmDev.db.getProfile(id), bot.profile.id))) { await p.evaluate(pr => __cmDev.db.upsertProfile(pr), bot.profile); await p.goto(u); }
  await p.waitForFunction(() => globalThis.__cmMesh?.()?.code, { timeout: 30000 }); bot.code = await p.evaluate(() => __cmMesh().code);
  log(bot.i, 'online as', bot.code, '·', (bot.profile.lookingFor || ['probe']).join('/'));
}
async function goOffline(bot) { try { await bot.page?.close({ runBeforeUnload: true }); } catch {} bot.page = null; log(bot.i, 'offline'); }
async function tick(bot) { // accept friend requests; reply to any chat whose last message is from the peer
  const acts = await bot.page.evaluate(async R => { const m = __cmMesh(); if (!m) return []; const out = [];
    for (const c of [...m.node.pendingIn.keys()]) { await m.accept(c); out.push('accepted friend ' + c); }
    for (const [peer, ch] of m.node.chats) { const last = ch.msgs[ch.msgs.length - 1]; if (!last || last.from === m.code || ch._botAt === last.at) continue;
      ch._botAt = last.at; const r = m.node.sendChat(peer, R[Math.floor(Math.random() * R.length)]); out.push(`replied to ${peer}: ${r.ok ? 'ok' : r.reason}`); }
    return out; }, REPLIES).catch(e => ['tick error ' + e.message]);
  acts.forEach(a => log(bot.i, a));
}
const bots = Array.from({ length: N }, (_, i) => ({ i, profile: profileFor(i), ctx: null, page: null, code: null, offUntil: 0 }));
// one shared context: the local BroadcastChannel transport doesn't cross browser contexts; identity is per ?as= key
for (const b of bots) { b.ctx = browser.defaultBrowserContext(); await goOnline(b); }
console.log(`\n${N} TEST bots online at ${URL0} — Ctrl-C to stop.${MIN ? ` Auto-stop in ${MIN} min.` : ''}\n`);
if (flag('probe')) { // self-test: a probe phone (seed-1) in the same browser sends a starter to bot-1 and waits for the canned reply
  const ctx = browser.defaultBrowserContext(), p = await ctx.newPage(); const probe = { i: -1, profile: { id: 'seed-1' }, ctx, page: null }; await goOnline(probe);
  const b = bots[0]; await p.close().catch(() => {}); const pp = probe.page;
  await pp.waitForFunction(c => __cmMesh().node.isOnline(c), { timeout: 20000 }, b.code);
  console.log('probe starter ->', b.code, await pp.evaluate(c => __cmMesh().node.sendStarter(c, 'hi bot, probe here'), b.code));
  setTimeout(() => tick(b), 500);
  const got = await pp.waitForFunction(c => __cmMesh().node.chats.get(c)?.msgs.some(m => m.from === c), { timeout: 15000 }, b.code).then(() => true, () => false);
  console.log(got ? 'PROBE PASS: bot replied ' + JSON.stringify(await pp.evaluate(c => __cmMesh().node.chats.get(c).msgs.at(-1).text, b.code)) : 'PROBE FAIL: no reply'); await pp.close(); if (!MIN) { bots.forEach(x => x.page = null); await browser.close(); if (srv) process.kill(-srv.pid); process.exit(got ? 0 : 1); }
}
let stopping = false; const stop = async () => { if (stopping) return; stopping = true; for (const b of bots) await goOffline(b); await browser.close().catch(() => {}); if (srv) try { process.kill(-srv.pid); } catch {} process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop); if (MIN) setTimeout(stop, MIN * 60e3);
let n = 0;
while (!stopping) {
  for (const b of bots) {
    if (stopping) break;
    if (!b.page) { if (Date.now() > b.offUntil) await goOnline(b).catch(e => log(b.i, 'reconnect failed', e.message)); continue; }
    await tick(b);
    if (n % 20 === 19 && Math.random() < OFF) { b.offUntil = Date.now() + 30e3 + Math.random() * 90e3; await goOffline(b); } // ~every minute: maybe drop offline 30–120 s
  }
  n++; await new Promise(r => setTimeout(r, 3000));
}
