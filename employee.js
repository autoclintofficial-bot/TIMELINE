// employee.js — Full featured version
if (!Session.requireEmployee()) throw new Error('Not authorized');
renderSidebarUser();
applyBranding();

const session = Session.get();
const userId  = session.id;

// ---- LOCAL STATE ----
let localState = {
  status:'offline', onlineTime:null, totalBreakSec:0,
  openBreakStart:null, openBreakType:null,
  workingSec:0, dateKey:T.todayKey(), recId:null, settings:null
};

let workIntervalId=null, clockIntervalId=null, idleTimerId=null;
let idleShown=false, breakWarned=false, isActionLocked=false;
let detailTaskId=null;
let leaveDates=[]; // date strings for pending apply

// ---- INIT ----
async function init() {
  const now=new Date(), h=now.getHours();
  const greet=h<5?'Good night':h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  const icon=h<12?'☀️':h<17?'🌤':'🌆';
  const gEl=document.getElementById('greeting'); if(gEl) gEl.textContent=`${greet}, ${session.name}! ${icon}`;
  const dEl=document.getElementById('emp-date'); if(dEl) dEl.textContent=now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const lEl=document.getElementById('i-login'); if(lEl) lEl.textContent=T.fmtTime(session.loginTime);
  localState.settings=await getSettings();
  const bwMax=document.getElementById('bw-max'); if(bwMax) bwMax.textContent=localState.settings.max_break_minutes;
  await syncStateFromDB();
  startClock();
  startIdleDetection();
  renderTimers();
  updateBreakLog();
}

// ---- SYNC FROM DB ----
async function syncStateFromDB() {
  try {
    const today=T.todayKey();
    const { data:rec }=await db.from('attendance').select('*').eq('user_id',userId).eq('date_key',today).maybeSingle();
    if (rec) {
      localState.status=rec.status; localState.onlineTime=rec.online_time;
      localState.totalBreakSec=rec.total_break_sec||0; localState.workingSec=rec.working_sec||0;
      localState.recId=rec.id; localState.dateKey=rec.date_key;
      if (rec.status==='break') {
        const { data:ob }=await db.from('breaks').select('*').eq('user_id',userId).is('end_time',null).maybeSingle();
        localState.openBreakStart=ob?ob.start_time:null; localState.openBreakType=ob?ob.type:null;
      } else { localState.openBreakStart=null; localState.openBreakType=null; }
    } else { localState.status='offline'; }
    localState.settings=await getSettings();
    const oEl=document.getElementById('i-online'); if(oEl) oEl.textContent=localState.onlineTime?T.fmtTime(localState.onlineTime):'--';
    const bEl=document.getElementById('i-brk'); if(bEl) bEl.textContent=localState.openBreakType||'--';
    if (localState.status==='online')       { setUIOnline(); startWorkTimer(); }
    else if (localState.status==='break')   { setUIBreak(localState.openBreakType); startWorkTimer(); }
    else                                    { setUIOffline(); }
  } catch(e) { console.error('syncStateFromDB:',e); }
}

// ---- CLOCK ----
function startClock() {
  if(clockIntervalId) clearInterval(clockIntervalId);
  clockIntervalId=setInterval(()=>{ const el=document.getElementById('clock'); if(el) el.textContent=new Date().toLocaleTimeString('en-US'); },1000);
}

// ---- WORK TIMER ----
function startWorkTimer()  { stopWorkTimer(); workIntervalId=setInterval(renderTimers,1000); }
function stopWorkTimer()   { if(workIntervalId){ clearInterval(workIntervalId); workIntervalId=null; } }

