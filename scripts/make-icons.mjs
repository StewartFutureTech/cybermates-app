// Rasterise the original SVG icons → PWA PNGs + Android launcher mipmaps (headless Chrome). node scripts/make-icons.mjs
import fs from 'fs'; import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] }); const p = await b.newPage();
const shot = async (svgFile, size, out, round = false) => { const svg = fs.readFileSync(svgFile, 'utf8'); await p.setViewport({ width: size, height: size });
  await p.setContent(`<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;${round ? 'border-radius:50%;overflow:hidden;' : ''}">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</div></body>`);
  await p.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } }); };
await shot('public/icon.svg', 192, 'public/icon-192.png'); await shot('public/icon.svg', 512, 'public/icon-512.png'); await shot('public/icon.svg', 180, 'public/icon-180.png');
await shot('public/icon-maskable.svg', 512, 'public/icon-maskable-512.png');
const R = 'android/app/src/main/res', D = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
if (fs.existsSync(R)) for (const [d, k] of Object.entries(D)) { const dir = `${R}/mipmap-${d}`;
  await shot('public/icon-maskable.svg', 48 * k, `${dir}/ic_launcher.png`); await shot('public/icon-maskable.svg', 48 * k, `${dir}/ic_launcher_round.png`, true);
  await shot(process.argv[2] || 'scripts/icon-foreground.svg', 108 * k, `${dir}/ic_launcher_foreground.png`); }
console.log('icons ok'); await b.close();
