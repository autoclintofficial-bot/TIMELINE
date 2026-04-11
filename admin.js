// admin.js — Full featured
if (!Session.requireAdmin()) throw new Error('Not authorized');
renderSidebarUser();
applyBranding();

const todayLabelEl=document.getElementById('today-label');
if(todayLabelEl) todayLabelEl.textContent=new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});

let allEmployees=[], currentSection='overview', selectedTasks=new Set();
let editingEmpPhotoFile=null, editingEmpCurrentPhoto=null;
let _logoFileForUpload=null, _removeLogoFlag=false;
let adminLeaveCalYear=0, adminLeaveCalMonth=0;

// ══════════════════════════════════
//  NAV
// ══════════════════════════════════
function showSec(name, btn) {
  document.querySelectorAll('main section').forEach(s=>s.style.display='none');
  const sec=document.getElementById('sec-'+name); if(sec) sec.style.display='block';
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  if(btn) btn.classList.add('active');
  currentSection=name;
  if(name==='overview')   refreshOverview();
  if(name==='employees')  loadAndRenderEmployees();
  if(name==='tasks')      { loadTaskEmployeeFilter(); loadTasks(); }
  if(name==='leaves')     loadLeaves();
  if(name==='incentives') { loadAdminEmpFilter(); loadAdminIncentives(); }
  if(name==='branding')   loadBrandingForm();
}

// ══════════════════════════════════
//  EMPLOYEES
// ══════════════════════════════════
async function loadEmployees() {
  try { const { data }=await db.from('users').select('*').order('created_at'); allEmployees=data||[]; }
  catch(e){ console.error(e); allEmployees=[]; }
}
async function loadAndRenderEmployees(){ await loadEmployees(); renderEmpTable(); }

function renderEmpTable() {
  const q=(document.getElementById('emp-search')?.value||'').toLowerCase();
  const list=allEmployees.filter(u=>!q||u.id.toLowerCase().includes(q)||u.name.toLowerCase().includes(q));
  const tbody=document.getElementById('emp-tbody'); if(!tbody) return;
  if(!list.length){ tbody.innerHTML='<tr><td colspan="7"><div class="empty-state"><div class="ei">👤</div><p>No employees found</p></div></td></tr>'; return; }
  tbody.innerHTML=list.map(u=>{
    const ph=u.photo_url?`<img src="${u.photo_url}" class="emp-photo-sm" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div class="sb-avatar" style="display:none;width:36px;height:36px;font-size:.85rem">${u.name.charAt(0).toUpperCase()}</div>`:`<div class="sb-avatar" style="width:36px;height:36px;font-size:.85rem">${u.name.charAt(0).toUpperCase()}</div>`;
    return `<tr><td><div class="fca">${ph}</div></td><td class="mono">${u.id}</td><td><strong>${u.name}</strong></td><td><span class="badge ${u.role==='admin'?'b-online':'b-offline'}">${u.role}</span></td><td><span class="badge ${u.status==='active'?'b-active':'b-disabled'}">${u.status}</span></td><td class="tsm">${T.fmtDate(u.created_at)}</td><td>${u.id!=='admin'?`<div class="fca gap1"><button class="btn btn-sm btn-outline" onclick="editEmp('${u.id}')">Edit</button><button class="btn btn-sm btn-danger" onclick="promptDel('${u.id}','${u.name.replace(/'/g,"\\'")}')">Delete</button></div>`:'<span class="t3 tsm">Protected</span>'}</td></tr>`;
  }).join('');
}

async function createEmployee(){
  const id=document.getElementById('ne-id')?.value.trim(), name=document.getElementById('ne-name')?.value.trim(), pw=document.getElementById('ne-pw')?.value, status=document.getElementById('ne-status')?.value;
  if(!id||!name||!pw){ showToast('All fields required','error'); return; }
  if(!/^[a-zA-Z0-9_-]+$/.test(id)){ showToast('ID: letters, numbers, _ and - only','error'); return; }
  try { const { error }=await db.from('users').insert({id,name,password:pw,role:'employee',status}); if(error){ showToast(error.code==='23505'?'ID already exists':error.message,'error'); return; } showToast(`${name} created ✓`,'success'); closeModal('m-add-emp'); ['ne-id','ne-name','ne-pw'].forEach(i=>{const el=document.getElementById(i);if(el)el.value=''}); await loadAndRenderEmployees(); refreshOverview(); }
  catch(e){ showToast('Error: '+e.message,'error'); }
}

async function editEmp(id){
  const u=allEmployees.find(e=>e.id===id); if(!u) return;
  editingEmpPhotoFile=null; editingEmpCurrentPhoto=u.photo_url||null;
  document.getElementById('ee-id').value=id; document.getElementById('ee-name').value=u.name; document.getElementById('ee-pw').value=''; document.getElementById('ee-status').value=u.status;
  const preview=document.getElementById('ee-photo-preview');
  if(preview){
    if(u.photo_url){ const img=document.createElement('img'); img.id='ee-photo-preview'; img.src=u.photo_url; img.className='photo-preview'; img.onerror=()=>{}; preview.replaceWith(img); }
    else { preview.className='emp-photo-placeholder'; preview.textContent=u.name.charAt(0).toUpperCase(); }
  }
  openModal('m-edit-emp');
}

