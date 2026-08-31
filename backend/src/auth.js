// Dashboard authentication with roles.
//
// Accounts live in dbo.WN_HIK_DashboardUsers (WN_HIK_DashUser_* procs) with a
// role of 'admin' or 'user':
//   admin — full dashboard + manage login accounts
//   user  — full dashboard, may only change their own password
//
// Sessions are stateless signed cookies (payload: username, role, expiry) so
// they work on a long-running server and on serverless (Vercel) alike. The
// HMAC secret is stored in WN_HIK_Settings.
//
// If ADMIN_USER / ADMIN_PASSWORD env vars are set they act as an emergency
// admin override (e.g. reset access from Vercel settings).
import crypto from 'node:crypto';
import { Router } from 'express';
import { sp, logAudit } from './db.js';

const COOKIE = 'wn_auth';
const SESSION_DAYS = 7;
const ROLES = ['admin', 'user'];

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return forwarded ? forwarded.split(',')[0].trim() : (req.socket?.remoteAddress || req.ip || '127.0.0.1');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `${salt}:${h}`;
}
function verifyPassword(password, stored) {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const candidate = crypto.scryptSync(String(password), salt, 32).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(h));
  } catch {
    return false;
  }
}

async function getSetting(key) {
  const rows = await sp('WN_HIK_Settings_Get', { key });
  return rows[0]?.value ?? null;
}
async function setSetting(key, value) {
  await sp('WN_HIK_Settings_Set', { key, value });
}

let _secret = null;
async function authSecret() {
  if (_secret) return _secret;
  let s = await getSetting('auth_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    await setSetting('auth_secret', s);
  }
  _secret = s;
  return s;
}

// Seed a default admin account when the table is empty.
async function ensureSeedCredentials() {
  const rows = await sp('WN_HIK_DashUser_Count');
  if (!Number(rows[0]?.n)) {
    await sp('WN_HIK_DashUser_Upsert', { username: 'admin', password_hash: hashPassword('admin123'), role: 'admin' });
  }
}

async function getDashUser(username) {
  const rows = await sp('WN_HIK_DashUser_Get', { username: String(username) });
  return rows[0] || null;
}

// Returns { username, role } on success, null on bad credentials.
async function checkCredentials(username, password) {
  if (process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
    if (username === process.env.ADMIN_USER && String(password) === process.env.ADMIN_PASSWORD) {
      return { username, role: 'admin' };
    }
  }
  await ensureSeedCredentials();
  const user = await getDashUser(username);
  if (user && verifyPassword(password, user.password_hash)) {
    return { username: user.username, role: ROLES.includes(user.role) ? user.role : 'user' };
  }
  return null;
}

const b64u = (s) => Buffer.from(s).toString('base64url');
async function makeToken(user) {
  const payload = b64u(JSON.stringify({ u: user.username, r: user.role, exp: Date.now() + SESSION_DAYS * 86400000 }));
  const sig = crypto.createHmac('sha256', await authSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}
// Returns { username, role } for a valid unexpired token, else null.
async function tokenInfo(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expect = crypto.createHmac('sha256', await authSecret()).update(payload).digest('hex');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  } catch {
    return null;
  }
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.u || Number(data.exp) < Date.now()) return null;
    return { username: String(data.u), role: ROLES.includes(data.r) ? data.r : 'user' };
  } catch {
    return null;
  }
}

