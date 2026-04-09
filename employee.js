// employee.js
if (!Session.requireEmployee()) throw new Error('Not authorized');
renderSidebarUser();

const session = Session.get();
const userId = session.id;
let workTimer = null, clockTimer = null, idleTimer = null;
let idleShown = false, breakWarned = false;
let detailTaskId = null;

// ---- INIT ----
async function init() {
  const now = new Date();
  const h = now.getHours();
  document.getElementById('greeting').textContent = `${h<5?'Good night':h<12?'Good morning':h<17?'Good afternoon':'Good evening'}, ${session.name}! ${h<12?'☀️':h<17?'🌤':'🌆'}`;
  document.getElementById('emp-date').textContent = now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  document.getElementById('i-login').textContent = T.fmtTime(session.loginTime);
  const s = await getSettings();
  document.getElementById('bw-max').textContent = s.max_break_minutes;

  // Restore today's state
  const today = T.todayKey();
  const { data: rec } = await db.from('attendance').select('*').eq('user_id',userId).eq('date_key',today).single().catch(()=>({data:null}));
  if (rec) {
    if (rec.status==='online')  { setUIOnline(); startWorkTimer(); if(rec.online_time) document.getElementById('i-online').textContent=T.fmtTime(rec.online_time); }
    else if (rec.status==='break') { setUIBreak(); startWorkTimer(); }
    else if (rec.status==='offline') { setUIOffline(); }
  }
  updateTimers();
  startClock();
  startIdleDetection();
  updateBreakLog();
}

// ---- CLOCK ----
function startClock() {
  clockTimer = setInterval(() => {
    document.getElementById('clock').textContent = new Date().toLocaleTimeString('en-US');
    updateTimers();
  }, 1000);
}

// ---- GO ONLINE ----
async function goOnline() {
  const now = T.now();
  const today = T.todayKey();
  const { data: existing } = await db.from('attendance').select('*').eq('user_id',userId).eq('date_key',today).single().catch(()=>({data:null}));
  if (existing) {
    await db.from('attendance').update({ status:'online', online_time: existing.online_time||now, login_time: existing.login_time||now }).eq('id',existing.id);
  } else {
    await db.from('attendance').insert({ id:`att_${userId}_${today}`, user_id:userId, date_key:today, login_time:now, online_time:now, status:'online', total_break_sec:0, working_sec:0, score:null });
  }
  document.getElementById('i-online').textContent = T.fmtTime(now);
  setUIOnline();
  startWorkTimer();
  showToast('You are now Online 🟢','success');
  breakWarned = false;
}

// ---- TAKE BREAK ----
async function takeBreak() {
  const type = document.getElementById('break-type').value;
  const now = T.now();
  const today = T.todayKey();
  const { data: rec } = await db.from('attendance').select('*').eq('user_id',userId).eq('date_key',today).single().catch(()=>({data:null}));
  if (!rec) return;
  const s = await getSettings();
  if ((rec.total_break_sec||0) >= s.max_break_minutes*60) { showToast('Break limit already reached!','error'); return; }
  await db.from('breaks').insert({ id:`brk_${userId}_${Date.now()}`, user_id:userId, date_key:today, type, start_time:now, end_time:null, duration_sec:0 });
  await db.from('attendance').update({ status:'break' }).eq('id',rec.id);
  document.getElementById('i-brk').textContent = type;
  setUIBreak(type);
  showToast(`${type} started ☕`,'info');
  updateBreakLog();
}

// ---- END BREAK ----
async function endBreak() {
  const now = T.now();
  const today = T.todayKey();
  const { data: openBrk } = await db.from('breaks').select('*').eq('user_id',userId).is('end_time',null).single().catch(()=>({data:null}));
  if (!openBrk) return;
  const dur = T.diff(openBrk.start_time, now);
  await db.from('breaks').update({ end_time:now, duration_sec:dur }).eq('id',openBrk.id);
  const { data: rec } = await db.from('attendance').select('*').eq('user_id',userId).eq('date_key',today).single().catch(()=>({data:null}));
  if (rec) {
    const newBreak = (rec.total_break_sec||0) + dur;
    await db.from('attendance').update({ status:'online', total_break_sec:newBreak }).eq('id',rec.id);
    checkBreakWarn(newBreak);
  }
  document.getElementById('i-brk').textContent = '--';
  setUIOnline();
  showToast(`Break ended — ${T.fmt(dur)}`,'success');
  updateBreakLog();
  updateTimers();
}

