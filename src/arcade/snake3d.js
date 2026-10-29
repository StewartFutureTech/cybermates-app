// 3D SNAKE for the Mass Arena (and Snake Battle duels). Real models: each snake is a segmented GLOWING body (one shared
// InstancedMesh of glossy spheres, per-instance theme colour, tapering to the tail, every segment interpolated along the
// path between ticks) and a modelled HEAD (glossy dome, emissive brow stripe, two eyes with pupils that look where the snake
// is steering). Food = instanced glowing gems that bob. The world wraps, so everything is placed at wrapped offsets around my
// (interpolated) head; a lagged chase camera, particles, camera shake. Colours = each player's theme (fx.js distinctColors).
import { stage } from './three-scene.js';
import { swatch } from './fx.js';
import { particles, shaker, chase, groundPoint, yawOf, lerp } from './feel3d.js';
const MAXSEG = 9000, MAXFOOD = 2500, VIEW = 36;
const wd = (d, n) => (d > n / 2 ? d - n : d < -n / 2 ? d + n : d);
function head(S, color) { const { THREE } = S, g = new THREE.Group();
  const shell = new THREE.MeshPhysicalMaterial({ metalness: 0.55, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, emissive: new THREE.Color(color), emissiveIntensity: 0.55 }); shell.color.set(color);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), shell); dome.scale.set(1, 0.72, 1.25); dome.position.y = 0.42; g.add(dome);
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 12), shell); jaw.scale.set(0.95, 0.4, 1.05); jaw.position.set(0, 0.26, -0.18); g.add(jaw);
  const glowM = new THREE.MeshBasicMaterial({ color: new THREE.Color(color) }); const brow = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.06), glowM); brow.position.set(0, 0.66, -0.25); g.add(brow);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.9), glowM); stripe.position.set(0, 0.79, 0.12); g.add(stripe);
  const eyeW = new THREE.MeshBasicMaterial(), eyeP = new THREE.MeshBasicMaterial(); S.tint(eyeW.color, 'white'); S.tint(eyeP.color, 'bg'); const pupils = [];
  for (const x of [-0.22, 0.22]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), eyeW); e.position.set(x, 0.6, -0.36); g.add(e); const p = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), eyeP); p.position.set(x, 0.62, -0.47); g.add(p); pupils.push(p); }
  g.userData = { shell, glowM, pupils }; return g; }
