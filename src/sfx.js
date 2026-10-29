// Procedural, ORIGINAL audio via WebAudio (no samples, no files): a boot sweep + a soft, upbeat synthwave-style loop
// (112 BPM, 8 bars: drums / bass / arp / pad) composed for Cybermates. Sound defaults ON (mute in Look & sound); the
// device volume controls loudness. Browsers (iOS Safari especially) block audio until a user gesture, so we create/resume
// the AudioContext INSIDE the first touchend/pointerup/click/keydown and fade in. iOS: the hardware silent switch mutes
// WebAudio — that's expected. Music suspends while the app is hidden and resumes when visible.
import { sound, setSound } from './theme.js';
let ac = null, master = null, musicBus = null, noise = null, unlocked = false, playing = false, timer = 0, step = 0, nextT = 0, booted = false;
const BPM = 112, S16 = 60 / BPM / 4, LOOP = 128, VOL = 0.07; // 8 bars of 16ths; soft
const hz = m => 440 * 2 ** ((m - 69) / 12);
// Original progression & motifs (A minor area): Am | F | C | G  then  Am | F | Dm | E(sus→E)
const CH = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62], [57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]];
const ROOT = [45, 41, 36, 43, 45, 41, 38, 40];
const ARP = [0, 2, 1, 2, 0, 2, 1, 3, 0, 2, 1, 2, 3, 2, 1, 2]; // index into chord (+3 = octave of root)
function ctx() {
  if (!ac) { const A = globalThis.AudioContext || globalThis.webkitAudioContext; if (!A) return null; try { ac = new A(); } catch (e) { console.warn('audio', e); return null; }
    master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
    watchState && setTimeout(() => watchState(), 0); musicBus = ac.createGain(); musicBus.gain.value = 1; musicBus.connect(master);
    const len = ac.sampleRate; const b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; noise = b; }
  return ac;
}
function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
function osc(type, f, t, dur, peak, dest, { a = 0.005, cut = 0, q = 1, det = 0 } = {}) {
  const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = f; o.detune.value = det; let n = o;
  if (cut) { const fl = ac.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(cut, t); fl.frequency.exponentialRampToValueAtTime(Math.max(200, cut / 4), t + dur); fl.Q.value = q; o.connect(fl); n = fl; }
  n.connect(g); g.connect(dest); env(g, t, a, peak, dur); o.start(t); o.stop(t + a + dur + .05);
}
function hit(t, kind) {
  if (kind === 'k') { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + .12); o.connect(g); g.connect(musicBus); env(g, t, .002, .9, .28); o.start(t); o.stop(t + .35); return; }
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = noise;
  if (kind === 's') { f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = .8; env(g, t, .002, .35, .16); }
  else { f.type = 'highpass'; f.frequency.value = 7000; env(g, t, .001, kind === 'o' ? .12 : .07, kind === 'o' ? .12 : .035); }
  s.connect(f); f.connect(g); g.connect(musicBus); s.start(t, Math.random() * .5); s.stop(t + .3);
}
function schedule(i, t) {
  const bar = (i >> 4) % 8, s = i % 16, ch = CH[bar];
  if (s % 4 === 0) hit(t, 'k'); if (s === 4 || s === 12) hit(t, 's'); if (s % 2 === 0) hit(t, s % 4 === 2 ? 'o' : 'h'); else if (s === 15) hit(t, 'h');
  if (s % 2 === 0) osc('sawtooth', hz(ROOT[bar] + (s % 4 === 2 ? 12 : 0)), t, S16 * 1.6, .22, musicBus, { cut: 900, q: 4 }); // octave-bounce bass
  const a = ARP[s], m = a === 3 ? ch[0] + 12 : ch[a]; osc('square', hz(m + 12), t, S16 * .9, .045, musicBus, { cut: 3200, q: 2 }); // arp
  if (s === 0) for (const [j, m2] of ch.entries()) for (const det of [-7, 7]) osc('sawtooth', hz(m2), t, S16 * 16, .035, musicBus, { a: .4, cut: 1400, det: det + j }); // pad
}
function tick() { if (!playing || !ac) return; if (nextT < ac.currentTime - .1) nextT = ac.currentTime + .05; /* after a suspend: no catch-up burst */ while (nextT < ac.currentTime + .25) { schedule(step, nextT); step = (step + 1) % LOOP; nextT += S16; } } // seamless: the step counter wraps; timing never resets
// No audio on DOB/age or terms screens (owner rule): only loader + main app.
const gated = () => typeof document !== 'undefined' && !!document.querySelector('.cm-gate');
export function startMusic(delay = 0) { if (gated() || !sound() || !ctx() || playing) return; if (ac.state !== 'running') ac.resume?.().catch?.(() => {}); playing = true; step = 0; nextT = ac.currentTime + delay + .05; tick(); timer = setInterval(tick, 60); fadeTo(VOL, 2.5); }
export function stopMusic() { if (!playing) return; playing = false; clearInterval(timer); }
function fadeTo(v, s) { const n = ac.currentTime; master.gain.cancelScheduledValues(n); master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), n); master.gain.linearRampToValueAtTime(v, n + s); }
// Original "plugging in" sound for the JACK IN tap: cable-jack click/clunk → electric surge/zap → rising power-up whoosh.
let plugT = 0, wantMusic = false;
// ---- resume after lock screen / interruption (iOS: 'interrupted' or 'suspended'; recreate if closed) ----
function rebuild() { try { ac?.close?.(); } catch {} ac = null; playing = false; clearInterval(timer); return ctx(); }
// Resume model (audio-fix): ONE permanent capture-phase gesture listener (see initAudioUnlock) calls kickInGesture()
// on every pointerdown/touchend/click/keydown. It checks the state each time and calls resume() synchronously.
// No one-shot listeners, no async rebuilds, no "tap to resume" overlay.
function unlockSilent(c) { try { const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch {} }
function revive() { // context is running again: restart the scheduler where it was (no sequence restart)
  if (!ac || ac.state !== 'running' || document.hidden || !sound() || gated()) return;
  unlocked = true;
  if (playing) { nextT = Math.max(nextT, ac.currentTime + .05); clearInterval(timer); timer = setInterval(tick, 60); tick(); fadeTo(VOL, 1); wantMusic = false; }
  else if (gestured && !dialing) { wantMusic = false; if (!booted && document.getElementById('jackin')) boot(); else startMusic(); } // first unlock (async resume on WebKit) or after a rebuild
}
let gestured = false; // autoplay probe alone never starts music; the loader/JACK IN sequence does
function kickInGesture() { // MUST stay synchronous (iOS Safari): create → silent buffer → resume(), before any await
  if (!sound()) return; gestured = true;
  let c = ctx(); if (!c) return;
  if (c.state === 'closed') { playing = false; clearInterval(timer); wantMusic = wantMusic || booted; ac = null; c = ctx(); if (!c) return; }
  if (c.state !== 'running') { unlockSilent(c); try { const p = c.resume(); p?.then?.(() => revive(), () => {}); } catch {} }
  if (c.state === 'running') revive();
}
export function resumeAudio() { // non-gesture attempt (visible/pageshow/focus); harmless if the browser refuses
  if (document.hidden || !sound() || !ac || gated()) return;
  if (ac.state === 'closed') { wantMusic = wantMusic || playing || booted; return; } // next tap rebuilds
  if (ac.state !== 'running') { try { ac.resume()?.then?.(() => revive(), () => {}); } catch {} } else revive();
}
function watchState() { if (!ac || ac.__w) return; ac.__w = 1; const me = ac; me.onstatechange = () => { if (ac !== me) return;
  if (me.state === 'running') revive(); else if (playing) wantMusic = true; }; } // interrupted/suspended: next tap resumes
// ---- ORIGINAL synthesized dial-up handshake (no samples): plug → SHORT (~2s) → LONG (~10s, extends until connect/timeout) → chime ----
let modem = null, dialing = false, dialTimer = 0;
function mbus() { if (modem) return modem; modem = ac.createGain(); modem.gain.value = .55; modem.connect(master); return modem; }
function tone(fs, t, dur, peak, type = 'sine') { for (const f of fs) { const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = f; o.connect(g); g.connect(mbus()); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + .01); g.gain.setValueAtTime(peak, t + dur - .015); g.gain.linearRampToValueAtTime(0, t + dur); o.start(t); o.stop(t + dur + .02); } }
function hiss(t, dur, peak, f = 3000, q = .5) { const s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = noise; s.loop = true; fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q; s.connect(fl); fl.connect(g); g.connect(mbus()); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + .05); g.gain.setValueAtTime(peak, t + dur - .05); g.gain.linearRampToValueAtTime(0, t + dur); s.start(t); s.stop(t + dur + .02); }
function warble(t, dur, a, b, rate, peak) { const o = ac.createOscillator(), m = ac.createOscillator(), mg = ac.createGain(), g = ac.createGain(); o.frequency.value = (a + b) / 2; m.type = 'square'; m.frequency.value = rate; mg.gain.value = (b - a) / 2; m.connect(mg); mg.connect(o.frequency); o.connect(g); g.connect(mbus());
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + .02); g.gain.setValueAtTime(peak, t + dur - .03); g.gain.linearRampToValueAtTime(0, t + dur); o.start(t); m.start(t); o.stop(t + dur + .02); m.stop(t + dur + .02); }
const DTMF = { 1: [697, 1209], 2: [697, 1336], 3: [697, 1477], 4: [770, 1209], 5: [770, 1336], 6: [770, 1477], 7: [852, 1209], 8: [852, 1336], 9: [852, 1477], 0: [941, 1336] };
function dialShort(t) { // ~2.0s condensed: dial tone, 5 fast digits, answer tone, screech, bongs
  tone([350, 440], t, .3, .08); '31337'.split('').forEach((d, i) => tone(DTMF[d], t + .34 + i * .08, .06, .07));
  tone([2100], t + .8, .3, .05); warble(t + 1.12, .35, 980, 1650, 38, .045); hiss(t + 1.12, .55, .05, 2400, .7);
  warble(t + 1.5, .2, 1200, 2400, 90, .04); tone([1800], t + 1.72, .12, .045); tone([1200], t + 1.86, .12, .045); return t + 2.0; }
