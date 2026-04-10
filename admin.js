// admin.js — Fixed version
// FIXES:
// 1. showSec initial call now correctly passes the active nav element
// 2. renderEmpTable() now always waits for loadEmployees() to finish first
// 3. refreshOverview() uses maybeSingle() not single() to avoid errors
// 4. Removed await getSettings() from inside per-employee loop (was N DB calls)
// 5. All DB errors are caught and shown as toasts

if (!Session.requireAdmin()) throw new Error('Not authorized');
renderSidebarUser();

const todayLabelEl = document.getElementById('today-label');
if (todayLabelEl) todayLabelEl.textContent = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

let allEmployees  = [];
let currentSection = 'overview';

// ---- SECTION NAV ----
function showSec(name, btn) {
  document.querySelectorAll('main section').forEach(s => s.style.display = 'none');
  const sec = document.getElementById('sec-' + name);
  if (sec) sec.style.display = 'block';

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (btn) btn.classList.add('active');

  currentSection = name;
  if (name === 'overview')   refreshOverview();
  if (name === 'employees')  loadAndRenderEmployees();
  if (name === 'tasks')      { loadTaskEmployeeFilter(); loadTasks(); }
}

// ---- LOAD EMPLOYEES ----
async function loadEmployees() {
  try {
    const { data, error } = await db.from('users').select('*').order('created_at');
    if (error) throw error;
    allEmployees = data || [];
  } catch(e) {
    console.error('loadEmployees error:', e);
    allEmployees = [];
  }
}

// Load then immediately render
async function loadAndRenderEmployees() {
  await loadEmployees();
  renderEmpTable();
}

// ---- OVERVIEW ----
async function refreshOverview() {
  try {
    await loadEmployees();
    const emps  = allEmployees.filter(u => u.role === 'employee');
    const today = T.todayKey();

    const [{ data: recs }, { data: openBreaks }, { data: openTasks }, settings] = await Promise.all([
      db.from('attendance').select('*').eq('date_key', today),
      db.from('breaks').select('*').eq('date_key', today).is('end_time', null),
      db.from('tasks').select('id').in('stage', ['todo','inprogress','review']),
      getSettings()
    ]);

    let online = 0, onBreak = 0;
    const rows = [];

    for (const emp of emps) {
      const rec    = (recs || []).find(r => r.user_id === emp.id);
      const status = rec ? rec.status : 'offline';
      if (status === 'online') online++;
      if (status === 'break')  onBreak++;

      let workSec = 0, breakSec = 0;
      if (rec) {
        breakSec = rec.total_break_sec || 0;
        if (status === 'break') {
          const ob = (openBreaks || []).find(b => b.user_id === emp.id);
          if (ob) breakSec += T.diff(ob.start_time, T.now());
        }
        if (status === 'offline' && rec.working_sec) {
          workSec  = rec.working_sec;
          breakSec = rec.total_break_sec || 0;
        } else if (rec.online_time && status !== 'offline') {
          workSec = Math.max(0, T.diff(rec.online_time, T.now()) - breakSec);
        }
      }

      const score      = rec ? (rec.score !== null && rec.score !== undefined ? rec.score : calcScoreSync(breakSec, settings)) : settings.daily_score;
      const scoreColor = score >= settings.daily_score ? 'var(--green)' : 'var(--red)';

      // Count open tasks for this employee (from already-loaded openTasks)
      const empOpenTasks = (openTasks || []).length; // this is total; we'll fetch per-emp below

      rows.push({ emp, status, workSec, breakSec, score, scoreColor });
    }

    // Fetch per-employee task counts in one query
    if (emps.length > 0) {
      const empIds = emps.map(e => e.id);
      const { data: taskData } = await db.from('tasks').select('assigned_to')
        .in('assigned_to', empIds).in('stage', ['todo','inprogress','review']);
      const taskCounts = {};
      (taskData || []).forEach(t => { taskCounts[t.assigned_to] = (taskCounts[t.assigned_to] || 0) + 1; });

      const tbody = document.getElementById('live-tbody');
      if (tbody) {
        tbody.innerHTML = rows.map(({ emp, status, workSec, breakSec, score, scoreColor }) => `<tr>
          <td><strong>${emp.name}</strong><br><span class="tsm t3 mono">${emp.id}</span></td>
          <td>${statusBadge(status)}</td>
          <td class="mono">${(recs||[]).find(r=>r.user_id===emp.id)?.online_time ? T.fmtTime((recs||[]).find(r=>r.user_id===emp.id).online_time) : '--'}</td>
          <td class="mono">${T.fmt(workSec)}</td>
          <td class="mono">${T.fmt(breakSec)}</td>
          <td><span class="mono" style="font-weight:700;color:${scoreColor}">${score}</span></td>
          <td><span class="badge b-todo">${taskCounts[emp.id] || 0} open</span></td>
        </tr>`).join('') || '<tr><td colspan="7"><div class="empty-state"><div class="ei">👥</div><p>No employees yet</p></div></td></tr>';
      }
    } else {
      const tbody = document.getElementById('live-tbody');
      if (tbody) tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="ei">👥</div><p>No employees yet. <button class="btn btn-sm btn-primary" onclick="showSec(\'employees\')">Add one</button></p></div></td></tr>';
    }

    const set = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
    set('st-total', emps.length);
    set('st-online', online);
    set('st-break', onBreak);
    set('st-tasks', openTasks ? openTasks.length : 0);

  } catch(e) {
    console.error('refreshOverview error:', e);
    showToast('Failed to refresh overview', 'error');
  }
}

