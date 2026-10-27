// v44 PROXIMITY VOICE AUDIO TRANSPORT in real tabs (admin/dev flavor, BroadcastChannel mesh, Chrome fake mic). Run after build:admin.
//  A + B (adults) and K (an under-18 voice identity) join the mesh. In each tab a real VoiceHub + ProximityVoice (window.__cmVoiceLab, admin
//  builds only) runs over the real mesh 'vrtc' signaling with positions chosen by the test (same on every tab). Checks: A and B in
//  range -> real RTCPeerConnections connect (STUN/host only, no TURN) negotiate, B's remote audio track lands in A's per-peer GainNode at the distance gain,
//  moving B away lowers the gain on both tabs and real (fake-mic) audio through the same per-peer graph gets quieter; when ICE
//  candidates exist (not in this box: managed Chrome policy blocks UDP) also connected + RTP bytes + talk over the data channel; leaving range
//  tears both sides down, re-entering reconnects; minor K next to A never links (A refuses K's forced dial); stop() cleans up; the
//  arcade's own Proximity voice toggle starts a hub and attaches it.   node scripts/e2e-proxvoice.mjs
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const PORT = 4195, URL0 = `http://localhost:${PORT}/`;
let browser, errs = []; const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-admin', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
const cleanup = async code => { try { await browser?.close(); } catch {} try { process.kill(-srv.pid); } catch {} process.exit(code); };
const assert = (c, m) => { if (!c) { console.error('E2E FAIL', m); cleanup(1); throw new Error('stop'); } else console.log('ok', m); };
setTimeout(() => { console.error('E2E FAIL global timeout'); cleanup(1); }, 300e3);
await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost/.test(d) && res()); setTimeout(() => rej(new Error('preview timeout')), 15000); });
browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const until = (p, fn, arg, ms = 30000) => p.waitForFunction(fn, { timeout: ms, polling: 250 }, arg).catch(e => { throw new Error(e.message + ' :: ' + String(fn).slice(0, 160)); });
const wait = ms => new Promise(r => setTimeout(r, ms));
const open = async (as, dob = '1995-05-05', q = '') => { const p = await browser.newPage(); await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: false });
  await p.evaluateOnNewDocument(() => { globalThis.__cmAckTest = { minMs: 0, noScroll: true }; localStorage.setItem('cm.sound', 'off'); }); p.on('dialog', d => d.accept());
  p.on('pageerror', e => { errs.push(`[${as}] ${e.message}`); console.log(`[${as}] pageerror`, e.message); });
  await p.goto(URL0 + '?as=' + as + '&loaderMin=300' + q);
  const ag = await p.waitForSelector('#ag-dob', { timeout: 15000 }).catch(() => null); if (ag) { await p.$eval('#ag-dob', (e, d) => e.value = d, dob); await p.click('#ag-go'); }
  const terms = await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null); if (terms) { await p.click('#tm-ok'); await p.click('#tm-yes'); await p.waitForSelector('#losswarn', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
  await until(p, () => globalThis.__cmMesh?.()?.code, null, 45000); return p; };
// in-page lab: real hub + ProximityVoice on the real mesh signal; world positions pushed by the test
const lab = (p, me, peers) => p.evaluate(async (me, peers) => { const V = await globalThis.__cmVoiceLab(), m = globalThis.__cmMesh(); const px = new V.ProximityVoice({ me, isBlocked: c => !!m.blocklist?.isBlocked(c) });
  const hub = new V.VoiceHub({ me: { ...me, code: m.code }, signal: m.arcade.voiceSignal, mode: 'proximity', connectMs: 600e3, peerInfo: c => peers[c], isMuted: c => px.muted.has(c), isBlocked: c => !!m.blocklist?.isBlocked(c) });
  const r = await hub.start(); if (!r.ok) return r; px.enabled = true; px.attach(hub); const world = { size: Infinity, players: new Map() };
  const t = setInterval(() => { px.update(world, m.code, c => !!peers[c]); hub.tick(); }, 100); const peak = new Map(); const pk = setInterval(() => { for (const [c, L] of hub.links) peak.set(c, Math.max(peak.get(c) || 0, L.level())); }, 20);
  globalThis.__pv = { V, px, hub, world, peak, stop() { clearInterval(t); clearInterval(pk); px.detach(); hub.stop(); } }; return { ok: true, ice: V.iceServers().length, hasTurn: V.hasTurn() }; }, me, peers);
const put = (pages, pos) => Promise.all(pages.map(p => p.evaluate(pos => { const W = globalThis.__pv.world; W.players.clear(); for (const [c, [x, y, minor]] of Object.entries(pos)) W.players.set(c, { code: c, x, y, minor: !!minor, adult: !minor }); }, pos)));
const st = (p, c) => p.evaluate(async c => { const L = globalThis.__pv.hub.links.get(c); if (!L) return null; const rx = await L.rx(); return { state: L.state, up: L.up, track: !!L.track, gain: L.gain, applied: L.applied, talk: L.remoteTalk.talking, bytes: rx.bytes, g: L.g ? L.g.gain.value : null, ac: globalThis.__pv.V.VoiceLink.ac?.state }; }, c);
const peakOf = async (p, c, ms = 2500) => { await p.evaluate(c => globalThis.__pv.peak.set(c, 0), c); await wait(ms); return p.evaluate(c => globalThis.__pv.peak.get(c) || 0, c); };
try {
  const A = await open('seed-2'), Bp = await open('seed-5'), K = await open('seed-7', '2011-02-02');
  const a = await A.evaluate(() => __cmMesh().code), b = await Bp.evaluate(() => __cmMesh().code), k = await K.evaluate(() => __cmMesh().code);
  console.log('K app minor mode:', await K.evaluate(() => !!__cmMesh().node.minor), '(voice band for K below = under-18)');
  for (const [p, others] of [[A, [b, k]], [Bp, [a, k]], [K, [a, b]]]) for (const c of others) await until(p, c => __cmMesh().e2e.peers.has(c), c, 40000);
  console.log('mesh: all three tabs know each other\'s keys');
  const AD = { age: 30 }, KD = { age: 13, minor: true };
  const peers = { [a]: { code: a, age: 30 }, [b]: { code: b, age: 31 }, [k]: { code: k, age: 13, minor: true } };
  const ra = await lab(A, AD, peers), rb = await lab(Bp, { age: 31 }, peers), rk = await lab(K, KD, peers);
  assert(ra.ok && rb.ok && rk.ok, `fake mic granted, hubs started in all tabs (ICE servers: ${ra.ice}, TURN configured: ${ra.hasTurn})`);
  const all = [A, Bp, K];
  // far apart: nothing
  await put(all, { [a]: [0, 0], [b]: [60, 0], [k]: [0, 60, 1] }); await wait(1500);
  assert(!(await st(A, b)) && !(await st(Bp, a)), 'A and B out of view: no voice link');
  // B walks into A's range (4 cells): real offer/answer over the mesh, remote audio track, per-peer GainNode
  await put(all, { [a]: [0, 0], [b]: [4, 0], [k]: [0, 60, 1] });
  await until(A, c => { const L = globalThis.__pv.hub.links.get(c); return L?.rsid && L.track && L.g && L.pc.signalingState === 'stable'; }, b, 30000); await until(Bp, c => { const L = globalThis.__pv.hub.links.get(c); return L?.rsid && L.track && L.g; }, a, 30000);
  const neg = await A.evaluate(c => { const L = globalThis.__pv.hub.links.get(c); return { m: /m=audio/.test(L.pc.remoteDescription?.sdp || '') && /a=(sendrecv|sendonly)/.test(L.pc.remoteDescription.sdp), mine: /m=audio/.test(L.pc.localDescription?.sdp || ''), cands: L.ice.sent, ac: globalThis.__pv.V.VoiceLink.ac?.state, el: !!L.el?.muted }; }, b);
  let sa = await st(A, b); const g4 = await A.evaluate(() => globalThis.__pv.V.gainFor({ x: 0, y: 0 }, { x: 4, y: 0 }));
  assert(neg.m && neg.mine && sa.track && Math.abs(sa.gain - g4) < 1e-6 && neg.el, `B in range: real RTCPeerConnection offer/answer over the mesh 'vrtc' signal, audio m-lines both ways, B's remote audio track on A -> muted element + per-peer GainNode, A's gain for B = ${sa.gain.toFixed(3)} (distance 4); AudioContext ${neg.ac}`);
  assert(sa.applied === 0 && sa.g === 0, 'B not talking: A\'s listener gate holds B at 0');
  const iceOK = neg.cands > 0; console.log(iceOK ? `ICE: ${neg.cands} local candidates -> connectivity checks enabled` : 'ICE: 0 local candidates in this box (managed Chrome policy disable_non_proxied_udp blocks UDP) -> connected/RTP/talk-over-datachannel checks SKIPPED here (run off-box), smoke-proxvoice covers that logic');
  if (iceOK) { await until(A, c => globalThis.__pv.hub.links.get(c)?.up, b, 30000); sa = await st(A, b); const by0 = sa.bytes; await wait(1500); sa = await st(A, b); assert(sa.state === 'connected' && sa.bytes > by0, `connected without TURN, audio RTP flows B -> A (inbound-rtp bytes ${by0} -> ${sa.bytes})`);
    await Bp.evaluate(() => globalThis.__pv.hub.press()); await until(A, c => globalThis.__pv.hub.links.get(c)?.remoteTalk.talking, b, 5000); const near0 = await peakOf(A, b); assert(near0 > 0.005, `B talks: A hears B through its GainNode (level ${near0.toFixed(4)})`); await Bp.evaluate(() => globalThis.__pv.hub.release()); }
  // B walks away: A's per-peer gain follows the distance (real GainNode target), then real audio through the same per-peer graph
  await put(all, { [a]: [0, 0], [b]: [13, 3], [k]: [0, 60, 1] }); await wait(500); const g13 = await A.evaluate(() => globalThis.__pv.V.gainFor({ x: 0, y: 0 }, { x: 13, y: 3 }));
  sa = await st(A, b); assert(Math.abs(sa.gain - g13) < 1e-6 && sa.gain < g4 && (await st(Bp, a)).gain === sa.gain, `B walked away (4 -> ~13 cells): gain ${g4.toFixed(3)} -> ${sa.gain.toFixed(3)} on both tabs`);
  const lb = await A.evaluate(async ({ g4, g13 }) => { const V = globalThis.__pv.V, mic = globalThis.__pv.hub.stream.getAudioTracks()[0].clone(); mic.enabled = true; // real (fake-device) audio through the same per-peer VoiceLink graph
    const L = new V.VoiceLink({ me: 'LB1', peer: 'LB2', send() {}, gain: 0 }); L._attach(mic); L.remoteTalk.press(); const peak = async ms => { let m = 0; const t0 = performance.now(); while (performance.now() - t0 < ms) { m = Math.max(m, L.level()); await new Promise(r => setTimeout(r, 15)); } return m; };
    await peak(300); const silent = await peak(1200); L.setGain(g4); await peak(200); const near = await peak(2500); L.setGain(g13); await peak(200); const far = await peak(2500); L.remoteTalk.release(); L._apply(); await peak(200); const gated = await peak(1200); L.close('t', { bye: false }); mic.stop(); return { silent, near, far, gated }; }, { g4, g13 });
  assert(lb.near > 0.003 && lb.far > 0 && lb.far < lb.near * 0.75 && lb.silent < lb.near * 0.1 && lb.gated < lb.near * 0.1, `real audio through a per-peer GainNode: level at distance 4 ${lb.near.toFixed(4)} -> at ~13 ${lb.far.toFixed(4)} (ratio ${(lb.far / lb.near).toFixed(2)} vs gain ratio ${(g13 / g4).toFixed(2)}), silent before ${lb.silent.toFixed(4)}, talk-gated ${lb.gated.toFixed(4)}`);
  // out of range: both sides torn down, back in: reconnect
  await put(all, { [a]: [0, 0], [b]: [40, 0], [k]: [0, 60, 1] }); await until(A, c => !globalThis.__pv.hub.links.has(c), b, 5000); await until(Bp, c => !globalThis.__pv.hub.links.has(c), a, 5000);
  assert(true, 'B left range: links closed on both tabs');
  await put(all, { [a]: [0, 0], [b]: [3, 2], [k]: [0, 60, 1] }); await until(A, c => { const L = globalThis.__pv.hub.links.get(c); return L?.rsid && L.track && (!L.ice.sent || L.up); }, b, 30000); assert(true, 'B came back into range: re-negotiated a fresh link');
  // minor K right next to A and B
  await put(all, { [a]: [0, 0], [b]: [3, 2], [k]: [1, 1, 1] }); await wait(2500);
  const ka = await st(A, k), ak = await st(K, a), kInA = await A.evaluate(c => globalThis.__pv.px.inRange.has(c), k);
  assert(!ka && !ak && !kInA && !(await st(K, b)), 'minor K standing next to adults A and B: never in their range, no link either way');
  const ref0 = await A.evaluate(() => globalThis.__pv.hub.counts.refused);
  await K.evaluate(a => { const H = globalThis.__pv.hub; H.peerInfo = c => ({ code: c, age: 13, minor: true }); H.wants = () => true; H.connect(a); }, a); await wait(2500);
  const ref1 = await A.evaluate(() => globalThis.__pv.hub.counts.refused);
  assert(ref1 > ref0 && !(await st(A, k)) && !(await st(K, a)), `K forces a dial to A (lies that A is a minor): A refuses (refused ${ref0} -> ${ref1}), nothing connects`);
  // teardown
  await A.evaluate(() => globalThis.__pv.stop()); await until(Bp, c => !globalThis.__pv.hub.links.has(c), a, 5000);
  const tracks = await A.evaluate(() => globalThis.__pv.hub.stream === null); assert(tracks, 'A stops voice: mic released, B\'s side of the link torn down');
  await Bp.evaluate(() => globalThis.__pv.stop()); await K.evaluate(() => globalThis.__pv.stop());
  // the real arcade toggle wires the hub (snake mass arena, adult tab)
  await Bp.evaluate(() => document.getElementById('moodpick')?.remove()); if (await Bp.$('#moodskip')) await Bp.click('#moodskip').catch(() => {});
  await Bp.$eval('nav [data-tab=arcade]', e => e.click()); await until(Bp, () => document.querySelector('[data-arctab=mass]'), null, 20000); await Bp.$eval('[data-arctab=mass]', e => e.click());
  await until(Bp, () => document.querySelector('#arc-voice'), null, 20000); await Bp.$eval('#arc-voice', e => { e.checked = true; e.dispatchEvent(new Event('change')); });
  await until(Bp, () => globalThis.__cmProx?.()?.hub, null, 15000); const pv = await Bp.evaluate(() => globalThis.__cmProx());
  assert(pv.enabled && Array.isArray(pv.hub) && pv.counts, 'arcade Proximity voice toggle: real hub started and attached (range-gated)');
  await Bp.$eval('#arc-voice', e => { e.checked = false; e.dispatchEvent(new Event('change')); }); await until(Bp, () => !globalThis.__cmProx()?.hub, null, 5000); assert(true, 'toggle off: hub stopped + detached');
  assert(errs.length === 0, 'no page errors in any tab' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log('E2E PROXVOICE PASS'); await cleanup(0);
} catch (e) { if (e.message !== 'stop') { for (const p of (await browser.pages())) try { console.error('DBG', JSON.stringify(await p.evaluate(() => globalThis.__pv && { me: __cmMesh().code, inRange: [...__pv.px.inRange], links: __pv.hub.stats(), counts: __pv.hub.counts, early: [...__pv.hub.early.keys()], bo: [...__pv.hub.backoff] }))); } catch {} console.error('E2E FAIL', e.message); await cleanup(1); } }
