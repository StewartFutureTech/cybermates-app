// Friend link: code format, KDF/tag, protocol over SimMesh (several joiners, auto-accept both ways), burn, expiry,
// wrong code, age bands, blocks, relays see no raw code.
import { MeshNode, SimMesh, newSigningKeys } from '../src/mesh.js';
import * as FL from '../src/friend-link.js';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
let T = 1e12; const now = () => T;
const c = FL.genCode(); ok(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(c), 'flink: code is 12 base32 chars in 3 groups (60 bits) ' + c);
ok(new Set(Array.from({ length: 200 }, () => FL.genCode())).size === 200, 'flink: 200 codes unique');
ok(FL.normalize(c.toLowerCase().replace(/-/g, ' ')) === c.replace(/-/g, '') && FL.normalize('abcd-efgh-ijkl') === 'ABCDEFGH1JK1' && !FL.normalize('short'), 'flink: typing-friendly normalize (case, spaces, I/L→1)');
const k1 = await FL.deriveKey(c, 1000), k2 = await FL.deriveKey(c.toLowerCase(), 1000), k3 = await FL.deriveKey(FL.genCode(), 1000);
ok(k1.tag === k2.tag && k1.tag !== k3.tag && k1.tag.length === 24 && !k1.tag.includes(c.replace(/-/g, '')), 'flink: tag deterministic per code, differs across codes');
ok(FL.bandsOk('adult', 'adult') && FL.bandsOk('minor', 'minor') && !FL.bandsOk('adult', 'minor') && !FL.bandsOk('minor', 'adult') && !FL.bandsOk('adult', undefined), 'flink: no adult<->minor');
// mesh harness
const sim = new SimMesh(), wire = [], nodes = {};
function mk(code, { age = 25, links = [] } = {}) { const n = new MeshNode({ code, keys: newSigningKeys(), net: { send() {} }, now, wallet: { consume: async () => true, refund: async () => ({ ok: true }) } });
  sim.add(n, links); const send = n.net.send; n.net.send = e => { wire.push(JSON.stringify(e)); send(e); }; const fwd = n.net.forward; n.net.forward = (e, x) => { wire.push(JSON.stringify(e)); fwd(e, x); };
  n.minor = age < 18; const me = { age }, blocked = new Set();
  const fl = new FL.FriendLinks({ node: n, me, now, iters: 1000, isBlocked: x => blocked.has(x), isBanned: () => false, requestFriend: x => n.requestFriend(x) }).install();
  return (nodes[code] = { n, fl, blocked }); }
const H = mk('HOST'), R = mk('RELAY', { links: ['HOST'] }), A = mk('ALICE', { links: ['RELAY'] }), B = mk('BOB', { links: ['RELAY'] }), K = mk('KID', { age: 15, links: ['RELAY'] }), X = mk('XBLK', { links: ['RELAY'] }), Z = mk('ZED', { links: ['RELAY'] });
for (const a of Object.values(nodes)) for (const b of Object.values(nodes)) if (a !== b) a.n.presence.set(b.n.code, T); // all online
H.blocked.add('XBLK'); H.n.blocked.add('XBLK');
const { code } = await H.fl.open({ minutes: 15 }); const raw = code.replace(/-/g, '');
await A.fl.join(code); await tick(300);
ok(H.n.friends.has('ALICE') && A.n.friends.has('HOST'), 'flink: Alice typed the code → both phones auto-sent + auto-accepted (mutual friends)');
ok(!R.n.friends.has('ALICE') && !R.n.friends.has('HOST'), 'flink: relay is not befriended');
await B.fl.join(code.toLowerCase()); await tick(300); ok(H.n.friends.has('BOB') && B.n.friends.has('HOST') && H.fl.status().added.join() === 'ALICE,BOB', 'flink: same code adds several people while the page is open');
await K.fl.join(code); await tick(300); ok(!H.n.friends.has('KID') && !K.n.friends.has('HOST') && !H.n.pendingIn.has('KID'), 'flink: minor cannot link with adult (refused both ways)');
await X.fl.join(code); await tick(300); ok(!H.n.friends.has('XBLK') && !X.n.friends.has('HOST'), 'flink: blocked person ignored');
const wrong = FL.genCode(); await Z.fl.join(wrong); await tick(300); ok(!H.n.friends.has('ZED'), 'flink: wrong code does nothing');
ok(!wire.some(w => w.includes(raw) || w.includes(code)), 'flink: raw code never on the wire (' + wire.length + ' packets checked)');
ok(wire.filter(w => w.includes('"flj"')).every(w => !/"a":/.test(w)), 'flink: broadcast join packet carries only tag/nonce/mac (no band, no code)');
H.fl.close(); ok(!H.fl.status(), 'flink: closing the page burns the code'); await Z.fl.join(code); await tick(300); ok(!H.n.friends.has('ZED'), 'flink: burned code no longer works');
// expiry
const { code: c2 } = await H.fl.open({ minutes: 5 }); T += 5 * 60e3 + 1; await Z.fl.join(c2); await tick(300); ok(!H.n.friends.has('ZED') && !H.fl.status(), 'flink: expired code (5 min) refused and burned');
// spoof: a peer replays Alice's MAC under its own id
T += 1; const { code: c3 } = await H.fl.open(); const k = await FL.deriveKey(c3, 1000); const n0 = 'abc'; const m = await k.mac('j', 'ALICE', n0);
let replied = 0; const s0 = H.n.send.bind(H.n); H.n.send = (to, t, b, id) => { if (t === 'flo') replied++; return s0(to, t, b, id); };
H.n.receive({ id: 'spoof1', from: 'ZED', to: '*', ttl: 1, type: 'flj', body: { t: k.tag, n: n0, m } }); await tick(40); ok(replied === 0, 'flink: MAC bound to sender id (replay under another id refused)');
for (let i = 0; i < 8; i++) H.n.receive({ id: 'g' + i, from: 'ZED', to: '*', ttl: 1, type: 'flj', body: { t: k.tag, n: 'n' + i, m: '00' } }); await tick(40); ok(H.fl.tries.get('ZED') <= FL.MAX_TRIES_PER_PEER + 9, 'flink: per-peer attempts counted (rate limit)');
ok(FL.EXPIRY_CHOICES.includes(FL.DEFAULT_EXPIRY_MIN) && FL.DEFAULT_EXPIRY_MIN === 15, 'flink: default expiry 15 min, selectable ' + FL.EXPIRY_CHOICES.join('/'));
console.log('PASS smoke-flink'); process.exit(0);