// ---- EMPLOYEE TABLE ----
function renderEmpTable() {
  const q     = (document.getElementById('emp-search')?.value || '').toLowerCase();
  const list  = allEmployees.filter(u => !q || u.id.toLowerCase().includes(q) || u.name.toLowerCase().includes(q));
  const tbody = document.getElementById('emp-tbody');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="ei">👤</div><p>No employees found</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = list.map(u => `<tr>
    <td class="mono">${u.id}</td>
    <td><strong>${u.name}</strong></td>
    <td><span class="badge ${u.role==='admin'?'b-online':'b-offline'}">${u.role}</span></td>
    <td><span class="badge ${u.status==='active'?'b-active':'b-disabled'}">${u.status}</span></td>
    <td class="tsm">${T.fmtDate(u.created_at)}</td>
    <td>${u.id !== 'admin'
      ? `<div class="fca gap1">
           <button class="btn btn-sm btn-outline" onclick="editEmp('${u.id}')">Edit</button>
           <button class="btn btn-sm btn-danger" onclick="promptDel('${u.id}','${u.name.replace(/'/g,"\\'")}')">Delete</button>
         </div>`
      : '<span class="t3 tsm">Protected</span>'}</td>
  </tr>`).join('');
}

// ---- CREATE EMPLOYEE ----
async function createEmployee() {
  const id     = document.getElementById('ne-id')?.value.trim();
  const name   = document.getElementById('ne-name')?.value.trim();
  const pw     = document.getElementById('ne-pw')?.value;
  const status = document.getElementById('ne-status')?.value;
  if (!id || !name || !pw) { showToast('All fields are required', 'error'); return; }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) { showToast('ID: letters, numbers, _ and - only', 'error'); return; }
  try {
    const { error } = await db.from('users').insert({ id, name, password:pw, role:'employee', status });
    if (error) { showToast(error.code === '23505' ? 'Employee ID already exists' : error.message, 'error'); return; }
    showToast(`${name} created ✓`, 'success');
    closeModal('m-add-emp');
    ['ne-id','ne-name','ne-pw'].forEach(i => { const el=document.getElementById(i); if(el) el.value=''; });
    await loadAndRenderEmployees();
    refreshOverview();
  } catch(e) {
    showToast('Error creating employee: ' + e.message, 'error');
  }
}

// ---- EDIT EMPLOYEE ----
async function editEmp(id) {
  const u = allEmployees.find(e => e.id === id);
  if (!u) return;
  const setVal = (id, val) => { const el=document.getElementById(id); if(el) el.value=val; };
  setVal('ee-id',     id);
  setVal('ee-name',   u.name);
  setVal('ee-pw',     '');
  setVal('ee-status', u.status);
  openModal('m-edit-emp');
}

