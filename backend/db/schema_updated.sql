
/* ---------------------------------------------------------------------------
   1) DROP TABLES (children first, FK-safe)
--------------------------------------------------------------------------- */
DROP TABLE IF EXISTS dbo.WN_HIK_SyncLog;
DROP TABLE IF EXISTS dbo.WN_HIK_Fingerprints;
DROP TABLE IF EXISTS dbo.WN_HIK_AccessGrants;
DROP TABLE IF EXISTS dbo.WN_HIK_Employees;
DROP TABLE IF EXISTS dbo.WN_HIK_Devices;
DROP TABLE IF EXISTS dbo.WN_HIK_Settings;
GO

/* ---------------------------------------------------------------------------
   2) CREATE TABLES
--------------------------------------------------------------------------- */

-- Hikvision access machines 
CREATE TABLE dbo.WN_HIK_Devices (
  id         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WN_HIK_Devices PRIMARY KEY,
  name       NVARCHAR(100)  NOT NULL,
  host       NVARCHAR(64)   NOT NULL,  -- LAN IP or public IP (port-forwarded)
  port       INT            NOT NULL CONSTRAINT DF_WN_HIK_Devices_port DEFAULT (80),
  use_https  BIT            NOT NULL CONSTRAINT DF_WN_HIK_Devices_https DEFAULT (0),
  username   NVARCHAR(64)   NOT NULL,                 -- device admin account
  password   NVARCHAR(128)  NOT NULL,                 -- device admin password
  location   NVARCHAR(128)  NULL,
  grp        NVARCHAR(64)   NULL,                     -- machine group
  model      NVARCHAR(64)   NULL,
  serial     NVARCHAR(64)   NULL,
  last_seen  DATETIME2(0)   NULL,
  online     BIT            NOT NULL CONSTRAINT DF_WN_HIK_Devices_online DEFAULT (0),
  created_at DATETIME2(0)   NOT NULL CONSTRAINT DF_WN_HIK_Devices_created DEFAULT (SYSDATETIME()),
  -- several machines may share one public IP on different forwarded ports
  CONSTRAINT UQ_WN_HIK_Devices_host_port UNIQUE (host, port)
);
GO

-- Dashboard-side person records:
--   kind='member' 
--   kind='card'    registered RFID card (backing person record)
--   kind='visitor' day passes & booking attendees (auto_delete after expiry)
CREATE TABLE dbo.WN_HIK_Employees (
  id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WN_HIK_Employees PRIMARY KEY,
  employee_no NVARCHAR(32)   NOT NULL CONSTRAINT UQ_WN_HIK_Employees_no UNIQUE,
  name        NVARCHAR(128)  NOT NULL,
  card_no     NVARCHAR(32)   NULL,
  face_path   NVARCHAR(260)  NULL,
  valid_begin DATETIME2(0)   NULL,
  valid_end   DATETIME2(0)   NULL,   -- machines enforce this natively
  auto_delete BIT            NOT NULL CONSTRAINT DF_WN_HIK_Employees_autodel DEFAULT (0),
  status      NVARCHAR(16)   NOT NULL CONSTRAINT DF_WN_HIK_Employees_status DEFAULT ('active')
              CONSTRAINT CK_WN_HIK_Employees_status CHECK (status IN ('active','expired')),
  notes       NVARCHAR(MAX)  NULL,
  kind        NVARCHAR(16)   NOT NULL CONSTRAINT DF_WN_HIK_Employees_kind DEFAULT ('member')
              CONSTRAINT CK_WN_HIK_Employees_kind CHECK (kind IN ('member','card','visitor')),
  booking_ref NVARCHAR(64)   NULL,   -- external booking system reference
  created_at  DATETIME2(0)   NOT NULL CONSTRAINT DF_WN_HIK_Employees_created DEFAULT (SYSDATETIME())
);
GO

-- Which machines a dashboard-tracked person is pushed to (+ sync state).
CREATE TABLE dbo.WN_HIK_AccessGrants (
  id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WN_HIK_AccessGrants PRIMARY KEY,
  employee_id INT            NOT NULL
              CONSTRAINT FK_WN_HIK_grants_employee REFERENCES dbo.WN_HIK_Employees(id) ON DELETE CASCADE,
  device_id   INT            NOT NULL
              CONSTRAINT FK_WN_HIK_grants_device REFERENCES dbo.WN_HIK_Devices(id) ON DELETE CASCADE,
  sync_state  NVARCHAR(16)   NOT NULL CONSTRAINT DF_WN_HIK_grants_state DEFAULT ('pending')
              CONSTRAINT CK_WN_HIK_grants_state CHECK (sync_state IN ('pending','synced','error','removing')),
  last_error  NVARCHAR(MAX)  NULL,
  synced_at   DATETIME2(0)   NULL,
  CONSTRAINT UQ_WN_HIK_grants_emp_dev UNIQUE (employee_id, device_id)
);
GO

