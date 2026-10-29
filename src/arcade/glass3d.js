// Generic 3D GLASS PANEL for games without a bespoke 3D model (Ultimate Tic-tac-toe, Trivia Clash, Draw & Guess,
// Star Fleet, Snake, Snake Battle, Tron Duel top-down …): the game's own 2D glow render (fx.js, theme palette) becomes the
// emissive texture of a thick glass slab with pulsing neon edges, floating over the shared starfield with bloom and a
// tilted camera (drag/pinch orbit). Taps are ray-cast to the slab and mapped back to 2D canvas coordinates (onTap(nx, ny)).
import { stage, orbit } from './three-scene.js';
export async function glass3d(canvas, src, { onTap = () => {}, tilt = 1.05 } = {}) {
  const S = await stage(canvas, { bloom: 0.75 }); const { THREE, scene } = S, root = new THREE.Group(); scene.add(root);
  const tex = new THREE.CanvasTexture(src); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.22, 8.2), new THREE.MeshPhysicalMaterial({ transmission: 0.75, ior: 1.5, thickness: 0.6, roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.95 }));
  S.tint(slab.material.color, 'glass'); slab.position.y = -0.12; root.add(slab);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false })); face.rotation.x = -Math.PI / 2; face.position.y = 0.002; root.add(face);
  const edgeM = new THREE.MeshBasicMaterial(); const edgeC = S.color('cy');
  for (const [w, d, x, z] of [[8.3, .05, 0, -4.12], [8.3, .05, 0, 4.12], [.05, 8.3, -4.12, 0], [.05, 8.3, 4.12, 0]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, .08, d), edgeM); m.position.set(x, 0, z); root.add(m); }
  const O = orbit(S, canvas, { R: 11.5, tilt, min: 7, max: 20 });
  O.onTap(ev => { const b = canvas.getBoundingClientRect(), v = new THREE.Vector2(((ev.clientX - b.left) / b.width) * 2 - 1, -((ev.clientY - b.top) / b.height) * 2 + 1), ray = new THREE.Raycaster(); ray.setFromCamera(v, S.cam); const h = ray.intersectObject(face)[0]; if (h?.uv) onTap(h.uv.x, 1 - h.uv.y); });
  let last = performance.now(), fr = 0; S.onTick(t => { const dt = Math.min(0.05, (t - last) / 1000); last = t; O.tick(dt); if (++fr % S.texEvery() === 0) tex.needsUpdate = true; edgeM.color.copy(edgeC).multiplyScalar(S.reduced ? 1 : 0.7 + 0.3 * Math.sin(t / 1500)); root.position.y = S.reduced ? 0 : Math.sin(t / 2400) * 0.08; });
  return { dispose: S.dispose, stage: S };
}
