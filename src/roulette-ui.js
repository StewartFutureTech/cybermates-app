// Round-robin video/voice connect UI (18+ only; caller never renders it for minors). See src/roulette.js.
import { Roulette, SAFETY_NOTICE, visibleFor } from './roulette.js';
import { mesh } from './app-mesh.js';
import { reportFlow } from './mesh-ui.js';
let R = null;
export function rouletteView(v, me) {
  if (!visibleFor(me)) { v.innerHTML = ''; return; } const m = mesh();
  const seen = globalThis.localStorage?.getItem('cm.rl.notice') === '1';
  if (!seen) { v.innerHTML = `<div class="card rl-notice"><h3>🎲 Round-robin connect</h3><p>${SAFETY_NOTICE}</p><button id="rl-ok" class="primary">I'm 18+ and understand</button></div>`; v.querySelector('#rl-ok').onclick = () => { localStorage.setItem('cm.rl.notice', '1'); rouletteView(v, me); }; return; }
  R ||= m?.roulette ? m.roulette.session(me, s => draw(s)) : new Roulette({ me, myCode: 'ME', pool: () => [], cooldown: { has: () => false, add: async () => {} } });
  const draw = () => { if (!v.isConnected) return; v.innerHTML = `<div class="roulette"><div class="rl-stage"><video id="rl-remote" autoplay playsinline></video><div class="rl-state">${R.state === 'connected' ? '🟢 connected' : R.state === 'connecting' ? '… connecting' : R.on ? '📡 looking for an adult who is also in round-robin…' : 'Tap Start'}</div><video id="rl-self" autoplay playsinline muted></video></div>
    <div class="row gap rl-ctl">${R.on ? `<button id="rl-next" class="primary">⏭ Skip / Next</button><button id="rl-report" class="danger" ${R.peer ? '' : 'disabled'}>⚑ Report</button><button id="rl-stop">Stop</button>` : '<button id="rl-start" class="primary">▶ Start</button>'}</div>
    <label class="small"><input type="checkbox" id="rl-bos" style="width:auto" ${R.blockOnSkip ? 'checked' : ''}> Block people I skip</label>
    <p class="muted small">18+ only · both sides opt in · no rematch for 24 h (list stays encrypted on this phone) · blocks and bans respected · peer-to-peer; on many networks calls need a TURN relay.</p></div>`;
    const q = s => v.querySelector(s); if (q('#rl-start')) q('#rl-start').onclick = () => { R.enter(); m?.roulette?.setOn(true); R.next().then(draw); draw(); };
    if (q('#rl-next')) q('#rl-next').onclick = () => R.skip().then(draw); if (q('#rl-stop')) q('#rl-stop').onclick = () => { R.leave(); m?.roulette?.setOn(false); draw(); };
    if (q('#rl-report')) q('#rl-report').onclick = async () => { const c = R.peer; if (c && m) { await reportFlow(m, c); R.skip({ block: false }).then(draw); } };
    q('#rl-bos').onchange = e => { R.blockOnSkip = e.target.checked; };
    const rem = m?.roulette?.remote?.(R.peer); if (rem) q('#rl-remote').srcObject = rem; };
  draw();
}
