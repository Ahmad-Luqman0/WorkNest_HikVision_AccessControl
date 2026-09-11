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
        <div class="logo-icon" style="width:44px;height:44px;background:#101c3d;padding:0;overflow:hidden">
          <img src="/logo-mark.png" alt="WorkNest" style="width:100%;height:100%;display:block" />
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
const p2 = (n) => String(n).padStart(2, '0');

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3200);
}

// Persistent warning shown when the HOSTED server cannot reach the machines
// (the office router blocks cloud traffic). Data pages keep working from
// snapshots; live machine actions need the local network until it's fixed.
function showCloudBlockedBar(blocked) {
  let bar = document.getElementById('cloudBlockedBar');
  if (!blocked) { if (bar) bar.remove(); return; }
  if (bar) return;
  bar = document.createElement('div');
  bar.id = 'cloudBlockedBar';
  // position:fixed so it NEVER participates in layout — the app body is a
  // grid whose direct children are columns, and an in-flow banner there
  // shoves the whole page sideways.
  bar.style.cssText = 'position:fixed;bottom:14px;right:14px;z-index:200;max-width:340px;background:#7a2e2e;color:#ffd7d7;padding:10px 14px;font-size:12.5px;line-height:1.45;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.35);pointer-events:auto;';
  bar.innerHTML = '<b>Machines unreachable from the dashboard server.</b> Terminals are offline in real time. Clears automatically once machines reconnect. <span style="float:right;cursor:pointer;margin-left:8px;font-weight:700" onclick="this.parentElement.remove()">✕</span>';
  document.body.appendChild(bar);
}

function openModal(html) {
  $('#modal').innerHTML = html;
  $('#modalBackdrop').hidden = false;
}

function closeModal() { $('#modalBackdrop').hidden = true; }
$('#modalBackdrop').addEventListener('click', (e) => { if (e.target.id === 'modalBackdrop') closeModal(); });

function confirmDialog({ title = 'Confirm Action', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const iconSvg = danger
      ? `<svg class="modal-alert-icon danger" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
      : `<svg class="modal-alert-icon info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;

    const formattedMessage = esc(message).replace(/\n/g, '<br>');
    const html = `
      <div class="confirm-dialog">
        <div class="confirm-head">
          ${iconSvg}
          <div class="confirm-title-area">
            <h3>${esc(title)}</h3>
            <p class="confirm-msg">${formattedMessage}</p>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="dlg_cancel" type="button">${esc(cancelText)}</button>
          <button class="btn ${danger ? 'danger' : 'primary'}" id="dlg_ok" type="button">${esc(confirmText)}</button>
        </div>
      </div>
    `;
    openModal(html);

    let resolved = false;
    const cleanup = (result) => {
      if (resolved) return;
      resolved = true;
      window.removeEventListener('keydown', onKey);
      closeModal();
      resolve(result);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') {
        cleanup(false);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        cleanup(true);
      }
    };
    window.addEventListener('keydown', onKey);

    $('#dlg_cancel')?.addEventListener('click', () => cleanup(false));
    $('#dlg_ok')?.addEventListener('click', () => cleanup(true));
    setTimeout(() => $('#dlg_ok')?.focus(), 50);
  });
}

function miniSparklineSvg(counts = []) {
  if (!counts || !counts.length) return '';
  const max = Math.max(...counts, 1);
  const bars = counts.map((c, i) => {
    const h = Math.max(2, Math.round((c / max) * 18));
    const y = 20 - h;
    const x = i * 4;
    return `<rect x="${x}" y="${y}" width="2.5" height="${h}" rx="1" fill="currentColor" opacity="${c > 0 ? 0.9 : 0.25}"/>`;
  }).join('');
  return `<svg class="stat-sparkline" viewBox="0 0 96 22" aria-hidden="true">${bars}</svg>`;
}

// ---- Global Server-Sent Events (SSE) Live Stream ----
let _sseSource = null;
function initSse() {
  if (_sseSource || typeof EventSource === 'undefined') return;
  try {
    _sseSource = new EventSource('/api/events/stream');
    _sseSource.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === 'activity') onLiveActivityEvent(data);
      } catch { }
    };
    _sseSource.onerror = () => { };
  } catch { }
}

function onLiveActivityEvent(entry) {
  if (current === 'dashboard') {
    const tickerBody = $('#dashTickerList');
    if (tickerBody) {
      const emptyNotice = tickerBody.querySelector('.list-empty');
      if (emptyNotice) emptyNotice.remove();

      const cred = getCredBadge(entry.action);
      const who = entry.name || prettyAction(entry.action);
      const avatar = renderAvatar(who, 'md');
      const row = el(`
        <div class="ticker-item live-incoming">
          ${avatar}
          <div class="ticker-main">
            <div class="ticker-person"><b>${esc(who)}</b> <span class="ticker-cred-label">${cred.label}</span></div>
            <div class="ticker-sub"><small class="hint">${esc(new Date().toLocaleTimeString())}</small></div>
          </div>
          <span class="badge ${entry.ok ? 'synced' : 'error'}">${entry.ok ? 'Granted' : 'Denied'}</span>
        </div>`);
      tickerBody.insertBefore(row, tickerBody.firstChild);
      while (tickerBody.children.length > 8) tickerBody.lastChild.remove();
    }
    const scansEl = $('#kpiScansVal');
    if (scansEl) {
      const cur = Number(scansEl.textContent) || 0;
      scansEl.textContent = cur + 1;
    }
    const liveTicker = $('#presenceLiveTicker');
    if (liveTicker && (entry.name || entry.action === 'door:open' || entry.action === 'door:close')) {
      const isRemote = entry.action === 'door:open';
      const who = entry.name || 'Member';
      const actionLabel = isRemote ? 'unlocked remotely' : 'accessed';
      liveTicker.innerHTML = `<b>${esc(who)}</b> ${actionLabel} <b>${esc(entry.device || 'Entrance')}</b> <span class="badge ${Boolean(entry.ok) ? 'synced' : 'error'}" style="font-size:10px;padding:2px 6px;">${Boolean(entry.ok) ? 'Granted' : 'Denied'}</span> <small class="hint">Just now</small>`;
      liveTicker.classList.add('ticker-pop');
      setTimeout(() => liveTicker.classList.remove('ticker-pop'), 1200);
    }
    const dot = $('.brand-text .live-dot');
    if (dot) {
      dot.style.transform = 'scale(1.6)';
      dot.style.boxShadow = '0 0 12px var(--green)';
      setTimeout(() => { dot.style.transform = ''; dot.style.boxShadow = ''; }, 1000);
    }
  }
}

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