function dialLong(t) { // ~10s full: dial tone, 10 digits, rings, answer tone w/ phase flips, V.8-ish chirps, training screeches, bongs, hiss
  tone([350, 440], t, 1.0, .07); '5550142' .split('').concat('6', '8', '3').forEach((d, i) => tone(DTMF[d], t + 1.1 + i * .11, .08, .065));
  const r = t + 2.35; tone([440, 480], r, .8, .05); tone([440, 480], r + 1.3, .6, .045);
  const a = r + 2.0; for (let k = 0; k < 4; k++) tone([2100], a + k * .45, .43, .045); // answer tone with "phase reversal" gaps
  const v = a + 1.85; for (let k = 0; k < 6; k++) warble(v + k * .12, .1, 1300, 2300, 120, .035);
  const s = v + .8; warble(s, .9, 900, 1900, 30, .045); hiss(s, 2.6, .055, 2800, .6); warble(s + .9, .7, 1100, 2600, 64, .04); warble(s + 1.6, .5, 600, 1300, 18, .04);
  tone([1650], s + 2.1, .18, .04); tone([1050], s + 2.3, .18, .04); hiss(s + 2.5, 1.5, .04, 3600, .4); warble(s + 2.6, 1.2, 1400, 1900, 9, .03);
  return s + 4.0; }
