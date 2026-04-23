// public/js/api.js
// ── Devnix API client ─────────────────────────────────────────────────────────
// All backend communication lives here.
// Every exported function returns parsed JSON or throws an Error.

// ── Detect API base URL ───────────────────────────────────────────────────────
// Priority:
//   1. <meta name="api-base" content="https://..."> tag (non-empty) — production
//   2. window.DEVNIX_API variable set before this script loads
//   3. Auto-detect: same hostname as the page, port 3001 (dev default)
//
// Rule 3 is the KEY fix: it reads location.hostname so if the browser
// opened localhost:XXXXX, the API call also goes to localhost:3001 — matching
// origins. If it opened 127.0.0.1:XXXXX, API goes to 127.0.0.1:3001.
// This eliminates the CORS mismatch between localhost and 127.0.0.1.

(function resolveApiBase() {
  // 1. Meta tag (only if non-empty)
  const meta = document.querySelector('meta[name="api-base"]');
  if (meta && meta.content && meta.content.trim() !== '') {
    window._DEVNIX_API_BASE = meta.content.replace(/\/$/, '') + '/api';
    return;
  }
  // 2. Manual override
  if (window.DEVNIX_API && window.DEVNIX_API.trim()) {
    window._DEVNIX_API_BASE = window.DEVNIX_API.replace(/\/$/, '') + '/api';
    return;
  }
  // 3. Auto-detect — same host as the page, backend always on 3001
  window._DEVNIX_API_BASE = `http://${location.hostname}:3001/api`;
})();

const API_BASE = window._DEVNIX_API_BASE;
console.log('[Devnix] API base →', API_BASE);

// ── Token storage ─────────────────────────────────────────────────────────────
function getToken()   { return localStorage.getItem('devnix_token'); }
function setToken(t)  { localStorage.setItem('devnix_token', t); }
function clearToken() { localStorage.removeItem('devnix_token'); }

// ── Core fetch wrapper ────────────────────────────────────────────────────────
async function apiFetch(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new Error('Cannot reach server — is the backend running on port 3001?');
  }

  let data;
  try { data = await res.json(); } catch { data = {}; }

  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
const Auth = {
  async register(email, password) {
    const d = await apiFetch('/auth/register', { method: 'POST', body: { email, password } });
    setToken(d.token);
    return d.user;
  },
  async login(email, password) {
    const d = await apiFetch('/auth/login', { method: 'POST', body: { email, password } });
    setToken(d.token);
    return d.user;
  },
  async me() {
    const d = await apiFetch('/auth/me');
    return d.user;
  },
  logout() { clearToken(); },
};

// ── Settings ──────────────────────────────────────────────────────────────────
const Settings = {
  async setDark(dark) {
    const d = await apiFetch('/user/settings', { method: 'PATCH', body: { dark } });
    return d.user;
  },
};

// ── Tasks ─────────────────────────────────────────────────────────────────────
const Tasks = {
  async getAll()         { return (await apiFetch('/user/tasks')).tasks; },
  async add(name, cat)   { return (await apiFetch('/user/tasks', { method:'POST', body:{name,cat} })).tasks; },
  async rename(id, name) { return (await apiFetch(`/user/tasks/${id}`, { method:'PATCH', body:{name} })).tasks; },
  async remove(id)       { return (await apiFetch(`/user/tasks/${id}`, { method:'DELETE' })).tasks; },
  async saveCheck(done, skipped, notes) {
    return apiFetch('/user/check', { method:'PATCH', body:{done,skipped,notes} });
  },
};

// ── Transactions ──────────────────────────────────────────────────────────────
const Transactions = {
  async getAll()            { return (await apiFetch('/user/transactions')).transactions; },
  async add(tx)             { return (await apiFetch('/user/transactions', { method:'POST', body:tx })).transactions; },
  async update(id, changes) { return (await apiFetch(`/user/transactions/${id}`, { method:'PATCH', body:changes })).transactions; },
  async remove(id)          { return (await apiFetch(`/user/transactions/${id}`, { method:'DELETE' })).transactions; },
  async bulkRemove(ids)     { return (await apiFetch('/user/transactions', { method:'DELETE', body:{ids} })).transactions; },
};

// ── Journals ──────────────────────────────────────────────────────────────────
const Journals = {
  async getAll()            { return (await apiFetch('/user/journals')).journals; },
  async add(entry)          { return (await apiFetch('/user/journals', { method:'POST', body:entry })).journals; },
  async update(id, changes) { return (await apiFetch(`/user/journals/${id}`, { method:'PATCH', body:changes })).journals; },
  async remove(id)          { return (await apiFetch(`/user/journals/${id}`, { method:'DELETE' })).journals; },
};

// ── Savings Goals ─────────────────────────────────────────────────────────────
const Goals = {
  async getAll()            { return (await apiFetch('/user/goals')).savingsGoals; },
  async add(goal)           { return (await apiFetch('/user/goals', { method:'POST', body:goal })).savingsGoals; },
  async update(id, changes) { return (await apiFetch(`/user/goals/${id}`, { method:'PATCH', body:changes })).savingsGoals; },
  async remove(id)          { return (await apiFetch(`/user/goals/${id}`, { method:'DELETE' })).savingsGoals; },
};

// ── Budgets ───────────────────────────────────────────────────────────────────
const Budgets = {
  async getAll()              { return (await apiFetch('/user/budgets')).budgets; },
  async set(category, amount) { return (await apiFetch('/user/budgets', { method:'PATCH', body:{category,amount} })).budgets; },
  async remove(category)      { return (await apiFetch(`/user/budgets/${category}`, { method:'DELETE' })).budgets; },
};

// ── Export ────────────────────────────────────────────────────────────────────
window.API = { Auth, Settings, Tasks, Transactions, Journals, Goals, Budgets, getToken };
