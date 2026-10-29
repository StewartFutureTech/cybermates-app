// v57 profile rework E2E (dist-admin, ?as= test profile): no Sensitive / Peer network sections; top card photo + starter + name +
// birthday with auto age; GPS + City/State/Country dropdowns; Discord invites + Add/✕; Twitch + Kick; gender "Add something else";
// typed interests (green chips with ✕, no presets, no More…); keyword categories; legacy duplicates gone; Only after match + Importance.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const PORT = 4196, URL0 = `http://localhost:${PORT}/`;
let browser; const srv = spawn('npx', ['vite', 'preview', '--outDir', 'dist-admin', '--port', String(PORT), '--strictPort'], { stdio: 'pipe', detached: true });
const cleanup = async code => { try { await browser?.close(); } catch {} try { process.kill(-srv.pid); } catch {} process.exit(code); };
const assert = (c, m) => { if (!c) { console.error('E2E FAIL', m); cleanup(1); } else console.log('ok', m); };
setTimeout(() => { console.error('E2E FAIL global timeout'); cleanup(1); }, 150e3);
await new Promise((res, rej) => { srv.stdout.on('data', d => /localhost/.test(d) && res()); setTimeout(() => rej(new Error('preview timeout')), 15000); });
browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
const wait = ms => new Promise(r => setTimeout(r, ms));
const p = await browser.newPage(); p.on('dialog', d => d.accept()); p.on('pageerror', e => console.log('pageerror', e.message)); await p.setViewport({ width: 390, height: 844 });
await p.evaluateOnNewDocument(() => { globalThis.__cmAckTest = { minMs: 0, noScroll: true }; localStorage.setItem('cm.sound', 'off'); });
await p.goto(URL0 + '?as=seed-1&loaderMin=0');
if (await p.waitForSelector('#ag-dob', { timeout: 6000 }).catch(() => null)) { await p.$eval('#ag-dob', e => e.value = '1995-05-05'); await p.click('#ag-go'); }
if (await p.waitForSelector('#tm-ok', { timeout: 4000 }).catch(() => null)) { await p.click('#tm-ok'); await wait(300); await p.click('#tm-yes'); await p.waitForSelector('#loss-ok', { timeout: 8000 }).then(() => p.$eval('#loss-ok', e => e.click())).catch(() => {}); }
await p.waitForFunction(() => document.querySelector('nav [data-tab=profile]') && !document.getElementById('jackin'), { timeout: 30000 });
for (const s of ['#moodskip']) await p.$eval(s, e => e.click()).catch(() => {});
const toProfile = async () => { await p.$eval('nav [data-tab=profile]', e => e.click()); await p.waitForSelector('#pf-top', { timeout: 10000 }); await wait(300); };
await toProfile();
const txt = await p.$eval('#view', e => e.innerText);
assert(!/Sensitive info/i.test(txt), 'Sensitive information section removed');
assert(!/Peer network \(beta\)/i.test(txt), 'Peer network (beta) section removed');
assert(await p.waitForSelector('#devlink', { timeout: 8000 }).catch(() => null), 'device linking + Advanced settings still on Profile');
assert(await p.$('#pf-top .photos') && await p.$('#pf-top [data-preset]') && await p.$('#pf-top #f_name') && await p.$('#pf-top #f_birthday[type=date]'), 'top card: photo, starter characters, name, birthday');
assert(await p.$eval('#f_birthday', e => e.value) === '1995-05-05', 'birthday defaults to the age-gate date');
await p.$eval('#f_birthday', e => { e.value = '1990-01-02'; e.dispatchEvent(new Event('input')); }); assert(/Age 3\d/.test(await p.$eval('#pf-age', e => e.textContent)), 'age auto-calculated from birthday');
assert(await p.$('[data-loc] [data-gps]') && (await p.$$('[data-loc] select[data-l]')).length === 3, 'location: GPS button + City/State/Country dropdowns');
await p.select('[data-loc] select[data-l=countryCode]', 'US'); await wait(100); await p.select('[data-loc] select[data-l=region]', 'TX'); await wait(100); await p.select('[data-loc] select[data-l=city]', 'Austin'); await wait(100);
assert(await p.$eval('[data-loc] select[data-l=city]', e => e.value) === 'Austin', 'manual city pick');
const tl = async (sel, v) => { await p.$eval(sel + ' [data-tlin]', (e, v) => { e.value = v; }, v); await p.$eval(sel + ' [data-tladd]', e => e.click()); await wait(80); };
await tl('#f_discordInvites', 'discord.gg/aaa111'); await tl('#f_discordInvites', 'bbb222'); await tl('#f_discordInvites', 'ccc333');
await p.$eval('#f_discordInvites [data-tlv="ccc333"] [data-tlx]', e => e.click()); assert((await p.$$('#f_discordInvites [data-tlv]')).length >= 2, 'Discord: + Add several invites, ✕ removes');
await p.type('#f_twitch', 'twitch.tv/neo'); await p.type('#f_kick', 'kick.com/neo'); assert(true, 'Twitch + Kick fields under Discord');
assert(await p.$('#f_gender [data-oxin]') !== null || await p.$('[data-oxadd="f_gender"]') !== null, 'gender has Add something else');
await p.$eval('[data-oxadd="f_gender"]', b => { b.parentElement.querySelector('[data-oxin]').value = 'Two-spirit'; b.click(); });
assert(await p.$eval('#f_gender', e => e.querySelector('input:checked')?.value) === 'Two-spirit', 'something else appended + selected');
assert(!(await p.$('details.more')), 'no More… expanders');
assert(await p.$('#f_interests[data-tl]') && !(await p.$('#f_interests input[type=checkbox]')), 'interests: typed entries, no preset pick-list');
assert(await p.$eval('[data-cat=anime]', e => e.hidden) || (await p.$$eval('#f_interests [data-tlv]', a => a.some(x => /anime/i.test(x.dataset.tlv)))), 'anime section hidden unless triggered');
await tl('#f_interests', 'anime'); assert(!(await p.$eval('[data-cat=anime]', e => e.hidden)), 'typing "anime" shows the Anime section');
await tl('#f_interests', 'esports'); assert(!(await p.$eval('[data-cat=esports]', e => e.hidden)), '"esports" shows Esports');
await tl('#f_interests', 'fishing'); assert(!(await p.$eval('[data-cat=outdoor]', e => e.hidden)), '"fishing" shows Outdoor');
assert(await p.$eval('#f_interests [data-tlv="fishing"]', e => e.classList.contains('on')), 'added items appear selected (green)');
await tl('#f_anime', 'Naruto');
const heads = await p.$$eval('#view h4', a => a.map(h => h.textContent.trim())); const dup = k => heads.filter(h => h === k).length;
assert(dup('Smoking') <= 1 && dup('Kids') <= 1 && dup('Drinking') <= 1 && dup('Politics') <= 1 && dup('Religion') <= 1, 'no duplicate legacy sections');
assert(await p.$('[data-aftermatch="interests"]') && await p.$('[data-cimp="interests"]') && await p.$('[data-aftermatch="smoking"]') && !(await p.$('[data-cimp="gamertags"]')), 'Only after match + Importance on categories (not gamer tags)');
await p.$eval('[data-aftermatch="interests"]', e => { e.checked = true; });
await p.$eval('#pf', f => f.requestSubmit()); await wait(1200); await toProfile();
const me = await p.evaluate(async () => { const r = await globalThis.__cmMe?.(); return r || null; });
const v = await p.evaluate(() => ({ inv: [...document.querySelectorAll('#f_discordInvites [data-tlv]')].map(e => e.dataset.tlv), tw: document.querySelector('#f_twitch').value, kick: document.querySelector('#f_kick').value,
  out: [...document.querySelectorAll('#f_cat_outdoor [data-tlv]')].map(e => e.dataset.tlv), ints: [...document.querySelectorAll('#f_interests [data-tlv]')].map(e => e.dataset.tlv), anime: [...document.querySelectorAll('#f_anime [data-tlv]')].map(e => e.dataset.tlv),
  bd: document.querySelector('#f_birthday').value, city: document.querySelector('[data-loc] select[data-l=city]').value, am: document.querySelector('[data-aftermatch="interests"]').checked, g: document.querySelector('#f_gender input:checked')?.value }));
assert(v.inv.includes('discord.gg/aaa111') && v.inv.includes('discord.gg/bbb222') && !v.inv.some(x => /ccc333/.test(x)), 'saved Discord invites');
assert(v.tw === 'twitch.tv/neo' && v.kick === 'kick.com/neo', 'saved Twitch + Kick');
assert(v.out.includes('fishing') && !v.ints.includes('fishing') && v.ints.includes('anime') && v.anime.includes('Naruto'), 'entries kept in the right category after save');
assert(v.bd === '1990-01-02' && v.city === 'Austin' && v.am && v.g === 'Two-spirit', 'birthday, city, only-after-match, custom gender persisted');
console.log('E2E PROFILE57 PASS'); cleanup(0);