function dialIdle(t) { hiss(t, 2, .035, 3200, .4); warble(t + .3, 1.4, 1500, 1800, 6, .022); return t + 2; } // keeps "negotiating" after LONG
export function dialStart(isDone) { if (!sound() || !ctx()) return; dialing = true; const t0 = Math.max(ac.currentTime + .05, plugT || 0); plugT = 0;
  let end = dialShort(t0), stage = 'short';
  const step = () => { if (!dialing) return; if (isDone?.()) return; // loader calls dialEnd()
    if (ac.currentTime >= end - .25) { end = stage === 'short' ? dialLong(end) : dialIdle(end); stage = 'long'; } dialTimer = setTimeout(step, 120); };
  dialTimer = setTimeout(step, 120); }
export function dialEnd(offline = false) { if (!dialing) return; dialing = false; clearTimeout(dialTimer); if (!ac) return; const t = ac.currentTime, m = modem; modem = null;
  if (m) { m.gain.cancelScheduledValues(t); m.gain.setValueAtTime(m.gain.value, t); m.gain.linearRampToValueAtTime(0, t + (offline ? .8 : .08)); setTimeout(() => { try { m.disconnect(); } catch {} }, 1500); }
  const c = t + (offline ? .9 : .12); fadeTo(VOL, .2);
  if (!offline) { [72, 76, 79, 84].forEach((n, i) => osc('triangle', hz(n), c + i * .09, .5, .16, master, { cut: 5000 })); osc('sine', hz(96), c + .36, .9, .06, master); } // "connected" chime
  else [69, 64].forEach((n, i) => osc('triangle', hz(n), c + i * .16, .5, .1, master, { cut: 3000 }));
  booted = true; startMusic(c - ac.currentTime + (offline ? .6 : .7)); }
