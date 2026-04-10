// admin.js — Full featured version
if (!Session.requireAdmin()) throw new Error('Not authorized');
renderSidebarUser();
applyBranding();

const todayLabelEl = document.getElementById('today-label');
if (todayLabelEl) todayLabelEl.textContent = new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

let allEmployees   = [];
let currentSection = 'overview';
let selectedTasks  = new Set();
let editingEmpPhotoFile = null;  // holds File object for pending upload
let editingEmpCurrentPhoto = null; // holds current photo_url when editing

// ---- NAV ----
function showSec(name, btn) {
  document.querySelectorAll('main section').forEach(s => s.style.display='none');
  const sec = document.getElementById('sec-'+name);
  if (sec) sec.style.display='block';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (btn) btn.classList.add('active');
  currentSection = name;
  if (name==='overview')  refreshOverview();
  if (name==='employees') loadAndRenderEmployees();
  if (name==='tasks')     { loadTaskEmployeeFilter(); loadTasks(); }
  if (name==='leaves')    loadLeaves();
  if (name==='branding')  loadBrandingForm();
}

// ---- EMPLOYEES ----
async function loadEmployees() {
  try {
    const { data, error } = await db.from('users').select('*').order('created_at');
    if (error) throw error;
    allEmployees = data || [];
  } catch(e) { console.error('loadEmployees:', e); allEmployees = []; }
}

async function loadAndRenderEmployees() {
  await loadEmployees();
  renderEmpTable();
}

