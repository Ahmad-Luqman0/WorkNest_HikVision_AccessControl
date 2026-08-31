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
import { getRoster, invalidateRoster } from './machineCache.js';
import { startScheduler, runExpiryPass, runCredentialSync, runOnlineCheck, syncCredentialGroup, replayPendingOps } from './scheduler.js';
import { securityHeaders, loginRateLimiter, hardwareRateLimiter, apiRateLimiter } from './security.js';
import { notFoundHandler, errorHandler, asyncHandler, BadRequestError } from './errors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.disable('x-powered-by');
app.use(securityHeaders);
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
// All machine rosters in one request. The browser caps parallel connections
// per host, so 50+ per-machine fetches would serialize badly with many
// offline machines; the server fans out in parallel instead.
app.get('/api/roster', async (req, res) => {
  const devices = await getAllDevices();
  const isAdmin = (req.auth?.role || 'user') === 'admin';
  const rosters = await Promise.all(devices.map(async (dev) => {
    try {
      const users = await getRoster(dev);
      return { device_id: dev.id, ok: true, users: isAdmin ? users : users.filter((u) => !u.localUIRight) };
    } catch (e) {
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
        .map((m) => ({ device: m.device, missing: union.filter((c) => !m.cards.includes(c)) }))
        .filter((m) => m.missing.length);
      if (missing.length) {
        issues.push({
          type: 'cards-differ', employeeNo: p.employeeNo, name: p.name, union, missing,
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
    const base = rows[0] || {};

    const now = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
    const yest = new Date(now.getTime() - 86400000);
    const yestStr = `${yest.getFullYear()}-${p2(yest.getMonth() + 1)}-${p2(yest.getDate())}`;

    const [todayRow, yestRow] = await Promise.all([
      getRow('SELECT COUNT(*) AS n FROM dbo.WN_HIK_Activity WHERE CAST(ts AS DATE) = ?', [todayStr]),
      getRow('SELECT COUNT(*) AS n FROM dbo.WN_HIK_Activity WHERE CAST(ts AS DATE) = ?', [yestStr]),
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
      ...base,
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
    const logs = await getRows(
      `SELECT TOP (${limit}) * FROM dbo.WN_HIK_Activity
       ORDER BY id DESC`
    );
    const parsed = logs.map((l) => {
      let info = {};
      try { info = JSON.parse(l.detail || '{}'); } catch {}
      return {
        id: l.id,
        ts: l.ts,
        action: String(l.action).replace(/^AUDIT:/, ''),
        actor: typeof info === 'object' && info?.actor ? info.actor : 'system',
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
    const [devices, stats, eventsResult, empsCount, cardsCount] = await Promise.all([
      getAllDevices(),
      sp('WN_HIK_Stats_Get'),
      sp('WN_HIK_Activity_Recent', { limit: 500 }),
      getRow('SELECT COUNT(*) AS n FROM dbo.WN_HIK_Employees WHERE status=\'active\''),
      getRow('SELECT COUNT(DISTINCT card_no) AS n FROM dbo.WN_HIK_Employees WHERE card_no IS NOT NULL'),
    ]);

    const s = stats[0] || {};
    const now = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const todayStr = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;

    // 1. Hourly Traffic Distribution (24 hours)
    const hourlyDistribution = new Array(24).fill(0);
    let todayTotal = 0;
    for (const e of eventsResult) {
      if (!e.ts) continue;
      const d = new Date(e.ts);
      if (!Number.isNaN(d.getTime())) {
        const eDateStr = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
        if (eDateStr === todayStr) {
          todayTotal++;
          hourlyDistribution[d.getHours()]++;
        }
      }
    }

    // 2. Door / Machine Usage Breakdown
    const doorUsageMap = new Map();
    for (const d of devices) doorUsageMap.set(d.name, 0);
    for (const e of eventsResult) {
      if (e.device_name && doorUsageMap.has(e.device_name)) {
        doorUsageMap.set(e.device_name, doorUsageMap.get(e.device_name) + 1);
      }
    }
    const totalDoorScans = [...doorUsageMap.values()].reduce((a, b) => a + b, 0) || 1;
    const doorUsage = [...doorUsageMap.entries()]
      .map(([name, count]) => ({ name, count, percent: Math.round((count / totalDoorScans) * 100) }))
      .sort((a, b) => b.count - a.count);

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
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.use(express.static(path.join(__dirname, '..', 'public'), {
  // Browsers must revalidate app.js/styles.css on every load — stale cached
  // UI after a deploy looked like bugs that were already fixed.
  setHeaders(res, filePath) {
    if (/\.(js|css|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

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
