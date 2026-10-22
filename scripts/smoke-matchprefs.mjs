// cm-v33 UX §5 matching: per-mode weights, deal breakers (+ accept lists), soft vs hard compare, hidden-field "sneaky"
// penalty, per-mode age ranges clamped to the age band, per-mode minimum %, dating-only fields, Dating-only gender filter,
// minors/adults never crossed. Pure logic + HTML strings (no browser). node scripts/smoke-matchprefs.mjs
globalThis.localStorage ??= { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } };
let fail = 0, n = 0; const ok = (c, m) => { n++; console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail++; };
const MV = await import('../src/match-v2.js'), L = await import('../src/match.js'), D = await import('../src/data.js');
const P = (o = {}) => ({ id: Math.random().toString(36).slice(2), age: 28, lookingFor: ['friends', 'gaming', 'dating'], gender: 'Woman', seekingGenders: ['Man', 'Woman'], ...o });
// --- per-mode weights
{ const a = P({ games: ['Halo'], interests: ['anime'] }), b = P({ games: ['Halo'], interests: ['cooking'] }), c = P({ games: ['Halo'], interests: ['anime'] });
  ok(MV.score(a, b, 'gaming') === MV.score(a, c, 'gaming'), 'Gaming scores gaming fields only (interests ignored)');
  ok(MV.score(a, b, 'friends') < MV.score(a, c, 'friends'), 'Friends still weighs interests');
  const r = (x, y, m) => MV.score(P({ religion: x, sports: ['soccer'], importance: { religion: 'make' } }), P({ religion: y, sports: ['soccer'], importance: { religion: 'make' } }), m);
  ok(r('Christian', 'Atheist', 'dating') < r('Christian', 'Atheist', 'friends') && r('Christian', 'Atheist', 'friends') < r('Christian', 'Christian', 'friends'), 'religion: full weight in Dating, much lower in Friends');
  ok(MV.FIELDS.religion.w.gaming === 0 && MV.FIELDS.religion.w.online <= .02, 'religion barely matters for gaming/online'); }
// --- soft vs hard
{ const a = P({ sports: ['soccer', 'baseball'] }), b = P({ sports: ['football'] });
  ok(MV.COMPARE_DEFAULT.dating === 'hard' && MV.COMPARE_DEFAULT.friends === 'soft' && MV.COMPARE_DEFAULT.gaming === 'hard', 'compare defaults: Dating hard, Friends soft, Gaming hard');
  ok(MV.compareFor({ compare: { friends: 'hard' } }, 'friends') === 'hard' && MV.compareFor({ compare: { friends: 'bogus' } }, 'friends') === 'soft', 'compare style is per mode and validated');
  const soft = MV.score({ ...a, compare: { friends: 'soft' } }, b, 'friends'), hard = MV.score({ ...a, compare: { friends: 'hard' } }, b, 'friends');
  ok(soft === 100 && hard === 50, `soft = category match (${soft}%), hard = partial credit (${hard}%)`);
  const g2 = MV.score(P({ games: ['Witcher', 'Halo'] }), P({ games: ['Witcher', 'Halo'] }), 'gaming', { how: 'hard' }), g0 = MV.score(P({ games: ['Witcher'], platforms: ['Xbox'] }), P({ games: ['Halo'], platforms: ['Xbox'] }), 'gaming', { how: 'hard' });
  ok(g2 > g0 && g2 <= 100 && g0 >= 0, `hard compare: same specific games earn extra points, clamped (${g2} vs ${g0})`); }
