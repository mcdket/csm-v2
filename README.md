
Rules of thumb:
- **One document per shift.** Not an array. This is why we can have thousands of shifts with no 1 MB limit problem.
- **Anonymous employees** can only touch their own shifts (verified by badge field) and can only create (not modify) leave/correction requests.
- **Only the manager** (Firebase Auth email/password + `managerRestaurants/{uid}` doc) can read everything, edit anything, delete, or write to schedules / auditLog.

---

## Common tasks

### Add a second restaurant
1. Firebase Console → Firestore → create `restaurants/{new-id}` with `{ name: "..." }`
2. In `managerRestaurants/{your-uid}`, change `id` to the new restaurant id
3. Sign out of the manager portal and back in
4. From now on, all data goes under `restaurants/{new-id}/`
5. To go back to the old restaurant, just change the id back

**Note:** you can only be "in" one restaurant at a time with the current setup. If you need to manage two restaurants simultaneously, we'd have to add a restaurant switcher UI.

### Reset an employee's PIN
The employee taps "PIN oublié ?" on `employee/login.html` — that resets their local PIN on their phone only. Their data is untouched.

### Manually fix a punch
Manager portal → Tableau de bord → find the employee → pencil icon → edit times → Save.

### Delete an employee
Manager portal → Employés → Désactiver. Their history is preserved. If you truly need to delete them, do it from the Firebase Console.

### Change the alert thresholds
Edit both `shared/rules-helpers.js` (`SEGMENT_MIN`, `BREAK_MIN`, `WARN_MIN`, `CRIT_MIN`, `FULL_NOBREAK_MIN`) and `push-alerts/check-alerts.js` (same constants at the top).

---

## Troubleshooting

**"I sign in but get kicked back to login"**
→ Make sure `shared/firebase.js` on GitHub has the `authReady` block. This was a real bug we fixed. If it recurs, we can re-check.

**"Employee doesn't see their scheduled shifts"**
→ The name they entered on first visit doesn't match the name in the planning PDF. Names must share at least the significant word(s). "Karim Benali" matches "KARIM BENALI" and "Benali K." but not "KB".

**"Alerts don't arrive"**
→ Actions tab → Check-alerts → check the last run. If it's green, alerts were sent and the issue is on the ntfy app side (subscription topic, phone permissions). If it's red, read the log — the secret is probably wrong.

**"The tablet shows old data"**
→ Hard-refresh the tablet page (long-press the reload button → "Reload without cache"). The service worker may be serving stale HTML. We intentionally don't cache much, so this is rare.

---

## Deploy / update workflow

Everything is on GitHub. To change the app:
1. Edit any file in the repo directly
2. Commit → GitHub Pages redeploys automatically within 60-90 seconds
3. On the tablet: pull-to-refresh. On phones: the browser will pick up the new version on next navigation.

No build step, no npm on the frontend, no bundler. Just static HTML/CSS/JS + Firebase.

---

## Support

Everything is in this repo:
- **Rules** — `firestore.rules`
- **Shared logic** — `shared/rules-helpers.js`
- **Cloud alerts** — `push-alerts/check-alerts.js`
- **Firestore indexes** — `firestore.indexes.json` (Firestore will email you a link if a query needs an index; click it, done)
