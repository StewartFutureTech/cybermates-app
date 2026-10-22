// UX §5 MATCHING v2: per-mode field weights x per-field importance, soft vs hard compare, deal breakers, "don't answer",
// hidden fields (silent penalty), per-mode age ranges + minimum match %. Score is clamped 0..100.
// Policy guards run FIRST and are never softened: adults and minors are never compared; minors never get dating;
// gender filter only exists in dating.
export const INTEREST_CAP = 20;
export const HIDDEN_PENALTY = 0.25;   // cm-v34: each hidden/unanswered field the other side marked deal-breaker multiplies the score by 0.75, compounding (80 -> 60 -> 45), silently; never reaches 0
export const GAME_BONUS = 6;          // hard compare: each exactly shared specific game (Witcher, Halo…) adds points (cap 3 games)
export const IMPORTANCE = { dontcare: 0, low: 1, mid: 3, high: 6, make: 12 }; // "I don't care" .. "make or break"
// field catalogue: kind set|one|bool, soft category function, which modes care and how much (0..1)
const SPORTS = { football: 'ball', soccer: 'ball', baseball: 'ball', basketball: 'ball', hockey: 'ice', gym: 'fitness', hiking: 'outdoor', skateboarding: 'board' };
const RELIG = r => { r = String(r || '').toLowerCase(); return !r || r === 'prefer not to say' ? null : ['agnostic', 'atheist'].includes(r) ? 'secular' : 'religious'; };
export const FIELDS = {
  games: { kind: 'set', soft: g => 'gamer', w: { dating: 1, friends: .8, gaming: 1, online: 1 } },
  platforms: { kind: 'set', soft: () => 'plays', w: { dating: .6, friends: .5, gaming: 1, online: 1 } },
  favGames: { kind: 'set', soft: () => 'gamer', w: { dating: .6, friends: .6, gaming: 1, online: 1 } },
  sports: { kind: 'set', soft: s => SPORTS[String(s).toLowerCase()] || 'sport', w: { dating: 1, friends: .8, gaming: 0, online: 0 } },
  interests: { kind: 'set', soft: v => v, w: { dating: 1, friends: .8, gaming: 0, online: .1 } }, // v33: Gaming = gaming fields only (UX §5)
  events: { kind: 'set', soft: v => v, w: { dating: .8, friends: .8, gaming: 0, online: 0 } },
  location: { kind: 'one', soft: v => v, w: { dating: 1, friends: .8, gaming: 0, online: 0 } },
  religion: { kind: 'one', soft: RELIG, w: { dating: 1, friends: .15, gaming: 0, online: .02 } },
  politics: { kind: 'one', soft: v => v, w: { dating: 1, friends: .2, gaming: 0, online: .02 } },
  hand: { kind: 'one', soft: v => v, w: { dating: .2, friends: .05, gaming: 0, online: 0 } },
  glasses: { kind: 'bool', soft: v => v, w: { dating: .4, friends: 0, gaming: 0, online: 0 } },
  income: { kind: 'one', soft: v => v, w: { dating: .6, friends: 0, gaming: 0, online: 0 } },
  job: { kind: 'one', soft: v => v === 'none' ? 'none' : 'working', w: { dating: .8, friends: .1, gaming: 0, online: 0 } },
  drinking: { kind: 'one', soft: v => v, w: { dating: .8, friends: .3, gaming: 0, online: 0 } },
  smoking: { kind: 'one', soft: v => v, w: { dating: .9, friends: .3, gaming: 0, online: 0 } },
  kids: { kind: 'one', soft: v => v, w: { dating: 1, friends: 0, gaming: 0, online: 0 } },
};
export const JOB = ['full-time', 'part-time', 'self-employed', 'student', 'none'];
export const HANDS = ['left', 'right', 'both'];
export const POLITICS4 = ['liberal', 'moderate', 'conservative', 'apolitical'];
const lc = a => (Array.isArray(a) ? a : a == null ? [] : [a]).map(x => String(x).toLowerCase());
const minorOf = p => !!p?.minor || (p?.age != null && p.age < 18);
export function capInterests(list) { const u = [...new Set((list || []).map(String))]; return { list: u.slice(0, INTEREST_CAP), dropped: Math.max(0, u.length - INTEREST_CAP) }; }
// value of a field for comparison; null = not comparable (skipped "don't answer", hidden, or empty)
const val = (p, k) => p?.f?.[k] ?? p?.[k] ?? (k === 'location' ? p?.city : undefined);
const hidden = (p, k) => !!p?.hidden?.[k], skipped = (p, k) => !!p?.skip?.[k];
const usable = (p, k) => !hidden(p, k) && !skipped(p, k) && lc(val(p, k)).length > 0;
const imp = (p, k) => { const v = p?.importance?.[k]; return v == null ? IMPORTANCE.mid : typeof v === 'number' ? v : IMPORTANCE[v] ?? IMPORTANCE.mid; };
// soft: same category -> 1 else 0.   hard: exact overlap 1, same-category partial 0.5, per item (Dice-style), + game bonus.
export function compareField(k, a, b, how = 'hard') { const F = FIELDS[k], A = lc(a), B = lc(b); if (!A.length || !B.length) return null;
  const cat = x => F?.soft ? String(F.soft(x) ?? '') : x;
  if (how === 'soft' || F?.kind !== 'set') { if (how === 'hard' && F?.kind !== 'set') return A[0] === B[0] ? 1 : cat(A[0]) && cat(A[0]) === cat(B[0]) ? 0.5 : 0;
    const ca = new Set(A.map(cat)), cb = new Set(B.map(cat)); return [...ca].some(c => c && cb.has(c)) ? 1 : 0; }
  const credit = (X, Y) => X.reduce((s, x) => s + (Y.includes(x) ? 1 : Y.some(y => cat(y) && cat(y) === cat(x)) ? 0.5 : 0), 0);
  return Math.min(1, (credit(A, B) + credit(B, A)) / (A.length + B.length)); }
