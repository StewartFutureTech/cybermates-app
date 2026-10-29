// LIVE smoke test against the Cybermates Supabase project (RLS age-band separation, message flow, reports, safety).
// Users: SUPA_TEST_USERS='[{"email","password"} x4]' (adult1, adult2, minor1, minor2; pre-confirmed) OR, if unset, anonymous
// sign-ins (Auth > Anonymous sign-ins must be ON). Every user is deleted at the end via delete_my_account().
// If neither is available it prints SKIP and exits 0 so offline regress still works; SUPA_LIVE=1 makes SKIP a failure.
import nacl from 'tweetnacl';
import { makeClient } from '../src/backend/supabase-client.js';
import { createSupabaseBackend, boxSealer } from '../src/backend/supabase-backend.js';
const transport = globalThis.WebSocket || (await import('ws')).default; // Node 20 has no native WebSocket
const b64 = u8 => Buffer.from(u8).toString('base64');
let pass = 0, fail = 0; const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const throws = async (fn, m) => { try { const r = await fn(); ok(false, m + ' (unexpectedly succeeded: ' + JSON.stringify(r)?.slice(0, 120) + ')'); } catch (e) { ok(true, m + ' -> ' + e.message.slice(0, 80)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = y => { const d = new Date(); d.setFullYear(d.getFullYear() - y); return d.toISOString().slice(0, 10); };

async function user(cred, name) {
  const keys = nacl.box.keyPair(), xpub = b64(keys.publicKey), xsec = b64(keys.secretKey);
  const c = await makeClient({ persist: false, transport });
  const be = await createSupabaseBackend({ client: c, sealer: boxSealer({ xsec }) });
  if (cred) await be.auth.signInWithPassword(cred.email, cred.password); else await be.auth.signInAnonymously();
  be.name = name; be.id = await be.auth.userId(); be.xpub = xpub; return be;
}
async function main() {
  let creds = null; try { creds = process.env.SUPA_TEST_USERS ? JSON.parse(process.env.SUPA_TEST_USERS) : null; } catch {}
  const users = [];
  try {
    for (const [i, n] of ['adult1', 'adult2', 'minor1', 'minor2'].entries()) users.push(await user(creds?.[i], n));
  } catch (e) {
    for (const u of users) await u.store.deleteAccount().catch(() => {});
    const msg = `SKIP live Supabase smoke: cannot create test users (${e.message}). Enable Anonymous sign-ins or set SUPA_TEST_USERS.`;
    console.log(msg); process.exit(process.env.SUPA_LIVE === '1' ? 1 : 0);
  }
  const [A1, A2, M1, M2] = users;
  try {
    console.log('# age check (server-side band)');
    ok(await A1.store.submitAgeCheck(iso(30)) === 'adult', 'adult1 -> adult'); ok(await A2.store.submitAgeCheck(iso(25)) === 'adult', 'adult2 -> adult');
    ok(await M1.store.submitAgeCheck(iso(15)) === 'minor', 'minor1 -> minor'); ok(await M2.store.submitAgeCheck(iso(14)) === 'minor', 'minor2 -> minor');
    await throws(() => M1.store.submitAgeCheck(iso(30)), 'minor cannot re-check into adult');
    { const { error } = await M1.client.from('profiles').update({ age_band: 'adult' }).eq('id', M1.id); ok(!!error, 'age_band not client-writable (' + error?.code + ')'); }
    ok((await M1.store.getProfile()).age_band === 'minor', 'minor band unchanged');
    for (const u of users) await u.store.upsertProfile({ handle: 'cmtest_' + u.name + '_' + u.id.slice(0, 4), display_name: u.name, e2e_pubkey: u.xpub });

    console.log('# cross-band READ fails, same-band READ succeeds');
    ok(await A1.store.getProfile(M1.id) === null, 'adult cannot read minor profile');
    ok(await M1.store.getProfile(A1.id) === null, 'minor cannot read adult profile');
    ok((await A1.store.getProfile(A2.id))?.id === A2.id, 'adult reads adult');
    ok((await M1.store.getProfile(M2.id))?.id === M2.id, 'minor reads minor');
    const vis = (await A1.store.listProfiles({ limit: 1000 })).map(p => p.id);
    ok(!vis.includes(M1.id) && !vis.includes(M2.id), 'adult profile list contains no minors');
    { const anon = await makeClient({ persist: false, transport }); const { data } = await anon.from('profiles').select('id'); ok(!data?.length, 'signed-out anon key reads nothing'); }

    console.log('# cross-band MESSAGE fails, same-band succeeds');
    await throws(() => A1.store.getOrCreateConversation(M1.id), 'adult cannot open conversation with minor');
    await throws(() => M1.store.getOrCreateConversation(A1.id), 'minor cannot open conversation with adult');
    ok(!(await A1.store.sendMessage(A1.id, M1.id, 'hi')).ok, 'adult->minor sendMessage rejected');
    ok(!(await M2.store.sendMessage(M2.id, A2.id, 'hi')).ok, 'minor->adult sendMessage rejected');
    const mConv = await M1.store.getOrCreateConversation(M2.id); ok(mConv.band === 'minor', 'minor<->minor conversation created');
    { const { error } = await A1.client.from('messages').insert({ conversation_id: mConv.id, sender_id: A1.id, body: 'x' }); ok(!!error, 'adult cannot inject into minor conversation'); }
    { const { data } = await A1.client.from('conversations').select('id').eq('id', mConv.id); ok(!data?.length, 'adult cannot see minor conversation'); }

    console.log('# message flow (E2E sealed, realtime, delivery status, 7-day hold)');
    const got = []; const off = await A2.realtime.subscribeMessages(m => got.push(m)); await sleep(2500);
    const r = await A1.store.sendMessage(A1.id, A2.id, 'gg wp, duo later?'); ok(r.ok, 'adult1 -> adult2 sent');
    const raw = (await A2.client.from('messages').select('body,nonce,expires_at,created_at').eq('id', r.msg.id).single()).data;
    ok(raw && raw.body !== 'gg wp, duo later?' && raw.nonce, 'server stores ciphertext only');
    const hold = (Date.parse(raw.expires_at) - Date.parse(raw.created_at)) / 864e5; ok(Math.abs(hold - 7) < 0.01, '7-day hold (' + hold.toFixed(3) + 'd)');
    const inbox = await A2.store.listMessages(null); ok(inbox.some(m => m.id === r.msg.id && m.text === 'gg wp, duo later?'), 'recipient decrypts');
    for (let i = 0; i < 20 && !got.some(m => m.id === r.msg.id); i++) await sleep(300);
    ok(got.some(m => m.id === r.msg.id), 'realtime INSERT delivered to recipient'); off();
    { const { data } = await A1.client.from('messages').update({ status: 'read' }).eq('id', r.msg.id).select(); ok(!data?.length, 'sender cannot mark own message read'); }
    ok((await A2.store.markDelivered([r.msg.id]))[0]?.status === 'delivered', 'recipient -> delivered');
    ok((await A2.store.markRead(A2.id, A1.id))[0]?.status === 'read', 'recipient -> read');
    ok((await A1.store.listMessages(null)).find(m => m.id === r.msg.id)?.status === 'read', 'sender sees read receipt');
    ok((await M1.store.sendMessage(M1.id, M2.id, 'minecraft?')).ok, 'minor1 -> minor2 sent');
    ok(await A1.store.boostBalance() === 0, 'boost balance 0 (grants are service-role only)');
    ok((await A1.store.sendMessage(A1.id, A2.id, 'boost!', { boost: true })).reason === 'no-boosts', 'boost without balance rejected');

    console.log('# minors: no dating/roulette; presence is band-scoped');
    await throws(() => M1.store.setMatchPrefs({ modes: ['friends', 'dating'] }), 'minor cannot enable dating');
    await throws(() => M1.store.joinRoulette(), 'minor cannot join roulette');
    ok(!!(await M1.store.setMatchPrefs({ modes: ['friends', 'duo'] })), 'minor friends/duo prefs ok');
    ok(await A1.store.joinRoulette(), 'adult joins roulette'); await A2.store.setMatchPrefs({ modes: ['friends', 'dating'] });
    ok(!(await M2.store.findMatches('friends')).some(p => p.id === A1.id || p.id === A2.id), 'minor matches contain no adults');
    ok((await M2.store.findMatches('friends')).some(p => p.id === M1.id), 'minor matches minor');
    ok(!(await A1.store.findMatches('friends')).some(p => p.id === M1.id), 'adult matches contain no minors');
    const subState = (u, topic) => new Promise(res => { const ch = u.client.channel(topic, { config: { private: true } }); const t = setTimeout(() => res('TIMEOUT'), 8000); ch.subscribe(s => { if (s !== 'CLOSED') { clearTimeout(t); res(s); u.client.removeChannel(ch); } }); });
    await M1.realtime._auth(); await A1.realtime._auth();
    ok(await subState(M1, 'presence:adult') !== 'SUBSCRIBED', 'minor cannot join adult presence/voice channel');
    ok(await subState(M1, 'presence:minor') === 'SUBSCRIBED', 'minor joins minor presence');
    ok(await subState(A1, 'conv:' + mConv.id) !== 'SUBSCRIBED', 'adult cannot join minor conversation (voice signaling) channel');

    console.log('# reports queue + escalation');
    const rep = await A1.store.report({ reported: A2.id, reason: 'harassment', details: 'test', messageId: r.msg.id }); ok(rep.status === 'open' && rep.priority === 3, 'report queued open p3');
    ok(await A1.store.escalateReport(rep.id, 'still happening') === 'escalated', 'reporter escalates');
    ok((await A1.store.listMyReports()).find(x => x.id === rep.id)?.escalation_level === 1, 'escalation level 1');
    ok(!(await A2.store.listMyReports()).some(x => x.id === rep.id), 'reported user cannot see the report');
    await throws(() => A2.store.escalateReport(rep.id), 'non-reporter cannot escalate');
    const rep2 = await M1.store.report({ reported: A1.id, reason: 'threats/violence' }); ok(rep2.status === 'escalated' && rep2.priority === 1, 'severe report auto-escalated p1 (cross-band report allowed)');
    { const { data } = await A1.client.from('reports').select('moderator_note'); ok(!data, 'moderator_note not client-readable'); }

    console.log('# parent controls (hashed code disables features)');
    await M1.store.setParentControls('4321', ['messages', 'lfg']);
    ok((await M1.store.getParentControls()).disabled_features.includes('messages'), 'controls stored');
    { const { data } = await M1.client.from('parent_controls').select('code_hash'); ok(!data, 'code_hash not readable'); }
    ok(!(await M1.store.sendMessage(M1.id, M2.id, 'blocked by parent')).ok, 'messages disabled by parent');
    await throws(() => M1.store.postLfg({ game: 'Minecraft', title: 'build?' }), 'LFG disabled by parent');
    await throws(() => M1.store.clearParentControls('0000'), 'wrong parent code rejected');
    ok(await M1.store.clearParentControls('4321'), 'right code clears'); ok((await M1.store.sendMessage(M1.id, M2.id, 'back')).ok, 'messages re-enabled');

    console.log('# LFG / events / interests / blocks');
    const post = await A1.store.postLfg({ game: 'Valorant', title: 'need 2 for ranked' }); ok(post.band === 'adult', 'LFG band set server-side');
    ok((await A2.store.listLfg()).some(p => p.id === post.id), 'adult sees adult LFG'); ok(!(await M1.store.listLfg()).some(p => p.id === post.id), 'minor never sees adult LFG');
    const ev = await M2.store.createEvent({ title: 'Kart night', starts_at: new Date(Date.now() + 864e5).toISOString() });
    ok((await M1.store.listEvents()).some(e => e.id === ev.id), 'minor sees minor event'); ok(!(await A1.store.listEvents()).some(e => e.id === ev.id), 'adult never sees minor event');
    await throws(() => A1.store.joinEvent(ev.id), 'adult cannot join minor event');
    await throws(() => A1.store.setInterests(Array.from({ length: 21 }, (_, i) => 't' + i)), 'interests capped at 20');
    ok((await A1.store.setInterests(['fps', 'rpg'])).length === 2, 'interests saved');
    const fr = await A1.store.sendFriendRequest(A2.id); await A2.store.respondFriendRequest(fr.id, 'accepted'); ok((await A1.store.listFriends()).includes(A2.id), 'same-band friend request accepted');
    await throws(() => A1.store.sendFriendRequest(M1.id), 'cross-band friend request rejected');
    await A2.store.block(A1.id);
    ok(await A1.store.getProfile(A2.id) === null, 'blocked: profile hidden'); ok(!(await A1.store.sendMessage(A1.id, A2.id, 'hey?')).ok, 'blocked: cannot message');
    await A1.store.acknowledge(3); ok((await A1.store.getProfile()).ack_version === 3, 'ack version recorded');
  } finally {
    console.log('# cleanup');
    for (const u of users) { try { await u.store.deleteAccount(); ok(true, 'deleted ' + u.name); } catch (e) { ok(false, 'delete ' + u.name + ': ' + e.message); } }
    for (const u of users) u.realtime.closeAll();
  }
  console.log(`supa-live: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
