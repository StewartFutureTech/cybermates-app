// v51: live-path wiring helpers for CookieGate + FloodReporter (keeps app-mesh thin).
import { CookieGate, cookiePkt, PROTO } from './rx-cookie.js';
import { FloodReporter } from './flood-report.js';

export { PROTO };

export function makeShield({ code, isKnown, changed, bus }) {
  const flood = new FloodReporter({ reporter: code });
  const pending = new Map();
  const gate = new CookieGate({
    isKnown,
    onStrike: s => { changed('shield: flood dropped from', s.code, '(' + s.count + ')'); flood.onStrike(s); },
    onChallenge: ({ to, ch }) => { try { bus.post(cookiePkt(to, ch, code)); changed('shield: challenge', to); } catch {} },
  });
  const beforeAdmit = (msg) => {
    if (msg?.k === 'ck' && msg.to === code && msg.ch) {
      pending.set(msg.from || 'peer', msg.ch);
      bus.post({ k: 'hello', code, ck: msg.ch, pv: PROTO, ack: true });
      return 'handled';
    }
    return null;
  };
  const onHello = (msg, rv) => {
    rv.seen(msg.code);
    if (msg.ck || msg.cookie) gate.acceptCookie?.(msg.code, msg.ck || msg.cookie);
    if (msg.code !== code && !msg.ack) {
      const ck = pending.get(msg.code);
      bus.post({ k: 'hello', code, ack: true, pv: PROTO, ...(ck ? { ck } : {}) });
    }
  };
  const helloOut = () => ({ k: 'hello', code, pv: PROTO });
  gate.wire = { beforeAdmit, onHello, helloOut, flood, PROTO };
  return { gate, flood, beforeAdmit, onHello, helloOut, PROTO };
}
