-- WorkNest Access Control — WN_HIK_* schema
-- GENERATED FROM THE LIVE DATABASE on 2026-09-25.
-- The runtime creates/migrates everything itself (src/db.js ensure* functions
-- + stored procedures); this file is reference documentation of the current
-- state, regenerate it after schema changes rather than editing by hand.

CREATE TABLE dbo.WN_HIK_AccessGrants (
  id INT IDENTITY(1,1) NOT NULL,
  employee_id INT NOT NULL,
  device_id INT NOT NULL,
  sync_state NVARCHAR(16) NOT NULL DEFAULT ('pending'),
  last_error NVARCHAR(MAX) NULL,
  synced_at DATETIME2(0) NULL
);
GO
CREATE INDEX IX_WN_HIK_grants_state ON dbo.WN_HIK_AccessGrants (sync_state);
GO
ALTER TABLE dbo.WN_HIK_AccessGrants ADD CONSTRAINT PK_WN_HIK_AccessGrants PRIMARY KEY (id);
GO
CREATE UNIQUE INDEX UQ_WN_HIK_grants_emp_dev ON dbo.WN_HIK_AccessGrants (employee_id, device_id);
GO

CREATE TABLE dbo.WN_HIK_Cards (
  id INT IDENTITY(1,1) NOT NULL,
  employee_no NVARCHAR(32) NULL,
  employee_name NVARCHAR(128) NULL,
  name NVARCHAR(128) NOT NULL,
  card_no NVARCHAR(32) NULL,
  valid_begin DATETIME2(7) NULL,
  valid_end DATETIME2(7) NULL,
  auto_delete BIT NOT NULL DEFAULT ((0)),
  status NVARCHAR(16) NOT NULL DEFAULT ('active'),
  notes NVARCHAR(MAX) NULL,
  booking_ref NVARCHAR(64) NULL,
  created_at DATETIME2(7) NOT NULL DEFAULT (sysdatetime())
);
GO
ALTER TABLE dbo.WN_HIK_Cards ADD CONSTRAINT PK_WN_HIK_Cards PRIMARY KEY (id);
GO

CREATE TABLE dbo.WN_HIK_DashboardUsers (
  id INT IDENTITY(1,1) NOT NULL,
  username NVARCHAR(64) NOT NULL,
  password_hash NVARCHAR(256) NOT NULL,
  created_at DATETIME2(0) NOT NULL DEFAULT (sysdatetime()),
  updated_at DATETIME2(0) NULL,
  role NVARCHAR(16) NOT NULL DEFAULT ('user')
);
GO
ALTER TABLE dbo.WN_HIK_DashboardUsers ADD CONSTRAINT PK_WN_HIK_DashboardUsers PRIMARY KEY (id);
GO
CREATE UNIQUE INDEX UQ_WN_HIK_DashboardUsers_username ON dbo.WN_HIK_DashboardUsers (username);
GO

CREATE TABLE dbo.WN_HIK_DevCache (
  device_id INT NOT NULL,
  roster NVARCHAR(MAX) NULL,
  roster_at DATETIME2(0) NULL,
  cards NVARCHAR(MAX) NULL,
  cards_at DATETIME2(0) NULL
);
GO
ALTER TABLE dbo.WN_HIK_DevCache ADD CONSTRAINT PK_WN_HIK_DevCache PRIMARY KEY (device_id);
GO

CREATE TABLE dbo.WN_HIK_Devices (
  id INT IDENTITY(1,1) NOT NULL,
  name NVARCHAR(100) NOT NULL,
  host NVARCHAR(64) NOT NULL,
  port INT NOT NULL DEFAULT ((80)),
  use_https BIT NOT NULL DEFAULT ((0)),
  username NVARCHAR(64) NOT NULL,
  password NVARCHAR(128) NOT NULL,
  location NVARCHAR(128) NULL,
  grp NVARCHAR(64) NULL,
  model NVARCHAR(64) NULL,
  serial NVARCHAR(64) NULL,
  last_seen DATETIME2(0) NULL,
  online BIT NOT NULL DEFAULT ((0)),
  created_at DATETIME2(0) NOT NULL DEFAULT (sysdatetime()),
  code NVARCHAR(32) NULL,
  host2 NVARCHAR(64) NULL
);
GO
ALTER TABLE dbo.WN_HIK_Devices ADD CONSTRAINT PK_WN_HIK_Devices PRIMARY KEY (id);
GO
CREATE UNIQUE INDEX UQ_WN_HIK_Devices_host_port ON dbo.WN_HIK_Devices (host, port);
GO

CREATE TABLE dbo.WN_HIK_EventCategories (
  code INT NOT NULL,
  label NVARCHAR(64) NOT NULL,
  is_denied BIT NOT NULL DEFAULT ((0))
);
GO
ALTER TABLE dbo.WN_HIK_EventCategories ADD CONSTRAINT PK_WN_HIK_EventCategories PRIMARY KEY (code);
GO