// --- deal breakers
{ const me = P({ sports: ['soccer'], f: { glasses: 'yes' }, dealBreakers: { glasses: true }, accept: { glasses: ['no'] } });
  ok(MV.score(me, P({ sports: ['soccer'], f: { glasses: 'yes' } }), 'dating') === null, 'deal breaker with accept list: excluded value blocks');
  ok(MV.score(me, P({ sports: ['soccer'], f: { glasses: 'no' } }), 'dating') != null, 'deal breaker with accept list: accepted value passes');
  ok(MV.score(me, P({ sports: ['soccer'], f: { glasses: 'yes' } }), 'friends') != null, 'deal breaker on a field the mode ignores (glasses in Friends) has no effect');
  ok(MV.score(P({ sports: ['soccer'], dealBreakers: { smoking: true } }), P({ sports: ['soccer'], f: { smoking: 'yes' } }), 'dating') != null, 'deal breaker with no answer and no accept list does not block everyone');
  ok(MV.acceptFor({ f: { smoking: 'no' } }, 'smoking').join() === 'no' && MV.acceptFor({ f: { smoking: 'no' }, accept: { smoking: ['no', 'sometimes'] } }, 'smoking').length === 2, 'accept list defaults to own answer'); }
// --- hidden fields: sneaky penalty
{ const me = P({ sports: ['soccer'], f: { smoking: 'no' }, dealBreakers: { smoking: true } });
  const vis = MV.score(me, P({ sports: ['soccer'], f: { smoking: 'no' } }), 'dating'), hid = MV.score(me, P({ sports: ['soccer'], f: { smoking: 'yes' }, hidden: { smoking: true } }), 'dating');
  ok(hid != null && Math.abs(hid - Math.round(vis * (1 - MV.HIDDEN_PENALTY))) <= 1, `hidden + their deal breaker = significant silent penalty, never a block (${vis} -> ${hid})`);
  ok(MV.HIDDEN_PENALTY === 0.25, 'cm-v34: each hidden deal-breaker field multiplies the score by 0.75');
  ok(Math.abs(MV.score(me, P({ sports: ['soccer'], f: { smoking: 'no' }, skip: { smoking: true } }), 'dating') - hid) <= 0, 'blank/"don\'t answer" and hidden count the same');
  const two = MV.score({ ...me, f: { smoking: 'no', drinking: 'no' }, dealBreakers: { smoking: true, drinking: true } }, P({ sports: ['soccer'], hidden: { smoking: true, drinking: true } }), 'dating');
  ok(two != null && two < hid, `each hidden deal-breaker field compounds (${two})`);
  { const base = MV.score({ ...me, f: { smoking: 'no', drinking: 'no' }, dealBreakers: {} }, P({ sports: ['soccer'], hidden: { smoking: true, drinking: true } }), 'dating');
    ok(Math.abs(two - Math.round(base * 0.75 * 0.75)) <= 1, `two hidden fields compound x0.75 x0.75 (${base} -> ${two})`); }
  { const dbAll = Object.fromEntries(Object.keys(MV.FIELDS).filter(k => MV.FIELDS[k].w.dating > 0).map(k => [k, true])), hidAll = { ...dbAll };
    const s = MV.score(P({ sports: ['soccer'], dealBreakers: dbAll }), P({ sports: ['soccer'], hidden: hidAll }), 'dating'); ok(s != null && s >= 1, `many hidden deal breakers never reach 0 (${s})`); }
  ok([80, 60, 45].every((v, i, a) => !i || Math.round(a[i - 1] * (1 - MV.HIDDEN_PENALTY)) === v), 'documented example 80 -> 60 -> 45');
  ok(typeof hid === 'number', 'score is a bare number: no reason is exposed to either party');
  ok(MV.score(P({ sports: ['soccer'], f: { smoking: 'no' }, dealBreakers: { smoking: true } }), P({ sports: ['soccer'], f: { smoking: 'yes' }, skip: { smoking: true } }), 'dating') != null, '"don\'t answer" vs a deal breaker: same silent penalty, never a block');
  const pk = MV.matchPacket(P({ f: { smoking: 'yes' }, hidden: { smoking: true } })); ok(!('smoking' in pk.f) && pk.h.includes('smoking'), 'packet: hidden value never sent, only the key'); }
