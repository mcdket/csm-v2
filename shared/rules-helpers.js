/**
 * shared/rules-helpers.js
 * -----------------------
 * Pure helpers shared by every page. No Firebase, easy to test.
 *
 * Exposes on window.CSMRules:
 *   shiftState(shift, todayIso?)    -- compute state of one shift
 *   sameName(a, b)                   -- fuzzy name match
 *   nameTokens(name)                 -- name → normalized tokens
 *   nowMinutes()                     -- current time as minutes since midnight
 *   minToHM(min)                     -- 725 → "12:05"
 *   hmToMin("12:05")                 -- "12:05" → 725
 *   fmtHrs(min)                      -- 725 → "12h05"
 *   todayKey()                       -- "2025-10-15"
 *   monthKey()                       -- "2025-10"
 *   weekKeys()                       -- 7 ISO dates, Monday → Sunday
 *
 * Constants (Moroccan labour rules):
 *   SEGMENT_MIN      = 290   (4h50 continuous work max)
 *   BREAK_MIN        = 30    (mandatory break)
 *   WARN_MIN         = 270   (4h30 warning threshold)
 *   CRIT_MIN         = 290   (4h50 hard limit)
 *   FULL_NOBREAK_MIN = 610   (10h10 with no break)
 */
(function(){
  'use strict';

  // ============================================================
  // Rule constants — mirrored in push-alerts/check-alerts.js
  // ============================================================
  const SEGMENT_MIN      = 4 * 60 + 50;   // 4h50 continuous segment max
  const BREAK_MIN        = 30;            // 30 min mandatory break
  const WARN_MIN         = 4 * 60 + 30;   // 4h30 warn threshold
  const CRIT_MIN         = 4 * 60 + 50;   // 4h50 hard limit
  const FULL_NOBREAK_MIN = 10 * 60 + 10;  // 10h10 with no break at all

  // ============================================================
  // Time helpers
  // ============================================================
  function nowMinutes(){
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }

  function minToHM(min){
    if(min === null || min === undefined || isNaN(min)) return null;
    min = ((min % 1440) + 1440) % 1440;
    return String(Math.floor(min / 60)).padStart(2, '0')
         + ':' + String(Math.round(min % 60)).padStart(2, '0');
  }

  function hmToMin(hm){
    if(!hm) return null;
    const m = String(hm).match(/^(\d{1,2}):(\d{2})/);
    if(!m) return null;
    return (+m[1]) * 60 + (+m[2]);
  }

  function fmtHrs(min){
    if(min === null || min === undefined || isNaN(min)) return '0h00';
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h + 'h' + String(m).padStart(2, '0');
  }

  function todayKey(){
    const d = new Date();
    return d.getFullYear() + '-'
         + String(d.getMonth() + 1).padStart(2, '0') + '-'
         + String(d.getDate()).padStart(2, '0');
  }

  function monthKey(){
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // Returns the 7 ISO dates (YYYY-MM-DD) of the current week, Monday → Sunday.
  function weekKeys(){
    const d = new Date();
    const dow = (d.getDay() + 6) % 7;
    const monday = new Date(d);
    monday.setDate(d.getDate() - dow);
    const out = [];
    for(let i = 0; i < 7; i++){
      const x = new Date(monday);
      x.setDate(monday.getDate() + i);
      out.push(x.getFullYear() + '-'
             + String(x.getMonth() + 1).padStart(2, '0') + '-'
             + String(x.getDate()).padStart(2, '0'));
    }
    return out;
  }

  // ============================================================
  // Shift state
  // ============================================================
  /**
   * Compute the live state of a shift.
   *
   * @param {object} shift       { clockIn, breakStart, breakReturn, clockOut, date? }
   *                             All times are minutes-since-midnight or null.
   * @param {string} todayIso    Optional 'YYYY-MM-DD'. Defaults to today.
   *
   * @returns {object} {
   *   clockIn, breakStart, breakReturn, clockOut,  // pass-through of the input times
   *   workedMinutes,          // total worked minutes today (breaks excluded)
   *   continuousMinutes,      // minutes since last break-return (or since clock-in)
   *   elapsedBreakMinutes,    // minutes spent on the current break (0 if not on break)
   *   status,                 // see below
   *   statusLabel             // French label ready to display
   * }
   *
   * Status values:
   *   'notpunched'  -- no clockIn yet
   *   'ok'          -- working, under 4h30 continuous
   *   'warn'        -- between 4h30 and 4h50
   *   'crit'        -- over 4h50, break overdue
   *   'break'       -- on break, under 30 min
   *   'breakover'   -- on break, over 30 min
   *   'done'        -- clocked out, or stale shift from a previous day
   *   'stale'       -- alias for done-with-warning (previous day, never clocked out)
   */
  function shiftState(shift, todayIso){
    if(!todayIso) todayIso = todayKey();

    const out = {
      clockIn:     null,
      breakStart:  null,
      breakReturn: null,
      clockOut:    null,
      workedMinutes:       0,
      continuousMinutes:   0,
      elapsedBreakMinutes: 0,
      status:       'notpunched',
      statusLabel:  'Pas encore pointé'
    };

    if(!shift) return out;

    const ci = shift.clockIn;
    if(ci === null || ci === undefined) return out;

    out.clockIn     = ci;
    out.breakStart  = (shift.breakStart  !== undefined) ? shift.breakStart  : null;
    out.breakReturn = (shift.breakReturn !== undefined) ? shift.breakReturn : null;
    out.clockOut    = (shift.clockOut    !== undefined) ? shift.clockOut    : null;

    const hasBreakStart = out.breakStart  !== null;
    const hasReturn     = out.breakReturn !== null;
    const hasClockOut   = out.clockOut    !== null;

    // A shift belongs to a past day and was never clocked out.
    const shiftDate   = shift.date || todayIso;
    const isStale     = !hasClockOut && shiftDate !== todayIso;

    // Effective "end of counting" time:
    // - if clocked out: that's the end
    // - if stale: last known punch (breakReturn > breakStart > clockIn)
    // - otherwise: now
    let endMin;
    if(hasClockOut){
      endMin = out.clockOut;
    } else if(isStale){
      endMin = hasReturn ? out.breakReturn : (hasBreakStart ? out.breakStart : ci);
    } else {
      endMin = nowMinutes();
    }

    // --- Worked minutes (breaks excluded) ---
    let pre = 0, post = 0;

    if(hasBreakStart){
      let d = out.breakStart - ci; if(d < 0) d += 1440;
      pre = d;
    } else {
      let d = endMin - ci; if(d < 0) d += 1440;
      pre = d;
    }

    if(hasReturn){
      let d = endMin - out.breakReturn; if(d < 0) d += 1440;
      post = d;
    }

    out.workedMinutes = pre + post;

    // --- Stale shift: done, but flagged ---
    if(isStale){
      out.status = 'done';
      out.statusLabel = 'Sortie non pointée';
      return out;
    }

    // --- Clocked out ---
    if(hasClockOut){
      out.status = 'done';
      out.statusLabel = 'Journée terminée';
      return out;
    }

    // --- On break ---
    if(hasBreakStart && !hasReturn){
      let elapsed = endMin - out.breakStart; if(elapsed < 0) elapsed += 1440;
      out.elapsedBreakMinutes = elapsed;
      out.continuousMinutes = pre;
      if(elapsed >= BREAK_MIN){
        out.status = 'breakover';
        out.statusLabel = 'Pause dépassée (' + elapsed + 'm)';
      } else {
        out.status = 'break';
        out.statusLabel = 'En pause (' + elapsed + 'm)';
      }
      return out;
    }

    // --- Working (with or without a completed break) ---
    let cont = hasReturn ? (endMin - out.breakReturn) : (endMin - ci);
    if(cont < 0) cont += 1440;
    out.continuousMinutes = cont;

    if(cont >= CRIT_MIN){
      out.status = 'crit';
      out.statusLabel = 'Limite 4h50 atteinte';
    } else if(cont >= WARN_MIN){
      out.status = 'warn';
      out.statusLabel = 'Limite bientôt atteinte';
    } else {
      out.status = 'ok';
      out.statusLabel = hasReturn ? 'En poste (post-pause)' : 'En poste';
    }

    return out;
  }

  // ============================================================
  // Fuzzy name matching
  // ============================================================
  function nameTokens(n){
    return String(n || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/).filter(Boolean);
  }

  // True if the two names plausibly refer to the same person.
  //   "Karim Benali" ↔ "BENALI K."
  //   "Karim B." ↔ "Karim Benali"
  //   "Nourreddine El Idrissi" ↔ "NOUREDDINE EL IDRISSI"
  // Rejects two completely different names, and single-letter-only matches.
  function sameName(a, b){
    const A = nameTokens(a), B = nameTokens(b);
    if(!A.length || !B.length) return false;
    const small = A.length <= B.length ? A : B;
    const large = A.length <= B.length ? B : A;
    const hits = small.filter(function(t){
      return large.some(function(u){
        return u === t || (t.length >= 4 && u.length >= 4
                        && (u.startsWith(t) || t.startsWith(u)));
      });
    }).length;
    return hits === small.length && (small.length >= 2 || large.length === 1);
  }

  // ============================================================
  // Export
  // ============================================================
  window.CSMRules = {
    SEGMENT_MIN: SEGMENT_MIN,
    BREAK_MIN: BREAK_MIN,
    WARN_MIN: WARN_MIN,
    CRIT_MIN: CRIT_MIN,
    FULL_NOBREAK_MIN: FULL_NOBREAK_MIN,

    nowMinutes: nowMinutes,
    minToHM: minToHM,
    hmToMin: hmToMin,
    fmtHrs: fmtHrs,
    todayKey: todayKey,
    monthKey: monthKey,
    weekKeys: weekKeys,

    shiftState: shiftState,
    sameName: sameName,
    nameTokens: nameTokens
  };

})();
