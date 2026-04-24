// public/js/app.js  — Devnix Frontend (fully patched)
// ─────────────────────────────────────────────────────────
// BUG FIXES applied:
//  1. Guard: API is always available (api.js loads first)
//  2. doAuth: passes "remember" checkbox to API.Auth.login
//  3. normaliseUser: safe deep-copy, handles all edge cases
//  4. boot(): null/undefined user guard, timeout fixed
//  5. renderGrid: safe date handling, no crash on empty tasks
//  6. Finance charts: destroy guard prevents canvas reuse crash
//  7. Journal renderJournalPage: safe when journals=[]
//  8. All async handlers: wrapped in try/catch with proper toasts
//  9. Dark-mode toggle: applied before mountApp to avoid flash
// 10. editTxModal: fixed position so it overlays correctly
// ─────────────────────────────────────────────────────────

// ── Global state ──────────────────────────────────────────
let S = { user: null, dark: false };
let wOff = 0, barCI = null, lineCI = null, analyDays = 14;
let dragActive = false, dragVal = false;
let noteCtx = { tid: null, ds: null };
let debTimer = null;
let txSortCol = 'date', txSortAsc = false;
let finCharts = {};
let selectedTxIds = new Set();

const CAT_COL = { health: '#4caf50', work: '#2196f3', study: '#9c27b0', other: '#ff9800' };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const usr = () => S.user;
const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const dStr = d => {
  try {
    const x = d instanceof Date ? d : new Date(d + 'T12:00:00');
    return x.toISOString().slice(0, 10);
  } catch (e) { return ''; }
};
const today = () => new Date().toISOString().slice(0, 10);
const addD = (base, n) => {
  const d = new Date(typeof base === 'string' ? base + 'T12:00:00' : base);
  d.setDate(d.getDate() + n);
  return d;
};
const fmtFull = d => {
  try { return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
  catch (e) { return ''; }
};

// ── Sync indicator ─────────────────────────────────────────
function setSyncState(st) {
  const dot = document.getElementById('syncDot');
  const txt = document.getElementById('syncTxt');
  if (!dot || !txt) return;
  if (st === 'saving') { dot.classList.add('saving'); txt.textContent = 'Saving…'; }
  else { dot.classList.remove('saving'); txt.textContent = 'Saved'; }
}

// ── Toast ──────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const w = document.getElementById('toastWrap');
  if (!w) return;
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  w.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    t.style.transform = 'translateY(-8px)';
    t.style.transition = 'all .3s';
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

// ── Dark mode ──────────────────────────────────────────────
function applyDark() {
  document.body.classList.toggle('dk', !!S.dark);
  const btn = document.getElementById('darkBtn');
  if (btn) btn.textContent = S.dark ? '☀' : '☾';
}

const toggleDark = async () => {
  S.dark = !S.dark;
  applyDark();
  toast(S.dark ? 'Dark mode on' : 'Light mode on');
  try { await API.Settings.setDark(S.dark); } catch (e) { /* non-critical */ }
};

document.getElementById('darkBtn').addEventListener('click', toggleDark);

// ── Auth UI helpers ────────────────────────────────────────
let isUp = false; // false = login, true = register

function setAuthMode(register) {
  isUp = register;
  document.getElementById('aBtn').textContent = register ? 'Create account' : 'Sign in';
  document.getElementById('aToggle').textContent = register ? 'Sign in instead' : 'Create one free';
  document.getElementById('authErr').classList.add('H');
}

document.getElementById('aToggle').addEventListener('click', () => setAuthMode(!isUp));

const showAuthErr = m => {
  const e = document.getElementById('authErr');
  e.textContent = m;
  e.classList.remove('H');
};

document.getElementById('aBtn').addEventListener('click', doAuth);
['aEm', 'aPw'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') doAuth(); });
});

async function doAuth() {
  const em = (document.getElementById('aEm').value || '').trim().toLowerCase();
  const pw = document.getElementById('aPw').value || '';
  const remember = document.getElementById('aRem') ? document.getElementById('aRem').checked : true;

  // Client-side validation
  if (!em || !pw) { showAuthErr('Please fill in all fields.'); return; }
  if (!em.includes('@') || !em.includes('.')) { showAuthErr('Enter a valid email address.'); return; }
  if (pw.length < 6) { showAuthErr('Password must be at least 6 characters.'); return; }

  const btn = document.getElementById('aBtn');
  const origText = btn.textContent;
  btn.textContent = '…';
  btn.disabled = true;
  document.getElementById('authErr').classList.add('H');

  try {
    let user;
    if (isUp) {
      user = await API.Auth.register(em, pw);
    } else {
      user = await API.Auth.login(em, pw, remember);
    }

    if (!user || !user.email) {
      throw new Error('Invalid response from server. Please try again.');
    }

    S.user = normaliseUser(user);
    S.dark = !!(user.dark);
    applyDark();

    toast(isUp ? 'Account created! Welcome to Devnix 🎉' : 'Welcome back! 👋');
    mountApp();
  } catch (err) {
    showAuthErr(err.message || 'Authentication failed. Please try again.');
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
  }
}

async function doLogout() {
  try { API.Auth.logout(); } catch (e) { /* ignore */ }
  S = { user: null, dark: false };
  wOff = 0;
  selectedTxIds.clear();
  // Destroy charts to avoid canvas reuse errors
  Object.keys(finCharts).forEach(k => { try { finCharts[k].destroy(); } catch (e) { } });
  finCharts = {};
  if (barCI) { try { barCI.destroy(); } catch (e) { } barCI = null; }
  if (lineCI) { try { lineCI.destroy(); } catch (e) { } lineCI = null; }

  document.getElementById('appShell').classList.add('H');
  document.getElementById('authView').classList.remove('H');
  document.getElementById('aEm').value = '';
  document.getElementById('aPw').value = '';
  document.getElementById('authErr').classList.add('H');
  setAuthMode(false);
  toast('Signed out.', 'warn');
}

document.getElementById('logoutBtn').addEventListener('click', doLogout);

// ── Normalise user from MongoDB ─────────────────────────────
function toPlainObj(val) {
  if (!val) return {};
  if (val instanceof Map) return Object.fromEntries(val);
  if (typeof val === 'object' && !Array.isArray(val)) return { ...val };
  return {};
}

function normaliseUser(u) {
  if (!u) return null;
  const norm = { ...u };
  norm.done = toPlainObj(norm.done);
  norm.skipped = toPlainObj(norm.skipped);
  norm.notes = toPlainObj(norm.notes);
  norm.budgets = toPlainObj(norm.budgets);
  norm.transactions = Array.isArray(norm.transactions) ? norm.transactions : [];
  norm.journals = Array.isArray(norm.journals) ? norm.journals : [];
  norm.savingsGoals = Array.isArray(norm.savingsGoals) ? norm.savingsGoals : [];
  norm.tasks = Array.isArray(norm.tasks) ? norm.tasks : [];
  return norm;
}

// ── Debounced save ─────────────────────────────────────────
function debounceSave() {
  setSyncState('saving');
  clearTimeout(debTimer);
  debTimer = setTimeout(async () => {
    try {
      const u = usr();
      if (!u) return;
      await API.Tasks.saveCheck(u.done, u.skipped, u.notes);
      setSyncState('saved');
    } catch (e) {
      setSyncState('saved');
    }
  }, 600);
}

// ── Nav ─────────────────────────────────────────────────────
document.querySelectorAll('.nb-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nb-btn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    ['pgDashboard', 'pgFinance', 'pgJournal', 'pgProfile'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('H');
    });
    const pg = btn.dataset.pg;
    if (pg === 'dashboard') {
      document.getElementById('pgDashboard').classList.remove('H');
    } else if (pg === 'finance') {
      document.getElementById('pgFinance').classList.remove('H');
      setTimeout(() => renderFinOverview(), 80);
    } else if (pg === 'journal') {
      document.getElementById('pgJournal').classList.remove('H');
      jState = { mode: 'list', tab: 'entries', editId: null, selMood: null, selTags: [], searchQ: '' };
      renderJournalPage();
    } else {
      document.getElementById('pgProfile').classList.remove('H');
      renderProfile();
    }
  });
});

document.querySelectorAll('.fin-tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.fin-tab').forEach(x => x.classList.remove('on'));
    t.classList.add('on');
    ['ftOverview', 'ftAnalytics', 'ftTransactions', 'ftReview'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('H');
    });
    const map = { overview: 'ftOverview', analytics: 'ftAnalytics', transactions: 'ftTransactions', review: 'ftReview' };
    const target = document.getElementById(map[t.dataset.ft]);
    if (target) target.classList.remove('H');
    if (t.dataset.ft === 'overview') renderFinOverview();
    else if (t.dataset.ft === 'analytics') renderFinAnalytics();
    else if (t.dataset.ft === 'transactions') renderTxPage();
    else if (t.dataset.ft === 'review') renderWeeklyReview();
  });
});

document.getElementById('prevW').addEventListener('click', () => { wOff--; renderGrid(); });
document.getElementById('nextW').addEventListener('click', () => { wOff++; renderGrid(); });
document.getElementById('addBtn').addEventListener('click', addTask);
document.getElementById('nTask').addEventListener('keydown', e => { if (e.key === 'Enter') addTask(); });

// ── TASKS ──────────────────────────────────────────────────
async function addTask() {
  const inp = document.getElementById('nTask');
  const n = (inp.value || '').trim();
  if (!n) { toast('Enter a task name first.', 'warn'); return; }
  const cat = document.getElementById('nCat').value;
  try {
    setSyncState('saving');
    const tasks = await API.Tasks.add(n, cat);
    S.user.tasks = Array.isArray(tasks) ? tasks : S.user.tasks;
    inp.value = '';
    renderGrid();
    toast('Task added!');
    setSyncState('saved');
  } catch (e) {
    toast(e.message || 'Failed to add task.', 'warn');
    setSyncState('saved');
  }
}

async function deleteTask(taskId, taskName) {
  if (!confirm('Delete "' + taskName + '"?')) return;
  try {
    setSyncState('saving');
    const tasks = await API.Tasks.remove(taskId);
    S.user.tasks = Array.isArray(tasks) ? tasks : S.user.tasks.filter(t => t.id !== taskId);
    renderGrid();
    toast('Task deleted.', 'warn');
    setSyncState('saved');
  } catch (e) {
    toast(e.message || 'Failed to delete task.', 'warn');
    setSyncState('saved');
  }
}

async function renameTask(taskId, newName) {
  try {
    await API.Tasks.rename(taskId, newName);
    setSyncState('saved');
  } catch (e) {
    toast(e.message || 'Failed to rename task.', 'warn');
  }
}

// ── CSV Export ─────────────────────────────────────────────
function doExport() {
  const u = usr();
  if (!u) return;
  const dates = [...new Set(Object.keys(u.done).map(k => k.split('_').pop()))].sort();
  let csv = 'Task,Category,' + dates.join(',') + '\n';
  (u.tasks || []).forEach(t => {
    csv += `"${t.name}",${t.cat || ''},` + dates.map(d =>
      u.skipped[t.id + '_' + d] ? 'skip' : u.done[t.id + '_' + d] ? '1' : '0'
    ).join(',') + '\n';
  });
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'devnix_discipline.csv';
  a.click();
  toast('CSV exported!');
}
document.getElementById('exportBtn').addEventListener('click', doExport);

// ── Reminder ───────────────────────────────────────────────
function showReminder() {
  const u = usr();
  if (!u) return;
  const td = today();
  const missed = (u.tasks || []).filter(t => !u.done[t.id + '_' + td] && !u.skipped[t.id + '_' + td]);
  document.getElementById('remMsg').textContent = missed.length === 0
    ? 'All tasks done today — amazing work! 🎉'
    : `${missed.length} task${missed.length > 1 ? 's' : ''} still pending: ${missed.slice(0, 3).map(t => t.name).join(', ')}${missed.length > 3 ? '…' : ''}`;
  document.getElementById('reminderBanner').classList.remove('H');
}
document.getElementById('reminderBtn').addEventListener('click', showReminder);

// ── Note modal ─────────────────────────────────────────────
document.getElementById('noteCancel').addEventListener('click', () => {
  document.getElementById('noteModal').classList.add('H');
});

document.getElementById('noteSave').addEventListener('click', () => {
  const u = usr();
  if (!u) return;
  const key = noteCtx.tid + '_' + noteCtx.ds;
  const txt = (document.getElementById('noteTA').value || '').trim();
  if (txt) u.notes[key] = txt;
  else delete u.notes[key];
  debounceSave();
  document.getElementById('noteModal').classList.add('H');
  renderGrid();
  toast('Note saved!');
});

function addRipple(el, e) {
  const r = document.createElement('div');
  r.className = 'ripple-el';
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  r.style.cssText = `width:${size}px;height:${size}px;left:${(e.clientX || 0) - rect.left - size / 2}px;top:${(e.clientY || 0) - rect.top - size / 2}px`;
  el.appendChild(r);
  setTimeout(() => r.remove(), 500);
}

