// v58 smoke (pure node + source checks): Nov 10 live UX review fixes. node scripts/smoke-v58.mjs
import { readFileSync } from 'node:fs';
const src = f => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const store = new Map(); globalThis.localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
const C = await import('../src/compliance.js');
for (const [st, t] of Object.entries(C.DATING_SAFETY)) ok(!/PLACEHOLDER|\[|ILCS|56:8|394-cc|ch\. 106/.test(t) && /does NOT conduct criminal background checks/.test(t) && /Report/.test(t), `dating safety notice ${st}: final user-facing wording, disclosure kept`);
ok(C.safetyNoticeFor({ countryCode: 'US', region: 'IL' }) === C.DATING_SAFETY.IL && C.safetyNoticeFor({ countryCode: 'GB', region: 'IL' }) === null, 'Illinois notice still shown to US/IL dating profiles');
ok(!/PLACEHOLDER/.test(JSON.stringify(C.ukAgeAssurance('GB'))) && C.ukAgeAssurance('GB').required === true, 'UK age-assurance flag kept, no placeholder text');
ok(!/\(placeholder\)/.test(src('compliance.js')), 'birthday gate: no "(placeholder)" line');
ok(!/TEST STORE|pricing notes/.test(src('shop-ui.js')) && /STORE_LIVE/.test(src('shop-ui.js')), 'shop: no TEST STORE banner / internal pricing notes; honest "payments aren\'t live yet" line until checkout is live');
const S = await import('../src/shop.js'); const p5 = S.bySku('pack5'), b15 = S.bySku('boost15');
ok(/about \$0\.40 each/.test(p5.desc) && Math.abs(p5.cents / p5.boosts - 40) < 1 && /About \$0\.33 each/.test(b15.desc) && Math.abs(b15.cents / b15.boosts - 33.3) < 1, 'per-item price copy matches the pack price');
ok(!/— Settings'/.test(src('shop-ui.js')), 'ad bar tip no longer points to a Settings page that does not exist');
ok(/Nobody else is online near you right now/.test(src('mesh-ui.js')) && /DEV_UI \?/.test(src('mesh-ui.js')), 'Discover empty state: no ?as=seed-3 developer text (dev panel only in admin/dev builds)');
ok(!/'MESH GATE · '/.test(src('app-mesh.js')), 'JACK IN status: no raw MESH GATE · <reason> code');
ok(/currentUser: globalThis\.__cmDemoUser \?\? DEMO_USER/.test(src('store.js')) && /VITE_ADMIN === '1' \? 'seed-26' : null/.test(src('store.js')), 'fresh public device: no current user (blank onboarding); admin/dev + node harness keep seed-26');
{ const { db } = await import('../src/store.js'); ok(await db.getCurrentUserId() === 'seed-26', 'node harness (no import.meta.env) still boots the legacy demo user'); }
ok(/anPad = !!M\.state\.game\?\.analog \|\| g\.id === 'tronduel' \|\| g\.id === 'snakebattle'/.test(src('match-ui.js')), 'match screen: no ◀▲▼▶ pad for Tron Duel / Snake Battle');
ok(/header \.who \.av/.test(src('main.js')) && /hdrAv/.test(src('main.js')), 'header avatar opens Profile');
ok(/oldNav\.dataset\.sig === sig\) nn\.replaceWith\(oldNav\)/.test(src('main.js')), 'nav node kept across identical re-renders (no lost clicks)');
ok(/function syncChrome/.test(src('main.js')) && /body\.cm-padb main\{padding-bottom:calc\(var\(--chrome-b/.test(src('neon.css')), 'bottom padding follows measured nav + ad bar');
ok(/R\.follow = \(\) =>/.test(src('megafleet-ui.js')) && /stageEl\.addEventListener\('pointermove'/.test(src('megafleet-ui.js')), 'Mega Fleet: mouse movement steers (no drag needed); touch keeps drag');
ok(/outCard\(myLast\)/.test(src('arcade-ui.js')) && /Crashed!/.test(src('arcade-ui.js')), 'Light cycles / Snake: round-over card with score + best on crash (respawn stays instant)');
ok(/age > 120/.test(src('main.js')) && /\(a < 18\) !== DISC\.isMinor\(st\.me\)/.test(src('main.js')), 'age: adult account cannot set an under-18 birthday; onboarding age 18-120');
ok(/cm-v58-2026-11-19/.test(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')), 'SW stamp cm-v58-2026-11-19');
console.log('SMOKE V58 PASS');
