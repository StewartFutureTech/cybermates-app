// Every arcade game starts with ZERO other humans (AI fills every seat/slot), AI skill varies, AI swaps out for humans
// (mass: immediately/mid-round; matches: next round), match hubs ≤100, and the single shared palette (no hardcoded colours).
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
import fs from 'node:fs';
const M = await import('../src/arcade/match.js'), E = await import('../src/arcade/engine.js'), I = await import('../src/arcade/instance.js');
const { snake } = await import('../src/arcade/snake.js'), { tron } = await import('../src/arcade/tron.js'), { FleetRoom } = await import('../src/arcade/megaship.js'), DG = await import('../src/arcade/games/drawguess.js');
const me = { code: 'ME', age: 30, name: 'me' };
// ---- matches: every game x mode starts with only me
let n = 0; for (const g of Object.values(M.GAMES)) for (const mode of g.modes.filter(m => m in M.MODES)) { const mm = new M.Matchmaker({ now: () => 0 }); mm.enqueue(me, g.id, mode); const r = mm.tryForm(mm.key(g.id, mode, me), g.id, mode, true);
  const x = r.match; assert(x.seats.length === M.MODES[mode] && x.seats.filter(s => s.ai).length === M.MODES[mode] - 1 && x.seats.every(s => !s.ai || /AI-/.test(s.code)), `${g.id} ${mode}: starts with just me + ${M.MODES[mode] - 1} AI`);
  if (g.kind === 'turn') { let k = 0; for (; k < 400 && !x.over; k++) { const ts = x.mod.turnSeat(x.state); if (ts == null) break; if (x.seats[ts].ai) { if (!x.aiMove(ts)) break; } else { const mv = x.mod.ai(x.state, ts, Math.random); if (!mv || !x.receive({ mid: x.id, seq: x.seq + 1, seat: ts, move: mv, prev: x.head, sig: 'ai' }).ok) { x.seats[ts].ai = true; } } } assert(x.seq > 0, `${g.id} ${mode}: AI keeps the game moving (${x.seq} moves)`); }
  n++; }
assert(n === 18, 'all 18 game/mode combos covered (10 match games incl. tic-tac-toe)');
// ---- AI skill + natural mistakes
const mm = new M.Matchmaker({ now: () => 0 }); const skills = []; for (let i = 0; i < 12; i++) { mm.enqueue({ code: 'S' + i, age: 30 }, 'trivia', '4v4'); const r = mm.tryForm(mm.key('trivia', '4v4', { code: 'S' + i, age: 30 }), 'trivia', '4v4', true); skills.push(...r.match.seats.filter(s => s.ai).map(s => s.skill)); }
assert(Math.min(...skills) >= 0.3 && Math.max(...skills) <= 0.9 && new Set(skills).size > 5, `AI skill varies ${Math.min(...skills)}..${Math.max(...skills)}`);
const acc = sk => { let ok = 0, tot = 0; for (let t = 0; t < 30; t++) { const x = new M.Match({ id: 'tq' + sk + t, game: 'trivia', mode: '1v1', seats: [{ code: 'a', ai: true, skill: sk, team: 0 }, { code: 'b', ai: true, skill: sk, team: 1 }] }); const right = x.mod.BANK[x.state.qs[0]][2]; x.aiMove(0); tot++; ok += x.state.score[0] > 0 ? 1 : 0; } return ok / tot; };
assert(acc(0.85) > acc(0.35), `trivia AI accuracy tracks skill (${acc(0.85).toFixed(2)} vs ${acc(0.35).toFixed(2)})`);
{ let wins = [0, 0]; for (let t = 0; t < 12; t++) { const x = new M.Match({ id: 'cf' + t, game: 'connect4', mode: '1v1', seats: [{ code: 'g', ai: true, skill: 0.9, team: 0 }, { code: 'w', ai: true, skill: 0.2, team: 1 }] }); for (let i = 0; i < 60 && !x.over; i++) x.aiMove(x.mod.turnSeat(x.state)); if (x.over && !x.over.draw) wins[x.over.winner]++; } assert(wins[0] > wins[1], `strong AI beats weak AI more often (connect4 ${wins.join('-')}): mistakes are real`); }
// ---- swap AI -> human at next round (matches)
const x = new M.Match({ id: 'sw', game: 'chess', mode: '1v1', seats: [{ ...me, team: 0 }, { code: 'AI-9', ai: true, skill: .5, team: 1 }] }); x.queueHuman({ code: 'FRIEND', age: 31 });
assert(x.seats.some(s => s.code === 'AI-9'), 'human waits: AI keeps playing this round'); x.rematch(); assert(x.seats.some(s => s.code === 'FRIEND') && !x.seats.some(s => s.code === 'AI-9'), 'next round: AI swapped out for the real player');
const xk = new M.Match({ id: 'sw2', game: 'chess', mode: '1v1', seats: [{ ...me, team: 0 }, { code: 'AI-1', ai: true, team: 1 }] }); xk.queueHuman({ code: 'KID', minor: true }); xk.rematch(); assert(!xk.seats.some(s => s.code === 'KID'), 'swap-in keeps adult/minor separation');
// ---- mass games: start alone, bots step aside mid-round
for (const [name, mk] of [['snake', () => new I.InstanceManager({ game: snake, gameName: 'snake' })], ['tron', () => new I.InstanceManager({ game: tron, gameName: 'tron' })], ['megaship', () => new I.InstanceManager({ gameName: 'megaship', factory: id => new FleetRoom({ id }) })], ['drawguess', () => new I.InstanceManager({ gameName: 'drawguess', factory: id => new DG.DrawRoom({ id }) })]]) {
  const L = mk(); const w = L.join('ME'); const b0 = w.bots().length; for (let i = 0; i < 20; i++) w.step(Math.random); assert(b0 > 0 && w.humans().length === 1, `${name}: starts with just me + ${b0} AI`); L.join('H2'); assert(w.bots().length === b0 - 1, `${name}: a joining human replaces a bot mid-round`); }
{ const r = new DG.DrawRoom({ id: 'dg' }); r.add('ME'); let strokes = 0, guesses = 0; const rng = E.mulberry32(4); for (let i = 0; i < 400; i++) { const before = r.state.log.length; if (DG.drawers(r.state).includes('ME')) r.move('ME', { next: 1 }); r.step(rng, 0); guesses += r.state.log.length - before; strokes = Math.max(strokes, r.state.strokes.length); }
  assert(strokes >= 2 && guesses > 0, `draw&guess AI: drawers use the stroke library (${strokes} strokes), guessers guess (${guesses})`); }