function previewEmpPhoto(input){
  if(!input.files||!input.files[0]) return;
  const file=input.files[0];
  if(file.size>2*1024*1024){ showToast('Photo must be under 2MB','error'); input.value=''; return; }
  editingEmpPhotoFile=file;
  const reader=new FileReader(); reader.onload=e=>{ const preview=document.getElementById('ee-photo-preview'); if(preview){ const img=document.createElement('img'); img.id='ee-photo-preview'; img.src=e.target.result; img.className='photo-preview'; preview.replaceWith(img); } }; reader.readAsDataURL(file);
}

function removeEmpPhoto(){
  editingEmpPhotoFile=null; editingEmpCurrentPhoto=null;
  const preview=document.getElementById('ee-photo-preview'); if(preview){ const ph=document.createElement('div'); ph.id='ee-photo-preview'; ph.className='emp-photo-placeholder'; ph.textContent='👤'; preview.replaceWith(ph); }
}

async function saveEmployee(){
  const id=document.getElementById('ee-id')?.value, name=document.getElementById('ee-name')?.value.trim(), pw=document.getElementById('ee-pw')?.value, status=document.getElementById('ee-status')?.value;
  if(!name){ showToast('Name required','error'); return; }
  let photoUrl=editingEmpCurrentPhoto;
  if(editingEmpPhotoFile){ try{ const ext=editingEmpPhotoFile.name.split('.').pop(); const path=`${id}_${Date.now()}.${ext}`; const { error:upErr }=await db.storage.from('avatars').upload(path,editingEmpPhotoFile,{upsert:true}); if(upErr) throw upErr; const { data:ud }=db.storage.from('avatars').getPublicUrl(path); photoUrl=ud.publicUrl; }catch(e){ showToast('Photo upload failed: '+e.message,'warning'); } }
  else if(editingEmpCurrentPhoto===null) photoUrl=null;
  try { const upd={name,status,photo_url:photoUrl}; if(pw) upd.password=pw; const { error }=await db.from('users').update(upd).eq('id',id); if(error){ showToast(error.message,'error'); return; } showToast('Employee updated ✓','success'); closeModal('m-edit-emp'); editingEmpPhotoFile=null; await loadAndRenderEmployees(); renderSidebarUser(); }
  catch(e){ showToast('Error: '+e.message,'error'); }
}

function promptDel(id,name){ document.getElementById('del-id').value=id; document.getElementById('del-name').textContent=name; openModal('m-delete'); }
async function confirmDelete(){ const id=document.getElementById('del-id')?.value; if(!id) return; try{ const { error }=await db.from('users').delete().eq('id',id); if(error){ showToast(error.message,'error'); return; } showToast('Deleted','success'); closeModal('m-delete'); await loadAndRenderEmployees(); refreshOverview(); }catch(e){ showToast('Error','error'); } }

// ══════════════════════════════════
//  OVERVIEW + ADMIN LEAVE CALENDAR
// ══════════════════════════════════
async function refreshOverview(){
  try {
    await loadEmployees();
    const emps=allEmployees.filter(u=>u.role==='employee'), today=T.todayKey();
    const [{ data:recs },{ data:openBreaks },{ data:pendingLeaves },{ data:pendingInc },settings]=await Promise.all([
      db.from('attendance').select('*').eq('date_key',today),
      db.from('breaks').select('*').eq('date_key',today).is('end_time',null),
      db.from('leaves').select('id').eq('status','pending'),
      db.from('incentives').select('id').eq('status','pending'),
      getSettings()
    ]);
    const empIds=emps.map(e=>e.id);
    const taskData=empIds.length?(await db.from('tasks').select('assigned_to').in('assigned_to',empIds).in('stage',['todo','inprogress','review'])).data||[]:[];
    const taskCounts={}; taskData.forEach(t=>{ taskCounts[t.assigned_to]=(taskCounts[t.assigned_to]||0)+1; });
    let online=0;
    const rows=emps.map(emp=>{
      const rec=(recs||[]).find(r=>r.user_id===emp.id), status=rec?rec.status:'offline';
      if(status==='online') online++;
      let workSec=0, breakSec=0;
      if(rec){ breakSec=rec.total_break_sec||0; if(status==='break'){ const ob=(openBreaks||[]).find(b=>b.user_id===emp.id); if(ob) breakSec+=T.diff(ob.start_time,T.now()); } if(status==='offline'&&rec.working_sec){ workSec=rec.working_sec; breakSec=rec.total_break_sec||0; } else if(rec.online_time&&status!=='offline') workSec=Math.max(0,T.diff(rec.online_time,T.now())-breakSec); }
      const score=rec?(rec.score!==null&&rec.score!==undefined?rec.score:calcScoreSync(breakSec,settings)):settings.daily_score;
      const scoreColor=score>=settings.daily_score?'var(--green)':'var(--red)';
      const ph=emp.photo_url?`<img src="${emp.photo_url}" class="emp-photo-sm" alt="" style="margin-right:.5rem" onerror="this.style.display='none'"/>`:'';
      return `<tr><td><div class="fca gap1">${ph}<div><strong>${emp.name}</strong><br><span class="tsm t3 mono">${emp.id}</span></div></div></td><td>${statusBadge(status)}</td><td class="mono">${T.fmt(workSec)}</td><td class="mono">${T.fmt(breakSec)}</td><td><span class="mono" style="font-weight:700;color:${scoreColor}">${score}</span></td><td><span class="badge b-todo">${taskCounts[emp.id]||0} open</span></td></tr>`;
    });
    const plc=(pendingLeaves||[]).length, pic=(pendingInc||[]).length;
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    set('st-total',emps.length); set('st-online',online); set('st-leaves',plc); set('st-incentives',pic);
    const lb=document.getElementById('leave-badge'); if(lb){ lb.textContent=plc; lb.style.display=plc>0?'inline':'none'; }
    const ib=document.getElementById('inc-badge'); if(ib){ ib.textContent=pic; ib.style.display=pic>0?'inline':'none'; }
    const tbody=document.getElementById('live-tbody');
    if(tbody) tbody.innerHTML=rows.join('')||'<tr><td colspan="6"><div class="empty-state"><div class="ei">👥</div><p>No employees yet</p></div></td></tr>';
    renderAdminLeaveCalendar();
  } catch(e){ console.error('refreshOverview:',e); }
}