// ---- Initials Avatars & Polish Utilities ----
function getInitials(name) {
  if (!name || typeof name !== 'string') return 'G';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'G';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function nameThemeHash(name) {
  let hash = 0;
  const str = String(name || 'User');
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 8;
}

function renderAvatar(name, size = 'sm') {
  const inits = getInitials(name);
  const theme = nameThemeHash(name);
  return `<span class="avatar-badge ${size} avatar-theme-${theme}" title="${esc(name || 'Member')}">${esc(inits)}</span>`;
}

// ---- Copy to Clipboard Helpers ----
const COPY_SVG = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
const CHECK_SVG = `<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

function copyableBadge(text, display = null) {
  if (text === null || text === undefined || text === '') return '<small class="hint">—</small>';
  const showText = display !== null ? display : text;
  return `<span class="copyable-badge" data-copy="${esc(String(text))}" title="Click to copy">${esc(String(showText))} ${COPY_SVG}</span>`;
}

function initCopyHandler() {
  document.addEventListener('click', async (e) => {
    const badge = e.target.closest('.copyable-badge');
    if (!badge || badge.classList.contains('copied')) return;
    const text = badge.dataset.copy;
    if (!text) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      const origHtml = badge.innerHTML;
      badge.classList.add('copied');
      badge.innerHTML = `<span>Copied!</span> ${CHECK_SVG}`;
      setTimeout(() => {
        badge.classList.remove('copied');
        badge.innerHTML = origHtml;
      }, 1400);
    } catch {
      toast('Copied to clipboard: ' + text);
    }
  });
}
initCopyHandler();

// ---- Interactive Bezier Area Chart Generator ----
function generateBezierAreaChartSvg(dataPoints, width = 740, height = 240) {
  const padLeft = 40;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 30;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const safeData = Array.isArray(dataPoints) && dataPoints.length === 24 ? dataPoints : Array(24).fill(0);
  const maxVal = Math.max(5, ...safeData);
  const n = safeData.length;

  const coords = safeData.map((val, i) => {
    const x = padLeft + (i / (n - 1)) * chartW;
    const y = padTop + chartH - (val / maxVal) * chartH;
    return { x, y, val, hr: i };
  });

  let pathD = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = i > 0 ? coords[i - 1] : coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = i !== coords.length - 2 ? coords[i + 2] : p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    pathD += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  const areaD = `${pathD} L ${coords[coords.length - 1].x.toFixed(1)} ${(padTop + chartH).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(padTop + chartH).toFixed(1)} Z`;

  const gridLines = [0.25, 0.5, 0.75, 1].map((lvl) => {
    const y = padTop + chartH - lvl * chartH;
    const label = Math.round(lvl * maxVal);
    return `
      <line class="chart-grid-line" x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" />
      <text class="chart-axis-label" x="${padLeft - 8}" y="${y + 4}" text-anchor="end">${label}</text>
    `;
  }).join('');

  const xLabels = [0, 4, 8, 12, 16, 20, 23].map((hr) => {
    const pt = coords[hr];
    const label = `${String(hr).padStart(2, '0')}:00`;
    return `<text class="chart-axis-label" x="${pt.x}" y="${height - 8}" text-anchor="middle">${label}</text>`;
  }).join('');

  const ptsJson = JSON.stringify(coords.map((c) => ({ x: Math.round(c.x), y: Math.round(c.y), val: c.val, hr: c.hr })));

  return `
    <div class="bezier-chart-wrap" id="analyticsBezierWrap" data-coords='${ptsJson}'>
      <svg class="bezier-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="areaTrafficGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#6366f1" stop-opacity="0.38" />
            <stop offset="60%" stop-color="#8b5cf6" stop-opacity="0.12" />
            <stop offset="100%" stop-color="#6366f1" stop-opacity="0.0" />
          </linearGradient>
          <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#6366f1" flood-opacity="0.5"/>
          </filter>
        </defs>
        ${gridLines}
        <path d="${areaD}" fill="url(#areaTrafficGrad)" />
        <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" filter="url(#lineGlow)" />
        <line class="chart-guide-line" id="chartGuideLine" x1="0" y1="${padTop}" x2="0" y2="${padTop + chartH}" />
        <circle class="chart-hover-dot" id="chartHoverDot" cx="0" cy="0" r="5" />
      </svg>
      <div class="chart-tooltip-glass" id="chartTooltip"></div>
    </div>
  `;
}

function wireBezierChart() {
  const wrap = $('#analyticsBezierWrap');
  if (!wrap) return;
  const raw = wrap.dataset.coords;
  if (!raw) return;
  try {
    const coords = JSON.parse(raw);
    const guide = $('#chartGuideLine');
    const dot = $('#chartHoverDot');
    const tt = $('#chartTooltip');

    wrap.addEventListener('mousemove', (e) => {
      const rect = wrap.getBoundingClientRect();
      const svgRatio = 740 / rect.width;
      const mouseSvgX = (e.clientX - rect.left) * svgRatio;

      let closest = coords[0];
      let minDiff = Infinity;
      for (const c of coords) {
        const diff = Math.abs(c.x - mouseSvgX);
        if (diff < minDiff) { minDiff = diff; closest = c; }
      }

      if (guide && dot && tt) {
        guide.setAttribute('x1', closest.x);
        guide.setAttribute('x2', closest.x);
        guide.style.opacity = '1';

        dot.setAttribute('cx', closest.x);
        dot.setAttribute('cy', closest.y);
        dot.style.opacity = '1';

        const hrStr = `${String(closest.hr).padStart(2, '0')}:00`;
        tt.innerHTML = `<span class="tt-time">${hrStr}</span> <span class="tt-val">${closest.val} scan${closest.val === 1 ? '' : 's'}</span>`;
        tt.style.left = `${(closest.x / 740) * 100}%`;
        tt.style.top = `${(closest.y / 240) * 100}%`;
        tt.style.opacity = '1';
      }
    });

    wrap.addEventListener('mouseleave', () => {
      if (guide) guide.style.opacity = '0';
      if (dot) dot.style.opacity = '0';
      if (tt) tt.style.opacity = '0';
    });
  } catch { }
}

// ---- Space Utilization Donut Generator ----
function renderSpaceDonut(doorUsage, todayTotal) {
  const safeDoors = Array.isArray(doorUsage) ? doorUsage.slice(0, 6) : [];
  if (!safeDoors.length) return '<div class="list-empty">No door activity recorded in this period.</div>';

  const colors = ['#6366f1', '#10b981', '#38bdf8', '#f59e0b', '#a855f7', '#ec4899'];
  const radius = 46;
  const circ = 2 * Math.PI * radius; // ~289.02

  let accumulated = 0;
  const segments = safeDoors.map((d, i) => {
    const pct = d.percent || 0;
    const strokeLen = (pct / 100) * circ;
    const strokeDash = `${strokeLen.toFixed(1)} ${circ.toFixed(1)}`;
    const strokeOffset = (-accumulated).toFixed(1);
    accumulated += strokeLen;
    const color = colors[i % colors.length];
    return `<circle cx="65" cy="65" r="${radius}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${strokeDash}" stroke-dashoffset="${strokeOffset}" opacity="0.9" />`;
  }).join('');

  const legend = safeDoors.map((d, i) => {
    const color = colors[i % colors.length];
    return `
      <div class="usage-row" style="margin-bottom:8px">
        <div class="usage-head">
          <span class="usage-name" style="display:flex;align-items:center;gap:6px">
            <span style="width:8px;height:8px;border-radius:50%;background:${color};display:inline-block"></span>
            ${esc(d.name)}
          </span>
          <span class="usage-val">${d.count} (${d.percent}%)</span>
        </div>
        <div class="progress-bar-bg" style="height:5px">
          <div class="progress-bar-fill" style="width:${Math.max(3, d.percent)}%; background:${color}"></div>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="utilization-donut-card">
      <div class="utilization-donut-box">
        <svg class="utilization-donut-svg" viewBox="0 0 130 130">
          <circle cx="65" cy="65" r="${radius}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="12" />
          ${segments}
        </svg>
        <div class="utilization-donut-center">
          <div class="utilization-donut-total">${todayTotal || 0}</div>
          <div class="utilization-donut-sub">Total Scans</div>
        </div>
      </div>
      <div class="utilization-legend-list">
        ${legend}
      </div>
    </div>
  `;
}

// ---- CSV Export Utility ----
function exportUsersCsv(exportEntries) {
  if (!exportEntries || !exportEntries.length) { toast('No members to export', 'err'); return; }
  const headers = ['Employee No', 'Name', 'Room Access', 'Role', 'Machines', 'Valid Until', 'Cards', 'Fingerprints', 'Faces', 'Status'];
  const csvRows = [headers.join(',')];
  for (const { u, on } of exportEntries) {
    const blocked = u.Valid?.enable === false ? 'Blocked' : 'Active';
    const role = u.localUIRight ? 'Admin' : 'User';
    const machines = on.map((d) => d.name).join('; ');
    const rooms = on.map((d) => d.code ? 'Room ' + d.code : d.name).join('; ');
    const validUntil = u.Valid?.endTime ? u.Valid.endTime.replace('T', ' ') : 'Unlimited';
    const row = [
      `"${String(u.employeeNo || '').replace(/"/g, '""')}"`,
      `"${String(u.name || '').replace(/"/g, '""')}"`,
      `"${rooms.replace(/"/g, '""')}"`,
      `"${role}"`,
      `"${machines.replace(/"/g, '""')}"`,
      `"${validUntil}"`,
      u.numOfCard || 0,
      u.numOfFP || 0,
      u.numOfFace || 0,
      `"${blocked}"`
    ];
    csvRows.push(row.join(','));
  }
  const blob = new Blob([csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `worknest_users_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast(`Exported ${exportEntries.length} members to CSV`, 'ok');
}

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
    ${dashRole === 'admin' ? chip('*', items.length, 'Select all') : ''}
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

// Clean vector empty state generator (no emojis, crisp SVG iconography)
function renderEmptyState({ icon = 'search', title = 'No results found', message = 'Try adjusting your search query or filters.', actionText = '', onAction = null }) {
  const ICONS_MAP = {
    search: '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="12" cy="15" r="2"/></svg>',
    devices: '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2.5" width="14" height="19" rx="2.5"/><circle cx="12" cy="9" r="2.6"/><line x1="8.5" y1="17" x2="15.5" y2="17"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>',
    user: '<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
  };
  const svg = ICONS_MAP[icon] || ICONS_MAP.search;
  const actId = 'empty_act_' + Math.random().toString(36).slice(2, 8);
  if (actionText && onAction) {
    setTimeout(() => {
      const btn = document.getElementById(actId);
      if (btn) btn.addEventListener('click', onAction);
    }, 0);
  }
  return `
    <div class="modern-empty-state">
      <div class="empty-icon-box">${svg}</div>
      <div class="empty-title">${esc(title)}</div>
      <div class="empty-message">${esc(message)}</div>
      ${actionText && onAction ? `<button id="${actId}" class="btn sm primary empty-action-btn" type="button">${esc(actionText)}</button>` : ''}
    </div>
  `;
}

// ---- Router ----
const views = { dashboard, devices, users, cards, logs, analytics: analyticsView, audit: auditView, dashusers, bookings: bookingsView };
let current = 'dashboard';
let _autoTimer = null; // live-refresh timer for dashboard / activity views
let _cmdCachedEntries = [];
let _cmdCachedUsers = [];
let _cmdCachedDevs = [];
let _deviceFilter = 'all';
let _deviceSearch = '';
let _bookingsViewMode = localStorage.getItem('wn_bookings_view_mode') || 'gantt';
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

// Global Cmd+K / Ctrl+K quick-search shortcut
window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (current === 'dashboard') go('users');
    const sc = $('#globalSearchContainer');
    const si = $('#globalSearch');
    if (sc) sc.hidden = false;
    if (si) {
      si.focus();
      si.select();
    }
  }
});

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
  analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>',
  table: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="14" x2="21" y2="14"/><line x1="9" y1="4" x2="9" y2="20"/></svg>',
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  userPlus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
  door: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 21h18M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M14 12v.01"/></svg>',
  audit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
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

const getCredBadge = (action) => {
  const act = String(action || '').toLowerCase();
  if (act.includes('card') || act.includes('rfid')) return { icon: ICONS.card, label: 'RFID Card', cls: 'cred-card' };
  if (act.includes('face')) return { icon: ICONS.user, label: 'Facial Scan', cls: 'cred-face' };
  if (act.includes('finger')) return { icon: ICONS.user, label: 'Fingerprint', cls: 'cred-finger' };
  if (act.includes('door') || act.includes('unlock') || act.includes('open')) return { icon: ICONS.unlock, label: 'Remote Unlock', cls: 'cred-remote' };
  return { icon: ICONS.machine, label: 'Access Event', cls: 'cred-gen' };
};

async function dashboard() {
  initSse();
  // Instant shell — the page appears immediately while live data loads on first paint.
  if (!content.querySelector('.stat-grid') && !$('#dashWrapper')) {
    content.innerHTML = `<div><div class="stat-grid">${Array.from({ length: 6 }, () =>
      '<div class="stat"><div class="stat-head"><span class="skel-cell" style="width:60%"></span></div><div class="value"><span class="skel-cell" style="width:40%;height:22px"></span></div></div>').join('')}</div>
      ${skeletonTable(['', '', ''], 4)}</div>`;
  }
  // Live view: refresh every 30s while the dashboard is open (not over modals).
  clearInterval(_autoTimer);
  _autoTimer = setInterval(() => {
    if (current === 'dashboard' && $('#modalBackdrop').hidden) dashboard();
  }, 30000);

  const [s, devs, logsList, expiring, bookingsSummary, analyticsData] = await Promise.all([
    api.get('/stats'), api.get('/devices'), api.get('/logs'), api.get('/expiring'),
    api.get('/bookings-feed?summary=1'), api.get('/analytics').catch(() => null),
  ]);
  if (Array.isArray(devs)) _cmdCachedDevs = devs;
  if (current !== 'dashboard') return; // view changed while loading

  // Background non-blocking consistency and online checks
  setTimeout(() => {
    if (current !== 'dashboard') return;
    api.get('/consistency').then((c) => {
      const slot = document.getElementById('dashConsistency');
      if (current !== 'dashboard' || !slot || !c?.ok || !c.issues?.length) {
        if (slot) slot.innerHTML = '';
        return;
      }
      slot.innerHTML = `<div class="notice-banner">${c.issues.length} credential mismatch${c.issues.length === 1 ? '' : 'es'} between machines (cards/fingerprints/faces differ) — open <b>Users</b> for details.</div>`;
      slot.firstElementChild.addEventListener('click', () => go('users'));
    }).catch(() => { });

    api.post('/online-check').then((r) => {
      showCloudBlockedBar(!!r?.blocked);
      if (r?.blocked) {
        const badge = document.getElementById('heroBadge');
        if (badge) {
          badge.className = 'exec-greeting-badge alert';
          badge.innerHTML = `<span class="live-dot" style="background:var(--red);box-shadow:0 0 8px var(--red)"></span> All Terminals Offline`;
        }
        document.querySelectorAll('#dashExecHero .live-dot').forEach((dot) => {
          dot.style.background = 'var(--red)';
          dot.style.boxShadow = '0 0 8px var(--red)';
        });
        document.querySelectorAll('.list-row .status-dot.on').forEach((dot) => {
          dot.className = 'status-dot off';
        });
        document.querySelectorAll('.list-row span.badge.online').forEach((b) => {
          b.className = 'badge offline';
          b.textContent = 'Offline';
        });
        if (Array.isArray(_cmdCachedDevs)) {
          _cmdCachedDevs.forEach((d) => (d.online = 0));
        }
      }
      if (r?.ok && r.changed && current === 'dashboard' && !document.querySelector('#modalBackdrop:not([hidden])')) overview();
    }).catch(() => { });
  }, 1000);

  const totalMachines = (s && s.devices > 0) ? s.devices : devs.length;
  const onlineMachines = (s && s.devicesOnline !== undefined) ? s.devicesOnline : devs.filter((d) => d.online).length;
  const trendText = s.trendPct !== undefined ? `${s.trendPct >= 0 ? '+' : ''}${s.trendPct}% vs yesterday` : '';
  const sparkSvg = miniSparklineSvg(analyticsData?.hourlyDistribution || []);

  const nowHour = new Date().getHours();
  const greeting = nowHour < 12 ? 'Good morning' : nowHour < 17 ? 'Good afternoon' : 'Good evening';
  const offlineCount = devs.filter((d) => !d.online).length;
  const isHealthy = offlineCount === 0 && totalMachines > 0;
  const liveHeadcount = (analyticsData?.liveHeadcount !== undefined)
    ? analyticsData.liveHeadcount
    : Math.min(s.todayScans || 0, s.active || 0);
  const totalCapacity = Math.max(50, s.active || 50);
  const occupancyPct = Math.min(100, Math.round((liveHeadcount / totalCapacity) * 100));
  const ringCircumference = 238.76;
  const ringOffset = (ringCircumference * (1 - occupancyPct / 100)).toFixed(1);

  const uniqueToday = (s && s.uniqueToday !== undefined)
    ? s.uniqueToday
    : (liveHeadcount || Math.min(s.todayScans || 0, s.active || 0));
  const peakHour = analyticsData?.peakHourLabel || '09:00 - 10:00 AM';

  let latestSwipe = null;
  if (s && s.lastEvent && s.lastEvent.name) {
    latestSwipe = s.lastEvent;
  } else if (logsList && logsList.length) {
    const accessEvent = logsList.find((l) =>
      Boolean(l.employee_name) ||
      Boolean(l.employee_id) ||
      l.action === 'door:open' ||
      l.action === 'door:close' ||
      (l.action && (l.action.startsWith('card') || l.action.startsWith('face') || l.action.startsWith('finger')))
    );
    if (accessEvent) {
      latestSwipe = {
        name: accessEvent.employee_name || 'Member',
        action: accessEvent.action,
        deviceName: accessEvent.device_name || 'Entrance',
        time: accessEvent.ts,
        ok: Boolean(accessEvent.ok),
      };
    }
  }
  let lastSwipeHtml;
  if (latestSwipe) {
    const isRemote = latestSwipe.action === 'door:open';
    const actionLabel = isRemote ? 'unlocked remotely' : 'accessed';
    lastSwipeHtml = `
      <b>${esc(latestSwipe.name || 'Member')}</b> ${actionLabel} <b>${esc(latestSwipe.deviceName || 'Entrance')}</b>
      <span class="badge ${latestSwipe.ok ? 'synced' : 'error'}" style="font-size:10px;padding:2px 6px;">${latestSwipe.ok ? 'Granted' : 'Denied'}</span>
      <small class="hint">${esc(latestSwipe.time ? String(latestSwipe.time).replace('T', ' ').slice(11, 19) : 'Just now')}</small>
    `;
  } else {
    lastSwipeHtml = '<span class="hint">No member access events recorded today (terminals offline)</span>';
  }

  const presenceBarHtml = `
    <div class="facility-presence-bar" id="facilityPresenceBar">
      <div class="presence-metrics-group">
        <div class="presence-metric">
          <div class="presence-metric-icon">
            ${ICONS.user}
            <span class="presence-live-pulse"></span>
          </div>
          <div class="presence-metric-text">
            <div class="presence-val tabular-nums" id="presenceUniqueVal">${uniqueToday}</div>
            <div class="presence-lbl">Members On-Site Today</div>
          </div>
        </div>

        <div class="presence-divider"></div>

        <div class="presence-metric">
          <div class="presence-metric-icon">
            ${ICONS.clock}
          </div>
          <div class="presence-metric-text">
            <div class="presence-val" id="presencePeakVal">${esc(peakHour)}</div>
            <div class="presence-lbl">Peak Arrival Window</div>
          </div>
        </div>
      </div>

      <div class="presence-divider"></div>

      <div class="presence-ticker-box" id="presenceLiveTickerBox">
        <div class="presence-ticker-tag">
          <span class="ticker-live-dot"></span> Live Access
        </div>
        <div class="presence-ticker-content" id="presenceLiveTicker">
          ${lastSwipeHtml}
        </div>
      </div>
    </div>
  `;

  const heroHtml = `
    <div class="exec-hero" id="dashExecHero">
      <div class="exec-hero-left">
        <div class="exec-greeting-badge ${isHealthy ? '' : 'alert'}" id="heroBadge">
          <span class="live-dot" style="${isHealthy ? '' : 'background:var(--red);box-shadow:0 0 8px var(--red)'}"></span>
          ${isHealthy ? 'All Systems Nominal' : `${offlineCount} Terminal${offlineCount > 1 ? 's' : ''} Offline`}
        </div>
        <h2 class="exec-greeting-title" id="heroTitle">${greeting}, Admin</h2>
        <p class="exec-greeting-sub" id="heroSub">
          <b>${onlineMachines} of ${totalMachines}</b> devices operational · <b>${s.active || 0}</b> active members · <b>${s.todayScans || 0}</b> scans recorded today.
        </p>
        <div class="exec-actions">
          <button class="btn sm primary" id="heroDayPass">+ Day Pass</button>
          <button class="btn sm" id="heroQuickUnlock">${ICONS.unlock} Quick Unlock</button>
          <button class="btn sm" id="heroAnalytics">${ICONS.analytics} Live Analytics →</button>
        </div>
      </div>

      <div class="exec-hero-right">
        <div class="occupancy-ring-box" title="Estimated live occupancy based on access scans today">
          <svg class="occupancy-ring-svg" viewBox="0 0 92 92">
            <defs>
              <linearGradient id="occupancyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#6366f1" />
                <stop offset="100%" stop-color="#10b981" />
              </linearGradient>
            </defs>
            <circle class="occupancy-ring-bg" cx="46" cy="46" r="38"></circle>
            <circle class="occupancy-ring-fill" id="occupancyRingFill" cx="46" cy="46" r="38"
              stroke-dasharray="${ringCircumference}"
              stroke-dashoffset="${ringOffset}"></circle>
          </svg>
          <div class="occupancy-ring-meta">
            <div class="occupancy-ring-pct" id="occupancyRingPct">${occupancyPct}%</div>
            <div class="occupancy-ring-label">Capacity</div>
          </div>
        </div>
        <div class="occupancy-details">
          <div class="occupancy-details-val" id="occupancyHeadcountVal">${liveHeadcount} Members Live</div>
          <div class="occupancy-details-sub" id="occupancyCapacitySub">Capacity target: ${totalCapacity}</div>
          <div class="occupancy-details-sub" style="color:var(--accent); font-weight:600">Peak: ${esc(analyticsData?.peakHourLabel || '14:00')}</div>
        </div>
      </div>
    </div>
  `;

  const machineRows = devs.length ? devs.map((d) => `
    <div class="list-row">
      <span class="status-dot ${d.online ? 'on' : 'off'}"></span>
      <div class="list-main">
        <b>${esc(d.name)}</b>
        <small class="hint">${copyableBadge(d.host)}${d.model ? ' · ' + esc(d.model) : ''}</small>
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
        <small class="hint">${copyableBadge(it.employeeNo)} · ${esc(it.on.map((x) => x.device).join(', '))}</small>
      </div>
      <span class="badge ${it.status === 'expired' ? 'expired' : 'pending'}">${it.status === 'expired' ? 'expired' : 'ends ' + esc(String(it.minEnd).replace('T', ' ').slice(0, 16))}</span>
      <button class="btn sm" data-extend="${esc(it.employeeNo)}" data-ename="${esc(it.name || '')}">Extend 30 days</button>
    </div>`).join('')
    : '<div class="list-empty">No memberships expiring in the next 7 days.</div>';

  const actRows = logsList.length ? logsList.slice(0, 8).map((l) => {
    const cred = getCredBadge(l.action);
    const who = l.employee_name || prettyAction(l.action);
    const avatar = renderAvatar(who, 'md');
    return `
    <div class="ticker-item animate-slide">
      ${avatar}
      <div class="ticker-main">
        <div class="ticker-person"><b>${esc(who)}</b> <span class="ticker-cred-label">${cred.label}</span></div>
        <div class="ticker-sub">${l.device_name ? esc(l.device_name) + ' · ' : ''}<small class="hint">${esc(l.ts)}</small></div>
      </div>
      <span class="badge ${l.ok ? 'synced' : 'error'}">${l.ok ? 'Granted' : 'Denied'}</span>
    </div>`;
  }).join('') : '<div class="list-empty">No entry activity stream yet.</div>';

  const offline = devs.filter((d) => !d.online);
  const offlineHtml = offline.length
    ? `<div class="offline-banner">Machine${offline.length === 1 ? '' : 's'} offline: <b>${esc(offline.map((d) => d.name).join(', '))}</b> — check power and network. Entries and changes for ${offline.length === 1 ? 'it' : 'them'} won't apply until ${offline.length === 1 ? 'it is' : 'they are'} back.</div>`
    : '';

  const bookingsHtml = bookingsSummary.ok && bookingsSummary.needingEnrollment > 0
    ? `<div class="notice-banner" id="dashBookingsBanner">${bookingsSummary.needingEnrollment} booking${bookingsSummary.needingEnrollment === 1 ? '' : 's'} need${bookingsSummary.needingEnrollment === 1 ? 's' : ''} people enrolled (fingerprints/cards) — open <b>Bookings</b> to add them.</div>`
    : '';

  // Non-destructive DOM update: if container already exists, patch elements in place
  const existingWrapper = $('#dashWrapper');
  if (existingWrapper && current === 'dashboard') {
    const heroBadge = $('#heroBadge');
    if (heroBadge) {
      heroBadge.className = `exec-greeting-badge ${isHealthy ? '' : 'alert'}`;
      heroBadge.innerHTML = `<span class="live-dot" style="${isHealthy ? '' : 'background:var(--red);box-shadow:0 0 8px var(--red)'}"></span> ${isHealthy ? 'All Systems Nominal' : `${offlineCount} Terminal${offlineCount > 1 ? 's' : ''} Offline`}`;
    }
    const heroTitle = $('#heroTitle');
    if (heroTitle) heroTitle.textContent = `${greeting}, Admin`;
    const heroSub = $('#heroSub');
    if (heroSub) heroSub.innerHTML = `<b>${onlineMachines} of ${totalMachines}</b> devices operational · <b>${s.active || 0}</b> active members · <b>${s.todayScans || 0}</b> scans recorded today.`;
    const ringEl = $('#occupancyRingFill');
    if (ringEl) ringEl.style.strokeDashoffset = `${ringOffset}`;
    const pctEl = $('#occupancyRingPct');
    if (pctEl) pctEl.textContent = `${occupancyPct}%`;
    const hcEl = $('#occupancyHeadcountVal');
    if (hcEl) hcEl.textContent = `${liveHeadcount} Members Live`;
    const capEl = $('#occupancyCapacitySub');
    if (capEl) capEl.textContent = `Capacity target: ${totalCapacity}`;

    const presenceValEl = $('#presenceUniqueVal');
    if (presenceValEl) presenceValEl.textContent = uniqueToday;
    const peakValEl = $('#presencePeakVal');
    if (peakValEl) peakValEl.textContent = peakHour;
    const tickerEl = $('#presenceLiveTicker');
    if (tickerEl) {
      tickerEl.innerHTML = lastSwipeHtml;
    }

    $('#dashOfflineBanner').innerHTML = offlineHtml;
    $('#dashBookingsSlot').innerHTML = bookingsHtml;
    $('#kpiMachinesVal').textContent = totalMachines;
    $('#kpiMachinesSub').textContent = `${onlineMachines} online`;
    $('#kpiUsersVal').textContent = s.active || 0;
    $('#kpiScansVal').textContent = s.todayScans || 0;
    $('#kpiScansSub').textContent = trendText;
    const sparkEl = $('#kpiScansSpark');
    if (sparkEl && sparkSvg) sparkEl.innerHTML = sparkSvg;
    $('#kpiCardsVal').textContent = s.cards || 0;
    $('#kpiExpiredVal').textContent = s.expired || 0;
    $('#kpiSyncVal').textContent = s.pendingSync || 0;

    $('#dashMachineList').innerHTML = machineRows;
    $('#dashTickerList').innerHTML = actRows;
    $('#dashExpiringList').innerHTML = expRows;

    wireDashActions(devs);
    return;
  }

  content.innerHTML = '';
  const kpi = (idPrefix, icon, label, value, cls = '', sub = '', trend = null, extra = '') => {
    let trendBadge = '';
    if (trend !== null && trend !== undefined) {
      const isUp = trend >= 0;
      const arrow = isUp ? '↑' : '↓';
      const trendCls = isUp ? 'up' : 'down';
      trendBadge = `<span class="stat-trend ${trendCls}">${arrow} ${isUp ? '+' : ''}${trend}%</span>`;
    }
    const displayVal = (value !== undefined && value !== null && !Number.isNaN(value)) ? value : 0;
    return `
    <div class="stat ${cls}" id="${idPrefix}Card">
      <div class="stat-head">
        <span class="stat-icon">${ICONS[icon] || ''}</span>
        <span class="label">${label}</span>
        ${trendBadge}
      </div>
      <div class="value" id="${idPrefix}Val">${displayVal}</div>
      <div class="sub" id="${idPrefix}Sub">${sub || ''}</div>
      ${extra}
    </div>`;
  };

  content.appendChild(el(`<div id="dashWrapper">
    ${presenceBarHtml}
    ${heroHtml}
    <div id="dashOfflineBanner">${offlineHtml}</div>
    <div id="dashBookingsSlot">${bookingsHtml}</div>
    <div id="dashConsistency"></div>
    <div class="stat-grid">
      ${kpi('kpiMachines', 'machine', 'Machines', totalMachines, '', `${onlineMachines} online`)}
      ${kpi('kpiUsers', 'user', 'Active Users', s.active || 0, 'good')}
      ${kpi('kpiScans', 'online', 'Today Scans', s.todayScans || 0, 'good', trendText, s.trendPct, `<div id="kpiScansSpark">${sparkSvg}</div>`)}
      ${kpi('kpiCards', 'card', 'Cards', s.cards || 0)}
      ${kpi('kpiExpired', 'clock', 'Expired', s.expired || 0, s.expired ? 'warn' : '')}
      ${kpi('kpiSync', 'sync', 'Pending sync', s.pendingSync || 0, s.pendingSync ? 'bad' : '')}
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
        <div class="panel-body" id="dashMachineList">${machineRows}</div>
      </section>

      <section class="panel">
        <header>
          <h3><span class="live-dot"></span> Real-Time Entry Stream</h3>
          <div class="panel-actions"><button class="btn sm" id="dashGoLogs">View all →</button></div>
        </header>
        <div class="panel-body" id="dashTickerList" style="padding:10px;">${actRows}</div>
      </section>
    </div>

    <section class="panel" style="margin-top:16px; height:auto; max-height:320px">
      <header>
        <h3>Expiring soon (next ${expiring.horizonDays || 7} days)</h3>
        <div class="panel-actions"><button class="btn sm" id="dashGoUsers">Users →</button></div>
      </header>
      <div class="panel-body" id="dashExpiringList">${expRows}</div>
    </section>

    <p class="hint" style="margin-top:20px">
      Machines enforce each person's valid period on their own — access is blocked at the door after expiry even if this dashboard is offline.
    </p>
  </div>`));

  wireDashActions(devs);
}

function quickUnlockModal(devs) {
  if (!devs || !devs.length) { toast('No devices configured', 'err'); return; }

  const doorItems = devs.map((d) => `
    <div class="list-row" style="padding:10px 14px; margin-bottom:8px; border-radius:10px; background:var(--surface-card); border:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; gap:12px;">
      <div style="display:flex; align-items:center; gap:10px; min-width:0;">
        <span class="status-dot ${d.online ? 'on' : 'off'}"></span>
        <div style="min-width:0;">
          <b style="font-size:14px; color:var(--text-main); display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${esc(d.name)}</b>
          <small class="hint" style="font-family:ui-monospace, monospace; font-size:11px;">${esc(d.host)}${d.model ? ' · ' + esc(d.model) : ''}</small>
        </div>
      </div>
      <button class="btn sm ${d.online ? 'primary' : ''}" data-modal-unlock="${d.id}" data-devname="${esc(d.name)}" ${d.online ? '' : 'disabled'} title="${d.online ? 'Unlock this door' : 'Device is offline'}">
        ${ICONS.unlock} Unlock
      </button>
    </div>
  `).join('');

  openModal(`
    <div style="max-width:480px; width:100%;">
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px;">
        <div style="width:40px; height:40px; border-radius:10px; background:rgba(99, 102, 241, 0.15); color:var(--accent); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
          ${ICONS.unlock}
        </div>
        <div>
          <h2 style="margin:0; font-size:18px; font-weight:700;">Select Door to Unlock</h2>
          <p class="hint" style="margin:2px 0 0;">Choose a terminal below to send an immediate unlock signal:</p>
        </div>
      </div>

      <div style="max-height:340px; overflow-y:auto; margin:16px 0; padding-right:4px;">
        ${doorItems}
      </div>

      <div class="modal-actions" style="margin-top:14px; display:flex; justify-content:space-between; align-items:center;">
        <button class="btn" id="modalUnlockAll" style="font-size:12px;">Unlock All Doors</button>
        <button class="btn" id="modalUnlockClose">Close</button>
      </div>
    </div>
  `);

  $('#modalUnlockClose')?.addEventListener('click', closeModal);

  $('#modalUnlockAll')?.addEventListener('click', async () => {
    closeModal();
    const ok = await confirmDialog({
      title: 'Fleet Door Unlock',
      message: `Unlock the door on ALL ${devs.length} machine${devs.length === 1 ? '' : 's'} now?`,
      confirmText: 'Unlock All Doors',
      danger: true
    });
    if (!ok) return;
    toast('Unlocking all doors…');
    const r = await api.post('/devices/door', { cmd: 'open' });
    const failed = (r.results || []).filter((x) => !x.ok);
    toast(failed.length ? `Unlocked ${r.okCount}/${r.total}` : `Unlocked all ${r.okCount}`, failed.length ? 'err' : 'ok');
  });

  document.querySelectorAll('[data-modal-unlock]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const devId = btn.dataset.modalUnlock;
      const devName = btn.dataset.devname;
      btn.disabled = true;
      btn.textContent = 'Unlocking…';
      toast(`Unlocking ${devName}…`);
      try {
        const r = await api.post(`/devices/${devId}/door`, { cmd: 'open' });
        if (r.ok) {
          toast(`Door unlocked at ${devName}`, 'ok');
          closeModal();
        } else {
          toast(`Failed: ${r.error || 'error'}`, 'err');
          btn.disabled = false;
          btn.innerHTML = `${ICONS.unlock} Unlock`;
        }
      } catch (e) {
        toast(`Error: ${e.message || e}`, 'err');
        btn.disabled = false;
        btn.innerHTML = `${ICONS.unlock} Unlock`;
      }
    });
  });
}

function wireDashActions(devs) {
  $('#dashGoMachines')?.addEventListener('click', () => go('devices'));
  $('#dashGoLogs')?.addEventListener('click', () => go('logs'));
  $('#dashGoUsers')?.addEventListener('click', () => go('users'));
  $('#heroDayPass')?.addEventListener('click', () => dayPassModal(devs));
  $('#heroQuickUnlock')?.addEventListener('click', () => quickUnlockModal(devs));
  $('#heroAnalytics')?.addEventListener('click', () => go('analytics'));
  const bb = $('#dashBookingsBanner');
  if (bb) bb.addEventListener('click', () => go('bookings'));

  content.querySelectorAll('[data-extend]').forEach((b) => {
    b.onclick = async () => {
      const who = b.dataset.ename || 'user ' + b.dataset.extend;
      const ok = await confirmDialog({
        title: 'Extend Member Access',
        message: `Extend “${who}” (#${b.dataset.extend}) by 30 days on all their machines?`,
        confirmText: 'Extend 30 Days'
      });
      if (!ok) return;
      toast('Extending access…');
      const r = await api.post('/expiring/extend', { employeeNo: b.dataset.extend, name: b.dataset.ename || undefined, days: 30 });
      const fails = (r.results || []).filter((x) => !x.ok);
      toast(r.ok
        ? (fails.length ? `Extended, but failed on ${fails.map((f) => f.device).join(', ')}` : `Extended to ${(r.newEnd || '').replace('T', ' ').slice(0, 16)}`)
        : `Failed: ${r.error || 'error'}`, r.ok && !fails.length ? 'ok' : 'err');
      dashboard();
    };
  });

  const ua = $('#dashUnlockAll');
  if (ua) {
    ua.onclick = async () => {
      const ok = await confirmDialog({
        title: 'Fleet Door Unlock',
        message: `Unlock the door on ALL ${devs.length} machine${devs.length === 1 ? '' : 's'} now?`,
        confirmText: 'Unlock All Doors',
        danger: true
      });
      if (!ok) return;
      toast('Unlocking all doors…');
      const r = await api.post('/devices/door', { cmd: 'open' });
      const failed = (r.results || []).filter((x) => !x.ok);
      toast(failed.length ? `Unlocked ${r.okCount}/${r.total}` : `Unlocked all ${r.okCount}`, failed.length ? 'err' : 'ok');
    };
  }

  content.querySelectorAll('[data-dash-unlock]').forEach((b) => {
    b.onclick = async () => {
      const ok = await confirmDialog({
        title: 'Unlock Door',
        message: 'Unlock the door on this machine now?',
        confirmText: 'Unlock Door'
      });
      if (!ok) return;
      toast('Unlocking…');
      const r = await api.post(`/devices/${b.dataset.dashUnlock}/door`, { cmd: 'open' });
      toast(r.ok ? 'Door unlocked' : `Failed: ${r.error || 'error'}`, r.ok ? 'ok' : 'err');
    };
  });
}

