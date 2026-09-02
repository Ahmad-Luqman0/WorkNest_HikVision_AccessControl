// Background jobs: expiry enforcement, clock sync, machine watchdog, and
// cross-machine credential sync. The MACHINES block people after their Valid
// Period natively — these jobs handle the extras (status flips, auto-delete,
// keeping credentials identical everywhere).
import cron from 'node-cron';
import { getRow, getRows, getAllDevices, getDeviceById, sp, run, logSync, isUnreachableErr, getFpTemplates } from './db.js';
import * as isapi from './isapi.js';
import { syncAllPending } from './sync.js';
import { getRoster, invalidateRoster } from './machineCache.js';
import { migrateRenewedBookings } from './routes/bookings.js';

function nowLocalIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}`;
}

export async function runExpiryPass() {
  const now = nowLocalIso();
  // WN_HIK_Expiry_Run flips status to 'expired' and returns the affected rows.
  const expired = await sp('WN_HIK_Expiry_Run', { now });

  for (const emp of expired) {
    logSync(emp.id, null, 'expire', true, `expired at ${now}`);
    if (emp.auto_delete) {
      const grants = await getRows('SELECT * FROM dbo.WN_HIK_AccessGrants WHERE employee_id=?', [emp.id]);
      for (const g of grants) {
        const dev = await getDeviceById(g.device_id);
        if (!dev) continue;
        try {
          const r = await isapi.deletePerson(dev, emp.employee_no);
          logSync(emp.id, dev.id, 'auto-delete', r.ok, r);
        } catch (e) {
          logSync(emp.id, dev.id, 'auto-delete', false, String(e.message || e));
        }
      }
      await run('DELETE FROM dbo.WN_HIK_AccessGrants WHERE employee_id=?', [emp.id]);
    }
  }
  return { checkedAt: now, expiredCount: expired.length };
}

// Write the server's clock to every machine. A drifted machine clock makes
// valid people look expired at the door — this makes that impossible.
export async function runClockSync() {
  const devices = await getAllDevices();
  const results = [];
  await Promise.all(devices.map(async (dev) => {
    try {
      const r = await isapi.setDeviceTime(dev);
      logSync(null, dev.id, 'time-sync', r.ok, r.ok ? 'clock set to server time' : r);
      results.push({ device: dev.name, ok: r.ok });
    } catch (e) {
      logSync(null, dev.id, 'time-sync', false, String(e.message || e));
      results.push({ device: dev.name, ok: false });
    }
  }));
  return results;
}

// Ping every machine; update online/last_seen and log transitions so the
// dashboard can show offline alerts.
export async function runOnlineCheck() {
  const devices = await getAllDevices();
  let changed = 0;
  const cameOnline = [];
  await Promise.all(devices.map(async (dev) => {
    let up = false;
    try {
      await isapi.getDeviceInfo(dev);
      up = true;
    } catch { up = false; }
    if (up) {
      if (!dev.online) { changed++; cameOnline.push(dev.name); logSync(null, dev.id, 'online', true, 'machine is reachable again'); }
      await sp('WN_HIK_Device_SetOnline', { device_id: dev.id, online: 1 });
    } else {
      if (dev.online) { changed++; logSync(null, dev.id, 'offline', false, 'machine stopped responding'); }
      await sp('WN_HIK_Device_SetOnline', { device_id: dev.id, online: 0 });
    }
  }));
  // A machine that just came back gets reconciled right away: queued ops
  // first, then the credential sync copies fingerprints/cards/faces for every
  // person matched by employee # + name. (On serverless the watcher and the
  // next online check pick this up instead of a background task.)
  if (cameOnline.length && !process.env.VERCEL) {
    (async () => {
      try { await replayPendingOps(); } catch { /* retried by the watcher */ }
      try {
        const r = await runCredentialSync();
        if (r.copied) console.log(`[online] ${cameOnline.join(', ')} back — synced ${r.copied} credential(s)`);
      } catch { /* retried by the watcher */ }
    })();
  }
  return { checked: devices.length, changed, cameOnline };
}

// Keep credentials identical for the same person across machines. A person is
// matched ONLY when both employee # AND name are equal on the machines. Any
// fingerprint, card or face present on one machine and missing on another is
// copied over — so enrolling at one machine propagates everywhere.
export async function runCredentialSync() {
  const devices = await getAllDevices();
  if (devices.length < 2) return { copied: 0 };

  const rosters = (await Promise.all(devices.map(async (dev) => {
    try { return { dev, users: await getRoster(dev) }; }
    catch { return null; } /* unreachable — skip this machine this round */
  }))).filter(Boolean);
  if (rosters.length < 2) return { copied: 0 };

  const groups = new Map(); // `${employeeNo}||${name}` -> [{dev, u}]
  for (const r of rosters) {
    for (const u of r.users) {
      const key = `${u.employeeNo}||${String(u.name || '').trim().toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ dev: r.dev, u });
    }
  }

  let copied = 0;
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    copied += (await syncCredentialGroup(members)).copied;
  }
  return { copied };
}

