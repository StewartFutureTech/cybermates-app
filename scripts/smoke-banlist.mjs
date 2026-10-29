// Gossiped signed ban list: forged ignored, valid ban + lift propagate via anti-entropy, banned peer refused + killed, sizes.
import * as G from '../src/membership.js';
import nodeCrypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
globalThis.localStorage ||= (() => { const m = {}; return { getItem: k => m[k] ?? null, setItem: (k, v) => m[k] = String(v), removeItem: k => delete m[k] }; })();
G.setEd25519({ keyPair: () => { const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ed25519'); return { publicKey: new Uint8Array(publicKey.export({ format: 'der', type: 'spki' }).subarray(12)), secretKey: privateKey }; },
  sign: (m, sk) => new Uint8Array(nodeCrypto.sign(null, m, sk)), verify: (m, sig, pub) => nodeCrypto.verify(null, m, nodeCrypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(pub)]), format: 'der', type: 'spki' }), sig) });
G.CFG.settleMs = 0;
const K = ({ ...(await import('../src/killswitch.js')), ...(await import('./lib/sign.mjs')) }), BL = await import('../src/banlist.js'), B = await import('../src/ban.js'), V = await import('../src/vault.js');
const k = K.keygen(), pub = k.publicKey, sgn = o => K.sign(K.makeMsg({ ttlMs: 365 * 864e5, ...o }), k.privateKey);
const rng = G.seededRng(11), net = new G.SimNet(rng), SH = 'global';
let blMsgs = 0; const deliver = net.deliver.bind(net); net.deliver = (f, t, m) => { if (/^bl/.test(m.t)) blMsgs++; deliver(f, t, m); };
const N = 30, kicks = [];
const nodes = Array.from({ length: N }, (_, i) => { const m = new G.Member({ code: 'B' + String(i).padStart(6, '0'), profile: {}, now: net.now, net, rng }); m.banlist = new BL.BanList({ pubkey: pub }); m.onBan = c => kicks.push([m.code, c]); net.nodes.set(m.code, m); return m; });
const rows = nodes.map(n => n.row(SH)); for (const n of nodes) for (const r of rows) { n.pins.set(r.code, r.pub); n.active.set(n.key(SH, r.code), r); n.links.add(r.code); }
const flush = () => new Promise(r => setImmediate(r));
const rounds = async n => { for (let i = 0; i < n; i++) { nodes.filter(x => x.alive).forEach(x => x.syncWith(SH)); for (let j = 0; j < 6; j++) { net.run(net.t + 200); await flush(); await flush(); } } };
const X = nodes[7].code, others = nodes.filter(n => n.code !== X);
// steady state: equal hashes -> zero ban-list traffic
blMsgs = 0; await rounds(2); assert(blMsgs === 0, 'equal ban-list hashes: no ban-list messages on anti-entropy (no extra traffic)');
// forged
const forged = K.sign(K.makeMsg({ type: 'kill', scope: 'user:' + X }), K.keygen().privateKey);
assert((await nodes[0].mergeBans([forged])) === 0 && !nodes[0].banlist.isBanned(X), 'forged ban entry ignored');
assert((await nodes[0].mergeBans([{ ...sgn({ type: 'kill', scope: 'user:' + X }), scope: 'user:' + nodes[3].code }])) === 0, 'tampered entry (scope swapped) ignored');
// valid ban propagates
const ban = sgn({ type: 'kill', scope: 'user:' + X, reason: 'test ban' });
await nodes[0].mergeBans([ban]); blMsgs = 0; await rounds(12);
const cov = others.filter(n => n.banlist.isBanned(X)).length; assert(cov === others.length, `valid ban propagated to ${cov}/${others.length} phones via digest hash mismatch (${blMsgs} ban-list msgs)`);
assert(others.every(n => ![...n.active.values()].some(r => r.code === X)), 'banned code removed from every active list (presence not relayed)');
// banned peer reconnects via cached addresses/links
kicks.length = 0; nodes[7].syncWith(SH, nodes[5].code); nodes[7].send(nodes[12].code, { t: 'join', id: 'zz', shard: SH, row: nodes[7].row(SH), ttl: 3, from: X }); net.run(net.t + 500); await flush();
assert(kicks.some(([by, c]) => by === nodes[5].code && c === X) && kicks.some(([by]) => by === nodes[12].code), 'banned peer reconnecting is refused (onBan fired at each contacted phone)');
assert(!nodes[5].accept(nodes[7].row(SH)), 'banned row never re-accepted');
{ // the app sends the stored signed entry as the kill (app-mesh kick -> {k:'ctl', src:'ban-list'}); target wipes active list + disconnects
  const store = new V.MemorySecretStore(); const vault = await new V.Vault({ store, info: 'x' }).load(); await vault.init({ meshIds: {} });
  const disk = (() => { const m = {}; return { _m: m, getItem: q => m[q] ?? null, setItem: (q, v) => m[q] = String(v), removeItem: q => delete m[q] }; })();
  disk.setItem('cybermates:active-list:x', 'legacy'); let stopped = false;
  const fm = { node: { presence: new Map(), live: new Map(), cache: new Map(), friends: new Map(), chats: new Map() }, member: { active: new Map([[1, 1]]) }, async stop() { stopped = true; } };
  localStorage.removeItem('cybermates:kill'); localStorage.removeItem('cybermates:mesh-kill-nonces');
  const entry = nodes[5].banlist.entry(X); const r = await B.applyControl({ ...entry }, { code: X, vault, mesh: fm, pubkey: pub, source: 'record', storage: disk });
  assert(r.applied === 'ban' && stopped && !Object.keys(disk._m).length && !fm.member.active.size, 'kicked banned phone applies the signed kill (even hours later): in-memory list cleared, legacy file purged, disconnected');
  localStorage.removeItem('cybermates:kill'); }