function readCookie(req) {
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
function setCookie(res, req, value, maxAgeSeconds) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`);
}

async function sessionOf(req) {
  try {
    return await tokenInfo(readCookie(req));
  } catch {
    return null;
  }
}

// Guard for the dashboard APIs (the external /api/ext API has its own key).
export async function requireAuth(req, res, next) {
  const auth = await sessionOf(req);
  if (auth) { req.auth = auth; return next(); }
  res.status(401).json({ error: 'authentication required' });
}

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  try {
    const user = await checkCredentials(String(username || ''), String(password || ''));
    if (!user) {
      logAudit('guest', 'LOGIN_FAILED', String(username || ''), getClientIp(req), 'Invalid credentials');
      return res.status(401).json({ ok: false, error: 'Wrong username or password' });
    }
    setCookie(res, req, await makeToken(user), SESSION_DAYS * 86400);
    logAudit(user.username, 'LOGIN_SUCCESS', user.username, getClientIp(req), `Logged in as ${user.role}`);
    res.json({ ok: true, username: user.username, role: user.role });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

authRouter.post('/logout', async (req, res) => {
  const auth = await sessionOf(req);
  if (auth) logAudit(auth.username, 'LOGOUT', auth.username, getClientIp(req), 'Signed out');
  setCookie(res, req, '', 0);
  res.json({ ok: true });
});

authRouter.get('/me', async (req, res) => {
  const auth = await sessionOf(req);
  res.json(auth ? { ok: true, username: auth.username, role: auth.role } : { ok: false });
});

// Change a password. Regular users may only change their OWN password (current
// password required). Admins may also RESET any other account's password
// without knowing its current one.
authRouter.post('/change-password', async (req, res) => {
  const auth = await sessionOf(req);
  if (!auth) return res.status(401).json({ error: 'authentication required' });
  const { current, next: nextPassword } = req.body || {};
  const username = String(req.body?.username || auth.username).trim();
  if (!nextPassword || String(nextPassword).length < 6) {
    return res.status(400).json({ ok: false, error: 'New password must be at least 6 characters' });
  }
  try {
    if (process.env.ADMIN_USER && process.env.ADMIN_PASSWORD && username === process.env.ADMIN_USER) {
      return res.status(400).json({ ok: false, error: 'Credentials are set via environment variables — change them there' });
    }
    if (auth.role !== 'admin' && username !== auth.username) {
      return res.status(403).json({ ok: false, error: 'Only admins can change other accounts' });
    }
    const user = await getDashUser(username);
    if (!user) return res.status(404).json({ ok: false, error: `No account "${username}"` });
    const isSelf = username === auth.username;
    if (isSelf && !verifyPassword(String(current || ''), user.password_hash)) {
      return res.status(401).json({ ok: false, error: 'Current password is wrong' });
    }
    await sp('WN_HIK_DashUser_Upsert', { username, password_hash: hashPassword(String(nextPassword)), role: null });
    logAudit(auth.username, 'CHANGE_PASSWORD', username, getClientIp(req), `Password updated for account ${username}`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ---- Account management (admin only) ----
async function requireAdmin(req, res) {
  const auth = await sessionOf(req);
  if (!auth) { res.status(401).json({ error: 'authentication required' }); return null; }
  if (auth.role !== 'admin') { res.status(403).json({ error: 'admin role required' }); return null; }
  return auth;
}

authRouter.get('/users', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    res.json({ ok: true, users: await sp('WN_HIK_DashUser_List') });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

authRouter.post('/users', async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const role = ROLES.includes(req.body?.role) ? req.body.role : 'user';
  if (!username) return res.status(400).json({ ok: false, error: 'Username required' });
  if (password.length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
  try {
    if (await getDashUser(username)) {
      return res.status(409).json({ ok: false, error: `User "${username}" already exists` });
    }
    await sp('WN_HIK_DashUser_Upsert', { username, password_hash: hashPassword(password), role });
    logAudit(auth.username, 'CREATE_DASH_USER', username, getClientIp(req), `Created dashboard account (${role})`);
    res.json({ ok: true, username, role });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

authRouter.delete('/users/:username', async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  const username = String(req.params.username);
  if (username === auth.username) {
    return res.status(400).json({ ok: false, error: 'You cannot delete the account you are signed in with' });
  }
  try {
    await sp('WN_HIK_DashUser_Delete', { username });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

export default authRouter;