-- Fingerprint templates stored dashboard-side (legacy flow).
CREATE TABLE dbo.WN_HIK_Fingerprints (
  id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WN_HIK_Fingerprints PRIMARY KEY,
  employee_id INT            NOT NULL
              CONSTRAINT FK_WN_HIK_fp_employee REFERENCES dbo.WN_HIK_Employees(id) ON DELETE CASCADE,
  finger_no   INT            NOT NULL CONSTRAINT DF_WN_HIK_fp_no DEFAULT (1),  -- slot 1..10
  template    NVARCHAR(MAX)  NOT NULL,                                  -- base64
  created_at  DATETIME2(0)   NOT NULL CONSTRAINT DF_WN_HIK_fp_created DEFAULT (SYSDATETIME())
);
GO

-- Dashboard activity log.
CREATE TABLE dbo.WN_HIK_SyncLog (
  id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WN_HIK_SyncLog PRIMARY KEY,
  employee_id INT            NULL,
  device_id   INT            NULL,
  action      NVARCHAR(64)   NULL,   -- e.g. 'door:open','sync-face','booking'
  ok          BIT            NULL,
  detail      NVARCHAR(MAX)  NULL,   -- JSON or message
  ts          DATETIME2(0)   NOT NULL CONSTRAINT DF_WN_HIK_log_ts DEFAULT (SYSDATETIME())
);
GO

-- Key/value settings (holds the external booking API key).
CREATE TABLE dbo.WN_HIK_Settings (
  [key]  NVARCHAR(64)  NOT NULL CONSTRAINT PK_WN_HIK_Settings PRIMARY KEY,
  value  NVARCHAR(256) NULL
);
GO

-- Indexes for the hot paths.
CREATE INDEX IX_WN_HIK_SyncLog_action      ON dbo.WN_HIK_SyncLog (action);
CREATE INDEX IX_WN_HIK_Employees_kind       ON dbo.WN_HIK_Employees (kind);
CREATE INDEX IX_WN_HIK_Employees_booking    ON dbo.WN_HIK_Employees (booking_ref);
CREATE INDEX IX_WN_HIK_Employees_expiry     ON dbo.WN_HIK_Employees (status, valid_end);
CREATE INDEX IX_WN_HIK_grants_state         ON dbo.WN_HIK_AccessGrants (sync_state);
GO

/* ---------------------------------------------------------------------------
   3) STORED PROCEDURES

--------------------------------------------------------------------------- */

-- Upsert a machine keyed by host (startup seeding / provisioning).
CREATE OR ALTER PROCEDURE dbo.WN_HIK_Device_UpsertByHost
  @name NVARCHAR(100), @host NVARCHAR(64), @port INT = 80, @use_https BIT = 0,
  @username NVARCHAR(64), @password NVARCHAR(128),
  @location NVARCHAR(128) = NULL, @grp NVARCHAR(64) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  -- keyed by host + port: several machines can share one public IP
  IF EXISTS (SELECT 1 FROM dbo.WN_HIK_Devices WITH (NOLOCK) WHERE host = @host AND port = @port)
    UPDATE dbo.WN_HIK_Devices
       SET name = @name, use_https = @use_https,
           username = @username, password = @password,
           location = @location, grp = @grp
     WHERE host = @host AND port = @port;
  ELSE
    INSERT INTO dbo.WN_HIK_Devices (name, host, port, use_https, username, password, location, grp)
    VALUES (@name, @host, @port, @use_https, @username, @password, @location, @grp);
  SELECT id FROM dbo.WN_HIK_Devices WITH (NOLOCK) WHERE host = @host AND port = @port;
END
GO

-- Record a connectivity result (Test button / online watchdog).
CREATE OR ALTER PROCEDURE dbo.WN_HIK_Device_SetOnline
  @device_id INT, @online BIT, @model NVARCHAR(64) = NULL, @serial NVARCHAR(64) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.WN_HIK_Devices
     SET online   = @online,
         last_seen = CASE WHEN @online = 1 THEN SYSDATETIME() ELSE last_seen END,
         model    = COALESCE(@model,  model),
         serial   = COALESCE(@serial, serial)
   WHERE id = @device_id;
