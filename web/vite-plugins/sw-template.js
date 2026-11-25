/* Service worker do otp-out. Gerado no build (vite-plugins/service-worker.ts).
 * Guarda só os arquivos da própria página, para abrir sem rede depois da
 * primeira visita. Não busca nada de outro domínio e não guarda nada do usuário. */
const VERSION = __VERSION__;
const CACHE = "otp-out-" + VERSION;
const PRECACHE = __PRECACHE__;

const scope = self.registration.scope;
const indexUrl = new URL("./", scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((path) => new URL(path, scope).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("otp-out-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Fora da origem ou fora da pasta da página: o service worker não mexe.
  if (url.origin !== self.location.origin || !request.url.startsWith(scope)) return;

  if (request.mode === "navigate") {
    event.respondWith(
      caches.open(CACHE).then((cache) =>
        cache.match(url.pathname === new URL(indexUrl).pathname ? indexUrl : request, { ignoreSearch: true, ignoreVary: true }).then(
          (cached) => cached || fetch(request).catch(() => cache.match(indexUrl)),
        ),
      ),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(request, { ignoreSearch: true, ignoreVary: true }).then((cached) => cached || fetch(request)),
    ),
  );
});
