// Dashboard authentication.
//
// Stateless signed-cookie sessions so it works both on a long-running server
// and on serverless (Vercel): the token is HMAC-signed with a secret stored in
// WN_HIK_Settings, so every instance can verify it.
//
// Credentials:
//   - If ADMIN_USER / ADMIN_PASSWORD env vars are set, they win (lets you
//     reset the password from Vercel project settings without a DB change).
//   - Otherwise the username/password hash stored in WN_HIK_Settings is used,
//     seeded on first use as admin / admin123 (change it after first login).
import crypto from 'node:crypto';
import { Router } from 'express';
import { sp } from './db.js';

const COOKIE = 'wn_auth';
const SESSION_DAYS = 7;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `${salt}:${h}`;
}
function verifyPassword(password, stored) {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const candidate = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(h));
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

// Login accounts live in dbo.WN_HIK_DashboardUsers (WN_HIK_DashUser_* procs).
// If the table is empty, a default admin / admin123 account is seeded.
async function ensureSeedCredentials() {
  const rows = await sp('WN_HIK_DashUser_Count');
  if (!Number(rows[0]?.n)) {
    await sp('WN_HIK_DashUser_Upsert', { username: 'admin', password_hash: hashPassword('admin123') });
  }
}

async function getDashUser(username) {
  const rows = await sp('WN_HIK_DashUser_Get', { username: String(username) });
  return rows[0] || null;
}

async function checkCredentials(username, password) {
  if (process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
    return username === process.env.ADMIN_USER && String(password) === process.env.ADMIN_PASSWORD;
  }
  await ensureSeedCredentials();
  const user = await getDashUser(username);
  return !!user && verifyPassword(password, user.password_hash);
}

async function makeToken() {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const sig = crypto.createHmac('sha256', await authSecret()).update(String(exp)).digest('hex');
  return `${exp}.${sig}`;
}
async function tokenValid(token) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expect = crypto.createHmac('sha256', await authSecret()).update(String(exp)).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect));
  } catch {
    return false;
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

// Guard for the dashboard APIs (the external /api/ext API has its own key).
export async function requireAuth(req, res, next) {
  try {
    if (await tokenValid(readCookie(req))) return next();
  } catch { /* fall through */ }
  res.status(401).json({ error: 'authentication required' });
}

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  try {
    if (!(await checkCredentials(String(username || ''), String(password || '')))) {
      return res.status(401).json({ ok: false, error: 'Wrong username or password' });
    }
    setCookie(res, req, await makeToken(), SESSION_DAYS * 86400);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

authRouter.post('/logout', (req, res) => {
  setCookie(res, req, '', 0);
  res.json({ ok: true });
});

authRouter.get('/me', async (req, res) => {
  res.json({ ok: await tokenValid(readCookie(req)).catch(() => false) });
});

// Change a login account's password (requires being logged in + the current
// password of that account). Optionally renames the account too.
// Note: if ADMIN_USER/ADMIN_PASSWORD env vars are set, they override the
// stored credentials — change those in the environment instead.
authRouter.post('/change-password', async (req, res) => {
  if (!(await tokenValid(readCookie(req)))) return res.status(401).json({ error: 'authentication required' });
  const { current, next: nextPassword } = req.body || {};
  const username = String(req.body?.username || 'admin').trim();
  const newUsername = req.body?.newUsername ? String(req.body.newUsername).trim() : null;
  if (!nextPassword || String(nextPassword).length < 6) {
    return res.status(400).json({ ok: false, error: 'New password must be at least 6 characters' });
  }
  try {
    if (process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
      return res.status(400).json({ ok: false, error: 'Credentials are set via environment variables — change them there' });
    }
    await ensureSeedCredentials();
    const user = await getDashUser(username);
    if (!user || !verifyPassword(String(current || ''), user.password_hash)) {
      return res.status(401).json({ ok: false, error: 'Current username/password is wrong' });
    }
    await sp('WN_HIK_DashUser_Upsert', { username, password_hash: hashPassword(String(nextPassword)) });
    if (newUsername && newUsername !== username) {
      await sp('WN_HIK_DashUser_Rename', { old_username: username, new_username: newUsername });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

export default authRouter;
