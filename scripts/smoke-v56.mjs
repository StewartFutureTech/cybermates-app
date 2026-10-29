// v56: lone-phone mesh join (TDZ root cause), friend-link connecting state, roulette guard line, cross-age GAMING rule
// (default ON, parent toggle off => same band only; friends/dating/chat/voice stay band-strict), age copy, safety contact.
import { readFileSync } from 'node:fs';
import { band, gband, gameCompat, xageOk, setSelfXage, canHear } from '../src/arcade/proximity.js';
import { Matchmaker, RoundChat } from '../src/arcade/match.js';
import { TOGGLES, DEFAULT_OFF, ParentControls } from '../src/parental.js';
import { TERMS, TERMS_VERSION } from '../src/terms.js';
import { SAFETY_CONTACT } from '../src/compliance.js';
import { menuActions } from '../src/player-menu.js';
import { canLink } from '../src/rtc-voice.js';
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const rd = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// 1. root cause: presence('login') used myModes() before its const declaration (TDZ) => startMesh threw after every bootstrap 200
const am = rd('src/app-mesh.js'), dIdx = am.indexOf('const myModes = '), uIdx = am.indexOf("presence('login')");
assert(dIdx > 0 && uIdx > 0 && dIdx < uIdx, 'app-mesh: myModes declared before the first presence(\'login\') call (no TDZ)');
assert(/NO PEERS YET · LISTENING/.test(rd('src/main.js')) && /node-online/.test(rd('src/mesh-ui.js')), 'lone phone: status + Discover show online mesh node with 0 peers');
assert(/\n\s+if \(st\.tab === 'roulette' && !rouletteVisible\(st\.me\)\) st\.tab = 'discover';/.test(rd('src/main.js')), 'main.js roulette guard is real code on its own line');
assert(/if \(!m\) return `[^`]*data-flconnecting/.test(rd('src/friend-link-ui.js')), 'friend-link section renders a connecting state when mesh() is null');
// 2. age rules
const A = { code: 'AD1', age: 30 }, Mx = { code: 'MI1', minor: true, xage: true }, Mr = { code: 'MI2', minor: true, xage: false }, Mold = { code: 'MI3', minor: true };
assert(gameCompat(A, Mx) && gameCompat(Mx, A), 'adult + allowed minor can share a game');
assert(!gameCompat(A, Mr) && !gameCompat(A, Mold), 'restricted minor / old client (no xage) never seated with adults');
assert(gameCompat(Mr, Mx) && gameCompat(Mr, Mold), 'minors always compatible with minors');
assert(gband(A) === 'open' && gband(Mx) === 'open' && gband(Mr) === 'minor', 'game queue bands');
setSelfXage(null); assert(!xageOk({ id: 'p', age: 15 }), 'own minor profile: closed until parent setting loaded'); setSelfXage(true); assert(xageOk({ id: 'p', age: 15 }), 'own minor profile follows parent toggle');
const mm = new Matchmaker(); assert(mm.key('chess', '1v1', A).split('|')[2] === mm.key('chess', '1v1', Mx).split('|')[2] && mm.key('chess', '1v1', A) .split('|')[2] !== mm.key('chess', '1v1', Mr).split('|')[2], 'matchmaker: adult+allowed minor same queue, restricted minor separate');
assert('crossAgeGaming' in TOGGLES && !DEFAULT_OFF.includes('crossAgeGaming'), 'parent toggle crossAgeGaming exists, default ON');
const mem = { s: null }, P = new ParentControls({ store: { read: async () => mem.s, write: x => { mem.s = x; } }, iters: 1000 });
assert(await P.allowed('crossAgeGaming') === true, 'default allowed'); await P.setPin('1234'); await P.set('crossAgeGaming', false); assert(await P.allowed('crossAgeGaming') === false, 'parent can turn it off');
// strict separation stays
assert(band(A) !== band(Mx) && !menuActions({ target: { code: 'MI1', band: 'minor' }, me: { code: 'AD1', age: 30 } }).some(a => a.id === 'add'), 'no friend request across ages from the game screen');
{ const rc = new RoundChat('chess'); rc.text = true; assert(!rc.canMessage(Mx, A) && rc.canMessage(Mx, Mr), 'game text chat never crosses ages'); }
assert(!canLink(A, Mx) && !canHear({ ...A, x: 0, y: 0 }, { ...Mx, x: 0, y: 0 }, { enabled: true, peerEnabled: true }), 'voice never crosses ages');
const fl = rd('src/friend-link.js'); assert(/bandsOk\(band\(this\.api\.me\), b\.a\)/.test(fl), 'friend-link codes still refuse mismatched ages');
// 3. copy + contact
const T = TERMS.join(' '); assert(TERMS_VERSION === '2026-10-29.1' && /play together by default/.test(T) && /parent can turn this off/.test(T) && /should not meet in person/.test(T), 'terms carry the new age rule (re-prompt)');
assert(/should not meet in person/.test(rd('docs/help-kb.md')) && /unless a parent turns that off/.test(rd('src/compliance.js')), 'help + age gate copy updated');
assert(SAFETY_CONTACT === 'stewartfuturetech@gmail.com' && !/cybermates\.example/.test(rd('src/compliance.js')), 'safety contact is the real address');
console.log('smoke-v56 OK');
