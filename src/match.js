import { defaultDist } from './data.js';
// Matching: hard filters + shared-interest requirement + OkCupid-style weighted score.
const R = 3958.8;
export function distanceMi(a, b) {
  const t = x => x * Math.PI / 180, dLat = t(b.lat - a.lat), dLng = t(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const lc = a => (a || []).map(x => String(x).toLowerCase());
const inter = (a, b) => { const B = new Set(lc(b)); return (a || []).filter(x => B.has(String(x).toLowerCase())); };

export function sharedItems(a, b, mode) {
  const s = [];
  const add = (label, items) => items.forEach(i => s.push({ label, item: i }));
  add('Game', inter(a.games, b.games));
  const plats = p => [...new Set([...(p.platforms || []), ...Object.keys(p.gamertags || {})])];
  add('Platform', inter(plats(a), plats(b)));
  add('Interest', inter(a.interests, b.interests));
  add('Anime', inter(a.anime, b.anime));
  add('Show', inter(a.shows, b.shows));
  add('Movie', inter(a.movies, b.movies));
  add('Team', inter(a.teams, b.teams));
  add('Streams', inter(a.streaming, b.streaming));
  if (mode === 'gaming') return s.filter(x => ['Game', 'Platform', 'Interest'].includes(x.label) && (x.label !== 'Interest' || x.item === 'esports'));
  return s;
}

function satisfaction(me, them, questions) {
  let earned = 0, possible = 0;
  for (const q of questions) {
    const mine = me.answers?.[q.id], theirs = them.answers?.[q.id];
    if (!mine || !theirs) continue;
    possible += mine.importance; if (mine.accept.includes(theirs.answer)) earned += mine.importance;
  }
  return possible ? earned / possible : null;
}

export function questionScore(a, b, questions) {
  const s1 = satisfaction(a, b, questions), s2 = satisfaction(b, a, questions);
  if (s1 == null || s2 == null) return null;
  return Math.sqrt(s1 * s2); // geometric mean, like OkCupid
}

const same = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
export const KM_PER_MI = 1.609344;
export function prefFor(p, mode) { return p.distPrefs?.[mode] || defaultDist(p.countryCode)[mode]; }
// Does `them` fall inside `me`'s distance setting for this mode?
export function locationOk(me, them, mode, dist) {
  const pr = prefFor(me, mode);
  switch (pr.scope) {
    case 'global': return true;
    case 'country': return same(me.countryCode, them.countryCode);
    case 'region': return same(me.countryCode, them.countryCode) && same(me.region, them.region);
    case 'city': return same(me.countryCode, them.countryCode) && same(me.city, them.city);
    default: { // radius
      if (dist == null) return false;
      const miles = pr.unit === 'km' ? (pr.value || 0) / KM_PER_MI : (pr.value || 0);
      return dist <= miles;
    }
  }
}

function genderOk(a, b) { return !a.seekingGenders?.length || a.seekingGenders.includes(b.gender); }

export function evaluate(me, them, mode, questions) {
  if (me.id === them.id) return null;
  if (!me.lookingFor?.includes(mode) || !them.lookingFor?.includes(mode)) return null;
  const mn = p => p.minor === true || p.age < 18; if (mn(me) !== mn(them)) return null; // v33: minors <-> adults never matched (was: everyone under 18 dropped, which emptied minors' Discover)
  const romantic = mode === 'dating'; if (romantic && (mn(me) || mn(them))) return null; // no dating under 18
  if (romantic && (!genderOk(me, them) || !genderOk(them, me))) return null;
  if (romantic && (them.age < (me.ageMin || 18) || them.age > (me.ageMax || 99) || me.age < (them.ageMin || 18) || me.age > (them.ageMax || 99))) return null;
  const dist = (me.lat != null && them.lat != null) ? distanceMi(me, them) : null;
  if (!locationOk(me, them, mode, dist) || !locationOk(them, me, mode, dist)) return null; // both sides' prefs
  const shared = sharedItems(me, them, mode);
  if (!shared.length) return null; // core rule: must share something
  const q = questionScore(me, them, questions);
  const sharedScore = Math.min(1, shared.length / 8);
  const pct = Math.round(100 * (q == null ? sharedScore : 0.6 * q + 0.4 * sharedScore));
  return { profile: them, pct, shared, dist };
}

export function findMatches(me, all, mode, questions) {
  return all.map(t => evaluate(me, t, mode, questions)).filter(Boolean).sort((x, y) => y.pct - x.pct);
}
