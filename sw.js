const CACHE="journal-machiniste-pro-v5-0-0";
const ASSETS=["./","./index.html","./styles.css","./manifest.json","./icon-192.png","./icon-512.png","./vendor/jszip.min.js","./seed-data.js","./db.js","./xlsx-lite.js","./pdf-lite.js","./app.js"];
self.addEventListener("install",event=>{self.skipWaiting();event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));});
self.addEventListener("activate",event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response&&response.ok&&new URL(event.request.url).origin===location.origin){const clone=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,clone));}return response;}).catch(()=>caches.match("./index.html"))));
});
