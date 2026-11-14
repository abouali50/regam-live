// REGAM Live - service worker: shows "the live has started" when the site says so.
// The message from the site carries no content: the rooms on air are asked for here.
'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let room = null, site = 'REGAM Live';
    try {
      const d = await (await fetch('/api/rooms')).json();
      site = d.site || site;
      room = (d.rooms || []).filter((r) => r.live).sort((a, b) => (b.viewers || 0) - (a.viewers || 0))[0] || null;
    } catch { /* shown without the room's name */ }
    const fr = (self.navigator.language || 'fr').slice(0, 2) !== 'en';
    await self.registration.showNotification(room ? room.title || site : site, {
      body: (fr ? 'Le live a commencé' : 'The live has started') + (room && room.liveTitle ? ' : ' + room.liveTitle : ''),
      icon: '/icon-192.png', badge: '/icon-192.png', tag: 'live', renotify: true, data: { url: room ? '/r/' + room.slug : '/' },
    });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    for (const c of await self.clients.matchAll({ type: 'window' })) if (new URL(c.url).pathname === url) return c.focus();
    return self.clients.openWindow(url);
  })());
});
