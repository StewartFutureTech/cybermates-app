// Shared three.js stage for 3D arcade views (chess + Tron vehicles). LAZY-LOADED (dynamic import) only when a 3D game opens.
//  - Capability gate: WebGL2 required, and not on low-end phones (<=4 cores AND <=4 GB, or lowfx/saveData) -> caller falls
//    back to the 2D glow renderer (fx.js). ?force3d=1 overrides for screenshots/tests.
//  - Pixel ratio capped (MAX_DPR = 1.5) for phone performance; one UnrealBloomPass (bloom, ALWAYS on) + OutputPass.
//  - Procedural starfield skybox (points on a sphere, 2 layers with slight parallax). Reduced motion: no orbit/pulse.
import { swatch, onThemeChange } from './fx.js';
export const MAX_DPR = 1.5;
// can3D: true whenever WebGL2 works (three r170 needs WebGL2). Probed ONCE and the probe context is released right away —
// WebKit (iOS WKWebView) only allows a handful of live WebGL contexts, so leaking one per game open made later opens fail
// and silently fall back to 2D. Low-end devices are NOT sent to 2D any more (the quality tier handles perf).
// Every decision is recorded in localStorage 'cm.bootdiag'.three and shown as a tiny note when 2D is used.
let probed = null;
export const diag3d = (k, v) => { try { const d = JSON.parse(localStorage.getItem('cm.bootdiag') || '{}'); d.three = { ...(d.three || {}), [k]: v, at: new Date().toISOString() }; localStorage.setItem('cm.bootdiag', JSON.stringify(d)); } catch {} globalThis.__cm3dDiag = { ...(globalThis.__cm3dDiag || {}), [k]: v }; };
export function can3D() { const q = new URLSearchParams(globalThis.location?.search || ''); if (q.get('force3d') === '1') return true; if (q.get('force3d') === '0') { diag3d('fallback', 'force3d=0'); return false; }
  if (probed != null) return probed;
  try { const c = document.createElement('canvas'); let gl = c.getContext('webgl2'); if (gl) { probed = true; diag3d('probe', 'webgl2'); }
    else { const g1 = c.getContext('webgl') || c.getContext('experimental-webgl'); probed = false; diag3d('fallback', g1 ? 'only WebGL1 (3D needs WebGL2)' : 'no WebGL'); gl = g1; }
    gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) { probed = false; diag3d('fallback', 'probe threw: ' + (e?.message || e)); }
  return probed; }
