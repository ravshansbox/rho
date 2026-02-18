// Rho PWA Service Worker — network-first with offline shell fallback
const CACHE_NAME = "rho-v1";
const SHELL_ASSETS = [
	"/",
	"/css/style.css",
	"/js/app.js",
	"/js/chat.js",
	"/js/config.js",
	"/js/memory.js",
	"/js/slash-contract.js",
	"/favicon.svg",
	"/manifest.json",
];

// Pre-cache the app shell on install
self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)),
	);
	self.skipWaiting();
});

// Clean up old caches on activate
self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
				),
			),
	);
	self.clients.claim();
});

// Network-first for API/dynamic, cache-first for static assets
self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);

	// Skip non-GET and API requests
	if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) {
		return;
	}

	// Static assets: cache-first
	if (
		url.pathname.startsWith("/css/") ||
		url.pathname.startsWith("/js/") ||
		url.pathname.startsWith("/assets/") ||
		url.pathname.endsWith(".svg") ||
		url.pathname.endsWith(".png")
	) {
		event.respondWith(
			caches.match(event.request).then(
				(cached) =>
					cached ||
					fetch(event.request).then((response) => {
						const clone = response.clone();
						caches
							.open(CACHE_NAME)
							.then((cache) => cache.put(event.request, clone));
						return response;
					}),
			),
		);
		return;
	}

	// Navigation/HTML: network-first, fall back to cache
	event.respondWith(
		fetch(event.request)
			.then((response) => {
				const clone = response.clone();
				caches
					.open(CACHE_NAME)
					.then((cache) => cache.put(event.request, clone));
				return response;
			})
			.catch(() => caches.match(event.request)),
	);
});