// Copy the union of ONE person's fingerprints, cards and face template to
// every machine in `members` ([{dev, u}]) that lacks them. Used by the
// periodic credential sync and by the dashboard's per-person Fix button.
export async function syncCredentialGroup(members, onlyDeviceIds = null) {
  let copied = 0;
  if (members.length < 2) return { copied };
  const employeeNo = String(members[0].u.employeeNo);
  // onlyDeviceIds: write just to these machines (the union is still read from
  // ALL members so nothing is missed) — lets the UI batch for progress.
  const writable = (m) => !onlyDeviceIds || onlyDeviceIds.has(m.dev.id);

  // Fingerprints: union by finger slot. Machines can't export templates, so
  // the DB vault (filled at capture time) is the primary source; anything a
  // machine does export is unioned in too.
  try {
    const sets = await Promise.all(members.map(async (m) => ({ m, prints: await isapi.readFingerprints(m.dev, employeeNo) })));
    const union = new Map();
    try {
      for (const v of await getFpTemplates(employeeNo, members[0].u.name)) union.set(Number(v.finger_no) || 1, v.template);
    } catch { /* vault unavailable — machine reads only */ }
    for (const s of sets) for (const p of s.prints) if (!union.has(p.fingerPrintID)) union.set(p.fingerPrintID, p.fingerData);
    await Promise.all(sets.filter((s) => writable(s.m)).map(async (s) => {
      if (Number(s.m.u.numOfFP) >= union.size && union.size) return; // already complete
      const have = new Set(s.prints.map((p) => p.fingerPrintID));
      for (const [fid, data] of union) {
        if (have.has(fid)) continue;
        const r = await isapi.addFingerprint(s.m.dev, employeeNo, data, fid);
        const ok = r.ok || /alreadyexist/i.test(String(r.subStatusCode || ''));
        logSync(null, s.m.dev.id, 'sync-fingerprint', ok, { employeeNo, fingerPrintID: fid });
        if (r.ok) copied++;
      }
    }));
  } catch { /* partial failure — retried next round */ }

  // Cards: union of card numbers.
  try {
    const sets = await Promise.all(members.map(async (m) => ({ m, cards: await isapi.readCards(m.dev, employeeNo) })));
    const union = new Set(sets.flatMap((s) => s.cards));
    await Promise.all(sets.filter((s) => writable(s.m)).map(async (s) => {
      const have = new Set(s.cards);
      for (const c of union) {
        if (have.has(c)) continue;
        const r = await isapi.addCard(s.m.dev, employeeNo, c);
        const ok = r.ok || /alreadyexist|duplicate/i.test(String(r.subStatusCode || ''));
        logSync(null, s.m.dev.id, 'sync-card', ok, { employeeNo, cardNo: c });
        if (r.ok) copied++;
      }
    }));
  } catch { /* retried next round */ }

  // Faces: copy the recognition template to machines with no face enrolled.
  try {
    const withFace = members.filter((m) => Number(m.u.numOfFace) > 0);
    const without = members.filter((m) => !Number(m.u.numOfFace) && writable(m));
    if (withFace.length && without.length) {
      const faces = await isapi.readFaces(withFace[0].dev, employeeNo);
      if (faces.length) {
        await Promise.all(without.map(async (m) => {
          const r = await isapi.addFaceByModel(m.dev, employeeNo, faces[0].modelData);
          // 'deviceUserAlreadyExistFace' = the face is already there — success.
          const ok = r.ok || /alreadyexist/i.test(String(r.subStatusCode || ''));
          logSync(null, m.dev.id, 'sync-face', ok, { employeeNo });
          if (r.ok) copied++;
        }));
      }
    }
  } catch { /* retried next round */ }
  return { copied };
}

