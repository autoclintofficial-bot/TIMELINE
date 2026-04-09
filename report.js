// report.js
if (!Session.requireLogin()) throw new Error('Not authorized');
renderSidebarUser();
const session = Session.get();
const isAdmin = session.role === 'admin';
let currentTab = 'daily';
let allUsers = [];

// Setup
async function setup() {
  const { data } = await db.from('users').select('*').order('name');
  allUsers = data || [];
  const emps = allUsers.filter(u=>u.role==='employee');
  document.getElementById('nav-dash').href = isAdmin ? 'admin-dashboard.html' : 'employee-dashboard.html';
  if (isAdmin) {
    document.getElementById('admin-filter').style.display='block';
    document.getElementById('nav-settings').style.display='flex';
    document.getElementById('c-emp').style.display='block';
    document.getElementById('report-sub').textContent='All employees attendance data';
    const opts = '<option value="all">All Employees</option>' + emps.map(e=>`<option value="${e.id}">${e.name} (${e.id})</option>`).join('');
    document.getElementById('f-emp').innerHTML = opts;
    document.getElementById('c-emp').innerHTML = '<option value="">Select Employee…</option>' + emps.map(e=>`<option value="${e.id}">${e.name}</option>`).join('');
  }
  // Set default dates
  const now = new Date();
  document.getElementById('d-date').value = T.todayKey();
  document.getElementById('m-month').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  document.getElementById('c-month').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  try { document.getElementById('w-week').value = `${now.getFullYear()}-W${String(getWeekNum(now)).padStart(2,'0')}`; } catch(e){}
  loadReport();
}

function getWeekNum(d) {
  const onejan = new Date(d.getFullYear(),0,1);
  return Math.ceil((((d-onejan)/86400000)+onejan.getDay()+1)/7);
}

function switchTab(tab, btn) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('tab-'+tab).classList.add('active');
  loadReport();
}

function loadReport() {
  if (currentTab==='daily') loadDaily();
  else if (currentTab==='weekly') loadWeekly();
  else if (currentTab==='monthly') loadMonthly();
  else if (currentTab==='calendar') loadCalendar();
}

function targetIds() {
  if (!isAdmin) return [session.id];
  const v = document.getElementById('f-emp')?.value||'all';
  if (v==='all') return allUsers.filter(u=>u.role==='employee').map(u=>u.id);
  return [v];
}

function empName(id) { return (allUsers.find(u=>u.id===id)||{}).name||id; }

async function getScoreThreshold() { const s=await getSettings(); return s.daily_score; }

function scoreCell(score, threshold) {
  if (score===null||score===undefined) return '<span class="t3">—</span>';
  const c = score>=threshold ? 'var(--green)' : 'var(--red)';
  return `<span class="mono" style="font-weight:700;color:${c}">${score}</span>`;
}
function dayCell(rec, threshold) {
  if (!rec||rec.score===null||rec.score===undefined) return `<span class="badge b-offline">${rec?.status||'no data'}</span>`;
  return rec.score>=threshold ? `<span class="badge b-active">Good</span>` : `<span class="badge b-disabled">Low</span>`;
}

async function loadDaily() {
  const dateVal = document.getElementById('d-date').value || T.todayKey();
  const ids = targetIds();
  const threshold = await getScoreThreshold();
  const { data: recs } = await db.from('attendance').select('*').in('user_id',ids).eq('date_key',dateVal);
  const rows = [];
  for (const id of ids) {
    const rec = (recs||[]).find(r=>r.user_id===id);
    let w=0,b=0;
    if (rec) {
      w=rec.working_sec||0; b=rec.total_break_sec||0;
      if (rec.status==='online'&&rec.online_time) w=Math.max(0,T.diff(rec.online_time,T.now())-b);
    }
    rows.push(`<tr><td><strong>${empName(id)}</strong><br><span class="tsm t3 mono">${id}</span></td><td class="mono">${T.fmtDate(dateVal+'T00:00:00')}</td><td class="mono">${rec?T.fmtTime(rec.login_time):'--'}</td><td class="mono">${rec?T.fmtTime(rec.online_time):'--'}</td><td class="mono">${rec?T.fmtTime(rec.offline_time):'--'}</td><td class="mono">${T.fmt(w)}</td><td class="mono">${T.fmt(b)}</td><td>${scoreCell(rec?.score,threshold)}</td><td>${dayCell(rec,threshold)}</td></tr>`);
  }
  document.getElementById('d-tbody').innerHTML = rows.join('')||emptyRow(9);
}

async function loadWeekly() {
  const wv = document.getElementById('w-week').value;
  let start,end;
  if (wv) {
    const [yr,wk] = wv.split('-W');
    const d = new Date(yr,0,1+(parseInt(wk)-1)*7);
    while(d.getDay()!==1) d.setDate(d.getDate()-1);
    start = d.toISOString().split('T')[0];
    const ed = new Date(d); ed.setDate(ed.getDate()+6);
    end = ed.toISOString().split('T')[0];
  } else { start=end=T.todayKey(); }
  await renderRange('w-tbody', start, end, false);
}

async function loadMonthly() {
  const mv = document.getElementById('m-month').value; if(!mv) return;
  const [yr,mo] = mv.split('-');
  const start = `${yr}-${mo}-01`;
  const lastDay = new Date(yr,mo,0).getDate();
  const end = `${yr}-${mo}-${String(lastDay).padStart(2,'0')}`;
  await renderRange('m-tbody', start, end, true);
}