// unban lift propagates
const lift = sgn({ type: 'clear', scope: 'user:' + X, ttlMs: 30 * 864e5 }); await nodes[20].mergeBans([lift]); await rounds(12);
assert(others.every(n => !n.banlist.isBanned(X)), 'signed lift propagated: code unbanned everywhere');
assert((await nodes[1].mergeBans([ban])) === 0 && !nodes[1].banlist.isBanned(X), 'older ban cannot override a newer lift');
const flift = K.sign(K.makeMsg({ type: 'clear', scope: 'user:' + nodes[2].code }), K.keygen().privateKey); await nodes[0].mergeBans([sgn({ type: 'kill', scope: 'user:' + nodes[2].code })]); await nodes[0].mergeBans([flift]);
assert(nodes[0].banlist.isBanned(nodes[2].code), 'forged lift ignored');
assert(nodes[5].accept({ ...nodes[7].row(SH) }) !== undefined, 'unbanned row accepted again');
// encrypted at rest
{ const vault = await new V.Vault({ store: new V.MemorySecretStore(), info: 'a' }).load(); await vault.init({}); const disk = { m: {}, getItem(q) { return this.m[q] ?? null; }, setItem(q, v) { this.m[q] = v; } };
  await nodes[0].banlist.save(vault, disk); const raw = disk.getItem('cybermates:ban-list'); assert(!raw.includes(nodes[2].code), 'ban list at rest is ciphertext');
  const nb = new BL.BanList({ pubkey: pub }); assert((await nb.load(vault, disk)) >= 1 && nb.isBanned(nodes[2].code), 'ban list decrypts on this device');
  const other = await new V.Vault({ store: new V.MemorySecretStore(), info: 'a' }).load(); const nb2 = new BL.BanList({ pubkey: pub }); assert((await nb2.load(other, disk)) === 0, 'copied ban list fails to decrypt on another device'); }
// sizes
for (const n of [1000, 10000]) { const tpl = sgn({ type: 'kill', scope: 'user:C0', reason: '' }); // sizes only: real-size random 64-byte sigs / 16-byte nonces (signing 10k with tweetnacl is slow)
  const entries = Array.from({ length: n }, (_, i) => BL.encodeEntry({ ...tpl, scope: 'user:' + ('C' + i).padEnd(10, 'X'), nonce: nodeCrypto.randomBytes(16).toString('base64'), sig: nodeCrypto.randomBytes(64).toString('base64'), issued_at: tpl.issued_at + i }));
  const json = JSON.stringify(entries), gz = gzipSync(json).length, idx = JSON.stringify(entries.map(e => [e[1], e[3]])).length;
  console.log(`  BAN LIST ${n}: full ${(json.length / 1024).toFixed(0)} KB (${Math.round(json.length / n)} B/entry), gzip ${(gz / 1024).toFixed(0)} KB, diff index ${(idx / 1024).toFixed(0)} KB, hash on each pull: ~7 B`); }
assert(true, 'ban-list sizes reported');
