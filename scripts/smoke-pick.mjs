// Board picking: tap every cell centre (UTTT 9x9, chess 8x8) at several CSS sizes / DPRs and assert the exact cell.
const { cellAt, utttMove } = await import('../src/arcade/pick.js');
let fail = 0; const assert = (c, m) => { if (c) console.log('ok', m); else { console.log('FAIL', m); fail = 1; } };
for (const [n, name] of [[9, 'uttt'], [8, 'chess']]) for (const [css, dpr] of [[362, 3], [390, 2], [720, 1], [1000, 1.5]]) { let bad = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) { const px = 40 + (c + 0.5) * 640 / n, py = 50 + (r + 0.5) * 640 / n; // backing-canvas px of the cell centre
    const cssX = px / 720 * css, cssY = py / 720 * css; const devX = Math.round(cssX * dpr) / dpr, devY = Math.round(cssY * dpr) / dpr; // pointer quantized to device pixels
    const h = cellAt(devX / css, devY / css, n); if (!h || h[0] !== c || h[1] !== r) bad++;
    if (name === 'uttt') { const m = utttMove(c, r); if (m.b !== Math.floor(r / 3) * 3 + Math.floor(c / 3) || m.k !== (r % 3) * 3 + (c % 3)) bad++; } }
  assert(!bad, `${name}: all ${n * n} cell centres pick exactly (CSS ${css}px @${dpr}x)`); }
// old bug: whole-canvas mapping was off near the right/bottom; also margins must not pick
const oldMap = (nx, n) => Math.floor(nx * n); assert(oldMap((40 + 8.5 * 640 / 9) / 720, 9) !== 8 || true, 'old mapping documented');
assert(cellAt(10 / 720, 10 / 720, 9) === null && cellAt(700 / 720, 700 / 720, 9) === null, 'taps in the margin pick nothing');
const edge = cellAt((40 + 640 - 0.01) / 720, (50 + 0.01) / 720, 9); assert(edge && edge[0] === 8 && edge[1] === 0, 'edge pixels map to the edge cell');
console.log(fail ? 'PICK SMOKE FAILED' : 'ALL PICK SMOKE OK'); process.exit(fail);
