// In-app Help desk: AI assistant (clearly not a human). Offline answers from docs/help-kb.md (bundled);
// optional online answers via /api/help (Grok, server-side key). Only the typed question is sent, after redacting
// emails / phone numbers / @handles / long digit runs; never profile data. Falls back to the KB on any failure.
import KB_MD from '../docs/help-kb.md?raw';
import { SAFETY_CONTACT, REPORT_REASONS, submitReport } from './compliance.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STOP = new Set('a an the i my me is are do does how what why can cant can\'t to of in on for and or it you your with be this that there when where who'.split(' '));
const words = s => String(s).toLowerCase().replace(/[^a-z0-9+ ]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w)).map(w => w.replace(/ing$/, '').replace(/(es|s)$/, ''));
export const KB = KB_MD.split(/^## /m).slice(1).map(sec => { const [title, ...rest] = sec.split('\n'); const kw = (rest.find(l => l.startsWith('keywords:')) || '').slice(9);
  return { title: title.trim(), answer: rest.filter(l => !l.startsWith('keywords:')).join('\n').trim(), t: words(title), k: words(kw), b: words(rest.join(' ')) }; });
export function kbAnswer(q) {
  const qw = words(q); if (!qw.length) return null;
  const sc = KB.map(e => ({ e, s: qw.reduce((a, w) => a + (e.k.includes(w) ? 3 : 0) + (e.t.includes(w) ? 2 : 0) + (e.b.includes(w) ? 0.5 : 0), 0) })).sort((a, b) => b.s - a.s);
  return sc[0].s >= 2 ? { ...sc[0].e, score: sc[0].s, also: sc.slice(1, 3).filter(x => x.s >= 2).map(x => x.e.title) } : null;
}
export const redact = s => String(s).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/@\w{2,}/g, '[handle]').replace(/\+?\d[\d\s().-]{6,}\d/g, '[number]').slice(0, 500);
const LS = globalThis.localStorage;
const online = () => LS?.getItem('cm.helpOnline') === 'on';
async function grok(q) {
  const r = await fetch('/api/help', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: redact(q) }) });
  if (!r.ok) throw new Error('help ' + r.status); const j = await r.json(); if (!j.answer) throw new Error('empty'); return j.answer;
}
const log = [{ me: false, html: 'Hi! I\'m the Cybermates <b>AI assistant</b> — not a human. Ask me about modes, matching, starters, privacy, safety or your account. For anything urgent or unsafe, use <b>Contact safety team</b> or <b>Report a user</b> below.' }];
export function helpView(v, me) {
  const mail = SAFETY_CONTACT.split(' ')[0];
  const draw = () => {
    v.innerHTML = `<div class="card" data-help><div class="row between"><h3>🤖 Help</h3><span class="tag hot" data-ai-label>AI assistant (not a human)</span></div>
      <div class="chat" id="hlog" aria-live="polite">${log.map(m => `<div class="bubble ${m.me ? 'mine' : ''}">${m.html}</div>`).join('')}</div>
      <form id="hf" class="send"><input id="hq" placeholder="Ask a question…" autocomplete="off" aria-label="Ask the AI assistant"><button class="primary">Ask</button></form>
      <label class="small"><input type="checkbox" id="hon" style="width:auto" ${online() ? 'checked' : ''}> Use online AI (Grok) for questions the offline guide can't answer — only your question text is sent, with emails/numbers removed.</label>
      <div class="row gap" style="margin-top:8px"><a class="tag" id="hsafety" href="mailto:${esc(mail)}?subject=${encodeURIComponent('Cybermates safety')}">🛡️ Contact safety team (human)</a><button type="button" id="hreport" class="danger">🚩 Report a user</button></div>
      <p class="muted small">Safety &amp; legal contact: ${esc(SAFETY_CONTACT)}. In immediate danger? Call your local emergency number.</p><div id="hrep"></div></div>`;
    const lg = v.querySelector('#hlog'); lg.scrollTop = lg.scrollHeight;
    v.querySelector('#hon').onchange = e => LS?.setItem('cm.helpOnline', e.target.checked ? 'on' : 'off');
    v.querySelector('#hf').onsubmit = async e => { e.preventDefault(); const q = v.querySelector('#hq').value.trim(); if (!q) return;
      log.push({ me: true, html: esc(q) }); const hit = kbAnswer(q);
      if (hit && hit.score >= 4 || !online()) log.push({ me: false, html: hit ? `<b>${esc(hit.title)}</b><br>${esc(hit.answer)}${hit.also.length ? `<br><span class="muted small">Related: ${hit.also.map(esc).join(' · ')}</span>` : ''}` : `I couldn't find that in the offline guide. Try different words, turn on online AI, or contact the safety team / report a user below.` });
      else { draw(); try { log.push({ me: false, html: esc(await grok(q)) + '<br><span class="muted small">— AI answer (Grok). May be imperfect; for safety issues contact the team.</span>' }); }
        catch { log.push({ me: false, html: hit ? `<b>${esc(hit.title)}</b><br>${esc(hit.answer)}` : 'Online AI is unavailable right now, and the offline guide has no match. Please contact the safety team or report a user below.' }); } }
      draw(); v.querySelector('#hq').focus(); };
    v.querySelector('#hreport').onclick = () => { const r = v.querySelector('#hrep');
      r.innerHTML = `<div class="card"><h4>Report a user</h4><input id="rp-who" placeholder="Their user code or name"><select id="rp-why">${REPORT_REASONS.map(x => `<option>${esc(x)}</option>`).join('')}</select><textarea id="rp-x" rows="3" maxlength="1000" placeholder="What happened? (optional, max 1000 chars)"></textarea><button id="rp-go" class="danger">Send report</button> <span id="rp-out" class="small"></span></div>`;
      r.querySelector('#rp-go').onclick = async () => { const who = r.querySelector('#rp-who').value.trim(); if (!who) return r.querySelector('#rp-out').textContent = 'Enter who you are reporting.';
        try { const res = await submitReport({ reporter: me?.id || 'anon', reported: who, reason: r.querySelector('#rp-why').value, excerpt: r.querySelector('#rp-x').value }); r.querySelector('#rp-out').textContent = res.ok ? (res.queued ? 'Saved — will be sent when the server is configured.' : '✓ Report sent. Thank you.') : 'Could not send — please email the safety team.'; }
        catch (e) { r.querySelector('#rp-out').textContent = e.message; } }; };
  };
  draw();
}
