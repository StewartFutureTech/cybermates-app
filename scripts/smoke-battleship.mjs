// Star Fleet (Battleship) v36 smoke: tap -> cell mapping is exact in every layout (2D boxes and 3D board-local math),
// placement helpers (drag/rotate/random), and the UI controller flow (place -> Ready commit -> fire -> auto-answer) with
// ship positions never entering the shared state. node scripts/smoke-battleship.mjs
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const B = await import('../src/arcade/games/battleship.js'), P = await import('../src/arcade/pick.js'), V = await import('../src/arcade/battleship3d.js');
// 3D board-local mapping: the centre of cell (r,c) maps back to (r,c); also near its corners
let bad = []; for (const size of [5.2, 9, 10]) for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) { const cell = r * 10 + c, [x, z] = V.localOfCell(cell, size), s = size / 10;
  for (const [dx, dz] of [[0, 0], [0.45, 0.45], [-0.45, -0.45], [0.45, -0.45]]) if (V.cellFromLocal(x + dx * s, z + dz * s, size) !== cell) bad.push(`${size}:${r},${c}`); }
assert(!bad.length, '3D: tapping cell (r,c) anywhere inside it resolves to (r,c) — all 100 cells, 3 board sizes ' + bad.slice(0, 5));
assert(V.localOfCell(0, 10)[0] < 0 && V.localOfCell(0, 10)[1] < 0 && V.localOfCell(9, 10)[0] > 0 && V.localOfCell(90, 10)[1] > 0, '3D: column -> +x (left to right), row -> +z (top to bottom): no swap, no mirror');
assert(V.cellFromLocal(5.01, 0, 10) === -1 && V.cellFromLocal(0, -5.01, 10) === -1, '3D: outside the board = no shot');
// 2D fallback boxes (720x720 backing canvas)
const UI = await import('../src/battleship-ui.js'); bad = [];
for (const [name, box] of [['place.mine', UI.BOX.place.mine], ['battle.mine', UI.BOX.battle.mine], ['battle.enemy', UI.BOX.battle.enemy]]) for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++) { const [x0, y0, sz] = box, s = sz / 10, nx = (x0 + (c + 0.5) * s) / 720, ny = (y0 + (r + 0.5) * s) / 720, h = P.cellAt(nx, ny, 10, { W: 720, H: 720, box }); if (!h || h[0] !== c || h[1] !== r) bad.push(name + ':' + r + ',' + c); }
assert(!bad.length, '2D: tapping cell (r,c) hits (r,c) in every board box ' + bad.slice(0, 5));
// controller flow with a fake match (no DOM needed beyond $ -> null)
const M = await import('../src/arcade/match.js'); const nacl = (await import('tweetnacl')).default, { b64 } = await import('../src/vault.js');
const k = nacl.sign.keyPair(), seats = [{ code: 'ME', pub: b64(k.publicKey), team: 0 }, { code: 'AI-1', ai: true, team: 1 }], X = new M.Match({ id: 'bs-ctl', game: 'battleship', mode: '1v1', seats });
const doMove = mv => X.receive(X.makeMove(0, mv, k.secretKey)).ok; const ctl = UI.bsController({ M: X, mySeat: () => 0, doMove, $: () => null });
ctl.sync(null); assert(ctl.placing() && X.state.phase === 'place', 'placement phase before the game starts');
const s0 = ctl.ships; const i = 4, sh = s0[i]; ctl.down({ b: 'mine', c: B.shipCells(sh)[0] }); const free = [...Array(100).keys()].find(c => B.canPlace(ctl.ships, i, { ...sh, r: Math.floor(c / 10), c: c % 10 }) && c !== B.shipCells(sh)[0]);
ctl.move({ b: 'mine', c: free }); ctl.up({ b: 'mine', c: free }); assert(B.shipCells(ctl.ships[i])[0] === free && B.validShips(ctl.ships), 'drag moves a ship to the cell under the finger');
const h0 = ctl.ships[i].h; ctl.down({ b: 'mine', c: free }); ctl.up({ b: 'mine', c: free }); assert(ctl.ships[i].h !== h0 || !B.rotated(ctl.ships, i), 'tapping the selected ship rotates it');
ctl.random(); assert(B.validShips(ctl.ships), 'random button = valid fleet'); ctl.ready(); ctl.tick(); assert(X.state.commits[0] && !JSON.stringify(X.state).includes('"ships"'), 'Ready publishes only a commitment');
for (let n = 0; n < 5 && X.state.phase === 'place'; n++) X.aiMove(1); assert(X.state.phase === 'fire', 'both fleets deployed -> battle');
for (const [r, c] of [[0, 0], [3, 7], [9, 2], [6, 6], [9, 9]]) { while (B.turnSeat(X.state) !== 0 || X.state.pending) { if (X.state.pending && B.turnSeat(X.state) === 0) ctl.tick(); else X.aiMove(B.turnSeat(X.state)); }
  if (X.state.shots[1][r * 10 + c]) continue; ctl.down({ b: 'enemy', c: r * 10 + c }); ctl.up({ b: 'enemy', c: r * 10 + c }); const lm = X.log[X.log.length - 1].move; assert(lm.cell === r * 10 + c && X.state.pending?.cell === r * 10 + c, `tap enemy cell (${r},${c}) fires at exactly (${r},${c})`); X.aiMove(1); assert(X.state.shots[1][r * 10 + c] > 0, `(${r},${c}) marked ${X.state.shots[1][r * 10 + c] === 2 ? 'hit' : 'miss'} on the enemy board`); }
// AI shoots me -> my client answers truthfully from the private grid
let guard = 0; while (!X.over && guard++ < 400) { const ts = B.turnSeat(X.state); if (ts === 0) { if (X.state.pending) ctl.tick(); else { const open = X.state.shots[1].findIndex(v => !v); doMove({ cell: open }); } } else X.aiMove(ts); }
assert(X.over && B.audit(X.state, 0, X.bsSecret.grid, X.bsSecret.salt).ok, `full game finishes (${X.over?.how}); my answers pass the audit`);
console.log('STAR FLEET SMOKE OK');