// ── Keyboard nav ───────────────────────────────────────────
let kF = { r: 0, c: 0 };
document.addEventListener('keydown', e => {
  const tag = document.activeElement ? document.activeElement.tagName : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const boxes = document.querySelectorAll('.ck');
  if (!boxes.length) return;
  const cols = 7, rows = Math.ceil(boxes.length / cols);
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(e.key)) return;
  e.preventDefault();
  if (e.key === 'ArrowRight' && kF.c < cols - 1) kF.c++;
  else if (e.key === 'ArrowLeft' && kF.c > 0) kF.c--;
  else if (e.key === 'ArrowDown' && kF.r < rows - 1) kF.r++;
  else if (e.key === 'ArrowUp' && kF.r > 0) kF.r--;
  else if (e.key === 'Enter' || e.key === ' ') {
    const idx = kF.r * cols + kF.c;
    if (boxes[idx]) boxes[idx].click();
  }
  const focusIdx = kF.r * cols + kF.c;
  boxes.forEach((b, i) => { b.style.outline = i === focusIdx ? '2px solid var(--p)' : ''; });
  if (boxes[focusIdx]) boxes[focusIdx].scrollIntoView({ block: 'nearest' });
});

// ── Grid ───────────────────────────────────────────────────
function weekDates(off) {
  const n = new Date();
  const day = n.getDay();
  const mon = addD(n, -(day === 0 ? 6 : day - 1) + (off * 7));
  return Array.from({ length: 7 }, (_, i) => addD(mon, i));
}

function renderGrid() {
  const u = usr();
  if (!u) return;
  const dates = weekDates(wOff);
  const td = today();

  const wkLbl = document.getElementById('wkLbl');
  if (wkLbl) wkLbl.textContent = fmtFull(dates[0]) + ' – ' + fmtFull(dates[6]);

  // Build head
  const head = document.getElementById('gHead');
  if (!head) return;
  head.innerHTML = '';
  const hr = document.createElement('tr');
  const th0 = document.createElement('th');
  th0.className = 'th0';
  th0.textContent = 'Task';
  hr.appendChild(th0);

  dates.forEach(d => {
    const ds = dStr(d);
    const isPastH = ds < td;
    const th = document.createElement('th');
    th.className = 'th-d' + (ds === td ? ' th-today' : isPastH ? ' th-past' : '');
    th.innerHTML = `<span class="dw">${WD[d.getDay()]}</span>${d.getDate()}${isPastH ? '<span class="dw" style="opacity:.5;font-size:9px">🔒</span>' : ''}`;
    hr.appendChild(th);
  });
  head.appendChild(hr);

  // Build body
  const body = document.getElementById('gBody');
  if (!body) return;
  body.innerHTML = '';
  let todayDone = 0;

  (u.tasks || []).forEach((task, ri) => {
    const tr = document.createElement('tr');
    tr.style.animationDelay = ri * 30 + 'ms';

    const td0 = document.createElement('td');
    td0.className = 'td0';
    const inn = document.createElement('div');
    inn.className = 'ti';
    const dot = document.createElement('div');
    dot.className = 'cat-dot2';
    dot.style.background = CAT_COL[task.cat] || '#999';
    const inp = document.createElement('input');
    inp.className = 'task-inp';
    inp.value = task.name || '';
    inp.addEventListener('change', () => {
      const newName = inp.value.trim() || task.name;
      task.name = newName;
      renameTask(task.id, newName);
    });
    const del = document.createElement('button');
    del.className = 'del-t';
    del.textContent = '×';
    del.title = 'Delete task';
    del.addEventListener('click', () => deleteTask(task.id, task.name));
    inn.append(dot, inp, del);
    td0.appendChild(inn);
    tr.appendChild(td0);

    dates.forEach(d => {
      const ds = dStr(d);
      const key = task.id + '_' + ds;
      const isPast = ds < td;
      const isSkip = !!u.skipped[key];
      const isDone = !!u.done[key];
      const noteVal = u.notes[key] || '';

      const cell = document.createElement('td');
      if (ds === td) cell.classList.add('col-today');
      else if (isPast) cell.classList.add('col-past');

      const box = document.createElement('div');
      box.className = 'ck';
      if (isPast) box.classList.add('locked');
      if (isSkip) box.classList.add('skip');
      else if (isDone) box.classList.add('done');
      else if (isPast) box.classList.add('miss');

      const tip = document.createElement('div');
      tip.className = 'tip';
      const tipDate = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
      const tipStatus = isSkip ? 'Skipped' : isDone ? 'Done ✓' : isPast ? 'Missed' : 'Pending';
      tip.textContent = tipDate + ' — ' + tipStatus + (noteVal ? ' · ' + noteVal.slice(0, 24) : '');
      box.appendChild(tip);

      if (!isPast) {
        box.addEventListener('contextmenu', ev => {
          ev.preventDefault();
          if (isSkip) delete u.skipped[key];
          else { u.skipped[key] = true; delete u.done[key]; }
          debounceSave();
          renderGrid();
          renderDisciplineAnalytics();
        });
        box.addEventListener('mousedown', ev => {
          dragActive = true;
          dragVal = !u.done[key];
          addRipple(box, ev);
          toggleCell(u, key, box, ds, td);
        });
        box.addEventListener('mouseenter', ev => {
          if (ev.buttons === 1 && dragActive) toggleCell(u, key, box, ds, td, dragVal);
        });
      }

      if (ds === td && isDone) todayDone++;
      cell.appendChild(box);

      if (noteVal) {
        const nc = document.createElement('div');
        nc.style.cssText = 'font-size:10px;color:var(--tx3);max-width:44px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text;padding:0 2px';
        nc.textContent = noteVal;
        nc.title = 'Edit note';
        nc.addEventListener('click', ev => { ev.stopPropagation(); openNote(task.id, ds, d); });
        cell.appendChild(nc);
      } else {
        cell.addEventListener('dblclick', () => openNote(task.id, ds, d));
      }
      tr.appendChild(cell);
    });
    body.appendChild(tr);
  });

  document.addEventListener('mouseup', () => { dragActive = false; }, { once: true, capture: true });
  updateGoalBar(u, td, todayDone);
}

function openNote(tid, ds, d) {
  const u = usr();
  if (!u) return;
  noteCtx = { tid, ds };
  document.getElementById('noteTitle').textContent = 'Note — ' + d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
  document.getElementById('noteTA').value = u.notes[tid + '_' + ds] || '';
  document.getElementById('noteModal').classList.remove('H');
  setTimeout(() => { const ta = document.getElementById('noteTA'); if (ta) ta.focus(); }, 50);
}

function toggleCell(u, key, box, ds, td, forceTo) {
  if (u.skipped[key]) return;
  const val = forceTo !== undefined ? forceTo : !u.done[key];
  if (val) u.done[key] = true;
  else delete u.done[key];
  box.classList.toggle('done', !!u.done[key]);
  box.classList.toggle('miss', !u.done[key] && ds < td);
  debounceSave();
  const tdDone = (u.tasks || []).filter(t => u.done[t.id + '_' + td]).length;
  updateGoalBar(u, td, tdDone);
  clearTimeout(toggleCell._t);
  toggleCell._t = setTimeout(() => renderDisciplineAnalytics(), 350);
}

function updateGoalBar(u, td, todayDone) {
  const tasks = u.tasks || [];
  const pct = tasks.length ? Math.round(todayDone / tasks.length * 100) : 0;
  const fill = document.getElementById('gFill');
  const pctEl = document.getElementById('gPct');
  const badge = document.getElementById('gBadge');
  if (!fill || !pctEl || !badge) return;
  fill.style.width = Math.min(pct, 100) + '%';
  fill.style.background = pct >= 80 ? 'var(--pm)' : pct >= 50 ? 'var(--ambm)' : 'var(--redm)';
  pctEl.textContent = pct + '%';
  const [cls, lbl] = pct === 100 ? ['g-good', 'Perfect! 🎉'] : pct >= 80 ? ['g-good', 'On track ✓'] : pct >= 50 ? ['g-mid', 'Keep going'] : ['g-low', 'Push harder'];
  badge.className = 'g-badge ' + cls;
  badge.textContent = lbl;
}

// ── Discipline Analytics ─────────────────────────────────
function renderDisciplineAnalytics() {
  const u = usr();
  if (!u) return;
  const td = today();

  // Streak
  let streak = 0;
  for (let i = 0; i < 120; i++) {
    const d = dStr(addD(new Date(), -i));
    if ((u.tasks || []).length && (u.tasks || []).every(t => u.done[t.id + '_' + d])) streak++;
    else if (i > 0) break;
  }

  const daysArr = Array.from({ length: analyDays }, (_, i) => dStr(addD(new Date(), -(analyDays - 1) + i)));
  const pcts = daysArr.map(d => (u.tasks || []).length
    ? Math.round((u.tasks || []).filter(t => u.done[t.id + '_' + d]).length / (u.tasks || []).length * 100)
    : 0
  );
  const avg = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0;
  const todayP = (u.tasks || []).length
    ? Math.round((u.tasks || []).filter(t => u.done[t.id + '_' + td]).length / (u.tasks || []).length * 100)
    : 0;

  const statsRow = document.getElementById('statsRow');
  if (statsRow) {
    statsRow.innerHTML = `
      <div class="stat" style="animation-delay:0ms"><div class="s-lbl">Today</div><div class="s-val">${todayP}%</div><div class="s-sub">${(u.tasks || []).filter(t => u.done[t.id + '_' + td]).length}/${(u.tasks || []).length} tasks</div></div>
      <div class="stat" style="animation-delay:60ms"><div class="s-lbl">Streak</div><div class="s-val">${streak}</div><div class="s-sub">perfect days</div></div>
      <div class="stat" style="animation-delay:120ms"><div class="s-lbl">Period avg</div><div class="s-val">${avg}%</div><div class="s-sub">last ${analyDays} days</div></div>
      <div class="stat" style="animation-delay:180ms"><div class="s-lbl">Total check-ins</div><div class="s-val">${Object.keys(u.done).length}</div><div class="s-sub">all time</div></div>
    `;
  }

  // Re-bind period pills
  document.querySelectorAll('.pill[data-d]').forEach(p => {
    p.addEventListener('click', () => {
      document.querySelectorAll('.pill[data-d]').forEach(x => x.classList.remove('on'));
      p.classList.add('on');
      analyDays = +p.dataset.d;
      renderDisciplineAnalytics();
    });
  });

  const dk = S.dark;
  const tcC = dk ? '#555e72' : '#9ea3b5';
  const gcC = dk ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.04)';

  // Bar chart
  document.getElementById('barSkel')?.classList.add('H');
  document.getElementById('barWrap')?.classList.remove('H');
  if (barCI) { try { barCI.destroy(); } catch (e) { } barCI = null; }
  const barEl = document.getElementById('barCh');
  if (barEl) {
    barCI = new Chart(barEl, {
      type: 'bar',
      data: {
        labels: daysArr.map(d => { const x = new Date(d + 'T12:00:00'); return WD[x.getDay()] + ' ' + x.getDate(); }),
        datasets: [{ data: pcts, backgroundColor: pcts.map(v => v === 100 ? '#2e7d32' : v >= 50 ? '#66bb6a' : '#a5d6a7'), borderRadius: 4, borderSkipped: false }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 700, easing: 'easeOutQuart' },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.parsed.y + '%' } } },
        scales: {
          y: { min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 10 }, color: tcC }, grid: { color: gcC } },
          x: { ticks: { font: { size: 9 }, color: tcC, autoSkip: true, maxTicksLimit: 14, maxRotation: 45 }, grid: { display: false } }
        }
      }
    });
  }

  // Line chart
  const ma7 = pcts.map((_, i) => { const sl = pcts.slice(Math.max(0, i - 6), i + 1); return Math.round(sl.reduce((a, b) => a + b, 0) / sl.length); });
  document.getElementById('lineSkel')?.classList.add('H');
  document.getElementById('lineWrap')?.classList.remove('H');
  if (lineCI) { try { lineCI.destroy(); } catch (e) { } lineCI = null; }
  const lineEl = document.getElementById('lineCh');
  if (lineEl) {
    lineCI = new Chart(lineEl, {
      type: 'line',
      data: {
        labels: daysArr.map(d => { const x = new Date(d + 'T12:00:00'); return MO[x.getMonth()] + ' ' + x.getDate(); }),
        datasets: [
          { label: 'Daily', data: pcts, borderColor: '#a5d6a7', backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 2, borderDash: [5, 3], tension: .3 },
          { label: '7-day avg', data: ma7, borderColor: '#2e7d32', backgroundColor: 'rgba(46,125,50,.08)', borderWidth: 2.5, fill: true, pointRadius: 3, tension: .4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 800, easing: 'easeOutQuart' },
        plugins: { legend: { display: false } },
        scales: {
          y: { min: 0, max: 100, ticks: { callback: v => v + '%', font: { size: 10 }, color: tcC }, grid: { color: gcC } },
          x: { ticks: { font: { size: 9 }, color: tcC, autoSkip: true, maxTicksLimit: 10 }, grid: { display: false } }
        }
      }
    });
  }

  // Heatmap
  const hm = document.getElementById('hmGrid');
  if (hm) {
    hm.innerHTML = '';
    for (let i = 89; i >= 0; i--) {
      const d = dStr(addD(new Date(), -i));
      const p = (u.tasks || []).length ? (u.tasks || []).filter(t => u.done[t.id + '_' + d]).length / (u.tasks || []).length : 0;
      const sq = document.createElement('div');
      sq.className = 'hm-sq hm' + (p === 0 ? 0 : p < .5 ? 1 : p < 1 ? 2 : 3);
      sq.title = d + ': ' + Math.round(p * 100) + '%';
      hm.appendChild(sq);
    }
  }
  document.getElementById('hmSkel')?.classList.add('H');
  document.getElementById('hmGrid')?.classList.remove('H');

  // Insights
  const best = daysArr.reduce((b, d) => { const p = (u.tasks || []).length ? (u.tasks || []).filter(t => u.done[t.id + '_' + d]).length / (u.tasks || []).length : 0; return p >= b.p ? { d, p } : b; }, { d: '', p: -1 });
  const worst = daysArr.reduce((b, d) => { const p = (u.tasks || []).length ? (u.tasks || []).filter(t => u.done[t.id + '_' + d]).length / (u.tasks || []).length : 0; return p <= b.p ? { d, p } : b; }, { d: '', p: 2 });
  const consist = pcts.filter(p => p >= 80).length;
  const insGrid = document.getElementById('insGrid');
  if (insGrid) {
    insGrid.innerHTML = `
      <div class="ins-card-d" style="animation-delay:0ms"><div class="ins-lbl">Best day</div><div class="ins-val">${best.d ? new Date(best.d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'}</div><div class="ins-sub">${Math.round((best.p || 0) * 100)}% done</div></div>
      <div class="ins-card-d" style="animation-delay:60ms"><div class="ins-lbl">Worst day</div><div class="ins-val">${worst.d && worst.p < 2 ? new Date(worst.d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'}</div><div class="ins-sub">${worst.p < 2 ? Math.round(worst.p * 100) : 0}% done</div></div>
      <div class="ins-card-d" style="animation-delay:120ms"><div class="ins-lbl">Days at 80%+</div><div class="ins-val">${consist}/${analyDays}</div><div class="ins-sub">consistency score</div></div>
      <div class="ins-card-d" style="animation-delay:180ms"><div class="ins-lbl">Notes written</div><div class="ins-val">${Object.keys(u.notes).length}</div><div class="ins-sub">across all tasks</div></div>
    `;
  }
}

