// TRUE-3D GRID BOARDS (Ultimate Tic-tac-toe, Star Fleet). Each board is an InstancedMesh of glass tiles laid on the XZ
// plane; picking is a raycast against the instanced tiles (instanceId -> cell), so taps land on the cell you see at any
// camera angle. Pieces are real meshes (X = crossed bars, O = torus, ships = capsules, hits/misses = glowing orbs).
// API: set({ tiles, marks, hl, glow }) · pickAt(clientX, clientY) · cellScreen(board, cell) (tests) · dispose().
import { stage, orbit } from './three-scene.js';
export async function grid3d(canvas, { boards, onPick = () => {}, R = 13, tilt = 1.0, gap = 0.06, groupGap = 0.28, orbitOn = true } = {}) {
  const S = await stage(canvas, { bloom: 0.8 }); const { THREE, scene } = S, root = new THREE.Group(); scene.add(root);
  const C = { cy: S.color('cy'), hot: S.color('hot'), acid: S.color('acid'), fg: S.color('fg'), mut: S.color('mut'), bg2: S.color(sw => sw.bg2 || sw.bg) };
  const B = new Map();
  for (const b of boards) { const n = b.n, grp = b.group || 0, ng = grp ? Math.ceil(n / grp) - 1 : 0, s = (b.size - ng * groupGap) / n;
    const pos = (c, r) => [b.cx - b.size / 2 + c * s + (grp ? Math.floor(c / grp) * groupGap : 0) + s / 2, b.cz - b.size / 2 + r * s + (grp ? Math.floor(r / grp) * groupGap : 0) + s / 2];
    const geo = new THREE.BoxGeometry(s - gap, 0.12, s - gap), mat = new THREE.MeshPhysicalMaterial({ transmission: 0.9, ior: 1.5, thickness: 0.35, roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 0.45, transparent: true, opacity: 0.95 }); // clear refracting glass tiles
    const mesh = new THREE.InstancedMesh(geo, mat, n * n); const m4 = new THREE.Matrix4();
    for (let i = 0; i < n * n; i++) { const [x, z] = pos(i % n, Math.floor(i / n)); m4.makeTranslation(x, 0, z); mesh.setMatrixAt(i, m4); mesh.setColorAt(i, C.bg2); }
    mesh.userData.board = b.id; root.add(mesh);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(b.size + 0.3, 0.06, b.size + 0.3), new THREE.MeshBasicMaterial({ color: C.cy, transparent: true, opacity: 0.18 })); frame.position.set(b.cx, -0.08, b.cz); root.add(frame);
    if (b.label) { const t = label(THREE, b.label); t.position.set(b.cx, 0.02, b.cz - b.size / 2 - 0.45); root.add(t); }
    const rec = { ...b, s, pos, mesh, cellCol: Array(n * n).fill(null) }; B.set(b.id, rec);
    if (b.nums) { const c = document.createElement('canvas'); c.width = c.height = 64 * n; const tex = new THREE.CanvasTexture(c); const pl = new THREE.Mesh(new THREE.PlaneGeometry(b.size, b.size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false }));
      pl.rotation.x = -Math.PI / 2; pl.position.set(b.cx, 0.075, b.cz); pl.renderOrder = 2; root.add(pl); rec.numCanvas = c; rec.numTex = tex; drawNums(rec, b.nums); } }
  function drawNums(bb, nums) { const c = bb.numCanvas, x = c.getContext('2d'), cs = c.width / bb.n; x.clearRect(0, 0, c.width, c.height); x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = 'white';
    nums.forEach((t, i) => { x.font = `700 ${String(t).length > 2 ? 18 : 30}px ui-monospace,monospace`; x.fillText(String(t), (i % bb.n + 0.5) * cs, (Math.floor(i / bb.n) + 0.5) * cs); }); bb.numTex.needsUpdate = true; bb.nums = nums; }
  function label(THREE, text) { const c = document.createElement('canvas'); c.width = 512; c.height = 64; const x = c.getContext('2d'); x.font = '600 34px ui-monospace,monospace'; x.fillStyle = 'white'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text.toUpperCase(), 256, 32);
    const tex = new THREE.CanvasTexture(c); const m = new THREE.Mesh(new THREE.PlaneGeometry(6, 0.75), new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: C.mut, toneMapped: false })); m.rotation.x = -Math.PI / 2; return m; }
  // piece geometry (shared)
  const G = { bar: new THREE.BoxGeometry(1, 0.14, 0.16), torus: new THREE.TorusGeometry(0.32, 0.075, 12, 32), cap: new THREE.CapsuleGeometry(0.28, 0.35, 4, 12), orb: new THREE.SphereGeometry(0.25, 20, 14), dot: new THREE.SphereGeometry(0.1, 10, 8) };
  const M = { cy: new THREE.MeshBasicMaterial({ color: C.cy, toneMapped: false }), hot: new THREE.MeshBasicMaterial({ color: C.hot, toneMapped: false }), ship: new THREE.MeshPhysicalMaterial({ color: C.cy, transmission: 0.85, ior: 1.5, thickness: 0.4, roughness: 0.05, clearcoat: 1, emissive: C.cy, emissiveIntensity: 0.3 }), mut: new THREE.MeshBasicMaterial({ color: C.mut }) };
  const marks = new Map();
  const makeMark = (b, c, k) => { const bb = B.get(b), [x, z] = bb.pos(c % bb.n, Math.floor(c / bb.n)), s = bb.s, g = new THREE.Group(); g.position.set(x, 0.12, z);
    if (k === 'x') for (const a of [1, -1]) { const m = new THREE.Mesh(G.bar, M.cy); m.scale.set(s * 0.95, 1, 1); m.rotation.y = a * Math.PI / 4; g.add(m); }
    if (k === 'o') { const m = new THREE.Mesh(G.torus, M.hot); m.rotation.x = Math.PI / 2; m.scale.setScalar(s * 1.05); g.add(m); }
    if (k === 'ship') { const m = new THREE.Mesh(G.cap, M.ship); m.rotation.z = Math.PI / 2; m.scale.setScalar(s * 1.1); g.add(m); }
    if (k === 'hit') { const m = new THREE.Mesh(G.orb, M.hot); m.scale.setScalar(s * 1.2); m.position.y = 0.2; g.add(m); }
    if (k === 'daub') { const m = new THREE.Mesh(G.torus, M.hot); m.rotation.x = Math.PI / 2; m.scale.set(s * 1.25, s * 1.25, 0.5); m.position.y = -0.02; g.add(m); }
    if (k === 'miss') { const m = new THREE.Mesh(G.dot, M.mut); m.scale.setScalar(s * 1.4); g.add(m); }
    g.userData.spawn = performance.now(); g.scale.setScalar(0.01); root.add(g); return g; };
  let hover = null;
  const set = ({ marks: mk = [], hl = {}, glow = {} } = {}) => { const want = new Set();
    for (const { b, c, k } of mk) { const key = `${b}:${c}:${k}`; want.add(key); if (!marks.has(key)) marks.set(key, makeMark(b, c, k)); }
    for (const [key, g] of marks) if (!want.has(key)) { root.remove(g); marks.delete(key); }
    for (const bb of B.values()) { const hs = new Set(hl[bb.id] || []), gs = new Set(glow[bb.id] || []); let dirty = false;
      for (let i = 0; i < bb.n * bb.n; i++) { const col = hover && hover.b === bb.id && hover.c === i ? 'hover' : hs.has(i) ? 'hot' : gs.has(i) ? 'acid' : null; if (bb.cellCol[i] === col) continue; bb.cellCol[i] = col; dirty = true;
        const cc = col === 'hover' ? C.hot.clone().multiplyScalar(0.55) : col === 'hot' ? C.hot : col === 'acid' ? C.acid.clone().multiplyScalar(0.45) : C.bg2; bb.mesh.setColorAt(i, cc); }
      if (dirty) bb.mesh.instanceColor.needsUpdate = true; } };
  let last = {}; const reset = o => { last = o; set(o); };
  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2(), meshes = [...B.values()].map(b => b.mesh);
  const pickAt = (cx, cy) => { const r = canvas.getBoundingClientRect(); v2.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(v2, S.cam); const h = ray.intersectObjects(meshes, false)[0]; return h ? { b: h.object.userData.board, c: h.instanceId } : null; };
  const cellScreen = (b, c) => { const bb = B.get(b), [x, z] = bb.pos(c % bb.n, Math.floor(c / bb.n)), p = new THREE.Vector3(x, 0.06, z).project(S.cam), r = canvas.getBoundingClientRect(); return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }; };
  let O = null;
  if (orbitOn) { O = orbit(S, canvas, { R, tilt, min: R * 0.6, max: R * 1.7 }); O.onTap(e => { const h = pickAt(e.clientX, e.clientY); if (h) onPick(h.b, h.c); }); }
  else { canvas.style.touchAction = 'none'; canvas.addEventListener('click', e => { const h = pickAt(e.clientX, e.clientY); if (h) onPick(h.b, h.c); }); S.cam.position.set(0, R * Math.sin(tilt), R * Math.cos(tilt)); S.cam.lookAt(0, 0, 0); }
  canvas.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse' && !e.buttons) return; const h = pickAt(e.clientX, e.clientY); if ((h?.b + ':' + h?.c) !== (hover?.b + ':' + hover?.c)) { hover = h; set(last); } });
  canvas.addEventListener('pointerleave', () => { hover = null; set(last); });
  canvas.addEventListener('pointerdown', e => { const h = pickAt(e.clientX, e.clientY); hover = h; set(last); }); // press feedback
  let lt = performance.now(); S.onTick(t => { const dt = Math.min(0.05, (t - lt) / 1000); lt = t; O?.tick(dt); S.cam.updateMatrixWorld();
    for (const g of marks.values()) { const a = Math.min(1, (t - g.userData.spawn) / 220); g.scale.setScalar(a < 1 ? 0.01 + a * (1 + 0.25 * Math.sin(a * Math.PI)) : 1); }
    root.position.y = S.reduced ? 0 : Math.sin(t / 2400) * 0.05; });
  const view = { set: reset, setNums: (b, nums) => { const bb = B.get(b); if (bb?.numCanvas && String(nums) !== String(bb.nums)) drawNums(bb, nums); }, pickAt, cellScreen, dispose: S.dispose, stage: S, get markCount() { return marks.size; } };
  if (O) view.freeze = () => { O.tick = () => {}; }; // tests: stop idle auto-orbit
  globalThis.__cmGrid = view; return view;
}
