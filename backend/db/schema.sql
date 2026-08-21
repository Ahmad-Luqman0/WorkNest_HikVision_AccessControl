======================================================================= */

/* ---------------------------------------------------------------------------
   1) DROP TABLES (children first, FK-safe)
--------------------------------------------------------------------------- */
DROP TABLE IF EXISTS dbo.sync_log;
DROP TABLE IF EXISTS dbo.fingerprints;
DROP TABLE IF EXISTS dbo.access_grants;
DROP TABLE IF EXISTS dbo.employees;
DROP TABLE IF EXISTS dbo.devices;
DROP TABLE IF EXISTS dbo.settings;
GO

/* ---------------------------------------------------------------------------
   2) CREATE TABLES
--------------------------------------------------------------------------- */

-- Hikvision access machines 
CREATE TABLE dbo.devices (
  id         INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_devices PRIMARY KEY,
  name       NVARCHAR(100)  NOT NULL,
  host       NVARCHAR(64)   NOT NULL CONSTRAINT UQ_devices_host UNIQUE,  -- LAN IP
  port       INT            NOT NULL CONSTRAINT DF_devices_port DEFAULT (80),
  use_https  BIT            NOT NULL CONSTRAINT DF_devices_https DEFAULT (0),
  username   NVARCHAR(64)   NOT NULL,                 -- device admin account
  password   NVARCHAR(128)  NOT NULL,                 -- device admin password
  location   NVARCHAR(128)  NULL,
  grp        NVARCHAR(64)   NULL,                     -- machine group
  model      NVARCHAR(64)   NULL,
  serial     NVARCHAR(64)   NULL,
  last_seen  DATETIME2(0)   NULL,
  online     BIT            NOT NULL CONSTRAINT DF_devices_online DEFAULT (0),
  created_at DATETIME2(0)   NOT NULL CONSTRAINT DF_devices_created DEFAULT (SYSDATETIME())
);
GO

-- Dashboard-side person records:
--   kind='member' 
--   kind='card'    registered RFID card (backing person record)
--   kind='visitor' day passes & booking attendees (auto_delete after expiry)
CREATE TABLE dbo.employees (
  id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_employees PRIMARY KEY,
  employee_no NVARCHAR(32)   NOT NULL CONSTRAINT UQ_employees_no UNIQUE,
  name        NVARCHAR(128)  NOT NULL,
  card_no     NVARCHAR(32)   NULL,
  face_path   NVARCHAR(260)  NULL,
  valid_begin DATETIME2(0)   NULL,
  valid_end   DATETIME2(0)   NULL,   -- machines enforce this natively
  auto_delete BIT            NOT NULL CONSTRAINT DF_employees_autodel DEFAULT (0),
  status      NVARCHAR(16)   NOT NULL CONSTRAINT DF_employees_status DEFAULT ('active')
              CONSTRAINT CK_employees_status CHECK (status IN ('active','expired')),
  notes       NVARCHAR(MAX)  NULL,
  kind        NVARCHAR(16)   NOT NULL CONSTRAINT DF_employees_kind DEFAULT ('member')
              CONSTRAINT CK_employees_kind CHECK (kind IN ('member','card','visitor')),
  booking_ref NVARCHAR(64)   NULL,   -- external booking system reference
  created_at  DATETIME2(0)   NOT NULL CONSTRAINT DF_employees_created DEFAULT (SYSDATETIME())
);
GO

-- Which machines a dashboard-tracked person is pushed to (+ sync state).
CREATE TABLE dbo.access_grants (
  id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_access_grants PRIMARY KEY,
  employee_id INT            NOT NULL
              CONSTRAINT FK_grants_employee REFERENCES dbo.employees(id) ON DELETE CASCADE,
  device_id   INT            NOT NULL
              CONSTRAINT FK_grants_device REFERENCES dbo.devices(id) ON DELETE CASCADE,
  sync_state  NVARCHAR(16)   NOT NULL CONSTRAINT DF_grants_state DEFAULT ('pending')
              CONSTRAINT CK_grants_state CHECK (sync_state IN ('pending','synced','error','removing')),
  last_error  NVARCHAR(MAX)  NULL,
  synced_at   DATETIME2(0)   NULL,
  CONSTRAINT UQ_grants_emp_dev UNIQUE (employee_id, device_id)
);
GO