// ---- Devices ----
async function devices() {
  // Live view: machine online/offline status refreshes on its own.
  clearInterval(_autoTimer);
  _autoTimer = setInterval(() => {
    if (current === 'devices' && $('#modalBackdrop').hidden) devices();
  }, 30000);
  if (!content.querySelector('table') && !content.querySelector('.devices-kpi-grid')) {
    content.innerHTML = skeletonTable(['Name', 'Address', 'Model', 'Status', ''], 4);
  }
  const list = await api.get('/devices');
  if (Array.isArray(list)) _cmdCachedDevs = list;
  if (current !== 'devices') return; // view changed while loading

  $('#viewActions').innerHTML =
    (dashRole === 'admin' ? '<button class="btn" id="addMachine">+ Add machine</button>' : '') +
    (list.length ? '<button class="btn" id="syncTimeAll">Sync time</button><button class="btn primary" id="unlockAll">Unlock all doors</button>' : '');
  $('#addMachine')?.addEventListener('click', () => deviceModal(null, list));
  const syncTimeBtn = $('#syncTimeAll');
  if (syncTimeBtn) syncTimeBtn.addEventListener('click', async () => {
    const onlineDevs = list.filter((d) => d.online);
    if (!onlineDevs.length) {
      toast('No machines are currently online', 'err');
      return;
    }
    const ok = await confirmDialog({
      title: 'Synchronize Machine Clocks',
      message: `Sync the internal RTC clock on ${onlineDevs.length} online machine${onlineDevs.length === 1 ? '' : 's'} to match server time?\n\nThis ensures room bookings, access schedules, and event timestamps match exactly.`,
      confirmText: 'Sync Clocks',
    });
    if (!ok) return;
    toast('Synchronizing machine clocks…');
    try {
      const r = await api.post('/devices/time-sync-all');
      if (r?.ok) {
        if (r.failed > 0) {
          toast(`Synced ${r.synced}/${r.total} machines — ${r.failed} failed`, 'err');
        } else {
          toast(`All ${r.synced} machine clock${r.synced === 1 ? '' : 's'} synchronized`, 'ok');
        }
      } else {
        toast(`Sync failed: ${r?.error || 'error'}`, 'err');
      }
    } catch (err) {
      toast(`Sync failed: ${err.message || 'error'}`, 'err');
    }
  });
  const unlockAllBtn = $('#unlockAll');
  if (unlockAllBtn) unlockAllBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'Fleet Door Unlock',
      message: `Unlock the door on ALL ${list.length} machine${list.length === 1 ? '' : 's'} now?`,
      confirmText: 'Unlock All Doors',
      danger: true
    });
    if (!ok) return;
    toast('Unlocking all doors…');
    const r = await api.post('/devices/door', { cmd: 'open' });
    const failed = (r.results || []).filter((x) => !x.ok);
    toast(
      failed.length ? `Unlocked ${r.okCount}/${r.total} — failed: ${failed.map((f) => f.device).join(', ')}` : `Unlocked all ${r.okCount} door${r.okCount === 1 ? '' : 's'}`,
      failed.length ? (r.okCount ? '' : 'err') : 'ok'
    );
  });

  content.innerHTML = '';
  if (!list.length) {
    content.appendChild(el('<div class="empty">No machines. Machines are provisioned in the database — add them via <code>data/machines.json</code> or a direct INSERT into <code>devices</code>, then restart.</div>'));
    return;
  }

  // Calculate fleet metrics
  const total = list.length;
  const onlineCount = list.filter((d) => d.online).length;
  const offlineCount = total - onlineCount;
  const isEntrance = (d) =>
    (d.grp && d.grp.toLowerCase().includes('entrance')) ||
    d.name.toLowerCase().includes('entrance') ||
    d.name.toLowerCase().includes('lift');
  const isMeeting = (d) =>
    d.name.toLowerCase().includes('meeting') ||
    d.name.toLowerCase().includes('conferance') ||
    d.name.toLowerCase().includes('conference');
  const entranceCount = list.filter(isEntrance).length;
  const meetingCount = list.filter(isMeeting).length;
  const officeCount = Math.max(0, total - entranceCount - meetingCount);

  // Filter machines based on selected chip and search query
  const getFilteredList = () => {
    return list.filter((d) => {
      if (_deviceFilter === 'online' && !d.online) return false;
      if (_deviceFilter === 'offline' && d.online) return false;
      if (_deviceFilter === 'entrances' && !isEntrance(d)) return false;
      if (_deviceFilter === 'meetings' && !isMeeting(d)) return false;
      if (_deviceFilter === 'offices' && (isEntrance(d) || isMeeting(d))) return false;

      if (_deviceSearch) {
        const q = _deviceSearch.toLowerCase();
        const s = `${d.name} ${d.host} ${d.port} ${d.model || ''} ${d.serial || ''} ${d.code || ''} ${d.location || ''} ${d.grp || ''}`.toLowerCase();
        if (!s.includes(q)) return false;
      }
      return true;
    });
  };

  const container = el(`<div>
    <div class="devices-kpi-grid">
      <div class="stat good">
        <div class="stat-head"><span class="label">Total Fleet</span><div class="stat-icon">${ICONS.machine}</div></div>
        <div class="value">${total}</div>
        <div class="sub">Provisioned access points</div>
      </div>
      <div class="stat ${onlineCount > 0 ? 'good' : 'bad'}">
        <div class="stat-head"><span class="label">Network Status</span><div class="stat-icon">${ICONS.zap}</div></div>
        <div class="value">${onlineCount} <small style="font-size:14px;font-weight:500;color:var(--text-muted)">/ ${total} Online</small></div>
        <div class="sub">${onlineCount === total ? 'All systems nominal' : `${offlineCount} terminal${offlineCount === 1 ? '' : 's'} unreachable`}</div>
      </div>
      <div class="stat">
        <div class="stat-head"><span class="label">Main Entrances</span><div class="stat-icon">${ICONS.unlock}</div></div>
        <div class="value">${entranceCount}</div>
        <div class="sub">Cargo lifts & turnstiles</div>
      </div>
      <div class="stat">
        <div class="stat-head"><span class="label">Meeting Rooms</span><div class="stat-icon">${ICONS.clock}</div></div>
        <div class="value">${meetingCount}</div>
        <div class="sub">Conference & shared suites</div>
      </div>
    </div>

    <div class="devices-toolbar">
      <div class="devices-filters" id="deviceFilterBar">
        <button class="filter-chip ${_deviceFilter === 'all' ? 'active' : ''}" data-dfilter="all">All <span class="chip-count">${total}</span></button>
        <button class="filter-chip ${_deviceFilter === 'online' ? 'active' : ''}" data-dfilter="online">Online <span class="chip-count">${onlineCount}</span></button>
        <button class="filter-chip ${_deviceFilter === 'offline' ? 'active' : ''}" data-dfilter="offline">Offline <span class="chip-count">${offlineCount}</span></button>
        <button class="filter-chip ${_deviceFilter === 'entrances' ? 'active' : ''}" data-dfilter="entrances">Entrances <span class="chip-count">${entranceCount}</span></button>
        <button class="filter-chip ${_deviceFilter === 'meetings' ? 'active' : ''}" data-dfilter="meetings">Meeting Rooms <span class="chip-count">${meetingCount}</span></button>
        <button class="filter-chip ${_deviceFilter === 'offices' ? 'active' : ''}" data-dfilter="offices">Offices <span class="chip-count">${officeCount}</span></button>
      </div>
      <div class="devices-search-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input type="text" id="deviceSearchInput" class="devices-search-input" placeholder="Search by name, room, IP..." value="${esc(_deviceSearch)}" />
        <button class="devices-search-clear" id="deviceSearchClear" style="display:${_deviceSearch ? 'block' : 'none'}">✕</button>
      </div>
    </div>

    <div class="table-wrapper" id="devicesTableWrapper"></div>
  </div>`);

  content.appendChild(container);

  const renderTableRows = () => {
    const filtered = getFilteredList();
    const tableWrapper = $('#devicesTableWrapper');
    if (!tableWrapper) return;

    if (!filtered.length) {
      tableWrapper.innerHTML = renderEmptyState({
        icon: 'devices',
        title: 'No matching machines',
        message: _deviceSearch
          ? `No terminals matched "${esc(_deviceSearch)}" with filter "${esc(_deviceFilter)}".`
          : `No machines found under filter "${esc(_deviceFilter)}".`,
        actionText: 'Reset search & filters',
        onAction: () => {
          _deviceSearch = '';
          _deviceFilter = 'all';
          const inp = $('#deviceSearchInput');
          if (inp) inp.value = '';
          const clr = $('#deviceSearchClear');
          if (clr) clr.style.display = 'none';
          $('#deviceFilterBar')?.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c.dataset.dfilter === 'all'));
          renderTableRows();
        },
      });
      return;
    }

    const rows = filtered.map((d) => `
      <tr id="dev-row-${d.id}">
        <td>
          <div style="display:flex;align-items:center;gap:10px;">
            <span class="status-dot ${d.online ? 'on' : 'off'}"></span>
            <div>
              <b>${esc(d.name)}</b>
              ${d.grp ? `<span class="badge" style="margin-left:4px;">${esc(d.grp)}</span>` : ''}
              ${d.code ? `<span class="badge admin" style="margin-left:4px;">room ${esc(d.code)}</span>` : ''}
              ${d.location ? `<br><small class="hint">${esc(d.location)}</small>` : ''}
            </div>
          </div>
        </td>
        <td class="nowrap" style="font-family:monospace;font-size:12.5px;">
          ${esc(d.host)}:${d.port}
          ${d.use_https ? ' <span class="badge" style="font-size:10px;padding:1px 5px;">https</span>' : ''}
        </td>
        <td>
          <b>${esc(d.model || '—')}</b>
          ${d.serial ? `<br><small class="hint" style="font-family:monospace;font-size:11px;">${esc(d.serial)}</small>` : ''}
        </td>
        <td>
          <span class="badge ${d.online ? 'online' : 'offline'}">${d.online ? 'Online' : 'Offline'}</span>
        </td>
        <td class="row-actions">
          <button class="btn sm" data-open="${d.id}" title="Unlock door now">${ICONS.unlock} Unlock</button>
          <button class="btn sm" data-test="${d.id}" title="Test connection">${ICONS.zap} Test</button>
          <button class="btn sm" data-dev-menu="${d.id}" title="More machine actions" style="padding:5px 9px;font-weight:bold;">•••</button>
        </td>
      </tr>`).join('');

    tableWrapper.innerHTML = `<table><thead><tr>
        <th>Name</th><th>Address</th><th>Model</th><th>Status</th><th style="width:230px;"></th>
      </tr></thead><tbody>${rows}</tbody></table>`;

    // Wire up row buttons
    tableWrapper.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => {
      const dev = list.find((d) => d.id == b.dataset.open);
      const ok = await confirmDialog({
        title: 'Unlock Door',
        message: `Unlock the door on ${dev?.name || 'this machine'} now?`,
        confirmText: 'Unlock Door'
      });
      if (!ok) return;
      toast('Unlocking…');
      const r = await api.post(`/devices/${b.dataset.open}/door`, { cmd: 'open' });
      toast(r.ok ? 'Door unlocked' : `Failed: ${r.error || 'error'}`, r.ok ? 'ok' : 'err');
    }));

    tableWrapper.querySelectorAll('[data-test]').forEach((b) => b.addEventListener('click', async () => {
      const origText = b.innerHTML;
      b.disabled = true;
      b.textContent = 'Testing…';
      toast('Testing connection…');
      try {
        const r = await api.post(`/devices/${b.dataset.test}/test`);
        toast(r?.ok ? `Connected: ${r.info?.model || 'ok'}` : `Failed: ${r?.error || 'unreachable'}`, r?.ok ? 'ok' : 'err');
      } catch (err) {
        toast(`Failed: ${err.message || 'connection error'}`, 'err');
      } finally {
        b.disabled = false;
        b.innerHTML = origText;
        devices();
      }
    }));

    tableWrapper.querySelectorAll('[data-dev-menu]').forEach((b) => b.addEventListener('click', () => {
      const dev = list.find((d) => d.id == b.dataset.devMenu);
      if (!dev) return;
      const items = [
        ['Sync Time', async () => {
          toast(`Syncing time on ${dev.name}…`);
          try {
            const r = await api.post(`/devices/${dev.id}/time-sync`);
            if (r?.ok) {
              toast(`Time synced: ${r.message || 'ok'}`, 'ok');
            } else {
              toast(`Failed: ${r?.error || 'unreachable'}`, 'err');
            }
          } catch (err) {
            toast(`Failed: ${err.message || 'error'}`, 'err');
          }
        }],
        ['Book Slot', () => bookSlotModal(dev, list)],
        ['Enrolled Users', async () => {
          toast('Fetching users from machine…');
          const r = await api.get(`/devices/${dev.id}/users`);
          if (!r.ok) { toast(`Failed: ${r.error || 'error'}`, 'err'); return; }
          toast(`${r.total} user${r.total === 1 ? '' : 's'} on device`, 'ok');
          usersModal(dev, r.users, list);
        }],
      ];
      if (dashRole === 'admin') {
        items.push(['Edit Configuration', () => deviceModal(dev, list)]);
        items.push(['Delete Machine', async () => {
          const ok = await confirmDialog({
            title: 'Delete Machine',
            message: `Delete ${dev.name} from the dashboard? It will no longer be monitored.`,
            confirmText: 'Delete Machine',
            danger: true
          });
          if (!ok) return;
          await api.del(`/devices/${dev.id}`);
          devices();
        }, true]);
      }
      showRowMenu(b, items);
    }));
  };

  renderTableRows();

  // Wire up filter chips
  $('#deviceFilterBar')?.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $('#deviceFilterBar')?.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      _deviceFilter = chip.dataset.dfilter || 'all';
      renderTableRows();
    });
  });

  // Wire up search input
  $('#deviceSearchInput')?.addEventListener('input', (e) => {
    _deviceSearch = e.target.value;
    const clr = $('#deviceSearchClear');
    if (clr) clr.style.display = _deviceSearch ? 'block' : 'none';
    renderTableRows();
  });

  $('#deviceSearchClear')?.addEventListener('click', () => {
    _deviceSearch = '';
    const inp = $('#deviceSearchInput');
    if (inp) { inp.value = ''; inp.focus(); }
    const clr = $('#deviceSearchClear');
    if (clr) clr.style.display = 'none';
    renderTableRows();
  });

  // Kick a live reachability check (works on Vercel too — no background jobs
  // needed there); refresh the list only if any machine changed state.
  api.post('/online-check').then((r) => {
    showCloudBlockedBar(!!r?.blocked);
    if (r?.blocked) {
      content.querySelectorAll('span.badge.online').forEach((b) => {
        b.className = 'badge offline';
        b.textContent = 'Offline';
      });
      if (Array.isArray(_cmdCachedDevs)) {
        _cmdCachedDevs.forEach((d) => (d.online = 0));
      }
    }
    if (r?.ok && r.changed && current === 'devices' && !document.querySelector('#modalBackdrop:not([hidden])')) devices();
  }).catch(() => { });
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
      const ok = await confirmDialog({
        title: 'Delete User from Machine',
        message: `Delete “${b.dataset.uname || 'user ' + b.dataset.del}” from ${srcDev.name}?`,
        confirmText: 'Delete User',
        danger: true
      });
      if (!ok) return;
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
let _userViewMode = localStorage.getItem('wn_user_view_mode') || 'table';
let _userSearchQuery = '';
let _userActiveFilter = 'all';

