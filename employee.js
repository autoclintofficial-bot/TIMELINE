// employee.js — Full featured
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
let leaveDates=[];          // selected dates for apply-leave modal
let calPickerYear=0, calPickerMonth=0;
let dashKanbanExpanded=false;
let leaveCalYear=0, leaveCalMonth=0;

// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════
async function init() {
  const now=new Date(), h=now.getHours();
  const greet=h<5?'Good night':h<12?'Good morning':h<17?'Good afternoon':'Good evening';
  const icon=h<12?'☀️':h<17?'🌤':'🌆';
  const g=document.getElementById('greeting'); if(g) g.textContent=`${greet}, ${session.name}! ${icon}`;
  const d=document.getElementById('emp-date'); if(d) d.textContent=now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const l=document.getElementById('i-login'); if(l) l.textContent=T.fmtTime(session.loginTime);
  localState.settings = await getSettings();
  const bwm=document.getElementById('bw-max'); if(bwm) bwm.textContent=localState.settings.max_break_minutes;
  // Set default incentive date to today
  const nd=document.getElementById('ni-date'); if(nd) nd.value=T.todayKey();
  await syncStateFromDB();
  startClock();
  startIdleDetection();
  renderTimers();
  updateBreakLog();
  // Init dashboard extras
  loadDashKanban();
  initLeaveCalendar();
}

// ═══════════════════════════════════════════════
//  SYNC FROM DB
// ═══════════════════════════════════════════════
async function syncStateFromDB() {
  try {
    const { data:rec }=await db.from('attendance').select('*').eq('user_id',userId).eq('date_key',T.todayKey()).maybeSingle();
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
    const oe=document.getElementById('i-online'); if(oe) oe.textContent=localState.onlineTime?T.fmtTime(localState.onlineTime):'--';
    const be=document.getElementById('i-brk'); if(be) be.textContent=localState.openBreakType||'--';
    if (localState.status==='online')     { setUIOnline(); startWorkTimer(); }
    else if (localState.status==='break') { setUIBreak(localState.openBreakType); startWorkTimer(); }
    else                                  { setUIOffline(); }
  } catch(e) { console.error('syncStateFromDB:',e); }
}

// ═══════════════════════════════════════════════
//  CLOCK + TIMERS
// ═══════════════════════════════════════════════
function startClock() {
  if(clockIntervalId) clearInterval(clockIntervalId);
  clockIntervalId=setInterval(()=>{ const el=document.getElementById('clock'); if(el) el.textContent=new Date().toLocaleTimeString('en-US'); },1000);
}
function startWorkTimer()  { stopWorkTimer(); workIntervalId=setInterval(renderTimers,1000); }
function stopWorkTimer()   { if(workIntervalId){ clearInterval(workIntervalId); workIntervalId=null; } }

function renderTimers() {
  const s=localState.settings||{daily_score:10,max_break_minutes:60,penalty_interval_minutes:10,penalty_points:1,duty_hours:9};
  const now=Date.now();
  let breakSec=localState.totalBreakSec, workSec=0;
  if (localState.status==='break'&&localState.openBreakStart) breakSec+=Math.floor((now-new Date(localState.openBreakStart))/1000);
  if (localState.status==='offline') { workSec=localState.workingSec; breakSec=localState.totalBreakSec; }
  else if (localState.onlineTime) { workSec=Math.max(0,Math.floor((now-new Date(localState.onlineTime))/1000)-breakSec); }
  const dutyTotal=s.duty_hours*3600, maxBreak=s.max_break_minutes*60;
  const breakLeft=Math.max(0,maxBreak-breakSec), dutyLeft=Math.max(0,dutyTotal-workSec);
  const score=calcScoreSync(breakSec,s);
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  const sp=(id,p)=>{const el=document.getElementById(id);if(el)el.style.width=Math.min(100,p)+'%';};
  set('work-timer',T.fmt(workSec)); set('w-card',T.fmt(workSec)); set('b-card',T.fmt(breakSec));
  set('br-card',T.fmt(breakLeft)); set('d-card',T.fmt(dutyLeft));
  const wp=dutyTotal>0?(workSec/dutyTotal)*100:0, bp=maxBreak>0?(breakSec/maxBreak)*100:0;
  sp('w-prog',wp); sp('b-prog',bp); sp('br-prog',maxBreak>0?(breakLeft/maxBreak)*100:100); sp('d-prog',wp);
  const bpel=document.getElementById('b-prog'); if(bpel) bpel.style.background=breakSec>maxBreak?'linear-gradient(90deg,var(--red),#f87171)':'linear-gradient(90deg,var(--orange),#fbbf24)';
  set('w-lbl',`${Math.round(wp)}% of ${s.duty_hours}h duty`);
  set('b-lbl',`${Math.round(breakSec/60)} min used of ${s.max_break_minutes}`);
  set('br-lbl',`${Math.round(breakLeft/60)} min left`); set('d-lbl',`${Math.round(wp)}% complete`);
  const isGood=score>=s.daily_score;
  const sr=document.getElementById('score-ring'); if(sr){ sr.textContent=score; sr.className=`score-ring ${isGood?'sr-good':'sr-bad'}`; }
  const sl=document.getElementById('score-label'); if(sl){ sl.textContent=isGood?'Perfect Score ✓':'Penalty Applied ⚠'; sl.style.color=isGood?'var(--green)':'var(--red)'; }
  const sd=document.getElementById('score-detail'); if(sd){ const x=Math.max(0,breakSec-maxBreak); sd.textContent=x>0?`+${Math.round(x/60)} min over limit`:'No penalties'; }
  if (!breakWarned&&localState.status!=='offline'&&breakSec>=maxBreak*0.8&&breakSec<maxBreak) {
    breakWarned=true;
    const bwl=document.getElementById('bw-left'); if(bwl) bwl.textContent=Math.round(breakLeft/60)+' min';
    openModal('m-brk-warn');
  }
}

