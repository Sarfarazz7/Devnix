// public/js/app.js — Devnix Frontend (fully fixed)
// ── Global state ──────────────────────────────────────────
let S = { user: null, dark: false };
let wOff = 0, barCI = null, lineCI = null, analyDays = 14;
let dragActive = false, dragVal = false;
let noteCtx = { tid: null, ds: null };
let debTimer = null;
let txSortCol = 'date', txSortAsc = false;
let finCharts = {};
let selectedTxIds = new Set();

const CAT_COL  = { health:'#4caf50', work:'#2196f3', study:'#9c27b0', other:'#ff9800' };
const WD  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MO  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const usr = () => S.user;
const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
const dStr = d => { const x = d instanceof Date ? d : new Date(d+'T12:00:00'); return x.toISOString().slice(0,10); };
const today = () => new Date().toISOString().slice(0,10);
const addD = (base,n) => { const d = new Date(typeof base==='string'?base+'T12:00:00':base); d.setDate(d.getDate()+n); return d; };
const fmtFull = d => d.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
const isDk = () => S.dark;
const tc = () => isDk() ? '#555e72' : '#9ea3b5';
const gc = () => isDk() ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)';
const sf = () => isDk() ? '#181b24' : '#fff';

// ── Sync indicator ─────────────────────────────────────────
function setSyncState(st) {
  const dot = document.getElementById('syncDot'), txt = document.getElementById('syncTxt');
  if (!dot) return;
  if (st === 'saving') { dot.classList.add('saving'); txt.textContent = 'Saving…'; }
  else { dot.classList.remove('saving'); txt.textContent = 'Saved'; }
}

// ── Toast ──────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const w = document.getElementById('toastWrap'); if (!w) return;
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg;
  w.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transform='translateY(-8px)'; t.style.transition='all .3s'; setTimeout(()=>t.remove(),300); }, 2200);
}

// ── Dark mode ──────────────────────────────────────────────
function applyDark() {
  document.body.classList.toggle('dk', S.dark);
  const btn = document.getElementById('darkBtn');
  if (btn) btn.textContent = S.dark ? '☀' : '☾';
}
const toggleDark = async () => {
  S.dark = !S.dark; applyDark();
  toast(S.dark ? 'Dark mode on' : 'Light mode on');
  try { await API.Settings.setDark(S.dark); } catch(e) {
    // FIX #13: revert if backend call fails
    S.dark = !S.dark; applyDark();
    toast('Could not save dark mode preference.','warn');
  }
};
document.getElementById('darkBtn').addEventListener('click', toggleDark);

// ── Auth UI ────────────────────────────────────────────────
let isUp = false;

function setAuthMode(register) {
  isUp = register;
  document.getElementById('aBtn').textContent = register ? 'Create account' : 'Sign in';
  document.getElementById('aToggle').textContent = register ? 'Sign in instead' : 'Create one free';
  document.getElementById('authErr').classList.add('H');
}

document.getElementById('aToggle').addEventListener('click', () => setAuthMode(!isUp));
const showAuthErr = m => { const e = document.getElementById('authErr'); e.textContent = m; e.classList.remove('H'); };
document.getElementById('aBtn').addEventListener('click', doAuth);
['aEm','aPw'].forEach(id => document.getElementById(id).addEventListener('keydown', e => { if (e.key==='Enter') doAuth(); }));

async function doAuth() {
  const em = document.getElementById('aEm').value.trim().toLowerCase();
  const pw = document.getElementById('aPw').value;
  if (!em || !pw) { showAuthErr('Please fill in all fields.'); return; }
  if (!em.includes('@')) { showAuthErr('Enter a valid email.'); return; }
  if (pw.length < 6) { showAuthErr('Password must be 6+ characters.'); return; }

  // FIX #2: Read the "stay signed in" checkbox
  const remember = document.getElementById('aRem')?.checked || false;

  const btn = document.getElementById('aBtn');
  const origText = btn.textContent;
  btn.textContent = '…'; btn.disabled = true;
  document.getElementById('authErr').classList.add('H');
  try {
    const user = isUp
      ? await API.Auth.register(em, pw, remember)
      : await API.Auth.login(em, pw, remember);
    S.user = normaliseUser(user);
    S.dark = user.dark || false;
    applyDark();
    toast(isUp ? 'Account created! Welcome.' : 'Welcome back!');
    mountApp();
  } catch (err) {
    showAuthErr(err.message || 'Something went wrong. Please try again.');
  } finally {
    btn.textContent = origText;
    btn.disabled = false;
  }
}

async function doLogout() {
  try { API.Auth.logout(); } catch(e) { /* ignore */ }
  S = { user: null, dark: false };
  applyDark();
  // Destroy all chart instances to avoid stale canvas state on re-login
  [barCI, lineCI].forEach(c => { try { c && c.destroy(); } catch(e){} });
  barCI = lineCI = null;
  Object.values(finCharts).forEach(c => { try { c && c.destroy(); } catch(e){} });
  finCharts = {};
  document.getElementById('appShell').classList.add('H');
  document.getElementById('authView').classList.remove('H');
  document.getElementById('aEm').value = '';
  document.getElementById('aPw').value = '';
  document.getElementById('aPw') && (document.getElementById('aPw').value = '');
  document.getElementById('authErr').classList.add('H');
  // Reset nav state
  document.querySelectorAll('.nb-btn').forEach(b => b.classList.remove('on'));
  const dashBtn = document.querySelector('.nb-btn[data-pg="dashboard"]');
  if (dashBtn) dashBtn.classList.add('on');
  ['pgDashboard','pgFinance','pgJournal','pgProfile'].forEach(id => {
    const el = document.getElementById(id); if (el) el.classList.add('H');
  });
  document.getElementById('pgDashboard')?.classList.remove('H');
  toast('Signed out.', 'warn');
}
document.getElementById('logoutBtn').addEventListener('click', doLogout);

// ── Normalise user from MongoDB ────────────────────────────
function toPlainObj(val) {
  if (!val) return {};
  if (val instanceof Map) return Object.fromEntries(val);
  if (typeof val === 'object') return Object.assign({}, val);
  return {};
}
function normaliseUser(u) {
  if (!u) return u;
  const norm = { ...u };
  norm.done    = toPlainObj(norm.done);
  norm.skipped = toPlainObj(norm.skipped);
  norm.notes   = toPlainObj(norm.notes);
  norm.budgets = toPlainObj(norm.budgets);
  norm.transactions = Array.isArray(norm.transactions) ? norm.transactions : [];
  norm.journals     = Array.isArray(norm.journals)     ? norm.journals     : [];
  norm.savingsGoals = Array.isArray(norm.savingsGoals) ? norm.savingsGoals : [];
  norm.tasks        = Array.isArray(norm.tasks)        ? norm.tasks        : [];
  return norm;
}

// ── Debounced save ─────────────────────────────────────────
function debounceSave() {
  setSyncState('saving');
  clearTimeout(debTimer);
  debTimer = setTimeout(async () => {
    try {
      await API.Tasks.saveCheck(S.user.done, S.user.skipped, S.user.notes);
      setSyncState('saved');
    } catch (e) { setSyncState('saved'); }
  }, 600);
}

// ── Nav ────────────────────────────────────────────────────
document.querySelectorAll('.nb-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nb-btn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    ['pgDashboard','pgFinance','pgJournal','pgProfile'].forEach(id =>
      document.getElementById(id)?.classList.add('H'));
    const pg = btn.dataset.pg;
    if (pg === 'dashboard') {
      document.getElementById('pgDashboard').classList.remove('H');
    } else if (pg === 'finance') {
      document.getElementById('pgFinance').classList.remove('H');
      setTimeout(() => renderFinOverview(), 100);
    } else if (pg === 'journal') {
      document.getElementById('pgJournal').classList.remove('H');
      // FIX #11: Only reset jState when switching TO journal from another tab,
      // not on every render — preserve the current mode/view
      if (!jState) jState = { mode:'list', tab:'entries', editId:null, selMood:null, selTags:[], searchQ:'' };
      else { jState.tab = jState.tab || 'entries'; }
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
    ['ftOverview','ftAnalytics','ftTransactions','ftReview'].forEach(id =>
      document.getElementById(id)?.classList.add('H'));
    const map = { overview:'ftOverview', analytics:'ftAnalytics', transactions:'ftTransactions', review:'ftReview' };
    document.getElementById(map[t.dataset.ft])?.classList.remove('H');
    if      (t.dataset.ft==='overview')      renderFinOverview();
    else if (t.dataset.ft==='analytics')     renderFinAnalytics();
    else if (t.dataset.ft==='transactions')  renderTxPage();
    else if (t.dataset.ft==='review')        renderWeeklyReview();
  });
});

document.getElementById('prevW').addEventListener('click', () => { wOff--; renderGrid(); });
document.getElementById('nextW').addEventListener('click', () => { wOff++; renderGrid(); });
document.getElementById('addBtn').addEventListener('click', addTask);
document.getElementById('nTask').addEventListener('keydown', e => { if (e.key==='Enter') addTask(); });

// ── TASKS ──────────────────────────────────────────────────
async function addTask() {
  const n = document.getElementById('nTask').value.trim(); if (!n) return;
  const cat = document.getElementById('nCat').value;
  try {
    setSyncState('saving');
    const tasks = await API.Tasks.add(n, cat);
    S.user.tasks = tasks;
    document.getElementById('nTask').value = '';
    renderGrid(); toast('Task added!'); setSyncState('saved');
  } catch(e) { toast(e.message||'Could not add task.','warn'); setSyncState('saved'); }
}

async function deleteTask(taskId, taskName) {
  if (!confirm('Delete "'+taskName+'"?')) return;
  try {
    setSyncState('saving');
    const tasks = await API.Tasks.remove(taskId);
    S.user.tasks = tasks;
    renderGrid(); toast('Task deleted.','warn'); setSyncState('saved');
  } catch(e) { toast(e.message||'Could not delete task.','warn'); setSyncState('saved'); }
}

async function renameTask(taskId, newName) {
  try { await API.Tasks.rename(taskId, newName); setSyncState('saved'); }
  catch(e) { toast(e.message||'Rename failed.','warn'); }
}

// ── CSV Export ─────────────────────────────────────────────
function doExport() {
  const u = usr(); if (!u) return;
  const dates = [...new Set(Object.keys(u.done).map(k=>k.split('_').pop()))].sort();
  let csv = 'Task,Category,'+dates.join(',')+'\n';
  u.tasks.forEach(t => {
    csv += `"${t.name}",${t.cat||''},`+dates.map(d=>u.skipped[t.id+'_'+d]?'skip':u.done[t.id+'_'+d]?'1':'0').join(',')+'\n';
  });
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download = 'devnix_discipline.csv'; a.click();
  toast('CSV exported!');
}
document.getElementById('exportBtn').addEventListener('click', doExport);

// ── Reminder ───────────────────────────────────────────────
function showReminder() {
  const u = usr(); if (!u) return;
  const td = today();
  const missed = u.tasks.filter(t => !u.done[t.id+'_'+td] && !u.skipped[t.id+'_'+td]);
  document.getElementById('remMsg').textContent = missed.length === 0
    ? 'All tasks done today — amazing work!'
    : `${missed.length} task${missed.length>1?'s':''} still pending: ${missed.slice(0,3).map(t=>t.name).join(', ')}${missed.length>3?'…':''}`;
  document.getElementById('reminderBanner').classList.remove('H');
}
document.getElementById('reminderBtn').addEventListener('click', showReminder);

// ── Note modal ─────────────────────────────────────────────
document.getElementById('noteCancel').addEventListener('click', () =>
  document.getElementById('noteModal').classList.add('H'));
document.getElementById('noteSave').addEventListener('click', () => {
  const u = usr(); if (!u) return;
  const key = noteCtx.tid+'_'+noteCtx.ds;
  const txt = document.getElementById('noteTA').value.trim();
  if (txt) u.notes[key] = txt; else delete u.notes[key];
  debounceSave();
  document.getElementById('noteModal').classList.add('H');
  renderGrid(); toast('Note saved!');
});

function addRipple(el, e) {
  const r = document.createElement('div'); r.className = 'ripple-el';
  const rect = el.getBoundingClientRect(); const size = Math.max(rect.width,rect.height);
  r.style.cssText = `width:${size}px;height:${size}px;left:${(e.clientX||0)-rect.left-size/2}px;top:${(e.clientY||0)-rect.top-size/2}px`;
  el.appendChild(r); setTimeout(()=>r.remove(),500);
}

// ── Keyboard nav ───────────────────────────────────────────
let kF = {r:0,c:0};
document.addEventListener('keydown', e => {
  if (document.activeElement.tagName==='INPUT'||document.activeElement.tagName==='TEXTAREA') return;
  const boxes = document.querySelectorAll('.ck'); if (!boxes.length) return;
  const cols = 7, rows = Math.ceil(boxes.length/cols);
  if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter',' '].includes(e.key)) return;
  e.preventDefault();
  if      (e.key==='ArrowRight'&&kF.c<cols-1) kF.c++;
  else if (e.key==='ArrowLeft' &&kF.c>0)      kF.c--;
  else if (e.key==='ArrowDown' &&kF.r<rows-1) kF.r++;
  else if (e.key==='ArrowUp'   &&kF.r>0)      kF.r--;
  else if (e.key==='Enter'||e.key===' ') { const i=kF.r*cols+kF.c; if(boxes[i])boxes[i].click(); }
  const idx = kF.r*cols+kF.c;
  boxes.forEach((b,i) => { b.style.outline = i===idx ? '2px solid var(--p)' : ''; });
  if (boxes[idx]) boxes[idx].scrollIntoView({block:'nearest'});
});

