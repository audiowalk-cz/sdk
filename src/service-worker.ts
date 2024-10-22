declare var self: ServiceWorkerGlobalScope;

async function install() {
  const res = await fetch("audiowalk.json");

  const config = await res.json();

  const cache = await caches.open(`audiowalk-v${config.version}`);
}

async function clearCache() {
  const keys = await caches.keys();

  await Promise.all(keys.map((key) => caches.delete(key)));
}

async function updateCache() {
  const res = await fetch("audiowalk.json");

  const config = await res.json();

  const cache = await caches.open(`audiowalk-v${config.version}`);

  const keys = await cache.keys();
}

async function checkUpdate() {
  const res = await fetch("audiowalk.json");

  const config = await res.json();

  const cache = await caches.open(`audiowalk-v${config.version}`);
}

async function checkCache() {
  return false;
}

self.addEventListener("install", (event) => {});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  event.respondWith(
    caches.match(request).then((response) => {
      return response || fetch(request);
    })
  );
});

self.addEventListener("activate", (event) => {});

self.addEventListener("message", (event) => {
  // TODO: Implement message handler
});
