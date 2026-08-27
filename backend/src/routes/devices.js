import { Router } from 'express';
import { getAllDevices, getDeviceById, run, sp, logSync } from '../db.js';
import * as isapi from '../isapi.js';

export const devicesRouter = Router();

devicesRouter.get('/', async (req, res) => {
  const rows = await getAllDevices();
  // never leak passwords to the UI
  res.json(rows.map(({ password, ...d }) => d));
});

// Machines are provisioned in the DB (data/machines.json or direct INSERT), not
// created from the UI. Creation via the API is intentionally disabled.
devicesRouter.post('/', (req, res) => {
  res.status(405).json({ error: 'Machines are managed in the database, not the dashboard. Add them via data/machines.json or a direct INSERT into `devices`.' });
});

devicesRouter.put('/:id', async (req, res) => {
  const dev = await getDeviceById(req.params.id);
  if (!dev) return res.status(404).json({ error: 'not found' });
  const fields = ['name', 'host', 'port', 'use_https', 'username', 'password', 'location', 'grp', 'code'];
  const updates = [];
  const vals = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f}=?`);
      vals.push(f === 'use_https' ? (req.body[f] ? 1 : 0) : req.body[f]);
    }
  }
  if (!updates.length) return res.json({ ok: true });
  vals.push(req.params.id);
  await run(`UPDATE dbo.WN_HIK_Devices SET ${updates.join(', ')} WHERE id=?`, vals);
  res.json({ ok: true });
});

devicesRouter.delete('/:id', async (req, res) => {
  await run('DELETE FROM dbo.WN_HIK_Devices WHERE id=?', [Number(req.params.id)]);
  res.json({ ok: true });
});

// Test connectivity + pull model/serial.
devicesRouter.post('/:id/test', async (req, res) => {
  const dev = await getDeviceById(req.params.id);
  if (!dev) return res.status(404).json({ error: 'not found' });
  try {
    const info = await isapi.getDeviceInfo(dev);
    await sp('WN_HIK_Device_SetOnline', { device_id: dev.id, online: 1, model: info.model || null, serial: info.serialNumber || null });
    logSync(null, dev.id, 'test', true, info);
    res.json({ ok: true, info });
  } catch (e) {
    await sp('WN_HIK_Device_SetOnline', { device_id: dev.id, online: 0 });
    logSync(null, dev.id, 'test', false, String(e.message || e));
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Live list of persons currently enrolled ON the device (pulled over ISAPI).
devicesRouter.get('/:id/users', async (req, res) => {
  const dev = await getDeviceById(req.params.id);
  if (!dev) return res.status(404).json({ error: 'not found' });
  try {
    const users = [];
    let pos = 0;
    for (let i = 0; i < 200; i++) {
      const page = await isapi.searchPersons(dev, pos, 30);
      users.push(...page.list);
      if (!page.list.length || users.length >= page.total) break;
      pos += page.list.length;
    }
    res.json({ ok: true, total: users.length, users });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Create a user on one or more machines in a single operation, with an optional
// typed RFID card attached on each. The employee # is chosen to be free on ALL
// selected machines so the same person keeps one number everywhere.
// body: { device_ids: [...], employeeNo?, name, role?, valid_begin?, valid_end?, card_no? }
devicesRouter.post('/users', async (req, res) => {
  const { name, card_no } = req.body || {};
  const ids = [...new Set((req.body?.device_ids || []).map(Number))].filter(Boolean);
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!ids.length) return res.status(400).json({ error: 'pick at least one machine' });
  const devs = (await Promise.all(ids.map((id) => getDeviceById(id)))).filter(Boolean);
  if (!devs.length) return res.status(404).json({ error: 'no such machines' });
  try {
    // Read existing users on every target machine: reject a duplicate # and
    // auto-pick a number that is free on all of them.
    const taken = new Set();
    let maxNo = 0;
    for (const dev of devs) {
      const existing = [];
      let pos = 0;
      for (let i = 0; i < 200; i++) {
        const page = await isapi.searchPersons(dev, pos, 30);
        existing.push(...page.list);
        if (!page.list.length || existing.length >= page.total) break;
        pos += page.list.length;
      }
      for (const u of existing) {
        taken.add(String(u.employeeNo));
        maxNo = Math.max(maxNo, Number(u.employeeNo) || 0);
      }
    }

    let employeeNo = req.body.employeeNo ? String(req.body.employeeNo).trim() : '';
    if (employeeNo) {
      if (taken.has(employeeNo))
        return res.status(409).json({ error: `Employee #${employeeNo} already exists on a selected machine — pick another or leave it blank.` });
    } else {
      employeeNo = String(maxNo + 1);
    }

    const record = {
      employeeNo,
      name,
      admin: req.body.role === 'admin',
      validBegin: req.body.valid_begin || '2020-01-01T00:00:00',
      validEnd: req.body.valid_end || '2037-12-31T23:59:59',
    };
    const results = [];
    for (const dev of devs) {
      try {
        const r = await isapi.upsertPerson(dev, record, 'add'); // add only — never overwrite
        logSync(null, dev.id, 'add-user', r.ok, { employeeNo, ...r });
        if (!r.ok) { results.push({ device_id: dev.id, device: dev.name, ok: false, error: isapi.describe(r) }); continue; }
        let cardError;
        if (card_no) {
          const c = await isapi.addCard(dev, employeeNo, String(card_no).trim());
          logSync(null, dev.id, 'store-card', c.ok, { employeeNo, cardNo: card_no, ...c });
          if (!c.ok) cardError = isapi.describe(c);
        }
        results.push({ device_id: dev.id, device: dev.name, ok: true, cardError });
      } catch (e) {
        results.push({ device_id: dev.id, device: dev.name, ok: false, error: String(e.message || e) });
      }
    }
    const okCount = results.filter((x) => x.ok).length;
    res.status(okCount ? 200 : 502).json({ ok: okCount > 0, employeeNo, name, results });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Create/enroll a user directly on a device (employeeNo + name + validity).