// ── Grid ───────────────────────────────────────────────────
function weekDates(off) {
  const n = new Date(), day = n.getDay();
  const mon = addD(n, -(day===0?6:day-1)+(off*7));
  return Array.from({length:7}, (_,i) => addD(mon,i));
}

function renderGrid() {
  const u = usr(); if (!u) return;
  const dates = weekDates(wOff);
  const td = today();
  document.getElementById('wkLbl').textContent = fmtFull(dates[0])+' – '+fmtFull(dates[6]);
  const head = document.getElementById('gHead'); head.innerHTML='';
  const hr = document.createElement('tr');
  const th0 = document.createElement('th'); th0.className='th0'; th0.textContent='Task'; hr.appendChild(th0);
  dates.forEach(d => {
    const ds = dStr(d), th = document.createElement('th');
    const isPastH = ds < td;
    th.className = 'th-d'+(ds===td?' th-today':isPastH?' th-past':'');
    th.innerHTML = `<span class="dw">${WD[d.getDay()]}</span>${d.getDate()}${isPastH?'<span class="dw" style="opacity:.5;font-size:9px">🔒</span>':''}`;
    hr.appendChild(th);
  });
  head.appendChild(hr);

  const body = document.getElementById('gBody'); body.innerHTML='';
  let todayDone = 0;
  u.tasks.forEach((task, ri) => {
    const tr = document.createElement('tr');
    tr.style.animationDelay = ri*30+'ms';
    const td0 = document.createElement('td'); td0.className='td0';
    const inn = document.createElement('div'); inn.className='ti';
    const dot = document.createElement('div'); dot.className='cat-dot2'; dot.style.background=CAT_COL[task.cat]||'#999';
    const inp = document.createElement('input'); inp.className='task-inp'; inp.value=task.name;
    inp.addEventListener('change', () => {
      const newName = inp.value.trim()||task.name;
      task.name = newName; renameTask(task.id, newName);
    });
    const del = document.createElement('button'); del.className='del-t'; del.textContent='×'; del.title='Delete';
    del.addEventListener('click', () => deleteTask(task.id, task.name));
    inn.append(dot,inp,del); td0.appendChild(inn); tr.appendChild(td0);

    dates.forEach(d => {
      const ds = dStr(d); const key = task.id+'_'+ds;
      const isPast = ds < td;
      const isSkip = !!u.skipped[key], isDone = !!u.done[key], noteVal = u.notes[key]||'';
      const cell = document.createElement('td');
      if (ds===td)    cell.classList.add('col-today');
      else if(isPast) cell.classList.add('col-past');
      const box = document.createElement('div'); box.className='ck';
      if (isPast)  box.classList.add('locked');
      if (isSkip)  box.classList.add('skip');
      else if (isDone) box.classList.add('done');
      else if (isPast) box.classList.add('miss');
      const tip = document.createElement('div'); tip.className='tip';
      tip.textContent = (isPast?'🔒 Locked — ':(isSkip?'Skipped':isDone?'Done':'Pending')+' — ')
        +d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short'})
        +(isDone?' ✓':isSkip?' (skipped)':isPast?' (missed)':'')
        +(noteVal?' · '+noteVal.slice(0,24):'');
      box.appendChild(tip);
      if (!isPast) {
        box.addEventListener('contextmenu', ev => {
          ev.preventDefault();
          if (isSkip) delete u.skipped[key];
          else { u.skipped[key]=true; delete u.done[key]; }
          debounceSave(); renderGrid();
          clearTimeout(toggleCell._t);
          toggleCell._t = setTimeout(()=>renderDisciplineAnalytics(),300);
        });
        box.addEventListener('mousedown', ev => { dragActive=true; dragVal=!u.done[key]; addRipple(box,ev); toggleCell(u,key,box,ds,td); });
        box.addEventListener('mouseenter', ev => { if(ev.buttons===1&&dragActive) toggleCell(u,key,box,ds,td,dragVal); });
      }
      if (ds===td&&isDone) todayDone++;
      cell.appendChild(box);
      if (noteVal) {
        const nc = document.createElement('div');
        nc.style.cssText='font-size:10px;color:var(--tx3);max-width:44px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:text;padding:0 2px';
        nc.textContent=noteVal; nc.title='Edit note';
        nc.addEventListener('click', ev => { ev.stopPropagation(); openNote(task.id,ds,d); });
        cell.appendChild(nc);
      } else {
        cell.addEventListener('dblclick', () => openNote(task.id,ds,d));
      }
      tr.appendChild(cell);
    });
    body.appendChild(tr);
  });
  document.addEventListener('mouseup', () => { dragActive=false; }, {once:true,capture:true});
  updateGoalBar(u, td, todayDone);
}

function openNote(tid, ds, d) {
  const u = usr(); if (!u) return;
  noteCtx = {tid,ds};
  document.getElementById('noteTitle').textContent = 'Note — '+d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'short'});
  document.getElementById('noteTA').value = u.notes[tid+'_'+ds]||'';
  document.getElementById('noteModal').classList.remove('H');
  setTimeout(()=>document.getElementById('noteTA').focus(),50);
}

function toggleCell(u, key, box, ds, td, forceTo) {
  if (u.skipped[key]) return;
  const val = forceTo!==undefined ? forceTo : !u.done[key];
  if (val) u.done[key]=true; else delete u.done[key];
  box.classList.toggle('done', !!u.done[key]);
  box.classList.toggle('miss', !u.done[key] && ds < td);
  debounceSave();
  const tdDone = u.tasks.filter(t=>u.done[t.id+'_'+td]).length;
  updateGoalBar(u, td, tdDone);
  // FIX #10: debounce analytics re-render to avoid rapid canvas recreation
  clearTimeout(toggleCell._t);
  toggleCell._t = setTimeout(()=>renderDisciplineAnalytics(), 350);
}

function updateGoalBar(u, td, todayDone) {
  const pct = u.tasks.length ? Math.round(todayDone/u.tasks.length*100) : 0;
  document.getElementById('gFill').style.width = Math.min(pct,100)+'%';
  document.getElementById('gFill').style.background = pct>=80?'var(--pm)':pct>=50?'var(--ambm)':'var(--redm)';
  document.getElementById('gPct').textContent = pct+'%';
  const b = document.getElementById('gBadge');
  const [cls,lbl] = pct===100?['g-good','Perfect!']:pct>=80?['g-good','On track']:pct>=50?['g-mid','Keep going']:['g-low','Push harder'];
  b.className='g-badge '+cls; b.textContent=lbl;
}

// ── Discipline Analytics ───────────────────────────────────
function renderDisciplineAnalytics() {
  const u=usr(); if(!u) return;
  const td=today();
  let streak=0;
  for(let i=0;i<120;i++){const d=dStr(addD(new Date(),-i));if(u.tasks.length&&u.tasks.every(t=>u.done[t.id+'_'+d]))streak++;else if(i>0)break;}
  const daysArr=Array.from({length:analyDays},(_,i)=>dStr(addD(new Date(),-(analyDays-1)+i)));
  const pcts=daysArr.map(d=>u.tasks.length?Math.round(u.tasks.filter(t=>u.done[t.id+'_'+d]).length/u.tasks.length*100):0);
  const avg=pcts.length?Math.round(pcts.reduce((a,b)=>a+b,0)/pcts.length):0;
  const todayP=u.tasks.length?Math.round(u.tasks.filter(t=>u.done[t.id+'_'+td]).length/u.tasks.length*100):0;
  document.getElementById('statsRow').innerHTML=`
    <div class="stat" style="animation-delay:0ms"><div class="s-lbl">Today</div><div class="s-val">${todayP}%</div><div class="s-sub">${u.tasks.filter(t=>u.done[t.id+'_'+td]).length}/${u.tasks.length} tasks</div></div>
    <div class="stat" style="animation-delay:60ms"><div class="s-lbl">Streak</div><div class="s-val">${streak}</div><div class="s-sub">perfect days</div></div>
    <div class="stat" style="animation-delay:120ms"><div class="s-lbl">Period avg</div><div class="s-val">${avg}%</div><div class="s-sub">last ${analyDays} days</div></div>
    <div class="stat" style="animation-delay:180ms"><div class="s-lbl">Total check-ins</div><div class="s-val">${Object.keys(u.done).length}</div><div class="s-sub">all time</div></div>
  `;
  document.querySelectorAll('.pill[data-d]').forEach(p=>{
    p.addEventListener('click',()=>{
      document.querySelectorAll('.pill[data-d]').forEach(x=>x.classList.remove('on'));
      p.classList.add('on'); analyDays=+p.dataset.d; renderDisciplineAnalytics();
    });
  });
  document.getElementById('barSkel').classList.add('H');
  document.getElementById('barWrap').classList.remove('H');
  // FIX #10: always destroy before recreating
  if(barCI){barCI.destroy();barCI=null;}
  barCI=new Chart(document.getElementById('barCh'),{type:'bar',
    data:{labels:daysArr.map(d=>{const x=new Date(d+'T12:00:00');return WD[x.getDay()]+' '+x.getDate();}),
      datasets:[{data:pcts,backgroundColor:pcts.map(v=>v===100?'#2e7d32':v>=50?'#66bb6a':'#a5d6a7'),borderRadius:4,borderSkipped:false}]},
    options:{responsive:true,maintainAspectRatio:false,animation:{duration:700,easing:'easeOutQuart'},
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y+'%'}}},
      scales:{y:{min:0,max:100,ticks:{callback:v=>v+'%',font:{size:10},color:tc()},grid:{color:gc()}},
        x:{ticks:{font:{size:9},color:tc(),autoSkip:true,maxTicksLimit:14,maxRotation:45},grid:{display:false}}}}});
  const ma7=pcts.map((_,i)=>{const sl=pcts.slice(Math.max(0,i-6),i+1);return Math.round(sl.reduce((a,b)=>a+b,0)/sl.length);});
  document.getElementById('lineSkel').classList.add('H');
  document.getElementById('lineWrap').classList.remove('H');
  if(lineCI){lineCI.destroy();lineCI=null;}
  lineCI=new Chart(document.getElementById('lineCh'),{type:'line',
    data:{labels:daysArr.map(d=>{const x=new Date(d+'T12:00:00');return MO[x.getMonth()]+' '+x.getDate();}),
      datasets:[{label:'Daily',data:pcts,borderColor:'#a5d6a7',backgroundColor:'transparent',borderWidth:1.5,pointRadius:2,borderDash:[5,3],tension:.3},
        {label:'7-day avg',data:ma7,borderColor:'#2e7d32',backgroundColor:'rgba(46,125,50,.08)',borderWidth:2.5,fill:true,pointRadius:3,tension:.4}]},
    options:{responsive:true,maintainAspectRatio:false,animation:{duration:800,easing:'easeOutQuart'},
      plugins:{legend:{display:false}},
      scales:{y:{min:0,max:100,ticks:{callback:v=>v+'%',font:{size:10},color:tc()},grid:{color:gc()}},
        x:{ticks:{font:{size:9},color:tc(),autoSkip:true,maxTicksLimit:10},grid:{display:false}}}}});
  const hm=document.getElementById('hmGrid'); hm.innerHTML='';
  for(let i=89;i>=0;i--){
    const d=dStr(addD(new Date(),-i));
    const p=u.tasks.length?u.tasks.filter(t=>u.done[t.id+'_'+d]).length/u.tasks.length:0;
    const sq=document.createElement('div');sq.className='hm-sq hm'+(p===0?0:p<.5?1:p<1?2:3);sq.title=d+': '+Math.round(p*100)+'%';hm.appendChild(sq);
  }
  document.getElementById('hmSkel').classList.add('H');
  document.getElementById('hmGrid').classList.remove('H');
  const best=daysArr.reduce((b,d)=>{const p=u.tasks.length?u.tasks.filter(t=>u.done[t.id+'_'+d]).length/u.tasks.length:0;return p>=b.p?{d,p}:b},{d:'',p:-1});
  const worst=daysArr.reduce((b,d)=>{const p=u.tasks.length?u.tasks.filter(t=>u.done[t.id+'_'+d]).length/u.tasks.length:0;return p<=b.p?{d,p}:b},{d:'',p:2});
  const consist=pcts.filter(p=>p>=80).length;
  document.getElementById('insGrid').innerHTML=`
    <div class="ins-card-d" style="animation-delay:0ms"><div class="ins-lbl">Best day</div><div class="ins-val">${best.d?new Date(best.d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}):'—'}</div><div class="ins-sub">${Math.round((best.p||0)*100)}% done</div></div>
    <div class="ins-card-d" style="animation-delay:60ms"><div class="ins-lbl">Worst day</div><div class="ins-val">${worst.d&&worst.p<2?new Date(worst.d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}):'—'}</div><div class="ins-sub">${worst.p<2?Math.round(worst.p*100):0}% done</div></div>
    <div class="ins-card-d" style="animation-delay:120ms"><div class="ins-lbl">Days at 80%+</div><div class="ins-val">${consist}/${analyDays}</div><div class="ins-sub">consistency score</div></div>
    <div class="ins-card-d" style="animation-delay:180ms"><div class="ins-lbl">Notes written</div><div class="ins-val">${Object.keys(u.notes).length}</div><div class="ins-sub">across all tasks</div></div>
  `;
}