// ── Profile ────────────────────────────────────────────────
function renderProfile() {
  const u = usr();
  if (!u) return;
  const em = u.email || '';
  const name = em.split('@')[0] || '?';
  const avEl = document.getElementById('pAv');
  const nameEl = document.getElementById('pName');
  const emailEl = document.getElementById('pEmail');
  if (avEl) avEl.textContent = (name[0] || '?').toUpperCase();
  if (nameEl) nameEl.textContent = name;
  if (emailEl) emailEl.textContent = em;

  const td = today();
  let streak = 0;
  for (let i = 0; i < 120; i++) {
    const d = dStr(addD(new Date(), -i));
    if ((u.tasks || []).length && (u.tasks || []).every(t => u.done[t.id + '_' + d])) streak++;
    else if (i > 0) break;
  }
  const todayP = (u.tasks || []).length
    ? Math.round((u.tasks || []).filter(t => u.done[t.id + '_' + td]).length / (u.tasks || []).length * 100)
    : 0;

  const pStats = document.getElementById('pStats');
  if (pStats) {
    pStats.innerHTML = `
      <div class="p-stat"><div class="p-stat-v">${(u.tasks || []).length}</div><div class="p-stat-l">Tasks</div></div>
      <div class="p-stat"><div class="p-stat-v">${streak}</div><div class="p-stat-l">Day streak</div></div>
      <div class="p-stat"><div class="p-stat-v">${todayP}%</div><div class="p-stat-l">Today</div></div>
      <div class="p-stat"><div class="p-stat-v">${(u.transactions || []).length}</div><div class="p-stat-l">Transactions</div></div>
      <div class="p-stat" style="grid-column:span 2"><div class="p-stat-v">${Object.keys(u.done).length}</div><div class="p-stat-l">Total check-ins</div></div>
    `;
  }

  const pExp = document.getElementById('pExp');
  const pRem = document.getElementById('pRem');
  const pDark = document.getElementById('pDark');
  const pOut = document.getElementById('pOut');
  if (pExp) pExp.onclick = doExport;
  if (pRem) pRem.onclick = () => { showReminder(); toast('Reminder shown!'); };
  if (pDark) pDark.onclick = toggleDark;
  if (pOut) pOut.onclick = doLogout;
}

// ══════════════════════════════════════════════════════════
//  FINANCE MODULE
// ══════════════════════════════════════════════════════════
const CAT_ICONS = {
  Income: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-4H9l3-3 3 3h-2v4z"/>',
  Food: '<path d="M18.06 22.99h1.66c.84 0 1.53-.64 1.63-1.46L23 5.05h-5V1h-1.97v4.05h-4.97l.3 2.34c1.71.47 3.31 1.32 4.27 2.26 1.44 1.42 2.43 2.89 2.43 5.29v8.05zM1 21.99V21h15.03v.99c0 .55-.45 1-1.01 1H2.01c-.56 0-1.01-.45-1.01-1zm15.03-7c0-4.5-6.74-5.97-8.04-5.99H1v2h15.03v3.99z"/>',
  Transport: '<path d="M17.5 5h-11L4 11v6c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h10v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-6l-2.5-6zm-11 1h11l1.5 4h-14l1.5-4zM6.5 14c-.83 0-1.5-.67-1.5-1.5S5.67 11 6.5 11s1.5.67 1.5 1.5S7.33 14 6.5 14zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>',
  Housing: '<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>',
  Health: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>',
  Shopping: '<path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96C5 16.1 6.9 18 9 18h12v-2H9.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63H19c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1 1 0 0023.45 5H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2S15.9 22 17 22s2-.9 2-2-.9-2-2-2z"/>',
  Entertainment: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>'
};
const CAT_COLORS = { Income: '#22c55e', Food: '#f59e0b', Transport: '#3b82f6', Housing: '#8b5cf6', Health: '#14b8a6', Shopping: '#ec4899', Entertainment: '#f87171' };
const CAT_COLORS_AN = { Food: '#f59e0b', Transport: '#3b82f6', Housing: '#8b5cf6', Health: '#14b8a6', Shopping: '#ec4899', Entertainment: '#f87171', Other: '#888', Income: '#22c55e' };

const isDk = () => S.dark;
const tcFn = () => isDk() ? '#555e72' : '#9ea3b5';
const gcFn = () => isDk() ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)';
const sfFn = () => isDk() ? '#181b24' : '#fff';

function destroyFinChart(id) {
  if (finCharts[id]) {
    try { finCharts[id].destroy(); } catch (e) { }
    delete finCharts[id];
  }
}

function fmtCurrency(n) {
  const abs = Math.abs(n);
  let s;
  if (abs >= 10000000) s = (abs / 10000000).toFixed(1) + 'Cr';
  else if (abs >= 100000) s = (abs / 100000).toFixed(1) + 'L';
  else if (abs >= 1000) s = (abs / 1000).toFixed(1) + 'k';
  else s = abs.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return (n < 0 ? '-' : '') + '₹' + s;
}

function calcTotals(txns) {
  const inc = txns.filter(t => t.type === 'income').reduce((s, t) => s + Math.abs(t.amt), 0);
  const exp = txns.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amt), 0);
  return { inc, exp, net: inc - exp };
}

function getGoals() { const u = usr(); return u ? (u.savingsGoals || []) : []; }
function getBudgets() { const u = usr(); return u ? (u.budgets || {}) : {}; }

