// Logic smoke test (no browser): seed, matching, voice parsing, messaging rules.
globalThis.window = {}; const mem = {}; globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => mem[k] = v, removeItem: k => delete mem[k] };
const D = await import('../src/data.js'); const { findMatches, locationOk, distanceMi } = await import('../src/match.js'); const H = await import('../src/handoff.js');
const { db } = await import('../src/store.js'); const V = await import('../src/voice.js');
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const seed = D.makeSeed(); assert(seed.length === 30, '30 seed profiles');
for (const m of D.MODES) assert(seed.some(p => p.lookingFor.includes(m)), 'mode covered: ' + m);
assert(JSON.stringify(D.MODES) === '["friends","gaming","dating"]', 'modes = friends/gaming/dating only (Friends first)');
assert(!JSON.stringify(seed).toLowerCase().includes('hookup'), 'no hookup anywhere in seed');
assert(new Set(seed.map(p => p.countryCode)).size >= 6, 'seed spans countries: ' + [...new Set(seed.map(p => p.countryCode))].join(','));
const tot = {}; for (const me of seed) for (const m of me.lookingFor) { const r = findMatches(me, seed, m, D.QUESTIONS); tot[m] = (tot[m] || 0) + r.length; r.forEach(x => { if (!x.shared.length) throw 'no shared'; if (!locationOk(me, x.profile, m, x.dist) || !locationOk(x.profile, me, m, x.dist)) throw 'loc'; }); }
console.log('match totals', tot); assert(tot.dating >= 10 && tot.friends > 0 && tot.gaming > 0, 'healthy matches per mode');
const datersWithMatch = seed.filter(p => p.lookingFor.includes('dating') && findMatches(p, seed, 'dating', D.QUESTIONS).length).length; console.log('daters with ≥1 match:', datersWithMatch);
const chi = { city: 'Chicago', region: 'IL', countryCode: 'US', lat: 41.88, lng: -87.63 }, mke = { city: 'Milwaukee', region: 'WI', countryCode: 'US', lat: 43.04, lng: -87.91 }, ldn = { city: 'London', region: 'England', countryCode: 'GB', lat: 51.5, lng: -0.1 };
const pref = (scope, extra = {}) => ({ distPrefs: { dating: { scope, ...extra } } });
const d = distanceMi(chi, mke);
assert(locationOk({ ...chi, ...pref('radius', { value: 100, unit: 'mi' }) }, mke, 'dating', d) && !locationOk({ ...chi, ...pref('radius', { value: 50, unit: 'mi' }) }, mke, 'dating', d), 'radius miles (' + Math.round(d) + ' mi)');
assert(locationOk({ ...chi, ...pref('radius', { value: 150, unit: 'km' }) }, mke, 'dating', d) && !locationOk({ ...chi, ...pref('radius', { value: 100, unit: 'km' }) }, mke, 'dating', d), 'radius km');
assert(!locationOk({ ...chi, ...pref('region') }, mke, 'dating', d) && locationOk({ ...chi, ...pref('country') }, mke, 'dating', d) && !locationOk({ ...chi, ...pref('country') }, ldn, 'dating', 4000) && locationOk({ ...chi, ...pref('global') }, ldn, 'dating', 4000), 'region/country/global scopes');
assert(locationOk(chi, mke, 'gaming', d) && locationOk(chi, ldn, 'gaming', 4000) && !locationOk(chi, mke, 'friends', d), 'defaults: gaming global, friends same region');
const owner = { name: 'T', gamertags: { Steam: 'abc', Discord: 'abc' }, socials: { Instagram: '@abc' }, reveal: { 'gamertags.Steam': 'public', 'socials.Instagram': 'hidden' } };
assert(H.visibleAccounts(owner).filter(a => a.shown).map(a => a.platform).join() === 'Steam', 'privacy before match');
assert(H.visibleAccounts(owner, { mutual: true }).filter(a => a.shown).map(a => a.platform).join() === 'Steam,Discord', 'privacy after mutual match (hidden stays hidden)');
assert(H.linkFor('Instagram', '@abc') === 'https://instagram.com/abc' && H.linkFor('Riot', 'x#1') === null && H.inviteUrl('xyz') === 'https://discord.gg/xyz', 'handoff links');
assert(JSON.stringify(V.parseList('I play halo and minecraft', D.GAMES)) === '["Halo","Minecraft"]', 'parseList');
assert(V.parseNumber("I'm 27") === 27 && V.parseNumber('twenty five') === 25, 'parseNumber');
assert(V.parseHandles('my xbox is Chief117 and steam is chiefy', D.GAMER_PLATFORMS).Steam === 'chiefy', 'parseHandles');
for (let i = 2; i <= 7; i++) { const r = await db.sendMessage('seed-1', 'seed-' + i, 'hi'); assert(r.ok === (i <= 6), `starter ${i - 1} ${r.ok ? 'allowed' : 'blocked'}`); }
assert((await db.sendMessage('seed-1', 'seed-2', 'again')).ok, 'existing convo always delivers');
await db.mockPurchase('seed-1', 'starters5'); assert((await db.sendMessage('seed-1', 'seed-7', 'hi')).ok, 'bought starter works');
{ const b = (await db.getWallet('seed-1')).extraStarters; await db.mockPurchase('seed-1', 'starters40'); assert((await db.getWallet('seed-1')).extraStarters === b + 40, 'starters40 credits 40'); }
await db.mockPurchase('seed-2', 'plus1m'); const w2 = await db.getWallet('seed-2'); assert(w2.plus && w2.boosts === 5, 'Cybermates+ mock');
for (let i = 10; i <= 24; i++) assert((await db.sendMessage('seed-2', 'seed-' + i, 'hi')).ok, 'plus starter ' + (i - 9));
assert((await db.sendMessage('seed-2', 'seed-25', 'hi')).ok === false, '16th plus starter blocked');
await db.mockPurchase('seed-1', 'boost1'); assert((await db.sendMessage('seed-1', 'seed-8', 'boosted!', { boost: true })).msg.boosted, 'boost');
{ const cp = V.crossPick('I play Halo and cod on xbox and ps5, want a duo', [{ k: 'games', o: D.GAMES }, { k: 'platforms', o: D.GAMER_PLATFORMS }, { k: 'lookingFor', o: D.MODES }]); assert(cp.games.join() === 'Halo,Call of Duty' && cp.platforms.join() === 'Xbox,PlayStation' && cp.lookingFor.join() === 'gaming', 'smart cross-field parsing'); assert(V.parseOne('i am a girl', D.GENDERS) === 'Woman', 'gender synonym'); }
await import('./smoke-p2p.mjs');
await import('./smoke-gate.mjs');
await import('./smoke-secure.mjs');
await import('./smoke-wallet.mjs');
await import('./smoke-membership.mjs');
await import('./smoke-legal.mjs');
await import('./smoke-flavors.mjs');
await import('./smoke-help.mjs');
await import('./smoke-admin.mjs');
await import('./smoke-twokey.mjs');
await import('./smoke-tiers.mjs');
await import('./smoke-approved.mjs');
await import('./smoke-presence.mjs');
await import('./smoke-killkey.mjs');
await import('./smoke-ban.mjs');
await import('./smoke-banlist.mjs');
await import('./smoke-sweep.mjs');
console.log('SMOKE PASS');
