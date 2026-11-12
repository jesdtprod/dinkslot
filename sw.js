const CACHE = "dinkslot-shell-v283";
const RUNTIME = "dinkslot-cdn-v1";

const SHELL = ["./", "index.html", "css/app.css", "js/app.js", "js/landing.js", "js/config.js", "js/ui.js", "js/notify.js", "js/admin.js", "js/booking.js", "js/vendor/qrcode.js", "js/player.js", "js/ph-address.js", "manifest.webmanifest", "favicon.ico", "assets/dinkslot-logo.png", "assets/landing-court.jpg", "assets/pickleball-courts-hd.jpg", "assets/icons/qr-logo.png", "assets/icons/icon-192.png", "assets/icons/icon-512.png"];

// Third-party static files the app needs to boot (libraries, CSS, fonts). Cached after first
// load so the shell opens offline. API calls (supabase.co) and the human check are never cached.
const CDN_HOSTS = ["cdn.jsdelivr.net", "cdn.tailwindcss.com", "fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com"];

self.addEventListener("install", (e) => {
  // Tolerant: one missing file must not break the whole install.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(SHELL.map((u) => c.add(u)))));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);

  // Third-party static assets: cache first, refresh in the background.
  if (u.origin !== location.origin) {
    if (!CDN_HOSTS.includes(u.hostname)) return; // Supabase, Turnstile, etc.: always live
    e.respondWith(
      caches.open(RUNTIME).then((cache) =>
        cache.match(req).then((hit) => {
          const net = fetch(req).then((r) => { if (r && (r.ok || r.type === "opaque")) cache.put(req, r.clone()); return r; }).catch(() => hit);
          return hit || net;
        })
      )
    );
    return;
  }

  // Our own files: network first (so deploys show up), cached copy when offline.
  e.respondWith(
    fetch(req)
      .then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(req, c)); } return r; })
      .catch(() => caches.match(req).then((m) => m || (req.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
