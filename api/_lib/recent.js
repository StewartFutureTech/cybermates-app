// "Recently online" list: rolling, bounded (last 500 profiles that were online), each with lastSeen. PUBLIC display-card
// fields only (name, thumb, interests, modes, adult flag) — no IDs beyond the network ID key, no IPs, no answers.
// Display-only: connecting still goes through the join-scan/matching flow and accept-before-message.
// In memory (mock) or the server's existing store. Filtered by mode and age (minors never see Dating; adults and minors
// are separated); banned profiles removed; deleting the account removes the entry. Blocks are local-only (client filters).
export const RECENT_MAX = 500, RECENT_PAGE = 100;
const clean = (c = {}) => ({ name: String(c.name || '').slice(0, 40), thumb: /^data:image\/jpeg;base64,[A-Za-z0-9+/=]{0,2400}$/.test(c.thumb || '') ? c.thumb : '', interests: (Array.isArray(c.interests) ? c.interests : []).slice(0, 6).map(x => String(x).slice(0, 24)) });
export class RecentList {
  constructor({ max = RECENT_MAX, now = () => Date.now() } = {}) { Object.assign(this, { max, now }); this.m = new Map(); }
  seen(code, { card, modes = [], adult = false } = {}) { this.m.delete(code); this.m.set(code, { code, ...clean(card), modes: modes.filter(x => ['friends', 'gaming', 'dating'].includes(x)), adult: !!adult, lastSeen: this.now() }); while (this.m.size > this.max) this.m.delete(this.m.keys().next().value); }
  remove(code) { return this.m.delete(code); }
  async list({ mode = null, adult = false, exclude = null, isBanned = async () => false, limit = RECENT_PAGE } = {}) {
    if (!adult && mode === 'dating') return [];
    const out = []; for (const e of [...this.m.values()].reverse()) { if (e.code === exclude || e.adult !== !!adult) continue; if (mode && !e.modes.includes(mode)) continue; if (!e.adult && e.modes.includes('dating') && mode === 'dating') continue;
      if (await isBanned(e.code)) { this.m.delete(e.code); continue; } out.push({ ...e, modes: adult ? e.modes : e.modes.filter(m => m !== 'dating') }); if (out.length >= limit) break; }
    return out;
  }
}