-- Fingerprint templates stored dashboard-side (legacy flow).
CREATE TABLE dbo.fingerprints (
  id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_fingerprints PRIMARY KEY,
  employee_id INT            NOT NULL
              CONSTRAINT FK_fp_employee REFERENCES dbo.employees(id) ON DELETE CASCADE,
  finger_no   INT            NOT NULL CONSTRAINT DF_fp_no DEFAULT (1),  -- slot 1..10
  template    NVARCHAR(MAX)  NOT NULL,                                  -- base64
  created_at  DATETIME2(0)   NOT NULL CONSTRAINT DF_fp_created DEFAULT (SYSDATETIME())
);
GO

-- Dashboard activity log.
CREATE TABLE dbo.sync_log (
  id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_sync_log PRIMARY KEY,
  employee_id INT            NULL,
  device_id   INT            NULL,
  action      NVARCHAR(64)   NULL,   -- e.g. 'door:open','sync-face','booking'
  ok          BIT            NULL,
  detail      NVARCHAR(MAX)  NULL,   -- JSON or message
  ts          DATETIME2(0)   NOT NULL CONSTRAINT DF_log_ts DEFAULT (SYSDATETIME())
);
GO

-- Key/value settings (holds the external booking API key).
CREATE TABLE dbo.settings (
  [key]  NVARCHAR(64)  NOT NULL CONSTRAINT PK_settings PRIMARY KEY,
  value  NVARCHAR(256) NULL
);
GO

-- Indexes for the hot paths.
CREATE INDEX IX_sync_log_action      ON dbo.sync_log (action);
CREATE INDEX IX_employees_kind       ON dbo.employees (kind);
CREATE INDEX IX_employees_booking    ON dbo.employees (booking_ref);
CREATE INDEX IX_employees_expiry     ON dbo.employees (status, valid_end);
CREATE INDEX IX_grants_state         ON dbo.access_grants (sync_state);
GO

/* ---------------------------------------------------------------------------
   3) STORED PROCEDURES

--------------------------------------------------------------------------- */

-- Upsert a machine keyed by host (startup seeding / provisioning).
CREATE OR ALTER PROCEDURE dbo.usp_Device_UpsertByHost
  @name NVARCHAR(100), @host NVARCHAR(64), @port INT = 80, @use_https BIT = 0,
  @username NVARCHAR(64), @password NVARCHAR(128),
  @location NVARCHAR(128) = NULL, @grp NVARCHAR(64) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM dbo.devices WITH (NOLOCK) WHERE host = @host)
    UPDATE dbo.devices
       SET name = @name, port = @port, use_https = @use_https,
           username = @username, password = @password,
           location = @location, grp = @grp
     WHERE host = @host;
  ELSE
    INSERT INTO dbo.devices (name, host, port, use_https, username, password, location, grp)
    VALUES (@name, @host, @port, @use_https, @username, @password, @location, @grp);
  SELECT id FROM dbo.devices WITH (NOLOCK) WHERE host = @host;
END
GO

-- Record a connectivity result (Test button / online watchdog).
CREATE OR ALTER PROCEDURE dbo.usp_Device_SetOnline
  @device_id INT, @online BIT, @model NVARCHAR(64) = NULL, @serial NVARCHAR(64) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.devices
     SET online   = @online,
         last_seen = CASE WHEN @online = 1 THEN SYSDATETIME() ELSE last_seen END,
         model    = COALESCE(@model,  model),
         serial   = COALESCE(@serial, serial)
   WHERE id = @device_id;
END
GO

-- Next free person number at or above a floor (visitors/bookings use 9000).
CREATE OR ALTER PROCEDURE dbo.usp_Employee_NextNumber
  @floor INT = 1000
