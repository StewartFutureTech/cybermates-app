// 3D TRON vehicles for Mass Arena Tron + Tron Duel. Procedural models: sleek LIGHT-CYCLE (default) or STAR FIGHTER, picked
// in game settings (localStorage 'cm.arc.vehicle'). Glossy dark hull (MeshPhysicalMaterial clearcoat) + emissive panel
// lines in the player's colour; trails are continuous glowing RIBBONS following the free-steered path (additive, bloomed);
// claimed land = the true captured polygons (ShapeGeometry, later claims on top) with glowing outlines. Lagged chase camera,
// tick interpolation, banking into turns, particles + camera shake on cuts/claims/deaths. Colours: each player's APP THEME,
// clashes auto hue-shifted + outlined (fx.js distinctColors). Shared stage/bloom/fallback (three-scene.js).
import { stage } from './three-scene.js';
import { swatch } from './fx.js';
import { particles, shaker, chase, groundPoint, yawOf } from './feel3d.js';
export const VEHICLES = ['bike', 'fighter'];
export const vehicle = () => (VEHICLES.includes(globalThis.localStorage?.getItem('cm.arc.vehicle')) ? localStorage.getItem('cm.arc.vehicle') : 'bike');
export const setVehicle = v => VEHICLES.includes(v) && localStorage.setItem('cm.arc.vehicle', v);
function hull(S, kind, color, outline) { const THREE = S.THREE;
  const g = new THREE.Group(), dark = new THREE.MeshPhysicalMaterial({ metalness: 0.8, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.05 }), glowM = new THREE.MeshBasicMaterial({ color }); S.tint(dark.color, 'hull'); // glossy dark hull from the theme
  const line = (w, h, d, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glowM); m.position.set(x, y, z); g.add(m); };
  if (kind === 'bike') { // two glowing wheels, wedge body, canopy
    for (const z of [-0.55, 0.55]) { const w = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.08, 12, 32), dark); w.position.set(0, 0.3, z); w.rotation.y = Math.PI / 2; g.add(w); const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.02, 6, 32), glowM); rim.position.copy(w.position); rim.rotation.y = Math.PI / 2; g.add(rim); }
    const s = new THREE.Shape(); [[-0.75, 0.22], [0.7, 0.2], [0.55, 0.52], [0.05, 0.68], [-0.55, 0.5]].forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y));
    const body = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.28, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 }), dark); body.geometry.translate(0, 0, -0.14); body.rotation.y = -Math.PI / 2; g.add(body);
    line(0.3, 0.02, 1.2, 0.0, 0.5, 0); line(0.02, 0.18, 0.9, 0.17, 0.38, 0); line(0.02, 0.18, 0.9, -0.17, 0.38, 0); }
  else { // star fighter: fuselage cone, swept wings, twin engines
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.5, 6), dark); f.rotation.x = -Math.PI / 2; f.position.y = 0.5; g.add(f);
    const ws = new THREE.Shape(); ws.moveTo(0, 0.4); ws.lineTo(0.95, -0.45); ws.lineTo(0.95, -0.6); ws.lineTo(0, -0.35); ws.lineTo(-0.95, -0.6); ws.lineTo(-0.95, -0.45);
    const wing = new THREE.Mesh(new THREE.ExtrudeGeometry(ws, { depth: 0.05, bevelEnabled: false }), dark); wing.rotation.x = -Math.PI / 2; wing.position.y = 0.45; g.add(wing);
    for (const x of [-0.3, 0.3]) { const e = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.4, 12), dark); e.rotation.x = Math.PI / 2; e.position.set(x, 0.48, 0.55); g.add(e); const n = new THREE.Mesh(new THREE.CircleGeometry(0.08, 16), glowM); n.position.set(x, 0.48, 0.76); g.add(n); }
    line(1.7, 0.02, 0.03, 0, 0.51, 0.45); line(0.03, 0.02, 1.2, 0, 0.62, -0.1); }
  if (outline) { const o = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.03, 6, 40), new THREE.MeshBasicMaterial()); S.tint(o.material.color, 'white'); o.rotation.x = Math.PI / 2; o.position.y = 0.05; g.add(o); } // clash outline ring
  g.userData.glow = glowM; return g; }
