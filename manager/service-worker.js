// Minimal service worker — enables "Add to Home Screen" / install
// prompt for the manager portal. Pass-through only, no caching.
// The manager portal needs live Firestore anyway, so offline caching
// would be misleading.

self.addEventListener('install', function(){
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event){
  // Default behavior: pass through to the network.
});
