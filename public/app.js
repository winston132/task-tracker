/* ════════════════════════════════════════════════════════════════════
   app.js — TrackFlow Frontend Logic
   Pure vanilla JS — no external libraries.
   Features:
     - Robust API client with seamless Offline / LocalStorage fallback
     - Full CRUD with persistent storage (tasks.json / localStorage)
     - Interactive Dashboard with animated donut, productivity chart, & stats
     - Full Kanban Board with quick actions & context menus
     - Table view with search, filter tabs & inline status change
     - Canvas-based Analytics (distribution pie chart, bar chart, weekly curve)
     - Projects grouping with progress metrics
     - Custom Settings: 8 color themes + solid/gradient/image backgrounds
     - Deadline & alert system with snooze & browser notifications
     - Interactive Help guide modal
   ════════════════════════════════════════════════════════════════════ */

'use strict';

// ── API Configuration & Connection Detection ──────────────────────────
function getApiBase() {
  if (window.location.protocol === 'file:' || !window.location.port || window.location.port !== '3000') {
    return 'http://localhost:3000/api';
  }
  return '/api';
}
const API = getApiBase();

let isServerOnline = false;
let isSyncing = false;

// ── State ────────────────────────────────────────────────────────────
let tasks         = [];
let currentFilter = 'all';
let currentView   = 'dashboard';
let editingId     = null;

// Notification / deadline state
let alertQueue    = [];      // queued {task, type} alerts
let currentAlert  = null;    // currently displayed alert
const firedNotifs = new Set(
  JSON.parse(localStorage.getItem('tf-fired-notifs') || '[]')
);

// ── DOM Refs ─────────────────────────────────────────────────────────
const sidebar       = document.getElementById('sidebar');
const pageTitle     = document.getElementById('pageTitle');
const taskModal     = document.getElementById('taskModal');
const taskForm      = document.getElementById('taskForm');
const modalTitle    = document.getElementById('modalTitle');
const editIdInput   = document.getElementById('editId');
const fDesc         = document.getElementById('fDesc');
const fStatus       = document.getElementById('fStatus');
const fPriority     = document.getElementById('fPriority');
const fProject      = document.getElementById('fProject');
const fAssignee     = document.getElementById('fAssignee');
const fDueDate      = document.getElementById('fDueDate');
const fProgress     = document.getElementById('fProgress');
const progressVal   = document.getElementById('progressVal');
const notifPanel    = document.getElementById('notifPanel');
const notifList     = document.getElementById('notifList');
const toast         = document.getElementById('toast');
const globalSearch  = document.getElementById('globalSearch');
const notifBar      = document.getElementById('notifBar');
const deadlineAlert = document.getElementById('deadlineAlert');
const connBadge     = document.getElementById('connBadge');
const helpModal     = document.getElementById('helpModal');