// Admin leave calendar (shows ALL employees)
async function renderAdminLeaveCalendar(){
  const container=document.getElementById('admin-leave-cal'); if(!container) return;
  if(!adminLeaveCalYear){ const now=new Date(); adminLeaveCalYear=now.getFullYear(); adminLeaveCalMonth=now.getMonth(); }
  const year=adminLeaveCalYear, month=adminLeaveCalMonth;
  const firstDay=new Date(year,month,1), daysInMonth=new Date(year,month+1,0).getDate(), startDow=firstDay.getDay();
  const monthName=firstDay.toLocaleString('en-US',{month:'long',year:'numeric'});
  const startKey=`${year}-${String(month+1).padStart(2,'0')}-01`, endKey=`${year}-${String(month+1).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;
  let leaveMap={};
  try {
    const { data:leaves }=await db.from('leaves').select('user_id,dates,leave_type,status').neq('status','rejected');
    (leaves||[]).forEach(l=>{
      const dates=JSON.parse(l.dates||'[]');
      dates.forEach(dk=>{ if(dk>=startKey&&dk<=endKey){ if(!leaveMap[dk]) leaveMap[dk]=[]; const emp=allEmployees.find(e=>e.id===l.user_id); leaveMap[dk].push({name:emp?emp.name:l.user_id,type:l.leave_type,status:l.status}); } });
    });
  } catch(e){ console.error(e); }
  const todayKey=T.todayKey();
  const dayNames=['Su','Mo','Tu','We','Th','Fr','Sa'];
  let html=`<div class="leave-cal-wrap">
    <div class="leave-cal-head">
      <button class="leave-cal-nav" onclick="adminLeaveCalNav(-1)">‹</button>
      <span class="leave-cal-title">${monthName}</span>
      <button class="leave-cal-nav" onclick="adminLeaveCalNav(1)">›</button>
    </div>
    <div class="leave-cal-grid">${dayNames.map(d=>`<div class="lc-dh">${d}</div>`).join('')}`;
  for(let i=0;i<startDow;i++) html+=`<div class="lc-day lc-empty"></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const dk=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const leaves=leaveMap[dk]||[];
    let cls='lc-day'; if(dk===todayKey) cls+=' lc-today';
    let tooltip='';
    if(leaves.length){
      const hasFullDay=leaves.some(l=>l.type==='full'); cls+=hasFullDay?' lc-leave-full':' lc-leave-half';
      tooltip=`<div class="leave-tooltip" style="max-width:160px;white-space:normal">${leaves.map(l=>`${l.name}: ${l.type}`).join('<br/>')}</div>`;
    }
    html+=`<div class="${cls}">${d}${leaves.length>0?`<span class="txs" style="font-size:.55rem">${leaves.length>1?leaves.length:''}` :''}${tooltip}</div>`;
  }
  html+=`</div><div class="leave-cal-legend"><div class="legend-item"><div class="legend-dot ld-full"></div>Full Day</div><div class="legend-item"><div class="legend-dot ld-half"></div>Half Day</div></div></div>`;
  container.innerHTML=html;
}

function adminLeaveCalNav(dir){ adminLeaveCalMonth+=dir; if(adminLeaveCalMonth>11){adminLeaveCalMonth=0;adminLeaveCalYear++;} if(adminLeaveCalMonth<0){adminLeaveCalMonth=11;adminLeaveCalYear--;} renderAdminLeaveCalendar(); }

// ══════════════════════════════════
//  TASKS (with bulk select + attachments)
// ══════════════════════════════════
async function loadTaskEmployeeFilter(){
  if(!allEmployees.length) await loadEmployees();
  const emps=allEmployees.filter(u=>u.role==='employee'), opts=emps.map(e=>`<option value="${e.id}">${e.name}</option>`).join('');
  ['tf-employee','nt-assign','et-assign'].forEach(sid=>{ const sel=document.getElementById(sid); if(!sel) return; sel.innerHTML=(sid==='tf-employee'?'<option value="">All Employees</option>':'<option value="">Select…</option>')+opts; });
}

