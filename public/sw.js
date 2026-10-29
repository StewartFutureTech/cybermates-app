const C='cm-v54-2026-10-29';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(['/','/manifest.webmanifest','/icon.svg','/icon-192.png','/logo-mark.svg','/city-bg.jpg'])))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
// Network first. Only successful same-origin responses are cached. The cached index is only ever a fallback for a
// page navigation; a script/style request never gets HTML back (that broke module loading = blank screen).
self.addEventListener('fetch',e=>{const q=e.request;if(q.method!=='GET'||new URL(q.url).origin!==location.origin)return;const nav=q.mode==='navigate';
  e.respondWith(fetch(q,nav?{cache:'no-store'}:undefined).then(r=>{if(r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(nav?'/':q,cp))}return r}).catch(()=>caches.match(nav?'/':q).then(r=>r||Response.error())))});
