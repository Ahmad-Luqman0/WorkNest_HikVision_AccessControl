# Users Module (.NET)

Standalone port of the WorkNest **Users page** to ASP.NET Core 8 — the page
frontend plus the APIs it reads from, converted from the Node backend to C#.
Everything is served from the same SQL Server tables the Node backend keeps
fresh (`WN_HIK_Devices`, `WN_HIK_DevCache` machine snapshots, `WN_HIK_Users`),
so this service is **read-only** and never talks to the Hikvision machines.

## Run

```bash
cd users-module-dotnet
export DB_SERVER=... DB_PORT=1450 DB_USER=... DB_PASSWORD=... DB_NAME=...
dotnet run
```

Open http://localhost:5000 — the Users page loads with live data.

Requires the .NET 8 SDK. Same environment variables as `backend/.env`.

## What is ported (Node → .NET)

| Node (Express)                  | .NET (this module)          | Purpose |
|---------------------------------|-----------------------------|---------|
| `GET /api/devices`              | `GET /api/devices`          | machine list (no connection secrets exposed) |
| `GET /api/roster`               | `GET /api/roster`           | all-machine user rosters from snapshots + CNIC map |
| `GET /api/devices/:id/users`    | `GET /api/devices/{id}/users` | one machine's roster |
| `GET /api/devices/next-employee-no` | `GET /api/next-employee-no` | Add-user number prefill (members < 8500) |

Response shapes mirror the Node API, so frontend code is portable either way.

## Not ported (still Node) — the machine-writing operations

Creating users, renames, role changes, access grants, card/fingerprint/face
captures, deletes and copies all require the Hikvision ISAPI stack (HTTP
Digest auth, person/credential endpoints, offline-op queueing). Porting that
means rewriting `backend/src/isapi.js`, `digestClient.js` and the pending-ops
replay in C#. Until then, point write actions at the Node backend.

## Notes

- **No authentication is included.** The Node dashboard gates these APIs
  behind session auth; wire this module into your own auth (e.g. the HR
  app's) before exposing it beyond localhost.
- Data freshness comes from the Node side's maintenance passes (snapshots
  refresh continuously). This module works even while the Node dashboard is
  running — both read the same tables.
