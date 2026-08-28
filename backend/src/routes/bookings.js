// Booking-app integration (reads the booking system's own tables).
//
//   dbo.WN_Bookings — bookings (SpaceId, StartOn/EndOn, CustomerCode, ...)
//   dbo.WN_Spaces   — spaces   (Code = real room number, Capacity, Name, ...)
//
// For each active booking the dashboard prompts to enroll up to `Capacity`
// people (fingerprint/card). Every attendee becomes an auto-deleting visitor
// (booking_ref = 'WNB-<bookingId>') valid StartOn→EndOn on:
//   - every machine in an "Entrance" group, and
//   - the machine whose `code` equals the space's Code (the room's own door).
// The booking tables are treated as READ-ONLY.
import { Router } from 'express';
import { getRow, getRows, run, sp, getAllDevices, getDeviceById, logSync } from '../db.js';
import * as isapi from '../isapi.js';
import { syncEmployee } from '../sync.js';
import { getRoster } from '../machineCache.js';

export const bookingsRouter = Router();

const REF = (id) => `WNB-${id}`;

// WN_SpaceTypes may or may not exist — probe once, then cache.
let _hasSpaceTypes = null;
async function bookingsQuery(whereExtra = '', params = []) {
  if (_hasSpaceTypes === null) {
    const t = await getRow(`SELECT COUNT(*) AS n FROM sys.tables WHERE name = 'WN_SpaceTypes'`);
    _hasSpaceTypes = Number(t?.n) > 0;
  }
  const typeJoin = _hasSpaceTypes
    ? 'LEFT JOIN dbo.WN_SpaceTypes st WITH (NOLOCK) ON st.Id = s.SpaceTypeId'
    : '';
  const typeCol = _hasSpaceTypes ? 'st.Name AS spaceType,' : 'NULL AS spaceType,';
  return getRows(
    `SELECT TOP 200
        b.Id, b.ChallanNumber, b.CustomerCode, b.StartOn, b.EndOn,
        b.BookingStatusId, b.BookingDate,
        s.Id AS spaceId, s.Code AS spaceCode, s.Name AS spaceName,
        s.Capacity AS capacity, ${typeCol} s.SpaceTypeId
     FROM dbo.WN_Bookings b WITH (NOLOCK)
     JOIN dbo.WN_Spaces s WITH (NOLOCK) ON s.Id = b.SpaceId
     ${typeJoin}
     WHERE b.IsDeleted = 0 ${whereExtra}
     ORDER BY b.StartOn DESC`,
    params
  );
}

// Machines a booking's attendees should be enrolled on.
async function bookingMachines(spaceCode) {
  const devs = await getAllDevices();
  const entrances = devs.filter((d) => String(d.grp || '').trim().toLowerCase().startsWith('entrance'));
  const room = devs.find((d) => String(d.code || '').trim() !== '' && String(d.code).trim() === String(spaceCode).trim()) || null;
  const targets = [...entrances];
  if (room && !targets.some((d) => d.id === room.id)) targets.push(room);
  return { targets, entrances, room };
}