// ── Local Storage Cache & Fallback ────────────────────────────────────
function getLocalTasks() {
  try {
    const raw = localStorage.getItem('tf-local-tasks');
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

function setLocalTasks(arr) {
  try {
    localStorage.setItem('tf-local-tasks', JSON.stringify(arr));
  } catch (e) {
    console.error('LocalStorage write error:', e);
  }
}

function updateConnBadge(online) {
  isServerOnline = online;
  if (!connBadge) return;
  if (online) {
    connBadge.className = 'conn-badge connected';
    connBadge.textContent = '🟢 Server Connected';
    connBadge.title = 'Connected to http://localhost:3000 (tasks.json synced). Click to re-check.';
  } else {
    connBadge.className = 'conn-badge offline';
    connBadge.textContent = '🟡 Local Mode (Offline)';
    connBadge.title = 'Server not reachable. Tasks saved locally. Click to retry connecting to Docker.';
  }
}

connBadge?.addEventListener('click', async () => {
  showToast('Testing connection to server...', 'info');
  const ok = await checkServerConnection(true);
  if (ok) {
    await loadTasks();
  }
});

// ── Robust API Client (With Offline Fallback) ─────────────────────────
async function apiFetch(path, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(API + path, { ...opts, signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Server responded with ${res.status}`);
    }
    const data = await res.json();
    if (!isServerOnline) {
      updateConnBadge(true);
    }
    return data;
  } catch (err) {
    // Network / connection error -> gracefully fall back to local storage
    if (isServerOnline) {
      console.warn(`Server unreachable (${err.message}). Switching to Local Mode.`);
      updateConnBadge(false);
    }
    return handleLocalFallback(path, method, body);
  }
}

function handleLocalFallback(path, method, body) {
  let local = getLocalTasks();

  // GET /tasks
  if (path.startsWith('/tasks') && method === 'GET') {
    return local;
  }

  // POST /tasks
  if (path === '/tasks' && method === 'POST') {
    const nextId = local.length > 0 ? Math.max(...local.map(t => t.id || 0)) + 1 : 1;
    const newTask = {
      id: nextId,
      description: (body && body.description ? body.description.trim() : 'New Task'),
      status: (body && body.status) || 'todo',
      priority: (body && body.priority) || 'medium',
      project: (body && body.project) || '',
      progress: (body && body.progress) || 0,
      assignee: (body && body.assignee) || '',
      dueDate: (body && body.dueDate) || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      _needsSync: true,
    };
    local.push(newTask);
    setLocalTasks(local);
    return newTask;
  }

  // Match /tasks/:id
  const match = path.match(/^\/tasks\/(\d+)$/);
  if (match) {
    const id = parseInt(match[1]);
    const idx = local.findIndex(t => t.id === id);

    // DELETE /tasks/:id
    if (method === 'DELETE') {
      if (idx !== -1) {
        local.splice(idx, 1);
        setLocalTasks(local);
      }
      return { message: 'Task deleted locally.' };
    }

    // PUT or PATCH /tasks/:id
    if (idx !== -1 && (method === 'PUT' || method === 'PATCH')) {
      local[idx] = {
        ...local[idx],
        ...body,
        id,
        updatedAt: new Date().toISOString(),
        _needsSync: true,
      };
      setLocalTasks(local);
      return local[idx];
    }
  }

  // GET /stats
  if (path === '/stats' && method === 'GET') {
    const done = local.filter(t => t.status === 'done').length;
    const inProgress = local.filter(t => t.status === 'in-progress').length;
    const todo = local.filter(t => t.status === 'todo').length;
    return { total: local.length, done, inProgress, todo, overdue: 0 };
  }

  return local;
}

// Check server status periodically & sync local modifications
async function checkServerConnection(notify = false) {
  try {
    const controller = new AbortController();
    const tId = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(API + '/stats', { signal: controller.signal });
    clearTimeout(tId);
    if (res.ok) {
      if (!isServerOnline) {
        updateConnBadge(true);
        if (notify) showToast('🟢 Connected to TrackFlow server!', 'success');
        await syncLocalToServer();
      }
      return true;
    }
  } catch (_) {}
  updateConnBadge(false);
  if (notify) showToast('⚠️ Running in Local Mode (Server offline). Start Docker to sync.', 'info');
  return false;
}

async function syncLocalToServer() {
  if (isSyncing) return;
  isSyncing = true;
  try {
    const local = getLocalTasks();
    const unsynced = local.filter(t => t._needsSync);
    if (unsynced.length > 0) {
      for (const t of unsynced) {
        const payload = { ...t };
        delete payload._needsSync;
        delete payload.id;
        await fetch(API + '/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      showToast(`Synced ${unsynced.length} local task(s) with server ✓`, 'success');
    }
    // Refresh tasks from server
    const remote = await fetch(API + '/tasks').then(r => r.json());
    if (Array.isArray(remote)) {
      tasks = remote;
      setLocalTasks(remote);
      render();
    }
  } catch (err) {
    console.warn('Sync failed:', err);
  } finally {
    isSyncing = false;
  }
}

async function loadTasks() {
  try {
    const data = await apiFetch('/tasks');
    tasks = Array.isArray(data) ? data : [];
    setLocalTasks(tasks);
  } catch (e) {
    console.error('loadTasks error:', e);
    tasks = getLocalTasks();
  }
  render();
}

// ── Toast System ──────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'info') {
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3200);
}

// ── Navigation ────────────────────────────────────────────────────────
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const targetView = document.getElementById(`view-${view}`);
  if (targetView) targetView.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.view === view);
  });
  const titles = {
    dashboard: 'Dashboard', tasks: 'My Tasks', kanban: 'Kanban Board',
    analytics: 'Analytics', projects: 'Projects', settings: 'Settings',
  };
  if (pageTitle) pageTitle.textContent = titles[view] || view;
  render();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    switchView(item.dataset.view);
  });
});

// ── Help Modal ────────────────────────────────────────────────────────
const helpBtn = document.getElementById('helpBtn');
const closeHelpModal = document.getElementById('closeHelpModal');
const ackHelpModal = document.getElementById('ackHelpModal');

helpBtn?.addEventListener('click', () => helpModal?.classList.remove('hidden'));
closeHelpModal?.addEventListener('click', () => helpModal?.classList.add('hidden'));
ackHelpModal?.addEventListener('click', () => helpModal?.classList.add('hidden'));
helpModal?.addEventListener('click', e => { if (e.target === helpModal) helpModal.classList.add('hidden'); });

// ── Task Modal (Create & Edit) ─────────────────────────────────────────
function openModal(task = null, defaultStatus = 'todo') {
  editingId = task ? task.id : null;
  if (modalTitle) modalTitle.textContent = task ? `Edit Task #${task.id}` : 'Create Task';
  if (editIdInput) editIdInput.value = task ? task.id : '';
  if (fDesc) fDesc.value = task ? task.description : '';
  if (fStatus) fStatus.value = task ? task.status : defaultStatus;
  if (fPriority) fPriority.value = task ? (task.priority || 'medium') : 'medium';
  if (fProject) fProject.value = task ? (task.project || '') : '';
  if (fAssignee) fAssignee.value = task ? (task.assignee || '') : '';
  if (fDueDate) fDueDate.value = task && task.dueDate ? toLocalDatetimeInput(task.dueDate) : '';
  if (fProgress) {
    fProgress.value = task ? (task.progress || 0) : 0;
    if (progressVal) progressVal.textContent = fProgress.value;
  }
  taskModal?.classList.remove('hidden');
  setTimeout(() => fDesc?.focus(), 50);
}

function closeModal() {
  taskModal?.classList.add('hidden');
  editingId = null;
}

document.getElementById('createTaskBtn')?.addEventListener('click', () => openModal());
document.getElementById('addTaskInline')?.addEventListener('click', () => openModal());
document.getElementById('closeModal')?.addEventListener('click', closeModal);
document.getElementById('cancelModal')?.addEventListener('click', closeModal);
taskModal?.addEventListener('click', e => { if (e.target === taskModal) closeModal(); });
fProgress?.addEventListener('input', () => { if (progressVal) progressVal.textContent = fProgress.value; });

taskForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const desc = fDesc.value.trim();
  if (!desc) {
    showToast('Task description cannot be empty', 'error');
    return;
  }
  const dueDateRaw = fDueDate.value;
  const payload = {
    description: desc,
    status:    fStatus.value,
    priority:  fPriority.value,
    project:   fProject.value.trim(),
    assignee:  fAssignee.value.trim(),
    dueDate:   dueDateRaw ? new Date(dueDateRaw).toISOString() : null,
    progress:  parseInt(fProgress.value) || 0,
  };

  try {
    if (editingId) {
      await apiFetch(`/tasks/${editingId}`, 'PUT', payload);
      firedNotifs.delete(`${editingId}-warn`);
      firedNotifs.delete(`${editingId}-over`);
      saveFiredNotifs();
      showToast('Task updated successfully ✓', 'success');
      addNotif(`Task #${editingId} updated: "${desc}"`);
    } else {
      const created = await apiFetch('/tasks', 'POST', payload);
      showToast(`Task created (ID: ${created.id}) ✓`, 'success');
      addNotif(`New task created: "${created.description}"${created.dueDate ? ' ⏰ ' + fmtDateTime(created.dueDate) : ''}`);
    }
    closeModal();
    await loadTasks();
  } catch (err) {
    showToast('Notice: ' + err.message, 'info');
    closeModal();
    await loadTasks();
  }
});

// ── Delete / Status Change ────────────────────────────────────────────
async function deleteTask(id) {
  if (!confirm(`Delete task #${id}?`)) return;
  try {
    await apiFetch(`/tasks/${id}`, 'DELETE');
    firedNotifs.delete(`${id}-warn`);
    firedNotifs.delete(`${id}-over`);
    saveFiredNotifs();
    showToast(`Task #${id} deleted`, 'info');
    addNotif(`Task #${id} deleted`);
    await loadTasks();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

async function patchStatus(id, status) {
  try {
    await apiFetch(`/tasks/${id}`, 'PATCH', { status });
    if (status === 'done') {
      firedNotifs.delete(`${id}-warn`);
      firedNotifs.delete(`${id}-over`);
      saveFiredNotifs();
      if (currentAlert && currentAlert.task.id === id) closeDeadlineAlert();
    }
    await loadTasks();
    showToast(`Status updated to "${status}"`, 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

// ── Notifications Drawer ──────────────────────────────────────────────
function addNotif(msg) {
  if (!notifList) return;
  const item = document.createElement('div');
  item.className = 'notif-item';
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  item.textContent = `[${t}] ${msg}`;
  notifList.prepend(item);
}

document.getElementById('notifBtn')?.addEventListener('click', e => {
  e.stopPropagation();
  notifPanel?.classList.toggle('hidden');
});
document.addEventListener('click', e => {
  if (notifPanel && !notifPanel.contains(e.target)) notifPanel.classList.add('hidden');
});

// ── Global Search ─────────────────────────────────────────────────────
globalSearch?.addEventListener('input', debounce(() => {
  const q = globalSearch.value.toLowerCase().trim();
  if (!q) { render(); return; }
  const filtered = tasks.filter(t =>
    (t.description || '').toLowerCase().includes(q) ||
    (t.project || '').toLowerCase().includes(q) ||
    (t.assignee || '').toLowerCase().includes(q)
  );
  renderTaskTable(filtered);
  if (currentView !== 'tasks') switchView('tasks');
}, 200));

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Master Render Dispatch ────────────────────────────────────────────
function render() {
  renderDashboard();
  renderTaskTable();
  renderKanban('kanbanFull');
  renderAnalytics();
  renderProjects();
}

// ── Dashboard View ────────────────────────────────────────────────────
function renderDashboard() {
  const done     = tasks.filter(t => t.status === 'done').length;
  const inProg   = tasks.filter(t => t.status === 'in-progress').length;
  const todo     = tasks.filter(t => t.status === 'todo').length;
  const total    = tasks.length;
  const overdue  = tasks.filter(t => isOverdue(t)).length;
  const pct      = total ? Math.round((done / total) * 100) : 0;
  const circ     = 238.76;

  const donutPctEl = document.getElementById('donutPct');
  const statDoneEl = document.getElementById('statDone');
  const statPendingEl = document.getElementById('statPending');
  const statProgressEl = document.getElementById('statProgress');
  const statOverdueEl = document.getElementById('statOverdue');
  const donutSegEl = document.getElementById('donutSeg');

  if (donutPctEl) donutPctEl.textContent = pct + '%';
  if (statDoneEl) statDoneEl.textContent = done;
  if (statPendingEl) statPendingEl.textContent = todo;
  if (statProgressEl) statProgressEl.textContent = inProg;
  if (statOverdueEl) statOverdueEl.textContent = overdue;
  if (donutSegEl) donutSegEl.style.strokeDashoffset = circ - (circ * pct / 100);

  // Urgent tasks (high priority or due within 1 hour, not completed)
  const urgent = tasks.filter(t => (t.priority === 'high' || isDueWithinHour(t)) && t.status !== 'done').slice(0, 5);
  const ul = document.getElementById('urgentList');
  if (ul) {
    ul.innerHTML = urgent.length ? urgent.map(t => `
      <div class="urgent-item">
        <input type="checkbox" class="urg-check" ${t.status === 'done' ? 'checked' : ''}
          onchange="patchStatus(${t.id}, this.checked ? 'done' : 'todo')" />
        <span class="urg-desc" title="${esc(t.description)}">${esc(t.description)}</span>
        ${dueDateBadge(t)}
        <span class="badge ${t.priority || 'high'}">${cap(t.priority || 'high')}</span>
      </div>`).join('')
    : '<div class="empty-state">No urgent tasks 🎉</div>';
  }

  drawActivityChart();
  renderKanban('dashKanban', true);
}

// ── Activity Chart (Canvas Line/Area) ─────────────────────────────────
function drawActivityChart() {
  const canvas = document.getElementById('activityChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const base = Math.max(tasks.length, 5);
  const pts = [
    Math.round(base * 0.3), Math.round(base * 0.5), Math.round(base * 0.4),
    Math.round(base * 0.8), Math.round(base * 0.6), Math.round(base * 0.9), Math.round(base * 0.7)
  ];
  drawSmoothChart(ctx, pts, W, H, getAccentColor());
}

function drawSmoothChart(ctx, pts, W, H, accent, padT=10, padB=10, padL=10, padR=10) {
  const max  = Math.max(...pts, 1);
  const pw   = W - padL - padR;
  const ph   = H - padT - padB;
  const step = pw / (pts.length - 1);
  const xs   = pts.map((_, i) => padL + i * step);
  const ys   = pts.map(v => padT + ph - (v / max) * ph);

  const grad = ctx.createLinearGradient(0, padT, 0, H);
  grad.addColorStop(0, accent + '55');
  grad.addColorStop(1, accent + '00');

  // Fill area under curve
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i < xs.length; i++) {
    const cx = (xs[i-1] + xs[i]) / 2;
    ctx.bezierCurveTo(cx, ys[i-1], cx, ys[i], xs[i], ys[i]);
  }
  ctx.lineTo(xs[xs.length-1], H);
  ctx.lineTo(xs[0], H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Smooth line
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i < xs.length; i++) {
    const cx = (xs[i-1] + xs[i]) / 2;
    ctx.bezierCurveTo(cx, ys[i-1], cx, ys[i], xs[i], ys[i]);
  }
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Highlight points
  xs.forEach((x, i) => {
    ctx.beginPath();
    ctx.arc(x, ys[i], 3.5, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  });
}

function getAccentColor() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim() || '#4f6ef7';
}

// ── Kanban Board ──────────────────────────────────────────────────────
function renderKanban(containerId, mini = false) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const cols = [
    { id: 'todo',        label: 'To Do',            defaultStatus: 'todo' },
    { id: 'in-progress', label: 'In Progress',       defaultStatus: 'in-progress' },
    { id: 'done',        label: 'Review/Completed',  defaultStatus: 'done' },
  ];

  container.innerHTML = cols.map(col => {
    const colTasks = tasks.filter(t => t.status === col.id);
    const cards    = colTasks.map(t => kanbanCard(t, mini)).join('');
    return `
      <div class="kanban-col" data-col="${col.id}">
        <div class="kanban-col-header">
          <span>${esc(col.label)}</span>
          <span class="kanban-col-count">${colTasks.length}</span>
          <button class="btn-icon" title="Options" onclick="openModal(null, '${col.defaultStatus}')">＋</button>
        </div>
        <div class="kanban-cards">${cards || '<div class="empty-state">No tasks here</div>'}</div>
        ${mini ? '' : `<button class="add-task-btn" onclick="openModal(null, '${col.defaultStatus}')">+ Add Task</button>`}
      </div>`;
  }).join('');

  container.querySelectorAll('.kanban-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.classList.contains('btn-icon') || e.target.tagName === 'SELECT') return;
      const id = parseInt(card.dataset.id);
      const t  = tasks.find(x => x.id === id);
      if (t) openModal(t);
    });
  });
}

function kanbanCard(t, mini) {
  const prog       = t.progress || 0;
  const badgeHtml  = t.priority ? `<span class="badge ${t.priority}">${cap(t.priority)}</span>` : '';
  const assigneeHtml = t.assignee
    ? `<div class="avatar av1" style="width:22px;height:22px;font-size:.65rem" title="${esc(t.assignee)}">${t.assignee[0].toUpperCase()}</div>` : '';
  const progressHtml = (!mini && prog > 0) ? `
    <div class="kanban-card-footer">
      <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${prog}%"></div></div>
      <div class="progress-pct">${prog}%</div>
    </div>` : '';
  const doneStyle  = t.status === 'done' ? 'text-decoration:line-through;opacity:.7;' : '';
  const dueBadge   = !mini ? dueDateBadge(t) : '';

  let cardClass = 'kanban-card';
  if (t.status !== 'done') {
    if (isOverdue(t)) cardClass += ' card-overdue';
    else if (isDueSoon(t)) cardClass += ' card-soon';
  }

  return `
    <div class="${cardClass}" data-id="${t.id}">
      <div class="kanban-card-title" style="${doneStyle}">${esc(t.description)}</div>
      <div class="kanban-card-meta">
        ${badgeHtml}
        ${assigneeHtml}
        ${t.project ? `<span style="font-size:.72rem;color:var(--text-muted)">${esc(t.project)}</span>` : ''}
        <button class="btn-icon" style="margin-left:auto" onclick="event.stopPropagation();showCardMenu(event,${t.id})">···</button>
      </div>
      ${dueBadge ? `<div style="margin-top:.35rem">${dueBadge}</div>` : ''}
      ${progressHtml}
    </div>`;
}

function showCardMenu(e, id) {
  e.stopPropagation();
  const old = document.getElementById('cardMenuPop');
  if (old) old.remove();
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  const pop = document.createElement('div');
  pop.id = 'cardMenuPop';
  pop.style.cssText = `position:fixed;z-index:500;background:var(--surface);border:1px solid var(--border);
    border-radius:10px;box-shadow:var(--shadow-lg);padding:.4rem 0;min-width:170px;
    left:${Math.min(e.clientX, window.innerWidth - 180)}px;top:${Math.min(e.clientY, window.innerHeight - 200)}px`;
  const items = [
    ['✏️ Edit',            () => openModal(t)],
    ['▶️ In Progress',     () => patchStatus(id, 'in-progress')],
    ['✅ Mark Done',        () => patchStatus(id, 'done')],
    ['↩️ Reset to Todo',   () => patchStatus(id, 'todo')],
    ['⏰ Set Deadline',    () => { openModal(t); setTimeout(() => fDueDate?.focus(), 100); }],
    ['🗑 Delete',          () => deleteTask(id)],
  ];
  items.forEach(([label, fn]) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = 'display:block;width:100%;text-align:left;padding:.45rem 1rem;background:none;border:none;cursor:pointer;font-size:.85rem;color:var(--text)';
    btn.onmouseenter = () => btn.style.background = 'var(--surface2)';
    btn.onmouseleave = () => btn.style.background = 'none';
    btn.onclick = () => { pop.remove(); fn(); };
    pop.appendChild(btn);
  });
  document.body.appendChild(pop);
  setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }), 0);
}

