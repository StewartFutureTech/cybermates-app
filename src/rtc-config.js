// WebRTC ICE configuration. STUN only by default. TURN is a CONFIG SLOT LEFT EMPTY on purpose: no TURN host or credential
// is bundled in this app. When a TURN service exists, fill TURN_SERVERS at deploy time (or set VITE_TURN_URLS /
// VITE_TURN_USERNAME / VITE_TURN_CREDENTIAL, ideally short-lived credentials minted by a server endpoint) — never commit a
// long-lived TURN secret. Without TURN, peers behind symmetric NAT / strict carrier NAT will fail to connect.
export const STUN_SERVERS = ['stun:stun.l.google.com:19302'];
export const TURN_SERVERS = []; // e.g. [{ urls: ['turns:turn.example.com:443'], username: '<short-lived>', credential: '<short-lived>' }]
export function iceServers(env = (typeof import.meta !== 'undefined' && import.meta.env) || {}, turn = TURN_SERVERS) {
  const s = [{ urls: (env.VITE_STUN_URLS ? env.VITE_STUN_URLS.split(',') : STUN_SERVERS) }];
  for (const t of turn) if (t?.urls?.length) s.push(t);
  if (env.VITE_TURN_URLS) s.push({ urls: env.VITE_TURN_URLS.split(','), username: env.VITE_TURN_USERNAME || '', credential: env.VITE_TURN_CREDENTIAL || '' });
  return s; }
export const hasTurn = (env, turn) => iceServers(env, turn).length > 1;
