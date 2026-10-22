// Self-contained QR Code encoder (ISO/IEC 18004), byte mode, error-correction level M, versions 1-15 (up to 412 bytes).
// Used by the device-linking screen (src/link-ui.js) to draw the signed link offer locally; nothing leaves the phone.
// API: qrMatrix(text) -> { size, get(x, y) -> bool }; drawQr(canvas, text, { scale, margin }) renders dark-on-light.
const EC = [, [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]], [16, [[4, 27]]], [18, [[4, 31]]],
  [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]], [30, [[1, 50], [4, 51]]], [22, [[6, 36], [2, 37]]],
  [22, [[8, 37], [1, 38]]], [24, [[4, 40], [5, 41]]], [24, [[5, 41], [5, 42]]]]; // [ec codewords per block, [[blocks, data cw]...]]
const ALIGN = [, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70]];
const dataCap = v => EC[v][1].reduce((s, [n, d]) => s + n * d, 0);
// GF(256) with polynomial 0x11D
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => a && b ? EXP[LOG[a] + LOG[b]] : 0;
function rsGen(n) { let g = [1]; for (let i = 0; i < n; i++) { const r = new Array(g.length + 1).fill(0); g.forEach((c, j) => { r[j] ^= c; r[j + 1] ^= mul(c, EXP[i]); }); g = r; } return g; }
function rsEc(data, n) { const g = rsGen(n), r = new Array(n).fill(0); for (const d of data) { const f = d ^ r.shift(); r.push(0); for (let i = 0; i < n; i++) r[i] ^= mul(g[i + 1], f); } return r; }
function bch(v, poly, bits) { let x = v << bits; const deg = Math.floor(Math.log2(poly)); while (x && Math.floor(Math.log2(x)) >= deg) x ^= poly << (Math.floor(Math.log2(x)) - deg); return (v << bits) | x; }
const MASKS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => x * y % 2 + x * y % 3 === 0, (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];

export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  let v = 1; while (v <= 15 && 4 + (v < 10 ? 8 : 16) + bytes.length * 8 > dataCap(v) * 8) v++;
  if (v > 15) throw new Error('QR payload too long');
  // data bit stream
  const bits = [], put = (val, n) => { for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => put(b, 8));
  const cap = dataCap(v) * 8; put(0, Math.min(4, cap - bits.length)); while (bits.length % 8) bits.push(0);
  const data = []; for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => a * 2 + b, 0));
  for (let p = 0; data.length < dataCap(v); p ^= 1) data.push(p ? 0x11 : 0xec);
  // blocks + interleave
  const [ecn, groups] = EC[v], blocks = []; let k = 0;
  for (const [n, d] of groups) for (let i = 0; i < n; i++) { const dat = data.slice(k, k += d); blocks.push({ dat, ec: rsEc(dat, ecn) }); }
  const cw = [], maxD = Math.max(...blocks.map(b => b.dat.length));
  for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.dat.length) cw.push(b.dat[i]);
  for (let i = 0; i < ecn; i++) for (const b of blocks) cw.push(b.ec[i]);
  // function patterns
  const size = v * 4 + 17, M = Array.from({ length: size }, () => new Array(size).fill(false)), F = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, d) => { M[y][x] = d; F[y][x] = true; };
  const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= size || y >= size) continue; const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, d !== 2 && d !== 4); } };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  const al = ALIGN[v]; for (const ay of al) for (const ax of al) { if ((ax === 6 && ay === 6) || (ax === 6 && ay === al[al.length - 1]) || (ay === 6 && ax === al[al.length - 1])) continue; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1); }
  const drawFormat = mask => { const f = bch((0 << 3) | mask, 0x537, 10) ^ 0x5412, b = i => ((f >>> i) & 1) === 1; // level M = 00
    for (let i = 0; i <= 5; i++) set(8, i, b(i)); set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8)); for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, b(i)); for (let i = 8; i < 15; i++) set(8, size - 15 + i, b(i)); set(8, size - 8, true); };
  drawFormat(0);
  if (v >= 7) { const r = bch(v, 0x1f25, 12); for (let i = 0; i < 18; i++) { const d = ((r >>> i) & 1) === 1, a = size - 11 + i % 3, c = Math.floor(i / 3); set(a, c, d); set(c, a, d); } }
  // zigzag data placement
  let bi = 0; const total = cw.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) { if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) { const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
      if (!F[y][x] && bi < total) { M[y][x] = ((cw[bi >>> 3] >>> (7 - (bi & 7))) & 1) === 1; bi++; } } }
  // choose mask with the lowest penalty
  const apply = m => { for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!F[y][x] && MASKS[m](x, y)) M[y][x] = !M[y][x]; };
  let best = 0, bestP = Infinity;
  for (let m = 0; m < 8; m++) { apply(m); drawFormat(m); const p = penalty(M, size); if (p < bestP) { bestP = p; best = m; } apply(m); }
  apply(best); drawFormat(best);
  return { size, version: v, mask: best, get: (x, y) => x >= 0 && y >= 0 && x < size && y < size && M[y][x] };
}
function penalty(M, n) {
  let p = 0, dark = 0;
  const line = get => { let run = 1, prev = get(0), s = 0, w = []; for (let i = 1; i < n; i++) { const c = get(i); if (c === prev) run++; else { if (run >= 5) s += run - 2; run = 1; prev = c; } } if (run >= 5) s += run - 2;
    for (let i = 0; i + 10 < n; i++) { w = []; for (let j = 0; j < 11; j++) w.push(get(i + j) ? 1 : 0); const t = w.join(''); if (t === '10111010000' || t === '00001011101') s += 40; } return s; };
  for (let y = 0; y < n; y++) p += line(i => M[y][i]);
  for (let x = 0; x < n; x++) p += line(i => M[i][x]);
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const c = M[y][x]; if (c === M[y][x + 1] && c === M[y + 1][x] && c === M[y + 1][x + 1]) p += 3; }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (M[y][x]) dark++;
  return p + Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
}
export function drawQr(canvas, text, { scale = 6, margin = 4, dark = '#05060a', light = '#ffffff' } = {}) {
  const q = qrMatrix(text), px = (q.size + margin * 2) * scale; canvas.width = canvas.height = px;
  const g = canvas.getContext('2d'); g.fillStyle = light; g.fillRect(0, 0, px, px); g.fillStyle = dark;
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (q.get(x, y)) g.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
  return q;
}
