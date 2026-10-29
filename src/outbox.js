// Store-and-forward queue on the SENDING phone only (relays never hold anything). A chat message or connection request to a
// recently-online person that can't be delivered now is held locally in the encrypted vault in a 'pending' state (no ✓),
// retried when the recipient's ID shows up in presence again, and dropped silently after the 7-day retention window.
// A boost on an item that expires undelivered is refunded automatically (same server-verified refund path as delivery failure).
// Acceptance is still required (the receiver enforces it, too).
export const PENDING_TTL_MS = 7 * 864e5, MAX_PENDING = 200, MAX_PER_PEER = 20;
export class Outbox {
  // persist(items) -> Promise (vault-backed, encrypted at rest); items = [{id, to, type, body, boost, at, tries}]
  constructor({ items = [], persist = async () => {}, now = () => Date.now() } = {}) { Object.assign(this, { persist, now }); this.items = items.filter(i => now() - i.at < PENDING_TTL_MS); }
  add(it) { if (this.items.length >= MAX_PENDING || this.items.filter(i => i.to === it.to).length >= MAX_PER_PEER) return false; this.items.push({ tries: 0, at: this.now(), ...it }); this.persist(this.items).catch?.(() => {}); return true; }
  for(to) { return this.items.filter(i => i.to === to); }
  has(id) { return this.items.some(i => i.id === id); }
  done(id) { const n = this.items.length; this.items = this.items.filter(i => i.id !== id); if (n !== this.items.length) this.persist(this.items).catch?.(() => {}); return n !== this.items.length; }
  expire() { const t = this.now(), gone = this.items.filter(i => t - i.at >= PENDING_TTL_MS); if (gone.length) { this.items = this.items.filter(i => t - i.at < PENDING_TTL_MS); this.persist(this.items).catch?.(() => {}); } return gone; }
}