async function loadTasks(){
  try {
    if(!allEmployees.length) await loadEmployees();
    const ef=document.getElementById('tf-employee')?.value||'', pf=document.getElementById('tf-priority')?.value||'', sf=(document.getElementById('tf-search')?.value||'').toLowerCase();
    let q=db.from('tasks').select('*').order('created_at',{ascending:false});
    if(ef) q=q.eq('assigned_to',ef); if(pf) q=q.eq('priority',pf);
    const { data:tasks }=await q;
    const filtered=(tasks||[]).filter(t=>!sf||t.title.toLowerCase().includes(sf)||(t.description||'').toLowerCase().includes(sf));
    const stages=['todo','inprogress','review','done'], sc={todo:0,inprogress:0,review:0,done:0};
    stages.forEach(s=>{ const c=document.getElementById('col-'+s); if(c) c.innerHTML=''; const n=document.getElementById('cnt-'+s); if(n) n.textContent='0'; });
    for(const t of filtered){
      sc[t.stage]=(sc[t.stage]||0)+1;
      const empName=(allEmployees.find(e=>e.id===t.assigned_to)||{}).name||t.assigned_to;
      const card=document.createElement('div'); card.className='task-card'+(selectedTasks.has(t.id)?' selected':''); card.dataset.tid=t.id;
      card.innerHTML=`<div class="task-priority-strip strip-${t.priority}"></div><div class="task-card-title">${t.title}</div>${t.description?`<p class="tsm t3" style="margin-bottom:.4rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${t.description}</p>`:''}<div class="task-card-meta"><span class="task-card-assign">👤 ${empName}</span>${t.deadline?`<span class="task-deadline ${deadlineClass(t.deadline)}">${deadlineText(t.deadline)}</span>`:''}</div><div class="fca gap1 mt1">${priorityBadge(t.priority)}</div>`;
      card.onclick=()=>openTaskDetail(t.id);
      const col=document.getElementById('col-'+t.stage); if(col) col.appendChild(card);
    }
    stages.forEach(s=>{ const n=document.getElementById('cnt-'+s); if(n) n.textContent=sc[s]||0; const col=document.getElementById('col-'+s); if(col&&!col.children.length) col.innerHTML='<div class="empty-col">✦<span>No tasks</span></div>'; });
    const tbody=document.getElementById('task-tbody'); if(!tbody) return;
    if(!filtered.length){ tbody.innerHTML='<tr><td colspan="7"><div class="empty-state"><div class="ei">📋</div><p>No tasks found</p></div></td></tr>'; return; }
    tbody.innerHTML=filtered.map(t=>{ const empName=(allEmployees.find(e=>e.id===t.assigned_to)||{}).name||t.assigned_to; const checked=selectedTasks.has(t.id)?'checked':''; return `<tr><td class="cb-cell"><input type="checkbox" ${checked} onchange="toggleTaskSelect('${t.id}',this.checked)" onclick="event.stopPropagation()"/></td><td><strong>${t.title}</strong></td><td>${empName}</td><td>${priorityBadge(t.priority)}</td><td>${stageBadge(t.stage)}</td><td class="tsm ${deadlineClass(t.deadline)}">${t.deadline?deadlineText(t.deadline):'—'}</td><td><div class="fca gap1"><button class="btn btn-sm btn-outline" onclick="openEditTask('${t.id}')">Edit</button><button class="btn btn-sm btn-ghost" onclick="openTaskDetail('${t.id}')">View</button><button class="btn btn-sm btn-danger" onclick="deleteSingleTask('${t.id}')">Del</button></div></td></tr>`; }).join('');
    updateBulkBar();
  } catch(e){ console.error(e); showToast('Error loading tasks','error'); }
}