// body: { employeeNo?, name, valid_begin?, valid_end? }
devicesRouter.post('/:id/users', async (req, res) => {
  const dev = await getDeviceById(req.params.id);
  if (!dev) return res.status(404).json({ error: 'not found' });
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    // Read current users once: to reject duplicates and to auto-pick a free #.
    const existing = [];
    let pos = 0;
    for (let i = 0; i < 200; i++) {
      const page = await isapi.searchPersons(dev, pos, 30);
      existing.push(...page.list);
      if (!page.list.length || existing.length >= page.total) break;
      pos += page.list.length;
    }
    const taken = new Set(existing.map((u) => String(u.employeeNo)));

    let employeeNo = req.body.employeeNo ? String(req.body.employeeNo).trim() : '';
    if (employeeNo) {
      if (taken.has(employeeNo))
        return res.status(409).json({ error: `Employee #${employeeNo} already exists on this machine — pick another or leave it blank.` });
    } else {
      const maxNo = existing.reduce((m, u) => Math.max(m, Number(u.employeeNo) || 0), 0);
      employeeNo = String(maxNo + 1);
    }

    const record = {
      employeeNo,
      name,
      admin: req.body.role === 'admin',
      validBegin: req.body.valid_begin || '2020-01-01T00:00:00',
      validEnd: req.body.valid_end || '2037-12-31T23:59:59',
    };
    const r = await isapi.upsertPerson(dev, record, 'add'); // add only — never overwrite
    logSync(null, dev.id, 'add-user', r.ok, { employeeNo, ...r });
    if (!r.ok) return res.status(502).json({ ok: false, error: isapi.describe(r) });
    res.json({ ok: true, employeeNo, name });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Delete a user from a device.
devicesRouter.delete('/:id/users/:employeeNo', async (req, res) => {
  const dev = await getDeviceById(req.params.id);
  if (!dev) return res.status(404).json({ error: 'not found' });
  try {
    const r = await isapi.deletePerson(dev, req.params.employeeNo);
    logSync(null, dev.id, 'delete-user', r.ok, { employeeNo: req.params.employeeNo, ...r });
    res.status(r.ok ? 200 : 502).json({ ok: r.ok, error: r.ok ? undefined : isapi.describe(r) });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Which machines this user (employeeNo) is currently enrolled on. Queries every
// machine. present=true/false, or null if that machine was unreachable.
devicesRouter.get('/:id/users/:employeeNo/access', async (req, res) => {
  const src = await getDeviceById(req.params.id);
  if (!src) return res.status(404).json({ error: 'not found' });
  const employeeNo = String(req.params.employeeNo);
  const devices = await getAllDevices();
  let name = null;
  const machines = [];
  for (const d of devices) {
    let present = false;
    let enabled = true;
    let validEnd = null;
    try {
      const p = await isapi.getPerson(d, employeeNo);
      present = !!p;
      enabled = p ? p.Valid?.enable !== false : true;
      validEnd = p?.Valid?.endTime || null;
      if (p && (d.id === src.id || !name)) name = p.name;
    } catch {
      present = null; // unreachable
    }
    machines.push({ device_id: d.id, name: d.name, host: d.host, grp: d.grp || null, present, enabled, valid_end: validEnd, isSource: d.id === src.id });
  }
  res.json({ ok: true, employeeNo, name, machines });
});

// Set the exact set of machines this user may access. Enrolls (copies identity +
// cards + fingerprints from the source machine) where newly granted; where access
// is revoked the person is BLOCKED (Valid.enable=false) but stays enrolled, so
// the user never disappears from the dashboard. Delete is a separate action.
devicesRouter.post('/:id/users/:employeeNo/access', async (req, res) => {
  const src = await getDeviceById(req.params.id);
  if (!src) return res.status(404).json({ error: 'not found' });
  const employeeNo = String(req.params.employeeNo);
  const wanted = new Set((req.body.device_ids || []).map(Number));
  const validEnd = req.body.valid_end || null; // global fallback
  const validEnds = req.body.valid_ends || {}; // per-machine: { "<device_id>": "YYYY-MM-DDTHH:mm:ss" }
  try {
    const person = await isapi.getPerson(src, employeeNo);
    if (!person) return res.status(404).json({ error: `user ${employeeNo} not found on source machine` });
    const cards = await isapi.readCards(src, employeeNo);
    const prints = await isapi.readFingerprints(src, employeeNo);
    const base = {
      employeeNo,
      name: person.name || `User ${employeeNo}`,
      admin: !!person.localUIRight,
      validBegin: person.Valid?.beginTime || '2020-01-01T00:00:00',
    };
    const devices = await getAllDevices();
    const results = [];
    for (const d of devices) {
      let existing;
      try { existing = await isapi.getPerson(d, employeeNo); }
      catch { results.push({ device_id: d.id, device: d.name, state: 'unreachable' }); continue; }
      const present = !!existing;
      const enabled = present && existing.Valid?.enable !== false;
      const want = wanted.has(d.id);
      // Per-machine deadline wins, then the global one, then whatever the
      // machine (or the source record) already has.
      const dEnd = validEnds[String(d.id)] || validEnd;
      const endFor = (p) => dEnd || p?.Valid?.endTime || person.Valid?.endTime || '2037-12-31T23:59:59';
      try {
        if (want && !present) {
          // Grant: enroll identity + credentials copied from the source machine.
          const record = { ...base, validEnd: endFor(null) };
          let r = await isapi.upsertPerson(d, record, 'add');
          if (!r.ok) r = await isapi.upsertPerson(d, record, 'modify');
          if (!r.ok) throw new Error(isapi.describe(r));
          for (const c of cards) await isapi.addCard(d, employeeNo, c);
          for (const fp of prints) await isapi.addFingerprint(d, employeeNo, fp.fingerData, fp.fingerPrintID);
          logSync(null, d.id, 'access-grant', true, { employeeNo });
          results.push({ device_id: d.id, device: d.name, state: 'granted' });
        } else if (want && present && !enabled) {
          // Re-grant: un-block the existing enrollment.
          const r = await isapi.upsertPerson(d, { ...base, validEnd: endFor(existing), enabled: true }, 'modify');
          if (!r.ok) throw new Error(isapi.describe(r));
          logSync(null, d.id, 'access-grant', true, { employeeNo, unblocked: true });
          results.push({ device_id: d.id, device: d.name, state: 'unblocked' });
        } else if (!want && present && enabled) {
          // Revoke: block at the door but keep profile + credentials enrolled.
          const r = await isapi.upsertPerson(d, { ...base, validEnd: endFor(existing), enabled: false }, 'modify');
          logSync(null, d.id, 'access-revoke', r.ok, { employeeNo, blocked: true, ...r });
          if (!r.ok) throw new Error(isapi.describe(r));
          results.push({ device_id: d.id, device: d.name, state: 'blocked' });
        } else if (want && present && enabled && dEnd && dEnd !== existing.Valid?.endTime) {
          const r = await isapi.upsertPerson(d, { ...base, validEnd: dEnd }, 'modify');
          if (!r.ok) throw new Error(isapi.describe(r));
          results.push({ device_id: d.id, device: d.name, state: 'updated' });
        } else {
          results.push({ device_id: d.id, device: d.name, state: want ? 'unchanged' : (present ? 'blocked' : 'absent') });
        }
      } catch (e) {
        results.push({ device_id: d.id, device: d.name, state: 'error', error: String(e.message || e) });
      }
    }
    res.json({ ok: true, results });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Edit a user's name and/or employee # across machines. Renaming is an
// in-place modify. Changing the employee # re-creates the person under the new
// number (with cards, fingerprints and face template) and deletes the old one,
// because the number is the device's primary key.
devicesRouter.post('/:id/users/:employeeNo/update', async (req, res) => {
  const src = await getDeviceById(req.params.id);
  if (!src) return res.status(404).json({ error: 'not found' });
  const employeeNo = String(req.params.employeeNo);
  const newName = req.body?.name ? String(req.body.name).trim() : null;
  const newNo = req.body?.newEmployeeNo ? String(req.body.newEmployeeNo).trim() : null;
  const ids = [...new Set((req.body?.device_ids || []).map(Number))].filter(Boolean);
  const targets = (await Promise.all((ids.length ? ids : [src.id]).map((id) => getDeviceById(id)))).filter(Boolean);
  const renumber = newNo && newNo !== employeeNo;
  const results = [];
  for (const dev of targets) {
    try {
      const p = await isapi.getPerson(dev, employeeNo);
      if (!p) { results.push({ device: dev.name, ok: false, error: 'user not on this machine' }); continue; }
      if (renumber) {
        const clash = await isapi.getPerson(dev, newNo);
        if (clash) { results.push({ device: dev.name, ok: false, error: `#${newNo} is already taken by "${clash.name}"` }); continue; }
        const cards = await isapi.readCards(dev, employeeNo);
        const prints = await isapi.readFingerprints(dev, employeeNo);
        const faces = await isapi.readFaces(dev, employeeNo);
        const record = {
          employeeNo: newNo,
          name: newName || p.name || `User ${newNo}`,
          admin: !!p.localUIRight,
          enabled: p.Valid?.enable !== false,
          validBegin: p.Valid?.beginTime || '2020-01-01T00:00:00',
          validEnd: p.Valid?.endTime || '2037-12-31T23:59:59',
        };
        const r = await isapi.upsertPerson(dev, record, 'add');
        if (!r.ok) { results.push({ device: dev.name, ok: false, error: isapi.describe(r) }); continue; }
        for (const c of cards) await isapi.addCard(dev, newNo, c);
        for (const fp of prints) await isapi.addFingerprint(dev, newNo, fp.fingerData, fp.fingerPrintID);
        for (const f of faces) await isapi.addFaceByModel(dev, newNo, f.modelData);
        const del = await isapi.deletePerson(dev, employeeNo);
        logSync(null, dev.id, 'edit-user', del.ok, { from: employeeNo, to: newNo, name: record.name });
        results.push({ device: dev.name, ok: del.ok, error: del.ok ? undefined : isapi.describe(del) });
      } else if (newName && newName !== p.name) {
        const r = await isapi.upsertPerson(dev, {
          employeeNo,
          name: newName,
          admin: !!p.localUIRight,
          enabled: p.Valid?.enable !== false,
          validBegin: p.Valid?.beginTime || '2020-01-01T00:00:00',
          validEnd: p.Valid?.endTime || '2037-12-31T23:59:59',
        }, 'modify');
        logSync(null, dev.id, 'edit-user', r.ok, { employeeNo, name: newName });
        results.push({ device: dev.name, ok: r.ok, error: r.ok ? undefined : isapi.describe(r) });
      } else {
        results.push({ device: dev.name, ok: true, unchanged: true });
      }
    } catch (e) {
      results.push({ device: dev.name, ok: false, error: String(e.message || e) });
    }
  }
  const okCount = results.filter((x) => x.ok).length;
  res.status(okCount ? 200 : 502).json({ ok: okCount > 0, results });
});

// Change a user's access level (admin/user) on the device. Reads the current
// record to preserve name/validity, then re-writes with the new localUIRight.
devicesRouter.post('/:id/users/:employeeNo/role', async (req, res) => {
  const dev = await getDeviceById(req.params.id);
  if (!dev) return res.status(404).json({ error: 'not found' });
  const employeeNo = String(req.params.employeeNo);
  const admin = req.body?.role === 'admin';
  try {
    const p = await isapi.getPerson(dev, employeeNo);
    if (!p) return res.status(404).json({ error: `no user ${employeeNo} on this machine` });
    const r = await isapi.upsertPerson(
      dev,
      {
        employeeNo,
        name: p.name || `User ${employeeNo}`,
        admin,
        validBegin: p.Valid?.beginTime || '2020-01-01T00:00:00',
        validEnd: p.Valid?.endTime || '2037-12-31T23:59:59',
      },
      'modify'
    );
    logSync(null, dev.id, `set-role:${admin ? 'admin' : 'user'}`, r.ok, { employeeNo, ...r });
    if (!r.ok) return res.status(502).json({ ok: false, error: isapi.describe(r) });
    res.json({ ok: true, role: admin ? 'admin' : 'user' });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Trigger the terminal to capture a fingerprint (it prompts the person to press
// their finger), then store the captured template against that user on the device.
devicesRouter.post('/:id/users/:employeeNo/capture-fingerprint', async (req, res) => {
  const dev = await getDeviceById(req.params.id);
  if (!dev) return res.status(404).json({ error: 'not found' });
  const fingerNo = Number(req.body?.fingerNo) || 1;
  try {
    const cap = await isapi.captureFingerprint(dev, fingerNo);
    logSync(null, dev.id, 'capture-fingerprint', cap.ok, { employeeNo: req.params.employeeNo, ok: cap.ok, quality: cap.quality, statusString: cap.statusString });
    if (!cap.ok) return res.status(502).json({ ok: false, error: isapi.describe(cap) || 'Capture failed — no finger detected.' });
    const stored = await isapi.addFingerprint(dev, req.params.employeeNo, cap.fingerData, fingerNo);
    logSync(null, dev.id, 'store-fingerprint', stored.ok, stored);
    if (!stored.ok) return res.status(502).json({ ok: false, error: isapi.describe(stored) });
    // Replicate the captured template to the user's other machines so one scan
    // enrolls the finger everywhere.
    const replicateIds = [...new Set((req.body?.replicate_device_ids || []).map(Number))]
      .filter((id) => id && id !== dev.id);
    const replicated = [];
    for (const rid of replicateIds) {
      const rdev = await getDeviceById(rid);
      if (!rdev) continue;
      try {
        const rr = await isapi.addFingerprint(rdev, req.params.employeeNo, cap.fingerData, fingerNo);
        logSync(null, rdev.id, 'store-fingerprint', rr.ok, rr);
        replicated.push({ device: rdev.name, ok: rr.ok, error: rr.ok ? undefined : isapi.describe(rr) });
      } catch (e) {
        replicated.push({ device: rdev.name, ok: false, error: String(e.message || e) });
      }
    }
    res.json({ ok: true, quality: cap.quality, replicated });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Tag a card: prompt the terminal to read a card at its reader, then attach the
// captured card number to this user on the device.
devicesRouter.post('/:id/users/:employeeNo/capture-card', async (req, res) => {
  const dev = await getDeviceById(req.params.id);
  if (!dev) return res.status(404).json({ error: 'not found' });
  const employeeNo = String(req.params.employeeNo);
  try {
    const cap = await isapi.captureCard(dev);
    logSync(null, dev.id, 'capture-card', cap.ok, { employeeNo, ...cap });
    if (!cap.ok) return res.status(502).json({ ok: false, error: cap.error });
    const stored = await isapi.addCard(dev, employeeNo, cap.cardNo);
    logSync(null, dev.id, 'store-card', stored.ok, stored);
    if (!stored.ok)
      return res.status(502).json({ ok: false, cardNo: cap.cardNo, error: isapi.describe(stored) });
    // Replicate the tapped card to the user's other machines.
    const replicateIds = [...new Set((req.body?.replicate_device_ids || []).map(Number))]
      .filter((id) => id && id !== dev.id);
    const replicated = [];
    for (const rid of replicateIds) {
      const rdev = await getDeviceById(rid);
      if (!rdev) continue;
      try {
        const rr = await isapi.addCard(rdev, employeeNo, cap.cardNo);
        logSync(null, rdev.id, 'store-card', rr.ok, rr);
        replicated.push({ device: rdev.name, ok: rr.ok, error: rr.ok ? undefined : isapi.describe(rr) });
      } catch (e) {
        replicated.push({ device: rdev.name, ok: false, error: String(e.message || e) });
      }
    }
    res.json({ ok: true, cardNo: cap.cardNo, replicated });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Unlock (or control) many machines at once. Body: { device_ids?[], cmd? }.
// With no device_ids, applies to every machine.
devicesRouter.post('/door', async (req, res) => {
  const allowed = ['open', 'close', 'alwaysOpen', 'alwaysClose'];
  const cmd = allowed.includes(req.body?.cmd) ? req.body.cmd : 'open';
  const ids = Array.isArray(req.body?.device_ids) && req.body.device_ids.length
    ? [...new Set(req.body.device_ids.map(Number))]
    : (await getAllDevices()).map((d) => d.id);
  const results = [];
  for (const id of ids) {
    const dev = await getDeviceById(id);
    if (!dev) { results.push({ device_id: id, ok: false, error: 'not found' }); continue; }
    try {
      const r = await isapi.remoteControlDoor(dev, cmd);
      logSync(null, dev.id, `door:${cmd}`, r.ok, r);
      results.push({ device_id: id, device: dev.name, ok: r.ok, error: r.ok ? undefined : isapi.describe(r) });
    } catch (e) {
      results.push({ device_id: id, device: dev.name, ok: false, error: String(e.message || e) });
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  res.json({ ok: okCount > 0, okCount, total: results.length, results });
});

// Detach a card number from machines (removes it from whichever user holds it;
// the user profile itself stays). Defaults to every machine.
devicesRouter.post('/card/delete', async (req, res) => {
  const cardNo = String(req.body?.card_no || '').trim();
  if (!cardNo) return res.status(400).json({ error: 'card_no required' });
  const ids = Array.isArray(req.body?.device_ids) && req.body.device_ids.length
    ? [...new Set(req.body.device_ids.map(Number))]
    : (await getAllDevices()).map((d) => d.id);
  const results = [];
  for (const id of ids) {
    const dev = await getDeviceById(id);
    if (!dev) continue;
    try {
      const r = await isapi.deleteCard(dev, cardNo);
      logSync(null, dev.id, 'delete-card', r.ok, { cardNo, ...r });
      results.push({ device: dev.name, ok: r.ok, error: r.ok ? undefined : isapi.describe(r) });
    } catch (e) {
      results.push({ device: dev.name, ok: false, error: String(e.message || e) });
    }
  }
  res.json({ ok: results.some((x) => x.ok), results });
});

// List the card numbers attached to one user on a device.
devicesRouter.get('/:id/users/:employeeNo/cards', async (req, res) => {
  const dev = await getDeviceById(req.params.id);
  if (!dev) return res.status(404).json({ error: 'not found' });
  try {
    const cards = await isapi.readCards(dev, String(req.params.employeeNo));
    res.json({ ok: true, cards });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Enroll a face: the terminal shows its face-capture UI, the person looks at
// the camera, and the captured face is stored for this user on the device.
devicesRouter.post('/:id/users/:employeeNo/capture-face', async (req, res) => {
  const dev = await getDeviceById(req.params.id);
  if (!dev) return res.status(404).json({ error: 'not found' });
  const employeeNo = String(req.params.employeeNo);
  try {
    const cap = await isapi.captureFace(dev);
    logSync(null, dev.id, 'capture-face', cap.ok, { employeeNo, ok: cap.ok, error: cap.error });
    if (!cap.ok) return res.status(502).json({ ok: false, error: cap.error });
    const stored = await isapi.addFaceByImage(dev, employeeNo, cap.jpeg);
    logSync(null, dev.id, 'store-face', stored.ok, stored);
    if (!stored.ok) return res.status(502).json({ ok: false, error: isapi.describe(stored) });
    // Replicate the captured face to the user's other machines.
    const replicateIds = [...new Set((req.body?.replicate_device_ids || []).map(Number))]
      .filter((id) => id && id !== dev.id);
    const replicated = [];
    for (const rid of replicateIds) {
      const rdev = await getDeviceById(rid);
      if (!rdev) continue;
      try {
        const rr = await isapi.addFaceByImage(rdev, employeeNo, cap.jpeg);
        logSync(null, rdev.id, 'store-face', rr.ok, rr);
        replicated.push({ device: rdev.name, ok: rr.ok, error: rr.ok ? undefined : isapi.describe(rr) });
      } catch (e) {
        replicated.push({ device: rdev.name, ok: false, error: String(e.message || e) });
      }
    }
    res.json({ ok: true, replicated });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Delete a user's enrolled face(s) while keeping fingerprints, cards and the
// profile. Applies to every given machine — deleting on just one would be
// undone by the credential auto-sync copying the face back.
devicesRouter.post('/:id/users/:employeeNo/delete-face', async (req, res) => {
  const src = await getDeviceById(req.params.id);
  if (!src) return res.status(404).json({ error: 'not found' });
  const employeeNo = String(req.params.employeeNo);
  const ids = [...new Set((req.body?.device_ids || []).map(Number))].filter(Boolean);
  const targets = (await Promise.all((ids.length ? ids : [src.id]).map((id) => getDeviceById(id)))).filter(Boolean);
  const results = [];
  for (const dev of targets) {
    try {
      const r = await isapi.deleteFace(dev, employeeNo);
      logSync(null, dev.id, 'delete-face', r.ok, { employeeNo, ...r });
      results.push({ device: dev.name, ok: r.ok, error: r.ok ? undefined : isapi.describe(r) });
    } catch (e) {
      results.push({ device: dev.name, ok: false, error: String(e.message || e) });
    }
  }
  const okCount = results.filter((x) => x.ok).length;
  res.status(okCount ? 200 : 502).json({ ok: okCount > 0, results });
});

// Attach a typed card number to an existing user on a device (no tap needed).
devicesRouter.post('/:id/users/:employeeNo/card', async (req, res) => {
  const dev = await getDeviceById(req.params.id);
  if (!dev) return res.status(404).json({ error: 'not found' });
  const cardNo = String(req.body?.card_no || '').trim();
  if (!cardNo) return res.status(400).json({ error: 'card_no required' });
  try {
    const r = await isapi.addCard(dev, String(req.params.employeeNo), cardNo);
    logSync(null, dev.id, 'store-card', r.ok, { employeeNo: req.params.employeeNo, cardNo, ...r });
    if (!r.ok) return res.status(502).json({ ok: false, error: isapi.describe(r) });
    res.json({ ok: true, cardNo });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Remote door control from the dashboard (default: momentary unlock).
devicesRouter.post('/:id/door', async (req, res) => {
  const dev = await getDeviceById(req.params.id);
  if (!dev) return res.status(404).json({ error: 'not found' });
  const allowed = ['open', 'close', 'alwaysOpen', 'alwaysClose'];
  const cmd = allowed.includes(req.body?.cmd) ? req.body.cmd : 'open';
  try {
    const r = await isapi.remoteControlDoor(dev, cmd);
    logSync(null, dev.id, `door:${cmd}`, r.ok, r);
    res.status(r.ok ? 200 : 502).json({ ok: r.ok, error: r.ok ? undefined : isapi.describe(r) });
  } catch (e) {
    logSync(null, dev.id, `door:${cmd}`, false, String(e.message || e));
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

// Copy one enrolled person (identity + cards + fingerprints) from this device to
// one or more target machines, with a chosen access-until deadline enforced by
// the terminal itself. Face photos cannot be exported from a device.
devicesRouter.post('/:id/users/:employeeNo/copy', async (req, res) => {
  const src = await getDeviceById(req.params.id);
  if (!src) return res.status(404).json({ error: 'source machine not found' });
  const employeeNo = String(req.params.employeeNo);
  const targetIds = [...new Set((req.body.target_device_ids || []).map(Number))].filter(
    (id) => id && id !== src.id
  );
  if (!targetIds.length) return res.status(400).json({ error: 'pick at least one target machine' });
  const validEnd = req.body.valid_end || null;
  const validBegin = req.body.valid_begin || null;

  try {
    const person = await isapi.getPerson(src, employeeNo);
    if (!person) return res.status(404).json({ error: `no user ${employeeNo} on source machine` });
    const cards = await isapi.readCards(src, employeeNo);
    const prints = await isapi.readFingerprints(src, employeeNo);

    const results = [];
    for (const tid of targetIds) {
      const dev = await getDeviceById(tid);
      if (!dev) { results.push({ device_id: tid, state: 'error', error: 'target not found' }); continue; }
      const detail = { cards: 0, fingerprints: 0 };
      try {
        const record = {
          employeeNo,
          name: person.name || `User ${employeeNo}`,
          admin: !!person.localUIRight, // preserve access level from source
          validBegin: validBegin || person.Valid?.beginTime || '2020-01-01T00:00:00',
          validEnd: validEnd || person.Valid?.endTime || '2037-12-31T23:59:59',
        };
        let r = await isapi.upsertPerson(dev, record, 'add');
        if (!r.ok) r = await isapi.upsertPerson(dev, record, 'modify');
        logSync(null, dev.id, 'copy-person', r.ok, { from: src.id, employeeNo, ...r });
        if (!r.ok) throw new Error(isapi.describe(r));

        for (const cardNo of cards) {
          const c = await isapi.addCard(dev, employeeNo, cardNo);
          if (c.ok) detail.cards++;
          logSync(null, dev.id, 'copy-card', c.ok, c);
        }
        for (const fp of prints) {
          const p = await isapi.addFingerprint(dev, employeeNo, fp.fingerData, fp.fingerPrintID);
          if (p.ok) detail.fingerprints++;
          logSync(null, dev.id, 'copy-fingerprint', p.ok, p);
        }
        results.push({ device_id: tid, device: dev.name, state: 'copied', ...detail });
      } catch (e) {
        results.push({ device_id: tid, device: dev.name, state: 'error', error: String(e.message || e) });
      }
    }
    res.json({ ok: true, employeeNo, name: person.name, cards: cards.length, fingerprints: prints.length, results });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});

devicesRouter.get('/:id/capabilities', async (req, res) => {
  const dev = await getDeviceById(req.params.id);
  if (!dev) return res.status(404).json({ error: 'not found' });
  try {
    const caps = await isapi.getCapabilities(dev);
    res.json({ ok: true, caps });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
});