CREATE TABLE dbo.WN_HIK_Events (
  id INT IDENTITY(1,1) NOT NULL,
  device_id INT NOT NULL,
  device_name NVARCHAR(100) NULL,
  employee_no NVARCHAR(32) NULL,
  name NVARCHAR(128) NULL,
  card_no NVARCHAR(32) NULL,
  access_event INT NULL,
  machine_event_no BIGINT NULL,
  event_time DATETIME2(0) NOT NULL,
  created_at DATETIME2(0) NOT NULL DEFAULT (sysdatetime()),
  access_event_details NVARCHAR(64) NULL
);
GO
CREATE INDEX IX_WN_HIK_Events_emp ON dbo.WN_HIK_Events (employee_no, event_time);
GO
CREATE INDEX IX_WN_HIK_Events_time ON dbo.WN_HIK_Events (event_time);
GO
ALTER TABLE dbo.WN_HIK_Events ADD CONSTRAINT PK_WN_HIK_Events PRIMARY KEY (id);
GO
CREATE UNIQUE INDEX UX_WN_HIK_Events_dev_serial ON dbo.WN_HIK_Events (device_id, machine_event_no, event_time) WHERE ([machine_event_no] IS NOT NULL);
GO

CREATE TABLE dbo.WN_HIK_FaceVault (
  id INT IDENTITY(1,1) NOT NULL,
  employee_no NVARCHAR(32) NOT NULL,
  name NVARCHAR(128) NOT NULL,
  model_data NVARCHAR(MAX) NOT NULL,
  updated_at DATETIME2(0) NOT NULL DEFAULT (sysdatetime())
);
GO
ALTER TABLE dbo.WN_HIK_FaceVault ADD CONSTRAINT PK_WN_HIK_FaceVault PRIMARY KEY (id);
GO
CREATE UNIQUE INDEX UQ_WN_HIK_FaceVault ON dbo.WN_HIK_FaceVault (employee_no, name);
GO

CREATE TABLE dbo.WN_HIK_FpVault (
  id INT IDENTITY(1,1) NOT NULL,
  employee_no NVARCHAR(32) NOT NULL,
  name NVARCHAR(128) NOT NULL,
  finger_no INT NOT NULL DEFAULT ((1)),
  template NVARCHAR(MAX) NOT NULL,
  updated_at DATETIME2(0) NOT NULL DEFAULT (sysdatetime())
);
GO
ALTER TABLE dbo.WN_HIK_FpVault ADD CONSTRAINT PK_WN_HIK_FpVault PRIMARY KEY (id);
GO
CREATE UNIQUE INDEX UQ_WN_HIK_FpVault ON dbo.WN_HIK_FpVault (employee_no, name, finger_no);
GO

CREATE TABLE dbo.WN_HIK_PendingOps (
  id INT IDENTITY(1,1) NOT NULL,
  device_id INT NOT NULL,
  op NVARCHAR(32) NOT NULL,
  employee_no NVARCHAR(32) NULL,
  payload NVARCHAR(MAX) NULL,
  attempts INT NOT NULL DEFAULT ((0)),
  last_error NVARCHAR(MAX) NULL,
  created_at DATETIME2(0) NOT NULL DEFAULT (sysdatetime())
);
GO
ALTER TABLE dbo.WN_HIK_PendingOps ADD CONSTRAINT PK_WN_HIK_PendingOps PRIMARY KEY (id);
GO

CREATE TABLE dbo.WN_HIK_Settings (
  key NVARCHAR(64) NOT NULL,
  value NVARCHAR(256) NULL
);
GO
ALTER TABLE dbo.WN_HIK_Settings ADD CONSTRAINT PK_WN_HIK_Settings PRIMARY KEY (key);
GO

CREATE TABLE dbo.WN_HIK_SyncLog (
  id INT IDENTITY(1,1) NOT NULL,
  employee_id INT NULL,
  device_id INT NULL,
  action NVARCHAR(64) NULL,
  ok BIT NULL,
  detail NVARCHAR(MAX) NULL,
  ts DATETIME2(0) NOT NULL DEFAULT (sysdatetime())
);
GO
CREATE INDEX IX_WN_HIK_SyncLog_action ON dbo.WN_HIK_SyncLog (action);
GO
ALTER TABLE dbo.WN_HIK_SyncLog ADD CONSTRAINT PK_WN_HIK_SyncLog PRIMARY KEY (id);
GO

CREATE TABLE dbo.WN_HIK_Users (
  id INT IDENTITY(1,1) NOT NULL,
  employee_no NVARCHAR(32) NOT NULL,
  name NVARCHAR(128) NOT NULL,
  room NVARCHAR(256) NULL,
  role NVARCHAR(16) NOT NULL DEFAULT ('user'),
  machines NVARCHAR(MAX) NULL,
  machine_count INT NOT NULL DEFAULT ((0)),
  updated_at DATETIME2(0) NOT NULL DEFAULT (sysdatetime()),
  cnic NVARCHAR(20) NULL
);
GO
ALTER TABLE dbo.WN_HIK_Users ADD CONSTRAINT PK_WN_HIK_Users PRIMARY KEY (id);
GO
CREATE UNIQUE INDEX UQ_WN_HIK_Users ON dbo.WN_HIK_Users (employee_no, name);
GO

CREATE TABLE dbo.WN_HIK_Visitors (
  id INT IDENTITY(1,1) NOT NULL,
  employee_no NVARCHAR(32) NOT NULL,
  name NVARCHAR(128) NOT NULL,
  card_no NVARCHAR(32) NULL,
  face_path NVARCHAR(260) NULL,
  valid_begin DATETIME2(7) NULL,
  valid_end DATETIME2(7) NULL,
  auto_delete BIT NOT NULL DEFAULT ((0)),
  status NVARCHAR(16) NOT NULL DEFAULT ('active'),
  notes NVARCHAR(MAX) NULL,
  booking_ref NVARCHAR(64) NULL,
  created_at DATETIME2(7) NOT NULL DEFAULT (sysdatetime())
);
GO
ALTER TABLE dbo.WN_HIK_Visitors ADD CONSTRAINT PK_WN_HIK_Visitors PRIMARY KEY (id);
GO