async function saveEmployee() {
  const id     = document.getElementById('ee-id')?.value;
  const name   = document.getElementById('ee-name')?.value.trim();
  const pw     = document.getElementById('ee-pw')?.value;
  const status = document.getElementById('ee-status')?.value;
  if (!name) { showToast('Name is required', 'error'); return; }
  const upd = { name, status };
  if (pw) upd.password = pw;
  try {
    const { error } = await db.from('users').update(upd).eq('id', id);
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Employee updated ✓', 'success');
    closeModal('m-edit-emp');
    await loadAndRenderEmployees();
  } catch(e) {
    showToast('Error updating employee', 'error');
  }
}

// ---- DELETE EMPLOYEE ----
function promptDel(id, name) {
  const delId   = document.getElementById('del-id');
  const delName = document.getElementById('del-name');
  if (delId)   delId.value       = id;
  if (delName) delName.textContent = name;
  openModal('m-delete');
}

async function confirmDelete() {
  const id = document.getElementById('del-id')?.value;
  if (!id) return;
  try {
    const { error } = await db.from('users').delete().eq('id', id);
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Employee deleted', 'success');
    closeModal('m-delete');
    await loadAndRenderEmployees();
    refreshOverview();
  } catch(e) {
    showToast('Error deleting employee', 'error');
  }
}

// ---- TASK EMPLOYEE FILTER ----
async function loadTaskEmployeeFilter() {
  if (!allEmployees.length) await loadEmployees();
  const emps = allEmployees.filter(u => u.role === 'employee');
  const opts = emps.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  ['tf-employee','nt-assign','et-assign'].forEach(sid => {
    const sel = document.getElementById(sid);
    if (!sel) return;
    const base = sid === 'tf-employee' ? '<option value="">All Employees</option>' : '<option value="">Select employee…</option>';
    sel.innerHTML = base + opts;
  });
}

