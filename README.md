# Hik Access — Co-working Access Dashboard

Centralized dashboard for **Hikvision access terminals** (DS-K1T320 / MinMoe family).
Add a member once, choose which machines they can use, set an access-until time — the
devices block them automatically after expiry, and the dashboard can auto-delete them too.

## What it does

- **One dashboard, many machines.** Register every terminal once.
- **Add a member once → grant a subset of machines** (e.g. 7 of 10). Push happens over ISAPI.
- **Credentials:** RFID card, face photo, fingerprint templates.
- **Time-limited access.** Each member has an *access-until* time written to the device's
  native **Valid Period** — the terminal blocks them at the door even if this dashboard or the
  network is down. No dependence on a cron running.
- **Auto-block / auto-delete on expiry.** Status flips to `expired`; if `auto_delete` is on,
  the member is removed from every assigned machine.
- **Activity log** of every push/delete/test.

## Requirements

- **Node.js 22.5+** (uses the built-in `node:sqlite` — no native build step).
- The PC running this must be **on the same LAN** as the terminals (able to reach each device IP).
- Each terminal's **admin username + password**, and its **IP address**.

## Configuration

Copy `backend/.env.example` to `backend/.env` and fill in the SQL Server
connection (never commit `.env`):

```
DB_SERVER=...
DB_PORT=1450
DB_USER=...
DB_PASSWORD=...
DB_NAME=SAC400
```

## Deploying to Vercel

The dashboard + SQL Server-backed APIs run fine on Vercel. Two things to know:

1. **Project settings:** set **Root Directory** to `backend`, and add the
   `DB_SERVER / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME` environment
   variables in the Vercel project settings.
2. **The machines are on a LAN.** Vercel cannot reach the Hikvision machines
   (192.168.x.x), and serverless has no background jobs — so the hosted copy is
   the management/booking view. Keep one copy running on a PC **inside the
   co-working network** (`npm start`): that instance is the device agent doing
   syncs, unlocks, captures, expiry auto-delete and clock sync. Both copies
   share the same SQL Server, so they stay consistent.

## Run

```bash
cd backend
npm install
npm start
# open http://localhost:3000
```

Data lives in `backend/data/hik.db` (SQLite). Face photos in `backend/data/faces/`.

## Provisioning machines (database, not the UI)

Machines are **registered in the database**, not added through the dashboard. Two ways:

- **Config file (recommended).** Copy `backend/data/machines.example.json` to
  `backend/data/machines.json`, list your terminals, and restart. On startup they're
  upserted into the `devices` table (matched by `host` — re-running updates existing rows).

  ```json
  [
    { "name": "Front door", "host": "192.168.1.64", "username": "admin", "password": "…", "location": "Reception" }
  ]
  ```
  Fields: `name`, `host`, `username`, `password` are required; `port` (defaults 80 / 443 with
  https), `use_https` (default false), and `location` are optional.

- **Direct SQL.** `INSERT INTO devices (name, host, port, use_https, username, password, location) VALUES (…)`
  against `backend/data/hik.db`.

The dashboard's **Machines** view is read-only for provisioning — it lists the terminals and
lets you **Test** connectivity (which pulls the real model + serial and marks them **Online**).
If a test fails: check the PC can `ping` the device IP, the credentials are right, and
ISAPI/"Network service" is enabled on the device (it is by default on these units).

## Going live with real machines

1. Provision every terminal in `machines.json` (or via SQL) as above, then start the server.
2. Open **Machines** and click **Test** on each to confirm it's reachable and **Online**.
3. **Members → + Add member**: name, RFID card #, access-from/until, tick the allowed machines,
   optionally upload a face photo. Save → it pushes to those machines immediately.
5. Use **Sync all pending** any time after edits.

## How time-blocking works (important)

The reliable guarantee is the **device-side Valid Period**. When you set *access until*, that
time is written to the person record on each machine. The terminal itself denies entry after it —
this keeps working during a power/network outage on the dashboard. The dashboard's 5-minute
scheduler only handles the *extras*: flipping status to `expired` and optional auto-delete.

## Notes on the DS-K1T320EFWX

- `EFWX` = face + card. Fingerprint enrollment needs a unit with a fingerprint sensor
  (e.g. the `M`/`MFW` variants). The software supports fingerprints via ISAPI regardless;
  a machine with no sensor simply won't accept prints.
- All device calls use **HTTP Digest auth** over ISAPI (`/ISAPI/AccessControl/...`).

## Booking-system integration API

External booking apps integrate via `/api/ext/...`. Every request needs the API key,
printed to the server console at startup (`X-API-Key` header or `?api_key=`).

Each booking attendee becomes an auto-deleting visitor on the chosen machines: the
machines only allow entry inside the slot, and **attendees (with their fingerprints)
are deleted from the machines automatically within ~5 minutes after the booking ends**.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/ext/machines` | machine ids/names/groups (no credentials) |
| POST | `/api/ext/bookings` | create booking: `{ref, begin, end, device_ids:[…], attendees:[{name, card_no?}…]}` → returns each attendee's `employeeNo` |
| GET | `/api/ext/bookings/:ref` | status: attendees, machines, live fingerprint count |
| POST | `/api/ext/bookings/:ref/attendees/:employeeNo/capture-fingerprint` | `{device_id, fingerNo?}` — that machine prompts for the finger; template is stored on every booking machine |
| PATCH | `/api/ext/bookings/:ref` | reschedule: `{begin?, end?}` applied to all attendees + auto-delete timer |
| DELETE | `/api/ext/bookings/:ref` | cancel now — attendees and fingerprints removed from all machines immediately |

Times are local `YYYY-MM-DDTHH:mm:ss`. Attendee numbers are issued in the 9000+ range.

## API (for scripting / integration)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/devices` | list machines (adding is DB-only; POST returns 405) |
| POST | `/api/devices/:id/test` | connectivity + model/serial |
| GET/POST | `/api/employees` | list / add member |
| PUT | `/api/employees/:id/grants` | set allowed machines `{device_ids:[…]}` |
| POST | `/api/employees/:id/face` | upload face photo (multipart `face`) |
| POST | `/api/employees/:id/sync` | push this member to their machines |
| POST | `/api/sync` | push everything pending |
| POST | `/api/expiry-check` | run expiry pass now |
| GET | `/api/logs` | recent activity |