export const isDialing = () => dialing;
export function plugIn() { if (!sound() || !ctx()) return; const t = ac.currentTime + .02; plugT = t + 1.3; bootFx(t + .04); // boot sound = button-press sound, layered with the plug master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(VOL * 1.6, t);
  const nz = (t0, dur, type, f0, f1, q, peak) => { const s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = noise; fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f0, t0); fl.frequency.exponentialRampToValueAtTime(f1, t0 + dur); s.connect(fl); fl.connect(g); g.connect(master); env(g, t0, .002, peak, dur); s.start(t0, Math.random() * .5); s.stop(t0 + dur + .05); };
  // click (metal tip) + clunk (sleeve seating): bright tick, then a damped low thump
  nz(t, .025, 'highpass', 4000, 3000, .7, .9); nz(t + .045, .03, 'bandpass', 2500, 1200, 3, .6);
  { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(180, t + .05); o.frequency.exponentialRampToValueAtTime(55, t + .2); o.connect(g); g.connect(master); env(g, t + .05, .003, 1, .22); o.start(t + .05); o.stop(t + .32); }
  // surge/zap: FM-buzzed saw + crackly bandpassed noise sweeping up
  { const z = t + .16, o = ac.createOscillator(), m = ac.createOscillator(), mg = ac.createGain(), f = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(90, z); o.frequency.exponentialRampToValueAtTime(900, z + .22); m.type = 'square'; m.frequency.value = 47; mg.gain.value = 260; m.connect(mg); mg.connect(o.frequency);
    f.type = 'bandpass'; f.Q.value = 5; f.frequency.setValueAtTime(800, z); f.frequency.exponentialRampToValueAtTime(5000, z + .2); o.connect(f); f.connect(g); g.connect(master); env(g, z, .004, .35, .26);
    o.start(z); m.start(z); o.stop(z + .32); m.stop(z + .32); nz(z, .24, 'bandpass', 1500, 7000, 6, .45); nz(z + .1, .08, 'highpass', 6000, 9000, 1, .3); }
  // power-up whoosh: rising filtered noise + sine sweep
  nz(t + .3, .65, 'bandpass', 300, 6000, 1.6, .38);
  { const w = t + .32, o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(110, w); o.frequency.exponentialRampToValueAtTime(880, w + .6); o.connect(g); g.connect(master); env(g, w, .45, .22, .25); o.start(w); o.stop(w + .8); }
  master.gain.linearRampToValueAtTime(VOL, t + 1.1);
}
export function boot() { if (gated() || dialing) return; // short original boot sweep + figure; then the loop starts
  if (!sound() || !ctx()) return; const t = Math.max(ac.currentTime + .05, plugT); plugT = 0; booted = true; fadeTo(VOL, .3);
  bootFx(t); startMusic(1.6 + Math.max(0, t - ac.currentTime - .05));
}
function bootFx(t) { // the original boot sweep + figure (used on JACK IN press, layered with the plug click)
  const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(220, t + .9);
  f.type = 'bandpass'; f.Q.value = 8; f.frequency.setValueAtTime(200, t); f.frequency.exponentialRampToValueAtTime(3000, t + .9); o.connect(f); f.connect(g); g.connect(master); env(g, t, .6, .5, .4); o.start(t); o.stop(t + 1.1);
  [62, 69, 65, 72, 74].forEach((m, i) => osc('square', hz(m), t + .55 + i * .11, .3, .18, master, { cut: 3200 }));
  osc('sawtooth', hz(38), t + 1.15, 1.2, .5, master, { cut: 900 });
}
export function stopAll() { stopMusic(); if (master && ac) fadeTo(0, .3); }
// compat for older callers
export const ambient = () => {}; export const stopAmbient = () => {};
// First user gesture unlocks audio (must happen synchronously inside the handler for iOS Safari).
export function initAudioUnlock() {
  globalThis.__cmAudio = () => audioState(); globalThis.__cmAudioCtx = () => ac; // test hooks
  if (globalThis.__cmAudioInit) return; globalThis.__cmAudioInit = 1;
  const evs = ['pointerdown', 'touchend', 'click', 'keydown'];
  // PERMANENT capture listener (never once/removed): every gesture checks state and resumes synchronously in the gesture.
  const onGesture = () => { if (!sound()) return; kickInGesture(); hint(); }; // music starts in revive() once running
  evs.forEach(e => document.addEventListener(e, onGesture, { capture: true, passive: true }));
  // Autoplay probe (native WebViews): resume() without a gesture; rejection is swallowed, no console error.
  if (sound()) { try { const c = ctx(); c?.resume?.()?.then(() => { if (c.state === 'running') unlocked = true; }, () => {}); } catch {} }
  globalThis.__cmAudioKick = () => { if (ac?.state === 'running') { unlocked = true; if (!gated() && sound() && !playing) { if (document.getElementById('jackin') && !booted) boot(); else startMusic(); } } hint(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (!ac) return; wantMusic = wantMusic || playing; fadeTo(0, .2); setTimeout(() => document.hidden && ac?.state === 'running' && ac.suspend().catch(() => {}), 250); } else resumeAudio(); });
  addEventListener('pageshow', () => resumeAudio()); addEventListener('focus', () => resumeAudio());
  // HTMLAudio elements (none today; future-proof): if one pauses/stalls unexpectedly, the next gesture replays it.
  const media = new Set(); document.addEventListener('pause', e => { if (e.target instanceof HTMLMediaElement && !e.target.ended && e.target.dataset.cmBg) media.add(e.target); }, true);
  document.addEventListener('stalled', e => { if (e.target instanceof HTMLMediaElement && e.target.dataset.cmBg) media.add(e.target); }, true);
  evs.forEach(e => document.addEventListener(e, () => { if (!sound()) return; media.forEach(m => { try { m.play()?.catch?.(() => {}); } catch {} }); media.clear(); }, { capture: true, passive: true }));
}
export const audioState = () => ({ unlocked, playing, booted, dialing, state: ac?.state || 'none', sound: sound() });
// Subtle loader-only hint while audio is still locked (no toggle).
// Glowing 'TAP FOR SOUND' hint on the loader or main screen while the context is still suspended (never on DOB/terms).
function hint() { document.querySelectorAll?.('.ji-tap').forEach(h => h.remove()); } // replaced by the loader's JACK IN button
export const audioHint = () => hint();
// Settings toggle: MUST run synchronously inside the tap (iOS). Creates/resumes the context and starts/stops music now.
// JACK IN button: synchronous in-gesture create/resume (no music yet; the loader then calls boot()).
export function unlockNow() { if (!sound()) return audioState(); const c = ctx(); if (!c) return audioState();
  if (c.state !== 'running') { try { const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch {} try { c.resume?.()?.then(() => { unlocked = c.state === 'running'; }, () => {}); } catch {} } else unlocked = true;
  return audioState(); }
export function setSoundNow(on) { setSound(on);
  if (!on) { stopAll(); return audioState(); } const c = ctx(); if (!c) return audioState();
  if (c.state !== 'running') { try { const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); } catch {} try { c.resume?.()?.then(() => { unlocked = c.state === 'running'; }, () => {}); } catch {} }
  else unlocked = true;
  if (playing) fadeTo(VOL, .4); else startMusic(); return audioState(); }
