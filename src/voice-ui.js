// Push-to-talk UI for real game voice (src/rtc-voice.js). Hold the button (or Space when focused) to talk: a turn is cut at
// 10 s and the meter shows the rolling 10 s-per-minute budget. Used by arcade proximity voice and match/room voice.
import { VoiceHub, TURN_MS, BUDGET_MS } from './rtc-voice.js';
export const pttHTML = id => `<div class="row gap ptt-row" id="${id}" hidden><button class="ptt glass3d" aria-label="Hold to talk">🎙 Hold to talk</button><div class="ptt-meter grow" aria-hidden="true"><i></i></div><span class="small muted ptt-note"></span></div>`;
export function mountPTT(root, hub) { const b = root.querySelector('.ptt'), bar = root.querySelector('.ptt-meter i'), note = root.querySelector('.ptt-note'); root.hidden = false;
  const down = e => { e.preventDefault(); const r = hub.press(); if (!r.ok) { note.textContent = `talk budget used · ${Math.ceil(r.retryIn / 1000)}s`; return; } b.classList.add('live'); note.textContent = 'talking…'; };
  const up = () => { hub.release(); b.classList.remove('live'); note.textContent = ''; };
  b.onpointerdown = down; b.onpointerup = b.onpointerleave = b.onpointercancel = up; b.onkeydown = e => { if (e.code === 'Space' && !e.repeat) down(e); }; b.onkeyup = e => { if (e.code === 'Space') up(); };
  const t = setInterval(() => { if (!root.isConnected) return clearInterval(t); const cut = hub.tick(); if (cut) { b.classList.remove('live'); note.textContent = cut === 'turn-over' ? `${TURN_MS / 1000}s turn over` : 'talk budget used'; }
    const left = hub.mine.left(); bar.style.width = `${(left / BUDGET_MS) * 100}%`; }, 200);
  return () => { clearInterval(t); up(); root.hidden = true; }; }
// start a hub on the mesh voice signal; returns {hub, stop} or {error}
export async function startVoice({ me, code, mesh, peerInfo, isMuted = () => false, mode = 'room', root }) {
  const signal = mesh?.arcade?.voiceSignal; if (!signal) return { error: 'Voice needs the live mesh.' };
  if (!globalThis.RTCPeerConnection) return { error: 'This browser has no WebRTC.' };
  const hub = new VoiceHub({ me: { ...me, code }, signal, mode, peerInfo, isMuted, isBlocked: c => !!mesh?.blocklist?.isBlocked(c) });
  const r = await hub.start(); if (!r.ok) { hub.stop(); return { error: 'Microphone permission is needed for voice.' }; }
  const unmount = root ? mountPTT(root, hub) : () => {}; return { hub, stop: () => { unmount(); hub.stop(); } };
}
