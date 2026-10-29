// Help desk KB + redaction (no browser). Loads docs/help-kb.md the way Vite's ?raw would.
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
register('data:text/javascript,' + encodeURIComponent(`export async function load(u, c, n) { if (u.endsWith('?raw')) { const f = new URL(u.replace('?raw', '')); return { format: 'module', shortCircuit: true, source: 'export default ' + JSON.stringify((await import('node:fs')).readFileSync(f, 'utf8')) }; } return n(u, c); }`));
const H = await import('../src/help.js');
assert(H.KB.length >= 15, 'help KB has ' + H.KB.length + ' entries');
for (const [q, t] of [['how do I cancel my subscription', 'cancel'], ['someone is harassing me, how to report', 'report'], ['do boosts move to my new phone', 'new phone'], ['talk to a human', 'human']]) { const a = H.kbAnswer(q); assert(a && a.title.toLowerCase().includes(t), `KB: "${q}" -> ${a?.title}`); }
assert(H.kbAnswer('zzqx blorp') === null, 'KB: nonsense -> no answer (fallback text)');
assert(H.redact('mail me a@b.co or +1 312 555 0199, I am @neo') === 'mail me [email] or [number], I am [handle]', 'redaction of email/phone/handle');
assert(readFileSync(new URL('../api/_fn/help.js', import.meta.url), 'utf8').includes('XAI_API_KEY'), 'api/_fn/help.js reads key server-side');
