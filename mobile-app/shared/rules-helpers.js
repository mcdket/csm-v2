/**
 * shared/rules-helpers.js
 * -----------------------
 * Pure helpers shared by every page:
 *   - shift computation (the 4h50 / 30 min rules)
 *   - fuzzy name matching (used to reconcile planning PDF ↔ employee names)
 *   - time / date formatting
 *   - date-key helpers
 *
 * No Firebase here — pure functions only, easy to test.
 *
 * Exposes on window:
 *   CSMRules.computeShift(shift)
 *   CSMRules.sameName(a, b)
 *   CSMRules.nowMinutes()
 *   CSMRules.minToHM(min)
 *   CSMRules.fmtHrs(min)
 *   CSMRules.todayKey()
 *   CSMRules.monthKey()
 *   CSMRules.weekKeys()
 *   CSMRules.SEGMENT_MIN, BREAK_MIN, WARN_MIN, CRIT_MIN, FULL_NOBREAK_MIN
 */
(function(){
  'use strict';

  // ============================================================
  // Rule constants — DO NOT change without updating
  // push-alerts/check-alerts.js as well (it has its own copy).
  // ============================================================
  const SEGMENT_MIN      = 4 * 60 + 50;   // 4h50 continuous segment max
  const BREAK_MIN        = 30;            // 30 min mandatory break
  const WARN_MIN         = 4 * 60 + 30;   // yellow threshold
  const CRIT_MIN         = 4 * 60 + 50;   // red threshold (the hard limit)
  const FULL_NOBREAK_MIN = 10 * 60 + 10;  // if no break taken at all

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
    const dow = (d.getDay() + 6) % 7; // 0 = Monday
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
  // Shift computation
  // ============================================================
  /**
   * Takes a shift document's fields and returns the live state.
   *
   * @param {object} shift  { clockIn, breakStart, breakReturn, clockOut }
   *                        All values are minutes-since-midnight or null.
   * @returns {object} {
   *   suggBreak, suggReturn, suggEnd,
   *   contMinutes,        // continuous minutes since last break started/ended
   *   totalMinutes,       // total worked minutes today
   *   elapsedBreakMinutes,
   *   status,             // 'ok' | 'warn' | 'crit' | 'break' | 'breakover' | 'done' | 'nodata'
   *   statusLabel         // human-readable French label
   * }
   */
  function computeShift(shift){
    const out = {
      suggBreak: null,
      suggReturn: null,
      suggEnd: null,
      contMinutes: 0,
      totalMinutes: 0,
      elapsedBreakMinutes: 0,
      status: 'nodata',
      statusLabel: 'Pas encore pointé'
    };
    if(!shift) return out;

    const ci = shift.clockIn;
    if(ci === null || ci === undefined) return out;

    const hasReturn     = shift.breakReturn !== null && shift.breakReturn !== undefined;
    const hasBreakStart = shift.breakStart !== null && shift.breakStart !== undefined;
    const hasClockOut   = shift.clockOut    !== null && shift.clockOut    !== undefined;

    out.suggBreak  = ci + SEGMENT_MIN;
    out.suggReturn = out.suggBreak + BREAK_MIN;
    out.suggEnd    = hasReturn ? shift.breakReturn + SEGMENT_MIN : ci + FULL_NOBREAK_MIN;

    const t = nowMinutes();
    let pre = 0, post = 0;

    if(hasBreakStart){
      const pEnd = hasReturn ? shift.breakReturn : shift.breakStart;
      let d = pEnd - ci; if(d < 0) d += 1440;
      pre = d;
    } else {
      const end = hasClockOut ? shift.clockOut : t;
      let d = end - ci; if(d < 0) d += 1440;
      pre = d;
    }

    if(hasReturn){
      const end = hasClockOut ? shift.clockOut : t;
      let d = end - shift.breakReturn; if(d < 0) d += 1440;
      post = d;
    }

    out.totalMinutes = pre + post;

    if(hasClockOut){
      out.status = 'done';
      out.statusLabel = 'Journée terminée';
      out.contMinutes = 0;
      return out;
    }

    if(hasBreakStart && !hasReturn){
      let elapsed = t - shift.breakStart; if(elapsed < 0) elapsed += 1440;
      out.elapsedBreakMinutes = elapsed;
      out.contMinutes = pre;
      if(elapsed >= BREAK_MIN){
        out.status = 'breakover';
        out.statusLabel = 'Pause dépassée (' + elapsed + 'm)';
      } else {
        out.status = 'break';
        out.statusLabel = 'En pause (' + elapsed + 'm)';
      }
      return out;
    }

    let cont = hasReturn ? (t - shift.breakReturn) : (t - ci);
    if(cont < 0) cont += 1440;
    out.contMinutes = cont;

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
  // Normalise: lowercase, strip accents, keep [a-z0-9 ], split on spaces.
  function nameTokens(n){
    return String(n || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/).filter(Boolean);
  }

  // True if the two names plausibly refer to the same person.
  // Handles: "Karim Benali" ↔ "BENALI K.", "Karim B." ↔ "Karim Benali",
  //          "Nourreddine El Idrissi" ↔ "NOUREDDINE EL IDRISSI"
  // Rejects: two completely different names, single-letter-only matches.
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

    computeShift: computeShift,
    sameName: sameName,
    nameTokens: nameTokens
  };

})();
