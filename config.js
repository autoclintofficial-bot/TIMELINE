// ============================================================
// config.js — Supabase connection + shared utilities
// ============================================================

// ⚠️  REPLACE THESE TWO VALUES with your own from Supabase
// dashboard → Project Settings → API
const SUPABASE_URL = 'https://ngdafgaznovwrgdgvysm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5nZGFmZ2F6bm92d3JnZGd2eXNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2OTc4MDQsImV4cCI6MjA5MTI3MzgwNH0.j31q4OtDrBNfKIXuD2n2SbvEhIi0qT3oFUNzXjNJ3eQ';

// ---- SUPABASE CLIENT ----
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- SESSION (still uses localStorage just for login state) ----
const Session = {
  get()       { try { return JSON.parse(localStorage.getItem('wt_session')); } catch { return null; } },
  set(user)   { localStorage.setItem('wt_session', JSON.stringify({ id: user.id, name: user.name, role: user.role, loginTime: new Date().toISOString() })); },
  clear()     { localStorage.removeItem('wt_session'); },
  isLoggedIn(){ return !!this.get(); },
  isAdmin()   { const s = this.get(); return s && s.role === 'admin'; },
  requireLogin() { if (!this.isLoggedIn()) { window.location.href = 'index.html'; return false; } return true; },
  requireAdmin() {
    if (!this.isLoggedIn()) { window.location.href = 'index.html'; return false; }
    if (!this.isAdmin())   { window.location.href = 'employee-dashboard.html'; return false; }
    return true;
  },
};

// ---- TOAST ----
function showToast(msg, type = 'info') {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toast-wrap'; document.body.appendChild(wrap); }
  const icons = { success:'✓', error:'✕', warning:'⚠', info:'ℹ' };
  const t = document.createElement('div');
  t.className = `toast t-${type}`;
  t.innerHTML = `<span class="ti">${icons[type]||'ℹ'}</span><span>${msg}</span>`;
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),300); }, 3000);
}

// ---- TIME UTILS ----
const T = {
  fmt(sec) {
    if (sec < 0) sec = 0;
    return `${String(Math.floor(sec/3600)).padStart(2,'0')}:${String(Math.floor((sec%3600)/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
  },
  fmtTime(iso) { if (!iso) return '--:--'; return new Date(iso).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true}); },
  fmtDate(iso) { if (!iso) return '--'; return new Date(iso).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); },
  fmtDateTime(iso) { if (!iso) return '--'; return new Date(iso).toLocaleString('en-US',{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'}); },
  todayKey() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; },
  diff(a,b)  { return Math.floor((new Date(b)-new Date(a))/1000); },
  now()      { return new Date().toISOString(); },
  daysUntil(iso) { if (!iso) return null; return Math.ceil((new Date(iso)-new Date())/(1000*60*60*24)); },
};

// ---- SCORE ----
async function calcScore(totalBreakSec) {
  const s = await getSettings();
  const max = s.max_break_minutes * 60;
  const interval = s.penalty_interval_minutes * 60;
  let score = s.daily_score;
  if (totalBreakSec > max) score -= Math.floor((totalBreakSec - max) / interval) * s.penalty_points;
  return Math.max(0, score);
}

async function getSettings() {
  const { data } = await db.from('settings').select('*').eq('id',1).single();
  return data || { daily_score:10, max_break_minutes:60, penalty_interval_minutes:10, penalty_points:1, duty_hours:9 };
}

// ---- MODALS ----
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.addEventListener('click', e => {
  if (e.target.classList.contains('overlay')) e.target.classList.remove('open');
});

// ---- SIDEBAR USER ----
function renderSidebarUser() {
  const s = Session.get(); if (!s) return;
  ['sidebar-username','topbar-username'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=s.name; });
  const roleEl = document.getElementById('sidebar-role'); if(roleEl) roleEl.textContent = s.role==='admin'?'Administrator':'Employee';
  const av = document.getElementById('sidebar-avatar'); if(av) av.textContent = s.name.charAt(0).toUpperCase();
}

// ---- LOGOUT ----
async function logout() {
  const s = Session.get();
  if (s) {
    // Auto go-offline on logout
    const today = T.todayKey();
    const { data: rec } = await db.from('attendance').select('*').eq('user_id',s.id).eq('date_key',today).single().catch(()=>({data:null}));
    if (rec && (rec.status === 'online' || rec.status === 'break')) {
      const now = T.now();
      // Close any open break
      if (rec.status === 'break') {
        const { data: openBrk } = await db.from('breaks').select('*').eq('user_id',s.id).is('end_time',null).single().catch(()=>({data:null}));
        if (openBrk) {
          const dur = T.diff(openBrk.start_time, now);
          await db.from('breaks').update({ end_time:now, duration_sec:dur }).eq('id',openBrk.id);
          rec.total_break_sec = (rec.total_break_sec||0) + dur;
        }
      }
      const workSec = rec.online_time ? Math.max(0, T.diff(rec.online_time,now) - (rec.total_break_sec||0)) : 0;
      const score = await calcScore(rec.total_break_sec||0);
      await db.from('attendance').update({ status:'offline', offline_time:now, working_sec:workSec, score, total_break_sec:rec.total_break_sec||0 }).eq('id',rec.id);
    }
  }
  Session.clear();
  window.location.href = 'index.html';
}

// ---- STAGE / PRIORITY HELPERS ----
function stageBadge(stage) {
  const map = { todo:'b-todo', inprogress:'b-inprogress', review:'b-review', done:'b-done' };
  const label = { todo:'To Do', inprogress:'In Progress', review:'Review', done:'Done' };
  return `<span class="badge ${map[stage]||'b-todo'}">${label[stage]||stage}</span>`;
}
function priorityBadge(p) {
  const map = { low:'b-p-low', medium:'b-p-medium', high:'b-p-high', urgent:'b-p-urgent' };
  return `<span class="badge ${map[p]||'b-p-medium'}">${p}</span>`;
}
function deadlineClass(iso) {
  if (!iso) return '';
  const d = T.daysUntil(iso);
  if (d < 0) return 'deadline-over';
  if (d <= 2) return 'deadline-soon';
  return 'deadline-ok';
}
function deadlineText(iso) {
  if (!iso) return '';
  const d = T.daysUntil(iso);
  if (d < 0) return `⚠ ${Math.abs(d)}d overdue`;
  if (d === 0) return '⏰ Due today';
  if (d === 1) return '⏰ Due tomorrow';
  return `📅 ${T.fmtDate(iso)}`;
}
