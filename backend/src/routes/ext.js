// External integration API for booking systems.
//
// Every endpoint requires the API key (X-API-Key header or ?api_key=...).
// The key is generated once at first startup, stored in WN_HIK_Settings,
// and printed to the server console.
//
// Model: each booking attendee becomes an auto-deleting visitor record
// (kind='visitor', auto_delete=1) tied to the booking via booking_ref. The
// machines themselves block entry outside the slot, and the scheduler deletes
// the attendees from the machines within ~5 minutes after the booking ends.
import { Router } from 'express';
import crypto from 'node:crypto';
import { getRow, getRows, run, sp, getAllDevices, getDeviceById, logSync } from '../db.js';
import * as isapi from '../isapi.js';
import { syncEmployee } from '../sync.js';

export const extRouter = Router();

let _apiKey = null;
export async function ensureApiKey() {
  if (_apiKey) return _apiKey;
  const rows = await sp('WN_HIK_Settings_Get', { key: 'api_key' });
  if (rows[0]?.value) {
    _apiKey = rows[0].value;
  } else {
    _apiKey = crypto.randomBytes(24).toString('hex');
    await sp('WN_HIK_Settings_Set', { key: 'api_key', value: _apiKey });
  }
  return _apiKey;
}

extRouter.use(async (req, res, next) => {
  const key = req.get('x-api-key') || req.query.api_key;
  const expected = await ensureApiKey().catch(() => null);
  if (!key || !expected || key !== expected) return res.status(401).json({ error: 'invalid or missing API key' });
  next();
});

// Machines list (no credentials) so the booking app can pick device ids.
extRouter.get('/machines', async (req, res) => {
  const devices = await getAllDevices();
  res.json({
    ok: true,
    machines: devices.map(({ id, name, host, location, grp, online }) => ({ id, name, host, location, grp, online })),
  });
});

