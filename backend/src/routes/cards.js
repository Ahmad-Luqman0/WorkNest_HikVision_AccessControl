import { Router } from 'express';
import { getRow, getRows, run, sp, getAllDevices, logSync } from '../db.js';
import { syncEmployee } from '../sync.js';
import * as isapi from '../isapi.js';
import { getRoster } from '../machineCache.js';

export const cardsRouter = Router();

// A "card" is a person record on the device (kind='card') whose purpose is to
// carry one RFID card. Hik machines require every card to attach to an
// employeeNo, so each card assignment is backed by a minimal person record.
async function withGrants(row) {
  const grants = await getRows(
    `SELECT g.device_id, g.sync_state, g.last_error, d.name AS device_name
     FROM dbo.WN_HIK_AccessGrants g JOIN dbo.WN_HIK_Devices d ON d.id = g.device_id
     WHERE g.employee_id = ?`,
    [row.id]
  );
  return { ...row, grants };
}

async function nextEmployeeNo() {
  const rows = await sp('WN_HIK_Employee_NextNumber', { floor: 1001 });
  return Number(rows[0]?.next_no) || 1001;
}

async function cardRows() {
  const rows = await getRows(`SELECT * FROM dbo.WN_HIK_Employees WHERE kind='card' ORDER BY id DESC`);
  return Promise.all(rows.map(withGrants));
}