END
GO

-- Next free person number at or above a floor (visitors/bookings use 9000).
CREATE OR ALTER PROCEDURE dbo.WN_HIK_Employee_NextNumber
  @floor INT = 1000
AS
BEGIN
  SET NOCOUNT ON;
  -- next = max(floor - 1, highest numeric employee_no) + 1
  SELECT CASE WHEN MAX(n) IS NULL OR MAX(n) < @floor - 1
              THEN @floor
              ELSE MAX(n) + 1 END AS next_no
  FROM (SELECT TRY_CAST(employee_no AS INT) AS n FROM dbo.WN_HIK_Employees WITH (NOLOCK)) t
  WHERE n IS NOT NULL;
END
GO

-- Register a card entry (Cards menu / auto-discovered tapped card).
CREATE OR ALTER PROCEDURE dbo.WN_HIK_Card_Register
  @employee_no NVARCHAR(32), @name NVARCHAR(128), @card_no NVARCHAR(32),
  @valid_begin DATETIME2(0) = NULL, @valid_end DATETIME2(0) = NULL, @auto_delete BIT = 0
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.WN_HIK_Employees (employee_no, name, card_no, valid_begin, valid_end, auto_delete, kind)
  VALUES (@employee_no, @name, @card_no, @valid_begin, @valid_end, @auto_delete, 'card');
  SELECT SCOPE_IDENTITY() AS id;
END
GO

-- Create a day-pass visitor or booking attendee (auto-deletes after expiry).
CREATE OR ALTER PROCEDURE dbo.WN_HIK_Visitor_Create
  @employee_no NVARCHAR(32), @name NVARCHAR(128), @card_no NVARCHAR(32) = NULL,
  @valid_begin DATETIME2(0), @valid_end DATETIME2(0), @booking_ref NVARCHAR(64) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.WN_HIK_Employees (employee_no, name, card_no, valid_begin, valid_end,
                             auto_delete, kind, booking_ref)
  VALUES (@employee_no, @name, @card_no, @valid_begin, @valid_end, 1, 'visitor', @booking_ref);
  SELECT SCOPE_IDENTITY() AS id;
END
GO

-- Grant a machine to a person (idempotent; pending until pushed).
CREATE OR ALTER PROCEDURE dbo.WN_HIK_Grant_Ensure
  @employee_id INT, @device_id INT
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM dbo.WN_HIK_AccessGrants WITH (NOLOCK)
                 WHERE employee_id = @employee_id AND device_id = @device_id)
    INSERT INTO dbo.WN_HIK_AccessGrants (employee_id, device_id, sync_state)
    VALUES (@employee_id, @device_id, 'pending');
END
GO

-- Update one grant after a push attempt.
CREATE OR ALTER PROCEDURE dbo.WN_HIK_Grant_SetState
  @grant_id INT, @state NVARCHAR(16), @error NVARCHAR(MAX) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.WN_HIK_AccessGrants
     SET sync_state = @state, last_error = @error, synced_at = SYSDATETIME()
   WHERE id = @grant_id;
END
GO

-- Mark all of a person's grants for device-side removal.
CREATE OR ALTER PROCEDURE dbo.WN_HIK_Grant_MarkRemoving
  @employee_id INT
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.WN_HIK_AccessGrants SET sync_state = 'removing' WHERE employee_id = @employee_id;
END
GO

-- People with work still queued for the sync engine.
CREATE OR ALTER PROCEDURE dbo.WN_HIK_Grant_PendingEmployees
AS
BEGIN
  SET NOCOUNT ON;
  SELECT DISTINCT employee_id
  FROM dbo.WN_HIK_AccessGrants WITH (NOLOCK)
  WHERE sync_state IN ('pending','error','removing');
END
GO

-- Expiry pass: return newly expired people and flip their status.
-- (The app then deletes auto_delete=1 people from their machines.)
CREATE OR ALTER PROCEDURE dbo.WN_HIK_Expiry_Run
  @now DATETIME2(0)
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @expired TABLE (id INT, employee_no NVARCHAR(32), auto_delete BIT);
  UPDATE dbo.WN_HIK_Employees
     SET status = 'expired'
  OUTPUT inserted.id, inserted.employee_no, inserted.auto_delete INTO @expired
   WHERE valid_end IS NOT NULL AND valid_end <= @now AND status = 'active';
  SELECT * FROM @expired;
END
GO