// ---- RENDER TIMERS (zero DB calls) ----
function renderTimers() {
  const s=localState.settings||{daily_score:10,max_break_minutes:60,penalty_interval_minutes:10,penalty_points:1,duty_hours:9};
  const now=Date.now();
  let breakSec=localState.totalBreakSec, workSec=0;
  if (localState.status==='break'&&localState.openBreakStart) breakSec+=Math.floor((now-new Date(localState.openBreakStart))/1000);
  if (localState.status==='offline') { workSec=localState.workingSec; breakSec=localState.totalBreakSec; }
  else if (localState.onlineTime) { const onlineSec=Math.floor((now-new Date(localState.onlineTime))/1000); workSec=Math.max(0,onlineSec-breakSec); }
  const dutyTotal=s.duty_hours*3600, maxBreak=s.max_break_minutes*60;
  const breakLeft=Math.max(0,maxBreak-breakSec), dutyLeft=Math.max(0,dutyTotal-workSec);
  const score=calcScoreSync(breakSec,s);
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  const setProg=(id,pct)=>{const el=document.getElementById(id);if(el)el.style.width=Math.min(100,pct)+'%';};
  set('work-timer',T.fmt(workSec)); set('w-card',T.fmt(workSec)); set('b-card',T.fmt(breakSec));
  set('br-card',T.fmt(breakLeft)); set('d-card',T.fmt(dutyLeft));
  const wp=dutyTotal>0?(workSec/dutyTotal)*100:0, bp=maxBreak>0?(breakSec/maxBreak)*100:0;
  setProg('w-prog',wp); setProg('b-prog',bp); setProg('br-prog',maxBreak>0?(breakLeft/maxBreak)*100:100); setProg('d-prog',wp);
  const bpEl=document.getElementById('b-prog'); if(bpEl) bpEl.style.background=breakSec>maxBreak?'linear-gradient(90deg,var(--red),#f87171)':'linear-gradient(90deg,var(--orange),#fbbf24)';
  set('w-lbl',`${Math.round(wp)}% of ${s.duty_hours}h duty`);
  set('b-lbl',`${Math.round(breakSec/60)} min used of ${s.max_break_minutes}`);
  set('br-lbl',`${Math.round(breakLeft/60)} min left`);
  set('d-lbl',`${Math.round(wp)}% complete`);
  const isGood=score>=s.daily_score;
  const srEl=document.getElementById('score-ring'); if(srEl){ srEl.textContent=score; srEl.className=`score-ring ${isGood?'sr-good':'sr-bad'}`; }
  const slEl=document.getElementById('score-label'); if(slEl){ slEl.textContent=isGood?'Perfect Score ✓':'Penalty Applied ⚠'; slEl.style.color=isGood?'var(--green)':'var(--red)'; }
  const sdEl=document.getElementById('score-detail'); if(sdEl){ const extra=Math.max(0,breakSec-maxBreak); sdEl.textContent=extra>0?`+${Math.round(extra/60)} min over limit`:'No penalties'; }
  if (!breakWarned&&localState.status!=='offline'&&breakSec>=maxBreak*0.8&&breakSec<maxBreak) {
    breakWarned=true;
    const bwLeft=document.getElementById('bw-left'); if(bwLeft) bwLeft.textContent=Math.round(breakLeft/60)+' min';
    openModal('m-brk-warn');
  }
}

// ---- ACTION LOCK ----
function lockActions(lock) {
  isActionLocked=lock;
  if (!lock) return; // re-enable via setUI*
  ['btn-on','btn-brk','btn-ebrk','btn-off'].forEach(id=>{ const el=document.getElementById(id); if(el) el.disabled=true; });
}

// ---- GO ONLINE ----
async function goOnline() {
  if(isActionLocked) return;
  lockActions(true);
  const now=T.now(), today=T.todayKey();
  try {
    const { data:existing }=await db.from('attendance').select('*').eq('user_id',userId).eq('date_key',today).maybeSingle();
    if (existing) {
      await db.from('attendance').update({status:'online',online_time:existing.online_time||now,login_time:existing.login_time||now}).eq('id',existing.id);
    } else {
      await db.from('attendance').insert({id:`att_${userId}_${today}`,user_id:userId,date_key:today,login_time:now,online_time:now,status:'online',total_break_sec:0,working_sec:0,score:null});
    }
    await syncStateFromDB(); showToast('You are now Online 🟢','success'); breakWarned=false; renderTimers(); startWorkTimer();
  } catch(e) { showToast('Error: '+e.message,'error'); lockActions(false); setUIOffline(); }
}