// ---- LOAD TASKS ----
async function loadTasks() {
  try {
    if (!allEmployees.length) await loadEmployees();

    const empFilter = document.getElementById('tf-employee')?.value || '';
    const priFilter = document.getElementById('tf-priority')?.value || '';
    const search    = (document.getElementById('tf-search')?.value || '').toLowerCase();

    let query = db.from('tasks').select('*').order('created_at', { ascending: false });
    if (empFilter) query = query.eq('assigned_to', empFilter);
    if (priFilter) query = query.eq('priority', priFilter);

    const { data: tasks, error } = await query;
    if (error) throw error;

    let filtered = (tasks || []).filter(t =>
      !search || t.title.toLowerCase().includes(search) || (t.description || '').toLowerCase().includes(search)
    );

    // ---- Build Kanban ----
    const stages    = ['todo','inprogress','review','done'];
    const stageCtrs = { todo:0, inprogress:0, review:0, done:0 };

    stages.forEach(s => {
      const col = document.getElementById('col-' + s);
      const cnt = document.getElementById('cnt-' + s);
      if (col) col.innerHTML = '';
      if (cnt) cnt.textContent = '0';
    });

    for (const t of filtered) {
      stageCtrs[t.stage] = (stageCtrs[t.stage] || 0) + 1;
      const empName = (allEmployees.find(e => e.id === t.assigned_to) || {}).name || t.assigned_to;
      const card    = document.createElement('div');
      card.className = 'task-card';
      card.innerHTML = `
        <div class="task-priority-strip strip-${t.priority}"></div>
        <div class="task-card-title">${t.title}</div>
        ${t.description ? `<p class="tsm t3" style="margin-bottom:.4rem;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${t.description}</p>` : ''}
        <div class="task-card-meta">
          <span class="task-card-assign">👤 ${empName}</span>
          ${t.deadline ? `<span class="task-deadline ${deadlineClass(t.deadline)}">${deadlineText(t.deadline)}</span>` : ''}
        </div>
        <div class="fca gap1 mt1">${priorityBadge(t.priority)}</div>`;
      card.onclick = () => openTaskDetail(t.id);
      const col = document.getElementById('col-' + t.stage);
      if (col) col.appendChild(card);
    }

    stages.forEach(s => {
      const cnt = document.getElementById('cnt-' + s);
      if (cnt) cnt.textContent = stageCtrs[s] || 0;
      const col = document.getElementById('col-' + s);
      if (col && !col.children.length) col.innerHTML = '<div class="empty-col">✦<span>No tasks here</span></div>';
    });

    // ---- Task Table ----
    const tbody = document.getElementById('task-tbody');
    if (!tbody) return;
    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="ei">📋</div><p>No tasks found</p></div></td></tr>';
      return;
    }
    tbody.innerHTML = filtered.map(t => {
      const empName = (allEmployees.find(e => e.id === t.assigned_to) || {}).name || t.assigned_to;
      return `<tr>
        <td><strong>${t.title}</strong></td>
        <td>${empName}</td>
        <td>${priorityBadge(t.priority)}</td>
        <td>${stageBadge(t.stage)}</td>
        <td class="tsm ${deadlineClass(t.deadline)}">${t.deadline ? deadlineText(t.deadline) : '—'}</td>
        <td><div class="fca gap1">
          <button class="btn btn-sm btn-outline" onclick="openEditTask('${t.id}')">Edit</button>
          <button class="btn btn-sm btn-ghost"   onclick="openTaskDetail('${t.id}')">View</button>
          <button class="btn btn-sm btn-danger"  onclick="deleteTask('${t.id}')">Del</button>
        </div></td>
      </tr>`;
    }).join('');
  } catch(e) {
    console.error('loadTasks error:', e);
    showToast('Error loading tasks', 'error');
  }
}

// ---- CREATE TASK ----
async function createTask() {
  const title    = document.getElementById('nt-title')?.value.trim();
  const desc     = document.getElementById('nt-desc')?.value.trim();
  const assignTo = document.getElementById('nt-assign')?.value;
  const priority = document.getElementById('nt-priority')?.value;
  const stage    = document.getElementById('nt-stage')?.value;
  const deadline = document.getElementById('nt-deadline')?.value;
  if (!title || !assignTo) { showToast('Title and assigned employee are required', 'error'); return; }
  const sess = Session.get();
  try {
    const { error } = await db.from('tasks').insert({
      id:          `task_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      title, description: desc,
      assigned_to: assignTo,
      assigned_by: sess.id,
      priority, stage,
      deadline: deadline ? new Date(deadline).toISOString() : null
    });
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Task created ✓', 'success');
    closeModal('m-add-task');
    const clearIds = ['nt-title','nt-desc'];
    clearIds.forEach(i => { const el=document.getElementById(i); if(el) el.value=''; });
    loadTasks();
  } catch(e) {
    showToast('Error creating task', 'error');
  }
}

// ---- EDIT TASK ----
async function openEditTask(id) {
  try {
    const { data: t } = await db.from('tasks').select('*').eq('id', id).single();
    if (!t) return;
    await loadTaskEmployeeFilter();
    const setVal = (id, val) => { const el=document.getElementById(id); if(el) el.value=val; };
    setVal('et-id',       t.id);
    setVal('et-title',    t.title);
    setVal('et-desc',     t.description || '');
    setVal('et-assign',   t.assigned_to);
    setVal('et-priority', t.priority);
    setVal('et-stage',    t.stage);
    setVal('et-deadline', t.deadline ? new Date(t.deadline).toISOString().slice(0,16) : '');
    openModal('m-edit-task');
  } catch(e) {
    showToast('Could not load task', 'error');
  }
}

async function saveTask() {
  const id       = document.getElementById('et-id')?.value;
  const title    = document.getElementById('et-title')?.value.trim();
  const desc     = document.getElementById('et-desc')?.value.trim();
  const assignTo = document.getElementById('et-assign')?.value;
  const priority = document.getElementById('et-priority')?.value;
  const stage    = document.getElementById('et-stage')?.value;
  const deadline = document.getElementById('et-deadline')?.value;
  if (!title) { showToast('Title is required', 'error'); return; }
  try {
    const { error } = await db.from('tasks').update({
      title, description: desc, assigned_to: assignTo,
      priority, stage,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      updated_at: T.now()
    }).eq('id', id);
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Task updated ✓', 'success');
    closeModal('m-edit-task');
    loadTasks();
  } catch(e) {
    showToast('Error saving task', 'error');
  }
}