// --- per-mode age ranges
{ ok(MV.clampRange({ age: 15 }, [10, 40]).join() === '13,17' && MV.clampRange({ age: 30 }, [5, 200]).join() === '18,99' && MV.clampRange({ age: 30 }, [40, 25]).join() === '25,40' && MV.clampRange({ age: 30 }, [null, '']).join() === '18,99' && MV.clampRange({ age: 15 }, [null, 16]).join() === '13,16', 'age ranges clamp into own band (minor 13-17, adult 18-99) and swap if reversed');
  ok(MV.ageRangeFor({ age: 30, ageMin: 25, ageMax: 35 }, 'dating').join() === '25,35' && MV.ageRangeFor({ age: 30, ageMin: 25, ageMax: 35 }, 'friends') === null, 'Dating range falls back to onboarding ageMin/ageMax; other modes default to whole band');
  const me = P({ age: 30, ageRanges: { dating: [28, 32], friends: [20, 60], gaming: [18, 99] } }), t = P({ age: 45 });
  ok(MV.score(me, t, 'dating') === null && MV.score(me, t, 'friends') != null, 'separate age range per mode');
  ok(MV.score(P({ age: 30 }), P({ age: 45, ageRanges: { friends: [40, 50] } }), 'friends') === null, 'ranges are mutual (their range must include me)');
  ok(MV.score(P({ age: 16, minor: true, ageRanges: { friends: [13, 99] } }), P({ age: 19 }), 'friends') === null, 'a minor widening the range still never reaches adults'); }
// --- minimum match per mode + discoverList
{ const me = P({ sports: ['soccer'], games: ['Halo'] }), ppl = [P({ sports: ['soccer'], games: ['Halo'] }), P({ sports: ['golf'], games: ['Zelda'], interests: ['x'] })];
  ok(MV.minFor({}, 'dating') === MV.DEFAULT_MIN.dating && MV.minFor({ minMatch: { gaming: 90 } }, 'gaming') === 90 && MV.minFor({ minMatch: { gaming: 0 } }, 'gaming') === 0 && MV.minFor({ minMatch: { gaming: 300 } }, 'gaming') === 100, 'minimum % per mode (default, set, 0 allowed, clamped)');
  const all = MV.discoverList({ ...me, minMatch: { friends: 0 } }, ppl, 'friends'), hi = MV.discoverList({ ...me, minMatch: { friends: 95 } }, ppl, 'friends');
  ok(all.length === 2 && hi.length < all.length && hi.every(x => x.pct >= 95), `minimum % filters Discover (${all.map(x => x.pct)} -> ${hi.map(x => x.pct)})`);
  ok(all[0].pct >= all[1].pct, 'Discover sorted best match first');
  ok(MV.discoverList({ ...me, datingOff: true }, ppl, 'dating').length === 0, 'Dating off: no dating Discover');
  const kid = P({ age: 15, minor: true, lookingFor: ['friends', 'gaming'], sports: ['soccer'] }), kid2 = P({ age: 16, minor: true, lookingFor: ['friends', 'gaming'], sports: ['soccer'] }), adult = P({ sports: ['soccer'] });
  const kl = MV.discoverList({ ...kid, minMatch: { friends: 0 } }, [kid2, adult], 'friends');
  ok(kl.length === 1 && kl[0].profile.id === kid2.id, 'minor Discover: only other minors');
  ok(MV.discoverList({ ...adult, minMatch: { friends: 0 } }, [kid, kid2], 'friends').length === 0, 'adult Discover: never minors');
  ok(MV.discoverList({ ...kid, lookingFor: ['friends', 'dating'] }, [kid2], 'dating').length === 0 && !MV.datingOn({ ...kid, lookingFor: ['dating'] }), 'minors never get Dating, even with a forged mode');
  const man = P({ gender: 'Man', sports: ['soccer'] }), onlyW = { ...adult, seekingGenders: ['Woman'], minMatch: { friends: 0, gaming: 0, dating: 0 } };
  ok(MV.discoverList(onlyW, [man], 'dating').length === 0 && MV.discoverList(onlyW, [man], 'friends').length === 1 && MV.discoverList(onlyW, [man], 'gaming').length === 1, 'gender filter ("only women") applies in Dating only');
  ok(MV.GENDER_FILTER_MODES.join() === 'dating', 'gender filter mode list = Dating only'); }