// ── Profile ────────────────────────────────────────────────
function renderProfile() {
  const u=usr(); if(!u) return;
  const em=u.email||'', name=em.split('@')[0];
  document.getElementById('pAv').textContent = name[0]?.toUpperCase()||'?';
  document.getElementById('pName').textContent = name;
  document.getElementById('pEmail').textContent = em;
  const td=today(); let streak=0;
  for(let i=0;i<120;i++){const d=dStr(addD(new Date(),-i));if(u.tasks.length&&u.tasks.every(t=>u.done[t.id+'_'+d]))streak++;else if(i>0)break;}
  const todayP=u.tasks.length?Math.round(u.tasks.filter(t=>u.done[t.id+'_'+td]).length/u.tasks.length*100):0;
  document.getElementById('pStats').innerHTML=`
    <div class="p-stat"><div class="p-stat-v">${u.tasks.length}</div><div class="p-stat-l">Tasks</div></div>
    <div class="p-stat"><div class="p-stat-v">${streak}</div><div class="p-stat-l">Day streak</div></div>
    <div class="p-stat"><div class="p-stat-v">${todayP}%</div><div class="p-stat-l">Today</div></div>
    <div class="p-stat"><div class="p-stat-v">${(u.transactions||[]).length}</div><div class="p-stat-l">Transactions</div></div>
    <div class="p-stat" style="grid-column:span 2"><div class="p-stat-v">${Object.keys(u.done).length}</div><div class="p-stat-l">Total check-ins</div></div>
  `;
  document.getElementById('pExp').onclick=doExport;
  document.getElementById('pRem').onclick=()=>{showReminder();toast('Reminder sent!');};
  document.getElementById('pDark').onclick=toggleDark;
  document.getElementById('pOut').onclick=doLogout;
}

// ══════════════════════════════════════════════════════════
//  FINANCE
// ══════════════════════════════════════════════════════════
const CAT_ICONS={Income:'<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-4H9l3-3 3 3h-2v4z"/>',Food:'<path d="M18.06 22.99h1.66c.84 0 1.53-.64 1.63-1.46L23 5.05h-5V1h-1.97v4.05h-4.97l.3 2.34c1.71.47 3.31 1.32 4.27 2.26 1.44 1.42 2.43 2.89 2.43 5.29v8.05zM1 21.99V21h15.03v.99c0 .55-.45 1-1.01 1H2.01c-.56 0-1.01-.45-1.01-1zm15.03-7c0-4.5-6.74-5.97-8.04-5.99H1v2h15.03v3.99z"/>',Transport:'<path d="M17.5 5h-11L4 11v6c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h10v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-6l-2.5-6zm-11 1h11l1.5 4h-14l1.5-4zM6.5 14c-.83 0-1.5-.67-1.5-1.5S5.67 11 6.5 11s1.5.67 1.5 1.5S7.33 14 6.5 14zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>',Housing:'<path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>',Health:'<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>',Shopping:'<path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96C5 16.1 6.9 18 9 18h12v-2H9.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63H19c.75 0 1.41-.41 1.75-1.03l3.58-6.49A1 1 0 0023.45 5H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2S15.9 22 17 22s2-.9 2-2-.9-2-2-2z"/>',Entertainment:'<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>'}
const CAT_COLORS={Income:'#22c55e',Food:'#f59e0b',Transport:'#3b82f6',Housing:'#8b5cf6',Health:'#14b8a6',Shopping:'#ec4899',Entertainment:'#f87171'};
const CAT_COLORS_AN={Food:'#f59e0b',Transport:'#3b82f6',Housing:'#8b5cf6',Health:'#14b8a6',Shopping:'#ec4899',Entertainment:'#f87171',Other:'#888',Income:'#22c55e'};
function destroyFinChart(id){if(finCharts[id]){try{finCharts[id].destroy();}catch(e){}delete finCharts[id];}}
function fmtCurrency(n){const abs=Math.abs(n);let s;if(abs>=10000000)s=(abs/10000000).toFixed(1)+'Cr';else if(abs>=100000)s=(abs/100000).toFixed(1)+'L';else if(abs>=1000)s=(abs/1000).toFixed(1)+'k';else s=abs.toLocaleString('en-IN',{maximumFractionDigits:0});return(n<0?'-':'')+'\u20b9'+s;}
function calcTotals(txns){const inc=txns.filter(t=>t.type==='income').reduce((s,t)=>s+Math.abs(t.amt),0);const exp=txns.filter(t=>t.type==='expense').reduce((s,t)=>s+Math.abs(t.amt),0);return{inc,exp,net:inc-exp};}
function getGoals(){const u=usr();if(!u)return[];return u.savingsGoals||[];}
function getBudgets(){const u=usr();if(!u)return{};return toPlainObj(u.budgets);} // FIX: toPlainObj guards against Mongoose Map
function animateChartData(chart,newData,datasetIdx=0){if(!chart)return;chart.data.datasets[datasetIdx].data=newData;chart.update({duration:700,easing:'easeInOutQuart'});}

function renderFinOverview(){
  const u=usr();if(!u)return;
  const txns=u.transactions||[];
  const{inc,exp,net}=calcTotals(txns);
  const hasData=txns.length>0;
  const savRate=inc>0?Math.round(net/inc*100):0;
  const incTxCount=txns.filter(t=>t.type==='income').length;
  const expTxCount=txns.filter(t=>t.type==='expense').length;
  const kpiDefs=[
    {label:'Total income',val:hasData?fmtCurrency(inc):'\u20b90',sub:hasData?incTxCount+' income entr'+(incTxCount===1?'y':'ies'):'Add your first income →',pos:true,color:'#3b82f6',bg:isDk()?'#0d2044':'#eff6ff',icon:'<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-4H9l3-3 3 3h-2v4z"/>'},
    {label:'Total expenses',val:hasData?fmtCurrency(exp):'\u20b90',sub:hasData?expTxCount+' expense entr'+(expTxCount===1?'y':'ies'):'No expenses recorded yet',pos:false,color:'#ef4444',bg:isDk()?'#2d0f0f':'#fef2f2',icon:'<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-4H9l3 3 3-3h-2v-4z"/>'},
    {label:'Net savings',val:hasData?fmtCurrency(net):'\u20b90',sub:hasData?(net>=0?savRate+'% savings rate':'Expenses exceed income'):'Starts updating on first entry',pos:net>=0,color:net>=0?'#22c55e':'#ef4444',bg:net>=0?(isDk()?'#0d2818':'#f0fdf4'):(isDk()?'#2d0f0f':'#fef2f2'),icon:'<path d="M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z"/>'},
    {label:'Net worth',val:hasData?fmtCurrency(net):'\u20b90',sub:hasData?(net>=0?'Income minus all expenses':'Review your spending'):'Reflects your total net',pos:net>=0,color:net>=0?'#8b5cf6':'#ef4444',bg:isDk()?'#1e0d3d':'#f5f3ff',icon:'<path d="M23 8c0 1.1-.9 2-2 2-.18 0-.35-.02-.51-.07l-3.56 3.55c.05.16.07.34.07.52 0 1.1-.9 2-2 2s-2-.9-2-2c0-.18.02-.36.07-.52l-2.55-2.55c-.16.05-.34.07-.52.07s-.36-.02-.52-.07l-4.55 4.56c.05.16.07.33.07.51 0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2c.18 0 .35.02.51.07l4.56-4.55C8.02 9.36 8 9.18 8 9c0-1.1.9-2 2-2s2 .9 2 2c0 .18-.02.36-.07.52l2.55 2.55c.16-.05.34-.07.52-.07s.36.02.52.07l3.55-3.56C19.02 8.35 19 8.18 19 8c0-1.1.9-2 2-2s2 .9 2 2z"/>'},
  ];
  document.getElementById('kpiRow').innerHTML=kpiDefs.map((k,i)=>`<div class="kpi" style="animation-delay:${i*50}ms"><div class="kpi-icon" style="background:${k.bg}"><svg viewBox="0 0 24 24" style="width:16px;height:16px;fill:${k.color}">${k.icon}</svg></div><div class="kpi-lbl">${k.label}</div><div class="kpi-val">${k.val}</div><div class="kpi-sub ${k.pos?'pos':'neg'}">${k.sub}</div><div class="kpi-bar" style="background:${k.color}"></div></div>`).join('');
  if(!hasData){
    destroyFinChart('revExp');destroyFinChart('catDonut');
    const emptyChartHTML=msg=>`<div style="height:180px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:var(--tx3)"><svg viewBox="0 0 24 24" style="width:28px;height:28px;fill:var(--tx3)"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg><span style="font-size:12px">${msg}</span></div>`;
    document.getElementById('revExpCh').closest('.fin-card').querySelector('.ch').innerHTML=emptyChartHTML('Add transactions to see income vs expense chart');
    document.getElementById('catDonutCh').closest('.fin-card').querySelector('.ch').innerHTML=emptyChartHTML('Add expenses to see category breakdown');
    document.getElementById('overviewInsights').innerHTML=`<div class="ins-card2" style="grid-column:1/-1"><div class="ins-icon2" style="background:${isDk()?'#0d2044':'#eff6ff'}"><svg viewBox="0 0 24 24" style="fill:#3b82f6"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg></div><div><div class="ins-title2">Start tracking to unlock insights</div><div class="ins-body2">Go to the <strong>Transactions</strong> tab and log your first income or expense.</div></div></div>`;
    return;
  }
  const monthlyMap={};
  txns.forEach(t=>{const m=t.date?t.date.slice(0,7):'';if(!m)return;if(!monthlyMap[m])monthlyMap[m]={inc:0,exp:0};if(t.type==='income')monthlyMap[m].inc+=Math.abs(t.amt);else monthlyMap[m].exp+=Math.abs(t.amt);});
  const sortedMonths=Object.keys(monthlyMap).sort().slice(-6);
  const mInc=sortedMonths.map(m=>monthlyMap[m].inc);
  const mExp=sortedMonths.map(m=>monthlyMap[m].exp);
  const mLbls=sortedMonths.map(m=>{const d=new Date(m+'-01');return MO[d.getMonth()]+' '+d.getFullYear().toString().slice(2);});
  destroyFinChart('revExp');
  finCharts.revExp=new Chart(document.getElementById('revExpCh'),{type:'bar',data:{labels:mLbls,datasets:[{label:'Income',data:mInc,backgroundColor:isDk()?'#1d4ed8':'#3b82f6',borderRadius:4,borderSkipped:false,order:2},{label:'Expenses',data:mExp,type:'line',borderColor:'#ef4444',backgroundColor:'transparent',borderWidth:2,borderDash:[5,3],pointRadius:3,pointBackgroundColor:'#ef4444',tension:.3,order:1}]},options:{responsive:true,maintainAspectRatio:false,animation:{duration:700},plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:10},color:tc()},grid:{display:false}},y:{ticks:{callback:v=>'\u20b9'+v/1000+'k',font:{size:10},color:tc()},grid:{color:gc()}}}}});
  const catMap={};txns.filter(t=>t.type==='expense').forEach(t=>{catMap[t.cat]=(catMap[t.cat]||0)+Math.abs(t.amt);});
  const catKeys=Object.keys(catMap).filter(k=>catMap[k]>0);
  const totalExpCat=catKeys.reduce((s,k)=>s+catMap[k],0);
  destroyFinChart('catDonut');
  if(catKeys.length>0)finCharts.catDonut=new Chart(document.getElementById('catDonutCh'),{type:'doughnut',data:{labels:catKeys,datasets:[{data:catKeys.map(k=>catMap[k]),backgroundColor:catKeys.map(k=>CAT_COLORS_AN[k]||'#888'),borderWidth:2,borderColor:sf()}]},options:{responsive:true,maintainAspectRatio:false,cutout:'65%',animation:{duration:600},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.label+': \u20b9'+c.parsed.toLocaleString('en-IN')+' ('+Math.round(c.parsed/totalExpCat*100)+'%)'}}}}}});
  const insights=[];
  if(savRate>=40)insights.push({icon:'<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>',color:'#22c55e',bg:isDk()?'#0d2818':'#f0fdf4',title:'Strong savings rate — '+savRate+'%',body:'You\'re saving '+savRate+'% of your income. Keep it up!'});
  else if(inc>0)insights.push({icon:'<path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>',color:'#f59e0b',bg:isDk()?'#2e1e00':'#fffbeb',title:'Savings rate: '+savRate+'%',body:'Target 40% or more. Try reducing your top expense category.'});
  if(net<0)insights.push({icon:'<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>',color:'#ef4444',bg:isDk()?'#2d0f0f':'#fef2f2',title:'Spending exceeds income',body:'You\'re spending '+fmtCurrency(Math.abs(net))+' more than you earn.'});
  const topCat=catKeys.sort((a,b)=>catMap[b]-catMap[a])[0];
  if(topCat)insights.push({icon:'<path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/>',color:'#3b82f6',bg:isDk()?'#0d2044':'#eff6ff',title:'Top expense: '+topCat,body:topCat+' is '+Math.round(catMap[topCat]/totalExpCat*100)+'% of total spend ('+fmtCurrency(catMap[topCat])+')'});
  insights.push({icon:'<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/>',color:'#8b5cf6',bg:isDk()?'#1e0d3d':'#f5f3ff',title:txns.length+' transactions logged',body:'Income '+fmtCurrency(inc)+' · Expenses '+fmtCurrency(exp)+' · Net '+fmtCurrency(net)});
  document.getElementById('overviewInsights').innerHTML=insights.slice(0,4).map((ins,i)=>`<div class="ins-card2" style="animation-delay:${i*60}ms"><div class="ins-icon2" style="background:${ins.bg}"><svg viewBox="0 0 24 24" style="fill:${ins.color}">${ins.icon}</svg></div><div><div class="ins-title2">${ins.title}</div><div class="ins-body2">${ins.body}</div></div></div>`).join('');
}

// ── Finance Analytics ──────────────────────────────────────
let _anGoalEditIdx=null, _anSelColor='#3b82f6';

