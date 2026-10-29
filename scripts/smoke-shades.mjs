// Same-theme colour collisions: first player of a theme = pure theme colour; up to 100 same-theme players all get
// perceptually distinct shades (OKLab ΔE >= MIN_DE) in the same hue family, deterministically. Every theme checked.
const F = await import('../src/arcade/fx.js'), { THEMES } = await import('../src/theme.js');
let fail = 0; const assert = (c, m) => { if (c) console.log('ok', m); else { console.log('FAIL', m); fail = 1; } };
for (const t of THEMES) { const base = F.themeAccent(t[0]); const ps = Array.from({ length: 100 }, (_, i) => ({ code: 'P' + String(i).padStart(3, '0'), color: base }));
  const r = F.distinctColors(ps), labs = r.map(c => F.hexToOklab(c.color)); let m = 9; for (let i = 0; i < 100; i++) for (let j = i + 1; j < 100; j++) m = Math.min(m, F.deltaE(labs[i], labs[j]));
  const hue = h => F.hexToOklab(h), H = x => Math.atan2(x[2], x[1]), b0 = hue(base), off = Math.max(...labs.map(l => Math.abs(Math.atan2(Math.sin(H(l) - H(b0)), Math.cos(H(l) - H(b0))))));
  assert(r[0].color.toLowerCase() === base.toLowerCase() && new Set(r.map(c => c.color)).size === 100 && m >= F.MIN_DE - 1e-9 && off < 0.6, `${t[0]}: 100 same-theme players -> pure first + 99 distinct shades (min ΔE ${m.toFixed(3)}, hue within ±${(off * 57.3).toFixed(0)}°)`);
  const again = F.distinctColors([...ps].reverse()); assert(JSON.stringify(again.map(c => [c.code, c.color])) === JSON.stringify(r.map(c => [c.code, c.color])), `${t[0]}: deterministic (order-independent)`); }
console.log(fail ? 'SHADES SMOKE FAILED' : 'ALL SHADES SMOKE OK'); process.exit(fail);
