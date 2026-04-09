// admin.js
if (!Session.requireAdmin()) throw new Error('Not authorized');
renderSidebarUser();
document.getElementById('today-label').textContent = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

let allEmployees = [];
let currentSection = 'overview';

// ---- SECTION NAV ----
function showSec(name, btn) {
  document.querySelectorAll('main section').forEach(s => s.style.display='none');
  document.getElementById('sec-'+name).style.display = 'block';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (btn) btn.classList.add('active');
  currentSection = name;
  if (name==='overview') refreshOverview();
  if (name==='employees') { loadEmployees(); renderEmpTable(); }
  if (name==='tasks') { loadTaskEmployeeFilter(); loadTasks(); }
}

// ---- LOAD EMPLOYEES ----
async function loadEmployees() {
  const { data } = await db.from('users').select('*').order('created_at');
  allEmployees = data || [];
}

// ---- OVERVIEW ----
async function refreshOverview() {
  await loadEmployees();
  const emps = allEmployees.filter(u => u.role === 'employee');
  const today = T.todayKey();
  const { data: recs } = await db.from('attendance').select('*').eq('date_key', today);
  const { data: breaks } = await db.from('breaks').select('*').eq('date_key', today).is('end_time', null);
  const { data: openTasks } = await db.from('tasks').select('id').in('stage',['todo','inprogress','review']);

  let online=0, onBreak=0;
  const rows = [];
  for (const emp of emps) {
    const rec = (recs||[]).find(r => r.user_id === emp.id);
    const status = rec ? rec.status : 'offline';
    if (status==='online') online++;
    if (status==='break') onBreak++;

    let workSec=0, breakSec=0;
    if (rec) {
      breakSec = rec.total_break_sec||0;
      if (status==='break') {
        const ob = (breaks||[]).find(b => b.user_id===emp.id);
        if (ob) breakSec += T.diff(ob.start_time, T.now());
      }
      if (rec.online_time) {
        const end = rec.offline_time ? rec.offline_time : T.now();
        workSec = Math.max(0, T.diff(rec.online_time, end) - breakSec);
      }
      if (status==='offline' && rec.working_sec) workSec = rec.working_sec;
    }
    const s = await getSettings();
    const score = rec ? (rec.score !== null ? rec.score : await calcScore(breakSec)) : s.daily_score;
    const scoreColor = score >= s.daily_score ? 'var(--green)' : 'var(--red)';
    const empTasks = await db.from('tasks').select('id,stage').eq('assigned_to',emp.id).in('stage',['todo','inprogress','review']);
    const taskCount = empTasks.data ? empTasks.data.length : 0;
    rows.push(`<tr>
      <td><strong>${emp.name}</strong><br><span class="tsm t3 mono">${emp.id}</span></td>
      <td>${sBadge(status)}</td>
      <td class="mono">${rec&&rec.online_time ? T.fmtTime(rec.online_time) : '--'}</td>
      <td class="mono">${T.fmt(workSec)}</td>
      <td class="mono">${T.fmt(breakSec)}</td>
      <td><span class="mono" style="font-weight:700;color:${scoreColor}">${score}</span></td>
      <td><span class="badge b-todo">${taskCount} open</span></td>
    </tr>`);
  }
  document.getElementById('st-total').textContent = emps.length;
  document.getElementById('st-online').textContent = online;
  document.getElementById('st-break').textContent = onBreak;
  document.getElementById('st-tasks').textContent = openTasks ? openTasks.length : 0;
  document.getElementById('live-tbody').innerHTML = rows.join('') || '<tr><td colspan="7"><div class="empty-state"><div class="ei">👥</div><p>No employees yet</p></div></td></tr>';
}

function sBadge(s) {
  if (s==='online') return `<span class="badge b-online"><span class="dot dot-on"></span>Online</span>`;
  if (s==='break') return `<span class="badge b-break"><span class="dot dot-brk"></span>On Break</span>`;
  return `<span class="badge b-offline"><span class="dot dot-off"></span>Offline</span>`;
}

