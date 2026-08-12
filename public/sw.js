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
  event.respondWith(fetch(event.request));
});
