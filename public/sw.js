// Service worker minimo: nessuna cache. Serve solo a soddisfare il
// requisito di installabilità PWA di Chrome (icona "Installa" nella barra
// degli indirizzi). Ogni richiesta passa dritta alla rete: dati sempre
// freschi, nessun rischio di contenuti vecchi mostrati dalla cache.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Le richieste con corpo (POST delle Server Action, incluso "Invia link
  // per la liberatoria") vanno lasciate al browser: rifare qui il fetch di
  // una Request con body, senza { duplex: "half" }, fallisce con "Failed to
  // fetch" nei Chrome recenti. Non chiamando respondWith() per queste, il
  // browser le gestisce come se il service worker non ci fosse.
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request));
});