export async function tron3d(canvas) {
  const S = await stage(canvas, { bloom: 1.1 }); const { THREE, scene } = S, root = new THREE.Group(); scene.add(root);
  // floor grid: one mip-mapped, anisotropic repeating texture (anti-aliased at grazing angles, 1 draw call)
  const gc = document.createElement('canvas'); gc.width = gc.height = 64; const gx = gc.getContext('2d'); gx.strokeStyle = gx.fillStyle = swatch().white; gx.globalAlpha = 0.9; gx.lineWidth = 2; gx.strokeRect(0, 0, 64, 64); gx.globalAlpha = 0.25; gx.fillRect(31, 31, 2, 2);
  const gt = new THREE.CanvasTexture(gc); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(400, 400); gt.anisotropy = Math.min(8, S.renderer.capabilities.getMaxAnisotropy()); gt.colorSpace = THREE.SRGBColorSpace;
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ map: gt, transparent: true, opacity: 0.22, depthWrite: false })); grid.rotation.x = -Math.PI / 2; grid.position.set(0, -0.01, 0); S.tint(grid.material.color, 'cy'); root.add(grid);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial()); floor.rotation.x = -Math.PI / 2; floor.position.set(0, -0.03, 0); S.tint(floor.material.color, 'bg'); root.add(floor);
  const bikes = new Map(), ribbons = new Map(), lands = new Map(); const fx = particles(S, root), shake = shaker(S), cam = chase(S, canvas, { dist: 11, height: 4.5, ahead: 8 });
  const RCAP = 2400; let border = null, bsize = 0, W = null, cols = new Map(), meCode = null, tSet = 0, tickMs = 40, last = performance.now(), half = 0;
  const ribbon = color => { const g = new THREE.BufferGeometry(), pos = new Float32Array(RCAP * 2 * 3), idx = []; for (let i = 0; i < RCAP - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setIndex(idx); g.setDrawRange(0, 0);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); m.frustumCulled = false; root.add(m); return m; };
  function landMesh(poly, color) { const sh = new THREE.Shape(poly.pts.map(([x, y]) => new THREE.Vector2(x - half, -(y - half)))); const grp = new THREE.Group();
    const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.3, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = 0.005 + (poly.id % 50) * 0.0004; m.renderOrder = 1 + (poly.id % 1000); grp.add(m);
    const lg = new THREE.BufferGeometry().setFromPoints(poly.pts.concat([poly.pts[0]]).map(([x, y]) => new THREE.Vector3(x - half, 0.03, y - half))); const ln = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.9 })); grp.add(ln);
    grp.userData = { m, ln, o: poly.o }; root.add(grp); return grp; }
  // world: engine World (tron), colors: [{code,color,outline}], me: my code. Cell = 1 unit.
  function set(world, colors, me) { W = world; cols = new Map(colors.map(c => [c.code, c])); meCode = me; tSet = performance.now(); tickMs = world.tickMs || 40; half = world.size / 2; const kind = vehicle();
    if (bsize !== world.size) { if (border) root.remove(border); const n = world.size, h = n / 2; border = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-h, -h], [h, -h], [h, h], [-h, h]].map(([x, z]) => new THREE.Vector3(x, 0.05, z))), new THREE.LineBasicMaterial()); S.tint(border.material.color, 'hot'); root.add(border); bsize = n;
      for (const g of lands.values()) root.remove(g); lands.clear(); }
    for (const [code, b] of bikes) if (!world.players.has(code) || b.userData.kind !== kind) { root.remove(b); bikes.delete(code); }
    for (const [code, r] of ribbons) if (!world.players.has(code)) { root.remove(r); ribbons.delete(code); }
    for (const p of world.players.values()) { const c = cols.get(p.code) || { color: swatch().cy }; let b = bikes.get(p.code); if (!b) { b = hull(S, kind, new THREE.Color(c.color), c.outline); b.userData.kind = kind; root.add(b); bikes.set(p.code, b); }
      b.userData.glow.color.set(c.color); b.visible = p.alive; if (!ribbons.has(p.code)) ribbons.set(p.code, ribbon(c.color)); ribbons.get(p.code).material.color.set(c.color); }
    const ids = new Set(); for (const poly of world.polys || []) { ids.add(poly.id); if (!lands.has(poly.id)) lands.set(poly.id, landMesh(poly, cols.get(poly.o)?.color || swatch().cy)); else { const g = lands.get(poly.id), cc = cols.get(poly.o)?.color; if (cc) { g.userData.m.material.color.set(cc); g.userData.ln.material.color.set(cc); } } }
    for (const [id, g] of lands) if (!ids.has(id)) { g.traverse(o => o.geometry?.dispose?.()); root.remove(g); lands.delete(id); } }
  function events(evs) { if (!W) return; for (const e of evs) { const p = W.players.get(e.who), x = e.x ?? p?.x, y = e.y ?? p?.y; if (x == null) continue; const c = cols.get(e.who)?.color || swatch().cy, X = x - half, Z = y - half;
      if (e.t === 'claim') { fx.burst(X, 0.3, Z, c, 40, 3); if (e.who === meCode) shake.kick(0.2); } else if (e.t === 'cut') { fx.burst(X, 0.5, Z, cols.get(e.victim)?.color || c, 40, 5); if (e.who === meCode) shake.kick(0.35); }
      else if (e.t === 'kill') { fx.burst(X, 0.5, Z, c, 70, 7); if (e.who === meCode) shake.kick(1); } } }
  const pos = (p, a) => [(p.px ?? p.x) + (p.x - (p.px ?? p.x)) * a - half, (p.py ?? p.y) + (p.y - (p.py ?? p.y)) * a - half];
  S.onTick(t => { const dt = Math.min(0.05, (t - last) / 1000); last = t; if (!W) return; const a = Math.min(1, (t - tSet) / tickMs);
    for (const p of W.players.values()) { const b = bikes.get(p.code), r = ribbons.get(p.code); if (!b || !r) continue; const [X, Z] = pos(p, a);
      b.position.set(X, 0, Z); const yaw = yawOf(p.h ?? 0), prev = b.userData.yaw ?? yaw; let dy = yaw - prev; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); b.userData.yaw = prev + dy * Math.min(1, dt * 18); b.rotation.set(0, b.userData.yaw, 0);
      b.userData.bank = (b.userData.bank || 0) + ((-dy * 6) - (b.userData.bank || 0)) * Math.min(1, dt * 8); b.rotation.z = Math.max(-0.5, Math.min(0.5, b.userData.bank)); // lean into turns
      const tr = p.alive ? (p.trail || []) : [], from = Math.max(0, tr.length - (RCAP - 1)), P = r.geometry.attributes.position.array; let k = 0;
      for (let i = from; i < tr.length; i++) { const x = tr[i][0] - half, z = tr[i][1] - half; P.set([x, 0, z, x, 0.85, z], k); k += 6; }
      if (tr.length) { P.set([X, 0, Z, X, 0.85, Z], k); k += 6; }
      const nv = k / 3; r.geometry.setDrawRange(0, Math.max(0, (nv / 2 - 1) * 6)); r.geometry.attributes.position.needsUpdate = true; r.visible = nv >= 4; }
    const me = W.players.get(meCode); if (me) { const [X, Z] = pos(me, a); cam.update(X, Z, me.h ?? 0, dt); } shake.apply(S.cam, dt); fx.tick(dt);
    grid.material.opacity = S.reduced ? 0.2 : 0.14 + 0.06 * Math.sin(t / 1500); });
  // pointer -> target heading: angle from my vehicle to the touched ground point
  const aimAt = (cx, cy) => { const g = groundPoint(S, canvas, cx, cy), me = W?.players.get(meCode); if (!g || !me) return null; return Math.atan2(g[1] - (me.y - half), g[0] - (me.x - half)); };
  return { set, events, aimAt, dispose: S.dispose, stage: S };
}
