// Two headless Chromium tabs with fake camera/mic: direct WebRTC link, call button only when the link is up, video call,
// mute/camera, renegotiation (audio -> +video), hangup, ring timeout, block kills call + link, parent can disable video.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const PORT = 4191, U = `http://localhost:${PORT}/scripts/calls-harness.html`;
let browser; const srv = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
const cleanup = async c => { try { await browser?.close(); } catch {} try { process.kill(-srv.pid); } catch {} process.exit(c); };
const assert = (c, m) => { if (!c) { console.error('CALLS FAIL', m); cleanup(1); } console.log('ok', m); };
setTimeout(() => { console.error('CALLS FAIL global timeout'); cleanup(1); }, 120e3);
await new Promise((r, j) => { srv.stdout.on('data', d => /localhost/.test(d) && r()); setTimeout(() => j(new Error('vite timeout')), 20000); });
browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--allow-loopback-in-peer-connection', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
const until = (p, fn, a, ms = 15000) => p.waitForFunction(fn, { timeout: ms, polling: 100 }, a);
try {
  { const p = await browser.newPage(); await p.goto(U.replace('calls-harness.html', '../index.html')).catch(() => {}); const n = await p.evaluate(async () => { const a = new RTCPeerConnection(); a.createDataChannel('x'); let n = 0; a.onicecandidate = e => e.candidate && n++; await a.setLocalDescription(); await new Promise(r => setTimeout(r, 2000)); a.close(); return n; });
    if (!n) { console.error('CALLS BLOCKED: this Chrome gathers no ICE candidates here (sandboxed network); logic covered by smoke-calls.mjs. Run on a normal machine.'); await cleanup(2); } await p.close(); }
  const open = async (me, peer, x = '') => { const p = await browser.newPage(); p.on('pageerror', e => console.log(me, 'pageerror', e.message)); await p.goto(`${U}?me=${me}&peer=${peer}${x}`); await until(p, () => !!window.link); return p; };
  const A = await open('AAAA', 'BBBB'); assert(await A.$eval('#callbtn', b => b.hidden), 'call button hidden before the direct link is up');
  const B = await open('BBBB', 'AAAA');
  await until(A, () => link.up); await until(B, () => link.up); assert(!(await A.$eval('#callbtn', b => b.hidden)), 'direct WebRTC DataChannel link up → call button shown');
  await A.evaluate(async () => link.start({ video: true, gate: await gate(true) })); await until(B, () => link.call?.state === 'ringing');
  await B.evaluate(async () => link.accept({ gate: await gate(true) })); await until(A, () => link.call?.state === 'active');
  await until(B, () => remote && remote.getVideoTracks().length > 0); await until(A, () => remote && remote.getAudioTracks().length > 0);
  await until(B, () => document.getElementById('remote').videoWidth > 0, null, 20000); assert(true, 'video call: fake camera/mic media flows peer-to-peer (remote video has frames)');
  assert(await A.evaluate(() => link.mute(true) === false && link.local.getAudioTracks().every(t => !t.enabled)), 'mute turns the mic track off');
  assert(await A.evaluate(() => link.camera(false) === false && link.local.getVideoTracks().every(t => !t.enabled)), 'camera toggle off');
  await A.evaluate(() => link.hangup()); await until(B, () => events.includes('call:ended:hangup')); assert(await A.evaluate(() => !link.call && !link.local && link.up), 'hangup: both ended, tracks stopped, link stays up');
  await B.evaluate(() => { remote = null; }); await A.evaluate(async () => link.start({ video: false, gate: await gate(false) })); await until(B, () => link.call?.state === 'ringing'); await B.evaluate(async () => link.accept({ gate: await gate(false) }));
  await until(B, () => remote && remote.getAudioTracks().length > 0); await A.evaluate(() => link.addVideo()); await until(B, () => remote && remote.getVideoTracks().length > 0);
  assert(true, 'renegotiation: voice call upgraded with video mid-call'); await B.evaluate(() => link.hangup()); await until(A, () => !link.call);
  await B.evaluate(() => { link._o = link._ctl; link._ctl = o => o.c === 'ring' ? null : link._o(o); });
  await A.evaluate(async () => link.start({ video: false, gate: await gate(false), ringMs: 300 })); await until(A, () => events.includes('call:ended:timeout')); assert(true, 'unanswered call times out');
  await B.evaluate(() => { link._ctl = link._o; link.call = null; });
  await A.evaluate(async () => link.start({ video: false, gate: await gate(false) })); await until(B, () => link.call?.state === 'ringing'); await B.evaluate(async () => link.accept({ gate: await gate(false) })); await until(A, () => link.call?.state === 'active');
  await B.evaluate(() => link.kill('blocked')); await until(A, () => events.includes('call:ended:blocked')); await until(A, () => !link.up, null, 20000);
  assert(true, 'block/ban/halt: call ends on both sides and the direct link drops');
  const C = await open('CCCC', 'DDDD', '&novideo=1'); await open('DDDD', 'CCCC'); await until(C, () => link.up);
  const g = await C.evaluate(() => gate(true)); assert(!g.ok && g.reason === 'parent-disabled', 'parent controls: video call refused when the parent turned video off');
  assert((await C.evaluate(() => gate(false))).ok, 'voice call still allowed');
  console.log('CALLS PASS'); await cleanup(0);
} catch (e) { console.error('CALLS FAIL', e.message); for (const p of await browser.pages()) try { console.log(await p.evaluate(() => JSON.stringify({ ev: window.events, sig: window.link?.pc.signalingState, ice: window.link?.pc.iceConnectionState, conn: window.link?.pc.connectionState, dc: window.link?.dc?.readyState, sent: window.sent, got: window.got }))); } catch {} await cleanup(1); }
