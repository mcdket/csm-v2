/**
 * shared/firebase.js
 * ------------------
 * Single Firebase initialisation, imported by every page in the app.
 *
 * Using the compat SDK (firebase-app-compat) so the rest of the code can
 * stay in vanilla JS with no build step — same approach as the old version,
 * just centralised in one file so we don't repeat the config in every page.
 *
 * Exposes on window:
 *   CSM.db             Firestore instance
 *   CSM.auth           Auth instance
 *   CSM.restaurantId   resolved restaurant id (or null if not yet known)
 *   CSM.restaurantName human-readable restaurant name
 *   CSM.ready          Promise that resolves once the restaurant is known
 */
(function(){
  'use strict';

  const firebaseConfig = {
    apiKey: "AIzaSyB72spQb0rqq82uK23LmhDDkNG2Y_-tHJI",
    authDomain: "contractsocialmanager-v2.firebaseapp.com",
    projectId: "contractsocialmanager-v2",
    storageBucket: "contractsocialmanager-v2.firebasestorage.app",
    messagingSenderId: "288053912651",
    appId: "1:288053912651:web:6a38597328529d81ff59ce"
    // measurementId intentionally omitted — we don't use Analytics.
  };

  firebase.initializeApp(firebaseConfig);

  const db = firebase.firestore();

  // Enable offline persistence so the app keeps working (read-only) on flaky
  // restaurant Wi-Fi. Errors are non-fatal — some browsers block it in private
  // mode, or when two tabs are open.
  db.enablePersistence({ synchronizeTabs: true }).catch(function(err){
    if(err && err.code === 'failed-precondition'){
      console.warn('Firestore persistence disabled: multiple tabs open.');
    } else if(err && err.code === 'unimplemented'){
      console.warn('Firestore persistence not supported in this browser.');
    }
  });

  const auth = firebase.auth();
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function(){});

  /* ------------------------------------------------------------------
     Restaurant resolution
     ------------------------------------------------------------------
     Priority order:
       1. ?r=xxx in the URL   (used by personal phone links)
       2. csm_restaurant in localStorage  (remembered from a previous visit)
       3. First restaurant returned by the `restaurants` collection  (fallback)
     The resolved id is also cached to localStorage so subsequent loads are
     instant and don't require a network round-trip.
  ------------------------------------------------------------------ */
  const STORAGE_KEY = 'csm_restaurant';

  function readFromUrl(){
    try{
      return new URLSearchParams(window.location.search).get('r') || null;
    }catch(e){ return null; }
  }
  function readFromStorage(){
    try{ return localStorage.getItem(STORAGE_KEY); }catch(e){ return null; }
  }
  function writeToStorage(id){
    try{ if(id) localStorage.setItem(STORAGE_KEY, id); }catch(e){}
  }

  const CSM = {
    db: db,
    auth: auth,
    restaurantId: null,
    restaurantName: '',
    ready: null,
  };

  CSM.ready = (function resolveRestaurant(){
    const fromUrl = readFromUrl();
    if(fromUrl){
      writeToStorage(fromUrl);
      return hydrate(fromUrl);
    }
    const stored = readFromStorage();
    if(stored) return hydrate(stored);

    // Fallback: first restaurant in the collection.
    // (Only happens on a truly fresh device with no ?r= and no prior visit.)
    return db.collection('restaurants').limit(1).get().then(function(snap){
      if(snap.empty){
        throw new Error('Aucun restaurant configuré. Contactez votre responsable.');
      }
      const id = snap.docs[0].id;
      writeToStorage(id);
      return hydrate(id);
    });
  })();

  function hydrate(id){
    CSM.restaurantId = id;
    return db.collection('restaurants').doc(id).get().then(function(doc){
      CSM.restaurantName = (doc.exists && doc.data().name) || id;
      return CSM;
    }).catch(function(){
      CSM.restaurantName = id;
      return CSM;
    });
  }

  /* ------------------------------------------------------------------
     Convenience ref helpers — every page should use these instead of
     building paths by hand. Keeps the structure in one place.
  ------------------------------------------------------------------ */
  CSM.refs = {
    restaurant: function(){ return db.collection('restaurants').doc(CSM.restaurantId); },
    meta:       function(){ return db.collection('restaurants').doc(CSM.restaurantId).collection('meta').doc('info'); },
    staff:      function(badge){ return db.collection('restaurants').doc(CSM.restaurantId).collection('staff').doc(String(badge)); },
    staffColl:  function(){ return db.collection('restaurants').doc(CSM.restaurantId).collection('staff'); },
    shifts:     function(){ return db.collection('restaurants').doc(CSM.restaurantId).collection('shifts'); },
    shift:      function(id){ return db.collection('restaurants').doc(CSM.restaurantId).collection('shifts').doc(id); },
    schedules:  function(){ return db.collection('restaurants').doc(CSM.restaurantId).collection('schedules'); },
    leaveReqs:  function(){ return db.collection('restaurants').doc(CSM.restaurantId).collection('leaveRequests'); },
    corrections:function(){ return db.collection('restaurants').doc(CSM.restaurantId).collection('corrections'); },
    auditLog:   function(){ return db.collection('restaurants').doc(CSM.restaurantId).collection('auditLog'); },
    managers:   function(uid){ return db.collection('managerRestaurants').doc(uid); }
  };

  // Expose globally (used by every page as window.CSM).
  window.CSM = CSM;
  // Shortcut for pages that just want the Firestore instance.
  window.db = db;
  window.auth = auth;

})();
