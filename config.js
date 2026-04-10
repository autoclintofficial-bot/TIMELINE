// ============================================================
// config.js — Supabase + shared utilities
// ============================================================

// ⚠️  REPLACE with YOUR values from Supabase → Project Settings → API
const SUPABASE_URL = 'https://ngdafgaznovwrgdgvysm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5nZGFmZ2F6bm92d3JnZGd2eXNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2OTc4MDQsImV4cCI6MjA5MTI3MzgwNH0.j31q4OtDrBNfKIXuD2n2SbvEhIi0qT3oFUNzXjNJ3eQ';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- SETTINGS CACHE (prevents DB hit every second) ----
let _settingsCache = null, _settingsFetchedAt = 0;
async function getSettings() {
  if (_settingsCache && Date.now() - _settingsFetchedAt < 60000) return _settingsCache;
  try {
    const { data } = await db.from('settings').select('*').eq('id',1).single();
    _settingsCache = data || _defaultSettings();
  } catch { _settingsCache = _settingsCache || _defaultSettings(); }
  _settingsFetchedAt = Date.now();
  return _settingsCache;
}
function _defaultSettings() { return { daily_score:10, max_break_minutes:60, penalty_interval_minutes:10, penalty_points:1, duty_hours:9 }; }
function clearSettingsCache() { _settingsCache = null; _settingsFetchedAt = 0; }

// ---- BRANDING CACHE ----
let _brandingCache = null;
async function getBranding() {
  if (_brandingCache) return _brandingCache;
  try {
    const { data } = await db.from('branding').select('*').eq('id',1).single();
    _brandingCache = data || { app_name:'WorkTrack', logo_url:null, primary_color:'#3b82f6' };
  } catch { _brandingCache = { app_name:'WorkTrack', logo_url:null, primary_color:'#3b82f6' }; }
  return _brandingCache;
}
function clearBrandingCache() { _brandingCache = null; }

// Apply branding to page — call once on load
async function applyBranding() {
  try {
    const b = await getBranding();
    // App name in sidebar
    document.querySelectorAll('.sb-name').forEach(el => el.textContent = b.app_name || 'WorkTrack');
    document.querySelectorAll('.topbar-appname').forEach(el => el.textContent = b.app_name || 'WorkTrack');
    // Logo
    if (b.logo_url) {
      document.querySelectorAll('.sb-icon-logo').forEach(el => {
        el.innerHTML = `<img src="${b.logo_url}" alt="logo" style="width:100%;height:100%;object-fit:cover;border-radius:8px"/>`;
      });
      document.querySelectorAll('.topbar-logo-img').forEach(el => {
        el.innerHTML = `<img src="${b.logo_url}" alt="logo" style="width:100%;height:100%;object-fit:cover;border-radius:6px"/>`;
      });
    }
    // Primary color
    if (b.primary_color) {
      document.documentElement.style.setProperty('--blue', b.primary_color);
    }
    // Page title
    if (b.app_name) document.title = document.title.replace('WorkTrack', b.app_name);
  } catch(e) { console.warn('applyBranding error:', e); }
}

// ---- SCORE ----
function calcScoreSync(totalBreakSec, settings) {
  const max = settings.max_break_minutes * 60;
  const interval = settings.penalty_interval_minutes * 60;
  let score = settings.daily_score;
  if (totalBreakSec > max) score -= Math.floor((totalBreakSec - max) / interval) * settings.penalty_points;
  return Math.max(0, score);
}
async function calcScore(totalBreakSec) {
  return calcScoreSync(totalBreakSec, await getSettings());
}

// ---- SESSION ----
const Session = {
  get()        { try { return JSON.parse(localStorage.getItem('wt_session')); } catch { return null; } },
  set(user)    { localStorage.setItem('wt_session', JSON.stringify({ id:user.id, name:user.name, role:user.role, loginTime:new Date().toISOString() })); },
  clear()      { localStorage.removeItem('wt_session'); },
  isLoggedIn() { return !!this.get(); },
  isAdmin()    { const s=this.get(); return s && s.role==='admin'; },
  requireLogin()   { if (!this.isLoggedIn()) { window.location.href='index.html'; return false; } return true; },
  requireAdmin()   { if (!this.isLoggedIn()) { window.location.href='index.html'; return false; } if (!this.isAdmin()) { window.location.href='employee-dashboard.html'; return false; } return true; },
  requireEmployee(){ if (!this.isLoggedIn()) { window.location.href='index.html'; return false; } return true; }
};

// ---- TOAST ----
function showToast(msg, type='info') {
  let wrap = document.getElementById('toast-wrap');
  if (!wrap) { wrap=document.createElement('div'); wrap.id='toast-wrap'; document.body.appendChild(wrap); }
  const icons = { success:'✓', error:'✕', warning:'⚠', info:'ℹ' };
  const t = document.createElement('div');
  t.className = `toast t-${type}`;
  t.innerHTML = `<span class="ti">${icons[type]||'ℹ'}</span><span>${msg}</span>`;
  wrap.appendChild(t);
  setTimeout(() => { t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),300); }, 3500);
}

