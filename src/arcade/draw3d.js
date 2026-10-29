// TRUE-3D DRAW & GUESS: the shared drawing is a live canvas texture on a glowing easel in 3D space. Drawers paint by
// raycasting the pointer onto the easel (UV -> normalized 0..1 coords, the same stroke format as before), so strokes
// sync unchanged. Fixed camera (no orbit), gentle parallax.
import { stage } from './three-scene.js';
import { particles } from './feel3d.js';
export async function draw3d(canvas, src, { onDown = () => {}, onMove = () => {}, onUp = () => {} } = {}) {
  const S = await stage(canvas, { bloom: 0.55 }); const { THREE, scene } = S, root = new THREE.Group(); scene.add(root);
  const tex = new THREE.CanvasTexture(src); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })); root.add(face);
  const back = new THREE.Mesh(new THREE.BoxGeometry(8.4, 8.4, 0.25), new THREE.MeshStandardMaterial({ color: S.color(sw => sw.bg2 || sw.bg), metalness: 0.5, roughness: 0.3 })); back.position.z = -0.14; root.add(back);
  const edge = new THREE.MeshBasicMaterial({ color: S.color('cy'), toneMapped: false });
  for (const [w, h, x, y] of [[8.5, .08, 0, 4.22], [8.5, .08, 0, -4.22], [.08, 8.5, -4.22, 0], [.08, 8.5, 4.22, 0]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), edge); m.position.set(x, y, 0.02); root.add(m); }
  // A-frame easel: two front legs + a rear leg, a ledge tray, a clear refracting glass pane over the canvas, and a 3D glass
  // stylus that rides the stroke tip (local drawer) with an ink spark trail.
  const legM = new THREE.MeshPhysicalMaterial({ transmission: 0.85, ior: 1.5, thickness: 0.5, roughness: 0.06, clearcoat: 1, transparent: true });
  S.tint(legM.color, 'glass');
  for (const [x, z, rx, rz] of [[-3.2, 0.25, 0.1, 0.12], [3.2, 0.25, 0.1, -0.12], [0, -1.6, -0.32, 0]]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 10.5, 14), legM); leg.position.set(x, -2.6, z); leg.rotation.set(rx, 0, rz); root.add(leg); }
  const tray = new THREE.Mesh(new THREE.BoxGeometry(9, 0.22, 0.7), legM); tray.position.set(0, -4.45, 0.28); root.add(tray);
  const lip = new THREE.Mesh(new THREE.BoxGeometry(9, 0.07, 0.07), edge); lip.position.set(0, -4.32, 0.62); root.add(lip);
  const pane = new THREE.Mesh(new THREE.BoxGeometry(8.2, 8.2, 0.12), new THREE.MeshPhysicalMaterial({ transmission: 1, ior: 1.45, thickness: 0.12, roughness: 0.02, clearcoat: 1, envMapIntensity: 0.25, transparent: true, opacity: 0.12 }));
  S.tint(pane.material.color, 'glass'); pane.position.z = 0.09; pane.raycast = () => {}; root.add(pane);
  const pen = new THREE.Group(); const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.2, 16), legM); body.position.y = 1.25; pen.add(body);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 16), new THREE.MeshBasicMaterial({ color: S.color('hot'), toneMapped: false })); tip.rotation.x = Math.PI; tip.position.y = 0.0; pen.add(tip);
  pen.rotation.set(0.5, 0, -0.45); pen.visible = false; root.add(pen); const ink = particles(S, root, 240); const inkC = S.color('hot');
  const penAt = p => { if (!p) return; pen.visible = true; pen.position.set(p[0] * 8 - 4, 4 - p[1] * 8, 0.3); ink.burst(pen.position.x, pen.position.y, 0.35, inkC, 3, 1.2); };
  root.rotation.x = -0.08; S.cam.position.set(0, 0.2, 10.6); S.cam.lookAt(0, 0, 0);
  const ray = new THREE.Raycaster(), v = new THREE.Vector2();
  const uvAt = e => { const r = canvas.getBoundingClientRect(); v.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(v, S.cam); const h = ray.intersectObject(face)[0]; return h?.uv ? [+h.uv.x.toFixed(3), +(1 - h.uv.y).toFixed(3)] : null; };
  canvas.style.touchAction = 'none'; let down = false, dirty = true, fr = 0, last = 0;
  canvas.addEventListener('pointerdown', e => { const p = uvAt(e); if (!p) return; down = true; canvas.setPointerCapture?.(e.pointerId); onDown(p); penAt(p); dirty = true; });
  canvas.addEventListener('pointermove', e => { if (!down) return; const p = uvAt(e); if (p) { onMove(p); penAt(p); dirty = true; } });
  for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, () => { if (down) { down = false; onUp(); pen.visible = false; } });
  const toScreen = (nx, ny) => { const p = new THREE.Vector3(nx * 8 - 4, 4 - ny * 8, 0); face.localToWorld(p); p.project(S.cam); const r = canvas.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; };
  S.onTick(t => { const dt = Math.min(0.05, ((t - (last || t)) / 1000)); last = t; ink.tick(dt); if (dirty || ++fr % S.texEvery() === 0) { tex.needsUpdate = true; dirty = false; } if (!S.reduced) root.rotation.y = Math.sin(t / 5000) * 0.03; });
  const view = { set() {}, uvAt, toScreen, dispose: S.dispose, stage: S }; globalThis.__cmDraw = view; return view;
}
