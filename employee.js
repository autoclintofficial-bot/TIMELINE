// employee.js — Fixed version
// KEY FIXES:
// 1. Timer loop uses LOCAL state — zero DB calls per tick
// 2. DB is fetched only on user actions and once on init
// 3. startClock() only updates the clock display — no DB
// 4. Settings cached via getSettings() in config.js
// 5. All buttons properly enabled/disabled

if (!Session.requireEmployee()) throw new Error('Not authorized');
renderSidebarUser();

const session = Session.get();
const userId  = session.id;

// ---- LOCAL STATE (updated from DB only on actions/init) ----
let localState = {
  status:         'offline',   // 'offline' | 'online' | 'break'
  onlineTime:     null,        // ISO string when went online today
  totalBreakSec:  0,           // confirmed closed breaks total
  openBreakStart: null,        // ISO string if currently on break
  openBreakType:  null,        // break type string
  workingSec:     0,           // final value when offline
  dateKey:        T.todayKey(),
  recId:          null,        // attendance row id
  settings:       null         // cached settings object
};

let workIntervalId = null;
let clockIntervalId = null;
let idleTimerId    = null;
let idleShown      = false;
let breakWarned    = false;
let detailTaskId   = null;
let isActionLocked = false;    // prevents double-clicks during async ops

// ---- INIT ----
async function init() {
  // Greeting
  const now = new Date();
  const h   = now.getHours();
  const greet = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const icon  = h < 12 ? '☀️' : h < 17 ? '🌤' : '🌆';
  const greetEl = document.getElementById('greeting');
  if (greetEl) greetEl.textContent = `${greet}, ${session.name}! ${icon}`;
  const dateEl = document.getElementById('emp-date');
  if (dateEl) dateEl.textContent = now.toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const loginEl = document.getElementById('i-login');
  if (loginEl) loginEl.textContent = T.fmtTime(session.loginTime);

  // Load settings into cache
  localState.settings = await getSettings();
  const bwMax = document.getElementById('bw-max');
  if (bwMax) bwMax.textContent = localState.settings.max_break_minutes;

  // Load today's attendance from DB
  await syncStateFromDB();

  // Start clock (display only — no DB calls)
  startClock();

  // Start idle detection
  startIdleDetection();

  // Initial UI update
  renderTimers();
  updateBreakLog();
}

// ---- SYNC STATE FROM DB (called on init and after each action) ----
async function syncStateFromDB() {
  try {
    const today = T.todayKey();
    const { data: rec } = await db.from('attendance').select('*')
      .eq('user_id', userId).eq('date_key', today).maybeSingle();

    if (rec) {
      localState.status        = rec.status;
      localState.onlineTime    = rec.online_time;
      localState.totalBreakSec = rec.total_break_sec || 0;
      localState.workingSec    = rec.working_sec || 0;
      localState.recId         = rec.id;
      localState.dateKey       = rec.date_key;

      // If on break, load the open break
      if (rec.status === 'break') {
        const { data: openBrk } = await db.from('breaks').select('*')
          .eq('user_id', userId).is('end_time', null).maybeSingle();
        localState.openBreakStart = openBrk ? openBrk.start_time : null;
        localState.openBreakType  = openBrk ? openBrk.type : null;
      } else {
        localState.openBreakStart = null;
        localState.openBreakType  = null;
      }
    } else {
      localState.status = 'offline';
    }

    // Refresh settings cache
    localState.settings = await getSettings();

    // Update session info fields
    const onlineEl = document.getElementById('i-online');
    if (onlineEl) onlineEl.textContent = localState.onlineTime ? T.fmtTime(localState.onlineTime) : '--';
    const brkEl = document.getElementById('i-brk');
    if (brkEl) brkEl.textContent = localState.openBreakType || '--';

    // Apply UI state
    if (localState.status === 'online')  setUIOnline();
    else if (localState.status === 'break') setUIBreak(localState.openBreakType);
    else setUIOffline();

    // Start/stop work timer
    if (localState.status === 'online' || localState.status === 'break') {
      startWorkTimer();
    } else {
      stopWorkTimer();
    }
  } catch(e) {
    console.error('syncStateFromDB error:', e);
  }
}