// tiny visible note when a 3D view fell back to 2D (so the reason is obvious on a phone)
export function noteFallback(host, why) { diag3d('fallback', String(why)); try { if (!host || host.querySelector?.('.cm-3dnote')) return; const n = document.createElement('div'); n.className = 'cm-3dnote small muted'; n.textContent = '2D view · ' + String(why).slice(0, 80); host.prepend(n); } catch {} }
export const reduced = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
export const GLOW_SCALE = 0.7; // David 2026-10-21: all games' glow -30% (base strength x0.7), still always on
export async function stage(canvas, { bloom: bloomBase = 0.9 } = {}) { const bloom = bloomBase * GLOW_SCALE;
  const THREE = await import('three'); const { EffectComposer } = await import('three/examples/jsm/postprocessing/EffectComposer.js'); const { RenderPass } = await import('three/examples/jsm/postprocessing/RenderPass.js');
  const { UnrealBloomPass } = await import('three/examples/jsm/postprocessing/UnrealBloomPass.js'); const { OutputPass } = await import('three/examples/jsm/postprocessing/OutputPass.js'); const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
  let r; try { r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false }); } catch (e) { diag3d('retry', e?.message || String(e)); r = new THREE.WebGLRenderer({ canvas, antialias: false }); } r.setPixelRatio(Math.min(MAX_DPR, globalThis.devicePixelRatio || 1));
  let W = canvas.clientWidth || canvas.width, H = canvas.clientHeight || canvas.height; r.setSize(W, H, false); r.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(45, W / H, 0.1, 2000); const SW = swatch(); scene.background = new THREE.Color(SW.bg);
  const pm = new THREE.PMREMGenerator(r); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; // reflections/refraction source for glass
  const amb = new THREE.AmbientLight(SW.ambient, 0.35); scene.add(amb); const key = new THREE.DirectionalLight(SW.white, 1.4); key.position.set(4, 10, 6); scene.add(key);
  const stars = new THREE.Group(); for (const [n, rad, size] of [[1400, 400, 1.1], [600, 250, 1.8]]) { const g = new THREE.BufferGeometry(), p = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u); p.set([rad * s * Math.cos(t), rad * u, rad * s * Math.sin(t)], i * 3); } g.setAttribute('position', new THREE.BufferAttribute(p, 3)); stars.add(new THREE.Points(g, new THREE.PointsMaterial({ color: SW.star, size, sizeAttenuation: false, transparent: true, opacity: 0.85 }))); }
  scene.add(stars);
  // Composer is (re)buildable: on WebGL context restore or a render throw we rebuild it so the glow comes back (never disabled).
  const BQ = { res: 1, at: '' }; let comp, bp;
  const buildComp = () => { try { comp?.dispose?.(); } catch {} comp = new EffectComposer(r); comp.addPass(new RenderPass(scene, cam)); bp = new UnrealBloomPass(new THREE.Vector2(W, H), bloom, 0.6, 0.15);
    const bset = bp.setSize.bind(bp); bp.setSize = (w, h) => bset(Math.max(2, Math.round(w * BQ.res)), Math.max(2, Math.round(h * BQ.res))); // bloom at reduced res, upsampled on composite
    Object.defineProperty(bp, 'enabled', { get: () => true, set: () => {}, configurable: false }); // cm-v35: bloom can NEVER be switched off
    Object.defineProperty(bp, 'strength', { get: () => bloom, set: () => {}, configurable: false }); // fixed 0.7x glow in every tier
    comp.addPass(bp); comp.addPass(new OutputPass()); BQ.at = ''; };
  buildComp();
  // live theme retint: tint(colorObj, token|fn) binds a THREE.Color to the shared palette; re-applied on theme switch.
  const binds = []; const apply = (sw, [c, f]) => c.set(typeof f === 'function' ? f(sw) : sw[f]);
  const tint = (c, f) => { binds.push([c, f]); apply(swatch(), [c, f]); return c; }; tint(scene.background, 'bg'); tint(amb.color, 'ambient'); tint(key.color, 'white'); for (const p of stars.children) tint(p.material.color, 'star');
  const unsub = onThemeChange(sw => { for (const b of binds) apply(sw, b); });
  let raf = 0, alive = true; const ticks = new Set();
  // ADAPTIVE QUALITY (60 fps target). BLOOM IS NEVER DISABLED (glow is always on). Tier 2 = DPR<=1.5 + full-res full bloom,
  // 1 = DPR 1 + half-res bloom @0.85 strength, 0 = DPR 0.75 + half-res bloom @0.75 strength. Inside a tier the render SCALE
  // (0.6..1) moves continuously. ONLY resolution + bloom strength/resolution change; materials (refraction) are never touched.
  // Spike-proof: 3 s warm-up is ignored, frame dt is clamped to 50 ms, and a step down needs 2 consecutive slow 1.5 s windows.
  // ?tier=0|1|2 pins it. Rendering pauses while hidden. Exposed as S.tier / S.fps / S.scale / __cm3d.bloom for HUDs + tests.
  const qp = new URLSearchParams(globalThis.location?.search || ''), dev = globalThis.navigator || {};
  const startTier = qp.has('tier') ? Math.max(0, Math.min(2, +qp.get('tier') | 0)) : ((dev.hardwareConcurrency || 8) <= 4 || (dev.deviceMemory || 8) <= 3 ? 1 : 2);
  const Q = { tier: -1, scale: 1, fps: 60, ema: 16.7, lastT: 0, since: 0, good: 0, bad: 0, t0: 0, auto: !qp.has('tier'), lost: false, rebuilds: 0 };
  const applyRes = () => { const dpr = Math.max(0.5, Math.min(globalThis.devicePixelRatio || 1, [0.75, 1, MAX_DPR][Q.tier]) * Q.scale); const key = `${dpr}|${W}x${H}|${BQ.res}`; if (key === BQ.at) return; BQ.at = key; r.setPixelRatio(dpr); r.setSize(W, H, false); cam.aspect = W / H; cam.updateProjectionMatrix(); comp.setPixelRatio?.(dpr); comp.setSize(W, H); }; // cm-v35: reallocate render targets ONLY when something actually changed
  const applyBloom = () => {}; // cm-v35: strength/enabled are locked on the pass (always on, 0.7x); tiers only change resolution
  const setTier = k => { if (k === Q.tier) return; Q.tier = k; Q.scale = 1; BQ.res = k >= 2 ? ((globalThis.devicePixelRatio || 1) > 1.25 ? 0.5 : 1) : k === 1 ? 0.5 : 0.25; applyRes(); applyBloom(); };
  setTier(startTier);
  const qual = t => { if (Q.lastT) { const dt = Math.min(50, t - Q.lastT); Q.ema += (dt - Q.ema) * 0.05; Q.fps = 1000 / Q.ema; } else if (!Q.t0) Q.t0 = t; Q.lastT = t; if (!Q.auto) return;
    if (t - Q.t0 < 3000 || t - Q.since < 1500) return; Q.since = t;
    if (Q.ema > 18.5) { Q.good = 0; if (++Q.bad < 2) return; Q.bad = 0; if (Q.scale > 0.6) { Q.scale = Math.max(0.6, +(Q.scale - 0.15).toFixed(2)); applyRes(); } else if (Q.tier > 0) setTier(Q.tier - 1); }
    else if (Q.ema < 15) { Q.bad = 0; if (++Q.good >= 3) { Q.good = 0; if (Q.scale < 1) { Q.scale = Math.min(1, +(Q.scale + 0.1).toFixed(2)); applyRes(); } else if (Q.tier < startTier) { setTier(Q.tier + 1); Q.scale = 0.7; applyRes(); } } }
    else { Q.good = 0; Q.bad = 0; } };
  const rebuild = why => { Q.rebuilds++; diag3d('rebuild', String(why).slice(0, 80)); buildComp(); applyRes(); applyBloom(); };
  // WebGL context loss (iOS WKWebView drops contexts under memory pressure / backgrounding): pause, then rebuild with glow on restore.
  const onLost = e => { e.preventDefault(); Q.lost = true; diag3d('ctxlost', new Date().toISOString()); cancelAnimationFrame(raf); raf = 0; };
  const onRestored = () => { Q.lost = false; try { scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; } catch {} rebuild('restored'); Q.lastT = 0; if (alive && !raf) raf = requestAnimationFrame(loop); };
  canvas.addEventListener('webglcontextlost', onLost, false); canvas.addEventListener('webglcontextrestored', onRestored, false);
  let lastFail = 0; const draw = () => { if (!comp.passes.includes(bp)) rebuild('bloom pass missing'); try { comp.render(); } catch (e) { diag3d('renderErr', e?.message || String(e)); r.render(scene, cam); const n = performance.now(); if (n - lastFail > 2000) { lastFail = n; rebuild('throw: ' + (e?.message || e)); } } };
  const onVis = () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (alive && !raf && !Q.lost) { Q.lastT = 0; raf = requestAnimationFrame(loop); } };
  globalThis.document?.addEventListener?.('visibilitychange', onVis);
  // cm-v35: follow fullscreen / rotation / resize (debounced; same size => no reallocation)
  let rzT = 0; const onRz = () => { clearTimeout(rzT); rzT = setTimeout(() => { const w = canvas.clientWidth | 0, h = canvas.clientHeight | 0; if (w > 1 && h > 1 && (w !== W || h !== H)) { W = w; H = h; applyRes(); } }, 150); };
  const ro = globalThis.ResizeObserver ? new ResizeObserver(onRz) : null; ro?.observe(canvas); globalThis.addEventListener?.('resize', onRz);
  const loop = t => { if (!alive) return; if (globalThis.document?.hidden || Q.lost) { raf = 0; return; } if (!canvas.isConnected) return dispose(); qual(t); for (const f of ticks) f(t); stars.children[0].rotation.y = cam.position.x * 0.0004; stars.children[1].rotation.y = cam.position.x * 0.0012; draw(); raf = requestAnimationFrame(loop); }; // parallax: near layer moves more
  const dispose = () => { ro?.disconnect(); globalThis.removeEventListener?.('resize', onRz); clearTimeout(rzT); unsub(); canvas.removeEventListener('webglcontextlost', onLost); canvas.removeEventListener('webglcontextrestored', onRestored); globalThis.document?.removeEventListener?.('visibilitychange', onVis); alive = false; cancelAnimationFrame(raf); r.dispose(); pm.dispose(); try { r.forceContextLoss(); } catch {} };
  raf = requestAnimationFrame(loop);
  globalThis.__cm3d = { cam, get bloom() { return { enabled: bp.enabled, strength: bp.strength, res: BQ.res, inComposer: comp.passes.includes(bp) }; }, get rebuilds() { return Q.rebuilds; }, get lost() { return Q.lost; }, renderer: r, get tier() { return Q.tier; }, get fps() { return Q.fps; }, get scale() { return Q.scale; } };
  return { THREE, tint, color: f => tint(new THREE.Color(), f), renderer: r, scene, cam, get composer() { return comp; }, get bloomPass() { return bp; }, onTick: f => ticks.add(f), dispose, reduced: reduced(), get tier() { return Q.tier; }, get fps() { return Q.fps; }, get scale() { return Q.scale; }, texEvery: () => (Q.tier >= 2 && Q.ema < 17.5 ? 1 : 2), setTier: k => { Q.auto = false; setTier(k); } };
}
export const themeColor = (THREE, n = '--cy') => new THREE.Color(swatch()[n.replace('--', '')]); // static snapshot; prefer S.color(token) (live)
// cm-v35 (David): BOARD-SURFACE light at 50% in air hockey / chess / checkers ONLY. Per-material shader scale on the final
// lit colour (diffuse + specular + env + emissive), so it survives theme retints and never touches pieces/paddles/puck.
// ?boardlight=1 restores the old look (used for before/after screenshots).
export const BOARD_LIGHT = 0.5;
export function dimSurface(mat, k = BOARD_LIGHT) { const q = Number(new URLSearchParams(globalThis.location?.search || '').get('boardlight')); if (Number.isFinite(q) && q > 0) k = q; if (k === 1) return mat;
  mat.onBeforeCompile = sh => { sh.uniforms.cmBoardK = { value: k }; sh.fragmentShader = 'uniform float cmBoardK;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight *= cmBoardK;\n#include <opaque_fragment>'); };
  mat.customProgramCacheKey = () => 'cmBoardK' + k; mat.userData.boardK = k; mat.needsUpdate = true; return mat; }