// ═══════════════════════════════════════════════
//  ACTION LOCK
// ═══════════════════════════════════════════════
function lockActions(lock) {
  isActionLocked=lock;
  if(!lock) return;
  ['btn-on','btn-brk','btn-ebrk','btn-off'].forEach(id=>{const el=document.getElementById(id);if(el)el.disabled=true;});
}

// ═══════════════════════════════════════════════
//  WORK ACTIONS
// ═══════════════════════════════════════════════
async function goOnline() {
  if(isActionLocked) return; lockActions(true);
  const now=T.now(), today=T.todayKey();
  try {
    const { data:ex }=await db.from('attendance').select('*').eq('user_id',userId).eq('date_key',today).maybeSingle();
    if (ex) await db.from('attendance').update({status:'online',online_time:ex.online_time||now,login_time:ex.login_time||now}).eq('id',ex.id);
    else await db.from('attendance').insert({id:`att_${userId}_${today}`,user_id:userId,date_key:today,login_time:now,online_time:now,status:'online',total_break_sec:0,working_sec:0,score:null});
    await syncStateFromDB(); showToast('You are now Online 🟢','success'); breakWarned=false; renderTimers(); startWorkTimer();
  } catch(e) { showToast('Error: '+e.message,'error'); lockActions(false); setUIOffline(); }
}

async function takeBreak() {
  if(isActionLocked) return; lockActions(true);
  const type=document.getElementById('break-type')?.value||'Short Break';
  const now=T.now(), today=T.todayKey();
  try {
    const settings=await getSettings();
    if(localState.totalBreakSec>=settings.max_break_minutes*60){ showToast('Break limit reached!','error'); lockActions(false); setUIOnline(); return; }
    await db.from('breaks').insert({id:`brk_${userId}_${Date.now()}`,user_id:userId,date_key:today,type,start_time:now,end_time:null,duration_sec:0});
    await db.from('attendance').update({status:'break'}).eq('user_id',userId).eq('date_key',today);
    await syncStateFromDB(); showToast(`${type} started ☕`,'info'); renderTimers();
  } catch(e) { showToast('Error: '+e.message,'error'); lockActions(false); setUIOnline(); }
}

async function endBreak() {
  if(isActionLocked) return; lockActions(true);
  const now=T.now(), today=T.todayKey();
  try {
    const { data:ob }=await db.from('breaks').select('*').eq('user_id',userId).is('end_time',null).maybeSingle();
    if(ob){ const dur=T.diff(ob.start_time,now); await db.from('breaks').update({end_time:now,duration_sec:dur}).eq('id',ob.id); const { data:rec }=await db.from('attendance').select('total_break_sec').eq('user_id',userId).eq('date_key',today).maybeSingle(); await db.from('attendance').update({status:'online',total_break_sec:((rec?.total_break_sec)||0)+dur}).eq('user_id',userId).eq('date_key',today); }
    else await db.from('attendance').update({status:'online'}).eq('user_id',userId).eq('date_key',today);
    await syncStateFromDB(); showToast('Break ended ✓','success'); renderTimers(); updateBreakLog();
  } catch(e) { showToast('Error: '+e.message,'error'); lockActions(false); setUIOnline(); }
}

async function goOffline() {
  if(isActionLocked) return; lockActions(true);
  const now=T.now(), today=T.todayKey();
  try {
    const { data:ob }=await db.from('breaks').select('*').eq('user_id',userId).is('end_time',null).maybeSingle();
    let totalBreakSec=localState.totalBreakSec;
    if(ob){ const dur=T.diff(ob.start_time,now); await db.from('breaks').update({end_time:now,duration_sec:dur}).eq('id',ob.id); totalBreakSec+=dur; }
    const workSec=localState.onlineTime?Math.max(0,T.diff(localState.onlineTime,now)-totalBreakSec):0;
    const settings=localState.settings||await getSettings();
    const score=calcScoreSync(totalBreakSec,settings);
    await db.from('attendance').update({status:'offline',offline_time:now,working_sec:workSec,total_break_sec:totalBreakSec,score}).eq('user_id',userId).eq('date_key',today);
    await syncStateFromDB(); stopWorkTimer(); showToast(`Offline. Score: ${score}/${settings.daily_score}`,score>=settings.daily_score?'success':'warning'); renderTimers(); updateBreakLog();
  } catch(e) { showToast('Error: '+e.message,'error'); lockActions(false); setUIOnline(); }
}