AS
BEGIN
  SET NOCOUNT ON;
  -- next = max(floor - 1, highest numeric employee_no) + 1
  SELECT CASE WHEN MAX(n) IS NULL OR MAX(n) < @floor - 1
              THEN @floor
              ELSE MAX(n) + 1 END AS next_no
  FROM (SELECT TRY_CAST(employee_no AS INT) AS n FROM dbo.employees WITH (NOLOCK)) t
  WHERE n IS NOT NULL;
END
GO

-- Register a card entry (Cards menu / auto-discovered tapped card).
CREATE OR ALTER PROCEDURE dbo.usp_Card_Register
  @employee_no NVARCHAR(32), @name NVARCHAR(128), @card_no NVARCHAR(32),
  @valid_begin DATETIME2(0) = NULL, @valid_end DATETIME2(0) = NULL, @auto_delete BIT = 0
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.employees (employee_no, name, card_no, valid_begin, valid_end, auto_delete, kind)
  VALUES (@employee_no, @name, @card_no, @valid_begin, @valid_end, @auto_delete, 'card');
  SELECT SCOPE_IDENTITY() AS id;
END
GO

-- Create a day-pass visitor or booking attendee (auto-deletes after expiry).
CREATE OR ALTER PROCEDURE dbo.usp_Visitor_Create
  @employee_no NVARCHAR(32), @name NVARCHAR(128), @card_no NVARCHAR(32) = NULL,
  @valid_begin DATETIME2(0), @valid_end DATETIME2(0), @booking_ref NVARCHAR(64) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.employees (employee_no, name, card_no, valid_begin, valid_end,
                             auto_delete, kind, booking_ref)
  VALUES (@employee_no, @name, @card_no, @valid_begin, @valid_end, 1, 'visitor', @booking_ref);
  SELECT SCOPE_IDENTITY() AS id;
END
GO

-- Grant a machine to a person (idempotent; pending until pushed).
CREATE OR ALTER PROCEDURE dbo.usp_Grant_Ensure
  @employee_id INT, @device_id INT
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (SELECT 1 FROM dbo.access_grants WITH (NOLOCK)
                 WHERE employee_id = @employee_id AND device_id = @device_id)
    INSERT INTO dbo.access_grants (employee_id, device_id, sync_state)
    VALUES (@employee_id, @device_id, 'pending');
END
GO

-- Update one grant after a push attempt.
CREATE OR ALTER PROCEDURE dbo.usp_Grant_SetState
  @grant_id INT, @state NVARCHAR(16), @error NVARCHAR(MAX) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.access_grants
     SET sync_state = @state, last_error = @error, synced_at = SYSDATETIME()
   WHERE id = @grant_id;
END
GO

-- Mark all of a person's grants for device-side removal.
CREATE OR ALTER PROCEDURE dbo.usp_Grant_MarkRemoving
  @employee_id INT
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.access_grants SET sync_state = 'removing' WHERE employee_id = @employee_id;
END
GO

-- People with work still queued for the sync engine.
CREATE OR ALTER PROCEDURE dbo.usp_Grant_PendingEmployees
AS
BEGIN
  SET NOCOUNT ON;
  SELECT DISTINCT employee_id
  FROM dbo.access_grants WITH (NOLOCK)
  WHERE sync_state IN ('pending','error','removing');
END
GO

-- Expiry pass: return newly expired people and flip their status.
-- (The app then deletes auto_delete=1 people from their machines.)
CREATE OR ALTER PROCEDURE dbo.usp_Expiry_Run
  @now DATETIME2(0)
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @expired TABLE (id INT, employee_no NVARCHAR(32), auto_delete BIT);
  UPDATE dbo.employees
     SET status = 'expired'
  OUTPUT inserted.id, inserted.employee_no, inserted.auto_delete INTO @expired
   WHERE valid_end IS NOT NULL AND valid_end <= @now AND status = 'active';
  SELECT * FROM @expired;
END
GO

