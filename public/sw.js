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

// Notifiche push (sezione "Domande dei collaboratori"): il payload arriva
// come JSON da src/lib/push.ts. Se il parsing fallisce (payload assente o
// malformato) mostra comunque un avviso generico invece di non mostrare
// nulla — un push arrivato senza notifica visibile sembra un bug silenzioso.
self.addEventListener("push", (event) => {
  let dati = {};
  try {
    dati = event.data ? event.data.json() : {};
  } catch {
    // payload non JSON: procede con i valori di default sotto
  }
  const { title, body, url } = dati;
  event.waitUntil(
    self.registration.showNotification(title || "ToothTalk", {
      body: body || "Hai una nuova notifica.",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: url || "/admin" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/admin";
  event.waitUntil(self.clients.openWindow(url));
});