function toggleTaskSelect(id,checked){ if(checked) selectedTasks.add(id); else selectedTasks.delete(id); updateBulkBar(); }
function updateBulkBar(){ const bar=document.getElementById('task-bulk-bar'), info=document.getElementById('bulk-info'); if(!bar||!info) return; if(selectedTasks.size>0){ bar.classList.add('show'); info.textContent=`${selectedTasks.size} task${selectedTasks.size>1?'s':''} selected`; } else bar.classList.remove('show'); }
function toggleSelectAllTasks(cb){ selectedTasks.clear(); if(cb.checked){ document.querySelectorAll('#task-tbody input[type=checkbox]').forEach(c=>{ c.checked=true; const delBtn=c.closest('tr')?.querySelector('button.btn-danger'); if(delBtn){ const m=delBtn.getAttribute('onclick')?.match(/'([^']+)'/); if(m) selectedTasks.add(m[1]); } }); } else document.querySelectorAll('#task-tbody input[type=checkbox]').forEach(c=>c.checked=false); updateBulkBar(); }
function clearTaskSelection(){ selectedTasks.clear(); document.querySelectorAll('#task-tbody input[type=checkbox]').forEach(c=>c.checked=false); const sa=document.getElementById('select-all-tasks'); if(sa) sa.checked=false; updateBulkBar(); }
async function bulkDeleteTasks(){ if(selectedTasks.size===0) return; if(!confirm(`Delete ${selectedTasks.size} task(s)?`)) return; try{ await db.from('tasks').delete().in('id',[...selectedTasks]); showToast(`${selectedTasks.size} tasks deleted`,'success'); selectedTasks.clear(); loadTasks(); }catch(e){ showToast('Error','error'); } }
async function deleteSingleTask(id){ if(!confirm('Delete this task?')) return; try{ await db.from('tasks').delete().eq('id',id); showToast('Task deleted','success'); selectedTasks.delete(id); loadTasks(); }catch(e){ showToast('Error','error'); } }

async function createTask(){ const title=document.getElementById('nt-title')?.value.trim(), desc=document.getElementById('nt-desc')?.value.trim(), assignTo=document.getElementById('nt-assign')?.value, priority=document.getElementById('nt-priority')?.value, stage=document.getElementById('nt-stage')?.value, deadline=document.getElementById('nt-deadline')?.value; if(!title||!assignTo){ showToast('Title and employee required','error'); return; } const sess=Session.get(); try{ const { error }=await db.from('tasks').insert({id:`task_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,title,description:desc,assigned_to:assignTo,assigned_by:sess.id,priority,stage,deadline:deadline?new Date(deadline).toISOString():null}); if(error){ showToast(error.message,'error'); return; } showToast('Task created ✓','success'); closeModal('m-add-task'); ['nt-title','nt-desc'].forEach(i=>{const el=document.getElementById(i);if(el)el.value=''}); loadTasks(); }catch(e){ showToast('Error','error'); } }
async function openEditTask(id){ try{ const { data:t }=await db.from('tasks').select('*').eq('id',id).single(); if(!t) return; await loadTaskEmployeeFilter(); const sv=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;}; sv('et-id',t.id); sv('et-title',t.title); sv('et-desc',t.description||''); sv('et-assign',t.assigned_to); sv('et-priority',t.priority); sv('et-stage',t.stage); sv('et-deadline',t.deadline?new Date(t.deadline).toISOString().slice(0,16):''); openModal('m-edit-task'); }catch(e){ showToast('Could not load task','error'); } }
async function saveTask(){ const id=document.getElementById('et-id')?.value, title=document.getElementById('et-title')?.value.trim(), desc=document.getElementById('et-desc')?.value.trim(), assignTo=document.getElementById('et-assign')?.value, priority=document.getElementById('et-priority')?.value, stage=document.getElementById('et-stage')?.value, deadline=document.getElementById('et-deadline')?.value; if(!title){ showToast('Title required','error'); return; } try{ const { error }=await db.from('tasks').update({title,description:desc,assigned_to:assignTo,priority,stage,deadline:deadline?new Date(deadline).toISOString():null,updated_at:T.now()}).eq('id',id); if(error){ showToast(error.message,'error'); return; } showToast('Updated ✓','success'); closeModal('m-edit-task'); loadTasks(); }catch(e){ showToast('Error','error'); } }

// Task detail + attachments + comments
let detailTaskId=null;
async function openTaskDetail(id){ detailTaskId=id; try{ const { data:t }=await db.from('tasks').select('*').eq('id',id).single(); if(!t) return; const ae=(allEmployees.find(e=>e.id===t.assigned_to)||{}).name||t.assigned_to, ab=(allEmployees.find(e=>e.id===t.assigned_by)||{}).name||t.assigned_by; const sv=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;}; const st=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;}; const sh=(id,v)=>{const el=document.getElementById(id);if(el)el.innerHTML=v;}; sv('td-id',id); st('td-title',t.title); st('td-desc',t.description||'No description'); st('td-assign',ae); st('td-by',ab); st('td-created',T.fmtDateTime(t.created_at)); sh('td-priority',priorityBadge(t.priority)); sh('td-stage',stageBadge(t.stage)); sh('td-deadline',t.deadline?`<span class="${deadlineClass(t.deadline)}">${deadlineText(t.deadline)}</span>`:'—'); sv('td-stage-update',t.stage); await loadTaskAttachments(id); await loadComments(id); openModal('m-task-detail'); }catch(e){ showToast('Could not load task','error'); } }
async function loadTaskAttachments(taskId){ const list=document.getElementById('td-attachments'); if(!list) return; try{ const { data:atts }=await db.from('task_attachments').select('*').eq('task_id',taskId).order('created_at'); if(!atts||!atts.length){ list.innerHTML='<p class="tsm t3 mb1">No attachments yet</p>'; return; } list.innerHTML=atts.map(a=>`<div class="attach-item"><div class="attach-item-info"><span class="attach-icon">${fileIcon(a.file_type)}</span><div><div class="attach-name">${a.file_name}</div><div class="attach-size">${fmtFileSize(a.file_size)}</div></div></div><div class="fca gap1"><a href="${a.file_url}" target="_blank" class="btn btn-sm btn-outline">↗ Open</a><button class="btn btn-sm btn-danger" onclick="deleteAttachment('${a.id}','${taskId}')">✕</button></div></div>`).join(''); }catch(e){ console.error(e); } }
async function uploadAttachments(input){ if(!input.files||!input.files.length||!detailTaskId) return; const sess=Session.get(); let uploaded=0; for(const file of [...input.files]){ if(file.size>10*1024*1024){ showToast(`${file.name} exceeds 10MB`,'warning'); continue; } try{ const path=`${detailTaskId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`; const { error:upErr }=await db.storage.from('task-files').upload(path,file,{upsert:false}); if(upErr) throw upErr; const { data:ud }=db.storage.from('task-files').getPublicUrl(path); await db.from('task_attachments').insert({id:`att_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,task_id:detailTaskId,user_id:sess.id,file_name:file.name,file_url:ud.publicUrl,file_type:file.type||'application/octet-stream',file_size:file.size}); uploaded++; }catch(e){ showToast(`Failed: ${e.message}`,'error'); } } if(uploaded>0){ showToast(`${uploaded} uploaded ✓`,'success'); await loadTaskAttachments(detailTaskId); } input.value=''; }
async function deleteAttachment(attId,taskId){ if(!confirm('Remove attachment?')) return; try{ await db.from('task_attachments').delete().eq('id',attId); showToast('Removed','success'); await loadTaskAttachments(taskId); }catch(e){ showToast('Error','error'); } }
async function loadComments(taskId){ const list=document.getElementById('td-comments'); if(!list) return; try{ const { data:comments }=await db.from('task_comments').select('*').eq('task_id',taskId).order('created_at'); if(!comments||!comments.length){ list.innerHTML='<div class="t3 tsm" style="text-align:center;padding:1rem">No comments yet</div>'; return; } list.innerHTML=comments.map(c=>{ const u=(allEmployees.find(e=>e.id===c.user_id)||{}).name||c.user_id; return `<div class="comment-item"><div><span class="comment-author">${u}</span><span class="comment-time">${T.fmtDateTime(c.created_at)}</span></div><div class="comment-text">${c.comment}</div></div>`; }).join(''); list.scrollTop=list.scrollHeight; }catch(e){ console.error(e); } }
async function addComment(){ const input=document.getElementById('td-comment-input'), text=input?input.value.trim():''; if(!text||!detailTaskId) return; const sess=Session.get(); try{ await db.from('task_comments').insert({id:`cmt_${Date.now()}`,task_id:detailTaskId,user_id:sess.id,comment:text}); if(input) input.value=''; await loadComments(detailTaskId); }catch(e){ showToast('Error','error'); } }
async function updateTaskStage(){ const id=document.getElementById('td-id')?.value, stage=document.getElementById('td-stage-update')?.value; if(!id||!stage) return; try{ await db.from('tasks').update({stage,updated_at:T.now()}).eq('id',id); const el=document.getElementById('td-stage'); if(el) el.innerHTML=stageBadge(stage); showToast('Stage updated ✓','success'); loadTasks(); }catch(e){ showToast('Error','error'); } }

// ══════════════════════════════════
//  LEAVES
// ══════════════════════════════════
async function loadLeaves(){
  const filter=document.getElementById('leave-filter')?.value||'pending';
  const list=document.getElementById('leaves-list'); if(!list) return;
  list.innerHTML='<div class="loading"><div class="spinner"></div></div>';
  try {
    if(!allEmployees.length) await loadEmployees();
    let q=db.from('leaves').select('*').order('applied_at',{ascending:false}); if(filter!=='all') q=q.eq('status',filter);
    const { data:leaves }=await q;
    const plc=(leaves||[]).filter(l=>l.status==='pending').length;
    const lb=document.getElementById('leave-badge'); if(lb){ lb.textContent=plc; lb.style.display=plc>0?'inline':'none'; }
    if(!leaves||!leaves.length){ list.innerHTML='<div class="empty-state"><div class="ei">🗓</div><p>No leave requests</p></div>'; return; }
    list.innerHTML=leaves.map(l=>{ const emp=(allEmployees.find(e=>e.id===l.user_id)||{}).name||l.user_id, dates=JSON.parse(l.dates||'[]'), nc=l.status==='approved'?'approved-note':l.status==='rejected'?'rejected-note':''; return `<div class="leave-card"><div class="leave-card-head"><div class="fca gap2"><strong>${emp}</strong><span class="badge ${l.leave_type==='half'?'b-p-medium':'b-p-high'}">${l.leave_type==='half'?'Half':'Full'} Day</span>${leaveBadge(l.status)}</div><span class="tsm t3 mono">${T.fmtDateTime(l.applied_at)}</span></div><div class="leave-dates">${dates.map(d=>`<span class="leave-date-tag">${d}</span>`).join('')}</div><p class="leave-reason">"${l.reason}"</p>${l.admin_note?`<div class="leave-admin-note ${nc}">📝 ${l.admin_note}</div>`:''}${l.status==='pending'?`<div class="leave-actions"><button class="btn btn-success btn-sm" onclick="quickReview('${l.id}','approved')">✓ Approve</button><button class="btn btn-danger btn-sm" onclick="quickReview('${l.id}','rejected')">✕ Reject</button><button class="btn btn-outline btn-sm" onclick="openReviewModal('${l.id}')">📝 With Note</button></div>`:''}</div>`; }).join('');
  } catch(e){ console.error(e); list.innerHTML='<div class="empty-state"><div class="ei">⚠️</div><p>Error loading</p></div>'; }
}

async function quickReview(id,status){ const sess=Session.get(); try{ await db.from('leaves').update({status,reviewed_at:T.now(),reviewed_by:sess.id,admin_note:''}).eq('id',id); showToast(`Leave ${status} ✓`,status==='approved'?'success':'warning'); loadLeaves(); }catch(e){ showToast('Error','error'); } }
async function openReviewModal(id){ try{ const { data:l }=await db.from('leaves').select('*').eq('id',id).single(); if(!l) return; const emp=(allEmployees.find(e=>e.id===l.user_id)||{}).name||l.user_id, dates=JSON.parse(l.dates||'[]'); document.getElementById('rl-id').value=id; document.getElementById('rl-emp').textContent=emp; document.getElementById('rl-type').innerHTML=`<span class="badge ${l.leave_type==='half'?'b-p-medium':'b-p-high'}">${l.leave_type==='half'?'Half':'Full'} Day</span>`; document.getElementById('rl-dates').innerHTML=dates.map(d=>`<span class="leave-date-tag">${d}</span>`).join(''); document.getElementById('rl-reason').textContent=l.reason; document.getElementById('rl-note').value=l.admin_note||''; openModal('m-review-leave'); }catch(e){ showToast('Error','error'); } }
async function reviewLeave(status){ const id=document.getElementById('rl-id')?.value, note=document.getElementById('rl-note')?.value.trim()||'', sess=Session.get(); try{ await db.from('leaves').update({status,reviewed_at:T.now(),reviewed_by:sess.id,admin_note:note}).eq('id',id); showToast(`Leave ${status} ✓`,status==='approved'?'success':'warning'); closeModal('m-review-leave'); loadLeaves(); }catch(e){ showToast('Error','error'); } }

// ══════════════════════════════════
//  INCENTIVES
// ══════════════════════════════════
async function loadAdminEmpFilter(){
  if(!allEmployees.length) await loadEmployees();
  const emps=allEmployees.filter(u=>u.role==='employee'), opts='<option value="">All Employees</option>'+emps.map(e=>`<option value="${e.id}">${e.name}</option>`).join('');
  const sel=document.getElementById('adm-inc-emp'); if(sel) sel.innerHTML=opts;
}

async function loadAdminIncentives(){
  const list=document.getElementById('admin-incentives-list'); if(!list) return;
  list.innerHTML='<div class="loading"><div class="spinner"></div></div>';
  const empFilter=document.getElementById('adm-inc-emp')?.value||'';
  const statusFilter=document.getElementById('adm-inc-status')?.value||'';
  const monthFilter=document.getElementById('adm-inc-month-filter')?.value||'';
  try {
    if(!allEmployees.length) await loadEmployees();
    // Overall stats (unfiltered)
    const { data:allInc }=await db.from('incentives').select('*');
    const totApproved=(allInc||[]).filter(i=>i.status==='approved').reduce((s,i)=>s+parseFloat(i.amount||0),0);
    const cntApproved=(allInc||[]).filter(i=>i.status==='approved').length;
    const pendingCnt=(allInc||[]).filter(i=>i.status==='pending').length;
    const curMonth=new Date().toISOString().slice(0,7);
    const monthTotal=(allInc||[]).filter(i=>i.status==='approved'&&i.date&&i.date.startsWith(curMonth)).reduce((s,i)=>s+parseFloat(i.amount||0),0);
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    set('adm-inc-total',`₹${totApproved.toFixed(2)}`); set('adm-inc-count',`${cntApproved} entries approved`); set('adm-inc-pending',pendingCnt); set('adm-inc-month',`₹${monthTotal.toFixed(2)}`);
    const ib=document.getElementById('inc-badge'); if(ib){ ib.textContent=pendingCnt; ib.style.display=pendingCnt>0?'inline':'none'; }
    // Filtered query
    let q=db.from('incentives').select('*').order('submitted_at',{ascending:false});
    if(empFilter) q=q.eq('user_id',empFilter); if(statusFilter) q=q.eq('status',statusFilter);
    const { data:items }=await q;
    let filtered=items||[]; if(monthFilter) filtered=filtered.filter(i=>i.date&&i.date.startsWith(monthFilter));
    if(!filtered.length){ list.innerHTML='<div class="empty-state"><div class="ei">💰</div><p>No incentive entries found</p></div>'; return; }
    list.innerHTML=filtered.map(i=>{ const emp=(allEmployees.find(e=>e.id===i.user_id)||{}).name||i.user_id, nc=i.status==='approved'?'approved-note':i.status==='rejected'?'rejected-note':''; return `<div class="incentive-card"><div class="incentive-card-head"><div class="fca gap2"><strong>${emp}</strong><span class="tsm t3 mono">${i.date}</span><span class="incentive-order">Order: ${i.order_id}</span></div><div class="fca gap2"><span class="incentive-amount-sm ${i.status==='approved'?'amt-approved':i.status==='pending'?'amt-pending':'amt-rejected'}">₹${parseFloat(i.amount).toFixed(2)}</span>${incBadge(i.status)}</div></div>${i.remark?`<p class="tsm t2">${i.remark}</p>`:''} ${i.admin_note?`<div class="leave-admin-note ${nc} mt1">📝 ${i.admin_note}</div>`:''}<div class="tsm t3 mt1">Submitted: ${T.fmtDateTime(i.submitted_at)}</div>${i.status==='pending'?`<div class="leave-actions"><button class="btn btn-success btn-sm" onclick="quickReviewInc('${i.id}','approved')">✓ Approve</button><button class="btn btn-danger btn-sm" onclick="quickReviewInc('${i.id}','rejected')">✕ Reject</button><button class="btn btn-outline btn-sm" onclick="openReviewIncentive('${i.id}')">📝 With Note</button></div>`:''}</div>`; }).join('');
  } catch(e){ console.error(e); list.innerHTML='<div class="empty-state"><div class="ei">⚠️</div><p>Error loading</p></div>'; }
}

function incBadge(s){ const map={pending:'b-pending',approved:'b-approved',rejected:'b-rejected'}; return `<span class="badge ${map[s]||'b-pending'}">${s}</span>`; }
async function quickReviewInc(id,status){ const sess=Session.get(); try{ await db.from('incentives').update({status,reviewed_at:T.now(),reviewed_by:sess.id,admin_note:''}).eq('id',id); showToast(`Incentive ${status} ✓`,status==='approved'?'success':'warning'); loadAdminIncentives(); }catch(e){ showToast('Error','error'); } }
async function openReviewIncentive(id){ try{ const { data:i }=await db.from('incentives').select('*').eq('id',id).single(); if(!i) return; const emp=(allEmployees.find(e=>e.id===i.user_id)||{}).name||i.user_id; document.getElementById('ri-id').value=id; document.getElementById('ri-emp').textContent=emp; document.getElementById('ri-date').textContent=i.date; document.getElementById('ri-order').textContent=i.order_id; document.getElementById('ri-amount').textContent=`₹${parseFloat(i.amount).toFixed(2)}`; document.getElementById('ri-remark').textContent=i.remark||'—'; document.getElementById('ri-note').value=i.admin_note||''; openModal('m-review-incentive'); }catch(e){ showToast('Error','error'); } }
async function reviewIncentive(status){ const id=document.getElementById('ri-id')?.value, note=document.getElementById('ri-note')?.value.trim()||'', sess=Session.get(); try{ await db.from('incentives').update({status,reviewed_at:T.now(),reviewed_by:sess.id,admin_note:note}).eq('id',id); showToast(`Incentive ${status} ✓`,status==='approved'?'success':'warning'); closeModal('m-review-incentive'); loadAdminIncentives(); }catch(e){ showToast('Error','error'); } }

async function exportAllIncentivesCSV(){
  try {
    if(!allEmployees.length) await loadEmployees();
    const { data:items }=await db.from('incentives').select('*').order('date');
    if(!items||!items.length){ showToast('No incentives to export','warning'); return; }
    const headers=['Employee','Employee ID','Date','Order ID','Remark','Amount','Status','Admin Note','Submitted'];
    const rows=items.map(i=>{ const emp=(allEmployees.find(e=>e.id===i.user_id)||{}).name||i.user_id; return [emp,i.user_id,i.date,i.order_id,i.remark||'',parseFloat(i.amount||0).toFixed(2),i.status,i.admin_note||'',T.fmtDateTime(i.submitted_at)]; });
    const totApproved=items.filter(i=>i.status==='approved').reduce((s,i)=>s+parseFloat(i.amount||0),0);
    rows.push(['','','','','TOTAL APPROVED',totApproved.toFixed(2),'','','']);
    const csv=[headers,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download=`all_incentives_${T.todayKey()}.csv`; a.click(); showToast('Exported ✓','success');
  } catch(e){ showToast('Error exporting','error'); }
}

// ══════════════════════════════════
//  BRANDING
// ══════════════════════════════════
async function loadBrandingForm(){ _logoFileForUpload=null; _removeLogoFlag=false; const b=await getBranding(); const ne=document.getElementById('brand-name'); if(ne) ne.value=b.app_name||'WorkTrack'; const preview=document.getElementById('logo-preview'); if(preview){ if(b.logo_url) preview.innerHTML=`<img src="${b.logo_url}" alt="logo" style="width:100%;height:100%;object-fit:cover;border-radius:var(--r2)"/>`; else preview.innerHTML='⏱'; } }
function previewLogo(input){ if(!input.files||!input.files[0]) return; const file=input.files[0]; if(file.size>2*1024*1024){ showToast('Logo must be under 2MB','error'); input.value=''; return; } _logoFileForUpload=file; _removeLogoFlag=false; const reader=new FileReader(); reader.onload=e=>{ const p=document.getElementById('logo-preview'); if(p) p.innerHTML=`<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:var(--r2)"/>`; }; reader.readAsDataURL(file); }
function removeLogo(){ _logoFileForUpload=null; _removeLogoFlag=true; const p=document.getElementById('logo-preview'); if(p) p.innerHTML='⏱'; }
async function saveBranding(){ const name=document.getElementById('brand-name')?.value.trim()||'WorkTrack'; let logoUrl=(await getBranding()).logo_url||null; if(_removeLogoFlag) logoUrl=null; if(_logoFileForUpload){ try{ const ext=_logoFileForUpload.name.split('.').pop(), path=`logo_${Date.now()}.${ext}`; const { error:upErr }=await db.storage.from('branding').upload(path,_logoFileForUpload,{upsert:true}); if(upErr) throw upErr; const { data:ud }=db.storage.from('branding').getPublicUrl(path); logoUrl=ud.publicUrl; }catch(e){ showToast('Logo upload failed: '+e.message,'warning'); } } try{ await db.from('branding').upsert({id:1,app_name:name,logo_url:logoUrl}); clearBrandingCache(); showToast('Branding saved ✓ — refresh to see','success'); _logoFileForUpload=null; _removeLogoFlag=false; applyBranding(); }catch(e){ showToast('Error saving branding','error'); } }

// ══════════════════════════════════
//  INIT
// ══════════════════════════════════
const firstNav=document.querySelector('.nav-item');
showSec('overview',firstNav);
setInterval(()=>{ if(currentSection==='overview') refreshOverview(); },30000);