// ── Global Scope Bindings for Inline HTML handlers ────────────────────
window.showCardMenu = showCardMenu;
window.openModal    = openModal;
window.patchStatus  = patchStatus;
window.deleteTask   = deleteTask;

// ── Tasks Table View ──────────────────────────────────────────────────
function renderTaskTable(filtered = null) {
  const tbody = document.getElementById('taskTableBody');
  if (!tbody) return;

  let list = filtered || tasks;
  if (!filtered && currentFilter !== 'all') {
    list = tasks.filter(t => t.status === currentFilter);
  }
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No tasks found in this view.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(t => {
    const rowClass = isOverdue(t) ? 'row-overdue' : '';
    return `
    <tr class="${rowClass}">
      <td><strong>#${t.id}</strong></td>
      <td>${esc(t.description)}</td>
      <td>
        <select class="status-pill ${t.status}" onchange="patchStatus(${t.id},this.value)">
          <option value="todo"        ${t.status==='todo'        ?'selected':''}>To Do</option>
          <option value="in-progress" ${t.status==='in-progress' ?'selected':''}>In Progress</option>
          <option value="done"        ${t.status==='done'        ?'selected':''}>Done</option>
        </select>
      </td>
      <td><span class="badge ${t.priority||'medium'}">${cap(t.priority||'medium')}</span></td>
      <td>${dueDateBadge(t) || (t.dueDate ? fmtDateTime(t.dueDate) : '—')}</td>
      <td>${fmtDate(t.createdAt)}</td>
      <td>${fmtDate(t.updatedAt)}</td>
      <td>
        <div class="task-actions">
          <button class="btn-icon" title="Edit"   onclick="openModal(tasks.find(x=>x.id===${t.id}))">✏️</button>
          <button class="btn-icon" title="Delete" onclick="deleteTask(${t.id})">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// Ensure "Due Date" header exists in the table
(function patchTableHeader() {
  const thead = document.querySelector('.task-table thead tr');
  if (thead && thead.children.length === 7) {
    const dueTh = document.createElement('th');
    dueTh.textContent = 'Due Date';
    thead.insertBefore(dueTh, thead.children[4]);
  }
})();

document.querySelectorAll('.filter-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentFilter = tab.dataset.filter;
    renderTaskTable();
  });
});

// ── Analytics ─────────────────────────────────────────────────────────
function renderAnalytics() {
  drawPieChart();
  drawBarChart();
  drawWeeklyChart();
}

function drawPieChart() {
  const canvas = document.getElementById('pieChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const todo    = tasks.filter(t => t.status === 'todo').length;
  const prog    = tasks.filter(t => t.status === 'in-progress').length;
  const done    = tasks.filter(t => t.status === 'done').length;
  const overdue = tasks.filter(t => isOverdue(t)).length;
  const total   = tasks.length || 1;

  const slices = [
    { val: done,    color: '#10b981', label: 'Done' },
    { val: prog,    color: '#4f6ef7', label: 'In Progress' },
    { val: todo,    color: '#f59e0b', label: 'To Do' },
    { val: overdue, color: '#ef4444', label: 'Overdue' },
  ];

  let angle = -Math.PI / 2;
  const cx = W/2, cy = H/2, r = Math.min(W,H)/2 - 16;

  slices.forEach(s => {
    if (!s.val) return;
    const sweep = (s.val / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + sweep);
    ctx.closePath(); ctx.fillStyle = s.color; ctx.fill();
    angle += sweep;
  });

  const surfaceColor = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff';
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
  ctx.fillStyle = surfaceColor; ctx.fill();

  const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#111';
  const mutedColor = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#6b7280';
  ctx.fillStyle = textColor;
  ctx.font = 'bold 18px Segoe UI, system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(tasks.length, cx, cy - 8);
  ctx.font = '11px Segoe UI, system-ui';
  ctx.fillStyle = mutedColor;
  ctx.fillText('Total', cx, cy + 12);

  const legend = document.getElementById('pieLegend');
  if (legend) {
    legend.innerHTML = slices.filter(s => s.val > 0).map(s =>
      `<div class="pie-leg-item"><div class="pie-leg-dot" style="background:${s.color}"></div>${s.label}: ${s.val}</div>`
    ).join('');
  }
}

function drawBarChart() {
  const container = document.getElementById('barChart');
  if (!container) return;
  const stats = [
    { label:'To Do',       val:tasks.filter(t=>t.status==='todo').length,        color:'#f59e0b' },
    { label:'In Progress', val:tasks.filter(t=>t.status==='in-progress').length,  color:'#4f6ef7' },
    { label:'Done',        val:tasks.filter(t=>t.status==='done').length,          color:'#10b981' },
    { label:'Overdue',     val:tasks.filter(t=>isOverdue(t)).length,               color:'#ef4444' },
  ];
  const max = Math.max(...stats.map(s=>s.val), 1);
  container.innerHTML = stats.map(s => `
    <div class="bar-row">
      <div class="bar-label">${s.label}</div>
      <div class="bar-outer"><div class="bar-inner" style="width:${(s.val/max)*100}%;background:${s.color}"></div></div>
      <div class="bar-count">${s.val}</div>
    </div>`).join('');
}

function drawWeeklyChart() {
  const canvas = document.getElementById('weeklyChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const base = Math.max(tasks.length, 4);
  const pts  = [
    Math.round(base*0.25), Math.round(base*0.45), Math.round(base*0.3),
    Math.round(base*0.7),  Math.round(base*0.55), Math.round(base*0.85), Math.round(base*0.6)
  ];
  drawSmoothChart(ctx, pts, W, H, getAccentColor(), 15, 15, 15, 15);
}

// ── Projects View ─────────────────────────────────────────────────────
function renderProjects() {
  const container = document.getElementById('projectsGrid');
  if (!container) return;
  const projects = {};
  tasks.forEach(t => {
    const name = t.project || 'General';
    if (!projects[name]) projects[name] = { total:0, done:0, overdue:0 };
    projects[name].total++;
    if (t.status === 'done') projects[name].done++;
    if (isOverdue(t)) projects[name].overdue++;
  });
  const names = Object.keys(projects);
  if (!names.length) {
    container.innerHTML = '<div class="empty-state">No projects yet. Tag tasks with a project name to group them.</div>';
    return;
  }
  container.innerHTML = names.map(name => {
    const p   = projects[name];
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    return `
      <div class="project-card" onclick="filterByProject('${esc(name)}')">
        <div class="project-name">${esc(name)}</div>
        <div class="project-count">${p.total} task${p.total!==1?'s':''} · ${p.done} done${p.overdue ? ` · <span style="color:#ef4444">${p.overdue} overdue</span>` : ''}</div>
        <div class="project-bar-wrap"><div class="project-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');
}

function filterByProject(name) {
  switchView('tasks');
  document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
  currentFilter = 'all';
  const filtered = tasks.filter(t => (t.project || 'General') === name);
  renderTaskTable(filtered);
}
window.filterByProject = filterByProject;

document.getElementById('addProjectBtn')?.addEventListener('click', () => {
  openModal();
  setTimeout(() => fProject?.focus(), 100);
});

// ══════════════════════════════════════════════════════════════════════
// ── NOTIFICATION & DEADLINE ALERT ENGINE ─────────────────────────────
// ══════════════════════════════════════════════════════════════════════

function saveFiredNotifs() {
  const activeIds = new Set(
    tasks.filter(t => t.status !== 'done').map(t => `${t.id}`)
  );
  const pruned = [...firedNotifs].filter(key => {
    const id = key.split('-')[0];
    return activeIds.has(id);
  });
  pruned.forEach(k => firedNotifs.add(k));
  localStorage.setItem('tf-fired-notifs', JSON.stringify([...firedNotifs]));
}

async function requestNotifPermission() {
  if (!('Notification' in window)) {
    showToast('Your browser does not support desktop notifications', 'error');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    showToast('🔔 Browser notifications enabled!', 'success');
    notifBar?.classList.add('hidden');
    localStorage.setItem('tf-notif-bar-dismissed', 'true');
  } else {
    showToast('Notifications blocked in browser settings', 'error');
  }
}
window.requestNotifPermission = requestNotifPermission;

function dismissNotifBar() {
  notifBar?.classList.add('hidden');
  localStorage.setItem('tf-notif-bar-dismissed', 'true');
}
window.dismissNotifBar = dismissNotifBar;

function checkNotifBarVisibility() {
  const dismissed = localStorage.getItem('tf-notif-bar-dismissed') === 'true';
  const granted   = 'Notification' in window && Notification.permission === 'granted';
  if (!dismissed && !granted && 'Notification' in window && notifBar) {
    notifBar.classList.remove('hidden');
  }
}

function isOverdue(task) {
  if (!task.dueDate || task.status === 'done') return false;
  return new Date(task.dueDate).getTime() < Date.now();
}

function isDueSoon(task) {
  if (!task.dueDate || task.status === 'done') return false;
  const diff = new Date(task.dueDate).getTime() - Date.now();
  return diff >= 0 && diff <= 15 * 60 * 1000;
}

function isDueWithinHour(task) {
  if (!task.dueDate || task.status === 'done') return false;
  const diff = new Date(task.dueDate).getTime() - Date.now();
  return diff >= 0 && diff <= 60 * 60 * 1000;
}

function dueDateBadge(task) {
  if (!task.dueDate) return '';
  if (task.status === 'done') return `<span class="due-badge done-badge">✅ Done</span>`;
  const diff = new Date(task.dueDate).getTime() - Date.now();
  if (diff < 0) {
    const m = Math.round(Math.abs(diff)/60000);
    const label = m < 60 ? `${m}m overdue` : `${Math.round(m/60)}h overdue`;
    return `<span class="due-badge overdue">🔴 ${label}</span>`;
  }
  if (diff <= 15*60*1000) {
    const m = Math.round(diff/60000);
    return `<span class="due-badge due-soon">⚠️ ${m}m left</span>`;
  }
  if (diff <= 60*60*1000) {
    const m = Math.round(diff/60000);
    return `<span class="due-badge due-hour">⏰ ${m}m left</span>`;
  }
  return `<span class="due-badge due-ok">📅 ${fmtDateTime(task.dueDate)}</span>`;
}

function startDeadlineChecker() {
  checkDeadlines();
  setInterval(checkDeadlines, 30 * 1000); // Check every 30 seconds
}

function checkDeadlines() {
  const now = Date.now();
  tasks.forEach(task => {
    if (!task.dueDate || task.status === 'done') return;
    const due  = new Date(task.dueDate).getTime();
    const diff = due - now;
    const keyOver = `${task.id}-over`;
    const keyWarn = `${task.id}-warn`;

    if (diff <= 0 && !firedNotifs.has(keyOver)) {
      firedNotifs.add(keyOver);
      saveFiredNotifs();
      queueAlert(task, 'overdue');
    } else if (diff > 0 && diff <= 15*60*1000 && !firedNotifs.has(keyWarn)) {
      firedNotifs.add(keyWarn);
      saveFiredNotifs();
      queueAlert(task, 'soon');
    }
  });
  processAlertQueue();
}

function queueAlert(task, type) {
  if (alertQueue.some(a => a.task.id === task.id && a.type === type)) return;
  alertQueue.push({ task, type });
  addNotif(`${type === 'overdue' ? '🔴 OVERDUE' : '⏰ Due soon'}: "${task.description}"`);
}

function processAlertQueue() {
  if (currentAlert || alertQueue.length === 0) return;
  currentAlert = alertQueue.shift();
  showDeadlineAlertUI(currentAlert.task, currentAlert.type);
  fireBrowserNotification(currentAlert.task, currentAlert.type);
}

function fireBrowserNotification(task, type) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const isOver = type === 'overdue';
  try {
    const n = new Notification(
      isOver ? '🔴 Task Overdue!' : '⏰ Task Due Soon!',
      {
        body: task.description + (task.dueDate ? '\nDue: ' + fmtDateTime(task.dueDate) : ''),
        tag: `task-${task.id}-${type}`,
        requireInteraction: true,
      }
    );
    n.onclick = () => { window.focus(); };
  } catch (_) {}
}

function showDeadlineAlertUI(task, type) {
  if (!deadlineAlert) return;
  const isOver = type === 'overdue';
  const card   = deadlineAlert.querySelector('.deadline-card');

  card?.classList.remove('type-soon');
  if (!isOver) card?.classList.add('type-soon');

  const dIcon  = document.getElementById('dalertIcon');
  const dTitle = document.getElementById('dalertTitle');
  const dDesc  = document.getElementById('dalertDesc');
  const dTime  = document.getElementById('dalertTime');

  if (dIcon) dIcon.textContent  = isOver ? '🔴' : '⏰';
  if (dTitle) dTitle.textContent = isOver ? 'Task Overdue!' : 'Task Due Soon!';
  if (dDesc) dDesc.textContent  = task.description;

  const diff = new Date(task.dueDate).getTime() - Date.now();
  let timeText;
  if (diff <= 0) {
    const m = Math.round(Math.abs(diff)/60000);
    timeText = m < 60 ? `Overdue by ${m} minute${m!==1?'s':''}` : `Overdue by ${Math.round(m/60)} hour${Math.round(m/60)!==1?'s':''}`;
  } else {
    const m = Math.round(diff/60000);
    timeText = `Due in ${m} minute${m!==1?'s':''}`;
  }
  if (dTime) dTime.textContent = timeText;

  const qEl = document.getElementById('dalertQueueCount');
  if (qEl) {
    if (alertQueue.length > 0) {
      qEl.textContent = `+${alertQueue.length} more`;
      qEl.classList.remove('hidden');
    } else {
      qEl.classList.add('hidden');
    }
  }

  // Wire buttons
  const btnDone = document.getElementById('dalertDone');
  if (btnDone) btnDone.onclick = async () => { await patchStatus(task.id, 'done'); closeDeadlineAlert(); };

  document.getElementById('dalertSnooze15').onclick = () => snoozeTask(task.id, 15);
  document.getElementById('dalertSnooze30').onclick = () => snoozeTask(task.id, 30);
  document.getElementById('dalertSnooze60').onclick = () => snoozeTask(task.id, 60);
  document.getElementById('dalertDismiss').onclick  = closeDeadlineAlert;

  deadlineAlert.classList.remove('hidden');
  deadlineAlert.style.animation = 'none';
  requestAnimationFrame(() => { deadlineAlert.style.animation = ''; });
}

function closeDeadlineAlert() {
  deadlineAlert?.classList.add('hidden');
  currentAlert = null;
  setTimeout(processAlertQueue, 500);
}

async function snoozeTask(taskId, minutes) {
  const newDue = new Date(Date.now() + minutes * 60000).toISOString();
  try {
    await apiFetch(`/tasks/${taskId}`, 'PATCH', { dueDate: newDue });
    firedNotifs.delete(`${taskId}-warn`);
    firedNotifs.delete(`${taskId}-over`);
    saveFiredNotifs();
    await loadTasks();
    closeDeadlineAlert();
    showToast(`😴 Task snoozed for ${minutes} min`, 'info');
    addNotif(`Task #${taskId} snoozed for ${minutes} min`);
  } catch (err) {
    showToast('Notice: ' + err.message, 'info');
    closeDeadlineAlert();
    await loadTasks();
  }
}
window.snoozeTask = snoozeTask;

// ══════════════════════════════════════════════════════════════════════
// ── SETTINGS & THEMES ─────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

document.querySelectorAll('.swatch').forEach(sw => {
  sw.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    applyTheme(sw.dataset.theme);
    localStorage.setItem('tf-theme', sw.dataset.theme);
  });
});

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? '' : theme);
  setTimeout(render, 50);
}

