// Produce dist-single/index.html with JS+CSS inlined (handy for one-file uploads).
import fs from 'fs';
const SRC = process.argv[2] || 'dist', OUT = process.argv[3] || 'dist-single';
let h = fs.readFileSync(SRC + '/index.html', 'utf8');
h = h.replace(/<script type="module" crossorigin src="\/(assets\/[^"]+)"><\/script>/, (_, p) => `<script type="module">${fs.readFileSync(SRC + '/' + p, 'utf8').replace(/<\/script/g, '<\\/script')}</script>`);
h = h.replace(/<link rel="stylesheet" crossorigin href="\/(assets\/[^"]+)">/, (_, p) => `<style>${fs.readFileSync(SRC + '/' + p, 'utf8')}</style>`);
fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(OUT + '/index.html', h);
console.log('inlined', h.length, /src="\/assets/.test(h) ? 'WARN external left' : 'ok');
