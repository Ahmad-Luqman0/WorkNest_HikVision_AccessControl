// Users page module — ASP.NET Core 8 minimal API.
//
// .NET port of the READ endpoints the WorkNest Users page consumes. All data
// comes from the same SQL Server tables the Node backend maintains
// (WN_HIK_Devices, WN_HIK_DevCache machine snapshots, WN_HIK_Users), so this
// service is read-only and needs no connection to the Hikvision machines.
// Response shapes mirror the Node API so the frontend is drop-in portable.
//
// Config (same env vars as the Node backend): DB_SERVER, DB_PORT, DB_USER,
// DB_PASSWORD, DB_NAME.

using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.SqlClient;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

string Env(string key, string? fallback = null) =>
    Environment.GetEnvironmentVariable(key)
    ?? fallback
    ?? throw new InvalidOperationException($"Missing required environment variable {key}");

var connectionString = new SqlConnectionStringBuilder
{
    DataSource = $"{Env("DB_SERVER")},{Env("DB_PORT", "1433")}",
    UserID = Env("DB_USER"),
    Password = Env("DB_PASSWORD"),
    InitialCatalog = Env("DB_NAME"),
    Encrypt = false,
    TrustServerCertificate = true,
}.ConnectionString;

async Task<SqlConnection> OpenAsync()
{
    var conn = new SqlConnection(connectionString);
    await conn.OpenAsync();
    return conn;
}

static bool IsEntrance(string? grp) =>
    (grp ?? "").Trim().StartsWith("entrance", StringComparison.OrdinalIgnoreCase);

// ---------------------------------------------------------------------------
// GET /api/devices — machine list for the filter dropdown and room/machine
// columns. Connection details (host/port/credentials) are never exposed:
// this module serves the page for user-level viewing.
// ---------------------------------------------------------------------------
app.MapGet("/api/devices", async () =>
{
    await using var conn = await OpenAsync();
    await using var cmd = new SqlCommand(
        @"SELECT d.Id AS id, d.Device_Name AS name, g.Name AS grp, d.Code AS code, d.Location AS location, d.Online AS online, d.Last_seen AS last_seen
          FROM dbo.WN_HIK_Devices d WITH (NOLOCK)
          LEFT JOIN dbo.WN_HIK_Groups g ON g.Id = d.Group_id ORDER BY d.Device_Name", conn);
    var devices = new List<object>();
    await using var r = await cmd.ExecuteReaderAsync();
    while (await r.ReadAsync())
    {
        devices.Add(new
        {
            id = r.GetInt32(0),
            name = r.GetString(1),
            grp = r.IsDBNull(2) ? null : r.GetString(2),
            code = r.IsDBNull(3) ? null : r.GetString(3),
            location = r.IsDBNull(4) ? null : r.GetString(4),
            online = !r.IsDBNull(5) && r.GetBoolean(5) ? 1 : 0,
            last_seen = r.IsDBNull(6) ? null : r.GetDateTime(6).ToString("yyyy-MM-ddTHH:mm:ss"),
        });
    }
    return Results.Json(devices);
});

// ---------------------------------------------------------------------------
// GET /api/roster — one row per machine with its user roster, straight from
// the WN_HIK_DevCache snapshots (kept fresh by the Node maintenance passes),
// plus the CNIC map from WN_HIK_Users. Mirrors Node's /api/roster shape.
// ---------------------------------------------------------------------------
app.MapGet("/api/roster", async () =>
{
    await using var conn = await OpenAsync();

    var rosters = new List<object>();
    await using (var cmd = new SqlCommand(
        @"SELECT d.Id, c.Users_snapshot
          FROM dbo.WN_HIK_Devices d WITH (NOLOCK)
          LEFT JOIN dbo.WN_HIK_DevCache c WITH (NOLOCK) ON c.Device_id = d.Id", conn))
    await using (var r = await cmd.ExecuteReaderAsync())
    {
        while (await r.ReadAsync())
        {
            var deviceId = r.GetInt32(0);
            if (r.IsDBNull(1))
            {
                rosters.Add(new { device_id = deviceId, ok = false, error = "no snapshot yet" });
                continue;
            }
            try
            {
                var users = JsonNode.Parse(r.GetString(1));
                rosters.Add(new { device_id = deviceId, ok = true, users });
            }
            catch
            {
                rosters.Add(new { device_id = deviceId, ok = false, error = "corrupt snapshot" });
            }
        }
    }

    // CNIC lookup: "employeeNo||lowercased name" -> cnic (same key as Node)
    var cnics = new Dictionary<string, string>();
    await using (var cmd = new SqlCommand(
        @"SELECT employee_no, name, cnic FROM dbo.WN_HIK_Users WITH (NOLOCK)
          WHERE cnic IS NOT NULL AND cnic <> ''", conn))
    await using (var r = await cmd.ExecuteReaderAsync())
    {
        while (await r.ReadAsync())
            cnics[$"{r.GetString(0)}||{r.GetString(1).Trim().ToLowerInvariant()}"] = r.GetString(2);
    }

    return Results.Json(new { ok = true, rosters, cnics });
});

// ---------------------------------------------------------------------------
// GET /api/devices/{id}/users — one machine's roster from its snapshot.
// ---------------------------------------------------------------------------
app.MapGet("/api/devices/{id:int}/users", async (int id) =>
{
    await using var conn = await OpenAsync();
    await using var cmd = new SqlCommand(
        "SELECT Users_snapshot FROM dbo.WN_HIK_DevCache WITH (NOLOCK) WHERE Device_id = @id", conn);
    cmd.Parameters.AddWithValue("@id", id);
    var roster = await cmd.ExecuteScalarAsync() as string;
    if (string.IsNullOrEmpty(roster))
        return Results.Json(new { ok = false, error = "no snapshot for this machine yet" });
    var users = JsonNode.Parse(roster) as JsonArray ?? new JsonArray();
    return Results.Json(new { ok = true, total = users.Count, users });
});

// ---------------------------------------------------------------------------
// GET /api/next-employee-no — prefill for the Add-user form. Members stay
// below 8500 (8500–8999 is reserved for cards, 9000+ for visitors).
// ---------------------------------------------------------------------------
app.MapGet("/api/next-employee-no", async () =>
{
    await using var conn = await OpenAsync();
    await using var cmd = new SqlCommand(
        @"SELECT MAX(n) FROM (
            SELECT TRY_CAST(employee_no AS INT) AS n FROM dbo.WN_HIK_Users WITH (NOLOCK)
          ) t WHERE n IS NOT NULL AND n < 8500", conn);
    var max = await cmd.ExecuteScalarAsync();
    var next = (max is int m ? m : 999) + 1;
    return Results.Json(new { ok = true, next });
});

app.UseDefaultFiles();
app.UseStaticFiles();

app.Run();
