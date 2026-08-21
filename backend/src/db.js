// Data layer — Microsoft SQL Server (mssql/tedious).
// Tables + stored procedures are defined in db/schema_updated.sql (WN_HIK_*).
// Dates are stored as DATETIME2 and normalized back to local
// 'YYYY-MM-DDTHH:mm:ss' strings so the rest of the app is format-agnostic.
import sql from 'mssql';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Connection comes exclusively from environment variables (.env locally,
// project env vars on Vercel). No credentials are hardcoded here.
for (const k of ['DB_SERVER', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']) {
  if (!process.env[k]) throw new Error(`Missing required environment variable ${k} — see backend/.env.example`);
}
const config = {
  server: process.env.DB_SERVER,
  port: Number(process.env.DB_PORT) || 1433,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  options: { encrypt: false, trustServerCertificate: true },
  pool: { max: 10, min: 1, idleTimeoutMillis: 30000 },
  connectionTimeout: 15000,
  requestTimeout: 30000,
};

let pool = null;

export async function initDb() {
  if (pool) return pool;
  pool = await new sql.ConnectionPool(config).connect();
  pool.on('error', (e) => console.error('[db] pool error:', e.message));
  await migrateFromSqliteIfEmpty();
  return pool;
}

const p2 = (n) => String(n).padStart(2, '0');
function toLocalString(d) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}
function normalizeRow(row) {
  if (!row) return row;
  for (const k of Object.keys(row)) {
    if (row[k] instanceof Date) row[k] = toLocalString(row[k]);
    else if (typeof row[k] === 'boolean') row[k] = row[k] ? 1 : 0;
  }
  return row;
}

// Run parameterized SQL. Accepts '?' placeholders with a params array —
// converted to @p0..@pn so existing query shapes keep working.
async function request(sqlText, params = []) {
  const req = pool.request();
  let i = 0;
  const text = sqlText.replace(/\?/g, () => `@p${i++}`);
  params.forEach((v, n) => req.input(`p${n}`, v === undefined ? null : v));
  return req.query(text);
}

export async function getRow(sqlText, params = []) {
  const r = await request(sqlText, params);
  return normalizeRow(r.recordset?.[0]) || undefined;
}
export async function getRows(sqlText, params = []) {
  const r = await request(sqlText, params);
  return (r.recordset || []).map(normalizeRow);
}
export async function run(sqlText, params = []) {
  const r = await request(sqlText, params);
  return { changes: r.rowsAffected?.[0] ?? 0 };
}
// INSERT that returns the new identity id.
export async function insert(sqlText, params = []) {
  const r = await request(`${sqlText}; SELECT SCOPE_IDENTITY() AS id;`, params);
  const rs = Array.isArray(r.recordsets) ? r.recordsets[r.recordsets.length - 1] : r.recordset;
  return { lastInsertRowid: Number(rs?.[0]?.id) };
}
// Execute a stored procedure; returns normalized recordset rows.
export async function sp(name, params = {}) {
  const req = pool.request();
  for (const [k, v] of Object.entries(params)) req.input(k, v === undefined ? null : v);
  const r = await req.execute(name);
  return (r.recordset || []).map(normalizeRow);
}

// ---- Common lookups used across routes ----
export async function getDeviceById(id) {
  return getRow('SELECT * FROM dbo.WN_HIK_Devices WHERE id=?', [Number(id)]);
}
export async function getAllDevices() {
  return getRows('SELECT * FROM dbo.WN_HIK_Devices ORDER BY id');
}

// Fire-and-forget activity log via the WN_HIK_Log_Write proc. Never throws.
export function logSync(employee_id, device_id, action, ok, detail) {
  const payload = typeof detail === 'string' ? detail : JSON.stringify(detail);
  sp('WN_HIK_Log_Write', {
    employee_id: employee_id ?? null,
    device_id: device_id ?? null,
    action,
    ok: ok ? 1 : 0,
    detail: payload ?? null,
  }).catch((e) => console.error('[db] logSync failed:', e.message));
}

// Machines are provisioned in the DB. On startup, upsert entries from
// data/machines.json (keyed by host) via the WN_HIK_Device_UpsertByHost proc.
export async function seedDevices() {
  const cfgPath = path.join(__dirname, '..', 'data', 'machines.json');
  if (!fs.existsSync(cfgPath)) return;
  let list;
  try {
    list = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (e) {
    console.error('  machines.json: invalid JSON —', e.message);
    return;
  }
  if (!Array.isArray(list) || !list.length) return;
  let n = 0;
  for (const m of list) {
    if (!m || !m.host || !m.name || !m.username || !m.password) {
      console.error('  machines.json: skipping entry missing name/host/username/password');
      continue;
    }
    await sp('WN_HIK_Device_UpsertByHost', {
      name: m.name,
      host: m.host,
      port: m.port || (m.use_https ? 443 : 80),
      use_https: m.use_https ? 1 : 0,
      username: m.username,
      password: m.password,
      location: m.location || null,
      grp: m.group || m.grp || null,
    });
    n++;
  }
  if (n) console.log(`  seeded ${n} machine(s) from machines.json`);
}

// One-time migration: if the remote DB has no machines yet but the old local
// SQLite file exists, copy machines, people, grants and settings across.
async function migrateFromSqliteIfEmpty() {
  const dbFile = path.join(__dirname, '..', 'data', 'hik.db');
  if (!fs.existsSync(dbFile)) return;
  const count = await getRow('SELECT COUNT(*) AS n FROM dbo.WN_HIK_Devices');
  if (count.n > 0) return;
  let lite;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    lite = new DatabaseSync(dbFile, { readOnly: true });
  } catch (e) {
    console.error('[db] SQLite migration skipped:', e.message);
    return;
  }
  try {
    const devs = lite.prepare('SELECT * FROM devices ORDER BY id').all();
    const devIdMap = new Map(); // old id -> new id
    for (const d of devs) {
      const rows = await sp('WN_HIK_Device_UpsertByHost', {
        name: d.name, host: d.host, port: d.port || 80, use_https: d.use_https ? 1 : 0,
        username: d.username, password: d.password, location: d.location || null, grp: d.grp || null,
      });
      if (rows[0]?.id) devIdMap.set(d.id, Number(rows[0].id));
    }
    const emps = lite.prepare('SELECT * FROM employees ORDER BY id').all();
    const empIdMap = new Map();
    for (const e of emps) {
      const r = await insert(
        `INSERT INTO dbo.WN_HIK_Employees (employee_no, name, card_no, valid_begin, valid_end, auto_delete, status, notes, kind, booking_ref)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [String(e.employee_no), e.name, e.card_no || null, e.valid_begin || null, e.valid_end || null,
         e.auto_delete ? 1 : 0, e.status || 'active', e.notes || null, e.kind || 'member', e.booking_ref || null]
      );
      empIdMap.set(e.id, r.lastInsertRowid);
    }
    const grants = lite.prepare('SELECT * FROM access_grants').all();
    for (const g of grants) {
      const eid = empIdMap.get(g.employee_id);
      const did = devIdMap.get(g.device_id);
      if (!eid || !did) continue;
      await run(
        `INSERT INTO dbo.WN_HIK_AccessGrants (employee_id, device_id, sync_state, last_error) VALUES (?,?,?,?)`,
        [eid, did, g.sync_state || 'pending', g.last_error || null]
      );
    }
    try {
      const settings = lite.prepare('SELECT * FROM settings').all();
      for (const s of settings) await sp('WN_HIK_Settings_Set', { key: s.key, value: s.value });
    } catch { /* settings table may not exist */ }
    console.log(`[db] migrated from SQLite: ${devs.length} machines, ${emps.length} people, ${grants.length} grants`);
  } catch (e) {
    console.error('[db] SQLite migration failed:', e.message);
  } finally {
    lite.close();
  }
}
