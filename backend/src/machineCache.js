// Short-TTL cache of each machine's full user roster.
//
// The machines are reached over the public internet and serve one HTTP
// request at a time, so every page re-scanning them is what makes the UI
// slow. All read-heavy paths share one scan per machine per TTL window,
// and concurrent requests share the same in-flight scan.
import * as isapi from './isapi.js';

const TTL = 20000; // ms
const entries = new Map(); // deviceId -> { at, data, inflight }

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
  const inflight = scan(dev)
    .then((users) => {
      entries.set(dev.id, { at: Date.now(), data: users });
      return users;
    })
    .catch((err) => {
      entries.set(dev.id, { at: e?.at || 0, data: e?.data }); // drop inflight, keep stale data
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