ALTER TABLE dbo.WN_HIK_AccessGrants ADD CONSTRAINT FK_WN_HIK_grants_device FOREIGN KEY (device_id) REFERENCES dbo.WN_HIK_Devices(id) ON DELETE CASCADE;
GO

-- ===================== VIEWS, PROCEDURES, TRIGGERS =====================

-- VIEW: WN_HIK_Employees
CREATE   VIEW dbo.WN_HIK_Employees AS
  SELECT id, employee_no, name, card_no, CAST(NULL AS NVARCHAR(260)) AS face_path, valid_begin, valid_end, auto_delete, status, notes, CAST('card' AS NVARCHAR(16)) AS kind, booking_ref, created_at FROM dbo.WN_HIK_Cards
  UNION ALL
  SELECT id, employee_no, name, card_no, face_path, valid_begin, valid_end, auto_delete, status, notes, CAST('visitor' AS NVARCHAR(16)) AS kind, booking_ref, created_at FROM dbo.WN_HIK_Visitors
GO

-- SQL_STORED_PROCEDURE: WN_HIK_Access_Extend
CREATE   PROCEDURE dbo.WN_HIK_Access_Extend
  @employee_no NVARCHAR(32), @valid_end DATETIME2(0), @valid_begin DATETIME2(0) = NULL AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.WN_HIK_Cards SET valid_end = @valid_end, valid_begin = COALESCE(@valid_begin, valid_begin), status = 'active' WHERE employee_no = @employee_no;
  UPDATE dbo.WN_HIK_Visitors SET valid_end = @valid_end, valid_begin = COALESCE(@valid_begin, valid_begin), status = 'active' WHERE employee_no = @employee_no;
END
GO

-- SQL_STORED_PROCEDURE: WN_HIK_Activity_Recent
-- Recent activity for the dashboard.
CREATE   PROCEDURE [dbo].[WN_HIK_Activity_Recent]
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

-- SQL_STORED_PROCEDURE: WN_HIK_Booking_Attendees
-- Booking lookups by external reference.
CREATE   PROCEDURE [dbo].[WN_HIK_Booking_Attendees]
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

-- SQL_STORED_PROCEDURE: WN_HIK_Booking_Delete
CREATE   PROCEDURE dbo.WN_HIK_Booking_Delete @ref NVARCHAR(64) AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.WN_HIK_Visitors WHERE booking_ref = @ref;  -- grants cascade via TR_WN_HIK_Visitors_GrantCascade
END
GO

-- SQL_STORED_PROCEDURE: WN_HIK_Card_Register
CREATE   PROCEDURE dbo.WN_HIK_Card_Register
  @employee_no NVARCHAR(32) = NULL, @name NVARCHAR(128), @card_no NVARCHAR(32),
  @valid_begin DATETIME2(0) = NULL, @valid_end DATETIME2(0) = NULL, @auto_delete BIT = 0 AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.WN_HIK_Cards (employee_no, name, card_no, valid_begin, valid_end, auto_delete)
  VALUES (@employee_no, @name, @card_no, @valid_begin, @valid_end, @auto_delete);
  SELECT SCOPE_IDENTITY() AS id;
END
GO

-- SQL_STORED_PROCEDURE: WN_HIK_DashUser_Count
CREATE   PROCEDURE [dbo].[WN_HIK_DashUser_Count]
AS
BEGIN
  SET NOCOUNT ON;
  SELECT COUNT(*) AS n FROM dbo.WN_HIK_DashboardUsers WITH (NOLOCK);
END
GO

-- SQL_STORED_PROCEDURE: WN_HIK_DashUser_Delete
CREATE   PROCEDURE [dbo].[WN_HIK_DashUser_Delete]
  @username NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  DELETE FROM dbo.WN_HIK_DashboardUsers WHERE username = @username;
END
GO

-- SQL_STORED_PROCEDURE: WN_HIK_DashUser_Get
CREATE   PROCEDURE [dbo].[WN_HIK_DashUser_Get]
  @username NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, username, password_hash, role FROM dbo.WN_HIK_DashboardUsers WITH (NOLOCK) WHERE username = @username;
END
GO

-- SQL_STORED_PROCEDURE: WN_HIK_DashUser_List
CREATE   PROCEDURE [dbo].[WN_HIK_DashUser_List]
AS
BEGIN
  SET NOCOUNT ON;
  SELECT id, username, role, created_at, updated_at FROM dbo.WN_HIK_DashboardUsers WITH (NOLOCK) ORDER BY username;
END
GO

-- SQL_STORED_PROCEDURE: WN_HIK_DashUser_Rename
CREATE   PROCEDURE [dbo].[WN_HIK_DashUser_Rename]
  @old_username NVARCHAR(64), @new_username NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.WN_HIK_DashboardUsers
     SET username = @new_username, updated_at = SYSDATETIME()
   WHERE username = @old_username;
END
GO

-- SQL_STORED_PROCEDURE: WN_HIK_DashUser_Upsert
CREATE   PROCEDURE [dbo].[WN_HIK_DashUser_Upsert]
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

