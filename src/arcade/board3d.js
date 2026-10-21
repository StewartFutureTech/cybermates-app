// 3D CHESS + CHECKERS board (three.js, lazy-loaded via three-scene.js; 2D glow fallback lives in match-ui.js).
//  Pieces: procedural Staunton silhouettes (LatheGeometry profiles; knight = extruded head on a lathe base); checkers =
//  lathe discs, kings stacked two-high with a glowing crown ring. Material: MeshPhysicalMaterial glass — transmission 1,
//  ior 1.5, thickness, slight theme tint; white/red side = clear glass, black side = smoked glass; fresnel rim via an
//  additive back-face shell in the theme colour. Board: Tron grid lines that pulse slowly + procedural cyber texture in
//  the squares, floating over the starfield. Bloom from the shared stage. Smooth orbit + tilt, move tween, capture shatter.
//  Reduced motion: no pulse, no orbit (static camera), moves snap quickly.
import { stage, themeColor } from './three-scene.js';
import { swatch, mixHex, onThemeChange } from './fx.js';
const sqPos = i => [(i & 7) - 3.5, (i >> 3) - 3.5];
const PROFILES = { // [radius, height] pairs, bottom -> top (unit ≈ one square)
  p: [[.32, 0], [.32, .06], [.22, .12], [.14, .32], [.11, .42], [.17, .46], [.1, .5], [.15, .58], [.16, .66], [.1, .74], [0, .77]],
  r: [[.34, 0], [.34, .07], [.25, .14], [.2, .5], [.27, .56], [.27, .74], [.21, .74], [.21, .68], [0, .68]],
  b: [[.33, 0], [.33, .07], [.23, .13], [.14, .48], [.21, .52], [.12, .56], [.17, .7], [.13, .82], [.04, .9], [.06, .94], [0, .96]],
  q: [[.36, 0], [.36, .07], [.26, .14], [.15, .58], [.24, .62], [.14, .66], [.21, .9], [.15, .94], [.06, .98], [.07, 1.02], [0, 1.04]],
  k: [[.37, 0], [.37, .07], [.27, .14], [.16, .62], [.25, .66], [.15, .7], [.21, .96], [.12, 1], [0, 1.02]],
  n: [[.34, 0], [.34, .07], [.24, .13], [.2, .3], [0, .3]],
  c: [[.38, 0], [.4, .03], [.4, .09], [.36, .12], [.2, .12], [.2, .1], [0, .1]] }; // checker disc
