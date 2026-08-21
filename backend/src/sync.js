// Reconciles the desired state (employees + access_grants) with each machine.
import fs from 'node:fs';
import { getRow, getRows, getDeviceById, sp, run, logSync } from './db.js';
import * as isapi from './isapi.js';

function employee(id) {
  return getRow('SELECT * FROM dbo.WN_HIK_Employees WHERE id = ?', [Number(id)]);
}

async function markGrant(id, state, error = null) {
  await sp('WN_HIK_Grant_SetState', { grant_id: Number(id), state, error });
}

// Push one employee onto one machine (person + card + face + fingerprints).
export async function pushEmployeeToDevice(emp, dev) {
  const person = {
    employeeNo: emp.employee_no,
    name: emp.name,
    validBegin: emp.valid_begin || '2020-01-01T00:00:00',
    validEnd: emp.valid_end || '2037-12-31T23:59:59',
  };

  // Try add; if it already exists, modify.
  let r = await isapi.upsertPerson(dev, person, 'add');
  if (!r.ok) {
    r = await isapi.upsertPerson(dev, person, 'modify');
  }
  logSync(emp.id, dev.id, 'person', r.ok, r);
  if (!r.ok) throw new Error(isapi.describe(r));

  if (emp.card_no) {
    const c = await isapi.addCard(dev, emp.employee_no, emp.card_no);
    logSync(emp.id, dev.id, 'card', c.ok, c);
  }

  if (emp.face_path && fs.existsSync(emp.face_path)) {
    const jpeg = fs.readFileSync(emp.face_path);
    const f = await isapi.addFaceByImage(dev, emp.employee_no, jpeg);
    logSync(emp.id, dev.id, 'face', f.ok, f);
  }

  const prints = await getRows('SELECT * FROM dbo.WN_HIK_Fingerprints WHERE employee_id = ?', [emp.id]);
  for (const fp of prints) {
    const p = await isapi.addFingerprint(dev, emp.employee_no, fp.template, fp.finger_no);
    logSync(emp.id, dev.id, 'fingerprint', p.ok, p);
  }

  return true;
}

export async function removeEmployeeFromDevice(emp, dev) {
  const r = await isapi.deletePerson(dev, emp.employee_no); // cascades card/face/fp on device
  logSync(emp.id, dev.id, 'delete', r.ok, r);
  return r.ok;
}

// Sync all pending/error grants for one employee.
export async function syncEmployee(employeeId) {
  const emp = await employee(employeeId);
  if (!emp) throw new Error('employee not found');
  const grants = await getRows('SELECT * FROM dbo.WN_HIK_AccessGrants WHERE employee_id = ?', [Number(employeeId)]);
  const results = [];
  for (const g of grants) {
    const dev = await getDeviceById(g.device_id);
    if (!dev) continue;
    try {
      if (g.sync_state === 'removing') {
        await removeEmployeeFromDevice(emp, dev);
        await run('DELETE FROM dbo.WN_HIK_AccessGrants WHERE id = ?', [g.id]);
        results.push({ device: dev.name, state: 'removed' });
      } else {
        await pushEmployeeToDevice(emp, dev);
        await markGrant(g.id, 'synced');
        results.push({ device: dev.name, state: 'synced' });
      }
    } catch (e) {
      await markGrant(g.id, 'error', String(e.message || e));
      results.push({ device: dev.name, state: 'error', error: String(e.message || e) });
    }
  }
  return results;
}

// Full reconcile across everyone with pending work.
export async function syncAllPending() {
  const empIds = (await sp('WN_HIK_Grant_PendingEmployees')).map((r) => r.employee_id);
  const summary = [];
  for (const id of empIds) {
    summary.push({ employeeId: id, results: await syncEmployee(id) });
  }
  return summary;
}
