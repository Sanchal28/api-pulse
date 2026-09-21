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

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

loadProjects();