document.querySelectorAll('input[name="bg"]').forEach(radio => {
  radio.addEventListener('change', () => {
    ['Solid','Gradient','Image','Upload'].forEach(n =>
      document.getElementById(`bg${n}Opt`)?.classList.add('hidden')
    );
    const id = `bg${cap(radio.value)}Opt`;
    document.getElementById(id)?.classList.remove('hidden');
  });
});

document.getElementById('bgColor')?.addEventListener('input', e => {
  document.body.style.background = e.target.value;
  document.body.classList.remove('has-bg-image');
  localStorage.setItem('tf-bg-type', 'solid');
  localStorage.setItem('tf-bg-val', e.target.value);
});

document.getElementById('gradientSelect')?.addEventListener('change', e => {
  document.body.style.background = e.target.value;
  document.body.classList.remove('has-bg-image');
  localStorage.setItem('tf-bg-type', 'gradient');
  localStorage.setItem('tf-bg-val', e.target.value);
});

document.getElementById('applyImageUrl')?.addEventListener('click', () => {
  const url = document.getElementById('bgImageUrl')?.value.trim();
  if (!url) return;
  applyBgImage(url);
  localStorage.setItem('tf-bg-type', 'image');
  localStorage.setItem('tf-bg-val', url);
  showToast('Custom background image applied ✓', 'success');
});