// ---- TIME UTILS ----
const T = {
  fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    return `${String(Math.floor(sec/3600)).padStart(2,'0')}:${String(Math.floor((sec%3600)/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
  },
  fmtTime(iso)     { if (!iso) return '--:--'; try { return new Date(iso).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true}); } catch { return '--:--'; } },
  fmtDate(iso)     { if (!iso) return '--'; try { return new Date(iso).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); } catch { return '--'; } },
  fmtDateTime(iso) { if (!iso) return '--'; try { return new Date(iso).toLocaleString('en-US',{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'}); } catch { return '--'; } },
  todayKey()  { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; },
  diff(a,b)   { return Math.floor((new Date(b)-new Date(a))/1000); },
  now()       { return new Date().toISOString(); },
  daysUntil(iso) { if (!iso) return null; return Math.ceil((new Date(iso)-new Date())/(1000*60*60*24)); }
};

// ---- MODALS ----
function openModal(id)  { const el=document.getElementById(id); if(el) el.classList.add('open'); }
function closeModal(id) { const el=document.getElementById(id); if(el) el.classList.remove('open'); }
document.addEventListener('click', e => { if (e.target.classList.contains('overlay')) e.target.classList.remove('open'); });

// ---- SIDEBAR USER ----
async function renderSidebarUser() {
  const s = Session.get(); if (!s) return;
  ['sidebar-username','topbar-username'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=s.name; });
  const roleEl=document.getElementById('sidebar-role'); if(roleEl) roleEl.textContent=s.role==='admin'?'Administrator':'Employee';

  // Try to load user photo
  try {
    const { data: user } = await db.from('users').select('photo_url').eq('id',s.id).single();
    const av = document.getElementById('sidebar-avatar');
    if (av) {
      if (user && user.photo_url) {
        av.innerHTML = `<img src="${user.photo_url}" alt="${s.name}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
      } else {
        av.textContent = s.name.charAt(0).toUpperCase();
      }
    }
  } catch {
    const av=document.getElementById('sidebar-avatar');
    if(av) av.textContent=s.name.charAt(0).toUpperCase();
  }
}

// ---- LOGOUT ----
function logout() {
  async function cleanupAndLeave() {
    const s = Session.get();
    if (s) {
      try {
        const today = T.todayKey();
        const { data: rec } = await db.from('attendance').select('*').eq('user_id',s.id).eq('date_key',today).maybeSingle();
        if (rec && (rec.status==='online'||rec.status==='break')) {
          const now = T.now();
          let totalBreakSec = rec.total_break_sec||0;
          if (rec.status==='break') {
            const { data: ob } = await db.from('breaks').select('*').eq('user_id',s.id).is('end_time',null).maybeSingle();
            if (ob) { const dur=T.diff(ob.start_time,now); await db.from('breaks').update({end_time:now,duration_sec:dur}).eq('id',ob.id); totalBreakSec+=dur; }
          }
          const settings = await getSettings();
          const workSec = rec.online_time ? Math.max(0,T.diff(rec.online_time,now)-totalBreakSec) : 0;
          const score   = calcScoreSync(totalBreakSec,settings);
          await db.from('attendance').update({status:'offline',offline_time:now,working_sec:workSec,score,total_break_sec:totalBreakSec}).eq('id',rec.id);
        }
      } catch(e) { console.warn('Logout cleanup error:',e); }
    }
    Session.clear();
    window.location.href='index.html';
  }
  cleanupAndLeave();
}

// ---- FILE SIZE FORMATTER ----
function fmtFileSize(bytes) {
  if (!bytes) return '0B';
  if (bytes < 1024) return bytes+'B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1)+'KB';
  return (bytes/(1024*1024)).toFixed(1)+'MB';
}

// ---- FILE ICON ----
function fileIcon(type) {
  if (!type) return '📎';
  if (type.startsWith('image/')) return '🖼';
  if (type.includes('pdf')) return '📄';
  if (type.includes('word')||type.includes('document')) return '📝';
  if (type.includes('sheet')||type.includes('excel')) return '📊';
  if (type.includes('zip')||type.includes('rar')) return '🗜';
  return '📎';
}

// ---- BADGE HELPERS ----
function stageBadge(s) {
  const map={todo:'b-todo',inprogress:'b-inprogress',review:'b-review',done:'b-done'};
  const lab={todo:'To Do',inprogress:'In Progress',review:'Review',done:'Done'};
  return `<span class="badge ${map[s]||'b-todo'}">${lab[s]||s}</span>`;
}
function priorityBadge(p) {
  const map={low:'b-p-low',medium:'b-p-medium',high:'b-p-high',urgent:'b-p-urgent'};
  return `<span class="badge ${map[p]||'b-p-medium'}">${p}</span>`;
}
function leaveBadge(s) {
  const map={pending:'b-pending',approved:'b-approved',rejected:'b-rejected'};
  return `<span class="badge ${map[s]||'b-pending'}">${s}</span>`;
}
function deadlineClass(iso) {
  if(!iso) return ''; const d=T.daysUntil(iso);
  if(d<0) return 'deadline-over'; if(d<=2) return 'deadline-soon'; return 'deadline-ok';
}
function deadlineText(iso) {
  if(!iso) return ''; const d=T.daysUntil(iso);
  if(d<0) return `⚠ ${Math.abs(d)}d overdue`; if(d===0) return '⏰ Due today'; if(d===1) return '⏰ Due tomorrow'; return `📅 ${T.fmtDate(iso)}`;
}
function statusBadge(s) {
  if(s==='online') return `<span class="badge b-online"><span class="dot dot-on"></span>Online</span>`;
  if(s==='break')  return `<span class="badge b-break"><span class="dot dot-brk"></span>On Break</span>`;
  return `<span class="badge b-offline"><span class="dot dot-off"></span>Offline</span>`;
}
