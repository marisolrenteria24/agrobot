// Service worker minimo: cachea el "cascaron" de la app para que abra rapido
// y muestre algo aunque no haya internet. El control BLE en si siempre
// necesita que el celular este cerca del ESP32, eso no cambia.

// Al subir una versión nueva hay que cambiar este número: es lo que le dice al
// navegador que descarte la caché vieja y baje los archivos actualizados.
const CACHE_NAME = 'agrobot-cache-v2';
const ARCHIVOS_CASCARON = [
  './agrobot_control.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  // Inteligencia agronómica local (funciona offline, sin API)
  './inteligencia_agronomica.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_CASCARON))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(
        nombres
          .filter((n) => n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Cache-first para los archivos del cascaron; todo lo demas va directo a la red
  event.respondWith(
    caches.match(event.request).then((respuestaCache) => {
      return respuestaCache || fetch(event.request);
    })
  );
});
