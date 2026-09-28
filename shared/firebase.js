/**
 * shared/firebase.js
 * ------------------
 * Single Firebase initialisation, imported by every page.
 * Exposes on window: CSM, db, auth
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
  };

  firebase.initializeApp(firebaseConfig);

  const db = firebase.firestore();

  // Offline persistence — safe to fail (some browsers block it in private
  // mode or with multiple tabs open). Non-fatal either way.
  db.enablePersistence({ synchronizeTabs: true }).catch(function(err){
    if(err && err.code === 'failed-precondition'){
      console.warn('Firestore persistence disabled: multiple tabs open.');
    } else if(err && err.code === 'unimplemented'){
      console.warn('Firestore persistence not supported in this browser.');
    }
  });

  const auth = firebase.auth();
  auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function(){});

  // ============================================================
  // Restaurant resolution
  // ============================================================
  // Priority:
  //   1. ?r=xxx in the URL  (used by employee personal-phone links)
  //   2. localStorage csm_restaurant  (remembered from prior visit)
  //   3. DEFAULT_RESTAURANT below  (single-restaurant fallback)
  //
  // NOTE: we do NOT query the `restaurants` collection. Firestore
  // rules deny collection-level reads; only document reads of a
  // specific known ID are allowed. If you ever add a second
  // restaurant, change DEFAULT_RESTAURANT or always use ?r=xxx.
  // ============================================================
  const DEFAULT_RESTAURANT = 'ketia';
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
    ready: null
  };

  CSM.ready = (function(){
    const id = readFromUrl() || readFromStorage() || DEFAULT_RESTAURANT;
    writeToStorage(id);
    CSM.restaurantId = id;

    // Try to fetch the friendly restaurant name. If this fails
    // (permissions, network, doc missing), we still resolve — just
    // with the raw id as the name — so pages don't get stuck.
    return db.collection('restaurants').doc(id).get()
      .then(function(doc){
        CSM.restaurantName = (doc.exists && doc.data().name) || id;
        return CSM;
      })
      .catch(function(err){
        console.warn('Could not load restaurant meta:', err.message);
        CSM.restaurantName = id;
        return CSM;
      });
  })();

  // ============================================================
  // Convenience refs — every page should use these
  // ============================================================
  CSM.refs = {
    restaurant:  function(){ return db.collection('restaurants').doc(CSM.restaurantId); },
    staff:       function(badge){ return db.collection('restaurants').doc(CSM.restaurantId).collection('staff').doc(String(badge)); },
    staffColl:   function(){ return db.collection('restaurants').doc(CSM.restaurantId).collection('staff'); },
    shifts:      function(){ return db.collection('restaurants').doc(CSM.restaurantId).collection('shifts'); },
    shift:       function(id){ return db.collection('restaurants').doc(CSM.restaurantId).collection('shifts').doc(id); },
    schedules:   function(){ return db.collection('restaurants').doc(CSM.restaurantId).collection('schedules'); },
    leaveReqs:   function(){ return db.collection('restaurants').doc(CSM.restaurantId).collection('leaveRequests'); },
    corrections: function(){ return db.collection('restaurants').doc(CSM.restaurantId).collection('corrections'); },
    auditLog:    function(){ return db.collection('restaurants').doc(CSM.restaurantId).collection('auditLog'); },
    managers:    function(uid){ return db.collection('managerRestaurants').doc(uid); }
  };

  window.CSM = CSM;
  window.db = db;
  window.auth = auth;

})();
