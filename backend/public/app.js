// No-build SPA for the Hik co-working dashboard.
// Every API response goes through handle(): a 401 anywhere pops the login
// screen instead of failing silently.
async function handle(res) {
  if (res.status === 401) {
    showLogin();
    return { error: 'authentication required', __auth: true };
  }
  return res.json();
}
const api = {
  async get(p) { return handle(await fetch('/api' + p)); },
  async post(p, body) {
    return handle(await fetch('/api' + p, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }));
  },
  async put(p, body) {
    return handle(await fetch('/api' + p, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
  },
  async del(p) { return handle(await fetch('/api' + p, { method: 'DELETE' })); },
  async upload(p, formData) { return handle(await fetch('/api' + p, { method: 'POST', body: formData })); },
};

// ---- Login overlay ----
function showLogin() {
  if ($('#loginOverlay')) return;
  const overlay = el(`<div id="loginOverlay" class="login-overlay">
    <form class="login-card" id="loginForm">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:20px;">
        <div class="logo-icon" style="width:44px;height:44px;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <circle cx="12" cy="16" r="1.5" fill="currentColor" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>
        <div>
          <h2 style="margin:0;font-size:20px;font-weight:800;letter-spacing:-0.03em;">WorkNest Access</h2>
          <p class="hint" style="margin:0;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">Centralized Control</p>
        </div>
      </div>
      <div class="field"><label>Username</label><input id="lg_user" autocomplete="username" value="admin"></div>
      <div class="field"><label>Password</label><input id="lg_pass" type="password" autocomplete="current-password"></div>
      <div id="lg_err" class="hint" style="color:var(--red);min-height:18px"></div>
      <button class="btn primary" type="submit" style="width:100%">Sign in</button>
    </form>
  </div>`);
  document.body.appendChild(overlay);
  $('#lg_pass').focus();
  $('#loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const r = await (await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('#lg_user').value.trim(), password: $('#lg_pass').value }),
    })).json();
    if (r.ok) { location.reload(); }
    else { $('#lg_err').textContent = r.error || 'Sign-in failed'; $('#lg_pass').value = ''; $('#lg_pass').focus(); }
  });
}

async function changePasswordModal() {
  const me = await api.get('/auth/me');
  if (!me.ok) return; // 401 already showed the login overlay
  openModal(`
    <h2>Change password <small class="hint">${esc(me.username)} \u00b7 ${esc(me.role)}</small></h2>
    <div class="field"><label>Current password</label><input id="cp_cur" type="password" autocomplete="current-password"></div>
    <div class="two-col">
      <div class="field"><label>New password <small class="hint">(min 6 chars)</small></label><input id="cp_new" type="password" autocomplete="new-password"></div>
      <div class="field"><label>Repeat new password</label><input id="cp_new2" type="password" autocomplete="new-password"></div>
    </div>
    ${me.role === 'admin' ? '<p class="hint">Managing other accounts moved to <b>Dashboard Users</b> in the sidebar.</p>' : ''}
    <div class="modal-actions">
      <button class="btn" id="cp_cancel">Cancel</button>
      <button class="btn primary" id="cp_save">Change password</button>
    </div>`);
  $('#cp_cancel').addEventListener('click', closeModal);
  $('#cp_save').addEventListener('click', async () => {
    const next = $('#cp_new').value;
    if (next.length < 6) { toast('New password must be at least 6 characters', 'err'); return; }
    if (next !== $('#cp_new2').value) { toast('New passwords do not match', 'err'); return; }
    const r = await api.post('/auth/change-password', { username: me.username, current: $('#cp_cur').value, next });
    if (r.ok) { closeModal(); toast('Password changed', 'ok'); }
    else if (!r.__auth) toast(r.error || 'Failed', 'err');
  });
}

const $ = (s) => document.querySelector(s);
const content = $('#content');
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3200);
}

function openModal(html) {
  $('#modal').innerHTML = html;
  $('#modalBackdrop').hidden = false;
}

function closeModal() { $('#modalBackdrop').hidden = true; }
$('#modalBackdrop').addEventListener('click', (e) => { if (e.target.id === 'modalBackdrop') closeModal(); });

// ---- Theme Controller ----
function initTheme() {
  const saved = localStorage.getItem('worknest_theme') || 'dark';
  document.documentElement.dataset.theme = saved;
  const toggleBtn = $('#themeToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('worknest_theme', next);
      toast(`Theme set to ${next} mode`, 'ok');
    });
  }
}
initTheme();

// ---- Floating row menu (one shared instance, fixed-positioned so table
// overflow can't clip it) ----
let _rowMenu = null;
function closeRowMenu() {
  if (_rowMenu) { _rowMenu.remove(); _rowMenu = null; document.removeEventListener('click', _onMenuOutside); }
}
function _onMenuOutside(ev) { if (_rowMenu && !_rowMenu.contains(ev.target)) closeRowMenu(); }
function showRowMenu(anchor, items) {
  if (_rowMenu && _rowMenu._anchor === anchor) { closeRowMenu(); return; } // toggle
  closeRowMenu();
  const menu = document.createElement('div');
  menu.className = 'row-menu';
  menu._anchor = anchor;
  for (const [label, fn, danger] of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (danger) b.classList.add('danger');
    b.addEventListener('click', () => { closeRowMenu(); fn(); });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${Math.min(r.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.left = `${Math.max(8, r.right - menu.offsetWidth)}px`;
  _rowMenu = menu;
  setTimeout(() => document.addEventListener('click', _onMenuOutside), 0);
}
content.addEventListener('scroll', closeRowMenu);

// ---- Machine groups: one-click select of a whole group (e.g. "Entrances")
// in any machine checklist. items = [{id, grp}], checkboxClass = checklist class.
function groupSelectHtml(items) {
  const groups = new Map(); // name -> machine count
  for (const x of items) {
    const g = String(x.grp || '').trim();
    if (g) groups.set(g, (groups.get(g) || 0) + 1);
  }
  const chip = (g, n, label) => `
    <button type="button" class="grp-chip" data-grpsel="${esc(g)}" title="Select / deselect ${esc(label || 'all ' + g + ' machines')}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
      ${esc(label || g)}<span class="grp-count">${n}</span>
    </button>`;
  return `<div class="grp-row">
    <small class="hint">Groups</small>
    ${[...groups.entries()].map(([g, n]) => chip(g, n)).join('')}
    ${chip('*', items.length, 'Select all')}
  </div>`;
}
function wireGroupSelect(items, checkboxClass) {
  const boxesOf = (grp) => {
    if (grp === '*') return [...document.querySelectorAll(`.${checkboxClass}`)].filter((c) => !c.disabled);
    const ids = new Set(items.filter((x) => String(x.grp || '').trim() === grp).map((x) => String(x.id)));
    return [...document.querySelectorAll(`.${checkboxClass}`)].filter((c) => ids.has(String(c.value)) && !c.disabled);
  };
  // A chip lights up while every machine of its group is selected.
  const refresh = () => {
    document.querySelectorAll('[data-grpsel]').forEach((b) => {
      const boxes = boxesOf(b.dataset.grpsel);
      b.classList.toggle('active', boxes.length > 0 && boxes.every((c) => c.checked));
    });
  };
  document.querySelectorAll('[data-grpsel]').forEach((b) => b.addEventListener('click', () => {
    const boxes = boxesOf(b.dataset.grpsel);
    const all = boxes.length && boxes.every((c) => c.checked);
    boxes.forEach((c) => { c.checked = !all; c.dispatchEvent(new Event('change')); });
    refresh();
  }));
  document.querySelectorAll(`.${checkboxClass}`).forEach((c) => c.addEventListener('change', refresh));
  refresh();
}

// ---- Router ----
const views = { dashboard, devices, users, cards, logs, analytics: analyticsView, audit: auditView, dashusers, bookings: bookingsView };
let current = 'dashboard';
let _autoTimer = null; // live-refresh timer for dashboard / activity views
document.querySelectorAll('nav a').forEach((a) =>
  a.addEventListener('click', () => go(a.dataset.view))
);

// Mobile: the sidebar is an off-canvas drawer behind the hamburger button.
const setNav = (open) => document.body.classList.toggle('nav-open', open);
$('#menuToggle')?.addEventListener('click', () => setNav(!document.body.classList.contains('nav-open')));
$('#sidebarBackdrop')?.addEventListener('click', () => setNav(false));

function go(view) {
  current = view;
  setNav(false); // picking a page closes the mobile drawer
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  const names = { dashboard: 'Dashboard', devices: 'Machines', users: 'Users', cards: 'Cards', logs: 'Activity Log', analytics: 'Analytics & Occupancy', audit: 'Admin Audit Log', dashusers: 'Dashboard Users', bookings: 'Bookings' };
  const title = names[view] || 'Dashboard';
  $('#viewTitle').textContent = title;
  const breadcrumb = $('#viewBreadcrumb');
  if (breadcrumb) breadcrumb.textContent = title;
  $('#viewActions').innerHTML = '';
  
  const searchContainer = $('#globalSearchContainer');
  if (searchContainer) {
    searchContainer.hidden = (view === 'dashboard');
    const searchInput = $('#globalSearch');
    if (searchInput) searchInput.value = '';
  }
  clearInterval(_autoTimer);
  closeRowMenu();
  views[view]();
}

const searchInput = $('#globalSearch');
if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    const rows = document.querySelectorAll('#content table tbody tr, #content .list-row');
    rows.forEach((row) => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(q) ? '' : 'none';
    });
  });
}

const _logoutBtn = $('#logout');
if (_logoutBtn) _logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.reload();
});
const _changePassBtn = $('#changePass');
if (_changePassBtn) _changePassBtn.addEventListener('click', changePasswordModal);

$('#syncAll').addEventListener('click', async () => {
  toast('Syncing all pending changes…');
  const r = await api.post('/sync');
  toast(r.ok ? 'Sync complete!' : 'Sync failed', r.ok ? 'ok' : 'err');
  views[current]();
});

// ---- Dashboard ----
const ICONS = {
  machine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2.5" width="14" height="19" rx="2.5"/><circle cx="12" cy="9" r="2.6"/><path d="M8.5 17h7"/></svg>',
  online: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5a10 10 0 0 1 14 0"/><path d="M8.2 15.7a5.5 5.5 0 0 1 7.6 0"/><circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/></svg>',
  card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5.5" width="19" height="13" rx="2.5"/><path d="M2.5 10h19"/><path d="M6.5 14.5h4"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.8-3.5 3.6-5.5 7-5.5s6.2 2 7 5.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  sync: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 8a8 8 0 0 0-14.5-2M4 16a8 8 0 0 0 14.5 2"/><path d="M20 3v5h-5M4 21v-5h5"/></svg>',
  unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 7.8-1.3"/></svg>',
};

const ACTION_LABELS = {
  'door:open': 'Door unlocked', 'door:close': 'Door closed',
  'door:alwaysOpen': 'Door set always-open', 'door:alwaysClose': 'Door set always-closed',
  test: 'Connection test', 'add-user': 'User added', 'delete-user': 'User deleted',
  'capture-fingerprint': 'Fingerprint captured', 'store-fingerprint': 'Fingerprint enrolled',
  'capture-card': 'Card read', 'store-card': 'Card attached', 'delete-card': 'Card removed',
  'capture-face': 'Face captured', 'store-face': 'Face enrolled', 'card-expiry': 'Card expiry applied',
  'time-sync': 'Clock synced', online: 'Machine back online', offline: 'Machine went offline',
  'sync-fingerprint': 'Fingerprint auto-synced', 'sync-card': 'Card auto-synced', 'sync-face': 'Face auto-synced',
  'edit-user': 'User edited', 'delete-face': 'Face removed',
  expire: 'Access expired', 'auto-delete': 'Auto-removed after expiry', extend: 'Access extended',
  booking: 'Slot booked', 'booking-update': 'Booking rescheduled', 'booking-cancel': 'Booking cancelled',
  'copy-person': 'User copied', 'copy-card': 'Card copied', 'copy-fingerprint': 'Fingerprint copied',
  'access-grant': 'Access granted', 'access-revoke': 'Access revoked',
  'set-role:admin': 'Made admin', 'set-role:user': 'Made user',
  person: 'Person synced', card: 'Card synced', face: 'Face synced',
  fingerprint: 'Fingerprint synced', delete: 'Removed from machine',
};
const prettyAction = (a) => ACTION_LABELS[a] || a;

