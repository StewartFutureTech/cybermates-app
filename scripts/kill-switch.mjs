#!/usr/bin/env node
// DEPRECATED: use scripts/mod.mjs (keyfile outside the repo, HALT confirmation, server-first ordering, resume-newer check).
//   kill-switch.mjs keygen  -> mod.mjs keygen   |  trigger --reason "…" -> mod.mjs halt --reason "…"  |  clear -> mod.mjs resume
// Per-user/session kills: use mod.mjs ban/strike. No env-var or throwaway keys anymore.
const [cmd, ...rest] = process.argv.slice(2), map = { keygen: 'keygen', trigger: 'halt', clear: 'resume' };
if (!map[cmd]) { console.error('usage: kill-switch.mjs keygen | trigger --reason "…" | clear   (forwards to scripts/mod.mjs)'); process.exit(1); }
if (cmd === 'trigger' && rest.includes('--scope') && rest[rest.indexOf('--scope') + 1] !== 'all') { console.error('scoped kills: use node scripts/mod.mjs ban|strike <id>'); process.exit(1); }
process.argv = [process.argv[0], new URL('./mod.mjs', import.meta.url).pathname, map[cmd], ...rest.filter((x, i, a) => x !== '--scope' && a[i - 1] !== '--scope' && x !== '--ttl-hours' && a[i - 1] !== '--ttl-hours')];
await import('./mod.mjs');