// ---- TAKE BREAK ----
async function takeBreak() {
  if(isActionLocked) return;
  lockActions(true);
  const type=document.getElementById('break-type')?.value||'Short Break';
  const now=T.now(), today=T.todayKey();
  try {
    const settings=await getSettings();
    if (localState.totalBreakSec>=settings.max_break_minutes*60) { showToast('Break limit already reached!','error'); lockActions(false); setUIOnline(); return; }
    await db.from('breaks').insert({id:`brk_${userId}_${Date.now()}`,user_id:userId,date_key:today,type,start_time:now,end_time:null,duration_sec:0});
    await db.from('attendance').update({status:'break'}).eq('user_id',userId).eq('date_key',today);
    await syncStateFromDB(); showToast(`${type} started ☕`,'info'); renderTimers();
  } catch(e) { showToast('Error: '+e.message,'error'); lockActions(false); setUIOnline(); }
}

// ---- END BREAK ----
async function endBreak() {
  if(isActionLocked) return;
  lockActions(true);
  const now=T.now(), today=T.todayKey();
  try {
    const { data:ob }=await db.from('breaks').select('*').eq('user_id',userId).is('end_time',null).maybeSingle();
    if (ob) {
      const dur=T.diff(ob.start_time,now);
      await db.from('breaks').update({end_time:now,duration_sec:dur}).eq('id',ob.id);
      const { data:rec }=await db.from('attendance').select('total_break_sec').eq('user_id',userId).eq('date_key',today).maybeSingle();
      await db.from('attendance').update({status:'online',total_break_sec:((rec?.total_break_sec)||0)+dur}).eq('user_id',userId).eq('date_key',today);
    } else {
      await db.from('attendance').update({status:'online'}).eq('user_id',userId).eq('date_key',today);
    }
    await syncStateFromDB(); showToast(`Break ended ✓`,'success'); renderTimers(); updateBreakLog();
  } catch(e) { showToast('Error: '+e.message,'error'); lockActions(false); setUIOnline(); }
}

// ---- GO OFFLINE ----
async function goOffline() {
  if(isActionLocked) return;
  lockActions(true);
  const now=T.now(), today=T.todayKey();
  try {
    const { data:ob }=await db.from('breaks').select('*').eq('user_id',userId).is('end_time',null).maybeSingle();
    let totalBreakSec=localState.totalBreakSec;
    if (ob) { const dur=T.diff(ob.start_time,now); await db.from('breaks').update({end_time:now,duration_sec:dur}).eq('id',ob.id); totalBreakSec+=dur; }
    const workSec=localState.onlineTime?Math.max(0,T.diff(localState.onlineTime,now)-totalBreakSec):0;
    const settings=localState.settings||await getSettings();
    const score=calcScoreSync(totalBreakSec,settings);
    await db.from('attendance').update({status:'offline',offline_time:now,working_sec:workSec,total_break_sec:totalBreakSec,score}).eq('user_id',userId).eq('date_key',today);
    await syncStateFromDB(); stopWorkTimer(); showToast(`Offline. Score: ${score}/${settings.daily_score}`,score>=settings.daily_score?'success':'warning'); renderTimers(); updateBreakLog();
  } catch(e) { showToast('Error: '+e.message,'error'); lockActions(false); setUIOnline(); }
}