// --- legacy evaluator (shared items/distance) now keeps minors <-> minors, still never across
{ const k1 = { id: 1, age: 15, minor: true, lookingFor: ['friends'], games: ['Halo'], countryCode: 'US', distPrefs: { friends: { scope: 'global' } } }, k2 = { ...k1, id: 2, age: 16 }, ad = { ...k1, id: 3, age: 30, minor: false };
  ok(L.evaluate(k1, k2, 'friends', D.QUESTIONS) != null && L.evaluate(k1, ad, 'friends', D.QUESTIONS) === null && L.evaluate(ad, k1, 'friends', D.QUESTIONS) === null, 'legacy evaluate: minor<->minor allowed, minor<->adult never');
  ok(L.evaluate({ ...k1, lookingFor: ['dating'] }, { ...k2, lookingFor: ['dating'] }, 'dating', D.QUESTIONS) === null, 'legacy evaluate: no dating under 18'); }
// --- dating-only fields in packet + profile UI
{ const on = MV.matchPacket(P({ ageRanges: { dating: [25, 30], friends: [20, 40] } })), off = MV.matchPacket(P({ datingOff: true, lookingFor: ['friends'], ageRanges: { dating: [25, 30], friends: [20, 40] } })), kid = MV.matchPacket({ age: 15, minor: true, ageRanges: { dating: [13, 17] } });
  ok(on.ar.dating && !off.ar.dating && off.ar.friends && !kid.ar.dating, 'dating age range is only sent while Dating is on (never for minors)');
  ok(MV.DATING_ONLY.includes('seekingGenders') && MV.DATING_ONLY.includes('ageRange'), 'dating-only field list');
  const UX = await import('../src/ux-ui.js');
  const hA = UX.prefsCard(P()), hOff = UX.prefsCard(P({ datingOff: true, lookingFor: ['friends'] })), hK = UX.prefsCard({ age: 15, minor: true, lookingFor: ['friends', 'gaming'] });
  ok(/id="dating-on" checked/.test(hA) && /data-modeprefs="dating" data-dating-only>/.test(hA), 'adult with Dating on: dating box visible');
  ok(/data-modeprefs="dating" data-dating-only hidden/.test(hOff) && !/id="dating-on" checked/.test(hOff), 'Dating off: dating-only box rendered hidden (toggle shows it live)');
  ok(!/dating-on/.test(hK) && !/data-modeprefs="dating"/.test(hK) && /data-minor-note/.test(hK) && /min="13" max="17"/.test(hK) && !/Income/.test(hK), 'minor: no Dating toggle, no dating box, ages limited to 13-17, no income/kids');
  for (const m of ['dating', 'friends', 'gaming']) ok(new RegExp(`data-ar="${m}.0"`).test(hA) && new RegExp(`data-mm="${m}"`).test(hA) && new RegExp(`data-cmp="${m}"`).test(hA), `${m}: own age range + min % + soft/hard setting`);
  ok(/data-ar="friends.0" min="18" max="99" value="18"/.test(hA) && /data-ar="friends.1" min="18" max="99" value="99"/.test(hA) && /data-ar="friends.1" min="13" max="17" value="17"/.test(hK), 'unset ranges default to the whole band (adult 18-99, minor 13-17)');
  ok(/data-accwrap="glasses" hidden/.test(hA) && /data-acc="glasses"/.test(hA), 'deal-breaker accept bubbles appear only when the toggle is on');
  ok(/I don't want to answer this/.test(hA) && /<select data-pf="religion"/.test(hA) && /data-bub="politics"/.test(hA), 'input rules: big list = dropdown, small sets = bubbles, per-field "don\'t answer"'); }
console.log(fail ? `MATCHPREFS: ${fail}/${n} FAIL` : `ALL MATCHPREFS OK (${n})`); process.exit(fail ? 1 : 0);