// ── Finance Overview ───────────────────────────────────────
function renderFinOverview() {
  const u = usr();
  if (!u) return;
  const txns = u.transactions || [];
  const { inc, exp, net } = calcTotals(txns);
  const hasData = txns.length > 0;
  const savRate = inc > 0 ? Math.round(net / inc * 100) : 0;
  const incTxCount = txns.filter(t => t.type === 'income').length;
  const expTxCount = txns.filter(t => t.type === 'expense').length;

  const kpiDefs = [
    { label: 'Total income', val: hasData ? fmtCurrency(inc) : '₹0', sub: hasData ? incTxCount + ' income entr' + (incTxCount === 1 ? 'y' : 'ies') : 'Add your first income →', pos: true, color: '#3b82f6', bg: isDk() ? '#0d2044' : '#eff6ff', icon: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-4H9l3-3 3 3h-2v4z"/>' },
    { label: 'Total expenses', val: hasData ? fmtCurrency(exp) : '₹0', sub: hasData ? expTxCount + ' expense entr' + (expTxCount === 1 ? 'y' : 'ies') : 'No expenses recorded yet', pos: false, color: '#ef4444', bg: isDk() ? '#2d0f0f' : '#fef2f2', icon: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-4H9l3 3 3-3h-2v-4z"/>' },
    { label: 'Net savings', val: hasData ? fmtCurrency(net) : '₹0', sub: hasData ? (net >= 0 ? savRate + '% savings rate' : 'Expenses exceed income') : 'Updates on first entry', pos: net >= 0, color: net >= 0 ? '#22c55e' : '#ef4444', bg: net >= 0 ? (isDk() ? '#0d2818' : '#f0fdf4') : (isDk() ? '#2d0f0f' : '#fef2f2'), icon: '<path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/>' },
    { label: 'Net worth', val: hasData ? fmtCurrency(net) : '₹0', sub: hasData ? (net >= 0 ? 'Income minus all expenses' : 'Review your spending') : 'Reflects your total net', pos: net >= 0, color: net >= 0 ? '#8b5cf6' : '#ef4444', bg: isDk() ? '#1e0d3d' : '#f5f3ff', icon: '<path d="M23 8c0 1.1-.9 2-2 2-.18 0-.35-.02-.51-.07l-3.56 3.55c.05.16.07.34.07.52 0 1.1-.9 2-2 2s-2-.9-2-2c0-.18.02-.36.07-.52l-2.55-2.55c-.16.05-.34.07-.52.07s-.36-.02-.52-.07l-4.55 4.56c.05.16.07.33.07.51 0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2c.18 0 .35.02.51.07l4.56-4.55C8.02 9.36 8 9.18 8 9c0-1.1.9-2 2-2s2 .9 2 2c0 .18-.02.36-.07.52l2.55 2.55c.16-.05.34-.07.52-.07s.36.02.52.07l3.55-3.56C19.02 8.35 19 8.18 19 8c0-1.1.9-2 2-2s2 .9 2 2z"/>' }
  ];

  const kpiRow = document.getElementById('kpiRow');
  if (kpiRow) kpiRow.innerHTML = kpiDefs.map((k, i) => `<div class="kpi" style="animation-delay:${i * 50}ms"><div class="kpi-icon" style="background:${k.bg}"><svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:${k.color}">${k.icon}</svg></div><div class="kpi-lbl">${k.label}</div><div class="kpi-val">${k.val}</div><div class="kpi-sub ${k.pos ? 'pos' : 'neg'}">${k.sub}</div><div class="kpi-bar" style="background:${k.color}"></div></div>`).join('');

  if (!hasData) {
    destroyFinChart('revExp');
    destroyFinChart('catDonut');
    const emptyHTML = msg => `<div style="height:180px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:var(--tx3)"><svg viewBox="0 0 24 24" style="width:28px;height:28px;fill:var(--tx3)"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg><span style="font-size:12px">${msg}</span></div>`;
    const revEl = document.getElementById('revExpCh');
    if (revEl) revEl.closest('.fin-card')?.querySelector('.ch')?.insertAdjacentHTML('afterbegin', emptyHTML('Add transactions to see income vs expense chart'));
    document.getElementById('overviewInsights').innerHTML = `<div class="ins-card2" style="grid-column:1/-1"><div class="ins-icon2" style="background:${isDk() ? '#0d2044' : '#eff6ff'}"><svg viewBox="0 0 24 24" style="fill:#3b82f6"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg></div><div><div class="ins-title2">Start tracking to unlock insights</div><div class="ins-body2">Go to the <strong>Transactions</strong> tab and log your first income or expense. All charts and insights update instantly.</div></div></div>`;
    return;
  }

  const monthlyMap = {};
  txns.forEach(t => {
    const m = t.date ? t.date.slice(0, 7) : '';
    if (!m) return;
    if (!monthlyMap[m]) monthlyMap[m] = { inc: 0, exp: 0 };
    if (t.type === 'income') monthlyMap[m].inc += Math.abs(t.amt);
    else monthlyMap[m].exp += Math.abs(t.amt);
  });
  const sortedMonths = Object.keys(monthlyMap).sort().slice(-6);
  const mInc = sortedMonths.map(m => monthlyMap[m].inc);
  const mExp = sortedMonths.map(m => monthlyMap[m].exp);
  const mLbls = sortedMonths.map(m => { const d = new Date(m + '-01'); return MO[d.getMonth()] + ' ' + d.getFullYear().toString().slice(2); });

  destroyFinChart('revExp');
  const revExpEl = document.getElementById('revExpCh');
  if (revExpEl) {
    finCharts.revExp = new Chart(revExpEl, {
      type: 'bar',
      data: {
        labels: mLbls,
        datasets: [
          { label: 'Income', data: mInc, backgroundColor: isDk() ? '#1d4ed8' : '#3b82f6', borderRadius: 4, borderSkipped: false, order: 2 },
          { label: 'Expenses', data: mExp, type: 'line', borderColor: '#ef4444', backgroundColor: 'transparent', borderWidth: 2, borderDash: [5, 3], pointRadius: 3, pointBackgroundColor: '#ef4444', tension: .3, order: 1 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 700 },
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { font: { size: 10 }, color: tcFn() }, grid: { display: false } },
          y: { ticks: { callback: v => '₹' + v / 1000 + 'k', font: { size: 10 }, color: tcFn() }, grid: { color: gcFn() } }
        }
      }
    });
  }

  const catMap = {};
  txns.filter(t => t.type === 'expense').forEach(t => { catMap[t.cat] = (catMap[t.cat] || 0) + Math.abs(t.amt); });
  const catKeys = Object.keys(catMap).filter(k => catMap[k] > 0);
  const totalExpCat = catKeys.reduce((s, k) => s + catMap[k], 0);

  destroyFinChart('catDonut');
  const donutEl = document.getElementById('catDonutCh');
  if (donutEl && catKeys.length > 0) {
    finCharts.catDonut = new Chart(donutEl, {
      type: 'doughnut',
      data: { labels: catKeys, datasets: [{ data: catKeys.map(k => catMap[k]), backgroundColor: catKeys.map(k => CAT_COLORS_AN[k] || '#888'), borderWidth: 2, borderColor: sfFn() }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '65%', animation: { duration: 600 },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => c.label + ': ₹' + c.parsed.toLocaleString('en-IN') + ' (' + Math.round(c.parsed / totalExpCat * 100) + '%)' } } }
      }
    });
  }

  const insights = [];
  if (savRate >= 40) insights.push({ icon: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>', color: '#22c55e', bg: isDk() ? '#0d2818' : '#f0fdf4', title: 'Strong savings rate — ' + savRate + '%', body: 'You\'re saving ' + savRate + '% of your income. Keep it up!' });
  else if (inc > 0) insights.push({ icon: '<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>', color: '#f59e0b', bg: isDk() ? '#2e1e00' : '#fffbeb', title: 'Savings rate: ' + savRate + '%', body: 'Target 40% or more. Try reducing your top expense category.' });
  if (net < 0) insights.push({ icon: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>', color: '#ef4444', bg: isDk() ? '#2d0f0f' : '#fef2f2', title: 'Spending exceeds income', body: 'You\'re spending ' + fmtCurrency(Math.abs(net)) + ' more than you earn.' });
  const topCat = catKeys.sort((a, b) => catMap[b] - catMap[a])[0];
  if (topCat) insights.push({ icon: '<path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/>', color: '#3b82f6', bg: isDk() ? '#0d2044' : '#eff6ff', title: 'Top expense: ' + topCat, body: topCat + ' is ' + Math.round(catMap[topCat] / totalExpCat * 100) + '% of total spend (' + fmtCurrency(catMap[topCat]) + ')' });
  insights.push({ icon: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/>', color: '#8b5cf6', bg: isDk() ? '#1e0d3d' : '#f5f3ff', title: txns.length + ' transactions logged', body: 'Income ' + fmtCurrency(inc) + ' · Expenses ' + fmtCurrency(exp) + ' · Net ' + fmtCurrency(net) });

  const overviewIns = document.getElementById('overviewInsights');
  if (overviewIns) overviewIns.innerHTML = insights.slice(0, 4).map((ins, i) => `<div class="ins-card2" style="animation-delay:${i * 60}ms"><div class="ins-icon2" style="background:${ins.bg}"><svg viewBox="0 0 24 24" style="fill:${ins.color}">${ins.icon}</svg></div><div><div class="ins-title2">${ins.title}</div><div class="ins-body2">${ins.body}</div></div></div>`).join('');
}

// ── Finance Analytics ──────────────────────────────────────
let _anGoalEditIdx = null, _anSelColor = '#3b82f6';

function renderFinAnalytics() {
  const u = usr();
  if (!u) return;
  const addCatBtn = document.getElementById('addCatBudgetBtn');
  if (addCatBtn) addCatBtn.onclick = () => {
    document.getElementById('bmCat').value = 'Food';
    document.getElementById('bmAmt').value = '';
    document.getElementById('budgetModal').classList.remove('H');
    setTimeout(() => document.getElementById('bmAmt')?.focus(), 50);
  };
  const bmCancel = document.getElementById('bmCancel');
  if (bmCancel) bmCancel.onclick = () => document.getElementById('budgetModal').classList.add('H');
  const bmSave = document.getElementById('bmSave');
  if (bmSave) bmSave.onclick = saveBudget;
  const addGoalBtn = document.getElementById('addGoalBtn');
  if (addGoalBtn) addGoalBtn.onclick = () => openGoalModal(null);
  const gmCancel = document.getElementById('gmCancel');
  if (gmCancel) gmCancel.onclick = () => document.getElementById('goalModal').classList.add('H');
  const gmSave = document.getElementById('gmSave');
  if (gmSave) gmSave.onclick = saveGoal;
  document.getElementById('gmColorPicker')?.querySelectorAll('span').forEach(s => {
    s.onclick = () => {
      _anSelColor = s.dataset.c;
      document.getElementById('gmColor').value = _anSelColor;
      document.getElementById('gmColorPicker').querySelectorAll('span').forEach(x => x.style.border = '2px solid transparent');
      s.style.border = '2px solid var(--tx)';
    };
  });
  refreshAnalyticsCharts(u.transactions || []);
}

function refreshAnalyticsCharts(txns) {
  const now = new Date();
  const monthLabels = [], mInc = [], mExp = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthLabels.push(d.toLocaleString('en-US', { month: 'short' }));
    const mTx = txns.filter(t => {
      const td = new Date(t.date + 'T12:00:00');
      return td.getFullYear() === d.getFullYear() && td.getMonth() === d.getMonth();
    });
    mInc.push(mTx.filter(t => t.type === 'income').reduce((s, t) => s + Math.abs(t.amt), 0));
    mExp.push(mTx.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amt), 0));
  }
  const cashFlow = mInc.map((v, i) => v - mExp[i]);
  let runNW = 0;
  const nwData = cashFlow.map(cf => { runNW += cf; return Math.round(runNW); });

  // Net Worth chart
  const nwEl = document.getElementById('netWorthCh');
  if (nwEl) {
    if (finCharts.netWorth) {
      finCharts.netWorth.data.labels = monthLabels;
      finCharts.netWorth.data.datasets[0].data = nwData;
      finCharts.netWorth.update({ duration: 700 });
    } else {
      destroyFinChart('netWorth');
      finCharts.netWorth = new Chart(nwEl, {
        type: 'line',
        data: { labels: monthLabels, datasets: [{ label: 'Net worth', data: nwData, borderColor: '#8b5cf6', backgroundColor: isDk() ? 'rgba(139,92,246,.12)' : 'rgba(139,92,246,.08)', borderWidth: 2.5, fill: true, tension: .4, pointRadius: 4, pointBackgroundColor: '#8b5cf6' }] },
        options: { responsive: true, maintainAspectRatio: false, animation: { duration: 800 }, plugins: { legend: { display: false } }, scales: { x: { ticks: { font: { size: 10 }, color: tcFn() }, grid: { display: false } }, y: { ticks: { callback: v => (v >= 0 ? '$' : '-$') + Math.abs(v / 1000).toFixed(1) + 'k', font: { size: 10 }, color: tcFn() }, grid: { color: gcFn() } } } }
      });
    }
  }

  const nwSub = document.getElementById('nwSub');
  if (nwSub) nwSub.textContent = 'Accumulated from ' + txns.length + ' transaction' + (txns.length !== 1 ? 's' : '');

  // Category list
  const catMap = {};
  txns.filter(t => t.type === 'expense').forEach(t => { catMap[t.cat] = (catMap[t.cat] || 0) + Math.abs(t.amt); });
  const budgets = getBudgets();
  const catKeys = Object.keys(catMap).length ? Object.keys(catMap) : Object.keys(budgets);
  const totalExp = catKeys.reduce((s, k) => s + (catMap[k] || 0), 0);
  const catListEl = document.getElementById('catList2');
  if (catListEl) {
    catListEl.innerHTML = '';
    if (!catKeys.length) {
      catListEl.innerHTML = '<div style="font-size:12px;color:var(--tx3);padding:12px 0">No expenses yet — add transactions to see breakdown.</div>';
    } else {
      catKeys.sort((a, b) => (catMap[b] || 0) - (catMap[a] || 0)).forEach(cat => {
        const amt = catMap[cat] || 0, budget = budgets[cat] || 0, pct = totalExp > 0 ? Math.round(amt / totalExp * 100) : 0;
        const color = CAT_COLORS_AN[cat] || '#888', over = budget > 0 && amt > budget;
        const row = document.createElement('div');
        row.className = 'cat-item2';
        row.style.cursor = 'pointer';
        row.title = 'Click to set budget';
        row.innerHTML = `<div class="cat-head2"><div class="cat-name2"><div class="cat-dot" style="background:${color}"></div><span>${cat}</span></div><div style="display:flex;align-items:center;gap:8px">${budget > 0 ? `<span style="font-size:10px;color:${over ? '#ef4444' : 'var(--tx3)'};font-weight:600">${over ? '⚠ ' : ''}₹${amt.toFixed(0)} / ₹${budget} budget</span>` : `<span style="font-size:10px;color:var(--tx3)">₹${amt.toFixed(0)}</span>`}<span style="font-size:10px;font-weight:700;color:${color}">${pct}%</span><button class="del-cat-btn" data-cat="${cat}" style="background:none;border:none;color:var(--tx3);cursor:pointer;font-size:14px;padding:0;line-height:1;opacity:0;transition:opacity .18s" title="Remove budget">×</button></div></div><div class="cat-track" style="height:8px;margin-top:4px"><div class="cat-fill" style="width:0%;background:${over ? '#ef4444' : color};transition:width .7s cubic-bezier(.4,0,.2,1)"></div></div>`;
        row.addEventListener('mouseenter', () => row.querySelector('.del-cat-btn').style.opacity = '1');
        row.addEventListener('mouseleave', () => row.querySelector('.del-cat-btn').style.opacity = '0');
        row.querySelector('.del-cat-btn').addEventListener('click', async e => {
          e.stopPropagation();
          if (budgets[cat]) {
            try { const b = await API.Budgets.remove(cat); S.user.budgets = b; refreshAnalyticsCharts(txns); toast('Budget removed for ' + cat, 'warn'); }
            catch (e2) { toast(e2.message, 'warn'); }
          }
        });
        row.addEventListener('click', e => {
          if (e.target.classList.contains('del-cat-btn')) return;
          document.getElementById('bmCat').value = cat;
          document.getElementById('bmAmt').value = budget || '';
          document.getElementById('budgetModal').classList.remove('H');
          setTimeout(() => document.getElementById('bmAmt')?.focus(), 50);
        });
        catListEl.appendChild(row);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const fill = row.querySelector('.cat-fill');
          if (fill) fill.style.width = Math.min(budget > 0 ? Math.round(amt / budget * 100) : pct, 120) + '%';
        }));
      });
    }
  }

  // Cash flow chart
  const cfEl = document.getElementById('cashFlowCh');
  if (cfEl) {
    if (finCharts.cashFlow) {
      finCharts.cashFlow.data.labels = monthLabels;
      finCharts.cashFlow.data.datasets[0].data = cashFlow;
      finCharts.cashFlow.data.datasets[0].backgroundColor = cashFlow.map(v => v >= 0 ? (isDk() ? '#166534' : '#22c55e') : (isDk() ? '#991b1b' : '#ef4444'));
      finCharts.cashFlow.update({ duration: 700 });
    } else {
      destroyFinChart('cashFlow');
      finCharts.cashFlow = new Chart(cfEl, {
        type: 'bar',
        data: { labels: monthLabels, datasets: [{ label: 'Cash flow', data: cashFlow, backgroundColor: cashFlow.map(v => v >= 0 ? (isDk() ? '#166534' : '#22c55e') : (isDk() ? '#991b1b' : '#ef4444')), borderRadius: 5, borderSkipped: false }] },
        options: { responsive: true, maintainAspectRatio: false, animation: { duration: 700 }, plugins: { legend: { display: false } }, scales: { x: { ticks: { font: { size: 10 }, color: tcFn() }, grid: { display: false } }, y: { ticks: { callback: v => (v >= 0 ? '$' : '-$') + Math.abs(v / 1000).toFixed(1) + 'k', font: { size: 10 }, color: tcFn() }, grid: { color: gcFn() } } } }
      });
    }
  }

  renderSavingsGoals(txns);

  // Forecast chart
  const last6 = cashFlow.slice(-6), avg6 = last6.length ? last6.reduce((a, b) => a + b, 0) / last6.length : 0;
  const lastNW = nwData[nwData.length - 1] || 0, fLabels = [];
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    fLabels.push(d.toLocaleString('en-US', { month: 'short' }));
  }
  const forecastNW = fLabels.map((_, i) => Math.round(lastNW + (avg6 * (i + 1))));
  const forecastSav = fLabels.map(() => Math.round(avg6));
  const allFL = [...monthLabels.slice(-3), ...fLabels];
  const fcEl = document.getElementById('forecastCh');
  if (fcEl) {
    if (finCharts.forecast) {
      finCharts.forecast.data.labels = allFL;
      finCharts.forecast.data.datasets[0].data = [...nwData.slice(-3), ...Array(6).fill(null)];
      finCharts.forecast.data.datasets[1].data = [...Array(2).fill(null), nwData[nwData.length - 1], ...forecastNW];
      finCharts.forecast.data.datasets[2].data = [...Array(3).fill(null), ...forecastSav];
      finCharts.forecast.update({ duration: 700 });
    } else {
      destroyFinChart('forecast');
      finCharts.forecast = new Chart(fcEl, {
        type: 'line',
        data: {
          labels: allFL,
          datasets: [
            { label: 'Net worth (actual)', data: [...nwData.slice(-3), ...Array(6).fill(null)], borderColor: '#8b5cf6', borderWidth: 2, pointRadius: 3, tension: .3, backgroundColor: 'transparent' },
            { label: 'Net worth (forecast)', data: [...Array(2).fill(null), nwData[nwData.length - 1], ...forecastNW], borderColor: '#8b5cf6', borderWidth: 2, borderDash: [6, 4], pointRadius: 3, tension: .3, backgroundColor: 'rgba(139,92,246,.06)', fill: true },
            { label: 'Monthly savings', data: [...Array(3).fill(null), ...forecastSav], borderColor: '#22c55e', borderWidth: 1.5, borderDash: [4, 3], pointRadius: 2, tension: .3, backgroundColor: 'transparent', yAxisID: 'y1' }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 800 }, plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { font: { size: 10 }, color: tcFn() }, grid: { display: false } },
            y: { ticks: { callback: v => (v >= 0 ? '$' : '-$') + Math.abs(v / 1000).toFixed(1) + 'k', font: { size: 10 }, color: tcFn() }, grid: { color: gcFn() } },
            y1: { position: 'right', ticks: { callback: v => '$' + v / 1000 + 'k', font: { size: 10 }, color: '#22c55e' }, grid: { display: false } }
          }
        }
      });
    }
  }
  const forecastSub = document.getElementById('forecastSub');
  if (forecastSub) forecastSub.textContent = avg6 >= 0
    ? `Avg monthly savings: $${Math.round(avg6).toLocaleString()} · projected over 6 months`
    : `Avg monthly deficit: -$${Math.abs(Math.round(avg6)).toLocaleString()} · review your spending`;
}

