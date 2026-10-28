// v46 REALTIME JOIN GATE (client side). The shared Supabase Realtime broadcast topic 'mesh' (src/net.js SupabaseBus) is a
// PRIVATE channel: Realtime only lets a user join / send when the database says they are ADMITTED (migration
// 20261027000013_realtime_gate.sql, app.mesh_topic_ok). Admission = public.mesh_admit(...) with a FRESH proof of work bound to
// this Supabase user id + mesh ID code + signing key + the current 10-minute window (so a proof can't be replayed by anyone
// else or later), checked in SQL with SHA-256 - the same puzzle as the v43 ID binding (src/idbind.js), own domain string.
// Attested users (Play Integrity / App Attest verified server-side, public.mesh_admit_service = the hook) pay a lighter cost.
// Per-user limits live in the DB (attempts per hour/day, admission lifetime, suspensions); this file only:
//   * gets a session (an existing sign-in; else anonymous sign-in when the project allows it) - no session = no join (fail closed),
//   * asks mesh_gate_info for the current window + required work, solves it off the UI path (yields), calls mesh_admit,
//   * caches the admission until shortly before it expires, and backs off on refusals (rate / suspended / bad proof).
import { solvePowSeed, verifyPowSeed, sha256Bytes } from './idbind.js';
export const WINDOW_SECS = 600, RENEW_BEFORE_MS = 10 * 60e3, DEFAULT_POW = { b: 16, k: 6 }, POW_CAP = { b: 24, k: 32 };
const te = new TextEncoder();
export const admitWindow = (now = Date.now()) => Math.floor(now / 1000 / WINDOW_SECS);
export const admitSeed = ({ uid, code, pub, w, b, k }) => sha256Bytes(te.encode(`cm-mesh-admit-v1|${uid}|${code}|${pub}|${w}|${b}|${k}`));
export async function solveAdmission({ uid, code, pub, w, pow = DEFAULT_POW, ...o }) {
  const b = Math.min(POW_CAP.b, Math.max(0, pow.b | 0)), k = Math.min(POW_CAP.k, Math.max(1, pow.k | 0));
  const { n, hashes } = await solvePowSeed(admitSeed({ uid, code, pub, w, b, k }), { b, k }, o);
  return { args: { p_code: code, p_pub: pub, p_w: w, p_b: b, p_k: k, p_n: n }, hashes };
}
export const verifyAdmission = ({ uid, code, pub, w, b, k, n }) => verifyPowSeed(admitSeed({ uid, code, pub, w, b, k }), { b, k }, n);
export class GateError extends Error { constructor(reason, extra = {}) { super('mesh gate: ' + reason); this.gate = reason; Object.assign(this, extra); } }
// MeshGate({ client, identity:{code,pub}, now, anon }) - ensure() resolves { uid, expiresAt, att } or throws GateError
export class MeshGate {
  constructor({ client, identity, now = () => Date.now(), anon = true, solveOpts = {} }) { Object.assign(this, { client, identity, now, anon, solveOpts }); this.adm = null; this.inflight = null; this.blockedUntil = 0; this.last = null; }
  async session() {
    let s = (await this.client.auth.getSession())?.data?.session || null;
    if (!s && this.anon && this.client.auth.signInAnonymously) { const r = await this.client.auth.signInAnonymously().catch(e => ({ error: e })); s = r?.data?.session || null; }
    if (!s?.user?.id) throw new GateError('signin', { note: 'sign in to join the network' });
    return s;
  }
  valid() { return !!this.adm && this.adm.expiresAt - this.now() > RENEW_BEFORE_MS; }
  ensure() { if (this.valid()) return Promise.resolve(this.adm); return this.inflight ||= this._admit().finally(() => { this.inflight = null; }); }
  async _admit() {
    if (this.now() < this.blockedUntil) throw new GateError(this.last || 'backoff', { retryAt: this.blockedUntil });
    const { code, pub } = this.identity || {}; if (!code || !pub) throw new GateError('identity');
    const s = await this.session(), uid = s.user.id;
    if (this.client.realtime?.setAuth) await this.client.realtime.setAuth(s.access_token);
    const gi = await this.client.rpc('mesh_gate_info'); if (gi.error) throw new GateError('server', { detail: gi.error.message });
    const info = gi.data || {};
    if (info.suspended_until) return this._refuse('suspended', Date.parse(info.suspended_until));
    if (info.age_checked === false) return this._refuse('age-check-required', this.now() + 60e3);
    if (info.admitted && info.expires_at && Date.parse(info.expires_at) - this.now() > RENEW_BEFORE_MS) return this.adm = { uid, expiresAt: Date.parse(info.expires_at), att: false, reused: true };
    const w = Number.isFinite(info.w) ? info.w : admitWindow(this.now()), pow = info.pow || DEFAULT_POW;
    const { args, hashes } = await solveAdmission({ uid, code, pub, w, pow, ...this.solveOpts });
    const r = await this.client.rpc('mesh_admit', args); if (r.error) throw new GateError('server', { detail: r.error.message });
    const d = r.data || {};
    if (!d.ok) { const ms = d.error === 'rate' ? (d.retry_after_secs || 3600) * 1000 : d.error === 'suspended' ? Math.max(60e3, Date.parse(d.until) - this.now() || 0) : 30e3; return this._refuse(d.error || 'refused', this.now() + ms, d); }
    this.last = null; this.blockedUntil = 0;
    return this.adm = { uid, expiresAt: Date.parse(d.expires_at), att: !!d.att, hashes, leftHour: d.left_hour, leftDay: d.left_day };
  }
  _refuse(reason, until, extra = {}) { this.last = reason; this.blockedUntil = Number.isFinite(until) ? until : this.now() + 30e3; this.adm = null; throw new GateError(reason, { retryAt: this.blockedUntil, ...extra }); }
  forget() { this.adm = null; }
}
