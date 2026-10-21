// iPhone WebKit start-flow test (needs playwright: /workspace/wk). node scripts/flow-webkit.mjs prod|new|upgrade. Shots: flow-<mode>-<step>.png; prints gate ids + sound-start count per step.
import { webkit, devices } from 'playwright';
import fs from 'fs'; import path from 'path';
const PROD='https://cybermates-stewart-future-tech.vercel.app/';
const mode=process.argv[2]; // prod | new | upgrade
const b=await webkit.launch(); const c=await b.newContext({...devices['iPhone 14']});
const DIST='/workspace/cybermates/dist';
const useLocal=async()=>c.route(PROD+'**',async r=>{let u=new URL(r.request().url()).pathname; if(u==='/'||!fs.existsSync(DIST+u))u='/index.html'; const ext=path.extname(u);
 const ct={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json','.webmanifest':'application/manifest+json'}[ext]||'application/octet-stream';
 r.fulfill({body:fs.readFileSync(DIST+u),contentType:ct});});
if(mode==='new')await useLocal();
await c.addInitScript(()=>{window.__snd=0;for(const K of ['OscillatorNode','AudioBufferSourceNode']){const o=window[K]?.prototype.start;if(o)window[K].prototype.start=function(...a){window.__snd++;return o.apply(this,a)}}});const p=await c.newPage(); const errs=[];
p.on('console',m=>{if(m.type()==='error')errs.push(m.text())}); p.on('pageerror',e=>errs.push('PAGEERR '+e.message));
const S='/workspace/cybermates-shots/';
const info=async()=>p.evaluate(()=>({gates:[...document.querySelectorAll('.cm-gate,#jackin,#jackbtn')].map(g=>g.id),rain:[...document.querySelectorAll('canvas')].map(c=>(c.id||c.className||c.parentElement?.id)+':'+getComputedStyle(c).opacity),snd:window.__snd,txt:document.body.innerText.trim().slice(0,140).replace(/\s+/g,' ')}));
const step=async n=>{await p.waitForTimeout(1200);await p.screenshot({path:`${S}flow-${mode}-${n}.png`});console.log(n,JSON.stringify(await info()));};
async function gates(){
 await p.goto(PROD,{waitUntil:'load'}); await step('1-age');
 await p.fill('#ag-dob','1990-05-05'); await p.click('#ag-go'); await step('2-terms');
 if(await p.$('#tm-ok')){await p.evaluate(()=>{const s=document.querySelector('#tm-ok').closest('.cm-gate')?.querySelector('[class*=scroll],div');});await p.check('#tm-ok');await p.click('#tm-yes');}
 await step('3-ack');
 for(let i=0;i<3 && !(await p.$('#jb-go'));i++){const g=await p.$$('.cm-gate:not(#jackbtn) input[type=checkbox]');for(const x of g)await x.check().catch(()=>{});const bt=await p.$('.cm-gate:not(#jackbtn) button.primary:not([disabled])');if(!bt)break;await bt.click();await p.waitForTimeout(800);}
 await step('4-jackin');
 if(await p.$('#jb-go'))await p.click('#jb-go'); await step('5-loading');
 await p.waitForTimeout(6000); await step('6-app');
}
await gates();
if(mode==='upgrade'){errs.push('--- now new build, same storage');await useLocal();await p.reload({waitUntil:'load'});await step('7-upgraded');await p.waitForTimeout(5000);await step('8-upgraded-later');}
console.log('ERRS',errs.join('\n'));await b.close();