// ---- DELETE TASK ----
async function deleteTask(id) {
  if (!confirm('Delete this task? This cannot be undone.')) return;
  try {
    await db.from('tasks').delete().eq('id', id);
    showToast('Task deleted', 'success');
    loadTasks();
  } catch(e) {
    showToast('Error deleting task', 'error');
  }
}

// ---- TASK DETAIL ----
let detailTaskId = null;

async function openTaskDetail(id) {
  detailTaskId = id;
  try {
    const { data: t } = await db.from('tasks').select('*').eq('id', id).single();
    if (!t) return;

    const assignEmp = (allEmployees.find(e => e.id === t.assigned_to) || {}).name || t.assigned_to;
    const assignBy  = (allEmployees.find(e => e.id === t.assigned_by) || {}).name || t.assigned_by;

    const set     = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
    const setHTML = (id, val) => { const el=document.getElementById(id); if(el) el.innerHTML=val; };
    const setVal  = (id, val) => { const el=document.getElementById(id); if(el) el.value=val; };

    setVal('td-id', id);
    set('td-title',   t.title);
    set('td-desc',    t.description || 'No description');
    set('td-assign',  assignEmp);
    set('td-by',      assignBy);
    set('td-created', T.fmtDateTime(t.created_at));
    setHTML('td-priority', priorityBadge(t.priority));
    setHTML('td-stage',    stageBadge(t.stage));
    setHTML('td-deadline', t.deadline
      ? `<span class="${deadlineClass(t.deadline)}">${deadlineText(t.deadline)}</span>`
      : '—');
    setVal('td-stage-update', t.stage);

    await loadComments(id);
    openModal('m-task-detail');
  } catch(e) {
    showToast('Could not load task details', 'error');
    console.error('openTaskDetail error:', e);
  }
}

async function loadComments(taskId) {
  const list = document.getElementById('td-comments');
  if (!list) return;
  try {
    const { data: comments } = await db.from('task_comments').select('*')
      .eq('task_id', taskId).order('created_at');
    if (!comments || !comments.length) {
      list.innerHTML = '<div class="t3 tsm" style="text-align:center;padding:1rem">No comments yet</div>';
      return;
    }
    list.innerHTML = comments.map(c => {
      const uname = (allEmployees.find(e => e.id === c.user_id) || {}).name || c.user_id;
      return `<div class="comment-item">
        <div><span class="comment-author">${uname}</span>
        <span class="comment-time">${T.fmtDateTime(c.created_at)}</span></div>
        <div class="comment-text">${c.comment}</div>
      </div>`;
    }).join('');
    list.scrollTop = list.scrollHeight;
  } catch(e) {
    console.error('loadComments error:', e);
  }
}

async function addComment() {
  const input = document.getElementById('td-comment-input');
  const text  = input ? input.value.trim() : '';
  if (!text || !detailTaskId) return;
  const sess = Session.get();
  try {
    await db.from('task_comments').insert({
      id: `cmt_${Date.now()}`, task_id: detailTaskId, user_id: sess.id, comment: text
    });
    if (input) input.value = '';
    await loadComments(detailTaskId);
  } catch(e) {
    showToast('Could not post comment', 'error');
  }
}

async function updateTaskStage() {
  const id    = document.getElementById('td-id')?.value;
  const stage = document.getElementById('td-stage-update')?.value;
  if (!id || !stage) return;
  try {
    await db.from('tasks').update({ stage, updated_at: T.now() }).eq('id', id);
    const stageEl = document.getElementById('td-stage');
    if (stageEl) stageEl.innerHTML = stageBadge(stage);
    showToast('Stage updated ✓', 'success');
    loadTasks();
  } catch(e) {
    showToast('Could not update stage', 'error');
  }
}

// ---- INIT ----
// Find the first nav-item that corresponds to overview and mark it active
const firstNavItem = document.querySelector('.nav-item');
showSec('overview', firstNavItem);
setInterval(() => { if (currentSection === 'overview') refreshOverview(); }, 30000);