async function users() {
  if (!content.querySelector('#u_table')) {
    content.innerHTML = `
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px">
        <span class="skel-cell" style="width:140px;height:34px;border-radius:8px"></span>
        <span class="skel-cell" style="width:90px;height:34px;border-radius:8px"></span>
        <span class="skel-cell" style="width:90px;height:34px;border-radius:8px"></span>
      </div>
      <div id="u_table">${skeletonTable(['Emp #', 'Name', 'Room', 'Role', 'Machines', 'Valid until', 'Credentials', ''], 6)}</div>`;
  }
  const devs = await api.get('/devices');
  if (current !== 'users') return; // view changed while loading
  $('#viewActions').innerHTML = '';
  content.innerHTML = '';
  if (!devs.length) { content.appendChild(el('<div class="empty">No machines yet. Provision a machine in the database first.</div>')); return; }
  if (_usersDevId !== 'all' && !devs.find((d) => d.id == _usersDevId)) _usersDevId = 'all';

  content.appendChild(el(`
    <div class="users-toolbar">
      <div class="user-search-wrapper">
        ${ICONS.search}
        <input type="text" id="userLiveSearch" class="user-search-input" value="${esc(_userSearchQuery)}" placeholder="Search by name, employee #, card, or room..." autocomplete="off" />
        <button id="userSearchClear" class="user-search-clear" style="${_userSearchQuery ? '' : 'display:none'}" title="Clear search">✕</button>
      </div>

      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:6px;">
          <label class="hint" style="font-size:12px;">Machine</label>
          <select id="u_dev" style="padding:6px 10px;font-size:12.5px;">
            <option value="all" ${_usersDevId === 'all' ? 'selected' : ''}>All machines</option>
            ${devs.map((d) => `<option value="${d.id}" ${d.id == _usersDevId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
          </select>
        </div>

        <div class="view-toggle-group">
          <button id="userViewTable" class="view-toggle-btn ${_userViewMode === 'table' ? 'active' : ''}" title="Table View">
            ${ICONS.table}
          </button>
          <button id="userViewGrid" class="view-toggle-btn ${_userViewMode === 'grid' ? 'active' : ''}" title="Card Grid View">
            ${ICONS.grid}
          </button>
        </div>

        <button class="btn sm primary" id="u_add">+ Add user</button>
        <button class="btn sm" id="u_daypass">+ Day pass</button>
        <button class="btn sm" id="u_refresh" title="Reload from machines">↻</button>
      </div>
    </div>
  `));
  content.appendChild(el('<div id="u_table"></div>'));

  $('#u_dev').addEventListener('change', (e) => { _usersDevId = e.target.value === 'all' ? 'all' : Number(e.target.value); loadUsersTable(devs); });
  $('#u_refresh').addEventListener('click', () => loadUsersTable(devs));
  $('#u_add').addEventListener('click', () => addUserModal(_usersDevId === 'all' ? devs[0] : devs.find((d) => d.id == _usersDevId), devs, _usersDevId === 'all'));
  $('#u_daypass').addEventListener('click', () => dayPassModal(devs));

  $('#userLiveSearch')?.addEventListener('input', (e) => {
    _userSearchQuery = e.target.value;
    const clr = $('#userSearchClear');
    if (clr) clr.style.display = _userSearchQuery ? '' : 'none';
    window._applyUserFilters?.();
  });

  $('#userSearchClear')?.addEventListener('click', () => {
    _userSearchQuery = '';
    const inp = $('#userLiveSearch');
    if (inp) { inp.value = ''; inp.focus(); }
    const clr = $('#userSearchClear');
    if (clr) clr.style.display = 'none';
    window._applyUserFilters?.();
  });

  $('#userViewTable')?.addEventListener('click', () => {
    _userViewMode = 'table';
    localStorage.setItem('wn_user_view_mode', 'table');
    $('#userViewTable')?.classList.add('active');
    $('#userViewGrid')?.classList.remove('active');
    $('#userTableWrap')?.style.setProperty('display', '');
    $('#userGridWrap')?.style.setProperty('display', 'none');
  });

  $('#userViewGrid')?.addEventListener('click', () => {
    _userViewMode = 'grid';
    localStorage.setItem('wn_user_view_mode', 'grid');
    $('#userViewGrid')?.classList.add('active');
    $('#userViewTable')?.classList.remove('active');
    $('#userTableWrap')?.style.setProperty('display', 'none');
    $('#userGridWrap')?.style.setProperty('display', '');
  });

  loadUsersTable(devs);
}

async function loadUsersTable(devs) {
  const holder = $('#u_table');
  if (!holder) return;
  const all = _usersDevId === 'all';
  holder.innerHTML = skeletonTable(['Emp #', 'Name', 'Room', 'Role', 'Machines', 'Valid until', 'Credentials', '']);

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
        const key = `${u.employeeNo}||${String(u.name || '').trim().toLowerCase()}`;
        if (!map.has(key)) map.set(key, { u, on: [] });
        map.get(key).on.push(d);
      }
    }
    entries = [...map.values()].sort((a, b) =>
      ((b.u.localUIRight ? 1 : 0) - (a.u.localUIRight ? 1 : 0)) ||
      (b.on.length - a.on.length) ||
      ((Number(a.u.employeeNo) || 0) - (Number(b.u.employeeNo) || 0)) ||
      String(a.u.name || '').localeCompare(String(b.u.name || '')));
  } else {
    const srcDev = devs.find((d) => d.id == _usersDevId);
    const r = await api.get(`/devices/${_usersDevId}/users`);
    if (!r.ok) { holder.innerHTML = `<div class="empty">Couldn't reach ${esc(srcDev.name)}: ${esc(r.error || 'error')}</div>`; return; }
    entries = r.users
      .map((u) => ({ u, on: [srcDev] }))
      .sort((a, b) =>
        ((b.u.localUIRight ? 1 : 0) - (a.u.localUIRight ? 1 : 0)) ||
        ((Number(a.u.employeeNo) || 0) - (Number(b.u.employeeNo) || 0)));
  }

  // Populate global cache for Command Palette
  _cmdCachedEntries = entries;
  _cmdCachedUsers = entries.map((e) => e.u);
  _cmdCachedDevs = devs;

  const note = unreachable.length ? `<p class="hint" style="margin:0 0 10px">Unreachable: ${esc(unreachable.join(', '))} — their users are not shown.</p>` : '';
  if (!entries.length) { holder.innerHTML = `${note}<div class="empty">No users found. Click <b>+ Add user</b>.</div>`; return; }

  const nowTime = new Date();
  const isExpired = (u) => u.Valid?.enable === false || (u.Valid?.endTime && new Date(u.Valid.endTime) <= nowTime);
  const hasCard = (u) => (u.numOfCard || 0) > 0;
  const hasBiometric = (u) => (u.numOfFP || 0) > 0 || (u.numOfFace || 0) > 0;

  const rows = [];
  const cards = [];

  entries.forEach(({ u, on }, i) => {
    const creds = [];
    if (u.numOfCard) creds.push(`${u.numOfCard} card`);
    if (u.numOfFP) creds.push(`${u.numOfFP} fp`);
    if (u.numOfFace) creds.push(`${u.numOfFace} face`);
    const end = u.Valid?.endTime ? u.Valid.endTime.replace('T', ' ') : '—';
    const blocked = u.Valid?.enable === false;
    const expired = isExpired(u);
    const admin = !!u.localUIRight;
    const isRoomDev = (d) => d.code && !String(d.grp || '').trim().toLowerCase().startsWith('entrance');
    const totalRooms = devs.filter(isRoomDev).length;
    const tenantRooms = on.filter(isRoomDev);
    const roomList = tenantRooms.map((d) => 'room ' + d.code).join(', ');
    const cardStr = Array.isArray(u.cards) ? u.cards.join(' ') : (u.cardNo || '');

    let roomCell;
    if (!tenantRooms.length) roomCell = '<small class="hint">—</small>';
    else if (totalRooms > 1 && tenantRooms.length >= totalRooms) roomCell = `<span class="badge admin" title="${esc(roomList)}">All rooms (${tenantRooms.length})</span>`;
    else if (tenantRooms.length > 2) roomCell = `<span class="badge admin">room ${esc(tenantRooms[0].code)}</span> <span class="badge admin" title="${esc(roomList)}">+${tenantRooms.length - 1} more</span>`;
    else roomCell = tenantRooms.map((d) => `<span class="badge admin" title="Tenant — has access to this room">room ${esc(d.code)}</span>`).join(' ');

    let machineCell = '';
    if (all) {
      const full = on.map((d) => d.name).join(', ');
      const entr = on.filter((d) => String(d.grp || '').trim().toLowerCase().startsWith('entrance'));
      const totalDevs = devs.length;
      if (totalDevs > 1 && on.length >= totalDevs) {
        machineCell = `<td class="nowrap"><span class="badge" title="${esc(full)}">All machines (${on.length})</span></td>`;
      } else if (on.length <= 2) {
        machineCell = `<td class="nowrap"><small class="hint">${esc(full)}</small></td>`;
      } else {
        const allEntr = entr.length && entr.length === devs.filter((d) => String(d.grp || '').trim().toLowerCase().startsWith('entrance')).length;
        const rest = on.length - (allEntr ? entr.length : 1);
        machineCell = `<td class="nowrap">${allEntr
          ? `<span class="badge">Entrances (${entr.length})</span> <span class="badge" title="${esc(full)}">+${rest} more</span>`
          : `<small class="hint">${esc(on[0].name)}</small> <span class="badge" title="${esc(full)}">+${rest} more</span>`}</td>`;
      }
    }

    // 1. Table Row
    rows.push(`
      <tr class="clickable-row" data-rowidx="${i}" data-emp="${esc(u.employeeNo)}" data-name="${esc(u.name || '')}" data-room="${esc(roomList)}" data-cardno="${esc(cardStr)}" data-hascard="${hasCard(u) ? '1' : '0'}" data-hasbio="${hasBiometric(u) ? '1' : '0'}" data-expired="${expired ? '1' : '0'}" title="View full profile">
        <td style="text-align:center; width:36px;"><input type="checkbox" class="custom-cb user-row-cb" data-cbidx="${i}"></td>
        <td>${copyableBadge(u.employeeNo)}</td>
        <td>
          <div class="user-identity">
            ${renderAvatar(u.name, 'sm')}
            <div class="user-identity-names">
              <a class="link" data-profile="${i}"><b>${esc(u.name || '—')}</b></a>
            </div>
          </div>
        </td>
        <td class="nowrap">${roomCell}</td>
        <td>${admin ? '<span class="badge admin">Admin</span>' : '<span class="badge">User</span>'}</td>
        ${machineCell}
        <td class="nowrap">${blocked ? '<span class="badge blocked">blocked</span>' : expired ? '<span class="badge blocked">expired</span>' : `<small class="hint">${esc(end)}</small>`}</td>
        <td class="creds-cell" data-credidx="${i}" style="cursor:pointer" title="View / manage credentials"><small class="hint"><a class="link" data-cards="${i}">${esc(creds.join(' · ') || 'no credentials — add card')}</a></small></td>
        <td class="row-actions">
          <button class="btn sm" data-menu="${i}">Actions ▾</button>
        </td>
      </tr>
    `);

    // 2. Card View Item
    cards.push(`
      <div class="user-card" data-rowidx="${i}" data-emp="${esc(u.employeeNo)}" data-name="${esc(u.name || '')}" data-room="${esc(roomList)}" data-cardno="${esc(cardStr)}" data-hascard="${hasCard(u) ? '1' : '0'}" data-hasbio="${hasBiometric(u) ? '1' : '0'}" data-expired="${expired ? '1' : '0'}">
        <div class="user-card-head">
          <div class="user-card-id-block">
            <input type="checkbox" class="custom-cb user-row-cb" data-cbidx="${i}">
            ${renderAvatar(u.name, 'md')}
            <div class="user-card-name-wrap">
              <a class="link user-card-name" data-profile="${i}"><b>${esc(u.name || 'User ' + u.employeeNo)}</b></a>
              <div class="user-card-sub">
                ${copyableBadge(u.employeeNo)}
                ${admin ? '<span class="badge admin" style="font-size:10px;">Admin</span>' : '<span class="badge" style="font-size:10px;">Member</span>'}
              </div>
            </div>
          </div>
          <span class="badge ${blocked || expired ? 'blocked' : 'synced'}" style="font-size:10px;">
            ${blocked ? 'Blocked' : expired ? 'Expired' : 'Active'}
          </span>
        </div>

        <div class="user-card-body">
          <div class="user-card-meta-row">
            <span class="user-card-meta-label">Access / Room:</span>
            <span class="user-card-meta-val">${roomCell}</span>
          </div>
          ${all ? `
            <div class="user-card-meta-row">
              <span class="user-card-meta-label">Machines:</span>
              <span class="user-card-meta-val"><span class="badge" style="font-size:10.5px;">${on.length} door${on.length === 1 ? '' : 's'}</span></span>
            </div>
          ` : ''}
          <div class="user-card-meta-row">
            <span class="user-card-meta-label">Credentials:</span>
            <span class="user-card-meta-val"><small class="hint">${esc(creds.join(' · ') || 'None enrolled')}</small></span>
          </div>
          <div class="user-card-meta-row">
            <span class="user-card-meta-label">Valid Until:</span>
            <span class="user-card-meta-val"><small class="hint">${esc(end)}</small></span>
          </div>
        </div>

        <div class="user-card-footer">
          <div style="display:flex;gap:6px;">
            <button class="btn sm" data-profile="${i}" title="View profile">Profile</button>
            <button class="btn sm" data-cards="${i}" title="Manage cards">Cards</button>
          </div>
          <button class="btn sm" data-menu="${i}">Actions ▾</button>
        </div>
      </div>
    `);
  });

  const countAll = entries.length;
  const countActive = entries.filter((e) => !isExpired(e.u)).length;
  const countExpired = entries.filter((e) => isExpired(e.u)).length;
  const countCards = entries.filter((e) => hasCard(e.u)).length;
  const countNoCard = entries.filter((e) => !hasCard(e.u)).length;
  const countBiometric = entries.filter((e) => hasBiometric(e.u)).length;
  const countNoCreds = entries.filter((e) => !hasCard(e.u) && !hasBiometric(e.u)).length;

  const filterBarHtml = `
    <div class="filter-bar" id="userFilterBar" style="margin-bottom:10px;">
      <button class="filter-chip ${_userActiveFilter === 'all' ? 'active' : ''}" data-ufilter="all">All <span class="chip-count">${countAll}</span></button>
      <button class="filter-chip ${_userActiveFilter === 'active' ? 'active' : ''}" data-ufilter="active">Active <span class="chip-count">${countActive}</span></button>
      <button class="filter-chip ${_userActiveFilter === 'expired' ? 'active' : ''}" data-ufilter="expired">Expired <span class="chip-count">${countExpired}</span></button>
      <button class="filter-chip ${_userActiveFilter === 'cards' ? 'active' : ''}" data-ufilter="cards">With Cards <span class="chip-count">${countCards}</span></button>
      <button class="filter-chip ${_userActiveFilter === 'nocard' ? 'active' : ''}" data-ufilter="nocard">Missing Card <span class="chip-count">${countNoCard}</span></button>
      <button class="filter-chip ${_userActiveFilter === 'biometric' ? 'active' : ''}" data-ufilter="biometric">Biometrics Enrolled <span class="chip-count">${countBiometric}</span></button>
      <button class="filter-chip ${_userActiveFilter === 'nocreds' ? 'active' : ''}" data-ufilter="nocreds">No Credentials <span class="chip-count">${countNoCreds}</span></button>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding:0 2px;">
      <span class="hint tabular-nums" id="userMatchCount" style="font-size:12px;">Showing ${countAll} of ${countAll} members</span>
    </div>
  `;

  const dockHtml = `
    <div class="floating-action-dock" id="floatingActionDock">
      <div class="dock-counter"><span class="dock-counter-dot"></span> <b id="dockSelectedCount">0</b> selected</div>
      <div class="dock-divider"></div>
      <button class="dock-btn primary" id="dockExtendBtn">${ICONS.clock} Extend 30 Days</button>
      <button class="dock-btn" id="dockExportBtn">${ICONS.download} Export CSV</button>
      <div class="dock-divider"></div>
      <button class="dock-btn ghost" id="dockClearBtn">Clear</button>
    </div>
  `;

  holder.innerHTML = `
    ${note}
    ${filterBarHtml}
    <div id="consistencyNote"></div>
    <div id="userEmptyNotice" style="display:none;"></div>
    <div id="userTableWrap" class="table-wrapper" style="${_userViewMode === 'grid' ? 'display:none' : ''}">
      <table>
        <thead>
          <tr>
            <th style="width:36px; text-align:center;"><input type="checkbox" id="userSelectAll" class="custom-cb" title="Select all users"></th>
            <th>Emp #</th>
            <th>Name</th>
            <th>Room</th>
            <th>Role</th>
            ${all ? '<th>Machines</th>' : ''}
            <th>Valid until</th>
            <th>Credentials</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.join('')}
        </tbody>
      </table>
    </div>
    <div id="userGridWrap" class="user-cards-grid" style="${_userViewMode === 'table' ? 'display:none' : ''}">
      ${cards.join('')}
    </div>
    ${dockHtml}
  `;

  const _selectedUserIndices = new Set();
  const dock = $('#floatingActionDock');
  const countEl = $('#dockSelectedCount');
  const selectAllCb = $('#userSelectAll');

  const updateDock = () => {
    const count = _selectedUserIndices.size;
    if (countEl) countEl.textContent = count;
    if (dock) {
      if (count > 0) dock.classList.add('visible');
      else dock.classList.remove('visible');
    }
    if (selectAllCb) {
      const visibleRows = holder.querySelectorAll('tbody tr:not([style*="display: none"])');
      const checkedVisible = holder.querySelectorAll('tbody tr:not([style*="display: none"]) .user-row-cb:checked');
      selectAllCb.checked = visibleRows.length > 0 && checkedVisible.length === visibleRows.length;
    }
  };

  const applyUserFilters = () => {
    const q = (_userSearchQuery || '').trim().toLowerCase();
    const filter = _userActiveFilter;
    let matchCount = 0;

    const checkMatch = (el) => {
      const emp = (el.dataset.emp || '').toLowerCase();
      const nm = (el.dataset.name || '').toLowerCase();
      const rm = (el.dataset.room || '').toLowerCase();
      const cardno = (el.dataset.cardno || '').toLowerCase();
      const hascard = el.dataset.hascard === '1';
      const hasbio = el.dataset.hasbio === '1';
      const expired = el.dataset.expired === '1';

      if (q) {
        const match = emp.includes(q) || nm.includes(q) || rm.includes(q) || cardno.includes(q);
        if (!match) return false;
      }

      if (filter === 'active') return !expired;
      if (filter === 'expired') return expired;
      if (filter === 'cards') return hascard;
      if (filter === 'nocard') return !hascard;
      if (filter === 'biometric') return hasbio;
      if (filter === 'nocreds') return !hascard && !hasbio;
      return true;
    };

    holder.querySelectorAll('tbody tr[data-rowidx]').forEach((tr) => {
      const match = checkMatch(tr);
      tr.style.display = match ? '' : 'none';
      if (match) matchCount++;
    });

    holder.querySelectorAll('.user-cards-grid .user-card').forEach((card) => {
      const match = checkMatch(card);
      card.style.display = match ? '' : 'none';
    });

    const matchEl = $('#userMatchCount');
    if (matchEl) {
      matchEl.textContent = `Showing ${matchCount} of ${entries.length} members${q ? ` for "${q}"` : ''}`;
    }

    const emptyNotice = $('#userEmptyNotice');
    const tableWrap = $('#userTableWrap');
    const gridWrap = $('#userGridWrap');
    if (emptyNotice) {
      if (matchCount === 0) {
        emptyNotice.innerHTML = renderEmptyState({
          icon: 'user',
          title: 'No members found',
          message: q
            ? `No members matched "${esc(q)}" with active filter "${esc(filter)}".`
            : `No members found matching filter "${esc(filter)}".`,
          actionText: 'Reset search & filters',
          onAction: () => {
            _userSearchQuery = '';
            const inp = $('#userLiveSearch');
            if (inp) inp.value = '';
            const clr = $('#userSearchClear');
            if (clr) clr.style.display = 'none';
            _userActiveFilter = 'all';
            $('#userFilterBar')?.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c.dataset.ufilter === 'all'));
            applyUserFilters();
          },
        });
        emptyNotice.style.display = '';
        if (tableWrap) tableWrap.style.display = 'none';
        if (gridWrap) gridWrap.style.display = 'none';
      } else {
        emptyNotice.innerHTML = '';
        emptyNotice.style.display = 'none';
        if (tableWrap) tableWrap.style.display = _userViewMode === 'grid' ? 'none' : '';
        if (gridWrap) gridWrap.style.display = _userViewMode === 'table' ? 'none' : '';
      }
    }

    updateDock();
  };

  window._applyUserFilters = applyUserFilters;
  applyUserFilters();

  holder.querySelectorAll('.user-row-cb').forEach((cb) => {
    cb.addEventListener('change', (ev) => {
      ev.stopPropagation();
      const idx = Number(cb.dataset.cbidx);
      const isChecked = cb.checked;
      if (isChecked) {
        _selectedUserIndices.add(idx);
      } else {
        _selectedUserIndices.delete(idx);
      }
      holder.querySelectorAll(`[data-cbidx="${idx}"]`).forEach((input) => { input.checked = isChecked; });
      holder.querySelectorAll(`[data-rowidx="${idx}"]`).forEach((el) => {
        if (isChecked) el.classList.add(el.tagName === 'TR' ? 'selected-row' : 'selected-card');
        else el.classList.remove(el.tagName === 'TR' ? 'selected-row' : 'selected-card');
      });
      updateDock();
    });
  });

  if (selectAllCb) {
    selectAllCb.addEventListener('change', () => {
      const check = selectAllCb.checked;
      holder.querySelectorAll('tbody tr').forEach((tr) => {
        if (tr.style.display === 'none') return;
        const idx = Number(tr.dataset.rowidx);
        if (check) _selectedUserIndices.add(idx);
        else _selectedUserIndices.delete(idx);
        holder.querySelectorAll(`[data-cbidx="${idx}"]`).forEach((input) => { input.checked = check; });
        holder.querySelectorAll(`[data-rowidx="${idx}"]`).forEach((el) => {
          if (check) el.classList.add(el.tagName === 'TR' ? 'selected-row' : 'selected-card');
          else el.classList.remove(el.tagName === 'TR' ? 'selected-row' : 'selected-card');
        });
      });
      updateDock();
    });
  }

  $('#dockClearBtn')?.addEventListener('click', () => {
    _selectedUserIndices.clear();
    holder.querySelectorAll('.user-row-cb').forEach((cb) => { cb.checked = false; });
    holder.querySelectorAll('[data-rowidx]').forEach((el) => {
      el.classList.remove('selected-row', 'selected-card');
    });
    if (selectAllCb) selectAllCb.checked = false;
    updateDock();
  });

  $('#dockExtendBtn')?.addEventListener('click', async () => {
    const selected = [..._selectedUserIndices].map((i) => entries[i]).filter(Boolean);
    if (!selected.length) return;
    const ok = await confirmDialog({
      title: 'Extend Selected Access',
      message: `Extend access by 30 days for ${selected.length} selected member${selected.length === 1 ? '' : 's'} on all their provisioned machines?`,
      confirmText: `Extend ${selected.length} Members`
    });
    if (!ok) return;
    toast(`Extending access for ${selected.length} member(s)…`);
    let successCount = 0;
    for (const it of selected) {
      try {
        const r = await api.post('/expiring/extend', { employeeNo: it.u.employeeNo, name: it.u.name || undefined, days: 30 });
        if (r.ok) successCount++;
      } catch { }
    }
    toast(`Successfully extended ${successCount} of ${selected.length} members`, successCount ? 'ok' : 'err');
    loadUsersTable(devs);
  });

  $('#dockExportBtn')?.addEventListener('click', () => {
    const selected = _selectedUserIndices.size > 0
      ? [..._selectedUserIndices].map((i) => entries[i]).filter(Boolean)
      : entries;
    exportUsersCsv(selected);
  });

  holder.querySelectorAll('#userFilterBar .filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      holder.querySelectorAll('#userFilterBar .filter-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      _userActiveFilter = chip.dataset.ufilter || 'all';
      applyUserFilters();
    });
  });

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
      // Only the machines actually missing the credential are visited; the
      // union is still computed from every machine so nothing is missed.
      const allIds = (iss.missing_ids && iss.missing_ids.length) ? iss.missing_ids : devs.map((d) => d.id);
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
  }).catch(() => { });

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
      ...(dashRole === 'admin' ? [[admin ? 'Change role: Admin → User' : 'Change role: User → Admin', () => setRole(e.on, e.u.employeeNo, admin ? 'user' : 'admin', devs)]] : []),
      ['Tag card', () => tagCard(e, devs)],
      ['Capture fingerprint', () => captureFpModal(e, devs)],
      e.u.numOfFace ? ['Delete face', () => deleteFaceAction(e, devs), true] : ['Enroll face', () => enrollFace(e, devs)],
      ...(dashRole === 'admin' ? [['Copy to machine…', () => copyUserModal(e.on[0], e.u.employeeNo, e.u.name || '', devs, entries.map((x) => x.u))]] : []),
      ['Delete user', () => deleteUser(e.on, e.u.employeeNo, e.u.name || '', devs), true],
    ]);
  }));
  holder.querySelectorAll('[data-cards]').forEach((b) => b.addEventListener('click', (ev) => { ev.preventDefault(); userCardsModal(entries[Number(b.dataset.cards)], devs); }));
  // The whole credentials cell (including the 'differs' badge and padding)
  // opens the credentials manager — not the profile.
  holder.querySelectorAll('td.creds-cell').forEach((td) => td.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (ev.target.closest('a')) return; // the link handler already fired
    userCardsModal(entries[Number(td.dataset.credidx)], devs);
  }));
}