function renderFinAnalytics(){
  const u=usr();if(!u)return;
  // FIX #9: Use replaceWith pattern to kill duplicate listeners — re-clone buttons
  const cloneBtn = id => {
    const old = document.getElementById(id); if(!old) return;
    const clone = old.cloneNode(true); old.replaceWith(clone);
  };
  cloneBtn('addCatBudgetBtn'); cloneBtn('addGoalBtn'); cloneBtn('bmCancel'); cloneBtn('bmSave'); cloneBtn('gmCancel'); cloneBtn('gmSave');

  document.getElementById('addCatBudgetBtn').onclick=()=>{document.getElementById('bmCat').value='Food';document.getElementById('bmAmt').value='';document.getElementById('budgetModal').classList.remove('H');setTimeout(()=>document.getElementById('bmAmt').focus(),50);};
  document.getElementById('bmCancel').onclick=()=>document.getElementById('budgetModal').classList.add('H');
  document.getElementById('bmSave').onclick=saveBudget;
  document.getElementById('addGoalBtn').onclick=()=>openGoalModal(null);
  document.getElementById('gmCancel').onclick=()=>document.getElementById('goalModal').classList.add('H');
  document.getElementById('gmSave').onclick=saveGoal;
  document.getElementById('gmColorPicker').querySelectorAll('span').forEach(s=>{s.onclick=()=>{_anSelColor=s.dataset.c;document.getElementById('gmColor').value=_anSelColor;document.getElementById('gmColorPicker').querySelectorAll('span').forEach(x=>x.style.border='2px solid transparent');s.style.border='2px solid var(--tx)';};});
  refreshAnalyticsCharts(u.transactions||[]);
}

function refreshAnalyticsCharts(txns){
  const now=new Date();const monthLabels=[];const mInc=[];const mExp=[];
  for(let i=11;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);monthLabels.push(d.toLocaleString('en-US',{month:'short'}));const mTx=txns.filter(t=>{const td=new Date(t.date+'T12:00:00');return td.getFullYear()===d.getFullYear()&&td.getMonth()===d.getMonth();});mInc.push(mTx.filter(t=>t.type==='income').reduce((s,t)=>s+Math.abs(t.amt),0));mExp.push(mTx.filter(t=>t.type==='expense').reduce((s,t)=>s+Math.abs(t.amt),0));}
  const cashFlow=mInc.map((v,i)=>v-mExp[i]);let runNW=0;const nwData=cashFlow.map(cf=>{runNW+=cf;return Math.round(runNW);});
  if(finCharts.netWorth){finCharts.netWorth.data.labels=monthLabels;animateChartData(finCharts.netWorth,nwData,0);}
  else{destroyFinChart('netWorth');finCharts.netWorth=new Chart(document.getElementById('netWorthCh'),{type:'line',data:{labels:monthLabels,datasets:[{label:'Net worth',data:nwData,borderColor:'#8b5cf6',backgroundColor:isDk()?'rgba(139,92,246,.12)':'rgba(139,92,246,.08)',borderWidth:2.5,fill:true,tension:.4,pointRadius:4,pointBackgroundColor:'#8b5cf6',pointHoverRadius:6}]},options:{responsive:true,maintainAspectRatio:false,animation:{duration:800,easing:'easeInOutQuart'},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>'Net worth: ₹'+c.parsed.y.toLocaleString()}}},scales:{x:{ticks:{font:{size:10},color:tc()},grid:{display:false}},y:{ticks:{callback:v=>(v>=0?'₹':'-₹')+Math.abs(v/1000).toFixed(1)+'k',font:{size:10},color:tc()},grid:{color:gc()}}}}});}
  document.getElementById('nwSub').textContent='Accumulated from '+txns.length+' transaction'+(txns.length!==1?'s':'');
  const catMap={};txns.filter(t=>t.type==='expense').forEach(t=>{catMap[t.cat]=(catMap[t.cat]||0)+Math.abs(t.amt);});
  const budgets=getBudgets();const catKeys=Object.keys(catMap).length?Object.keys(catMap):Object.keys(budgets);
  const totalExp=catKeys.reduce((s,k)=>s+(catMap[k]||0),0);
  const catListEl=document.getElementById('catList2');catListEl.innerHTML='';
  if(catKeys.length===0){catListEl.innerHTML='<div style="font-size:12px;color:var(--tx3);padding:12px 0">No expenses yet — add transactions to see breakdown.</div>';}
  else{catKeys.sort((a,b)=>(catMap[b]||0)-(catMap[a]||0)).forEach(cat=>{const amt=catMap[cat]||0,budget=budgets[cat]||0,pct=totalExp>0?Math.round(amt/totalExp*100):0,color=CAT_COLORS_AN[cat]||'#888',over=budget>0&&amt>budget;const row=document.createElement('div');row.className='cat-item2';row.style.cursor='pointer';row.title='Click to set budget';row.innerHTML=`<div class="cat-head2"><div class="cat-name2"><div class="cat-dot" style="background:${color}"></div><span>${cat}</span></div><div style="display:flex;align-items:center;gap:8px">${budget>0?`<span style="font-size:10px;color:${over?'#ef4444':'var(--tx3)'};font-weight:600">${over?'⚠ ':''}₹${amt.toFixed(0)} / ₹${budget} budget</span>`:`<span style="font-size:10px;color:var(--tx3)">₹${amt.toFixed(0)}</span>`}<span style="font-size:10px;font-weight:700;color:${color}">${pct}%</span><button class="del-cat-btn" data-cat="${cat}" style="background:none;border:none;color:var(--tx3);cursor:pointer;font-size:14px;padding:0;line-height:1;opacity:0;transition:opacity .18s" title="Remove budget">×</button></div></div><div class="cat-track" style="height:8px;margin-top:4px"><div class="cat-fill" style="width:0%;background:${over?'#ef4444':color};transition:width .7s cubic-bezier(.4,0,.2,1)"></div></div>`;row.addEventListener('mouseenter',()=>row.querySelector('.del-cat-btn').style.opacity='1');row.addEventListener('mouseleave',()=>row.querySelector('.del-cat-btn').style.opacity='0');row.querySelector('.del-cat-btn').addEventListener('click',async e=>{e.stopPropagation();if(budgets[cat]){try{const b=await API.Budgets.remove(cat);S.user.budgets=toPlainObj(b);refreshAnalyticsCharts(txns);toast('Budget removed for '+cat,'warn');}catch(e2){toast(e2.message||'Error removing budget.','warn');}}});row.addEventListener('click',e=>{if(e.target.classList.contains('del-cat-btn'))return;document.getElementById('bmCat').value=cat;document.getElementById('bmAmt').value=budget||'';document.getElementById('budgetModal').classList.remove('H');setTimeout(()=>document.getElementById('bmAmt').focus(),50);});catListEl.appendChild(row);requestAnimationFrame(()=>requestAnimationFrame(()=>{const fill=row.querySelector('.cat-fill');if(fill)fill.style.width=Math.min(budget>0?Math.round(amt/budget*100):pct,120)+'%';}));});}
  if(finCharts.cashFlow){finCharts.cashFlow.data.labels=monthLabels;finCharts.cashFlow.data.datasets[0].data=cashFlow;finCharts.cashFlow.data.datasets[0].backgroundColor=cashFlow.map(v=>v>=0?(isDk()?'#166534':'#22c55e'):(isDk()?'#991b1b':'#ef4444'));finCharts.cashFlow.update({duration:700,easing:'easeInOutQuart'});}
  else{destroyFinChart('cashFlow');finCharts.cashFlow=new Chart(document.getElementById('cashFlowCh'),{type:'bar',data:{labels:monthLabels,datasets:[{label:'Cash flow',data:cashFlow,backgroundColor:cashFlow.map(v=>v>=0?(isDk()?'#166534':'#22c55e'):(isDk()?'#991b1b':'#ef4444')),borderRadius:5,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,animation:{duration:700,easing:'easeInOutQuart'},plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:10},color:tc()},grid:{display:false}},y:{ticks:{callback:v=>(v>=0?'₹':'-₹')+Math.abs(v/1000).toFixed(1)+'k',font:{size:10},color:tc()},grid:{color:gc()}}}}});}
  renderSavingsGoals(txns);
  const last6=cashFlow.slice(-6),avg6=last6.length?last6.reduce((a,b)=>a+b,0)/last6.length:0,lastNW=nwData[nwData.length-1]||0,fLabels=[];
  for(let i=1;i<=6;i++){const d=new Date(now.getFullYear(),now.getMonth()+i,1);fLabels.push(d.toLocaleString('en-US',{month:'short'}));}
  const forecastNW=fLabels.map((_,i)=>Math.round(lastNW+(avg6*(i+1)))),allFL=[...monthLabels.slice(-3),...fLabels];
  if(finCharts.forecast){finCharts.forecast.data.labels=allFL;finCharts.forecast.data.datasets[0].data=[...nwData.slice(-3),...Array(6).fill(null)];finCharts.forecast.data.datasets[1].data=[...Array(2).fill(null),nwData[nwData.length-1],...forecastNW];finCharts.forecast.data.datasets[2].data=[...Array(3).fill(null),...fLabels.map(()=>Math.round(avg6))];finCharts.forecast.update({duration:700,easing:'easeInOutQuart'});}
  else{destroyFinChart('forecast');finCharts.forecast=new Chart(document.getElementById('forecastCh'),{type:'line',data:{labels:allFL,datasets:[{label:'Net worth (actual)',data:[...nwData.slice(-3),...Array(6).fill(null)],borderColor:'#8b5cf6',borderWidth:2,pointRadius:3,tension:.3,backgroundColor:'transparent'},{label:'Net worth (forecast)',data:[...Array(2).fill(null),nwData[nwData.length-1],...forecastNW],borderColor:'#8b5cf6',borderWidth:2,borderDash:[6,4],pointRadius:3,tension:.3,backgroundColor:'rgba(139,92,246,.06)',fill:true},{label:'Monthly savings',data:[...Array(3).fill(null),...fLabels.map(()=>Math.round(avg6))],borderColor:'#22c55e',borderWidth:1.5,borderDash:[4,3],pointRadius:2,tension:.3,backgroundColor:'transparent',yAxisID:'y1'}]},options:{responsive:true,maintainAspectRatio:false,animation:{duration:800,easing:'easeInOutQuart'},plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:10},color:tc()},grid:{display:false}},y:{ticks:{callback:v=>(v>=0?'₹':'-₹')+Math.abs(v/1000).toFixed(1)+'k',font:{size:10},color:tc()},grid:{color:gc()}},y1:{position:'right',ticks:{callback:v=>'₹'+v/1000+'k',font:{size:10},color:'#22c55e'},grid:{display:false}}}}});}
  document.getElementById('forecastSub').textContent=avg6>=0?`Avg monthly savings: ₹${Math.round(avg6).toLocaleString()} · projected over 6 months`:`Avg monthly deficit: -₹${Math.abs(Math.round(avg6)).toLocaleString()} · review your spending`;
}

function renderSavingsGoals(txns){
  const goals=getGoals(),listEl=document.getElementById('savingsList2');if(!listEl)return;listEl.innerHTML='';
  if(goals.length===0){listEl.innerHTML='<div style="font-size:12px;color:var(--tx3);padding:12px 0">No goals yet — click "+ Add goal" to create one.</div>';return;}
  goals.forEach((g,idx)=>{
    const pct=Math.min(Math.round(g.saved/g.target*100),100),over=pct>=100;
    const bs=over?`background:${isDk()?'#0d2818':'#f0fdf4'};color:${isDk()?'#3fb950':'#15803d'}`:pct>=50?`background:${isDk()?'#0d2044':'#eff6ff'};color:${isDk()?'#58a6ff':'#1a56db'}`:`background:${isDk()?'#2e1e00':'#fffbeb'};color:${isDk()?'#d29922':'#b45309'}`;
    const card=document.createElement('div');card.className='goal-card2';
    card.innerHTML=`<div class="goal-head2"><div class="goal-name2" style="color:${g.color}">${g.emoji} ${g.name}</div><div style="display:flex;align-items:center;gap:6px"><span class="goal-badge2" style="${bs}">${over?'Complete ✓':pct>=50?'In progress':'Just started'}</span><span class="goal-pct2" style="color:${g.color}">${pct}%</span><button class="edit-goal-btn" style="background:none;border:1px solid var(--bd);color:var(--tx2);cursor:pointer;font-size:11px;border-radius:6px;padding:2px 7px;font-family:inherit">Edit</button><button class="del-goal-btn" style="background:none;border:none;color:var(--tx3);cursor:pointer;font-size:16px;padding:0 2px;line-height:1">×</button></div></div><div class="goal-track2"><div class="goal-fill2" style="width:0%;background:${g.color};transition:width .8s cubic-bezier(.4,0,.2,1)"></div></div><div class="goal-meta2" style="margin-top:4px"><span style="font-size:11px;color:var(--tx2)">₹${g.saved.toLocaleString()} saved</span><span style="font-size:11px;color:var(--tx3)">Target: ₹${g.target.toLocaleString()}</span></div>${!over?`<div style="font-size:10px;color:var(--tx3);margin-top:2px">₹${(g.target-g.saved).toLocaleString()} remaining</div>`:''}`;
    card.querySelector('.edit-goal-btn').addEventListener('click',()=>openGoalModal(idx));
    card.querySelector('.del-goal-btn').addEventListener('click',async()=>{
      if(!confirm('Delete goal "'+g.name+'"?'))return;
      try{const goals2=await API.Goals.remove(g.id);S.user.savingsGoals=goals2;renderSavingsGoals(txns);toast('Goal deleted.','warn');}catch(e2){toast(e2.message||'Delete failed.','warn');}
    });
    listEl.appendChild(card);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{const fill=card.querySelector('.goal-fill2');if(fill)fill.style.width=pct+'%';}));
  });
}