// ---- UI STATES ----
function setUIOnline() {
  isActionLocked=false;
  const _s=(id,v)=>{const el=document.getElementById(id);if(el&&typeof v==='string'&&(el.tagName==='INPUT'||el.tagName==='SELECT')){ }};
  const panel=document.getElementById('status-panel'); if(panel) panel.className='status-panel s-online';
  const ring=document.getElementById('status-ring'); if(ring) ring.className='status-ring r-online';
  const em=document.getElementById('s-emoji'); if(em) em.textContent='💼';
  const lb=document.getElementById('s-label'); if(lb) lb.textContent='Online';
  const setDis=(id,v,disp)=>{const el=document.getElementById(id);if(el){el.disabled=v;if(disp!==undefined)el.style.display=disp;}};
  setDis('btn-on',true); setDis('btn-brk',false); setDis('btn-ebrk',true,'none'); setDis('btn-off',false);
  const bsr=document.getElementById('break-select-row'); if(bsr) bsr.style.display='block';
}
function setUIBreak(type) {
  isActionLocked=false;
  const emojis={'Lunch':'🍽','Short Break':'☕','Spiritual Break':'🙏','Washroom':'🚻'};
  const panel=document.getElementById('status-panel'); if(panel) panel.className='status-panel s-break';
  const ring=document.getElementById('status-ring'); if(ring) ring.className='status-ring r-break';
  const em=document.getElementById('s-emoji'); if(em) em.textContent=emojis[type]||'☕';
  const lb=document.getElementById('s-label'); if(lb) lb.textContent=type||'On Break';
  const setDis=(id,v,disp)=>{const el=document.getElementById(id);if(el){el.disabled=v;if(disp!==undefined)el.style.display=disp;}};
  setDis('btn-on',true); setDis('btn-brk',true); setDis('btn-ebrk',false,'inline-flex'); setDis('btn-off',true);
  const bsr=document.getElementById('break-select-row'); if(bsr) bsr.style.display='none';
  const bEl=document.getElementById('i-brk'); if(bEl) bEl.textContent=type||'On Break';
}
function setUIOffline() {
  isActionLocked=false;
  const panel=document.getElementById('status-panel'); if(panel) panel.className='status-panel s-offline';
  const ring=document.getElementById('status-ring'); if(ring) ring.className='status-ring r-offline';
  const em=document.getElementById('s-emoji'); if(em) em.textContent='💤';
  const lb=document.getElementById('s-label'); if(lb) lb.textContent='Offline';
  const setDis=(id,v,disp)=>{const el=document.getElementById(id);if(el){el.disabled=v;if(disp!==undefined)el.style.display=disp;}};
  setDis('btn-on',false); setDis('btn-brk',true); setDis('btn-ebrk',true,'none'); setDis('btn-off',true);
  const bsr=document.getElementById('break-select-row'); if(bsr) bsr.style.display='none';
  const bEl=document.getElementById('i-brk'); if(bEl) bEl.textContent='--';
  stopWorkTimer();
}

// ---- BREAK LOG ----
async function updateBreakLog() {
  const container=document.getElementById('brk-log'); if(!container) return;
  try {
    const { data:brks }=await db.from('breaks').select('*').eq('user_id',userId).eq('date_key',T.todayKey()).order('start_time');
    const brkCount=document.getElementById('i-brkcount'); if(brkCount) brkCount.textContent=brks?brks.length:0;
    if (!brks||!brks.length) { container.innerHTML='<div class="empty-state"><div class="ei">☕</div><p>No breaks today</p></div>'; return; }
    const emojis={'Lunch':'🍽','Short Break':'☕','Spiritual Break':'🙏','Washroom':'🚻'};
    container.innerHTML=`<div class="brk-list">${brks.map(b=>`<div class="brk-item"><span class="brk-type">${emojis[b.type]||'☕'} ${b.type}</span><span class="brk-time">${T.fmtTime(b.start_time)} → ${b.end_time?T.fmtTime(b.end_time):'...'}</span><span class="brk-dur">${b.end_time?T.fmt(b.duration_sec):'...'}</span></div>`).join('')}</div>`;
  } catch(e) { console.error('updateBreakLog:',e); }
}

