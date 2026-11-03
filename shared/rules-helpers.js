/**
 * shared/rules-helpers.js
 */
(function(){
  'use strict';

  const SEGMENT_MIN      = 4 * 60 + 50;   // 4h50 continuous
  const BREAK_MIN        = 30;            // 30 min mandatory break
  const WARN_MIN         = 4 * 60 + 50;   // 4h50 warning
  const CRIT_MIN         = 4 * 60 + 55;   // 4h55 hard limit
  const FULL_NOBREAK_MIN = 10 * 60 + 10;  // 10h10 no break

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

  function shiftState(shift, todayIso){
    if(!todayIso) todayIso = todayKey();

    const out = {
      clockIn: null, breakStart: null, breakReturn: null, clockOut: null,
      workedMinutes: 0, continuousMinutes: 0, elapsedBreakMinutes: 0,
      status: 'notpunched', statusLabel: 'Pas encore pointé',
      inPunches: [], outPunches: []
    };
    if(!shift) return out;

    // Build arrays for backward compatibility and new multi-part shifts
    let inP = shift.inPunches ? shift.inPunches.slice() : [];
    let outP = shift.outPunches ? shift.outPunches.slice() : [];

    if(inP.length === 0 && shift.clockIn != null) inP.push(shift.clockIn);
    if(outP.length === 0 && shift.breakStart != null) outP.push(shift.breakStart);
    if(shift.breakReturn != null && !inP.includes(shift.breakReturn)) inP.push(shift.breakReturn);
    if(shift.clockOut != null && !outP.includes(shift.clockOut)) outP.push(shift.clockOut);

    inP.sort(function(a,b){ return a - b; });
    outP.sort(function(a,b){ return a - b; });

    out.inPunches = inP;
    out.outPunches = outP;

    if(inP.length === 0) return out;

    out.clockIn = inP[0];
    out.clockOut = (outP.length >= inP.length) ? outP[outP.length - 1] : null;

    const shiftDate = shift.date || todayIso;
    const isStale = !out.clockOut && shiftDate !== todayIso;
    let endMin = nowMinutes();

    if(out.clockOut != null){
      endMin = out.clockOut;
    } else if(isStale){
      endMin = inP[inP.length - 1];
    }

    // Calculate total worked minutes
    let totalWorked = 0;
    for(let i = 0; i < inP.length; i++){
      if(i < outP.length){
        let d = outP[i] - inP[i];
        if(d < 0) d += 1440;
        totalWorked += d;
      } else {
        // Currently working, open segment
        let d = endMin - inP[i];
        if(d < 0) d += 1440;
        totalWorked += d;
      }
    }
    out.workedMinutes = totalWorked;

    if(isStale){
      out.status = 'done';
      out.statusLabel = 'Sortie non pointée';
      return out;
    }

    if(out.clockOut != null){
      out.status = 'done';
      out.statusLabel = 'Journée terminée';
      return out;
    }

    // Determine current status (on break, working, etc)
    const isOnBreak = inP.length === outP.length;
    
    if(isOnBreak){
      let elapsed = endMin - outP[outP.length - 1];
      if(elapsed < 0) elapsed += 1440;
      out.elapsedBreakMinutes = elapsed;
      out.continuousMinutes = totalWorked;
      if(elapsed >= BREAK_MIN){
        out.status = 'breakover';
        out.statusLabel = 'Pause dépassée (' + elapsed + 'm)';
      } else {
        out.status = 'break';
        out.statusLabel = 'En pause (' + elapsed + 'm)';
      }
      return out;
    }

    // Working
    let cont = endMin - inP[inP.length - 1];
    if(cont < 0) cont += 1440;
    out.continuousMinutes = cont;

    if(cont >= CRIT_MIN){
      out.status = 'crit';
      out.statusLabel = 'Limite 4h55 atteinte';
    } else if(cont >= WARN_MIN){
      out.status = 'warn';
      out.statusLabel = 'Limite 4h50 proche';
    } else {
      out.status = 'ok';
      out.statusLabel = 'En poste';
    }

    return out;
  }

  function nameTokens(n){
    return String(n || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/).filter(Boolean);
  }

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

  window.CSMRules = {
    SEGMENT_MIN, BREAK_MIN, WARN_MIN, CRIT_MIN, FULL_NOBREAK_MIN,
    nowMinutes, minToHM, hmToMin, fmtHrs, todayKey, monthKey, weekKeys,
    shiftState, sameName, nameTokens
  };

})();