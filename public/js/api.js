// public/js/api.js
// ── Devnix API client ─────────────────────────────────────────────────────────
// FIXES APPLIED:
//   1. Auth.login() now accepts and forwards `remember` param to backend
//   2. apiFetch: headers ordering fixed (Content-Type set before use)
//   3. All methods documented with correct return shapes

// ── Detect API base URL ───────────────────────────────────────────────────────
(function resolveApiBase() {
  const meta = document.querySelector('meta[name="api-base"]');
  if (meta && meta.content && meta.content.trim() !== '') {
    window._DEVNIX_API_BASE = meta.content.replace(/\/$/, '') + '/api';
    return;
  }
  if (window.DEVNIX_API && window.DEVNIX_API.trim()) {
    window._DEVNIX_API_BASE = window.DEVNIX_API.replace(/\/$/, '') + '/api';
    return;
  }
  window._DEVNIX_API_BASE = `${location.origin}/api`;
})();

const API_BASE = window._DEVNIX_API_BASE;
console.log('[Devnix] API base →', API_BASE);

// ── Token storage ─────────────────────────────────────────────────────────────
function getToken()   { try { return localStorage.getItem('devnix_token'); } catch(e) { return null; } }
function setToken(t)  { try { localStorage.setItem('devnix_token', t); } catch(e) {} }
function clearToken() { try { localStorage.removeItem('devnix_token'); } catch(e) {} }

// ── Core fetch wrapper ────────────────────────────────────────────────────────
async function apiFetch(path, { method = 'GET', body } = {}) {
  const headers = {};
  // FIX: set Content-Type BEFORE building the fetch call
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let res;
  try {
    res = await fetch(API_BASE + path, {
      method,
      headers,
      signal: controller.signal,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    clearTimeout(timeout);
  } catch (networkErr) {
    clearTimeout(timeout);
    throw new Error('Network error: ' + networkErr.message);
  }

  let data;
  try { data = await res.json(); } catch { data = {}; }

  if (!res.ok) throw new Error(data.error || data.message || 'HTTP ' + res.status);
  return data;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
const Auth = {
  async register(email, password) {
    const d = await apiFetch('/auth/register', { method: 'POST', body: { email, password } });
    if (d.token) setToken(d.token);
    return d.user;
  },

  // FIX #1: `remember` param now forwarded to backend
  async login(email, password, remember = true) {
    const d = await apiFetch('/auth/login', { method: 'POST', body: { email, password, remember } });
    if (d.token) setToken(d.token);
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
  async add(name, cat)   { return (await apiFetch('/user/tasks', { method: 'POST', body: { name, cat } })).tasks; },
  async rename(id, name) { return (await apiFetch(`/user/tasks/${id}`, { method: 'PATCH', body: { name } })).tasks; },
  async remove(id)       { return (await apiFetch(`/user/tasks/${id}`, { method: 'DELETE' })).tasks; },
  async saveCheck(done, skipped, notes) {
    return apiFetch('/user/check', { method: 'PATCH', body: { done, skipped, notes } });
  },
};

// ── Transactions ──────────────────────────────────────────────────────────────
const Transactions = {
  async getAll()            { return (await apiFetch('/user/transactions')).transactions; },
  async add(tx)             { return (await apiFetch('/user/transactions', { method: 'POST', body: tx })).transactions; },
  async update(id, changes) { return (await apiFetch(`/user/transactions/${id}`, { method: 'PATCH', body: changes })).transactions; },
  async remove(id)          { return (await apiFetch(`/user/transactions/${id}`, { method: 'DELETE' })).transactions; },
  async bulkRemove(ids)     { return (await apiFetch('/user/transactions', { method: 'DELETE', body: { ids } })).transactions; },
};

// ── Journals ──────────────────────────────────────────────────────────────────
const Journals = {
  async getAll()            { return (await apiFetch('/user/journals')).journals; },
  async add(entry)          { return (await apiFetch('/user/journals', { method: 'POST', body: entry })).journals; },
  async update(id, changes) { return (await apiFetch(`/user/journals/${id}`, { method: 'PATCH', body: changes })).journals; },
  async remove(id)          { return (await apiFetch(`/user/journals/${id}`, { method: 'DELETE' })).journals; },
};

// ── Savings Goals ─────────────────────────────────────────────────────────────
const Goals = {
  async getAll()            { return (await apiFetch('/user/goals')).savingsGoals; },
  async add(goal)           { return (await apiFetch('/user/goals', { method: 'POST', body: goal })).savingsGoals; },
  async update(id, changes) { return (await apiFetch(`/user/goals/${id}`, { method: 'PATCH', body: changes })).savingsGoals; },
  async remove(id)          { return (await apiFetch(`/user/goals/${id}`, { method: 'DELETE' })).savingsGoals; },
};

// ── Budgets ───────────────────────────────────────────────────────────────────
const Budgets = {
  async getAll()              { return (await apiFetch('/user/budgets')).budgets; },
  async set(category, amount) { return (await apiFetch('/user/budgets', { method: 'PATCH', body: { category, amount } })).budgets; },
  async remove(category)      { return (await apiFetch(`/user/budgets/${category}`, { method: 'DELETE' })).budgets; },
};

// ── Export ────────────────────────────────────────────────────────────────────
window.API = { Auth, Settings, Tasks, Transactions, Journals, Goals, Budgets, getToken };