// ---- CLOCK (display only — no DB calls ever) ----
function startClock() {
  if (clockIntervalId) clearInterval(clockIntervalId);
  clockIntervalId = setInterval(() => {
    const clockEl = document.getElementById('clock');
    if (clockEl) clockEl.textContent = new Date().toLocaleTimeString('en-US');
  }, 1000);
}

// ---- WORK TIMER (pure local math — no DB calls) ----
function startWorkTimer() {
  stopWorkTimer();
  workIntervalId = setInterval(renderTimers, 1000);
}
function stopWorkTimer() {
  if (workIntervalId) { clearInterval(workIntervalId); workIntervalId = null; }
}

// ---- RENDER TIMERS (pure local math — ZERO DB calls) ----
function renderTimers() {
  const s   = localState.settings || getDefaultSettings();
  const now = Date.now();

  let breakSec = localState.totalBreakSec;
  let workSec  = 0;

  if (localState.status === 'break' && localState.openBreakStart) {
    breakSec += Math.floor((now - new Date(localState.openBreakStart)) / 1000);
  }

  if (localState.status === 'offline') {
    workSec  = localState.workingSec;
    breakSec = localState.totalBreakSec;
  } else if (localState.onlineTime) {
    const onlineSec = Math.floor((now - new Date(localState.onlineTime)) / 1000);
    workSec = Math.max(0, onlineSec - breakSec);
  }

  const dutyTotal = s.duty_hours * 3600;
  const maxBreak  = s.max_break_minutes * 60;
  const breakLeft = Math.max(0, maxBreak - breakSec);
  const dutyLeft  = Math.max(0, dutyTotal - workSec);
  const score     = calcScoreSync(breakSec, s);

  // ---- Update DOM ----
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('work-timer', T.fmt(workSec));
  set('w-card',     T.fmt(workSec));
  set('b-card',     T.fmt(breakSec));
  set('br-card',    T.fmt(breakLeft));
  set('d-card',     T.fmt(dutyLeft));

  // Progress bars
  const setProg = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = Math.min(100, pct) + '%'; };
  const wp  = dutyTotal  > 0 ? (workSec  / dutyTotal)  * 100 : 0;
  const bp  = maxBreak   > 0 ? (breakSec / maxBreak)   * 100 : 0;
  const brp = maxBreak   > 0 ? (breakLeft / maxBreak)  * 100 : 100;
  const dp  = dutyTotal  > 0 ? (workSec  / dutyTotal)  * 100 : 0;
  setProg('w-prog',  wp);
  setProg('b-prog',  bp);
  setProg('br-prog', brp);
  setProg('d-prog',  dp);

  // Break bar turns red when over limit
  const bProg = document.getElementById('b-prog');
  if (bProg) bProg.style.background = breakSec > maxBreak
    ? 'linear-gradient(90deg,var(--red),#f87171)'
    : 'linear-gradient(90deg,var(--orange),#fbbf24)';

  // Labels
  set('w-lbl',  `${Math.round(wp)}% of ${s.duty_hours}h duty`);
  set('b-lbl',  `${Math.round(breakSec / 60)} min used of ${s.max_break_minutes}`);
  set('br-lbl', `${Math.round(breakLeft / 60)} min left`);
  set('d-lbl',  `${Math.round(dp)}% complete`);

  // Score
  const isGood   = score >= s.daily_score;
  const srEl     = document.getElementById('score-ring');
  const slEl     = document.getElementById('score-label');
  const sdEl     = document.getElementById('score-detail');
  if (srEl) { srEl.textContent = score; srEl.className = `score-ring ${isGood ? 'sr-good' : 'sr-bad'}`; }
  if (slEl) { slEl.textContent = isGood ? 'Perfect Score ✓' : 'Penalty Applied ⚠'; slEl.style.color = isGood ? 'var(--green)' : 'var(--red)'; }
  if (sdEl) {
    const extra = Math.max(0, breakSec - maxBreak);
    sdEl.textContent = extra > 0 ? `+${Math.round(extra / 60)} min over limit` : 'No penalties';
  }

  // Break warning at 80% usage (only fires once)
  if (!breakWarned && localState.status !== 'offline' && breakSec >= maxBreak * 0.8 && breakSec < maxBreak) {
    breakWarned = true;
    const bwLeft = document.getElementById('bw-left');
    if (bwLeft) bwLeft.textContent = Math.round(breakLeft / 60) + ' min';
    openModal('m-brk-warn');
  }
}