function renderEmpTable() {
  const q     = (document.getElementById('emp-search')?.value||'').toLowerCase();
  const list  = allEmployees.filter(u => !q || u.id.toLowerCase().includes(q) || u.name.toLowerCase().includes(q));
  const tbody = document.getElementById('emp-tbody');
  if (!tbody) return;
  if (!list.length) { tbody.innerHTML='<tr><td colspan="7"><div class="empty-state"><div class="ei">👤</div><p>No employees found</p></div></td></tr>'; return; }
  tbody.innerHTML = list.map(u => {
    const photoHTML = u.photo_url
      ? `<img src="${u.photo_url}" class="emp-photo-sm" alt="${u.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div class="sb-avatar" style="display:none;width:36px;height:36px;font-size:.85rem">${u.name.charAt(0).toUpperCase()}</div>`
      : `<div class="sb-avatar" style="width:36px;height:36px;font-size:.85rem">${u.name.charAt(0).toUpperCase()}</div>`;
    return `<tr>
      <td><div class="fca">${photoHTML}</div></td>
      <td class="mono">${u.id}</td>
      <td><strong>${u.name}</strong></td>
      <td><span class="badge ${u.role==='admin'?'b-online':'b-offline'}">${u.role}</span></td>
      <td><span class="badge ${u.status==='active'?'b-active':'b-disabled'}">${u.status}</span></td>
      <td class="tsm">${T.fmtDate(u.created_at)}</td>
      <td>${u.id!=='admin'
        ? `<div class="fca gap1"><button class="btn btn-sm btn-outline" onclick="editEmp('${u.id}')">Edit</button><button class="btn btn-sm btn-danger" onclick="promptDel('${u.id}','${u.name.replace(/'/g,"\\'")}')">Delete</button></div>`
        : '<span class="t3 tsm">Protected</span>'}</td>
    </tr>`;
  }).join('');
}

async function createEmployee() {
  const id=document.getElementById('ne-id')?.value.trim();
  const name=document.getElementById('ne-name')?.value.trim();
  const pw=document.getElementById('ne-pw')?.value;
  const status=document.getElementById('ne-status')?.value;
  if (!id||!name||!pw) { showToast('All fields required','error'); return; }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) { showToast('ID: letters, numbers, _ and - only','error'); return; }
  try {
    const { error } = await db.from('users').insert({id,name,password:pw,role:'employee',status});
    if (error) { showToast(error.code==='23505'?'Employee ID already exists':error.message,'error'); return; }
    showToast(`${name} created ✓`,'success');
    closeModal('m-add-emp');
    ['ne-id','ne-name','ne-pw'].forEach(i=>{const el=document.getElementById(i);if(el)el.value='';});
    await loadAndRenderEmployees(); refreshOverview();
  } catch(e) { showToast('Error: '+e.message,'error'); }
}

async function editEmp(id) {
  const u = allEmployees.find(e=>e.id===id); if(!u) return;
  editingEmpPhotoFile    = null;
  editingEmpCurrentPhoto = u.photo_url || null;
  document.getElementById('ee-id').value     = id;
  document.getElementById('ee-name').value   = u.name;
  document.getElementById('ee-pw').value     = '';
  document.getElementById('ee-status').value = u.status;
  // Show current photo
  const preview = document.getElementById('ee-photo-preview');
  if (preview) {
    if (u.photo_url) {
      preview.outerHTML = `<img id="ee-photo-preview" src="${u.photo_url}" class="photo-preview" alt="${u.name}" onerror="this.src=''"/>`;
    } else {
      preview.className = 'emp-photo-placeholder';
      preview.textContent = u.name.charAt(0).toUpperCase();
    }
  }
  openModal('m-edit-emp');
}

function previewEmpPhoto(input) {
  if (!input.files||!input.files[0]) return;
  const file = input.files[0];
  if (file.size > 2*1024*1024) { showToast('Photo must be under 2MB','error'); input.value=''; return; }
  editingEmpPhotoFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('ee-photo-preview');
    if (preview) {
      const img = document.createElement('img');
      img.id = 'ee-photo-preview';
      img.src = e.target.result;
      img.className = 'photo-preview';
      preview.replaceWith(img);
    }
  };
  reader.readAsDataURL(file);
}

function removeEmpPhoto() {
  editingEmpPhotoFile    = null;
  editingEmpCurrentPhoto = null;
  const preview = document.getElementById('ee-photo-preview');
  if (preview) {
    const placeholder = document.createElement('div');
    placeholder.id = 'ee-photo-preview';
    placeholder.className = 'emp-photo-placeholder';
    placeholder.textContent = '👤';
    preview.replaceWith(placeholder);
  }
}

async function saveEmployee() {
  const id     = document.getElementById('ee-id')?.value;
  const name   = document.getElementById('ee-name')?.value.trim();
  const pw     = document.getElementById('ee-pw')?.value;
  const status = document.getElementById('ee-status')?.value;
  if (!name) { showToast('Name required','error'); return; }

  let photoUrl = editingEmpCurrentPhoto; // keep existing unless changed

  // Upload new photo if selected
  if (editingEmpPhotoFile) {
    try {
      const ext  = editingEmpPhotoFile.name.split('.').pop();
      const path = `${id}_${Date.now()}.${ext}`;
      const { error: upErr } = await db.storage.from('avatars').upload(path, editingEmpPhotoFile, { upsert:true });
      if (upErr) throw upErr;
      const { data: urlData } = db.storage.from('avatars').getPublicUrl(path);
      photoUrl = urlData.publicUrl;
    } catch(e) { showToast('Photo upload failed: '+e.message,'warning'); }
  } else if (editingEmpCurrentPhoto === null) {
    photoUrl = null; // explicitly removed
  }

  const upd = { name, status, photo_url: photoUrl };
  if (pw) upd.password = pw;
  try {
    const { error } = await db.from('users').update(upd).eq('id',id);
    if (error) { showToast(error.message,'error'); return; }
    showToast('Employee updated ✓','success');
    closeModal('m-edit-emp');
    editingEmpPhotoFile = null;
    await loadAndRenderEmployees();
    renderSidebarUser(); // refresh avatar if editing self
  } catch(e) { showToast('Error: '+e.message,'error'); }
}

function promptDel(id,name) {
  document.getElementById('del-id').value=id;
  document.getElementById('del-name').textContent=name;
  openModal('m-delete');
}
async function confirmDelete() {
  const id=document.getElementById('del-id')?.value; if(!id) return;
  try {
    const { error } = await db.from('users').delete().eq('id',id);
    if (error) { showToast(error.message,'error'); return; }
    showToast('Employee deleted','success');
    closeModal('m-delete');
    await loadAndRenderEmployees(); refreshOverview();
  } catch(e) { showToast('Error: '+e.message,'error'); }
}

// ---- OVERVIEW ----
async function refreshOverview() {
  try {
    await loadEmployees();
    const emps  = allEmployees.filter(u=>u.role==='employee');
    const today = T.todayKey();
    const [{ data:recs }, { data:openBreaks }, { data:pendingLeaves }, settings] = await Promise.all([
      db.from('attendance').select('*').eq('date_key',today),
      db.from('breaks').select('*').eq('date_key',today).is('end_time',null),
      db.from('leaves').select('id').eq('status','pending'),
      getSettings()
    ]);

    let online=0, onBreak=0;
    // Per-emp task counts
    const empIds = emps.map(e=>e.id);
    const taskData = empIds.length ? (await db.from('tasks').select('assigned_to').in('assigned_to',empIds).in('stage',['todo','inprogress','review'])).data || [] : [];
    const taskCounts = {};
    taskData.forEach(t=>{ taskCounts[t.assigned_to]=(taskCounts[t.assigned_to]||0)+1; });

    const rows = emps.map(emp => {
      const rec    = (recs||[]).find(r=>r.user_id===emp.id);
      const status = rec ? rec.status : 'offline';
      if (status==='online') online++;
      if (status==='break')  onBreak++;
      let workSec=0, breakSec=0;
      if (rec) {
        breakSec = rec.total_break_sec||0;
        if (status==='break') { const ob=(openBreaks||[]).find(b=>b.user_id===emp.id); if(ob) breakSec+=T.diff(ob.start_time,T.now()); }
        if (status==='offline'&&rec.working_sec) { workSec=rec.working_sec; breakSec=rec.total_break_sec||0; }
        else if (rec.online_time&&status!=='offline') workSec=Math.max(0,T.diff(rec.online_time,T.now())-breakSec);
      }
      const score      = rec ? (rec.score!==null&&rec.score!==undefined ? rec.score : calcScoreSync(breakSec,settings)) : settings.daily_score;
      const scoreColor = score>=settings.daily_score ? 'var(--green)' : 'var(--red)';
      const photoHTML  = emp.photo_url ? `<img src="${emp.photo_url}" class="emp-photo-sm" alt="" style="margin-right:.5rem" onerror="this.style.display='none'"/>` : '';
      return `<tr>
        <td><div class="fca gap1">${photoHTML}<div><strong>${emp.name}</strong><br><span class="tsm t3 mono">${emp.id}</span></div></div></td>
        <td>${statusBadge(status)}</td>
        <td class="mono">${rec&&rec.online_time?T.fmtTime(rec.online_time):'--'}</td>
        <td class="mono">${T.fmt(workSec)}</td>
        <td class="mono">${T.fmt(breakSec)}</td>
        <td><span class="mono" style="font-weight:700;color:${scoreColor}">${score}</span></td>
        <td><span class="badge b-todo">${taskCounts[emp.id]||0} open</span></td>
      </tr>`;
    });

    const pendingCount = (pendingLeaves||[]).length;
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    set('st-total',emps.length); set('st-online',online); set('st-break',onBreak); set('st-leaves',pendingCount);
    const lbadge = document.getElementById('leave-badge');
    if (lbadge) { lbadge.textContent=pendingCount; lbadge.style.display=pendingCount>0?'inline':'none'; }
    const tbody = document.getElementById('live-tbody');
    if (tbody) tbody.innerHTML = rows.join('')||'<tr><td colspan="7"><div class="empty-state"><div class="ei">👥</div><p>No employees yet</p></div></td></tr>';
  } catch(e) { console.error('refreshOverview:',e); showToast('Failed to refresh','error'); }
}

// ---- TASKS ----
async function loadTaskEmployeeFilter() {
  if (!allEmployees.length) await loadEmployees();
  const emps = allEmployees.filter(u=>u.role==='employee');
  const opts = emps.map(e=>`<option value="${e.id}">${e.name}</option>`).join('');
  ['tf-employee','nt-assign','et-assign'].forEach(sid=>{
    const sel=document.getElementById(sid); if(!sel) return;
    const base = sid==='tf-employee' ? '<option value="">All Employees</option>' : '<option value="">Select employee…</option>';
    sel.innerHTML = base+opts;
  });
}

async function loadTasks() {
  try {
    if (!allEmployees.length) await loadEmployees();
    const empFilter = document.getElementById('tf-employee')?.value||'';
    const priFilter = document.getElementById('tf-priority')?.value||'';
    const search    = (document.getElementById('tf-search')?.value||'').toLowerCase();
    let query = db.from('tasks').select('*').order('created_at',{ascending:false});
    if (empFilter) query=query.eq('assigned_to',empFilter);
    if (priFilter) query=query.eq('priority',priFilter);
    const { data:tasks, error } = await query;
    if (error) throw error;
    const filtered = (tasks||[]).filter(t=>!search||t.title.toLowerCase().includes(search)||(t.description||'').toLowerCase().includes(search));

    // Kanban
    const stages=['todo','inprogress','review','done'];
    const sCounts={todo:0,inprogress:0,review:0,done:0};
    stages.forEach(s=>{
      const col=document.getElementById('col-'+s); if(col) col.innerHTML='';
      const cnt=document.getElementById('cnt-'+s);  if(cnt) cnt.textContent='0';
    });
    for (const t of filtered) {
      sCounts[t.stage]=(sCounts[t.stage]||0)+1;
      const empName=(allEmployees.find(e=>e.id===t.assigned_to)||{}).name||t.assigned_to;
      const card=document.createElement('div');
      card.className='task-card'+(selectedTasks.has(t.id)?' selected':'');
      card.dataset.taskId=t.id;
      card.innerHTML=`
        <div class="task-priority-strip strip-${t.priority}"></div>
        <div class="task-card-title">${t.title}</div>
        ${t.description?`<p class="tsm t3" style="margin-bottom:.4rem;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${t.description}</p>`:''}
        <div class="task-card-meta"><span class="task-card-assign">👤 ${empName}</span>${t.deadline?`<span class="task-deadline ${deadlineClass(t.deadline)}">${deadlineText(t.deadline)}</span>`:''}</div>
        <div class="fca gap1 mt1">${priorityBadge(t.priority)}</div>`;
      card.onclick=()=>openTaskDetail(t.id);
      const col=document.getElementById('col-'+t.stage);
      if(col) col.appendChild(card);
    }
    stages.forEach(s=>{
      const cnt=document.getElementById('cnt-'+s); if(cnt) cnt.textContent=sCounts[s]||0;
      const col=document.getElementById('col-'+s); if(col&&!col.children.length) col.innerHTML='<div class="empty-col">✦<span>No tasks here</span></div>';
    });

    // Table
    const tbody=document.getElementById('task-tbody'); if(!tbody) return;
    if (!filtered.length) { tbody.innerHTML='<tr><td colspan="7"><div class="empty-state"><div class="ei">📋</div><p>No tasks found</p></div></td></tr>'; return; }
    tbody.innerHTML=filtered.map(t=>{
      const empName=(allEmployees.find(e=>e.id===t.assigned_to)||{}).name||t.assigned_to;
      const checked=selectedTasks.has(t.id)?'checked':'';
      return `<tr>
        <td class="cb-cell"><input type="checkbox" ${checked} onchange="toggleTaskSelect('${t.id}',this.checked)" onclick="event.stopPropagation()"/></td>
        <td><strong>${t.title}</strong></td>
        <td>${empName}</td>
        <td>${priorityBadge(t.priority)}</td>
        <td>${stageBadge(t.stage)}</td>
        <td class="tsm ${deadlineClass(t.deadline)}">${t.deadline?deadlineText(t.deadline):'—'}</td>
        <td><div class="fca gap1">
          <button class="btn btn-sm btn-outline" onclick="openEditTask('${t.id}')">Edit</button>
          <button class="btn btn-sm btn-ghost"   onclick="openTaskDetail('${t.id}')">View</button>
          <button class="btn btn-sm btn-danger"  onclick="deleteSingleTask('${t.id}')">Del</button>
        </div></td>
      </tr>`;
    }).join('');
    updateBulkBar();
  } catch(e) { console.error('loadTasks:',e); showToast('Error loading tasks','error'); }
}

// ---- TASK SELECTION (BULK) ----
function toggleTaskSelect(id, checked) {
  if (checked) selectedTasks.add(id); else selectedTasks.delete(id);
  updateBulkBar();
}
function updateBulkBar() {
  const bar  = document.getElementById('task-bulk-bar');
  const info = document.getElementById('bulk-info');
  if (!bar||!info) return;
  if (selectedTasks.size > 0) { bar.classList.add('show'); info.textContent=`${selectedTasks.size} task${selectedTasks.size>1?'s':''} selected`; }
  else bar.classList.remove('show');
}
function toggleSelectAllTasks(cb) {
  const checkboxes = document.querySelectorAll('#task-tbody input[type=checkbox]');
  checkboxes.forEach(c => { c.checked=cb.checked; const id=c.closest('tr')?.querySelector('[onclick*="openEditTask"]')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1]; if(id){ if(cb.checked) selectedTasks.add(id); else selectedTasks.delete(id); } });
  // simpler: re-read from DOM
  selectedTasks.clear();
  if (cb.checked) {
    document.querySelectorAll('#task-tbody input[type=checkbox]').forEach(c => {
      c.checked=true;
      // get task id from sibling button
      const delBtn = c.closest('tr')?.querySelector('button.btn-danger');
      if (delBtn) { const m=delBtn.getAttribute('onclick')?.match(/'([^']+)'/); if(m) selectedTasks.add(m[1]); }
    });
  }
  updateBulkBar();
}
function clearTaskSelection() {
  selectedTasks.clear();
  document.querySelectorAll('#task-tbody input[type=checkbox]').forEach(c=>c.checked=false);
  const sa=document.getElementById('select-all-tasks'); if(sa) sa.checked=false;
  updateBulkBar();
}
async function bulkDeleteTasks() {
  if (selectedTasks.size===0) return;
  if (!confirm(`Delete ${selectedTasks.size} selected task(s)? This cannot be undone.`)) return;
  try {
    const ids = [...selectedTasks];
    const { error } = await db.from('tasks').delete().in('id',ids);
    if (error) { showToast(error.message,'error'); return; }
    showToast(`${ids.length} tasks deleted`,'success');
    selectedTasks.clear();
    loadTasks();
  } catch(e) { showToast('Error deleting tasks','error'); }
}
async function deleteSingleTask(id) {
  if (!confirm('Delete this task?')) return;
  try {
    await db.from('tasks').delete().eq('id',id);
    showToast('Task deleted','success');
    selectedTasks.delete(id);
    loadTasks();
  } catch(e) { showToast('Error deleting task','error'); }
}

async function createTask() {
  const title=document.getElementById('nt-title')?.value.trim();
  const desc=document.getElementById('nt-desc')?.value.trim();
  const assignTo=document.getElementById('nt-assign')?.value;
  const priority=document.getElementById('nt-priority')?.value;
  const stage=document.getElementById('nt-stage')?.value;
  const deadline=document.getElementById('nt-deadline')?.value;
  if (!title||!assignTo) { showToast('Title and assigned employee required','error'); return; }
  const sess=Session.get();
  try {
    const { error }=await db.from('tasks').insert({ id:`task_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,title,description:desc,assigned_to:assignTo,assigned_by:sess.id,priority,stage,deadline:deadline?new Date(deadline).toISOString():null });
    if (error) { showToast(error.message,'error'); return; }
    showToast('Task created ✓','success');
    closeModal('m-add-task');
    ['nt-title','nt-desc'].forEach(i=>{const el=document.getElementById(i);if(el)el.value='';});
    loadTasks();
  } catch(e) { showToast('Error: '+e.message,'error'); }
}

