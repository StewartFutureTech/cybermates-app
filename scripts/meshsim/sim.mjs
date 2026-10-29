const R='/workspace/cybermates-git/';
import { createRequire } from 'node:module'; const rq=createRequire(R+'package.json'); const { createClient } = await import(rq.resolve('@supabase/supabase-js'));
const nacl=(await import(rq.resolve('tweetnacl'))).default;
const { Member } = await import(R+'src/membership.js');
const { makeClaim } = await import(R+'src/idbind.js');
const { MeshGate } = await import(R+'src/mesh-admit.js');
const { b64 } = await import(R+'src/vault.js');
const URL='https://sedbojspfkgwyowuupdl.supabase.co', ANON=process.env.ANON, SITE='https://cybermates-stewart-future-tech.vercel.app';
const res={}; const step=(k,ok,d='')=>{(res[k]??=[]).push(ok);console.log(ok?'PASS':'FAIL',k,d)};
const N=3, cl=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<N;i++){
  const c=createClient(URL,ANON,{auth:{persistSession:false,autoRefreshToken:false}});
  const s=await c.auth.signInAnonymously(); step('1 anon sign-in',!s.error,s.error?.message||s.data.user.id);
  const kp=nacl.sign.keyPair(), keys={pub:b64(kp.publicKey),sec:b64(kp.secretKey)};
  const code='SIM'+Math.random().toString(36).slice(2,9).toUpperCase();
  const m=new Member({code,keys:kp,now:()=>Date.now()});
  const ag=await c.rpc('submit_age_check',{p_birthdate:'1995-05-05'}); step('1b age check',!ag.error,ag.error?.message||ag.data);
  cl.push({c,uid:s.data.user.id,code,keys,m,tok:s.data.session.access_token,got:[]});
}
for(const x of cl){ const t0=Date.now(); const claim=await makeClaim({code:x.code,keys:x.keys});
  const r=await fetch(SITE+'/api/bootstrap',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+x.tok},body:JSON.stringify({op:'login',code:x.code,row:x.m.row('global'),modes:['friends'],bind:claim})});
  const j=await r.json().catch(()=>({})); step('2 bootstrap login (+ID bind PoW)',r.status===200&&j.ok,`HTTP ${r.status} ${JSON.stringify(j).slice(0,160)} pow ${Date.now()-t0}ms`); }
for(const x of cl){ const r=await fetch(SITE+'/api/bootstrap?code='+x.code+'&mode=friends'); const j=await r.json();
  const others=cl.filter(y=>y!==x).map(y=>y.code), seen=(j.list||[]).map(r=>r.code);
  step('3 presence super-list sees others',others.every(o=>seen.includes(o)),`HTTP ${r.status} signal=${j.signal} list=${seen.length} sees ${others.filter(o=>seen.includes(o)).length}/${others.length}`); }
// negative: unadmitted client joining private 'mesh'
{ const x=cl[0]; await x.c.realtime.setAuth(x.tok); const st=await new Promise(r=>{const ch=x.c.channel('mesh',{config:{private:true}});const t=setTimeout(()=>r('TIMEOUT'),10000);ch.subscribe(s=>{if(s!=='CLOSED'){clearTimeout(t);r(s)}});}); x.c.removeAllChannels();
  step('4a unadmitted join to private mesh refused',st!=='SUBSCRIBED',st); }
for(const x of cl){ try{ const g=new MeshGate({client:x.c,identity:{code:x.code,pub:x.keys.pub}}); const a=await g.ensure(); step('4 MeshGate admission (mesh_admit)',!!a.expiresAt,`expires ${new Date(a.expiresAt).toISOString()} left_hour=${a.leftHour}`);}catch(e){step('4 MeshGate admission (mesh_admit)',false,e.message+' '+(e.detail||''));} }
for(const x of cl){ const st=await new Promise(r=>{const t=setTimeout(()=>r('TIMEOUT'),15000); x.ch=x.c.channel('mesh',{config:{private:true,broadcast:{self:false,ack:false}}}); x.ch.on('broadcast',{event:'m'},({payload})=>x.got.push(payload)).subscribe(s=>{clearTimeout(t);r(s)});}); step('5 join private realtime mesh',st==='SUBSCRIBED',st); }
await wait(1500);
for(const x of cl) await x.ch.send({type:'broadcast',event:'m',payload:{from:x.code,t:'hello'}});
await wait(3000);
for(const x of cl){ const exp=cl.filter(y=>y!==x).map(y=>y.code), fr=x.got.map(p=>p.from); step('6 mesh broadcast messaging',exp.every(e=>fr.includes(e)),`got ${fr.length} from ${[...new Set(fr)].join(',')}`); }
// DB messaging rpc A->B
{ const [a,b]=cl; const r=await a.c.rpc('send_message',{to_user:b.uid,body:'sim hello',boost:false}); step('7 send_message rpc A->B',!r.error,r.error?.message||'ok');
  const ib=await b.c.rpc('inbox'); step('7b B inbox has msg',!ib.error&&JSON.stringify(ib.data||[]).includes('sim hello'),ib.error?.message||`${(ib.data||[]).length} rows`); }
for(const x of cl){ const r=await fetch(SITE+'/api/bootstrap',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op:'logoff',code:x.code,row:x.m.row('global')})}); step('8 bootstrap logoff',r.status===200,'HTTP '+r.status); }
{ const r=await fetch(SITE+'/api/bootstrap?code='+cl[0].code); const j=await r.json(); const left=(j.list||[]).filter(r=>cl.some(y=>y.code===r.code)).length; step('8b presence cleared after logoff',left===0,`remaining sim rows ${left}`); }
for(const x of cl) x.c.removeAllChannels();
console.log('SUMMARY',JSON.stringify(Object.fromEntries(Object.entries(res).map(([k,v])=>[k,v.every(Boolean)?'PASS':`FAIL ${v.filter(b=>!b).length}/${v.length}`]))));
process.exit(0);