// Booking renewals: extending a room creates a NEW row in WN_Bookings with a
// new Id but the same CustomerCode + SpaceId. That is treated as the SAME
// booking continuing — the old booking's attendees are re-linked to the new
// booking id and their Valid Period on the machines is extended to the new
// EndOn, so fingerprints/cards keep working with no re-enrollment and no gap.
// Runs before the expiry pass so a renewal always wins over auto-delete.
export async function migrateRenewedBookings() {
  const refs = await getRows(
    `SELECT DISTINCT booking_ref FROM dbo.WN_HIK_Employees WHERE booking_ref LIKE 'WNB-%'`
  );
  let migrated = 0;
  for (const { booking_ref } of refs) {
    const oldId = Number(String(booking_ref).slice(4));
    if (!oldId) continue;
    const oldB = await getRow(
      `SELECT b.Id, b.CustomerCode, b.SpaceId, b.EndOn
       FROM dbo.WN_Bookings b WITH (NOLOCK) WHERE b.Id = ?`,
      [oldId]
    );
    if (!oldB) continue;
    // Successor = the earliest newer booking for the same customer + space
    // that ends after this one (and hasn't ended already).
    const next = await getRow(
      `SELECT TOP 1 b.Id, b.StartOn, b.EndOn
       FROM dbo.WN_Bookings b WITH (NOLOCK)
       WHERE b.IsDeleted = 0 AND b.Id <> ? AND b.CustomerCode = ? AND b.SpaceId = ?
         AND b.EndOn > ? AND b.EndOn > SYSDATETIME()
       ORDER BY b.StartOn ASC`,
      [oldB.Id, oldB.CustomerCode, oldB.SpaceId, oldB.EndOn]
    );
    if (!next) continue;
    const clash = await getRow(
      `SELECT 1 AS x FROM dbo.WN_HIK_Employees WHERE booking_ref = ?`,
      [REF(next.Id)]
    );
    if (clash) continue; // the new booking already has its own attendees
    const attendees = await getRows(
      `SELECT id FROM dbo.WN_HIK_Employees WHERE booking_ref = ?`,
      [booking_ref]
    );
    if (!attendees.length) continue;
    // valid_begin stays as-is so access is continuous through the changeover.
    await run(
      `UPDATE dbo.WN_HIK_Employees SET booking_ref = ?, valid_end = ?, status = 'active' WHERE booking_ref = ?`,
      [REF(next.Id), next.EndOn, booking_ref]
    );
    for (const a of attendees) {
      await run(
        `UPDATE dbo.WN_HIK_AccessGrants SET sync_state='pending' WHERE employee_id=? AND sync_state IN ('synced','error')`,
        [a.id]
      );
      try { await syncEmployee(a.id); } catch { /* machine unreachable — the watcher retries */ }
    }
    migrated += attendees.length;
    logSync(null, null, 'booking-renew', true, {
      from: booking_ref, to: REF(next.Id), attendees: attendees.length, newEnd: next.EndOn,
    });
  }
  return { migrated };
}

async function attendeesOf(bookingId) {
  return getRows(
    `SELECT * FROM dbo.WN_HIK_Employees WHERE booking_ref = ? ORDER BY id`,
    [REF(bookingId)]
  );
}