async function openEditTask(id) {
  try {
    const { data:t }=await db.from('tasks').select('*').eq('id',id).single(); if(!t) return;
    await loadTaskEmployeeFilter();
    const sv=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;};
    sv('et-id',t.id); sv('et-title',t.title); sv('et-desc',t.description||'');
    sv('et-assign',t.assigned_to); sv('et-priority',t.priority); sv('et-stage',t.stage);
    sv('et-deadline',t.deadline?new Date(t.deadline).toISOString().slice(0,16):'');
    openModal('m-edit-task');
  } catch(e) { showToast('Could not load task','error'); }
}
async function saveTask() {
  const id=document.getElementById('et-id')?.value;
  const title=document.getElementById('et-title')?.value.trim();
  const desc=document.getElementById('et-desc')?.value.trim();
  const assignTo=document.getElementById('et-assign')?.value;
  const priority=document.getElementById('et-priority')?.value;
  const stage=document.getElementById('et-stage')?.value;
  const deadline=document.getElementById('et-deadline')?.value;
  if (!title) { showToast('Title required','error'); return; }
  try {
    const { error }=await db.from('tasks').update({title,description:desc,assigned_to:assignTo,priority,stage,deadline:deadline?new Date(deadline).toISOString():null,updated_at:T.now()}).eq('id',id);
    if (error) { showToast(error.message,'error'); return; }
    showToast('Task updated ✓','success'); closeModal('m-edit-task'); loadTasks();
  } catch(e) { showToast('Error: '+e.message,'error'); }
}

