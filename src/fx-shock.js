// Tap shockwave pixel distortion. Primary: real displacement of the page pixels under the tap via an SVG
// feDisplacementMap filter (radial ring map generated once) applied briefly (~320 ms) to the tapped region's container.
// Plus a WebGL fragment-shader refraction ring (chromatic lens band) on a small canvas at the tap; if WebGL is
// unavailable (or context lost) it's skipped — the 2D canvas shockwave/glitch in fx-pointer.js always runs.
const NS = 'http://www.w3.org/2000/svg', SZ = 160; let svg, feImg, feDisp, busy = false, gl = null, glc = null, prog = null, glOK = null;
function mapURL() { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), im = x.createImageData(128, 128);
  for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) { const dx = (i - 63.5) / 64, dy = (j - 63.5) / 64, d = Math.hypot(dx, dy), a = d < 1 ? Math.sin(d * Math.PI) * (1 - d) : 0, k = (j * 128 + i) * 4;
    im.data[k] = 128 + (d ? dx / d : 0) * a * 127; im.data[k + 1] = 128 + (d ? dy / d : 0) * a * 127; im.data[k + 2] = 128; im.data[k + 3] = 255; }
  x.putImageData(im, 0, 0); return c.toDataURL(); }
function ensureSvg() { if (svg) return; svg = document.createElementNS(NS, 'svg'); svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true'); svg.style.position = 'absolute';
  svg.innerHTML = `<filter id="cm-shock" filterUnits="userSpaceOnUse" x="-5000" y="-5000" width="20000" height="20000" color-interpolation-filters="sRGB"><feFlood flood-color="rgb(128,128,0)" result="n"/><feImage result="m" preserveAspectRatio="none"/><feComposite in="m" in2="n" operator="over" result="mm"/><feDisplacementMap in="SourceGraphic" in2="mm" scale="0" xChannelSelector="R" yChannelSelector="G"/></filter>`;
  document.body.appendChild(svg); feImg = svg.querySelector('feImage'); feDisp = svg.querySelector('feDisplacementMap'); feImg.setAttribute('href', mapURL()); feImg.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', feImg.getAttribute('href')); }
function displace(cx, cy, target) {
  // Never on onboarding/age/terms/loader screens, and NEVER filter a scroll container (or anything inside a modal/scroller):
  // Safari re-rasterises a filtered scroller → flash + scroll position reset (the 8:32 terms-page regression).
  if (busy || document.querySelector('.cm-gate,.cm-onb,#jackin,.modal')) return;
  const el = target?.closest?.('.card,.modes,nav,header'); if (!el) return;
  for (let n = el; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); if (/auto|scroll/.test(cs.overflowY) || cs.position === 'fixed') return; }
  const r = el.getBoundingClientRect(); if (r.width * r.height > 900 * 1400) return; // keep it cheap: only element-sized regions
  ensureSvg(); busy = true; feImg.setAttribute('x', cx - r.left - SZ / 2); feImg.setAttribute('y', cy - r.top - SZ / 2); feImg.setAttribute('width', SZ); feImg.setAttribute('height', SZ);
  const prev = el.style.filter; el.style.filter = 'url(#cm-shock)'; const t0 = performance.now();
  const step = t => { const k = Math.min(1, (t - t0) / 320); feDisp.setAttribute('scale', String(28 * Math.sin(k * Math.PI) * (1 - k * .5)));
    if (k < 1) requestAnimationFrame(step); else { el.style.filter = prev; feDisp.setAttribute('scale', '0'); busy = false; } };
  requestAnimationFrame(step);
}
const VS = 'attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}';
const FS = 'precision mediump float;varying vec2 v;uniform float t;uniform vec3 c1;uniform vec3 c2;void main(){vec2 q=v-.5;float d=length(q)*2.;float r=t*.9+.05;float w=.10*(1.-t)+.02;' +
  'float band=smoothstep(w,0.,abs(d-r));float rr=smoothstep(w,0.,abs(d-r-.04*(1.-t)));float bb=smoothstep(w,0.,abs(d-r+.04*(1.-t)));' +
  'vec3 col=c1*band+vec3(rr*c2.r,0.,bb*c1.b)*.6;float a=max(band,max(rr,bb)*.6)*(1.-t);gl_FragColor=vec4(col*a,a);}';
function hex(c) { const m = /#?([0-9a-f]{6})/i.exec(c || ''); const n = m ? parseInt(m[1], 16) : 0x19e6ff; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
function initGL() { if (glOK !== null) return glOK; try { glc = document.createElement('canvas'); glc.id = 'fxgl'; glc.setAttribute('aria-hidden', 'true'); glc.width = glc.height = 192;
    gl = glc.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false }); if (!gl) return glOK = false;
    const sh = (ty, src) => { const s = gl.createShader(ty); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw 0; return s; };
    prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
    const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    glc.addEventListener('webglcontextlost', e => { e.preventDefault(); glOK = false; }); return glOK = true; } catch { return glOK = false; } }
let glBusy = false;
function ring(x, y) { if (glBusy || !initGL()) return; const v = globalThis.visualViewport; glBusy = true; if (!glc.isConnected) document.body.appendChild(glc); glc.style.visibility = 'visible'; // stays mounted: no add/remove repaint
  glc.style.left = (x - 96 + (v?.offsetLeft || 0)) + 'px'; glc.style.top = (y - 96 + (v?.offsetTop || 0)) + 'px';
  const s = getComputedStyle(document.documentElement); gl.uniform3fv(gl.getUniformLocation(prog, 'c1'), hex(s.getPropertyValue('--cy').trim())); gl.uniform3fv(gl.getUniformLocation(prog, 'c2'), hex(s.getPropertyValue('--hot').trim()));
  const tl = gl.getUniformLocation(prog, 't'), t0 = performance.now();
  const step = t => { const k = Math.min(1, (t - t0) / 420); gl.viewport(0, 0, 192, 192); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.uniform1f(tl, k); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (k < 1) requestAnimationFrame(step); else { gl.clear(gl.COLOR_BUFFER_BIT); glc.style.visibility = 'hidden'; glBusy = false; } };
  requestAnimationFrame(step); }
// clientX/clientY in, all positioning relative to the fixed overlays (visualViewport-aware)
// NOTE: the DOM displacement filter is no longer applied on tap — putting an SVG filter on a card (which has
// backdrop-filter + clip-path) made iOS Safari re-rasterise it = visible flash. Distortion is the WebGL lens ring only.
export function shock(clientX, clientY, target) { if (document.querySelector('.cm-gate,.cm-onb,#jackin')) return; try { ring(clientX - (globalThis.visualViewport?.offsetLeft || 0), clientY - (globalThis.visualViewport?.offsetTop || 0)); } catch {} }
export const shockCaps = () => ({ webgl: initGL(), svg: true });
