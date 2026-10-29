// STAR FLEET 3D view (Battleship). Two glass boards on the XZ plane under a FIXED camera (no orbit, no drag, no auto-spin:
// the old orbiting camera rotated/mirrored the boards under your finger, which is what made shots land off the tapped cell).
// Coordinate contract (shared with games/battleship.js + the 2D fallback): cell = r * 10 + c, column c -> +x (left->right
// on screen), row r -> +z (top->bottom on screen, the camera looks toward -z). Picking = raycast against the board's tile
// InstancedMesh (instanceId == cell) with a plane-intersection fallback through cellFromLocal(), so a tap on the cell you
// see always resolves to exactly that (r, c). Layout: 'place' = your board alone and large; 'battle' = enemy waters large
// at the bottom (thumb side) and your fleet small at the top.
// API: set({ mode, mine: ships[], sel, bad, shotsMine, shotsEnemy, sunkEnemy, pending }) · pickAt(x, y) -> {b, c} ·
// cellScreen(b, c) -> {x, y} · on(down|move|up, fn(hit, e)) · dispose().
import { stage } from './three-scene.js';
export const N = 10;
// board-local point (x, z measured from the board centre, board side `size`) -> cell, or -1 outside
export function cellFromLocal(x, z, size, n = N) { const s = size / n, c = Math.floor((x + size / 2) / s), r = Math.floor((z + size / 2) / s); return c < 0 || r < 0 || c >= n || r >= n ? -1 : r * n + c; }
export const localOfCell = (cell, size, n = N) => { const s = size / n; return [-size / 2 + (cell % n + 0.5) * s, -size / 2 + (Math.floor(cell / n) + 0.5) * s]; };
export const LAYOUT = { place: { mine: [0, 0, 9], enemy: null }, battle: { mine: [0, -6.3, 5.2], enemy: [0, 1.9, 9] } }; // [cx, cz, size]
export async function battleship3d(canvas, { tilt = 1.2 } = {}) {
  const S = await stage(canvas, { bloom: 0.8 }); const { THREE, scene } = S, root = new THREE.Group(); scene.add(root);
  const C = { cy: S.color('cy'), hot: S.color('hot'), acid: S.color('acid'), mut: S.color('mut'), bg2: S.color(sw => sw.bg2 || sw.bg) };
  const SIZE = 10, s = SIZE / N, B = {}, handlers = { down: [], move: [], up: [] };
  const glass = () => new THREE.MeshPhysicalMaterial({ transmission: 0.9, ior: 1.5, thickness: 0.35, roughness: 0.3, metalness: 0, specularIntensity: 0.15, clearcoat: 0, envMapIntensity: 0.06, transparent: true, opacity: 0.95 }); // low env: the near-top-down camera would otherwise mirror the studio ceiling (white glare)
  const label = text => { const c = document.createElement('canvas'); c.width = 512; c.height = 64; const x = c.getContext('2d'); x.font = '600 34px ui-monospace,monospace'; x.fillStyle = 'white'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text.toUpperCase(), 256, 32);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 0.875), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, color: C.mut, toneMapped: false })); m.rotation.x = -Math.PI / 2; return m; };
  for (const id of ['mine', 'enemy']) { const g = new THREE.Group(), geo = new THREE.BoxGeometry(s - 0.07, 0.12, s - 0.07), tiles = new THREE.InstancedMesh(geo, glass(), N * N), m4 = new THREE.Matrix4();
    for (let i = 0; i < N * N; i++) { const [x, z] = localOfCell(i, SIZE); m4.makeTranslation(x, 0, z); tiles.setMatrixAt(i, m4); tiles.setColorAt(i, C.bg2); }
    tiles.userData.board = id; g.add(tiles); const frame = new THREE.Mesh(new THREE.BoxGeometry(SIZE + 0.3, 0.06, SIZE + 0.3), new THREE.MeshBasicMaterial({ color: C.cy, transparent: true, opacity: 0.18 })); frame.position.y = -0.08; g.add(frame);
    const lab = label(id === 'mine' ? 'your fleet' : 'enemy waters · tap to fire'); lab.position.set(0, 0.02, -SIZE / 2 - 0.6); g.add(lab);
    const marks = new THREE.Group(); g.add(marks); root.add(g); B[id] = { g, tiles, marks, lab, col: Array(N * N).fill(null), key: '' }; }
  const G = { cap: new THREE.CapsuleGeometry(0.3, 1, 4, 14), orb: new THREE.SphereGeometry(0.25, 18, 12), dot: new THREE.SphereGeometry(0.11, 10, 8), ring: new THREE.TorusGeometry(0.36, 0.05, 8, 28) };
  const M = { hot: new THREE.MeshBasicMaterial({ color: C.hot, toneMapped: false }), mut: new THREE.MeshBasicMaterial({ color: C.mut }), acid: new THREE.MeshBasicMaterial({ color: C.acid, toneMapped: false }),
    ship: new THREE.MeshPhysicalMaterial({ color: C.cy, transmission: 0.8, ior: 1.5, thickness: 0.5, roughness: 0.05, clearcoat: 0.5, envMapIntensity: 0.15, emissive: C.cy, emissiveIntensity: 0.35 }),
    sel: new THREE.MeshPhysicalMaterial({ color: C.acid, transmission: 0.7, ior: 1.5, thickness: 0.5, roughness: 0.05, clearcoat: 0.5, envMapIntensity: 0.15, emissive: C.acid, emissiveIntensity: 0.6 }),
    wreck: new THREE.MeshPhysicalMaterial({ color: C.hot, transmission: 0.6, ior: 1.4, thickness: 0.4, roughness: 0.2, envMapIntensity: 0.15, emissive: C.hot, emissiveIntensity: 0.25, transparent: true, opacity: 0.7 }) };
  const shipMesh = (cells, mat) => { const a = cells[0], b = cells[cells.length - 1], [x0, z0] = localOfCell(a, SIZE), [x1, z1] = localOfCell(b, SIZE), m = new THREE.Mesh(G.cap, mat);
    m.scale.set(s, cells.length * s * 0.88 / 1.6, s); if (x1 !== x0) m.rotation.z = Math.PI / 2; else m.rotation.x = Math.PI / 2;
    m.position.set((x0 + x1) / 2, 0.3, (z0 + z1) / 2); return m; };
  const dot = (cell, geo, mat, y = 0.18, k = 1) => { const m = new THREE.Mesh(geo, mat), [x, z] = localOfCell(cell, SIZE); m.position.set(x, y, z); m.scale.setScalar(k); return m; };
  let mode = null, last = {}, hover = null;
  const layout = md => { if (md === mode) return; mode = md; const L = LAYOUT[md]; for (const id of ['mine', 'enemy']) { const p = L[id]; B[id].g.visible = !!p; if (p) { B[id].g.position.set(p[0], 0, p[1]); B[id].g.scale.setScalar(p[2] / SIZE); } } fit(); };
  const fit = () => { const L = LAYOUT[mode || 'place'], bx = Object.values(L).filter(Boolean); let z0 = Infinity, z1 = -Infinity, w = 0; for (const [, cz, sz] of bx) { z0 = Math.min(z0, cz - sz / 2 - 0.9); z1 = Math.max(z1, cz + sz / 2); w = Math.max(w, sz); }
    const asp = (canvas.clientWidth || 1) / (canvas.clientHeight || 1), fov = S.cam.fov * Math.PI / 180, h = (z1 - z0) * Math.sin(tilt) + 0.6, need = Math.max(h / (2 * Math.tan(fov / 2)), (w + 0.6) / (2 * Math.tan(fov / 2) * asp)) * 1.06;
    const cz = (z0 + z1) / 2; S.cam.position.set(0, need * Math.sin(tilt), cz + need * Math.cos(tilt)); S.cam.lookAt(0, 0, cz); S.cam.updateMatrixWorld(); };
  const set = (o = {}) => { last = o; layout(o.mode || 'battle'); const tc = { mine: new Map(), enemy: new Map() };
    const mk = (id, key, build) => { const bb = B[id]; if (bb.key === key) return; bb.key = key; bb.marks.clear(); build(bb.marks); };
    const ships = o.mine || [], sm = o.shotsMine || [], se = o.shotsEnemy || [];
    mk('mine', JSON.stringify([ships, o.sel, sm.join('')]), g => { ships.forEach((sh, i) => g.add(shipMesh(sh.cells, i === o.sel ? M.sel : M.ship))); sm.forEach((v, i) => { if (v === 2) g.add(dot(i, G.orb, M.hot, 0.55, s * 1.2)); else if (v === 1) g.add(dot(i, G.dot, M.mut, 0.18, s * 1.3)); }); });
    mk('enemy', JSON.stringify([se.join(''), o.sunkEnemy || [], o.pending]), g => { for (const cells of o.sunkEnemy || []) g.add(shipMesh(cells, M.wreck)); se.forEach((v, i) => { if (v === 2) g.add(dot(i, G.orb, M.hot, 0.32, s * 1.2)); else if (v === 1) g.add(dot(i, G.dot, M.mut, 0.18, s * 1.3)); });
      if (o.pending != null) { const r = dot(o.pending, G.ring, M.acid, 0.2, s * 1.1); r.rotation.x = Math.PI / 2; g.add(r); } });
    for (const c of o.bad || []) tc.mine.set(c, 'hot'); if (hover) tc[hover.b]?.set(hover.c, 'hover');
    for (const id of ['mine', 'enemy']) { const bb = B[id]; let dirty = false; for (let i = 0; i < N * N; i++) { const col = tc[id].get(i) || null; if (bb.col[i] === col) continue; bb.col[i] = col; dirty = true; bb.tiles.setColorAt(i, col === 'hot' ? C.hot.clone().multiplyScalar(0.5) : col === 'hover' ? C.acid.clone().multiplyScalar(0.45) : C.bg2); } if (dirty) bb.tiles.instanceColor.needsUpdate = true; } };
  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.06), hitP = new THREE.Vector3();
  const pickAt = (x, y) => { const r = canvas.getBoundingClientRect(); v2.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1); root.updateMatrixWorld(true); ray.setFromCamera(v2, S.cam);
    const vis = ['mine', 'enemy'].filter(id => B[id].g.visible), h = ray.intersectObjects(vis.map(id => B[id].tiles), false)[0]; if (h) return { b: h.object.userData.board, c: h.instanceId };
    if (!ray.ray.intersectPlane(plane, hitP)) return null; for (const id of vis) { const g = B[id].g, k = g.scale.x, c = cellFromLocal((hitP.x - g.position.x) / k, (hitP.z - g.position.z) / k, SIZE); if (c >= 0) return { b: id, c }; } return null; };
  const cellScreen = (b, c) => { const g = B[b].g, [x, z] = localOfCell(c, SIZE), p = new THREE.Vector3(g.position.x + x * g.scale.x, 0.06, g.position.z + z * g.scale.x).project(S.cam), r = canvas.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; };
  canvas.style.touchAction = 'none';
  const emit = (k, e) => { const h = pickAt(e.clientX, e.clientY); for (const f of handlers[k]) f(h, e); return h; };
  const onDown = e => { e.preventDefault?.(); canvas.setPointerCapture?.(e.pointerId); hover = emit('down', e); set(last); };
  const onMove = e => { const h = (e.buttons || e.pointerType === 'touch') ? emit('move', e) : (e.pointerType === 'mouse' ? pickAt(e.clientX, e.clientY) : null); if ((h?.b + ':' + h?.c) !== (hover?.b + ':' + hover?.c)) { hover = h; set(last); } };
  const onUp = e => { emit('up', e); hover = null; set(last); };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
  let lw = 0, lh = 0; S.onTick(t => { if (canvas.clientWidth !== lw || canvas.clientHeight !== lh) { lw = canvas.clientWidth; lh = canvas.clientHeight; fit(); } for (const id of ['mine', 'enemy']) for (const m of B[id].marks.children) if (m.geometry === G.orb) m.position.y = (id === 'mine' ? 0.55 : 0.32) + (S.reduced ? 0 : Math.sin(t / 300 + m.position.x) * 0.04); });
  layout('place');
  const view = { set, pickAt, cellScreen, on: (k, f) => handlers[k].push(f), dispose: S.dispose, stage: S, get mode() { return mode; }, get markCount() { return B.mine.marks.children.length + B.enemy.marks.children.length; }, freeze() {} };
  globalThis.__cmBS3d = view; return view;
}
