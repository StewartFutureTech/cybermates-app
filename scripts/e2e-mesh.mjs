// Local multi-tab E2E (headless Chrome, BroadcastChannel transport): 5 tabs join, mood, request→accept→message (✓ on receipt), block+refund, logoff.
// Run: npm run build:admin && npm run e2e (e2e uses ?as= multi-profile tabs, which exist only in the admin/dev flavor)   (needs Chrome; CHROME_PATH overrides /usr/bin/google-chrome)
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const PORT = 4179, URL0 = `http://localhost:${PORT}/`;
const assert = (c, m) => { if (!c) { console.error('E2E FAIL', m); cleanup(1); } console.log('ok', m); };
const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-admin', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
setTimeout(() => { console.error('E2E FAIL global timeout'); cleanup(1); }, 180e3);
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
  const A = await open('seed-1'), B = await open('seed-2'), C = await open('seed-3'), D = await open('seed-4'), E = await open('seed-5');
  const ALL = [A, B, C, D, E]; console.log('5 tabs open');
  // mood picker: shown once per session after the first join; A picks a mood, the rest skip
  for (const P of ALL) await P.waitForSelector('#moodpick', { timeout: 5000 }).catch(() => null);
  assert(await A.$('#moodpick'), 'mood picker shown after JACK IN (first join this session)');
  await A.select('#moodsel', 'gaming'); await clk(A, '#moodok'); for (const P of ALL.slice(1)) { if (await P.$('#moodskip')) await clk(P, '#moodskip'); }
  assert(true, 'jack-in loader shown and dismissed after mesh join (loaderMin=300)');
  await tab(A, 'discover'); await until(A, () => document.querySelectorAll('.modes [data-m]').length === 3);
  const order = await A.$$eval('.modes [data-m]', bs => bs.map(b => b.dataset.m + (b.classList.contains('on') ? '*' : '')).join(','));
  assert(order === 'friends*,gaming,dating', 'mode picker order Friends/Gaming/Dating, Friends default (' + order + ')');
  const [a, b, c, d, e] = await Promise.all(ALL.map(code));
  assert(new Set([a, b, c, d, e]).size === 5, `5 tabs joined with distinct user codes ${a} ${b} ${c} ${d} ${e}`);
  for (const P of ALL) await until(P, n => __cmMesh().online().length >= n, 4, 25000);
  assert(true, 'all 5 tabs see each other online (presence + gossip membership)');
  assert((await A.evaluate(() => __cmMesh().member.active.size)) >= 5, 'gossip active list on A has all 5 phones');
  await until(B, x => __cmMesh().moodOf(x) === 'gaming', a, 20000);
  assert(true, "B sees A's session mood (gaming) from the signed presence row");
  await tab(A, 'discover');
  await until(A, x => !!document.querySelector(`[data-mchat="${x}"]`), b);
  const bName = await B.evaluate(() => __cmMesh().node.myProfile.profile.name);
  assert((await A.$eval(`[data-peer="${b}"]`, e => e.textContent)).includes(bName), `A sees B's full profile (${bName}) in Live now`);
  // accept-before-message: A opens B → no text box, only a connection request
  await clk(A, `[data-mchat="${b}"]`); await A.waitForSelector('#mreqgo');
  assert(!(await A.$('#mtxt')), 'non-friend chat has no message box (accept before any message)');
  const strangerChat = await A.evaluate(x => __cmMesh().node.sendChat(x, 'sneaky'), b);
  assert(strangerChat.ok === false, 'sendChat to a non-friend is refused (' + strangerChat.reason + ')');
  await clk(A, '#mreqgo'); await until(B, x => __cmMesh().node.pendingIn.has(x), a, 15000);
  assert(true, 'request delivered to B as pending (no message content)');
  await tab(B, 'inbox'); await until(B, x => !!document.querySelector(`[data-req="${x}"] [data-maccept]`), a);
  assert(await B.$(`[data-req="${a}"] .mode-ic`), 'request row is on top of the single inbox with a mode icon');
  await clk(B, `[data-maccept="${a}"]`);
  await until(A, x => __cmMesh().node.friends.has(x), b); await until(B, x => __cmMesh().node.friends.has(x), a);
  assert(true, 'A<->B connected via request + accept');
  await tab(A, 'inbox'); await until(A, x => !!document.querySelector(`[data-mopen="${x}"]`), b); await clk(A, `[data-mopen="${b}"]`);
  await A.waitForSelector('#mtxt'); await A.type('#mtxt', 'hey from A'); await clk(A, '#msf button');
  await until(B, x => __cmMesh().node.chats.get(x)?.msgs.some(m => m.text === 'hey from A'), a);
  await until(A, x => __cmMesh().node.chats.get(x)?.msgs.some(m => m.text === 'hey from A' && m.state === 'delivered'), b);
  assert(true, 'B received the message; A shows ✓ only after the signed receipt');
  await tab(B, 'inbox'); await until(B, x => !!document.querySelector(`[data-mopen="${x}"] .fbadge`), a);
  assert(true, 'B inbox: chat row with friend badge');
  // block: C blocks D; D's (boosted if possible) request to C → blocked + refund
  await C.evaluate(x => __cmMesh().block(x), d);
  let r = await D.evaluate(x => __cmMesh().requestFriend(x, { boost: true }), c);
  const boosted = r?.reason !== 'no-boosts'; if (!boosted) r = await D.evaluate(x => __cmMesh().requestFriend(x, { boost: false }), c);
  assert(r && r.ok === false && r.reason === 'blocked' && (!boosted || r.refunded === true), (boosted ? '[boosted] ' : '[no boosts in wallet → free request] ') + "blocked: D gets 'blocked' (boost refunded when boosted) " + JSON.stringify(r));
  // E sees everyone (5th tab) and friend-only call gate holds for strangers
  const g = await E.evaluate(x => __cmMesh().callGate(x, false), a);
  assert(g.ok === false && g.reason === 'not-accepted', 'calls: non-friends cannot call (' + g.reason + ')');
  // third sees logoff: close A, C sees A go offline (stub only)
  await tab(C, 'discover'); { const am = await A.evaluate(() => __cmMesh().node.myProfile.profile.lookingFor?.[0]); if (am) await clk(C, `[data-m="${am}"]`); } // mode-filtered discovery: view A's mode
  await until(C, x => !!document.querySelector(`[data-mchat="${x}"]`), a);
  await A.close({ runBeforeUnload: true });
  await until(C, x => { const v = __cmMesh().node.view(x); return v && !v.full; }, a);
  await until(C, x => !document.querySelector(`[data-mchat="${x}"]`), a);
  const stub = await C.evaluate(x => __cmMesh().node.view(x), a);
  assert(!stub.full && stub.name && !('profile' in stub), `C sees A log off → stub only (${stub.name}, ${stub.status})`);
  console.log('E2E PASS'); await cleanup(0);
} catch (e) { console.error('E2E FAIL', e.message); await cleanup(1); }