-- SQL_STORED_PROCEDURE: WN_HIK_Device_SetOnline
-- Record a connectivity result (Test button / online watchdog).
CREATE   PROCEDURE [dbo].[WN_HIK_Device_SetOnline]
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

-- SQL_STORED_PROCEDURE: WN_HIK_Device_UpsertByHost
CREATE   PROCEDURE [dbo].[WN_HIK_Device_UpsertByHost]
  @name NVARCHAR(100), @host NVARCHAR(64), @port INT = 80, @use_https BIT = 0,
  @username NVARCHAR(64), @password NVARCHAR(128),
  @location NVARCHAR(128) = NULL, @grp NVARCHAR(64) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  -- keyed by host + port: several machines can share one public IP on
  -- different forwarded ports
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

-- SQL_STORED_PROCEDURE: WN_HIK_Employee_NextNumber
CREATE   PROCEDURE dbo.WN_HIK_Employee_NextNumber
  @floor INT = 1000, @ceiling INT = 2147483647
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CASE WHEN MAX(n) IS NULL OR MAX(n) < @floor - 1 THEN @floor ELSE MAX(n) + 1 END AS next_no
  FROM (SELECT TRY_CAST(employee_no AS INT) AS n FROM dbo.WN_HIK_Employees WITH (NOLOCK)) t
  WHERE n IS NOT NULL AND n >= @floor AND n < @ceiling;
END
GO

-- SQL_STORED_PROCEDURE: WN_HIK_Expiry_Run
CREATE   PROCEDURE dbo.WN_HIK_Expiry_Run @now DATETIME2(0) AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @expired TABLE (id INT, employee_no NVARCHAR(32), auto_delete BIT);
  UPDATE dbo.WN_HIK_Cards SET status = 'expired'
  OUTPUT inserted.id, inserted.employee_no, inserted.auto_delete INTO @expired
   WHERE valid_end IS NOT NULL AND valid_end <= @now AND status = 'active';
  UPDATE dbo.WN_HIK_Visitors SET status = 'expired'
  OUTPUT inserted.id, inserted.employee_no, inserted.auto_delete INTO @expired
   WHERE valid_end IS NOT NULL AND valid_end <= @now AND status = 'active';
  SELECT * FROM @expired;
END
GO

-- SQL_STORED_PROCEDURE: WN_HIK_Grant_Ensure
-- Grant a machine to a person (idempotent; pending until pushed).
CREATE   PROCEDURE [dbo].[WN_HIK_Grant_Ensure]
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

-- SQL_STORED_PROCEDURE: WN_HIK_Grant_MarkRemoving
-- Mark all of a person's grants for device-side removal.
CREATE   PROCEDURE [dbo].[WN_HIK_Grant_MarkRemoving]
  @employee_id INT
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.WN_HIK_AccessGrants SET sync_state = 'removing' WHERE employee_id = @employee_id;
END
GO

-- SQL_STORED_PROCEDURE: WN_HIK_Grant_PendingEmployees
-- People with work still queued for the sync engine.
CREATE   PROCEDURE [dbo].[WN_HIK_Grant_PendingEmployees]
AS
BEGIN
  SET NOCOUNT ON;
  SELECT DISTINCT employee_id
  FROM dbo.WN_HIK_AccessGrants WITH (NOLOCK)
  WHERE sync_state IN ('pending','error','removing');
END
GO

-- SQL_STORED_PROCEDURE: WN_HIK_Grant_SetState
-- Update one grant after a push attempt.
CREATE   PROCEDURE [dbo].[WN_HIK_Grant_SetState]
  @grant_id INT, @state NVARCHAR(16), @error NVARCHAR(MAX) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.WN_HIK_AccessGrants
     SET sync_state = @state, last_error = @error, synced_at = SYSDATETIME()
   WHERE id = @grant_id;
END
GO

-- SQL_STORED_PROCEDURE: WN_HIK_Log_Write
-- Write an activity-log entry.
CREATE   PROCEDURE [dbo].[WN_HIK_Log_Write]
  @employee_id INT = NULL, @device_id INT = NULL,
  @action NVARCHAR(64), @ok BIT, @detail NVARCHAR(MAX) = NULL
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.WN_HIK_SyncLog (employee_id, device_id, action, ok, detail)
  VALUES (@employee_id, @device_id, @action, @ok, @detail);
END
GO

-- SQL_STORED_PROCEDURE: WN_HIK_Settings_Get
-- Get / set a settings value (e.g. the external booking API key).
CREATE   PROCEDURE [dbo].[WN_HIK_Settings_Get]
  @key NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  SELECT value FROM dbo.WN_HIK_Settings WITH (NOLOCK) WHERE [key] = @key;
END
GO

-- SQL_STORED_PROCEDURE: WN_HIK_Settings_Set
CREATE   PROCEDURE [dbo].[WN_HIK_Settings_Set]
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

-- SQL_STORED_PROCEDURE: WN_HIK_Stats_Get
-- Dashboard counters.
CREATE   PROCEDURE [dbo].[WN_HIK_Stats_Get]
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

-- SQL_STORED_PROCEDURE: WN_HIK_Visitor_Create
CREATE   PROCEDURE dbo.WN_HIK_Visitor_Create
  @employee_no NVARCHAR(32), @name NVARCHAR(128), @card_no NVARCHAR(32) = NULL,
  @valid_begin DATETIME2(0), @valid_end DATETIME2(0), @booking_ref NVARCHAR(64) = NULL AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO dbo.WN_HIK_Visitors (employee_no, name, card_no, valid_begin, valid_end, auto_delete, booking_ref)
  VALUES (@employee_no, @name, @card_no, @valid_begin, @valid_end, 1, @booking_ref);
  SELECT SCOPE_IDENTITY() AS id;