// List current + upcoming bookings with enrollment progress.
// ?summary=1 returns just the "needs enrollment" counters for the dashboard.
bookingsRouter.get('/', async (req, res) => {
  try {
    // Reconcile renewals in the background — the carried-over counts show on
    // the next refresh; don't make the page wait on machine calls.
    migrateRenewedBookings().catch(() => {});
    const bookings = await bookingsQuery('AND b.EndOn >= SYSDATETIME()');
    const counts = new Map();
    const enrolled = await getRows(
      `SELECT booking_ref, COUNT(*) AS n FROM dbo.WN_HIK_Employees
       WHERE booking_ref LIKE 'WNB-%' GROUP BY booking_ref`
    );
    for (const r of enrolled) counts.set(r.booking_ref, Number(r.n));
    const devs = await getAllDevices();
    const codes = new Set(devs.map((d) => String(d.code || '').trim()).filter(Boolean));
    const items = bookings.map((b) => ({
      id: b.Id,
      ref: REF(b.Id),
      challan: b.ChallanNumber,
      customer: b.CustomerCode,
      start: b.StartOn,
      end: b.EndOn,
      spaceId: b.spaceId,
      spaceCode: b.spaceCode,
      spaceName: b.spaceName,
      spaceType: b.spaceType,
      capacity: Number(b.capacity) || 0,
      enrolled: counts.get(REF(b.Id)) || 0,
      roomMachine: codes.has(String(b.spaceCode).trim()),
    }));
    if (req.query.summary) {
      const needing = items.filter((x) => x.enrolled < x.capacity);
      return res.json({
        ok: true,
        total: items.length,
        needingEnrollment: needing.length,
        unenrolled: items.filter((x) => x.enrolled === 0).length,
      });
    }
    res.json({ ok: true, items });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// One booking with its attendees (live fingerprint counts included).
bookingsRouter.get('/:id', async (req, res) => {
  try {
    const rows = await bookingsQuery('AND b.Id = ?', [Number(req.params.id)]);
    const b = rows[0];
    if (!b) return res.status(404).json({ ok: false, error: 'booking not found' });
    const { targets, room } = await bookingMachines(b.spaceCode);
    const list = await attendeesOf(b.Id);
    const attendees = [];
    for (const a of list) {
      let fingerprints = null;
      let cards = 0;
      if (targets.length) {
        try {
          const p = await isapi.getPerson(targets[0], a.employee_no);
          fingerprints = Number(p?.numOfFP) || 0;
          cards = Number(p?.numOfCard) || 0;
        } catch { /* machine unreachable */ }
      }
      attendees.push({
        id: a.id,
        employeeNo: a.employee_no,
        name: a.name,
        card_no: a.card_no,
        fingerprints,
        cards,
      });
    }
    res.json({
      ok: true,
      booking: {
        id: b.Id, ref: REF(b.Id), challan: b.ChallanNumber, customer: b.CustomerCode,
        start: b.StartOn, end: b.EndOn,
        spaceCode: b.spaceCode, spaceName: b.spaceName, spaceType: b.spaceType,
        capacity: Number(b.capacity) || 0,
      },
      machines: targets.map((d) => ({ id: d.id, name: d.name })),
      roomMachine: room ? { id: room.id, name: room.name } : null,
      attendees,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Enroll one person against a booking (capacity enforced). They get access to
// the Entrance group + the room's machine, valid for the booking window, and
// are auto-deleted from the machines after it ends.
// body: { name, card_no? }
bookingsRouter.post('/:id/attendees', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ ok: false, error: 'name required' });
  try {
    const rows = await bookingsQuery('AND b.Id = ?', [Number(req.params.id)]);
    const b = rows[0];
    if (!b) return res.status(404).json({ ok: false, error: 'booking not found' });
    if (String(b.EndOn) < new Date().toISOString().slice(0, 19)) {
      return res.status(400).json({ ok: false, error: 'booking has already ended' });
    }
    const existing = await attendeesOf(b.Id);
    const capacity = Number(b.capacity) || 0;
    if (capacity && existing.length >= capacity) {
      return res.status(409).json({ ok: false, error: `Capacity reached — this space allows ${capacity} people` });
    }
    const { targets, room } = await bookingMachines(b.spaceCode);
    if (!targets.length) {
      return res.status(400).json({ ok: false, error: 'No machines to enroll on — set an Entrance group or a machine room code first' });
    }

    // Free number in the 9000+ range across the target machines and the DB.
    let maxNo = 8999;
    const rosters = await Promise.all(targets.map((dev) => getRoster(dev).catch(() => [])));
    for (const users of rosters) for (const u of users) maxNo = Math.max(maxNo, Number(u.employeeNo) || 0);
    const dbMax = await getRow('SELECT MAX(TRY_CAST(employee_no AS INT)) AS m FROM dbo.WN_HIK_Employees');
    const employeeNo = String(Math.max(maxNo, Number(dbMax?.m) || 0) + 1);

    const created = await sp('WN_HIK_Visitor_Create', {
      employee_no: employeeNo,
      name,
      card_no: req.body?.card_no ? String(req.body.card_no).trim() : null,
      valid_begin: b.StartOn,
      valid_end: b.EndOn,
      booking_ref: REF(b.Id),
    });
    const empId = Number(created[0]?.id);
    for (const dev of targets) {
      await sp('WN_HIK_Grant_Ensure', { employee_id: empId, device_id: dev.id });
    }
    const results = await syncEmployee(empId);
    logSync(empId, null, 'booking-enroll', true, { ref: REF(b.Id), name, employeeNo, machines: targets.length });
    res.json({
      ok: true,
      employeeNo,
      name,
      machines: results,
      roomMachine: room ? room.name : null,
      enrolled: existing.length + 1,
      capacity,
    });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Remove one attendee from a booking (deleted from every machine immediately).
bookingsRouter.delete('/:id/attendees/:employeeNo', async (req, res) => {
  try {
    const row = await getRow(
      'SELECT * FROM dbo.WN_HIK_Employees WHERE booking_ref=? AND employee_no=?',
      [REF(Number(req.params.id)), String(req.params.employeeNo)]
    );
    if (!row) return res.status(404).json({ ok: false, error: 'attendee not found in this booking' });
    await sp('WN_HIK_Grant_MarkRemoving', { employee_id: row.id });
    let machines = [];
    try {
      machines = await syncEmployee(row.id); // deletes person + fingerprints from each machine
    } catch (e) {
      return res.status(502).json({ ok: false, error: String(e.message || e) });
    }
    await run('DELETE FROM dbo.WN_HIK_Employees WHERE id=?', [row.id]);
    logSync(null, null, 'booking-unenroll', true, { ref: REF(req.params.id), employeeNo: row.employee_no });
    res.json({ ok: true, machines });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

export default bookingsRouter;