// ---- TASKS ----
async function loadEmpTasks() {
  try {
    const { data:tasks }=await db.from('tasks').select('*').eq('assigned_to',userId).order('created_at',{ascending:false});
    const stages=['todo','inprogress','review','done'];
    const counts={todo:0,inprogress:0,review:0,done:0};
    stages.forEach(s=>{ const col=document.getElementById('ek-col-'+s); const cnt=document.getElementById('ek-cnt-'+s); if(col)col.innerHTML=''; if(cnt)cnt.textContent='0'; });
    for (const t of (tasks||[])) {
      counts[t.stage]=(counts[t.stage]||0)+1;
      const card=document.createElement('div');
      card.className='task-card';
      card.innerHTML=`<div class="task-priority-strip strip-${t.priority}"></div><div class="task-card-title">${t.title}</div>${t.description?`<p class="tsm t3" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:.4rem">${t.description}</p>`:''}<div class="task-card-meta">${priorityBadge(t.priority)}${t.deadline?`<span class="task-deadline ${deadlineClass(t.deadline)}">${deadlineText(t.deadline)}</span>`:''}</div>`;
      card.onclick=()=>openEmpTaskDetail(t.id);
      const col=document.getElementById('ek-col-'+t.stage); if(col) col.appendChild(card);
    }
    stages.forEach(s=>{ const cnt=document.getElementById('ek-cnt-'+s); if(cnt) cnt.textContent=counts[s]||0; const col=document.getElementById('ek-col-'+s); if(col&&!col.children.length) col.innerHTML='<div class="empty-col">✦<span>No tasks</span></div>'; });
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    set('tst-todo',counts.todo||0); set('tst-ip',counts.inprogress||0); set('tst-rv',counts.review||0); set('tst-dn',counts.done||0);
  } catch(e) { console.error('loadEmpTasks:',e); }
}

async function openEmpTaskDetail(id) {
  detailTaskId=id;
  try {
    const { data:t }=await db.from('tasks').select('*').eq('id',id).single(); if(!t) return;
    let assignerName=t.assigned_by;
    try { const { data:a }=await db.from('users').select('name').eq('id',t.assigned_by).single(); if(a) assignerName=a.name; } catch{}
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    const setHTML=(id,v)=>{const el=document.getElementById(id);if(el)el.innerHTML=v;};
    const setVal=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;};
    set('etd-title',t.title); set('etd-desc',t.description||'No description'); set('etd-by',assignerName);
    setHTML('etd-priority',priorityBadge(t.priority)); setHTML('etd-stage',stageBadge(t.stage));
    setHTML('etd-deadline',t.deadline?`<span class="${deadlineClass(t.deadline)}">${deadlineText(t.deadline)}</span>`:'—');
    setVal('etd-stage-sel',t.stage); setVal('etd-id',id);
    await empLoadTaskAttachments(id);
    await empLoadComments(id);
    openModal('m-emp-task-detail');
  } catch(e) { showToast('Could not load task','error'); }
}

async function empLoadTaskAttachments(taskId) {
  const list=document.getElementById('etd-attachments'); if(!list) return;
  try {
    const { data:atts }=await db.from('task_attachments').select('*').eq('task_id',taskId).order('created_at');
    if (!atts||!atts.length) { list.innerHTML='<p class="tsm t3 mb1">No attachments yet</p>'; return; }
    list.innerHTML=atts.map(a=>`<div class="attach-item"><div class="attach-item-info"><span class="attach-icon">${fileIcon(a.file_type)}</span><div><div class="attach-name">${a.file_name}</div><div class="attach-size">${fmtFileSize(a.file_size)}</div></div></div><a href="${a.file_url}" target="_blank" class="btn btn-sm btn-outline">↗ Open</a></div>`).join('');
  } catch(e) { console.error('empLoadTaskAttachments:',e); }
}

