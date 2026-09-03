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

// Nessun respondWith: rifare qui il fetch() dell'oggetto Request originale
// è fragile (fallisce con "Failed to read"/"Failed to fetch" in vari casi,
// non solo per le POST — visto succedere anche su richieste GET di
// refresh). Il listener resta registrato solo per soddisfare il requisito
// di installabilità PWA di Chrome: senza respondWith, ogni richiesta va
// dritta alla rete esattamente come se questo service worker non ci fosse.
self.addEventListener("fetch", () => {});
