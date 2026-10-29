// 3D DEEP SPACE for Mega Fleet (and Star Fleet's 3D option): shared starfield + bloom, NEBULA fog-of-war (theme-tinted
// sprites hide everything outside your vision/sensor pings), asteroid debris, procedural glass/neon STARSHIPS with emissive
// panel lines that grow from scout → corvette → frigate → cruiser → capital class (megaship lvl / size), plasma/torpedo
// STREAKS (additive, bloomed), and SENSOR-PING pulse rings for reveals. Every colour comes from the shared palette.
import { stage, orbit } from './three-scene.js';
import { swatch, mixHex } from './fx.js';
import { megaship } from './megaship.js';
export const CLASSES = ['scout', 'corvette', 'frigate', 'cruiser', 'capital'];
export const classOf = size => CLASSES[Math.min(CLASSES.length - 1, Math.max(0, size - 1))];
function starship(S, size, color) { const { THREE } = S, g = new THREE.Group(), k = 0.5 + size * 0.45;
  const hullM = new THREE.MeshPhysicalMaterial({ transmission: 0.7, ior: 1.5, thickness: 0.5, roughness: 0.06, clearcoat: 1, metalness: 0.2 }); S.tint(hullM.color, 'smoke');
  const glowM = new THREE.MeshBasicMaterial({ color }); const add = (geo, m = hullM) => { const x = new THREE.Mesh(geo, m); g.add(x); return x; };
  const body = add(new THREE.CylinderGeometry(0.12 * k, 0.3 * k, 1.6 * k, 6)); body.rotation.x = Math.PI / 2;
  const ws = new THREE.Shape(); ws.moveTo(0, 0.5 * k); ws.lineTo(0.9 * k, -0.4 * k); ws.lineTo(0.2 * k, -0.25 * k); ws.lineTo(-0.2 * k, -0.25 * k); ws.lineTo(-0.9 * k, -0.4 * k);
  const wing = add(new THREE.ExtrudeGeometry(ws, { depth: 0.04 * k, bevelEnabled: false })); wing.rotation.x = -Math.PI / 2;
  for (let i = 0; i < Math.min(5, size); i++) { const deck = add(new THREE.BoxGeometry(0.5 * k * (1 - i * 0.12), 0.08 * k, 0.3 * k)); deck.position.set(0, 0.1 * k + i * 0.08 * k, 0.1 * k - i * 0.18 * k); } // capital-class superstructure
  for (const x of [-0.45, 0.45]) { const ln = add(new THREE.BoxGeometry(0.02 * k, 0.02 * k, 1.1 * k), glowM); ln.position.set(x * k, 0.03 * k, -0.05 * k); } // emissive panel lines
  const eng = add(new THREE.CircleGeometry(0.14 * k, 16), glowM); eng.position.z = 0.81 * k;
  g.userData.glow = glowM; g.userData.size = size; return g; }
