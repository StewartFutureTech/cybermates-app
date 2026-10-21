// 3D view for BRAWL: neon glass fighters (transmissive capsules + emissive rim rings) over a glass arena backplane with a
// theme-tinted grid, glowing energy balls, beam cylinders, teleport SPEED LINES, punch/KO flash rings and SCREEN SHAKE.
// Bloom via the shared stage (three-scene.js). All colours come from the theme palette / player colours (no literals).
// Camera faces the arena plane head-on so screen -> arena mapping stays linear (taps land where you touch).
// Reduced motion: no shake, no speed lines, no idle bob.
import { stage } from './three-scene.js';
import { Wd, Hd, FULL, BEAM_W } from './games/brawl.js';
const K = 0.1, AW = Wd * K, AH = Hd * K, X = x => x * K - AW / 2, Y = y => AH / 2 - y * K;
export async function brawl3d(canvas, { colors = [] } = {}) {
  const S = await stage(canvas, { bloom: 0.85 }); const { THREE, scene, cam } = S, root = new THREE.Group(); scene.add(root);
  const fov = 45; cam.fov = fov; cam.aspect = AW / AH; const D = (AH / 2) / Math.tan(fov * Math.PI / 360) * 1.04; cam.position.set(0, 0, D); cam.lookAt(0, 0, 0); cam.updateProjectionMatrix();
  const plate = new THREE.Mesh(new THREE.BoxGeometry(AW, AH, 0.2), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.94 })); plate.position.z = -0.6; S.tint(plate.material.color, 'bg'); root.add(plate);
  const gridM = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.22 }); S.tint(gridM.color, 'line');
  for (let x = 0; x <= Wd; x += 20) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.02, AH), gridM); m.position.set(X(x), 0, -0.49); root.add(m); }
  for (let y = 0; y <= Hd; y += 20) { const m = new THREE.Mesh(new THREE.PlaneGeometry(AW, 0.02), gridM); m.position.set(0, Y(y), -0.49); root.add(m); }
  const edgeM = new THREE.MeshBasicMaterial(); S.tint(edgeM.color, 'cy'); for (const [w, h, x, y] of [[AW, .06, 0, AH / 2], [AW, .06, 0, -AH / 2], [.06, AH, -AW / 2, 0], [.06, AH, AW / 2, 0]]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), edgeM); m.position.set(x, y, -0.45); root.add(m); }
  const col = i => new THREE.Color(colors[i] || S.color('cy').getStyle());
  const fighters = colors.map((c, i) => { const g = new THREE.Group(), cc = col(i);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.5, 6, 18), new THREE.MeshPhysicalMaterial({ color: cc, emissive: cc, emissiveIntensity: 0.45, transmission: 0.6, ior: 1.5, thickness: 0.4, roughness: 0.05, clearcoat: 1 }));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 40), new THREE.MeshBasicMaterial({ color: cc })); ring.rotation.x = Math.PI / 2.4;
    const aura = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), new THREE.MeshBasicMaterial({ color: cc, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshBasicMaterial({ color: cc })); fist.visible = false;
    g.add(body, ring, aura, fist); root.add(g); return { g, body, ring, aura, fist, cc }; });
  const pool = (mk) => { const a = []; return n => { while (a.length < n) a.push(mk()); a.forEach((m, i) => m.visible = i < n); return a; }; };
  const balls = pool(() => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); root.add(m); return m; });
  const beams = pool(() => { const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 18, 1, true), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })); root.add(m); return m; });
  const fx = []; const lineM = c => new THREE.LineBasicMaterial({ color: c, transparent: true, blending: THREE.AdditiveBlending });
  const speedLines = (x0, y0, x1, y1, c) => { if (S.reduced) return; for (let i = 0; i < 7; i++) { const o = (i - 3) * 0.07, nx = -(y1 - y0), ny = x1 - x0, L = Math.hypot(nx, ny) || 1;
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(X(x0) + nx / L * o, Y(y0) - ny / L * o, 0), new THREE.Vector3(X(x1) + nx / L * o, Y(y1) - ny / L * o, 0)]); const l = new THREE.Line(g, lineM(c)); l.userData.life = 1; root.add(l); fx.push(l); } };
  const flash = (x, y, c, r = 0.6) => { const m = new THREE.Mesh(new THREE.RingGeometry(0.05, r, 32), new THREE.MeshBasicMaterial({ color: c, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); m.position.set(X(x), Y(y), 0.1); m.userData.life = 1; m.userData.grow = 1; root.add(m); fx.push(m); };
  let shake = 0, seen = new Set(), t0 = 0;
  S.onTick(t => { const dt = Math.min(0.05, (t - (t0 || t)) / 1000); t0 = t;
    for (let i = fx.length - 1; i >= 0; i--) { const m = fx[i]; m.userData.life -= dt * 2.5; m.material.opacity = Math.max(0, m.userData.life); if (m.userData.grow) m.scale.setScalar(1 + (1 - m.userData.life) * 0.8); if (m.material.opacity !== undefined && m.userData.grow) m.material.opacity *= 0.6; if (m.userData.life <= 0) { root.remove(m); m.geometry.dispose(); m.material.dispose(); fx.splice(i, 1); } }
    if (!S.reduced && shake > 0) { cam.position.x = (Math.random() - 0.5) * shake; cam.position.y = (Math.random() - 0.5) * shake; shake *= 0.86; if (shake < 0.005) { shake = 0; cam.position.x = cam.position.y = 0; } } });
  function set(st) {
    st.f.forEach((p, i) => { const F = fighters[i]; if (!F) return; const bob = S.reduced ? 0 : Math.sin(st.tick / 6 + i) * 0.04; F.g.position.set(X(p.x), Y(p.y) + bob, 0);
      F.body.material.opacity = p.shield > 0 && st.tick % 6 < 3 ? 0.45 : 1; F.body.material.transparent = true; F.ring.rotation.z += 0.05;
      F.aura.material.opacity = p.charging ? 0.05 + 0.22 * p.charge / FULL : 0; F.aura.scale.setScalar(0.8 + (p.charging ? p.charge / FULL : 0) * 0.6);
      F.fist.visible = p.fx?.k === 'punch' && st.tick - p.fx.t < 5; if (F.fist.visible) { const q = st.f[p.fx.to]; F.fist.position.set(Math.sign(q.x - p.x) * 0.45, Math.sign(p.y - q.y) * 0.15, 0.1); }
      const key = p.fx && `${i}:${p.fx.k}:${p.fx.t}`; if (key && !seen.has(key)) { seen.add(key); if (p.fx.k === 'tp') speedLines(p.fx.from[0], p.fx.from[1], p.x, p.y, F.cc); if (p.fx.k === 'spawn') flash(p.x, p.y, F.cc, 0.7); if (p.fx.k === 'beam') shake = Math.max(shake, 0.12); } });
    const bs = balls(st.balls.length); st.balls.forEach((b, i) => { const m = bs[i]; m.position.set(X(b.x), Y(b.y), 0.05); m.scale.setScalar(b.r * K * 1.2); m.material.color.copy(fighters[b.own]?.cc || m.material.color); });
    const ms = beams(st.beams.length); st.beams.forEach((b, i) => { const m = ms[i], L = Math.hypot(Wd, Hd) * K; m.scale.set(BEAM_W * K * 0.3 * (0.6 + b.t / 20), L, BEAM_W * K * 0.3); const a = Math.atan2(-b.dy, b.dx); m.rotation.set(0, 0, a - Math.PI / 2); m.position.set(X(b.x) + Math.cos(a) * L / 2, Y(b.y) + Math.sin(a) * L / 2, 0.02); m.material.color.copy(fighters[b.own]?.cc || m.material.color); });
    for (const e of st.events) if (e.k === 'hit' || e.k === 'ko') { const v = st.f[e.vic], key = `e:${e.t}:${e.k}:${e.att}:${e.vic}`; if (seen.has(key)) continue; seen.add(key); flash(v.x, v.y, fighters[e.att]?.cc || fighters[e.vic].cc, e.k === 'ko' ? 0.9 : 0.45); shake = Math.max(shake, e.k === 'ko' ? 0.3 : Math.min(0.2, e.dmg / 120)); }
    if (seen.size > 600) seen = new Set([...seen].slice(-200)); }
  return { set, dispose: S.dispose, shake: () => shake };
}