// ---- TASK DETAIL + ATTACHMENTS ----
let detailTaskId=null;
async function openTaskDetail(id) {
  detailTaskId=id;
  try {
    const { data:t }=await db.from('tasks').select('*').eq('id',id).single(); if(!t) return;
    const assignEmp=(allEmployees.find(e=>e.id===t.assigned_to)||{}).name||t.assigned_to;
    const assignBy=(allEmployees.find(e=>e.id===t.assigned_by)||{}).name||t.assigned_by;
    const sv=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;};
    const st=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    const sh=(id,v)=>{const el=document.getElementById(id);if(el)el.innerHTML=v;};
    sv('td-id',id); st('td-title',t.title); st('td-desc',t.description||'No description');
    st('td-assign',assignEmp); st('td-by',assignBy); st('td-created',T.fmtDateTime(t.created_at));
    sh('td-priority',priorityBadge(t.priority)); sh('td-stage',stageBadge(t.stage));
    sh('td-deadline',t.deadline?`<span class="${deadlineClass(t.deadline)}">${deadlineText(t.deadline)}</span>`:'—');
    sv('td-stage-update',t.stage);
    await loadTaskAttachments(id);
    await loadComments(id);
    openModal('m-task-detail');
  } catch(e) { showToast('Could not load task','error'); console.error(e); }
}