globalThis.__cmSetSound = setSoundNow;
// ---- game feel: short procedural event sounds + haptics (navigator.vibrate; iOS Safari ignores vibrate, harmless).
// Plays only when sound is on and audio is already unlocked (never on gate screens). Rate-limited per kind.
const fxLast = {};
export function gameFx(kind, { haptic = true, gain = 1, sound: snd = true } = {}) {
  const now = globalThis.performance?.now?.() || 0; if (now - (fxLast[kind] || -1e9) < 60) return; fxLast[kind] = now;
  if (haptic) try { const v = { die: [60, 30, 90], kill: 35, eat: 12, claim: [20, 20, 30], hit: 25, boost: 8 }[kind]; if (v && globalThis.navigator?.vibrate) navigator.vibrate(v); } catch {}
  if (!snd || gated() || !sound() || !ac || ac.state !== 'running' || !master) return; const t = ac.currentTime + .005, out = master;
  const P = { eat: () => osc('triangle', 880, t, .07, .12 * gain, out, { cut: 4000 }) || osc('triangle', 1320, t + .04, .06, .08 * gain, out),
    claim: () => [0, 4, 7, 12].forEach((m, i) => osc('square', hz(72 + m), t + i * .05, .09, .06 * gain, out, { cut: 3000 })),
    kill: () => { osc('sawtooth', 220, t, .18, .12 * gain, out, { cut: 2000, q: 3 }); osc('square', 660, t + .02, .1, .05 * gain, out); },
    die: () => { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(60, t + .5); o.connect(g); g.connect(out); env(g, t, .005, .14 * gain, .5); o.start(t); o.stop(t + .6); },
    hit: () => osc('square', 160, t, .08, .1 * gain, out, { cut: 1200 }),
    boost: () => osc('sine', 300, t, .12, .04 * gain, out) };
  try { P[kind]?.(); } catch {}
}

