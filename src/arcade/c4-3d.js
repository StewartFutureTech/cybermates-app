// 3D CONNECT FOUR: upright neon glass frame (7x6), transparent glass discs tinted with team theme colours (--cy / --hot),
// drop with a physics-like bounce (gravity + damped restitution) and a fading light trail; the winning line pulses.
// Free orbit (drag / pinch / wheel, slow auto-orbit when idle). Shared starfield + bloom + 2D fallback (three-scene.js).
import { stage, orbit } from './three-scene.js';
import { mixHex } from './fx.js';
import { COLS, ROWS } from './games/connect4.js';
const X = c => c - (COLS - 1) / 2, Y = r => (ROWS - 1) / 2 - r + 3.2;
export async function connect4_3d(canvas, { onPick = () => {} } = {}) {
  const S = await stage(canvas, { bloom: 1.0 }); const { THREE, scene } = S, col = [S.color('cy'), S.color('hot')], root = new THREE.Group(); scene.add(root);
  const frameMat = new THREE.MeshPhysicalMaterial({ transmission: 0.85, ior: 1.5, thickness: 0.3, roughness: 0.08, clearcoat: 1, transparent: true, opacity: 0.55 });
  S.tint(frameMat.color, sw => mixHex(sw.bg2, sw.cy, 0.15)); const neon = new THREE.MeshBasicMaterial({ color: col[0] });
  const fw = COLS + 0.4, fh = ROWS + 0.4; const shape = new THREE.Shape(); shape.moveTo(-fw / 2, -fh / 2); shape.lineTo(fw / 2, -fh / 2); shape.lineTo(fw / 2, fh / 2); shape.lineTo(-fw / 2, fh / 2);
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) { const h = new THREE.Path(); h.absarc(X(c), Y(r) - 3.2, 0.38, 0, Math.PI * 2, true); shape.holes.push(h); }
  for (const z of [-0.22, 0.22]) { const pl = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false, curveSegments: 20 }), frameMat); pl.position.set(0, 3.2, z - 0.03); root.add(pl); }
  for (const [w, h, x, y] of [[fw + .1, .06, 0, 3.2 - fh / 2], [fw + .1, .06, 0, 3.2 + fh / 2], [.06, fh, -fw / 2, 3.2], [.06, fh, fw / 2, 3.2]]) for (const z of [-0.25, 0.25]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, .05), neon); m.position.set(x, y, z); root.add(m); }
  const floor = new THREE.GridHelper(14, 28); floor.material.vertexColors = false; floor.material.needsUpdate = true; S.tint(floor.material.color, 'cy'); floor.material.transparent = true; floor.material.opacity = 0.25; floor.position.y = -0.2; root.add(floor);
  const discGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.26, 40); discGeo.rotateX(Math.PI / 2);
  const discMat = t => { const m = new THREE.MeshPhysicalMaterial({ emissiveIntensity: 0.35, transmission: 0.9, ior: 1.5, thickness: 0.4, roughness: 0.05, clearcoat: 1, attenuationDistance: 0.6 }); for (const k of ['color', 'emissive', 'attenuationColor']) S.tint(m[k], t ? 'hot' : 'cy'); return m; };
  const MATS = [discMat(0), discMat(1)], discs = new Map(), falling = [], trails = [];
  const hover = new THREE.Mesh(discGeo, MATS[0].clone()); hover.material.opacity = 0.35; hover.material.transparent = true; hover.position.set(0, Y(-1), 0); hover.visible = false; root.add(hover);
  let winLine = null;
  function set(st, { win = null } = {}) { for (let i = 0; i < st.g.length; i++) { const t = st.g[i]; if (t == null || discs.has(i)) continue; const r = Math.floor(i / COLS), c = i % COLS, m = new THREE.Mesh(discGeo, MATS[t]); m.position.set(X(c), Y(-1.5), 0); root.add(m); discs.set(i, m);
      falling.push({ m, y: Y(-1.5), vy: 0, to: Y(r), bounces: 0, t }); }
    for (const [i, m] of discs) if (st.g[i] == null) { root.remove(m); discs.delete(i); }
    winLine = win?.line ? win.line.map(i => discs.get(i)).filter(Boolean) : null; }
  const O = orbit(S, canvas, { R: 11, tilt: 0.18, target: [0, 3.2, 0], idleS: 5, stopOnAnyTouch: true }) /* cm-v35: idle resume 2.5 s -> 5 s */;
  O.onTap(ev => { const b = canvas.getBoundingClientRect(), v = new THREE.Vector2(((ev.clientX - b.left) / b.width) * 2 - 1, -((ev.clientY - b.top) / b.height) * 2 + 1), ray = new THREE.Raycaster(); ray.setFromCamera(v, S.cam);
    const p = new THREE.Vector3(); if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), p)) { const c = Math.round(p.x + (COLS - 1) / 2); if (c >= 0 && c < COLS) onPick(c); } });
  let last = performance.now();
  S.onTick(t => { const dt = Math.min(0.033, (t - last) / 1000); last = t; O.tick(dt);
    for (let i = falling.length - 1; i >= 0; i--) { const f = falling[i]; f.vy -= 30 * dt; f.y += f.vy * dt; if (f.y <= f.to) { f.y = f.to; if (Math.abs(f.vy) > 1.5 && f.bounces < 3) { f.vy = -f.vy * 0.32; f.bounces++; } else { falling.splice(i, 1); } } f.m.position.y = f.y;
      if (!S.reduced && f.vy < -2) { const tr = new THREE.Mesh(discGeo, new THREE.MeshBasicMaterial({ color: col[f.t], transparent: true, opacity: 0.35, depthWrite: false })); tr.position.copy(f.m.position); tr.scale.setScalar(0.85); root.add(tr); trails.push(tr); } }
    for (let i = trails.length - 1; i >= 0; i--) { const tr = trails[i]; tr.material.opacity -= dt * 1.6; tr.scale.multiplyScalar(0.97); if (tr.material.opacity <= 0) { root.remove(tr); tr.material.dispose(); trails.splice(i, 1); } }
    const p = S.reduced ? 1 : 0.5 + 0.5 * Math.sin(t / 260); neon.color.copy(col[0]).multiplyScalar(S.reduced ? 1 : 0.75 + 0.25 * Math.sin(t / 1600));
    for (const m of discs.values()) m.scale.setScalar(1); if (winLine) for (const m of winLine) { m.scale.setScalar(1 + 0.12 * p); } for (const k of [0, 1]) MATS[k].emissiveIntensity = 0.35; if (winLine) { for (const m of winLine) m.material = m.material.userData.win ||= Object.assign(m.material.clone(), { userData: {} }); for (const m of winLine) m.material.emissiveIntensity = 0.8 + 1.6 * p; } });
  return { set, dispose: S.dispose, stage: S, falling: () => falling.length };
}
