// db.js — tiny file-backed JSON store.
// No external DB needed: keeps the whole project "npm install && run".
const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'data.json');

function load() {
  if (!fs.existsSync(DB_FILE)) {
    return { users: [], projects: [], events: [], flags: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return { users: [], projects: [], events: [], flags: [] };
  }
}

let db = load();
let saveTimer = null;

function save() {
  // debounce writes so a burst of ingest calls doesn't hammer the disk
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    saveTimer = null;
  }, 150);
}

// keep event/flag arrays from growing forever in a demo project
const MAX_EVENTS_PER_PROJECT = 500;
const MAX_FLAGS_PER_PROJECT = 200;

function trim() {
  const byProject = {};
  for (const e of db.events) {
    byProject[e.projectKey] = byProject[e.projectKey] || [];
    byProject[e.projectKey].push(e);
  }
  let kept = [];
  for (const key in byProject) {
    const list = byProject[key].slice(-MAX_EVENTS_PER_PROJECT);
    kept = kept.concat(list);
  }
  db.events = kept;

  const byProjectF = {};
  for (const f of db.flags) {
    byProjectF[f.projectKey] = byProjectF[f.projectKey] || [];
    byProjectF[f.projectKey].push(f);
  }
  let keptF = [];
  for (const key in byProjectF) {
    const list = byProjectF[key].slice(-MAX_FLAGS_PER_PROJECT);
    keptF = keptF.concat(list);
  }
  db.flags = keptF;
}

module.exports = {
  get db() { return db; },
  save,
  trim,
};
