/**
 * shared/notifications.js
 * -----------------------
 * Native Windows toast notifications via the Tauri notification plugin.
 *
 * Requires: shared/notifications.js is loaded by the page
 *           AND the tauri notification plugin is installed.
 *
 * Exposes: window.CSMNotify.notify(title, body)
 *          window.CSMNotify.checkAndNotify(shifts, previousState)
 */
(function(){
  'use strict';

  // Detect whether we're running inside Tauri (desktop app) or in a browser.
  const isTauri = typeof window.__TAURI__ !== 'undefined'
               || (window.location.protocol === 'tauri:' || window.location.hostname === 'tauri.localhost')
               || (navigator.userAgent || '').indexOf('Tauri') !== -1;

  let notified = {};

  function sendNative(title, body){
    if(!isTauri) return;
    try{
      // Plugin exposes sendNotification via window.__TAURI__.notification
      if(window.__TAURI__ && window.__TAURI__.notification && window.__TAURI__.notification.sendNotification){
        window.__TAURI__.notification.sendNotification({
          title: title,
          body: body,
          icon: 'icon'
        });
        return true;
      }
      // Fallback: use plugin via invoke
      if(window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke){
        window.__TAURI__.core.invoke('plugin:notification|notify', {
          options: { title: title, body: body }
        }).catch(function(){});
        return true;
      }
    }catch(e){
      console.warn('Notification failed:', e);
    }
    return false;
  }

  function requestPermission(){
    if(!isTauri) return;
    try{
      if(window.__TAURI__ && window.__TAURI__.notification && window.__TAURI__.notification.isPermissionGranted){
        window.__TAURI__.notification.isPermissionGranted().then(function(granted){
          if(!granted && window.__TAURI__.notification.requestPermission){
            return window.__TAURI__.notification.requestPermission();
          }
        });
      }
    }catch(e){}
  }

  // The notification plugin on Windows requires permission. Request once
  // when the script loads.
  setTimeout(requestPermission, 1500);

  window.CSMNotify = {
    notify: sendNative,

    /**
     * Check a list of shifts and notify for warn / crit / breakover.
     * Keeps track of what's been sent to avoid spam.
     * Format of shifts: [{ badge, name, status: 'warn'|'crit'|'breakover' }]
     */
    checkAndNotify: function(shifts){
      if(!isTauri) return;
      if(!Array.isArray(shifts)) return;
      const now = Date.now();
      const seen = {};

      shifts.forEach(function(s){
        const key = String(s.badge || s.name || Math.random());
        seen[key] = true;
        let level = null, body = null, title = null;

        if(s.status === 'crit' || s.status === 'breakover'){
          level = 'crit';
          title = (s.name || 'Employé') + ' — Limite atteinte';
          body = s.status === 'breakover'
            ? 'Pause dépassée (30 min max). Pause immédiate requise.'
            : 'Limite de 4h50 atteinte. Pause immédiate requise.';
        } else if(s.status === 'warn'){
          level = 'warn';
          title = (s.name || 'Employé') + ' — Limite proche';
          body = 'Approche des 4h50 sans pause (4h30 atteintes).';
        }

        if(!level) return;

        // Only notify once per employee per level change
        const prev = notified[key];
        if(prev && prev.level === level) return;

        notified[key] = { level: level, at: now };
        sendNative(title, body);
      });

      // Clean up: forget employees who are no longer flagged
      Object.keys(notified).forEach(function(k){
        if(!seen[k]) delete notified[k];
      });
    }
  };
})();