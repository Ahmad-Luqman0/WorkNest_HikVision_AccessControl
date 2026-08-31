// Short-TTL cache of each machine's full user roster.
//
// The machines are reached over the public internet and serve one HTTP
// request at a time, so every page re-scanning them is what makes the UI
// slow. All read-heavy paths share one scan per machine per TTL window,
// and concurrent requests share the same in-flight scan.
import * as isapi from './isapi.js';
import { sp } from './db.js';

const TTL = 20000; // ms
const FAIL_TTL = 25000; // an unreachable machine isn't retried for this long
const entries = new Map(); // deviceId -> { at, data, inflight, failedAt, lastErr }

// Persistent high-water mark of member employee numbers (< 9000) seen on any
// roster — lets the Add-user form prefill instantly without machine calls.
let _hw = 0;
function trackHighWater(users) {
  let mx = 0;
  for (const u of users) {
    const n = Number(u.employeeNo) || 0;
    if (n < 9000) mx = Math.max(mx, n);
  }
  if (mx > _hw) {
    _hw = mx;
    sp('WN_HIK_Settings_Set', { key: 'max_member_no', value: String(mx) }).catch(() => {});
  }
}

async function scan(dev) {
  const users = [];
  let pos = 0;
  for (let i = 0; i < 100; i++) {
    const page = await isapi.searchPersons(dev, pos, 100);
    users.push(...page.list);
    if (!page.list.length || users.length >= page.total) break;
    pos += page.list.length;
  }
  return users;
}

// Full roster of a machine (array of device user records). Throws when the
// machine is unreachable. maxAge can stretch the acceptable staleness.
export function getRoster(dev, maxAge = TTL) {
  const e = entries.get(dev.id);
  const now = Date.now();
  if (e?.data && now - e.at < maxAge) return Promise.resolve(e.data);
  if (e?.inflight) return e.inflight;
  // Recently-failed machine: fail fast instead of re-waiting on the timeout.
  if (e?.failedAt && now - e.failedAt < FAIL_TTL && !(e?.data && maxAge > TTL)) {
    return Promise.reject(new Error(e.lastErr || 'machine unreachable (cached)'));
  }
  const inflight = scan(dev)
    .then((users) => {
      entries.set(dev.id, { at: Date.now(), data: users });
      trackHighWater(users);
      return users;
    })
    .catch((err) => {
      // drop inflight, keep stale data, remember the failure briefly
      entries.set(dev.id, { at: e?.at || 0, data: e?.data, failedAt: Date.now(), lastErr: String(err.message || err) });
      throw err;
    });
  entries.set(dev.id, { at: e?.at || 0, data: e?.data, inflight });
  return inflight;
}

// Call after anything that changes users on a machine (add/edit/delete,
// captures, syncs) so the next read reflects it immediately.
export function invalidateRoster(deviceId) {
  if (deviceId == null) entries.clear();
  else entries.delete(Number(deviceId));
}