function renderSavingsGoals(txns) {
  const goals = getGoals();
  const listEl = document.getElementById('savingsList2');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (!goals.length) {
    listEl.innerHTML = '<div style="font-size:12px;color:var(--tx3);padding:12px 0">No goals yet — click "+ Add goal" to create one.</div>';
    return;
  }
  goals.forEach((g, idx) => {
    const pct = Math.min(Math.round(g.saved / g.target * 100), 100), over = pct >= 100;
    const bs = over ? `background:${isDk() ? '#0d2818' : '#f0fdf4'};color:${isDk() ? '#3fb950' : '#15803d'}` : pct >= 50 ? `background:${isDk() ? '#0d2044' : '#eff6ff'};color:${isDk() ? '#58a6ff' : '#1a56db'}` : `background:${isDk() ? '#2e1e00' : '#fffbeb'};color:${isDk() ? '#d29922' : '#b45309'}`;
    const card = document.createElement('div');
    card.className = 'goal-card2';
    card.innerHTML = `<div class="goal-head2"><div class="goal-name2" style="color:${g.color}">${g.emoji} ${g.name}</div><div style="display:flex;align-items:center;gap:6px"><span class="goal-badge2" style="${bs}">${over ? 'Complete ✓' : pct >= 50 ? 'In progress' : 'Just started'}</span><span class="goal-pct2" style="color:${g.color}">${pct}%</span><button class="edit-goal-btn" style="background:none;border:1px solid var(--bd);color:var(--tx2);cursor:pointer;font-size:11px;border-radius:6px;padding:2px 7px;font-family:inherit">Edit</button><button class="del-goal-btn" style="background:none;border:none;color:var(--tx3);cursor:pointer;font-size:16px;padding:0 2px;line-height:1">×</button></div></div><div class="goal-track2"><div class="goal-fill2" style="width:0%;background:${g.color};transition:width .8s cubic-bezier(.4,0,.2,1)"></div></div><div class="goal-meta2" style="margin-top:4px"><span style="font-size:11px;color:var(--tx2)">₹${g.saved.toLocaleString()} saved</span><span style="font-size:11px;color:var(--tx3)">Target: ₹${g.target.toLocaleString()}</span></div>${!over ? `<div style="font-size:10px;color:var(--tx3);margin-top:2px">₹${(g.target - g.saved).toLocaleString()} remaining</div>` : ''}`;
    card.querySelector('.edit-goal-btn').addEventListener('click', () => openGoalModal(idx));
    card.querySelector('.del-goal-btn').addEventListener('click', async () => {
      if (!confirm('Delete goal "' + g.name + '"?')) return;
      try { const goals2 = await API.Goals.remove(g.id); S.user.savingsGoals = goals2; renderSavingsGoals(txns); toast('Goal deleted.', 'warn'); }
      catch (e2) { toast(e2.message, 'warn'); }
    });
    listEl.appendChild(card);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const fill = card.querySelector('.goal-fill2');
      if (fill) fill.style.width = pct + '%';
    }));
  });
}

function openGoalModal(idx) {
  _anGoalEditIdx = idx;
  const goals = getGoals();
  const g = idx !== null ? goals[idx] : null;
  document.getElementById('goalModalTitle').textContent = g ? '✏ Edit Goal' : '🎯 New Savings Goal';
  document.getElementById('gmName').value = g ? g.name : '';
  document.getElementById('gmEmoji').value = g ? g.emoji : '🎯';
  document.getElementById('gmTarget').value = g ? g.target : '';
  document.getElementById('gmSaved').value = g ? g.saved : '';
  _anSelColor = g ? g.color : '#3b82f6';
  document.getElementById('gmColor').value = _anSelColor;
  document.getElementById('gmColorPicker')?.querySelectorAll('span').forEach(s => {
    s.style.border = s.dataset.c === _anSelColor ? '2px solid var(--tx)' : '2px solid transparent';
  });
  document.getElementById('goalModal').classList.remove('H');
  setTimeout(() => document.getElementById('gmName')?.focus(), 50);
}

async function saveGoal() {
  const name = (document.getElementById('gmName').value || '').trim();
  const emoji = (document.getElementById('gmEmoji').value || '').trim() || '🎯';
  const target = parseFloat(document.getElementById('gmTarget').value);
  const saved = parseFloat(document.getElementById('gmSaved').value) || 0;
  const color = document.getElementById('gmColor').value || '#3b82f6';
  if (!name || isNaN(target) || target <= 0) { toast('Fill in name and target amount.', 'warn'); return; }
  const goals = getGoals();
  const obj = { name, emoji, target, saved, color };
  try {
    let updatedGoals;
    if (_anGoalEditIdx !== null && goals[_anGoalEditIdx]) {
      updatedGoals = await API.Goals.update(goals[_anGoalEditIdx].id, obj);
      toast('Goal updated!');
    } else {
      updatedGoals = await API.Goals.add(obj);
      toast('Goal added!');
    }
    S.user.savingsGoals = updatedGoals;
    document.getElementById('goalModal').classList.add('H');
    renderSavingsGoals(S.user.transactions || []);
  } catch (e) { toast(e.message, 'warn'); }
}

async function saveBudget() {
  const cat = document.getElementById('bmCat').value;
  const amt = parseFloat(document.getElementById('bmAmt').value);
  if (!cat || isNaN(amt) || amt < 0) { toast('Enter a valid amount.', 'warn'); return; }
  try {
    const budgets = await API.Budgets.set(cat, amt);
    S.user.budgets = budgets;
    document.getElementById('budgetModal').classList.add('H');
    refreshAnalyticsCharts(S.user.transactions || []);
    toast('Budget set for ' + cat + '!');
  } catch (e) { toast(e.message, 'warn'); }
}

// ── Transactions ───────────────────────────────────────────
function updateSelBar() {
  const n = selectedTxIds.size, bar = document.getElementById('selBar');
  if (!bar) return;
  if (n === 0) { bar.classList.add('H'); }
  else {
    bar.classList.remove('H');
    document.getElementById('selBarTxt').textContent = n + ' transaction' + (n > 1 ? 's' : '') + ' selected';
    const editBtn = document.getElementById('selEditBtn');
    const dupBtn = document.getElementById('selDupBtn');
    if (editBtn) editBtn.style.display = n === 1 ? '' : 'none';
    if (dupBtn) dupBtn.style.display = n === 1 ? '' : 'none';
  }
}

function exportTxCSV(txList, filename) {
  const header = 'Date,Description,Category,Type,Amount,Status';
  const rows = txList.map(t => `${t.date},"${(t.name || '').replace(/"/g, '""')}",${t.cat},${t.type || (t.amt > 0 ? 'income' : 'expense')},${Math.abs(t.amt).toFixed(2)},${t.status || 'cleared'}`);
  const csv = header + '\n' + rows.join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = filename;
  a.click();
}

function renderTxPage() {
  const dateEl = document.getElementById('qaDate');
  if (dateEl) dateEl.value = today();

  // Wire up add button
  const qaAdd = document.getElementById('qaAdd');
  if (qaAdd) qaAdd.onclick = addTransaction;

  // Wire up search/filter
  const txSearch = document.getElementById('txSearch');
  if (txSearch) txSearch.oninput = renderTxTable;
  const txCatF = document.getElementById('txCatF');
  if (txCatF) txCatF.onchange = renderTxTable;
  const txTypeF = document.getElementById('txTypeF');
  if (txTypeF) txTypeF.onchange = renderTxTable;

  // Bulk action buttons
  const selEditBtn = document.getElementById('selEditBtn');
  if (selEditBtn) selEditBtn.onclick = openEditModal;
  const selDupBtn = document.getElementById('selDupBtn');
  if (selDupBtn) selDupBtn.onclick = duplicateSelected;
  const selDelBtn = document.getElementById('selDelBtn');
  if (selDelBtn) selDelBtn.onclick = deleteSelected;
  const selClearedBtn = document.getElementById('selClearedBtn');
  if (selClearedBtn) selClearedBtn.onclick = () => bulkSetStatus('cleared');
  const selPendingBtn = document.getElementById('selPendingBtn');
  if (selPendingBtn) selPendingBtn.onclick = () => bulkSetStatus('pending');
  const selExportBtn = document.getElementById('selExportBtn');
  if (selExportBtn) selExportBtn.onclick = exportSelected;
  const selClearBtn = document.getElementById('selClearBtn');
  if (selClearBtn) selClearBtn.onclick = () => { selectedTxIds.clear(); updateSelBar(); renderTxTable(); };

  const exportAllBtn = document.getElementById('exportAllBtn');
  if (exportAllBtn) exportAllBtn.onclick = () => {
    const u = usr(); if (!u) return;
    const search = (document.getElementById('txSearch')?.value || '').toLowerCase();
    const cat = document.getElementById('txCatF')?.value || 'all';
    const type = document.getElementById('txTypeF')?.value || 'all';
    const rows = (u.transactions || []).filter(t =>
      (cat === 'all' || t.cat === cat) && (type === 'all' || t.type === type) &&
      ((t.name || '').toLowerCase().includes(search) || (t.cat || '').toLowerCase().includes(search))
    );
    exportTxCSV(rows, 'transactions.csv');
    toast('Exported ' + rows.length + ' transactions!');
  };

  const etCancel = document.getElementById('etCancel');
  if (etCancel) etCancel.onclick = () => document.getElementById('editTxModal').classList.add('H');
  const etSave = document.getElementById('etSave');
  if (etSave) etSave.onclick = saveEditedTx;

  renderTxTable();
}

async function bulkSetStatus(status) {
  const u = usr(); if (!u || selectedTxIds.size === 0) return;
  setSyncState('saving');
  try {
    for (const id of selectedTxIds) {
      const idx = (u.transactions || []).findIndex(t => t.id === id);
      if (idx > -1) { await API.Transactions.update(id, { status }); u.transactions[idx].status = status; }
    }
    setSyncState('saved'); renderTxTable();
    toast(selectedTxIds.size + ' transaction' + (selectedTxIds.size > 1 ? 's' : '') + ' marked ' + status + '!');
  } catch (e) { toast(e.message, 'warn'); setSyncState('saved'); }
}

async function duplicateSelected() {
  const u = usr(); if (!u || selectedTxIds.size !== 1) return;
  const id = [...selectedTxIds][0];
  const tx = (u.transactions || []).find(t => t.id === id); if (!tx) return;
  const copy = { date: tx.date, name: 'Copy of ' + tx.name, cat: tx.cat, type: tx.type, amt: tx.amt, status: 'pending' };
  try {
    const txs = await API.Transactions.add(copy);
    S.user.transactions = txs;
    selectedTxIds.clear(); updateSelBar(); renderTxTable();
    toast('Transaction duplicated as pending!');
  } catch (e) { toast(e.message, 'warn'); }
}

function exportSelected() {
  const u = usr(); if (!u || selectedTxIds.size === 0) return;
  const txList = (u.transactions || []).filter(t => selectedTxIds.has(t.id));
  exportTxCSV(txList, 'selected_transactions.csv');
  toast('Exported ' + txList.length + ' transaction' + (txList.length > 1 ? 's' : '') + ' to CSV!');
}