-- Extend / renew a person's access (Extend-30-days, booking reschedule).
CREATE OR ALTER PROCEDURE dbo.WN_HIK_Access_Extend
  @employee_no NVARCHAR(32), @valid_end DATETIME2(0), @valid_begin DATETIME2(0) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.WN_HIK_Employees
     SET valid_end   = @valid_end,
         valid_begin = COALESCE(@valid_begin, valid_begin),
         status      = 'active'
   WHERE employee_no = @employee_no;
END
GO

-- Booking lookups by external reference.
CREATE OR ALTER PROCEDURE dbo.WN_HIK_Booking_Attendees
  @ref NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT e.*, g.device_id, g.sync_state, d.name AS device_name
  FROM dbo.WN_HIK_Employees e WITH (NOLOCK)
  LEFT JOIN dbo.WN_HIK_AccessGrants g WITH (NOLOCK) ON g.employee_id = e.id
  LEFT JOIN dbo.WN_HIK_Devices d WITH (NOLOCK) ON d.id = g.device_id
  WHERE e.booking_ref = @ref;
END
GO

-- Cancel a booking dashboard-side (device cleanup happens in the app first).
CREATE OR ALTER PROCEDURE dbo.WN_HIK_Booking_Delete
  @ref NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.WN_HIK_Employees WHERE booking_ref = @ref;  -- grants cascade
END
GO

-- Write an activity-log entry.
CREATE OR ALTER PROCEDURE dbo.WN_HIK_Log_Write
  @employee_id INT = NULL, @device_id INT = NULL,
  @action NVARCHAR(64), @ok BIT, @detail NVARCHAR(MAX) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.WN_HIK_SyncLog (employee_id, device_id, action, ok, detail)
  VALUES (@employee_id, @device_id, @action, @ok, @detail);
END
GO

-- Recent activity for the dashboard.
CREATE OR ALTER PROCEDURE dbo.WN_HIK_Activity_Recent
  @limit INT = 200
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (@limit)
         l.*, e.name AS employee_name, d.name AS device_name
  FROM dbo.WN_HIK_SyncLog l WITH (NOLOCK)
  LEFT JOIN dbo.WN_HIK_Employees e WITH (NOLOCK) ON e.id = l.employee_id
  LEFT JOIN dbo.WN_HIK_Devices  d WITH (NOLOCK) ON d.id = l.device_id
  ORDER BY l.id DESC;
END
GO

-- Dashboard counters.
CREATE OR ALTER PROCEDURE dbo.WN_HIK_Stats_Get
AS
BEGIN
  SET NOCOUNT ON;
  SELECT
    (SELECT COUNT(*) FROM dbo.WN_HIK_Devices WITH (NOLOCK))                           AS devices,
    (SELECT COUNT(*) FROM dbo.WN_HIK_Devices WITH (NOLOCK) WHERE online = 1)          AS devicesOnline,
    (SELECT COUNT(*) FROM dbo.WN_HIK_Employees WITH (NOLOCK) WHERE status = 'active') AS active,
    (SELECT COUNT(*) FROM dbo.WN_HIK_Employees WITH (NOLOCK) WHERE status = 'expired') AS expired,
    (SELECT COUNT(*) FROM dbo.WN_HIK_Employees WITH (NOLOCK) WHERE kind = 'card')     AS cards,
    (SELECT COUNT(*) FROM dbo.WN_HIK_AccessGrants WITH (NOLOCK)
      WHERE sync_state IN ('pending','error','removing'))                      AS pendingSync;
END
GO

-- Get / set a settings value (e.g. the external booking API key).
CREATE OR ALTER PROCEDURE dbo.WN_HIK_Settings_Get
  @key NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT value FROM dbo.WN_HIK_Settings WITH (NOLOCK) WHERE [key] = @key;
END
GO

CREATE OR ALTER PROCEDURE dbo.WN_HIK_Settings_Set
  @key NVARCHAR(64), @value NVARCHAR(256)
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM dbo.WN_HIK_Settings WITH (NOLOCK) WHERE [key] = @key)
    UPDATE dbo.WN_HIK_Settings SET value = @value WHERE [key] = @key;
  ELSE
    INSERT INTO dbo.WN_HIK_Settings ([key], value) VALUES (@key, @value);
END
GO

/* ---------------------------------------------------------------------------
   4) DASHBOARD LOGIN
--------------------------------------------------------------------------- */

