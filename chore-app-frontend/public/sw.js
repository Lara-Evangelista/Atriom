// public/sw.js
//
// Minimal service worker: its only two jobs are (1) receive Web Push
// events even when no tab is open, and show a notification, and (2)
// focus/open the app when that notification is tapped. It also enables
// "Add to Home Screen" install on Android (a service worker + manifest
// are both required for Chrome to consider a site installable).
//
// This intentionally does NOT do offline caching / asset precaching —
// that's a separate concern (and easy to get wrong in a way that serves
// stale app code). Add a caching strategy here later if you want offline
// support.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = { title: "Chores", body: "" };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    if (event.data) payload.body = event.data.text();
  }

  const { title, body, data } = payload;

  event.waitUntil(
    self.registration.showNotification(title || "Chores", {
      body: body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: data || {},
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
