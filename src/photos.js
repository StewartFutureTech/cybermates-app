// UX §3 PROFILE PICTURES. Starter characters (goth / jock / gamer x boy / girl) as glass-styled SVG; at most 4 photos travel
// in the profile packet. More than 4 = ROLLING: extras stay on this phone only (LocalKV 'photos-extra', never sent) and a
// different window of 4 is shown each login/logout.
import { kv } from './kv-store.js';
export const MAX_SHOWN = 4;
export const ROLLING_NOTICE = 'You have more than 4 photos. Only 4 are shown at a time; they rotate each time you log in or out. The extras stay on this phone only and are not sent to anyone.';
const P = { goth: ['#7a3cff', '#1a0b2e', '#ff2bd6'], jock: ['#16c6ff', '#06243a', '#ffd23f'], gamer: ['#3dff9a', '#062a1c', '#16c6ff'] };
export const PRESETS = ['goth', 'jock', 'gamer'].flatMap(s => ['boy', 'girl'].map(g => ({ id: `${s}-${g}`, style: s, g, label: `${g === 'boy' ? 'Boy' : 'Girl'} ${s}` })));
export function presetSVG(id) { const [s, g] = id.split('-'), [a, b, c] = P[s] || P.gamer, hair = g === 'girl' ? `<path d="M22 44 Q20 18 50 16 Q80 18 78 44 L82 74 L70 60 L30 60 L18 74 Z" fill="${b}" opacity=".9"/>` : `<path d="M26 40 Q30 16 50 16 Q70 16 74 40 L68 32 L32 32 Z" fill="${b}"/>`;
  const acc = s === 'gamer' ? `<path d="M24 46 Q24 22 50 22 Q76 22 76 46" stroke="${c}" stroke-width="5" fill="none"/><rect x="18" y="42" width="10" height="16" rx="4" fill="${c}"/><rect x="72" y="42" width="10" height="16" rx="4" fill="${c}"/>` : s === 'jock' ? `<path d="M28 30 Q50 14 72 30 L80 34 L28 34 Z" fill="${c}"/>` : `<path d="M38 48 l6 2 M56 50 l6 -2" stroke="${c}" stroke-width="3"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><radialGradient id="gl" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".35" stop-color="${a}" stop-opacity=".55"/><stop offset="1" stop-color="${b}" stop-opacity=".9"/></radialGradient><linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="${c}" stop-opacity=".6"/></linearGradient></defs><circle cx="50" cy="50" r="47" fill="url(#gl)" stroke="url(#rim)" stroke-width="2.5"/><ellipse cx="50" cy="92" rx="30" ry="18" fill="${a}" opacity=".7"/><circle cx="50" cy="50" r="20" fill="#f2d6c9" opacity=".92"/>${hair}${acc}<ellipse cx="36" cy="26" rx="14" ry="7" fill="#fff" opacity=".35" transform="rotate(-25 36 26)"/></svg>`; }
export const presetURL = id => 'data:image/svg+xml;utf8,' + encodeURIComponent(presetSVG(id));
const extras = () => kv('photos-extra');
// add a photo: first 4 go on the profile; later ones go to the local-only extras pool
export async function addPhoto(p, url, owner = p.id) { p.photos = (p.photos || []).slice(0, MAX_SHOWN);
  if (p.photos.length < MAX_SHOWN) { p.photos.push(url); return { placed: 'profile' }; }
  const rec = (await extras().get(owner)) || { id: owner, list: [], at: 0 }; rec.list.push(url); rec.at = Date.now(); await extras().put(rec); return { placed: 'local-extra', notice: ROLLING_NOTICE }; }
export async function allPhotos(p, owner = p.id) { return [...(p.photos || []), ...((await extras().get(owner))?.list || [])]; }
// rotate on login/logout: the shown window advances by one each session
export async function rotate(p, owner = p.id) { const rec = (await extras().get(owner)) || { id: owner, list: [] }, order = [...(rec.order || [])];
  for (const x of [...(p.photos || []), ...(rec.list || [])]) if (!order.includes(x)) order.push(x); if (order.length <= MAX_SHOWN) return p.photos;
  const k = ((rec.k || 0) + MAX_SHOWN) % order.length, win = Array.from({ length: MAX_SHOWN }, (_, i) => order[(k + i) % order.length]);
  p.photos = win; await extras().put({ ...rec, order, list: order.filter(x => !win.includes(x)), k, at: Date.now() }); return win; }
export const packetPhotos = p => (p.photos || []).slice(0, MAX_SHOWN); // the only photos that ever leave the phone