// ---- GO OFFLINE ----
async function goOffline() {
  const now = T.now();
  const today = T.todayKey();
  // Close open break if any
  const { data: openBrk } = await db.from('breaks').select('*').eq('user_id',userId).is('end_time',null).single().catch(()=>({data:null}));
  let totalBreakSec = 0;
  const { data: rec } = await db.from('attendance').select('*').eq('user_id',userId).eq('date_key',today).single().catch(()=>({data:null}));
  if (!rec) return;
  totalBreakSec = rec.total_break_sec||0;
  if (openBrk) {
    const dur = T.diff(openBrk.start_time, now);
    await db.from('breaks').update({ end_time:now, duration_sec:dur }).eq('id',openBrk.id);
    totalBreakSec += dur;
  }
  const workSec = rec.online_time ? Math.max(0, T.diff(rec.online_time,now) - totalBreakSec) : 0;
  const score = await calcScore(totalBreakSec);
  await db.from('attendance').update({ status:'offline', offline_time:now, working_sec:workSec, total_break_sec:totalBreakSec, score }).eq('id',rec.id);
  stopWorkTimer();
  setUIOffline();
  const s = await getSettings();
  showToast(`Offline. Score: ${score}/${s.daily_score}`,score>=s.daily_score?'success':'warning');
  updateTimers();
}

// ---- TIMERS ----
function startWorkTimer() { stopWorkTimer(); workTimer = setInterval(updateTimers, 1000); }
function stopWorkTimer()  { if (workTimer) { clearInterval(workTimer); workTimer=null; } }

async function updateTimers() {
  const today = T.todayKey();
  const { data: rec } = await db.from('attendance').select('*').eq('user_id',userId).eq('date_key',today).single().catch(()=>({data:null}));
  const s = await getSettings();
  const now = T.now();
  let breakSec=0, workSec=0;
  if (rec) {
    breakSec = rec.total_break_sec||0;
    if (rec.status==='break') {
      const { data: ob } = await db.from('breaks').select('*').eq('user_id',userId).is('end_time',null).single().catch(()=>({data:null}));
      if (ob) breakSec += T.diff(ob.start_time, now);
    }
    if (rec.status!=='offline' && rec.online_time) {
      workSec = Math.max(0, T.diff(rec.online_time,now) - breakSec);
    } else if (rec.status==='offline') {
      workSec = rec.working_sec||0;
      breakSec = rec.total_break_sec||0;
    }
  }
  const dutyTotal = s.duty_hours*3600;
  const maxBreak  = s.max_break_minutes*60;
  const breakLeft = Math.max(0, maxBreak-breakSec);
  const dutyLeft  = Math.max(0, dutyTotal-workSec);
  const score = await calcScore(breakSec);

  // Display
  document.getElementById('work-timer').textContent = T.fmt(workSec);
  document.getElementById('w-card').textContent = T.fmt(workSec);
  document.getElementById('b-card').textContent = T.fmt(breakSec);
  document.getElementById('br-card').textContent = T.fmt(breakLeft);
  document.getElementById('d-card').textContent  = T.fmt(dutyLeft);

  // Progress
  const wp = Math.min(100,(workSec/dutyTotal)*100);
  const bp = Math.min(100,(breakSec/maxBreak)*100);
  const brp = (breakLeft/maxBreak)*100;
  const dp = 100-Math.min(100,(dutyLeft/dutyTotal)*100);
  document.getElementById('w-prog').style.width = wp+'%';
  document.getElementById('b-prog').style.width = bp+'%';
  document.getElementById('br-prog').style.width = brp+'%';
  document.getElementById('d-prog').style.width = dp+'%';
  document.getElementById('b-prog').style.background = breakSec>maxBreak ? 'linear-gradient(90deg,var(--red),#f87171)' : 'linear-gradient(90deg,var(--orange),#fbbf24)';

  // Labels
  document.getElementById('w-lbl').textContent = `${Math.round(wp)}% of ${s.duty_hours}h duty`;
  document.getElementById('b-lbl').textContent = `${Math.round(breakSec/60)} min used of ${s.max_break_minutes}`;
  document.getElementById('br-lbl').textContent = `${Math.round(breakLeft/60)} min left`;
  document.getElementById('d-lbl').textContent = `${Math.round(dp)}% complete`;

  // Score
  const isGood = score >= s.daily_score;
  const sr = document.getElementById('score-ring');
  sr.textContent = score;
  sr.className = `score-ring ${isGood?'sr-good':'sr-bad'}`;
  document.getElementById('score-label').textContent = isGood ? 'Perfect Score ✓' : 'Penalty Applied ⚠';
  document.getElementById('score-label').style.color = isGood ? 'var(--green)' : 'var(--red)';
  const extra = Math.max(0,breakSec-maxBreak);
  document.getElementById('score-detail').textContent = extra>0 ? `+${Math.round(extra/60)} min over limit` : 'No penalties';

  // Break count
  const { data: brkList } = await db.from('breaks').select('id').eq('user_id',userId).eq('date_key',today);
  document.getElementById('i-brkcount').textContent = brkList ? brkList.length : 0;

  // Warn at 80%
  if (!breakWarned && breakSec >= maxBreak*0.8 && rec && rec.status!=='offline') checkBreakWarn(breakSec);
}

