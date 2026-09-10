// Short-TTL cache of each machine's full user roster.
//
// The machines are reached over the public internet and serve one HTTP
// request at a time, so every page re-scanning them is what makes the UI
// slow. All read-heavy paths share one scan per machine per TTL window,
// and concurrent requests share the same in-flight scan.
import * as isapi from './isapi.js';
import { sp, getRow, run } from './db.js';

const TTL = 120000; // ms (2 minutes — invalidated on user mutations)
const FAIL_TTL = 45000; // an unreachable machine isn't retried for this long
const entries = new Map(); // deviceId -> { at, data, inflight, failedAt, lastErr }
const cardEntries = new Map(); // deviceId -> { at, data, inflight }
const CARDS_TTL = 300000;

// ---- DB-backed shared snapshot (WN_HIK_DevCache) ----------------------------
// Serverless instances each start cold; without this, every page load
// re-scanned all machines over the WAN. One instance scans and writes the
// snapshot; every other instance reads it in milliseconds.
function freshEnough(at, ttl) {
  if (!at) return false;
  const t = new Date(String(at).replace(' ', 'T')).getTime();
  return Number.isFinite(t) && Date.now() - t < ttl;
}
async function dbSnapshot(devId) {
  try { return await getRow('SELECT roster, roster_at, cards, cards_at FROM dbo.WN_HIK_DevCache WITH (NOLOCK) WHERE device_id=?', [Number(devId)]); }
  catch { return null; }
}
function dbSaveSnapshot(devId, field, data) {
  const json = JSON.stringify(data);
  run(`MERGE dbo.WN_HIK_DevCache AS t USING (SELECT ? AS id) s ON t.device_id = s.id
       WHEN MATCHED THEN UPDATE SET ${field} = ?, ${field}_at = SYSDATETIME()
       WHEN NOT MATCHED THEN INSERT (device_id, ${field}, ${field}_at) VALUES (s.id, ?, SYSDATETIME());`,
    [Number(devId), json, json]).catch(() => {});
}

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
    const page = await isapi.searchPersons(dev, pos, 60, { timeout: 2200 });
    users.push(...page.list);
    if (!page.list.length || users.length >= page.total) break;
    pos += page.list.length;
  }
  return users;
}

// Full roster of a machine (array of device user records). Throws when the
// machine is unreachable. maxAge can stretch the acceptable staleness.
export function getRoster(dev, maxAge = TTL) {
  if (!dev.online) {
    const e0 = entries.get(dev.id);
    if (e0?.data) return Promise.resolve(e0.data);
    // last known snapshot (any age) beats showing nothing for a dead machine
    return (async () => {
      const snap = await dbSnapshot(dev.id);
      if (snap?.roster) {
        try {
          const users = JSON.parse(snap.roster);
          entries.set(dev.id, { at: Date.now(), data: users });
          return users;
        } catch { /* corrupt */ }
      }
      throw new Error('machine offline');
    })();
  }
  const e = entries.get(dev.id);
  const now = Date.now();
  if (e?.data && now - e.at < maxAge) return Promise.resolve(e.data);
  if (e?.inflight) return e.inflight;
  // Recently-failed machine: fail fast instead of re-waiting on the timeout.
  if (e?.failedAt && now - e.failedAt < FAIL_TTL && !(e?.data && maxAge > TTL)) {
    return Promise.reject(new Error(e.lastErr || 'machine unreachable (cached)'));
  }
  const inflight = (async () => {
    // shared snapshot first — fresh enough means no machine round trips
    const snap = await dbSnapshot(dev.id);
    if (snap?.roster && freshEnough(snap.roster_at, maxAge)) {
      try {
        const users = JSON.parse(snap.roster);
        entries.set(dev.id, { at: Date.now(), data: users });
        return users;
      } catch { /* corrupt snapshot — fall through to a real scan */ }
    }
    const users = await scan(dev);
    entries.set(dev.id, { at: Date.now(), data: users });
    trackHighWater(users);
    dbSaveSnapshot(dev.id, 'roster', users);
    return users;
  })().catch((err) => {
    // drop inflight, keep stale data, remember the failure briefly
    entries.set(dev.id, { at: e?.at || 0, data: e?.data, failedAt: Date.now(), lastErr: String(err.message || err) });
    throw err;
  });
  entries.set(dev.id, { at: e?.at || 0, data: e?.data, inflight });
  return inflight;
}

// Full card table of a machine ([{cardNo, employeeNo}...]) with the same
// triple-layer caching as rosters (memory → DB snapshot → machine).
export function getCardTable(dev, maxAge = CARDS_TTL) {
  const e = cardEntries.get(dev.id);
  const now = Date.now();
  if (e?.data && now - e.at < maxAge) return Promise.resolve(e.data);
  if (e?.inflight) return e.inflight;
  const inflight = (async () => {
    const snap = await dbSnapshot(dev.id);
    if (snap?.cards && (freshEnough(snap.cards_at, maxAge) || !dev.online)) {
      try {
        const list = JSON.parse(snap.cards);
        cardEntries.set(dev.id, { at: Date.now(), data: list });
        return list;
      } catch { /* fall through */ }
    }
    if (!dev.online) throw new Error('machine offline');
    const all = [];
    let pos = 0;
    for (let i = 0; i < 60; i++) {
      const page = await isapi.readAllCards(dev, pos, 100);
      all.push(...page.list);
      if (!page.list.length || all.length >= page.total) break;
      pos += page.list.length;
    }
    const list = all.map((c) => ({ cardNo: String(c.cardNo), employeeNo: String(c.employeeNo) }));
    cardEntries.set(dev.id, { at: Date.now(), data: list });
    dbSaveSnapshot(dev.id, 'cards', list);
    return list;
  })().catch((err) => {
    cardEntries.delete(dev.id);
    throw err;
  });
  cardEntries.set(dev.id, { ...(e || {}), inflight });
  return inflight;
}

// Call after anything that changes users on a machine (add/edit/delete,
// captures, syncs) so the next read reflects it immediately.
export function invalidateRoster(deviceId) {
  if (deviceId == null) {
    entries.clear();
    cardEntries.clear();
    run('UPDATE dbo.WN_HIK_DevCache SET roster_at=NULL, cards_at=NULL').catch(() => {});
  } else {
    entries.delete(Number(deviceId));
    cardEntries.delete(Number(deviceId));
    run('UPDATE dbo.WN_HIK_DevCache SET roster_at=NULL, cards_at=NULL WHERE device_id=?', [Number(deviceId)]).catch(() => {});
  }
}
