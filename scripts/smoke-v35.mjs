// cm-v35 pure checks: chess/checkers pickup->slide->place sounds, air hockey paddle/wall/glide, bloom lock, board light 50%, idle 5 s.
globalThis.__cmSfxLog = []; let fail = 0; const ok = (c, m) => { console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail = 1; };
const { matchWatcher } = await import('../src/game-audio.js'); const fs = await import('node:fs');
for (const g of ['chess', 'checkers']) { __cmSfxLog.length = 0; const M = { log: [], seats: [{ team: 0 }], state: { b: [1, 1, 1] }, round: 1 }; const w = matchWatcher(g, M, () => 0); w.tick(); M.log.push(1); M.state = { b: [1, 1, 1] }; w.tick();
  await new Promise(r => setTimeout(r, 400)); ok(__cmSfxLog.join() === 'pickup,slide,move', `${g}: pickup -> slide -> place (${__cmSfxLog})`); }
{ __cmSfxLog.length = 0; const M = { log: [], seats: [{ team: 0 }], round: 1, state: { score: [0, 0], ball: { vx: 1, vy: 1 } } }; const w = matchWatcher('pong', M, () => 0); w.tick();
  M.state = { score: [0, 0], ball: { vx: -1, vy: 1 } }; w.tick(); await new Promise(r => setTimeout(r, 60)); M.state = { score: [0, 0], ball: { vx: -1, vy: -1 } }; w.tick(); await new Promise(r => setTimeout(r, 400)); M.state = { score: [0, 0], ball: { vx: -1, vy: -1 } }; w.tick();
  ok(['paddle', 'wall', 'glide'].every(n => __cmSfxLog.includes(n)), `air hockey: paddle hit, wall bounce, glide (${__cmSfxLog})`); }
const ts = fs.readFileSync(new URL('../src/arcade/three-scene.js', import.meta.url), 'utf8');
ok(/defineProperty\(bp, 'enabled', \{ get: \(\) => true, set: \(\) => \{\}/.test(ts), 'bloom pass enabled is locked true'); ok(/GLOW_SCALE = 0\.7/.test(ts), 'glow 0.7x'); ok(/BOARD_LIGHT = 0\.5/.test(ts), 'board light 50%');
const all = fs.readdirSync(new URL('../src/arcade/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => fs.readFileSync(new URL('../src/arcade/' + f, import.meta.url), 'utf8')).join('\n');
ok(!/(bp|bloom\w*|pass)\.enabled\s*=\s*false/i.test(all) && !/new (THREE\.)?WebGLRenderer/.test(all.replace(ts, '')), 'no game disables bloom or bypasses the shared stage');
ok(/idleS: 5, stopOnAnyTouch: true/.test(fs.readFileSync(new URL('../src/arcade/c4-3d.js', import.meta.url), 'utf8')) && /IDLE_S = 5/.test(fs.readFileSync(new URL('../src/arcade/board3d.js', import.meta.url), 'utf8')), 'idle spin resume 5 s + any-touch stop (c4, chess, checkers)');
process.exit(fail);