// ---- ACTION LOCK (prevents double-click while DB is busy) ----
function lockActions(lock) {
  isActionLocked = lock;
  ['btn-on','btn-brk','btn-ebrk','btn-off'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (lock) {
      el.setAttribute('data-was-disabled', el.disabled ? '1' : '0');
      el.disabled = true;
    } else {
      // Restore correct state via UI function
    }
  });
}

// ---- GO ONLINE ----
async function goOnline() {
  if (isActionLocked) return;
  lockActions(true);
  const now   = T.now();
  const today = T.todayKey();
  try {
    const { data: existing } = await db.from('attendance').select('*')
      .eq('user_id', userId).eq('date_key', today).maybeSingle();

    if (existing) {
      await db.from('attendance').update({
        status:     'online',
        online_time: existing.online_time || now,
        login_time:  existing.login_time  || now
      }).eq('id', existing.id);
    } else {
      await db.from('attendance').insert({
        id:              `att_${userId}_${today}`,
        user_id:         userId,
        date_key:        today,
        login_time:      now,
        online_time:     now,
        status:          'online',
        total_break_sec: 0,
        working_sec:     0,
        score:           null
      });
    }

    await syncStateFromDB();
    showToast('You are now Online 🟢', 'success');
    breakWarned = false;
    renderTimers();
    startWorkTimer();
  } catch(e) {
    showToast('Error connecting. Please try again.', 'error');
    console.error('goOnline error:', e);
    lockActions(false);
    setUIOffline();
  }
}

// ---- TAKE BREAK ----
async function takeBreak() {
  if (isActionLocked) return;
  lockActions(true);
  const type  = document.getElementById('break-type')?.value || 'Short Break';
  const now   = T.now();
  const today = T.todayKey();
  try {
    const settings = await getSettings();
    if (localState.totalBreakSec >= settings.max_break_minutes * 60) {
      showToast('Break limit already reached!', 'error');
      lockActions(false);
      setUIOnline();
      return;
    }

    await db.from('breaks').insert({
      id:           `brk_${userId}_${Date.now()}`,
      user_id:      userId,
      date_key:     today,
      type:         type,
      start_time:   now,
      end_time:     null,
      duration_sec: 0
    });

    await db.from('attendance').update({ status: 'break' })
      .eq('user_id', userId).eq('date_key', today);

    await syncStateFromDB();
    showToast(`${type} started ☕`, 'info');
    renderTimers();
  } catch(e) {
    showToast('Error starting break. Please try again.', 'error');
    console.error('takeBreak error:', e);
    lockActions(false);
    setUIOnline();
  }
}

// ---- END BREAK ----
async function endBreak() {
  if (isActionLocked) return;
  lockActions(true);
  const now   = T.now();
  const today = T.todayKey();
  try {
    const { data: openBrk } = await db.from('breaks').select('*')
      .eq('user_id', userId).is('end_time', null).maybeSingle();

    if (openBrk) {
      const dur = T.diff(openBrk.start_time, now);
      await db.from('breaks').update({ end_time: now, duration_sec: dur }).eq('id', openBrk.id);

      const { data: rec } = await db.from('attendance').select('total_break_sec')
        .eq('user_id', userId).eq('date_key', today).maybeSingle();

      const newBreakTotal = ((rec && rec.total_break_sec) || 0) + dur;
      await db.from('attendance').update({
        status:          'online',
        total_break_sec: newBreakTotal
      }).eq('user_id', userId).eq('date_key', today);

      await syncStateFromDB();
      showToast(`Break ended — ${T.fmt(dur)}`, 'success');
      renderTimers();
      updateBreakLog();
    } else {
      // No open break found — just mark online
      await db.from('attendance').update({ status: 'online' })
        .eq('user_id', userId).eq('date_key', today);
      await syncStateFromDB();
      setUIOnline();
    }
  } catch(e) {
    showToast('Error ending break. Please try again.', 'error');
    console.error('endBreak error:', e);
    lockActions(false);
    setUIOnline();
  }
}