async function renderRange(tbodyId, start, end, showSummary) {
  const ids = targetIds();
  const threshold = await getScoreThreshold();
  const { data: recs } = await db.from('attendance').select('*').in('user_id',ids).gte('date_key',start).lte('date_key',end).order('date_key');
  const rows=[], allW=[], allB=[], allS=[];
  for (const rec of (recs||[])) {
    let w=rec.working_sec||0, b=rec.total_break_sec||0;
    if (rec.status==='online'&&rec.online_time) w=Math.max(0,T.diff(rec.online_time,T.now())-b);
    allW.push(w); allB.push(b); if(rec.score!==null&&rec.score!==undefined) allS.push(rec.score);
    rows.push(`<tr><td><strong>${empName(rec.user_id)}</strong></td><td class="mono">${T.fmtDate(rec.date_key+'T00:00:00')}</td><td class="mono">${T.fmt(w)}</td><td class="mono">${T.fmt(b)}</td><td>${scoreCell(rec.score,threshold)}</td><td>${dayCell(rec,threshold)}</td></tr>`);
  }
  document.getElementById(tbodyId).innerHTML = rows.join('')||emptyRow(6);
  if (showSummary) {
    const sm = document.getElementById('m-summary'); if(sm) sm.style.display='block';
    const totalW = allW.reduce((a,b)=>a+b,0);
    const avgB = allB.length ? Math.round(allB.reduce((a,b)=>a+b,0)/allB.length/60) : 0;
    const avgS = allS.length ? (allS.reduce((a,b)=>a+b,0)/allS.length).toFixed(1) : '—';
    document.getElementById('ms-days').textContent = rows.length;
    document.getElementById('ms-work').textContent = (totalW/3600).toFixed(1)+'h';
    document.getElementById('ms-score').textContent = avgS;
    document.getElementById('ms-break').textContent = avgB+'m';
  }
}

async function loadCalendar() {
  const mv = document.getElementById('c-month').value; if(!mv) return;
  const [yr,mo] = mv.split('-').map(Number);
  const targetId = isAdmin ? (document.getElementById('c-emp')?.value||session.id) : session.id;
  if(!targetId) { document.getElementById('cal-container').innerHTML='<p class="t3 tsm" style="padding:1rem">Select an employee</p>'; return; }

  const firstDay = new Date(yr,mo-1,1);
  const daysInMonth = new Date(yr,mo,0).getDate();
  const startDow = firstDay.getDay();
  const startKey=`${yr}-${String(mo).padStart(2,'0')}-01`, endKey=`${yr}-${String(mo).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;
  const { data: recs } = await db.from('attendance').select('*').eq('user_id',targetId).gte('date_key',startKey).lte('date_key',endKey);
  const recMap={}; (recs||[]).forEach(r=>recMap[r.date_key]=r);
  const threshold = await getScoreThreshold();
  const monthName = firstDay.toLocaleString('en-US',{month:'long',year:'numeric'});
  const targetName = empName(targetId);

  let html=`<h3 class="mb2">${monthName} — ${targetName}</h3><div class="cal-grid">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="cal-dh">${d}</div>`).join('')}`;
  for(let i=0;i<startDow;i++) html+=`<div class="cal-day cal-empty"></div>`;
  const todayKey = T.todayKey();
  for(let d=1;d<=daysInMonth;d++) {
    const dk=`${yr}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const rec=recMap[dk];
    let cls='cal-day';
    if(dk===todayKey) cls+=' cal-today';
    let inner=`<span>${d}</span>`;
    if(rec) {
      cls+=' cal-has';
      if(rec.score!==null&&rec.score!==undefined) {
        cls+=rec.score>=threshold?' cal-good':' cal-bad';
        inner+=`<span class="cal-score">${rec.score}pt</span>`;
      }
    }
    html+=`<div class="${cls}">${inner}</div>`;
  }
  html+=`</div><div class="fca gap2 mt2 tsm t3"><span>🟢 Good day</span><span>🔴 Low score</span><span style="border:1px solid var(--blue);padding:0 4px;border-radius:4px">Today</span></div>`;
  document.getElementById('cal-container').innerHTML=html;
}

function emptyRow(cols) { return `<tr><td colspan="${cols}"><div class="empty-state"><div class="ei">📋</div><p>No data for this period</p></div></td></tr>`; }

async function exportCSV() {
  const ids = targetIds();
  const { data: recs } = await db.from('attendance').select('*').in('user_id',ids).order('date_key');
  const threshold = await getScoreThreshold();
  const headers = ['Employee','Employee ID','Date','Login','Online','Offline','Work Hrs','Break Min','Score','Status'];
  const rows = (recs||[]).map(r=>{
    const w=((r.working_sec||0)/3600).toFixed(2);
    const b=Math.round((r.total_break_sec||0)/60);
    const s=r.score!==null&&r.score!==undefined?(r.score>=threshold?'Good':'Low'):r.status;
    return [empName(r.user_id),r.user_id,r.date_key,T.fmtTime(r.login_time),T.fmtTime(r.online_time),T.fmtTime(r.offline_time),w,b,r.score??'—',s];
  });
  const csv=[headers,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download=`worktrack_${T.todayKey()}.csv`;
  a.click();
  showToast('Exported as CSV','success');
}

setup();