// Create a booking: one auto-deleting person per attendee, valid begin→end on
// the given machines. Returns each attendee's employeeNo (needed for the
// fingerprint step). Fails if the ref already exists.
// body: { ref, begin, end, device_ids: [..], attendees: [{ name, card_no? }, ..] }
extRouter.post('/bookings', async (req, res) => {
  const { ref, begin, end } = req.body || {};
  const attendees = Array.isArray(req.body?.attendees) ? req.body.attendees.filter((a) => a && a.name) : [];
  const ids = [...new Set((req.body?.device_ids || []).map(Number))].filter(Boolean);
  if (!ref || !begin || !end) return res.status(400).json({ error: 'ref, begin and end required (YYYY-MM-DDTHH:mm:ss)' });
  if (String(end) <= String(begin)) return res.status(400).json({ error: 'end must be after begin' });
  if (!attendees.length) return res.status(400).json({ error: 'at least one attendee with a name required' });
  if (!ids.length) return res.status(400).json({ error: 'device_ids required' });
  const devices = (await Promise.all(ids.map((id) => getDeviceById(id)))).filter(Boolean);
  if (!devices.length) return res.status(404).json({ error: 'no such machines' });
  const exists = await getRow('SELECT 1 AS x FROM dbo.WN_HIK_Employees WHERE booking_ref=?', [String(ref)]);
  if (exists) {
    return res.status(409).json({ error: `booking ref "${ref}" already exists — cancel it or use a new ref` });
  }
  try {
    // Attendee numbers: 9000+ range, free on the machines and in the DB.
    let maxNo = 8999;
    for (const dev of devices) {
      const users = [];
      let pos = 0;
      for (let i = 0; i < 200; i++) {
        const page = await isapi.searchPersons(dev, pos, 30);
        users.push(...page.list);
        if (!page.list.length || users.length >= page.total) break;
        pos += page.list.length;
      }
      for (const u of users) maxNo = Math.max(maxNo, Number(u.employeeNo) || 0);
    }
    const dbMax = await getRow('SELECT MAX(TRY_CAST(employee_no AS INT)) AS m FROM dbo.WN_HIK_Employees');
    maxNo = Math.max(maxNo, Number(dbMax?.m) || 0);

    const created = [];
    for (const a of attendees) {
      const employeeNo = String(++maxNo);
      const rows = await sp('WN_HIK_Visitor_Create', {
        employee_no: employeeNo,
        name: String(a.name).trim(),
        card_no: a.card_no ? String(a.card_no).trim() : null,
        valid_begin: begin,
        valid_end: end,
        booking_ref: String(ref),
      });
      const empId = Number(rows[0]?.id);
      for (const dev of devices) {
        await sp('WN_HIK_Grant_Ensure', { employee_id: empId, device_id: dev.id });
      }
      const results = await syncEmployee(empId); // pushes person + card now
      created.push({
        employeeNo,
        name: String(a.name).trim(),
        machines: results.map((x) => ({ device: x.device, state: x.state, error: x.error })),
      });
    }
    logSync(null, null, 'booking', true, { ref: String(ref), begin, end, attendees: created.length });
    res.json({ ok: true, ref: String(ref), begin, end, attendees: created });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Booking status: attendees, their machines, live fingerprint count.
extRouter.get('/bookings/:ref', async (req, res) => {
  const rows = await getRows('SELECT * FROM dbo.WN_HIK_Employees WHERE booking_ref=?', [String(req.params.ref)]);
  if (!rows.length) return res.status(404).json({ error: 'booking not found' });
  const attendees = [];
  for (const r of rows) {
    const grants = await getRows(
      `SELECT g.device_id, g.sync_state, d.name AS device
       FROM dbo.WN_HIK_AccessGrants g JOIN dbo.WN_HIK_Devices d ON d.id = g.device_id
       WHERE g.employee_id=?`,
      [r.id]
    );
    let fingerprints = null;
    if (grants.length) {
      const first = await getDeviceById(grants[0].device_id);
      try { fingerprints = Number((await isapi.getPerson(first, r.employee_no))?.numOfFP) || 0; } catch { /* unreachable */ }
    }
    attendees.push({
      employeeNo: r.employee_no,
      name: r.name,
      card_no: r.card_no,
      valid_begin: r.valid_begin,
      valid_end: r.valid_end,
      status: r.status,
      fingerprints,
      machines: grants,
    });
  }
  res.json({ ok: true, ref: String(req.params.ref), attendees });
});

// Register a fingerprint for one attendee: the chosen machine prompts for the
// finger, and the template is stored on EVERY machine of the booking.
// body: { device_id, fingerNo? }
extRouter.post('/bookings/:ref/attendees/:employeeNo/capture-fingerprint', async (req, res) => {
  const row = await getRow(
    'SELECT * FROM dbo.WN_HIK_Employees WHERE booking_ref=? AND employee_no=?',
    [String(req.params.ref), String(req.params.employeeNo)]
  );
  if (!row) return res.status(404).json({ error: 'attendee not found in this booking' });
  const dev = await getDeviceById(Number(req.body?.device_id));
  if (!dev) return res.status(400).json({ error: 'device_id required — the machine that prompts for the finger' });
  const fingerNo = Number(req.body?.fingerNo) || 1;
  try {
    const cap = await isapi.captureFingerprint(dev, fingerNo);
    logSync(null, dev.id, 'capture-fingerprint', cap.ok, { employeeNo: row.employee_no, booking: req.params.ref });
    if (!cap.ok) return res.status(502).json({ ok: false, error: isapi.describe(cap) || 'No finger detected — try again.' });
    const grants = await getRows('SELECT device_id FROM dbo.WN_HIK_AccessGrants WHERE employee_id=?', [row.id]);
    const results = [];
    for (const g of grants) {
      const d = await getDeviceById(g.device_id);
      if (!d) continue;
      const r = await isapi.addFingerprint(d, row.employee_no, cap.fingerData, fingerNo);
      logSync(null, d.id, 'store-fingerprint', r.ok, { employeeNo: row.employee_no });
      results.push({ device: d.name, ok: r.ok, error: r.ok ? undefined : isapi.describe(r) });
    }
    res.json({ ok: results.some((x) => x.ok), fingerNo, quality: cap.quality, results });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Reschedule / extend a booking: new begin/end applied to every attendee on
// every machine (and to the auto-delete timer).
extRouter.patch('/bookings/:ref', async (req, res) => {
  const rows = await getRows('SELECT * FROM dbo.WN_HIK_Employees WHERE booking_ref=?', [String(req.params.ref)]);
  if (!rows.length) return res.status(404).json({ error: 'booking not found' });
  const begin = req.body?.begin || null;
  const end = req.body?.end || null;
  if (!begin && !end) return res.status(400).json({ error: 'begin or end required' });
  const results = [];
  for (const row of rows) {
    const nb = begin || row.valid_begin;
    const ne = end || row.valid_end;
    await run(
      `UPDATE dbo.WN_HIK_Employees SET valid_begin=?, valid_end=?, status='active' WHERE id=?`,
      [nb, ne, row.id]
    );
    const grants = await getRows('SELECT device_id FROM dbo.WN_HIK_AccessGrants WHERE employee_id=?', [row.id]);
    for (const g of grants) {
      const d = await getDeviceById(g.device_id);
      if (!d) continue;
      try {
        const p = await isapi.getPerson(d, row.employee_no);
        if (!p) { results.push({ employeeNo: row.employee_no, device: d.name, ok: false, error: 'not on machine' }); continue; }
        const r = await isapi.upsertPerson(d, {
          employeeNo: row.employee_no,
          name: p.name || row.name,
          admin: !!p.localUIRight,
          enabled: p.Valid?.enable !== false,
          validBegin: nb,
          validEnd: ne,
        }, 'modify');
        results.push({ employeeNo: row.employee_no, device: d.name, ok: r.ok, error: r.ok ? undefined : isapi.describe(r) });
      } catch (e) {
        results.push({ employeeNo: row.employee_no, device: d.name, ok: false, error: String(e.message || e) });
      }
    }
  }
  logSync(null, null, 'booking-update', true, { ref: String(req.params.ref), begin, end });
  res.json({ ok: results.every((x) => x.ok), results });
});

// Cancel a booking now: attendees (and their fingerprints/cards) are deleted
// from every machine immediately, then removed from the dashboard.
extRouter.delete('/bookings/:ref', async (req, res) => {
  const rows = await getRows('SELECT * FROM dbo.WN_HIK_Employees WHERE booking_ref=?', [String(req.params.ref)]);
  if (!rows.length) return res.status(404).json({ error: 'booking not found' });
  const results = [];
  for (const row of rows) {
    await sp('WN_HIK_Grant_MarkRemoving', { employee_id: row.id });
    try {
      const r = await syncEmployee(row.id); // deletes person (incl. fingerprints) from each machine
      results.push({ employeeNo: row.employee_no, machines: r });
    } catch (e) {
      results.push({ employeeNo: row.employee_no, error: String(e.message || e) });
    }
  }
  await sp('WN_HIK_Booking_Delete', { ref: String(req.params.ref) });
  logSync(null, null, 'booking-cancel', true, { ref: String(req.params.ref), attendees: rows.length });
  res.json({ ok: true, results });
});

export default extRouter;
