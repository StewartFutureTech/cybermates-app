// In-game friend requests: menu actions for real players only; hidden for AI/self/blocked; no Add friend across age bands.
import { menuActions, nameAttrs, isAI } from '../src/player-menu.js';
let f = 0; const ok = (c, m) => { console.log(c ? 'ok' : 'FAIL', m); if (!c) f = 1; };
const me = { code: 'ME', age: 30 }, adult = { code: 'X1', name: 'Ann', age: 25 }, kid = { code: 'K1', name: 'Kid', minor: true };
const ids = o => menuActions(o).map(a => a.id + (a.disabled ? '!' : ''));
ok(ids({ target: adult, me }).join() === 'add,report,block', 'real adult: Add friend / Report / Block');
ok(!ids({ target: { code: 'AI-3', name: 'bot 3', ai: true }, me }).length && !ids({ target: { code: 'b1', bot: true }, me }).length, 'AI: no menu');
ok(!ids({ target: { code: 'ME' }, me }).length, 'self: no menu');
ok(!ids({ target: adult, me, blocked: new Set(['X1']) }).length, 'blocked: no menu');
ok(ids({ target: kid, me }).join() === 'report,block', 'adult viewing minor: no Add friend (age band)');
ok(ids({ target: adult, me: { code: 'K2', minor: true } }).join() === 'report,block', 'minor viewing adult: no Add friend');
ok(ids({ target: kid, me: { code: 'K2', minor: true } })[0] === 'add', 'minor↔minor: Add friend allowed');
ok(ids({ target: adult, me, friends: new Set(['X1']) })[0] === 'friend!', 'already friends: shown, disabled');
ok(ids({ target: adult, me, pendingOut: new Set(['X1']) })[0] === 'add!', 'pending: Request sent (disabled)');
ok(nameAttrs({ code: 'AI-1', ai: true }, 'ME') === '' && nameAttrs({ code: 'ME' }, 'ME') === '' && /data-pcode="X1"/.test(nameAttrs(adult, 'ME')), 'names tappable only for real other players');
ok(isAI({ code: 'AI-9' }), 'AI-* code treated as AI');
console.log(f ? 'PMENU FAILED' : 'PMENU OK'); process.exit(f);