function openEditModal() {
  const u = usr(); if (!u || selectedTxIds.size !== 1) return;
  const id = [...selectedTxIds][0];
  const tx = (u.transactions || []).find(t => t.id === id); if (!tx) return;
  document.getElementById('etDesc').value = tx.name || '';
  document.getElementById('etAmt').value = Math.abs(tx.amt);
  document.getElementById('etType').value = tx.type || (tx.amt > 0 ? 'income' : 'expense');
  document.getElementById('etCat').value = tx.cat || 'Food';
  document.getElementById('etDate').value = tx.date || today();
  document.getElementById('etStatus').value = tx.status || 'cleared';
  const modal = document.getElementById('editTxModal');
  modal.classList.remove('H');
  modal.dataset.txid = id;
  setTimeout(() => document.getElementById('etDesc')?.focus(), 50);
}

async function saveEditedTx() {
  const u = usr(); if (!u) return;
  const id = document.getElementById('editTxModal').dataset.txid;
  const tx = (u.transactions || []).find(t => t.id === id); if (!tx) return;
  const desc = (document.getElementById('etDesc').value || '').trim();
  const amt = parseFloat(document.getElementById('etAmt').value);
  if (!desc || isNaN(amt) || amt <= 0) { toast('Fill in all fields correctly.', 'warn'); return; }
  const type = document.getElementById('etType').value;
  const changes = {
    name: desc, type,
    cat: document.getElementById('etCat').value,
    date: document.getElementById('etDate').value,
    status: document.getElementById('etStatus').value,
    amt: type === 'expense' ? -Math.abs(amt) : Math.abs(amt)
  };
  try {
    const txs = await API.Transactions.update(id, changes);
    S.user.transactions = txs;
    document.getElementById('editTxModal').classList.add('H');
    selectedTxIds.clear(); updateSelBar(); renderTxTable();
    toast('Transaction updated!');
    if (!document.getElementById('ftAnalytics')?.classList.contains('H')) refreshAnalyticsCharts(S.user.transactions || []);
    if (!document.getElementById('ftOverview')?.classList.contains('H')) renderFinOverview();
  } catch (e) { toast(e.message, 'warn'); }
}

async function deleteSelected() {
  const u = usr(); if (!u || selectedTxIds.size === 0) return;
  const n = selectedTxIds.size;
  if (!confirm('Delete ' + n + ' transaction' + (n > 1 ? 's' : '') + ' permanently?')) return;
  try {
    const ids = [...selectedTxIds];
    const txs = await API.Transactions.bulkRemove(ids);
    S.user.transactions = txs;
    selectedTxIds.clear(); updateSelBar(); renderTxTable();
    toast(n + ' transaction' + (n > 1 ? 's' : '') + ' deleted.', 'warn');
    if (!document.getElementById('ftAnalytics')?.classList.contains('H')) refreshAnalyticsCharts(S.user.transactions || []);
    if (!document.getElementById('ftOverview')?.classList.contains('H')) renderFinOverview();
  } catch (e) { toast(e.message, 'warn'); }
}

async function addTransaction() {
  const u = usr(); if (!u) return;
  const desc = (document.getElementById('qaDesc')?.value || '').trim();
  const amt = parseFloat(document.getElementById('qaAmt')?.value);
  const cat = document.getElementById('qaCat')?.value || 'Food';
  const type = document.getElementById('qaType')?.value || 'expense';
  const date = document.getElementById('qaDate')?.value || today();
  if (!desc || isNaN(amt) || amt <= 0) { toast('Please fill in description and amount.', 'warn'); return; }
  try {
    const txs = await API.Transactions.add({ date, name: desc, cat, type, amt: type === 'expense' ? -amt : amt, status: 'cleared' });
    S.user.transactions = txs;
    if (document.getElementById('qaDesc')) document.getElementById('qaDesc').value = '';
    if (document.getElementById('qaAmt')) document.getElementById('qaAmt').value = '';
    renderTxTable(); toast('Transaction added!');
    if (!document.getElementById('ftOverview')?.classList.contains('H')) renderFinOverview();
    if (!document.getElementById('ftAnalytics')?.classList.contains('H')) refreshAnalyticsCharts(S.user.transactions || []);
  } catch (e) { toast(e.message, 'warn'); }
}

function renderTxTable() {
  const u = usr(); if (!u) return;
  const txns = u.transactions || [];
  const search = (document.getElementById('txSearch')?.value || '').toLowerCase();
  const cat = document.getElementById('txCatF')?.value || 'all';
  const type = document.getElementById('txTypeF')?.value || 'all';

  let rows = txns.filter(t =>
    (cat === 'all' || t.cat === cat) &&
    (type === 'all' || t.type === type) &&
    ((t.name || '').toLowerCase().includes(search) || (t.cat || '').toLowerCase().includes(search))
  );

  // Sort
  rows = [...rows].sort((a, b) => {
    let av = a[txSortCol === 'description' ? 'name' : txSortCol === 'category' ? 'cat' : txSortCol] || '';
    let bv = b[txSortCol === 'description' ? 'name' : txSortCol === 'category' ? 'cat' : txSortCol] || '';
    if (txSortCol === 'amount') { av = a.amt; bv = b.amt; }
    if (typeof av === 'string') return txSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
    return txSortAsc ? av - bv : bv - av;
  });

  const countEl = document.getElementById('txRowCount');
  if (countEl) countEl.textContent = rows.length + ' of ' + txns.length;

  const allIds = rows.map(t => t.id);
  const allChecked = allIds.length > 0 && allIds.every(id => selectedTxIds.has(id));

  const head = document.getElementById('txHead2');
  if (!head) return;
  head.innerHTML = `<tr><th class="tx-cb-th" style="cursor:default"><input type="checkbox" class="tx-cb" id="txCbAll" ${allChecked ? 'checked' : ''} title="Select all visible"/></th>${['date', 'description', 'category', 'amount', 'status'].map(h => `<th class="${txSortCol === h ? 'sorted' : ''}" data-col="${h}">${h.charAt(0).toUpperCase() + h.slice(1)} ${txSortCol === h ? (txSortAsc ? '↑' : '↓') : ''}</th>`).join('')}</tr>`;

  head.querySelectorAll('th[data-col]').forEach(th => {
    th.onclick = () => {
      if (txSortCol === th.dataset.col) txSortAsc = !txSortAsc;
      else { txSortCol = th.dataset.col; txSortAsc = true; }
      renderTxTable();
    };
  });

  const cbAll = document.getElementById('txCbAll');
  if (cbAll) cbAll.addEventListener('change', () => {
    if (cbAll.checked) allIds.forEach(id => selectedTxIds.add(id));
    else allIds.forEach(id => selectedTxIds.delete(id));
    updateSelBar(); renderTxTable();
  });

  const body = document.getElementById('txBody2');
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--tx3);padding:28px 0">No transactions match — try adjusting your filters</td></tr>';
    return;
  }

  const selRows = rows.filter(t => selectedTxIds.has(t.id));
  const selInc = selRows.filter(t => t.amt > 0).reduce((s, t) => s + t.amt, 0);
  const selExp = selRows.filter(t => t.amt < 0).reduce((s, t) => s + Math.abs(t.amt), 0);
  body.innerHTML = '';

  rows.forEach(t => {
    const col = CAT_COLORS[t.cat] || '#888';
    const bg = isDk() ? col + '22' : col + '18';
    const pos = t.amt > 0;
    const sb = t.status === 'cleared' ? (isDk() ? '#0d2818' : '#f0fdf4') : (isDk() ? '#2e1e00' : '#fffbeb');
    const sc = t.status === 'cleared' ? (isDk() ? '#3fb950' : '#15803d') : (isDk() ? '#d29922' : '#b45309');
    const isSel = selectedTxIds.has(t.id);
    const tr = document.createElement('tr');
    if (isSel) tr.classList.add('tx-selected');
    tr.style.cursor = 'pointer';
    tr.title = 'Double-click to edit';
    tr.innerHTML = `<td class="tx-cb-td"><input type="checkbox" class="tx-cb tx-row-cb" data-id="${t.id}" ${isSel ? 'checked' : ''}/></td><td style="color:var(--tx3);font-size:11px">${t.date || ''}</td><td><div class="tx-row"><div class="tx-icon" style="background:${bg};color:${col}"><svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:${col}">${CAT_ICONS[t.cat] || ''}</svg></div><div class="tx-name">${escHtml(t.name || '')}</div></div></td><td><span class="badge" style="background:${bg};color:${col}">${t.cat || ''}</span></td><td class="${pos ? 'amt-pos' : 'amt-neg'}" style="font-variant-numeric:tabular-nums">${pos ? '+' : '-'}₹${Math.abs(t.amt).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td><span class="badge" style="background:${sb};color:${sc}">${t.status || 'cleared'}</span></td>`;
    tr.addEventListener('dblclick', e => {
      if (e.target.closest('.tx-cb-td')) return;
      selectedTxIds.clear(); selectedTxIds.add(t.id);
      updateSelBar(); renderTxTable(); openEditModal();
    });
    body.appendChild(tr);
  });

  body.querySelectorAll('.tx-row-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) selectedTxIds.add(id);
      else selectedTxIds.delete(id);
      updateSelBar(); renderTxTable();
    });
    cb.addEventListener('click', e => e.stopPropagation());
  });

  if (selRows.length > 0) {
    const foot = document.createElement('tr');
    foot.innerHTML = `<td colspan="6" style="padding:8px 14px;background:var(--blubg);border-top:1px solid var(--blumid);font-size:11px;color:var(--blumid);font-weight:600">Selected: ${selRows.length} row${selRows.length > 1 ? 's' : ''}${selInc > 0 ? ` &nbsp;·&nbsp; <span style="color:var(--grnmid)">+₹${selInc.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>` : ''}${selExp > 0 ? ` &nbsp;·&nbsp; <span style="color:var(--redm)">-₹${selExp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>` : ''} &nbsp;·&nbsp; Net: <span style="color:${selInc - selExp >= 0 ? 'var(--grnmid)' : 'var(--redm)'}">${selInc - selExp >= 0 ? '+' : ''}₹${Math.abs(selInc - selExp).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></td>`;
    body.appendChild(foot);
  }
}

function renderWeeklyReview() {
  const u = usr(); if (!u) return;
  const txns = u.transactions || [];
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const weekTxns = txns.filter(t => new Date(t.date + 'T12:00:00') >= weekStart);
  const weekInc = weekTxns.filter(t => t.amt > 0).reduce((s, t) => s + t.amt, 0);
  const weekExp = weekTxns.filter(t => t.amt < 0).reduce((s, t) => s + Math.abs(t.amt), 0);
  const weekNet = weekInc - weekExp;

  const wrSub = document.getElementById('wrSubtitle');
  if (wrSub) wrSub.textContent = `Summary for ${weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const wrGrid = document.getElementById('wrGrid');
  if (wrGrid) wrGrid.innerHTML = [
    { label: 'Week income', val: '₹' + weekInc.toFixed(0), color: '#22c55e' },
    { label: 'Week expenses', val: '₹' + weekExp.toFixed(0), color: '#ef4444' },
    { label: 'Net this week', val: (weekNet >= 0 ? '+' : '') + ('₹' + Math.abs(weekNet).toFixed(0)), color: weekNet >= 0 ? '#22c55e' : '#ef4444' },
    { label: 'Transactions', val: weekTxns.length, color: '#3b82f6' }
  ].map(i => `<div class="wr-item" style="border-color:${i.color}"><div class="wr-item-label">${i.label}</div><div class="wr-item-val" style="color:${i.color}">${i.val}</div></div>`).join('');

  const suggestions = [
    weekExp > weekInc * 0.7 ? { icon: '⚠️', msg: 'Expenses are above 70% of income this week.', color: '#f59e0b' } : null,
    weekNet < 0 ? { icon: '🔴', msg: 'You spent more than you earned this week.', color: '#ef4444' } : null,
    weekNet > 1000 ? { icon: '✅', msg: 'Great week! You saved ₹' + weekNet.toFixed(0) + '. Consider moving the surplus to a savings goal.', color: '#22c55e' } : null,
    { icon: '💡', msg: 'Set a daily spending limit to stay on track. Try the 24-hour rule before non-essential purchases.', color: '#3b82f6' },
    weekTxns.filter(t => t.cat === 'Entertainment').length > 3 ? { icon: '🎬', msg: 'Multiple entertainment transactions this week. Check if any subscriptions can be paused.', color: '#8b5cf6' } : null
  ].filter(Boolean);

  const wrSug = document.getElementById('wrSuggestions');
  if (wrSug) wrSug.innerHTML = suggestions.slice(0, 4).map(s => `<div class="wr-sug" style="border-color:${s.color}"><span>${s.icon}</span><span style="color:var(--tx2)">${s.msg}</span></div>`).join('');

  const smallTxns = txns.filter(t => t.amt < 0 && Math.abs(t.amt) < 50);
  const leakMap = {};
  smallTxns.forEach(t => { leakMap[t.cat] = (leakMap[t.cat] || 0) + Math.abs(t.amt); });
  const leaks = Object.entries(leakMap).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const spendingLeaks = document.getElementById('spendingLeaks');
  if (spendingLeaks) spendingLeaks.innerHTML = leaks.map(([cat, amt]) => `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--sf2);border-radius:8px;font-size:12px"><span style="color:var(--tx2)">${cat}</span><span style="font-weight:600;color:var(--redm)">₹${amt.toFixed(2)}</span></div>`).join('') || '<div style="font-size:12px;color:var(--tx3);padding:8px">No small recurring leaks detected.</div>';

  const catMap2 = {};
  txns.filter(t => t.type === 'expense').forEach(t => { catMap2[t.cat] = (catMap2[t.cat] || 0) + Math.abs(t.amt); });
  const budgets = getBudgets();
  const alerts = [];
  Object.entries(budgets).forEach(([cat, budget]) => {
    const spent = catMap2[cat] || 0;
    if (spent > budget) alerts.push({ msg: `${cat} is ${Math.round((spent / budget - 1) * 100)}% over budget`, color: '#ef4444' });
  });
  if (weekExp > weekInc) alerts.push({ msg: 'Overspending detected this week', color: '#ef4444' });
  alerts.push({ msg: 'Tip: log transactions daily for more accurate weekly reviews', color: '#3b82f6' });

  const ruleAlerts = document.getElementById('ruleAlerts');
  if (ruleAlerts) ruleAlerts.innerHTML = alerts.slice(0, 5).map(a => `<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;background:var(--sf2);border-radius:8px;border-left:3px solid ${a.color};font-size:12px;color:var(--tx2)"><span>•</span><span>${a.msg}</span></div>`).join('');

  const budgetActual = document.getElementById('budgetActual');
  if (budgetActual) budgetActual.innerHTML = Object.entries(budgets).map(([cat, budget]) => {
    const spent = catMap2[cat] || 0, pct = Math.round(spent / budget * 100), over = spent > budget;
    const color = CAT_COLORS_AN[cat] || '#888';
    return `<div class="cat-item2"><div class="cat-head2"><div class="cat-name2"><div class="cat-dot" style="background:${color}"></div>${cat}</div><div style="display:flex;gap:8px;align-items:center"><span style="font-size:11px;color:${over ? '#ef4444' : 'var(--tx3)'}">₹${spent.toFixed(0)} / ₹${budget}</span><span class="cat-amt" style="color:${over ? '#ef4444' : color}">${pct}%</span></div></div><div class="cat-track"><div class="cat-fill" style="width:${Math.min(pct, 100)}%;background:${over ? '#ef4444' : color}"></div></div></div>`;
  }).join('') || '<div style="font-size:12px;color:var(--tx3);padding:8px 0">Set budgets in the Analytics tab to track actuals here.</div>';
}