async function dashboard() {
  api.post('/online-check').catch(() => {}); // fresh statuses on next auto-refresh tick
  api.get('/consistency').then((c) => {
    const slot = document.getElementById('dashConsistency');
    if (current !== 'dashboard' || !slot || !c?.ok || !c.issues?.length) return;
    slot.innerHTML = `<div class="notice-banner">${c.issues.length} credential mismatch${c.issues.length === 1 ? '' : 'es'} between machines (cards/fingerprints/faces differ) — open <b>Users</b> for details.</div>`;
    slot.firstElementChild.addEventListener('click', () => go('users'));
  }).catch(() => {});
  // Live view: refresh every 30s while the dashboard is open (not over modals).
  clearInterval(_autoTimer);
  _autoTimer = setInterval(() => {
    if (current === 'dashboard' && $('#modalBackdrop').hidden) dashboard();
  }, 30000);
  const [s, devs, logsList, expiring, bookingsSummary] = await Promise.all([
    api.get('/stats'), api.get('/devices'), api.get('/logs'), api.get('/expiring'),
    api.get('/bookings-feed?summary=1'),
  ]);
  if (current !== 'dashboard') return; // view changed while loading
  content.innerHTML = '';

  const kpi = (icon, label, value, cls = '', sub = '') => `
    <div class="stat ${cls}">
      <div class="stat-head"><span class="stat-icon">${ICONS[icon]}</span><span class="label">${label}</span></div>
      <div class="value">${value}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
    </div>`;

  const machineRows = devs.length ? devs.map((d) => `
    <div class="list-row">
      <span class="status-dot ${d.online ? 'on' : 'off'}"></span>
      <div class="list-main">
        <b>${esc(d.name)}</b>
        <small class="hint">${esc(d.host)}${d.model ? ' · ' + esc(d.model) : ''}</small>
      </div>
      <span class="badge ${d.online ? 'online' : 'offline'}">${d.online ? 'Online' : 'Offline'}</span>
      <button class="btn sm" data-dash-unlock="${d.id}">Unlock</button>
    </div>`).join('')
    : '<div class="list-empty">No machines provisioned yet.</div>';

  const expItems = expiring.ok ? expiring.items : [];
  const expRows = expItems.length ? expItems.map((it) => `
    <div class="list-row">
      <span class="status-dot ${it.status === 'expired' ? 'off' : 'on'}"></span>
      <div class="list-main">
        <b>${esc(it.name || 'User ' + it.employeeNo)}</b>
        <small class="hint">#${esc(it.employeeNo)} · ${esc(it.on.map((x) => x.device).join(', '))}</small>
      </div>
      <span class="badge ${it.status === 'expired' ? 'expired' : 'pending'}">${it.status === 'expired' ? 'expired' : 'ends ' + esc(String(it.minEnd).replace('T', ' ').slice(0, 16))}</span>
      <button class="btn sm" data-extend="${esc(it.employeeNo)}" data-ename="${esc(it.name || '')}">Extend 30 days</button>
    </div>`).join('')
    : '<div class="list-empty">No memberships expiring in the next 7 days.</div>';

  const actIcon = (l) => (l.ok ? '<span class="act-dot ok"></span>' : '<span class="act-dot fail"></span>');
  const actRows = logsList.length ? logsList.slice(0, 8).map((l) => `
    <div class="list-row slim">
      ${actIcon(l)}
      <div class="list-main">
        <span>${esc(prettyAction(l.action))}${l.device_name ? ` · <span class="muted">${esc(l.device_name)}</span>` : ''}</span>
        <small class="hint">${esc(l.ts)}</small>
      </div>
      <span class="badge ${l.ok ? 'synced' : 'error'}">${l.ok ? 'ok' : 'fail'}</span>
    </div>`).join('')
    : '<div class="list-empty">No activity yet.</div>';

  const offline = devs.filter((d) => !d.online);
  const offlineBanner = offline.length
    ? `<div class="offline-banner">Machine${offline.length === 1 ? '' : 's'} offline: <b>${esc(offline.map((d) => d.name).join(', '))}</b> — check power and network. Entries and changes for ${offline.length === 1 ? 'it' : 'them'} won't apply until ${offline.length === 1 ? 'it is' : 'they are'} back.</div>`
    : '';

  const bookingsBanner = bookingsSummary.ok && bookingsSummary.needingEnrollment > 0
    ? `<div class="notice-banner" id="dashBookingsBanner">${bookingsSummary.needingEnrollment} booking${bookingsSummary.needingEnrollment === 1 ? '' : 's'} need${bookingsSummary.needingEnrollment === 1 ? 's' : ''} people enrolled (fingerprints/cards) — open <b>Bookings</b> to add them.</div>`
    : '';

  content.appendChild(el(`<div>
    ${offlineBanner}
    ${bookingsBanner}
    <div id="dashConsistency"></div>
    <div class="stat-grid">
      ${kpi('machine', 'Machines', s.devices)}
      ${kpi('online', 'Online', s.devicesOnline, s.devicesOnline === s.devices && s.devices ? 'good' : s.devices ? 'warn' : '')}
      ${kpi('card', 'Cards', s.cards ?? 0)}
      ${kpi('user', 'Active', s.active, 'good')}
      ${kpi('clock', 'Expired', s.expired, s.expired ? 'warn' : '')}
      ${kpi('sync', 'Pending sync', s.pendingSync, s.pendingSync ? 'bad' : '')}
    </div>

    <div class="panel-grid">
      <section class="panel">
        <header>
          <h3>Machines</h3>
          <div class="panel-actions">
            ${devs.length ? '<button class="btn sm" id="dashUnlockAll">Unlock all</button>' : ''}
            <button class="btn sm" id="dashGoMachines">Manage →</button>
          </div>
        </header>
        <div class="panel-body">${machineRows}</div>
      </section>

      <section class="panel">
        <header>
          <h3>Recent activity</h3>
          <div class="panel-actions"><button class="btn sm" id="dashGoLogs">View all →</button></div>
        </header>
        <div class="panel-body">${actRows}</div>
      </section>
    </div>

    <section class="panel" style="margin-top:16px; height:auto; max-height:320px">
      <header>
        <h3>Expiring soon (next ${expiring.horizonDays || 7} days)</h3>
        <div class="panel-actions"><button class="btn sm" id="dashGoUsers">Users →</button></div>
      </header>
      <div class="panel-body">${expRows}</div>
    </section>

    <p class="hint" style="margin-top:20px">
      Machines enforce each person's valid period on their own — access is blocked at the door after expiry even if this dashboard is offline.
    </p>
  </div>`));

  $('#dashGoMachines').addEventListener('click', () => go('devices'));
  $('#dashGoLogs').addEventListener('click', () => go('logs'));
  $('#dashGoUsers').addEventListener('click', () => go('users'));
  const bb = $('#dashBookingsBanner');
  if (bb) bb.addEventListener('click', () => go('bookings'));
  content.querySelectorAll('[data-extend]').forEach((b) => b.addEventListener('click', async () => {
    const who = b.dataset.ename || 'user ' + b.dataset.extend;
    if (!confirm(`Extend “${who}” (#${b.dataset.extend}) by 30 days on all their machines?`)) return;
    toast('Extending access…');
    const r = await api.post('/expiring/extend', { employeeNo: b.dataset.extend, name: b.dataset.ename || undefined, days: 30 });
    const fails = (r.results || []).filter((x) => !x.ok);
    toast(r.ok
      ? (fails.length ? `Extended, but failed on ${fails.map((f) => f.device).join(', ')}` : `Extended to ${(r.newEnd || '').replace('T', ' ').slice(0, 16)}`)
      : `Failed: ${r.error || 'error'}`, r.ok && !fails.length ? 'ok' : 'err');
    dashboard();
  }));
  const ua = $('#dashUnlockAll');
  if (ua) ua.addEventListener('click', async () => {
    if (!confirm(`Unlock the door on ALL ${devs.length} machine${devs.length === 1 ? '' : 's'} now?`)) return;
    toast('Unlocking all doors…');
    const r = await api.post('/devices/door', { cmd: 'open' });
    const failed = (r.results || []).filter((x) => !x.ok);
    toast(failed.length ? `Unlocked ${r.okCount}/${r.total}` : `Unlocked all ${r.okCount}`, failed.length ? 'err' : 'ok');
  });
  content.querySelectorAll('[data-dash-unlock]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Unlock the door on this machine now?')) return;
    toast('Unlocking…');
    const r = await api.post(`/devices/${b.dataset.dashUnlock}/door`, { cmd: 'open' });
    toast(r.ok ? 'Door unlocked' : `Failed: ${r.error || 'error'}`, r.ok ? 'ok' : 'err');
  }));
}

// ---- Devices ----
async function devices() {
  // Live view: machine online/offline status refreshes on its own.
  clearInterval(_autoTimer);
  _autoTimer = setInterval(() => {
    if (current === 'devices' && $('#modalBackdrop').hidden) devices();
  }, 30000);
  const list = await api.get('/devices');
  if (current !== 'devices') return; // view changed while loading
  $('#viewActions').innerHTML =
    (dashRole === 'admin' ? '<button class="btn" id="addMachine">+ Add machine</button>' : '') +
    (list.length ? '<button class="btn primary" id="unlockAll">Unlock all doors</button>' : '');
  $('#addMachine')?.addEventListener('click', () => deviceModal(null, list));
  const unlockAllBtn = $('#unlockAll');
  if (unlockAllBtn) unlockAllBtn.addEventListener('click', async () => {
    if (!confirm(`Unlock the door on ALL ${list.length} machine${list.length === 1 ? '' : 's'} now?`)) return;
    toast('Unlocking all doors…');
    const r = await api.post('/devices/door', { cmd: 'open' });
    const failed = (r.results || []).filter((x) => !x.ok);
    toast(
      failed.length ? `Unlocked ${r.okCount}/${r.total} — failed: ${failed.map((f) => f.device).join(', ')}` : `Unlocked all ${r.okCount} door${r.okCount === 1 ? '' : 's'}`,
      failed.length ? (r.okCount ? '' : 'err') : 'ok'
    );
  });
  content.innerHTML = '';
  if (!list.length) { content.appendChild(el('<div class="empty">No machines. Machines are provisioned in the database — add them via <code>data/machines.json</code> or a direct INSERT into <code>devices</code>, then restart.</div>')); return; }
  const rows = list.map((d) => `
    <tr>
      <td><b>${esc(d.name)}</b> ${d.grp ? `<span class="badge">${esc(d.grp)}</span>` : ''} ${d.code ? `<span class="badge admin">room ${esc(d.code)}</span>` : ''}<br><small class="hint">${esc(d.location || '')}</small></td>
      <td>${esc(d.host)}:${d.port}${d.use_https ? ' <small class="hint">https</small>' : ''}</td>
      <td>${esc(d.model || '—')}<br><small class="hint">${esc(d.serial || '')}</small></td>
      <td><span class="badge ${d.online ? 'online' : 'offline'}">${d.online ? 'Online' : 'Offline'}</span></td>
      <td class="row-actions">
        <button class="btn sm" data-book="${d.id}">Book slot</button>
        <button class="btn sm" data-open="${d.id}">Unlock</button>
        <button class="btn sm" data-users="${d.id}" data-name="${esc(d.name)}">Users</button>
        <button class="btn sm" data-test="${d.id}">Test</button>
        <button class="btn sm" data-edit="${d.id}">Edit</button>
        <button class="btn sm danger" data-del="${d.id}">Delete</button>
      </td>
    </tr>`).join('');
  content.appendChild(el(`<div class="table-wrapper"><table><thead><tr>
      <th>Name</th><th>Address</th><th>Model</th><th>Status</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>`));

  content.querySelectorAll('[data-test]').forEach((b) => b.addEventListener('click', async () => {
    toast('Testing connection…');
    const r = await api.post(`/devices/${b.dataset.test}/test`);
    toast(r.ok ? `Connected: ${r.info.model || 'ok'}` : `Failed: ${r.error}`, r.ok ? 'ok' : 'err');
    devices();
  }));
  content.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Unlock the door on this machine now?')) return;
    toast('Unlocking…');
    const r = await api.post(`/devices/${b.dataset.open}/door`, { cmd: 'open' });
    toast(r.ok ? 'Door unlocked' : `Failed: ${r.error || 'error'}`, r.ok ? 'ok' : 'err');
  }));
  content.querySelectorAll('[data-users]').forEach((b) => b.addEventListener('click', async () => {
    toast('Fetching users from machine…');
    const r = await api.get(`/devices/${b.dataset.users}/users`);
    if (!r.ok) { toast(`Failed: ${r.error || 'error'}`, 'err'); return; }
    toast(`${r.total} user${r.total === 1 ? '' : 's'} on device`, 'ok');
    usersModal(list.find((d) => d.id == b.dataset.users), r.users, list);
  }));
  content.querySelectorAll('[data-book]').forEach((b) =>
    b.addEventListener('click', () => bookSlotModal(list.find((d) => d.id == b.dataset.book), list)));
  content.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => deviceModal(list.find((d) => d.id == b.dataset.edit), list)));
  content.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Delete this machine?')) return;
    await api.del(`/devices/${b.dataset.del}`); devices();
  }));
  // Kick a live reachability check (works on Vercel too — no background jobs
  // needed there); refresh the list only if any machine changed state.
  api.post('/online-check').then((r) => {
    if (r?.ok && r.changed && current === 'devices' && !document.querySelector('#modalBackdrop:not([hidden])')) devices();
  }).catch(() => {});
}