-- Dashboard login accounts (scrypt password hashes, set by the app).
IF OBJECT_ID('dbo.WN_HIK_DashboardUsers','U') IS NULL
CREATE TABLE dbo.WN_HIK_DashboardUsers (
  id            INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_WN_HIK_DashboardUsers PRIMARY KEY,
  username      NVARCHAR(64)  NOT NULL CONSTRAINT UQ_WN_HIK_DashboardUsers_username UNIQUE,
  password_hash NVARCHAR(256) NOT NULL,
  created_at    DATETIME2(0)  NOT NULL CONSTRAINT DF_WN_HIK_DashboardUsers_created DEFAULT (SYSDATETIME()),
  updated_at    DATETIME2(0)  NULL
);
GO

-- Fetch one login account (hash verified by the app).
CREATE OR ALTER PROCEDURE dbo.WN_HIK_DashUser_Get
  @username NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, username, password_hash FROM dbo.WN_HIK_DashboardUsers WITH (NOLOCK) WHERE username = @username;
END
GO

-- How many accounts exist (0 -> the app seeds the default admin).
CREATE OR ALTER PROCEDURE dbo.WN_HIK_DashUser_Count
AS
BEGIN
  SET NOCOUNT ON;
  SELECT COUNT(*) AS n FROM dbo.WN_HIK_DashboardUsers WITH (NOLOCK);
END
GO

-- Create an account or replace its password hash.
CREATE OR ALTER PROCEDURE dbo.WN_HIK_DashUser_Upsert
  @username NVARCHAR(64), @password_hash NVARCHAR(256)
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM dbo.WN_HIK_DashboardUsers WITH (NOLOCK) WHERE username = @username)
    UPDATE dbo.WN_HIK_DashboardUsers
       SET password_hash = @password_hash, updated_at = SYSDATETIME()
     WHERE username = @username;
  ELSE
    INSERT INTO dbo.WN_HIK_DashboardUsers (username, password_hash) VALUES (@username, @password_hash);
END
GO

-- Rename an account (used by change-password when a new username is given).
CREATE OR ALTER PROCEDURE dbo.WN_HIK_DashUser_Rename
  @old_username NVARCHAR(64), @new_username NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.WN_HIK_DashboardUsers
     SET username = @new_username, updated_at = SYSDATETIME()
   WHERE username = @old_username;
END
GO

-- Roles for dashboard logins: 'admin' manages accounts, 'user' operates only.
IF COL_LENGTH('dbo.WN_HIK_DashboardUsers','role') IS NULL
ALTER TABLE dbo.WN_HIK_DashboardUsers ADD role NVARCHAR(16) NOT NULL CONSTRAINT DF_WN_HIK_DashboardUsers_role DEFAULT ('user');
GO

CREATE OR ALTER PROCEDURE dbo.WN_HIK_DashUser_Get
  @username NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, username, password_hash, role FROM dbo.WN_HIK_DashboardUsers WITH (NOLOCK) WHERE username = @username;
END
GO

CREATE OR ALTER PROCEDURE dbo.WN_HIK_DashUser_Upsert
  @username NVARCHAR(64), @password_hash NVARCHAR(256), @role NVARCHAR(16) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM dbo.WN_HIK_DashboardUsers WITH (NOLOCK) WHERE username = @username)
    UPDATE dbo.WN_HIK_DashboardUsers
       SET password_hash = @password_hash,
           role = COALESCE(@role, role),
           updated_at = SYSDATETIME()
     WHERE username = @username;
  ELSE
    INSERT INTO dbo.WN_HIK_DashboardUsers (username, password_hash, role)
    VALUES (@username, @password_hash, COALESCE(@role, 'user'));
END
GO

-- All accounts (admin management list).
CREATE OR ALTER PROCEDURE dbo.WN_HIK_DashUser_List
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, username, role, created_at, updated_at FROM dbo.WN_HIK_DashboardUsers WITH (NOLOCK) ORDER BY username;
END
GO

-- Remove a login account.
CREATE OR ALTER PROCEDURE dbo.WN_HIK_DashUser_Delete
  @username NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.WN_HIK_DashboardUsers WHERE username = @username;
END
GO


-- Migration for existing databases: host uniqueness becomes (host, port).
IF EXISTS (SELECT 1 FROM sys.key_constraints WHERE name='UQ_WN_HIK_Devices_host')
  ALTER TABLE dbo.WN_HIK_Devices DROP CONSTRAINT UQ_WN_HIK_Devices_host;
GO
IF NOT EXISTS (SELECT 1 FROM sys.key_constraints WHERE name='UQ_WN_HIK_Devices_host_port')
  ALTER TABLE dbo.WN_HIK_Devices ADD CONSTRAINT UQ_WN_HIK_Devices_host_port UNIQUE (host, port);
GO