export async function snake3d(canvas) {
  const S = await stage(canvas, { bloom: 1.0 }); const { THREE, scene } = S, root = new THREE.Group(); scene.add(root);
  // floor: repeating hex-ish grid texture tinted by the theme; scrolls with the wrapped world offset
  const gc = document.createElement('canvas'); gc.width = gc.height = 64; const gx = gc.getContext('2d'); gx.strokeStyle = swatch().white; gx.globalAlpha = 0.85; gx.lineWidth = 1.5; gx.strokeRect(0, 0, 64, 64); gx.globalAlpha = 0.3; gx.beginPath(); gx.arc(32, 32, 3, 0, 7); gx.stroke();
  const gt = new THREE.CanvasTexture(gc); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(60, 60); gt.anisotropy = Math.min(8, S.renderer.capabilities.getMaxAnisotropy()); gt.colorSpace = THREE.SRGBColorSpace;
  const floorM = new THREE.MeshBasicMaterial({ map: gt, transparent: true, opacity: 0.2, depthWrite: false }); S.tint(floorM.color, 'cy'); const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), floorM); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01; root.add(floor);
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshBasicMaterial()); S.tint(deck.material.color, 'bg'); deck.rotation.x = -Math.PI / 2; deck.position.y = -0.03; root.add(deck);
  const segM = new THREE.MeshPhysicalMaterial({ metalness: 0.4, roughness: 0.3, clearcoat: 1 }); segM.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance = vColor.rgb * 0.75;'); };
  const segs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.4, 14, 10), segM, MAXSEG); segs.instanceMatrix.setUsage(THREE.DynamicDrawUsage); segs.setColorAt(0, S.color('cy')); segs.count = 0; segs.frustumCulled = false; root.add(segs); // instanceColor allocated before the first compile
  const foodM = new THREE.MeshBasicMaterial(); S.tint(foodM.color, 'acid'); const food = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.2, 0), foodM, MAXFOOD); food.count = 0; food.frustumCulled = false; root.add(food);
  const fx = particles(S, root), shake = shaker(S), cam = chase(S, canvas, { dist: 8, height: 9, ahead: 4 }); const heads = new Map(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  let W = null, cols = new Map(), meCode = null, tSet = 0, tickMs = 40, last = performance.now(), origin = [0, 0];
  function set(world, colors, me) { W = world; cols = new Map(colors.map(c => [c.code, c])); meCode = me; tSet = performance.now(); tickMs = world.tickMs || 40;
    for (const [code, h] of heads) if (!world.players.has(code)) { root.remove(h); heads.delete(code); } }
  // feel hooks from the UI: engine events -> particles + shake
  function events(evs) { if (!W) return; const n = W.size; for (const e of evs) { const x = e.x ?? W.players.get(e.who)?.x, y = e.y ?? W.players.get(e.who)?.y; if (x == null) continue; const X = wd(x - origin[0], n), Z = wd(y - origin[1], n); if (Math.abs(X) > VIEW || Math.abs(Z) > VIEW) continue;
      const c = cols.get(e.who)?.color || swatch().cy; if (e.t === 'food') fx.burst(X, 0.3, Z, swatch().acid, 6, 2); else if (e.t === 'eat') { fx.burst(X, 0.4, Z, c, 30, 4); if (e.who === meCode) shake.kick(0.25); }
      else if (e.t === 'kill') { fx.burst(X, 0.5, Z, cols.get(e.who)?.color || c, 60, 6); if (e.who === meCode) shake.kick(0.9); else if (e.by === meCode) shake.kick(0.35); } } }
  S.onTick(t => { const dt = Math.min(0.05, (t - last) / 1000); last = t; if (!W) return; const n = W.size, a = Math.min(1, (t - tSet) / tickMs), me = W.players.get(meCode);
    const hx = me?.body?.length ? lerp(me.body[1]?.[0] ?? me.x, me.body[1] ? me.body[1][0] + wd(me.body[0][0] - me.body[1][0], n) : me.x, a) : (me?.x ?? 0), hy = me?.body?.length ? lerp(me.body[1]?.[1] ?? me.y, me.body[1] ? me.body[1][1] + wd(me.body[0][1] - me.body[1][1], n) : me.y, a) : (me?.y ?? 0);
    const ox = origin[0], oy = origin[1]; origin = [hx, hy]; const sdx = wd(hx - ox, n), sdz = wd(hy - oy, n); fx.shift(sdx, sdz); gt.offset.set(((hx / 4) % 1 + 1) % 1, ((-hy / 4) % 1 + 1) % 1);
    let k = 0; const seen = new Set();
    for (const p of W.players.values()) { if (!p.alive || !p.body?.length) continue; const c = cols.get(p.code)?.color || swatch().cy; col.set(c); const B = p.body, L = B.length, R = 0.32 + Math.min(0.5, L / 400);
      const X0 = wd(B[0][0] - hx, n), Z0 = wd(B[0][1] - hy, n); if (Math.abs(X0) > VIEW + L * 0.4 && Math.abs(Z0) > VIEW + L * 0.4) continue;
      for (let i = 1; i < L && k < MAXSEG; i += 2) { const p1 = B[i], p0 = B[i - 1]; const x = p1[0] + wd(p0[0] - p1[0], n) * a, y = p1[1] + wd(p0[1] - p1[1], n) * a; const X = wd(x - hx, n), Z = wd(y - hy, n); if (Math.abs(X) > VIEW || Math.abs(Z) > VIEW) continue;
        const taper = 1 - (i / L) * 0.55, s = R * taper * (1 + 0.08 * Math.sin(i * 0.5 - t / 160)); sc.set(s / 0.4, s / 0.4, s / 0.4); v3.set(X, s * 0.95, Z); q.identity(); m4.compose(v3, q, sc); segs.setMatrixAt(k, m4); col.set(c).multiplyScalar(0.55 + 0.45 * (1 - i / L)); segs.setColorAt(k, col); k++; }
      // head model
      let h = heads.get(p.code); if (!h) { h = head(S, c); root.add(h); heads.set(p.code, h); } seen.add(p.code); h.userData.shell.color.set(c); h.userData.shell.emissive.set(c); h.userData.glowM.color.set(c);
      const hb1 = B[1] || B[0], X = wd(hb1[0] + wd(B[0][0] - hb1[0], n) * a - hx, n), Z = wd(hb1[1] + wd(B[0][1] - hb1[1], n) * a - hy, n); h.position.set(X, 0, Z); h.rotation.y = yawOf(p.h ?? 0); const sH = (R / 0.4) * 1.35; h.scale.set(sH, sH, sH);
      const look = p.aim != null ? Math.max(-1, Math.min(1, Math.atan2(Math.sin(p.aim - p.h), Math.cos(p.aim - p.h)))) * 0.06 : 0; for (const pu of h.userData.pupils) pu.position.x = Math.sign(pu.position.x) * 0.22 + look; }
    for (const [code, h] of heads) h.visible = seen.has(code);
    segs.count = k; segs.instanceMatrix.needsUpdate = true; if (segs.instanceColor) segs.instanceColor.needsUpdate = true;
    let f = 0; for (const fd of W.food || []) { const X = wd(fd[0] - hx, n), Z = wd(fd[1] - hy, n); if (Math.abs(X) > VIEW || Math.abs(Z) > VIEW || f >= MAXFOOD) continue; v3.set(X, 0.3 + 0.08 * Math.sin(t / 300 + fd[0] * 3), Z); q.setFromAxisAngle(sc.set(0, 1, 0), t / 700 + fd[1]); m4.compose(v3, q, sc.set(1, 1, 1)); food.setMatrixAt(f++, m4); }
    food.count = f; food.instanceMatrix.needsUpdate = true;
    cam.update(0, 0, me?.h ?? 0, dt); shake.apply(S.cam, dt); fx.tick(dt); });
  // pointer -> target heading (world angle from my head to the touched ground point)
  const aimAt = (cx, cy) => { const g = groundPoint(S, canvas, cx, cy); return g ? Math.atan2(g[1], g[0]) : null; };
  return { set, events, aimAt, dispose: S.dispose, stage: S };
}