// deal breaker on field k: me.dealBreakers[k] = true, me.accept[k] = [allowed values] (default: must match my own value)
function dealBreak(me, them, k) { if (!me?.dealBreakers?.[k]) return 'ok'; if (!usable(them, k)) return 'hidden'; // never a hard block
  const ok = acceptFor(me, k); if (!ok.length) return 'ok'; const tv = lc(val(them, k)); return tv.some(x => ok.includes(x)) ? 'ok' : 'block'; } // no criteria set -> toggle has no effect
// accepted values for a deal breaker: the user's picked list, else their own answer (v33: empty list no longer blocks everyone)
export function acceptFor(me, k) { const a = lc(me?.accept?.[k]); return a.length ? a : lc(val(me, k)); }
// ---- cm-v33: per-mode age ranges (clamped to the user's own age band), compare style, minimum %, dating-only fields
export const BAND = { minor: [13, 17], adult: [18, 99] };
const bandOf = p => minorOf(p) ? BAND.minor : BAND.adult;
// clamp a [lo, hi] range into the band (a minor can never ask for adults and vice versa); swaps if reversed
export function clampRange(p, r) { const [B0, B1] = bandOf(p), num = x => x == null || x === '' ? NaN : Number(x); let a = num(r?.[0]), b = num(r?.[1]); if (!Number.isFinite(a)) a = B0; if (!Number.isFinite(b)) b = B1;
  a = Math.max(B0, Math.min(B1, Math.round(a))); b = Math.max(B0, Math.min(B1, Math.round(b))); return a <= b ? [a, b] : [b, a]; }
// the range used for `mode`: ageRanges[mode]; Dating falls back to the onboarding ageMin/ageMax; null = whole band
export function ageRangeFor(p, mode) { const r = p?.ageRanges?.[mode] ?? (mode === 'dating' && (p?.ageMin != null || p?.ageMax != null) ? [p.ageMin, p.ageMax] : null); return r ? clampRange(p, r) : null; }
function ageOk(me, them, mode) { const r = ageRangeFor(me, mode); if (!r || them?.age == null || them.age === '') return true; const a = Number(them.age); return a >= r[0] && a <= r[1]; }
// soft vs hard compare is chosen per mode by the user. Defaults (walkthrough silent): Dating hard, Friends soft, Gaming hard.
export const COMPARE_DEFAULT = { dating: 'hard', friends: 'soft', gaming: 'hard', online: 'hard' };
export const compareFor = (p, mode) => ['soft', 'hard'].includes(p?.compare?.[mode]) ? p.compare[mode] : COMPARE_DEFAULT[mode] || 'hard';
// dating-only profile fields: shown/sent only while Dating is enabled (never for minors)
export const DATING_ONLY = ['seekingGenders', 'orientation', 'ageRange', 'budget'];
export const datingOn = p => !minorOf(p) && (p?.lookingFor || []).includes('dating') && !p?.datingOff;
export const GENDER_FILTER_MODES = ['dating']; // gender filter exists in Dating only; Friends + Gaming are one gender-neutral space
function genderOk(me, them) { return !me.seekingGenders?.length || me.seekingGenders.includes(them.gender); }
// main entry. mode: dating | friends | gaming | online. how: soft | hard. Returns null when not allowed to match at all.
export function score(me, them, mode, { how = compareFor(me, mode) } = {}) {
  if (!me || !them || me.id === them.id) return null;
  if (minorOf(me) !== minorOf(them)) return null;                       // full age-band separation
  if (mode === 'dating' && (minorOf(me) || me.datingOff || them.datingOff)) return null; // no dating for minors / dating disabled
  if (mode === 'dating' && (!genderOk(me, them) || !genderOk(them, me))) return null;   // gender filter: dating only
  if (!ageOk(me, them, mode) || !ageOk(them, me, mode)) return null;
  let penalty = 1;
  for (const [x, y] of [[me, them], [them, me]]) for (const k of Object.keys(x.dealBreakers || {})) { if (!(FIELDS[k]?.w[mode] > 0)) continue;
    const r = dealBreak(x, y, k); if (r === 'block') return null; if (r === 'hidden') penalty *= 1 - HIDDEN_PENALTY; }
  let earned = 0, possible = 0;
  for (const [k, F] of Object.entries(FIELDS)) { const w = F.w[mode] || 0; if (!w || !usable(me, k) || !usable(them, k)) continue;
    const c = compareField(k, val(me, k), val(them, k), how); if (c == null) continue; const im = (imp(me, k) + imp(them, k)) / 2; if (!im) continue;
    earned += c * w * im; possible += w * im; }
  let pct = possible ? (earned / possible) * 100 : 50;
  if (how === 'hard') { const g = lc(val(me, 'games')).filter(x => lc(val(them, 'games')).includes(x)).length + lc(val(me, 'favGames')?.map?.(f => f.game ?? f)).filter(x => lc(val(them, 'favGames')?.map?.(f => f.game ?? f)).includes(x)).length; pct += Math.min(3, g) * GAME_BONUS; }
  const out = Math.round(Math.max(0, Math.min(100, pct * penalty)));
  return penalty < 1 ? Math.max(1, out) : out; // cm-v34: a hidden-field penalty never drives the score to 0 or below
}
// discovery filter: min match per mode (me.minMatch[mode]). Doc example was Dating 70 / Friends 60 / Gaming 90; defaults are
// lower so a fresh profile in a small mesh is not shown an empty Discover. Users raise them per mode.
export const DEFAULT_MIN = { dating: 50, friends: 40, gaming: 40, online: 30 };
export const minFor = (p, mode) => { const v = Number(p?.minMatch?.[mode]); return Number.isFinite(v) && p?.minMatch?.[mode] !== '' && p?.minMatch?.[mode] != null ? Math.max(0, Math.min(100, v)) : DEFAULT_MIN[mode] ?? 0; };
export function rank(me, people, mode, opts) { const min = minFor(me, mode);
  return people.map(p => ({ profile: p, pct: score(me, p, mode, opts) })).filter(x => x.pct != null && x.pct >= min).sort((a, b) => b.pct - a.pct); }