function openGoalModal(idx){
  _anGoalEditIdx=idx;const goals=getGoals();const g=idx!==null?goals[idx]:null;
  document.getElementById('goalModalTitle').textContent=g?'✏ Edit Goal':'🎯 New Savings Goal';
  document.getElementById('gmName').value=g?g.name:'';document.getElementById('gmEmoji').value=g?g.emoji:'🎯';
  document.getElementById('gmTarget').value=g?g.target:'';document.getElementById('gmSaved').value=g?g.saved:'';
  _anSelColor=g?g.color:'#3b82f6';document.getElementById('gmColor').value=_anSelColor;
  document.getElementById('gmColorPicker').querySelectorAll('span').forEach(s=>{s.style.border=s.dataset.c===_anSelColor?'2px solid var(--tx)':'2px solid transparent';});
  document.getElementById('goalModal').classList.remove('H');setTimeout(()=>document.getElementById('gmName').focus(),50);
}

async function saveGoal(){
  const name=document.getElementById('gmName').value.trim(),emoji=document.getElementById('gmEmoji').value.trim()||'🎯',target=parseFloat(document.getElementById('gmTarget').value),saved=parseFloat(document.getElementById('gmSaved').value)||0,color=document.getElementById('gmColor').value||'#3b82f6';
  if(!name||isNaN(target)||target<=0){toast('Fill in name and target amount.','warn');return;}
  const goals=getGoals();const obj={name,emoji,target,saved,color};
  try{
    let updatedGoals;
    if(_anGoalEditIdx!==null&&goals[_anGoalEditIdx]){updatedGoals=await API.Goals.update(goals[_anGoalEditIdx].id,obj);toast('Goal updated!');}
    else{updatedGoals=await API.Goals.add(obj);toast('Goal added!');}
    S.user.savingsGoals=updatedGoals;
    document.getElementById('goalModal').classList.add('H');
    renderSavingsGoals(S.user.transactions||[]);
  }catch(e){toast(e.message||'Could not save goal.','warn');}
}

async function saveBudget(){
  const cat=document.getElementById('bmCat').value;
  const amtRaw=document.getElementById('bmAmt').value;
  const amt=parseFloat(amtRaw);
  // FIX: guard empty string separately (parseFloat('')=NaN but also catch amt<0)
  if(!cat||amtRaw===''||isNaN(amt)||amt<0){toast('Enter a valid amount (0 or more).','warn');return;}
  setSyncState('saving');
  try{
    const raw=await API.Budgets.set(cat,amt);
    // FIX: Mongoose can return a Map — always normalise to plain {}
    S.user.budgets=toPlainObj(raw);
    document.getElementById('budgetModal').classList.add('H');
    setSyncState('saved');
    refreshAnalyticsCharts(S.user.transactions||[]);
    toast('Budget set for '+cat+'!');
  }catch(e){
    setSyncState('saved');
    toast(e.message||'Failed to save budget. Please try again.','warn');
  }
}

// ── Transactions ───────────────────────────────────────────
function updateSelBar(){
  const n=selectedTxIds.size,bar=document.getElementById('selBar');
  if(n===0){bar.classList.add('H');}else{bar.classList.remove('H');document.getElementById('selBarTxt').textContent=n+' transaction'+(n>1?'s':'')+' selected';document.getElementById('selEditBtn').style.display=n===1?'':'none';document.getElementById('selDupBtn').style.display=n===1?'':'none';}
}
function exportTxCSV(txList,filename){
  const header='Date,Description,Category,Type,Amount,Status';
  const rows=txList.map(t=>`${t.date},"${t.name}",${t.cat},${t.type||(t.amt>0?'income':'expense')},${Math.abs(t.amt).toFixed(2)},${t.status||'cleared'}`);
  const csv=header+'\n'+rows.join('\n');
  const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download=filename;a.click();
}

function renderTxPage(){
  // FIX #18: Clone input elements to remove stale listeners before re-attaching
  document.getElementById('qaDate').value=today();
  // Safely re-attach by cloning action buttons
  const cloneAndReattach = (id, handler) => {
    const old = document.getElementById(id); if(!old) return;
    const clone = old.cloneNode(true); old.replaceWith(clone);
    document.getElementById(id).addEventListener('click', handler);
  };
  document.getElementById('qaAdd').onclick = addTransaction;
  document.getElementById('txSearch').oninput = renderTxTable;
  document.getElementById('txCatF').onchange = renderTxTable;
  document.getElementById('txTypeF').onchange = renderTxTable;
  document.getElementById('selEditBtn').onclick=openEditModal;
  document.getElementById('selDupBtn').onclick=duplicateSelected;
  document.getElementById('selDelBtn').onclick=deleteSelected;
  document.getElementById('selClearedBtn').onclick=()=>bulkSetStatus('cleared');
  document.getElementById('selPendingBtn').onclick=()=>bulkSetStatus('pending');
  document.getElementById('selExportBtn').onclick=exportSelected;
  document.getElementById('selClearBtn').onclick=()=>{selectedTxIds.clear();updateSelBar();renderTxTable();};
  document.getElementById('exportAllBtn').onclick=()=>{
    const u=usr();if(!u)return;
    const search=(document.getElementById('txSearch')?.value||'').toLowerCase();
    const cat=document.getElementById('txCatF')?.value||'all';
    const type=document.getElementById('txTypeF')?.value||'all';
    const rows=(u.transactions||[]).filter(t=>(cat==='all'||t.cat===cat)&&(type==='all'||t.type===type)&&(t.name.toLowerCase().includes(search)||t.cat.toLowerCase().includes(search)));
    exportTxCSV(rows,'transactions.csv');toast('Exported '+rows.length+' transactions!');
  };
  document.getElementById('etCancel').onclick=()=>document.getElementById('editTxModal').classList.add('H');
  document.getElementById('etSave').onclick=saveEditedTx;
  renderTxTable();
}

async function bulkSetStatus(status){
  const u=usr();if(!u||selectedTxIds.size===0)return;
  setSyncState('saving');
  try{
    for(const id of selectedTxIds){const idx=u.transactions.findIndex(t=>t.id===id);if(idx>-1){await API.Transactions.update(id,{status});u.transactions[idx].status=status;}}
    setSyncState('saved');renderTxTable();toast(selectedTxIds.size+' transaction'+(selectedTxIds.size>1?'s':'')+' marked '+status+'!');
  }catch(e){toast(e.message||'Update failed.','warn');setSyncState('saved');}
}

async function duplicateSelected(){
  const u=usr();if(!u||selectedTxIds.size!==1)return;
  const id=[...selectedTxIds][0];const tx=(u.transactions||[]).find(t=>t.id===id);if(!tx)return;
  const copy={date:tx.date,name:'Copy of '+tx.name,cat:tx.cat,type:tx.type,amt:tx.amt,status:'pending'};
  try{const txs=await API.Transactions.add(copy);S.user.transactions=txs;selectedTxIds.clear();updateSelBar();renderTxTable();toast('Transaction duplicated as pending!');}
  catch(e){toast(e.message||'Duplicate failed.','warn');}
}

function exportSelected(){const u=usr();if(!u||selectedTxIds.size===0)return;const txList=(u.transactions||[]).filter(t=>selectedTxIds.has(t.id));exportTxCSV(txList,'selected_transactions.csv');toast('Exported '+txList.length+' transaction'+(txList.length>1?'s':'')+' to CSV!');}

function openEditModal(){
  const u=usr();if(!u||selectedTxIds.size!==1)return;
  const id=[...selectedTxIds][0];const tx=(u.transactions||[]).find(t=>t.id===id);if(!tx)return;
  document.getElementById('etDesc').value=tx.name;
  document.getElementById('etAmt').value=Math.abs(tx.amt);
  document.getElementById('etType').value=tx.type||(tx.amt>0?'income':'expense');
  document.getElementById('etCat').value=tx.cat;
  document.getElementById('etDate').value=tx.date;
  document.getElementById('etStatus').value=tx.status||'cleared';
  document.getElementById('editTxModal').classList.remove('H');
  document.getElementById('editTxModal').dataset.txid=id;
  setTimeout(()=>document.getElementById('etDesc').focus(),50);
}

async function saveEditedTx(){
  const u=usr();if(!u)return;
  const id=document.getElementById('editTxModal').dataset.txid;
  const tx=(u.transactions||[]).find(t=>t.id===id);if(!tx)return;
  const desc=document.getElementById('etDesc').value.trim();const amt=parseFloat(document.getElementById('etAmt').value);
  if(!desc||isNaN(amt)||amt<=0){toast('Fill in all fields correctly.','warn');return;}
  const type=document.getElementById('etType').value;
  const changes={name:desc,type,cat:document.getElementById('etCat').value,date:document.getElementById('etDate').value,status:document.getElementById('etStatus').value,amt:type==='expense'?-Math.abs(amt):Math.abs(amt)};
  try{
    const txs=await API.Transactions.update(id,changes);S.user.transactions=txs;
    document.getElementById('editTxModal').classList.add('H');selectedTxIds.clear();updateSelBar();
    renderTxTable();toast('Transaction updated!');
    if(!document.getElementById('ftAnalytics').classList.contains('H'))refreshAnalyticsCharts(S.user.transactions||[]);
    if(!document.getElementById('ftOverview').classList.contains('H'))renderFinOverview();
  }catch(e){toast(e.message||'Update failed.','warn');}
}

async function deleteSelected(){
  const u=usr();if(!u||selectedTxIds.size===0)return;
  const n=selectedTxIds.size;if(!confirm('Delete '+n+' transaction'+(n>1?'s':'')+' permanently?'))return;
  try{
    const ids=[...selectedTxIds];const txs=await API.Transactions.bulkRemove(ids);S.user.transactions=txs;
    selectedTxIds.clear();updateSelBar();renderTxTable();toast(n+' transaction'+(n>1?'s':'')+' deleted.','warn');
    if(!document.getElementById('ftAnalytics').classList.contains('H'))refreshAnalyticsCharts(S.user.transactions||[]);
    if(!document.getElementById('ftOverview').classList.contains('H'))renderFinOverview();
  }catch(e){toast(e.message||'Delete failed.','warn');}
}

async function addTransaction(){
  const u=usr();if(!u)return;
  const desc=document.getElementById('qaDesc').value.trim();
  const amt=parseFloat(document.getElementById('qaAmt').value);
  const cat=document.getElementById('qaCat').value;
  const type=document.getElementById('qaType').value;
  const date=document.getElementById('qaDate').value||today();
  if(!desc||isNaN(amt)||amt<=0){toast('Please fill in description and amount.','warn');return;}
  try{
    const txs=await API.Transactions.add({date,name:desc,cat,type,amt:type==='expense'?-amt:amt,status:'cleared'});
    S.user.transactions=txs;
    document.getElementById('qaDesc').value='';document.getElementById('qaAmt').value='';
    renderTxTable();toast('Transaction added!');
    if(!document.getElementById('ftOverview').classList.contains('H'))renderFinOverview();
    if(!document.getElementById('ftAnalytics').classList.contains('H'))refreshAnalyticsCharts(S.user.transactions||[]);
  }catch(e){toast(e.message||'Could not add transaction.','warn');}
}