async function loadTaskAttachments(taskId) {
  const list=document.getElementById('td-attachments'); if(!list) return;
  try {
    const { data:atts }=await db.from('task_attachments').select('*').eq('task_id',taskId).order('created_at');
    if (!atts||!atts.length) { list.innerHTML='<p class="tsm t3 mb1">No attachments yet</p>'; return; }
    list.innerHTML=atts.map(a=>`
      <div class="attach-item">
        <div class="attach-item-info">
          <span class="attach-icon">${fileIcon(a.file_type)}</span>
          <div><div class="attach-name">${a.file_name}</div><div class="attach-size">${fmtFileSize(a.file_size)}</div></div>
        </div>
        <div class="fca gap1">
          <a href="${a.file_url}" target="_blank" class="btn btn-sm btn-outline">↗ Open</a>
          <button class="btn btn-sm btn-danger" onclick="deleteAttachment('${a.id}','${taskId}')">✕</button>
        </div>
      </div>`).join('');
  } catch(e) { console.error('loadTaskAttachments:',e); }
}

async function uploadAttachments(input) {
  if (!input.files||!input.files.length||!detailTaskId) return;
  const sess=Session.get();
  const files=[...input.files];
  let uploaded=0;
  for (const file of files) {
    if (file.size>10*1024*1024) { showToast(`${file.name} exceeds 10MB limit`,'warning'); continue; }
    try {
      const path=`${detailTaskId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
      const { error:upErr }=await db.storage.from('task-files').upload(path,file,{upsert:false});
      if (upErr) throw upErr;
      const { data:urlData }=db.storage.from('task-files').getPublicUrl(path);
      await db.from('task_attachments').insert({ id:`att_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,task_id:detailTaskId,user_id:sess.id,file_name:file.name,file_url:urlData.publicUrl,file_type:file.type||'application/octet-stream',file_size:file.size });
      uploaded++;
    } catch(e) { showToast(`Failed to upload ${file.name}: ${e.message}`,'error'); }
  }
  if (uploaded>0) { showToast(`${uploaded} file${uploaded>1?'s':''} uploaded ✓`,'success'); await loadTaskAttachments(detailTaskId); }
  input.value='';
}

