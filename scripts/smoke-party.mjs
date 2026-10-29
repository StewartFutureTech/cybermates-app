// (e) party games: Bingo, Mass Trivia, Tic-tac-toe, global party voice (budget + age band).
import * as BG from '../src/party/bingo.js'; import * as MT from '../src/party/mtrivia.js'; import * as T from '../src/arcade/games/ttt.js';
let fail = 0; const ok = (c, m) => { console.log(c ? 'ok' : 'FAIL', m); if (!c) fail = 1; };
globalThis.localStorage ??= { getItem: () => null, setItem() {} };
const { PartyVoice } = await import('../src/party/voice.js');
// bingo
const c = BG.card('ME', 0); ok(c.length === 25 && c[12] === 0, 'bingo card 25 with free centre');
ok([0, 1, 2, 3, 4].every(col => [0, 1, 2, 3, 4].every(r => { const v = c[r * 5 + col]; return v === 0 || (v > col * 15 && v <= col * 15 + 15); })), 'columns B/I/N/G/O ranges');
ok(String(BG.sequence('r', 1)) === String(BG.sequence('r', 1)) && new Set(BG.sequence('r', 1)).size === 75, 'deterministic 75-ball sequence');
const R = new BG.BingoRoom({ id: 'b1', now: 0 }); R.add('ME'); ok(R.bots().length === 7, 'room bot-filled to 8');
ok(R.claim('ME', 1).ok === false, 'early claim rejected');
const card = R.cardOf('ME'), seq = BG.sequence('b1', 0); const row = [0, 1, 2, 3, 4]; const need = row.map(i => card[i]); const at = Math.max(...need.map(n => seq.indexOf(n))) ; const t = at * R.callMs + 1;
ok(R.daub('ME', 0, 0) === (seq[0] === card[0]), 'cannot daub an uncalled number');
row.forEach(i => R.daub('ME', i, t)); const r = R.claim('ME', t); ok(r.ok && r.line.join() === '0,1,2,3,4', 'top-row BINGO validated');
ok(R.leaderboard()[0].code === 'ME', 'winner on leaderboard'); R.step(Math.random, t + BG.NEXT_MS + 10); ok(R.round === 1, 'new round after win');
ok(BG.SPEEDS.fast === 10000 && BG.SPEEDS.classic === 60000 && BG.ROOM_CAP === 200, 'caller 10 s / 1 min; cap 200');
// mass trivia
const Q = new MT.TriviaRoom({ id: 'm1', now: 0 }); Q.add('ME'); const q0 = Q.question(10); ok(q0 && q0.q === 0, 'first question');
ok(Q.answer('ME', 0, q0.right, 10).correct && Q.players.get('ME').pts === 10, 'first correct = 5 + 5 speed bonus'); ok(!Q.answer('ME', 0, 1, 20).ok, 'one answer per question');
for (let k = 0; k < 500; k++) Q.step(Math.random, k * 400); ok(Q.set >= 1, 'set completes, podium, restarts'); ok(MT.ROOM_CAP === 200, 'mass trivia cap 200');
// ttt
let s = T.init(); for (const k of [0, 3, 1, 4, 2]) s = T.apply(s, T.legal(s, { k }, s.seat)); ok(T.result(s)?.winner === 0, 'ttt X wins top row'); ok(!T.legal(s, { k: 8 }, 1), 'no moves after win');
let d = T.init(); for (const k of [0, 1, 2, 4, 3, 5, 7, 6, 8]) d = T.apply(d, { k }); ok(T.result(d)?.draw, 'ttt draw'); ok(T.ai(T.apply(T.apply(T.init(), { k: 0 }), { k: 4 }), 0, () => 0).k != null, 'ttt ai moves');
// voice
let now = 0; const v = new PartyVoice({ me: { age: 30 }, now: () => now }); ok(!v.start().ok, 'voice off by default'); await v.setEnabled(true);
ok(v.start().maxMs === 10000, 'press capped at 10 s'); now = 12000; ok(v.tick() === 'cut' && !v.talking, 'auto-cut at 10 s'); now = 20000; ok(v.start().reason === 'budget', '10 s per minute budget enforced');
now = 71000; ok(v.start().ok, 'budget refills after a minute'); v.stop();
const heard = v.update([{ code: 'A', adult: true }, { code: 'K', minor: true }, { code: 'BOT-1', bot: true, adult: true }], 'ME', () => true); ok(heard.join() === 'A', 'adult hears adults only, never minors or bots');
const kid = new PartyVoice({ me: { age: 12 }, parent: { allowed: async () => false } }); ok((await kid.setEnabled(true)).reason === 'parent-disabled', 'minor needs parent permission');
process.exit(fail);
