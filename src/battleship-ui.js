// STAR FLEET (Battleship) match controller, used by match-ui.js. Owns: the PLACEMENT PHASE (drag a ship, tap a selected
// ship to rotate, Rotate / Random / Ready buttons), the PRIVATE fleet (kept on this client only, per round: M.bsSecret),
// auto-answering incoming shots from that private grid, and both renderers (3D battleship3d.js, 2D canvas fallback).
// Enemy ships are never known here: the enemy board shows only hits, misses and ships the enemy reported as sunk.
import * as BS from './arcade/games/battleship.js';
import { cellAt, normFromClient } from './arcade/pick.js';
export const BOX = { place: { mine: [40, 50, 640] }, battle: { mine: [200, 58, 320], enemy: [200, 398, 320] } }; // 2D boxes in the 720x720 backing canvas
export function bsController({ M, mySeat, doMove, $ }) {
  let ships = BS.randomShips(), sel = null, drag = null, bad = [], round = -1, panelKey = '', tip = '';
  const st = () => M.state, myTeam = () => M.seats[mySeat()]?.team ?? (mySeat() % 2), sec = () => (M.bsSecret?.round === M.round && M.bsSecret?.id === M.id ? M.bsSecret : null);
  const isKeeper = () => st().keeper?.[myTeam()] === mySeat(), placing = () => st().phase === 'place' && isKeeper() && !sec();
  const reset = () => { if (round === M.round) return; round = M.round; ships = BS.randomShips(); sel = null; drag = null; bad = []; panelKey = ''; };
  const setShip = (i, s) => { if (BS.canPlace(ships, i, s)) { ships = ships.map((o, j) => (j === i ? s : o)); bad = []; return true; } bad = BS.inBounds(s) ? BS.shipCells(s) : []; return false; };
  const rotate = () => { if (sel == null) { tip = 'tap a ship first'; return; } const r = BS.rotated(ships, sel); if (r) { ships = ships.map((o, j) => (j === sel ? r : o)); bad = []; tip = ''; } else { bad = BS.shipCells(ships[sel]); tip = 'no room to rotate here'; } };
  const random = () => { ships = BS.randomShips(); sel = null; bad = []; tip = ''; };
  const ready = () => { if (!BS.validShips(ships)) return; const grid = BS.gridOf(ships), salt = BS.newSalt(); M.bsSecret = { id: M.id, round: M.round, grid, salt, ships: ships.map(s => ({ ...s })), commit: BS.commitOf(grid, salt) }; sel = null; panelKey = ''; tick(); };
  // pointer protocol shared by 3D and 2D: h = { b: 'mine'|'enemy', c: cell } | null
  let downAt = null;
  const down = h => { downAt = h; if (!placing() || h?.b !== 'mine') return; const i = BS.shipAt(ships, h.c);
    if (i >= 0) { drag = { i, off: BS.shipCells(ships[i]).indexOf(h.c), moved: false, wasSel: sel === i }; sel = i; }
    else if (sel != null) { const s = ships[sel]; setShip(sel, { ...s, r: Math.floor(h.c / BS.N), c: h.c % BS.N }); } };
  const move = h => { if (!drag || h?.b !== 'mine') return; const s = ships[drag.i], r = Math.floor(h.c / BS.N), c = h.c % BS.N, n = { ...s, r: s.h ? r : r - drag.off, c: s.h ? c - drag.off : c }; if (n.r === s.r && n.c === s.c) return; if (setShip(drag.i, n)) drag.moved = true; };
  const up = h => { const d = downAt; downAt = null;
    if (drag) { if (!drag.moved && drag.wasSel && h?.b === 'mine' && BS.shipAt(ships, h.c) === drag.i) rotate(); drag = null; return; }
    if (h && d && h.b === 'enemy' && d.b === 'enemy' && h.c === d.c) fire(h.c); };
  const fire = cell => { const s = st(); if (s.phase !== 'fire' || s.pending || BS.turnSeat(s) !== mySeat()) return false; return doMove({ cell }); };
  function tick() { reset(); const s = st(), k = sec(); if (M.over || !k) return; const ts = BS.turnSeat(s); if (ts !== mySeat()) return;
    if (s.phase === 'place' && !s.commits[myTeam()]) doMove({ commit: k.commit });
    else if (s.pending && 1 - BS.team(s.pending.by) === myTeam()) doMove(BS.answer(k.grid, s.shots[myTeam()], s.pending.cell)); }
  const shownShips = () => (sec()?.ships || (placing() ? ships : [])).map(sh => ({ ...sh, cells: BS.shipCells(sh) }));
  const panel = () => { const el = $('#m-extra'); if (!el) return; const s = st(), k = placing() ? 'place:' + (sel ?? '') + tip : s.phase === 'place' ? (isKeeper() ? 'wait' : 'mate') : 'battle';
    if (k === panelKey) return; panelKey = k;
    if (placing()) { el.innerHTML = `<div class="arc-pad bs-place"><p class="small muted bs-tip">Deploy your fleet: drag a ship to move it, tap a selected ship (or Rotate) to turn it.${tip ? ' · <b>' + tip + '</b>' : ''}</p><div class="row gap"><button id="bs-rot" ${sel == null ? 'disabled' : ''}>⟳ Rotate</button><button id="bs-rnd">🎲 Random</button><button id="bs-ready" class="primary">✔ Ready</button></div></div>`;
      el.querySelector('#bs-rot').onclick = () => { rotate(); panelKey = ''; }; el.querySelector('#bs-rnd').onclick = () => { random(); panelKey = ''; }; el.querySelector('#bs-ready').onclick = ready; return; }
    el.innerHTML = `<div class="arc-pad bs-place"><p class="small muted bs-tip">${k === 'wait' ? 'Fleet locked in. Waiting for the enemy to deploy…' : k === 'mate' ? 'Your teammate is deploying the team fleet…' : 'Tap a cell in enemy waters to fire. Enemy ships stay hidden; you only see hits, misses and sunk ships.'}</p></div>`; };
  const sync = view => { reset(); panel(); const s = st(), my = myTeam(), place = s.phase === 'place' && !sec() && isKeeper();
    view?.set({ mode: place ? 'place' : 'battle', mine: shownShips(), sel: place ? sel : null, bad: place ? bad : [], shotsMine: s.shots[my], shotsEnemy: s.shots[1 - my], sunkEnemy: s.sunk[1 - my], pending: s.pending && BS.team(s.pending.by) === my ? s.pending.cell : null }); };
  const mount3d = async c3 => { const V = await import('./arcade/battleship3d.js'), view = await V.battleship3d(c3); view.on('down', down); view.on('move', move); view.on('up', up); return view; };
  // 2D fallback (same rules, same r*10+c contract): boxes per layout
  const boxes = () => (st().phase === 'place' && !sec() && isKeeper() ? BOX.place : BOX.battle);
  const hit2d = (cv, e) => { const [nx, ny] = e.nx != null ? [e.nx, e.ny] : normFromClient(cv, e.clientX, e.clientY); for (const [b, box] of Object.entries(boxes())) { const h = cellAt(nx, ny, BS.N, { W: cv.width, H: cv.height, box }); if (h) return { b, c: h[1] * BS.N + h[0] }; } return null; };
  const mount2d = cv => { cv.style.touchAction = 'none'; cv.addEventListener('pointerdown', e => { cv.setPointerCapture?.(e.pointerId); down(hit2d(cv, e)); }); cv.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') move(hit2d(cv, e)); }); cv.addEventListener('pointerup', e => up(hit2d(cv, e))); };
  const draw2d = (ctx, Pp, FX, grid) => { sync(null); const s = st(), my = myTeam();
    for (const [b, [x0, y0, sz]] of Object.entries(boxes())) { const cs = grid(BS.N, x0, y0, sz), shots = s.shots[b === 'mine' ? my : 1 - my]; ctx.fillStyle = Pp.mut; ctx.font = `500 13px ${Pp.mono}`; ctx.fillText((b === 'mine' ? 'your fleet' : 'enemy waters · tap to fire').toUpperCase(), x0, y0 - 8);
      const at = i => [x0 + (i % BS.N) * cs, y0 + Math.floor(i / BS.N) * cs];
      if (b === 'mine') shownShips().forEach((sh, i) => { for (const c of sh.cells) { const [x, y] = at(c); ctx.fillStyle = i === sel && boxes() === BOX.place ? Pp.acid : Pp.cy; ctx.globalAlpha = .35; ctx.fillRect(x + 2, y + 2, cs - 4, cs - 4); ctx.globalAlpha = 1; } });
      else for (const cells of s.sunk[1 - my]) for (const c of cells) { const [x, y] = at(c); ctx.fillStyle = Pp.hot; ctx.globalAlpha = .25; ctx.fillRect(x + 2, y + 2, cs - 4, cs - 4); ctx.globalAlpha = 1; }
      for (let i = 0; i < BS.N * BS.N; i++) { const [x, y] = at(i); if (shots[i] === 2) FX.neonCircle(ctx, x + cs / 2, y + cs / 2, cs * .3, Pp.hot); else if (shots[i] === 1) { ctx.fillStyle = Pp.mut; ctx.beginPath(); ctx.arc(x + cs / 2, y + cs / 2, cs * .1, 0, 7); ctx.fill(); } } } };
  const api = { sync, tick, mount3d, mount2d, draw2d, down, move, up, fire, rotate, random, ready, get ships() { return ships; }, get sel() { return sel; }, placing, hit2d };
  globalThis.__cmBS = { M, ctl: api }; return api;
}