async function empUploadAttachments(input) {
  if (!input.files||!input.files.length||!detailTaskId) return;
  const files=[...input.files];
  let uploaded=0;
  for (const file of files) {
    if (file.size>10*1024*1024) { showToast(`${file.name} exceeds 10MB`,'warning'); continue; }
    try {
      const path=`${detailTaskId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
      const { error:upErr }=await db.storage.from('task-files').upload(path,file,{upsert:false});
      if(upErr) throw upErr;
      const { data:urlData }=db.storage.from('task-files').getPublicUrl(path);
      await db.from('task_attachments').insert({id:`att_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,task_id:detailTaskId,user_id:userId,file_name:file.name,file_url:urlData.publicUrl,file_type:file.type||'application/octet-stream',file_size:file.size});
      uploaded++;
    } catch(e) { showToast(`Failed: ${e.message}`,'error'); }
  }
  if (uploaded>0) { showToast(`${uploaded} file${uploaded>1?'s':''} uploaded ✓`,'success'); await empLoadTaskAttachments(detailTaskId); }
  input.value='';
}

async function empLoadComments(taskId) {
  const list=document.getElementById('etd-comments'); if(!list) return;
  try {
    const { data:comments }=await db.from('task_comments').select('*').eq('task_id',taskId).order('created_at');
    if (!comments||!comments.length) { list.innerHTML='<div class="t3 tsm" style="text-align:center;padding:1rem">No comments yet</div>'; return; }
    const userIds=[...new Set(comments.map(c=>c.user_id))];
    const { data:users }=await db.from('users').select('id,name').in('id',userIds);
    const nameMap={}; (users||[]).forEach(u=>nameMap[u.id]=u.name);
    list.innerHTML=comments.map(c=>`<div class="comment-item"><div><span class="comment-author">${nameMap[c.user_id]||c.user_id}</span><span class="comment-time">${T.fmtDateTime(c.created_at)}</span></div><div class="comment-text">${c.comment}</div></div>`).join('');
    list.scrollTop=list.scrollHeight;
  } catch(e) { console.error('empLoadComments:',e); }
}
async function empAddComment() {
  const input=document.getElementById('etd-comment-input');
  const text=input?input.value.trim():''; if(!text||!detailTaskId) return;
  try {
    await db.from('task_comments').insert({id:`cmt_${Date.now()}`,task_id:detailTaskId,user_id:userId,comment:text});
    if(input) input.value='';
    await empLoadComments(detailTaskId);
  } catch(e) { showToast('Could not post comment','error'); }
}
async function empUpdateStage() {
  const id=document.getElementById('etd-id')?.value;
  const stage=document.getElementById('etd-stage-sel')?.value;
  if(!id||!stage) return;
  try {
    await db.from('tasks').update({stage,updated_at:T.now()}).eq('id',id);
    const el=document.getElementById('etd-stage'); if(el) el.innerHTML=stageBadge(stage);
    showToast('Stage updated ✓','success'); loadEmpTasks();
  } catch(e) { showToast('Error updating stage','error'); }
}

// ---- LEAVE APPLICATION ----
function addLeaveDate() {
  const picker=document.getElementById('al-date-picker');
  const val=picker?picker.value:''; if(!val) { showToast('Select a date first','warning'); return; }
  if (leaveDates.includes(val)) { showToast('Date already added','warning'); return; }
  leaveDates.push(val);
  leaveDates.sort();
  renderDateChips();
  if(picker) picker.value='';
}

function removeLeaveDateChip(date) {
  leaveDates=leaveDates.filter(d=>d!==date);
  renderDateChips();
}

function renderDateChips() {
  const container=document.getElementById('al-date-chips'); if(!container) return;
  container.innerHTML=leaveDates.map(d=>`<div class="date-chip"><span>${d}</span><span class="date-chip-remove" onclick="removeLeaveDateChip('${d}')">✕</span></div>`).join('');
}