function renderTxTable(){
  const u=usr();if(!u)return;const txns=u.transactions||[];
  const search=(document.getElementById('txSearch')?.value||'').toLowerCase();
  const cat=document.getElementById('txCatF')?.value||'all';
  const type=document.getElementById('txTypeF')?.value||'all';
  let rows=txns.filter(t=>(cat==='all'||t.cat===cat)&&(type==='all'||t.type===type)&&(t.name.toLowerCase().includes(search)||t.cat.toLowerCase().includes(search)));
  rows=[...rows].sort((a,b)=>{
    let av=a[txSortCol==='description'?'name':txSortCol==='category'?'cat':txSortCol]||'';
    let bv=b[txSortCol==='description'?'name':txSortCol==='category'?'cat':txSortCol]||'';
    if(txSortCol==='amount'){av=a.amt;bv=b.amt;}
    if(typeof av==='string')return txSortAsc?av.localeCompare(bv):bv.localeCompare(av);
    return txSortAsc?av-bv:bv-av;
  });
  const countEl=document.getElementById('txRowCount');if(countEl)countEl.textContent=rows.length+' of '+txns.length;
  const allIds=rows.map(t=>t.id);
  const allChecked=allIds.length>0&&allIds.every(id=>selectedTxIds.has(id));
  const head=document.getElementById('txHead2');
  head.innerHTML=`<tr><th class="tx-cb-th" style="cursor:default"><input type="checkbox" class="tx-cb" id="txCbAll" ${allChecked?'checked':''} title="Select all visible"/></th>${['date','description','category','amount','status'].map(h=>`<th class="${txSortCol===h?'sorted':''}" data-col="${h}">${h.charAt(0).toUpperCase()+h.slice(1)} ${txSortCol===h?txSortAsc?'↑':'↓':''}</th>`).join('')}</tr>`;
  head.querySelectorAll('th[data-col]').forEach(th=>{th.onclick=()=>{if(txSortCol===th.dataset.col)txSortAsc=!txSortAsc;else{txSortCol=th.dataset.col;txSortAsc=true;}renderTxTable();};});
  const cbAll=document.getElementById('txCbAll');
  if(cbAll)cbAll.addEventListener('change',()=>{if(cbAll.checked)allIds.forEach(id=>selectedTxIds.add(id));else allIds.forEach(id=>selectedTxIds.delete(id));updateSelBar();renderTxTable();});
  const body=document.getElementById('txBody2');
  if(!rows.length){body.innerHTML='<tr><td colspan="6" style="text-align:center;color:var(--tx3);padding:28px 0">No transactions match — try adjusting your filters</td></tr>';return;}
  const selRows=rows.filter(t=>selectedTxIds.has(t.id));
  const selInc=selRows.filter(t=>t.amt>0).reduce((s,t)=>s+t.amt,0);
  const selExp=selRows.filter(t=>t.amt<0).reduce((s,t)=>s+Math.abs(t.amt),0);
  body.innerHTML='';
  rows.forEach(t=>{
    const col=CAT_COLORS[t.cat]||'#888';const bg=isDk()?col+'22':col+'18';const pos=t.amt>0;
    const sb=t.status==='cleared'?(isDk()?'#0d2818':'#f0fdf4'):(isDk()?'#2e1e00':'#fffbeb');
    const sc=t.status==='cleared'?(isDk()?'#3fb950':'#15803d'):(isDk()?'#d29922':'#b45309');
    const isSel=selectedTxIds.has(t.id);
    const tr=document.createElement('tr');if(isSel)tr.classList.add('tx-selected');tr.style.cursor='pointer';tr.title='Double-click to edit';
    tr.innerHTML=`<td class="tx-cb-td"><input type="checkbox" class="tx-cb tx-row-cb" data-id="${t.id}" ${isSel?'checked':''}/></td><td style="color:var(--tx3);font-size:11px">${t.date}</td><td><div class="tx-row"><div class="tx-icon" style="background:${bg};color:${col}"><svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:${col}">${CAT_ICONS[t.cat]||''}</svg></div><div class="tx-name">${t.name}</div></div></td><td><span class="badge" style="background:${bg};color:${col}">${t.cat}</span></td><td class="${pos?'amt-pos':'amt-neg'}" style="font-variant-numeric:tabular-nums">${pos?'+':'-'}₹${Math.abs(t.amt).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td><span class="badge" style="background:${sb};color:${sc}">${t.status}</span></td>`;
    tr.addEventListener('dblclick',e=>{if(e.target.closest('.tx-cb-td'))return;selectedTxIds.clear();selectedTxIds.add(t.id);updateSelBar();renderTxTable();openEditModal();});
    body.appendChild(tr);
  });
  // FIX #18: Use event delegation instead of per-row listeners to avoid accumulation
  body.addEventListener('change', e => {
    if (!e.target.classList.contains('tx-row-cb')) return;
    const id = e.target.dataset.id;
    if (e.target.checked) selectedTxIds.add(id); else selectedTxIds.delete(id);
    updateSelBar(); renderTxTable();
  }, {once: true});
  if(selRows.length>0){
    const foot=document.createElement('tr');
    foot.innerHTML=`<td colspan="6" style="padding:8px 14px;background:var(--blubg);border-top:1px solid var(--blumid);font-size:11px;color:var(--blumid);font-weight:600">Selected: ${selRows.length} row${selRows.length>1?'s':''}${selInc>0?` &nbsp;·&nbsp; <span style="color:var(--grnmid)">+₹${selInc.toLocaleString('en-IN',{minimumFractionDigits:2})}</span>`:''}${selExp>0?` &nbsp;·&nbsp; <span style="color:var(--redm)">-₹${selExp.toLocaleString('en-IN',{minimumFractionDigits:2})}</span>`:''} &nbsp;·&nbsp; Net: <span style="color:${selInc-selExp>=0?'var(--grnmid)':'var(--redm)'}">${selInc-selExp>=0?'+':''}₹${Math.abs(selInc-selExp).toLocaleString('en-IN',{minimumFractionDigits:2})}</span></td>`;
    body.appendChild(foot);
  }
}

function renderWeeklyReview(){
  const u=usr();if(!u)return;
  const txns=u.transactions||[];const now=new Date();
  const weekStart=new Date(now);weekStart.setDate(now.getDate()-7);
  const weekTxns=txns.filter(t=>new Date(t.date+'T12:00:00')>=weekStart);
  const weekInc=weekTxns.filter(t=>t.amt>0).reduce((s,t)=>s+t.amt,0);
  const weekExp=weekTxns.filter(t=>t.amt<0).reduce((s,t)=>s+Math.abs(t.amt),0);
  const weekNet=weekInc-weekExp;
  document.getElementById('wrSubtitle').textContent=`Summary for ${weekStart.toLocaleDateString('en-GB',{day:'numeric',month:'short'})} – ${now.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}`;
  document.getElementById('wrGrid').innerHTML=[
    {label:'Week income',val:'₹'+weekInc.toFixed(0),color:'#22c55e'},
    {label:'Week expenses',val:'₹'+weekExp.toFixed(0),color:'#ef4444'},
    {label:'Net this week',val:(weekNet>=0?'+':'')+('₹'+Math.abs(weekNet).toFixed(0)),color:weekNet>=0?'#22c55e':'#ef4444'},
    {label:'Transactions',val:weekTxns.length,color:'#3b82f6'}
  ].map(i=>`<div class="wr-item" style="border-color:${i.color}"><div class="wr-item-label">${i.label}</div><div class="wr-item-val" style="color:${i.color}">${i.val}</div></div>`).join('');
  const suggestions=[
    weekExp>weekInc*0.7?{icon:'⚠️',msg:'Expenses are above 70% of income this week.',color:'#f59e0b'}:null,
    weekNet<0?{icon:'🔴',msg:'You spent more than you earned this week.',color:'#ef4444'}:null,
    weekNet>1000?{icon:'✅',msg:'Great week! You saved ₹'+weekNet.toFixed(0)+'. Consider moving the surplus to a savings goal.',color:'#22c55e'}:null,
    {icon:'💡',msg:'Set a daily spending limit to stay on track.',color:'#3b82f6'},
    weekTxns.filter(t=>t.cat==='Entertainment').length>3?{icon:'🎬',msg:'Multiple entertainment transactions this week.',color:'#8b5cf6'}:null
  ].filter(Boolean);
  document.getElementById('wrSuggestions').innerHTML=suggestions.slice(0,4).map(s=>`<div class="wr-sug" style="border-color:${s.color}"><span>${s.icon}</span><span style="color:var(--tx2)">${s.msg}</span></div>`).join('');
  const smallTxns=txns.filter(t=>t.amt<0&&Math.abs(t.amt)<50);const leakMap={};
  smallTxns.forEach(t=>{leakMap[t.cat]=(leakMap[t.cat]||0)+Math.abs(t.amt);});
  const leaks=Object.entries(leakMap).sort((a,b)=>b[1]-a[1]).slice(0,4);
  document.getElementById('spendingLeaks').innerHTML=leaks.map(([cat,amt])=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--sf2);border-radius:8px;font-size:12px"><span style="color:var(--tx2)">${cat}</span><span style="font-weight:600;color:var(--redm)">₹${amt.toFixed(2)}</span></div>`).join('')||'<div style="font-size:12px;color:var(--tx3);padding:8px">No small recurring leaks detected.</div>';
  const catMap2={};txns.filter(t=>t.type==='expense').forEach(t=>{catMap2[t.cat]=(catMap2[t.cat]||0)+Math.abs(t.amt);});
  const budgets=getBudgets();
  const alerts=[];
  Object.entries(budgets).forEach(([cat,budget])=>{const spent=catMap2[cat]||0;if(spent>budget)alerts.push({msg:`${cat} is ${Math.round((spent/budget-1)*100)}% over budget`,color:'#ef4444'});});
  if(weekExp>weekInc)alerts.push({msg:'Overspending detected this week',color:'#ef4444'});
  alerts.push({msg:'Tip: log transactions daily for more accurate weekly reviews',color:'#3b82f6'});
  document.getElementById('ruleAlerts').innerHTML=alerts.slice(0,5).map(a=>`<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;background:var(--sf2);border-radius:8px;border-left:3px solid ${a.color};font-size:12px;color:var(--tx2)"><span>•</span><span>${a.msg}</span></div>`).join('');
  document.getElementById('budgetActual').innerHTML=Object.entries(budgets).map(([cat,budget])=>{
    const spent=catMap2[cat]||0;const pct=Math.round(spent/budget*100);const over=spent>budget;const color=CAT_COLORS_AN[cat]||'#888';
    return`<div class="cat-item2"><div class="cat-head2"><div class="cat-name2"><div class="cat-dot" style="background:${color}"></div>${cat}</div><div style="display:flex;gap:8px;align-items:center"><span style="font-size:11px;color:${over?'#ef4444':'var(--tx3)'}">₹${spent.toFixed(0)} / ₹${budget}</span><span class="cat-amt" style="color:${over?'#ef4444':color}">${pct}%</span></div></div><div class="cat-track"><div class="cat-fill" style="width:${Math.min(pct,100)}%;background:${over?'#ef4444':color}"></div></div></div>`;
  }).join('')||'<div style="font-size:12px;color:var(--tx3);padding:8px 0">Set budgets in the Analytics tab to track actuals here.</div>';
}

// ══════════════════════════════════════════════════════════
//  JOURNAL MODULE
// ══════════════════════════════════════════════════════════
const MOODS=[
  {e:'😊',l:'Happy',score:5},{e:'😄',l:'Excited',score:6},{e:'🤩',l:'Amazing',score:7},
  {e:'😌',l:'Calm',score:4},{e:'🙂',l:'Good',score:4},{e:'😐',l:'Neutral',score:3},
  {e:'🤔',l:'Reflective',score:3},{e:'😴',l:'Tired',score:2},
  {e:'😞',l:'Down',score:2},{e:'😔',l:'Sad',score:1},{e:'😤',l:'Frustrated',score:2},
  {e:'😢',l:'Upset',score:1}
];
// FIX #6 & #7: MOOD_SCORE uses same emojis as MOODS array above
const MOOD_SCORE_MAP = Object.fromEntries(MOODS.map(m=>[m.e, m.score]));
const MOOD_COLORS_MAP = {'😊':'#4caf50','😄':'#22c55e','🤩':'#10b981','😌':'#2196f3','🙂':'#86efac','😐':'#94a3b8','🤔':'#ff9800','😴':'#64748b','😞':'#f97316','😔':'#9e9e9e','😤':'#f44336','😢':'#ef4444'};
const TAGS = ['Gratitude','Work','Personal','Goals','Health','Travel','Learning','Idea'];
let jState = { mode:'list', tab:'entries', editId:null, selMood:null, selTags:[], searchQ:'' };

function getJournals(){ const u=usr(); if(!u)return[]; return u.journals||[]; }

function sentimentScore(text){
  const pos=['happy','great','amazing','good','love','grateful','excited','proud','wonderful','fantastic','joy','blessed','achieve','win','success','positive','better','best','improve','hope','calm','peaceful'];
  const neg=['sad','bad','terrible','awful','hate','angry','frustrated','fail','lost','stress','anxious','depressed','horrible','worst','struggle','hard','difficult','pain','tired','overwhelmed','upset','lonely'];
  const words=(text||'').toLowerCase().split(/\W+/);let s=0;
  words.forEach(w=>{if(pos.includes(w))s++;if(neg.includes(w))s--;});
  if(s>2)return{label:'Positive',color:'#4caf50',val:s};
  if(s<-1)return{label:'Negative',color:'#ef4444',val:s};
  return{label:'Neutral',color:'#f59e0b',val:s};
}

// FIX #8: correct relative date calculation
function fmtRelative(dateStr){
  if(!dateStr) return '';
  const d = new Date(dateStr+'T00:00:00');
  const today2 = new Date(); today2.setHours(0,0,0,0);
  const diff = Math.round((today2 - d) / 864e5);
  if(diff === 0) return 'Today';
  if(diff === 1) return 'Yesterday';
  if(diff < 7) return diff+' days ago';
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}