// ---- GO OFFLINE ----
async function goOffline() {
  if (isActionLocked) return;
  lockActions(true);
  const now   = T.now();
  const today = T.todayKey();
  try {
    // Close any open break first
    const { data: openBrk } = await db.from('breaks').select('*')
      .eq('user_id', userId).is('end_time', null).maybeSingle();

    let totalBreakSec = localState.totalBreakSec;
    if (openBrk) {
      const dur = T.diff(openBrk.start_time, now);
      await db.from('breaks').update({ end_time: now, duration_sec: dur }).eq('id', openBrk.id);
      totalBreakSec += dur;
    }

    const onlineTime = localState.onlineTime;
    const workSec = onlineTime
      ? Math.max(0, T.diff(onlineTime, now) - totalBreakSec)
      : 0;

    const settings  = localState.settings || await getSettings();
    const score     = calcScoreSync(totalBreakSec, settings);

    await db.from('attendance').update({
      status:          'offline',
      offline_time:    now,
      working_sec:     workSec,
      total_break_sec: totalBreakSec,
      score:           score
    }).eq('user_id', userId).eq('date_key', today);

    await syncStateFromDB();
    stopWorkTimer();
    showToast(`Offline. Score: ${score}/${settings.daily_score}`, score >= settings.daily_score ? 'success' : 'warning');
    renderTimers();
    updateBreakLog();
  } catch(e) {
    showToast('Error going offline. Please try again.', 'error');
    console.error('goOffline error:', e);
    lockActions(false);
    setUIOnline();
  }
}

// ---- UI STATES ----
function setUIOnline() {
  isActionLocked = false;
  const panel = document.getElementById('status-panel');
  const ring  = document.getElementById('status-ring');
  const emoji = document.getElementById('s-emoji');
  const label = document.getElementById('s-label');
  if (panel) panel.className = 'status-panel s-online';
  if (ring)  ring.className  = 'status-ring r-online';
  if (emoji) emoji.textContent = '💼';
  if (label) label.textContent = 'Online';

  const btnOn   = document.getElementById('btn-on');
  const btnBrk  = document.getElementById('btn-brk');
  const btnEBrk = document.getElementById('btn-ebrk');
  const btnOff  = document.getElementById('btn-off');
  const brkRow  = document.getElementById('break-select-row');

  if (btnOn)   btnOn.disabled   = true;
  if (btnBrk)  btnBrk.disabled  = false;
  if (btnEBrk) { btnEBrk.style.display = 'none'; btnEBrk.disabled = true; }
  if (btnOff)  btnOff.disabled  = false;
  if (brkRow)  brkRow.style.display = 'block';
}

function setUIBreak(type) {
  isActionLocked = false;
  const emojis = { 'Lunch':'🍽', 'Short Break':'☕', 'Spiritual Break':'🙏', 'Washroom':'🚻' };
  const panel = document.getElementById('status-panel');
  const ring  = document.getElementById('status-ring');
  const emoji = document.getElementById('s-emoji');
  const label = document.getElementById('s-label');
  if (panel) panel.className = 'status-panel s-break';
  if (ring)  ring.className  = 'status-ring r-break';
  if (emoji) emoji.textContent = emojis[type] || '☕';
  if (label) label.textContent = type || 'On Break';

  const btnOn   = document.getElementById('btn-on');
  const btnBrk  = document.getElementById('btn-brk');
  const btnEBrk = document.getElementById('btn-ebrk');
  const btnOff  = document.getElementById('btn-off');
  const brkRow  = document.getElementById('break-select-row');

  if (btnOn)   btnOn.disabled   = true;
  if (btnBrk)  btnBrk.disabled  = true;
  if (btnEBrk) { btnEBrk.style.display = 'inline-flex'; btnEBrk.disabled = false; }
  if (btnOff)  btnOff.disabled  = true;
  if (brkRow)  brkRow.style.display = 'none';

  // Update info panel
  const brkEl = document.getElementById('i-brk');
  if (brkEl) brkEl.textContent = type || 'On Break';
}