// ═══════════════════════════════════════════════
//  UI STATES
// ═══════════════════════════════════════════════
function setUIOnline() {
  isActionLocked=false;
  const p=document.getElementById('status-panel'); if(p) p.className='status-panel s-online';
  const r=document.getElementById('status-ring'); if(r) r.className='status-ring r-online';
  const em=document.getElementById('s-emoji'); if(em) em.textContent='💼';
  const lb=document.getElementById('s-label'); if(lb) lb.textContent='Online';
  const sd=(id,v,dp)=>{const el=document.getElementById(id);if(el){el.disabled=v;if(dp!==undefined)el.style.display=dp;}};
  sd('btn-on',true); sd('btn-brk',false); sd('btn-ebrk',true,'none'); sd('btn-off',false);
  const bs=document.getElementById('break-select-row'); if(bs) bs.style.display='block';
}
function setUIBreak(type) {
  isActionLocked=false;
  const em={'Lunch':'🍽','Short Break':'☕','Spiritual Break':'🙏','Washroom':'🚻'};
  const p=document.getElementById('status-panel'); if(p) p.className='status-panel s-break';
  const r=document.getElementById('status-ring'); if(r) r.className='status-ring r-break';
  const se=document.getElementById('s-emoji'); if(se) se.textContent=em[type]||'☕';
  const lb=document.getElementById('s-label'); if(lb) lb.textContent=type||'On Break';
  const sd=(id,v,dp)=>{const el=document.getElementById(id);if(el){el.disabled=v;if(dp!==undefined)el.style.display=dp;}};
  sd('btn-on',true); sd('btn-brk',true); sd('btn-ebrk',false,'inline-flex'); sd('btn-off',true);
  const bs=document.getElementById('break-select-row'); if(bs) bs.style.display='none';
  const ib=document.getElementById('i-brk'); if(ib) ib.textContent=type||'On Break';
}
function setUIOffline() {
  isActionLocked=false;
  const p=document.getElementById('status-panel'); if(p) p.className='status-panel s-offline';
  const r=document.getElementById('status-ring'); if(r) r.className='status-ring r-offline';
  const em=document.getElementById('s-emoji'); if(em) em.textContent='💤';
  const lb=document.getElementById('s-label'); if(lb) lb.textContent='Offline';
  const sd=(id,v,dp)=>{const el=document.getElementById(id);if(el){el.disabled=v;if(dp!==undefined)el.style.display=dp;}};
  sd('btn-on',false); sd('btn-brk',true); sd('btn-ebrk',true,'none'); sd('btn-off',true);
  const bs=document.getElementById('break-select-row'); if(bs) bs.style.display='none';
  const ib=document.getElementById('i-brk'); if(ib) ib.textContent='--';
  stopWorkTimer();
}

// ═══════════════════════════════════════════════
//  BREAK LOG
// ═══════════════════════════════════════════════
async function updateBreakLog() {
  const c=document.getElementById('brk-log'); if(!c) return;
  try {
    const { data:brks }=await db.from('breaks').select('*').eq('user_id',userId).eq('date_key',T.todayKey()).order('start_time');
    const bc=document.getElementById('i-brkcount'); if(bc) bc.textContent=brks?brks.length:0;
    if(!brks||!brks.length){ c.innerHTML='<div class="empty-state"><div class="ei">☕</div><p>No breaks today</p></div>'; return; }
    const em={'Lunch':'🍽','Short Break':'☕','Spiritual Break':'🙏','Washroom':'🚻'};
    c.innerHTML=`<div class="brk-list">${brks.map(b=>`<div class="brk-item"><span class="brk-type">${em[b.type]||'☕'} ${b.type}</span><span class="brk-time">${T.fmtTime(b.start_time)} → ${b.end_time?T.fmtTime(b.end_time):'...'}</span><span class="brk-dur">${b.end_time?T.fmt(b.duration_sec):'...'}</span></div>`).join('')}</div>`;
  } catch(e){ console.error(e); }
}