END
GO

-- SQL_TRIGGER: TR_WN_HIK_AccessGrants_Audit
CREATE   TRIGGER [dbo].[TR_WN_HIK_AccessGrants_Audit]
ON [dbo].[WN_HIK_AccessGrants]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @UserId INT = CAST(SESSION_CONTEXT(N'AppUserId') AS INT);
    IF @UserId IS NULL SET @UserId = -1;

    DECLARE @UserEmail NVARCHAR(256) = CAST(SESSION_CONTEXT(N'AppUserEmail') AS NVARCHAR(256));
    DECLARE @SourceApp NVARCHAR(50) = CAST(SESSION_CONTEXT(N'SourceApp') AS NVARCHAR(50));
    DECLARE @EntityName NVARCHAR(128) = N'WN_HIK_AccessGrants';
    DECLARE @SysUtc DATETIME2(3) = SYSUTCDATETIME();

    BEGIN TRY
        -- INSERT Operation
        IF EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[id] AS NVARCHAR(64)),
                'I',
                NULL,
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i;
        END

        -- UPDATE Operation
        ELSE IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[id] AS NVARCHAR(64)),
                'U',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i
            INNER JOIN deleted d ON i.[id] = d.[id];
        END

        -- DELETE Operation
        ELSE IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(d.[id] AS NVARCHAR(64)),
                'D',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL,
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM deleted d;
        END
    END TRY
    BEGIN CATCH
        BEGIN TRY
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace,
                ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            VALUES (
                @EntityName,
                'TRIGGER_ERROR',
                'E',
                NULL, NULL,
                ERROR_MESSAGE(),
                'Error',
                CONCAT('Line: ', ERROR_LINE(), ' State: ', ERROR_STATE(), ' Procedure: ', ERROR_PROCEDURE()),
                @UserId, @UserEmail, SYSUTCDATETIME(), @SourceApp
            );
        END TRY
        BEGIN CATCH
            -- Silent swallow to guarantee original DML never fails
        END CATCH
    END CATCH
END;
GO

-- SQL_TRIGGER: TR_WN_HIK_Cards_GrantCascade
CREATE   TRIGGER dbo.TR_WN_HIK_Cards_GrantCascade ON dbo.WN_HIK_Cards AFTER DELETE AS
  BEGIN
    SET NOCOUNT ON;
    DELETE g FROM dbo.WN_HIK_AccessGrants g INNER JOIN deleted d ON g.employee_id = d.id;
  END
GO

-- SQL_TRIGGER: TR_WN_HIK_DashboardUsers_Audit
CREATE   TRIGGER [dbo].[TR_WN_HIK_DashboardUsers_Audit]
ON [dbo].[WN_HIK_DashboardUsers]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @UserId INT = CAST(SESSION_CONTEXT(N'AppUserId') AS INT);
    IF @UserId IS NULL SET @UserId = -1;

    DECLARE @UserEmail NVARCHAR(256) = CAST(SESSION_CONTEXT(N'AppUserEmail') AS NVARCHAR(256));
    DECLARE @SourceApp NVARCHAR(50) = CAST(SESSION_CONTEXT(N'SourceApp') AS NVARCHAR(50));
    DECLARE @EntityName NVARCHAR(128) = N'WN_HIK_DashboardUsers';
    DECLARE @SysUtc DATETIME2(3) = SYSUTCDATETIME();

    BEGIN TRY
        -- INSERT Operation
        IF EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[id] AS NVARCHAR(64)),
                'I',
                NULL,
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i;
        END

        -- UPDATE Operation
        ELSE IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[id] AS NVARCHAR(64)),
                'U',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i
            INNER JOIN deleted d ON i.[id] = d.[id];
        END

        -- DELETE Operation
        ELSE IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(d.[id] AS NVARCHAR(64)),
                'D',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL,
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM deleted d;
        END
    END TRY
    BEGIN CATCH
        BEGIN TRY
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace,
                ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            VALUES (
                @EntityName,
                'TRIGGER_ERROR',
                'E',
                NULL, NULL,
                ERROR_MESSAGE(),
                'Error',
                CONCAT('Line: ', ERROR_LINE(), ' State: ', ERROR_STATE(), ' Procedure: ', ERROR_PROCEDURE()),
                @UserId, @UserEmail, SYSUTCDATETIME(), @SourceApp
            );
        END TRY
        BEGIN CATCH
            -- Silent swallow to guarantee original DML never fails
        END CATCH
    END CATCH
END;
GO

