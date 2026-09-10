import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, getRow, getRows, run, sp, getAllDevices, getDeviceById, seedDevices, logSync, setLogSyncSubscriber } from './db.js';
import * as isapi from './isapi.js';
import { devicesRouter } from './routes/devices.js';
import { cardsRouter } from './routes/cards.js';
import { bookingsRouter } from './routes/bookings.js';
import { extRouter, ensureApiKey } from './routes/ext.js';
import { authRouter, requireAuth } from './auth.js';
import { syncAllPending, syncEmployee } from './sync.js';
import { getRoster, getCardTable, invalidateRoster } from './machineCache.js';
import { startScheduler, runExpiryPass, runCredentialSync, runOnlineCheck, syncCredentialGroup, replayPendingOps, archiveEvents, sweepFaceVault, syncUsersTable } from './scheduler.js';
import { securityHeaders, loginRateLimiter, hardwareRateLimiter, apiRateLimiter } from './security.js';
import { notFoundHandler, errorHandler, asyncHandler, BadRequestError } from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const p2 = (n) => String(n).padStart(2, '0');

app.disable('x-powered-by');
app.use(securityHeaders);
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Static assets are served BEFORE anything that needs the database — a cold
// serverless instance used to connect to SQL Server before even index.html
// could load, adding seconds to first paint.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders(res, filePath) {
    // App code must revalidate on every load (deploys show up immediately);
    // images/icons rarely change and may cache for a day.
    if (/\.(js|css|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    else if (/\.(png|jpg|jpeg|svg|ico)$/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=86400');
  },
}));

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

// Apply login rate limiter to auth routes
app.use('/api/auth/login', loginRateLimiter);
app.use('/api/auth', authRouter);
app.use('/api/ext', apiRateLimiter, extRouter); // external booking-system API (X-API-Key)

// Vercel Cron backstop (no session): checks all machines once a day even if
// nobody opens the dashboard and the on-site server is down. Protected by
// CRON_SECRET when set (Vercel sends it as a Bearer token).
app.get('/api/cron/online-check', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.get('authorization') !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    const check = await runOnlineCheck();
    try { await replayPendingOps(); } catch { /* next run */ }
    try { await archiveEvents(); } catch { /* next run */ }
    try { await sweepFaceVault(); } catch { /* next run */ }
    try { await syncUsersTable(); } catch { /* next run */ }
    res.json({ ok: true, ...check });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});
app.use('/api', requireAuth);   // everything else needs a logged-in session
app.use('/api/devices', devicesRouter);
app.use('/api/cards', cardsRouter);
app.use('/api/bookings-feed', bookingsRouter);

// --- Server-Sent Events (SSE) Live Activity Stream ---
const sseClients = new Set();