async function deleteAttachment(attId, taskId) {
  if (!confirm('Remove this attachment?')) return;
  try {
    await db.from('task_attachments').delete().eq('id',attId);
    showToast('Attachment removed','success');
    await loadTaskAttachments(taskId);
  } catch(e) { showToast('Error removing attachment','error'); }
}

async function loadComments(taskId) {
  const list=document.getElementById('td-comments'); if(!list) return;
  try {
    const { data:comments }=await db.from('task_comments').select('*').eq('task_id',taskId).order('created_at');
    if (!comments||!comments.length) { list.innerHTML='<div class="t3 tsm" style="text-align:center;padding:1rem">No comments yet</div>'; return; }
    list.innerHTML=comments.map(c=>{ const u=(allEmployees.find(e=>e.id===c.user_id)||{}).name||c.user_id; return `<div class="comment-item"><div><span class="comment-author">${u}</span><span class="comment-time">${T.fmtDateTime(c.created_at)}</span></div><div class="comment-text">${c.comment}</div></div>`; }).join('');
    list.scrollTop=list.scrollHeight;
  } catch(e) { console.error('loadComments:',e); }
}
async function addComment() {
  const input=document.getElementById('td-comment-input');
  const text=input?input.value.trim():''; if(!text||!detailTaskId) return;
  const sess=Session.get();
  try {
    await db.from('task_comments').insert({id:`cmt_${Date.now()}`,task_id:detailTaskId,user_id:sess.id,comment:text});
    if(input) input.value='';
    await loadComments(detailTaskId);
  } catch(e) { showToast('Could not post comment','error'); }
}
async function updateTaskStage() {
  const id=document.getElementById('td-id')?.value;
  const stage=document.getElementById('td-stage-update')?.value;
  if(!id||!stage) return;
  try {
    await db.from('tasks').update({stage,updated_at:T.now()}).eq('id',id);
    const el=document.getElementById('td-stage'); if(el) el.innerHTML=stageBadge(stage);
    showToast('Stage updated ✓','success'); loadTasks();
  } catch(e) { showToast('Error updating stage','error'); }
}

