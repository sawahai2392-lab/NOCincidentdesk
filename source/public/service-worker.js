self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "NOC Incident Desk";
  const options = {
    body: payload.body || "Ada pembaruan pada workspace NOC.",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-72.png",
    tag: payload.data?.incidentId || "noc-update",
    renotify: false,
    data: {
      url: payload.data?.url || "/",
      incidentId: payload.data?.incidentId || null
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url.startsWith(self.location.origin));
      if (existing) {
        return existing.navigate(target).then(() => existing.focus());
      }
      return clients.openWindow(target);
    })
  );
});