// ---- EMPLOYEE TABLE ----
function renderEmpTable() {
  const q = (document.getElementById('emp-search')?.value||'').toLowerCase();
  const list = allEmployees.filter(u => !q || u.id.toLowerCase().includes(q) || u.name.toLowerCase().includes(q));
  const tbody = document.getElementById('emp-tbody');
  if (!list.length) { tbody.innerHTML=`<tr><td colspan="6"><div class="empty-state"><div class="ei">👤</div><p>No employees found</p></div></td></tr>`; return; }
  tbody.innerHTML = list.map(u => `<tr>
    <td class="mono">${u.id}</td>
    <td><strong>${u.name}</strong></td>
    <td><span class="badge ${u.role==='admin'?'b-online':'b-offline'}">${u.role}</span></td>
    <td><span class="badge ${u.status==='active'?'b-active':'b-disabled'}">${u.status}</span></td>
    <td class="tsm">${T.fmtDate(u.created_at)}</td>
    <td>${u.id!=='admin' ? `<div class="fca gap1"><button class="btn btn-sm btn-outline" onclick="editEmp('${u.id}')">Edit</button><button class="btn btn-sm btn-danger" onclick="promptDel('${u.id}','${u.name.replace(/'/g,"\\'")}')">Delete</button></div>` : '<span class="t3 tsm">Protected</span>'}</td>
  </tr>`).join('');
}

// ---- CREATE EMPLOYEE ----
async function createEmployee() {
  const id=document.getElementById('ne-id').value.trim();
  const name=document.getElementById('ne-name').value.trim();
  const pw=document.getElementById('ne-pw').value;
  const status=document.getElementById('ne-status').value;
  if (!id||!name||!pw) { showToast('All fields required','error'); return; }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) { showToast('ID: letters, numbers, _ and - only','error'); return; }
  const { error } = await db.from('users').insert({ id, name, password:pw, role:'employee', status });
  if (error) { showToast(error.code==='23505'?'Employee ID already exists':error.message,'error'); return; }
  showToast(`${name} created successfully ✓`,'success');
  closeModal('m-add-emp');
  ['ne-id','ne-name','ne-pw'].forEach(i => document.getElementById(i).value='');
  await loadEmployees(); renderEmpTable(); refreshOverview();
}

// ---- EDIT EMPLOYEE ----
async function editEmp(id) {
  const u = allEmployees.find(e=>e.id===id); if(!u) return;
  document.getElementById('ee-id').value=id;
  document.getElementById('ee-name').value=u.name;
  document.getElementById('ee-pw').value='';
  document.getElementById('ee-status').value=u.status;
  openModal('m-edit-emp');
}
async function saveEmployee() {
  const id=document.getElementById('ee-id').value;
  const name=document.getElementById('ee-name').value.trim();
  const pw=document.getElementById('ee-pw').value;
  const status=document.getElementById('ee-status').value;
  if (!name) { showToast('Name required','error'); return; }
  const upd = { name, status };
  if (pw) upd.password = pw;
  const { error } = await db.from('users').update(upd).eq('id',id);
  if (error) { showToast(error.message,'error'); return; }
  showToast('Employee updated ✓','success');
  closeModal('m-edit-emp');
  await loadEmployees(); renderEmpTable();
}

// ---- DELETE EMPLOYEE ----
function promptDel(id, name) {
  document.getElementById('del-id').value=id;
  document.getElementById('del-name').textContent=name;
  openModal('m-delete');
}
async function confirmDelete() {
  const id=document.getElementById('del-id').value;
  const { error } = await db.from('users').delete().eq('id',id);
  if (error) { showToast(error.message,'error'); return; }
  showToast('Employee deleted','success');
  closeModal('m-delete');
  await loadEmployees(); renderEmpTable(); refreshOverview();
}

// ---- LOAD TASK EMPLOYEE FILTER ----
async function loadTaskEmployeeFilter() {
  if (!allEmployees.length) await loadEmployees();
  const emps = allEmployees.filter(u=>u.role==='employee');
  const selIds = ['tf-employee','nt-assign','et-assign'];
  selIds.forEach(sid => {
    const sel = document.getElementById(sid); if(!sel) return;
    const base = sid==='tf-employee' ? '<option value="">All Employees</option>' : '<option value="">Select employee…</option>';
    sel.innerHTML = base + emps.map(e=>`<option value="${e.id}">${e.name}</option>`).join('');
  });
}

// ---- LOAD TASKS ----
async function loadTasks() {
  const empFilter = document.getElementById('tf-employee')?.value||'';
  const priFilter = document.getElementById('tf-priority')?.value||'';
  const search = (document.getElementById('tf-search')?.value||'').toLowerCase();

  let q = db.from('tasks').select('*').order('created_at',{ascending:false});
  if (empFilter) q = q.eq('assigned_to', empFilter);
  if (priFilter) q = q.eq('priority', priFilter);
  const { data: tasks } = await q;
  let filtered = (tasks||[]).filter(t => !search || t.title.toLowerCase().includes(search) || (t.description||'').toLowerCase().includes(search));

  // Kanban
  const stages = ['todo','inprogress','review','done'];
  stages.forEach(s => { document.getElementById('col-'+s).innerHTML=''; document.getElementById('cnt-'+s).textContent='0'; });
  const stageCounts = {todo:0,inprogress:0,review:0,done:0};

  for (const t of filtered) {
    const empName = (allEmployees.find(e=>e.id===t.assigned_to)||{}).name || t.assigned_to;
    const dlClass = deadlineClass(t.deadline);
    const card = document.createElement('div');
    card.className = 'task-card';
    card.innerHTML = `
      <div class="task-priority-strip strip-${t.priority}"></div>
      <div class="task-card-title">${t.title}</div>
      ${t.description ? `<p class="tsm t3" style="margin-bottom:.4rem;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${t.description}</p>` : ''}
      <div class="task-card-meta">
        <span class="task-card-assign">👤 ${empName}</span>
        ${t.deadline ? `<span class="task-deadline ${dlClass}">${deadlineText(t.deadline)}</span>` : ''}
      </div>
      <div class="fca gap1 mt1">${priorityBadge(t.priority)}</div>`;
    card.onclick = () => openTaskDetail(t.id);
    const col = document.getElementById('col-'+t.stage);
    if (col) { col.appendChild(card); stageCounts[t.stage]=(stageCounts[t.stage]||0)+1; }
  }

  stages.forEach(s => {
    const el = document.getElementById('cnt-'+s);
    if (el) el.textContent = stageCounts[s]||0;
    const col = document.getElementById('col-'+s);
    if (col && !col.children.length) col.innerHTML = `<div class="empty-col">✦<span>No tasks here</span></div>`;
  });

  // Table
  const tbody = document.getElementById('task-tbody');
  if (!filtered.length) { tbody.innerHTML='<tr><td colspan="6"><div class="empty-state"><div class="ei">📋</div><p>No tasks found</p></div></td></tr>'; return; }
  tbody.innerHTML = filtered.map(t => {
    const empName = (allEmployees.find(e=>e.id===t.assigned_to)||{}).name||t.assigned_to;
    const dlClass = deadlineClass(t.deadline);
    return `<tr>
      <td><strong>${t.title}</strong></td>
      <td>${empName}</td>
      <td>${priorityBadge(t.priority)}</td>
      <td>${stageBadge(t.stage)}</td>
      <td class="tsm ${dlClass}">${t.deadline ? deadlineText(t.deadline) : '—'}</td>
      <td><div class="fca gap1">
        <button class="btn btn-sm btn-outline" onclick="openEditTask('${t.id}')">Edit</button>
        <button class="btn btn-sm btn-ghost" onclick="openTaskDetail('${t.id}')">View</button>
        <button class="btn btn-sm btn-danger" onclick="deleteTask('${t.id}')">Del</button>
      </div></td>
    </tr>`;
  }).join('');
}

// ---- CREATE TASK ----
async function createTask() {
  const title=document.getElementById('nt-title').value.trim();
  const desc=document.getElementById('nt-desc').value.trim();
  const assignTo=document.getElementById('nt-assign').value;
  const priority=document.getElementById('nt-priority').value;
  const stage=document.getElementById('nt-stage').value;
  const deadline=document.getElementById('nt-deadline').value;
  if (!title||!assignTo) { showToast('Title and assigned employee are required','error'); return; }
  const session = Session.get();
  const { error } = await db.from('tasks').insert({
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    title, description:desc, assigned_to:assignTo, assigned_by:session.id,
    priority, stage, deadline: deadline ? new Date(deadline).toISOString() : null
  });
  if (error) { showToast(error.message,'error'); return; }
  showToast('Task created ✓','success');
  closeModal('m-add-task');
  ['nt-title','nt-desc'].forEach(i=>document.getElementById(i).value='');
  loadTasks();
}

// ---- EDIT TASK ----
async function openEditTask(id) {
  const { data: t } = await db.from('tasks').select('*').eq('id',id).single();
  if (!t) return;
  await loadTaskEmployeeFilter();
  document.getElementById('et-id').value=t.id;
  document.getElementById('et-title').value=t.title;
  document.getElementById('et-desc').value=t.description||'';
  document.getElementById('et-assign').value=t.assigned_to;
  document.getElementById('et-priority').value=t.priority;
  document.getElementById('et-stage').value=t.stage;
  document.getElementById('et-deadline').value=t.deadline ? new Date(t.deadline).toISOString().slice(0,16) : '';
  openModal('m-edit-task');
}
async function saveTask() {
  const id=document.getElementById('et-id').value;
  const title=document.getElementById('et-title').value.trim();
  const desc=document.getElementById('et-desc').value.trim();
  const assignTo=document.getElementById('et-assign').value;
  const priority=document.getElementById('et-priority').value;
  const stage=document.getElementById('et-stage').value;
  const deadline=document.getElementById('et-deadline').value;
  if (!title) { showToast('Title required','error'); return; }
  const { error } = await db.from('tasks').update({ title, description:desc, assigned_to:assignTo, priority, stage, deadline:deadline?new Date(deadline).toISOString():null, updated_at:T.now() }).eq('id',id);
  if (error) { showToast(error.message,'error'); return; }
  showToast('Task updated ✓','success');
  closeModal('m-edit-task');
  loadTasks();
}

// ---- DELETE TASK ----
async function deleteTask(id) {
  if (!confirm('Delete this task? This cannot be undone.')) return;
  await db.from('tasks').delete().eq('id',id);
  showToast('Task deleted','success');
  loadTasks();
}

// ---- TASK DETAIL ----
let detailTaskId = null;
async function openTaskDetail(id) {
  detailTaskId = id;
  const { data: t } = await db.from('tasks').select('*').eq('id',id).single();
  if (!t) return;
  const assignEmp = (allEmployees.find(e=>e.id===t.assigned_to)||{}).name||t.assigned_to;
  const assignBy = (allEmployees.find(e=>e.id===t.assigned_by)||{}).name||t.assigned_by;
  document.getElementById('td-id').value=id;
  document.getElementById('td-title').textContent=t.title;
  document.getElementById('td-desc').textContent=t.description||'No description';
  document.getElementById('td-assign').textContent=assignEmp;
  document.getElementById('td-by').textContent=assignBy;
  document.getElementById('td-priority').innerHTML=priorityBadge(t.priority);
  document.getElementById('td-stage').innerHTML=stageBadge(t.stage);
  document.getElementById('td-deadline').innerHTML=t.deadline?`<span class="${deadlineClass(t.deadline)}">${deadlineText(t.deadline)}</span>`:'—';
  document.getElementById('td-created').textContent=T.fmtDateTime(t.created_at);
  document.getElementById('td-stage-update').value=t.stage;
  await loadComments(id);
  openModal('m-task-detail');
}
async function loadComments(taskId) {
  const { data: comments } = await db.from('task_comments').select('*').eq('task_id',taskId).order('created_at');
  const list = document.getElementById('td-comments');
  if (!comments||!comments.length) { list.innerHTML='<div class="t3 tsm" style="text-align:center;padding:1rem">No comments yet</div>'; return; }
  list.innerHTML = comments.map(c => {
    const u = (allEmployees.find(e=>e.id===c.user_id)||{}).name||c.user_id;
    return `<div class="comment-item"><div><span class="comment-author">${u}</span><span class="comment-time">${T.fmtDateTime(c.created_at)}</span></div><div class="comment-text">${c.comment}</div></div>`;
  }).join('');
  list.scrollTop = list.scrollHeight;
}
async function addComment() {
  const input = document.getElementById('td-comment-input');
  const text = input.value.trim();
  if (!text||!detailTaskId) return;
  const session = Session.get();
  await db.from('task_comments').insert({ id:`cmt_${Date.now()}`, task_id:detailTaskId, user_id:session.id, comment:text });
  input.value='';
  await loadComments(detailTaskId);
}
async function updateTaskStage() {
  const id = document.getElementById('td-id').value;
  const stage = document.getElementById('td-stage-update').value;
  await db.from('tasks').update({ stage, updated_at:T.now() }).eq('id',id);
  document.getElementById('td-stage').innerHTML = stageBadge(stage);
  showToast('Stage updated ✓','success');
  loadTasks();
}

// Init
showSec('overview', document.querySelector('.nav-item'));
setInterval(()=>{ if(currentSection==='overview') refreshOverview(); }, 30000);
