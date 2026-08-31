import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, getRow, run, sp, getAllDevices, getDeviceById, seedDevices, logSync } from './db.js';
import * as isapi from './isapi.js';
import { devicesRouter } from './routes/devices.js';
import { cardsRouter } from './routes/cards.js';
import { bookingsRouter } from './routes/bookings.js';
import { extRouter, ensureApiKey } from './routes/ext.js';
import { authRouter, requireAuth } from './auth.js';
import { syncAllPending, syncEmployee } from './sync.js';
import { getRoster } from './machineCache.js';
import { startScheduler, runExpiryPass, runCredentialSync, runOnlineCheck } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// On serverless (Vercel) there is no startup phase — make sure the DB pool
// exists before any request is handled. initDb() caches, so this is a no-op
// after the first call.
app.use(async (req, res, next) => {
  try {
    await initDb();
    next();
  } catch (e) {
    res.status(500).json({ error: 'database unavailable: ' + String(e.message || e) });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/ext', extRouter); // external booking-system API (X-API-Key)

// Vercel Cron backstop (no session): checks all machines once a day even if
// nobody opens the dashboard and the on-site server is down. Protected by
// CRON_SECRET when set (Vercel sends it as a Bearer token).
app.get('/api/cron/online-check', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.get('authorization') !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    res.json({ ok: true, ...(await runOnlineCheck()) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});
app.use('/api', requireAuth);   // everything else needs a logged-in session
app.use('/api/devices', devicesRouter);
app.use('/api/cards', cardsRouter);
app.use('/api/bookings-feed', bookingsRouter);

// Push everything pending across all employees/devices.
app.post('/api/sync', async (req, res) => {
  try {
    const summary = await syncAllPending();
    // Also reconcile credentials (fingerprints/cards/faces) across machines now.
    const credentials = await runCredentialSync();
    res.json({ ok: true, summary, credentials });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Force an expiry check now.
app.post('/api/expiry-check', async (req, res) => {
  res.json(await runExpiryPass());
});

// Live machine reachability check, fired by the dashboard whenever someone is
// viewing it — this is what keeps online status fresh on Vercel, where no
// background scheduler runs. Throttled to once per minute across all viewers.
app.post('/api/online-check', async (req, res) => {
  try {
    const last = await sp('WN_HIK_Settings_Get', { key: 'online_check_at' });
    const now = Date.now();
    if (Number(last[0]?.value) > now - 60000) {
      return res.json({ ok: true, skipped: true, changed: 0 });
    }
    await sp('WN_HIK_Settings_Set', { key: 'online_check_at', value: String(now) });
    res.json({ ok: true, ...(await runOnlineCheck()) });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Recent activity log.
app.get('/api/logs', async (req, res) => {
  try {
    res.json(await sp('WN_HIK_Activity_Recent', { limit: 200 }));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Live entry log pulled from every machine's own event memory (who entered,
// door open/close, denied attempts). Newest first.
app.get('/api/events', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 60, 200);
  const devices = await getAllDevices();
  const events = [];
  const unreachable = [];
  await Promise.all(devices.map(async (dev) => {
    try {
      const head = await isapi.searchEvents(dev, 0, 1);
      if (!head.total) return;
      const pos = Math.max(0, head.total - limit);
      const page = await isapi.searchEvents(dev, pos, limit);
      for (const e of page.list) events.push({ device: dev.name, device_id: dev.id, ...e });
    } catch {
      unreachable.push(dev.name);
    }
  }));
  events.sort((a, b) => String(b.time).localeCompare(String(a.time)));
  res.json({ ok: true, events: events.slice(0, limit), unreachable });
});

// One-click day pass: a visitor valid until tonight (or a chosen time), pushed
// to the selected machines immediately, and AUTO-DELETED from them after
// expiry by the scheduler. Visitor numbers live in their own 9000+ range.
app.post('/api/visitors', async (req, res) => {
  const { name, card_no, valid_end } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name required' });
  const ids = [...new Set((req.body?.device_ids || []).map(Number))].filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: 'pick at least one machine' });
  const devices = (await Promise.all(ids.map((id) => getDeviceById(id)))).filter(Boolean);
  if (!devices.length) return res.status(404).json({ error: 'no such machines' });
  try {
    // Pick a number free on the target machines AND in the dashboard DB.
    let maxNo = 8999;
    const rosters = await Promise.all(devices.map((dev) => getRoster(dev).catch(() => [])));
    for (const users of rosters) for (const u of users) maxNo = Math.max(maxNo, Number(u.employeeNo) || 0);
    const dbMax = await getRow(
      'SELECT MAX(TRY_CAST(employee_no AS INT)) AS m FROM dbo.WN_HIK_Employees'
    );
    const employeeNo = String(Math.max(maxNo, Number(dbMax?.m) || 0) + 1);

    const p = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const beginStr = req.body.valid_begin || `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T00:00:00`;
    const endStr = valid_end || `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T23:59:59`;

    const created = await sp('WN_HIK_Visitor_Create', {
      employee_no: employeeNo,
      name: String(name).trim(),
      card_no: card_no ? String(card_no).trim() : null,
      valid_begin: beginStr,
      valid_end: endStr,
      booking_ref: null,
    });
    const empId = Number(created[0]?.id);
    for (const dev of devices) {
      await sp('WN_HIK_Grant_Ensure', { employee_id: empId, device_id: dev.id });
    }
    const results = await syncEmployee(empId); // pushes person + card to each machine now
    const bad = results.filter((x) => x.state === 'error');
    res.json({ ok: !bad.length, employeeNo, valid_end: endStr, results });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Book a time slot on one machine (e.g. a meeting room) for an EXISTING user:
// the person's Valid Period on that machine becomes exactly the slot, so the
// door only opens between begin and end. If the user isn't on that machine yet
// they're enrolled with their credentials copied from wherever they exist.
app.post('/api/bookings', async (req, res) => {
  const { employeeNo, name, begin, end } = req.body || {};
  const dev = await getDeviceById(Number(req.body?.device_id));
  if (!dev) return res.status(404).json({ error: 'machine not found' });
  if (!employeeNo || !begin || !end) return res.status(400).json({ error: 'employeeNo, begin and end required' });
  if (String(end) <= String(begin)) return res.status(400).json({ error: 'slot end must be after slot start' });
  try {
    // Find the person on any machine to copy identity/credentials from.
    const devices = await getAllDevices();
    let src = null;
    let person = null;
    for (const d of devices) {
      try {
        const p = await isapi.getPerson(d, String(employeeNo));
        if (p && (!name || String(p.name || '').trim().toLowerCase() === String(name).trim().toLowerCase())) {
          src = d; person = p; break;
        }
      } catch { /* unreachable — try next */ }
    }
    if (!person) return res.status(404).json({ error: 'user not found on any machine' });

    const record = {
      employeeNo: String(employeeNo),
      name: person.name || `User ${employeeNo}`,
      admin: !!person.localUIRight,
      enabled: true,
      validBegin: begin,
      validEnd: end,
    };
    const existing = await isapi.getPerson(dev, String(employeeNo)).catch(() => null);
    const r = await isapi.upsertPerson(dev, record, existing ? 'modify' : 'add');
    if (!r.ok) return res.status(502).json({ ok: false, error: isapi.describe(r) });

    const copied = { cards: 0, fingerprints: 0, faces: 0 };
    if (!existing && src && src.id !== dev.id) {
      const cards = await isapi.readCards(src, String(employeeNo));
      for (const c of cards) { const cr = await isapi.addCard(dev, String(employeeNo), c); if (cr.ok) copied.cards++; }
      const prints = await isapi.readFingerprints(src, String(employeeNo));
      for (const fp of prints) { const pr = await isapi.addFingerprint(dev, String(employeeNo), fp.fingerData, fp.fingerPrintID); if (pr.ok) copied.fingerprints++; }
      const faces = await isapi.readFaces(src, String(employeeNo));
      if (faces.length) { const fr = await isapi.addFaceByModel(dev, String(employeeNo), faces[0].modelData); if (fr.ok) copied.faces++; }
    }
    logSync(null, dev.id, 'booking', true, { employeeNo, name: record.name, begin, end });
    res.json({ ok: true, employeeNo: String(employeeNo), name: record.name, begin, end, copied });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Full profile of one person: per machine — presence, blocked state, validity
// window, role, fingerprint/face counts and the actual card numbers.
app.get('/api/profile', async (req, res) => {
  const employeeNo = String(req.query.employeeNo || '');
  const name = String(req.query.name || '');
  if (!employeeNo) return res.status(400).json({ error: 'employeeNo required' });
  const devices = await getAllDevices();
  const machines = [];
  await Promise.all(devices.map(async (dev) => {
    try {
      const p = await isapi.getPerson(dev, employeeNo);
      const match = p && (!name || String(p.name || '').trim().toLowerCase() === name.trim().toLowerCase());
      if (!match) { machines.push({ device_id: dev.id, device: dev.name, host: dev.host, present: false }); return; }
      let cards = [];
      try { cards = await isapi.readCards(dev, employeeNo); } catch { /* leave empty */ }
      machines.push({
        device_id: dev.id,
        device: dev.name,
        host: dev.host,
        present: true,
        enabled: p.Valid?.enable !== false,
        validBegin: p.Valid?.beginTime || null,
        validEnd: p.Valid?.endTime || null,
        admin: !!p.localUIRight,
        numOfFP: Number(p.numOfFP) || 0,
        numOfFace: Number(p.numOfFace) || 0,
        cards,
        name: p.name,
      });
    } catch {
      machines.push({ device_id: dev.id, device: dev.name, host: dev.host, present: null }); // unreachable
    }
  }));
  machines.sort((a, b) => a.device_id - b.device_id);
  res.json({ ok: true, employeeNo, machines });
});

// Memberships expiring within N days (default 7) plus already-expired ones,
// computed live from the machines' rosters. People are matched across machines
// by employee # + name; far-future "no expiry" dates never show up.
app.get('/api/expiring', async (req, res) => {
  const horizonDays = Math.min(Number(req.query.days) || 7, 60);
  const devices = await getAllDevices();
  const groups = new Map();
  const unreachable = [];
  await Promise.all(devices.map(async (dev) => {
    try {
      const users = await getRoster(dev);
      for (const u of users) {
        const key = `${u.employeeNo}||${String(u.name || '').trim().toLowerCase()}`;
        if (!groups.has(key)) groups.set(key, { employeeNo: String(u.employeeNo), name: u.name || '', on: [] });
        groups.get(key).on.push({ device_id: dev.id, device: dev.name, validEnd: u.Valid?.endTime || null });
      }
    } catch {
      unreachable.push(dev.name);
    }
  }));
  const now = new Date();
  const horizon = new Date(now.getTime() + horizonDays * 86400000);
  const items = [];
  for (const g of groups.values()) {
    let minRaw = null;
    let minDate = null;
    for (const x of g.on) {
      if (!x.validEnd) continue;
      const d = new Date(x.validEnd);
      if (Number.isNaN(d.getTime())) continue;
      if (!minDate || d < minDate) { minDate = d; minRaw = x.validEnd; }
    }
    if (!minDate || minDate > horizon) continue;
    items.push({ ...g, minEnd: minRaw, status: minDate < now ? 'expired' : 'expiring' });
  }
  items.sort((a, b) => String(a.minEnd).localeCompare(String(b.minEnd)));
  res.json({ ok: true, items, unreachable, horizonDays });
});

// Extend a person's access by N days (default 30) on every machine they exist
// on. Extends from the current deadline if it's still in the future, otherwise
// from now. Dashboard-side records (visitors/cards) are kept in step so
// auto-delete doesn't fire at the old time.
app.post('/api/expiring/extend', async (req, res) => {
  const { employeeNo, name } = req.body || {};
  const days = Math.min(Number(req.body?.days) || 30, 365);
  if (!employeeNo) return res.status(400).json({ error: 'employeeNo required' });
  const devices = await getAllDevices();
  const p = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  const results = [];
  let newEnd = null;
  for (const dev of devices) {
    try {
      const u = await isapi.getPerson(dev, String(employeeNo));
      if (!u) continue;
      if (name && String(u.name || '').trim().toLowerCase() !== String(name).trim().toLowerCase()) continue;
      const cur = u.Valid?.endTime ? new Date(u.Valid.endTime) : new Date();
      const base = !Number.isNaN(cur.getTime()) && cur > new Date() ? cur : new Date();
      newEnd = fmt(new Date(base.getTime() + days * 86400000));
      const r = await isapi.upsertPerson(dev, {
        employeeNo: String(employeeNo),
        name: u.name || `User ${employeeNo}`,
        admin: !!u.localUIRight,
        enabled: u.Valid?.enable !== false,
        validBegin: u.Valid?.beginTime || '2020-01-01T00:00:00',
        validEnd: newEnd,
      }, 'modify');
      logSync(null, dev.id, 'extend', r.ok, { employeeNo, days, validEnd: newEnd });
      results.push({ device: dev.name, ok: r.ok, error: r.ok ? undefined : isapi.describe(r) });
    } catch (e) {
      results.push({ device: dev.name, ok: false, error: String(e.message || e) });
    }
  }
  if (!results.length) return res.status(404).json({ ok: false, error: 'user not found on any machine' });
  if (newEnd) {
    await sp('WN_HIK_Access_Extend', { employee_no: String(employeeNo), valid_end: newEnd, valid_begin: null });
  }
  const okCount = results.filter((x) => x.ok).length;
  res.status(okCount ? 200 : 502).json({ ok: okCount > 0, newEnd, results });
});

// Dashboard summary counters.
app.get('/api/stats', async (req, res) => {
  try {
    const rows = await sp('WN_HIK_Stats_Get');
    res.json(rows[0] || {});
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 3000;
const isServerless = !!process.env.VERCEL;

// On Vercel the app is exported as a serverless function: no listen(), no
// background schedulers (and no LAN access to the machines — a copy running
// inside the co-working network remains the device agent).
if (!isServerless) {
  (async () => {
    try {
      await initDb();
      await seedDevices();
      const key = await ensureApiKey();
      app.listen(PORT, () => {
        console.log(`\n  WorkNest Access Control → http://localhost:${PORT}`);
        console.log(`  Database: SQL Server ${process.env.DB_SERVER}:${process.env.DB_PORT || 1433} / ${process.env.DB_NAME}`);
        console.log(`  Booking API key (X-API-Key): ${key}\n`);
        startScheduler();
      });
    } catch (e) {
      console.error('FATAL: could not connect to SQL Server —', e.message);
      process.exit(1);
    }
  })();
}

export default app;