// ═══════════════════════════════════════════════
//  DASHBOARD MINI KANBAN
// ═══════════════════════════════════════════════
async function loadDashKanban() {
  try {
    const { data:tasks }=await db.from('tasks').select('*').eq('assigned_to',userId).in('stage',['todo','inprogress','review','done']).order('created_at',{ascending:false}).limit(20);
    const stages=['todo','inprogress','review','done'];
    const counts={todo:0,inprogress:0,review:0,done:0};
    stages.forEach(s=>{ const col=document.getElementById('dk-col-'+s); if(col) col.innerHTML=''; });
    for(const t of (tasks||[])){
      counts[t.stage]=(counts[t.stage]||0)+1;
      const col=document.getElementById('dk-col-'+t.stage); if(!col) continue;
      const card=document.createElement('div');
      card.className='task-card'; card.style.padding='.625rem';
      card.innerHTML=`<div class="task-priority-strip strip-${t.priority}"></div><div class="task-card-title" style="font-size:.8rem">${t.title}</div>${t.deadline?`<div class="tsm ${deadlineClass(t.deadline)} mt1">${deadlineText(t.deadline)}</div>`:''}`;
      card.onclick=()=>openEmpTaskDetail(t.id);
      col.appendChild(card);
    }
    stages.forEach(s=>{ const cnt=document.getElementById('dk-cnt-'+s); if(cnt) cnt.textContent=counts[s]||0; const col=document.getElementById('dk-col-'+s); if(col&&!col.children.length) col.innerHTML='<div class="empty-col" style="min-height:60px;font-size:.75rem">Empty</div>'; });
    // Show "show all" button if review or done have tasks
    const showBtn=document.getElementById('dk-show-all-btn');
    if(showBtn&&(counts.review>0||counts.done>0)) showBtn.style.display='inline-flex';
  } catch(e){ console.error('loadDashKanban:',e); }
}

function toggleDashKanban() {
  dashKanbanExpanded=!dashKanbanExpanded;
  ['dk-col-review-wrap','dk-col-done-wrap'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display=dashKanbanExpanded?'block':'none'; });
  const btn=document.getElementById('dk-show-all-btn');
  if(btn) btn.textContent=dashKanbanExpanded?'Hide Review & Done ▲':'Show Review & Done ▼';
  // Switch kanban between 2 and 4 cols
  const kb=document.getElementById('dash-kanban');
  if(kb) kb.className=dashKanbanExpanded?'kanban':'kanban kanban-sm';
}

// ═══════════════════════════════════════════════
//  LEAVE DISPLAY CALENDAR (dashboard)
// ═══════════════════════════════════════════════
function initLeaveCalendar() {
  const now=new Date(); leaveCalYear=now.getFullYear(); leaveCalMonth=now.getMonth();
  renderLeaveCalendar();
}

async function renderLeaveCalendar() {
  const container=document.getElementById('dash-leave-cal'); if(!container) return;
  const year=leaveCalYear, month=leaveCalMonth;
  const firstDay=new Date(year,month,1);
  const daysInMonth=new Date(year,month+1,0).getDate();
  const startDow=firstDay.getDay();
  const monthName=firstDay.toLocaleString('en-US',{month:'long',year:'numeric'});

  // Load leaves for this month
  const startKey=`${year}-${String(month+1).padStart(2,'0')}-01`;
  const endKey=`${year}-${String(month+1).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;
  let leaveMap={};
  try {
    const { data:leaves }=await db.from('leaves').select('*').eq('user_id',userId).neq('status','rejected');
    (leaves||[]).forEach(l=>{
      const dates=JSON.parse(l.dates||'[]');
      dates.forEach(dk=>{ if(dk>=startKey&&dk<=endKey) leaveMap[dk]={type:l.leave_type,status:l.status}; });
    });
  } catch(e){ console.error(e); }

  const todayKey=T.todayKey();
  const days=['Su','Mo','Tu','We','Th','Fr','Sa'];
  let html=`<div class="leave-cal-wrap">
    <div class="leave-cal-head">
      <button class="leave-cal-nav" onclick="leaveCalNav(-1)">‹</button>
      <span class="leave-cal-title">${monthName}</span>
      <button class="leave-cal-nav" onclick="leaveCalNav(1)">›</button>
    </div>
    <div class="leave-cal-grid">
    ${days.map(d=>`<div class="lc-dh">${d}</div>`).join('')}`;

  for(let i=0;i<startDow;i++) html+=`<div class="lc-day lc-empty"></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const dk=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const leave=leaveMap[dk];
    let cls='lc-day';
    if(dk===todayKey) cls+=' lc-today';
    let tooltip='';
    if(leave){
      cls+=leave.type==='full'?' lc-leave-full':' lc-leave-half';
      tooltip=`<div class="leave-tooltip">${leave.type==='full'?'Full':'Half'} Day — ${leave.status}</div>`;
    }
    html+=`<div class="${cls}" title="${dk}">${d}${tooltip}</div>`;
  }
  html+=`</div>
    <div class="leave-cal-legend">
      <div class="legend-item"><div class="legend-dot ld-full"></div>Full Day</div>
      <div class="legend-item"><div class="legend-dot ld-half"></div>Half Day</div>
      <div class="legend-item"><div class="legend-dot ld-pending"></div>Pending</div>
    </div>
  </div>`;
  container.innerHTML=html;
}

function leaveCalNav(dir){ leaveCalMonth+=dir; if(leaveCalMonth>11){leaveCalMonth=0;leaveCalYear++;} if(leaveCalMonth<0){leaveCalMonth=11;leaveCalYear--;} renderLeaveCalendar(); }

// ═══════════════════════════════════════════════
//  CALENDAR PICKER (for apply leave modal)
// ═══════════════════════════════════════════════
function openApplyLeave() {
  leaveDates=[];
  const now=new Date(); calPickerYear=now.getFullYear(); calPickerMonth=now.getMonth();
  renderDateChips();
  renderCalPicker();
  openModal('m-apply-leave');
}

