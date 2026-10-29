// Paid 'Grok voice setup' session (follow-up item 6). Hard-stops at the remaining cap (30 min per purchase).
// Usage is charged per started session against the encrypted wallet. Client timer is a UX guard only — the server
// must also cap the ephemeral token's lifetime (api/_fn/voice-session.js) because a modified client could ignore it.
export const pickReceipt = w => (w.voiceReceipts || []).find(r => r.usedMs < r.capMs);
export async function startVoiceSession({ wallet, uid, now = () => Date.now(), setT = setTimeout, clearT = clearTimeout, fetchToken = defaultToken, onStop = () => {} }) {
  if (!wallet) return { ok: false, reason: 'unavailable', message: 'Grok voice needs the local wallet.' };
  const w = await wallet.raw(uid), rc = pickReceipt(w); if (!rc) return { ok: false, reason: 'no-voice-credit', message: 'Buy “Grok voice setup” in the Shop first.' };
  const remaining = rc.capMs - rc.usedMs;
  const tok = await fetchToken(uid, remaining).catch(e => ({ error: e.message }));
  if (tok?.error) return { ok: false, reason: 'server', message: tok.error === 'not-configured' ? 'Grok voice is not configured on the server yet (no XAI_API_KEY). Using the free browser voice setup.' : tok.error };
  const started = now(); let stopped = false;
  const stop = async (why = 'user') => { if (stopped) return; stopped = true; clearT(t); const used = Math.min(remaining, now() - started);
    await wallet.credit(uid, x => { const r = x.voiceReceipts.find(y => y.id === rc.id); if (r) r.usedMs = Math.min(r.capMs, r.usedMs + used); }); onStop(why, used); };
  const t = setT(() => stop('cap'), remaining);
  return { ok: true, token: tok, remainingMs: remaining, stop };
}
async function defaultToken(uid, maxMs) { const r = await fetch('/api/voice-session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user_code: uid, max_ms: maxMs }) }); return r.json(); }
