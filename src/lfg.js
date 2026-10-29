// UX §13-14 GAMING EXTRAS + TAB FEATURES: favorite games (console + game, multiplayer-focused), Looking-For-Group board,
// Friends "Create Event" (events post alongside profiles and are matched to people who like that event type).
// Storage: kv-store MeshKV (local now, gossiped to peers; Supabase later). Age bands never mix: a minor never sees an
// adult's post and vice versa; receivers re-check on every gossiped record.
import { kv } from './kv-store.js';
export const CONSOLES = ['PC', 'PlayStation 5', 'PlayStation 4', 'Xbox Series X|S', 'Xbox One', 'Nintendo Switch', 'Mobile', 'VR'];
export const MP_GAMES = ['ARK: Survival Ascended', 'Fortnite', 'Call of Duty', 'Apex Legends', 'Valorant', 'League of Legends', 'Overwatch 2', 'Halo Infinite', 'Destiny 2', 'Rocket League', 'Minecraft', 'Sea of Thieves', 'Helldivers 2', 'Rust', 'Dead by Daylight', 'Counter-Strike 2', 'Rainbow Six Siege', 'World of Warcraft', 'Final Fantasy XIV', 'EA FC', 'Smash Bros', 'Mario Kart', 'Monster Hunter', 'Palworld', 'Lethal Company', 'Phasmophobia', 'GTA Online', 'Warframe', 'The Finals', 'Marvel Rivals'];
export const EVENT_TYPES = ['concert', 'sports game', 'gaming meetup', 'LAN party', 'convention', 'movie night', 'hike', 'food', 'study group', 'other'];
export const LFG_TTL_MS = 6 * 3600e3, EVENT_MAX_DAYS = 60, MAX_FAV = 10;
const bandOf = p => (p?.minor || (p?.age != null && p.age < 18)) ? 'minor' : 'adult';
const clip = (s, n) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
export function setFavorites(p, favs) { const out = []; for (const f of favs || []) { const console_ = CONSOLES.includes(f.console) ? f.console : null, game = clip(f.game, 60);
    if (!console_ || !game || out.some(o => o.console === console_ && o.game === game)) continue; out.push({ console: console_, game, mp: MP_GAMES.includes(game) }); }
  p.favGames = out.slice(0, MAX_FAV); return p.favGames; }
const validPost = (r, from, me) => r && r.owner === from && r.band === bandOf(me) && typeof r.title === 'string' && r.title.length <= 80 && (!r.expires || r.expires > Date.now());
export const lfgStore = (transport, me) => kv('lfg', { backend: 'mesh', transport, validate: (r, f) => validPost(r, f, me) && r.kind === 'lfg' });
export const eventStore = (transport, me) => kv('events', { backend: 'mesh', transport, validate: (r, f) => validPost(r, f, me) && r.kind === 'event' && EVENT_TYPES.includes(r.type) });
export async function postLFG(store, me, { game, console: c, need = 1, mic = false, note = '' }, now = Date.now()) {
  if (!clip(game, 60)) return { ok: false, reason: 'game' }; const mine = await store.list(r => r.owner === me.code && r.expires > now); for (const r of mine) await store.del(r.id); // one active post each
  const rec = { id: `lfg-${me.code}-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, kind: 'lfg', owner: me.code, name: clip(me.name, 40), band: bandOf(me), title: clip(`${game} · need ${need}`, 80), game: clip(game, 60), console: CONSOLES.includes(c) ? c : null, need: Math.max(1, Math.min(10, need | 0)), mic: !!mic, note: clip(note, 200), at: now, expires: now + LFG_TTL_MS };
  return { ok: true, rec: await store.put(rec) }; }
export async function boardFor(store, me, { game, console: c } = {}, now = Date.now()) { const b = bandOf(me);
  return (await store.list(r => r.kind === 'lfg' && r.band === b && r.expires > now && (!game || r.game === game) && (!c || r.console === c))).sort((x, y) => y.at - x.at); }
export async function createEvent(store, me, { title, type, when, city = '', note = '' }, now = Date.now()) {
  if (!EVENT_TYPES.includes(type)) return { ok: false, reason: 'type' }; const t = +new Date(when); if (!(t > now) || t - now > EVENT_MAX_DAYS * 864e5) return { ok: false, reason: 'when' }; if (!clip(title, 80)) return { ok: false, reason: 'title' };
  const rec = { id: `ev-${me.code}-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`, kind: 'event', owner: me.code, name: clip(me.name, 40), band: bandOf(me), title: clip(title, 80), type, when: t, city: clip(city, 60), note: clip(note, 300), at: now, expires: t + 6 * 3600e3 };
  return { ok: true, rec: await store.put(rec) }; }
// events shown next to profiles in Friends, ranked by whether the viewer likes that event type
export async function eventsFor(store, me, now = Date.now()) { const likes = new Set((me.eventTypes || []).map(String)), b = bandOf(me);
  return (await store.list(r => r.kind === 'event' && r.band === b && r.expires > now)).map(r => ({ ...r, match: likes.has(r.type) ? 1 : 0 })).sort((x, y) => y.match - x.match || x.when - y.when); }