-- SQL_TRIGGER: TR_WN_HIK_DevCache_Audit
CREATE   TRIGGER [dbo].[TR_WN_HIK_DevCache_Audit]
ON [dbo].[WN_HIK_DevCache]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @UserId INT = CAST(SESSION_CONTEXT(N'AppUserId') AS INT);
    IF @UserId IS NULL SET @UserId = -1;

    DECLARE @UserEmail NVARCHAR(256) = CAST(SESSION_CONTEXT(N'AppUserEmail') AS NVARCHAR(256));
    DECLARE @SourceApp NVARCHAR(50) = CAST(SESSION_CONTEXT(N'SourceApp') AS NVARCHAR(50));
    DECLARE @EntityName NVARCHAR(128) = N'WN_HIK_DevCache';
    DECLARE @SysUtc DATETIME2(3) = SYSUTCDATETIME();

    BEGIN TRY
        -- INSERT Operation
        IF EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[device_id] AS NVARCHAR(64)),
                'I',
                NULL,
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i;
        END

        -- UPDATE Operation
        ELSE IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[device_id] AS NVARCHAR(64)),
                'U',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i
            INNER JOIN deleted d ON i.[device_id] = d.[device_id];
        END

        -- DELETE Operation
        ELSE IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(d.[device_id] AS NVARCHAR(64)),
                'D',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL,
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM deleted d;
        END
    END TRY
    BEGIN CATCH
        BEGIN TRY
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace,
                ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            VALUES (
                @EntityName,
                'TRIGGER_ERROR',
                'E',
                NULL, NULL,
                ERROR_MESSAGE(),
                'Error',
                CONCAT('Line: ', ERROR_LINE(), ' State: ', ERROR_STATE(), ' Procedure: ', ERROR_PROCEDURE()),
                @UserId, @UserEmail, SYSUTCDATETIME(), @SourceApp
            );
        END TRY
        BEGIN CATCH
            -- Silent swallow to guarantee original DML never fails
        END CATCH
    END CATCH
END;
GO

-- SQL_TRIGGER: TR_WN_HIK_Devices_Audit
CREATE   TRIGGER [dbo].[TR_WN_HIK_Devices_Audit]
ON [dbo].[WN_HIK_Devices]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @UserId INT = CAST(SESSION_CONTEXT(N'AppUserId') AS INT);
    IF @UserId IS NULL SET @UserId = -1;

    DECLARE @UserEmail NVARCHAR(256) = CAST(SESSION_CONTEXT(N'AppUserEmail') AS NVARCHAR(256));
    DECLARE @SourceApp NVARCHAR(50) = CAST(SESSION_CONTEXT(N'SourceApp') AS NVARCHAR(50));
    DECLARE @EntityName NVARCHAR(128) = N'WN_HIK_Devices';
    DECLARE @SysUtc DATETIME2(3) = SYSUTCDATETIME();

    BEGIN TRY
        -- INSERT Operation
        IF EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[id] AS NVARCHAR(64)),
                'I',
                NULL,
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i;
        END

        -- UPDATE Operation
        ELSE IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[id] AS NVARCHAR(64)),
                'U',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i
            INNER JOIN deleted d ON i.[id] = d.[id];
        END

        -- DELETE Operation
        ELSE IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(d.[id] AS NVARCHAR(64)),
                'D',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL,
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM deleted d;
        END
    END TRY
    BEGIN CATCH
        BEGIN TRY
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace,
                ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            VALUES (
                @EntityName,
                'TRIGGER_ERROR',
                'E',
                NULL, NULL,
                ERROR_MESSAGE(),
                'Error',
                CONCAT('Line: ', ERROR_LINE(), ' State: ', ERROR_STATE(), ' Procedure: ', ERROR_PROCEDURE()),
                @UserId, @UserEmail, SYSUTCDATETIME(), @SourceApp
            );
        END TRY
        BEGIN CATCH
            -- Silent swallow to guarantee original DML never fails
        END CATCH
    END CATCH
END;
GO

-- SQL_TRIGGER: TR_WN_HIK_Events_Audit
CREATE   TRIGGER [dbo].[TR_WN_HIK_Events_Audit]
ON [dbo].[WN_HIK_Events]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @UserId INT = CAST(SESSION_CONTEXT(N'AppUserId') AS INT);
    IF @UserId IS NULL SET @UserId = -1;

    DECLARE @UserEmail NVARCHAR(256) = CAST(SESSION_CONTEXT(N'AppUserEmail') AS NVARCHAR(256));
    DECLARE @SourceApp NVARCHAR(50) = CAST(SESSION_CONTEXT(N'SourceApp') AS NVARCHAR(50));
    DECLARE @EntityName NVARCHAR(128) = N'WN_HIK_Events';
    DECLARE @SysUtc DATETIME2(3) = SYSUTCDATETIME();

    BEGIN TRY
        -- INSERT Operation
        IF EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[id] AS NVARCHAR(64)),
                'I',
                NULL,
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i;
        END

        -- UPDATE Operation
        ELSE IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[id] AS NVARCHAR(64)),
                'U',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i
            INNER JOIN deleted d ON i.[id] = d.[id];
        END

        -- DELETE Operation
        ELSE IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(d.[id] AS NVARCHAR(64)),
                'D',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL,
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM deleted d;
        END
    END TRY
    BEGIN CATCH
        BEGIN TRY
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace,
                ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            VALUES (
                @EntityName,
                'TRIGGER_ERROR',
                'E',
                NULL, NULL,
                ERROR_MESSAGE(),
                'Error',
                CONCAT('Line: ', ERROR_LINE(), ' State: ', ERROR_STATE(), ' Procedure: ', ERROR_PROCEDURE()),
                @UserId, @UserEmail, SYSUTCDATETIME(), @SourceApp
            );
        END TRY
        BEGIN CATCH
            -- Silent swallow to guarantee original DML never fails
        END CATCH
    END CATCH
END;
GO