// Live list of persons enrolled on a device (pulled straight from the terminal).
function usersModal(srcDev, users, devs = []) {
  const rows = users.length
    ? users.map((u) => {
        const creds = [];
        if (u.cards && u.cards.length) creds.push(`card${u.cards.length > 1 ? 's' : ''} ${u.cards.join(', ')}`);
        else if (u.numOfCard) creds.push(`${u.numOfCard} card`);
        if (u.numOfFP) creds.push(`${u.numOfFP} fp`);
        if (u.numOfFace) creds.push(`${u.numOfFace} face`);
        const end = u.Valid?.endTime ? u.Valid.endTime.replace('T', ' ') : '—';
        return `<tr>
          <td>${esc(u.employeeNo)}</td>
          <td><b>${esc(u.name || '—')}</b></td>
          <td class="nowrap"><small class="hint">${esc(end)}</small></td>
          <td><small class="hint">${esc(creds.join(' · ') || 'no credentials')}</small></td>
          <td class="row-actions">
            <button class="btn sm" data-copy="${esc(u.employeeNo)}" data-uname="${esc(u.name || '')}">Copy →</button>
            <button class="btn sm danger" data-del="${esc(u.employeeNo)}" data-uname="${esc(u.name || '')}">Delete</button>
          </td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="5" class="muted">No users enrolled on this device.</td></tr>';
  openModal(`
    <h2>Users on ${esc(srcDev.name)}</h2>
    <p class="hint">${users.length} enrolled — read live from the machine. <b>Copy →</b> re-enrols a user on another machine with an access deadline.</p>
    <div style="max-height:52vh; overflow:auto">
      <table><thead><tr><th>Emp #</th><th>Name</th><th>Valid until</th><th>Credentials</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
    </div>
    <div class="modal-actions"><button class="btn primary" id="u_close">Close</button></div>`);
  $('#u_close').addEventListener('click', closeModal);
  $('#modal').querySelectorAll('[data-copy]').forEach((b) =>
    b.addEventListener('click', () => copyUserModal(srcDev, b.dataset.copy, b.dataset.uname, devs, users)));
  $('#modal').querySelectorAll('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm(`Delete “${b.dataset.uname || 'user ' + b.dataset.del}” from ${srcDev.name}?`)) return;
      toast('Deleting user…');
      const r = await api.del(`/devices/${srcDev.id}/users/${encodeURIComponent(b.dataset.del)}`);
      toast(r.ok ? 'User deleted' : `Failed: ${r.error || 'error'}`, r.ok ? 'ok' : 'err');
      closeModal();
    }));
}

// Copy a user from srcDev to one or more other machines, with an access deadline.
function copyUserModal(srcDev, employeeNo, name, devs, users) {
  const targets = devs.filter((d) => d.id !== srcDev.id);
  const targetChecks = targets.length
    ? targets.map((d) => `<label><input type="checkbox" class="copy-target" value="${d.id}"> ${esc(d.name)} <small class="hint">${esc(d.host)}</small></label>`).join('')
    : '<span class="muted">No other machines yet. Provision a second machine in the database to copy to.</span>';
  openModal(`
    <h2>Copy “${esc(name || 'User ' + employeeNo)}” → machine(s)</h2>
    <p class="hint">From ${esc(srcDev.name)}. Copies identity, fingerprints, cards and the face template.</p>
    <div class="field">
      <label>Access until <small class="hint">(deadline enforced by the machine)</small></label>
      <input id="copy_end" type="datetime-local">
    </div>
    <div class="field">
      <label>Target machines</label>
      <div class="device-checklist">${targetChecks}</div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="copy_cancel">Cancel</button>
      <button class="btn primary" id="copy_go" ${targets.length ? '' : 'disabled'}>Copy</button>
    </div>`);
  $('#copy_cancel').addEventListener('click', closeModal);
  if (!targets.length) return;
  $('#copy_go').addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('.copy-target:checked')].map((x) => Number(x.value));
    if (!ids.length) { toast('Pick at least one target machine', 'err'); return; }
    const valid_end = fromLocalInput($('#copy_end').value);
    toast('Copying to machine(s)…');
    const r = await api.post(`/devices/${srcDev.id}/users/${encodeURIComponent(employeeNo)}/copy`, {
      target_device_ids: ids, valid_end,
    });
    if (!r.ok) { toast(`Failed: ${r.error || 'error'}`, 'err'); return; }
    const bad = (r.results || []).filter((x) => x.state === 'error');
    const okCount = (r.results || []).length - bad.length;
    toast(bad.length ? `Copied to ${okCount}, ${bad.length} failed` : `Copied to ${okCount} machine(s)`, bad.length ? 'err' : 'ok');
    closeModal();
  });
}

function deviceModal(d = null, all = []) {
  const groups = [...new Set(all.map((x) => String(x.grp || '').trim()).filter(Boolean))].sort();
  openModal(`
    <h2>${d ? 'Edit machine' : 'Add machine'}</h2>
    <div class="field"><label>Name</label><input id="d_name" value="${esc(d?.name || '')}" placeholder="Front door machine"></div>
    <div class="two-col">
      <div class="field"><label>IP / host</label><input id="d_host" value="${esc(d?.host || '')}" placeholder="192.168.1.64"></div>
      <div class="field"><label>Port</label><input id="d_port" type="number" value="${d?.port || 80}"></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Username</label><input id="d_user" value="${esc(d?.username || 'admin')}"></div>
      <div class="field"><label>Password</label><input id="d_pass" type="password" value="" placeholder="${d ? '•••• (unchanged)' : ''}"></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Location</label><input id="d_loc" value="${esc(d?.location || '')}" placeholder="Reception"></div>
      <div class="field"><label>Room code <small class="hint">(matches a space's code)</small></label><input id="d_code" value="${esc(d?.code || '')}" placeholder="e.g. 355"></div>
      <div class="field"><label>Group</label>
        <select id="d_grp_sel">
          <option value="">No group</option>
          ${groups.map((g) => `<option value="${esc(g)}" ${(d?.grp || '') === g ? 'selected' : ''}>${esc(g)}</option>`).join('')}
          <option value="__new">+ New group…</option>
        </select>
        <input id="d_grp_new" placeholder="New group name, e.g. Entrances" style="margin-top:8px; display:none">
      </div>
    </div>
    <div class="field check"><input id="d_https" type="checkbox" ${d?.use_https ? 'checked' : ''}><label>Use HTTPS</label></div>
    <div class="modal-actions">
      <button class="btn" id="d_cancel">Cancel</button>
      <button class="btn primary" id="d_save">${d ? 'Save' : 'Add'}</button>
    </div>`);
  $('#d_grp_sel').addEventListener('change', () => {
    const isNew = $('#d_grp_sel').value === '__new';
    $('#d_grp_new').style.display = isNew ? '' : 'none';
    if (isNew) $('#d_grp_new').focus();
  });
  $('#d_cancel').addEventListener('click', closeModal);
  $('#d_save').addEventListener('click', async () => {
    const grpSel = $('#d_grp_sel').value;
    const body = {
      name: $('#d_name').value.trim(), host: $('#d_host').value.trim(),
      port: Number($('#d_port').value), username: $('#d_user').value.trim(),
      location: $('#d_loc').value.trim(), use_https: $('#d_https').checked,
      grp: grpSel === '__new' ? ($('#d_grp_new').value.trim() || null) : (grpSel || null),
      code: $('#d_code').value.trim() || null,
    };
    const pass = $('#d_pass').value;
    if (pass) body.password = pass;
    if (!body.name || !body.host || !body.username || (!d && !pass)) { toast('Fill name, host, user, password', 'err'); return; }
    const r = d ? await api.put(`/devices/${d.id}`, body) : await api.post('/devices', body);
    if (r.error) { toast(r.error, 'err'); return; }
    closeModal(); toast('Saved', 'ok'); devices();
  });
}

// ---- Users (enrolled ON the machines) ----
let _usersDevId = 'all';
async function users() {
  const devs = await api.get('/devices');
  if (current !== 'users') return; // view changed while loading
  $('#viewActions').innerHTML = '';
  content.innerHTML = '';
  if (!devs.length) { content.appendChild(el('<div class="empty">No machines yet. Provision a machine in the database first.</div>')); return; }
  if (_usersDevId !== 'all' && !devs.find((d) => d.id == _usersDevId)) _usersDevId = 'all';
  content.appendChild(el(`<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
      <label class="hint">Machine</label>
      <select id="u_dev">
        <option value="all" ${_usersDevId === 'all' ? 'selected' : ''}>All machines</option>
        ${devs.map((d) => `<option value="${d.id}" ${d.id == _usersDevId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
      </select>
      <button class="btn primary" id="u_add">+ Add user</button>
      <button class="btn" id="u_daypass">+ Day pass</button>
      <button class="btn" id="u_refresh">Refresh</button>
    </div>`));
  content.appendChild(el('<div id="u_table"></div>'));
  $('#u_dev').addEventListener('change', (e) => { _usersDevId = e.target.value === 'all' ? 'all' : Number(e.target.value); loadUsersTable(devs); });
  $('#u_refresh').addEventListener('click', () => loadUsersTable(devs));
  $('#u_add').addEventListener('click', () => addUserModal(_usersDevId === 'all' ? devs[0] : devs.find((d) => d.id == _usersDevId), devs, _usersDevId === 'all'));
  $('#u_daypass').addEventListener('click', () => dayPassModal(devs));
  loadUsersTable(devs);
}

async function loadUsersTable(devs) {
  const holder = $('#u_table');
  if (!holder) return;
  const all = _usersDevId === 'all';
  holder.innerHTML = '<div class="muted">Loading users…</div>';

  // entries: one row per person — u = device record, on = machines they exist on
  let entries = [];
  const unreachable = [];
  if (all) {
    const rr = await api.get('/roster'); // one request — server queries all machines in parallel
    const results = devs.map((d) => {
      const row = rr.ok ? (rr.rosters || []).find((x) => x.device_id === d.id) : null;
      return { d, r: row?.ok ? { ok: true, users: row.users } : { ok: false, error: row?.error || rr.error } };
    });
    const map = new Map();
    for (const { d, r } of results) {
      if (!r.ok) { unreachable.push(d.name); continue; }
      for (const u of r.users) {
        // Same person = same employee # AND same name. "#1 TEST" and
        // "#1 Ahmad" on different machines stay separate rows.
        const key = `${u.employeeNo}||${String(u.name || '').trim().toLowerCase()}`;
        if (!map.has(key)) map.set(key, { u, on: [] });
        map.get(key).on.push(d);
      }
    }
    entries = [...map.values()].sort((a, b) =>
      ((Number(a.u.employeeNo) || 0) - (Number(b.u.employeeNo) || 0)) ||
      String(a.u.name || '').localeCompare(String(b.u.name || '')));
  } else {
    const srcDev = devs.find((d) => d.id == _usersDevId);
    const r = await api.get(`/devices/${_usersDevId}/users`);
    if (!r.ok) { holder.innerHTML = `<div class="empty">Couldn't reach ${esc(srcDev.name)}: ${esc(r.error || 'error')}</div>`; return; }
    entries = r.users.map((u) => ({ u, on: [srcDev] }));
  }

  const note = unreachable.length ? `<p class="hint" style="margin:0 0 10px">Unreachable: ${esc(unreachable.join(', '))} — their users are not shown.</p>` : '';
  if (!entries.length) { holder.innerHTML = `${note}<div class="empty">No users found. Click <b>+ Add user</b>.</div>`; return; }

  const rows = entries.map(({ u, on }, i) => {
    const creds = [];
    if (u.numOfCard) creds.push(`${u.numOfCard} card`);
    if (u.numOfFP) creds.push(`${u.numOfFP} fp`);
    if (u.numOfFace) creds.push(`${u.numOfFace} face`);
    const end = u.Valid?.endTime ? u.Valid.endTime.replace('T', ' ') : '—';
    const blocked = u.Valid?.enable === false;
    const admin = !!u.localUIRight;
    return `<tr class="clickable-row" data-rowidx="${i}" title="View full profile">
      <td>${esc(u.employeeNo)}</td>
      <td><a class="link" data-profile="${i}"><b>${esc(u.name || '—')}</b></a></td>
      <td>${admin ? '<span class="badge admin">Admin</span>' : '<span class="badge">User</span>'}</td>
      ${all ? `<td><small class="hint">${on.map((d) => esc(d.name)).join(', ')}</small></td>` : ''}
      <td class="nowrap">${blocked ? '<span class="badge blocked">blocked</span>' : `<small class="hint">${esc(end)}</small>`}</td>
      <td><small class="hint">${u.numOfCard ? `<a class="link" data-cards="${i}">${esc(creds.join(' · '))}</a>` : esc(creds.join(' · ') || 'no credentials')}</small></td>
      <td class="row-actions">
        <button class="btn sm" data-menu="${i}">Actions ▾</button>
      </td></tr>`;
  }).join('');
  holder.innerHTML = `${note}<div id="consistencyNote"></div><div class="table-wrapper"><table><thead><tr><th>Emp #</th><th>Name</th><th>Role</th>${all ? '<th>Machines</th>' : ''}<th>Valid until</th><th>Credentials</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;

  // Central-truth check: machines are compared in the background and any
  // credential disagreement (cards/fingerprints/faces) is flagged here.
  if (all) api.get('/consistency').then((c) => {
    if (current !== 'users' || !c?.ok || !document.getElementById('consistencyNote')) return;
    if (!c.issues.length) return;
    const flagged = new Set();
    for (const iss of c.issues) {
      if (iss.holders) for (const h of iss.holders) flagged.add(`${h.employeeNo}||${String(h.name || '').trim().toLowerCase()}`);
      if (iss.employeeNo !== undefined) flagged.add(`${iss.employeeNo}||${String(iss.name || '').trim().toLowerCase()}`);
    }
    entries.forEach(({ u }, i) => {
      const key = `${u.employeeNo}||${String(u.name || '').trim().toLowerCase()}`;
      if (!flagged.has(key)) return;
      const cell = holder.querySelector(`tr[data-rowidx="${i}"] td:nth-last-child(2)`);
      if (cell) cell.insertAdjacentHTML('beforeend', ' <span class="badge pending" title="Credentials differ between machines — see the notice above">differs</span>');
    });
    document.getElementById('consistencyNote').innerHTML = `
      <div class="notice-banner" style="cursor:default">
        <b>${c.issues.length} credential mismatch${c.issues.length === 1 ? '' : 'es'} between machines</b> — the dashboard compared ${c.checked} reachable machine${c.checked === 1 ? '' : 's'}.
        <details style="margin-top:6px"><summary style="cursor:pointer">Show details</summary>
          <ul style="margin:8px 0 0 18px; padding:0">${c.issues.map((i, n) => `<li style="margin-bottom:6px">${esc(i.detail)}
            ${i.employeeNo !== undefined && i.type !== 'card-conflict' ? `<button class="btn sm" style="margin-left:8px" data-fixmm="${n}">Copy missing to ${esc(i.name || '#' + i.employeeNo)}'s machines</button>` : ''}</li>`).join('')}</ul>
        </details>
      </div>`;
    document.querySelectorAll('[data-fixmm]').forEach((b) => b.addEventListener('click', async () => {
      const iss = c.issues[Number(b.dataset.fixmm)];
      b.disabled = true;
      // Batches of machines with a live progress bar; the credential union is
      // always computed from every machine, each batch only WRITES to its own.
      const allIds = devs.map((d) => d.id);
      const chunks = [];
      for (let i = 0; i < allIds.length; i += 10) chunks.push(allIds.slice(i, i + 10));
      const bar = progressBar(allIds.length, `Copying to ${iss.name || '#' + iss.employeeNo} —`);
      let copied = 0;
      let err = null;
      await runBatched(chunks, async (chunk) => {
        const r = await api.post('/consistency/fix', { employeeNo: iss.employeeNo, name: iss.name || '', only_device_ids: chunk });
        if (r.ok) copied += r.copied || 0;
        else err = r.error || 'error';
      }, bar, 1);
      bar.close();
      toast(err && !copied ? `Failed: ${err}` : `Done — copied ${copied} credential(s)`, err && !copied ? 'err' : 'ok');
      if (current === 'users') loadUsersTable(devs);
    }));
  }).catch(() => {});

  holder.querySelectorAll('[data-profile]').forEach((b) => b.addEventListener('click', (ev) => { ev.preventDefault(); userProfileModal(entries[Number(b.dataset.profile)]); }));
  // Whole row opens the profile — except clicks on buttons/links/inputs inside it.
  holder.querySelectorAll('tr[data-rowidx]').forEach((tr) => tr.addEventListener('click', (ev) => {
    if (ev.target.closest('button, a, input, select, label')) return;
    userProfileModal(entries[Number(tr.dataset.rowidx)]);
  }));
  // One "Actions" dropdown per row instead of a strip of buttons.
  holder.querySelectorAll('[data-menu]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const e = entries[Number(b.dataset.menu)];
    const admin = !!e.u.localUIRight;
    showRowMenu(b, [
      ['View profile', () => userProfileModal(e)],
      ['Edit name / #', () => editUserModal(e, devs)],
      ['Machine access', () => accessModal(e.on[0], e.u.employeeNo, e.u.name || '', devs)],
      ...(dashRole === 'admin' ? [[admin ? 'Make user' : 'Make admin', () => setRole(e.on, e.u.employeeNo, admin ? 'user' : 'admin', devs)]] : []),
      ['Tag card', () => tagCard(e, devs)],
      ['Capture fingerprint', () => captureFpModal(e, devs)],
      e.u.numOfFace ? ['Delete face', () => deleteFaceAction(e, devs), true] : ['Enroll face', () => enrollFace(e, devs)],
      ...(dashRole === 'admin' ? [['Copy to machine…', () => copyUserModal(e.on[0], e.u.employeeNo, e.u.name || '', devs, entries.map((x) => x.u))]] : []),
      ['Delete user', () => deleteUser(e.on, e.u.employeeNo, e.u.name || '', devs), true],
    ]);
  }));
  holder.querySelectorAll('[data-cards]').forEach((b) => b.addEventListener('click', (ev) => { ev.preventDefault(); userCardsModal(entries[Number(b.dataset.cards)], devs); }));
}

async function deleteFaceAction(e, devs) {
  const where = e.on.map((d) => d.name).join(', ');
  if (!confirm(`Delete the face of “${e.u.name || 'user ' + e.u.employeeNo}” from: ${where}?\n\nTheir fingerprints, cards and profile stay — only face recognition stops working.`)) return;
  toast('Deleting face…');
  const r = await api.post(`/devices/${e.on[0].id}/users/${encodeURIComponent(e.u.employeeNo)}/delete-face`, {
    device_ids: e.on.map((d) => d.id),
  });
  const fails = (r.results || []).filter((x) => !x.ok);
  toast(fails.length ? `Failed on ${fails.map((f) => f.device).join(', ')}${fails[0].error ? ': ' + fails[0].error : ''}` : `Face deleted from ${e.on.length} machine${e.on.length === 1 ? '' : 's'}`, fails.length ? 'err' : 'ok');
  if ($('#u_table')) loadUsersTable(devs);
}

async function deleteUser(devsOn, employeeNo, name, devs) {
  const where = devsOn.map((d) => d.name).join(', ');
  if (!confirm(`Delete “${name || 'user ' + employeeNo}” (#${employeeNo}) from: ${where}? This removes them from the machine${devsOn.length > 1 ? 's' : ''}.`)) return;
  const bar = progressBar(devsOn.length, 'Deleting —');
  const fails = [];
  await runBatched(devsOn, async (d) => {
    const r = await api.del(`/devices/${d.id}/users/${encodeURIComponent(employeeNo)}`);
    if (!r.ok) fails.push(`${d.name}: ${r.error || 'error'}`);
  }, bar, 6);
  bar.close();
  toast(fails.length ? `Failed on ${fails.length} machine(s): ${fails[0]}` : `User deleted from ${devsOn.length} machine${devsOn.length > 1 ? 's' : ''}`, fails.length ? 'err' : 'ok');
  if ($('#u_table')) loadUsersTable(devs);
}

// Book a time slot on one machine (meeting room style): an existing member or
// a walk-in visitor gets door access only between slot start and slot end.
function bookSlotModal(dev, devs) {
  const p2 = (n) => String(n).padStart(2, '0');
  const d0 = new Date();
  const dstr = `${d0.getFullYear()}-${p2(d0.getMonth() + 1)}-${p2(d0.getDate())}`;
  openModal(`
    <h2>Book slot — ${esc(dev.name)}</h2>
    <div class="field"><label>Who</label>
      <select id="bk_user"><option value="">Loading users…</option></select>
    </div>
    <div id="bk_visitor" hidden>
      <div class="two-col">
        <div class="field"><label>Visitor name</label><input id="bk_vname" placeholder="e.g. Meeting guest"></div>
        <div class="field"><label>RFID card # <small class="hint">(optional — typed)</small></label><input id="bk_vcard" placeholder="or Tag card later"></div>
      </div>
    </div>
    <div class="two-col">
      <div class="field"><label>Slot start</label><input id="bk_begin" type="datetime-local" value="${dstr}T13:00"></div>
      <div class="field"><label>Slot end</label><input id="bk_end" type="datetime-local" value="${dstr}T15:00"></div>
    </div>
    <p class="hint">The machine only opens for them inside the slot — enforced by the machine itself. Members keep their fingerprints/cards (copied over if they're not on this machine yet); visitors are auto-removed after the slot ends.</p>
    <div class="modal-actions">
      <button class="btn" id="bk_cancel">Cancel</button>
      <button class="btn primary" id="bk_save">Book slot</button>
    </div>`);
  (async () => {
    const results = await Promise.all(devs.map(async (d) => ({ d, r: await api.get(`/devices/${d.id}/users`) })));
    const seen = new Map();
    for (const { r } of results) {
      if (!r.ok) continue;
      for (const u of r.users || []) {
        const key = `${u.employeeNo}||${String(u.name || '').trim().toLowerCase()}`;
        if (!seen.has(key)) seen.set(key, u);
      }
    }
    const opts = [...seen.values()]
      .sort((a, b) => ((Number(a.employeeNo) || 0) - (Number(b.employeeNo) || 0)))
      .map((u) => `<option value="${esc(u.employeeNo)}|${esc(u.name || '')}">${esc(u.name || 'User')} — #${esc(u.employeeNo)}</option>`)
      .join('');
    const sel = $('#bk_user');
    if (sel) sel.innerHTML = opts + '<option value="__visitor">New visitor (with card)</option>';
  })();
  $('#bk_user').addEventListener('change', () => { $('#bk_visitor').hidden = $('#bk_user').value !== '__visitor'; });
  $('#bk_cancel').addEventListener('click', closeModal);
  $('#bk_save').addEventListener('click', async () => {
    const begin = fromLocalInput($('#bk_begin').value);
    const end = fromLocalInput($('#bk_end').value);
    if (!begin || !end) { toast('Pick slot start and end', 'err'); return; }
    if (end <= begin) { toast('Slot end must be after slot start', 'err'); return; }
    const who = $('#bk_user').value;
    if (!who) { toast('Pick a person', 'err'); return; }
    toast('Booking slot…');
    if (who === '__visitor') {
      const name = $('#bk_vname').value.trim();
      if (!name) { toast('Visitor name required', 'err'); return; }
      const r = await api.post('/visitors', {
        name,
        card_no: $('#bk_vcard').value.trim() || undefined,
        valid_begin: begin,
        valid_end: end,
        device_ids: [dev.id],
      });
      if (!r.ok && r.error) { toast(`Failed: ${r.error}`, 'err'); return; }
      const bad = (r.results || []).filter((x) => x.state === 'error');
      closeModal();
      toast(bad.length ? `Visitor created but failed on ${bad.map((b) => b.device).join(', ')}`
        : `Slot booked — visitor #${r.employeeNo}, ${begin.replace('T', ' ').slice(0, 16)} → ${end.replace('T', ' ').slice(11, 16)}`, bad.length ? 'err' : 'ok');
    } else {
      const [employeeNo, uname] = who.split('|');
      const r = await api.post('/bookings', { device_id: dev.id, employeeNo, name: uname || undefined, begin, end });
      if (!r.ok) { toast(`Failed: ${r.error || 'error'}`, 'err'); return; }
      closeModal();
      toast(`Slot booked — ${r.name} on ${dev.name}, ${begin.replace('T', ' ').slice(0, 16)} → ${end.replace('T', ' ').slice(11, 16)}`, 'ok');
    }
  });
}

// One-click visitor: valid until tonight by default, pushed to the selected
// machines now, auto-deleted from them after expiry.
function dayPassModal(devs) {
  const p = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const tonight = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T23:59`;
  const checks = devs.map((x) =>
    `<label><input type="checkbox" class="dp-dev" value="${x.id}" checked> ${esc(x.name)} <small class="hint">${esc(x.host)}</small></label>`
  ).join('');
  openModal(`
    <h2>Day pass</h2>
    <div class="two-col">
      <div class="field"><label>Visitor name</label><input id="dp_name" placeholder="e.g. Sara (visitor)"></div>
      <div class="field"><label>RFID card # <small class="hint">(optional — typed)</small></label><input id="dp_card" placeholder="or Tag card later"></div>
    </div>
    <div class="field"><label>Valid until</label><input id="dp_end" type="datetime-local" value="${tonight}"></div>
    <div class="field"><label>Machines</label>
      ${groupSelectHtml(devs)}
      <div class="device-checklist">${checks}</div>
    </div>
    <p class="hint">The visitor can enter until the deadline, then the machines block them and the dashboard <b>auto-deletes them from the machines</b>. Fingerprint or face can be added from their Users row after creating.</p>
    <div class="modal-actions">
      <button class="btn" id="dp_cancel">Cancel</button>
      <button class="btn primary" id="dp_save">Create day pass</button>
    </div>`);
  wireGroupSelect(devs, 'dp-dev');
  $('#dp_cancel').addEventListener('click', closeModal);
  $('#dp_save').addEventListener('click', async () => {
    const name = $('#dp_name').value.trim();
    if (!name) { toast('Name required', 'err'); return; }
    const deviceIds = [...document.querySelectorAll('.dp-dev:checked')].map((c) => Number(c.value));
    if (!deviceIds.length) { toast('Pick at least one machine', 'err'); return; }
    toast('Creating day pass…');
    const r = await api.post('/visitors', {
      name,
      card_no: $('#dp_card').value.trim() || undefined,
      valid_end: fromLocalInput($('#dp_end').value),
      device_ids: deviceIds,
    });
    if (!r.ok && r.error) { toast(`Failed: ${r.error}`, 'err'); return; }
    const bad = (r.results || []).filter((x) => x.state === 'error');
    closeModal();
    toast(bad.length
      ? `Visitor #${r.employeeNo} created, but failed on ${bad.map((b) => b.device).join(', ')}`
      : `Day pass created — visitor #${r.employeeNo}, valid until ${(r.valid_end || '').replace('T', ' ')}`,
      bad.length ? 'err' : 'ok');
    if ($('#u_table')) loadUsersTable(devs);
  });
}

// Row entry point: pick which machine's camera captures the face, then the
// face is copied to the user's other machines automatically.
function enrollFace(entry, devs) {
  const { u, on } = entry;
  const opts = on.map((d, i) => `<option value="${d.id}" ${i === 0 ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  openModal(`
    <h2>Enroll face — ${esc(u.name || 'User ' + u.employeeNo)} <small class="hint">#${esc(u.employeeNo)}</small></h2>
    <div class="field"><label>Capture at this machine</label><select id="ef_dev">${opts}</select></div>
    <p class="hint">Click <b>Start capture</b> — the chosen machine shows its face screen and the person stands in front of the camera (about 30s).${on.length > 1 ? ' The face is then copied to their other machines automatically.' : ''}</p>
    <div class="modal-actions">
      <button class="btn" id="ef_cancel">Cancel</button>
      <button class="btn primary" id="ef_start">Start capture</button>
    </div>`);
  $('#ef_cancel').addEventListener('click', closeModal);
  $('#ef_start').addEventListener('click', async () => {
    if (captureBusy) { toast('A capture is already in progress — wait for it to finish.', 'err'); return; }
    const dev = on.find((d) => d.id === Number($('#ef_dev').value)) || on[0];
    captureBusy = true;
    closeModal();
    toast(`Waiting for a face at ${dev.name}…`);
    try {
      const r = await api.post(`/devices/${dev.id}/users/${encodeURIComponent(u.employeeNo)}/capture-face`, {
        replicate_device_ids: on.map((d) => d.id),
      });
      const repBad = (r.replicated || []).filter((x) => !x.ok);
      const repOk = (r.replicated || []).filter((x) => x.ok);
      if (!r.ok) toast(`Failed: ${r.error || 'no face captured'}`, 'err');
      else if (repBad.length) toast(`Enrolled on ${dev.name}, but copy failed on ${repBad.map((x) => x.device).join(', ')}`, 'err');
      else toast(`Face enrolled${repOk.length ? ` on ${1 + repOk.length} machines` : ''}`, 'ok');
      if ($('#u_table')) loadUsersTable(devs);
    } finally { captureBusy = false; }
  });
}

// Row entry point: pick which machine's sensor reads the finger.
function captureFpModal(entry, devs) {
  const { u, on } = entry;
  const opts = on.map((d, i) => `<option value="${d.id}" ${i === 0 ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  openModal(`
    <h2>Capture fingerprint — ${esc(u.name || 'User ' + u.employeeNo)} <small class="hint">#${esc(u.employeeNo)}</small></h2>
    <div class="two-col">
      <div class="field"><label>Capture at this machine</label><select id="cf_dev">${opts}</select></div>
      <div class="field"><label>Finger slot <small class="hint">(up to 10 per user)</small></label>
        <select id="cf_slot">${Array.from({ length: 10 }, (_, n) => `<option value="${n + 1}">Finger ${n + 1}${u.numOfFP && n < u.numOfFP ? ' (enrolled — will be replaced)' : ''}</option>`).join('')}</select>
      </div>
    </div>
    <p class="hint">Click <b>Start capture</b> — the chosen machine prompts the person to press their finger. Each slot is one finger; capture again with a different slot to add more fingers.${on.length > 1 ? ' Fingerprints are copied to their other machines automatically.' : ''}</p>
    <div class="modal-actions">
      <button class="btn" id="cf_cancel">Cancel</button>
      <button class="btn primary" id="cf_start">Start capture</button>
    </div>`);
  // Default to the next free slot so a second capture ADDS a finger
  // instead of replacing finger 1.
  $('#cf_slot').value = String(Math.min((Number(u.numOfFP) || 0) + 1, 10));
  $('#cf_cancel').addEventListener('click', closeModal);
  $('#cf_start').addEventListener('click', async () => {
    const dev = on.find((d) => d.id === Number($('#cf_dev').value)) || on[0];
    const slot = Number($('#cf_slot').value) || 1;
    closeModal();
    await captureFp(dev, u.employeeNo, devs, on.map((d) => d.id), slot);
  });
}

async function captureFp(srcDev, employeeNo, devs, replicateIds = [], fingerNo = 1) {
  if (captureBusy) { toast('A capture is already in progress — wait for it to finish.', 'err'); return; }
  const extra = replicateIds.filter((id) => id !== srcDev.id);
  captureBusy = true;
  toast(`Waiting for finger at the machine… (slot ${fingerNo})`);
  try {
    const r = await api.post(`/devices/${srcDev.id}/users/${encodeURIComponent(employeeNo)}/capture-fingerprint`, { replicate_device_ids: extra, fingerNo });
    const repBad = (r.replicated || []).filter((x) => !x.ok);
    const repOk = (r.replicated || []).filter((x) => x.ok);
    if (!r.ok) toast(`Failed: ${r.error || 'no finger / timeout'}`, 'err');
    else if (repBad.length) toast(`Enrolled on ${srcDev.name}, but copy failed on ${repBad.map((x) => x.device).join(', ')}: ${repBad[0].error || ''}`, 'err');
    else toast(`Fingerprint enrolled${repOk.length ? ` on ${1 + repOk.length} machines` : ''}${r.quality ? ` (quality ${r.quality})` : ''}`, 'ok');
    if (devs && $('#u_table')) loadUsersTable(devs);
  } finally { captureBusy = false; }
}

// Full profile popup: per-machine access state, validity window, role and
// every credential (fingerprint/face counts, actual card numbers).
async function userProfileModal(entry) {
  const { u } = entry;
  openModal(`
    <h2>${esc(u.name || 'User ' + u.employeeNo)} <small class="hint">#${esc(u.employeeNo)}</small></h2>
    <div class="field" id="up_body"><span class="muted">Loading profile from machines…</span></div>
    <div class="modal-actions"><button class="btn" id="up_close">Close</button></div>`);
  $('#up_close').addEventListener('click', closeModal);
  const r = await api.get(`/profile?employeeNo=${encodeURIComponent(u.employeeNo)}&name=${encodeURIComponent(u.name || '')}`);
  const body = $('#up_body');
  if (!body) return;
  if (!r.ok) { body.innerHTML = `<span class="muted">Failed: ${esc(r.error || 'error')}</span>`; return; }
  const rows = r.machines.map((m) => {
    if (m.present === null) {
      return `<div class="list-row"><span class="status-dot off"></span>
        <div class="list-main"><b>${esc(m.device)}</b><small class="hint">${esc(m.host)}</small></div>
        <span class="badge offline">unreachable</span></div>`;
    }
    if (!m.present) {
      return `<div class="list-row"><span class="status-dot off"></span>
        <div class="list-main"><b>${esc(m.device)}</b><small class="hint">${esc(m.host)}</small></div>
        <span class="badge">no access</span></div>`;
    }
    const creds = [
      `${m.numOfFP} fingerprint${m.numOfFP === 1 ? '' : 's'}`,
      `${m.numOfFace} face`,
      m.cards.length ? `card${m.cards.length === 1 ? '' : 's'}: ${m.cards.join(', ')}` : 'no card',
    ];
    return `<div class="list-row">
      <span class="status-dot ${m.enabled ? 'on' : 'off'}"></span>
      <div class="list-main">
        <b>${esc(m.device)}</b>
        <small class="hint">valid ${esc((m.validBegin || '—').replace('T', ' '))} → ${esc((m.validEnd || '—').replace('T', ' '))}</small>
        <small class="hint">${esc(creds.join(' · '))}</small>
      </div>
      ${m.admin ? '<span class="badge admin">Admin</span>' : '<span class="badge">User</span>'}
      ${m.enabled ? '<span class="badge synced">has access</span>' : '<span class="badge blocked">blocked</span>'}
    </div>`;
  }).join('');
  body.innerHTML = `<div class="device-checklist" style="max-height:340px">${rows}</div>`;
}

// Edit a user's name / employee # across every machine they exist on.
function editUserModal(entry, devs) {
  const { u, on } = entry;
  openModal(`
    <h2>Edit user <small class="hint">#${esc(u.employeeNo)}</small></h2>
    <p class="hint">Applies on: <b>${esc(on.map((d) => d.name).join(', '))}</b>. Changing the employee # re-creates the user under the new number with all credentials (fingerprints, cards, face), then removes the old record.</p>
    <div class="two-col">
      <div class="field"><label>Name</label><input id="eu_name" value="${esc(u.name || '')}"></div>
      <div class="field"><label>Employee #</label><input id="eu_no" value="${esc(u.employeeNo)}"></div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="eu_cancel">Cancel</button>
      <button class="btn primary" id="eu_save">Save</button>
    </div>`);
  $('#eu_cancel').addEventListener('click', closeModal);
  $('#eu_save').addEventListener('click', async () => {
    const name = $('#eu_name').value.trim();
    const newNo = $('#eu_no').value.trim();
    if (!name || !newNo) { toast('Name and employee # are required', 'err'); return; }
    toast('Updating user…');
    const r = await api.post(`/devices/${on[0].id}/users/${encodeURIComponent(u.employeeNo)}/update`, {
      name,
      newEmployeeNo: newNo,
      device_ids: on.map((d) => d.id),
    });
    const fails = (r.results || []).filter((x) => !x.ok);
    closeModal();
    toast(fails.length ? `Failed on ${fails.map((f) => f.device).join(', ')}${fails[0].error ? ': ' + fails[0].error : ''}` : 'User updated', fails.length ? 'err' : 'ok');
    if ($('#u_table')) loadUsersTable(devs);
  });
}

// Popup listing the cards attached to a user, with per-card removal.
async function userCardsModal(entry, devs) {
  const { u, on } = entry;
  const srcDev = on[0];
  openModal(`
    <h2>Cards — ${esc(u.name || 'User ' + u.employeeNo)} <small class="hint">#${esc(u.employeeNo)}</small></h2>
    <p class="hint">Cards attached to this user on ${esc(on.map((d) => d.name).join(', '))}. Removing a card detaches it from every machine this user is on — their fingerprints and profile stay.</p>
    <div class="field" id="uc_list"><span class="muted">Loading cards…</span></div>
    <div class="field"><label>Add a card <small class="hint">(typed — attached on every machine this user is on; or use Actions → Tag card to tap it on a reader)</small></label>
      <div style="display:flex;gap:8px">
        <input id="uc_new" placeholder="e.g. 0012345678" style="flex:1">
        <button class="btn primary" id="uc_add">Attach card</button>
      </div>
    </div>
    <div class="modal-actions"><button class="btn" id="uc_close">Close</button></div>`);
  $('#uc_close').addEventListener('click', closeModal);
  $('#uc_add').addEventListener('click', async () => {
    const cardNo = $('#uc_new').value.trim();
    if (!cardNo) { toast('Enter a card number', 'err'); return; }
    toast(`Attaching card on ${on.length} machine${on.length === 1 ? '' : 's'}…`);
    const results = await Promise.all(on.map(async (d) => ({
      d, r: await api.post(`/devices/${d.id}/users/${encodeURIComponent(u.employeeNo)}/card`, { card_no: cardNo }),
    })));
    const fails = results.filter((x) => !x.r.ok);
    toast(fails.length
      ? `Failed on ${fails.map((f) => f.d.name).join(', ')}: ${fails[0].r.error || 'error'}`
      : `Card ${cardNo} attached`, fails.length ? 'err' : 'ok');
    $('#uc_new').value = '';
    load();
    if ($('#u_table')) loadUsersTable(devs);
  });
  $('#uc_new').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#uc_add').click(); });
  async function load() {
    const r = await api.get(`/devices/${srcDev.id}/users/${encodeURIComponent(u.employeeNo)}/cards`);
    const cardsList = r.ok ? r.cards : [];
    $('#uc_list').innerHTML = cardsList.length
      ? `<div class="device-checklist">${cardsList.map((c) => `
          <label style="justify-content:space-between;cursor:default">
            <span><b>${esc(c)}</b></span>
            <button class="btn sm danger" data-rmcard="${esc(c)}">Remove</button>
          </label>`).join('')}</div>`
      : `<span class="muted">${r.ok ? 'No cards attached to this user.' : `Couldn't read cards: ${esc(r.error || 'error')}`}</span>`;
    $('#uc_list').querySelectorAll('[data-rmcard]').forEach((b) => b.addEventListener('click', async () => {
      const cardNo = b.dataset.rmcard;
      if (!confirm(`Remove card ${cardNo} from ${u.name || 'this user'}?\n\nIt is detached on: ${on.map((d) => d.name).join(', ')}.`)) return;
      toast('Removing card…');
      const rr = await api.post('/devices/card/delete', { card_no: cardNo, device_ids: on.map((d) => d.id) });
      const fails = (rr.results || []).filter((x) => !x.ok);
      toast(fails.length ? `Failed on ${fails.map((f) => f.device).join(', ')}` : 'Card removed', fails.length ? 'err' : 'ok');
      load();
      if ($('#u_table')) loadUsersTable(devs);
    }));
  }
  load();
}

// Show + edit which machines a user has access to. Checked = enrolled.
async function accessModal(srcDev, employeeNo, name, devs) {
  toast('Checking machines…');
  const r = await api.get(`/devices/${srcDev.id}/users/${encodeURIComponent(employeeNo)}/access`);
  if (!r.ok) { toast(`Failed: ${r.error || 'error'}`, 'err'); return; }
  const checks = r.machines.map((m) => {
    const hasAccess = m.present && m.enabled !== false;
    const state = m.present === null
      ? '<span class="badge offline">unreachable</span>'
      : hasAccess ? '<span class="badge synced">has access</span>'
        : m.present ? '<span class="badge blocked">blocked</span>'
          : '<span class="badge">no access</span>';
    return `<label>
      <input type="checkbox" class="acc-check" value="${m.device_id}" ${hasAccess ? 'checked' : ''} ${m.present === null ? 'disabled' : ''}>
      <span style="flex:1;min-width:0">${esc(m.name)} <small class="hint">${esc(m.host)}</small> ${state}</span>
      <input type="datetime-local" class="acc-end" data-dev="${m.device_id}" value="${toLocalInput(m.valid_end)}" ${m.present === null ? 'disabled' : ''} title="Access until on this machine">
      <button type="button" class="btn sm acc-today" data-dev="${m.device_id}" ${m.present === null ? 'disabled' : ''} title="Access until tonight 23:59">Today</button>
    </label>`;
  }).join('');
  openModal(`
    <h2>Machine access — ${esc(r.name || name || 'user ' + employeeNo)} <small class="hint">#${esc(employeeNo)}</small></h2>
    <p class="hint">Checked machines allow entry, and each machine has its own <b>access-until</b> deadline. Unchecking <b>blocks</b> the user there but keeps their fingerprints and cards enrolled — re-checking restores access instantly. Use Delete to fully remove a user.</p>
    <div class="field">
      ${groupSelectHtml(r.machines.map((m) => ({ id: m.device_id, grp: m.grp })))}
      <input id="acc_filter" placeholder="Search machines… e.g. 315" autocomplete="off" style="margin:8px 0">
      <div class="device-checklist">${checks}</div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="acc_cancel">Cancel</button>
      <button class="btn primary" id="acc_save">Apply</button>
    </div>`);
  wireGroupSelect(r.machines.map((m) => ({ id: m.device_id, grp: m.grp })), 'acc-check');
  limitRoomSelection('acc-check', r.machines.map((m) => ({ id: m.device_id, grp: m.grp })));
  wireChecklistFilter('acc_filter');
  // "Today" preset: access until tonight 23:59 on that machine.
  document.querySelectorAll('.acc-today').forEach((b) => b.addEventListener('click', () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const inp = document.querySelector(`.acc-end[data-dev="${b.dataset.dev}"]`);
    if (inp) inp.value = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T23:59`;
  }));
  $('#acc_cancel').addEventListener('click', closeModal);
  $('#acc_save').addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('.acc-check:checked')].map((x) => Number(x.value));
    const validEnds = {};
    document.querySelectorAll('.acc-end').forEach((inp) => {
      const v = fromLocalInput(inp.value);
      if (v) validEnds[inp.dataset.dev] = v;
    });
    closeModal();
    // Batches of machines with a live progress bar — device_ids is always the
    // FULL wanted set; only_ids limits which machines each request touches.
    const allIds = r.machines.map((m) => m.device_id);
    const chunks = [];
    for (let i = 0; i < allIds.length; i += 8) chunks.push(allIds.slice(i, i + 8));
    const bar = progressBar(allIds.length, 'Applying access —');
    const results = [];
    let reqError = null;
    await runBatched(chunks, async (chunk) => {
      const rr = await api.post(`/devices/${srcDev.id}/users/${encodeURIComponent(employeeNo)}/access`, {
        device_ids: ids,
        valid_ends: validEnds,
        only_ids: chunk,
      });
      if (rr.ok) results.push(...(rr.results || []));
      else reqError = rr.error || 'error';
    }, bar);
    bar.close();
    if (reqError && !results.length) { toast(`Failed: ${reqError}`, 'err'); return; }
    const errs = results.filter((x) => x.state === 'error');
    const changed = results.filter((x) => ['granted', 'unblocked', 'blocked', 'updated'].includes(x.state)).length;
    toast(errs.length ? `${changed} changed, ${errs.length} failed: ${errs.map((e) => e.device).join(', ')}` : `Access updated (${changed} change${changed === 1 ? '' : 's'})`, errs.length ? 'err' : 'ok');
    if ($('#u_table')) loadUsersTable(devs);
  });
}

// Floating progress bar for long multi-machine operations ("5/52 machines").
function progressBar(total, label) {
  const el = document.createElement('div');
  el.className = 'progress-pop';
  el.innerHTML = '<div class="progress-label"></div><div class="progress-track"><div class="progress-fill"></div></div>';
  document.body.appendChild(el);
  let done = 0;
  const paint = () => {
    el.querySelector('.progress-label').textContent = `${label} ${done}/${total} machines`;
    el.querySelector('.progress-fill').style.width = `${total ? Math.round((done / total) * 100) : 100}%`;
  };
  paint();
  return {
    tick(n = 1) { done += n; paint(); },
    close() { el.remove(); },
  };
}

// Run jobs with limited concurrency, ticking the bar as each finishes.
async function runBatched(items, worker, bar, concurrency = 4) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
      bar.tick(Array.isArray(item) ? item.length : 1);
    }
  }));
}

// Only one device-capture (card or fingerprint) may run at a time — the
// terminal rejects overlapping capture sessions with "Device Busy".
let captureBusy = false;

async function setRole(devsOn, employeeNo, role, devs) {
  const targets = Array.isArray(devsOn) ? devsOn : [devsOn];
  toast(`Setting ${role === 'admin' ? 'Admin' : 'User'} access…`);
  const fails = [];
  for (const d of targets) {
    const r = await api.post(`/devices/${d.id}/users/${encodeURIComponent(employeeNo)}/role`, { role });
    if (!r.ok) fails.push(`${d.name}: ${r.error || 'error'}`);
  }
  toast(
    fails.length ? `Failed on ${fails.length} machine(s): ${fails[0]}`
      : `Now ${role === 'admin' ? 'Admin' : 'User'}${targets.length > 1 ? ` on ${targets.length} machines` : ''}`,
    fails.length ? 'err' : 'ok'
  );
  if (devs && $('#u_table')) loadUsersTable(devs);
}

function tagCard(entry, devs) {
  const { u, on } = entry;
  const opts = on.map((d, i) => `<option value="${d.id}" ${i === 0 ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  openModal(`
    <h2>Tag card — ${esc(u.name || 'User ' + u.employeeNo)} <small class="hint">#${esc(u.employeeNo)}</small></h2>
    <div class="field"><label>Read the card at this machine</label><select id="tc_dev">${opts}</select></div>
    <p class="hint">Click <b>Start reading</b>, then tap the card on the chosen machine's reader (about 30s). The card is attached to this user${on.length > 1 ? ' and copied to their other machines automatically' : ''}.</p>
    <div class="modal-actions">
      <button class="btn" id="tc_cancel">Cancel</button>
      <button class="btn primary" id="tc_start">Start reading</button>
    </div>`);
  $('#tc_cancel').addEventListener('click', closeModal);
  $('#tc_start').addEventListener('click', async () => {
    if (captureBusy) { toast('A capture is already in progress — wait for it to finish.', 'err'); return; }
    const dev = on.find((d) => d.id === Number($('#tc_dev').value)) || on[0];
    captureBusy = true;
    closeModal();
    toast(`Waiting for a card at ${dev.name}… tap it now`);
    try {
      const r = await api.post(`/devices/${dev.id}/users/${encodeURIComponent(u.employeeNo)}/capture-card`, {
        replicate_device_ids: on.map((d) => d.id),
      });
      const repBad = (r.replicated || []).filter((x) => !x.ok);
      if (!r.ok) toast(`Failed: ${r.error || 'no card'}`, 'err');
      else if (repBad.length) toast(`Card ${r.cardNo} attached on ${dev.name}, but copy failed on ${repBad.map((x) => x.device).join(', ')}`, 'err');
      else toast(`Card ${r.cardNo} attached${on.length > 1 ? ` on ${on.length} machines` : ''}`, 'ok');
      if ($('#u_table')) loadUsersTable(devs);
    } finally { captureBusy = false; }
  });
}

function addUserModal(srcDev, devs, checkAll = false) {
  const checks = devs.map((d) =>
    `<label><input type="checkbox" class="au-dev" value="${d.id}" ${!checkAll && d.id === srcDev.id ? 'checked' : ''}> ${esc(d.name)} <small class="hint">${esc(d.host)}</small></label>`
  ).join('');
  openModal(`
    <h2>Add user</h2>
    <div class="two-col">
      <div class="field"><label>Name</label><input id="au_name" placeholder="Full name"></div>
      <div class="field"><label>Employee # <small class="hint">(auto if blank)</small></label><input id="au_no" placeholder="e.g. 1005"></div>
    </div>
    <div class="two-col">
      <div class="field"><label>RFID card # <small class="hint">(optional — typed, no tap needed)</small></label><input id="au_card" placeholder="e.g. 0012345678"></div>
      <div class="field"><label>Access level</label>
        <select id="au_role"><option value="user">User (door access only)</option>${dashRole === 'admin' ? '<option value="admin">Admin (can enter the machine menu)</option>' : ''}</select>
      </div>
    </div>
    <div class="two-col">
      <div class="field"><label>Access from</label><input id="au_begin" type="datetime-local"></div>
      <div class="field"><label>Access until</label><input id="au_end" type="datetime-local"></div>
    </div>
    <div class="field"><label>Create on machines <small class="hint">(pick one or more)</small></label>
      ${groupSelectHtml(devs)}
      <input id="au_filter" placeholder="Search machines… e.g. 315" autocomplete="off" style="margin:8px 0">
      <div class="device-checklist">${checks}</div>
    </div>
    <div class="field"><label>Fingerprint machine <small class="hint">(after creating, this machine prompts for the finger — optional when an RFID card # is entered)</small></label>
      <select id="au_fpdev"></select>
    </div>
    <p class="hint">The same employee # is used on every selected machine. You can also tag a card later by tapping it (Tag card), or capture fingerprints any time.</p>
    <div class="modal-actions">
      <button class="btn" id="au_cancel">Cancel</button>
      <button class="btn primary" id="au_save">Add user</button>
    </div>`);
  wireGroupSelect(devs, 'au-dev');
  limitRoomSelection('au-dev', devs);
  wireChecklistFilter('au_filter');
  // Fingerprint-capture machine list mirrors whichever machines are ticked.
  // With an RFID card # entered, the fingerprint becomes optional — a
  // "card only" choice appears (and is preselected when the card came first).
  function refreshFpOptions() {
    const sel = $('#au_fpdev');
    const prev = sel.value;
    const hasCard = !!$('#au_card').value.trim();
    const checked = [...document.querySelectorAll('.au-dev:checked')].map((c) => Number(c.value));
    sel.innerHTML =
      `<option value="">${hasCard ? 'No fingerprint — card only' : 'Skip fingerprint'}</option>` +
      devs.filter((d) => checked.includes(d.id))
        .map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
    else if (hasCard) sel.value = '';
    else if (sel.options.length > 1) sel.selectedIndex = 1; // default: first ticked machine
  }
  document.querySelectorAll('.au-dev').forEach((c) => c.addEventListener('change', refreshFpOptions));
  $('#au_card').addEventListener('input', () => {
    refreshFpOptions();
    if ($('#au_card').value.trim()) $('#au_fpdev').value = ''; // card entered → default to card only
  });
  refreshFpOptions();

  $('#au_cancel').addEventListener('click', closeModal);
  $('#au_save').addEventListener('click', async () => {
    const name = $('#au_name').value.trim();
    if (!name) { toast('Name required', 'err'); return; }
    const deviceIds = [...document.querySelectorAll('.au-dev:checked')].map((c) => Number(c.value));
    if (!deviceIds.length) { toast('Pick at least one machine', 'err'); return; }
    const body = {
      device_ids: deviceIds,
      employeeNo: $('#au_no').value.trim() || undefined,
      name,
      role: $('#au_role').value,
      card_no: $('#au_card').value.trim() || undefined,
      valid_begin: fromLocalInput($('#au_begin').value),
      valid_end: fromLocalInput($('#au_end').value),
    };
    const fpDevId = Number($('#au_fpdev').value) || null;
    toast(`Creating user on ${deviceIds.length} machine${deviceIds.length === 1 ? '' : 's'}…`);
    const r = await api.post('/devices/users', body);
    if (!r.ok) {
      const firstErr = r.error || (r.results || []).map((x) => x.error).filter(Boolean)[0] || 'error';
      toast(`Failed: ${firstErr}`, 'err'); return;
    }
    closeModal();
    const bad = (r.results || []).filter((x) => !x.ok);
    const cardBad = (r.results || []).filter((x) => x.ok && x.cardError);
    if (bad.length) toast(`User ${r.employeeNo} added, but failed on ${bad.map((b) => b.device).join(', ')}: ${bad[0].error}`, 'err');
    else if (cardBad.length) toast(`User ${r.employeeNo} added; card failed on ${cardBad.map((b) => b.device).join(', ')}: ${cardBad[0].cardError}`, 'err');
    else toast(`User ${r.employeeNo}${body.card_no ? ' + card' : ''} added on ${r.results.length} machine${r.results.length === 1 ? '' : 's'}`, 'ok');
    const fpDev = fpDevId && deviceIds.includes(fpDevId) ? devs.find((d) => d.id === fpDevId) : null;
    if (fpDev) await captureFp(fpDev, r.employeeNo, devs, deviceIds);
    if ($('#u_table')) loadUsersTable(devs);
  });
}

// ---- Cards ---- 
async function cards() {
  const [list, devs] = await Promise.all([api.get('/cards'), api.get('/devices')]);
  if (current !== 'cards') return; // view changed while loading
  $('#viewActions').innerHTML = '<button class="btn primary" id="addCard">+ Add card</button>';
  $('#addCard').addEventListener('click', () => cardModal(null, devs));
  content.innerHTML = '';
  if (!list.length) { content.appendChild(el('<div class="empty">No cards yet. Click <b>+ Add card</b> to register a card, then <b>Edit</b> it to set access and machines.</div>')); return; }

  const rows = list.map((c) => {
    const active = c.grants.filter((g) => g.sync_state !== 'removing');
    const nDev = active.length;
    const nBad = active.filter((g) => g.sync_state !== 'synced').length;
    // Assigned to: live holders of this card number (real users on the machines)
    const byEmp = new Map();
    for (const h of c.assigned || []) {
      if (!byEmp.has(h.employeeNo)) byEmp.set(h.employeeNo, { name: h.name, devs: [] });
      byEmp.get(h.employeeNo).devs.push(h.device);
    }
    const assignedHtml = byEmp.size
      ? [...byEmp.entries()].map(([no, x]) =>
          `<b>${esc(x.name || 'User')}</b> <small class="hint">#${esc(no)} · ${esc(x.devs.join(', '))}</small>`
        ).join('<br>')
      : nDev
        ? `standalone on ${nDev} machine${nDev === 1 ? '' : 's'} ${nBad ? `<span class="badge pending">${nBad} pending</span>` : '<span class="badge synced">synced</span>'}`
        : '<span class="muted">not assigned</span>';
    return `<tr>
      <td><b>${esc(c.card_no || '—')}</b></td>
      <td>${esc(c.name)}</td>
      <td class="nowrap">${c.valid_end ? esc(c.valid_end.replace('T', ' ')) : '<span class="muted">no expiry</span>'}</td>
      <td>${assignedHtml}</td>
      <td class="row-actions">
        <button class="btn sm" data-assign="${c.id}">Assign to user</button>
        <button class="btn sm" data-unassign="${c.id}">Unassign</button>
        <button class="btn sm" data-sync="${c.id}">Sync</button>
        <button class="btn sm" data-edit="${c.id}">Edit</button>
        <button class="btn sm danger" data-del="${c.id}">Remove</button>
      </td>
    </tr>`;
  }).join('');
  content.appendChild(el(`<div class="table-wrapper"><table><thead><tr>
      <th>Card #</th><th>Label</th><th>Access until</th><th>Assigned to</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>`));

  content.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', () =>
    assignCardModal(list.find((c) => c.id == b.dataset.assign), devs)));
  content.querySelectorAll('[data-unassign]').forEach((b) => b.addEventListener('click', async () => {
    const c = list.find((x) => x.id == b.dataset.unassign);
    if (!c || !c.card_no) { toast('This entry has no card number', 'err'); return; }
    if (!confirm(`Remove card ${c.card_no} from every machine?\n\nWhoever holds it loses card access — their user profile stays.`)) return;
    toast('Removing card from machines…');
    const r = await api.post('/devices/card/delete', { card_no: c.card_no });
    const fails = (r.results || []).filter((x) => !x.ok);
    toast(fails.length ? `Failed on ${fails.map((f) => f.device).join(', ')}${fails[0].error ? ': ' + fails[0].error : ''}`
      : 'Card removed from all machines', fails.length ? 'err' : 'ok');
  }));
  content.querySelectorAll('[data-sync]').forEach((b) => b.addEventListener('click', async () => {
    toast('Pushing to machines…');
    const r = await api.post(`/cards/${b.dataset.sync}/sync`);
    const bad = (r.results || []).filter((x) => x.state === 'error');
    toast(bad.length ? `Errors on ${bad.length} machine(s)` : 'Synced', bad.length ? 'err' : 'ok');
    cards();
  }));
  content.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => cardModal(list.find((c) => c.id == b.dataset.edit), devs)));
  content.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    const c = list.find((x) => x.id == b.dataset.del);
    if (!confirm(`Delete card ${c?.card_no || ''}?\n\nIt is removed from every machine and detached from any user holding it — all access linked to this card stops working.`)) return;
    toast('Removing card everywhere…');
    const r = await api.del(`/cards/${b.dataset.del}`);
    const badDetach = (r.detached || []).filter((x) => !x.ok);
    toast(r.ok ? (badDetach.length ? `Removed, but detach failed on ${badDetach.map((x) => x.device).join(', ')}` : 'Card removed — all linked access blocked')
      : (r.error || 'Failed'), r.ok && !badDetach.length ? 'ok' : 'err');
    cards();
  }));
}

// Assign a registered card to an existing machine user (typed attach, no tap).
function assignCardModal(card, devs) {
  if (!card || !card.card_no) { toast('This entry has no card number', 'err'); return; }
  const devOpts = ['<option value="all">All machines</option>']
    .concat(devs.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`)).join('');
  openModal(`
    <h2>Assign card ${esc(card.card_no)} to a user</h2>
    <div class="two-col">
      <div class="field"><label>Machine</label><select id="ac_dev">${devOpts}</select></div>
      <div class="field"><label>User</label><select id="ac_user"><option value="">Loading…</option></select></div>
    </div>
    <p class="hint" id="ac_hint">The card is attached on every machine where the chosen user exists.</p>
    <div class="modal-actions">
      <button class="btn" id="ac_cancel">Cancel</button>
      <button class="btn primary" id="ac_save">Assign</button>
    </div>`);
  // employeeNo -> { name, devs: [machines the user exists on] }
  const userMachines = new Map();
  async function loadUsers() {
    const sel = $('#ac_dev').value;
    $('#ac_user').innerHTML = '<option value="">Loading…</option>';
    userMachines.clear();
    // Key by employee # AND name — two different people sharing a number on
    // different machines stay separate entries.
    const keyOf = (u) => `${u.employeeNo}||${String(u.name || '').trim().toLowerCase()}`;
    if (sel === 'all') {
      const results = await Promise.all(devs.map(async (d) => ({ d, r: await api.get(`/devices/${d.id}/users`) })));
      for (const { d, r } of results) {
        if (!r.ok) continue;
        for (const u of r.users || []) {
          const key = keyOf(u);
          if (!userMachines.has(key)) userMachines.set(key, { employeeNo: String(u.employeeNo), name: u.name || 'User', devs: [] });
          userMachines.get(key).devs.push(d);
        }
      }
      $('#ac_hint').textContent = 'The card is attached on every machine where the chosen user exists.';
    } else {
      const d = devs.find((x) => x.id == sel);
      const r = await api.get(`/devices/${sel}/users`);
      if (r.ok) for (const u of r.users || []) userMachines.set(keyOf(u), { employeeNo: String(u.employeeNo), name: u.name || 'User', devs: [d] });
      $('#ac_hint').textContent = `The card is attached on ${d ? d.name : 'this machine'} only.`;
    }
    const opts = [...userMachines.entries()]
      .sort((a, b) => ((Number(a[1].employeeNo) || 0) - (Number(b[1].employeeNo) || 0)) || a[1].name.localeCompare(b[1].name))
      .map(([key, info]) => `<option value="${esc(key)}">${esc(info.name)} — #${esc(info.employeeNo)}${sel === 'all' && devs.length > 1 ? ` (${info.devs.length} machine${info.devs.length === 1 ? '' : 's'})` : ''}</option>`)
      .join('');
    $('#ac_user').innerHTML = opts || '<option value="">No users found</option>';
  }
  $('#ac_dev').addEventListener('change', loadUsers);
  loadUsers();
  $('#ac_cancel').addEventListener('click', closeModal);
  $('#ac_save').addEventListener('click', async () => {
    const key = $('#ac_user').value;
    const info = userMachines.get(key);
    if (!info) { toast('Pick a user', 'err'); return; }
    const targets = info.devs;
    toast(`Attaching card on ${targets.length} machine${targets.length === 1 ? '' : 's'}…`);
    const fails = [];
    for (const d of targets) {
      const r = await api.post(`/devices/${d.id}/users/${encodeURIComponent(info.employeeNo)}/card`, { card_no: card.card_no });
      if (!r.ok) fails.push(`${d.name}: ${r.error || 'error'}`);
    }
    closeModal();
    toast(fails.length ? `Attached on ${targets.length - fails.length}/${targets.length} — ${fails[0]}`
      : `Card ${card.card_no} attached to ${info.name} (#${info.employeeNo}) on ${targets.length} machine${targets.length === 1 ? '' : 's'}`,
      fails.length ? 'err' : 'ok');
  });
}

function cardModal(c = null, devs = []) {
  // Add: only card # + name. Access and machines are set afterwards via Edit.
  if (!c) return addCardModal();

  const labelVal = c.name && !/^Card /.test(c.name) ? c.name : '';
  const grantIds = new Set((c.grants || []).filter((g) => g.sync_state !== 'removing').map((g) => g.device_id));
  const deviceChecks = devs.length
    ? devs.map((d) => `<label><input type="checkbox" class="card-dev-check" value="${d.id}" ${grantIds.has(d.id) ? 'checked' : ''}> ${esc(d.name)} <small class="hint">${esc(d.host)}</small></label>`).join('')
    : '<span class="muted">No machines yet — provision one in the database first.</span>';
  openModal(`
    <h2>Edit card</h2>
    <div class="two-col">
      <div class="field"><label>RFID card #</label><input id="c_card" value="${esc(c.card_no || '')}" placeholder="e.g. 0012345678"></div>
      <div class="field"><label>Label <small class="hint">(optional)</small></label><input id="c_label" value="${esc(labelVal)}" placeholder="e.g. Cleaner, Locker 12"></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Access from</label><input id="c_begin" type="datetime-local" value="${toLocalInput(c.valid_begin)}"></div>
      <div class="field"><label>Access until</label><input id="c_end" type="datetime-local" value="${toLocalInput(c.valid_end)}"></div>
    </div>
    <div class="field check"><input id="c_autodel" type="checkbox" ${c.auto_delete ? 'checked' : ''}><label>Auto-delete from machines after expiry</label></div>
    <p class="hint">If this card is <b>assigned to a user</b>, the access period is applied to that user on every machine holding the card — machines enforce validity per person, so it covers all their credentials there.</p>
    <div class="field">
      <label>Machines <small class="hint">(standalone card only — pick one or more)</small></label>
      ${groupSelectHtml(devs)}
      <div class="device-checklist">${deviceChecks}</div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="c_cancel">Cancel</button>
      <button class="btn primary" id="c_save">Save & sync</button>
    </div>`);
  wireGroupSelect(devs, 'card-dev-check');
  $('#c_cancel').addEventListener('click', closeModal);
  $('#c_save').addEventListener('click', async () => {
    const card_no = $('#c_card').value.trim();
    if (!card_no) { toast('Card # required', 'err'); return; }
    const deviceIds = [...document.querySelectorAll('.card-dev-check:checked')].map((x) => Number(x.value));
    const r = await api.put(`/cards/${c.id}`, {
      card_no,
      label: $('#c_label').value.trim() || null,
      valid_begin: fromLocalInput($('#c_begin').value),
      valid_end: fromLocalInput($('#c_end').value),
      auto_delete: $('#c_autodel').checked,
    });
    await api.put(`/cards/${c.id}/grants`, { device_ids: deviceIds });
    await api.post(`/cards/${c.id}/sync`);
    closeModal();
    const applied = (r.applied || []).filter((x) => x.ok);
    const failed = (r.applied || []).filter((x) => !x.ok);
    if (failed.length) toast(`Saved, but expiry failed on ${failed.map((f) => f.device).join(', ')}`, 'err');
    else if (applied.length) toast(`Saved — expiry applied to ${applied[0].name || 'holder'} on ${applied.length} machine${applied.length === 1 ? '' : 's'}`, 'ok');
    else toast('Saved & synced', 'ok');
    cards();
  });
}

// Minimal add: card number + optional name. No machines/access here — the
// dashboard user sets those afterwards with Edit.
function addCardModal() {
  openModal(`
    <h2>Add card</h2>
    <div class="two-col">
      <div class="field"><label>RFID card #</label><input id="c_card" placeholder="e.g. 0012345678"></div>
      <div class="field"><label>Name <small class="hint">(optional)</small></label><input id="c_label" placeholder="e.g. Cleaner, Locker 12"></div>
    </div>
    <p class="hint">After adding, use <b>Edit</b> to set the access period and which machines this card works on.</p>
    <div class="modal-actions">
      <button class="btn" id="c_cancel">Cancel</button>
      <button class="btn primary" id="c_save">Add</button>
    </div>`);
  $('#c_cancel').addEventListener('click', closeModal);
  $('#c_save').addEventListener('click', async () => {
    const card_no = $('#c_card').value.trim();
    if (!card_no) { toast('Card # required', 'err'); return; }
    const r = await api.post('/cards', { card_no, label: $('#c_label').value.trim() || null });
    if (r.error) { toast(r.error, 'err'); return; }
    closeModal(); toast('Card added — now Edit it to set access & machines', 'ok'); cards();
  });
}

// ---- Activity: machine entry log + dashboard action log ----
const EVENT_LABELS = {
  1: 'Entry authorized',
  2: 'Card + password',
  21: 'Door opened',
  22: 'Door closed',
  23: 'Door open timeout',
  27: 'Remote unlock',
  38: 'Fingerprint OK',
  39: 'Fingerprint denied',
  75: 'Face OK',
  76: 'Face not recognized',
  112: 'Entry denied (expired)',
};
const eventLabel = (e) => EVENT_LABELS[e.minor] || `Event ${e.minor}`;
const EVENT_DENIED = new Set([23, 39, 76, 112]);

let _logMode = 'entries';
let _logEvents = null; // cached last /events response (survives refreshes)
let _logBusy = false;

// How did the person authenticate? Derived from the event's minor code + data.
function entryMethod(e) {
  if (e.minor === 38 || e.minor === 39) return 'fingerprint';
  if (e.minor === 75 || e.minor === 76) return 'face';
  if (e.cardNo) return 'card';
  return 'other';
}

async function logs() {
  // Live view: entries refresh silently so the table never blanks out.
  clearInterval(_autoTimer);
  _autoTimer = setInterval(() => {
    if (current === 'logs' && $('#modalBackdrop').hidden) loadLogTable(true);
  }, 15000);
  content.innerHTML = '';
  content.appendChild(el(`<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
      <label class="hint">Show</label>
      <select id="log_mode">
        <option value="entries" ${_logMode === 'entries' ? 'selected' : ''}>Machine entries (who entered)</option>
        <option value="system" ${_logMode === 'system' ? 'selected' : ''}>Dashboard activity</option>
      </select>
      <span id="log_filters" style="display:${_logMode === 'entries' ? 'contents' : 'none'}">
        <label class="hint">Machine</label>
        <select id="log_machine"><option value="">All machines</option></select>
        <label class="hint">Method</label>
        <select id="log_method">
          <option value="">All methods</option>
          <option value="fingerprint">Fingerprint</option>
          <option value="card">Card</option>
          <option value="face">Face</option>
          <option value="other">Other</option>
        </select>
        <label class="hint">Result</label>
        <select id="log_result">
          <option value="">All results</option>
          <option value="ok">Allowed</option>
          <option value="denied">Denied</option>
        </select>
      </span>
      <button class="btn" id="log_refresh">Refresh</button>
    </div>`));
  content.appendChild(el('<div id="log_table"></div>'));
  $('#log_mode').addEventListener('change', (e) => {
    _logMode = e.target.value;
    $('#log_filters').style.display = _logMode === 'entries' ? 'contents' : 'none';
    loadLogTable();
  });
  ['log_machine', 'log_method', 'log_result'].forEach((id) =>
    $('#' + id).addEventListener('change', renderEntries));
  $('#log_refresh').addEventListener('click', () => loadLogTable());
  loadLogTable();
}

// silent=true keeps the current table on screen until fresh data arrives.
async function loadLogTable(silent = false) {
  const holder = $('#log_table');
  if (!holder || _logBusy) return;
  _logBusy = true;
  try {
    if (_logMode === 'system') {
      if (!silent) holder.innerHTML = '<div class="muted">Loading…</div>';
      const list = await api.get('/logs');
      if (!$('#log_table') || _logMode !== 'system' || current !== 'logs') return;
      if (!Array.isArray(list)) return;
      if (!list.length) { $('#log_table').innerHTML = '<div class="empty">No activity yet.</div>'; return; }
      const rows = list.map((l) => `<tr>
          <td class="nowrap"><small class="hint">${esc(l.ts)}</small></td>
          <td>${esc(l.employee_name || '—')}</td>
          <td>${esc(l.device_name || '—')}</td>
          <td>${esc(prettyAction(l.action))}</td>
          <td><span class="badge ${l.ok ? 'synced' : 'error'}">${l.ok ? 'ok' : 'fail'}</span></td>
          <td><small class="hint">${esc((l.detail || '').slice(0, 80))}</small></td>
        </tr>`).join('');
      $('#log_table').innerHTML = `<div class="table-wrapper"><table><thead><tr>
          <th>Time</th><th>Member</th><th>Machine</th><th>Action</th><th>Result</th><th>Detail</th>
        </tr></thead><tbody>${rows}</tbody></table></div>`;
      return;
    }

    // Machine entries — read live from each machine's own event memory.
    if (!silent && !_logEvents) holder.innerHTML = '<div class="muted">Loading entries from machines…</div>';
    const r = await api.get('/events?limit=80');
    if (!$('#log_table') || _logMode !== 'entries' || current !== 'logs') return;
    if (!r.ok) {
      if (!_logEvents && !r.__auth) $('#log_table').innerHTML = `<div class="empty">Couldn't read events: ${esc(r.error || 'error')}</div>`;
      return; // keep showing the last good table on refresh failures
    }
    _logEvents = r;
    renderEntries();
  } finally {
    _logBusy = false;
  }
}

function renderEntries() {
  const holder = $('#log_table');
  if (!holder || _logMode !== 'entries' || !_logEvents) return;
  const r = _logEvents;
  // Person events tell you WHO; denied events give context.
  let events = (r.events || []).filter((e) => e.name || e.employeeNoString || e.cardNo || EVENT_DENIED.has(e.minor));

  // Machine filter options (kept in sync with the data, selection preserved).
  const machineSel = $('#log_machine');
  if (machineSel) {
    const names = [...new Set(events.map((e) => e.device))].sort();
    const prev = machineSel.value;
    machineSel.innerHTML = '<option value="">All machines</option>' +
      names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    if (names.includes(prev)) machineSel.value = prev;
  }

  const fMachine = machineSel ? machineSel.value : '';
  const fMethod = $('#log_method') ? $('#log_method').value : '';
  const fResult = $('#log_result') ? $('#log_result').value : '';
  if (fMachine) events = events.filter((e) => e.device === fMachine);
  if (fMethod) events = events.filter((e) => entryMethod(e) === fMethod);
  if (fResult === 'ok') events = events.filter((e) => !EVENT_DENIED.has(e.minor));
  if (fResult === 'denied') events = events.filter((e) => EVENT_DENIED.has(e.minor));

  const note = (r.unreachable || []).length
    ? `<p class="hint" style="margin:0 0 10px">Unreachable: ${esc(r.unreachable.join(', '))} — their entries are not shown.</p>` : '';
  if (!events.length) {
    holder.innerHTML = `${note}<div class="empty">${fMachine || fMethod || fResult ? 'No entries match the current filters.' : 'No entries recorded yet. Events appear here after someone uses a card, fingerprint or face at a machine.'}</div>`;
    return;
  }
  const METHOD_LABEL = { fingerprint: 'Fingerprint', card: 'Card', face: 'Face', other: '—' };
  const rows = events.map((e) => {
    const who = e.name || (e.employeeNoString ? `User ${e.employeeNoString}` : '—');
    const method = entryMethod(e);
    const cred = e.cardNo ? `card ${e.cardNo}` : (e.currentVerifyMode && e.currentVerifyMode !== 'invalid' ? e.currentVerifyMode : '');
    const denied = EVENT_DENIED.has(e.minor);
    return `<tr>
      <td class="nowrap"><small class="hint">${esc(String(e.time || '').slice(0, 19).replace('T', ' '))}</small></td>
      <td><b>${esc(who)}</b>${e.employeeNoString ? ` <small class="hint">#${esc(e.employeeNoString)}</small>` : ''}</td>
      <td>${esc(e.device)}</td>
      <td>${esc(METHOD_LABEL[method])}${cred ? ` <small class="hint">${esc(cred)}</small>` : ''}</td>
      <td><span class="badge ${denied ? 'error' : 'synced'}">${esc(eventLabel(e))}</span></td>
    </tr>`;
  }).join('');
  holder.innerHTML = `${note}<div class="table-wrapper"><table><thead><tr>
      <th>Time</th><th>Person</th><th>Machine</th><th>Method</th><th>Event</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---- Bookings (from the booking system's WN_Bookings / WN_Spaces tables) ----
const fmtDT = (v) => String(v || '—').replace('T', ' ').slice(0, 16);

async function bookingsView() {
  $('#viewActions').innerHTML = '';
  content.innerHTML = '<div class="muted">Loading bookings…</div>';
  const r = await api.get('/bookings-feed');
  if (current !== 'bookings') return; // view changed while loading
  if (!r.ok) { if (!r.__auth) content.innerHTML = `<div class="empty">Couldn't load bookings: ${esc(r.error || 'error')}</div>`; return; }
  const items = r.items || [];
  if (!items.length) { content.innerHTML = '<div class="empty">No current or upcoming bookings in the booking system.</div>'; return; }
  const rows = items.map((b) => {
    const full = b.capacity > 0 && b.enrolled >= b.capacity;
    const none = b.enrolled === 0;
    const badge = full ? 'synced' : none ? 'error' : 'pending';
    return `<tr>
      <td><b>${esc(b.challan || b.ref)}</b><br><small class="hint">${esc(b.customer || '')}</small></td>
      <td><b>${esc(b.spaceName || '—')}</b> <span class="badge admin">room ${esc(b.spaceCode)}</span>
        ${b.roomMachine ? '' : '<br><small class="hint" style="color:var(--amber)">no machine has this room code</small>'}
        ${b.spaceType ? `<br><small class="hint">${esc(b.spaceType)}</small>` : ''}</td>
      <td class="nowrap"><small class="hint">${esc(fmtDT(b.start))} →<br>${esc(fmtDT(b.end))}</small>${b.accessEnd && b.accessEnd.slice(0, 10) !== String(b.end).slice(0, 10) ? `<br><small class="hint" style="color:var(--amber)">paid till ${esc(fmtDT(b.accessEnd))}</small>` : ''}</td>
      <td><span class="badge ${badge}">${b.enrolled} / ${b.capacity || '∞'} enrolled</span></td>
      <td class="row-actions"><button class="btn sm ${full ? '' : 'primary'}" data-enroll="${b.id}">${full ? 'View people' : 'Enroll people'}</button></td>
    </tr>`;
  }).join('');
  content.innerHTML = `<div class="table-wrapper"><table><thead><tr>
      <th>Booking</th><th>Space</th><th>Period</th><th>People</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint" style="margin-top:14px">Each booking allows up to the space's capacity. Enrolled people get access to the Entrance machines and the machine whose room code matches the space, for the paid booking period only — and are removed automatically when it ends. Shared co-working spaces don't appear here; paying another installment or re-booking the same space extends access automatically.</p>`;
  content.querySelectorAll('[data-enroll]').forEach((b) => b.addEventListener('click', () => bookingEnrollModal(Number(b.dataset.enroll))));
}

async function bookingEnrollModal(bookingId) {
  openModal('<h2>Booking</h2><div class="field"><span class="muted">Loading…</span></div>');
  const r = await api.get(`/bookings-feed/${bookingId}`);
  if (!r.ok) { if (!r.__auth) { closeModal(); toast(r.error || 'Failed to load booking', 'err'); } return; }
  const b = r.booking;
  const machines = r.machines || [];
  const render = () => {
    const left = Math.max(0, (b.capacity || 0) - r.attendees.length);
    const attRows = r.attendees.length ? r.attendees.map((a) => `
      <div class="list-row slim">
        <div class="list-main"><b>${esc(a.name)}</b>
          <small class="hint">#${esc(a.employeeNo)}${a.card_no ? ' · card ' + esc(a.card_no) : ''} · ${a.fingerprints === null ? 'fp: ?' : a.fingerprints + ' fp'}</small>
        </div>
        <button class="btn sm" data-bfp="${esc(a.employeeNo)}" data-bname="${esc(a.name)}" data-bfpn="${a.fingerprints || 0}">Capture FP</button>
        <button class="btn sm danger" data-brm="${esc(a.employeeNo)}" data-bname="${esc(a.name)}">Remove</button>
      </div>`).join('') : '<div class="list-empty">Nobody enrolled yet.</div>';
    $('#modal').innerHTML = `
      <h2>${esc(b.spaceName)} <span class="badge admin">room ${esc(b.spaceCode)}</span></h2>
      <p class="hint" style="margin:0 0 4px">${esc(b.challan || b.ref)} · ${esc(b.customer || '')} · ${esc(fmtDT(b.start))} → ${esc(fmtDT(b.end))}${b.accessEnd && b.accessEnd.slice(0, 10) !== String(b.end).slice(0, 10) ? ` · <span style="color:var(--amber)">access till ${esc(fmtDT(b.accessEnd))} (paid period)</span>` : ''}</p>
      <p class="hint" style="margin:0 0 10px">Access on: <b>${esc(machines.map((m) => m.name).join(', ') || '—')}</b>${r.roomMachine ? '' : ' <span style="color:var(--amber)">— no machine carries this room code yet (set it in Machines → Edit)</span>'}</p>
      <div class="field">
        <label>People <span class="badge ${left === 0 && b.capacity ? 'synced' : 'pending'}">${r.attendees.length} / ${b.capacity || '∞'}</span>
          ${left > 0 ? `<small class="hint">${left} more can be enrolled</small>` : ''}</label>
        <div class="device-checklist" style="max-height:260px">${attRows}</div>
      </div>
      ${(!b.capacity || r.attendees.length < b.capacity) ? `
      <div class="two-col">
        <div class="field"><label>Name</label><input id="ba_name" placeholder="Person's name"></div>
        <div class="field"><label>RFID card # <small class="hint">(optional — typed)</small></label><input id="ba_card" placeholder="or capture fingerprint after"></div>
      </div>
      <div class="modal-actions" style="margin-top:4px">
        <button class="btn" id="ba_close">Close</button>
        <button class="btn primary" id="ba_add">Add person</button>
      </div>` : `
      <div class="modal-actions"><button class="btn" id="ba_close">Close</button></div>`}`;
    $('#ba_close').addEventListener('click', () => { closeModal(); if (current === 'bookings') bookingsView(); });
    const addBtn = $('#ba_add');
    if (addBtn) addBtn.addEventListener('click', async () => {
      const name = $('#ba_name').value.trim();
      if (!name) { toast('Name required', 'err'); return; }
      toast('Enrolling on machines…');
      const rr = await api.post(`/bookings-feed/${bookingId}/attendees`, {
        name,
        card_no: $('#ba_card').value.trim() || undefined,
      });
      if (!rr.ok) { if (!rr.__auth) toast(rr.error || 'Failed', 'err'); return; }
      toast(`${name} enrolled (#${rr.employeeNo}) — now capture their fingerprint`, 'ok');
      bookingEnrollModal(bookingId);
    });
    $('#modal').querySelectorAll('[data-bfp]').forEach((btn) => btn.addEventListener('click', () => {
      closeModal();
      captureFpModal({
        u: { employeeNo: btn.dataset.bfp, name: btn.dataset.bname, numOfFP: Number(btn.dataset.bfpn) || 0 },
        on: machines.map((m) => ({ id: m.id, name: m.name })),
      }, []);
    }));
    $('#modal').querySelectorAll('[data-brm]').forEach((btn) => btn.addEventListener('click', async () => {
      if (!confirm(`Remove "${btn.dataset.bname}" from this booking? They are deleted from the machines immediately.`)) return;
      toast('Removing from machines…');
      const rr = await api.del(`/bookings-feed/${bookingId}/attendees/${encodeURIComponent(btn.dataset.brm)}`);
      if (rr.ok) { toast('Removed', 'ok'); bookingEnrollModal(bookingId); }
      else if (!rr.__auth) toast(rr.error || 'Failed', 'err');
    }));
  };
  render();
}

// datetime helpers: DB stores "YYYY-MM-DDTHH:mm:ss", input needs "YYYY-MM-DDTHH:mm"
function toLocalInput(v) { return v ? v.slice(0, 16) : ''; }
function fromLocalInput(v) { return v ? (v.length === 16 ? v + ':00' : v) : null; }

// ---- Dashboard Users (login accounts — admin only) ----
async function dashusers() {
  const me = await api.get('/auth/me');
  if (me.__auth) return;
  if (me.role !== 'admin') {
    $('#viewActions').innerHTML = '';
    content.innerHTML = '<div class="empty">Admin role required to manage dashboard users.</div>';
    return;
  }
  $('#viewActions').innerHTML = '<button class="btn primary" id="du_add">+ Add user</button>';
  $('#du_add').addEventListener('click', () => addDashUserModal());
  content.innerHTML = '<div class="muted">Loading accounts…</div>';
  const r = await api.get('/auth/users');
  if (current !== 'dashusers') return; // view changed while loading
  if (!r.ok) { if (!r.__auth) content.innerHTML = `<div class="empty">${esc(r.error || 'Failed to load accounts')}</div>`; return; }
  const rows = (r.users || []).map((u) => `
    <tr>
      <td><b>${esc(u.username)}</b> ${u.username === me.username ? '<small class="hint">(you)</small>' : ''}</td>
      <td><span class="badge ${u.role === 'admin' ? 'admin' : ''}">${esc(u.role)}</span></td>
      <td class="nowrap"><small class="hint">${esc(String(u.created_at || '—').replace('T', ' ').slice(0, 16))}</small></td>
      <td class="nowrap"><small class="hint">${esc(String(u.updated_at || '—').replace('T', ' ').slice(0, 16))}</small></td>
      <td class="row-actions">
        <button class="btn sm" data-reset="${esc(u.username)}">Reset password</button>
        ${u.username === me.username ? '' : `<button class="btn sm danger" data-deluser="${esc(u.username)}">Delete</button>`}
      </td>
    </tr>`).join('');
  content.innerHTML = `<div class="table-wrapper"><table><thead><tr>
      <th>Username</th><th>Role</th><th>Created</th><th>Updated</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>
    <p class="hint" style="margin-top:14px">Admins manage machines, people and these accounts. Users can operate the dashboard but cannot manage accounts.</p>`;
  content.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => resetDashPasswordModal(b.dataset.reset, me)));
  content.querySelectorAll('[data-deluser]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Delete dashboard login "${b.dataset.deluser}"? They can no longer sign in.`)) return;
    const rr = await api.del(`/auth/users/${encodeURIComponent(b.dataset.deluser)}`);
    if (rr.ok) { toast('Account deleted', 'ok'); dashusers(); }
    else if (!rr.__auth) toast(rr.error || 'Failed', 'err');
  }));
}

function addDashUserModal() {
  openModal(`
    <h2>Add dashboard user</h2>
    <div class="two-col">
      <div class="field"><label>Username</label><input id="du_user" autocomplete="off" placeholder="e.g. frontdesk"></div>
      <div class="field"><label>Password <small class="hint">(min 6 chars)</small></label><input id="du_pass" type="password" autocomplete="new-password"></div>
    </div>
    <div class="field"><label>Role</label>
      <select id="du_role"><option value="user">User (dashboard access)</option><option value="admin">Admin (can manage accounts)</option></select>
    </div>
    <div class="modal-actions">
      <button class="btn" id="du_cancel">Cancel</button>
      <button class="btn primary" id="du_save">Add user</button>
    </div>`);
  $('#du_cancel').addEventListener('click', closeModal);
  $('#du_save').addEventListener('click', async () => {
    const username = $('#du_user').value.trim();
    const password = $('#du_pass').value;
    if (!username) { toast('Username required', 'err'); return; }
    if (password.length < 6) { toast('Password must be at least 6 characters', 'err'); return; }
    const r = await api.post('/auth/users', { username, password, role: $('#du_role').value });
    if (r.ok) { closeModal(); toast(`User "${username}" (${r.role}) can now sign in`, 'ok'); dashusers(); }
    else if (!r.__auth) toast(r.error || 'Failed', 'err');
  });
}

function resetDashPasswordModal(username, me) {
  const isSelf = username === me.username;
  openModal(`
    <h2>Reset password <small class="hint">${esc(username)}</small></h2>
    ${isSelf ? '<div class="field"><label>Current password</label><input id="rp_cur" type="password" autocomplete="current-password"></div>' : '<p class="hint">Admin reset — no current password needed.</p>'}
    <div class="two-col">
      <div class="field"><label>New password <small class="hint">(min 6 chars)</small></label><input id="rp_new" type="password" autocomplete="new-password"></div>
      <div class="field"><label>Repeat new password</label><input id="rp_new2" type="password" autocomplete="new-password"></div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="rp_cancel">Cancel</button>
      <button class="btn primary" id="rp_save">Set password</button>
    </div>`);
  $('#rp_cancel').addEventListener('click', closeModal);
  $('#rp_save').addEventListener('click', async () => {
    const next = $('#rp_new').value;
    if (next.length < 6) { toast('New password must be at least 6 characters', 'err'); return; }
    if (next !== $('#rp_new2').value) { toast('New passwords do not match', 'err'); return; }
    const r = await api.post('/auth/change-password', { username, current: isSelf ? $('#rp_cur').value : undefined, next });
    if (r.ok) { closeModal(); toast('Password changed', 'ok'); }
    else if (!r.__auth) toast(r.error || 'Failed', 'err');
  });
}

// Reveal the Dashboard Users nav item for admins (server enforces regardless).
let dashRole = 'user';
(async () => {
  try {
    const me = await api.get('/auth/me');
    if (me.ok) dashRole = me.role || 'user';
    if (me.ok && me.role === 'admin') $('#navDashUsers').style.display = '';
  } catch { /* not signed in yet — login overlay handles it */ }
})();

// Search box for long machine checklists: hides labels that don't match.
function wireChecklistFilter(inputId) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.addEventListener('input', () => {
    const q = inp.value.toLowerCase().trim();
    inp.closest('.field').querySelectorAll('.device-checklist label').forEach((l) => {
      l.style.display = !q || l.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}

// Non-admin dashboard accounts: Entrance group + ONE room per employee.
// Removes the Select-all chip and keeps at most one non-entrance machine
// ticked (the server enforces the same rule regardless).
function limitRoomSelection(checkboxClass, devsList) {
  if (dashRole === 'admin') return;
  document.querySelector('[data-grpsel="*"]')?.remove();
  const entr = new Set(devsList
    .filter((d) => String(d.grp || '').trim().toLowerCase().startsWith('entrance'))
    .map((x) => String(x.id)));
  document.querySelectorAll(`.${checkboxClass}`).forEach((c) => c.addEventListener('change', () => {
    if (!c.checked || entr.has(String(c.value))) return;
    document.querySelectorAll(`.${checkboxClass}:checked`).forEach((o) => {
      if (o !== c && !entr.has(String(o.value))) { o.checked = false; o.dispatchEvent(new Event('change')); }
    });
  }));
}

// ---- Analytics & Occupancy View ----
async function analyticsView() {
  clearInterval(_autoTimer);
  content.innerHTML = '<div class="empty">Loading analytics engine…</div>';
  const data = await api.get('/analytics');
  if (current !== 'analytics') return;
  if (!data.ok) { content.innerHTML = `<div class="empty">Failed to load analytics: ${esc(data.error)}</div>`; return; }

  const kpi = (icon, label, value, cls = '', sub = '') => `
    <div class="stat ${cls}">
      <div class="stat-head"><span class="stat-icon">${ICONS[icon] || ''}</span><span class="label">${label}</span></div>
      <div class="value">${value}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
    </div>`;

  const maxVal = Math.max(1, ...data.hourlyDistribution);
  const hourlyBars = data.hourlyDistribution.map((cnt, hr) => {
    const pct = Math.round((cnt / maxVal) * 100);
    const label = `${String(hr).padStart(2, '0')}:00`;
    return `
      <div class="chart-bar-item" title="${cnt} scans at ${label}">
        <div class="chart-bar">
          <div class="chart-bar-fill" style="height: ${Math.max(4, pct)}%"></div>
        </div>
        <span class="chart-label">${hr % 3 === 0 ? label : ''}</span>
      </div>`;
  }).join('');

  const doorBars = data.doorUsage.slice(0, 8).map((d) => `
    <div class="usage-row">
      <div class="usage-head">
        <span class="usage-name">${esc(d.name)}</span>
        <span class="usage-val">${d.count} scans (${d.percent}%)</span>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width: ${Math.max(3, d.percent)}%"></div>
      </div>
    </div>`).join('') || '<div class="list-empty">No door activity recorded today.</div>';

  content.innerHTML = `<div>
    <div class="stat-grid">
      ${kpi('user', 'Live Occupancy', data.liveHeadcount, 'good', 'Estimated headcount on site')}
      ${kpi('online', 'Today Scans', data.todayTotal, 'good', 'Total entries today')}
      ${kpi('clock', 'Peak Hour', data.peakHourLabel, 'warn', `${data.maxPeak} scans during peak`)}
      ${kpi('machine', 'Active Doors', `${data.onlineCount} / ${data.devicesCount}`, data.onlineCount === data.devicesCount ? 'good' : 'warn', 'Online terminals')}
    </div>

    <div class="panel-grid" style="margin-top:24px;">
      <section class="panel" style="height:auto; min-height:380px;">
        <header>
          <h3>Hourly Traffic Distribution (Today)</h3>
        </header>
        <div class="panel-body" style="padding:22px;">
          <div class="chart-container">
            ${hourlyBars}
          </div>
        </div>
      </section>

      <section class="panel" style="height:auto; min-height:380px;">
        <header>
          <h3>Top Door Terminal Usage</h3>
        </header>
        <div class="panel-body" style="padding:20px;">
          ${doorBars}
        </div>
      </section>
    </div>
  </div>`;
}

// ---- Admin Audit Log View ----
async function auditView() {
  clearInterval(_autoTimer);
  content.innerHTML = '<div class="empty">Loading admin audit trail…</div>';
  const data = await api.get('/audit-logs?limit=200');
  if (current !== 'audit') return;
  if (!data.ok) { content.innerHTML = `<div class="empty">Failed to load audit trail: ${esc(data.error)}</div>`; return; }

  const rows = data.logs.length ? data.logs.map((l) => {
    const actCls = l.action.includes('SUCCESS') || l.action.includes('CREATE') ? 'synced' : l.action.includes('FAIL') || l.action.includes('DELETE') ? 'error' : 'pending';
    return `
      <tr>
        <td class="nowrap"><small class="hint">${esc(l.ts)}</small></td>
        <td><b>${esc(l.actor)}</b></td>
        <td><span class="badge ${actCls}">${esc(l.action)}</span></td>
        <td>${esc(l.target || '—')}</td>
        <td class="nowrap"><small class="hint">${esc(l.ip || '127.0.0.1')}</small></td>
        <td><small class="hint">${esc(typeof l.info === 'string' ? l.info : JSON.stringify(l.info))}</small></td>
      </tr>`;
  }).join('') : '<tr><td colspan="6" class="list-empty">No admin audit events recorded yet.</td></tr>';

  content.innerHTML = `<div>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Admin / User</th>
            <th>Action</th>
            <th>Target Device / Account</th>
            <th>IP Address</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
}

go('dashboard');
