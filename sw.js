self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil((async () => {
    try { if (d.badge && self.navigator && self.navigator.setAppBadge) await self.navigator.setAppBadge(d.badge); } catch (_) {}
    await self.registration.showNotification(d.title || "Myrtle Beach Championship", {
      body: d.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: d.tag || undefined,
      renotify: !!d.tag,
      silent: false,
      vibrate: [120, 60, 120, 60, 240],
      data: { url: d.url || "/?go=feed" }
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/?go=feed";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) { if ("focus" in w) { w.postMessage({ go: "feed" }); return w.focus(); } }
    return self.clients.openWindow(url);
  })());
});
