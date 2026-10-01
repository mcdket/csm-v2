/**
 * check-alerts.js
 * ----------------
 * Runs on a schedule via GitHub Actions.
 * Reads today's open shifts from Firestore, computes alert state
 * using the same rules as shared/rules-helpers.js, and sends
 * alerts to your phone via ntfy.
 *
 * Required environment variables (GitHub Actions secrets):
 *   FIREBASE_SERVICE_ACCOUNT  Full JSON of a Firebase service account key (one line)
 *   NTFY_TOPIC                Your private ntfy topic name
 *   RESTAURANT_ID             (optional) defaults to "ketia"
 *
 * Alert rules:
 *   1. Segment 4h50 without break   -> crit (repeat every 3 min)
 *   2. Segment 4h30 without break   -> warn (once)
 *   3. Break longer than 35 min     -> break-warn (once)
 *   4. Total shift >= 9h50          -> day-limit (repeat every 1 min until clock-out)
 */

const admin = require('firebase-admin');

const SEGMENT_MIN      = 4 * 60 + 50;   // 4h50 continuous
const BREAK_MIN        = 30;            // mandatory break length
const WARN_MIN         = 4 * 60 + 30;   // 4h30 warning
const CRIT_MIN         = 4 * 60 + 50;   // 4h50 hard limit
const FULL_NOBREAK_MIN = 10 * 60 + 10;  // if no break taken at all

const BREAK_ALERT_MIN  = 35;            // NEW: notify at 35 min of break
const DAY_LIMIT_MIN    = 9 * 60 + 50;   // NEW: 9h50 total shift
const DAY_LIMIT_REPEAT_MIN = 1;         // NEW: repeat every 1 min
const REPEAT_MIN       = 3;             // existing crit repeat
const TIMEZONE         = 'Africa/Casablanca';

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error('Missing FIREBASE_SERVICE_ACCOUNT env var.');
  process.exit(1);
}
if (!process.env.NTFY_TOPIC) {
  console.error('Missing NTFY_TOPIC env var.');
  process.exit(1);
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const RESTAURANT_ID = process.env.RESTAURANT_ID || 'ketia';

function nowMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, hour12: false, hour: '2-digit', minute: '2-digit'
  }).formatToParts(new Date());
  const h = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const m = parseInt(parts.find(p => p.type === 'minute').value, 10);
  return h * 60 + m;
}

function todayKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const y = parts.find(p => p.type === 'year').value;
  const m = parts.find(p => p.type === 'month').value;
  const d = parts.find(p => p.type === 'day').value;
  return y + '-' + m + '-' + d;
}

function fmtHrs(min) {
  if (min === null || min === undefined) return '—';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h + 'h' + String(m).padStart(2, '0');
}

function computeShift(shift, t) {
  const out = {
    status: 'ok',
    contMinutes: 0,
    totalMinutes: 0,
    elapsedBreakMinutes: 0
  };
  const ci = shift.clockIn;
  if (ci === null || ci === undefined) {
    out.status = 'nodata';
    return out;
  }
  const hasReturn     = shift.breakReturn !== null && shift.breakReturn !== undefined;
  const hasBreakStart = shift.breakStart !== null && shift.breakStart !== undefined;
  const hasClockOut   = shift.clockOut    !== null && shift.clockOut    !== undefined;

  // Always compute total for the day
  let pre = 0, post = 0;
  if (hasBreakStart) {
    const pEnd = hasReturn ? shift.breakReturn : shift.breakStart;
    let d = pEnd - ci; if (d < 0) d += 1440;
    pre = d;
  } else {
    const end = hasClockOut ? shift.clockOut : t;
    let d = end - ci; if (d < 0) d += 1440;
    pre = d;
  }
  if (hasReturn) {
    const end = hasClockOut ? shift.clockOut : t;
    let d = end - shift.breakReturn; if (d < 0) d += 1440;
    post = d;
  }
  out.totalMinutes = pre + post;

  if (hasClockOut) { out.status = 'done'; return out; }

  if (hasBreakStart && !hasReturn) {
    let elapsedBreak = t - shift.breakStart;
    if (elapsedBreak < 0) elapsedBreak += 1440;
    out.elapsedBreakMinutes = elapsedBreak;
    out.status = elapsedBreak >= BREAK_MIN ? 'breakover' : 'break';
    return out;
  }

  let cont = hasReturn ? (t - shift.breakReturn) : (t - ci);
  if (cont < 0) cont += 1440;
  out.contMinutes = cont;

  if (cont >= CRIT_MIN) out.status = 'crit';
  else if (cont >= WARN_MIN) out.status = 'warn';
  else out.status = 'ok';

  return out;
}

function buildMessage(shift, level, kind) {
  const name = shift.name || 'Employé';
  const badgeLabel = shift.badge || '—';
  const urgent = level === 'crit' || kind === 'day-limit';

  let body;
  if (kind === 'day-limit') {
    body = 'A travaillé ' + fmtHrs(computeShift(shift, nowMinutes()).totalMinutes) +
           ' au total aujourd\'hui — n\'a pas pointé sa sortie.';
  } else if (kind === 'break-35') {
    body = 'Pause en cours depuis plus de 35 min. Retour non pointé.';
  } else if (level === 'warn') {
    body = 'Approche des 4h50 sans pause (4h30 atteintes).';
  } else if (kind === 'brk') {
    body = 'Pause dépassée (plus de 30 min).';
  } else {
    body = 'Limite de 4h50 atteinte — pause immédiate requise.';
  }

  return {
    title: name + ' — Badge ' + badgeLabel,
    body: body,
    priority: urgent ? 5 : 4,
    tags: urgent ? ['rotating_light'] : ['warning']
  };
}

