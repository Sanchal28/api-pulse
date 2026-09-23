const API_BASE = '';
const token = localStorage.getItem('apipulse_token');
if (!token) window.location.href = 'index.html';

document.getElementById('userChip').textContent = localStorage.getItem('apipulse_email') || '';
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('apipulse_token');
  localStorage.removeItem('apipulse_email');
  window.location.href = 'index.html';
});

function authHeaders() {
  return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
}

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, { ...options, headers: authHeaders() });
  if (res.status === 401) {
    localStorage.removeItem('apipulse_token');
    window.location.href = 'index.html';
    return;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

let projects = [];
let activeProjectKey = null;
let pollTimer = null;
let pulseHistory = []; // recent call counts, drives the header pulse-line

// ---------------- projects ----------------
async function loadProjects() {
  const data = await api('/api/projects');
  projects = data.projects || [];
  renderProjectChips();
  if (!projects.length) {
    document.getElementById('emptyState').style.display = 'block';
    document.getElementById('dashboardContent').style.display = 'none';
    stopPolling();
    return;
  }
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('dashboardContent').style.display = 'block';
  if (!activeProjectKey || !projects.find(p => p.projectKey === activeProjectKey)) {
    activeProjectKey = projects[0].projectKey;
  }
  renderProjectChips();
  startPolling();
}

function renderProjectChips() {
  const bar = document.getElementById('projectsBar');
  bar.querySelectorAll('.project-chip').forEach(el => el.remove());
  const newBtn = document.getElementById('newProjectBtn');
  projects.forEach(p => {
    const chip = document.createElement('button');
    chip.className = 'project-chip' + (p.projectKey === activeProjectKey ? ' active' : '');
    chip.textContent = p.name;
    chip.addEventListener('click', () => {
      activeProjectKey = p.projectKey;
      renderProjectChips();
      refreshAll();
    });
    bar.insertBefore(chip, newBtn);
  });
}

// ---------------- new project modal ----------------
const newProjectModal = document.getElementById('newProjectModal');
document.getElementById('newProjectBtn').addEventListener('click', () => openNewProjectModal());
document.getElementById('emptyCreateBtn').addEventListener('click', () => openNewProjectModal());
document.getElementById('cancelProjectBtn').addEventListener('click', () => newProjectModal.classList.remove('open'));

function openNewProjectModal() {
  document.getElementById('projectNameInput').value = '';
  document.getElementById('projectErrorBox').style.display = 'none';
  newProjectModal.classList.add('open');
}

document.getElementById('createProjectBtn').addEventListener('click', async () => {
  const name = document.getElementById('projectNameInput').value.trim();
  const errBox = document.getElementById('projectErrorBox');
  if (!name) { errBox.textContent = 'Give the project a name.'; errBox.style.display = 'block'; return; }
  try {
    const data = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
    newProjectModal.classList.remove('open');
    await loadProjects();
    activeProjectKey = data.project.projectKey;
    renderProjectChips();
    refreshAll();
    openSetupModal(data.project.projectKey);
  } catch (e) {
    errBox.textContent = e.message;
    errBox.style.display = 'block';
  }
});

// ---------------- setup modal (shows key + snippet) ----------------
const setupModal = document.getElementById('setupModal');
function openSetupModal(projectKey) {
  document.getElementById('setupKey').textContent = projectKey;
  document.getElementById('setupSnippet').innerHTML =
    `<span class="k">const</span> apipulse = require(<span class="s">'apipulse-sdk'</span>);\n` +
    `apipulse.init(app, { projectKey: <span class="s">'${projectKey}'</span> });`;
  setupModal.classList.add('open');
}
document.getElementById('doneSetupBtn').addEventListener('click', () => setupModal.classList.remove('open'));
document.getElementById('copyKeyBtn').addEventListener('click', () => {
  const key = document.getElementById('setupKey').textContent;
  navigator.clipboard.writeText(key);
  const btn = document.getElementById('copyKeyBtn');
  btn.textContent = 'Copied';
  setTimeout(() => (btn.textContent = 'Copy'), 1200);
});

// ---------------- polling ----------------
function startPolling() {
  stopPolling();
  refreshAll();
  pollTimer = setInterval(refreshAll, 3000);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function refreshAll() {
  if (!activeProjectKey) return;
  try {
    const [feedData, summaryData, flagsData] = await Promise.all([
      api(`/api/dashboard/${activeProjectKey}/feed?limit=50`),
      api(`/api/dashboard/${activeProjectKey}/summary`),
      api(`/api/dashboard/${activeProjectKey}/flags?limit=30`),
    ]);
    renderCards(summaryData.overall, flagsData.flags);
    renderFeed(feedData.feed);
    renderSummary(summaryData.summary);
    renderFlags(flagsData.flags);
    updatePulse(feedData.feed);
    renderTrafficChart(feedData.feed);
    renderStatusBreakdown(feedData.feed);
  } catch (e) {
    console.error(e);
  }
}

// ---------------- rendering ----------------
function renderCards(overall, flags) {
  document.getElementById('cardTotal').textContent = overall.totalCalls.toLocaleString();
  document.getElementById('cardLatency').textContent = overall.totalCalls ? `${overall.avgLatency}ms` : '—';
  const successEl = document.getElementById('cardSuccess');
  successEl.textContent = overall.totalCalls ? `${overall.successRate}%` : '—';
  successEl.className = 'value ' + (overall.successRate >= 98 ? 'success' : overall.successRate >= 90 ? 'warning' : 'critical');

  const criticalCount = flags.filter(f => f.severity === 'critical').length;
  const flagsEl = document.getElementById('cardFlags');
  flagsEl.textContent = flags.length;
  flagsEl.className = 'value ' + (criticalCount > 0 ? 'critical' : flags.length > 0 ? 'warning' : 'success');
}

function statusBadgeClass(status) {
  if (status >= 500) return 's5xx';
  if (status >= 400) return 's4xx';
  return 's2xx';
}

function timeAgo(ts) {
  const diff = Math.max(0, Date.now() - ts);
  if (diff < 1000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function renderFeed(feed) {
  const body = document.getElementById('feedBody');
  const empty = document.getElementById('feedEmpty');
  if (!feed.length) { body.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  body.innerHTML = feed.map(e => `
    <tr>
      <td><span class="type-pill ${e.type}">${e.type}</span></td>
      <td>${escapeHtml(e.api)}</td>
      <td>${e.method}</td>
      <td>${e.duration}ms</td>
      <td><span class="badge ${statusBadgeClass(e.status)}">${e.status}</span></td>
      <td>${timeAgo(e.timestamp)}</td>
    </tr>
  `).join('');
}

function renderSummary(summary) {
  const body = document.getElementById('summaryBody');
  const empty = document.getElementById('summaryEmpty');
  if (!summary.length) { body.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  body.innerHTML = summary.map(s => `
    <tr>
      <td>${escapeHtml(s.api)}</td>
      <td>${s.totalCalls}</td>
      <td>${s.avgLatency}ms</td>
      <td><span class="badge ${s.successRate >= 98 ? 's2xx' : s.successRate >= 90 ? 's4xx' : 's5xx'}">${s.successRate}%</span></td>
    </tr>
  `).join('');
}

function renderFlags(flags) {
  const list = document.getElementById('flagsList');
  const empty = document.getElementById('flagsEmpty');
  if (!flags.length) { list.innerHTML = ''; list.appendChild(empty); empty.style.display = 'block'; return; }
  list.innerHTML = flags.map(f => `
    <div class="flag-item">
      <div class="flag-head">
        <span class="flag-sev ${f.severity}">${f.severity === 'critical' ? '● Critical' : '● Warning'}</span>
        <span class="flag-time">${timeAgo(f.timestamp)}</span>
      </div>
      <div class="flag-msg">${escapeHtml(f.message)}</div>
    </div>
  `).join('');
}

function updatePulse(feed) {
  const now = Date.now();
  const lastSecondCount = feed.filter(e => now - e.timestamp < 3000).length;
  pulseHistory.push(lastSecondCount);
  if (pulseHistory.length > 22) pulseHistory.shift();

  const w = 220, h = 30, mid = h / 2;
  const max = Math.max(4, ...pulseHistory);
  const step = w / Math.max(1, pulseHistory.length - 1);
  const points = pulseHistory.map((v, i) => {
    const amp = (v / max) * (h / 2 - 3);
    // alternate up/down like a heartbeat rather than a flat bar chart
    const y = mid + (i % 2 === 0 ? -amp : amp) * (v > 0 ? 1 : 0.15);
    return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  document.getElementById('pulseLine').setAttribute('points', points);
}

// ---------------- charts ----------------
// Buckets the feed (already time-ordered events) into fixed windows so we can
// draw calls/min + avg latency as lines without asking the backend for anything new.
function bucketFeed(feed, bucketCount = 12, rangeMs = 6 * 60 * 1000) {
  const now = Date.now();
  const start = now - rangeMs;
  const bucketMs = rangeMs / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    count: 0,
    durationSum: 0,
    s2xx: 0, s4xx: 0, s5xx: 0,
  }));
  feed.forEach((e) => {
    if (e.timestamp < start) return;
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((e.timestamp - start) / bucketMs)));
    const b = buckets[idx];
    b.count++;
    b.durationSum += e.duration;
    if (e.status >= 500) b.s5xx++;
    else if (e.status >= 400) b.s4xx++;
    else b.s2xx++;
  });
  return buckets.map((b) => ({ ...b, avgDuration: b.count ? Math.round(b.durationSum / b.count) : 0 }));
}

function renderTrafficChart(feed) {
  const svg = document.getElementById('trafficChart');
  const empty = document.getElementById('chartEmpty');
  const buckets = bucketFeed(feed);
  const hasData = buckets.some((b) => b.count > 0);

  if (!hasData) {
    svg.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const W = 760, H = 160, PAD = 10;
  const maxCalls = Math.max(1, ...buckets.map((b) => b.count));
  const maxLatency = Math.max(1, ...buckets.map((b) => b.avgDuration));
  const step = (W - PAD * 2) / Math.max(1, buckets.length - 1);

  const toPoints = (values, max) => values.map((v, i) => {
    const x = PAD + i * step;
    const y = H - PAD - (v / max) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const callsPoints = toPoints(buckets.map((b) => b.count), maxCalls);
  const latencyPoints = toPoints(buckets.map((b) => b.avgDuration), maxLatency);

  let grid = '';
  for (let i = 1; i < 4; i++) {
    const y = (PAD + (i * (H - PAD * 2)) / 4).toFixed(1);
    grid += `<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="#242A32" stroke-width="1" />`;
  }

  svg.innerHTML = `
    ${grid}
    <polyline points="${callsPoints}" fill="none" stroke="#5EEAD4" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />
    <polyline points="${latencyPoints}" fill="none" stroke="#FBBF24" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="5 4" />
  `;
}

function renderStatusBreakdown(feed) {
  const wrap = document.getElementById('statusBreakdown');
  const total = feed.length;
  if (!total) {
    wrap.innerHTML = '<div class="empty-panel" style="padding:0;">No calls recorded yet.</div>';
    return;
  }
  const s2xx = feed.filter((e) => e.status < 400).length;
  const s4xx = feed.filter((e) => e.status >= 400 && e.status < 500).length;
  const s5xx = feed.filter((e) => e.status >= 500).length;
  const pct = (n) => Math.round((n / total) * 100);

  wrap.innerHTML = `
    <div class="status-bar">
      ${s2xx ? `<div class="seg s2xx" style="width:${pct(s2xx)}%"></div>` : ''}
      ${s4xx ? `<div class="seg s4xx" style="width:${pct(s4xx)}%"></div>` : ''}
      ${s5xx ? `<div class="seg s5xx" style="width:${pct(s5xx)}%"></div>` : ''}
    </div>
    <div class="status-legend">
      <span><i class="s2xx"></i> 2xx/3xx — ${s2xx} (${pct(s2xx)}%)</span>
      <span><i class="s4xx"></i> 4xx — ${s4xx} (${pct(s4xx)}%)</span>
      <span><i class="s5xx"></i> 5xx — ${s5xx} (${pct(s5xx)}%)</span>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

loadProjects();