// ---- LEAVES ----
async function loadLeaves() {
  const filter = document.getElementById('leave-filter')?.value||'pending';
  const list   = document.getElementById('leaves-list'); if(!list) return;
  list.innerHTML='<div class="loading"><div class="spinner"></div></div>';
  try {
    let query = db.from('leaves').select('*').order('applied_at',{ascending:false});
    if (filter!=='all') query=query.eq('status',filter);
    const { data:leaves, error }=await query;
    if (error) throw error;
    if (!allEmployees.length) await loadEmployees();

    // Update badge
    const pending=(leaves||[]).filter(l=>l.status==='pending').length;
    const lbadge=document.getElementById('leave-badge');
    if(lbadge){ lbadge.textContent=pending; lbadge.style.display=pending>0?'inline':'none'; }

    if (!leaves||!leaves.length) { list.innerHTML='<div class="empty-state"><div class="ei">🗓</div><p>No leave requests found</p></div>'; return; }

    list.innerHTML=leaves.map(l=>{
      const emp=(allEmployees.find(e=>e.id===l.user_id)||{}).name||l.user_id;
      const dates=JSON.parse(l.dates||'[]');
      const noteClass=l.status==='approved'?'approved-note':l.status==='rejected'?'rejected-note':'';
      return `<div class="leave-card">
        <div class="leave-card-head">
          <div class="fca gap2">
            <strong>${emp}</strong>
            <span class="badge ${l.leave_type==='half'?'b-p-medium':'b-p-high'}">${l.leave_type==='half'?'Half Day':'Full Day'}</span>
            ${leaveBadge(l.status)}
          </div>
          <span class="tsm t3 mono">${T.fmtDateTime(l.applied_at)}</span>
        </div>
        <div class="leave-dates">${dates.map(d=>`<span class="leave-date-tag">${d}</span>`).join('')}</div>
        <p class="leave-reason">"${l.reason}"</p>
        ${l.admin_note?`<div class="leave-admin-note ${noteClass}">📝 ${l.admin_note}</div>`:''}
        ${l.status==='pending'?`<div class="leave-actions">
          <button class="btn btn-success btn-sm" onclick="quickReview('${l.id}','approved')">✓ Approve</button>
          <button class="btn btn-danger btn-sm" onclick="quickReview('${l.id}','rejected')">✕ Reject</button>
          <button class="btn btn-outline btn-sm" onclick="openReviewModal('${l.id}')">📝 Review with Note</button>
        </div>`:''}
      </div>`;
    }).join('');
  } catch(e) { console.error('loadLeaves:',e); list.innerHTML='<div class="empty-state"><div class="ei">⚠️</div><p>Error loading leaves</p></div>'; }
}

async function quickReview(id, status) {
  const sess=Session.get();
  try {
    await db.from('leaves').update({status,reviewed_at:T.now(),reviewed_by:sess.id,admin_note:''}).eq('id',id);
    showToast(`Leave ${status} ✓`,status==='approved'?'success':'warning');
    loadLeaves();
  } catch(e) { showToast('Error updating leave','error'); }
}

