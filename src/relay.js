// Random relay rotation with layered (onion-style) wrapping. Runs over the current transport (local bus / Supabase broadcast).
//  - Path: 2-3 random hops from the active list, re-picked every ROTATE_MS and per conversation (destination).
//  - Eligible relays: advertise relay:true in a recent ping (= that user is online AND searching), have a known X25519 key,
//    and are NOT banned, NOT user-blocked, and (when requireAttested) attested. Fewer than MIN_HOPS eligible -> fallback:
//    send direct over the current transport.
//  - Layers: each hop gets nacl.box(ephemeral -> hop X25519 key) of {next, p} (or {fin, p} for the exit), so a relay learns only
//    the previous hop (packet came from the bus) and the next hop. The innermost payload is the already E2E-encrypted envelope.
//  - Padding: every layer's plaintext is padded to a fixed bucket (PAD_BUCKET bytes); relays add JITTER_MS random delay.
//  - Relaying happens only while the user is online and searching (relayActive()); idle phones drop onion packets.
import nacl from 'tweetnacl';
import { b64, unb64 } from './vault.js';
export const ROTATE_MS = 3 * 60e3, MIN_HOPS = 2, MAX_HOPS = 3, PAD_BUCKET = 2048, JITTER_MS = [20, 120], RELAY_FRESH_MS = 2 * 60e3;
const te = new TextEncoder(), td = new TextDecoder();
export const pad = s => { const n = Math.ceil((s.length + 1) / PAD_BUCKET) * PAD_BUCKET; return s + '\u0000' + ' '.repeat(n - s.length - 1); };
export const unpad = s => s.slice(0, s.indexOf('\u0000'));
const randInt = n => { const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a); return a[0] % n; };
export const jitter = () => JITTER_MS[0] + randInt(JITTER_MS[1] - JITTER_MS[0]);
export function boxTo(xpubB64, obj) { const e = nacl.box.keyPair(), n = nacl.randomBytes(24); return { e: b64(e.publicKey), n: b64(n), c: b64(nacl.box(te.encode(pad(JSON.stringify(obj))), n, unb64(xpubB64), e.secretKey)) }; }
export function unbox(xsecB64, z) { const m = nacl.box.open(unb64(z.c), unb64(z.n), unb64(z.e), unb64(xsecB64)); return m ? JSON.parse(unpad(td.decode(m))) : null; }
// Build the onion: path = [code...]; xpubOf(code) -> X25519 key. Returns the packet for the first hop.
// ret (optional): a pre-built RETURN onion (reverse path back to the sender) the exit hop posts if the recipient is offline.
// No store-and-forward: the exit never holds the message; it returns it at once.
export function wrap(env, path, xpubOf, ret = null) {
  let z = null; for (let i = path.length - 1; i >= 0; i--) z = boxTo(xpubOf(path[i]), i === path.length - 1 ? { fin: 1, p: env, ...(ret ? { ret } : {}) } : { next: path[i + 1], p: z });
  return { k: 'onion', hop: path[0], z };
}
// Return onion: exit -> ... -> first hop -> sender. Innermost payload for the sender: {undeliv: ref}.
export function returnPath(hops, me, ref, xpubOf) { const back = hops.slice(0, -1).reverse().concat([me]); return wrap({ undeliv: ref }, back, xpubOf); }
export class RelayRouter {
  constructor({ me, xsec, xpubOf, candidates, isBanned = () => false, isBlocked = () => false, isAttested = () => true, requireAttested = false, now = () => Date.now(), isLinked = () => false, isOnline = () => true }) {
    Object.assign(this, { me, xsec, xpubOf, candidates, isBanned, isBlocked, isAttested, requireAttested, now, isLinked, isOnline }); this.paths = new Map(); this.relayers = new Map(); this.active = false;
  }
  noteRelayer(code, on) { if (on) this.relayers.set(code, this.now()); else this.relayers.delete(code); }
  eligible(exclude = []) { const t = this.now(), ex = new Set([this.me, ...exclude]);
    return this.candidates().filter(c => !ex.has(c) && (t - (this.relayers.get(c) || 0)) <= RELAY_FRESH_MS && this.xpubOf(c) && !this.isBanned(c) && !this.isBlocked(c) && (!this.requireAttested || this.isAttested(c))); }
  // Prefer already-open direct links (friends) as hops (saves connections/battery, counts within the connection cap), but
  // REQUIRE at least one random non-friend hop per path (mixing); paths keep rotating. No non-friend relay -> direct fallback.
  path(to) { // rotating, per conversation
    const cur = this.paths.get(to), t = this.now(), pool = this.eligible([to]);
    if (cur && t - cur.at < ROTATE_MS && cur.hops.every(h => pool.includes(h))) return cur.hops;
    if (pool.length < MIN_HOPS) { this.paths.delete(to); return null; } // fallback: direct
    const strangers = pool.filter(c => !this.isLinked(c)), linked = pool.filter(c => this.isLinked(c));
    if (!strangers.length) { this.paths.delete(to); return null; } // need >= 1 random non-friend hop
    const n = Math.min(MAX_HOPS, pool.length, MIN_HOPS + randInt(MAX_HOPS - MIN_HOPS + 1)), hops = [], L = [...linked], S = [...strangers];
    hops.push(S.splice(randInt(S.length), 1)[0]); // the mandatory random non-friend hop
    while (hops.length < n && L.length) hops.push(L.splice(randInt(L.length), 1)[0]); // then open friend links first
    while (hops.length < n && S.length) hops.push(S.splice(randInt(S.length), 1)[0]);
    for (let i = hops.length - 1; i > 0; i--) { const j = randInt(i + 1); [hops[i], hops[j]] = [hops[j], hops[i]]; } // shuffle positions
    this.paths.set(to, { hops, at: t }); return hops;
  }
  route(env, ref = null) { const hops = env.to === '*' ? null : this.path(env.to); if (!hops) return { via: null, pkt: { k: 'mesh', env } };
    const xp = c => this.xpubOf(c), ret = this.xpubOf(this.me) ? returnPath(hops, this.me, ref ?? env.id ?? null, xp) : null; return { via: hops, pkt: wrap(env, hops, xp, ret) }; }
  // Relay side. Returns {delay, pkt} to post, or null (not for us / idle / undecryptable).
  onPacket(m) { if (m?.k !== 'onion' || m.hop !== this.me || !this.active) return null; let l; try { l = unbox(this.xsec, m.z); } catch { l = null; } if (!l) return null;
    if (l.fin && l.p?.undeliv !== undefined) return { undeliverable: l.p.undeliv }; // returned to us (sender)
    if (l.fin) { if (l.p?.to && l.p.to !== '*' && !this.isOnline(l.p.to)) return l.ret ? { delay: jitter(), pkt: l.ret, returned: true } : null; return { delay: jitter(), pkt: { k: 'mesh', env: l.p } }; }
    if (this.isBanned(l.next) || this.isBlocked(l.next)) return null;
    return { delay: jitter(), pkt: { k: 'onion', hop: l.next, z: l.p } }; }
}
