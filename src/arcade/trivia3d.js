// TRUE-3D TRIVIA CLASH: the question floats on a standing holo-panel; the answers are four glass pads on the floor,
// each with its text rendered onto it. Tapping a pad (raycast) answers. Scores sit on two glowing pillars.
import { stage } from './three-scene.js';
const wrapText = (x, t, maxW, lh, x0, y0) => { const words = String(t).split(' '); let line = '', y = y0; for (const w of words) { const tt = line ? line + ' ' + w : w; if (x.measureText(tt).width > maxW && line) { x.fillText(line, x0, y); line = w; y += lh; } else line = tt; } x.fillText(line, x0, y); };
export async function trivia3d(canvas, { onPick = () => {} } = {}) {
  const S = await stage(canvas, { bloom: 0.7 }); const { THREE, scene } = S, root = new THREE.Group(); scene.add(root); const C = { cy: S.color('cy'), hot: S.color('hot'), fg: S.color('fg'), bg2: S.color(sw => sw.bg2 || sw.bg) };
  const texPlane = (w, h, pw, ph) => { const c = document.createElement('canvas'); c.width = pw; c.height = ph; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false })); return { m, c, x: c.getContext('2d'), tex }; };
  const Q = texPlane(8, 3, 1024, 384); Q.m.position.set(0, 3.1, -2.6); root.add(Q.m);
  const qFrame = new THREE.Mesh(new THREE.BoxGeometry(8.3, 3.3, 0.1), new THREE.MeshPhysicalMaterial({ color: C.bg2, transmission: 0.85, ior: 1.5, thickness: 0.3, roughness: 0.05, clearcoat: 1, envMapIntensity: 0.4, transparent: true, opacity: 0.9 })); qFrame.position.set(0, 3.1, -2.67); root.add(qFrame);
  const pads = [], padGeo = new THREE.BoxGeometry(3.6, 0.18, 1.9);
  for (let i = 0; i < 4; i++) { const g = new THREE.Group(); g.position.set((i % 2 ? 1.95 : -1.95), 0, (i < 2 ? -0.1 : 2.1)); const base = new THREE.Mesh(padGeo, new THREE.MeshStandardMaterial({ color: C.bg2, metalness: 0.2, roughness: 0.25, emissive: C.cy, emissiveIntensity: 0.05 })); base.userData.i = i; g.add(base);
    const L = texPlane(3.4, 1.7, 512, 256); L.m.rotation.x = -Math.PI / 2; L.m.position.y = 0.1; L.m.userData.i = i; g.add(L.m); root.add(g); pads.push({ g, base, L }); }
  const score = [0, 1].map(t => { const P = texPlane(1.6, 1.2, 256, 192); P.m.position.set(t ? 3.9 : -3.9, 1.5, -1.6); P.m.rotation.y = t ? -0.5 : 0.5; root.add(P.m); return P; });
  let key = '', hover = -1, picked = -1;
  const set = ({ text = '', choices = [], score: sc = [0, 0], answered = false, correct = null } = {}) => { const k = JSON.stringify([text, choices, sc, answered, correct]); if (k === key) return; key = k; const sw = getComputedStyle(document.documentElement);
    const col = n => sw.getPropertyValue('--' + n).trim() || 'white';
    Q.x.clearRect(0, 0, 1024, 384); Q.x.fillStyle = col('fg'); Q.x.font = '700 60px ui-monospace,monospace'; Q.x.textBaseline = 'top'; wrapText(Q.x, text || (answered ? 'Waiting for the others…' : ''), 980, 70, 22, 30); Q.tex.needsUpdate = true;
    pads.forEach((p, i) => { const c = choices[i]; p.g.visible = c != null; p.L.x.clearRect(0, 0, 512, 256); p.L.x.fillStyle = col(i === correct ? 'acid' : 'fg'); p.L.x.font = '700 58px ui-monospace,monospace'; p.L.x.textBaseline = 'top'; wrapText(p.L.x, `${'ABCD'[i]} ${c ?? ''}`, 480, 66, 16, 40); p.L.tex.needsUpdate = true;
      p.base.material.emissive.copy(i === picked ? C.hot : C.cy); p.base.material.emissiveIntensity = answered ? (i === picked ? 0.6 : 0.02) : 0.08; });
    score.forEach((P, t) => { P.x.clearRect(0, 0, 256, 192); P.x.fillStyle = col(t ? 'hot' : 'cy'); P.x.font = '700 120px ui-monospace,monospace'; P.x.textAlign = 'center'; P.x.textBaseline = 'middle'; P.x.fillText(String(sc[t] ?? 0), 128, 100); P.tex.needsUpdate = true; });
    if (!answered) picked = -1; };
  S.cam.position.set(0, 7.4, 9.0); S.cam.lookAt(0, 1.0, 0);
  const ray = new THREE.Raycaster(), v = new THREE.Vector2(), hits = pads.map(p => p.base);
  const pickAt = (cx, cy) => { const r = canvas.getBoundingClientRect(); v.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(v, S.cam); const h = ray.intersectObjects(hits.filter(m => m.parent.visible), false)[0]; return h ? h.object.userData.i : -1; };
  const padScreen = i => { const p = new THREE.Vector3(); pads[i].g.getWorldPosition(p); p.project(S.cam); const r = canvas.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; };
  canvas.addEventListener('click', e => { const i = pickAt(e.clientX, e.clientY); if (i >= 0) { picked = i; key = ''; onPick(i); } });
  canvas.addEventListener('pointermove', e => { hover = pickAt(e.clientX, e.clientY); canvas.style.cursor = hover >= 0 ? 'pointer' : ''; });
  S.onTick(t => { pads.forEach((p, i) => { p.g.position.y = (i === hover ? 0.12 : 0) + (S.reduced ? 0 : Math.sin(t / 900 + i) * 0.03); }); Q.m.position.y = 3.1 + (S.reduced ? 0 : Math.sin(t / 1600) * 0.06); });
  const view = { set, pickAt, padScreen, dispose: S.dispose, stage: S }; globalThis.__cmTrivia = view; return view;
}