// Free orbit camera: drag = orbit/tilt, pinch / wheel = zoom, slow auto-orbit when idle (off with reduced motion).
// Returns {tick(dt), onTap(fn)}; a short tap (no drag) calls onTap(event).
export function orbit(S, canvas, { R = 10, tilt = 0.5, min = 5, max = 18, target = [0, 0, 0], idleS = 2.5, stopOnAnyTouch = false } = {}) {
  const want = { az: 0, tilt, R }, cur = { ...want }; let idle = 0, tap = () => {}; const pts = new Map(); let pinch0 = null, drag = null;
  canvas.style.touchAction = 'none';
  // cm-v35: ANY touch / pointer down anywhere on screen halts the idle spin on the spot (no move detection needed)
  const halt = () => { idle = 0; want.az = cur.az; }; if (stopOnAnyTouch) for (const ev of ['pointerdown', 'touchstart']) globalThis.addEventListener?.(ev, halt, { capture: true, passive: true });
  canvas.addEventListener('pointerdown', e => { pts.set(e.pointerId, [e.clientX, e.clientY]); canvas.setPointerCapture?.(e.pointerId); idle = 0; if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, az: want.az, t: want.tilt, moved: false }; else { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), R: want.R }; drag = null; } });
  canvas.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, [e.clientX, e.clientY]); idle = 0;
    if (pinch0 && pts.size >= 2) { const [a, b] = [...pts.values()]; want.R = Math.min(max, Math.max(min, pinch0.R * pinch0.d / Math.max(1, Math.hypot(a[0] - b[0], a[1] - b[1])))); }
    else if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true; want.az = drag.az - dx * 0.008; want.tilt = Math.min(1.35, Math.max(-0.1, drag.t + dy * 0.006)); } });
  const end = e => { const wasTap = drag && !drag.moved && pts.size === 1; pts.delete(e.pointerId); if (pts.size < 2) pinch0 = null; if (wasTap) tap(e); if (!pts.size) drag = null; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', e => { e.preventDefault(); want.R = Math.min(max, Math.max(min, want.R * (1 + Math.sign(e.deltaY) * 0.08))); }, { passive: false });
  return { want, onTap: f => { tap = f; }, tick(dt) { idle += dt; if (!S.reduced && idle > idleS) want.az += dt * 0.12; for (const k of ['az', 'tilt', 'R']) cur[k] += (want[k] - cur[k]) * 0.08;
    S.cam.position.set(target[0] + Math.sin(cur.az) * cur.R * Math.cos(cur.tilt), target[1] + cur.R * Math.sin(cur.tilt), target[2] + Math.cos(cur.az) * cur.R * Math.cos(cur.tilt)); S.cam.lookAt(...target); } };
}
