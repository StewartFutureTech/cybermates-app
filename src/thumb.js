// Owner-side stub thumbnail: 32x32 pixelated, low-quality JPEG data URL (<= 4 KB) shipped with presence.
export async function makeThumb(src, size = 32) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d');
  const s = Math.min(img.width, img.height); x.imageSmoothingEnabled = false;
  x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
  for (let q = 0.5; q > 0.05; q -= 0.1) { const u = c.toDataURL('image/jpeg', q); if (u.length <= 4096) return u; }
  return '';
}
// Local demo only: seed profiles rotate online/offline every 10 minutes (no real presence without peers).
export const demoLastSeen = (id, now = Date.now()) => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; const slot = Math.floor(now / 6e5);
  return (h + slot) % 3 === 0 ? now - 60e3 : now - (((h >> 3) % 40) + 6) * 3600e3 / 10; };
