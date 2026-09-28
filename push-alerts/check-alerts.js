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
 */

const admin = require('firebase-admin');

const SEGMENT_MIN      = 4 * 60 + 50;
const BREAK_MIN        = 30;
const WARN_MIN         = 4 * 60 + 30;
const CRIT_MIN         = 4 * 60 + 50;
const FULL_NOBREAK_MIN = 10 * 60 + 10;

const REPEAT_MIN = 3;
const TIMEZONE = 'Africa/Casablanca';

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

function computeShift(shift, t) {
  const out = { status: 'ok', contMinutes: 0, elapsedBreakMinutes: 0 };
  const ci = shift.clockIn;
  if (ci === null || ci === undefined) {
    out.status = 'nodata';
    return out;
  }
  const hasReturn     = shift.breakReturn !== null && shift.breakReturn !== undefined;
  const hasBreakStart = shift.breakStart !== null && shift.breakStart !== undefined;
  const hasClockOut   = shift.clockOut    !== null && shift.clockOut    !== undefined;

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
  const urgent = level === 'crit';

  let body;
  if (level === 'warn') body = 'Approche des 4h50 sans pause (4h30 atteintes).';
  else if (kind === 'brk') body = 'Pause dépassée (plus de 30 min).';
  else body = 'Limite de 4h50 atteinte — pause immédiate requise.';

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
  const seenBadges = new Set();

  const toSend = [];

  shifts.forEach(shift => {
    const calc = computeShift(shift, t);
    let kind = null, level = null;

    if (calc.status === 'crit' || calc.status === 'breakover') {
      kind = calc.status === 'breakover' ? 'brk' : 'crit';
      level = 'crit';
    } else if (calc.status === 'warn') {
      kind = 'warn';
      level = 'warn';
    } else {
      return;
    }

    const badgeKey = String(shift.badge || shift._id || Math.random());
    seenBadges.add(badgeKey);

    const prev = notifiedState[badgeKey];
    const prevLevel = (prev && typeof prev === 'object') ? prev.level : prev;
    const prevAt = (prev && typeof prev === 'object') ? (prev.at || 0) : 0;
    const repeatDue = level === 'crit' && REPEAT_MIN > 0
                     && (Date.now() - prevAt) >= REPEAT_MIN * 60000;

    if (prevLevel !== level || repeatDue) {
      toSend.push({ badgeKey, prev, msg: buildMessage(shift, level, kind) });
      notifiedState[badgeKey] = { level, at: Date.now() };
    }
  });

  Object.keys(notifiedState).forEach(b => {
    if (!seenBadges.has(b)) delete notifiedState[b];
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
      if (item.prev === undefined) delete notifiedState[item.badgeKey];
      else notifiedState[item.badgeKey] = item.prev;
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
