// MEGA FLEET 3D view (true 3D, low fidelity, instanced): follow camera that zooms out as your ship grows (no camera drag),
// asteroids = ONE InstancedMesh of low-poly flat-shaded rocks (only the ones near the camera are written each frame),
// shots + explosion sparks = instanced glowing spheres/boxes (bloom from three-scene's stage, always on at 0.7x),
// ships = refracting glass hulls (MeshPhysicalMaterial transmission) with a glowing engine core, tinted per player.
// API: frame(room, myCode) · aimAt(clientX, clientY, me) -> heading · screenOf(x, y) · burst(x, y, n, colorCode) · dispose().
import { stage } from './three-scene.js';
import { radius, viewRadius, rockPos, MAP } from './megaship.js';
const MAX_ROCKS = 480, MAX_SHOTS = 400, MAX_SPARKS = 360, MAX_SHIPS = 48;
export async function megafleet3d(canvas, { colorOf = () => null } = {}) {
  const S = await stage(canvas, { bloom: 0.9 }); const { THREE, scene, cam } = S; cam.far = 4000; cam.updateProjectionMatrix();
  const C = { cy: S.color('cy'), hot: S.color('hot'), acid: S.color('acid'), mut: S.color('mut'), fg: S.color('fg'), bg2: S.color(sw => sw.bg2 || sw.bg) };
  // world floor: faint grid + map border
  const grid = new THREE.GridHelper(MAP, 20, C.cy, C.mut); grid.position.set(MAP / 2, -30, MAP / 2); grid.material.transparent = true; grid.material.opacity = 0.12; scene.add(grid);
  const bpts = [[0, 0], [MAP, 0], [MAP, MAP], [0, MAP]].map(([x, z]) => new THREE.Vector3(x, -29, z)); const border = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(bpts), new THREE.LineBasicMaterial({ color: C.hot, transparent: true, opacity: 0.6 })); scene.add(border);
  // parallax starfield that follows the camera
  const sg = new THREE.BufferGeometry(), sp = new Float32Array(900 * 3); for (let i = 0; i < 900; i++) sp.set([(Math.random() - 0.5) * 5000, -400 - Math.random() * 600, (Math.random() - 0.5) * 5000], i * 3); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: C.fg, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.7 })); scene.add(stars);
  const hemi = new THREE.HemisphereLight(C.fg, C.bg2, 0.35); scene.add(hemi);
  // asteroids
  const rockMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.9, metalness: 0.1, envMapIntensity: 0.05 }); rockMat.color.setScalar(0.7); const rocks = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), rockMat, MAX_ROCKS); rocks.frustumCulled = false; scene.add(rocks);
  const tierCol = [0, 1, 2, 3, 4].map(k => C.bg2.clone().lerp(C.mut, 0.35 + k * 0.12)); for (let i = 0; i < MAX_ROCKS; i++) rocks.setColorAt(i, tierCol[0]);
  // shots + sparks
  const glow = () => new THREE.MeshBasicMaterial({ toneMapped: false });
  const shots = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), glow(), MAX_SHOTS); shots.frustumCulled = false; scene.add(shots); for (let i = 0; i < MAX_SHOTS; i++) shots.setColorAt(i, C.cy);
  const sparks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), glow(), MAX_SPARKS); sparks.frustumCulled = false; scene.add(sparks); for (let i = 0; i < MAX_SPARKS; i++) sparks.setColorAt(i, C.hot);
  const sparkL = []; let sparkI = 0;
  // ships (pooled)
  const hullG = new THREE.ConeGeometry(0.62, 2.1, 6); hullG.rotateZ(-Math.PI / 2); const wingG = new THREE.BoxGeometry(0.9, 0.12, 2.0), coreG = new THREE.SphereGeometry(0.32, 12, 10), ringG = new THREE.TorusGeometry(1.6, 0.05, 6, 40);
  const mats = new Map(); const matFor = code => { if (mats.has(code)) return mats.get(code); const c = new THREE.Color(colorOf(code) || C.cy);
    const m = { hull: new THREE.MeshPhysicalMaterial({ color: c, transmission: 0.85, ior: 1.45, thickness: 0.8, roughness: 0.06, metalness: 0, clearcoat: 0.3, specularIntensity: 0.35, envMapIntensity: 0.12, emissive: c, emissiveIntensity: 0.3, transparent: true }), core: new THREE.MeshBasicMaterial({ color: c, toneMapped: false }) }; mats.set(code, m); return m; };
  const ringM = new THREE.MeshBasicMaterial({ color: C.acid, toneMapped: false, transparent: true, opacity: 0.8 });
  const pool = []; const shipObj = () => { const g = new THREE.Group(), hull = new THREE.Mesh(hullG), wing = new THREE.Mesh(wingG), core = new THREE.Mesh(coreG), ring = new THREE.Mesh(ringG, ringM); wing.position.x = -0.35; core.position.x = -0.95; ring.rotation.x = Math.PI / 2; g.add(hull, wing, core, ring); g.userData = { hull, wing, core, ring }; scene.add(g); return g; };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), sc = new THREE.Vector3();
  const camT = { x: MAP / 2, z: MAP / 2, h: 400 }, flash = new Map();
  const burst = (x, y, n = 12, code = null, size = 3) => { const col = code ? new THREE.Color(colorOf(code) || C.hot) : C.hot; for (let k = 0; k < n; k++) { const i = sparkI++ % MAX_SPARKS, a = Math.random() * 6.283, s = (40 + Math.random() * 120) * (size / 3); sparkL[i] = { x, y: 0, z: y, vx: Math.cos(a) * s, vy: (Math.random() - 0.3) * s * 0.6, vz: Math.sin(a) * s, t: 0.7, k: size * (0.4 + Math.random() * 0.6) }; sparks.setColorAt(i, col); } sparks.instanceColor.needsUpdate = true; };
  let room = null, me = null, lastT = performance.now();
  const frame = (r, myCode) => { room = r; me = myCode; };
  S.onTick(t => { const dt = Math.min(0.05, (t - lastT) / 1000); lastT = t; if (!room) return; const self = room.players.get(me);
    if (self) { const H = viewRadius(self.mass) * 1.15; camT.x += (self.x - camT.x) * Math.min(1, dt * 6); camT.z += (self.y - camT.z) * Math.min(1, dt * 6); camT.h += (H - camT.h) * Math.min(1, dt * 1.5); }
    cam.position.set(camT.x, camT.h, camT.z + camT.h * 0.42); cam.lookAt(camT.x, 0, camT.z - camT.h * 0.05); stars.position.set(camT.x * 0.85, 0, camT.z * 0.85);
    const vr = camT.h * 1.25, vr2 = vr * vr; let n = 0;
    for (const a of room.rocksNear(camT.x, camT.z, vr)) { if (n >= MAX_ROCKS) break; const [x, y] = rockPos(a, room.t); if ((x - camT.x) ** 2 + (y - camT.z) ** 2 > vr2) continue; e.set(room.t * a.spin + a.ph, room.t * a.spin * 0.7, a.ph); q.setFromEuler(e); sc.setScalar(a.r);
      m4.compose(v3.set(x, 0, y), q, sc); rocks.setMatrixAt(n, m4); const f = flash.get(a.key); rocks.setColorAt(n, f && t - f < 120 ? C.hot : tierCol[a.tier]); n++; }
    rocks.count = n; rocks.instanceMatrix.needsUpdate = true; if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    let ns = 0; q.identity(); for (const s of room.shots) { if (ns >= MAX_SHOTS) break; if ((s.x - camT.x) ** 2 + (s.y - camT.z) ** 2 > vr2) continue; sc.setScalar(s.r * 1.3); m4.compose(v3.set(s.x, 2, s.y), q, sc); shots.setMatrixAt(ns, m4); shots.setColorAt(ns, matFor(s.by).core.color); ns++; }
    shots.count = ns; shots.instanceMatrix.needsUpdate = true; if (shots.instanceColor) shots.instanceColor.needsUpdate = true;
    let nk = 0; for (let i = 0; i < MAX_SPARKS; i++) { const p = sparkL[i]; if (!p || p.t <= 0) { m4.makeScale(0, 0, 0); sparks.setMatrixAt(i, m4); continue; } p.t -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; sc.setScalar(p.k * Math.max(0, p.t / 0.7)); m4.compose(v3.set(p.x, p.y, p.z), q, sc); sparks.setMatrixAt(i, m4); nk++; } sparks.instanceMatrix.needsUpdate = true;
    let ni = 0; for (const p of room.players.values()) { if (!p.alive || ni >= MAX_SHIPS) continue; if ((p.x - camT.x) ** 2 + (p.y - camT.z) ** 2 > vr2 * 1.2) continue; const g = pool[ni] || (pool[ni] = shipObj()); ni++; const m = matFor(p.code), R = radius(p.mass);
      g.visible = true; g.position.set(p.x, 4, p.y); g.rotation.set(0, -p.h, Math.sin(t / 400 + p.hue) * 0.12); g.scale.setScalar(R); g.userData.hull.material = m.hull; g.userData.wing.material = m.hull; g.userData.core.material = m.core; g.userData.core.scale.setScalar(1 + 0.25 * Math.sin(t / 90 + p.hue)); g.userData.ring.visible = p.code === me; }
    for (let i = ni; i < pool.length; i++) pool[i].visible = false; });
  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hp = new THREE.Vector3();
  const worldAt = (cx, cy) => { const r = canvas.getBoundingClientRect(); v2.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(v2, cam); return ray.ray.intersectPlane(plane, hp) ? [hp.x, hp.z] : null; };
  const aimAt = (cx, cy, p) => { const w = worldAt(cx, cy); return w && p ? Math.atan2(w[1] - p.y, w[0] - p.x) : null; };
  const screenOf = (x, y) => { const p = new THREE.Vector3(x, 0, y).project(cam), r = canvas.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; };
  const view = { frame, aimAt, worldAt, screenOf, burst, flash: key => flash.set(key, performance.now()), dispose: S.dispose, stage: S, get camH() { return camT.h; }, get rockCount() { return rocks.count; } };
  globalThis.__cmMega3d = view; return view;
}