async function submitLeave() {
  const type=document.getElementById('al-type')?.value||'full';
  const reason=document.getElementById('al-reason')?.value.trim()||'';
  if (leaveDates.length===0) { showToast('Add at least one date','error'); return; }
  if (!reason) { showToast('Please enter a reason','error'); return; }
  try {
    await db.from('leaves').insert({id:`leave_${userId}_${Date.now()}`,user_id:userId,leave_type:type,dates:JSON.stringify(leaveDates),reason,status:'pending',admin_note:'',applied_at:T.now()});
    showToast('Leave request submitted ✓','success');
    closeModal('m-apply-leave');
    leaveDates=[];
    const reasonEl=document.getElementById('al-reason'); if(reasonEl) reasonEl.value='';
    renderDateChips();
    loadMyLeaves();
  } catch(e) { showToast('Error submitting leave: '+e.message,'error'); }
}

async function loadMyLeaves() {
  const list=document.getElementById('my-leaves-list'); if(!list) return;
  list.innerHTML='<div class="loading"><div class="spinner"></div></div>';
  try {
    const { data:leaves,error }=await db.from('leaves').select('*').eq('user_id',userId).order('applied_at',{ascending:false});
    if (error) throw error;
    if (!leaves||!leaves.length) { list.innerHTML='<div class="empty-state"><div class="ei">🗓</div><p>No leave requests yet. Click "+ Apply for Leave" to submit one.</p></div>'; return; }
    list.innerHTML=leaves.map(l=>{
      const dates=JSON.parse(l.dates||'[]');
      const noteClass=l.status==='approved'?'approved-note':l.status==='rejected'?'rejected-note':'';
      return `<div class="leave-card">
        <div class="leave-card-head">
          <div class="fca gap2">
            <span class="badge ${l.leave_type==='half'?'b-p-medium':'b-p-high'}">${l.leave_type==='half'?'Half Day':'Full Day'}</span>
            ${leaveBadge(l.status)}
          </div>
          <span class="tsm t3 mono">${T.fmtDateTime(l.applied_at)}</span>
        </div>
        <div class="leave-dates">${dates.map(d=>`<span class="leave-date-tag">${d}</span>`).join('')}</div>
        <p class="leave-reason">"${l.reason}"</p>
        ${l.admin_note?`<div class="leave-admin-note ${noteClass}">📝 Admin: ${l.admin_note}</div>`:''}
        ${l.status==='pending'?`<div class="leave-actions"><button class="btn btn-danger btn-sm" onclick="cancelLeave('${l.id}')">✕ Cancel Request</button></div>`:''}
      </div>`;
    }).join('');
  } catch(e) { console.error('loadMyLeaves:',e); list.innerHTML='<div class="empty-state"><div class="ei">⚠️</div><p>Error loading leaves</p></div>'; }
}

async function cancelLeave(id) {
  if (!confirm('Cancel this leave request?')) return;
  try {
    await db.from('leaves').delete().eq('id',id).eq('user_id',userId).eq('status','pending');
    showToast('Leave request cancelled','success'); loadMyLeaves();
  } catch(e) { showToast('Error cancelling leave','error'); }
}

// ---- NAV ----
function showSec(name,btn) {
  document.querySelectorAll('main section').forEach(s=>s.style.display='none');
  const sec=document.getElementById('sec-'+name); if(sec) sec.style.display='block';
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if(name==='tasks')  loadEmpTasks();
  if(name==='breaks') updateBreakLog();
  if(name==='leaves') loadMyLeaves();
}

// ---- IDLE DETECTION ----
function startIdleDetection() {
  let last=Date.now();
  ['mousemove','keydown','click','touchstart'].forEach(ev=>document.addEventListener(ev,()=>{ last=Date.now(); if(idleShown) dismissIdle(); },{passive:true}));
  idleTimerId=setInterval(()=>{ if(localState.status!=='online') return; if(!idleShown&&Date.now()-last>5*60*1000){ idleShown=true; const ol=document.getElementById('idle-overlay'); if(ol) ol.classList.add('show'); } },30000);
}
function dismissIdle() { idleShown=false; const ol=document.getElementById('idle-overlay'); if(ol) ol.classList.remove('show'); }

// ---- START ----
init();