// Replay queued operations against machines that are back online. Ops for
// still-offline machines stay queued; an op that keeps failing on a live
// machine is dropped (and logged) after 8 attempts.
export async function replayPendingOps() {
  const ops = await getRows('SELECT TOP 200 * FROM dbo.WN_HIK_PendingOps ORDER BY id');
  if (!ops.length) return { applied: 0 };
  const devCache = new Map();
  let applied = 0;
  for (const o of ops) {
    if (!devCache.has(o.device_id)) devCache.set(o.device_id, await getDeviceById(o.device_id));
    const dev = devCache.get(o.device_id);
    if (!dev) { await run('DELETE FROM dbo.WN_HIK_PendingOps WHERE id=?', [o.id]); continue; }
    if (!dev.online) continue; // wait for the watchdog to see it up
    try {
      const payload = o.payload ? JSON.parse(o.payload) : {};
      const emp = String(o.employee_no || '');
      if (o.op === 'grant') {
        const rec = payload.record;
        let r = await isapi.upsertPerson(dev, rec, 'add');
        if (!r.ok) r = await isapi.upsertPerson(dev, rec, 'modify');
        if (!r.ok) throw new Error(isapi.describe(r));
        for (const c of payload.cards || []) await isapi.addCard(dev, emp, c);
        for (const fp of payload.prints || []) await isapi.addFingerprint(dev, emp, fp.fingerData, fp.fingerPrintID);
        for (const f of payload.faces || []) await isapi.addFaceByModel(dev, emp, f);
      } else if (['block', 'unblock', 'rename', 'set-role'].includes(o.op)) {
        const p = await isapi.getPerson(dev, emp);
        if (p) {
          const r = await isapi.upsertPerson(dev, {
            employeeNo: emp,
            name: o.op === 'rename' ? payload.name : (p.name || `User ${emp}`),
            admin: o.op === 'set-role' ? !!payload.admin : !!p.localUIRight,
            enabled: o.op === 'block' ? false : o.op === 'unblock' ? true : p.Valid?.enable !== false,
            validBegin: p.Valid?.beginTime || '2020-01-01T00:00:00',
            validEnd: p.Valid?.endTime || '2037-12-31T23:59:59',
          }, 'modify');
          if (!r.ok) throw new Error(isapi.describe(r));
        }
      } else if (o.op === 'add-fp') {
        const p = await isapi.getPerson(dev, emp);
        if (p) {
          const r = await isapi.addFingerprint(dev, emp, payload.fingerData, payload.fingerNo || 1);
          if (!r.ok && !/alreadyexist/i.test(String(r.subStatusCode || ''))) throw new Error(isapi.describe(r));
        }
      } else if (o.op === 'delete-user') {
        const r = await isapi.deletePerson(dev, emp);
        if (!r.ok && !/notExist/i.test(String(r.subStatusCode || ''))) throw new Error(isapi.describe(r));
      }
      await run('DELETE FROM dbo.WN_HIK_PendingOps WHERE id=?', [o.id]);
      logSync(null, dev.id, `applied-queued:${o.op}`, true, { employee_no: o.employee_no });
      invalidateRoster(dev.id);
      applied++;
    } catch (e) {
      const msg = String(e.message || e).slice(0, 400);
      await run('UPDATE dbo.WN_HIK_PendingOps SET attempts=attempts+1, last_error=? WHERE id=?', [msg, o.id]);
      if (isUnreachableErr(e)) continue;
      if ((Number(o.attempts) || 0) + 1 >= 8) {
        await run('DELETE FROM dbo.WN_HIK_PendingOps WHERE id=?', [o.id]);
        logSync(null, dev.id, `dropped-queued:${o.op}`, false, msg);
      }
    }
  }
  if (applied) console.log(`[queue] applied ${applied} queued op(s) to machines that came back online`);
  return { applied };
}