document.getElementById('bgUpload')?.addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    applyBgImage(ev.target.result);
    localStorage.setItem('tf-bg-type', 'image');
    localStorage.setItem('tf-bg-val', ev.target.result);
    showToast('Background uploaded successfully ✓', 'success');
  };
  reader.readAsDataURL(file);
});

function applyBgImage(url) {
  document.body.style.background = `url('${url}') center/cover fixed`;
  document.body.classList.add('has-bg-image');
}

document.getElementById('resetBg')?.addEventListener('click', () => {
  document.body.style.background = '';
  document.body.classList.remove('has-bg-image');
  localStorage.removeItem('tf-bg-type');
  localStorage.removeItem('tf-bg-val');
  showToast('Background reset to default theme', 'info');
});

document.getElementById('accentColor')?.addEventListener('input', e => {
  document.documentElement.style.setProperty('--accent', e.target.value);
  localStorage.setItem('tf-accent', e.target.value);
});

document.getElementById('sidebarCollapse')?.addEventListener('change', e => {
  sidebar?.classList.toggle('collapsed', e.target.checked);
  localStorage.setItem('tf-sidebar-collapsed', e.target.checked);
});

document.getElementById('compactMode')?.addEventListener('change', e => {
  document.body.classList.toggle('compact', e.target.checked);
  localStorage.setItem('tf-compact', e.target.checked);
});