-- SQL_TRIGGER: TR_WN_HIK_FaceVault_Audit
CREATE   TRIGGER [dbo].[TR_WN_HIK_FaceVault_Audit]
ON [dbo].[WN_HIK_FaceVault]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @UserId INT = CAST(SESSION_CONTEXT(N'AppUserId') AS INT);
    IF @UserId IS NULL SET @UserId = -1;

    DECLARE @UserEmail NVARCHAR(256) = CAST(SESSION_CONTEXT(N'AppUserEmail') AS NVARCHAR(256));
    DECLARE @SourceApp NVARCHAR(50) = CAST(SESSION_CONTEXT(N'SourceApp') AS NVARCHAR(50));
    DECLARE @EntityName NVARCHAR(128) = N'WN_HIK_FaceVault';
    DECLARE @SysUtc DATETIME2(3) = SYSUTCDATETIME();

    BEGIN TRY
        -- INSERT Operation
        IF EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[id] AS NVARCHAR(64)),
                'I',
                NULL,
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i;
        END

        -- UPDATE Operation
        ELSE IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[id] AS NVARCHAR(64)),
                'U',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i
            INNER JOIN deleted d ON i.[id] = d.[id];
        END

        -- DELETE Operation
        ELSE IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(d.[id] AS NVARCHAR(64)),
                'D',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL,
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM deleted d;
        END
    END TRY
    BEGIN CATCH
        BEGIN TRY
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace,
                ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            VALUES (
                @EntityName,
                'TRIGGER_ERROR',
                'E',
                NULL, NULL,
                ERROR_MESSAGE(),
                'Error',
                CONCAT('Line: ', ERROR_LINE(), ' State: ', ERROR_STATE(), ' Procedure: ', ERROR_PROCEDURE()),
                @UserId, @UserEmail, SYSUTCDATETIME(), @SourceApp
            );
        END TRY
        BEGIN CATCH
            -- Silent swallow to guarantee original DML never fails
        END CATCH
    END CATCH
END;
GO

-- SQL_TRIGGER: TR_WN_HIK_FpVault_Audit
CREATE   TRIGGER [dbo].[TR_WN_HIK_FpVault_Audit]
ON [dbo].[WN_HIK_FpVault]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @UserId INT = CAST(SESSION_CONTEXT(N'AppUserId') AS INT);
    IF @UserId IS NULL SET @UserId = -1;

    DECLARE @UserEmail NVARCHAR(256) = CAST(SESSION_CONTEXT(N'AppUserEmail') AS NVARCHAR(256));
    DECLARE @SourceApp NVARCHAR(50) = CAST(SESSION_CONTEXT(N'SourceApp') AS NVARCHAR(50));
    DECLARE @EntityName NVARCHAR(128) = N'WN_HIK_FpVault';
    DECLARE @SysUtc DATETIME2(3) = SYSUTCDATETIME();

    BEGIN TRY
        -- INSERT Operation
        IF EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[id] AS NVARCHAR(64)),
                'I',
                NULL,
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i;
        END

        -- UPDATE Operation
        ELSE IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[id] AS NVARCHAR(64)),
                'U',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i
            INNER JOIN deleted d ON i.[id] = d.[id];
        END

        -- DELETE Operation
        ELSE IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(d.[id] AS NVARCHAR(64)),
                'D',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL,
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM deleted d;
        END
    END TRY
    BEGIN CATCH
        BEGIN TRY
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace,
                ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            VALUES (
                @EntityName,
                'TRIGGER_ERROR',
                'E',
                NULL, NULL,
                ERROR_MESSAGE(),
                'Error',
                CONCAT('Line: ', ERROR_LINE(), ' State: ', ERROR_STATE(), ' Procedure: ', ERROR_PROCEDURE()),
                @UserId, @UserEmail, SYSUTCDATETIME(), @SourceApp
            );
        END TRY
        BEGIN CATCH
            -- Silent swallow to guarantee original DML never fails
        END CATCH
    END CATCH
END;
GO

-- SQL_TRIGGER: TR_WN_HIK_PendingOps_Audit
CREATE   TRIGGER [dbo].[TR_WN_HIK_PendingOps_Audit]
ON [dbo].[WN_HIK_PendingOps]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @UserId INT = CAST(SESSION_CONTEXT(N'AppUserId') AS INT);
    IF @UserId IS NULL SET @UserId = -1;

    DECLARE @UserEmail NVARCHAR(256) = CAST(SESSION_CONTEXT(N'AppUserEmail') AS NVARCHAR(256));
    DECLARE @SourceApp NVARCHAR(50) = CAST(SESSION_CONTEXT(N'SourceApp') AS NVARCHAR(50));
    DECLARE @EntityName NVARCHAR(128) = N'WN_HIK_PendingOps';
    DECLARE @SysUtc DATETIME2(3) = SYSUTCDATETIME();

    BEGIN TRY
        -- INSERT Operation
        IF EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[id] AS NVARCHAR(64)),
                'I',
                NULL,
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i;
        END

        -- UPDATE Operation
        ELSE IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[id] AS NVARCHAR(64)),
                'U',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i
            INNER JOIN deleted d ON i.[id] = d.[id];
        END

        -- DELETE Operation
        ELSE IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(d.[id] AS NVARCHAR(64)),
                'D',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL,
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM deleted d;
        END
    END TRY
    BEGIN CATCH
        BEGIN TRY
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace,
                ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            VALUES (
                @EntityName,
                'TRIGGER_ERROR',
                'E',
                NULL, NULL,
                ERROR_MESSAGE(),
                'Error',
                CONCAT('Line: ', ERROR_LINE(), ' State: ', ERROR_STATE(), ' Procedure: ', ERROR_PROCEDURE()),
                @UserId, @UserEmail, SYSUTCDATETIME(), @SourceApp
            );
        END TRY
        BEGIN CATCH
            -- Silent swallow to guarantee original DML never fails
        END CATCH
    END CATCH