// List all cards with their machines + sync state, enriched with LIVE holder
// info read from every machine: which user holds this card number, and where.
cardsRouter.get('/', async (req, res) => {
  try {
    let registry = await cardRows();
    const devices = await getAllDevices();
    const holders = new Map(); // cardNo -> [{ device, device_id, employeeNo, name }]
    await Promise.all(devices.map(async (dev) => {
      try {
        const all = [];
        let pos = 0;
        for (let i = 0; i < 50; i++) {
          const page = await isapi.readAllCards(dev, pos, 100);
          all.push(...page.list);
          if (!page.list.length || all.length >= page.total) break;
          pos += page.list.length;
        }
        // Holder names come from the cached roster — no per-user round trips.
        const roster = await getRoster(dev).catch(() => []);
        const nameCache = new Map(roster.map((u) => [String(u.employeeNo), u.name || null]));
        for (const c of all) {
          const no = String(c.cardNo);
          const emp = String(c.employeeNo);
          if (!holders.has(no)) holders.set(no, []);
          holders.get(no).push({ device: dev.name, device_id: dev.id, employeeNo: emp, name: nameCache.get(emp) ?? null });
        }
      } catch { /* unreachable machine — skip */ }
    }));

    // Auto-register card numbers discovered on the machines (e.g. tagged at a
    // reader or enrolled at the machine) so every real card shows in this menu.
    const known = new Set(registry.map((r) => String(r.card_no)));
    let added = false;
    for (const no of holders.keys()) {
      if (known.has(no)) continue;
      const empNo = await nextEmployeeNo();
      await sp('WN_HIK_Card_Register', {
        employee_no: String(empNo), name: `Card ${no}`, card_no: no,
        valid_begin: null, valid_end: null, auto_delete: 0,
      });
      added = true;
    }
    if (added) registry = await cardRows();

    res.json(registry.map((r) => ({
      ...r,
      // exclude the card's own backing person record — only real users count
      assigned: (holders.get(String(r.card_no)) || []).filter((h) => h.employeeNo !== String(r.employee_no)),
    })));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// Create a card entry and grant it to a set of machines in one shot.
// body: { card_no, label?, valid_begin?, valid_end?, auto_delete?, device_ids?[] }
cardsRouter.post('/', async (req, res) => {
  const { card_no, label, valid_begin, valid_end, auto_delete } = req.body;
  if (!card_no) return res.status(400).json({ error: 'card_no required' });
  const deviceIds = [...new Set((req.body.device_ids || []).map(Number))].filter(Boolean);
  try {
    const empNo = await nextEmployeeNo();
    const name = (label && label.trim()) || `Card ${card_no}`;
    const created = await sp('WN_HIK_Card_Register', {
      employee_no: String(empNo), name, card_no: String(card_no),
      valid_begin: valid_begin || null, valid_end: valid_end || null,
      auto_delete: auto_delete ? 1 : 0,
    });
    const newId = Number(created[0]?.id);
    for (const did of deviceIds) {
      await sp('WN_HIK_Grant_Ensure', { employee_id: newId, device_id: did });
    }
    res.json({ id: newId, employee_no: String(empNo) });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// Update card number / label / validity.
cardsRouter.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const row = await getRow(`SELECT * FROM dbo.WN_HIK_Employees WHERE id=? AND kind='card'`, [id]);
  if (!row) return res.status(404).json({ error: 'not found' });
  const map = { card_no: 'card_no', label: 'name', valid_begin: 'valid_begin', valid_end: 'valid_end', auto_delete: 'auto_delete' };
  const updates = [];
  const vals = [];
  for (const [key, col] of Object.entries(map)) {
    if (req.body[key] !== undefined) {
      updates.push(`${col}=?`);
      vals.push(key === 'auto_delete' ? (req.body[key] ? 1 : 0) : req.body[key]);
    }
  }
  if (updates.length) {
    vals.push(id);
    await run(`UPDATE dbo.WN_HIK_Employees SET ${updates.join(', ')} WHERE id=?`, vals);
    await run(
      `UPDATE dbo.WN_HIK_AccessGrants SET sync_state='pending' WHERE employee_id=? AND sync_state='synced'`,
      [id]
    );
  }

  // If the access period changed, also apply it to every USER holding this card
  // on any machine. Machines enforce validity per person, so this updates the
  // holder's Valid Period there (all their credentials on that machine).
  const applied = [];
  if (req.body.valid_end !== undefined || req.body.valid_begin !== undefined) {
    const fresh = await getRow(`SELECT * FROM dbo.WN_HIK_Employees WHERE id=?`, [id]);
    if (fresh?.card_no) {
      const devices = await getAllDevices();
      for (const dev of devices) {
        try {
          const all = [];
          let pos = 0;
          for (let i = 0; i < 50; i++) {
            const page = await isapi.readAllCards(dev, pos, 100);
            all.push(...page.list);
            if (!page.list.length || all.length >= page.total) break;
            pos += page.list.length;
          }
          for (const c of all) {
            if (String(c.cardNo) !== String(fresh.card_no)) continue;
            if (String(c.employeeNo) === String(fresh.employee_no)) continue; // own backing record
            const p = await isapi.getPerson(dev, c.employeeNo);
            if (!p) continue;
            const r = await isapi.upsertPerson(dev, {
              employeeNo: String(c.employeeNo),
              name: p.name || `User ${c.employeeNo}`,
              admin: !!p.localUIRight,
              enabled: p.Valid?.enable !== false,
              validBegin: fresh.valid_begin || p.Valid?.beginTime || '2020-01-01T00:00:00',
              validEnd: fresh.valid_end || p.Valid?.endTime || '2037-12-31T23:59:59',
            }, 'modify');
            logSync(null, dev.id, 'card-expiry', r.ok, { cardNo: fresh.card_no, employeeNo: String(c.employeeNo), validEnd: fresh.valid_end });
            applied.push({ device: dev.name, employeeNo: String(c.employeeNo), name: p.name, ok: r.ok, error: r.ok ? undefined : isapi.describe(r) });
          }
        } catch {
          applied.push({ device: dev.name, ok: false, error: 'unreachable' });
        }
      }
    }
  }
  res.json({ ok: true, applied });
});

// Set the exact set of machines this card is on (adds new, marks removed for cleanup).
cardsRouter.put('/:id/grants', async (req, res) => {
  const id = Number(req.params.id);
  const row = await getRow(`SELECT * FROM dbo.WN_HIK_Employees WHERE id=? AND kind='card'`, [id]);
  if (!row) return res.status(404).json({ error: 'not found' });
  const wanted = new Set((req.body.device_ids || []).map(Number));
  const existing = await getRows('SELECT * FROM dbo.WN_HIK_AccessGrants WHERE employee_id=?', [id]);
  const existingIds = new Set(existing.map((g) => g.device_id));
  for (const did of wanted) {
    if (!existingIds.has(did)) {
      await sp('WN_HIK_Grant_Ensure', { employee_id: id, device_id: did });
    }
  }
  for (const g of existing) {
    if (!wanted.has(g.device_id)) {
      await run(`UPDATE dbo.WN_HIK_AccessGrants SET sync_state='removing' WHERE id=?`, [g.id]);
    }
  }
  res.json({ ok: true });
});

// Push this card to its assigned machines now.
cardsRouter.post('/:id/sync', async (req, res) => {
  const row = await getRow(`SELECT * FROM dbo.WN_HIK_Employees WHERE id=? AND kind='card'`, [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'not found' });
  try {
    const results = await syncEmployee(Number(req.params.id));
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// Remove this card from every machine and delete the entry. Device cleanup runs
// inline; the row is dropped afterward so the Cards list stays clean. The card
// number is also detached from ANY user holding it on ANY machine, so every
// access linked to this card is blocked.
cardsRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const row = await getRow(`SELECT * FROM dbo.WN_HIK_Employees WHERE id=? AND kind='card'`, [id]);
  if (!row) return res.status(404).json({ error: 'not found' });
  await sp('WN_HIK_Grant_MarkRemoving', { employee_id: id });
  let results = [];
  try {
    results = await syncEmployee(id); // removes the card-person from its granted devices
  } catch (e) {
    // fall through: we still drop the row below, but report the error
    return res.status(502).json({ ok: false, error: String(e.message || e) });
  }
  // Detach the card number itself from every machine — it may have been
  // assigned to real users, and deleting the card must block that access too.
  const detached = [];
  if (row.card_no) {
    const devices = await getAllDevices();
    for (const dev of devices) {
      try {
        const r = await isapi.deleteCard(dev, String(row.card_no));
        logSync(null, dev.id, 'delete-card', r.ok, { cardNo: row.card_no, ...r });
        detached.push({ device: dev.name, ok: r.ok });
      } catch (e) {
        detached.push({ device: dev.name, ok: false, error: String(e.message || e) });
      }
    }
  }
  await run(`DELETE FROM dbo.WN_HIK_Employees WHERE id=? AND kind='card'`, [id]);
  res.json({ ok: true, results, detached });
});

export default cardsRouter;