document.getElementById('exportBtn')?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tasks-export.json';
  a.click();
  showToast('Exported tasks to tasks-export.json', 'success');
});

document.getElementById('clearAllBtn')?.addEventListener('click', async () => {
  if (!confirm('Are you sure you want to delete ALL tasks? This cannot be undone.')) return;
  await Promise.all(tasks.map(t => apiFetch(`/tasks/${t.id}`, 'DELETE')));
  firedNotifs.clear();
  saveFiredNotifs();
  await loadTasks();
  showToast('All tasks cleared', 'info');
});

function restorePrefs() {
  const theme = localStorage.getItem('tf-theme');
  if (theme) {
    applyTheme(theme);
    document.querySelectorAll('.swatch').forEach(s =>
      s.classList.toggle('active', s.dataset.theme === theme)
    );
  }
  const bgType = localStorage.getItem('tf-bg-type');
  const bgVal  = localStorage.getItem('tf-bg-val');
  if (bgType === 'solid' && bgVal) {
    document.body.style.background = bgVal;
    const bgColInput = document.getElementById('bgColor');
    if (bgColInput) bgColInput.value = bgVal;
  } else if (bgType === 'gradient' && bgVal) {
    document.body.style.background = bgVal;
  } else if (bgType === 'image' && bgVal) {
    applyBgImage(bgVal);
  }

  const accent = localStorage.getItem('tf-accent');
  if (accent) {
    document.documentElement.style.setProperty('--accent', accent);
    const accInput = document.getElementById('accentColor');
    if (accInput) accInput.value = accent;
  }

  if (localStorage.getItem('tf-sidebar-collapsed') === 'true') {
    sidebar?.classList.add('collapsed');
    const sc = document.getElementById('sidebarCollapse');
    if (sc) sc.checked = true;
  }
  if (localStorage.getItem('tf-compact') === 'true') {
    document.body.classList.add('compact');
    const cm = document.getElementById('compactMode');
    if (cm) cm.checked = true;
  }
}