// ══════════════════════════════════════════════════════════
//  JOURNAL MODULE
// ══════════════════════════════════════════════════════════
const MOODS = [
  { e: '😊', l: 'Happy', score: 5 }, { e: '😌', l: 'Calm', score: 4 },
  { e: '🔥', l: 'Motivated', score: 5 }, { e: '😔', l: 'Sad', score: 1 },
  { e: '😤', l: 'Frustrated', score: 2 }, { e: '😴', l: 'Tired', score: 2 },
  { e: '🤔', l: 'Reflective', score: 3 }, { e: '🎉', l: 'Excited', score: 5 }
];
const TAGS = ['Gratitude', 'Work', 'Personal', 'Goals', 'Health', 'Travel', 'Learning', 'Idea'];

let jState = { mode: 'list', tab: 'entries', editId: null, selMood: null, selTags: [], searchQ: '' };
function getJournals() { const u = usr(); return u ? (u.journals || []) : []; }

function fmtRelative(dateStr) {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    const diff = Math.round((Date.now() - d) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return diff + ' days ago';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) { return dateStr || ''; }
}

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderJournalPage() {
  const pg = document.getElementById('pgJournal');
  if (!pg) return;
  pg.innerHTML = '';

  const journals = getJournals();

  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = dStr(addD(new Date(), -i));
    if (journals.some(j => j.date === d)) streak++;
    else if (i > 0) break;
  }
  const totalWords = journals.reduce((s, j) => s + ((j.body || '').split(/\s+/).filter(Boolean).length), 0);
  const thisMonth = journals.filter(j => {
    try {
      const d = new Date(j.date + 'T12:00:00'), n = new Date();
      return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
    } catch (e) { return false; }
  }).length;

  // Stats row
  const statsRow = document.createElement('div');
  statsRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
  [
    { icon: '📅', label: 'Writing streak', val: streak + ' day' + (streak !== 1 ? 's' : '') },
    { icon: '📝', label: 'Total entries', val: journals.length },
    { icon: '📖', label: 'Words written', val: totalWords.toLocaleString() },
    { icon: '🗓', label: 'This month', val: thisMonth }
  ].forEach(s => {
    const el = document.createElement('div');
    el.className = 'jstat';
    el.innerHTML = `${s.icon} ${s.label}: <strong>${s.val}</strong>`;
    statsRow.appendChild(el);
  });
  pg.appendChild(statsRow);

  // Layout
  const layout = document.createElement('div');
  layout.className = 'journal-layout';

  // Sidebar
  const sidebar = document.createElement('div');
  sidebar.className = 'journal-sidebar';
  sidebar.innerHTML = `
    <div class="journal-sidebar-head">
      <span class="journal-sidebar-title">📔 My Journal</span>
      <button class="btn-new-journal" id="jNewBtn">✦ New Entry</button>
    </div>
    <div class="journal-mini-stats">
      <div class="jms"><div class="jms-val">${journals.length}</div><div class="jms-lbl">Entries</div></div>
      <div class="jms"><div class="jms-val">${streak}</div><div class="jms-lbl">Streak</div></div>
      <div class="jms"><div class="jms-val">${thisMonth}</div><div class="jms-lbl">This month</div></div>
      <div class="jms"><div class="jms-val">${totalWords > 999 ? Math.round(totalWords / 1000) + 'k' : totalWords}</div><div class="jms-lbl">Words</div></div>
    </div>
    <div class="journal-tabs">
      <div class="jtab ${jState.tab === 'entries' ? 'on' : ''}" id="jtabEntries">Entries</div>
      <div class="jtab ${jState.tab === 'analytics' ? 'on' : ''}" id="jtabAnalytics">Analytics</div>
    </div>`;

  if (jState.tab === 'entries') {
    const searchDiv = document.createElement('div');
    searchDiv.className = 'journal-search';
    searchDiv.innerHTML = '<input type="text" placeholder="Search entries…" id="jSearch"/>';
    sidebar.appendChild(searchDiv);

    const listDiv = document.createElement('div');
    listDiv.className = 'journal-list';
    const q = (jState.searchQ || '').toLowerCase();
    const filtered = journals.filter(j => !q || (j.title || '').toLowerCase().includes(q) || (j.body || '').toLowerCase().includes(q));

    if (!filtered.length) {
      listDiv.innerHTML = `<div class="journal-empty-state"><div class="je-icon">📝</div><div class="je-txt">${q ? 'No entries match your search.' : 'No journal entries yet.\nClick "New Entry" to start writing.'}</div></div>`;
    } else {
      filtered.forEach(entry => {
        const card = document.createElement('div');
        card.className = 'journal-card' + (jState.editId === entry.id ? ' active' : '');
        card.innerHTML = `<div class="jc-date"><span class="jc-mood">${entry.mood || '📅'}</span>${fmtRelative(entry.date)}</div><div class="jc-title">${escHtml(entry.title || 'Untitled')}</div><div class="jc-preview">${escHtml((entry.body || '').slice(0, 120))}</div><button class="jc-del" data-id="${entry.id}" title="Delete entry">×</button>`;
        card.addEventListener('click', e => {
          if (e.target.classList.contains('jc-del')) return;
          jState.editId = entry.id; jState.mode = 'view'; renderJournalPage();
        });
        card.querySelector('.jc-del').addEventListener('click', async e => {
          e.stopPropagation();
          if (!confirm('Delete this entry?')) return;
          try {
            const j2 = await API.Journals.remove(entry.id);
            S.user.journals = j2;
            if (jState.editId === entry.id) { jState.editId = null; jState.mode = 'list'; }
            renderJournalPage(); toast('Entry deleted.', 'warn');
          } catch (e2) { toast(e2.message, 'warn'); }
        });
        listDiv.appendChild(card);
      });
    }
    sidebar.appendChild(listDiv);
  } else {
    const hint = document.createElement('div');
    hint.style.cssText = 'padding:16px 12px;font-size:12px;color:var(--tx3);line-height:1.7';
    hint.innerHTML = '📊 Analytics are shown in the main panel →';
    sidebar.appendChild(hint);
  }

  sidebar.addEventListener('click', e => {
    const t = e.target;
    if (t.id === 'jtabEntries') { jState.tab = 'entries'; jState.mode = 'list'; jState.editId = null; renderJournalPage(); }
    else if (t.id === 'jtabAnalytics') { jState.tab = 'analytics'; renderJournalPage(); }
    else if (t.id === 'jNewBtn') { jState.tab = 'entries'; jState.mode = 'edit'; jState.editId = null; jState.selMood = null; jState.selTags = []; renderJournalPage(); }
  });

  // Right panel
  const rightPane = document.createElement('div');
  rightPane.className = 'journal-editor';

  if (jState.tab === 'analytics') {
    rightPane.appendChild(renderJournalAnalyticsPanel(journals));
  } else if (jState.mode === 'edit') {
    renderJournalEditorForm(rightPane);
  } else if (jState.mode === 'view' && jState.editId) {
    const entry = journals.find(j => j.id === jState.editId);
    if (entry) renderJournalBookView(rightPane, entry);
    else { jState.mode = 'list'; jState.editId = null; }
  } else {
    rightPane.innerHTML = `<div class="journal-editor-empty"><div class="je-big-icon">📖</div><div class="je-hint">Select an entry to read it,<br>or click <strong>New Entry</strong> to start writing.</div></div>`;
  }

  layout.appendChild(sidebar);
  layout.appendChild(rightPane);
  pg.appendChild(layout);

  // Search binding
  if (jState.tab === 'entries') {
    const si = document.getElementById('jSearch');
    if (si) {
      si.value = jState.searchQ || '';
      si.addEventListener('input', () => { jState.searchQ = si.value; renderJournalPage(); });
    }
  }
}