async function sendNtfy(msg) {
  const res = await fetch('https://ntfy.sh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      topic: process.env.NTFY_TOPIC,
      title: msg.title,
      message: msg.body,
      priority: msg.priority,
      tags: msg.tags
    })
  });
  if (!res.ok) {
    throw new Error('ntfy responded ' + res.status + ': ' + (await res.text()));
  }
}

async function main() {
  if (process.env.NTFY_TEST === 'true') {
    await sendNtfy({
      title: 'Test — CSM alerts',
      body: 'Si vous voyez ceci, ntfy fonctionne.',
      priority: 5,
      tags: ['rotating_light']
    });
    console.log('Test notification sent.');
    return;
  }

  const t = nowMinutes();
  const today = todayKey();

  const shiftsRef = db
    .collection('restaurants').doc(RESTAURANT_ID)
    .collection('shifts');

  const snap = await shiftsRef
    .where('date', '==', today)
    .where('status', '==', 'open')
    .get();

  const shifts = snap.docs.map(d => Object.assign({ _id: d.id }, d.data()));

  const stateRef = db.collection('pushAlertState').doc(RESTAURANT_ID);
  const stateDoc = await stateRef.get();
  const notifiedState = (stateDoc.exists && stateDoc.data().state) || {};
  const seenKeys = new Set();

  const toSend = [];

  shifts.forEach(shift => {
    const calc = computeShift(shift, t);
    const badge = String(shift.badge || shift._id || Math.random());

    // ---- Rule 1 & 2: segment over 4h50 / 4h30 ----
    let segLevel = null, segKind = null;
    if (calc.status === 'crit' || calc.status === 'breakover') {
      segKind = calc.status === 'breakover' ? 'brk' : 'crit';
      segLevel = 'crit';
    } else if (calc.status === 'warn') {
      segKind = 'warn';
      segLevel = 'warn';
    }

    if (segLevel) {
      const key = badge + '_seg';
      seenKeys.add(key);
      const prev = notifiedState[key];
      const prevLevel = (prev && typeof prev === 'object') ? prev.level : prev;
      const prevAt = (prev && typeof prev === 'object') ? (prev.at || 0) : 0;
      const repeatDue = segLevel === 'crit' && REPEAT_MIN > 0
                     && (Date.now() - prevAt) >= REPEAT_MIN * 60000;

      if (prevLevel !== segLevel || repeatDue) {
        toSend.push({ key, prev, msg: buildMessage(shift, segLevel, segKind) });
        notifiedState[key] = { level: segLevel, at: Date.now() };
      }
    }

    // ---- Rule 3: break longer than 35 min (once) ----
    const hasBreakStart = shift.breakStart !== null && shift.breakStart !== undefined;
    const hasReturn     = shift.breakReturn !== null && shift.breakReturn !== undefined;
    if (hasBreakStart && !hasReturn) {
      let elapsedBreak = t - shift.breakStart;
      if (elapsedBreak < 0) elapsedBreak += 1440;
      if (elapsedBreak >= BREAK_ALERT_MIN) {
        const key = badge + '_break35';
        seenKeys.add(key);
        if (!notifiedState[key]) {
          toSend.push({ key, prev: undefined, msg: buildMessage(shift, 'crit', 'break-35') });
          notifiedState[key] = { level: 'break-35', at: Date.now() };
        }
      }
    }

    // ---- Rule 4: total shift >= 9h50 (repeat every minute until clock-out) ----
    if (calc.totalMinutes >= DAY_LIMIT_MIN) {
      const key = badge + '_daylimit';
      seenKeys.add(key);
      const prev = notifiedState[key];
      const prevAt = (prev && typeof prev === 'object') ? (prev.at || 0) : 0;
      const repeatDue = (Date.now() - prevAt) >= DAY_LIMIT_REPEAT_MIN * 60000;
      if (!prev || repeatDue) {
        toSend.push({ key, prev, msg: buildMessage(shift, 'crit', 'day-limit') });
        notifiedState[key] = { level: 'day-limit', at: Date.now() };
      }
    }
  });

  // Clean up state for employees no longer open today
  Object.keys(notifiedState).forEach(k => {
    const badgePart = k.split('_')[0];
    // Only remove if the badge's open shift is gone
    if (!shifts.some(s => String(s.badge) === badgePart)) {
      delete notifiedState[k];
    }
  });

  console.log(toSend.length + ' new alert(s) to send this run.');

  let failures = 0;
  for (const item of toSend) {
    try {
      await sendNtfy(item.msg);
      console.log('Sent: ' + item.msg.title);
    } catch (err) {
      failures++;
      console.error('ntfy send failed:', err.message);
      if (item.prev === undefined) delete notifiedState[item.key];
      else notifiedState[item.key] = item.prev;
    }
  }

  await stateRef.set({
    state: notifiedState,
    updatedAt: new Date().toISOString()
  });

  console.log('Done.');
  if (failures > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