-- Extend / renew a person's access (Extend-30-days, booking reschedule).
CREATE OR ALTER PROCEDURE dbo.usp_Access_Extend
  @employee_no NVARCHAR(32), @valid_end DATETIME2(0), @valid_begin DATETIME2(0) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.employees
     SET valid_end   = @valid_end,
         valid_begin = COALESCE(@valid_begin, valid_begin),
         status      = 'active'
   WHERE employee_no = @employee_no;
END
GO

-- Booking lookups by external reference.
CREATE OR ALTER PROCEDURE dbo.usp_Booking_Attendees
  @ref NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT e.*, g.device_id, g.sync_state, d.name AS device_name
  FROM dbo.employees e WITH (NOLOCK)
  LEFT JOIN dbo.access_grants g WITH (NOLOCK) ON g.employee_id = e.id
  LEFT JOIN dbo.devices d WITH (NOLOCK) ON d.id = g.device_id
  WHERE e.booking_ref = @ref;
END
GO

-- Cancel a booking dashboard-side (device cleanup happens in the app first).
CREATE OR ALTER PROCEDURE dbo.usp_Booking_Delete
  @ref NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.employees WHERE booking_ref = @ref;  -- grants cascade
END
GO

-- Write an activity-log entry.
CREATE OR ALTER PROCEDURE dbo.usp_Log_Write
  @employee_id INT = NULL, @device_id INT = NULL,
  @action NVARCHAR(64), @ok BIT, @detail NVARCHAR(MAX) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.sync_log (employee_id, device_id, action, ok, detail)
  VALUES (@employee_id, @device_id, @action, @ok, @detail);
END
GO

-- Recent activity for the dashboard.
CREATE OR ALTER PROCEDURE dbo.usp_Activity_Recent
  @limit INT = 200
AS
BEGIN
  SET NOCOUNT ON;
  SELECT TOP (@limit)
         l.*, e.name AS employee_name, d.name AS device_name
  FROM dbo.sync_log l WITH (NOLOCK)
  LEFT JOIN dbo.employees e WITH (NOLOCK) ON e.id = l.employee_id
  LEFT JOIN dbo.devices  d WITH (NOLOCK) ON d.id = l.device_id
  ORDER BY l.id DESC;
END
GO

-- Dashboard counters.
CREATE OR ALTER PROCEDURE dbo.usp_Stats_Get
AS
BEGIN
  SET NOCOUNT ON;
  SELECT
    (SELECT COUNT(*) FROM dbo.devices WITH (NOLOCK))                           AS devices,
    (SELECT COUNT(*) FROM dbo.devices WITH (NOLOCK) WHERE online = 1)          AS devicesOnline,
    (SELECT COUNT(*) FROM dbo.employees WITH (NOLOCK) WHERE status = 'active') AS active,
    (SELECT COUNT(*) FROM dbo.employees WITH (NOLOCK) WHERE status = 'expired') AS expired,
    (SELECT COUNT(*) FROM dbo.employees WITH (NOLOCK) WHERE kind = 'card')     AS cards,
    (SELECT COUNT(*) FROM dbo.access_grants WITH (NOLOCK)
      WHERE sync_state IN ('pending','error','removing'))                      AS pendingSync;
END
GO

-- Get / set a settings value (e.g. the external booking API key).
CREATE OR ALTER PROCEDURE dbo.usp_Settings_Get
  @key NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT value FROM dbo.settings WITH (NOLOCK) WHERE [key] = @key;
END
GO

CREATE OR ALTER PROCEDURE dbo.usp_Settings_Set
  @key NVARCHAR(64), @value NVARCHAR(256)
AS
BEGIN
  SET NOCOUNT ON;
  IF EXISTS (SELECT 1 FROM dbo.settings WITH (NOLOCK) WHERE [key] = @key)
    UPDATE dbo.settings SET value = @value WHERE [key] = @key;
  ELSE
    INSERT INTO dbo.settings ([key], value) VALUES (@key, @value);
END
GO
