// Board picking: normalized canvas coords (0..1, from a DOM click OR a 3D ray-cast UV on the glass slab) -> board cell.
// Boards are drawn inside a box [x0, y0, size] of a W x H backing canvas (e.g. 40,50,640 of 720x720), so the margin must be
// removed before dividing — mapping the whole canvas (the old bug) shifted taps by up to a cell. Returns null outside.
export const BOARD_BOX = [40, 50, 640];
export function cellAt(nx, ny, n, { W = 720, H = 720, box = BOARD_BOX } = {}) { const [x0, y0, sz] = box, px = nx * W - x0, py = ny * H - y0;
  if (!(px >= 0 && py >= 0 && px < sz && py < sz)) return null; return [Math.min(n - 1, Math.floor(px / sz * n)), Math.min(n - 1, Math.floor(py / sz * n))]; }
// client (CSS px) -> normalized canvas coords; robust to devicePixelRatio, CSS scaling and page offset/scroll
export function normFromClient(el, clientX, clientY) { const b = el.getBoundingClientRect(); return [(clientX - b.left) / b.width, (clientY - b.top) / b.height]; }
export const utttMove = (c, r) => ({ b: Math.floor(r / 3) * 3 + Math.floor(c / 3), k: (r % 3) * 3 + c % 3 });