// Near-real-time enrollment watcher. Every 30s it takes a cheap "signature" of
// each machine's roster; any change (enrolled finger/face/card, user added or
// removed at a terminal) triggers the credential sync immediately. It also
// pushes queued dashboard-side changes so no manual "Sync All" is needed.
let _watchBusy = false;
let _rosterSig = null;

async function rosterSignature() {
  const devices = await getAllDevices();
  const parts = [];
  await Promise.all(devices.map(async (dev) => {
    try {
      const users = await getRoster(dev, 5000); // near-fresh scan for the watcher
      for (const u of users) {
        parts.push(`${dev.id}:${u.employeeNo}:${u.name}:${u.numOfFP || 0}:${u.numOfFace || 0}:${u.numOfCard || 0}`);
      }
    } catch {
      parts.push(`${dev.id}:unreachable`);
    }
  }));
  return parts.sort().join('|');
}

export async function runRosterWatch() {
  if (_watchBusy) return;
  _watchBusy = true;
  try {
    try { await migrateRenewedBookings(); } catch { /* checked again next tick */ }
    const pending = await getRow(
      `SELECT COUNT(*) AS n FROM dbo.WN_HIK_AccessGrants WHERE sync_state IN ('pending','removing')`
    );
    if (pending.n) {
      try { await syncAllPending(); } catch (e) { console.error('[watch] pending sync failed:', e); }
    }
    try { await replayPendingOps(); } catch (e) { console.error('[watch] queued-op replay failed:', e); }
    const sig = await rosterSignature();
    if (_rosterSig !== null && sig !== _rosterSig) {
      const r = await runCredentialSync();
      if (r.copied) console.log(`[watch] enrollment change detected — auto-synced ${r.copied} credential(s)`);
      _rosterSig = await rosterSignature(); // settle on the post-sync state
    } else {
      _rosterSig = sig;
    }
  } catch (e) {
    console.error('[watch] roster watch failed:', e);
  } finally {
    _watchBusy = false;
  }
}

export function startScheduler() {
  // Every 5 minutes: expiry, retry errored syncs, then credential sync.
  cron.schedule('*/5 * * * *', async () => {
    try {
      const r = await migrateRenewedBookings();
      if (r.migrated) console.log(`[scheduler] booking renewal carried over ${r.migrated} attendee(s)`);
    } catch (e) { console.error('[scheduler] booking renewal check failed:', e); }
    try { await runExpiryPass(); } catch (e) { console.error('[scheduler] expiry pass failed:', e); }
    try { await syncAllPending(); } catch (e) { console.error('[scheduler] pending sync failed:', e); }
    try {
      const r = await runCredentialSync();
      if (r.copied) console.log(`[scheduler] credential sync copied ${r.copied} item(s)`);
    } catch (e) { console.error('[scheduler] credential sync failed:', e); }
  });
  // Machine reachability every 2 minutes.
  cron.schedule('*/2 * * * *', () => {
    runOnlineCheck().catch((e) => console.error('[scheduler] online check failed:', e));
  });
  // Clock sync daily at 04:00, and once shortly after startup.
  cron.schedule('0 4 * * *', () => {
    runClockSync().catch((e) => console.error('[scheduler] clock sync failed:', e));
  });
  // Enrollment watcher — near-real-time credential sync.
  setInterval(() => { runRosterWatch(); }, 90000);
  setTimeout(() => {
    runOnlineCheck().catch(() => {});
    runClockSync().catch(() => {});
    runCredentialSync().catch(() => {}).finally(() => runRosterWatch());
  }, 3000);
  console.log('[scheduler] enrollment watch every 90s · expiry + credential sync every 5 min · online check every 2 min · clock sync daily 04:00');
}
