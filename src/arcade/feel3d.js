// Shared 3D game feel for the analog arena games (Snake, Tron): a pooled additive particle system, camera shake, a lagged
// chase camera, tick interpolation and ground-plane aiming (pointer -> world heading). All colours come from the caller
// (theme palette); nothing hard-coded. Reduced motion: no shake, fewer particles.
export function particles(S, parent, max = 700) { const { THREE } = S; const g = new THREE.BufferGeometry(), pos = new Float32Array(max * 3), col = new Float32Array(max * 3);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size: 0.28, vertexColors: true, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }); const pts = new THREE.Points(g, m); pts.frustumCulled = false; parent.add(pts);
  const P = Array.from({ length: max }, () => ({ life: 0 })); let head = 0; const c = new THREE.Color();
  return { burst(x, y, z, color, n = 24, speed = 4) { if (S.reduced) n = Math.ceil(n / 3); c.set(color); for (let k = 0; k < n; k++) { const p = P[head = (head + 1) % max], a = Math.random() * Math.PI * 2, u = Math.random() * 0.9 + 0.1, v = speed * (0.4 + Math.random());
      Object.assign(p, { x, y, z, vx: Math.cos(a) * v * u, vy: v * (0.4 + Math.random() * 0.8), vz: Math.sin(a) * v * u, life: 0.5 + Math.random() * 0.6, r: c.r, g: c.g, b: c.b }); } },
    tick(dt) { let i = 0; for (const p of P) { if (p.life > 0) { p.life -= dt; p.vy -= 9 * dt; p.x += p.vx * dt; p.y = Math.max(0.02, p.y + p.vy * dt); p.z += p.vz * dt; const f = Math.max(0, Math.min(1, p.life * 2)); pos[i] = p.x; pos[i + 1] = p.y; pos[i + 2] = p.z; col[i] = p.r * f; col[i + 1] = p.g * f; col[i + 2] = p.b * f; } else { pos[i + 1] = -999; } i += 3; }
      g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true; }, shift(dx, dz) { for (const p of P) if (p.life > 0) { p.x -= dx; p.z -= dz; } } };
}
export function shaker(S) { let amp = 0; return { kick(a) { if (!S.reduced) amp = Math.min(1.2, amp + a); }, apply(cam, dt) { if (amp <= 0.001) return; cam.position.x += (Math.random() - 0.5) * amp; cam.position.y += (Math.random() - 0.5) * amp * 0.6; cam.position.z += (Math.random() - 0.5) * amp; amp *= Math.exp(-dt * 7); } }; }
// lagged chase camera: sits behind+above the target along its heading, eases toward it (position lag ~0.25 s, heading lag ~0.4 s)
export function chase(S, canvas, { dist = 9, height = 7.5, ahead = 3, min = 5, max = 22 } = {}) { const cam = S.cam, cur = { x: 0, y: height, z: dist, h: null, lx: 0, lz: 0 }; let zoom = 1;
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.min(max / dist, Math.max(min / dist, zoom * (1 + Math.sign(e.deltaY) * 0.08))); }, { passive: false });
  return { get zoom() { return zoom; }, set zoom(z) { zoom = z; }, snap() { cur.h = null; },
    update(tx, tz, h, dt) { if (cur.h == null) { cur.h = h; cur.lx = tx; cur.lz = tz; } let d = h - cur.h; d = Math.atan2(Math.sin(d), Math.cos(d)); cur.h += d * (1 - Math.exp(-dt * 2.6));
      const kp = 1 - Math.exp(-dt * 4.5); cur.lx += (tx - cur.lx) * kp; cur.lz += (tz - cur.lz) * kp; const fx = Math.cos(cur.h), fz = Math.sin(cur.h), D = dist * zoom, Hh = height * zoom;
      cam.position.set(cur.lx - fx * D, Hh, cur.lz - fz * D); cam.lookAt(cur.lx + fx * ahead, 0, cur.lz + fz * ahead); } };
}
// pointer -> point on the y=0 ground plane, in the scene's world coords (or null)
export function groundPoint(S, canvas, clientX, clientY) { const { THREE } = S, b = canvas.getBoundingClientRect(); const v = new THREE.Vector2(((clientX - b.left) / b.width) * 2 - 1, -((clientY - b.top) / b.height) * 2 + 1);
  const rc = new THREE.Raycaster(); rc.setFromCamera(v, S.cam); const o = rc.ray.origin, d = rc.ray.direction; if (Math.abs(d.y) < 1e-4) return null; const t = -o.y / d.y; if (t < 0) return null; return [o.x + d.x * t, o.z + d.z * t]; }
// heading (world angle) -> three.js rotation.y for models whose nose points to -z
export const yawOf = h => -h - Math.PI / 2;
export const lerp = (a, b, t) => a + (b - a) * t;
