const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const store = require('./db');
const { evaluate } = require('./security-flags');
const { requireAuth, JWT_SECRET } = require('./auth-middleware');
const { PORT, CORS_ORIGIN } = require('./config');

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ---------- helpers ----------
function genId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}
function genProjectKey() {
  return `pk_live_${crypto.randomBytes(12).toString('hex')}`;
}
function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}
function findProjectByKey(key) {
  return store.db.projects.find(p => p.projectKey === key);
}
function ownsProject(userId, projectKey) {
  const p = findProjectByKey(projectKey);
  return p && p.userId === userId;
}
function cleanEmail(email) {
  return String(email || '').trim().toLowerCase();
}
function isValidMethod(method) {
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(String(method || '').toUpperCase());
}
function normalizeEvent(raw) {
  const event = raw || {};
  const type = String(event.type || '').toLowerCase();
  const method = String(event.method || '').toUpperCase();
  const status = Number(event.status);
  const duration = Number(event.duration) || 0;
  const responseSize = Number(event.responseSize);

  if (!event.projectKey || !findProjectByKey(event.projectKey)) return { error: 'Unknown project key' };
  if (!['incoming', 'outgoing'].includes(type)) return { error: 'type must be incoming or outgoing' };
  if (!event.api || String(event.api).length > 500) return { error: 'api is required and must be under 500 characters' };
  if (!isValidMethod(method)) return { error: 'method is invalid' };
  if (!Number.isInteger(status) || status < 100 || status > 599) return { error: 'status must be a valid HTTP status code' };
  if (duration < 0 || duration > 10 * 60 * 1000) return { error: 'duration is out of range' };

  return {
    event: {
      id: genId('evt'),
      projectKey: event.projectKey,
      type,
      api: String(event.api),
      method,
      duration,
      status,
      responseSize: Number.isFinite(responseSize) && responseSize >= 0 ? responseSize : undefined,
      timestamp: Date.now(),
    }
  };
}