// ── Utility Helpers ───────────────────────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
  });
}

function toLocalDatetimeInput(iso) {
  if (!iso) return '';
  const d      = new Date(iso);
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

// ── App Initialization ────────────────────────────────────────────────
(async function init() {
  restorePrefs();
  checkNotifBarVisibility();

  // Test server connection
  await checkServerConnection(false);

  // Load initial tasks
  await loadTasks();

  // Seed demo data if totally empty (on fresh install)
  if (tasks.length === 0) {
    const in1h  = new Date(Date.now() + 60*60*1000).toISOString();
    const past  = new Date(Date.now() - 30*60*1000).toISOString();
    const demos = [
      { description:'Design UX wireframes',         status:'todo',        priority:'high',   project:'Design',   progress:25, dueDate:in1h },
      { description:'Research competitor apps',     status:'todo',        priority:'medium', project:'Research', progress:0  },
      { description:'Implement sidebar navigation', status:'in-progress', priority:'medium', project:'Frontend', progress:60 },
      { description:'Write API documentation',      status:'in-progress', priority:'low',    project:'Backend',  progress:40, dueDate:past },
      { description:'Setup project repo',           status:'done',        priority:'medium', project:'DevOps',   progress:100},
    ];
    for (const d of demos) {
      await apiFetch('/tasks', 'POST', d);
    }
    await loadTasks();
  }

  // Start background engines
  startDeadlineChecker();

  // Poll server connection every 6 seconds in background
  setInterval(() => {
    checkServerConnection(false);
  }, 6000);
})();