function setUIOffline() {
  isActionLocked = false;
  const panel = document.getElementById('status-panel');
  const ring  = document.getElementById('status-ring');
  const emoji = document.getElementById('s-emoji');
  const label = document.getElementById('s-label');
  if (panel) panel.className = 'status-panel s-offline';
  if (ring)  ring.className  = 'status-ring r-offline';
  if (emoji) emoji.textContent = '💤';
  if (label) label.textContent = 'Offline';

  const btnOn   = document.getElementById('btn-on');
  const btnBrk  = document.getElementById('btn-brk');
  const btnEBrk = document.getElementById('btn-ebrk');
  const btnOff  = document.getElementById('btn-off');
  const brkRow  = document.getElementById('break-select-row');

  if (btnOn)   btnOn.disabled   = false;
  if (btnBrk)  btnBrk.disabled  = true;
  if (btnEBrk) { btnEBrk.style.display = 'none'; btnEBrk.disabled = true; }
  if (btnOff)  btnOff.disabled  = true;
  if (brkRow)  brkRow.style.display = 'none';

  const brkEl = document.getElementById('i-brk');
  if (brkEl) brkEl.textContent = '--';

  stopWorkTimer();
}

// ---- BREAK LOG ----
async function updateBreakLog() {
  const container = document.getElementById('brk-log');
  if (!container) return;
  try {
    const today = T.todayKey();
    const { data: brks } = await db.from('breaks').select('*')
      .eq('user_id', userId).eq('date_key', today).order('start_time');

    // Update break count
    const brkCount = document.getElementById('i-brkcount');
    if (brkCount) brkCount.textContent = brks ? brks.length : 0;

    if (!brks || !brks.length) {
      container.innerHTML = '<div class="empty-state"><div class="ei">☕</div><p>No breaks today</p></div>';
      return;
    }
    const emojis = { 'Lunch':'🍽', 'Short Break':'☕', 'Spiritual Break':'🙏', 'Washroom':'🚻' };
    container.innerHTML = `<div class="brk-list">${brks.map(b => `
      <div class="brk-item">
        <span class="brk-type">${emojis[b.type] || '☕'} ${b.type}</span>
        <span class="brk-time">${T.fmtTime(b.start_time)} → ${b.end_time ? T.fmtTime(b.end_time) : '...'}</span>
        <span class="brk-dur">${b.end_time ? T.fmt(b.duration_sec) : '...'}</span>
      </div>`).join('')}</div>`;
  } catch(e) {
    console.error('updateBreakLog error:', e);
  }
}