export async function space3d(canvas, { onTap = () => {} } = {}) {
  const S = await stage(canvas, { bloom: 1.15 }); const { THREE, scene } = S, root = new THREE.Group(); scene.add(root);
  // nebula texture (theme tinted), redrawn live with the palette
  const nc = document.createElement('canvas'); nc.width = nc.height = 256; const nx = nc.getContext('2d');
  const paint = sw => { nx.clearRect(0, 0, 256, 256); for (let i = 0; i < 14; i++) { const x = 40 + (i * 53) % 180, y = 40 + (i * 97) % 180, r = 50 + (i * 31) % 70, gr = nx.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, mixHex(i % 2 ? sw.hot : sw.cy, sw.bg, 0.45)); gr.addColorStop(1, sw.bg); nx.globalAlpha = 0.18; nx.fillStyle = gr; nx.fillRect(0, 0, 256, 256); } nx.globalAlpha = 1; };
  paint(swatch()); const ntex = new THREE.CanvasTexture(nc); const fogM = new THREE.MeshBasicMaterial({ map: ntex, transparent: true, opacity: 0.92, depthWrite: false });
  const fog = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fogM); fog.rotation.x = -Math.PI / 2; fog.position.y = 1.6; root.add(fog);
  const holeM = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { n: { value: 0 }, pts: { value: Array.from({ length: 24 }, () => new THREE.Vector3()) }, c: { value: S.color('bg') } }, // fog-of-war: opaque nebula except vision / ping circles
    vertexShader: 'varying vec3 wp; void main(){ vec4 w = modelMatrix*vec4(position,1.); wp = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: 'uniform int n; uniform vec3 pts[24]; uniform vec3 c; varying vec3 wp; void main(){ float a = 0.78; for(int i=0;i<24;i++){ if(i>=n) break; float d = distance(wp.xz, pts[i].xy); a = min(a, smoothstep(pts[i].z*0.8, pts[i].z, d)*0.78); } gl_FragColor = vec4(c, a); }' });
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), holeM); veil.rotation.x = -Math.PI / 2; veil.position.y = 1.5; root.add(veil);
  const astM = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.1, flatShading: true }); S.tint(astM.color, sw => mixHex(sw.mut, sw.bg, 0.5)); const asts = [];
  const ships = new Map(), streaks = new Map(), pings = new Map(); let half = 0, built = 0;
  const O = orbit(S, canvas, { R: 30, tilt: 1.0, min: 12, max: 70 }); let me = null;
  O.onTap(ev => { const b = canvas.getBoundingClientRect(), v = new THREE.Vector2(((ev.clientX - b.left) / b.width) * 2 - 1, -((ev.clientY - b.top) / b.height) * 2 + 1), ray = new THREE.Raycaster(); ray.setFromCamera(v, S.cam); const p = new THREE.Vector3(); if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p)) onTap(p.x + half, p.z + half); });
  function set(w, colors, myCode) { half = w.size / 2; me = w.players.get(myCode); fog.scale.set(w.size * 3, w.size * 3, 1); veil.scale.set(w.size * 3, w.size * 3, 1);
    if (built !== w.size) { for (const a of asts) root.remove(a); asts.length = 0; for (let i = 0; i < w.size * 1.2; i++) { const a = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2 + ((i * 37) % 10) / 12, 0), astM); a.position.set(((i * 71) % w.size) - half, -0.3, ((i * 113) % w.size) - half); a.rotation.set(i, i * 2, i * 3); root.add(a); asts.push(a); } built = w.size; }
    const cmap = new Map(colors.map(c => [c.code, c])), vis = new Set(megaship.visibleShips(w, myCode).map(p => p.code));
    for (const [c, s] of ships) if (!w.players.has(c)) { root.remove(s); ships.delete(c); }
    for (const p of w.players.values()) { let s = ships.get(p.code); const col = cmap.get(p.code)?.color || swatch().cy; if (s && s.userData.size !== p.size) { root.remove(s); s = null; } if (!s) { s = starship(S, p.size, new THREE.Color(col)); root.add(s); ships.set(p.code, s); }
      s.userData.glow.color.set(col); s.visible = p.alive && vis.has(p.code); s.userData.to = [p.x - half, p.y - half]; s.rotation.y = { up: 0, down: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[p.dir] ?? 0; }
    const pts = [...(me ? [[me.x, me.y, 7 + me.size]] : []), ...(w.reveals || []).map(r => [r.x, r.y, r.r])].slice(0, 24); holeM.uniforms.n.value = pts.length; pts.forEach(([x, y, r], i) => holeM.uniforms.pts.value[i].set(x - half, y - half, r));
    for (const r of w.reveals || []) { const k = r.x + ',' + r.y + ',' + r.until; if (!pings.has(k)) { const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.04, 6, 64), new THREE.MeshBasicMaterial({ color: S.color('acid').clone(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); m.rotation.x = Math.PI / 2; m.position.set(r.x - half, 0.2, r.y - half); m.userData = { r: r.r, life: 1 }; root.add(m); pings.set(k, m); } }
    for (const s of w.streaks || []) { const k = s.x1 + ',' + s.y1 + ',' + s.until + s.victim; if (s.victim !== myCode || streaks.has(k)) continue; const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(s.x0 - half, 0.5, s.y0 - half), new THREE.Vector3(s.x1 - half, 0.3, s.y1 - half)]);
      const m = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: S.color('hot').clone(), transparent: true, blending: THREE.AdditiveBlending })); m.userData.life = 1; root.add(m); streaks.set(k, m); } // incoming torpedo streak: direction only
    for (const sh of w.shells || []) { const k = 'sh' + sh.land + sh.x + sh.y; if (streaks.has(k)) continue; if (sh.from !== myCode) continue; const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(sh.sx - half, 0.4, sh.sy - half), new THREE.Vector3(sh.x - half, 0.3, sh.y - half)]); const m = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: S.color('cy').clone(), transparent: true, blending: THREE.AdditiveBlending })); m.userData.life = 1; root.add(m); streaks.set(k, m); } }
  let last = performance.now(), tgt = [0, 0];
  S.onTick(t => { const dt = Math.min(0.05, (t - last) / 1000); last = t; O.tick(dt); if (me) { tgt[0] += (me.x - half - tgt[0]) * 0.1; tgt[1] += (me.y - half - tgt[1]) * 0.1; } S.cam.position.x += tgt[0]; S.cam.position.z += tgt[1]; S.cam.lookAt(tgt[0], 0, tgt[1]);
    for (const s of ships.values()) { const [x, z] = s.userData.to || [0, 0]; if (Math.abs(s.position.x - x) > 4 || Math.abs(s.position.z - z) > 4) s.position.set(x, 0, z); else { s.position.x += (x - s.position.x) * 0.3; s.position.z += (z - s.position.z) * 0.3; } s.position.y = S.reduced ? 0 : Math.sin(t / 700 + x) * 0.08; }
    for (const a of asts) if (!S.reduced) a.rotation.y += dt * 0.2;
    for (const [k, m] of pings) { m.userData.life -= dt * 0.8; const e = 1 - m.userData.life; m.scale.setScalar(0.2 + e * m.userData.r); m.material.opacity = Math.max(0, m.userData.life); if (m.userData.life <= 0) { root.remove(m); pings.delete(k); } }
    for (const [k, m] of streaks) { m.userData.life -= dt * 1.2; m.material.opacity = Math.max(0, m.userData.life); if (m.userData.life <= 0) { root.remove(m); streaks.delete(k); } } });
  return { set, dispose: S.dispose, stage: S };
}
