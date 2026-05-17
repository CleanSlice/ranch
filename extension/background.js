// Minimal MV3 service worker. The popup does the actual fetch+cookie work;
// the worker only exists so the extension survives across Chrome restarts
// and so future versions can hook into chrome.alarms / context menus
// without rewiring the manifest.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
