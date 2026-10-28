// v49 MULTI-DEVICE DELIVERY ON THE MESH PATH in real browsers (public build in dist/, vite preview). Run after `npm run build`.
// Three isolated browser contexts = three phones (A1, A2, B). A relay in this script carries the BroadcastChannel mesh bus and the
// v37 linking channel between them (a stand-in for the network) and records the wire.
//  1) A2 links to A1 with the REAL v37 short-code flow (Profile -> Linked devices), reloads, and now runs A1's network ID
//  2) A1 and A2 learn each other as sibling devices; B learns both of A's devices
//  3) B's connection request reaches BOTH A devices; A1 accepts; the friendship reaches A2 through dsync (friends sync)
//  4) B -> A chat opens on A1 AND A2; A1 -> B chat reaches B and shows on A2 as A's own message (sent copy), marked delivered
//     by B's receipt; A2 -> B the same way round
//  5) wire: no plaintext anywhere, v3 envelopes with several device wraps were used
//  6) block on A2 reaches A1; unblock on A1 reaches A2 (last writer wins); no page errors
//    node scripts/e2e-mdmesh.mjs
import { spawn } from 'node:child_process';
const pick = async (...ids) => { for (const id of ids) try { return await import(id); } catch {} throw new Error('missing ' + ids[0]); };
const { chromium } = await pick('playwright-core', '/workspace/wk/node_modules/playwright-core/index.mjs', 'playwright');
let fail = 0, n = 0; const ok = (c, m) => { console.log((c ? 'ok ' : 'FAIL ') + m); if (c) n++; else fail = 1; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const PORT = 4199, U = `http://localhost:${PORT}/`;
const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
let browser; const done = async c => { try { await browser?.close(); } catch {} try { process.kill(-srv.pid); } catch {} console.log(c ? 'E2E-MDMESH: FAIL' : `E2E-MDMESH: ALL OK (${n} checks)`); process.exit(c); };
setTimeout(() => { console.log('FAIL global timeout'); done(1); }, 420e3);
await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost/.test(d) && res()); setTimeout(() => rej(new Error('preview timeout')), 20000); });
browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const subs = new Map(), wire = []; const devices = [];
async function device(tag) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: `Mozilla/5.0 (Linux; Android 14; Pixel ${tag}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36` });
  const p = await ctx.newPage(); p.setDefaultTimeout(60000); p.errs = []; p.tag = tag; p.on('pageerror', e => p.errs.push(e.message));
  await p.exposeFunction('__cmRelaySend', (name, m) => { if (name === 'bc:cm-mesh') wire.push(JSON.stringify(m)); for (const o of subs.get(name) || []) if (o !== p) o.evaluate(([nm, x]) => nm === 'bc:cm-mesh' ? globalThis.__cmBcRecv?.(x) : globalThis.__cmRelayRecv(nm, x), [name, m]).catch(() => {}); });
  await p.exposeFunction('__cmRelaySub', name => { (subs.get(name) || subs.set(name, new Set()).get(name)).add(p); });
  await p.addInitScript(() => { localStorage.setItem('cm.sound', 'off'); globalThis.__cmAckTest = { minMs: 0, noScroll: true }; const fns = new Map();
    globalThis.__cmRelayRecv = (nm, m) => (fns.get(nm) || []).forEach(f => f(m));
    globalThis.__cmLinkTest = { timeoutMs: 3000, bus: name => { globalThis.__cmRelaySub(name); let mine = null; return { send: m => globalThis.__cmRelaySend(name, m), on: fn => { mine = fn; (fns.get(name) || fns.set(name, []).get(name)).push(fn); }, close: () => fns.set(name, (fns.get(name) || []).filter(f => f !== mine)) }; } };
    // the mesh bus is a BroadcastChannel: bridge it across the isolated contexts (separate phones)
    const BC = globalThis.BroadcastChannel, inst = new Set();
    globalThis.BroadcastChannel = class extends BC { constructor(nm) { super(nm); this.__nm = nm; if (nm === 'cm-mesh') { inst.add(this); globalThis.__cmRelaySub('bc:cm-mesh'); } }
      postMessage(m) { super.postMessage(m); if (this.__nm === 'cm-mesh') globalThis.__cmRelaySend('bc:cm-mesh', m); } close() { inst.delete(this); super.close(); } };
    globalThis.__cmBcRecv = m => { for (const c of inst) c.dispatchEvent(new MessageEvent('message', { data: m })); }; });
  devices.push(p); return p;
}
async function boot(p, url = U + '?loaderMin=0') {
  if (url) await p.goto(url); else await p.reload();
  const ag = await p.waitForSelector('#ag-dob', { timeout: 15000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.$eval('#ag-go', e => e.click()); }
  const tm = await p.waitForSelector('#tm-ok', { timeout: 8000 }).catch(() => null); if (tm) { await p.$eval('#tm-ok', e => e.click()); await p.$eval('#tm-yes', e => e.click()); }
  await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {});
  await p.waitForFunction(() => !document.getElementById('jackin') && document.querySelector('nav'), null, { timeout: 120000 });
  await p.evaluate(() => [...document.querySelectorAll('button')].find(x => x.textContent.trim() === 'Skip')?.click()); await wait(600); await p.evaluate(() => document.getElementById('moodpick')?.remove());
  await p.waitForFunction(() => globalThis.__cmMesh?.()?.code, null, { timeout: 90000 });
}
const openLinks = async p => { await p.$eval('nav [data-tab=profile]', e => e.click()); await p.waitForSelector('#devlink', { timeout: 30000 }); await p.$eval('#devlink', e => { e.open = true; e.scrollIntoView(); }); await p.waitForFunction(() => /of 5|linked/.test(document.querySelector('#dl-count')?.textContent || '')); };
const until = (p, fn, arg, ms = 40000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 250 }).then(() => true, () => false);
const M = (p, fn, arg) => p.evaluate(fn, arg);
try {
  const A1 = await device('A1'), A2 = await device('A2'), B = await device('B');
  await boot(A1); await boot(A2); await boot(B);
  const a = await M(A1, () => __cmMesh().code), a2own = await M(A2, () => __cmMesh().code), b = await M(B, () => __cmMesh().code);
  ok(a && b && a2own && new Set([a, b, a2own]).size === 3, `three phones on the mesh with their own IDs (A1 ${a}, A2 ${a2own}, B ${b})`);
  // 1) real v37 link: A1 shows a code, A2 types it, A1 approves
  await openLinks(A1); await openLinks(A2);
  await A1.click('#dl-new'); await A1.waitForSelector('#dl-qr'); const off = await M(A1, () => globalThis.__cmLink?.());
  await A2.click('#dl-join'); await A2.fill('#dl-input', off.code); await A2.click('#dl-send');
  ok(await until(A1, () => document.querySelector('#dl-ok')), 'link: A2\'s request reached A1 (approve prompt)'); await A1.click('#dl-ok');
  ok(await until(A2, () => globalThis.__cmLink?.().state === 'done'), 'link: A2 accepted the grant (v37 flow)');
  await boot(A2, null); // reload: the mesh restarts on the shared profile ID
  ok(await until(A2, c => __cmMesh()?.code === c, a, 90000), 'link: after reload A2 runs A1\'s network ID ' + a);
  // 2) siblings + device sets
  ok(await until(A1, () => __cmMesh().devices().siblings.length === 1, null, 60000) && await until(A2, () => __cmMesh().devices().siblings.length === 1, null, 60000), 'devices: A1 and A2 see each other as linked sibling devices');
  ok(await until(B, c => __cmMesh().devices().of(c).length === 2 && __cmMesh().devices().of(c).every(d => d.md && d.fs), a, 60000), 'devices: B knows BOTH of A\'s devices (v49, forward-secret prekeys)');
  // 3) connection request reaches both A devices; accept on A1; friendship synced to A2
  await M(B, c => __cmMesh().requestFriend(c), a);
  ok(await until(A1, c => __cmMesh().node.pendingIn.has(c), b) && await until(A2, c => __cmMesh().node.pendingIn.has(c), b), 'request: B\'s connection request shows on A1 AND A2');
  await M(A1, c => __cmMesh().accept(c), b);
  ok(await until(B, c => __cmMesh().node.friends.has(c), a), 'request: A1 accepted, B is connected to A');
  ok(await until(A2, c => __cmMesh().node.friends.has(c) && !__cmMesh().node.pendingIn.has(c), b), 'dsync: the friendship reached A2 (friends sync to linked devices), pending request cleared');
  // 4) chats
  await M(B, c => __cmMesh().node.sendChat(c, 'hello all my A phones'), a);
  ok(await until(A1, c => __cmMesh().node.chats.get(c)?.msgs.some(m => m.text === 'hello all my A phones'), b) && await until(A2, c => __cmMesh().node.chats.get(c)?.msgs.some(m => m.text === 'hello all my A phones'), b), 'chat: B -> A opens on A1 AND A2');
  ok(await until(B, c => __cmMesh().node.chats.get(c)?.msgs.find(m => m.text === 'hello all my A phones')?.state === 'delivered', a), 'chat: B sees it delivered (signed receipt)');
  await M(A1, c => __cmMesh().node.sendChat(c, 'sent from A1'), b);
  ok(await until(B, c => __cmMesh().node.chats.get(c)?.msgs.some(m => m.text === 'sent from A1'), a), 'chat: A1 -> B delivered');
  ok(await until(A2, ([c, me]) => { const m = __cmMesh().node.chats.get(c)?.msgs.find(x => x.text === 'sent from A1'); return m && m.from === me && m.copy; }, [b, a]), 'sent copy: A1\'s message shows on A2 as A\'s own message');
  ok(await until(A2, c => __cmMesh().node.chats.get(c)?.msgs.find(x => x.text === 'sent from A1')?.state === 'delivered', b), 'sent copy: B\'s receipt (to every A device) marks it delivered on A2 too');
  await M(A2, c => __cmMesh().node.sendChat(c, 'sent from A2'), b);
  ok(await until(B, c => __cmMesh().node.chats.get(c)?.msgs.some(m => m.text === 'sent from A2'), a) && await until(A1, c => __cmMesh().node.chats.get(c)?.msgs.some(x => x.text === 'sent from A2' && x.copy), b), 'chat: A2 -> B delivered, and the copy shows on A1');
  const st = await M(B, () => __cmMesh().e2e.fsStats), s1 = await M(A1, () => __cmMesh().e2e.fsStats);
  ok(st.v3out > 0 && st.v3in > 0 && s1.copies > 0 && st.v1out === 0 && s1.v1out === 0, `stats: v3 used both ways (B out ${st.v3out}/in ${st.v3in}, A1 copies ${s1.copies}), no static v1 envelope`);
  // 5) wire
  const w = wire.join('\n'); ok(!/hello all my A phones|sent from A1|sent from A2/.test(w), `wire: none of the chat texts appear in ${wire.length} relayed packets`);
  const v3 = wire.map(x => JSON.parse(x)).filter(m => m?.k === 'mesh' && Array.isArray(m.env?.md)); ok(v3.length > 0 && v3.some(m => m.env.md.length >= 2), `wire: ${v3.length} v3 envelopes, max ${Math.max(...v3.map(m => m.env.md.length))} device wraps`);
  // 6) block / unblock sync
  await M(A2, c => __cmMesh().block(c), b);
  ok(await until(A1, c => __cmMesh().blocklist.isBlocked(c) && !__cmMesh().node.friends.has(c), b), 'dsync: a block on A2 reaches A1');
  await M(A1, c => __cmMesh().unblock(c), b);
  ok(await until(A2, c => !__cmMesh().blocklist.isBlocked(c), b), 'dsync: an unblock on A1 reaches A2 (last writer wins)');
  for (const p of devices) ok(p.errs.length === 0, `${p.tag}: no page errors${p.errs.length ? ' -> ' + p.errs.slice(0, 3).join(' | ') : ''}`);
} catch (e) { console.log('FAIL exception', e.message); fail = 1; }
await done(fail);