END;
GO

-- SQL_TRIGGER: TR_WN_HIK_Settings_Audit
CREATE   TRIGGER [dbo].[TR_WN_HIK_Settings_Audit]
ON [dbo].[WN_HIK_Settings]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @UserId INT = CAST(SESSION_CONTEXT(N'AppUserId') AS INT);
    IF @UserId IS NULL SET @UserId = -1;

    DECLARE @UserEmail NVARCHAR(256) = CAST(SESSION_CONTEXT(N'AppUserEmail') AS NVARCHAR(256));
    DECLARE @SourceApp NVARCHAR(50) = CAST(SESSION_CONTEXT(N'SourceApp') AS NVARCHAR(50));
    DECLARE @EntityName NVARCHAR(128) = N'WN_HIK_Settings';
    DECLARE @SysUtc DATETIME2(3) = SYSUTCDATETIME();

    BEGIN TRY
        -- INSERT Operation
        IF EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[key] AS NVARCHAR(64)),
                'I',
                NULL,
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i;
        END

        -- UPDATE Operation
        ELSE IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[key] AS NVARCHAR(64)),
                'U',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i
            INNER JOIN deleted d ON i.[key] = d.[key];
        END

        -- DELETE Operation
        ELSE IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(d.[key] AS NVARCHAR(64)),
                'D',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL,
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM deleted d;
        END
    END TRY
    BEGIN CATCH
        BEGIN TRY
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace,
                ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            VALUES (
                @EntityName,
                'TRIGGER_ERROR',
                'E',
                NULL, NULL,
                ERROR_MESSAGE(),
                'Error',
                CONCAT('Line: ', ERROR_LINE(), ' State: ', ERROR_STATE(), ' Procedure: ', ERROR_PROCEDURE()),
                @UserId, @UserEmail, SYSUTCDATETIME(), @SourceApp
            );
        END TRY
        BEGIN CATCH
            -- Silent swallow to guarantee original DML never fails
        END CATCH
    END CATCH
END;
GO

-- SQL_TRIGGER: TR_WN_HIK_Users_Audit
CREATE   TRIGGER [dbo].[TR_WN_HIK_Users_Audit]
ON [dbo].[WN_HIK_Users]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    DECLARE @UserId INT = CAST(SESSION_CONTEXT(N'AppUserId') AS INT);
    IF @UserId IS NULL SET @UserId = -1;

    DECLARE @UserEmail NVARCHAR(256) = CAST(SESSION_CONTEXT(N'AppUserEmail') AS NVARCHAR(256));
    DECLARE @SourceApp NVARCHAR(50) = CAST(SESSION_CONTEXT(N'SourceApp') AS NVARCHAR(50));
    DECLARE @EntityName NVARCHAR(128) = N'WN_HIK_Users';
    DECLARE @SysUtc DATETIME2(3) = SYSUTCDATETIME();

    BEGIN TRY
        -- INSERT Operation
        IF EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[id] AS NVARCHAR(64)),
                'I',
                NULL,
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i;
        END

        -- UPDATE Operation
        ELSE IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(i.[id] AS NVARCHAR(64)),
                'U',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                (SELECT i.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM inserted i
            INNER JOIN deleted d ON i.[id] = d.[id];
        END

        -- DELETE Operation
        ELSE IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        BEGIN
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace, ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            SELECT 
                @EntityName,
                CAST(d.[id] AS NVARCHAR(64)),
                'D',
                (SELECT d.* FOR JSON PATH, WITHOUT_ARRAY_WRAPPER),
                NULL,
                NULL, NULL, NULL,
                @UserId, @UserEmail, @SysUtc, @SourceApp
            FROM deleted d;
        END
    END TRY
    BEGIN CATCH
        BEGIN TRY
            INSERT INTO dbo.WN_AuditLog (
                EntityName, RecordId, Operation, OldValues, NewValues,
                ErrorMessage, ErrorSeverity, StackTrace,
                ChangedByUserId, ChangedByUserEmail, ChangedAt, SourceApp
            )
            VALUES (
                @EntityName,
                'TRIGGER_ERROR',
                'E',
                NULL, NULL,
                ERROR_MESSAGE(),
                'Error',
                CONCAT('Line: ', ERROR_LINE(), ' State: ', ERROR_STATE(), ' Procedure: ', ERROR_PROCEDURE()),
                @UserId, @UserEmail, SYSUTCDATETIME(), @SourceApp
            );
        END TRY
        BEGIN CATCH
            -- Silent swallow to guarantee original DML never fails
        END CATCH
    END CATCH
END;
GO

-- SQL_TRIGGER: TR_WN_HIK_Visitors_GrantCascade
CREATE   TRIGGER dbo.TR_WN_HIK_Visitors_GrantCascade ON dbo.WN_HIK_Visitors AFTER DELETE AS
  BEGIN
    SET NOCOUNT ON;
    DELETE g FROM dbo.WN_HIK_AccessGrants g INNER JOIN deleted d ON g.employee_id = d.id;
  END
GO