const rateBuckets = new Map();
function rateLimit(name, limit, windowMs) {
  return (req, res, next) => {
    const key = `${name}:${req.ip}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count++;
    rateBuckets.set(key, bucket);
    if (bucket.count > limit) return res.status(429).json({ error: 'Too many requests, try again later' });
    next();
  };
}

// ================= AUTH =================
app.post('/api/auth/signup', rateLimit('auth', 20, 15 * 60 * 1000), (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = cleanEmail(email);
  if (!normalizedEmail || !password) return res.status(400).json({ error: 'email and password are required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });
  if (store.db.users.find(u => u.email.toLowerCase() === normalizedEmail)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }
  const user = {
    id: genId('usr'),
    email: normalizedEmail,
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: Date.now(),
  };
  store.db.users.push(user);
  store.save();
  const token = signToken(user.id);
  res.json({ token, user: { id: user.id, email: user.email } });
});

app.post('/api/auth/login', rateLimit('auth', 20, 15 * 60 * 1000), (req, res) => {
  const { email, password } = req.body || {};
  const user = store.db.users.find(u => u.email.toLowerCase() === cleanEmail(email));
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = signToken(user.id);
  res.json({ token, user: { id: user.id, email: user.email } });
});

// ================= PROJECTS =================
app.post('/api/projects', requireAuth, (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'Project name is required' });
  const project = {
    id: genId('proj'),
    userId: req.userId,
    name: name.trim(),
    projectKey: genProjectKey(),
    createdAt: Date.now(),
  };
  store.db.projects.push(project);
  store.save();
  res.json({ project });
});

app.get('/api/projects', requireAuth, (req, res) => {
  const projects = store.db.projects.filter(p => p.userId === req.userId);
  res.json({ projects });
});

app.delete('/api/projects/:projectKey', requireAuth, (req, res) => {
  const { projectKey } = req.params;
  if (!ownsProject(req.userId, projectKey)) return res.status(404).json({ error: 'Project not found' });
  store.db.projects = store.db.projects.filter(p => p.projectKey !== projectKey);
  store.db.events = store.db.events.filter(e => e.projectKey !== projectKey);
  store.db.flags = store.db.flags.filter(f => f.projectKey !== projectKey);
  store.save();
  res.json({ ok: true });
});

// ================= INGESTION (called by apipulse-sdk, no user JWT — uses project key) =================
app.post('/api/ingest', rateLimit('ingest', 1200, 60 * 1000), (req, res) => {
  const normalized = normalizeEvent(req.body);
  if (normalized.error) return res.status(normalized.error === 'Unknown project key' ? 404 : 400).json({ error: normalized.error });
  const event = normalized.event;
  store.db.events.push(event);

  // recent history for this project, used by the rule engine
  const recent = store.db.events.filter(e => e.projectKey === event.projectKey);
  const newFlags = evaluate(event, recent);
  if (newFlags.length) store.db.flags.push(...newFlags);

  store.trim();
  store.save();
  res.json({ ok: true, flags: newFlags.length });
});

// Fire many events at once (used by the demo traffic generator, keeps SDK API simple too)
app.post('/api/ingest/batch', rateLimit('ingest', 300, 60 * 1000), (req, res) => {
  const { events } = req.body || {};
  if (!Array.isArray(events)) return res.status(400).json({ error: 'events must be an array' });
  let stored = 0, flagCount = 0;
  for (const raw of events) {
    const normalized = normalizeEvent(raw);
    if (normalized.error) continue;
    const event = normalized.event;
    store.db.events.push(event);
    const recent = store.db.events.filter(e => e.projectKey === event.projectKey);
    const newFlags = evaluate(event, recent);
    if (newFlags.length) { store.db.flags.push(...newFlags); flagCount += newFlags.length; }
    stored++;
  }
  store.trim();
  store.save();
  res.json({ ok: true, stored, flags: flagCount });
});

// ================= DASHBOARD =================
app.get('/api/dashboard/:projectKey/feed', requireAuth, (req, res) => {
  const { projectKey } = req.params;
  if (!ownsProject(req.userId, projectKey)) return res.status(404).json({ error: 'Project not found' });
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const feed = store.db.events
    .filter(e => e.projectKey === projectKey)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
  res.json({ feed });
});

app.get('/api/dashboard/:projectKey/summary', requireAuth, (req, res) => {
  const { projectKey } = req.params;
  if (!ownsProject(req.userId, projectKey)) return res.status(404).json({ error: 'Project not found' });
  const events = store.db.events.filter(e => e.projectKey === projectKey);

  const byApi = {};
  for (const e of events) {
    byApi[e.api] = byApi[e.api] || { api: e.api, calls: [], type: e.type };
    byApi[e.api].calls.push(e);
  }
  const summary = Object.values(byApi).map(group => {
    const calls = group.calls;
    const total = calls.length;
    const avgLatency = Math.round(calls.reduce((s, c) => s + c.duration, 0) / total);
    const successCount = calls.filter(c => c.status >= 200 && c.status < 400).length;
    const successRate = Math.round((successCount / total) * 100);
    return { api: group.api, type: group.type, totalCalls: total, avgLatency, successRate };
  }).sort((a, b) => b.totalCalls - a.totalCalls);

  const overall = {
    totalCalls: events.length,
    avgLatency: events.length ? Math.round(events.reduce((s, e) => s + e.duration, 0) / events.length) : 0,
    successRate: events.length ? Math.round((events.filter(e => e.status >= 200 && e.status < 400).length / events.length) * 100) : 0,
    activeApis: summary.length,
  };

  res.json({ summary, overall });
});

app.get('/api/dashboard/:projectKey/flags', requireAuth, (req, res) => {
  const { projectKey } = req.params;
  if (!ownsProject(req.userId, projectKey)) return res.status(404).json({ error: 'Project not found' });
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const flags = store.db.flags
    .filter(f => f.projectKey === projectKey)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
  res.json({ flags });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`API Pulse backend running on http://localhost:${PORT}`);
});
