/* OI 雷达 SW：哈希资产永久缓存 + 快照 JSON 网络优先 + HTML 后台更新 */
const V='oir-20261126-5tabs2';
const ASSETS=['./','./index.html','assets/app.0457d4bb73.js','manifest.webmanifest','icon-180.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==location.origin)return;
  if(/\/assets\/[^/]+\.[0-9a-f]{10}\.(js|css)$/.test(url.pathname)){
    e.respondWith(caches.match(req).then(hit=>hit||fetch(req).then(r=>{const c=r.clone();caches.open(V).then(x=>x.put(req,c));return r})));
    return;
  }
  if(/\.json$/.test(url.pathname)){
    e.respondWith(fetch(req).then(r=>{const c=r.clone();caches.open(V).then(x=>x.put(req,c));return r}).catch(()=>caches.match(req)));
    return;
  }
  e.respondWith(fetch(req).then(r=>{const c=r.clone();caches.open(V).then(x=>x.put(req,c));return r}).catch(()=>caches.match(req).then(hit=>hit||caches.match('./index.html'))));
});