function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function renderJournalPage(){
  const pg=document.getElementById('pgJournal');
  pg.innerHTML='';
  const journals=getJournals();
  let streak=0;
  for(let i=0;i<365;i++){const d=dStr(addD(new Date(),-i));if(journals.some(j=>j.date===d))streak++;else if(i>0)break;}
  const totalWords=journals.reduce((s,j)=>s+(j.body||'').split(/\s+/).filter(Boolean).length,0);
  const thisMonth=journals.filter(j=>{const d=new Date(j.date+'T12:00:00'),n=new Date();return d.getMonth()===n.getMonth()&&d.getFullYear()===n.getFullYear();}).length;
  const statsRow=document.createElement('div');
  statsRow.style.cssText='display:flex;gap:8px;flex-wrap:wrap;';
  [{icon:'📅',label:'Streak',val:streak+' day'+(streak!==1?'s':'')},{icon:'📝',label:'Entries',val:journals.length},{icon:'📖',label:'Words',val:totalWords.toLocaleString()},{icon:'🗓',label:'This month',val:thisMonth}].forEach(s=>{
    const el=document.createElement('div');el.className='jstat';
    el.innerHTML=`${s.icon} ${s.label}: <strong>${s.val}</strong>`;statsRow.appendChild(el);
  });
  pg.appendChild(statsRow);
  const layout=document.createElement('div');layout.className='journal-layout';
  const sidebar=document.createElement('div');sidebar.className='journal-sidebar';
  sidebar.innerHTML=`
    <div class="journal-sidebar-head">
      <span class="journal-sidebar-title">📔 My Journal</span>
      <button class="btn-new-journal" id="jNewBtn">✦ New Entry</button>
    </div>
    <div class="journal-mini-stats">
      <div class="jms"><div class="jms-val">${journals.length}</div><div class="jms-lbl">Entries</div></div>
      <div class="jms"><div class="jms-val">${streak}</div><div class="jms-lbl">Streak</div></div>
      <div class="jms"><div class="jms-val">${thisMonth}</div><div class="jms-lbl">Month</div></div>
      <div class="jms"><div class="jms-val">${totalWords>999?Math.round(totalWords/1000)+'k':totalWords}</div><div class="jms-lbl">Words</div></div>
    </div>
    <div class="journal-tabs">
      <div class="jtab ${jState.tab==='entries'?'on':''}" id="jtabEntries">📋 Entries</div>
      <div class="jtab ${jState.tab==='analytics'?'on':''}" id="jtabAnalytics">📊 Analytics</div>
    </div>`;
  if(jState.tab==='entries'){
    const searchDiv=document.createElement('div');searchDiv.className='journal-search';
    searchDiv.innerHTML='<input type="text" placeholder="Search entries…" id="jSearch"/>';
    sidebar.appendChild(searchDiv);
    const listDiv=document.createElement('div');listDiv.className='journal-list';
    const q=(jState.searchQ||'').toLowerCase();
    const filtered=journals.filter(j=>!q||(j.title||'').toLowerCase().includes(q)||(j.body||'').toLowerCase().includes(q));
    if(filtered.length===0){
      listDiv.innerHTML=`<div class="journal-empty-state"><div class="je-icon">📝</div><div class="je-txt">${q?'No entries match your search.':'No entries yet.\nClick "New Entry" to start.'}</div></div>`;
    } else {
      filtered.forEach(entry=>{
        const card=document.createElement('div');
        card.className='journal-card'+(jState.editId===entry.id?' active':'');
        card.innerHTML=`<div class="jc-date"><span class="jc-mood">${entry.mood||'📅'}</span>${fmtRelative(entry.date)}</div><div class="jc-title">${escHtml(entry.title||'Untitled')}</div><div class="jc-preview">${escHtml((entry.body||'').slice(0,120))}</div><button class="jc-del" data-id="${entry.id}" title="Delete entry">×</button>`;
        card.addEventListener('click',e=>{if(e.target.classList.contains('jc-del'))return;jState.editId=entry.id;jState.mode='view';renderJournalPage();});
        card.querySelector('.jc-del').addEventListener('click',async e=>{
          e.stopPropagation();if(!confirm('Delete this entry?'))return;
          try{const j2=await API.Journals.remove(entry.id);S.user.journals=j2;if(jState.editId===entry.id){jState.editId=null;jState.mode='list';}renderJournalPage();toast('Entry deleted.','warn');}
          catch(e2){toast(e2.message||'Could not delete.','warn');}
        });
        listDiv.appendChild(card);
      });
    }
    sidebar.appendChild(listDiv);
  } else {
    const hint=document.createElement('div');
    hint.style.cssText='padding:16px 12px;font-size:12px;color:var(--tx3);line-height:1.7';
    hint.textContent='📊 Full analytics in the main panel →';
    sidebar.appendChild(hint);
  }
  sidebar.addEventListener('click',e=>{
    if(e.target.id==='jtabEntries'){jState.tab='entries';renderJournalPage();}
    else if(e.target.id==='jtabAnalytics'){jState.tab='analytics';renderJournalPage();}
    else if(e.target.id==='jNewBtn'){
      jState.tab='entries';jState.mode='edit';jState.editId=null;jState.selMood=null;jState.selTags=[];
      renderJournalPage();setTimeout(()=>{const t=document.getElementById('jTitleInp');if(t)t.focus();},80);
    }
  });
  const rightPane=document.createElement('div');rightPane.className='journal-editor';
  if(jState.tab==='analytics'){
    rightPane.appendChild(renderJournalAnalyticsPanel(journals));
  } else if(jState.mode==='edit'){
    renderJournalEditorForm(rightPane);
  } else if(jState.mode==='view'&&jState.editId){
    const entry=journals.find(j=>j.id===jState.editId);
    if(entry)renderJournalBookView(rightPane,entry);
    else{jState.mode='list';jState.editId=null;rightPane.innerHTML=`<div class="journal-editor-empty"><div class="je-big-icon">📖</div><div class="je-hint">Select an entry to read it.</div></div>`;}
  } else {
    rightPane.innerHTML=`<div class="journal-editor-empty"><div class="je-big-icon">📖</div><div class="je-hint">Select an entry to read it,<br>or click <strong>New Entry</strong> to start writing.</div></div>`;
  }
  layout.appendChild(sidebar);layout.appendChild(rightPane);pg.appendChild(layout);
  const si=document.getElementById('jSearch');
  if(si){si.value=jState.searchQ||'';si.addEventListener('input',()=>{jState.searchQ=si.value;renderJournalPage();});}
}

function renderJournalAnalyticsPanel(journals){
  const wrap=document.createElement('div');wrap.className='jan-wrap';
  if(!journals.length){
    wrap.innerHTML='<div style="padding:40px;text-align:center;font-size:13px;color:var(--tx3)">✍ Write a few entries to unlock analytics.</div>';
    return wrap;
  }
  const avgWords=Math.round(journals.reduce((s,j)=>s+(j.body||'').split(/\s+/).filter(Boolean).length,0)/journals.length);
  const moodCounts={};journals.filter(j=>j.mood).forEach(j=>{moodCounts[j.mood]=(moodCounts[j.mood]||0)+1;});
  const topMood=Object.entries(moodCounts).sort((a,b)=>b[1]-a[1])[0];
  let streak=0;
  for(let i=0;i<365;i++){const d=dStr(addD(new Date(),-i));if(journals.some(j=>j.date===d))streak++;else if(i>0)break;}
  // Sentiment counts
  const sentMap={Positive:0,Neutral:0,Negative:0};
  journals.forEach(j=>{const s=sentimentScore(j.body||'');sentMap[s.label]++;});
  // Tag counts
  const tagMap={};journals.forEach(j=>(j.tags||[]).forEach(t=>{tagMap[t]=(tagMap[t]||0)+1;}));
  const topTags=Object.entries(tagMap).sort((a,b)=>b[1]-a[1]).slice(0,6);

  const kpiRow=document.createElement('div');kpiRow.className='jan-kpi-row';
  kpiRow.innerHTML=[
    {icon:'📊',val:journals.length,lbl:'Total entries'},{icon:'🔥',val:streak,lbl:'Day streak'},
    {icon:'📝',val:avgWords,lbl:'Avg words'},{icon:topMood?topMood[0]:'😊',val:topMood?topMood[1]:0,lbl:'Top mood count'}
  ].map((k,i)=>`<div class="jan-kpi" style="animation-delay:${i*60}ms"><div class="jan-kpi-icon">${k.icon}</div><div class="jan-kpi-val">${k.val}</div><div class="jan-kpi-lbl">${k.lbl}</div></div>`).join('');
  wrap.appendChild(kpiRow);

  // FIX #7: use MOOD_SCORE_MAP which matches MOODS array emojis
  const moodEntries=journals.filter(j=>j.mood&&MOOD_SCORE_MAP[j.mood]!==undefined).sort((a,b)=>a.date.localeCompare(b.date)).slice(-30);

  wrap.innerHTML+=`
    <div class="jan-chart-card">
      <div class="jan-chart-head"><div class="jan-chart-title">📈 Mood Trend <span class="jan-chart-sub">last 30 entries</span></div></div>
      <div class="jan-chart-wrap"><canvas id="jMoodLineCh"></canvas></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="jan-chart-card">
        <div class="jan-chart-head"><div class="jan-chart-title">😊 Mood Distribution</div></div>
        <div style="display:flex;align-items:center;gap:12px">
          <div style="position:relative;width:100px;height:100px;flex-shrink:0"><canvas id="jMoodDonutCh"></canvas></div>
          <div id="jMoodLegend" class="jan-mood-legend"></div>
        </div>
      </div>
      <div class="jan-chart-card">
        <div class="jan-chart-head"><div class="jan-chart-title">💬 Sentiment</div></div>
        <div style="display:flex;align-items:center;gap:12px">
          <div style="position:relative;width:100px;height:100px;flex-shrink:0"><canvas id="jSentCh"></canvas></div>
          <div style="font-size:11px;line-height:2;color:var(--tx2)">
            <div><span style="color:#4caf50">●</span> Positive: ${sentMap.Positive}</div>
            <div><span style="color:#f59e0b">●</span> Neutral: ${sentMap.Neutral}</div>
            <div><span style="color:#ef4444">●</span> Negative: ${sentMap.Negative}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="jan-chart-card">
      <div class="jan-chart-head"><div class="jan-chart-title">✍️ Words Per Entry <span class="jan-chart-sub">last 14 entries</span></div></div>
      <div class="jan-chart-wrap"><canvas id="jWordsCh"></canvas></div>
    </div>
    <div class="jan-chart-card">
      <div class="jan-chart-head"><div class="jan-chart-title">📅 Writing Heatmap <span class="jan-chart-sub">last 12 weeks</span></div></div>
      <div id="jHeatmap" class="jan-heatmap"></div>
    </div>
    <div class="jan-chart-card">
      <div class="jan-chart-head"><div class="jan-chart-title">🏷️ Topic Frequency</div></div>
      <div id="jTagBars"></div>
    </div>
    <div class="jan-chart-card">
      <div class="jan-chart-head"><div class="jan-chart-title">💡 Insights</div></div>
      <div id="jInsights" class="jan-insights-row"></div>
    </div>
  `;
  wrap.insertBefore(kpiRow, wrap.firstChild);

  requestAnimationFrame(()=>{
    // 1. Mood line chart
    const moodLineCh=document.getElementById('jMoodLineCh');
    if(moodLineCh){
      if(moodEntries.length>1){
        new Chart(moodLineCh,{type:'line',data:{
          labels:moodEntries.map(e=>new Date(e.date+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'})),
          datasets:[{data:moodEntries.map(e=>MOOD_SCORE_MAP[e.mood]||3),borderColor:'#8b5cf6',backgroundColor:'rgba(139,92,246,.08)',borderWidth:2.5,fill:true,tension:.4,pointRadius:4,pointBackgroundColor:moodEntries.map(e=>{const s=MOOD_SCORE_MAP[e.mood]||3;return s>=5?'#22c55e':s>=3?'#f59e0b':'#ef4444';}),pointHoverRadius:7}]},
          options:{responsive:true,maintainAspectRatio:false,animation:{duration:800,easing:'easeInOutQuart'},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>{const e=moodEntries[c.dataIndex];return`${e.mood} score: ${c.parsed.y}`;}}}}  ,scales:{y:{min:0,max:8,ticks:{stepSize:1,font:{size:10},color:tc(),callback:v=>MOODS.find(m=>m.score===v)?.e||''},grid:{color:gc()}},x:{ticks:{font:{size:9},color:tc(),maxTicksLimit:10},grid:{display:false}}}}});
      } else {
        moodLineCh.closest('.jan-chart-wrap').innerHTML='<div style="height:150px;display:flex;align-items:center;justify-content:center;color:var(--tx3);font-size:12px">Add mood to 2+ entries to see trend</div>';
      }
    }
    // 2. Mood donut
    const moodDonutCh=document.getElementById('jMoodDonutCh');
    if(moodDonutCh&&Object.keys(moodCounts).length){
      const labels=Object.keys(moodCounts),data=labels.map(k=>moodCounts[k]),colors=labels.map(k=>MOOD_COLORS_MAP[k]||'#94a3b8');
      new Chart(moodDonutCh,{type:'doughnut',data:{labels,datasets:[{data,backgroundColor:colors,borderWidth:2,borderColor:isDk()?'#111827':'#fff'}]},options:{responsive:true,maintainAspectRatio:false,cutout:'60%',animation:{duration:700},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.label}: ${c.parsed} (${Math.round(c.parsed/journals.filter(j=>j.mood).length*100)}%)`}}}}});
      const total=data.reduce((a,b)=>a+b,0);
      const legEl=document.getElementById('jMoodLegend');
      if(legEl)legEl.innerHTML=labels.map((l,i)=>`<div class="jan-legend-item"><span class="jan-legend-dot" style="background:${colors[i]}"></span>${l} <span class="jan-legend-pct">${Math.round(data[i]/total*100)}%</span></div>`).join('');
    }
    // 3. Sentiment donut
    const sentCh=document.getElementById('jSentCh');
    if(sentCh&&(sentMap.Positive+sentMap.Neutral+sentMap.Negative>0)){
      new Chart(sentCh,{type:'doughnut',data:{labels:['Positive','Neutral','Negative'],datasets:[{data:[sentMap.Positive,sentMap.Neutral,sentMap.Negative],backgroundColor:['#4caf50','#f59e0b','#ef4444'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'60%',animation:{duration:700},plugins:{legend:{display:false}}}});
    }
    // 4. Words bar chart — FIX #16: guard empty array
    const wordsCh=document.getElementById('jWordsCh');
    const last14=[...journals].sort((a,b)=>a.date.localeCompare(b.date)).slice(-14);
    if(wordsCh&&last14.length>0){
      const wordCounts=last14.map(j=>(j.body||'').split(/\s+/).filter(Boolean).length);
      const barColors=wordCounts.map(w=>w>200?'#8b5cf6':w>100?'#06b6d4':w>50?'#22c55e':'#94a3b8');
      new Chart(wordsCh,{type:'bar',data:{labels:last14.map(j=>new Date(j.date+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'})),datasets:[{data:wordCounts,backgroundColor:barColors,borderRadius:5,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,animation:{duration:700,easing:'easeOutQuart'},plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>c.parsed.y+' words'}}},scales:{y:{ticks:{font:{size:10},color:tc()},grid:{color:gc()}},x:{ticks:{font:{size:9},color:tc()},grid:{display:false}}}}});
    } else if(wordsCh){
      wordsCh.closest('.jan-chart-wrap').innerHTML='<div style="height:150px;display:flex;align-items:center;justify-content:center;color:var(--tx3);font-size:12px">Write entries to see word count chart</div>';
    }
    // 5. Heatmap
    const heatEl=document.getElementById('jHeatmap');
    if(heatEl){
      const dateSet=new Set(journals.map(j=>j.date));
      const today2=new Date();const days=[];
      for(let i=83;i>=0;i--){const d=new Date(today2);d.setDate(d.getDate()-i);days.push(dStr(d));}
      const grid=document.createElement('div');grid.className='jan-heat-grid';
      days.forEach(d=>{const has=dateSet.has(d);const dt=new Date(d+'T12:00:00');const sq=document.createElement('div');sq.className='jan-heat-cell'+(has?' active':'');sq.title=dt.toLocaleDateString('en-GB',{day:'numeric',month:'short'})+(has?' ✓':'');if(has){sq.style.cursor='pointer';sq.addEventListener('click',()=>{const e=journals.find(j=>j.date===d);if(e){jState.tab='entries';jState.mode='view';jState.editId=e.id;renderJournalPage();}});}grid.appendChild(sq);});
      heatEl.innerHTML='';heatEl.appendChild(grid);
      const legend=document.createElement('div');legend.className='jan-heat-legend';
      legend.innerHTML='<div class="jan-heat-sq"></div>None <div class="jan-heat-sq on" style="margin-left:8px"></div>Wrote';
      heatEl.appendChild(legend);
    }
    // 6. Tag bars
    const tagBarsEl=document.getElementById('jTagBars');
    if(tagBarsEl){
      if(topTags.length===0){tagBarsEl.innerHTML='<div style="font-size:12px;color:var(--tx3);padding:8px 0">No tags used yet!</div>';}
      else{const maxCount=topTags[0][1];const tagColors=['#4caf50','#2196f3','#ff9800','#9c27b0','#f44336','#14b8a6'];topTags.forEach(([tag,count],i)=>{const pct=Math.round(count/maxCount*100);tagBarsEl.innerHTML+=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px"><span style="font-size:11px;color:var(--tx2);min-width:72px">${tag}</span><div style="flex:1;height:7px;background:var(--bd);border-radius:4px;overflow:hidden"><div style="width:${pct}%;height:100%;background:${tagColors[i%tagColors.length]};border-radius:4px;transition:width .7s var(--ease)"></div></div><span style="font-size:11px;color:var(--tx3);min-width:16px">${count}</span></div>`;});}
    }
    // 7. Insights
    const insEl=document.getElementById('jInsights');
    if(insEl){
      const insights=[];
      const avgMoodVal=journals.filter(j=>j.mood&&MOOD_SCORE_MAP[j.mood]).reduce((s,j)=>s+(MOOD_SCORE_MAP[j.mood]||3),0)/Math.max(journals.filter(j=>j.mood&&MOOD_SCORE_MAP[j.mood]).length,1);
      if(streak>=3)insights.push({icon:'🔥',title:streak+'-day streak!',txt:'Keep writing daily — consistency builds self-awareness.',color:'#ff9800'});
      if(avgMoodVal>=5)insights.push({icon:'😊',title:'Great mood overall',txt:'Your average mood score is high. Keep it up!',color:'#4caf50'});
      else if(avgMoodVal<3)insights.push({icon:'💙',title:'Mood seems low',txt:'Consider writing a gratitude entry to shift perspective.',color:'#2196f3'});
      if(topMood)insights.push({icon:topMood[0],title:`"${MOODS.find(m=>m.e===topMood[0])?.l||topMood[0]}" is top mood`,txt:`You've felt this way ${topMood[1]} time${topMood[1]!==1?'s':''}.`,color:MOOD_COLORS_MAP[topMood[0]]||'var(--p)'});
      if(topTags[0])insights.push({icon:'🏷️',title:`"${topTags[0][0]}" is your top topic`,txt:`You've tagged it ${topTags[0][1]} time${topTags[0][1]!==1?'s':''}.`,color:'#9c27b0'});
      if(avgWords>200)insights.push({icon:'📝',title:'Deep writer',txt:`You average ${avgWords} words per entry — impressive!`,color:'#14b8a6'});
      insEl.innerHTML=insights.slice(0,4).map((ins,i)=>`<div class="jan-insight-chip" style="animation-delay:${i*60}ms;border-left:3px solid ${ins.color}"><span class="jan-insight-emoji">${ins.icon}</span><span class="jan-insight-txt"><span class="jan-insight-bold">${ins.title}</span>${ins.txt}</span></div>`).join('')||'<div style="font-size:12px;color:var(--tx3)">Write more entries to unlock insights!</div>';
    }
  });
  return wrap;
}

