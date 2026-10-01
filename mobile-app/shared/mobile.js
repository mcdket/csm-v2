/**
 * shared/mobile.js
 * ----------------
 * Cross-platform mobile helpers:
 *   - Detect if running in Capacitor (real app) vs browser (preview)
 *   - PIN hashing + local storage
 *   - Push notification registration
 *   - Status bar / splash screen theming
 */
(function(){
  'use strict';

  // Detect if we're running inside the Capacitor native app
  const isNative = typeof window.Capacitor !== 'undefined'
                && window.Capacitor.isNativePlatform
                && window.Capacitor.isNativePlatform();

  // Detect platform
  const platform = (window.Capacitor && window.Capacitor.getPlatform)
    ? window.Capacitor.getPlatform()
    : 'web';

  // ============================================================
  // PIN hashing — simple but consistent
  // ============================================================
  function hashPin(pin){
    const s = 'csm-manager-pin-' + String(pin) + '-v1';
    let h = 5381;
    for(let i = 0; i < s.length; i++){
      h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    }
    return 'h' + (h >>> 0).toString(36);
  }

  // ============================================================
  // Local storage keys
  // ============================================================
  const PIN_HASH_KEY = 'csm_mobile_pin_hash';
  const PIN_SET_KEY  = 'csm_mobile_pin_set';
  const USER_EMAIL_KEY = 'csm_mobile_user_email';
  const DEVICE_TOKEN_KEY = 'csm_mobile_device_token';

  // ============================================================
  // Preferences wrapper
  // ============================================================
  async function prefGet(key){
    if(isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences){
      try{
        const r = await window.Capacitor.Plugins.Preferences.get({ key: key });
        return r.value || null;
      }catch(e){ return null; }
    }
    try{ return localStorage.getItem(key); }catch(e){ return null; }
  }

  async function prefSet(key, value){
    if(isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences){
      try{
        await window.Capacitor.Plugins.Preferences.set({ key: key, value: String(value) });
        return true;
      }catch(e){ return false; }
    }
    try{ localStorage.setItem(key, String(value)); return true; }catch(e){ return false; }
  }

  async function prefRemove(key){
    if(isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences){
      try{ await window.Capacitor.Plugins.Preferences.remove({ key: key }); return true; }catch(e){ return false; }
    }
    try{ localStorage.removeItem(key); return true; }catch(e){ return false; }
  }

  // ============================================================
  // Push notifications
  // ============================================================
  async function requestPushPermission(){
    if(!isNative) return { granted: false, reason: 'not-native' };
    try{
      const P = window.Capacitor.Plugins.PushNotifications;
      if(!P) return { granted: false, reason: 'no-plugin' };

      const perm = await P.checkPermissions();
      if(perm.receive === 'granted') return { granted: true };
      if(perm.receive === 'denied') return { granted: false, reason: 'denied' };

      const result = await P.requestPermissions();
      return { granted: result.receive === 'granted', reason: result.receive };
    }catch(e){
      return { granted: false, reason: e.message };
    }
  }

  async function getPushToken(){
    if(!isNative) return null;
    try{
      const P = window.Capacitor.Plugins.PushNotifications;
      if(!P) return null;

      return new Promise(function(resolve){
        let resolved = false;
        const timeout = setTimeout(function(){
          if(!resolved){ resolved = true; resolve(null); }
        }, 10000);

        P.addListener('registration', function(token){
          if(!resolved){
            resolved = true;
            clearTimeout(timeout);
            resolve(token.value);
          }
        });

        P.addListener('registrationError', function(err){
          if(!resolved){
            resolved = true;
            clearTimeout(timeout);
            resolve(null);
          }
        });

        P.register();
      });
    }catch(e){
      return null;
    }
  }

  async function addNotificationListener(handler){
    if(!isNative) return;
    try{
      const P = window.Capacitor.Plugins.PushNotifications;
      if(!P) return;
      P.addListener('pushNotificationReceived', function(notif){
        try{ handler(notif); }catch(e){ console.error(e); }
      });
    }catch(e){}
  }

  async function addNotificationTapListener(handler){
    if(!isNative) return;
    try{
      const P = window.Capacitor.Plugins.PushNotifications;
      if(!P) return;
      P.addListener('pushNotificationActionPerformed', function(action){
        try{ handler(action); }catch(e){ console.error(e); }
      });
    }catch(e){}
  }

  // ============================================================
  // Status bar
  // ============================================================
  function setStatusBar(color, isDark){
    if(!isNative) return;
    try{
      const S = window.Capacitor.Plugins.StatusBar;
      if(!S) return;
      if(S.setBackgroundColor) S.setBackgroundColor({ color: color || '#0D5B6E' });
      if(S.setStyle) S.setStyle({ style: isDark ? 'DARK' : 'LIGHT' });
    }catch(e){}
  }

  // ============================================================
  // Splash screen
  // ============================================================
  function hideSplash(){
    if(!isNative) return;
    try{
      const Splash = window.Capacitor.Plugins.SplashScreen;
      if(!Splash) return;
      Splash.hide();
    }catch(e){}
  }

  // ============================================================
  // Expose
  // ============================================================
  window.CSMMobile = {
    isNative: isNative,
    platform: platform,

    hashPin: hashPin,

    prefGet: prefGet,
    prefSet: prefSet,
    prefRemove: prefRemove,

    PIN_HASH_KEY: PIN_HASH_KEY,
    PIN_SET_KEY: PIN_SET_KEY,
    USER_EMAIL_KEY: USER_EMAIL_KEY,
    DEVICE_TOKEN_KEY: DEVICE_TOKEN_KEY,

    requestPushPermission: requestPushPermission,
    getPushToken: getPushToken,
    addNotificationListener: addNotificationListener,
    addNotificationTapListener: addNotificationTapListener,

    setStatusBar: setStatusBar,
    hideSplash: hideSplash
  };

  // Hide splash on load (native only)
  setTimeout(hideSplash, 500);

})();