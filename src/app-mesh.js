import { stripSensitive } from './compliance.js';
// Glue: mesh messaging + gossip membership + presence stubs for the app screens.
// One identity per profile per browser profile; `?as=<seedId>` lets several tabs act as different demo users.
import { MeshNode, newSigningKeys, ONLINE_MS } from './mesh.js';
import { Member, CFG as MCFG } from './membership.js';
import { migrateIdentity } from './identity.js';
import { BlockList } from './blocklist.js';
import { E2E, newBoxKeys } from './e2e.js';
import { RelayRouter } from './relay.js';
import * as DISC from './discovery.js';
import { requestAttestation } from './attest.js';
import { guardedFetch } from './never-send.js';
const gfetch = (...a) => guardedFetch()(...a); // all app-mesh HTTP goes through the never-send guard (bus posts are guarded in net.js)
import { createBus } from './net.js';
import { getVault } from './settings-ui.js';
import { pack, unpack } from './pack.js';
import { applyControl, blockedReason, wipePeers } from './ban.js';
import { verifySig } from './killswitch.js';
import { sweepStale } from './sweep.js';
import { startPlan, lastServerOk, recordServerOk, checkIn, applyServerBan } from './checkin.js';
import { BanList, decodeEntry } from './banlist.js';
import { Outbox } from './outbox.js';
import { DirectLink, canCall } from './call.js';
import { ParentControls } from './parental.js';
import { getMood, setMood as setMoodMem, clearMood } from './mood.js';
import { ConnCap } from './conncap.js';
import { Cooldown, Roulette, receiverAccept, isAdult } from './roulette.js';
import { matchPacket } from './match-v2.js';
import { LiveNode, powerLevel, decodeVec } from './livemesh.js'; // UX §6-8 living mesh: bucket, soft-tag presence, tentacles, search, tap-to-open // UX §5 compact match packet (visible answers only)
import { RxGate } from './shield.js'; // v38: DoS cheap shield on the live receive path
import { BDiscWire } from './bdisc.js'; // v38: broadcast discovery (anonymous soft-tag search) on the live receive path
export const PUBLIC_FIELDS = ['name', 'age', 'gender', 'city', 'countryCode', 'bio', 'games', 'lookingFor', 'interests', 'avatarHue', 'thumb', 'test'];
class BusRendezvous { constructor() { this.known = new Map(); } seen(c) { this.known.set(c, Date.now()); } seeds(shard, ex) { return [...this.known].filter(([c, t]) => c !== ex && Date.now() - t < 10 * 60e3).slice(-3).map(([c]) => c); } register() {} checkIn() {} }
let cur = null;
export const mesh = () => cur;
export async function startMesh({ me, asKey = me.id, db, onChange = () => {}, bus, onStatus = () => {}, onNotice = () => {} }) {
  if (cur?.asKey === asKey) return cur; if (cur) await cur.stop();
  onStatus('UNLOCKING VAULT'); const v = await getVault();
  { const blk = await blockedReason(v); if (blk) { onStatus(blk.banned ? 'ACCESS DENIED · BANNED' : blk.suspended ? 'ACCOUNT SUSPENDED' : 'NETWORK SHUT DOWN'); onNotice(blk); throw Object.assign(new Error(blk.banned ? 'banned' : blk.suspended ? 'suspended' : 'killed'), { blocked: blk }); } } // killed/banned: never reconnect
  // ID key (src/identity.js): network identity derived from stable device data only. `?as=` demo profiles (admin/dev flavor)
  // add a persona suffix so several tabs on one device stay distinct. Existing random codes migrate (kept as legacyCode).
  const persona = new URLSearchParams(globalThis.location?.search || '').get('as') || null;
  const id = await v.use(async p => { p.meshIds ||= {}; const rec = (p.meshIds[asKey] ||= { keys: newSigningKeys(), friends: {}, blocked: [] }); await migrateIdentity(rec, { persona }); rec.box ||= newBoxKeys(); return { ...rec, ...(p.devLink?.pid ? { code: p.devLink.pid, keys: p.devLink.keys, ownCode: rec.code } : {}) }; }); // v37: a linked device uses the shared profile network ID // box = X25519 keys for per-chat E2E
  const myCodes = [id.code, id.ownCode, id.legacyCode, ...(id.priorIds || [])].filter(Boolean);
  onStatus('OPENING TRANSPORT'); bus ||= await createBus(); onStatus('TRANSPORT ' + String(bus.kind).toUpperCase());
  const pub = DISC.publishProfile(me, stripSensitive({ ...Object.fromEntries(PUBLIC_FIELDS.map(k => [k, me[k]]).filter(([, x]) => x !== undefined)), mp: matchPacket(me) })); // minors: no dating vectors
  const rv = new BusRendezvous(); let timer = null, verifying = false; const log = [];
  const changed = (...e) => { log.unshift(new Date().toLocaleTimeString() + ' ' + e.join(' ')); log.length = Math.min(log.length, 20); clearTimeout(timer); timer = setTimeout(onChange, 50); };
  const node = new MeshNode({ code: id.code, keys: id.keys, profile: pub, onEvent: changed,
    wallet: { consume: async () => (await db._w().spend(me.id, { boost: true })).ok, refund: () => db._w().refund(me.id, { boost: true }) }, // boosts (paid highlight); starters retired
    net: { send: env => outbound(env) } });
  node.minor = DISC.isMinor(me); // under 18: no dating requests in or out
  // E2E layer (src/e2e.js): every envelope signed; directed ones AES-GCM encrypted per chat (X25519). Then relay rotation
  // (src/relay.js): 2-3 onion hops when enough eligible relays, else direct over the current transport.
  const e2e = new E2E({ code: id.code, keys: id.keys, box: id.box }), attested = new Set(), localT = !String(bus.kind).startsWith('supabase');
  let myAtt = false;
  // Boost refunds verified server-side (api/_fn/refund.js): register on send, recipient posts its signed receipt, sender claims
  // only after the timeout. Local dev bus: the node refunds locally (wallet) because there is no server.
  if (!localT) { const rf = op => b => gfetch('/api/refund', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, ...b }) }).then(r => r.json()).catch(() => ({ ok: false }));
    node.refunds = { register: rf('register'), receipt: rf('receipt'), claim: async b => { await new Promise(r => setTimeout(r, 500)); const c = await rf('claim')(b); if (c.ok && !c.already) await db._w().refund(me.id, { boost: true }); return c; } }; }
  const router = new RelayRouter({ me: id.code, xsec: id.box.xsec, xpubOf: c => c === id.code ? id.box.xpub : e2e.xpubOf(c), isLinked: c => node.friends.has(c), isOnline: c => node.isOnline(c), candidates: () => [...node.presence.keys()].filter(c => node.isOnline(c)),
    isBanned: c => bl.isBanned(c), isBlocked: c => blocks.isBlocked(c), isAttested: c => attested.has(c), requireAttested: !localT }); // local demo has no attestation
  function outbound(env) {
    if (env.type === 'ping') env = { ...env, body: { ...env.body, relay: router.active, att: myAtt } };
    if (env.to === '*') { try { bus.post({ k: 'mesh', env: e2e.sealBroadcast(env) }); } catch (e) { changed('send refused', e.code || e.message); } return; }
    e2e.seal(env).then(sealed => { const r = router.route(sealed, env.id); bus.post(r.pkt); if (r.via) changed('relay path', r.via.length, 'hops'); }).catch(e => changed('send refused', e.code || e.message));
  }
  const passedSet = new Set(); // swiped-left nodes (this session)
  // v38: legacy 'disc' (query carrying the sender ID, answered with the FULL signed profile) is retired: discovery is now
  // bdisc (anonymous query, sealed soft-tag answer, see BDiscWire below). Legacy queries from older clients get no answer,
  // so a full profile never leaves this phone except on tap (livemesh pget -> pfull).
  node.on_disc = () => {};
  node['on_disc-ans'] = (from, b) => { if (passedSet.has(from)) return; if (b?.mode === node.discMode && DISC.acceptVector(me, b.mode, b.sp?.profile)) { node._live(from, b.sp, b.pub); changed(); } };
  let inq = Promise.resolve(); // inbound envelopes are opened IN ARRIVAL ORDER (async AES must not reorder e.g. a late answer after 'bye')
  const inbound = env => (inq = inq.then(() => e2e.open(env)).then(o => { if (!o) return;
    if (o.type === 'ping') { router.noteRelayer(o.from, !!o.body?.relay); if (o.body?.att) attested.add(o.from); else attested.delete(o.from);
      if (node.discMode && o.body?.sp && !DISC.acceptVector(me, node.discMode, o.body.sp.profile)) o = { ...o, body: { ...o.body, sp: null } }; } // mode filter: only this mode's vectors
    node.receive(o); changed(); }).catch(() => {}));
  for (const [c, f] of Object.entries(id.friends || {})) node.friends.set(c, f);
  const blocks = await new BlockList(v, asKey).load(); await blocks.importLegacy(id.blocked || []); // user block list (separate from ban list)
  for (const { id: c } of blocks.list()) node.blocked.add(c);
  const member = new Member({ code: id.code, profile: pub, now: () => Date.now(), net: { deliver: (from, to, m) => { const s = JSON.stringify(m); if (s.length > 1024) pack(m).then(z => bus.post({ k: 'mem', to, z })).catch(() => {}); else bus.post({ k: 'mem', to, m }); } } }); // big slices/batches gzip-compressed
  const fwd = new Set(), bl = new BanList(), kicked = new Map(); await bl.load(v);
  member.banlist = bl; member.onBanList = () => { bl.save(v).catch(() => {}); changed('ban list', bl.hash()); };
  const kick = c => { const e = bl.entry(c); if (!e || Date.now() - (kicked.get(c) || 0) < 60e3) return; kicked.set(c, Date.now()); node.presence.delete(c); node.live.delete(c); node.cache.delete(c); bus.post({ k: 'ctl', msg: e, src: 'ban-list' }); changed('refused banned', c); };
  member.onBan = kick;
  // v38 CHEAP SHIELD on the live receive path (src/shield.js RxGate): relevance filter -> shape/size cap -> per-sender /
  // game / stranger / anonymous budgets, all BEFORE unpack, signature verify (e2e.open) or decrypt. Packets for other
  // phones on the shared channel are ignored first, so they never count against anyone.
  let liveRef = null, bdw = null;
  const rxGate = new RxGate({ isKnown: c => node.friends.has(c) || e2e.peers.has(c) || node.presence.has(c) || !!liveRef?.bucket.has(c), onStrike: s => changed('shield: flood dropped from', s.code, '(' + s.count + ')') });
  const rxMeta = m => { if (!m || typeof m !== 'object') return { sender: null };
    if (m.k === 'mesh') { const e = m.env; if (!e || e.from === id.code || (e.to !== id.code && e.to !== '*')) return null; return { sender: e.from, game: e.to === '*' && e.type === 'arc' }; }
    if (m.k === 'mem') return m.to === id.code ? { sender: null } : null;
    if (m.k === 'onion') return m.hop === id.code ? { sender: null } : null;
    if (m.k === 'hello') return m.code === id.code ? null : { sender: m.code };
    if (m.k === 'bdisc-ans') return bdw?.pending.has(m.id) ? { sender: null } : null; // not my query: dropped for free
    return { sender: null }; };
  bus.on(msg => {
    if (!msg) return; { const meta = rxMeta(msg); if (!meta || !rxGate.admit(msg, meta).ok) return; }
    if (msg.k === 'bdisc') { if (msg.q) bdw?.onQuery(msg.q); return; } // anonymous query: maybe a sealed soft-tag answer (staggered)
    if (msg.k === 'bdisc-ans') { if (bdw?.onAnswer(msg)) changed('bdisc hit'); return; } // only the searcher can open it
    if (msg.k === 'ctl' && msg.msg?.nonce) { if (fwd.has(msg.msg.nonce)) return; fwd.add(msg.msg.nonce); // signed kill/ban/clear gossip: verify, forward once if the signature is valid, then apply
      if (/^user:/.test(msg.msg.scope || '')) member.mergeBans([msg.msg]).catch(() => {}); // signed ban/lift entries join the gossiped ban list
      verifySig(msg.msg).then(okSig => { if (okSig) try { bus.post(msg); } catch {} return Promise.all(myCodes.map(c => applyControl(msg.msg, { code: c, vault: v, mesh: cur, onNotice, source: msg.src === 'ban-list' ? 'record' : 'broadcast' }))).then(rs => rs.find(r => r.applied) || rs[0]); }).then(r => changed('control', msg.msg.type, msg.msg.scope, r.applied || r.reason)).catch(() => {}); return; }
    if (msg.k === 'hello' && !blocks.allowInbound(msg)) return; // user-blocked IDs: presence ignored; their chat envelopes reach node.receive, which drops them and tells the sender they're blocked (+ refund)
    if (msg.code && bl.isBanned(msg.code)) return kick(msg.code); if (msg.env?.from && bl.isBanned(msg.env.from)) return kick(msg.env.from); // banned: refuse, don't relay, send signed kill
    if (msg.k === 'hello') { rv.seen(msg.code); if (msg.code !== id.code && !msg.ack) bus.post({ k: 'hello', code: id.code, ack: true }); return; }
    if (msg.k === 'mem' && msg.to === id.code) { if (msg.z) { unpack(msg.z).then(m => { member.receive(m); changed('membership', m.t); }).catch(() => {}); return; } member.receive(msg.m); return changed('membership', msg.m.t); }
    if (msg.k === 'onion') { const r = router.onPacket(msg); if (r?.undeliverable != null) { node.on_undeliv(null, { ref: r.undeliverable }); return changed('returned undeliverable', r.undeliverable); } if (r) setTimeout(() => { try { bus.post(r.pkt); } catch {} }, r.delay); return; } // relay hop (only while online + searching)
    if (msg.k === 'mesh' && (msg.env.to === id.code || msg.env.to === '*') && msg.env.from !== id.code) { rv.seen(msg.env.from); inbound(msg.env); }
  });
  // store-and-forward on THIS phone only: pending items live inside the encrypted vault (device key), 7-day window
  node.outbox = new Outbox({ items: (await v.read().catch(() => ({})))?.meshIds?.[asKey]?.outbox || [], persist: items => v.use(p => { if (p.meshIds?.[asKey]) p.meshIds[asKey].outbox = items; }) });
  { const { SafetyCopies } = await import('./retention.js'); const saved = (await v.read().catch(() => ({})))?.meshIds?.[asKey]?.safety || [];
    node.safety = new SafetyCopies({ seal: async x => x, open: async x => x, store: new Map(saved) }); const add0 = node.safety.add.bind(node.safety);
    node.safety.persist = () => v.use(p => { if (p.meshIds?.[asKey]) p.meshIds[asKey].safety = [...node.safety.store]; }); node.safety.add = async (...a) => { await add0(...a); await node.safety.persist(); }; }
  node.recent = new Set(); member.mood = getMood();
  const cap = new ConnCap({ pinned: c => node.friends.has(c) || links.has(c) });
  // LIVING MESH (src/livemesh.js) rides E2E 'lm' envelopes (receiver-gated in LiveNode: band, block, ban, signature, rate).
  const live = new LiveNode({ code: id.code, keys: id.keys, profile: pub, full: pub, send: (to, m) => node.send(to, 'lm', m), isBanned: c => bl.isBanned(c), isBlocked: c => blocks.isBlocked(c) || node.blocked.has(c),
    isOnline: c => c === id.code || node.isOnline(c), rendezvous: () => [...node.presence.keys()].filter(c => c !== id.code && node.isOnline(c)).sort(() => Math.random() - .5).slice(0, 4), onEvent: (...e) => changed('live', ...e) });
  node.on_lm = (from, b) => live.receive(from, b); liveRef = live;
  bdw = new BDiscWire({ post: m => { try { bus.post(m); } catch {} }, live, vecOf: () => decodeVec(live.tags.v).map(x => x / 3), myModes: () => DISC.myModes(me), minor: DISC.isMinor(me), band: live.tags.b, onHit: c => changed('live', 'bdisc', c) });
  const power = async () => { try { const b = await globalThis.navigator?.getBattery?.(), c = globalThis.navigator?.connection; live.setPower(powerLevel({ battery: b?.level ?? 1, charging: !!b?.charging, saveData: !!c?.saveData, metered: c?.type === 'cellular' })); } catch {} };
  power(); const lt = setInterval(() => { if (globalThis.document?.visibilityState === 'hidden') live.setPower('critical'); live.tick(); }, 1000); const lp = setInterval(power, 60e3);
  // direct WebRTC links + calls (friends only; signaling rides E2E mesh envelopes 'rtc', dropped from strangers by the receiver)
  const links = new Map(); const linkFor = c => { if (!node.friends.has(c) || blocks.isBlocked(c) || bl.isBanned(c)) return null; let L = links.get(c);
    if (!L) { try { L = new DirectLink({ me: id.code, peer: c, send: m => node.send(c, 'rtc', m), onState: () => changed(), onCall: (st2, o) => changed('call', c, st2, o?.reason || ''), onTrack: s2 => { L.remote = s2; changed(); } }).open(); links.set(c, L); } catch { return null; } } return L; };
  node.on_rtc = (from, b) => { if (!node.friends.has(from)) return; const L = links.get(from) || linkFor(from); L?.onSignal(b).catch(() => {}); };
  // ROUND-ROBIN (src/roulette.js): opt-in 'rl' broadcasts build the pool; stranger links ride 'rlrtc' envelopes and are gated
  // on the RECEIVER (adult + opted in + not blocked/banned/cooldown). Minors never broadcast, never answer.
  const rlCooldown = await new Cooldown(v, asKey).load(), rlPeers = new Map(), rlLinks = new Map(); let rlOn = false;
  const rlGate = from => receiverAccept(me, { from, adult: rlPeers.get(from)?.adult === true }, { on: rlOn, cooldown: rlCooldown, isBlocked: c => blocks.isBlocked(c), isBanned: c => bl.isBanned(c) });
  const rlLink = c => { let L = rlLinks.get(c); if (L) return L; L = new DirectLink({ me: id.code, peer: c, send: m2 => node.send(c, 'rlrtc', m2), onState: () => changed(), onTrack: s2 => { L.remote = s2; changed(); },
      onCall: (st2) => { if (st2 === 'ringing') { const g = rlGate(c); if (g.ok) { rlCooldown.add(c).catch(() => {}); L.accept({ gate: g }).catch(() => {}); } else L.decline(); } if (st2 === 'ended') { rlLinks.delete(c); try { L.close(); } catch {} } } }).open(); rlLinks.set(c, L); return L; };
  node.on_rl = (from, b) => { if (b?.on && b.adult === true && !blocks.isBlocked(from) && !bl.isBanned(from)) rlPeers.set(from, { code: from, adult: true, rl: true, at: Date.now() }); else rlPeers.delete(from); };
  node.on_rlrtc = (from, b) => { if (!rlLinks.has(from) && !rlGate(from).ok) return; rlLink(from).onSignal(b).catch(() => {}); };
  const roulette = { setOn(on) { if (on && !isAdult(me)) throw new Error('18+ only'); rlOn = !!on; node.send('*', 'rl', { on: rlOn, adult: isAdult(me) }); if (!on) { for (const L of rlLinks.values()) try { L.kill('left'); } catch {} rlLinks.clear(); } },
    cooldown: rlCooldown, remote: c => rlLinks.get(c)?.remote || null,
    session: (me2, onState) => new Roulette({ me: me2, myCode: id.code, onState, cooldown: rlCooldown, pool: () => [...rlPeers.values()].filter(p => node.isOnline(p.code)), isBlocked: c => blocks.isBlocked(c), isBanned: c => bl.isBanned(c),
      block: c => cur.block(c), report: async () => null,
      connect: async c => { const L = rlLink(c); await new Promise((res, rej) => { const t0 = Date.now(), t = setInterval(() => { if (L.up) { clearInterval(t); res(); } else if (Date.now() - t0 > 15e3) { clearInterval(t); rej(new Error('no-link')); } }, 200); });
        const r = await L.start({ video: true, gate: { ok: true } }); if (!r.ok) throw new Error(r.reason); return { hangup: reason => { try { L.kill(reason); } catch {} rlLinks.delete(c); } }; } }) };
  // ARCADE (src/arcade/*): 'arc' broadcasts carry join/leave/input/voice-flag for the games; blocked/banned senders dropped.
  let arcH = null; const arcSubs = new Set(); node.on_arc = (from, b) => { if (!blocks.isBlocked(from) && !bl.isBanned(from)) { arcH?.(from, b); for (const f of arcSubs) try { f(from, b); } catch {} } };
  // GAME VOICE signaling (src/rtc-voice.js): 'vrtc' envelopes between players in the same game room; the VoiceHub gates
  // every inbound offer (same age band, not blocked/muted) before a peer connection exists.
  const vrtcSubs = new Set(); node.on_vrtc = (from, b) => { if (blocks.isBlocked(from) || bl.isBanned(from)) return; for (const f of vrtcSubs) try { f(from, b); } catch {} };
  const voiceSignal = { send: (to, m) => node.send(to, 'vrtc', m), on: fn => { vrtcSubs.add(fn); return () => vrtcSubs.delete(fn); } };
  const arcade = { voiceSignal, send: b => node.send('*', 'arc', b), listen: fn => { arcH = fn; }, sub: fn => { arcSubs.add(fn); return () => arcSubs.delete(fn); } }; // sub(): extra listeners (host rotation / join-anytime in match-ui)
  const killLinks = reason => { for (const L of links.values()) try { L.kill(reason); } catch {} links.clear(); };
  const save = () => v.use(p => { const x = p.meshIds[asKey]; x.friends = node.persistable().friends; x.blocked = [...node.blocked]; });
  onStatus('BROADCASTING HELLO'); bus.post({ k: 'hello', code: id.code }); await new Promise(r => setTimeout(r, 300));
  // SINGLE ENTRY (api/_fn/bootstrap.js): the server super list is the ONLY way in. Halt / ban / US-only gate there. No cached-list
  // jump-start, no owner/master phone, no seed list, no phone snapshots. Server unreachable => no new entry.
  // The list is kept in memory only (member.active); it is never written to disk. Local dev bus: no server (dev only).
  const local = !bus.kind.startsWith('supabase'), plan = startPlan({ lastOk: lastServerOk(), local });  changed('check-in', plan.why);
  if (!local && plan.pull) { onStatus('ENTERING VIA SERVER'); const att = await requestAttestation(id.code).catch(() => ({ provider: 'none' })); const br = await gfetch('/api/bootstrap?code=' + encodeURIComponent(id.code) + (me.mode ? '&mode=' + encodeURIComponent(me.mode) : '') + (id.legacyCode ? '&legacy=' + encodeURIComponent(id.legacyCode) : ''), { headers: { 'x-cm-attest': btoa(JSON.stringify(att)) } }).catch(() => null); if (br?.status === 451) { const j = await br.json().catch(() => ({})); onStatus('US ONLY · NOT AVAILABLE HERE'); onNotice({ geo: true, notice: j.notice }); throw Object.assign(new Error('us-only'), { geo: true }); } if (!br || (!br.ok && ![403, 451, 503].includes(br.status))) { onStatus('SERVER UNREACHABLE · NO NEW ENTRY'); bus.close?.(); throw Object.assign(new Error('server-unreachable'), { offline: true }); }
  if (br?.ok) { recordServerOk(); br.clone?.().json?.().then(j => j?.geoWarning && onNotice({ warning: j.geoWarning, geo: true })).catch(() => {}); } if (br && (br.status === 403 || br.status === 503)) { const j = await br.json().catch(() => ({})), blk = { banned: br.status === 403 && !j.suspended, suspended: !!j.suspended, until: j.until, level: j.level, killed: br.status === 503, reason: j.reason }; if (br.status === 403) await applyServerBan({ vault: v, reason: blk.reason || (blk.suspended ? 'suspended' : 'banned'), until: blk.suspended ? blk.until : null, wipePeers }).catch(() => {}); bus.close?.(); onNotice(blk); throw Object.assign(new Error(blk.banned ? 'banned' : 'killed'), { blocked: blk }); } try { const r = await br.json(); if (Array.isArray(r.bans)) await member.mergeBans(r.bans.map(decodeEntry)); myAtt = !!r.attested; if (r.warning) onNotice({ warning: r.warning, level: r.level }); if (r.flags?.includes('unattested')) changed('bootstrap: ID unattested', att.provider); if (Array.isArray(r.list)) changed('server list', member.warmStart(r.list), 'rows (in memory only)'); } catch {}
    presence('login'); }
  onStatus('JOINING GOSSIP MESH'); await member.join(rv); node.ping(); onStatus('MESH JOINED · ' + member.active.size + ' NODES');
  const myModes = () => DISC.myModes ? DISC.myModes(me) : (me.lookingFor || []);
  function presence(op) { if (local) return; const body = JSON.stringify({ op, code: id.code, legacy: id.legacyCode || undefined, row: member.row(member.shards[0], 'alive'), modes: myModes(), adult: !DISC.isMinor(me), card: { name: me.name, thumb: pub?.thumb || '', interests: (me.games || me.interests || []).slice(0, 6) } });
    if (op === 'logoff' && globalThis.navigator?.sendBeacon) { try { navigator.sendBeacon('/api/bootstrap', new Blob([body], { type: 'application/json' })); return; } catch {} }
    gfetch('/api/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body }).then(async r => { if (r.status === 403 || r.status === 503 || r.status === 451) { const j = await r.json().catch(() => ({})); if (r.status === 403) applyServerBan({ vault: v, mesh: cur, wipePeers, onNotice, reason: j.reason, until: j.suspended ? j.until : null }); else onNotice(r.status === 451 ? { geo: true, notice: j.notice } : { killed: true, reason: j.reason }); } }).catch(() => {}); }
  let lastBeat = Date.now();
  const sweep = () => { const r = sweepStale({ member, node, isBanned: c => bl.isBanned(c), cooldowns: [rlCooldown] }); { const n = node.safety.sweep(); if (n) node.safety.persist().catch(() => {}); } node.expirePending().then(n => n && changed('pending expired (7 days)', n)).catch(() => {}); for (const c of node.presence.keys()) cap.touch(c); for (const c of cap.trim()) { node.presence.delete(c); node.cache.delete(c); } if (r.peers || r.queued || r.gossip || r.friendReqs || r.banned) changed('24h sweep', r.peers, 'stale peers,', r.banned || 0, 'banned,', r.queued, 'queued msgs,', r.gossip, 'gossip items dropped'); return r; };
  sweep(); // on startup (after warm start), then every 10 min — local only, no network
  let lastSweep = Date.now(), lastCheckTry = 0;
  const hb = setInterval(() => { node.ping(); node.prune(); member.tick(); changed(); if (Date.now() - lastSweep > 10 * 60e3) { lastSweep = Date.now(); sweep(); } if (Date.now() - lastBeat > 60e3) { lastBeat = Date.now(); presence('heartbeat'); }
    if (!local && startPlan({ lastOk: lastServerOk() }).check && Date.now() - lastCheckTry > 5 * 60e3) { lastCheckTry = Date.now(); // still owe a check-in: retry when online
      checkIn({ code: id.code, fetchStatus: c => gfetch('/api/bootstrap?check=1&code=' + encodeURIComponent(c) + (id.legacyCode ? '&legacy=' + encodeURIComponent(id.legacyCode) : '')) }).then(r => { if (r.banned || r.suspended) applyServerBan({ vault: v, mesh: cur, wipePeers, onNotice, reason: r.reason || undefined, until: r.suspended ? r.until : null }); else if (r.geo) { onNotice({ geo: true, notice: r.notice }); try { node.bye(); member.leave(); } catch {} } else { if (r.warning) onNotice({ warning: r.warning, level: r.level }); if (r.geoWarning) onNotice({ warning: r.geoWarning, geo: true }); } }).catch(() => {}); } }, 20e3);
  const ae = setInterval(() => member.syncWith(member.shards[0]), MCFG.syncMs); // compact-digest catch-up (was every 20 s with full version list)
  const bye = () => { presence('logoff'); node.bye(); if (member.alive) member.leave(); };
  globalThis.addEventListener?.('pagehide', bye);
  cur = {
    asKey, code: id.code, legacyCode: id.legacyCode || null, node, member, bus, log, transport: bus.kind,
    online: () => [...node.presence.keys()].filter(c => c !== id.code && node.isOnline(c) && !node.blocked.has(c) && !bl.isBanned(c)), banlist: bl, blocklist: blocks,
    peers: () => { const pending = [...member.active.values()].filter(r => r.code !== id.code && node.isOnline(r.code) && !member.verified.has(r)).slice(0, 60).map(r => r.code); if (pending.length && !verifying) { verifying = true; member.ensureVerified(pending).finally(() => { verifying = false; changed(); }); }
      const codes = new Set([...member.active.values()].map(r => r.code).concat([...node.cache.keys()], [...node.friends.keys()])); codes.delete(id.code); return blocks.filter([...codes]).filter(c => !node.blocked.has(c) && !bl.isBanned(c)).map(c => { const v = node.view(c); if (v && member.active.has(member.key(member.shards[0], c))) v.unverified = !member.isVerified(c); return v; }).filter(Boolean).sort((a, b) => b.full - a.full); },
    // UX §6 swipe-left PASS: drop that node from my discovery slot for this session (not a block, they are not told),
    // close any direct link, and re-run discovery so the mesh fills the slot with another node.
    passed: passedSet, live, openProfile: c => live.openProfile(c), like: c => live.like(c), search: (crit, cb) => live.search(crit, cb), bucket: () => [...live.bucket.entries()].map(([c, e]) => ({ code: c, score: e.score, tags: e.sp.profile })).sort((a, b) => b.score - a.score),
    pass(c) { if (!c) return; passedSet.add(c); live.pass(c); try { links.get(c)?.kill('passed'); } catch {} links.delete(c); node.discAt = 0; changed('passed', c); },
    async block(c) { links.get(c)?.kill('blocked'); links.delete(c); node.block(c); await blocks.add(c); await save(); changed('blocked', c); },
    async unblock(c) { node.unblock(c); await blocks.remove(c); await save(); changed(); },
    async requestFriend(c, opts = {}) { if (member.active.has(member.key(member.shards[0], c)) && !(await member.ensureVerified([c])).length) { changed('unverified row dropped', c); return { ok: false, reason: 'unverified' }; } const p = node.requestFriend(c, opts); changed('friend request', c); const r = await p; changed(); return r; },
    decline(c) { node.declineFriend(c); changed('declined', c); },
    parent: new ParentControls({ store: { read: async () => (await v.read())?.parental || null, write: x => v.use(p => { p.parental = x; }) } }),
    callGate: (c, video) => canCall({ friend: node.friends.has(c), linkUp: !!links.get(c)?.up, blocked: blocks.isBlocked(c), banned: bl.isBanned(c), halted: false, video, parent: DISC.isMinor(me) ? cur?.parent : null }),
    async accept(c) { node.acceptFriend(c); setTimeout(save, 500); changed('accepted', c); },
    save, ONLINE_MS, e2e, router, roulette, arcade, shield: rxGate, bdisc: bdw,
    setDiscovery(mode, searching) { const online = globalThis.document?.visibilityState !== 'hidden'; router.active = !!searching && online; // relay duty only while online + searching
      const m = mode && DISC.canQuery(me, mode) ? mode : null; if (m !== node.discMode || (m && Date.now() - (node.discAt || 0) > 60e3)) { node.discMode = m; node.discAt = Date.now(); if (m) live.setMode(m); if (m) bdw?.search(m); } }, // v38: anonymous broadcast discovery (was the legacy ID-carrying 'disc')
    setRetention: (c, o) => node.setRetention(c, o), safetyConversation: c => node.safety.conversation(c),
    link: c => linkFor(c), links, outbox: node.outbox,
    async recent(mode) { if (local) return []; const r = await gfetch('/api/bootstrap?recent=1&code=' + encodeURIComponent(id.code) + (mode ? '&mode=' + mode : '') + (DISC.isMinor(me) ? '' : '&adult=1')).then(x => x.ok ? x.json() : { recent: [] }).catch(() => ({ recent: [] }));
      const list = blocks.filter((r.recent || []).map(e => e.code)); const ok = new Set(list); const out = (r.recent || []).filter(e => ok.has(e.code) && !bl.isBanned(e.code) && e.code !== id.code); for (const e of out) node.recent.add(e.code); return out; },
    setMood(mid) { setMoodMem(mid, { minor: DISC.isMinor(me) }); member.mood = mid; for (const sh of member.shards) member.refute(sh); node.ping(); presence('heartbeat'); changed('mood', mid || 'cleared'); },
    mood: () => member.mood, moodOf: c => [...member.active.values()].find(r => r.code === c)?.mood || null,
    async deleteAccount() { if (!local) await gfetch('/api/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'delete', code: id.code, row: member.row(member.shards[0], 'alive') }) }).catch(() => {}); },
    async stop() { clearInterval(lt); clearInterval(lp); killLinks('halt'); clearMood(); member.mood = null; clearInterval(hb); clearInterval(ae); bye(); globalThis.removeEventListener?.('pagehide', bye); bus.close?.(); cur = null; },
  };
  // persist friendship once the other side confirms
  const orig = node.on_fok.bind(node); node.on_fok = (f, b) => { orig(f, b); save(); };
  return cur;
}
globalThis.__cmMesh = mesh; // test hook (read-only access for E2E)
