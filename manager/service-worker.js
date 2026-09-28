// Minimal service worker — enables "Add to Home Screen" / install
// prompt for the manager portal. Network-first, no offline caching
// beyond what the browser does by default. This app needs a live
// connection to Firestore anyway.

self.addEventListener('install', function(){
  self.skipWaiting();
});

self.addEventListener('activate', function(event){
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event){
  // Default behavior: pass through to the network. No custom caching
  // yet — if you later want offline support, add a Cache API strategy here.
});