// ---- hubs ≤100
const mh = new M.Matchmaker(); for (let i = 0; i < 205; i++) mh.hubs.join('P' + i); assert(mh.hubs.list.length === 3 && mh.hubs.list[0].members.size === 100 && mh.hubs.list[2].links.length === 2, 'match lobbies grouped in linked mesh hubs of ≤100');
assert(mh.key('chess', '1v1', { code: 'P150', age: 30 }).endsWith('hub-2'), 'matchmaking happens inside your hub');
// ---- single palette source: no hardcoded colours in any arcade renderer / game
const files = ['src/arcade-ui.js', 'src/match-ui.js', ...fs.readdirSync('src/arcade').filter(f => f.endsWith('.js') && f !== 'fx.js').map(f => 'src/arcade/' + f), ...fs.readdirSync('src/arcade/games').map(f => 'src/arcade/games/' + f)];
const bad = []; for (const f of files) { const t = fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, ''); for (const re of [/['"`]#[0-9a-fA-F]{3,8}['"`]/g, /\b0x[0-9a-fA-F]{6}\b(?![0-9a-fA-F])/g, /rgba?\(\s*\d/g, /['"`]hsl\(/g, /\bhsl\(\$\{/g]) for (const m of t.match(re) || []) if (!/0x6D2B79F5|0x[0-9a-fA-F]{8}/.test(m)) bad.push(f + ': ' + m); }
assert(!bad.length, 'no hardcoded colours outside fx.js' + (bad.length ? ' -> ' + bad.slice(0, 6).join(', ') : ''));
const renderers = ['src/arcade-ui.js', 'src/match-ui.js', 'src/arcade/three-scene.js', 'src/arcade/glass3d.js', 'src/arcade/board3d.js', 'src/arcade/c4-3d.js', 'src/arcade/paddle3d.js', 'src/arcade/tron3d.js', 'src/arcade/space3d.js'];
for (const f of renderers) { const t = fs.readFileSync(f, 'utf8'); assert(/from '\.\/(arcade\/)?fx\.js'|from '\.\/three-scene\.js'/.test(t) && (/swatch\(|palette\(|S\.color\(|S\.tint\(|FX\./.test(t)), `${f.split('/').pop()} reads the shared palette`); }
const fx = fs.readFileSync('src/arcade/fx.js', 'utf8'); assert(/getComputedStyle/.test(fx) && /onThemeChange/.test(fx) && /themeAccent/.test(fx) && /distinctColors/.test(fx), 'fx.js: theme tokens, live theme switch, per-player theme accent, clash hue-shift');
const FX = await import('../src/arcade/fx.js'); const dc = FX.distinctColors([{ code: 'a', color: '#19e6ff' }, { code: 'b', color: '#19e6ff' }, { code: 'c', color: '#ff5ec8' }]);
assert(dc.find(c => c.code === 'b').shade === 1 && dc.find(c => c.code === 'b').color !== dc.find(c => c.code === 'a').color && dc.find(c => c.code === 'a').color === '#19e6ff', 'same-theme opponents: first keeps the pure theme colour, the next gets a distinct shade of it');
console.log('ALL ARCADE-AI/PALETTE SMOKE OK');
{ const { readdirSync, readFileSync, statSync } = await import('node:fs'); const { join } = await import('node:path');
  const walk = d => readdirSync(d).flatMap(n => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const root = new URL('../src/arcade', import.meta.url).pathname, files = [...walk(root), new URL('../src/arcade-ui.js', import.meta.url).pathname, new URL('../src/match-ui.js', import.meta.url).pathname, new URL('../src/brawl-ui.js', import.meta.url).pathname];
  const bad = files.filter(f => /['"`]#[0-9a-fA-F]{3,8}['"`]|rgba?\(\s*\d/.test(readFileSync(f, 'utf8')));
  if (bad.length) { console.error('FAIL hardcoded colors in', bad); process.exit(1); } console.log('ok no hardcoded color literals in arcade/match code (theme tokens only)'); }