async function checkBreakWarn(totalBreakSec) {
  const s = await getSettings();
  const maxSec = s.max_break_minutes*60;
  const left = Math.max(0,maxSec-totalBreakSec);
  if (!breakWarned && left <= maxSec*0.2 && left > 0) {
    breakWarned = true;
    document.getElementById('bw-left').textContent = Math.round(left/60)+' min';
    openModal('m-brk-warn');
  }
}

// ---- UI STATES ----
function setUIOnline() {
  document.getElementById('status-panel').className='status-panel s-online';
  document.getElementById('status-ring').className='status-ring r-online';
  document.getElementById('s-emoji').textContent='💼';
  document.getElementById('s-label').textContent='Online';
  document.getElementById('btn-on').disabled=true;
  document.getElementById('btn-brk').disabled=false;
  document.getElementById('btn-ebrk').style.display='none';
  document.getElementById('btn-off').disabled=false;
  document.getElementById('break-select-row').style.display='block';
}
function setUIBreak(type) {
  const emojis={Lunch:'🍽','Short Break':'☕','Spiritual Break':'🙏',Washroom:'🚻'};
  document.getElementById('status-panel').className='status-panel s-break';
  document.getElementById('status-ring').className='status-ring r-break';
  document.getElementById('s-emoji').textContent=emojis[type]||'☕';
  document.getElementById('s-label').textContent=type||'On Break';
  document.getElementById('btn-on').disabled=true;
  document.getElementById('btn-brk').disabled=true;
  document.getElementById('btn-ebrk').style.display='inline-flex';
  document.getElementById('btn-ebrk').disabled=false;
  document.getElementById('btn-off').disabled=true;
  document.getElementById('break-select-row').style.display='none';
  // Restore label from DB
  db.from('breaks').select('type').eq('user_id',userId).is('end_time',null).single().then(({data})=>{
    if(data){ document.getElementById('s-label').textContent=data.type; document.getElementById('i-brk').textContent=data.type; }
  });
}
function setUIOffline() {
  document.getElementById('status-panel').className='status-panel s-offline';
  document.getElementById('status-ring').className='status-ring r-offline';
  document.getElementById('s-emoji').textContent='💤';
  document.getElementById('s-label').textContent='Offline';
  document.getElementById('btn-on').disabled=false;
  document.getElementById('btn-brk').disabled=true;
  document.getElementById('btn-ebrk').style.display='none';
  document.getElementById('btn-off').disabled=true;
  document.getElementById('break-select-row').style.display='none';
  stopWorkTimer();
}

// ---- BREAK LOG ----
async function updateBreakLog() {
  const today = T.todayKey();
  const { data: brks } = await db.from('breaks').select('*').eq('user_id',userId).eq('date_key',today).order('start_time');
  const container = document.getElementById('brk-log');
  if (!brks||!brks.length) { container.innerHTML='<div class="empty-state"><div class="ei">☕</div><p>No breaks today</p></div>'; return; }
  const emojis={Lunch:'🍽','Short Break':'☕','Spiritual Break':'🙏',Washroom:'🚻'};
  container.innerHTML = `<div class="brk-list">${brks.map(b=>`<div class="brk-item"><span class="brk-type">${emojis[b.type]||'☕'} ${b.type}</span><span class="brk-time">${T.fmtTime(b.start_time)} → ${b.end_time?T.fmtTime(b.end_time):'...'}</span><span class="brk-dur">${b.end_time?T.fmt(b.duration_sec):'...'}</span></div>`).join('')}</div>`;
}