function renderJournalAnalyticsPanel(journals) {
  const wrap = document.createElement('div');
  wrap.className = 'jan-wrap';
  if (!journals.length) {
    wrap.innerHTML = '<div style="padding:32px;text-align:center;font-size:13px;color:var(--tx3)">✍ Write a few entries to unlock analytics.</div>';
    return wrap;
  }

  const avgWords = Math.round(journals.reduce((s, j) => s + ((j.body || '').split(/\s+/).filter(Boolean).length), 0) / journals.length);
  const moodCounts = {};
  journals.filter(j => j.mood).forEach(j => { moodCounts[j.mood] = (moodCounts[j.mood] || 0) + 1; });
  const topMood = Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0];
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = dStr(addD(new Date(), -i));
    if (journals.some(j => j.date === d)) streak++;
    else if (i > 0) break;
  }

  const kpiRow = document.createElement('div');
  kpiRow.className = 'jan-kpi-row';
  kpiRow.innerHTML = [
    { icon: '📊', val: journals.length, lbl: 'Total entries' },
    { icon: '🔥', val: streak, lbl: 'Day streak' },
    { icon: '📝', val: avgWords, lbl: 'Avg words' },
    { icon: topMood ? topMood[0] : '😊', val: topMood ? topMood[1] : 0, lbl: 'Top mood count' }
  ].map((k, i) => `<div class="jan-kpi" style="animation-delay:${i * 60}ms"><div class="jan-kpi-icon">${k.icon}</div><div class="jan-kpi-val">${k.val}</div><div class="jan-kpi-lbl">${k.lbl}</div></div>`).join('');
  wrap.appendChild(kpiRow);

  const MOOD_SCORE = { '😢': 1, '😞': 2, '😐': 3, '🙂': 4, '😊': 5, '😄': 6, '🤩': 7, '😡': 1, '😰': 2, '😴': 3 };
  const moodEntries = journals.filter(j => j.mood && MOOD_SCORE[j.mood] !== undefined).sort((a, b) => a.date.localeCompare(b.date)).slice(-30);

  const moodSection = document.createElement('div');
  moodSection.className = 'jan-chart-section';
  moodSection.innerHTML = `<div class="jan-chart-title">📈 Mood Over Time <span class="jan-chart-sub">(last 30 entries)</span></div><div class="jan-chart-wrap"><canvas id="moodLineChart"></canvas></div>`;
  wrap.appendChild(moodSection);

  const moodDistSection = document.createElement('div');
  moodDistSection.className = 'jan-chart-section jan-chart-half';
  moodDistSection.innerHTML = `<div class="jan-chart-title">😊 Mood Distribution</div><div class="jan-chart-wrap" style="height:200px"><canvas id="moodDonutChart"></canvas></div><div id="moodLegend" class="jan-mood-legend"></div>`;
  wrap.appendChild(moodDistSection);

  const heatSection = document.createElement('div');
  heatSection.className = 'jan-chart-section jan-chart-half';
  heatSection.innerHTML = `<div class="jan-chart-title">📅 Writing Frequency <span class="jan-chart-sub">(last 12 weeks)</span></div><div id="journalHeatmap" class="jan-heatmap"></div>`;
  wrap.appendChild(heatSection);

  const wordsSection = document.createElement('div');
  wordsSection.className = 'jan-chart-section';
  wordsSection.innerHTML = `<div class="jan-chart-title">📝 Words per Entry <span class="jan-chart-sub">(last 14 entries)</span></div><div class="jan-chart-wrap"><canvas id="wordsBarChart"></canvas></div>`;
  wrap.appendChild(wordsSection);

  const tcC = () => isDk() ? '#6b7280' : '#9ca3af';
  const gcC = () => isDk() ? '#1f2937' : '#f3f4f6';

  requestAnimationFrame(() => {
    // Mood line
    const moodLineEl = document.getElementById('moodLineChart');
    if (moodLineEl && moodEntries.length > 1) {
      const moodColors = moodEntries.map(e => { const s = MOOD_SCORE[e.mood] || 3; return s >= 5 ? '#22c55e' : s >= 4 ? '#86efac' : s >= 3 ? '#fbbf24' : '#ef4444'; });
      new Chart(moodLineEl, {
        type: 'line',
        data: {
          labels: moodEntries.map(e => { const d = new Date(e.date + 'T12:00:00'); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }),
          datasets: [{ label: 'Mood', data: moodEntries.map(e => MOOD_SCORE[e.mood] || 3), borderColor: '#8b5cf6', backgroundColor: 'rgba(139,92,246,0.08)', borderWidth: 2.5, fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: moodColors }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 800 },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => { const e = moodEntries[c.dataIndex]; const labels = { 1: 'Very low', 2: 'Low', 3: 'Neutral', 4: 'Good', 5: 'Happy', 6: 'Very happy', 7: 'Excellent' }; return `${e.mood}  ${labels[c.parsed.y] || 'Neutral'}`; } } } },
          scales: { y: { min: 1, max: 7, ticks: { stepSize: 1, font: { size: 10 }, color: tcC(), callback: v => ['', '😢', '😞', '😐', '🙂', '😊', '😄', '🤩'][v] || '' }, grid: { color: gcC() } }, x: { ticks: { font: { size: 9 }, color: tcC(), maxTicksLimit: 10 }, grid: { display: false } } }
        }
      });
    } else if (moodLineEl) {
      moodLineEl.closest('.jan-chart-wrap').innerHTML = '<div style="height:180px;display:flex;align-items:center;justify-content:center;color:var(--tx3);font-size:12px">Add mood to at least 2 entries to see the trend</div>';
    }

    // Mood donut
    const moodDonutEl = document.getElementById('moodDonutChart');
    if (moodDonutEl && Object.keys(moodCounts).length) {
      const MOOD_COLORS_MAP = { '😄': '#22c55e', '🤩': '#10b981', '😊': '#86efac', '🙂': '#fbbf24', '😐': '#94a3b8', '😞': '#f97316', '😢': '#ef4444', '😡': '#dc2626', '😰': '#8b5cf6', '😴': '#64748b' };
      const labels = Object.keys(moodCounts), data = labels.map(k => moodCounts[k]), colors = labels.map(k => MOOD_COLORS_MAP[k] || '#94a3b8');
      new Chart(moodDonutEl, {
        type: 'doughnut',
        data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: isDk() ? '#111827' : '#ffffff' }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '60%', animation: { duration: 700 }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.label}  ${c.parsed} entries (${Math.round(c.parsed / journals.filter(j => j.mood).length * 100)}%)` } } } }
      });
      const total = data.reduce((a, b) => a + b, 0);
      const legendEl = document.getElementById('moodLegend');
      if (legendEl) legendEl.innerHTML = labels.map((l, i) => `<div class="jan-legend-item"><span class="jan-legend-dot" style="background:${colors[i]}"></span>${l} <span class="jan-legend-pct">${Math.round(data[i] / total * 100)}%</span></div>`).join('');
    }

    // Heatmap
    const heatEl = document.getElementById('journalHeatmap');
    if (heatEl) {
      const dateSet = new Set(journals.map(j => j.date));
      const today2 = new Date();
      const days = [];
      for (let i = 83; i >= 0; i--) { const d = new Date(today2); d.setDate(d.getDate() - i); days.push(dStr(d)); }
      heatEl.innerHTML = `<div class="jan-heat-grid">${days.map(d => { const has = dateSet.has(d); const dt = new Date(d + 'T12:00:00'); return `<div class="jan-heat-cell ${has ? 'active' : ''}" title="${dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}${has ? ' ✓' : ''}"></div>`; }).join('')}</div>`;
    }

    // Words bar
    const wordsEl = document.getElementById('wordsBarChart');
    if (wordsEl) {
      const last14 = [...journals].sort((a, b) => a.date.localeCompare(b.date)).slice(-14);
      const wordCounts = last14.map(j => (j.body || '').split(/\s+/).filter(Boolean).length);
      const barColors = wordCounts.map(w => w > 200 ? '#8b5cf6' : w > 100 ? '#06b6d4' : w > 50 ? '#22c55e' : '#94a3b8');
      new Chart(wordsEl, {
        type: 'bar',
        data: { labels: last14.map(j => { const d = new Date(j.date + 'T12:00:00'); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }), datasets: [{ data: wordCounts, backgroundColor: barColors, borderRadius: 5, borderSkipped: false }] },
        options: { responsive: true, maintainAspectRatio: false, animation: { duration: 700 }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${c.parsed.y} words` } } }, scales: { y: { ticks: { font: { size: 10 }, color: tcC() }, grid: { color: gcC() } }, x: { ticks: { font: { size: 9 }, color: tcC() }, grid: { display: false } } } }
      });
    }
  });

  return wrap;
}

function renderJournalEditorForm(wrap) {
  const isEdit = jState.mode === 'edit' && !!jState.editId;
  const journals = getJournals();
  const existing = isEdit ? journals.find(j => j.id === jState.editId) : null;

  wrap.innerHTML = `<div class="journal-editor-form"><div class="jef-toolbar"><div class="jef-mood-wrap"><span class="jef-mood-lbl">Mood:</span>${MOODS.map(m => `<button class="mood-btn ${jState.selMood === m.e ? 'sel' : ''}" data-mood="${m.e}" title="${m.l}">${m.e}</button>`).join('')}</div><div class="jef-tags">${TAGS.map(t => `<span class="tag-chip ${jState.selTags.includes(t) ? 'sel' : ''}" data-tag="${t}">${t}</span>`).join('')}</div></div><div class="jef-meta"><div class="jef-date-lbl">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div><input class="jef-title-inp" id="jTitleInp" placeholder="Entry title…" value="${escHtml(existing?.title || '')}"/></div><div class="jef-divider"></div><div class="jef-body"><textarea class="jef-body-inp" id="jBodyInp" placeholder="What's on your mind today?…">${escHtml(existing?.body || '')}</textarea></div><div class="jef-footer"><span class="jef-word-count" id="jWC">0 words</span><button class="btn-discard" id="jDiscard">Discard</button><button class="btn-save-journal" id="jSave">${isEdit ? 'Update entry' : 'Save entry'}</button></div></div>`;

  const bodyInp = wrap.querySelector('#jBodyInp');
  const wc = wrap.querySelector('#jWC');
  const updateWC = () => { const words = ((bodyInp.value.trim().match(/\S+/g)) || []).length; wc.textContent = words + ' word' + (words !== 1 ? 's' : ''); };
  bodyInp.addEventListener('input', updateWC);
  updateWC();

  wrap.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      jState.selMood = jState.selMood === btn.dataset.mood ? null : btn.dataset.mood;
      wrap.querySelectorAll('.mood-btn').forEach(b => b.classList.toggle('sel', b.dataset.mood === jState.selMood));
    });
  });

  wrap.querySelectorAll('.tag-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const t = chip.dataset.tag;
      if (jState.selTags.includes(t)) jState.selTags = jState.selTags.filter(x => x !== t);
      else jState.selTags = [...jState.selTags, t];
      chip.classList.toggle('sel', jState.selTags.includes(t));
    });
  });

  wrap.querySelector('#jDiscard').addEventListener('click', () => {
    if (isEdit) { jState.mode = 'view'; renderJournalPage(); }
    else { jState.mode = 'list'; jState.editId = null; renderJournalPage(); }
  });

  wrap.querySelector('#jSave').addEventListener('click', async () => {
    const titleEl = document.getElementById('jTitleInp');
    const bodyEl = document.getElementById('jBodyInp');
    const title = (titleEl ? titleEl.value : '').trim();
    const body = (bodyEl ? bodyEl.value : '').trim();
    if (!title && !body) { toast('Write something first!', 'warn'); return; }
    try {
      if (isEdit && existing) {
        const journals2 = await API.Journals.update(existing.id, { title: title || 'Untitled', body, mood: jState.selMood, tags: jState.selTags });
        S.user.journals = journals2;
        toast('Entry updated! 📝');
      } else {
        const journals2 = await API.Journals.add({ title: title || 'Untitled', body, mood: jState.selMood, tags: jState.selTags, date: today() });
        S.user.journals = journals2;
        jState.editId = Array.isArray(journals2) && journals2.length ? journals2[journals2.length - 1]?.id : null;
        toast('Journal saved! 📖');
      }
      jState.mode = 'view'; jState.selMood = null; jState.selTags = [];
      renderJournalPage();
    } catch (e) { toast(e.message || 'Failed to save entry.', 'warn'); }
  });
}

function renderJournalBookView(wrap, entry) {
  const wordCount = ((entry.body || '').trim().split(/\s+/).filter(Boolean)).length;
  const readMins = Math.max(1, Math.ceil(wordCount / 200));
  wrap.innerHTML = `<div class="journal-book-view"><div class="jbv-head"><button class="jbv-back" id="jbvBack" title="Back to list">‹</button><div class="jbv-meta">${entry.tags && entry.tags.length ? `<div class="jbv-tags">${entry.tags.map(t => `<span class="jbv-tag">${t}</span>`).join('')}</div>` : ''}<div class="jbv-date">${new Date(entry.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${wordCount} words · ${readMins} min read</div></div><div class="jbv-actions"><button class="jbv-edit-btn" id="jbvEdit">✏ Edit</button></div></div><div class="journal-book-page">${entry.mood ? `<div class="jbp-mood">${entry.mood}</div>` : ''}<div class="jbp-title">${escHtml(entry.title || 'Untitled')}</div><div class="jbp-body">${escHtml(entry.body || '').replace(/\n/g, '<br>')}</div><div class="jbp-footer"><span>${entry.updatedAt ? 'Last edited ' + fmtRelative(entry.updatedAt.slice(0, 10)) : 'Written on ' + fmtRelative(entry.date)}</span><span>✍ ${wordCount} words</span></div></div></div>`;
  wrap.querySelector('#jbvBack').addEventListener('click', () => { jState.mode = 'list'; jState.editId = null; renderJournalPage(); });
  wrap.querySelector('#jbvEdit').addEventListener('click', () => { jState.mode = 'edit'; jState.selMood = entry.mood || null; jState.selTags = [...(entry.tags || [])]; renderJournalPage(); });
}

// ══════════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════════
async function boot() {
  // ── Hard timeout: max 8s on splash ────────────────────────
  const killSwitch = setTimeout(() => {
    console.warn('[Devnix] Boot timeout — forcing login screen');
    document.getElementById('splash').classList.add('H');
    document.getElementById('authView').classList.remove('H');
  }, 8000);

  const finish = () => clearTimeout(killSwitch);

  // Apply saved dark mode preference before anything renders
  try {
    const savedDark = localStorage.getItem('devnix_dark');
    if (savedDark === 'true') { S.dark = true; applyDark(); }
  } catch (e) { /* storage blocked */ }

  // No token → show login immediately
  if (!API.getToken()) {
    finish();
    document.getElementById('splash').classList.add('H');
    document.getElementById('authView').classList.remove('H');
    return;
  }

  try {
    // Race: /auth/me vs 6s timeout
    const user = await Promise.race([
      API.Auth.me(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Request timed out')), 6000))
    ]);

    finish();

    if (!user || !user.email) {
      // Malformed response — wipe token
      API.Auth.logout();
      document.getElementById('splash').classList.add('H');
      document.getElementById('authView').classList.remove('H');
      return;
    }

    S.user = normaliseUser(user);
    S.dark = !!(user.dark);
    applyDark();
    document.getElementById('splash').classList.add('H');
    mountApp();

  } catch (e) {
    finish();
    console.warn('[Devnix] Boot failed:', e.message);
    // Token expired / network error → clear token, show login
    API.Auth.logout();
    applyDark(); // keep dark mode if user had it set
    document.getElementById('splash').classList.add('H');
    document.getElementById('authView').classList.remove('H');
  }
}

function mountApp() {
  document.getElementById('authView').classList.add('H');
  document.getElementById('splash').classList.add('H');
  document.getElementById('appShell').classList.remove('H');

  const u = S.user;
  const av = document.getElementById('nbAv');
  if (av) av.textContent = ((u?.email || '?').split('@')[0][0] || '?').toUpperCase();

  applyDark();
  wOff = 0;
  selectedTxIds.clear();

  renderGrid();
  setTimeout(() => renderDisciplineAnalytics(), 800);
  setSyncState('saved');
}

// ── Start the app ─────────────────────────────────────────
boot();