async function openReviewModal(id) {
  try {
    const { data:l }=await db.from('leaves').select('*').eq('id',id).single(); if(!l) return;
    const emp=(allEmployees.find(e=>e.id===l.user_id)||{}).name||l.user_id;
    const dates=JSON.parse(l.dates||'[]');
    document.getElementById('rl-id').value=id;
    document.getElementById('rl-emp').textContent=emp;
    document.getElementById('rl-type').innerHTML=`<span class="badge ${l.leave_type==='half'?'b-p-medium':'b-p-high'}">${l.leave_type==='half'?'Half Day':'Full Day'}</span>`;
    document.getElementById('rl-dates').innerHTML=dates.map(d=>`<span class="leave-date-tag">${d}</span>`).join('');
    document.getElementById('rl-reason').textContent=l.reason;
    document.getElementById('rl-note').value=l.admin_note||'';
    openModal('m-review-leave');
  } catch(e) { showToast('Could not load leave','error'); }
}
async function reviewLeave(status) {
  const id=document.getElementById('rl-id')?.value;
  const note=document.getElementById('rl-note')?.value.trim()||'';
  const sess=Session.get();
  try {
    await db.from('leaves').update({status,reviewed_at:T.now(),reviewed_by:sess.id,admin_note:note}).eq('id',id);
    showToast(`Leave ${status} ✓`,status==='approved'?'success':'warning');
    closeModal('m-review-leave'); loadLeaves();
  } catch(e) { showToast('Error updating leave','error'); }
}

// ---- BRANDING ----
let _logoFileForUpload=null;
let _removeLogoFlag=false;

async function loadBrandingForm() {
  _logoFileForUpload=null; _removeLogoFlag=false;
  const b=await getBranding();
  const nameEl=document.getElementById('brand-name'); if(nameEl) nameEl.value=b.app_name||'WorkTrack';
  const preview=document.getElementById('logo-preview');
  if (preview) {
    if (b.logo_url) preview.innerHTML=`<img src="${b.logo_url}" alt="logo" style="width:100%;height:100%;object-fit:cover;border-radius:var(--r2)"/>`;
    else preview.innerHTML='⏱';
  }
}

function previewLogo(input) {
  if (!input.files||!input.files[0]) return;
  const file=input.files[0];
  if (file.size>2*1024*1024) { showToast('Logo must be under 2MB','error'); input.value=''; return; }
  _logoFileForUpload=file; _removeLogoFlag=false;
  const reader=new FileReader();
  reader.onload=e=>{
    const preview=document.getElementById('logo-preview');
    if(preview) preview.innerHTML=`<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--r2)"/>`;
  };
  reader.readAsDataURL(file);
}

function removeLogo() {
  _logoFileForUpload=null; _removeLogoFlag=true;
  const preview=document.getElementById('logo-preview'); if(preview) preview.innerHTML='⏱';
}

async function saveBranding() {
  const name=document.getElementById('brand-name')?.value.trim()||'WorkTrack';
  let logoUrl=(await getBranding()).logo_url||null;
  if (_removeLogoFlag) logoUrl=null;
  if (_logoFileForUpload) {
    try {
      const ext=_logoFileForUpload.name.split('.').pop();
      const path=`logo_${Date.now()}.${ext}`;
      const { error:upErr }=await db.storage.from('branding').upload(path,_logoFileForUpload,{upsert:true});
      if (upErr) throw upErr;
      const { data:urlData }=db.storage.from('branding').getPublicUrl(path);
      logoUrl=urlData.publicUrl;
    } catch(e) { showToast('Logo upload failed: '+e.message,'warning'); }
  }
  try {
    await db.from('branding').upsert({id:1,app_name:name,logo_url:logoUrl});
    clearBrandingCache();
    showToast('Branding saved ✓ — refresh to see changes','success');
    _logoFileForUpload=null; _removeLogoFlag=false;
    applyBranding();
  } catch(e) { showToast('Error saving branding','error'); }
}

// ---- INIT ----
const firstNav=document.querySelector('.nav-item');
showSec('overview',firstNav);
setInterval(()=>{ if(currentSection==='overview') refreshOverview(); },30000);