export function broadcastEvent(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

setLogSyncSubscriber((entry) => {
  broadcastEvent({ type: 'activity', ...entry });
});

// SSE live stream endpoint
app.get('/api/events/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify({ type: 'connected', ts: new Date().toISOString() })}\n\n`);
  sseClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// Push everything pending across all employees/devices.
app.post('/api/sync', hardwareRateLimiter, async (req, res) => {
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
app.post('/api/expiry-check', hardwareRateLimiter, async (req, res) => {
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
    const check = await runOnlineCheck();
    let replayed = 0;
    try { replayed = (await replayPendingOps()).applied; } catch { /* retried next round */ }
    // Backups ride on dashboard traffic so NOTHING depends on the local dev
    // server: entry archive, face vault and the members backup table refresh
    // at most every 5 minutes, triggered by whoever has the dashboard open.
    try {
      const lastB = await sp('WN_HIK_Settings_Get', { key: 'backup_ran_at' });
      if (!(Number(lastB[0]?.value) > Date.now() - 300000)) {
        await sp('WN_HIK_Settings_Set', { key: 'backup_ran_at', value: String(Date.now()) });
        await archiveEvents().catch(() => {});
        await sweepFaceVault().catch(() => {});
        await syncUsersTable().catch(() => {});
      }
    } catch { /* next visit picks it up */ }
    res.json({ ok: true, ...check, replayed });
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
// door open/close, denied attempts) with fast DB fallback. Newest first.
app.get('/api/events', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 60, 200);
  const devices = await getAllDevices();
  const events = [];
  const unreachable = [];
  await Promise.all(devices.map(async (dev) => {
    if (!dev.online) return;
    try {
      const head = await isapi.searchEvents(dev, 0, 1, { timeout: 2000 });
      if (!head.total) return;
      // Firmware caps pages at 30 — walk the tail so the NEWEST events are
      // included (a single big request silently returned an older window).
      let pos = Math.max(0, head.total - limit);
      while (pos < head.total) {
        const page = await isapi.searchEvents(dev, pos, 30, { timeout: 2000 });
        if (!page.list.length) break;
        for (const e of page.list) events.push({ device: dev.name, device_id: dev.id, ...e });
        pos += page.list.length;
      }
    } catch {
      unreachable.push(dev.name);
    }
  }));

  if (events.length === 0) {
    try {
      const dbEvents = await getRows(
        `SELECT TOP (${limit}) device_id, device_name AS device, employee_no AS employeeNoString, name, card_no AS cardNo, minor, serial_no AS serialNo, event_time AS time
         FROM dbo.WN_HIK_Events WITH (NOLOCK)
         ORDER BY id DESC`
      );
      if (dbEvents && dbEvents.length > 0) {
        return res.json({ ok: true, events: dbEvents, unreachable, fromDb: true });
      }
    } catch {}
  }

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
  const name = String(req.query.name || '').trim().toLowerCase();
  if (!employeeNo) return res.status(400).json({ error: 'employeeNo required' });
  // Served from the shared snapshots — clicking a profile used to query all
  // 55 machines live (~29s); this answers in the time of a few DB reads.
  const devices = await getAllDevices();
  const machines = await Promise.all(devices.map(async (dev) => {
    try {
      const users = await getRoster(dev);
      const p = users.find((u) => String(u.employeeNo) === employeeNo
        && (!name || String(u.name || '').trim().toLowerCase() === name));
      if (!p) return { device_id: dev.id, device: dev.name, host: dev.host, present: false };
      let cards = [];
      try {
        cards = (await getCardTable(dev)).filter((c) => String(c.employeeNo) === employeeNo).map((c) => c.cardNo);
      } catch { /* cards unknown — counts still shown */ }
      return {
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
      };
    } catch {
      return { device_id: dev.id, device: dev.name, host: dev.host, present: null }; // unreachable
    }
  }));
  machines.sort((a, b) => a.device_id - b.device_id);
  res.json({ ok: true, employeeNo, machines });
});

// Memberships expiring within N days (default 7) plus already-expired ones,
// computed live from the machines' rosters. People are matched across machines
// by employee # + name; far-future "no expiry" dates never show up.
// All machine rosters in one request. The browser caps parallel connections
// per host, so 50+ per-machine fetches would serialize badly with many
// All machine rosters in one request.
// On Vercel (cloud), physical machines on local LAN (192.168.x.x) cannot be routed
// to directly; answers instantly (~10ms) from the central SQL Server database.
app.get('/api/roster', async (req, res) => {
  const devices = await getAllDevices();
  const isAdmin = (req.auth?.role || 'user') === 'admin';

  const rosters = await Promise.all(devices.map(async (dev) => {
    try {
      if (!dev.online) throw new Error('Device is offline');
      const users = await getRoster(dev);
      return { device_id: dev.id, ok: true, users: isAdmin ? users : users.filter((u) => !u.localUIRight) };
    } catch (e) {
      // Fast fallback to database records for this device so users view never hangs
      try {
        const dbUsers = await getRows(
          `SELECT e.employee_no AS employeeNo, e.name, e.card_no, e.valid_begin, e.valid_end, e.status
           FROM dbo.WN_HIK_AccessGrants g
           JOIN dbo.WN_HIK_Employees e ON e.id = g.employee_id
           WHERE g.device_id = ?`,
          [dev.id]
        );
        if (dbUsers.length > 0) {
          const mapped = dbUsers.map((u) => ({
            employeeNo: u.employeeNo,
            name: u.name,
            numOfCard: u.card_no ? 1 : 0,
            Valid: {
              enable: u.status !== 'expired',
              beginTime: u.valid_begin ? String(u.valid_begin) : null,
              endTime: u.valid_end ? String(u.valid_end) : null,
            },
          }));
          return { device_id: dev.id, ok: true, users: mapped, fromDb: true };
        }
      } catch {}
      return { device_id: dev.id, ok: false, error: String(e.message || e) };
    }
  }));
  res.json({ ok: true, rosters });
});

// Fix one person's credential gaps NOW: copy the union of their cards,
// fingerprints and face template to every reachable machine they exist on
// (matched by employee # AND name). Powers the mismatch banner's Fix button.
app.post('/api/consistency/fix', hardwareRateLimiter, async (req, res) => {
  const employeeNo = String(req.body?.employeeNo ?? '').trim();
  const name = String(req.body?.name ?? '').trim().toLowerCase();
  if (!employeeNo) return res.status(400).json({ ok: false, error: 'employeeNo required' });
  try {
    const devices = await getAllDevices();
    const members = [];
    await Promise.all(devices.map(async (dev) => {
      try {
        const users = await getRoster(dev);
        const u = users.find((x) => String(x.employeeNo) === employeeNo
          && String(x.name || '').trim().toLowerCase() === name);
        if (u) members.push({ dev, u });
      } catch { /* unreachable — skipped */ }
    }));
    if (members.length < 2) {
      return res.json({ ok: false, error: 'person found on fewer than 2 reachable machines — nothing to reconcile' });
    }
    const onlyIds = Array.isArray(req.body?.only_device_ids) && req.body.only_device_ids.length
      ? new Set(req.body.only_device_ids.map(Number))
      : null;
    const r = await syncCredentialGroup(members, onlyIds);
    invalidateRoster();
    logSync(null, null, 'consistency-fix', true, { employeeNo, name, copied: r.copied, machines: members.length });
    res.json({ ok: true, machines: members.length, copied: r.copied });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Central-truth check: compare every person's credentials across machines and
// report disagreements. The auto-sync fixes what it can on its own; what it
// CANNOT fix (e.g. one card owned by different users on different machines)
// is exactly what this surfaces, so the dashboard stays the source of truth.
app.get('/api/consistency', async (req, res) => {
  try {
    const devices = await getAllDevices();
    const per = [];
    await Promise.all(devices.map(async (dev) => {
      try {
        // near-fresh scan — a stale cache here made fixed issues linger
        const users = await getRoster(dev, 5000);
        const all = [];
        let pos = 0;
        for (let i = 0; i < 50; i++) {
          const page = await isapi.readAllCards(dev, pos, 100);
          all.push(...page.list);
          if (!page.list.length || all.length >= page.total) break;
          pos += page.list.length;
        }
        const cards = new Map();
        for (const c of all) {
          const emp = String(c.employeeNo);
          if (!cards.has(emp)) cards.set(emp, []);
          cards.get(emp).push(String(c.cardNo));
        }
        per.push({ dev, users, cards });
      } catch { /* unreachable — skipped from the comparison */ }
    }));
    if (per.length < 2) return res.json({ ok: true, checked: per.length, issues: [] });

    const owners = new Map(); // cardNo -> Map(personKey -> {employeeNo, name, devices[]})
    const people = new Map(); // personKey -> {employeeNo, name, machines[]}
    for (const { dev, users, cards } of per) {
      for (const u of users) {
        const key = `${u.employeeNo}||${String(u.name || '').trim().toLowerCase()}`;
        if (!people.has(key)) people.set(key, { employeeNo: String(u.employeeNo), name: u.name || '', machines: [] });
        people.get(key).machines.push({
          dev,
          device: dev.name,
          cards: cards.get(String(u.employeeNo)) || [],
          fp: Number(u.numOfFP) || 0,
          face: Number(u.numOfFace) || 0,
        });
        for (const no of cards.get(String(u.employeeNo)) || []) {
          if (!owners.has(no)) owners.set(no, new Map());
          if (!owners.get(no).has(key)) owners.get(no).set(key, { employeeNo: String(u.employeeNo), name: u.name || '', devices: [] });
          owners.get(no).get(key).devices.push(dev.name);
        }
      }
    }

    const issues = [];
    const conflictedCards = new Set();
    // 1) One card number, different owners depending on the machine.
    for (const [cardNo, hold] of owners) {
      if (hold.size > 1) {
        conflictedCards.add(cardNo);
        const holders = [...hold.values()];
        issues.push({
          type: 'card-conflict', cardNo, holders,
          detail: `Card ${cardNo} belongs to ${holders
            .map((h) => `${h.name || '#' + h.employeeNo} on ${h.devices.join(', ')}`)
            .join(' BUT to ')} — pick one owner; auto-sync cannot reconcile this.`,
        });
      }
    }
    // 2/3/4) Same person, different cards / fingerprints / face across machines.
    for (const p of people.values()) {
      if (p.machines.length < 2) continue;
      const who = p.name || '#' + p.employeeNo;
      const union = [...new Set(p.machines.flatMap((m) => m.cards))];
      const missing = p.machines
        .map((m) => ({ device: m.device, device_id: m.dev?.id, missing: union.filter((c) => !m.cards.includes(c)) }))
        .filter((m) => m.missing.length);
      if (missing.length) {
        issues.push({
          type: 'cards-differ', employeeNo: p.employeeNo, name: p.name, union, missing,
          missing_ids: missing.map((m) => m.device_id).filter(Boolean),
          detail: `${who} holds ${union.length} card(s) in total but not on every machine: ` + missing
            .map((m) => `${m.device} lacks ${m.missing.map((c) => conflictedCards.has(c) ? c + ' (owned by another user there)' : c).join(', ')}`)
            .join('; ') + '.',
        });
      }
      const fpMax = Math.max(...p.machines.map((m) => m.fp));
      const fpMiss = p.machines.filter((m) => m.fp < fpMax);
      if (fpMax && fpMiss.length) {
        issues.push({
          type: 'fp-differ', employeeNo: p.employeeNo, name: p.name,
          missing_ids: fpMiss.map((m) => m.dev?.id).filter(Boolean),
          detail: `${who} has ${fpMax} fingerprint(s) on some machines but fewer on ${fpMiss.map((m) => `${m.device} (${m.fp})`).join(', ')} — auto-sync copies it when the template is exportable; if this persists, recapture once via Actions → Capture fingerprint (one scan enrolls it everywhere).`,
        });
      }
      const faceMax = Math.max(...p.machines.map((m) => m.face));
      const faceMiss = p.machines.filter((m) => m.face < faceMax);
      if (faceMax && faceMiss.length) {
        // Roster counts can lag right after a sync — trust the face library:
        // only report machines whose FDLib really has no template.
        const reallyMissing = (await Promise.all(faceMiss.map(async (m) => {
          try { return (await isapi.readFaces(m.dev, p.employeeNo)).length ? null : m; }
          catch { return null; /* unreachable — don't accuse it */ }
        }))).filter(Boolean);
        if (reallyMissing.length) {
          issues.push({
            type: 'face-differ', employeeNo: p.employeeNo, name: p.name,
            missing_ids: reallyMissing.map((m) => m.dev?.id).filter(Boolean),
            detail: `${who} has a face enrolled on some machines but not on ${reallyMissing.map((m) => m.device).join(', ')} — auto-sync should close this shortly.`,
          });
        }
      }
    }
    // Same employee # under different names = duplicated rows on the Users
    // page (people are matched by # AND name). Usually a rename that didn't
    // reach every machine (some were offline).
    const byNo = new Map();
    for (const p of people.values()) {
      if (!byNo.has(p.employeeNo)) byNo.set(p.employeeNo, []);
      byNo.get(p.employeeNo).push(p);
    }
    for (const [no, variants] of byNo) {
      if (variants.length > 1) {
        issues.push({
          type: 'name-split', employeeNo: no,
          detail: `Employee #${no} has different names on different machines: ` +
            variants.map((v) => `"${v.name || '(blank)'}" on ${v.machines.map((m) => m.device).join(', ')}`).join(' — vs — ') +
            `. They show as separate rows until renamed to match: Actions → Edit name/# on the wrongly-named row.`,
        });
      }
    }
    res.json({ ok: true, checked: per.length, issues });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get('/api/expiring', async (req, res) => {
  try {
    const horizonDays = Math.min(Number(req.query.days) || 7, 60);
    const rows = await getRows(
      `SELECT e.employee_no AS employeeNo, e.name, e.valid_end AS validEnd, g.device_id, d.name AS device
       FROM dbo.WN_HIK_Employees e
       JOIN dbo.WN_HIK_AccessGrants g ON g.employee_id = e.id
       JOIN dbo.WN_HIK_Devices d ON d.id = g.device_id
       WHERE e.valid_end IS NOT NULL
         AND e.valid_end <= DATEADD(day, ?, SYSDATETIME())
       ORDER BY e.valid_end ASC`,
      [horizonDays]
    );

    const now = new Date();
    const map = new Map();
    for (const r of rows) {
      const key = `${r.employeeNo}||${String(r.name || '').trim().toLowerCase()}`;
      if (!map.has(key)) {
        const d = r.validEnd ? new Date(r.validEnd) : null;
        map.set(key, {
          employeeNo: String(r.employeeNo),
          name: r.name || '',
          minEnd: d ? d.toISOString() : null,
          status: d && d < now ? 'expired' : 'expiring',
          on: []
        });
      }
      map.get(key).on.push({
        device_id: r.device_id,
        device: r.device,
        validEnd: r.validEnd ? new Date(r.validEnd).toISOString() : null
      });
    }

    res.json({ ok: true, items: [...map.values()], unreachable: [], horizonDays });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
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
    let raw = {};
    try {
      const rows = await sp('WN_HIK_Stats_Get');
      raw = rows[0] || {};
    } catch {}

    const [devsCount, onlineDevsCount, activeEmpsCount, expiredEmpsCount, cardsCount, pendingSyncCount] = await Promise.all([
      getRow('SELECT COUNT(*) AS n FROM dbo.WN_HIK_Devices').catch(() => ({ n: 0 })),
      getRow('SELECT COUNT(*) AS n FROM dbo.WN_HIK_Devices WHERE online = 1').catch(() => ({ n: 0 })),
      getRow("SELECT COUNT(*) AS n FROM dbo.WN_HIK_Employees WHERE status = 'active' OR status IS NULL").catch(() => ({ n: 0 })),
      getRow("SELECT COUNT(*) AS n FROM dbo.WN_HIK_Employees WHERE status = 'expired'").catch(() => ({ n: 0 })),
      getRow("SELECT COUNT(*) AS n FROM dbo.WN_HIK_Cards").catch(async () => {
        return getRow("SELECT COUNT(DISTINCT card_no) AS n FROM dbo.WN_HIK_Employees WHERE card_no IS NOT NULL").catch(() => ({ n: 0 }));
      }),
      getRow("SELECT COUNT(*) AS n FROM dbo.WN_HIK_AccessGrants WHERE sync_state IN ('pending','error','removing')").catch(() => ({ n: 0 })),
    ]);

    const base = {};
    for (const [k, v] of Object.entries(raw)) {
      base[k.toLowerCase()] = v;
    }

    const devices = Number(base.devices ?? devsCount?.n ?? 0);
    const devicesOnline = Number(base.devicesonline ?? onlineDevsCount?.n ?? 0);
    const active = Number(base.active ?? activeEmpsCount?.n ?? 0);
    const expired = Number(base.expired ?? expiredEmpsCount?.n ?? 0);
    const cards = Number(base.cards ?? cardsCount?.n ?? 0);
    const pendingSync = Number(base.pendingsync ?? pendingSyncCount?.n ?? 0);

    const now = new Date();
    const todayStr = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
    const yest = new Date(now.getTime() - 86400000);
    const yestStr = `${yest.getFullYear()}-${p2(yest.getMonth() + 1)}-${p2(yest.getDate())}`;

    const [todayRow, yestRow] = await Promise.all([
      getRow('SELECT COUNT(*) AS n FROM dbo.WN_HIK_SyncLog WHERE CAST(ts AS DATE) = ?', [todayStr]).catch(() => ({ n: 0 })),
      getRow('SELECT COUNT(*) AS n FROM dbo.WN_HIK_SyncLog WHERE CAST(ts AS DATE) = ?', [yestStr]).catch(() => ({ n: 0 })),
    ]);

    const todayScans = todayRow?.n || 0;
    const yestScans = yestRow?.n || 0;
    let trendPct = 0;
    if (yestScans > 0) {
      trendPct = Math.round(((todayScans - yestScans) / yestScans) * 100);
    } else if (todayScans > 0) {
      trendPct = 100;
    }

    res.json({
      devices,
      devicesOnline,
      active,
      expired,
      cards,
      pendingSync,
      todayScans,
      yestScans,
      trendPct,
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Admin Audit Log API
app.get('/api/audit-logs', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    let logs = [];
    try {
      logs = await sp('WN_HIK_Activity_Recent', { limit });
    } catch {
      logs = await getRows(
        `SELECT TOP (${limit}) l.*, d.name AS device_name
         FROM dbo.WN_HIK_SyncLog l WITH (NOLOCK)
         LEFT JOIN dbo.WN_HIK_Devices d WITH (NOLOCK) ON d.id = l.device_id
         ORDER BY l.id DESC`
      ).catch(() => []);
    }
    const parsed = logs.map((l) => {
      let info = {};
      try { info = JSON.parse(l.detail || '{}'); } catch {}
      return {
        id: l.id,
        ts: l.ts,
        action: String(l.action).replace(/^AUDIT:/, ''),
        actor: typeof info === 'object' && info?.actor ? info.actor : (String(l.action).startsWith('AUDIT:') ? 'admin' : 'system'),
        target: typeof info === 'object' && info?.target ? info.target : (l.device_name || ''),
        ip: typeof info === 'object' && info?.ip ? info.ip : '',
        info: typeof info === 'object' && info?.info ? info.info : (l.detail || ''),
        ok: l.ok,
      };
    });
    res.json({ ok: true, logs: parsed });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Analytics & Occupancy Engine API
app.get('/api/analytics', async (req, res) => {
  try {
    // Pull fresh events into the permanent archive in the background (throttled
    // to once a minute across viewers) without blocking the HTTP response.
    try {
      const last = await sp('WN_HIK_Settings_Get', { key: 'events_archived_at' });
      if (!(Number(last[0]?.value) > Date.now() - 60000)) {
        await sp('WN_HIK_Settings_Set', { key: 'events_archived_at', value: String(Date.now()) });
        // Fire-and-forget in background, never block client HTTP response
        archiveEvents().catch(() => {});
      }
    } catch { /* archive refresh is best-effort */ }

    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const nowD = new Date();
    const pd = (n) => String(n).padStart(2, '0');
    const todayISO = `${nowD.getFullYear()}-${pd(nowD.getMonth() + 1)}-${pd(nowD.getDate())}`;
    const from = DATE_RE.test(String(req.query.from || '')) ? String(req.query.from) : todayISO;
    const to = DATE_RE.test(String(req.query.to || '')) ? String(req.query.to) : todayISO;
    const [
      hourlyRows,
      doorRows,
      userRows,
      totalCountRow,
      devices,
      stats,
      empsCount,
      cardsCount
    ] = await Promise.all([
      getRows(
        `SELECT DATEPART(hour, event_time) AS hr, COUNT(*) AS cnt
         FROM dbo.WN_HIK_Events WITH (NOLOCK)
         WHERE event_time BETWEEN ? AND ?
         GROUP BY DATEPART(hour, event_time)`,
        [`${from}T00:00:00`, `${to}T23:59:59`]
      ).catch(() => []),
      getRows(
        `SELECT device_name AS name, COUNT(*) AS count
         FROM dbo.WN_HIK_Events WITH (NOLOCK)
         WHERE event_time BETWEEN ? AND ? AND device_name IS NOT NULL
         GROUP BY device_name
         ORDER BY count DESC`,
        [`${from}T00:00:00`, `${to}T23:59:59`]
      ).catch(() => []),
      getRows(
        `SELECT TOP 10 employee_no, name, COUNT(*) AS count
         FROM dbo.WN_HIK_Events WITH (NOLOCK)
         WHERE event_time BETWEEN ? AND ? AND (employee_no IS NOT NULL OR name IS NOT NULL)
         GROUP BY employee_no, name
         ORDER BY count DESC`,
        [`${from}T00:00:00`, `${to}T23:59:59`]
      ).catch(() => []),
      getRow(
        `SELECT COUNT(*) AS total
         FROM dbo.WN_HIK_Events WITH (NOLOCK)
         WHERE event_time BETWEEN ? AND ?`,
        [`${from}T00:00:00`, `${to}T23:59:59`]
      ).catch(() => ({ total: 0 })),
      getAllDevices(),
      sp('WN_HIK_Stats_Get').catch(() => [{}]),
      getRow("SELECT COUNT(*) AS n FROM dbo.WN_HIK_Employees WHERE status='active'").catch(() => ({ n: 0 })),
      getRow('SELECT COUNT(DISTINCT card_no) AS n FROM dbo.WN_HIK_Employees WHERE card_no IS NOT NULL').catch(() => ({ n: 0 })),
    ]);

    const s = stats[0] || {};
    const todayTotal = Number(totalCountRow?.total) || 0;

    // 1. Hourly Traffic Distribution
    const hourlyDistribution = new Array(24).fill(0);
    for (const r of hourlyRows) {
      const hr = Number(r.hr);
      if (!Number.isNaN(hr) && hr >= 0 && hr < 24) {
        hourlyDistribution[hr] = Number(r.cnt) || 0;
      }
    }

    // 2. Door / Machine Usage Breakdown
    const totalDoorScans = doorRows.reduce((acc, d) => acc + (Number(d.count) || 0), 0) || 1;
    const doorUsage = doorRows.map((d) => ({
      name: d.name,
      count: Number(d.count) || 0,
      percent: Math.round(((Number(d.count) || 0) / totalDoorScans) * 100),
    }));

    // 3. Peak Hour
    let peakHour = 9;
    let maxPeak = 0;
    hourlyDistribution.forEach((cnt, hr) => {
      if (cnt > maxPeak) { maxPeak = cnt; peakHour = hr; }
    });
    const peakHourLabel = `${p2(peakHour)}:00 - ${p2(peakHour + 1)}:00`;

    // 4. Estimated Live Headcount
    const liveHeadcount = Math.max(0, Math.min(todayTotal, s.active || 0));

    // 5. Credential Breakdown
    const credentials = {
      cards: cardsCount?.n || 0,
      activeMembers: empsCount?.n || 0,
      totalDevices: devices.length,
    };

    // 6. Top users
    const totalUserScans = userRows.reduce((acc, u) => acc + (Number(u.count) || 0), 0) || 1;
    const userScans = userRows.map((u) => ({
      employeeNo: u.employee_no || '',
      name: u.name || '',
      count: Number(u.count) || 0,
      percent: Math.round(((Number(u.count) || 0) / totalUserScans) * 100),
    }));

    res.json({
      ok: true,
      liveHeadcount,
      todayTotal,
      peakHourLabel,
      maxPeak,
      hourlyDistribution,
      doorUsage,
      credentials,
      devicesCount: devices.length,
      onlineCount: s.devicesOnline || 0,
      userScans,
      range: { from, to },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Single user deep analytics breakdown (scan history, doors, peak times, and recent logs)
app.get('/api/analytics/user/:employeeNo', async (req, res) => {
  try {
    const rawEmpNo = String(req.params.employeeNo || '').trim();
    const nameQuery = String(req.query.name || '').trim();
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const nowD = new Date();
    const today = `${nowD.getFullYear()}-${p2(nowD.getMonth() + 1)}-${p2(nowD.getDate())}`;
    const from = DATE_RE.test(String(req.query.from || '')) ? req.query.from : today;
    const to = DATE_RE.test(String(req.query.to || '')) ? req.query.to : today;

    // 1. Employee profile from DB
    let emp = null;
    if (rawEmpNo && rawEmpNo !== 'null' && rawEmpNo !== 'undefined') {
      emp = await getRow('SELECT * FROM dbo.WN_HIK_Employees WHERE employee_no = ?', [rawEmpNo]).catch(() => null);
    }
    if (!emp && nameQuery) {
      emp = await getRow('SELECT * FROM dbo.WN_HIK_Employees WHERE name = ?', [nameQuery]).catch(() => null);
    }

    // 2. Assigned devices/doors from AccessGrants (or derived from active terminal events)
    let grants = [];
    if (emp?.id) {
      grants = await getRows(
        `SELECT d.id, d.name, d.location, d.grp, d.online
         FROM dbo.WN_HIK_AccessGrants g
         JOIN dbo.WN_HIK_Devices d ON d.id = g.device_id
         WHERE g.employee_id = ?`,
        [emp.id]
      ).catch(() => []);
    }

    const empNo = emp?.employee_no || rawEmpNo;
    const empName = emp?.name || nameQuery;

    if (grants.length === 0) {
      // If user was enrolled directly on a physical terminal (not provisioned via web dashboard),
      // discover the gates/terminals they are authorized on from event logs
      const activeDevs = await getRows(
        `SELECT DISTINCT d.id, d.name, d.location, d.grp, d.online
         FROM dbo.WN_HIK_Events e WITH (NOLOCK)
         JOIN dbo.WN_HIK_Devices d WITH (NOLOCK) ON d.id = e.device_id OR d.name = e.device_name
         WHERE (e.employee_no = ? OR (e.employee_no IS NULL AND e.name = ?))`,
        [empNo, empName]
      ).catch(() => []);
      if (activeDevs.length > 0) {
        grants = activeDevs.map((d) => ({ ...d, directEnroll: true }));
      }
    }

    // 3. User scan breakdown per door in range
    const doorBreakdown = await getRows(
      `SELECT device_name AS name, COUNT(*) AS count
       FROM dbo.WN_HIK_Events WITH (NOLOCK)
       WHERE (employee_no = ? OR (employee_no IS NULL AND name = ?))
         AND event_time BETWEEN ? AND ?
       GROUP BY device_name
       ORDER BY count DESC`,
      [empNo, empName, `${from}T00:00:00`, `${to}T23:59:59`]
    ).catch(() => []);

    // 4. Hourly distribution for user
    const hourlyRows = await getRows(
      `SELECT DATEPART(hour, event_time) AS hr, COUNT(*) AS count
       FROM dbo.WN_HIK_Events WITH (NOLOCK)
       WHERE (employee_no = ? OR (employee_no IS NULL AND name = ?))
         AND event_time BETWEEN ? AND ?
       GROUP BY DATEPART(hour, event_time)`,
      [empNo, empName, `${from}T00:00:00`, `${to}T23:59:59`]
    ).catch(() => []);

    const hourly = new Array(24).fill(0);
    let peakHr = 0;
    let peakVal = 0;
    for (const r of hourlyRows) {
      const h = Number(r.hr);
      if (!Number.isNaN(h) && h >= 0 && h < 24) {
        const cnt = Number(r.count) || 0;
        hourly[h] = cnt;
        if (cnt > peakVal) {
          peakVal = cnt;
          peakHr = h;
        }
      }
    }

    // 5. Total scans, first scan, last scan in range
    const metaRow = await getRow(
      `SELECT COUNT(*) AS total, MIN(event_time) AS first_scan, MAX(event_time) AS last_scan
       FROM dbo.WN_HIK_Events WITH (NOLOCK)
       WHERE (employee_no = ? OR (employee_no IS NULL AND name = ?))
         AND event_time BETWEEN ? AND ?`,
      [empNo, empName, `${from}T00:00:00`, `${to}T23:59:59`]
    ).catch(() => ({ total: 0, first_scan: null, last_scan: null }));

    // 6. Recent scan event log entries (latest 30)
    const recentEvents = await getRows(
      `SELECT TOP 30 id, device_name, event_time, card_no, minor
       FROM dbo.WN_HIK_Events WITH (NOLOCK)
       WHERE (employee_no = ? OR (employee_no IS NULL AND name = ?))
         AND event_time BETWEEN ? AND ?
       ORDER BY event_time DESC`,
      [empNo, empName, `${from}T00:00:00`, `${to}T23:59:59`]
    ).catch(() => []);

    // 7. All-time total scans
    const allTimeRow = await getRow(
      `SELECT COUNT(*) AS total
       FROM dbo.WN_HIK_Events WITH (NOLOCK)
       WHERE (employee_no = ? OR (employee_no IS NULL AND name = ?))`,
      [empNo, empName]
    ).catch(() => ({ total: 0 }));

    const totalScans = Number(metaRow?.total) || 0;

    res.json({
      ok: true,
      user: {
        employeeNo: empNo,
        name: empName || `User ${empNo}`,
        cardNo: emp?.card_no || (recentEvents.find((e) => e.card_no)?.card_no) || '',
        roomNo: emp?.room_no || '',
        status: emp?.status || 'active',
        validBegin: emp?.valid_begin,
        validEnd: emp?.valid_end,
      },
      grants,
      totalScans,
      allTimeScans: Number(allTimeRow?.total) || totalScans,
      firstScan: metaRow?.first_scan ? String(metaRow.first_scan) : null,
      lastScan: metaRow?.last_scan ? String(metaRow.last_scan) : null,
      peakHourLabel: peakVal > 0 ? `${p2(peakHr)}:00 - ${p2(peakHr + 1)}:00 (${peakVal} scans)` : '—',
      doors: doorBreakdown.map((d) => ({
        name: d.name || 'Terminal',
        count: Number(d.count) || 0,
        percent: totalScans > 0 ? Math.round(((Number(d.count) || 0) / totalScans) * 100) : 0,
      })),
      hourly,
      recentEvents: recentEvents.map((e) => ({
        id: e.id,
        device: e.device_name || 'Terminal',
        time: e.event_time ? String(e.event_time) : null,
        cardNo: e.card_no,
        minor: e.minor,
      })),
      range: { from, to },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});



// 404 API & Global Error Handlers
app.use(notFoundHandler);
app.use(errorHandler);

// Global process guards to catch unexpected background errors gracefully
process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandled-rejection] Promise:', promise, 'Reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[uncaught-exception] Error:', err.message || err, err.stack);
});

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
