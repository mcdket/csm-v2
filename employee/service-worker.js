// Minimal service worker — enables "Add to Home Screen" for the
// employee portal (both the punch tablet and personal phones).

self.addEventListener('install', function(){
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event){
  // Pass-through. Add offline caching later if needed.
});
