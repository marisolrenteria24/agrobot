// Service worker minimo: cachea el "cascaron" de la app para que abra rapido
// y muestre algo aunque no haya internet. El control BLE en si siempre
// necesita que el celular este cerca del ESP32, eso no cambia.

const CACHE_NAME = 'agrobot-cache-v1';
const ARCHIVOS_CASCARON = [
  './agrobot_control.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  // Análisis de plantas (rama feature/kindwise-api-integration): el módulo y la
  // base de datos local se precachean para que el análisis funcione también offline.
  './analisis_plantas.js',
  './plantas_local.json'
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