// ---- TASKS (EMPLOYEE VIEW) ----
async function loadEmpTasks() {
  const { data: tasks } = await db.from('tasks').select('*').eq('assigned_to',userId).order('created_at',{ascending:false});
  const stages = ['todo','inprogress','review','done'];
  const counts = {todo:0,inprogress:0,review:0,done:0};
  stages.forEach(s => { document.getElementById('ek-col-'+s).innerHTML=''; document.getElementById('ek-cnt-'+s).textContent='0'; });

  for (const t of (tasks||[])) {
    counts[t.stage]=(counts[t.stage]||0)+1;
    const dlClass = deadlineClass(t.deadline);
    const card = document.createElement('div');
    card.className='task-card';
    card.innerHTML=`
      <div class="task-priority-strip strip-${t.priority}"></div>
      <div class="task-card-title">${t.title}</div>
      ${t.description?`<p class="tsm t3" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:.4rem">${t.description}</p>`:''}
      <div class="task-card-meta">
        ${priorityBadge(t.priority)}
        ${t.deadline?`<span class="task-deadline ${dlClass}">${deadlineText(t.deadline)}</span>`:''}
      </div>`;
    card.onclick=()=>openEmpTaskDetail(t.id);
    document.getElementById('ek-col-'+t.stage).appendChild(card);
  }
  stages.forEach(s => {
    document.getElementById('ek-cnt-'+s).textContent=counts[s]||0;
    const col=document.getElementById('ek-col-'+s);
    if(col&&!col.children.length) col.innerHTML='<div class="empty-col">✦<span>No tasks</span></div>';
  });
  document.getElementById('tst-todo').textContent=counts.todo||0;
  document.getElementById('tst-ip').textContent=counts.inprogress||0;
  document.getElementById('tst-rv').textContent=counts.review||0;
  document.getElementById('tst-dn').textContent=counts.done||0;
}

async function openEmpTaskDetail(id) {
  detailTaskId = id;
  const { data: t } = await db.from('tasks').select('*').eq('id',id).single();
  if (!t) return;
  const { data: assigner } = await db.from('users').select('name').eq('id',t.assigned_by).single().catch(()=>({data:{name:t.assigned_by}}));
  document.getElementById('etd-id').value=id;
  document.getElementById('etd-title').textContent=t.title;
  document.getElementById('etd-desc').textContent=t.description||'No description';
  document.getElementById('etd-priority').innerHTML=priorityBadge(t.priority);
  document.getElementById('etd-stage').innerHTML=stageBadge(t.stage);
  document.getElementById('etd-deadline').innerHTML=t.deadline?`<span class="${deadlineClass(t.deadline)}">${deadlineText(t.deadline)}</span>`:'—';
  document.getElementById('etd-by').textContent=(assigner?.name)||t.assigned_by;
  document.getElementById('etd-stage-sel').value=t.stage;
  await empLoadComments(id);
  openModal('m-emp-task-detail');
}
async function empLoadComments(taskId) {
  const { data: comments } = await db.from('task_comments').select('*').eq('task_id',taskId).order('created_at');
  const list = document.getElementById('etd-comments');
  if (!comments||!comments.length) { list.innerHTML='<div class="t3 tsm" style="text-align:center;padding:1rem">No comments yet</div>'; return; }
  // Get all user names
  const userIds = [...new Set(comments.map(c=>c.user_id))];
  const { data: users } = await db.from('users').select('id,name').in('id',userIds);
  const nameMap = {}; (users||[]).forEach(u=>nameMap[u.id]=u.name);
  list.innerHTML=comments.map(c=>`<div class="comment-item"><div><span class="comment-author">${nameMap[c.user_id]||c.user_id}</span><span class="comment-time">${T.fmtDateTime(c.created_at)}</span></div><div class="comment-text">${c.comment}</div></div>`).join('');
  list.scrollTop=list.scrollHeight;
}
async function empAddComment() {
  const input=document.getElementById('etd-comment-input');
  const text=input.value.trim();
  if(!text||!detailTaskId) return;
  await db.from('task_comments').insert({ id:`cmt_${Date.now()}`, task_id:detailTaskId, user_id:userId, comment:text });
  input.value='';
  await empLoadComments(detailTaskId);
}
async function empUpdateStage() {
  const id=document.getElementById('etd-id').value;
  const stage=document.getElementById('etd-stage-sel').value;
  await db.from('tasks').update({ stage, updated_at:T.now() }).eq('id',id);
  document.getElementById('etd-stage').innerHTML=stageBadge(stage);
  showToast('Stage updated ✓','success');
  loadEmpTasks();
}

// ---- NAV ----
function showSec(name, btn) {
  document.querySelectorAll('main section').forEach(s=>s.style.display='none');
  document.getElementById('sec-'+name).style.display='block';
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if(name==='tasks') loadEmpTasks();
  if(name==='breaks') updateBreakLog();
}

// ---- IDLE DETECTION ----
function startIdleDetection() {
  let last = Date.now();
  ['mousemove','keydown','click','touchstart'].forEach(e=>document.addEventListener(e,()=>{ last=Date.now(); if(idleShown) dismissIdle(); }));
  idleTimer = setInterval(async()=>{
    const { data: rec } = await db.from('attendance').select('status').eq('user_id',userId).eq('date_key',T.todayKey()).single().catch(()=>({data:null}));
    if(rec?.status==='online' && Date.now()-last>5*60*1000 && !idleShown) {
      idleShown=true; document.getElementById('idle-overlay').classList.add('show');
    }
  }, 30000);
}
function dismissIdle() { idleShown=false; document.getElementById('idle-overlay').classList.remove('show'); }

init();