async function deleteFaceAction(e, devs) {
  const where = e.on.map((d) => d.name).join(', ');
  const ok = await confirmDialog({
    title: 'Delete Face Photo',
    message: `Delete the face of “${e.u.name || 'user ' + e.u.employeeNo}” from: ${where}?\n\nTheir fingerprints, cards and profile stay — only face recognition stops working.`,
    confirmText: 'Delete Face',
    danger: true
  });
  if (!ok) return;
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
  const ok = await confirmDialog({
    title: 'Delete User from Fleet',
    message: `Delete “${name || 'user ' + employeeNo}” (#${employeeNo}) from: ${where}? This removes them from the machine${devsOn.length > 1 ? 's' : ''}.`,
    confirmText: 'Delete User',
    danger: true
  });
  if (!ok) return;
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
    <div class="field" id="up_body" style="padding: 6px 0;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin:8px 0 10px;">
        <span style="font-size:12.5px;font-weight:600;display:flex;align-items:center;gap:7px;color:var(--text, #f1f5f9);">
          <span class="status-dot on" style="width:7px;height:7px;background:#38bdf8;box-shadow:0 0 8px rgba(56,189,248,0.7);"></span>
          Querying profile & credentials from machines…
        </span>
        <span class="hint" style="font-size:11px;">Please wait</span>
      </div>
      <div class="loading-bar-container" style="height:6px;margin:0 0 16px 0;box-shadow:0 0 10px rgba(99,102,241,0.25);">
        <div class="loading-bar-indeterminate"></div>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:14px;">
        <span class="skel-cell" style="flex:1;height:38px;border-radius:8px;"></span>
        <span class="skel-cell" style="flex:1;height:38px;border-radius:8px;"></span>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <span class="skel-cell" style="width:100%;height:32px;border-radius:6px;opacity:0.85;"></span>
        <span class="skel-cell" style="width:100%;height:32px;border-radius:6px;opacity:0.65;"></span>
        <span class="skel-cell" style="width:100%;height:32px;border-radius:6px;opacity:0.45;"></span>
      </div>
    </div>
    <div class="modal-actions"><button class="btn" id="up_close">Close</button></div>`);
  $('#up_close').addEventListener('click', closeModal);
  const r = await api.get(`/profile?employeeNo=${encodeURIComponent(u.employeeNo)}&name=${encodeURIComponent(u.name || '')}`);
  const body = $('#up_body');
  if (!body) return;
  if (!r.ok) { body.innerHTML = `<span class="muted">Failed: ${esc(r.error || 'error')}</span>`; return; }

  let maxFP = 0;
  let maxFace = 0;
  const cardsSet = new Set();
  let accessCount = 0;

  for (const m of r.machines) {
    if (m.present && m.enabled) accessCount++;
    if (m.numOfFP) maxFP = Math.max(maxFP, m.numOfFP);
    if (m.numOfFace) maxFace = Math.max(maxFace, m.numOfFace);
    if (Array.isArray(m.cards)) {
      for (const c of m.cards) cardsSet.add(c);
    }
  }

  const credParts = [];
  if (maxFP) credParts.push(`${maxFP} fingerprint${maxFP === 1 ? '' : 's'}`);
  if (maxFace) credParts.push(`${maxFace} face`);
  if (cardsSet.size) credParts.push(`Card${cardsSet.size === 1 ? '' : 's'}: ${[...cardsSet].join(', ')}`);
  const credsSummary = credParts.length ? credParts.join(' · ') : 'No credentials enrolled';

  const rows = r.machines.map((m) => {
    let dotClass = 'off';
    let statusBadge = '<span class="badge">no access</span>';
    let validStr = '—';

    if (m.present === null) {
      statusBadge = '<span class="badge offline">unreachable</span>';
    } else if (m.present) {
      dotClass = m.enabled ? 'on' : 'off';
      statusBadge = m.enabled ? '<span class="badge synced">has access</span>' : '<span class="badge blocked">blocked</span>';
      if (m.validEnd) {
        validStr = esc(String(m.validEnd).replace('T', ' ').slice(0, 16));
      }
    }

    const roleBadge = m.admin ? '<span class="badge admin">Admin</span>' : '<span class="badge">User</span>';

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="status-dot ${dotClass}"></span>
            <b>${esc(m.device)}</b>
            <small class="hint">${esc(m.host || '')}</small>
          </div>
        </td>
        <td class="nowrap"><small class="hint">${validStr}</small></td>
        <td>${roleBadge}</td>
        <td>${statusBadge}</td>
      </tr>`;
  }).join('');

  body.innerHTML = `
    <div class="profile-tabs">
      <button class="profile-tab-btn active" id="ptab_doors">
        Door Access
      </button>
      <button class="profile-tab-btn" id="ptab_audit">
        Audit & Credential Diffs <span class="profile-tab-count" id="ptab_audit_count">…</span>
      </button>
    </div>

    <div id="pview_doors">
      <div class="profile-summary-bar">
        <div class="psb-item"><span class="psb-label">Credentials:</span> <span class="psb-val">${esc(credsSummary)}</span></div>
        <div class="psb-item"><span class="psb-label">Access:</span> <span class="psb-val">${accessCount} of ${r.machines.length} doors</span></div>
      </div>
      <div class="table-wrapper" style="max-height:340px; overflow-y:auto;">
        <table class="profile-table">
          <thead>
            <tr>
              <th>Machine / Door</th>
              <th>Valid Until</th>
              <th>Role</th>
              <th>Access Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>

    <div id="pview_audit" style="display:none;">
      <div id="ptab_audit_content">
        <div class="empty" style="padding:24px 0;">Loading audit trail and change history…</div>
      </div>
    </div>`;

  let auditLoaded = false;
  const loadUserAudit = async () => {
    if (auditLoaded) return;
    const aContent = $('#ptab_audit_content');
    const aCount = $('#ptab_audit_count');
    if (!aContent) return;
    try {
      const data = await api.get(`/audit-logs?limit=100&employeeNo=${encodeURIComponent(u.employeeNo)}`);
      auditLoaded = true;
      if (!data?.ok || !data.logs || !data.logs.length) {
        if (aCount) aCount.textContent = '0';
        aContent.innerHTML = `<div class="empty" style="padding:24px 0;">No logged credential changes or audit events recorded for this member yet.</div>`;
        return;
      }
      if (aCount) aCount.textContent = String(data.logs.length);
      const itemsHtml = data.logs.map((log, idx) => {
        const diff = parseAuditDiff(log);
        return `
          <div class="diff-timeline-item">
            <div class="diff-timeline-icon">
              ${diff.type === 'access' ? ICONS.machine : diff.type === 'extend' ? ICONS.clock : diff.type === 'card' ? ICONS.card : ICONS.audit}
            </div>
            <div class="diff-timeline-card">
              <div class="diff-timeline-head">
                <div style="display:flex;align-items:center;gap:7px;">
                  <span class="diff-timeline-title">${esc(diff.title)}</span>
                  <span class="badge ${diff.badgeCls}" style="font-size:10px;">${esc(diff.badge)}</span>
                </div>
                <span class="diff-timeline-time tabular-nums">${esc(log.ts)}</span>
              </div>
              <div class="diff-timeline-body">
                <div>${diff.summaryHtml}</div>
              </div>
              <div class="diff-timeline-footer">
                <span>Actor: <b>${esc(log.actor || 'admin')}</b> (${esc(log.ip || '127.0.0.1')})</span>
                <button class="btn sm diff-btn" data-usr-diff="${idx}">Inspect Diff ▾</button>
              </div>
            </div>
          </div>
        `;
      }).join('');

      aContent.innerHTML = `<div class="diff-timeline">${itemsHtml}</div>`;
      aContent.querySelectorAll('[data-usr-diff]').forEach((b) => {
        b.addEventListener('click', () => {
          const l = data.logs[Number(b.dataset.usrDiff)];
          if (l) openVisualDiffModal(l);
        });
      });
    } catch (err) {
      aContent.innerHTML = `<div class="empty" style="padding:20px 0;">Failed to load audit history: ${esc(err?.message || err)}</div>`;
    }
  };

  // Prefetch count in background
  api.get(`/audit-logs?limit=50&employeeNo=${encodeURIComponent(u.employeeNo)}`).then((data) => {
    const aCount = $('#ptab_audit_count');
    if (aCount && data?.ok && Array.isArray(data.logs)) {
      aCount.textContent = String(data.logs.length);
    }
  }).catch(() => { });

  $('#ptab_doors')?.addEventListener('click', () => {
    $('#ptab_doors')?.classList.add('active');
    $('#ptab_audit')?.classList.remove('active');
    $('#pview_doors')?.style.setProperty('display', '');
    $('#pview_audit')?.style.setProperty('display', 'none');
  });

  $('#ptab_audit')?.addEventListener('click', () => {
    $('#ptab_audit')?.classList.add('active');
    $('#ptab_doors')?.classList.remove('active');
    $('#pview_doors')?.style.setProperty('display', 'none');
    $('#pview_audit')?.style.setProperty('display', '');
    loadUserAudit();
  });
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
  const machineOpts = `<option value="all">All their machines (${on.length})</option>` +
    on.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  openModal(`
    <h2>Credentials — ${esc(u.name || 'User ' + u.employeeNo)} <small class="hint">#${esc(u.employeeNo)}</small></h2>
    <p class="hint">On ${on.length} machine${on.length === 1 ? '' : 's'}. Deleting a fingerprint or face from only some machines may be undone by the credential auto-sync copying it back.</p>
    <div class="field"><label>Cards</label><div id="uc_list"><div class="loading-bar-container"><div class="loading-bar-indeterminate"></div></div></div></div>
    <div class="field"><label>Add a card <small class="hint">(typed — attached on every machine this user is on; or use Actions → Tag card)</small></label>
      <div style="display:flex;gap:8px">
        <input id="uc_new" placeholder="e.g. 0012345678" style="flex:1">
        <button class="btn primary" id="uc_add">Attach card</button>
      </div>
    </div>
    <div class="field"><label>Fingerprint <small class="hint">${u.numOfFP ? `${u.numOfFP} enrolled` : 'none enrolled'}</small></label>
      <div style="display:flex;gap:8px">
        <select id="uc_fpdev" style="flex:1">${machineOpts}</select>
        <button class="btn danger" id="uc_fpdel" ${u.numOfFP ? '' : 'disabled'}>Delete fingerprint</button>
      </div>
    </div>
    <div class="field"><label>Face <small class="hint">${u.numOfFace ? 'enrolled' : 'none enrolled'}</small></label>
      <div style="display:flex;gap:8px">
        <select id="uc_facedev" style="flex:1">${machineOpts}</select>
        <button class="btn danger" id="uc_facedel" ${u.numOfFace ? '' : 'disabled'}>Delete face</button>
      </div>
    </div>
    <div class="modal-actions"><button class="btn" id="uc_close">Close</button></div>`);
  $('#uc_close').addEventListener('click', closeModal);
  const chosen = (selId) => {
    const v = $(selId).value;
    return v === 'all' ? on.map((d) => d.id) : [Number(v)];
  };
  $('#uc_fpdel').addEventListener('click', async () => {
    const ids = chosen('#uc_fpdev');
    const where = ids.length === on.length ? 'ALL their machines' : on.find((d) => d.id === ids[0])?.name;
    const ok = await confirmDialog({
      title: 'Delete Fingerprint',
      message: `Delete ${u.name || 'this user'}'s fingerprint from ${where}? They keep cards, face and profile.`,
      confirmText: 'Delete Fingerprint',
      danger: true
    });
    if (!ok) return;
    const chunksF = [];
    for (let i = 0; i < ids.length; i += 8) chunksF.push(ids.slice(i, i + 8));
    const bar = progressBar(ids.length, 'Deleting fingerprint —');
    const fails = [];
    await runBatched(chunksF, async (chunk) => {
      const r = await api.post(`/devices/${srcDev.id}/users/${encodeURIComponent(u.employeeNo)}/delete-fingerprints`, { device_ids: chunk });
      fails.push(...(r.results || []).filter((x) => !x.ok));
      if (!r.ok && !r.results) fails.push({ device: 'request', error: r.error });
    }, bar, 3);
    bar.close();
    toast(!fails.length ? 'Fingerprint deleted' : `Failed on ${fails.map((f) => f.device).join(', ')}`, !fails.length ? 'ok' : 'err');
    if ($('#u_table')) loadUsersTable(devs);
  });
  $('#uc_facedel').addEventListener('click', async () => {
    const ids = chosen('#uc_facedev');
    const where = ids.length === on.length ? 'ALL their machines' : on.find((d) => d.id === ids[0])?.name;
    const ok = await confirmDialog({
      title: 'Delete Face',
      message: `Delete ${u.name || 'this user'}'s face from ${where}? Face recognition stops there; fingerprints, cards and profile stay.`,
      confirmText: 'Delete Face',
      danger: true
    });
    if (!ok) return;
    const chunksFc = [];
    for (let i = 0; i < ids.length; i += 8) chunksFc.push(ids.slice(i, i + 8));
    const bar = progressBar(ids.length, 'Deleting face —');
    const fails = [];
    await runBatched(chunksFc, async (chunk) => {
      const r = await api.post(`/devices/${srcDev.id}/users/${encodeURIComponent(u.employeeNo)}/delete-face`, { device_ids: chunk });
      fails.push(...(r.results || []).filter((x) => !x.ok));
      if (!r.ok && !r.results) fails.push({ device: 'request', error: r.error });
    }, bar, 3);
    bar.close();
    toast(!fails.length ? 'Face deleted' : `Failed on ${fails.map((f) => f.device).join(', ')}`, !fails.length ? 'ok' : 'err');
    if ($('#u_table')) loadUsersTable(devs);
  });
  $('#uc_add').addEventListener('click', async () => {
    const cardNo = $('#uc_new').value.trim();
    if (!cardNo) { toast('Enter a card number', 'err'); return; }
    const bar = progressBar(on.length, `Attaching card ${cardNo} —`);
    const results = [];
    await runBatched(on, async (d) => {
      results.push({ d, r: await api.post(`/devices/${d.id}/users/${encodeURIComponent(u.employeeNo)}/card`, { card_no: cardNo }) });
    }, bar, 6);
    bar.close();
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
    if ($('#uc_list') && !$('#uc_list').querySelector('.loading-bar-container')) {
      $('#uc_list').innerHTML = '<div class="loading-bar-container"><div class="loading-bar-indeterminate"></div></div>';
    }
    const r = await api.get(`/devices/${srcDev.id}/users/${encodeURIComponent(u.employeeNo)}/cards`);
    const cardsList = r.ok ? r.cards : [];
    if (!$('#uc_list')) return;
    $('#uc_list').innerHTML = cardsList.length
      ? `<div class="device-checklist">${cardsList.map((c) => `
          <label style="justify-content:space-between;cursor:default">
            <span style="display:flex;align-items:center;gap:8px;">${copyableBadge(c)}</span>
            <button class="btn sm danger" data-rmcard="${esc(c)}">Remove</button>
          </label>`).join('')}</div>`
      : `<span class="muted">${r.ok ? 'No cards attached to this user.' : `Couldn't read cards: ${esc(r.error || 'error')}`}</span>`;
    $('#uc_list').querySelectorAll('[data-rmcard]').forEach((b) => b.addEventListener('click', async () => {
      const cardNo = b.dataset.rmcard;
      const ok = await confirmDialog({
        title: 'Detach Card',
        message: `Remove card ${cardNo} from ${u.name || 'this user'}?\n\nIt is detached on: ${on.map((d) => d.name).join(', ')}.`,
        confirmText: 'Detach Card',
        danger: true
      });
      if (!ok) return;
      const ids = on.map((d) => d.id);
      const chunks = [];
      for (let i = 0; i < ids.length; i += 8) chunks.push(ids.slice(i, i + 8));
      const bar = progressBar(ids.length, `Removing card ${cardNo} —`);
      const fails = [];
      await runBatched(chunks, async (chunk) => {
        const rr = await api.post('/devices/card/delete', { card_no: cardNo, device_ids: chunk });
        fails.push(...(rr.results || []).filter((x) => !x.ok));
      }, bar, 3);
      bar.close();
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

    const displayName = (m.name && m.name !== m.host) ? m.name : (m.code ? `Machine ${m.code}` : `Machine #${m.device_id}`);
    const hostHint = m.host || '';

    return `<label class="dev-check-item acc-item">
      <input type="checkbox" class="acc-check" value="${m.device_id}" ${hasAccess ? 'checked' : ''} ${m.present === null ? 'disabled' : ''}>
      <div class="dev-info-col">
        <div class="dev-title-line">
          <b class="dev-name">${esc(displayName)}</b>
          ${hostHint ? `<small class="dev-host-hint">${esc(hostHint)}</small>` : ''}
          ${state}
        </div>
      </div>
      <div class="dev-date-actions">
        <input type="datetime-local" class="acc-end" data-dev="${m.device_id}" data-orig="${toLocalInput(m.valid_end)}" value="${toLocalInput(m.valid_end)}" ${m.present === null ? 'disabled' : ''} title="Access until on this machine">
        <button type="button" class="btn sm acc-today" data-dev="${m.device_id}" ${m.present === null ? 'disabled' : ''} title="Access until tonight 23:59">Today</button>
      </div>
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
    // Only machines whose state actually changed need visiting: a ticked box
    // that was unticked (or vice versa), or an edited deadline. Granting one
    // room used to crawl through all 55 machines.
    const wantedSet = new Set(ids);
    const endChanged = new Set();
    document.querySelectorAll('.acc-end').forEach((inp) => {
      if (!inp.disabled && inp.value !== inp.dataset.orig) endChanged.add(Number(inp.dataset.dev));
    });
    const allIds = r.machines.filter((m) => {
      const had = m.present === true && m.enabled !== false;
      const want = wantedSet.has(m.device_id);
      if (m.present === null) return want; // offline: queue a grant only if wanted
      return want !== had || (want && endChanged.has(m.device_id));
    }).map((m) => m.device_id);
    closeModal();
    if (!allIds.length) { toast('No access changes to apply', 'ok'); return; }
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
    }, bar, 4);
    bar.close();
    if (reqError && !results.length) { toast(`Failed: ${reqError}`, 'err'); return; }
    const errs = results.filter((x) => x.state === 'error');
    const queued = results.filter((x) => x.state === 'queued').length;
    const changed = results.filter((x) => ['granted', 'unblocked', 'blocked', 'updated'].includes(x.state)).length;
    const extra = queued ? ` · ${queued} offline queued (auto-applies when back)` : '';
    toast(errs.length ? `${changed} changed, ${errs.length} failed: ${errs.map((e) => e.device).join(', ')}${extra}` : `Access updated (${changed} change${changed === 1 ? '' : 's'})${extra}`, errs.length ? 'err' : 'ok');
    if ($('#u_table')) loadUsersTable(devs);
  });
}

// Structured skeleton table shown while real rows load — same columns as
// the data that replaces it, shimmering placeholder cells.
function skeletonTable(headers, rows = 6) {
  const widths = [55, 80, 65, 90, 70, 60];
  const body = Array.from({ length: rows }, (_, r) => `<tr>${headers.map((h, c) =>
    `<td><span class="skel-cell" style="width:${h === '' ? 34 : widths[(r + c) % widths.length]}%"></span></td>`).join('')}</tr>`).join('');
  return `<div class="table-wrapper"><table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
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
  const bar = progressBar(targets.length, `Setting ${role === 'admin' ? 'Admin' : 'User'} —`);
  const fails = [];
  await runBatched(targets, async (d) => {
    const r = await api.post(`/devices/${d.id}/users/${encodeURIComponent(employeeNo)}/role`, { role });
    if (!r.ok) fails.push(`${d.name}: ${r.error || 'error'}`);
  }, bar, 6);
  bar.close();
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
    toast(`Reading card on ${dev.name}… tap your card now (30s)`);
    const r = await api.post(`/devices/${dev.id}/users/${encodeURIComponent(u.employeeNo)}/read-card`);
    captureBusy = false;
    if (!r.ok) { toast(`Card read failed: ${r.error || 'error'}`, 'err'); return; }
    toast(`Card ${r.card_no} assigned to ${u.name || 'user ' + u.employeeNo}`, 'ok');
    if ($('#u_table')) loadUsersTable(devs);
  });
}

function addUserModal(srcDev, devs, checkAll = false) {
  const isEntrance = (d) => String(d.grp || '').trim().toLowerCase().startsWith('entrance');
  const checks = devs.map((d) => {
    const isChecked = isEntrance(d) || (!checkAll && d.id === srcDev.id);
    const displayName = (d.name && d.name !== d.host) ? d.name : (d.code ? `Machine ${d.code}` : `Machine #${d.id}`);
    return `
    <label class="dev-check-item">
      <input type="checkbox" class="au-dev" value="${d.id}" ${isChecked ? 'checked' : ''}>
      <div class="dev-info">
        <span class="dev-name">${esc(displayName)}</span>
        ${d.location ? `<span class="dev-loc">${esc(d.location)}</span>` : ''}
      </div>
      <span class="dev-host">${esc(d.host)}</span>
    </label>`;
  }).join('');
  openModal(`
    <h2>Add user</h2>
    <div class="two-col">
      <div class="field"><label>Name</label><input id="au_name" placeholder="Full name"></div>
      <div class="field"><label>Employee # <small class="hint">(auto-generated)</small></label><input id="au_no" readonly style="opacity:.75;cursor:default" tabindex="-1"></div>
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
    <div class="field"><label>Tenant of room <small class="hint">(picks that room's machine below — entrances + their room, fingerprint works on both)</small></label>
      <select id="au_room">
        <option value="">— not a room tenant —</option>
        ${devs.filter((d) => d.code && !String(d.grp || '').trim().toLowerCase().startsWith('entrance'))
      .map((d) => `<option value="${d.id}">Room ${esc(d.code)}${d.name && d.name !== 'Room ' + d.code ? ' — ' + esc(d.name) : ''}</option>`).join('')}
      </select>
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
  // Tenant dropdown drives the checklist: their room + the full Entrance
  // group get ticked (other rooms unticked), so fingerprint/card access
  // covers the entrances and their own door.
  $('#au_room')?.addEventListener('change', () => {
    const roomId = String($('#au_room').value);
    const isEntr = (d) => String(d.grp || '').trim().toLowerCase().startsWith('entrance');
    document.querySelectorAll('.au-dev').forEach((c) => {
      const d = devs.find((x) => String(x.id) === String(c.value));
      if (!d) return;
      const want = isEntr(d) ? true : String(d.id) === roomId ? true : roomId ? false : c.checked;
      if (c.checked !== want) { c.checked = want; c.dispatchEvent(new Event('change')); }
    });
  });
  wireChecklistFilter('au_filter');
  // Show the auto-generated employee # (checked across all machines + DB).
  $('#au_no').placeholder = 'auto…';
  api.get('/devices/next-employee-no').then((r) => {
    const inp = $('#au_no');
    if (r?.ok && inp && !inp.value.trim()) inp.value = String(r.next);
  }).catch(() => { });
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
      name,
      role: $('#au_role').value,
      card_no: $('#au_card').value.trim() || undefined,
      valid_begin: fromLocalInput($('#au_begin').value),
      valid_end: fromLocalInput($('#au_end').value),
    };
    const fpDevId = Number($('#au_fpdev').value) || null;
    closeModal();
    // Machines in batches with a live progress bar. The first batch assigns
    // the employee #; later batches reuse it (sequential on purpose).
    const chunks = [];
    for (let i = 0; i < deviceIds.length; i += 8) chunks.push(deviceIds.slice(i, i + 8));
    const bar = progressBar(deviceIds.length, 'Creating user —');
    let employeeNo = null;
    let firstErr = null;
    const results = [];
    for (const chunk of chunks) {
      const r = await api.post('/devices/users', {
        ...body,
        only_ids: chunk,
        employeeNo: employeeNo || undefined,
      });
      if (r.employeeNo) employeeNo = employeeNo || r.employeeNo;
      if (r.results) results.push(...r.results);
      else if (!firstErr) firstErr = r.error || 'error';
      bar.tick(chunk.length);
    }
    bar.close();
    if (!results.length) { toast(`Failed: ${firstErr || 'error'}`, 'err'); return; }
    const bad = results.filter((x) => !x.ok);
    const cardBad = results.filter((x) => x.ok && x.cardError);
    if (bad.length) toast(`User ${employeeNo} added, but failed on ${bad.map((b) => b.device).join(', ')}: ${bad[0].error}`, 'err');
    else if (cardBad.length) toast(`User ${employeeNo} added; card failed on ${cardBad.map((b) => b.device).join(', ')}: ${cardBad[0].cardError}`, 'err');
    else toast(`User ${employeeNo}${body.card_no ? ' + card' : ''} added on ${results.length} machine${results.length === 1 ? '' : 's'}`, 'ok');
    const fpDev = fpDevId && deviceIds.includes(fpDevId) ? devs.find((d) => d.id === fpDevId) : null;
    if (fpDev && employeeNo) await captureFp(fpDev, employeeNo, devs, deviceIds);
    if ($('#u_table')) loadUsersTable(devs);
  });
}

// ---- Cards ---- 
async function cards() {
  if (!content.querySelector('table')) {
    content.innerHTML = skeletonTable(['Card #', 'Access until', 'Assigned to', 'Access', ''], 6);
  }
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
    // Holder names only — the machine list collapses into the Access column.
    const assignedHtml = byEmp.size
      ? [...byEmp.entries()].map(([no, x]) =>
        `<b>${esc(x.name || 'User')}</b> <small class="hint">#${esc(no)}</small>`
      ).join('<br>')
      : nDev
        ? `standalone ${nBad ? `<span class="badge pending">${nBad} pending</span>` : '<span class="badge synced">synced</span>'}`
        : '<span class="muted">not assigned</span>';
    // Access summary per holder: Entrances chip + room badges, one line.
    const isEntrD = (d) => String(d.grp || '').trim().toLowerCase().startsWith('entrance');
    const entrAllCount = devs.filter(isEntrD).length;
    const summarize = (names) => {
      const ds = names.map((n) => devs.find((d) => d.name === n)).filter(Boolean);
      if (!ds.length) return '<small class="hint">—</small>';
      if (devs.length > 1 && ds.length >= devs.length) return `<span class="badge" title="${esc(names.join(', '))}">All machines (${ds.length})</span>`;
      const entrHave = ds.filter(isEntrD);
      const rooms = ds.filter((d) => d.code && !isEntrD(d));
      const parts = [];
      if (entrHave.length) parts.push(`<span class="badge">Entrances (${entrHave.length}${entrHave.length === entrAllCount ? '' : ' of ' + entrAllCount})</span>`);
      if (rooms.length) parts.push(`<span class="badge admin">room ${esc(rooms[0].code)}</span>`);
      const rest = ds.length - entrHave.length - (rooms.length ? 1 : 0);
      if (rest > 0) parts.push(`<span class="badge" title="${esc(names.join(', '))}">+${rest} more</span>`);
      return parts.join(' ');
    };
    const accessHtml = byEmp.size
      ? [...byEmp.values()].map((x) => summarize(x.devs)).join('<br>')
      : nDev
        ? summarize(c.grants.filter((g) => g.sync_state !== 'removing').map((g) => g.device_name))
        : '<small class="hint">—</small>';
    const customLabel = c.name && c.name !== `Card ${c.card_no}` ? ` <small class="hint">${esc(c.name)}</small>` : '';
    return `<tr>
      <td class="nowrap"><b>${esc(c.card_no || '—')}</b>${customLabel}</td>
      <td class="nowrap">${c.valid_end ? esc(c.valid_end.replace('T', ' ')) : '<span class="muted">no expiry</span>'}</td>
      <td class="nowrap">${assignedHtml}</td>
      <td class="nowrap">${accessHtml}</td>
      <td class="row-actions">
        <button class="btn sm" data-cmenu="${c.id}">Actions ▾</button>
        <span hidden>
          <button data-assign="${c.id}"></button>
          <button data-unassign="${c.id}"></button>
          <button data-sync="${c.id}"></button>
          <button data-edit="${c.id}"></button>
          <button data-del="${c.id}"></button>
        </span>
      </td>
    </tr>`;
  }).join('');
  content.appendChild(el(`<div class="table-wrapper"><table><thead><tr>
      <th>Card #</th><th>Access until</th><th>Assigned to</th><th>Access</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table></div>`));

  content.querySelectorAll('[data-cmenu]').forEach((b) => b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const row = b.closest('td');
    const hit = (sel) => row.querySelector(sel)?.click();
    showRowMenu(b, [
      ['Assign to user', () => hit('[data-assign]')],
      ['Unassign', () => hit('[data-unassign]')],
      ['Sync', () => hit('[data-sync]')],
      ['Edit', () => hit('[data-edit]')],
      ['Remove', () => hit('[data-del]'), true],
    ]);
  }));
  content.querySelectorAll('[data-assign]').forEach((b) => b.addEventListener('click', () =>
    assignCardModal(list.find((c) => c.id == b.dataset.assign), devs)));
  content.querySelectorAll('[data-unassign]').forEach((b) => b.addEventListener('click', async () => {
    const c = list.find((x) => x.id == b.dataset.unassign);
    if (!c || !c.card_no) { toast('This entry has no card number', 'err'); return; }
    const ok = await confirmDialog({
      title: 'Remove Card Access',
      message: `Remove card ${c.card_no} from every machine?\n\nWhoever holds it loses card access — their user profile stays.`,
      confirmText: 'Remove Card',
      danger: true
    });
    if (!ok) return;
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
    const ok = await confirmDialog({
      title: 'Delete Card from Fleet',
      message: `Delete card ${c?.card_no || ''}?\n\nIt is removed from every machine and detached from any user holding it — all access linked to this card stops working.`,
      confirmText: 'Delete Card',
      danger: true
    });
    if (!ok) return;
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
      if (!silent) holder.innerHTML = skeletonTable(['Time', 'Person', 'Machine', 'Method', 'Event']);
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
    if (!silent && !_logEvents) holder.innerHTML = skeletonTable(['Time', 'Person', 'Machine', 'Method', 'Event'], 8);
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
    holder.innerHTML = `${note}${renderEmptyState({
      icon: 'search',
      title: 'No access events found',
      message: fMachine || fMethod || fResult ? 'No entries match the selected filters.' : 'No entries recorded yet. Events appear here after someone scans a card, fingerprint, or face.',
      actionText: fMachine || fMethod || fResult ? 'Reset log filters' : '',
      onAction: fMachine || fMethod || fResult ? () => {
        const m = $('#log_machine'); if (m) m.value = '';
        const me = $('#log_method'); if (me) me.value = '';
        const r = $('#log_result'); if (r) r.value = '';
        renderEntries();
      } : null,
    })}`;
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
      <td>
        <div class="user-identity">
          ${renderAvatar(who, 'sm')}
          <div class="user-identity-names">
            <b>${esc(who)}</b>${e.employeeNoString ? ` <small class="hint">${copyableBadge(e.employeeNoString)}</small>` : ''}
          </div>
        </div>
      </td>
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

function renderBookingsGantt(items, devs = []) {
  const spaceMap = new Map();
  for (const b of items) {
    const key = String(b.spaceCode || b.spaceName || 'Space').trim();
    if (!spaceMap.has(key)) {
      spaceMap.set(key, {
        code: b.spaceCode,
        name: b.spaceName || `Room ${b.spaceCode}`,
        capacity: b.capacity || 0,
        type: b.spaceType || 'Meeting Space',
        machine: devs.find((d) => String(d.code || '').trim() === String(b.spaceCode).trim()),
        bookings: [],
      });
    }
    spaceMap.get(key).bookings.push(b);
  }

  for (const d of devs) {
    const isMeeting = (d.name && d.name.toLowerCase().includes('meeting')) || (d.grp && d.grp.toLowerCase().includes('meeting')) || (d.code);
    const key = String(d.code || d.name).trim();
    if (isMeeting && !spaceMap.has(key)) {
      spaceMap.set(key, {
        code: d.code || '',
        name: d.name,
        capacity: 10,
        type: 'Meeting Room',
        machine: d,
        bookings: [],
      });
    }
  }

  const spaces = [...spaceMap.values()];
  if (!spaces.length) {
    return `<div class="empty">No meeting spaces configured.</div>`;
  }

  const now = new Date();
  const nowM = now.getHours() * 60 + now.getMinutes();
  const showNow = nowM >= 480 && nowM <= 1200;
  const nowPct = showNow ? (((nowM - 480) / 720) * 100).toFixed(2) : null;
  const timeLabels = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];

  const rowsHtml = spaces.map((sp) => {
    const sorted = [...sp.bookings].sort((a, b) => new Date(a.start) - new Date(b.start));
    const blocksHtml = sorted.map((b) => {
      const ds = new Date(b.start);
      const de = new Date(b.end);
      const sM = ds.getHours() * 60 + ds.getMinutes();
      const eM = de.getHours() * 60 + de.getMinutes();
      const sClamp = Math.max(480, sM);
      const eClamp = Math.min(1200, eM);
      if (eClamp <= sClamp) return '';
      const left = (((sClamp - 480) / 720) * 100).toFixed(2);
      const width = Math.max(2.5, ((eClamp - sClamp) / 720) * 100).toFixed(2);
      const full = b.capacity > 0 && b.enrolled >= b.capacity;
      const statusText = full ? 'Full' : `${b.enrolled}/${b.capacity || '∞'}`;
      const timeStr = `${String(ds.getHours()).padStart(2, '0')}:${String(ds.getMinutes()).padStart(2, '0')} - ${String(de.getHours()).padStart(2, '0')}:${String(de.getMinutes()).padStart(2, '0')}`;

      return `
        <div class="gantt-slot-booked" style="left:${left}%; width:${width}%;" data-enroll="${b.id}" title="${esc(b.challan || b.ref)} · ${esc(b.customer || 'Booking')} (${timeStr}) — Click to manage attendees">
          <div class="gantt-slot-title">${esc(b.customer || b.challan || b.ref)} · ${statusText}</div>
          <div class="gantt-slot-time">${timeStr}</div>
        </div>
      `;
    }).join('');

    const gridLinesHtml = [0, 1, 2, 3, 4, 5, 6].map((i) =>
      `<div class="gantt-grid-line" style="left:${(i * 16.666).toFixed(2)}%;"></div>`
    ).join('');

    const availableEmptyHtml = !sorted.length ? `
      <div class="gantt-slot-available" style="left:1%; width:98%;" data-quick-book="${sp.machine ? sp.machine.id : ''}" data-spcode="${esc(sp.code)}" title="No bookings today — Click to reserve this room">
        Available all day — click to reserve slot
      </div>
    ` : '';

    return `
      <div class="gantt-room-row">
        <div class="gantt-room-info">
          <div class="gantt-room-title" title="${esc(sp.name)}">${esc(sp.name)}</div>
          <div class="gantt-room-meta">
            ${sp.code ? `<span class="badge admin" style="font-size:10px;">room ${esc(sp.code)}</span>` : ''}
            <span>${sp.capacity ? sp.capacity + ' seats' : (sp.type || 'Meeting')}</span>
          </div>
        </div>

        <div class="gantt-track-wrapper">
          ${gridLinesHtml}
          ${showNow ? `
            <div class="gantt-now-indicator" style="left:${nowPct}%;">
              <span class="gantt-now-badge">NOW</span>
            </div>
          ` : ''}
          ${availableEmptyHtml}
          ${blocksHtml}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="gantt-container">
      <div class="gantt-header-row">
        <div class="gantt-room-col-header">Meeting Space</div>
        <div class="gantt-timeline-header">
          ${timeLabels.map((t) => `<span>${t}</span>`).join('')}
        </div>
      </div>
      <div class="gantt-body">
        ${rowsHtml}
      </div>
    </div>
  `;
}

async function bookingsView() {
  $('#viewActions').innerHTML = `
    <div class="view-toggle-group">
      <button id="bookingsViewGantt" class="view-toggle-btn ${_bookingsViewMode === 'gantt' ? 'active' : ''}" title="Timeline Schedule View">
        ${ICONS.clock}
      </button>
      <button id="bookingsViewTable" class="view-toggle-btn ${_bookingsViewMode === 'table' ? 'active' : ''}" title="Table List View">
        ${ICONS.table}
      </button>
    </div>
  `;
  content.innerHTML = skeletonTable(['Booking', 'Space', 'Period', 'People', '']);
  const [r, devs] = await Promise.all([
    api.get('/bookings-feed'),
    api.get('/devices').catch(() => []),
  ]);
  if (current !== 'bookings') return;
  if (!r.ok) { if (!r.__auth) content.innerHTML = `<div class="empty">Couldn't load bookings: ${esc(r.error || 'error')}</div>`; return; }
  const items = r.items || [];
  if (Array.isArray(devs)) _cmdCachedDevs = devs;

  $('#bookingsViewGantt')?.addEventListener('click', () => {
    _bookingsViewMode = 'gantt';
    localStorage.setItem('wn_bookings_view_mode', 'gantt');
    bookingsView();
  });
  $('#bookingsViewTable')?.addEventListener('click', () => {
    _bookingsViewMode = 'table';
    localStorage.setItem('wn_bookings_view_mode', 'table');
    bookingsView();
  });

  if (!items.length) {
    content.innerHTML = renderEmptyState({
      icon: 'calendar',
      title: 'No active bookings',
      message: 'No upcoming room reservations scheduled. You can book a meeting room slot directly.',
      actionText: '+ Book a slot',
      onAction: () => {
        const meetingDev = (_cmdCachedDevs || []).find((d) => (d.name && d.name.toLowerCase().includes('meeting')) || (d.code));
        bookSlotModal(meetingDev || (_cmdCachedDevs && _cmdCachedDevs[0]), _cmdCachedDevs || []);
      },
    });
    return;
  }

  if (_bookingsViewMode === 'gantt') {
    content.innerHTML = renderBookingsGantt(items, _cmdCachedDevs || []);
    content.querySelectorAll('[data-enroll]').forEach((b) => b.addEventListener('click', () => bookingEnrollModal(Number(b.dataset.enroll))));
    content.querySelectorAll('[data-quick-book]').forEach((b) => b.addEventListener('click', () => {
      const devId = b.dataset.quickBook;
      const spCode = b.dataset.spcode;
      const dev = (_cmdCachedDevs || []).find((d) => d.id == devId || String(d.code) === String(spCode));
      bookSlotModal(dev || (_cmdCachedDevs && _cmdCachedDevs[0]), _cmdCachedDevs || []);
    }));
    return;
  }

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
      const ok = await confirmDialog({
        title: 'Remove Person from Booking',
        message: `Remove "${btn.dataset.bname}" from this booking? They are deleted from the machines immediately.`,
        confirmText: 'Remove Person',
        danger: true
      });
      if (!ok) return;
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
  content.innerHTML = skeletonTable(['Username', 'Role', 'Created', '']);
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
    const ok = await confirmDialog({
      title: 'Delete Dashboard Login',
      message: `Delete dashboard login "${b.dataset.deluser}"? They can no longer sign in.`,
      confirmText: 'Delete User',
      danger: true
    });
    if (!ok) return;
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
    if (me.ok && me.role === 'admin') {
      $('#navDashUsers').style.display = '';
      const a = $('#navAudit');
      if (a) a.style.display = '';
    }
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
let _anRange = { preset: 'today', from: null, to: null };
function anRangeDates() {
  const p = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const now = new Date();
  const shift = (days) => { const d = new Date(now); d.setDate(d.getDate() - days); return d; };
  switch (_anRange.preset) {
    case 'yesterday': return { from: iso(shift(1)), to: iso(shift(1)) };
    case '7d': return { from: iso(shift(6)), to: iso(now) };
    case '30d': return { from: iso(shift(29)), to: iso(now) };
    case 'custom': return { from: _anRange.from || iso(now), to: _anRange.to || iso(now) };
    default: return { from: iso(now), to: iso(now) };
  }
}

async function analyticsView() {
  clearInterval(_autoTimer);
  content.innerHTML = '<div class="empty">Loading analytics engine…</div>';
  const { from, to } = anRangeDates();
  const data = await api.get(`/analytics?from=${from}&to=${to}`);
  if (current !== 'analytics') return;
  if (!data.ok) { content.innerHTML = `<div class="empty">Failed to load analytics: ${esc(data.error)}</div>`; return; }
  const rangeLabel = from === to ? from : `${from} → ${to}`;

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
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:18px">
      <label class="hint" style="font-weight:600">Period</label>
      <select id="an_preset">
        <option value="today" ${_anRange.preset === 'today' ? 'selected' : ''}>Today</option>
        <option value="yesterday" ${_anRange.preset === 'yesterday' ? 'selected' : ''}>Yesterday</option>
        <option value="7d" ${_anRange.preset === '7d' ? 'selected' : ''}>Last 7 days</option>
        <option value="30d" ${_anRange.preset === '30d' ? 'selected' : ''}>Last 30 days</option>
        <option value="custom" ${_anRange.preset === 'custom' ? 'selected' : ''}>Custom range…</option>
      </select>
      <input id="an_from" type="date" value="${_anRange.from || from}" style="${_anRange.preset === 'custom' ? '' : 'display:none'}">
      <input id="an_to" type="date" value="${_anRange.to || to}" style="${_anRange.preset === 'custom' ? '' : 'display:none'}">
      <button class="btn sm" id="an_apply" style="${_anRange.preset === 'custom' ? '' : 'display:none'}">Apply</button>
      <small class="hint">Showing ${esc(rangeLabel)} · from the permanent entry archive</small>
    </div>
    <div class="stat-grid">
      ${kpi('user', 'Live Occupancy', data.liveHeadcount, 'good', 'Estimated headcount on site')}
      ${kpi('online', 'Entries', data.todayTotal, 'good', `Archived door events · ${esc(rangeLabel)}`)}
      ${kpi('clock', 'Peak Hour', data.peakHourLabel, 'warn', `${data.maxPeak} scans during peak`)}
      ${kpi('machine', 'Active Doors', `${data.onlineCount} / ${data.devicesCount}`, data.onlineCount === data.devicesCount ? 'good' : 'warn', 'Online terminals')}
    </div>

    <div class="panel-grid" style="margin-top:24px;">
      <section class="panel" style="height:auto; min-height:380px;">
        <header>
          <h3>Hourly Traffic Distribution</h3>
        </header>
        <div class="panel-body" style="padding:22px;">
          ${generateBezierAreaChartSvg(data.hourlyDistribution || [], 740, 240)}
        </div>
      </section>

      <section class="panel" style="height:auto; min-height:380px;">
        <header>
          <h3>Space & Terminal Utilization</h3>
        </header>
        <div class="panel-body" style="padding:20px;">
          ${renderSpaceDonut(data.doorUsage || [], data.todayTotal || 0)}
        </div>
      </section>
    </div>

    <section class="panel" style="height:auto; margin-top:24px;">
      <header style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <h3>Scans by User</h3>
        <small class="hint" style="font-size:12px;">Click a user to inspect detailed activity breakdown</small>
      </header>
      <div class="panel-body" style="padding:20px;">
        ${(data.userScans || []).map((u) => `
          <div class="usage-row clickable" data-user-emp="${esc(u.employeeNo)}" data-user-name="${esc(u.name)}">
            <div class="usage-head">
              <span class="usage-name" style="display:flex;align-items:center;gap:8px">
                ${renderAvatar(u.name, 'sm')}
                <span><b>${esc(u.name || 'User ' + u.employeeNo)}</b> <small class="hint">${copyableBadge(u.employeeNo)}</small></span>
              </span>
              <div style="display:flex;align-items:center;gap:10px;">
                <span class="usage-val tabular-nums">${u.count} scan${u.count === 1 ? '' : 's'} (${u.percent}%)</span>
                <svg class="usage-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
              </div>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: ${Math.max(3, u.percent)}%"></div>
            </div>
          </div>`).join('') || '<div class="list-empty">No user scans recorded in this period.</div>'}
      </div>
    </section>
  </div>`;
  wireBezierChart();

  content.querySelectorAll('.usage-row.clickable').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.copy-btn')) return;
      const emp = row.dataset.userEmp;
      const nm = row.dataset.userName;
      showUserAnalyticsBreakdown(emp, nm);
    });
  });

  $('#an_preset').addEventListener('change', () => {
    _anRange.preset = $('#an_preset').value;
    if (_anRange.preset !== 'custom') analyticsView();
    else['an_from', 'an_to', 'an_apply'].forEach((id) => { $('#' + id).style.display = ''; });
  });
  $('#an_apply').addEventListener('click', () => {
    _anRange.from = $('#an_from').value || null;
    _anRange.to = $('#an_to').value || null;
    analyticsView();
  });
}

// Interactive breakdown modal when a user is clicked in "Scans by User"
async function showUserAnalyticsBreakdown(empNo, name) {
  openModal(`
    <div style="max-width: 680px; width: 100%; max-height: 85vh; overflow-y: auto; padding-right: 4px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;gap:12px;">
        <div style="display:flex;align-items:center;gap:12px;">
          ${renderAvatar(name, 'md')}
          <div>
            <h2 style="margin:0;font-size:18px;font-weight:700;">${esc(name || 'User ' + empNo)}</h2>
            <div style="display:flex;gap:8px;align-items:center;margin-top:4px;">
              ${copyableBadge(empNo)}
              <span class="badge" style="font-size:11px;">Activity Breakdown</span>
            </div>
          </div>
        </div>
        <button class="btn sm" id="uab_close_top" style="padding:4px 8px;border-radius:6px;" title="Close">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>

      <div id="uab_body">
        <div style="display:flex;gap:12px;margin-bottom:16px;">
          <span class="skel-cell" style="flex:1;height:68px;border-radius:10px;"></span>
          <span class="skel-cell" style="flex:1;height:68px;border-radius:10px;"></span>
          <span class="skel-cell" style="flex:1;height:68px;border-radius:10px;"></span>
        </div>
        <span class="skel-cell" style="width:100%;height:140px;border-radius:10px;display:block;margin-bottom:16px;"></span>
        <span class="skel-cell" style="width:100%;height:120px;border-radius:10px;display:block;"></span>
      </div>

      <div class="modal-actions" style="margin-top:20px;display:flex;justify-content:space-between;align-items:center;">
        <div id="uab_footer_left"></div>
        <button class="btn primary" id="uab_close">Done</button>
      </div>
    </div>
  `);

  $('#uab_close_top')?.addEventListener('click', closeModal);
  $('#uab_close')?.addEventListener('click', closeModal);

  const body = $('#uab_body');
  try {
    const { from, to } = anRangeDates();
    const r = await api.get(`/analytics/user/${encodeURIComponent(empNo || '0')}?name=${encodeURIComponent(name || '')}&from=${from}&to=${to}`);
    if (!body) return;

    if (!r?.ok) {
      body.innerHTML = `<div class="empty">Failed to load user breakdown: ${esc(r?.error || 'error')}</div>`;
      return;
    }

    const u = r.user || {};
    const statusBadge = u.status === 'expired'
      ? '<span class="badge error">Expired</span>'
      : '<span class="badge synced">Active Member</span>';
    const roomBadge = u.roomNo ? `<span class="badge">Room ${esc(u.roomNo)}</span>` : '';
    const cardBadge = u.cardNo ? `<span class="badge monospace">Card: ${copyableBadge(u.cardNo)}</span>` : '<span class="badge">No card registered</span>';

    // Format first / last scan
    const formatScanTime = (iso) => {
      if (!iso) return '—';
      try {
        const d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso).replace('T', ' ').slice(11, 16);
        return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
      } catch {
        return String(iso).replace('T', ' ').slice(11, 16);
      }
    };

    const firstStr = formatScanTime(r.firstScan);
    const lastStr = formatScanTime(r.lastScan);

    // Door list
    const doorRows = (r.doors || []).map((d) => `
      <div class="usage-row" style="margin-bottom:10px;">
        <div class="usage-head" style="margin-bottom:4px;">
          <span class="usage-name" style="font-size:12.5px;font-weight:600;">${esc(d.name)}</span>
          <span class="usage-val tabular-nums" style="font-size:12px;">${d.count} scan${d.count === 1 ? '' : 's'} (${d.percent}%)</span>
        </div>
        <div class="progress-bar-bg" style="height:6px;">
          <div class="progress-bar-fill" style="width:${Math.max(4, d.percent)}%;"></div>
        </div>
      </div>
    `).join('') || '<div class="hint" style="padding:6px 0;">No door scans recorded in this date range.</div>';

    // Grants / Accessible Gates chips
    const hasGrants = r.grants && r.grants.length > 0;
    const isDirectEnroll = hasGrants && r.grants.some((g) => g.directEnroll);

    const grantChips = hasGrants ? (r.grants || []).map((g) => `
      <span class="uab-gate-chip" title="${g.directEnroll ? 'Authorized via physical reader' : (g.grp ? `Access Group: ${esc(g.grp)}` : 'Access Granted')}">
        <span class="status-dot ${g.online ? 'on' : 'off'}" style="width:6px;height:6px;flex-shrink:0;"></span>
        <span>${esc(g.name)}</span>
        ${!g.directEnroll && g.grp ? `<small class="hint" style="font-size:10px;">(${esc(g.grp)})</small>` : ''}
      </span>
    `).join('') : '<span class="hint" style="font-size:12px;padding:4px 0;display:block;">Enrolled on local terminal; no centralized access group assigned yet.</span>';

    // Recent scans table
    const recentRows = (r.recentEvents || []).slice(0, 15).map((e) => {
      let timeStr = '—';
      let dateStr = '—';
      try {
        if (e.time) {
          const d = new Date(e.time);
          if (!isNaN(d.getTime())) {
            timeStr = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
            dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
          } else {
            timeStr = String(e.time).replace('T', ' ').slice(11, 19);
            dateStr = String(e.time).slice(5, 10);
          }
        }
      } catch {
        timeStr = String(e.time || '—').slice(11, 19);
      }
      return `
        <tr>
          <td class="nowrap"><span class="tabular-nums" style="font-weight:600;">${timeStr}</span> <small class="hint">${dateStr}</small></td>
          <td><b>${esc(e.device)}</b></td>
          <td class="nowrap">${e.cardNo ? copyableBadge(e.cardNo) : '<small class="hint">Biometric</small>'}</td>
          <td class="nowrap"><span class="badge synced">Granted</span></td>
        </tr>
      `;
    }).join('') || '<tr><td colspan="4" class="list-empty" style="padding:16px;">No recent scan logs found for this user.</td></tr>';

    body.innerHTML = `
    <!-- Top Meta Badges -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
      ${statusBadge}
      ${roomBadge}
      ${cardBadge}
      ${u.validEnd ? `<span class="badge"><small class="hint">Valid until: </small>${esc(String(u.validEnd).replace('T', ' ').slice(0, 10))}</span>` : ''}
    </div>

    <!-- Stat Highlights -->
    <div class="uab-stat-grid">
      <div class="uab-stat-box">
        <div class="uab-stat-label">Scans (Range)</div>
        <div class="uab-stat-val">${r.totalScans}</div>
        <div class="uab-stat-sub">${r.allTimeScans} all-time recorded</div>
      </div>
      <div class="uab-stat-box">
        <div class="uab-stat-label">Peak Hour</div>
        <div class="uab-stat-val" style="font-size:14px;line-height:1.4;">${esc(r.peakHourLabel)}</div>
        <div class="uab-stat-sub">Highest activity window</div>
      </div>
      <div class="uab-stat-box">
        <div class="uab-stat-label">First & Last Scan</div>
        <div class="uab-stat-val" style="font-size:14px;line-height:1.4;">${firstStr} / ${lastStr}</div>
        <div class="uab-stat-sub">Activity interval</div>
      </div>
    </div>

    <!-- Scans by Door / Terminal Breakdown -->
    <div class="uab-section-title">
      <span>Terminal / Door Breakdown</span>
      <span class="tabular-nums">${r.doors ? r.doors.length : 0} door${r.doors && r.doors.length === 1 ? '' : 's'}</span>
    </div>
    <div class="uab-doors-list">
      ${doorRows}
    </div>

    <!-- Authorized Gates / Doors -->
    <div class="uab-section-title">
      <span>Assigned Access Permissions</span>
      <div style="display:flex;align-items:center;gap:6px;">
        ${isDirectEnroll ? '<span class="badge" style="font-size:10px;padding:2px 7px;font-weight:500;">Terminal Enrolled</span>' : ''}
        <span class="tabular-nums" style="font-size:11.5px;font-weight:600;">${r.grants ? r.grants.length : 0} gates</span>
      </div>
    </div>
    <div class="uab-gates-container">
      ${isDirectEnroll ? '<div class="hint" style="font-size:11px;margin-bottom:8px;color:var(--text-muted);display:flex;align-items:center;gap:5px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="8"/></svg> Verified on-device credentials active across physical readers:</div>' : ''}
      <div class="uab-gate-chips">
        ${grantChips}
      </div>
    </div>

    <!-- Recent Scans Timeline Table -->
    <div class="uab-section-title">
      <span>Recent Scan Activity Log</span>
      <span class="hint">${r.fallbackAllTime ? 'Latest entries (outside filter)' : 'Latest entries'}</span>
    </div>
    <div class="table-wrapper" style="max-height:220px;overflow-y:auto;border-radius:10px;border:1px solid var(--border);">
      <table class="uab-recent-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Terminal / Door</th>
            <th>Credential</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${recentRows}
        </tbody>
      </table>
    </div>
  `;

    // Left action: jump to users view
    const footerLeft = $('#uab_footer_left');
    if (footerLeft && (empNo || u.employeeNo)) {
      footerLeft.innerHTML = `<button class="btn sm" id="uab_jump_user">Manage in Users</button>`;
      $('#uab_jump_user')?.addEventListener('click', () => {
        closeModal();
        go('users');
      });
    }
  } catch (err) {
    console.error('Failed to load user activity breakdown:', err);
    if (body) body.innerHTML = `<div class="empty">Failed to load user breakdown: ${esc(err?.message || err)}</div>`;
  }
}

// ====================================================
// ---- Visual Credential Change Diff Viewer & Audit ----
// ====================================================

function parseAuditDiff(l) {
  let info = {};
  if (typeof l.info === 'object' && l.info !== null) {
    info = l.info;
  } else if (typeof l.info === 'string') {
    try { info = JSON.parse(l.info); } catch { info = { raw: l.info }; }
  } else if (typeof l.detail === 'object' && l.detail !== null) {
    info = l.detail;
  } else if (typeof l.detail === 'string') {
    try { info = JSON.parse(l.detail); } catch { info = { raw: l.detail }; }
  }

  const act = String(l.action || l.rawAction || '').toLowerCase();
  const res = {
    type: 'other',
    badge: 'Event',
    badgeCls: 'pending',
    title: l.action || 'Audit Event',
    summaryHtml: '',
    hasDiff: false,
    beforeItems: [],
    afterItems: [],
    meta: {
      actor: l.actor || 'system',
      target: l.target || '—',
      ts: l.ts || '',
      ip: l.ip || '—',
    },
  };

  // 1. Access Permission Changes
  if (act.includes('access_permission') || act.includes('access-grant') || act.includes('access-revoke') || act.includes('access-update')) {
    res.type = 'access';
    res.badge = 'Access Permission';
    res.badgeCls = 'admin';
    res.title = 'Door Access Permissions Changed';
    res.hasDiff = true;

    const granted = Array.isArray(info.granted) ? info.granted : [];
    const revoked = Array.isArray(info.revoked) ? info.revoked : [];

    if (!granted.length && !revoked.length) {
      if (act.includes('grant')) {
        const devName = l.target || l.device_name || 'Terminal';
        granted.push(devName);
      } else if (act.includes('revoke')) {
        const devName = l.target || l.device_name || 'Terminal';
        revoked.push(devName);
      }
    }

    const pills = [];
    if (granted.length) {
      pills.push(...granted.map((g) => `<span class="diff-chip added"><span class="diff-prefix-icon">+</span> ${esc(g)}</span>`));
      res.afterItems.push(...granted.map((g) => ({ type: 'added', text: `Granted access to ${g}` })));
    }
    if (revoked.length) {
      pills.push(...revoked.map((r) => `<span class="diff-chip removed"><span class="diff-prefix-icon">-</span> ${esc(r)}</span>`));
      res.beforeItems.push(...revoked.map((r) => ({ type: 'removed', text: `Access revoked from ${r}` })));
    }

    if (info.validEnd) {
      const endStr = esc(String(info.validEnd).replace('T', ' ').slice(0, 16));
      res.afterItems.push({ type: 'modified', text: `Valid until: ${endStr}` });
    }

    res.summaryHtml = pills.length ? `<div class="diff-chip-list">${pills.join('')}</div>` : `<small class="hint">${esc(l.target || 'Updated permissions')}</small>`;
    return res;
  }

  // 2. Validity Extension
  if (act.includes('extend')) {
    res.type = 'extend';
    res.badge = 'Validity Extended';
    res.badgeCls = 'synced';
    res.title = 'Access Validity Extended';
    res.hasDiff = true;

    const days = info.days || 30;
    const newEnd = info.newValidEnd || info.validEnd;
    const prevEnd = info.prevValidEnd || info.curEnd;

    if (prevEnd) {
      const pStr = esc(String(prevEnd).replace('T', ' ').slice(0, 16));
      res.beforeItems.push({ type: 'neutral', text: `Previous Expiry: ${pStr}` });
    } else {
      res.beforeItems.push({ type: 'neutral', text: 'Previous Expiry: Earlier Deadline' });
    }

    if (newEnd) {
      const nStr = esc(String(newEnd).replace('T', ' ').slice(0, 16));
      res.afterItems.push({ type: 'added', text: `New Expiry: ${nStr} (+${days} days)` });
    } else {
      res.afterItems.push({ type: 'added', text: `Extended by +${days} days` });
    }

    if (Array.isArray(info.devices) && info.devices.length) {
      res.afterItems.push({ type: 'neutral', text: `Applied to: ${info.devices.join(', ')}` });
    }

    res.summaryHtml = `<span class="diff-chip added"><span class="diff-prefix-icon">+</span> Extended +${days} Days</span>`;
    return res;
  }

  // 3. Card Credential (Assign / Remove)
  if (act.includes('card')) {
    res.type = 'card';
    const cardNo = info.cardNo || l.cardNo || '';
    if (act.includes('remove') || act.includes('delete')) {
      res.badge = 'Card Removed';
      res.badgeCls = 'error';
      res.title = 'RFID Card Removed';
      res.hasDiff = true;
      res.beforeItems.push({ type: 'removed', text: `Card #${cardNo || 'Enrolled Card'} attached to account` });
      res.afterItems.push({ type: 'neutral', text: 'Card unlinked / de-allocated' });
      res.summaryHtml = `<span class="diff-chip removed"><span class="diff-prefix-icon">-</span> Card #${esc(cardNo || 'removed')}</span>`;
    } else {
      res.badge = 'Card Assigned';
      res.badgeCls = 'synced';
      res.title = 'RFID Card Attached';
      res.hasDiff = true;
      res.beforeItems.push({ type: 'neutral', text: 'No card or previous badge' });
      res.afterItems.push({ type: 'added', text: `Active RFID Card #${cardNo || 'Enrolled'}` });
      res.summaryHtml = `<span class="diff-chip added"><span class="diff-prefix-icon">+</span> Card #${esc(cardNo || 'attached')}</span>`;
    }
    return res;
  }

  // 4. Biometric Changes (Fingerprint / Face)
  if (act.includes('finger') || act.includes('face') || act.includes('biometric')) {
    res.type = 'biometric';
    const isRemove = act.includes('delete') || act.includes('remove');
    const isFace = act.includes('face');
    const bioName = isFace ? 'Facial Biometric' : 'Fingerprint Template';

    res.badge = isRemove ? `${bioName} Deleted` : `${bioName} Enrolled`;
    res.badgeCls = isRemove ? 'error' : 'synced';
    res.title = isRemove ? `Biometric Removed: ${bioName}` : `Biometric Enrolled: ${bioName}`;
    res.hasDiff = true;

    if (isRemove) {
      res.beforeItems.push({ type: 'removed', text: `${bioName} active on terminal` });
      res.afterItems.push({ type: 'neutral', text: 'Biometric template wiped from hardware' });
      res.summaryHtml = `<span class="diff-chip removed"><span class="diff-prefix-icon">-</span> ${bioName} Purged</span>`;
    } else {
      res.beforeItems.push({ type: 'neutral', text: 'No biometric credentials' });
      res.afterItems.push({ type: 'added', text: `${bioName} captured & stored` });
      res.summaryHtml = `<span class="diff-chip added"><span class="diff-prefix-icon">+</span> ${bioName} Enrolled</span>`;
    }
    return res;
  }

  // 5. Role Changes
  if (act.includes('role')) {
    res.type = 'role';
    res.badge = 'Role Change';
    res.badgeCls = 'admin';
    res.title = 'Administrative Role Modified';
    res.hasDiff = true;

    const newR = info.role || (act.includes('admin') ? 'admin' : 'user');
    const prevR = info.previousRole || (newR === 'admin' ? 'user' : 'admin');

    res.beforeItems.push({ type: 'removed', text: `Role: ${prevR.toUpperCase()}` });
    res.afterItems.push({ type: 'added', text: `Role: ${newR.toUpperCase()}` });
    res.summaryHtml = `<span class="diff-chip modified"><span class="diff-prefix-icon">Δ</span> Role: ${prevR} → ${newR}</span>`;
    return res;
  }

  // 6. User Profile Update
  if (act.includes('user_profile') || act.includes('edit-user')) {
    res.type = 'user';
    res.badge = 'User Edited';
    res.badgeCls = 'pending';
    res.title = 'User Profile Details Updated';
    res.hasDiff = true;

    if (info.fromName && info.toName && info.fromName !== info.toName) {
      res.beforeItems.push({ type: 'removed', text: `Name: ${info.fromName}` });
      res.afterItems.push({ type: 'added', text: `Name: ${info.toName}` });
    }
    if (info.fromNo && info.toNo && info.fromNo !== info.toNo) {
      res.beforeItems.push({ type: 'removed', text: `Employee #: ${info.fromNo}` });
      res.afterItems.push({ type: 'added', text: `Employee #: ${info.toNo}` });
    }
    if (!res.beforeItems.length) {
      res.afterItems.push({ type: 'modified', text: `Updated user info: ${info.newName || l.target || 'Profile'}` });
    }

    res.summaryHtml = `<span class="diff-chip modified"><span class="diff-prefix-icon">Δ</span> Profile Info Updated</span>`;
    return res;
  }

  // 7. Door Unlock Commands
  if (act.includes('door') || act.includes('unlock')) {
    res.type = 'door';
    res.badge = 'Door Unlock';
    res.badgeCls = 'synced';
    res.title = 'Remote Door Pulse Command';
    res.summaryHtml = `<small class="hint">${esc(l.target || 'Door')} — ${esc(info.cmd || 'Momentary unlock pulse')}</small>`;
    return res;
  }

  // 8. Auth / Security Logins
  if (act.includes('login') || act.includes('logout') || act.includes('password') || act.includes('dash_user')) {
    res.type = 'auth';
    const isOk = act.includes('success') || act.includes('create');
    res.badge = act.includes('success') ? 'Login Success' : act.includes('fail') ? 'Login Failed' : 'Security';
    res.badgeCls = isOk ? 'synced' : 'error';
    res.title = `Security Event: ${l.action}`;
    res.summaryHtml = `<small class="hint">${esc(typeof info === 'string' ? info : info.info || info.raw || 'User authentication')}</small>`;
    return res;
  }

  // Fallback generic
  res.summaryHtml = `<small class="hint">${esc(typeof l.info === 'string' ? l.info : JSON.stringify(l.info || ''))}</small>`;
  return res;
}

function openVisualDiffModal(log) {
  const diff = parseAuditDiff(log);
  const infoJson = typeof log.info === 'object' ? JSON.stringify(log.info, null, 2) : String(log.info || '');

  let diffBodyHtml = '';
  if (diff.hasDiff && (diff.beforeItems.length || diff.afterItems.length)) {
    const renderItems = (items, fallbackText) => {
      if (!items.length) {
        return `<div class="hint" style="font-size:12px;padding:8px 0;">${fallbackText}</div>`;
      }
      return items.map((it) => {
        const cls = it.type === 'added' ? 'added' : it.type === 'removed' ? 'removed' : it.type === 'modified' ? 'modified' : 'neutral';
        const prefix = it.type === 'added' ? '+' : it.type === 'removed' ? '-' : it.type === 'modified' ? 'Δ' : '•';
        return `
          <div class="diff-chip ${cls}" style="display:flex;width:fit-content;margin-bottom:4px;">
            <span class="diff-prefix-icon">${prefix}</span>
            <span>${esc(it.text)}</span>
          </div>
        `;
      }).join('');
    };

    diffBodyHtml = `
      <div class="diff-side-by-side">
        <div class="diff-box before">
          <div class="diff-box-head">
            <span>Previous State (Before)</span>
            <span class="diff-prefix-icon">-</span>
          </div>
          <div class="diff-box-body">
            ${renderItems(diff.beforeItems, 'No prior restriction or removed items')}
          </div>
        </div>
        <div class="diff-box after">
          <div class="diff-box-head">
            <span>Resulting State (After)</span>
            <span class="diff-prefix-icon">+</span>
          </div>
          <div class="diff-box-body">
            ${renderItems(diff.afterItems, 'No newly granted permissions')}
          </div>
        </div>
      </div>
    `;
  } else {
    diffBodyHtml = `
      <div class="notice-banner" style="cursor:default;">
        <b>Event Summary:</b> ${diff.summaryHtml}
      </div>
    `;
  }

  openModal(`
    <div class="diff-modal-container">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div>
          <h2 style="margin:0 0 4px;font-size:18px;">${esc(diff.title)}</h2>
          <span class="hint" style="font-size:12px;">Visual Audit Trail & Credential Comparison</span>
        </div>
        <span class="badge ${diff.badgeCls}" style="font-size:11px;">${esc(diff.badge)}</span>
      </div>

      <div class="diff-meta-bar">
        <div class="diff-meta-item">
          <span class="diff-meta-label">Operator / Actor</span>
          <span class="diff-meta-val">${esc(diff.meta.actor)}</span>
        </div>
        <div class="diff-meta-item">
          <span class="diff-meta-label">Target Subject</span>
          <span class="diff-meta-val">${esc(diff.meta.target)}</span>
        </div>
        <div class="diff-meta-item">
          <span class="diff-meta-label">IP Address</span>
          <span class="diff-meta-val">${esc(diff.meta.ip)}</span>
        </div>
        <div class="diff-meta-item">
          <span class="diff-meta-label">Timestamp</span>
          <span class="diff-meta-val">${esc(diff.meta.ts)}</span>
        </div>
      </div>

      ${diffBodyHtml}

      <details style="margin-top:4px;">
        <summary style="font-size:11.5px;color:var(--text-muted);cursor:pointer;">Show raw event payload</summary>
        <pre style="background:rgba(0,0,0,0.3);padding:10px;border-radius:8px;font-size:11px;overflow-x:auto;margin-top:8px;max-height:180px;"><code>${esc(infoJson)}</code></pre>
      </details>

      <div class="modal-actions" style="margin-top:12px;">
        <button class="btn" id="diff_close">Close</button>
      </div>
    </div>
  `);

  $('#diff_close')?.addEventListener('click', closeModal);
}

// ---- Admin Audit Log View ----
let _auditFilter = 'all';
let _auditSearch = '';

async function auditView() {
  if (dashRole !== 'admin') { content.innerHTML = '<div class="empty">Admin Audit is available to admin accounts only.</div>'; return; }
  clearInterval(_autoTimer);
  content.innerHTML = '<div class="empty">Loading admin audit trail…</div>';
  const data = await api.get('/audit-logs?limit=300');
  if (current !== 'audit') return;
  if (!data.ok) { content.innerHTML = `<div class="empty">Failed to load audit trail: ${esc(data.error)}</div>`; return; }

  const allLogs = data.logs || [];

  content.innerHTML = `
    <div class="audit-toolbar">
      <div class="audit-search-wrapper">
        ${ICONS.search}
        <input type="text" id="auditSearchInput" class="audit-search-input" value="${esc(_auditSearch)}" placeholder="Search actor, target person/device, IP, action..." autocomplete="off" />
        <button id="auditSearchClear" class="user-search-clear" style="${_auditSearch ? '' : 'display:none'}" title="Clear search">✕</button>
      </div>

      <div class="filter-bar" id="auditFilterBar" style="margin:0;">
        <button class="filter-chip ${_auditFilter === 'all' ? 'active' : ''}" data-afilter="all">All Events</button>
        <button class="filter-chip ${_auditFilter === 'access' ? 'active' : ''}" data-afilter="access">Access Changes</button>
        <button class="filter-chip ${_auditFilter === 'extend' ? 'active' : ''}" data-afilter="extend">Validity Extensions</button>
        <button class="filter-chip ${_auditFilter === 'creds' ? 'active' : ''}" data-afilter="creds">Cards & Biometrics</button>
        <button class="filter-chip ${_auditFilter === 'door' ? 'active' : ''}" data-afilter="door">Door Unlocks</button>
        <button class="filter-chip ${_auditFilter === 'auth' ? 'active' : ''}" data-afilter="auth">Logins & Security</button>
      </div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;padding:0 2px;">
      <span class="hint tabular-nums" id="auditMatchCount" style="font-size:12px;">Showing ${allLogs.length} of ${allLogs.length} events</span>
    </div>

    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Operator / Actor</th>
            <th>Category</th>
            <th>Target Subject</th>
            <th>IP Address</th>
            <th>Credential / Permission Changes</th>
            <th style="text-align:right;">Diff Action</th>
          </tr>
        </thead>
        <tbody id="auditTableBody"></tbody>
      </table>
    </div>
  `;

  const renderAuditRows = () => {
    const q = _auditSearch.trim().toLowerCase();
    const filtered = allLogs.filter((l) => {
      const diff = parseAuditDiff(l);
      if (_auditFilter === 'access' && diff.type !== 'access') return false;
      if (_auditFilter === 'extend' && diff.type !== 'extend') return false;
      if (_auditFilter === 'creds' && diff.type !== 'card' && diff.type !== 'biometric') return false;
      if (_auditFilter === 'door' && diff.type !== 'door') return false;
      if (_auditFilter === 'auth' && diff.type !== 'auth') return false;

      if (q) {
        const str = `${l.actor} ${l.target} ${l.ip} ${l.action} ${diff.title} ${JSON.stringify(l.info || '')}`.toLowerCase();
        if (!str.includes(q)) return false;
      }
      return true;
    });

    const countEl = $('#auditMatchCount');
    if (countEl) countEl.textContent = `Showing ${filtered.length} of ${allLogs.length} events`;

    const tbody = $('#auditTableBody');
    if (!tbody) return;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="list-empty">No matching audit events found.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map((l, idx) => {
      const diff = parseAuditDiff(l);
      return `
        <tr>
          <td class="nowrap"><small class="hint tabular-nums">${esc(l.ts)}</small></td>
          <td><b>${esc(l.actor)}</b></td>
          <td><span class="badge ${diff.badgeCls}">${esc(diff.badge)}</span></td>
          <td>${esc(l.target || '—')}</td>
          <td class="nowrap"><small class="hint tabular-nums">${esc(l.ip || '127.0.0.1')}</small></td>
          <td style="max-width:320px;">${diff.summaryHtml}</td>
          <td style="text-align:right; white-space:nowrap;">
            <button class="btn sm diff-btn" data-audit-diff="${idx}">Inspect Diff ▾</button>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('[data-audit-diff]').forEach((b) => {
      b.addEventListener('click', () => {
        const l = filtered[Number(b.dataset.auditDiff)];
        if (l) openVisualDiffModal(l);
      });
    });
  };

  renderAuditRows();

  $('#auditSearchInput')?.addEventListener('input', (e) => {
    _auditSearch = e.target.value;
    const clr = $('#auditSearchClear');
    if (clr) clr.style.display = _auditSearch ? '' : 'none';
    renderAuditRows();
  });

  $('#auditSearchClear')?.addEventListener('click', () => {
    _auditSearch = '';
    const inp = $('#auditSearchInput');
    if (inp) { inp.value = ''; inp.focus(); }
    const clr = $('#auditSearchClear');
    if (clr) clr.style.display = 'none';
    renderAuditRows();
  });

  $('#auditFilterBar')?.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      $('#auditFilterBar')?.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      _auditFilter = chip.dataset.afilter || 'all';
      renderAuditRows();
    });
  });
}

// ==========================================
// ---- Global Command Palette (Cmd + K) ----
// ==========================================
let _cmdPaletteOpen = false;
let _cmdSelectedIndex = 0;
let _cmdCurrentItems = [];
let _cmdRosterFetching = false;

function openCommandPalette() {
  const backdrop = $('#cmdPaletteBackdrop');
  const input = $('#cmdPaletteInput');
  if (!backdrop || !input) return;
  _cmdPaletteOpen = true;
  backdrop.hidden = false;
  input.value = '';
  _cmdSelectedIndex = 0;

  // Asynchronously ensure devices and members are available in cache
  if (!_cmdCachedDevs.length) {
    api.get('/devices').then((d) => {
      if (Array.isArray(d)) {
        _cmdCachedDevs = d;
        if (_cmdPaletteOpen) renderCommandPalette($('#cmdPaletteInput')?.value || '');
      }
    }).catch(() => { });
  }

  if (!_cmdCachedEntries.length && !_cmdRosterFetching) {
    _cmdRosterFetching = true;
    api.get('/users?limit=500').then((res) => {
      if (res?.ok && Array.isArray(res.users) && res.users.length) {
        _cmdCachedEntries = res.users.map((u) => ({
          u: {
            employeeNo: u.employee_no || u.employeeNo,
            name: u.name,
            email: u.email,
            cards: u.cards || (u.card_no ? [u.card_no] : []),
            numOfCard: u.num_of_card || (u.card_no ? 1 : 0),
            numOfFP: u.num_of_fp || 0,
            numOfFace: u.num_of_face || 0,
            localUIRight: u.is_admin || false,
          },
          on: u.rooms ? u.rooms.map((r) => ({ code: r, name: `Room ${r}` })) : [],
        }));
        _cmdCachedUsers = _cmdCachedEntries.map((e) => e.u);
        if (_cmdPaletteOpen) renderCommandPalette($('#cmdPaletteInput')?.value || '');
      }
    }).catch(() => { });

    api.get('/roster').then(async (rr) => {
      _cmdRosterFetching = false;
      if (!rr?.ok || !rr.rosters) return;
      let devs = _cmdCachedDevs;
      if (!devs.length) devs = (await api.get('/devices')) || [];
      const map = new Map();
      for (const row of rr.rosters) {
        if (!row.ok) continue;
        const d = devs.find((x) => x.id === row.device_id) || { id: row.device_id, name: `Device ${row.device_id}` };
        for (const u of row.users || []) {
          const key = `${u.employeeNo}||${String(u.name || '').trim().toLowerCase()}`;
          if (!map.has(key)) map.set(key, { u, on: [] });
          map.get(key).on.push(d);
        }
      }
      _cmdCachedEntries = [...map.values()];
      _cmdCachedUsers = _cmdCachedEntries.map((e) => e.u);
      if (_cmdPaletteOpen) renderCommandPalette($('#cmdPaletteInput')?.value || '');
    }).catch(() => { _cmdRosterFetching = false; });
  }

  renderCommandPalette('');
  setTimeout(() => input.focus(), 30);
}

function closeCommandPalette() {
  const backdrop = $('#cmdPaletteBackdrop');
  if (!backdrop) return;
  _cmdPaletteOpen = false;
  backdrop.hidden = true;
}

function renderCommandPalette(query) {
  const container = $('#cmdPaletteResults');
  if (!container) return;
  const q = String(query || '').trim().toLowerCase();

  const isLight = document.documentElement.dataset.theme === 'light';
  const actions = [
    {
      id: 'act-theme',
      group: 'Quick Actions',
      title: isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode',
      subtitle: `Currently in ${isLight ? 'light' : 'dark'} mode`,
      icon: isLight ? ICONS.moon : ICONS.sun,
      badge: 'Theme',
      search: 'theme dark light mode switch appearance color',
      run: () => {
        closeCommandPalette();
        const next = isLight ? 'dark' : 'light';
        document.documentElement.dataset.theme = next;
        localStorage.setItem('worknest_theme', next);
        toast(`Theme set to ${next} mode`, 'ok');
      },
    },
    {
      id: 'act-daypass',
      group: 'Quick Actions',
      title: 'Create Day Pass',
      subtitle: 'Issue a temporary access PIN or visitor pass',
      icon: ICONS.card,
      badge: 'Visitor',
      search: 'day pass create temporary visitor ticket pin guest badge',
      run: async () => {
        closeCommandPalette();
        let devs = _cmdCachedDevs;
        if (!devs.length) devs = await api.get('/devices');
        dayPassModal(devs);
      },
    },
    {
      id: 'act-adduser',
      group: 'Quick Actions',
      title: 'Add New User / Member',
      subtitle: 'Enroll a new person with room and credential assignments',
      icon: ICONS.userPlus,
      badge: 'Enroll',
      search: 'add new user member enroll person create employee',
      run: async () => {
        closeCommandPalette();
        let devs = _cmdCachedDevs;
        if (!devs.length) devs = await api.get('/devices');
        addUserModal(devs[0], devs, true);
      },
    },
    {
      id: 'act-syncall',
      group: 'Quick Actions',
      title: 'Sync All Pending Changes',
      subtitle: 'Push queued user/card sync updates across all machines',
      icon: ICONS.sync,
      badge: 'Sync',
      search: 'sync all pending push queue offline machines terminals',
      run: () => {
        closeCommandPalette();
        $('#syncAll')?.click();
      },
    },
    {
      id: 'act-onlinecheck',
      group: 'Quick Actions',
      title: 'Run Diagnostics & Reachability Check',
      subtitle: 'Probe all terminals and refresh network online status',
      icon: ICONS.zap,
      badge: 'Network',
      search: 'diagnostics test ping reachability online check machines health',
      run: async () => {
        closeCommandPalette();
        toast('Running reachability check…');
        const r = await api.post('/online-check?force=1');
        showCloudBlockedBar(!!r?.blocked);
        toast(r?.blocked ? 'Terminals unreachable — marked offline' : r?.ok ? 'All terminal reachability checks completed' : 'Diagnostic check failed', r?.ok && !r?.blocked ? 'ok' : 'err');
        if (current === 'devices') devices();
        else if (current === 'dashboard') overview();
      },
    },
    {
      id: 'act-sync-clocks',
      group: 'Quick Actions',
      title: 'Sync Machine Clocks',
      subtitle: 'Synchronize terminal RTC clocks with dashboard server time',
      icon: ICONS.clock,
      badge: 'Time',
      search: 'sync time clock machine date rtc calibrate ntp time-sync',
      run: () => {
        closeCommandPalette();
        go('devices');
        setTimeout(() => $('#syncTimeAll')?.click(), 300);
      },
    },
    {
      id: 'act-exportcsv',
      group: 'Quick Actions',
      title: 'Export Users to CSV',
      subtitle: 'Download member roster and credentials to spreadsheet',
      icon: ICONS.download,
      badge: 'Export',
      search: 'export users members csv download excel spreadsheet',
      run: () => {
        closeCommandPalette();
        if (_cmdCachedEntries.length) {
          exportUsersCsv(_cmdCachedEntries);
        } else {
          go('users');
        }
      },
    },
  ];

  // Add individual door unlock actions for reachable / known machines
  if (_cmdCachedDevs && _cmdCachedDevs.length) {
    for (const dev of _cmdCachedDevs) {
      actions.push({
        id: `act-unlock-${dev.id}`,
        group: 'Quick Actions',
        title: `Unlock Door: ${dev.name}`,
        subtitle: `Trigger instant pulse unlock signal · ${dev.code ? 'Room ' + dev.code : dev.ip || 'Terminal'}`,
        icon: ICONS.unlock,
        badge: dev.online ? 'Online' : 'Offline',
        badgeCls: dev.online ? 'synced' : 'blocked',
        search: `unlock door ${dev.name} ${dev.code || ''} ${dev.ip || ''} open pulse gate room entrance`,
        run: async () => {
          closeCommandPalette();
          const ok = await confirmDialog({
            title: 'Unlock Door',
            message: `Unlock the door on ${dev.name} now?`,
            confirmText: 'Unlock Door',
          });
          if (!ok) return;
          toast(`Unlocking ${dev.name}…`);
          const r = await api.post(`/devices/${dev.id}/door`, { cmd: 'open' });
          toast(r.ok ? `${dev.name} unlocked` : `Failed: ${r.error || 'error'}`, r.ok ? 'ok' : 'err');
        },
      });
    }
  }

  // 2. Navigation Shortcuts
  const navItems = [
    {
      id: 'nav-dash',
      group: 'Navigation',
      title: 'Go to Dashboard',
      subtitle: 'Overview stats, machine health, and recent scans',
      icon: ICONS.analytics,
      badge: 'Home',
      search: 'dashboard home overview stats activity',
      run: () => { closeCommandPalette(); go('dashboard'); },
    },
    {
      id: 'nav-users',
      group: 'Navigation',
      title: 'Go to Users & Members',
      subtitle: 'Manage user access, enrollments, and room permissions',
      icon: ICONS.user,
      badge: 'Roster',
      search: 'users members employees roster people profiles directory',
      run: () => { closeCommandPalette(); go('users'); },
    },
    {
      id: 'nav-devices',
      group: 'Navigation',
      title: 'Go to Machines & Terminals',
      subtitle: 'Hikvision terminals, door relay controls, and hardware config',
      icon: ICONS.machine,
      badge: 'Hardware',
      search: 'machines terminals devices hardware hikvision doors relays readers',
      run: () => { closeCommandPalette(); go('devices'); },
    },
    {
      id: 'nav-cards',
      group: 'Navigation',
      title: 'Go to Cards Management',
      subtitle: 'RFID cards, unassigned badges, and card scanner reader',
      icon: ICONS.card,
      badge: 'RFID',
      search: 'cards rfid badges access fobs tag reader credentials',
      run: () => { closeCommandPalette(); go('cards'); },
    },
    {
      id: 'nav-bookings',
      group: 'Navigation',
      title: 'Go to Bookings',
      subtitle: 'Meeting room reservations and scheduled time slots',
      icon: ICONS.clock,
      badge: 'Schedule',
      search: 'bookings reservations meeting rooms calendar schedule slots calendar',
      run: () => { closeCommandPalette(); go('bookings'); },
    },
    {
      id: 'nav-logs',
      group: 'Navigation',
      title: 'Go to Activity Logs',
      subtitle: 'Live access log stream, card swipes, and door events',
      icon: ICONS.clock,
      badge: 'Events',
      search: 'activity log access swipes events stream history live audit',
      run: () => { closeCommandPalette(); go('logs'); },
    },
    {
      id: 'nav-analytics',
      group: 'Navigation',
      title: 'Go to Analytics & Occupancy',
      subtitle: 'Scan volume breakdown, peak hours, and user analytics',
      icon: ICONS.analytics,
      badge: 'Insights',
      search: 'analytics charts occupancy graphs metrics peak hours scans trends',
      run: () => { closeCommandPalette(); go('analytics'); },
    },
    {
      id: 'nav-audit',
      group: 'Navigation',
      title: 'Go to Admin Audit Log',
      subtitle: 'Security audit trail of operator changes and logins',
      icon: ICONS.audit,
      badge: 'Audit',
      search: 'audit security log operator changes admin trail tamper compliance',
      run: () => { closeCommandPalette(); go('audit'); },
    },
  ];

  // 2. Terminals & Machines (if query is present)
  const devItems = [];
  if (_cmdCachedDevs && _cmdCachedDevs.length && q) {
    for (const dev of _cmdCachedDevs) {
      const devSearch = `${dev.name} ${dev.location || ''} ${dev.code || ''} ${dev.host} ${dev.port} ${dev.model || ''} ${dev.serial || ''} ${dev.grp || ''}`.toLowerCase();
      if (devSearch.includes(q)) {
        devItems.push({
          id: `dev-${dev.id}`,
          group: 'Terminals & Machines',
          title: dev.name,
          subtitle: `${dev.host}:${dev.port} · ${dev.model || 'Hikvision Terminal'} · ${dev.code ? 'Room ' + dev.code : (dev.grp || 'Access Door')}`,
          icon: ICONS.machine,
          badge: dev.online ? 'Online' : 'Offline',
          badgeCls: dev.online ? 'synced' : 'blocked',
          search: devSearch,
          run: () => {
            closeCommandPalette();
            go('devices');
            setTimeout(() => {
              const row = document.getElementById(`dev-row-${dev.id}`);
              if (row) {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                row.classList.add('highlight-jump');
                setTimeout(() => row.classList.remove('highlight-jump'), 3000);
              }
            }, 300);
          },
        });
      }
    }
  }

  // 3. Members & Employees (if query is present)
  const memberItems = [];
  if (_cmdCachedEntries && _cmdCachedEntries.length && q) {
    for (const e of _cmdCachedEntries) {
      const u = e.u;
      const rooms = (e.on || []).map((d) => d.code ? `Room ${d.code}` : d.name).join(', ');
      const cards = Array.isArray(u.cards) ? u.cards.join(' ') : (u.cardNo || '');
      const searchStr = `${u.name || ''} ${u.employeeNo || ''} ${cards} ${rooms} ${u.email || ''}`.toLowerCase();

      if (searchStr.includes(q)) {
        const creds = [];
        if (u.numOfCard || (Array.isArray(u.cards) && u.cards.length)) {
          const cCount = u.numOfCard || u.cards.length;
          creds.push(`${cCount} card${cCount > 1 ? 's' : ''}`);
        }
        if (u.numOfFP) creds.push(`${u.numOfFP} fp`);
        if (u.numOfFace) creds.push(`${u.numOfFace} face`);
        const credDesc = creds.join(' · ') || 'No credentials';

        memberItems.push({
          id: `usr-${u.employeeNo}`,
          group: 'Members & Employees',
          title: u.name || `User #${u.employeeNo}`,
          subtitle: `Emp #${u.employeeNo} · ${credDesc} · ${rooms || 'No room assigned'}`,
          icon: renderAvatar(u.name, 'sm'),
          badge: u.localUIRight ? 'Admin' : 'Member',
          badgeCls: u.localUIRight ? 'admin' : '',
          search: searchStr,
          run: async () => {
            closeCommandPalette();
            let devs = _cmdCachedDevs;
            if (!devs.length) devs = await api.get('/devices');
            userProfileModal(e);
          },
        });
      }
    }
  }

  // Filter actions and navigation by query
  const matchedActions = q
    ? actions.filter((a) => a.search.toLowerCase().includes(q) || a.title.toLowerCase().includes(q) || a.subtitle.toLowerCase().includes(q))
    : actions;

  const matchedNav = q
    ? navItems.filter((n) => n.search.toLowerCase().includes(q) || n.title.toLowerCase().includes(q) || n.subtitle.toLowerCase().includes(q))
    : navItems;

  // Assemble list with groups (terminals and members prioritized when searching)
  const groups = [];
  if (devItems.length) groups.push({ title: 'Terminals & Machines', items: devItems.slice(0, 8) });
  if (memberItems.length) groups.push({ title: 'Members & Employees', items: memberItems.slice(0, 15) });
  if (matchedActions.length) groups.push({ title: 'Quick Actions', items: matchedActions });
  if (matchedNav.length) groups.push({ title: 'Navigation', items: matchedNav });

  // Flatten items for indexing
  _cmdCurrentItems = [];
  let flatIdx = 0;
  let html = '';

  if (!groups.length) {
    container.innerHTML = `
      <div style="padding:40px 16px;text-align:center;color:var(--text-muted);font-size:13px;">
        <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:var(--text-main);">No matches found</p>
        <span class="hint">No commands, members, or doors found matching "<b>${esc(query)}</b>"</span>
      </div>
    `;
    return;
  }

  for (const grp of groups) {
    html += `<div class="cmd-group-title">${esc(grp.title)}</div>`;
    for (const item of grp.items) {
      item._flatIdx = flatIdx;
      _cmdCurrentItems.push(item);
      const isSelected = flatIdx === _cmdSelectedIndex;
      html += `
        <div class="cmd-item ${isSelected ? 'active-cmd-item' : ''}" data-cmd-idx="${flatIdx}">
          <div class="cmd-item-left">
            <div class="cmd-item-icon">${item.icon}</div>
            <div class="cmd-item-info">
              <span class="cmd-item-title">${esc(item.title)}</span>
              <span class="cmd-item-subtitle">${esc(item.subtitle)}</span>
            </div>
          </div>
          <div class="cmd-item-right">
            ${item.badge ? `<span class="badge ${item.badgeCls || ''}" style="font-size:10px;">${esc(item.badge)}</span>` : ''}
            <kbd style="font-size:10px;padding:2px 5px;background:rgba(255,255,255,0.06);border:1px solid var(--border);border-radius:4px;color:var(--text-faint);">↵</kbd>
          </div>
        </div>
      `;
      flatIdx++;
    }
  }

  if (_cmdSelectedIndex >= _cmdCurrentItems.length) {
    _cmdSelectedIndex = 0;
  }

  container.innerHTML = html;

  container.querySelectorAll('.cmd-item').forEach((el) => {
    const idx = Number(el.dataset.cmdIdx);
    el.addEventListener('click', () => {
      if (_cmdCurrentItems[idx]) _cmdCurrentItems[idx].run();
    });
    el.addEventListener('mouseenter', () => {
      _cmdSelectedIndex = idx;
      updateCmdSelection();
    });
  });

  updateCmdSelection();
}

function updateCmdSelection() {
  const container = $('#cmdPaletteResults');
  if (!container) return;
  const items = container.querySelectorAll('.cmd-item');
  items.forEach((it, i) => {
    if (i === _cmdSelectedIndex) {
      it.classList.add('active-cmd-item');
      it.scrollIntoView({ block: 'nearest' });
    } else {
      it.classList.remove('active-cmd-item');
    }
  });
}

function initCommandPalette() {
  $('#cmdPaletteBtn')?.addEventListener('click', () => openCommandPalette());
  $('#cmdPaletteClose')?.addEventListener('click', () => closeCommandPalette());
  $('#cmdPaletteBackdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'cmdPaletteBackdrop') closeCommandPalette();
  });

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (_cmdPaletteOpen) closeCommandPalette();
      else openCommandPalette();
      return;
    }
    if (e.key === 'Escape' && _cmdPaletteOpen) {
      e.preventDefault();
      closeCommandPalette();
      return;
    }
  });

  const input = $('#cmdPaletteInput');
  if (input) {
    input.addEventListener('input', (e) => {
      _cmdSelectedIndex = 0;
      renderCommandPalette(e.target.value);
    });

    input.addEventListener('keydown', (e) => {
      if (!_cmdCurrentItems.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _cmdSelectedIndex = (_cmdSelectedIndex + 1) % _cmdCurrentItems.length;
        updateCmdSelection();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _cmdSelectedIndex = (_cmdSelectedIndex - 1 + _cmdCurrentItems.length) % _cmdCurrentItems.length;
        updateCmdSelection();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = _cmdCurrentItems[_cmdSelectedIndex];
        if (selected) selected.run();
      }
    });
  }
}

initCommandPalette();

go('dashboard');

