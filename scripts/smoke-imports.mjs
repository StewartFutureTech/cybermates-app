// Guard: a module calls a helper exported by a sibling module without importing it (caught live: board3d used themeColor
// without the import, so chess/checkers 3D silently fell back to 2D). Checks every src/**/*.js against all src exports.
import fs from 'fs'; import path from 'path';
const files = []; (function w(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? w(p) : p.endsWith('.js') && files.push(p); } })('src');
const exp = new Map(); for (const f of files.filter(f => /(three-scene|arcade[\/]fx|theme|logo|nav-icons)\.js$/.test(f))) for (const m of fs.readFileSync(f, 'utf8').matchAll(/export (?:async )?(?:function|const|let|class) ([A-Za-z_$][\w$]*)/g)) exp.set(m[1], f);
let fail = 0;
for (const f of files) { const s = fs.readFileSync(f, 'utf8'), code = s.replace(/\/\/.*$/gm, '').replace(/'(?:\\.|[^'])*'|"(?:\\.|[^"])*"|`(?:\\.|[^`])*`/g, "''");
  for (const [n, src] of exp) { if (src === f || n.length < 5) continue; if (!new RegExp(`(?<![\\w$.])${n.replace('$', '\\$')}\\s*\\(`).test(code)) continue;
    const local = new RegExp(`(?:function|const|let|var|class)\\s+${n}\\b|[{,]\\s*${n}\\s*[,}]|\\b${n}\\s*[,)]\\s*=>|\\(\\s*${n}\\b|import\\s+${n}\\b|as\\s+${n}\\b`).test(s);
    if (!local) { console.log(`FAIL ${f} calls ${n}() (exported by ${src}) without importing it`); fail++; } } }
console.log(fail ? `smoke-imports: ${fail} FAIL` : `PASS smoke-imports (${files.length} files)`); process.exit(fail ? 1 : 0);