// ---- TASKS ----
async function loadEmpTasks() {
  try {
    const { data: tasks } = await db.from('tasks').select('*')
      .eq('assigned_to', userId).order('created_at', { ascending: false });

    const stages = ['todo', 'inprogress', 'review', 'done'];
    const counts = { todo:0, inprogress:0, review:0, done:0 };

    stages.forEach(s => {
      const col = document.getElementById('ek-col-' + s);
      const cnt = document.getElementById('ek-cnt-' + s);
      if (col) col.innerHTML = '';
      if (cnt) cnt.textContent = '0';
    });

    for (const t of (tasks || [])) {
      counts[t.stage] = (counts[t.stage] || 0) + 1;
      const card = document.createElement('div');
      card.className = 'task-card';
      card.innerHTML = `
        <div class="task-priority-strip strip-${t.priority}"></div>
        <div class="task-card-title">${t.title}</div>
        ${t.description ? `<p class="tsm t3" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:.4rem">${t.description}</p>` : ''}
        <div class="task-card-meta">
          ${priorityBadge(t.priority)}
          ${t.deadline ? `<span class="task-deadline ${deadlineClass(t.deadline)}">${deadlineText(t.deadline)}</span>` : ''}
        </div>`;
      card.onclick = () => openEmpTaskDetail(t.id);
      const col = document.getElementById('ek-col-' + t.stage);
      if (col) col.appendChild(card);
    }

    stages.forEach(s => {
      const cnt = document.getElementById('ek-cnt-' + s);
      if (cnt) cnt.textContent = counts[s] || 0;
      const col = document.getElementById('ek-col-' + s);
      if (col && !col.children.length) col.innerHTML = '<div class="empty-col">✦<span>No tasks</span></div>';
    });

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('tst-todo', counts.todo || 0);
    set('tst-ip',   counts.inprogress || 0);
    set('tst-rv',   counts.review || 0);
    set('tst-dn',   counts.done || 0);
  } catch(e) {
    console.error('loadEmpTasks error:', e);
  }
}

async function openEmpTaskDetail(id) {
  detailTaskId = id;
  try {
    const { data: t } = await db.from('tasks').select('*').eq('id', id).single();
    if (!t) return;

    let assignerName = t.assigned_by;
    try {
      const { data: assigner } = await db.from('users').select('name').eq('id', t.assigned_by).single();
      if (assigner) assignerName = assigner.name;
    } catch(e) {}

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const setHTML = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };
    const setVal  = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };

    set('etd-title', t.title);
    set('etd-desc',  t.description || 'No description');
    set('etd-by',    assignerName);
    setHTML('etd-priority', priorityBadge(t.priority));
    setHTML('etd-stage',    stageBadge(t.stage));
    setHTML('etd-deadline', t.deadline
      ? `<span class="${deadlineClass(t.deadline)}">${deadlineText(t.deadline)}</span>`
      : '—');
    setVal('etd-stage-sel', t.stage);
    setVal('etd-id', id);

    await empLoadComments(id);
    openModal('m-emp-task-detail');
  } catch(e) {
    showToast('Could not load task details', 'error');
    console.error('openEmpTaskDetail error:', e);
  }
}

async function empLoadComments(taskId) {
  const list = document.getElementById('etd-comments');
  if (!list) return;
  try {
    const { data: comments } = await db.from('task_comments').select('*')
      .eq('task_id', taskId).order('created_at');
    if (!comments || !comments.length) {
      list.innerHTML = '<div class="t3 tsm" style="text-align:center;padding:1rem">No comments yet</div>';
      return;
    }
    const userIds = [...new Set(comments.map(c => c.user_id))];
    const { data: users } = await db.from('users').select('id,name').in('id', userIds);
    const nameMap = {};
    (users || []).forEach(u => nameMap[u.id] = u.name);
    list.innerHTML = comments.map(c => `
      <div class="comment-item">
        <div><span class="comment-author">${nameMap[c.user_id] || c.user_id}</span>
        <span class="comment-time">${T.fmtDateTime(c.created_at)}</span></div>
        <div class="comment-text">${c.comment}</div>
      </div>`).join('');
    list.scrollTop = list.scrollHeight;
  } catch(e) {
    console.error('empLoadComments error:', e);
  }
}

async function empAddComment() {
  const input = document.getElementById('etd-comment-input');
  const text  = input ? input.value.trim() : '';
  if (!text || !detailTaskId) return;
  try {
    await db.from('task_comments').insert({
      id:       `cmt_${Date.now()}`,
      task_id:  detailTaskId,
      user_id:  userId,
      comment:  text
    });
    if (input) input.value = '';
    await empLoadComments(detailTaskId);
  } catch(e) {
    showToast('Could not post comment', 'error');
  }
}

async function empUpdateStage() {
  const idEl    = document.getElementById('etd-id');
  const stageEl = document.getElementById('etd-stage-sel');
  if (!idEl || !stageEl) return;
  const id    = idEl.value;
  const stage = stageEl.value;
  try {
    await db.from('tasks').update({ stage, updated_at: T.now() }).eq('id', id);
    const stageDisplay = document.getElementById('etd-stage');
    if (stageDisplay) stageDisplay.innerHTML = stageBadge(stage);
    showToast('Stage updated ✓', 'success');
    loadEmpTasks();
  } catch(e) {
    showToast('Could not update stage', 'error');
  }
}

// ---- NAV ----
function showSec(name, btn) {
  document.querySelectorAll('main section').forEach(s => s.style.display = 'none');
  const sec = document.getElementById('sec-' + name);
  if (sec) sec.style.display = 'block';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (btn) btn.classList.add('active');
  if (name === 'tasks')  loadEmpTasks();
  if (name === 'breaks') updateBreakLog();
}

// ---- IDLE DETECTION ----
function startIdleDetection() {
  let lastActivity = Date.now();
  ['mousemove', 'keydown', 'click', 'touchstart'].forEach(ev => {
    document.addEventListener(ev, () => {
      lastActivity = Date.now();
      if (idleShown) dismissIdle();
    }, { passive: true });
  });

  idleTimerId = setInterval(() => {
    if (localState.status !== 'online') return;
    if (!idleShown && Date.now() - lastActivity > 5 * 60 * 1000) {
      idleShown = true;
      const overlay = document.getElementById('idle-overlay');
      if (overlay) overlay.classList.add('show');
    }
  }, 30000);
}

function dismissIdle() {
  idleShown = false;
  const overlay = document.getElementById('idle-overlay');
  if (overlay) overlay.classList.remove('show');
}

// ---- START ----
init();