function calPickerNav(dir){
  calPickerMonth+=dir;
  if(calPickerMonth>11){calPickerMonth=0;calPickerYear++;}
  if(calPickerMonth<0){calPickerMonth=11;calPickerYear--;}
  renderCalPicker();
}

function renderCalPicker() {
  const titleEl=document.getElementById('cp-title');
  const gridEl=document.getElementById('cp-grid');
  if(!titleEl||!gridEl) return;
  const year=calPickerYear, month=calPickerMonth;
  const firstDay=new Date(year,month,1);
  const daysInMonth=new Date(year,month+1,0).getDate();
  const startDow=firstDay.getDay();
  const monthName=firstDay.toLocaleString('en-US',{month:'long',year:'numeric'});
  titleEl.textContent=monthName;
  const today=new Date(); today.setHours(0,0,0,0);
  const days=['Su','Mo','Tu','We','Th','Fr','Sa'];
  let html=days.map(d=>`<div class="cal-picker-dh">${d}</div>`).join('');
  for(let i=0;i<startDow;i++) html+=`<div class="cal-picker-day cpd-empty"></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const dk=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayDate=new Date(year,month,d);
    const isPast=dayDate<today;
    const isToday=dk===T.todayKey();
    const isSel=leaveDates.includes(dk);
    let cls='cal-picker-day';
    if(isPast) cls+=' cpd-past';
    else if(isSel) cls+=' cpd-selected';
    else if(isToday) cls+=' cpd-today';
    const click=isPast?'':`onclick="toggleLeaveDate('${dk}')"`;
    html+=`<div class="${cls}" ${click}>${d}</div>`;
  }
  gridEl.innerHTML=html;
}

function toggleLeaveDate(dk) {
  if(leaveDates.includes(dk)) leaveDates=leaveDates.filter(x=>x!==dk);
  else leaveDates.push(dk);
  leaveDates.sort();
  renderDateChips();
  renderCalPicker();
}

function renderDateChips() {
  const c=document.getElementById('al-date-chips'); if(!c) return;
  if(!leaveDates.length){ c.innerHTML='<span class="tsm t3">No dates selected</span>'; return; }
  c.innerHTML=leaveDates.map(d=>`<div class="date-chip"><span>${d}</span><span class="date-chip-remove" onclick="removeLeaveDate('${d}')">✕</span></div>`).join('');
}
function removeLeaveDate(date){ leaveDates=leaveDates.filter(d=>d!==date); renderDateChips(); renderCalPicker(); }

async function submitLeave() {
  const type=document.getElementById('al-type')?.value||'full';
  const reason=document.getElementById('al-reason')?.value.trim()||'';
  if(!leaveDates.length){ showToast('Select at least one date on the calendar','error'); return; }
  if(!reason){ showToast('Please enter a reason','error'); return; }
  try {
    await db.from('leaves').insert({id:`leave_${userId}_${Date.now()}`,user_id:userId,leave_type:type,dates:JSON.stringify(leaveDates),reason,status:'pending',admin_note:'',applied_at:T.now()});
    showToast('Leave request submitted ✓','success');
    closeModal('m-apply-leave');
    leaveDates=[]; renderDateChips();
    const ar=document.getElementById('al-reason'); if(ar) ar.value='';
    loadMyLeaves();
    renderLeaveCalendar();
  } catch(e){ showToast('Error: '+e.message,'error'); }
}

// ═══════════════════════════════════════════════
//  MY LEAVES LIST
// ═══════════════════════════════════════════════
async function loadMyLeaves() {
  const list=document.getElementById('my-leaves-list'); if(!list) return;
  list.innerHTML='<div class="loading"><div class="spinner"></div></div>';
  try {
    const { data:leaves }=await db.from('leaves').select('*').eq('user_id',userId).order('applied_at',{ascending:false});
    if(!leaves||!leaves.length){ list.innerHTML='<div class="empty-state"><div class="ei">🗓</div><p>No leave requests yet.</p></div>'; return; }
    list.innerHTML=leaves.map(l=>{
      const dates=JSON.parse(l.dates||'[]');
      const noteClass=l.status==='approved'?'approved-note':l.status==='rejected'?'rejected-note':'';
      return `<div class="leave-card">
        <div class="leave-card-head">
          <div class="fca gap2"><span class="badge ${l.leave_type==='half'?'b-p-medium':'b-p-high'}">${l.leave_type==='half'?'Half Day':'Full Day'}</span>${leaveBadge(l.status)}</div>
          <span class="tsm t3 mono">${T.fmtDateTime(l.applied_at)}</span>
        </div>
        <div class="leave-dates">${dates.map(d=>`<span class="leave-date-tag">${d}</span>`).join('')}</div>
        <p class="leave-reason">"${l.reason}"</p>
        ${l.admin_note?`<div class="leave-admin-note ${noteClass}">📝 Admin: ${l.admin_note}</div>`:''}
        ${l.status==='pending'?`<div class="leave-actions"><button class="btn btn-danger btn-sm" onclick="cancelLeave('${l.id}')">✕ Cancel Request</button></div>`:''}
      </div>`;
    }).join('');
  } catch(e){ list.innerHTML='<div class="empty-state"><div class="ei">⚠️</div><p>Error loading leaves</p></div>'; }
}

async function cancelLeave(id) {
  if(!confirm('Cancel this leave request?')) return;
  try {
    await db.from('leaves').delete().eq('id',id).eq('user_id',userId).eq('status','pending');
    showToast('Cancelled','success'); loadMyLeaves(); renderLeaveCalendar();
  } catch(e){ showToast('Error','error'); }
}

// ═══════════════════════════════════════════════
//  TASKS
// ═══════════════════════════════════════════════
async function loadEmpTasks() {
  try {
    const { data:tasks }=await db.from('tasks').select('*').eq('assigned_to',userId).order('created_at',{ascending:false});
    const stages=['todo','inprogress','review','done'];
    const counts={todo:0,inprogress:0,review:0,done:0};
    stages.forEach(s=>{ const c=document.getElementById('ek-col-'+s); if(c) c.innerHTML=''; });
    for(const t of (tasks||[])){
      counts[t.stage]=(counts[t.stage]||0)+1;
      const card=document.createElement('div'); card.className='task-card';
      card.innerHTML=`<div class="task-priority-strip strip-${t.priority}"></div><div class="task-card-title">${t.title}</div>${t.description?`<p class="tsm t3" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:.4rem">${t.description}</p>`:''}<div class="task-card-meta">${priorityBadge(t.priority)}${t.deadline?`<span class="task-deadline ${deadlineClass(t.deadline)}">${deadlineText(t.deadline)}</span>`:''}</div>`;
      card.onclick=()=>openEmpTaskDetail(t.id);
      const col=document.getElementById('ek-col-'+t.stage); if(col) col.appendChild(card);
    }
    stages.forEach(s=>{ const cnt=document.getElementById('ek-cnt-'+s); if(cnt) cnt.textContent=counts[s]||0; const col=document.getElementById('ek-col-'+s); if(col&&!col.children.length) col.innerHTML='<div class="empty-col">✦<span>No tasks</span></div>'; });
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    set('tst-todo',counts.todo); set('tst-ip',counts.inprogress); set('tst-rv',counts.review); set('tst-dn',counts.done);
  } catch(e){ console.error(e); }
}

async function openEmpTaskDetail(id) {
  detailTaskId=id;
  try {
    const { data:t }=await db.from('tasks').select('*').eq('id',id).single(); if(!t) return;
    let aname=t.assigned_by;
    try{ const { data:a }=await db.from('users').select('name').eq('id',t.assigned_by).single(); if(a) aname=a.name; }catch{}
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    const sh=(id,v)=>{const el=document.getElementById(id);if(el)el.innerHTML=v;};
    const sv=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;};
    set('etd-title',t.title); set('etd-desc',t.description||'No description'); set('etd-by',aname);
    sh('etd-priority',priorityBadge(t.priority)); sh('etd-stage',stageBadge(t.stage));
    sh('etd-deadline',t.deadline?`<span class="${deadlineClass(t.deadline)}">${deadlineText(t.deadline)}</span>`:'—');
    sv('etd-stage-sel',t.stage); sv('etd-id',id);
    await empLoadTaskAttachments(id); await empLoadComments(id);
    openModal('m-emp-task-detail');
  } catch(e){ showToast('Could not load task','error'); }
}

async function empLoadTaskAttachments(taskId) {
  const list=document.getElementById('etd-attachments'); if(!list) return;
  try {
    const { data:atts }=await db.from('task_attachments').select('*').eq('task_id',taskId).order('created_at');
    if(!atts||!atts.length){ list.innerHTML='<p class="tsm t3 mb1">No attachments yet</p>'; return; }
    list.innerHTML=atts.map(a=>`<div class="attach-item"><div class="attach-item-info"><span class="attach-icon">${fileIcon(a.file_type)}</span><div><div class="attach-name">${a.file_name}</div><div class="attach-size">${fmtFileSize(a.file_size)}</div></div></div><a href="${a.file_url}" target="_blank" class="btn btn-sm btn-outline">↗ Open</a></div>`).join('');
  } catch(e){ console.error(e); }
}

async function empUploadAttachments(input) {
  if(!input.files||!input.files.length||!detailTaskId) return;
  let uploaded=0;
  for(const file of [...input.files]){
    if(file.size>10*1024*1024){ showToast(`${file.name} exceeds 10MB`,'warning'); continue; }
    try {
      const path=`${detailTaskId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
      const { error:upErr }=await db.storage.from('task-files').upload(path,file,{upsert:false});
      if(upErr) throw upErr;
      const { data:urlData }=db.storage.from('task-files').getPublicUrl(path);
      await db.from('task_attachments').insert({id:`att_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,task_id:detailTaskId,user_id:userId,file_name:file.name,file_url:urlData.publicUrl,file_type:file.type||'application/octet-stream',file_size:file.size});
      uploaded++;
    } catch(e){ showToast(`Failed: ${e.message}`,'error'); }
  }
  if(uploaded>0){ showToast(`${uploaded} file${uploaded>1?'s':''} uploaded ✓`,'success'); await empLoadTaskAttachments(detailTaskId); }
  input.value='';
}

async function empLoadComments(taskId) {
  const list=document.getElementById('etd-comments'); if(!list) return;
  try {
    const { data:comments }=await db.from('task_comments').select('*').eq('task_id',taskId).order('created_at');
    if(!comments||!comments.length){ list.innerHTML='<div class="t3 tsm" style="text-align:center;padding:1rem">No comments yet</div>'; return; }
    const ids=[...new Set(comments.map(c=>c.user_id))];
    const { data:users }=await db.from('users').select('id,name').in('id',ids);
    const nm={}; (users||[]).forEach(u=>nm[u.id]=u.name);
    list.innerHTML=comments.map(c=>`<div class="comment-item"><div><span class="comment-author">${nm[c.user_id]||c.user_id}</span><span class="comment-time">${T.fmtDateTime(c.created_at)}</span></div><div class="comment-text">${c.comment}</div></div>`).join('');
    list.scrollTop=list.scrollHeight;
  } catch(e){ console.error(e); }
}

async function empAddComment() {
  const input=document.getElementById('etd-comment-input');
  const text=input?input.value.trim():''; if(!text||!detailTaskId) return;
  try {
    await db.from('task_comments').insert({id:`cmt_${Date.now()}`,task_id:detailTaskId,user_id:userId,comment:text});
    if(input) input.value=''; await empLoadComments(detailTaskId);
  } catch(e){ showToast('Could not post comment','error'); }
}

async function empUpdateStage() {
  const id=document.getElementById('etd-id')?.value;
  const stage=document.getElementById('etd-stage-sel')?.value;
  if(!id||!stage) return;
  try {
    await db.from('tasks').update({stage,updated_at:T.now()}).eq('id',id);
    const el=document.getElementById('etd-stage'); if(el) el.innerHTML=stageBadge(stage);
    showToast('Stage updated ✓','success'); loadEmpTasks(); loadDashKanban();
  } catch(e){ showToast('Error','error'); }
}

// ═══════════════════════════════════════════════
//  INCENTIVES
// ═══════════════════════════════════════════════
async function loadMyIncentives() {
  const list=document.getElementById('my-incentives-list'); if(!list) return;
  list.innerHTML='<div class="loading"><div class="spinner"></div></div>';
  const statusFilter=document.getElementById('inc-filter-status')?.value||'';
  const monthFilter=document.getElementById('inc-filter-month')?.value||'';
  try {
    let q=db.from('incentives').select('*').eq('user_id',userId).order('submitted_at',{ascending:false});
    if(statusFilter) q=q.eq('status',statusFilter);
    const { data:all }=await db.from('incentives').select('*').eq('user_id',userId);
    const { data:items }=await q;

    // Totals from all (unfiltered)
    let totApproved=0,totPending=0,totRejected=0,cntA=0,cntP=0,cntR=0;
    (all||[]).forEach(i=>{
      if(i.status==='approved'){ totApproved+=parseFloat(i.amount||0); cntA++; }
      else if(i.status==='pending'){ totPending+=parseFloat(i.amount||0); cntP++; }
      else if(i.status==='rejected'){ totRejected+=parseFloat(i.amount||0); cntR++; }
    });
    const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
    set('inc-total-approved',`₹${totApproved.toFixed(2)}`);
    set('inc-count-approved',`${cntA} entr${cntA===1?'y':'ies'}`);
    set('inc-total-pending',`₹${totPending.toFixed(2)}`);
    set('inc-count-pending',`${cntP} entr${cntP===1?'y':'ies'}`);
    set('inc-total-rejected',`₹${totRejected.toFixed(2)}`);
    set('inc-count-rejected',`${cntR} entr${cntR===1?'y':'ies'}`);

    // Filter by month client-side
    let filtered=items||[];
    if(monthFilter){ filtered=filtered.filter(i=>i.date&&i.date.startsWith(monthFilter)); }

    if(!filtered.length){ list.innerHTML='<div class="empty-state"><div class="ei">💰</div><p>No incentive entries found.</p></div>'; return; }

    // Running total for filtered
    const runTotal=filtered.filter(i=>i.status==='approved').reduce((s,i)=>s+parseFloat(i.amount||0),0);
    const runPending=filtered.filter(i=>i.status==='pending').reduce((s,i)=>s+parseFloat(i.amount||0),0);

    list.innerHTML=`
      ${filtered.length>0&&monthFilter?`<div class="card card-sm mb2"><div class="fcb"><span class="tsm t2">${monthFilter} — Approved</span><span class="incentive-amount" style="font-size:1.25rem">₹${runTotal.toFixed(2)}</span></div>${runPending>0?`<div class="tsm t3 mt1">+ ₹${runPending.toFixed(2)} pending</div>`:''}</div>`:''}
      ${filtered.map(i=>`
      <div class="incentive-card">
        <div class="incentive-card-head">
          <div class="fca gap2">
            <span class="tsm t3 mono">${i.date}</span>
            <span class="incentive-order">Order: ${i.order_id}</span>
          </div>
          <div class="fca gap2">
            <span class="incentive-amount-sm ${i.status==='approved'?'amt-approved':i.status==='pending'?'amt-pending':'amt-rejected'}">₹${parseFloat(i.amount).toFixed(2)}</span>
            ${incBadge(i.status)}
          </div>
        </div>
        ${i.remark?`<p class="tsm t2">${i.remark}</p>`:''}
        ${i.admin_note?`<div class="leave-admin-note ${i.status==='approved'?'approved-note':'rejected-note'} mt1">📝 ${i.admin_note}</div>`:''}
        ${i.status==='pending'?`<div class="leave-actions"><button class="btn btn-danger btn-sm" onclick="deleteMyIncentive('${i.id}')">✕ Delete</button></div>`:''}
      </div>`).join('')}`;
  } catch(e){ console.error(e); list.innerHTML='<div class="empty-state"><div class="ei">⚠️</div><p>Error loading incentives</p></div>'; }
}

function incBadge(s){ const map={pending:'b-pending',approved:'b-approved',rejected:'b-rejected'}; return `<span class="badge ${map[s]||'b-pending'}">${s}</span>`; }

async function submitIncentive() {
  const date=document.getElementById('ni-date')?.value;
  const order=document.getElementById('ni-order')?.value.trim();
  const remark=document.getElementById('ni-remark')?.value.trim()||'';
  const amount=parseFloat(document.getElementById('ni-amount')?.value||'0');
  if(!date||!order){ showToast('Date and Order ID are required','error'); return; }
  if(isNaN(amount)||amount<=0){ showToast('Enter a valid amount greater than 0','error'); return; }
  try {
    await db.from('incentives').insert({id:`inc_${userId}_${Date.now()}`,user_id:userId,date,order_id:order,remark,amount,status:'pending',admin_note:'',submitted_at:T.now()});
    showToast('Incentive submitted ✓','success');
    closeModal('m-add-incentive');
    // Reset form
    ['ni-order','ni-remark','ni-amount'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    const nd=document.getElementById('ni-date'); if(nd) nd.value=T.todayKey();
    loadMyIncentives();
  } catch(e){ showToast('Error: '+e.message,'error'); }
}

async function deleteMyIncentive(id) {
  if(!confirm('Delete this incentive entry?')) return;
  try {
    await db.from('incentives').delete().eq('id',id).eq('user_id',userId).eq('status','pending');
    showToast('Deleted','success'); loadMyIncentives();
  } catch(e){ showToast('Error','error'); }
}

async function exportMyIncentivesCSV() {
  try {
    const { data:items }=await db.from('incentives').select('*').eq('user_id',userId).order('date');
    if(!items||!items.length){ showToast('No incentives to export','warning'); return; }
    const headers=['Date','Order ID','Remark','Amount','Status','Admin Note','Submitted'];
    const rows=items.map(i=>[i.date,i.order_id,i.remark,parseFloat(i.amount||0).toFixed(2),i.status,i.admin_note||'',T.fmtDateTime(i.submitted_at)]);
    const totApproved=items.filter(i=>i.status==='approved').reduce((s,i)=>s+parseFloat(i.amount||0),0);
    rows.push(['','','APPROVED TOTAL',totApproved.toFixed(2),'','','']);
    const csv=[headers,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
    a.download=`incentives_${session.name}_${T.todayKey()}.csv`;
    a.click(); showToast('Exported ✓','success');
  } catch(e){ showToast('Error exporting','error'); }
}

// ═══════════════════════════════════════════════
//  NAV
// ═══════════════════════════════════════════════
function showSec(name,btn) {
  document.querySelectorAll('main section').forEach(s=>s.style.display='none');
  const sec=document.getElementById('sec-'+name); if(sec) sec.style.display='block';
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if(name==='tasks')      loadEmpTasks();
  if(name==='breaks')     updateBreakLog();
  if(name==='leaves')     loadMyLeaves();
  if(name==='incentives') loadMyIncentives();
}

// ═══════════════════════════════════════════════
//  IDLE DETECTION
// ═══════════════════════════════════════════════
function startIdleDetection() {
  let last=Date.now();
  ['mousemove','keydown','click','touchstart'].forEach(ev=>document.addEventListener(ev,()=>{ last=Date.now(); if(idleShown) dismissIdle(); },{passive:true}));
  idleTimerId=setInterval(()=>{ if(localState.status!=='online') return; if(!idleShown&&Date.now()-last>5*60*1000){ idleShown=true; const ol=document.getElementById('idle-overlay'); if(ol) ol.classList.add('show'); } },30000);
}
function dismissIdle(){ idleShown=false; const ol=document.getElementById('idle-overlay'); if(ol) ol.classList.remove('show'); }

// ═══════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════
init();
