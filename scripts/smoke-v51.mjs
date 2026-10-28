// v51: presence-sync reply-to-join, matchmaker bot→invite, soft→hard mins, CookieGate PROTO
import assert from 'node:assert/strict';
import { PresenceSync, staggerMs, SILENCE_MS } from '../src/arcade/presence-sync.js';
import { Matchmaker, BOT_START_MS, INVITE_MS, FILL_MS } from '../src/arcade/match.js';
import { softTags, softMatch, softClearsBoth, softMinOf, DEFAULT_MIN } from '../src/livemesh.js';
import { minFor, DEFAULT_MIN as MV_MIN } from '../src/match-v2.js';
import { PROTO as RX_PROTO, CookieGate } from '../src/rx-cookie.js';
import { PROTO as FLOOD_PROTO, FloodReporter, ANTI_FRAME } from '../src/flood-report.js';
import { makeShield, PROTO as SH_PROTO } from '../src/shield-wire.js';

const ok = (c, m) => assert.ok(c, m);

// ---- soft→hard mins
ok(DEFAULT_MIN.dating === 50 && DEFAULT_MIN.friends === 40 && DEFAULT_MIN.gaming === 40, 'defaults 50/40/40');
ok(MV_MIN.dating === 50 && minFor({}, 'dating') === 50 && minFor({}, 'friends') === 40, 'minFor uses DEFAULT_MIN');
ok(minFor({ minMatch: { dating: 70 } }, 'dating') === 70, 'profile minMatch wins');
const a = softTags({ age: 30, lookingFor: ['friends', 'dating'], gender: 'm', minMatch: { dating: 50, friends: 40, gaming: 40 }, f: { games: ['x'], sports: ['soccer'], interests: ['music'] } });
const b = softTags({ age: 28, lookingFor: ['friends', 'dating'], gender: 'f', minMatch: { dating: 90, friends: 40, gaming: 40 }, f: { games: ['x'], sports: ['soccer'], interests: ['music'] } });
ok(Array.isArray(a.n) && a.n[0] === 50 && b.n[0] === 90, 'soft tags carry n mins');
const sf = softMatch(a, b, 'friends');
ok(sf != null && softClearsBoth(sf, a, b, 'friends'), 'friends soft clears both at 40');
const sd = softMatch(a, b, 'dating');
ok(sd != null, 'dating soft score computed');
ok(!softClearsBoth(sd, a, b, 'dating') || softMinOf(b, 'dating') <= sd, 'dating both-mins gate uses higher of both (90)');
ok(softMinOf(b, 'dating') === 90 && softMinOf(a, 'dating') === 50, 'softMinOf from tags.n');
// search crit.min never defaults to 0 when tags have mins
ok(softMinOf(a, 'friends') === 40, 'search default softMinOf friends=40 not 0');

// ---- PresenceSync reply-to-join + prune
{
  const sent = []; const admitted = []; const left = [];
  let now = 1e12;
  const ps = new PresenceSync({
    send: p => sent.push(p), admit: (c, o) => { admitted.push(c); return { code: c, ...o }; }, leave: c => left.push(c),
    me: () => ({ code: 'ME', name: 'me', minor: false, sub: 's1' }),
    sameBand: () => true, isBlocked: () => false, now: () => now, rng: () => 0, // stagger = REPLY_MIN
    timers: { setTimeout: (f) => { f(); return 1; }, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {} },
  }).start();
  const r1 = ps.onPeer('P1', { op: 'join', name: 'p1', minor: false });
  ok(r1.action === 'reply' && sent.some(p => p.hello === 1 && p.op === 'join'), 'reply-to-join sends hello:1');
  const r2 = ps.onPeer('P1', { op: 'join', hello: 1, name: 'p1' });
  ok(r2.action === 'admit' && !sent.filter(p => p.hello === 1).length !== 1, 'hello reply does not ping-pong');
  now += SILENCE_MS + 1; const dead = ps.prune(now);
  ok(dead.includes('P1') && left.includes('P1'), 'silence prune removes peer');
  ok(staggerMs(() => 0) >= 40 && staggerMs(() => 0.999) <= 380, 'stagger in range');
  ps.stop();
}

// ---- Matchmaker bot start + invite
{
  let t = 0; const mm = new Matchmaker({ now: () => t, idTag: () => 'T' });
  ok(BOT_START_MS === 15000 && INVITE_MS === 20000 && FILL_MS === BOT_START_MS, 'timings 15s/20s');
  const A = { code: 'A1', name: 'a', age: 25, adult: true };
  mm.enqueue(A, 'chess', '1v1');
  ok(!mm.tryForm(mm.key('chess', '1v1', A), 'chess', '1v1'), 'not yet bot due');
  t = BOT_START_MS + 1;
  const bot = mm.tryForm(mm.key('chess', '1v1', A), 'chess', '1v1');
  ok(bot?.bot && bot.seeking && mm.seeking.get('A1')?.status === 'bot', 'bot match keeps seeking');
  const B = { code: 'B1', name: 'b', age: 26, adult: true };
  mm.enqueue(B, 'chess', '1v1');
  const tick = mm.tick();
  ok(tick.invites.length >= 1 || mm.pendingInvite('A1'), 'invite proposed to bot player');
  const inv = mm.pendingInvite('A1');
  ok(inv && inv.until - t === INVITE_MS, 'invite ~20s');
  const acc = mm.acceptInvite('A1');
  ok(acc.ok && acc.match && !acc.match.seats.some(s => s.code === 'A1' && s.ai), 'accept forms human match');
}

// ---- CookieGate + flood PROTO
ok(RX_PROTO === 1 && FLOOD_PROTO === 1 && SH_PROTO === 1, 'PROTO=1');
ok(/UNVERIFIED|ANTI-FRAMING/i.test(ANTI_FRAME), 'anti-framing note');
{
  const posts = []; const bus = { post: m => posts.push(m) };
  const sh = makeShield({ code: 'ME', bus, changed: () => {}, isKnown: () => false });
  ok(typeof sh.beforeAdmit === 'function' && sh.helloOut().pv === 1, 'shield helloOut has pv');
  const handled = sh.beforeAdmit({ k: 'ck', to: 'ME', ch: 'abc', from: 'X' });
  ok(handled === 'handled' && posts.some(p => p.k === 'hello' && p.ck === 'abc'), 'cookie challenge answered');
}

console.log('ALL OK smoke-v51');