export async function board3d(canvas, { game = 'chess', onPick = () => {} } = {}) {
  const S = await stage(canvas, { bloom: 0.85 }); const { THREE, scene, cam } = S, tint = themeColor(THREE, '--cy'), hot = themeColor(THREE, '--hot');
  const root = new THREE.Group(); scene.add(root);
  // --- board: cyber texture squares + glowing grid lines
  const tc = document.createElement('canvas'); tc.width = tc.height = 512; const g = tc.getContext('2d');
  const paintTex = sw => { g.fillStyle = sw.bg; g.fillRect(0, 0, 512, 512); // cyber texture from the theme tokens
    for (let i = 0; i < 64; i++) { const x = (i & 7) * 64, y = (i >> 3) * 64, dark = ((i & 7) + (i >> 3)) % 2; g.fillStyle = dark ? mixHex(sw.bg, sw.cy, 0.07) : mixHex(sw.bg2, sw.hot, 0.08); g.fillRect(x, y, 64, 64); g.strokeStyle = dark ? sw.cy : sw.hot; g.globalAlpha = 0.12; g.lineWidth = 1;
      for (let k = 0; k < 4; k++) { const a = (i * 37 + k * 13) % 48 + 8; g.beginPath(); g.moveTo(x + a, y + 6); g.lineTo(x + a, y + 30 + k * 6); g.lineTo(x + 58, y + 30 + k * 6); g.stroke(); } g.globalAlpha = 0.2; g.fillStyle = sw.cy; g.fillRect(x + 6, y + 56, 10, 2); g.globalAlpha = 1; } };
  paintTex(swatch());
  const tex = new THREE.CanvasTexture(tc); tex.colorSpace = THREE.SRGBColorSpace; const offT = onThemeChange(sw => { paintTex(sw); tex.needsUpdate = true; }); canvas.addEventListener('cm-dispose', offT);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.18, 8.4), new THREE.MeshStandardMaterial({ map: tex, metalness: 0.6, roughness: 0.35, emissiveIntensity: 0.6 })); S.tint(plate.material.emissive, sw => mixHex(sw.bg, sw.cy, 0.1)); plate.position.y = -0.09; root.add(plate);
  const lines = []; const lm = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9 }); S.tint(lm.color, 'cy');
  for (let k = 0; k <= 8; k++) for (const ax of [0, 1]) { const m = new THREE.Mesh(new THREE.BoxGeometry(ax ? 0.025 : 8.05, 0.02, ax ? 8.05 : 0.025), lm); m.position.set(ax ? k - 4 : 0, 0.005, ax ? 0 : k - 4); root.add(m); lines.push(m); }
  const edge = new THREE.Mesh(new THREE.TorusGeometry(5.9, 0.03, 6, 4), new THREE.MeshBasicMaterial()); S.tint(edge.material.color, 'hot'); edge.rotation.set(Math.PI / 2, 0, Math.PI / 4); edge.position.y = -0.1; root.add(edge);
  // --- glass materials
  const glass = smoked => { const m = new THREE.MeshPhysicalMaterial({ transmission: 1, ior: 1.5, thickness: 0.6, roughness: smoked ? 0.12 : 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, attenuationDistance: smoked ? 0.35 : 2.5, envMapIntensity: 1.2 });
    S.tint(m.color, smoked ? 'smoke' : 'glass'); S.tint(m.attenuationColor, sw => smoked ? mixHex(sw.bg, sw.bg2, 0.5) : mixHex(sw.cy, sw.fg, 0.7)); return m; }; // clear vs smoked glass, theme-tinted
  const rimMat = c => new THREE.ShaderMaterial({ uniforms: { c: { value: c }, p: { value: 1 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
    vertexShader: 'varying vec3 n; varying vec3 v; void main(){ vec4 mv = modelViewMatrix * vec4(position*1.04,1.); n = normalize(normalMatrix*normal); v = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 c; uniform float p; varying vec3 n; varying vec3 v; void main(){ float f = pow(1. - abs(dot(n, v)), 2.2); gl_FragColor = vec4(c * f * 1.6 * p, f); }' });
  const MAT = { w: glass(false), b: glass(true) }, RIM = { w: rimMat(tint), b: rimMat(hot) }, geoCache = {};
  const lathe = k => geoCache[k] ||= new THREE.LatheGeometry(PROFILES[k].map(([r, h]) => new THREE.Vector2(r, h)), 40);
  const knightHead = () => geoCache.nh ||= (() => { const s = new THREE.Shape(); [[-.16, 0], [.2, 0], [.22, .22], [.12, .42], [.2, .52], [.08, .66], [-.06, .7], [-.24, .52], [-.26, .42], [-.1, .38], [-.16, .2]].forEach(([x, y], i) => i ? s.lineTo(x, y) : s.moveTo(x, y)); const gg = new THREE.ExtrudeGeometry(s, { depth: .16, bevelEnabled: true, bevelThickness: .04, bevelSize: .03, bevelSegments: 3 }); gg.translate(0, .28, -.08); return gg; })();
  function makePiece(code) { const side = game === 'chess' ? (code === code.toUpperCase() ? 'w' : 'b') : (code.toLowerCase() === 'r' ? 'w' : 'b'), t = code.toLowerCase(), grp = new THREE.Group();
    const add = gg => { const m = new THREE.Mesh(gg, MAT[side]); grp.add(m); grp.add(new THREE.Mesh(gg, RIM[side])); return m; };
    if (game === 'chess') { add(lathe(t === 'n' ? 'n' : t)); if (t === 'n') { const h = add(knightHead()); h.rotation.y = side === 'w' ? Math.PI / 2 : -Math.PI / 2; } if (t === 'k') { const cr = new THREE.BoxGeometry(.05, .2, .05), cb = new THREE.BoxGeometry(.16, .05, .05); add(cr).position.y = 1.1; add(cb).position.y = 1.12; } }
    else { add(lathe('c')); if (code === code.toUpperCase()) { add(lathe('c')).position.y = .13; const crown = new THREE.Mesh(new THREE.TorusGeometry(.26, .025, 8, 40), new THREE.MeshBasicMaterial()); crown.rotation.x = Math.PI / 2; crown.position.y = .28; grp.add(crown); grp.userData.crown = crown; } }
    grp.userData.code = code; return grp; }
  // --- highlights
  const hi = new THREE.Group(); root.add(hi); const hiMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: .5 }); S.tint(hiMat.color, 'hot');
  // --- pieces diff + tweens + shatter
  let meshes = new Map(); const tweens = [], shards = [];
  const shatter = (grp) => { const [x, z] = [grp.position.x, grp.position.z], col = grp.userData.code === grp.userData.code.toUpperCase() ? tint : hot; root.remove(grp);
    for (let i = 0; i < (S.reduced ? 0 : 26); i++) { const m = new THREE.Mesh(new THREE.TetrahedronGeometry(.04 + Math.random() * .05), new THREE.MeshBasicMaterial({ color: col.clone(), transparent: true })); m.position.set(x, .2 + Math.random() * .5, z); m.userData.v = new THREE.Vector3((Math.random() - .5) * .08, .04 + Math.random() * .06, (Math.random() - .5) * .08); m.userData.life = 1; root.add(m); shards.push(m); } };
  function set(board, { highlight = [] } = {}) { const next = new Map(), old = new Map(meshes), free = [];
    for (let i = 0; i < 64; i++) { const c = board[i]; if (!c) continue; const m = old.get(i); if (m && m.userData.code === c) { next.set(i, m); old.delete(i); } }
    for (const [i, m] of old) if (!board[i] || board[i] !== m.userData.code) free.push([i, m]);
    for (let i = 0; i < 64; i++) { const c = board[i]; if (!c || next.has(i)) continue; const k = free.findIndex(([, m]) => m.userData.code === c || (game === 'checkers' && m.userData.code.toLowerCase() === c.toLowerCase()) || (game === 'chess' && m.userData.code.toLowerCase() === 'p' && (c === c.toUpperCase()) === (m.userData.code === 'P')));
      let m; if (k >= 0 && free[k][1].userData.code === c) { m = free.splice(k, 1)[0][1]; } else { if (k >= 0) { root.remove(free[k][1]); free.splice(k, 1); } m = makePiece(c); const [x, z] = sqPos(i); m.position.set(x, 0, z); root.add(m); }
      const [x, z] = sqPos(i); tweens.push({ m, from: m.position.clone(), to: new THREE.Vector3(x, 0, z), t: 0 }); next.set(i, m); }
    for (const [, m] of free) shatter(m); meshes = next;
    hi.clear(); for (const i of highlight) { const [x, z] = sqPos(i); const h = new THREE.Mesh(new THREE.PlaneGeometry(.92, .92), hiMat); h.rotation.x = -Math.PI / 2; h.position.set(x, .012, z); hi.add(h); } }
  // --- camera orbit + tilt (smooth), pulse
  let az = 0, tilt = 0.95, want = { az: 0, tilt: 0.95 }; const R = 10.5;
  canvas.addEventListener('pointerdown', e => { const x0 = e.clientX, y0 = e.clientY, a0 = want.az, t0 = want.tilt; let moved = false;
    const mv = ev => { const dx = ev.clientX - x0, dy = ev.clientY - y0; if (Math.abs(dx) + Math.abs(dy) > 6) moved = true; want.az = a0 - dx * 0.008; want.tilt = Math.min(1.35, Math.max(0.45, t0 + dy * 0.006)); };
    const up = ev => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (!moved) pick(ev); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); });
  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2();
  function pick(ev) { const b = canvas.getBoundingClientRect(); v2.set(((ev.clientX - b.left) / b.width) * 2 - 1, -((ev.clientY - b.top) / b.height) * 2 + 1); ray.setFromCamera(v2, cam); const h = ray.intersectObject(plate)[0]; if (!h) return; const c = Math.floor(h.point.x + 4), r = Math.floor(h.point.z + 4); if (c >= 0 && c < 8 && r >= 0 && r < 8) onPick(r * 8 + c); }
  let last = performance.now();
  S.onTick(t => { const dt = Math.min(0.05, (t - last) / 1000); last = t; if (!S.reduced) want.az += dt * 0.04; // slow idle orbit
    az += (want.az - az) * 0.08; tilt += (want.tilt - tilt) * 0.08; cam.position.set(Math.sin(az) * R * Math.cos(tilt), R * Math.sin(tilt), Math.cos(az) * R * Math.cos(tilt)); cam.lookAt(0, 0, 0);
    const p = S.reduced ? 0.85 : 0.65 + 0.35 * Math.sin(t / 1600); lm.opacity = p; for (const k of ['w', 'b']) RIM[k].uniforms.p.value = 0.7 + 0.3 * p;
    for (const tw of tweens) { tw.t = Math.min(1, tw.t + dt * (S.reduced ? 20 : 3.2)); const e = tw.t < .5 ? 2 * tw.t * tw.t : 1 - (-2 * tw.t + 2) ** 2 / 2; tw.m.position.lerpVectors(tw.from, tw.to, e); tw.m.position.y = Math.sin(e * Math.PI) * 0.6 * tw.from.distanceTo(tw.to) / 4; }
    for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].t >= 1) tweens.splice(i, 1);
    for (const m of meshes.values()) if (m.userData.crown) m.userData.crown.material.color.copy(crownC).multiplyScalar(0.8 + 0.35 * p);
    for (let i = shards.length - 1; i >= 0; i--) { const s = shards[i]; s.position.add(s.userData.v); s.userData.v.y -= 0.004; s.rotation.x += .2; s.rotation.y += .15; s.userData.life -= dt * 1.2; s.material.opacity = Math.max(0, s.userData.life); if (s.userData.life <= 0) { root.remove(s); shards.splice(i, 1); } } });
  return { set, dispose: S.dispose, stage: S, shatterTest: () => shards.length };
}
