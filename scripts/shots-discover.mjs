// cm-v35 UX §6 Discover: list/swipe modes. Pure deck checks (pass frees + refills slot with next best, like, no re-admit),
// match guards (minors only ever match minors, 0.75x hidden penalty, per-mode min %), then real Chrome at 320/390/430 px:
// drag left = pass + refill, drag right = like, tap = "Loading their profile...", no horizontal overflow, 3D glass card.
import puppeteer from 'puppeteer-core'; import fs from 'node:fs';
import { SwipeDeck } from '../src/discover-view.js'; import * as MV from '../src/match-v2.js';
let fail = 0, n = 0; const ok = (c, m) => { n++; console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fail++; };
const P = (id, pct) => ({ profile: { id, name: 'N' + id, code: 'c' + id }, pct });
{ const passed = [], liked = []; const d = new SwipeDeck([P(1, 90), P(2, 80)], { slots: 2, pool: [P(3, 50), P(4, 70)], onPass: x => passed.push(x.profile.id), onLike: x => liked.push(x.profile.id) });
  ok(d.items.length === 2 && d.reserve.length === 2, 'deck fills exactly the slot count');
  d.swipe('left'); ok(passed[0] === 1 && d.top.profile.id === 2 && d.items.some(x => x.profile.id === 4), 'pass disconnects + refills slot with next best (70 before 50)');
  d.swipe('right'); ok(liked[0] === 2, 'swipe right likes'); ok(d.top.profile.id === 4, 'next card is refill');
  d.refill([P(1, 99)]); ok(!d.reserve.some(x => x.profile.id === 1) && !d.items.slice(d.i).some(x => x.profile.id === 1), 'passed node never re-admitted'); }
{ const adult = { id: 'a', age: 30, lookingFor: ['friends'] }, kid = { id: 'k', age: 15, lookingFor: ['friends'] }, kid2 = { id: 'k2', age: 16, lookingFor: ['friends'] };
  ok(MV.score(adult, kid, 'friends') == null && MV.score(kid, adult, 'friends') == null, 'adult<->minor never scored');
  ok(MV.score(kid, kid2, 'friends') != null, 'minor<->minor can match'); ok(MV.score(kid, kid2, 'dating') == null, 'no dating for minors');
  ok(1 - MV.HIDDEN_PENALTY === 0.75, 'hidden-field penalty is 0.75x'); ok(MV.DEFAULT_MIN.dating === 50 && MV.DEFAULT_MIN.friends === 40, 'per-mode min %'); }
const src = fs.readFileSync(new URL('../src/discover-view.js', import.meta.url), 'utf8'), css = fs.readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
for (const w of [320, 390, 430]) { const p = await b.newPage(); await p.setViewport({ width: w, height: 760, deviceScaleFactor: 2 }); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.setContent(`<style>${css}</style><div id="r"></div>`);
  await p.addScriptTag({ type: 'module', content: src.replace(/export /g, '') + `
    const P=(id,pct)=>({profile:{id,name:'Node '+id},pct}); window.log=[];
    const d=new SwipeDeck([P(1,90),P(2,80)],{slots:2,pool:[P(3,50),P(4,70)],onPass:x=>log.push('pass'+x.profile.id),onLike:x=>log.push('like'+x.profile.id)});
    window.open1=()=>loadingProfile(document.getElementById('r'),()=>new Promise(r=>setTimeout(()=>r({online:true,profile:{name:'Full Node 4',age:22}}),1200)));
    swipeView(document.getElementById('r'),d,{cardHTML:x=>'<div style="padding:2rem">'+x.profile.name+' '+x.pct+'%</div>',onOpen:x=>{log.push('open'+x.profile.id);open1();}}); window.ready=1;` });
  await p.waitForFunction(() => window.ready); const drag = async dx => { const r = await p.$eval('.dv-card', e => { const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; }); await p.mouse.move(r[0], r[1]); await p.mouse.down(); await p.mouse.move(r[0] + dx / 2, r[1], { steps: 4 }); await p.mouse.move(r[0] + dx, r[1], { steps: 4 }); await p.mouse.up(); await new Promise(r => setTimeout(r, 400)); };
  ok(await p.$eval('.dv-stage', e => getComputedStyle(e).perspective !== 'none'), `${w}px swipe card is true 3D (perspective)`);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${w}px no horizontal overflow`);
  await drag(-140); ok(await p.evaluate(() => log.join() === 'pass1' && document.querySelector('.dv-card').textContent.includes('Node 2')), `${w}px drag left passes, next card shown`);
  await drag(140); ok(await p.evaluate(() => log.includes('like2') && document.querySelector('.dv-card').textContent.includes('Node 4')), `${w}px drag right likes, refilled next-best slot shown`);
  await drag(0); ok(await p.evaluate(() => log.includes('open4') && document.body.textContent.includes('Loading their profile')), `${w}px tap opens "Loading their profile"`);
  await new Promise(r => setTimeout(r, 1200)); ok(await p.evaluate(() => document.body.textContent.includes('Full Node 4') && !!document.querySelector('.dv-talk')), `${w}px full profile loads after tap`);
  await p.screenshot({ path: `${process.env.SHOTS || '/workspace/cybermates-shots'}/v35-discover-${w}.png` }).catch(() => {}); ok(!errs.length, `${w}px no page errors ${errs.join('|')}`); await p.close(); }
await b.close(); console.log(`${n - fail}/${n} passed`); process.exit(fail ? 1 : 0);