function renderJournalEditorForm(wrap){
  // FIX #4: isEdit = mode is 'edit' AND editId is set (not null)
  const isEdit = jState.mode==='edit' && !!jState.editId;
  const journals=getJournals();
  const existing=isEdit?journals.find(j=>j.id===jState.editId):null;
  // Restore mood/tags from existing entry when editing
  if(isEdit&&existing&&jState.selMood===null)jState.selMood=existing.mood||null;
  if(isEdit&&existing&&!jState.selTags.length)jState.selTags=[...(existing.tags||[])];
  wrap.innerHTML=`<div class="journal-editor-form">
    <div class="jef-toolbar">
      <div class="jef-mood-wrap">
        <span class="jef-mood-lbl">Mood:</span>
        ${MOODS.map(m=>`<button class="mood-btn ${jState.selMood===m.e?'sel':''}" data-mood="${m.e}" title="${m.l}">${m.e}</button>`).join('')}
      </div>
      <div class="jef-tags">${TAGS.map(t=>`<span class="tag-chip ${jState.selTags.includes(t)?'sel':''}" data-tag="${t}">${t}</span>`).join('')}</div>
    </div>
    <div class="jef-meta">
      <div class="jef-date-lbl">${isEdit&&existing?fmtRelative(existing.date)+' — '+new Date(existing.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}):new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</div>
      <input class="jef-title-inp" id="jTitleInp" placeholder="Entry title…" value="${escHtml(existing?.title||'')}" maxlength="120"/>
    </div>
    <div class="jef-divider"></div>
    <div class="jef-body"><textarea class="jef-body-inp" id="jBodyInp" placeholder="What's on your mind today?…">${escHtml(existing?.body||'')}</textarea></div>
    <div class="jef-footer">
      <span class="jef-word-count" id="jWC">0 words</span>
      <button class="btn-discard" id="jDiscard">${isEdit?'Cancel':'Discard'}</button>
      <button class="btn-save-journal" id="jSave">${isEdit?'Update entry ✓':'Save entry ✓'}</button>
    </div>
  </div>`;
  const bodyInp=wrap.querySelector('#jBodyInp');const wc=wrap.querySelector('#jWC');
  const updateWC=()=>{const w=(bodyInp.value.trim().match(/\S+/g)||[]).length;wc.textContent=w+' word'+(w!==1?'s':'');};
  bodyInp.addEventListener('input',updateWC);updateWC();
  wrap.querySelectorAll('.mood-btn').forEach(btn=>{btn.addEventListener('click',()=>{jState.selMood=jState.selMood===btn.dataset.mood?null:btn.dataset.mood;wrap.querySelectorAll('.mood-btn').forEach(b=>b.classList.toggle('sel',b.dataset.mood===jState.selMood));});});
  wrap.querySelectorAll('.tag-chip').forEach(chip=>{chip.addEventListener('click',()=>{const t=chip.dataset.tag;if(jState.selTags.includes(t))jState.selTags=jState.selTags.filter(x=>x!==t);else jState.selTags=[...jState.selTags,t];chip.classList.toggle('sel',jState.selTags.includes(t));});});
  wrap.querySelector('#jDiscard').addEventListener('click',()=>{
    jState.selMood=null;jState.selTags=[];
    if(isEdit){jState.mode='view';renderJournalPage();}else{jState.mode='list';jState.editId=null;renderJournalPage();}
  });
  wrap.querySelector('#jSave').addEventListener('click',async()=>{
    const title=document.getElementById('jTitleInp').value.trim();
    const body=document.getElementById('jBodyInp').value.trim();
    if(!title&&!body){toast('Write something first!','warn');return;}
    try{
      let journals2;
      if(isEdit&&existing){
        journals2=await API.Journals.update(existing.id,{title:title||'Untitled',body,mood:jState.selMood,tags:jState.selTags});
        toast('Entry updated! 📝');
      } else {
        journals2=await API.Journals.add({title:title||'Untitled',body,mood:jState.selMood,tags:jState.selTags,date:today()});
        // FIX #5: find the newly added entry by matching title+date rather than [0]
        const newEntry=journals2.find(j=>j.title===(title||'Untitled')&&j.date===today());
        jState.editId=newEntry?.id||journals2[0]?.id||null;
        toast('Journal saved! 📖');
      }
      S.user.journals=journals2;
      jState.mode='view';jState.selMood=null;jState.selTags=[];
      renderJournalPage();
    }catch(e){toast(e.message||'Could not save entry.','warn');}
  });
}

function renderJournalBookView(wrap,entry){
  const wordCount=(entry.body||'').trim().split(/\s+/).filter(Boolean).length;
  const readMins=Math.max(1,Math.ceil(wordCount/200));
  wrap.innerHTML=`<div class="journal-book-view">
    <div class="jbv-head">
      <button class="jbv-back" id="jbvBack">‹</button>
      <div class="jbv-meta">
        ${entry.tags&&entry.tags.length?`<div class="jbv-tags">${entry.tags.map(t=>`<span class="jbv-tag">${t}</span>`).join('')}</div>`:''}
        <div class="jbv-date">${new Date(entry.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · ${wordCount} words · ${readMins} min read</div>
      </div>
      <div class="jbv-actions"><button class="jbv-edit-btn" id="jbvEdit">✏ Edit</button></div>
    </div>
    <div class="journal-book-page">
      ${entry.mood?`<div class="jbp-mood">${entry.mood}</div>`:''}
      <div class="jbp-title">${escHtml(entry.title||'Untitled')}</div>
      <div class="jbp-body">${escHtml(entry.body||'').replace(/\n/g,'<br>')}</div>
      <div class="jbp-footer"><span>${entry.updatedAt?'Last edited '+fmtRelative(entry.updatedAt.slice(0,10)):'Written '+fmtRelative(entry.date)}</span><span>✍ ${wordCount} words</span></div>
    </div>
  </div>`;
  wrap.querySelector('#jbvBack').addEventListener('click',()=>{jState.mode='list';jState.editId=null;renderJournalPage();});
  wrap.querySelector('#jbvEdit').addEventListener('click',()=>{jState.mode='edit';jState.selMood=entry.mood||null;jState.selTags=[...(entry.tags||[])];renderJournalPage();});
}

// ══════════════════════════════════════════════════════════
//  BOOT
// ══════════════════════════════════════════════════════════
async function boot(){
  // FIX #3: guard against missing API.getToken
  const token = typeof API?.getToken === 'function' ? API.getToken() : null;

  // Hard timeout — splash never hangs beyond 8s
  const killSwitch=setTimeout(()=>{
    console.warn('[Devnix] Boot hard-timeout — forcing login');
    document.getElementById('splash').classList.add('H');
    document.getElementById('authView').classList.remove('H');
  },8000);
  // Show "waking up" after 3s
  const slowTimer=setTimeout(()=>{
    const el=document.getElementById('splashSlow');
    if(el&&!document.getElementById('splash').classList.contains('H'))el.style.display='block';
  },3000);
  const finish=()=>{clearTimeout(killSwitch);clearTimeout(slowTimer);};

  if(!token){
    finish();applyDark();
    document.getElementById('splash').classList.add('H');
    document.getElementById('authView').classList.remove('H');
    return;
  }
  try{
    const user=await Promise.race([
      API.Auth.me(),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),5000))
    ]);
    finish();
    if(!user||!user.email){
      API.Auth.logout();applyDark();
      document.getElementById('splash').classList.add('H');
      document.getElementById('authView').classList.remove('H');
      return;
    }
    S.user=normaliseUser(user);S.dark=user.dark||false;applyDark();
    document.getElementById('splash').classList.add('H');
    mountApp();
  }catch(e){
    finish();
    try{API.Auth.logout();}catch(e2){}
    applyDark();
    document.getElementById('splash').classList.add('H');
    document.getElementById('authView').classList.remove('H');
  }
}

function mountApp(){
  document.getElementById('authView').classList.add('H');
  document.getElementById('splash').classList.add('H');
  document.getElementById('appShell').classList.remove('H');
  const u=S.user;
  document.getElementById('nbAv').textContent=(u?.email||'?').split('@')[0][0]?.toUpperCase()||'?';
  // Reset to dashboard tab
  document.querySelectorAll('.nb-btn').forEach(b=>b.classList.remove('on'));
  document.querySelector('.nb-btn[data-pg="dashboard"]')?.classList.add('on');
  ['pgFinance','pgJournal','pgProfile'].forEach(id=>document.getElementById(id)?.classList.add('H'));
  document.getElementById('pgDashboard')?.classList.remove('H');
  applyDark();wOff=0;
  renderGrid();
  setTimeout(()=>renderDisciplineAnalytics(),750);
  setSyncState('saved');
}

// ── Budget & goal modal buttons — wired ONCE at startup ─────────────────────
// FIX: Previously only wired inside renderFinAnalytics(), causing silent failure
// if the budget modal was opened before the Analytics tab was visited.
(function wireBudgetGoalModals(){
  const bmCancel=document.getElementById('bmCancel');
  const bmSave=document.getElementById('bmSave');
  const gmCancel=document.getElementById('gmCancel');
  const gmSave=document.getElementById('gmSave');
  if(bmCancel)bmCancel.onclick=()=>document.getElementById('budgetModal').classList.add('H');
  if(bmSave)bmSave.onclick=saveBudget;
  if(gmCancel)gmCancel.onclick=()=>document.getElementById('goalModal').classList.add('H');
  if(gmSave)gmSave.onclick=saveGoal;
  document.getElementById('gmColorPicker')?.querySelectorAll('span').forEach(s=>{
    s.onclick=()=>{
      _anSelColor=s.dataset.c;
      const inp=document.getElementById('gmColor');if(inp)inp.value=_anSelColor;
      document.getElementById('gmColorPicker').querySelectorAll('span').forEach(x=>x.style.border='2px solid transparent');
      s.style.border='2px solid var(--tx)';
    };
  });
})();

boot();
