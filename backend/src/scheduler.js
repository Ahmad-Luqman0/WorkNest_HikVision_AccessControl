// Background jobs: expiry enforcement, clock sync, machine watchdog, and
// cross-machine credential sync. The MACHINES block people after their Valid
// Period natively — these jobs handle the extras (status flips, auto-delete,
// keeping credentials identical everywhere).
import cron from 'node-cron';
import { getRow, getRows, getAllDevices, getDeviceById, sp, run, logSync, isUnreachableErr, getFpTemplates, saveFpTemplate, saveFaceTemplate, getFaceTemplate } from './db.js';
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
  const now = Date.now();
  await Promise.all(devices.map(async (dev) => {
    try {
      const devTime = await isapi.getDeviceTime(dev).catch(() => null);
      let driftSec = null;
      if (devTime && !Number.isNaN(devTime.getTime())) {
        driftSec = Math.round(Math.abs(now - devTime.getTime()) / 1000);
      }
      const r = await isapi.setDeviceTime(dev);
      const detail = driftSec !== null
        ? `clock synced to server (drift was ${driftSec}s)`
        : (r.ok ? 'clock set to server time' : r);
      logSync(null, dev.id, driftSec && driftSec > 15 ? 'clock-drift-warning' : 'time-sync', r.ok, detail);
      results.push({ device: dev.name, ok: r.ok, driftSec });
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
  const cameOnlineDevs = [];
  const results = await Promise.all(devices.map(async (dev) => {
    try {
      // Short timeout: on Vercel this runs inside a request with a 60s cap,
      // and a mostly-offline fleet must still finish within it.
      await isapi.getDeviceInfo(dev, { timeout: 2000 });
      return { dev, up: true };
    } catch { return { dev, up: false }; }
  }));
  // Every single machine unreachable means it's OUR path that's dead — e.g.
  // the office router/ISP drops traffic from cloud providers, so probes from
  // Vercel all time out while the fleet is actually fine (verified 2026-09:
  // both bom1 and sin1 blocked while a Pakistani connection gets through).
  // Don't clobber the stored statuses from a vantage point that can't see
  // anything; whoever CAN see the machines keeps the flags truthful.
  if (devices.length && !results.some((r) => r.up)) {
    console.warn('[online] all machines unreachable from here — leaving stored statuses untouched');
    return { checked: devices.length, changed: 0, cameOnline: [], blocked: true };
  }
  for (const { dev, up } of results) {
    if (up) {
      if (!dev.online) { changed++; cameOnline.push(dev.name); cameOnlineDevs.push(dev); logSync(null, dev.id, 'online', true, 'machine is reachable again'); }
      await sp('WN_HIK_Device_SetOnline', { device_id: dev.id, online: 1 });
    } else {
      if (dev.online) { changed++; logSync(null, dev.id, 'offline', false, 'machine stopped responding'); }
      await sp('WN_HIK_Device_SetOnline', { device_id: dev.id, online: 0 });
    }
  }
  // A machine that just came back gets reconciled right away: queued ops
  // first, then the credential sync copies fingerprints/cards/faces for every
  // person matched by employee # + name. (On serverless the watcher and the
  // next online check pick this up instead of a background task.)
  if (cameOnline.length && !process.env.VERCEL) {
    (async () => {
      // Clock first: a machine that was offline missed the daily 04:00 sync,
      // and a drifted clock makes valid people look expired at the door.
      await Promise.all(cameOnlineDevs.map(async (d) => {
        try {
          const r = await isapi.setDeviceTime(d);
          logSync(null, d.id, 'time-sync', r.ok, 'clock set after coming online');
        } catch { /* next daily sync catches it */ }
      }));
      try { await replayPendingOps(); } catch { /* retried by the watcher */ }
      try {
        const pendingSyncs = await syncAllPending();
        if (pendingSyncs?.length) console.log(`[online] ${cameOnline.join(', ')} back — pushed ${pendingSyncs.length} pending access grant(s)`);
      } catch (e) { console.error('[online] pending grant sync failed:', e); }
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
    // Per-machine error handling everywhere: one unreachable machine must
    // only skip itself, not abort the sync for the other 49.
    const sets = (await Promise.all(members.map(async (m) => {
      try { return { m, prints: await isapi.readFingerprints(m.dev, employeeNo) }; }
      catch { return null; } /* unreachable this round */
    }))).filter(Boolean);
    const union = new Map();
    try {
      for (const v of await getFpTemplates(employeeNo, members[0].u.name)) union.set(Number(v.finger_no) || 1, v.template);
    } catch { /* vault unavailable — machine reads only */ }
    for (const s of sets) for (const p of s.prints) if (!union.has(p.fingerPrintID)) union.set(p.fingerPrintID, p.fingerData);
    // Anything a machine exported that the vault lacks: vault it now, so the
    // template survives even if every machine holding it dies later.
    for (const s of sets) for (const p of s.prints) {
      if (p.fingerData) saveFpTemplate(employeeNo, members[0].u.name, p.fingerPrintID || 1, p.fingerData).catch(() => {});
    }
    await Promise.all(sets.filter((s) => writable(s.m)).map(async (s) => {
      try {
        if (Number(s.m.u.numOfFP) >= union.size && union.size) return; // already complete
        const have = new Set(s.prints.map((p) => p.fingerPrintID));
        for (const [fid, data] of union) {
          if (have.has(fid)) continue;
          const r = await isapi.addFingerprint(s.m.dev, employeeNo, data, fid);
          const ok = r.ok || /alreadyexist/i.test(String(r.subStatusCode || ''));
          logSync(null, s.m.dev.id, 'sync-fingerprint', ok, { employeeNo, fingerPrintID: fid });
          if (r.ok) copied++;
        }
      } catch { /* this machine only — retried next round */ }
    }));
  } catch { /* partial failure — retried next round */ }

  // Cards: union of card numbers.
  try {
    const sets = (await Promise.all(members.map(async (m) => {
      try { return { m, cards: await isapi.readCards(m.dev, employeeNo) }; }
      catch { return null; } /* unreachable this round */
    }))).filter(Boolean);
    const union = new Set(sets.flatMap((s) => s.cards));
    await Promise.all(sets.filter((s) => writable(s.m)).map(async (s) => {
      try {
        const have = new Set(s.cards);
        for (const c of union) {
          if (have.has(c)) continue;
          const r = await isapi.addCard(s.m.dev, employeeNo, c);
          const ok = r.ok || /alreadyexist|duplicate/i.test(String(r.subStatusCode || ''));
          logSync(null, s.m.dev.id, 'sync-card', ok, { employeeNo, cardNo: c });
          if (r.ok) copied++;
        }
      } catch { /* this machine only — retried next round */ }
    }));
  } catch { /* retried next round */ }

  // Faces: copy the recognition template to machines with no face enrolled.
  try {
    const withFace = members.filter((m) => Number(m.u.numOfFace) > 0);
    const without = members.filter((m) => !Number(m.u.numOfFace) && writable(m));
    if (without.length && (withFace.length || true)) {
      let faces = [];
      if (withFace.length) faces = await isapi.readFaces(withFace[0].dev, employeeNo).catch(() => []);
      if (faces.length) {
        // opportunistically keep the vault current
        saveFaceTemplate(employeeNo, members[0].u.name, faces[0].modelData).catch(() => {});
      } else {
        // no machine can provide it (all lost/offline) — restore from the vault
        const vaulted = await getFaceTemplate(employeeNo, members[0].u.name).catch(() => null);
        if (vaulted) faces = [{ modelData: vaulted }];
      }
      if (faces.length) {
        await Promise.all(without.map(async (m) => {
          try {
            const r = await isapi.addFaceByModel(m.dev, employeeNo, faces[0].modelData);
            // 'deviceUserAlreadyExistFace' = the face is already there — success.
            const ok = r.ok || /alreadyexist/i.test(String(r.subStatusCode || ''));
            logSync(null, m.dev.id, 'sync-face', ok, { employeeNo });
            if (r.ok) copied++;
          } catch { /* this machine only — retried next round */ }
        }));
      }
    }
  } catch { /* retried next round */ }
  return { copied };
}

// Back-fill the face vault: for every person with an enrolled face (per the
// roster snapshots) whose template isn't vaulted yet, export it from one of
// their machines. After one full sweep every face survives a dead machine.
export async function sweepFaceVault() {
  const devs = await getAllDevices();
  const snaps = await getRows('SELECT device_id, roster FROM dbo.WN_HIK_DevCache WITH (NOLOCK) WHERE roster IS NOT NULL');
  const people = new Map();
  for (const s of snaps) {
    let users; try { users = JSON.parse(s.roster); } catch { continue; }
    for (const u of users) {
      if (!Number(u.numOfFace)) continue;
      const key = `${u.employeeNo}||${String(u.name || '').trim().toLowerCase()}`;
      if (!people.has(key)) people.set(key, { emp: String(u.employeeNo), name: String(u.name || '').trim(), devIds: [] });
      people.get(key).devIds.push(s.device_id);
    }
  }
  const have = new Set((await getRows('SELECT employee_no, name FROM dbo.WN_HIK_FaceVault WITH (NOLOCK)'))
    .map((r) => `${r.employee_no}||${String(r.name).trim().toLowerCase()}`));
  let saved = 0;
  for (const p of people.values()) {
    if (have.has(`${p.emp}||${p.name.toLowerCase()}`)) continue;
    for (const id of p.devIds) {
      const dev = devs.find((d) => d.id === id);
      if (!dev?.online) continue;
      try {
        const faces = await isapi.readFaces(dev, p.emp);
        if (faces.length) { await saveFaceTemplate(p.emp, p.name, faces[0].modelData); saved++; break; }
      } catch { /* try their next machine */ }
    }
  }
  if (saved) console.log(`[vault] backed up ${saved} face template(s)`);
  return { saved, withFace: people.size };
}

// Rebuild the WN_HIK_Users backup table from the roster snapshots: one row
// per person with employee #, name, room(s), role and machine access.
export async function syncUsersTable() {
  const devs = await getAllDevices();
  const meta = new Map(devs.map((d) => [d.id, d]));
  const snaps = await getRows('SELECT device_id, roster FROM dbo.WN_HIK_DevCache WITH (NOLOCK) WHERE roster IS NOT NULL');
  if (!snaps.length) return { users: 0 };
  const people = new Map();
  for (const s of snaps) {
    const dev = meta.get(s.device_id);
    if (!dev) continue;
    let users; try { users = JSON.parse(s.roster); } catch { continue; }
    for (const u of users) {
      const key = `${u.employeeNo}||${String(u.name || '').trim().toLowerCase()}`;
      if (!people.has(key)) people.set(key, { emp: String(u.employeeNo), name: String(u.name || '').trim(), admin: false, machines: [], rooms: [] });
      const p = people.get(key);
      if (u.localUIRight) p.admin = true;
      if (!p.machines.includes(dev.name)) p.machines.push(dev.name);
      const isEntr = String(dev.grp || '').trim().toLowerCase().startsWith('entrance');
      if (dev.code && !isEntr && !p.rooms.includes(String(dev.code))) p.rooms.push(String(dev.code));
    }
  }
  await run('DELETE FROM dbo.WN_HIK_Users');
  for (const p of people.values()) {
    await run('INSERT INTO dbo.WN_HIK_Users (employee_no, name, room, role, machines, machine_count) VALUES (?,?,?,?,?,?)',
      [p.emp, p.name, p.rooms.join(',') || null, p.admin ? 'admin' : 'user', JSON.stringify(p.machines), p.machines.length]);
  }
  return { users: people.size };
}

// Copy each online machine's recent door events into the permanent
// WN_HIK_Events archive (deduplicated by the device's own event serial).
export async function archiveEvents() {
  const devices = (await getAllDevices()).filter((d) => d.online);
  let saved = 0;
  await Promise.all(devices.map(async (dev) => {
    try {
      const head = await isapi.searchEvents(dev, 0, 1, { timeout: 2000 });
      if (!head.total) return;
      // The firmware caps event pages at 30 results regardless of maxResults —
      // walk the tail with a strict limit so background jobs don't stall.
      let pos = Math.max(0, head.total - 60);
      const recent = [];
      while (pos < head.total && recent.length < 90) {
        const page = await isapi.searchEvents(dev, pos, 30, { timeout: 2000 });
        if (!page.list.length) break;
        recent.push(...page.list);
        pos += page.list.length;
      }
      const maxRow = await getRow('SELECT MAX(serial_no) AS m FROM dbo.WN_HIK_Events WHERE device_id=?', [dev.id]);
      const lastSerial = Number(maxRow?.m) || 0;
      for (const e of recent) {
        const serial = Number(e.serialNo) || null;
        if (serial && serial <= lastSerial) continue;
        const t = String(e.time || '').slice(0, 19);
        if (!t || t.length < 19) continue;
        try {
          await run(
            'INSERT INTO dbo.WN_HIK_Events (device_id, device_name, employee_no, name, card_no, minor, serial_no, event_time) VALUES (?,?,?,?,?,?,?,?)',
            [dev.id, dev.name, e.employeeNoString ? String(e.employeeNoString) : null, e.name || null,
             e.cardNo ? String(e.cardNo) : null, Number(e.minor) || null, serial, t]
          );
          saved++;
        } catch { /* duplicate serial — already archived */ }
      }
    } catch { /* machine went away mid-run — next cycle */ }
  }));
  if (saved) console.log(`[archive] stored ${saved} new door event(s)`);
  return { saved };
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
      } else if (o.op === 'door-control') {
        const r = await isapi.remoteControlDoor(dev, payload?.cmd || 'open');
        if (!r.ok) throw new Error(isapi.describe(r));
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
      `SELECT COUNT(*) AS n FROM dbo.WN_HIK_AccessGrants WHERE sync_state IN ('pending','error','removing')`
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
    try { await archiveEvents(); } catch (e) { console.error('[scheduler] event archive failed:', e); }
    try { await sweepFaceVault(); } catch (e) { console.error('[scheduler] face vault sweep failed:', e); }
    try { await syncUsersTable(); } catch (e) { console.error('[scheduler] users table sync failed:', e); }
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