// Compact match packet that travels with the public profile: visible answers only. Hidden / "don't answer" fields send
// NO value (just the key in `h`), so the other side can apply the silent penalty without ever learning the answer.
// Religion stays on-device (sensitive) and is never put in the packet.
export function matchPacket(p) { const f = {}, h = []; for (const k of Object.keys(FIELDS)) { if (k === 'religion' || k === 'location') continue; const v = p?.f?.[k] ?? p?.[k];
    if (p?.hidden?.[k] || p?.skip?.[k]) { h.push(k); continue; } if (v != null && (!Array.isArray(v) || v.length)) f[k] = Array.isArray(v) ? v.slice(0, INTEREST_CAP) : v; }
  const db = Object.keys(p?.dealBreakers || {}).filter(k => FIELDS[k] && k !== 'religion'); const acc = Object.fromEntries(db.map(k => [k, p.accept?.[k] ?? p?.f?.[k] ?? p?.[k]]));
  const ar = { ...(p?.ageRanges || {}) }; if (datingOn(p) && !ar.dating && ageRangeFor(p, 'dating')) ar.dating = ageRangeFor(p, 'dating'); if (!datingOn(p)) delete ar.dating; // v33: dating range only while dating is on
  return { f, h, db, acc, imp: p?.importance || {}, ar, ...(p?.datingOff ? { doff: 1 } : {}) }; }
export const fromPacket = (base, mp) => mp ? { ...base, f: mp.f, hidden: Object.fromEntries((mp.h || []).map(k => [k, true])), dealBreakers: Object.fromEntries((mp.db || []).map(k => [k, true])), accept: mp.acc, importance: mp.imp, ageRanges: mp.ar, datingOff: !!mp.doff } : base;
// cm-v33 Discover pipeline (pure; main.js passes the legacy evaluator from match.js for shared items + distance + the
// OkCupid question score). Policy guards (band separation, no minor dating, dating-only gender filter, per-mode age
// ranges, deal breakers) all live in score(); a row survives only if BOTH say yes. Shown % = mean of the legacy score and
// the v2 score, and the user's per-mode minimum applies to that shown number. Sorted best first.
export function discoverList(me, all, mode, legacy = null) { const min = minFor(me, mode), how = compareFor(me, mode), out = [];
  if (!me || (mode === 'dating' && !datingOn(me))) return out;
  for (const p of all || []) { const v2 = score(me, p, mode, { how }); if (v2 == null) continue; const e = legacy ? legacy(p) : { profile: p, pct: v2, shared: [] }; if (!e) continue;
    const pct = Math.round(((e.pct ?? v2) + v2) / 2); if (pct < min) continue; out.push({ ...e, v2, pct, how }); }
  return out.sort((a, b) => b.pct - a.pct); }
