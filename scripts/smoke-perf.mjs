// Models + performance pass (glow/bloom always on) (static, pure node): adaptive quality touches only resolution + bloom (never refraction),
// 60 fps thresholds, hidden-tab pause, canvas-texture throttling, Draw & Guess 3D easel/stylus.
import { readFileSync } from 'node:fs'; const src = f => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const S = src('arcade/three-scene.js'); const q = S.slice(S.indexOf('ADAPTIVE QUALITY'), S.indexOf('const loop = t =>'));
ok(q.length > 200 && !/transmission|\\bior\\b|thickness|material/.test(q.replace(/\/\/.*$/gm, '')), 'quality system code never touches materials (refraction kept at every tier)');
ok(/Q\.ema > 18\.5/.test(q) && /Q\.ema < 15/.test(q) && /Q\.scale/.test(q), '60 fps target: steps on 18.5 ms / 15 ms with continuous resolution scale');
ok(/defineProperty\(bp, 'enabled', \{ get: \(\) => true, set: \(\) => \{\}/.test(S) && !/bp\.enabled = (k|false|Q)/.test(S) && /setPixelRatio/.test(q) && /BQ\.res/.test(q), 'only DPR and bloom resolution vary; bloom is NEVER disabled (cm-v35: enabled/strength locked on the pass)');
ok(/webglcontextlost/.test(S) && /webglcontextrestored/.test(S) && /buildComp\(\)/.test(S) && !/r\.render\(scene, cam\); raf/.test(S), 'context loss handled: composer rebuilt, glow kept; no bloom-less render path');
ok(/visibilitychange/.test(S) && /document\?\.hidden/.test(S), 'render loop pauses while hidden');
for (const f of ['arcade/glass3d.js', 'arcade/draw3d.js']) ok(/texEvery\(\)/.test(src(f)), f + ': canvas texture upload throttled by tier');
const D = src('arcade/draw3d.js'); ok(/transmission: 1/.test(D) && /ConeGeometry/.test(D) && /particles\(/.test(D), 'Draw & Guess: glass pane + 3D stylus + ink sparks');
for (const f of ['arcade/c4-3d.js', 'arcade/grid3d.js', 'arcade/trivia3d.js', 'arcade/brawl3d.js', 'arcade/board3d.js', 'arcade/paddle3d.js', 'arcade/glass3d.js']) ok(/transmission/.test(src(f)), f + ': clear refracting glass kept');
ok(/tron3d/.test(src('arcade-ui.js')) && /snake3d/.test(src('arcade-ui.js')), 'Tron/Snake keep 3D views');