// ---- PER-GAME SOUND EFFECTS (procedural WebAudio, original). sfx(name, {pitch, gain}) plays one named effect.
// Respects mute (sound()), never plays on DOB/terms gates, and only once the AudioContext was unlocked by a user gesture
// (tap-to-resume rule: we never resume audio here). Rate-limited per name. Names are listed in SFX_NAMES.
const sfxLast = {};
function nz(t, dur, peak, dest, { type = 'bandpass', f = 1800, f2 = 0, q = 1 } = {}) { const s = ac.createBufferSource(), fl = ac.createBiquadFilter(), g = ac.createGain(); s.buffer = noise; fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q; s.connect(fl); fl.connect(g); g.connect(dest); env(g, t, .002, peak, dur); s.start(t, Math.random() * .5); s.stop(t + dur + .1); }
function sweep(type, f1, f2, t, dur, peak, dest) { const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur); o.connect(g); g.connect(dest); env(g, t, .004, peak, dur); o.start(t); o.stop(t + dur + .05); }
const LIB = {
  move: (t, o, p, v) => { nz(t, .05, .35 * v, o, { f: 2400 * p, q: 6 }); osc('sine', 180 * p, t, .06, .25 * v, o); },               // wooden/glass piece set-down
  place: (t, o, p, v) => { osc('triangle', 1046 * p, t, .12, .12 * v, o); osc('sine', 2093 * p, t + .01, .2, .05 * v, o); },        // glass ting
  capture: (t, o, p, v) => { nz(t, .09, .4 * v, o, { f: 900 * p, q: 3 }); sweep('square', 600 * p, 150 * p, t, .16, .09 * v, o); },
  drop: (t, o, p, v) => { sweep('sine', 520 * p, 140 * p, t, .22, .3 * v, o); nz(t + .2, .06, .25 * v, o, { f: 600, q: 2 }); },       // disc falls + clunk
  hit: (t, o, p, v) => osc('square', 160 * p, t, .08, .12 * v, o, { cut: 1200 }),
  puck: (t, o, p, v) => { nz(t, .03, .5 * v, o, { f: 3200 * p, q: 8 }); osc('sine', 420 * p, t, .05, .2 * v, o); },
  wall: (t, o, p, v) => { nz(t, .04, .3 * v, o, { f: 1400 * p, q: 5 }); },
  goal: (t, o, p, v) => [0, 7, 12].forEach((m, i) => osc('sawtooth', hz(64 + m) * p, t + i * .07, .18, .07 * v, o, { cut: 2600 })),
  boost: (t, o, p, v) => sweep('sawtooth', 200 * p, 900 * p, t, .25, .06 * v, o),
  torpedo: (t, o, p, v) => { nz(t, .5, .25 * v, o, { type: 'lowpass', f: 400, f2: 2600, q: 2 }); sweep('sine', 90, 240, t, .5, .1 * v, o); },
  explosion: (t, o, p, v) => { nz(t, .7, .6 * v, o, { type: 'lowpass', f: 2400 * p, f2: 120, q: 1 }); sweep('sine', 120 * p, 30, t, .6, .35 * v, o); },
  splash: (t, o, p, v) => nz(t, .3, .25 * v, o, { type: 'highpass', f: 1500 * p, q: .7 }),
  ping: (t, o, p, v) => { osc('sine', 1480 * p, t, .5, .12 * v, o); osc('sine', 1480 * p, t + .32, .4, .04 * v, o); },               // sonar / sensor ping
  laser: (t, o, p, v) => sweep('square', 1800 * p, 300 * p, t, .14, .06 * v, o),
  daub: (t, o, p, v) => { nz(t, .06, .4 * v, o, { type: 'lowpass', f: 900 * p, q: 1 }); osc('sine', 260 * p, t, .08, .2 * v, o); },   // bingo dauber stamp
  correct: (t, o, p, v) => [0, 4, 7, 12].forEach((m, i) => osc('triangle', hz(76 + m) * p, t + i * .06, .14, .1 * v, o)),
  wrong: (t, o, p, v) => { osc('sawtooth', 196 * p, t, .22, .08 * v, o, { cut: 900 }); osc('sawtooth', 185 * p, t + .02, .26, .06 * v, o, { cut: 800 }); },
  tick: (t, o, p, v) => osc('square', 1200 * p, t, .03, .05 * v, o),
  countdown: (t, o, p, v) => osc('square', 880 * p, t, .09, .08 * v, o, { cut: 3000 }),
  go: (t, o, p, v) => osc('square', 1760 * p, t, .3, .09 * v, o, { cut: 4000 }),
  win: (t, o, p, v) => [0, 4, 7, 12, 16].forEach((m, i) => osc('square', hz(72 + m) * p, t + i * .09, .2, .07 * v, o, { cut: 3500 })),
  lose: (t, o, p, v) => [0, -3, -7, -12].forEach((m, i) => osc('triangle', hz(67 + m) * p, t + i * .14, .25, .09 * v, o)),
  respawn: (t, o, p, v) => sweep('sine', 300 * p, 1200 * p, t, .35, .08 * v, o),
  die: (t, o, p, v) => sweep('sawtooth', 520 * p, 60, t, .5, .12 * v, o),
  kill: (t, o, p, v) => { osc('sawtooth', 220 * p, t, .18, .12 * v, o, { cut: 2000, q: 3 }); osc('square', 660 * p, t + .02, .1, .05 * v, o); },
  eat: (t, o, p, v) => { osc('triangle', 880 * p, t, .07, .12 * v, o, { cut: 4000 }); osc('triangle', 1320 * p, t + .04, .06, .08 * v, o); },
  claim: (t, o, p, v) => [0, 4, 7, 12].forEach((m, i) => osc('square', hz(72 + m) * p, t + i * .05, .09, .06 * v, o, { cut: 3000 })),
  punch: (t, o, p, v) => { nz(t, .08, .5 * v, o, { type: 'lowpass', f: 1200 * p, q: 1 }); sweep('sine', 160 * p, 50, t, .12, .3 * v, o); },
  teleport: (t, o, p, v) => { sweep('sine', 2000 * p, 300 * p, t, .18, .07 * v, o); nz(t, .15, .1 * v, o, { type: 'highpass', f: 4000 }); },
  charge: (t, o, p, v) => sweep('sawtooth', 120 * p, 480 * p, t, .4, .05 * v, o),
  beam: (t, o, p, v) => { sweep('sawtooth', 900 * p, 200 * p, t, .5, .08 * v, o); nz(t, .5, .15 * v, o, { f: 2000, f2: 400, q: 2 }); },
  ko: (t, o, p, v) => { LIB.explosion(t, o, p, v * .6); LIB.lose(t + .15, o, p * 1.3, v * .5); },
  scribble: (t, o, p, v) => nz(t, .12, .12 * v, o, { f: 3000 * p, q: 3 }),
  // cm-v35 movement sounds: chess/checkers piece pickup -> slide -> place (move/capture); air hockey puck glide + paddle hit
  pickup: (t, o, p, v) => { nz(t, .035, .22 * v, o, { f: 3000 * p, q: 5 }); sweep('sine', 240 * p, 420 * p, t, .06, .12 * v, o); },
  slide: (t, o, p, v) => nz(t, .2, .1 * v, o, { type: 'bandpass', f: 1100 * p, f2: 1600 * p, q: 1.4 }),
  glide: (t, o, p, v) => nz(t, .32, .06 * v, o, { type: 'bandpass', f: 600 * p, f2: 900 * p, q: 1.2 }),
  paddle: (t, o, p, v) => { nz(t, .04, .55 * v, o, { type: 'lowpass', f: 2200 * p, q: 2 }); osc('sine', 300 * p, t, .07, .25 * v, o); },
  check: (t, o, p, v) => { osc('square', 988 * p, t, .1, .07 * v, o); osc('square', 988 * p, t + .14, .1, .07 * v, o); },
};
export const SFX_NAMES = Object.keys(LIB);
export const sfxReady = () => !!ac && ac.state === 'running' && !gated() && sound();
export function sfx(name, { pitch = 1, gain = 1 } = {}) {
  const f = LIB[name]; if (!f) return false; const now = globalThis.performance?.now?.() || 0; if (now - (sfxLast[name] || -1e9) < 45) return false; sfxLast[name] = now;
  globalThis.__cmSfxLog?.push(name); // test hook (the log array is only created by tests)
  if (!sfxReady() || !master) return false; try { f(ac.currentTime + .005, master, pitch, gain); } catch { return false; } return true; }
globalThis.__cmSfx = { ready: () => sfxReady(), play: (n, o) => sfx(n, o) }; // test/debug hook
