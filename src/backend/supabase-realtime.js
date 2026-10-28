// Realtime: new messages + delivery-status updates via postgres_changes (RLS-filtered server-side, so a user only ever
// receives rows they may read), presence on private band-scoped channels ('presence:<band>'), and per-conversation
// broadcast channels ('conv:<id>') for typing + voice/WebRTC signaling. Channel authorization: realtime.messages RLS.
export class SupabaseRealtime {
  constructor(client) { this.c = client; this.chans = new Set(); }
  async _auth() { const { data } = await this.c.auth.getSession(); if (data?.session) await this.c.realtime.setAuth(data.session.access_token); return data?.session?.user?.id; }
  _track(ch) { this.chans.add(ch); return () => { this.chans.delete(ch); this.c.removeChannel(ch); }; }
  // ownSent (v48 multi-device): also deliver rows I sent (from my other devices) so every device of mine shows the thread.
  async subscribeMessages(onMessage, onStatus = () => {}, { ownSent = false } = {}) {
    const me = await this._auth();
    let ch = this.c.channel(`msgs:${me}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_id=eq.${me}` }, p => onMessage(p.new))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `sender_id=eq.${me}` }, p => onStatus(p.new));
    if (ownSent) ch = ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `sender_id=eq.${me}` }, p => onMessage(p.new));
    ch.subscribe();
    return this._track(ch);
  }
  // band = caller's own age_band; the server rejects joining the other band's channel.
  async presence(band, meta, onSync) {
    const me = await this._auth();
    const ch = this.c.channel(`presence:${band}`, { config: { private: true, presence: { key: me } } });
    ch.on('presence', { event: 'sync' }, () => onSync(ch.presenceState()))
      .subscribe(async s => { if (s === 'SUBSCRIBED') await ch.track({ ...meta, at: Date.now() }); });
    return this._track(ch);
  }
  // conversation channel: typing + voice signaling (offer/answer/ice). Members only; same band by construction.
  async conversation(conversationId, onEvent) {
    await this._auth();
    const ch = this.c.channel(`conv:${conversationId}`, { config: { private: true, broadcast: { self: false } } });
    ch.on('broadcast', { event: '*' }, ({ event, payload }) => onEvent(event, payload)).subscribe();
    const off = this._track(ch);
    return { send: (event, payload) => ch.send({ type: 'broadcast', event, payload }), close: off, channel: ch };
  }
  closeAll() { for (const ch of this.chans) this.c.removeChannel(ch); this.chans.clear(); }
}
