/* ════════════════════════════════════════════════════════════════════
   app.js — TrackFlow Frontend Logic
   Pure vanilla JS — no external libraries.
   Includes: full CRUD, Kanban, Analytics, Projects, Settings,
             Theme/BG customization, Deadline alerts & notifications.
   ════════════════════════════════════════════════════════════════════ */

'use strict';

const API = '/api';

// ── State ────────────────────────────────────────────────────────────
let tasks         = [];
let currentFilter = 'all';
let currentView   = 'dashboard';
let editingId     = null;

// Notification / deadline state
let alertQueue    = [];      // queued {task, type} alerts
let currentAlert  = null;    // currently displayed alert
// Persist fired notifications in localStorage so refresh won't re-fire
const firedNotifs = new Set(
  JSON.parse(localStorage.getItem('tf-fired-notifs') || '[]')
);

// ── DOM Refs ─────────────────────────────────────────────────────────
const sidebar      = document.getElementById('sidebar');
const pageTitle    = document.getElementById('pageTitle');
const taskModal    = document.getElementById('taskModal');
const taskForm     = document.getElementById('taskForm');
const modalTitle   = document.getElementById('modalTitle');
const editIdInput  = document.getElementById('editId');
const fDesc        = document.getElementById('fDesc');
const fStatus      = document.getElementById('fStatus');
const fPriority    = document.getElementById('fPriority');
const fProject     = document.getElementById('fProject');
const fAssignee    = document.getElementById('fAssignee');
const fDueDate     = document.getElementById('fDueDate');
const fProgress    = document.getElementById('fProgress');
const progressVal  = document.getElementById('progressVal');
const notifPanel   = document.getElementById('notifPanel');
const notifList    = document.getElementById('notifList');
const toast        = document.getElementById('toast');
const globalSearch = document.getElementById('globalSearch');
const notifBar     = document.getElementById('notifBar');
const deadlineAlert= document.getElementById('deadlineAlert');

// ── API Helpers ───────────────────────────────────────────────────────
async function apiFetch(path, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function loadTasks() {
  tasks = await apiFetch('/tasks');
  render();
}

// ── Toast ────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'info') {
  toast.textContent = msg;
  toast.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ── Navigation ────────────────────────────────────────────────────────
function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${view}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.view === view);
  });
  const titles = {
    dashboard: 'Dashboard', tasks: 'My Tasks', kanban: 'Kanban Board',
    analytics: 'Analytics', projects: 'Projects', settings: 'Settings',
  };
  pageTitle.textContent = titles[view] || view;
  render();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => { e.preventDefault(); switchView(item.dataset.view); });
});

// ── Modal ─────────────────────────────────────────────────────────────
function openModal(task = null) {
  editingId = task ? task.id : null;
  modalTitle.textContent = task ? 'Edit Task' : 'Create Task';
  editIdInput.value = task ? task.id : '';
  fDesc.value     = task ? task.description          : '';
  fStatus.value   = task ? task.status               : 'todo';
  fPriority.value = task ? (task.priority || 'medium'): 'medium';
  fProject.value  = task ? (task.project  || '')      : '';
  fAssignee.value = task ? (task.assignee || '')       : '';
  fDueDate.value  = task && task.dueDate ? toLocalDatetimeInput(task.dueDate) : '';
  fProgress.value = task ? (task.progress || 0)       : 0;
  progressVal.textContent = fProgress.value;
  taskModal.classList.remove('hidden');
  fDesc.focus();
}

function closeModal() { taskModal.classList.add('hidden'); }

document.getElementById('createTaskBtn').addEventListener('click', () => openModal());
document.getElementById('addTaskInline').addEventListener('click', () => openModal());
document.getElementById('closeModal').addEventListener('click', closeModal);
document.getElementById('cancelModal').addEventListener('click', closeModal);
taskModal.addEventListener('click', e => { if (e.target === taskModal) closeModal(); });
fProgress.addEventListener('input', () => { progressVal.textContent = fProgress.value; });

taskForm.addEventListener('submit', async e => {
  e.preventDefault();
  const dueDateRaw = fDueDate.value;
  const payload = {
    description: fDesc.value.trim(),
    status:    fStatus.value,
    priority:  fPriority.value,
    project:   fProject.value.trim(),
    assignee:  fAssignee.value.trim(),
    dueDate:   dueDateRaw ? new Date(dueDateRaw).toISOString() : null,
    progress:  parseInt(fProgress.value),
  };
  try {
    if (editingId) {
      await apiFetch(`/tasks/${editingId}`, 'PUT', payload);
      // Clear fired notifs for this task so new deadline re-fires
      firedNotifs.delete(`${editingId}-warn`);
      firedNotifs.delete(`${editingId}-over`);
      saveFiredNotifs();
      showToast('Task updated ✓', 'success');
      addNotif(`Task #${editingId} updated`);
    } else {
      const created = await apiFetch('/tasks', 'POST', payload);
      showToast(`Task added (ID: ${created.id}) ✓`, 'success');
      addNotif(`New task: "${created.description}"${created.dueDate ? ' ⏰ ' + fmtDateTime(created.dueDate) : ''}`);
    }
    closeModal();
    await loadTasks();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
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
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

async function patchStatus(id, status) {
  try {
    await apiFetch(`/tasks/${id}`, 'PATCH', { status });
    if (status === 'done') {
      // Clear alerts for this task when marked done
      firedNotifs.delete(`${id}-warn`);
      firedNotifs.delete(`${id}-over`);
      saveFiredNotifs();
      // Close alert if it's the current task being alerted
      if (currentAlert && currentAlert.task.id === id) closeDeadlineAlert();
    }
    await loadTasks();
    showToast(`Marked as "${status}"`, 'success');
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

// ── Notifications ─────────────────────────────────────────────────────
function addNotif(msg) {
  const item = document.createElement('div');
  item.className = 'notif-item';
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  item.textContent = `[${t}] ${msg}`;
  notifList.prepend(item);
}

document.getElementById('notifBtn').addEventListener('click', e => {
  e.stopPropagation();
  notifPanel.classList.toggle('hidden');
});
document.addEventListener('click', e => {
  if (!notifPanel.contains(e.target)) notifPanel.classList.add('hidden');
});

// ── Search ────────────────────────────────────────────────────────────
globalSearch.addEventListener('input', debounce(() => {
  const q = globalSearch.value.toLowerCase();
  if (!q) { render(); return; }
  const filtered = tasks.filter(t =>
    t.description.toLowerCase().includes(q) ||
    (t.project  || '').toLowerCase().includes(q) ||
    (t.assignee || '').toLowerCase().includes(q)
  );
  renderTaskTable(filtered);
  if (currentView !== 'tasks') switchView('tasks');
}, 250));

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── Render Dispatch ───────────────────────────────────────────────────
function render() {
  renderDashboard();
  renderTaskTable();
  renderKanban('kanbanFull');
  renderAnalytics();
  renderProjects();
}

// ── Dashboard ─────────────────────────────────────────────────────────
function renderDashboard() {
  const done     = tasks.filter(t => t.status === 'done').length;
  const inProg   = tasks.filter(t => t.status === 'in-progress').length;
  const todo     = tasks.filter(t => t.status === 'todo').length;
  const total    = tasks.length;
  const overdue  = tasks.filter(t => isOverdue(t)).length;
  const pct      = total ? Math.round((done / total) * 100) : 0;
  const circ     = 238.76;

  document.getElementById('donutPct').textContent   = pct + '%';
  document.getElementById('statDone').textContent    = done;
  document.getElementById('statPending').textContent = todo;
  document.getElementById('statProgress').textContent= inProg;

  // Update overdue count label (the third stat row shows in-progress — add overdue badge)
  const overdueEl = document.getElementById('statOverdue');
  if (overdueEl) overdueEl.textContent = overdue;

  document.getElementById('donutSeg').style.strokeDashoffset = circ - (circ * pct / 100);

  // Urgent tasks (high priority, not done)
  const urgent = tasks.filter(t => t.priority === 'high' && t.status !== 'done').slice(0, 5);
  const ul = document.getElementById('urgentList');
  ul.innerHTML = urgent.length ? urgent.map(t => `
    <div class="urgent-item">
      <input type="checkbox" class="urg-check" ${t.status === 'done' ? 'checked' : ''}
        onchange="patchStatus(${t.id}, this.checked ? 'done' : 'todo')" />
      <span class="urg-desc" title="${esc(t.description)}">${esc(t.description)}</span>
      ${dueDateBadge(t)}
      <span class="badge high">High</span>
    </div>`).join('')
  : '<div class="empty-state">No urgent tasks 🎉</div>';

  drawActivityChart();
  renderKanban('dashKanban', true);
}

// ── Activity Chart (canvas) ───────────────────────────────────────────
function drawActivityChart() {
  const canvas = document.getElementById('activityChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const base = Math.max(tasks.length, 5);
  const pts = [
    Math.round(base*.3), Math.round(base*.5), Math.round(base*.4),
    Math.round(base*.8), Math.round(base*.6), Math.round(base*.9), Math.round(base*.7)
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

  // Fill
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i < xs.length; i++) {
    const cx = (xs[i-1] + xs[i]) / 2;
    ctx.bezierCurveTo(cx, ys[i-1], cx, ys[i], xs[i], ys[i]);
  }
  ctx.lineTo(xs[xs.length-1], H); ctx.lineTo(xs[0], H); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // Line
  ctx.beginPath(); ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i < xs.length; i++) {
    const cx = (xs[i-1] + xs[i]) / 2;
    ctx.bezierCurveTo(cx, ys[i-1], cx, ys[i], xs[i], ys[i]);
  }
  ctx.strokeStyle = accent; ctx.lineWidth = 2.5; ctx.stroke();

  // Dots
  xs.forEach((x, i) => {
    ctx.beginPath(); ctx.arc(x, ys[i], 3.5, 0, Math.PI * 2);
    ctx.fillStyle = accent; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
  });
}

function getAccentColor() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--accent').trim() || '#4f6ef7';
}

// ── Kanban ────────────────────────────────────────────────────────────
function renderKanban(containerId, mini = false) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const cols = [
    { id: 'todo',        label: 'To Do' },
    { id: 'in-progress', label: 'In Progress' },
    { id: 'done',        label: 'Review/Completed' },
  ];

  container.innerHTML = cols.map(col => {
    const colTasks = tasks.filter(t => t.status === col.id);
    const cards    = colTasks.map(t => kanbanCard(t, mini)).join('');
    return `
      <div class="kanban-col">
        <div class="kanban-col-header">
          ${esc(col.label)}
          <span class="kanban-col-count">${colTasks.length}</span>
          <button class="btn-icon" title="Options">···</button>
        </div>
        <div class="kanban-cards">${cards || '<div class="empty-state">Empty</div>'}</div>
        ${mini ? '' : `<button class="add-task-btn" onclick="openModal()">+ Add Task</button>`}
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

  // Card border accent for deadline
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

// Card context menu
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
    left:${e.clientX}px;top:${e.clientY}px`;
  const items = [
    ['✏️ Edit',            () => openModal(t)],
    ['▶️ In Progress',     () => patchStatus(id, 'in-progress')],
    ['✅ Mark Done',        () => patchStatus(id, 'done')],
    ['↩️ Reset to Todo',   () => patchStatus(id, 'todo')],
    ['⏰ Set Deadline',    () => { openModal(t); setTimeout(() => fDueDate.focus(), 100); }],
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
window.showCardMenu = showCardMenu;
window.openModal    = openModal;
window.patchStatus  = patchStatus;
window.deleteTask   = deleteTask;

// ── Task Table ────────────────────────────────────────────────────────
function renderTaskTable(filtered = null) {
  const tbody = document.getElementById('taskTableBody');
  if (!tbody) return;

  let list = filtered || tasks;
  if (!filtered && currentFilter !== 'all') {
    list = tasks.filter(t => t.status === currentFilter);
  }
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No tasks found.</td></tr>';
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

// Update table header to include Due Date column
(function patchTableHeader() {
  const thead = document.querySelector('.task-table thead tr');
  if (thead && thead.children.length < 8) {
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

  // Donut hole
  const surfaceColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--surface').trim() || '#fff';
  ctx.beginPath(); ctx.arc(cx, cy, r*.5, 0, Math.PI*2);
  ctx.fillStyle = surfaceColor; ctx.fill();

  // Centre text
  const textColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--text').trim() || '#111';
  const mutedColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--text-muted').trim() || '#6b7280';
  ctx.fillStyle = textColor;
  ctx.font = 'bold 18px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(tasks.length, cx, cy - 8);
  ctx.font = '11px Segoe UI'; ctx.fillStyle = mutedColor;
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
    Math.round(base*.25), Math.round(base*.45), Math.round(base*.3),
    Math.round(base*.7),  Math.round(base*.55), Math.round(base*.85), Math.round(base*.6)
  ];
  drawSmoothChart(ctx, pts, W, H, getAccentColor(), 15, 15, 15, 15);
}

// ── Projects ──────────────────────────────────────────────────────────
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
    container.innerHTML = '<div class="empty-state">No projects yet. Tag tasks with a project name.</div>';
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

document.getElementById('addProjectBtn').addEventListener('click', () => {
  openModal(); fProject.focus();
});

// ══════════════════════════════════════════════════════════════════════
// ── NOTIFICATION / DEADLINE SYSTEM ───────────────────────────────────
// ══════════════════════════════════════════════════════════════════════

function saveFiredNotifs() {
  // Keep only IDs that still exist & aren't done
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

// ── Browser Permission Bar ────────────────────────────────────────────
async function requestNotifPermission() {
  if (!('Notification' in window)) {
    showToast('Your browser does not support notifications', 'error'); return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    showToast('🔔 Notifications enabled!', 'success');
    notifBar.classList.add('hidden');
    localStorage.setItem('tf-notif-bar-dismissed', 'true');
  } else {
    showToast('Notifications blocked — enable them in browser settings', 'error');
  }
}
window.requestNotifPermission = requestNotifPermission;

function dismissNotifBar() {
  notifBar.classList.add('hidden');
  localStorage.setItem('tf-notif-bar-dismissed', 'true');
}
window.dismissNotifBar = dismissNotifBar;

function checkNotifBarVisibility() {
  const dismissed = localStorage.getItem('tf-notif-bar-dismissed') === 'true';
  const granted   = 'Notification' in window && Notification.permission === 'granted';
  if (!dismissed && !granted && 'Notification' in window) {
    notifBar.classList.remove('hidden');
  }
}

// ── Deadline Helpers ──────────────────────────────────────────────────
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

// ── Deadline Checker ──────────────────────────────────────────────────
function startDeadlineChecker() {
  checkDeadlines();               // check immediately on load
  setInterval(checkDeadlines, 60 * 1000); // then every minute
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

// ── Alert Queue ───────────────────────────────────────────────────────
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

// ── Browser Notification ──────────────────────────────────────────────
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
  } catch (_) { /* silently ignore notification errors */ }
}

// ── In-App Alert UI ───────────────────────────────────────────────────
function showDeadlineAlertUI(task, type) {
  const isOver = type === 'overdue';
  const card   = deadlineAlert.querySelector('.deadline-card');

  // Colour-code the top bar
  card.classList.toggle('type-soon', !isOver);
  card.classList.remove('type-soon');
  if (!isOver) card.classList.add('type-soon');

  document.getElementById('dalertIcon').textContent  = isOver ? '🔴' : '⏰';
  document.getElementById('dalertTitle').textContent = isOver ? 'Task Overdue!' : 'Task Due Soon!';
  document.getElementById('dalertDesc').textContent  = task.description;

  // Time label
  const diff = new Date(task.dueDate).getTime() - Date.now();
  let timeText;
  if (diff <= 0) {
    const m = Math.round(Math.abs(diff)/60000);
    timeText = m < 60
      ? `Overdue by ${m} minute${m!==1?'s':''}`
      : `Overdue by ${Math.round(m/60)} hour${Math.round(m/60)!==1?'s':''}`;
  } else {
    const m = Math.round(diff/60000);
    timeText = `Due in ${m} minute${m!==1?'s':''}`;
  }
  document.getElementById('dalertTime').textContent = timeText;

  // Queue count badge
  const qEl = document.getElementById('dalertQueueCount');
  if (alertQueue.length > 0) {
    qEl.textContent = `+${alertQueue.length} more`;
    qEl.classList.remove('hidden');
  } else {
    qEl.classList.add('hidden');
  }

  // Wire buttons
  document.getElementById('dalertDone').onclick     = async () => { await patchStatus(task.id, 'done'); closeDeadlineAlert(); };
  document.getElementById('dalertSnooze15').onclick = () => snoozeTask(task.id, 15);
  document.getElementById('dalertSnooze30').onclick = () => snoozeTask(task.id, 30);
  document.getElementById('dalertSnooze60').onclick = () => snoozeTask(task.id, 60);
  document.getElementById('dalertDismiss').onclick  = closeDeadlineAlert;

  deadlineAlert.classList.remove('hidden');
  // Restart animation
  deadlineAlert.style.animation = 'none';
  requestAnimationFrame(() => { deadlineAlert.style.animation = ''; });
}

function closeDeadlineAlert() {
  deadlineAlert.classList.add('hidden');
  currentAlert = null;
  setTimeout(processAlertQueue, 600); // short pause before next alert
}

async function snoozeTask(taskId, minutes) {
  const newDue = new Date(Date.now() + minutes * 60000).toISOString();
  try {
    await apiFetch(`/tasks/${taskId}`, 'PATCH', { dueDate: newDue });
    // Clear fired flags so it re-fires after the snooze period
    firedNotifs.delete(`${taskId}-warn`);
    firedNotifs.delete(`${taskId}-over`);
    saveFiredNotifs();
    await loadTasks();
    closeDeadlineAlert();
    showToast(`😴 Snoozed ${minutes} min — you'll be reminded again`, 'info');
    addNotif(`Task #${taskId} snoozed for ${minutes} min`);
  } catch (err) {
    showToast('Error snoozing: ' + err.message, 'error');
  }
}
window.snoozeTask = snoozeTask;

// ══════════════════════════════════════════════════════════════════════
// ── SETTINGS ──────────────────────────────────────────────────────────
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

// Background options
document.querySelectorAll('input[name="bg"]').forEach(radio => {
  radio.addEventListener('change', () => {
    ['Solid','Gradient','Image','Upload'].forEach(n =>
      document.getElementById(`bg${n}Opt`).classList.add('hidden')
    );
    const id = `bg${cap(radio.value)}Opt`;
    document.getElementById(id)?.classList.remove('hidden');
  });
});

document.getElementById('bgColor').addEventListener('input', e => {
  document.body.style.background = e.target.value;
  document.body.classList.remove('has-bg-image');
  localStorage.setItem('tf-bg-type', 'solid');
  localStorage.setItem('tf-bg-val', e.target.value);
});

document.getElementById('gradientSelect').addEventListener('change', e => {
  document.body.style.background = e.target.value;
  document.body.classList.remove('has-bg-image');
  localStorage.setItem('tf-bg-type', 'gradient');
  localStorage.setItem('tf-bg-val', e.target.value);
});

document.getElementById('applyImageUrl').addEventListener('click', () => {
  const url = document.getElementById('bgImageUrl').value.trim();
  if (!url) return;
  applyBgImage(url);
  localStorage.setItem('tf-bg-type', 'image');
  localStorage.setItem('tf-bg-val', url);
});

document.getElementById('bgUpload').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    applyBgImage(ev.target.result);
    localStorage.setItem('tf-bg-type', 'image');
    localStorage.setItem('tf-bg-val', ev.target.result);
  };
  reader.readAsDataURL(file);
});

function applyBgImage(url) {
  document.body.style.background = `url('${url}') center/cover fixed`;
  document.body.classList.add('has-bg-image');
}

document.getElementById('resetBg').addEventListener('click', () => {
  document.body.style.background = '';
  document.body.classList.remove('has-bg-image');
  localStorage.removeItem('tf-bg-type');
  localStorage.removeItem('tf-bg-val');
  showToast('Background reset', 'info');
});

document.getElementById('accentColor').addEventListener('input', e => {
  document.documentElement.style.setProperty('--accent', e.target.value);
  localStorage.setItem('tf-accent', e.target.value);
});

document.getElementById('sidebarCollapse').addEventListener('change', e => {
  sidebar.classList.toggle('collapsed', e.target.checked);
  localStorage.setItem('tf-sidebar-collapsed', e.target.checked);
});

document.getElementById('compactMode').addEventListener('change', e => {
  document.body.classList.toggle('compact', e.target.checked);
  localStorage.setItem('tf-compact', e.target.checked);
});

document.getElementById('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'tasks-export.json'; a.click();
  showToast('Exported tasks.json', 'success');
});

document.getElementById('clearAllBtn').addEventListener('click', async () => {
  if (!confirm('Delete ALL tasks? This cannot be undone.')) return;
  await Promise.all(tasks.map(t => apiFetch(`/tasks/${t.id}`, 'DELETE')));
  firedNotifs.clear(); saveFiredNotifs();
  await loadTasks();
  showToast('All tasks cleared', 'info');
});

// ── Restore Preferences ───────────────────────────────────────────────
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
  if (bgType === 'solid'    && bgVal) { document.body.style.background = bgVal; document.getElementById('bgColor').value = bgVal; }
  else if (bgType === 'gradient' && bgVal) { document.body.style.background = bgVal; }
  else if (bgType === 'image'    && bgVal) { applyBgImage(bgVal); }

  const accent = localStorage.getItem('tf-accent');
  if (accent) { document.documentElement.style.setProperty('--accent', accent); document.getElementById('accentColor').value = accent; }

  if (localStorage.getItem('tf-sidebar-collapsed') === 'true') {
    sidebar.classList.add('collapsed');
    document.getElementById('sidebarCollapse').checked = true;
  }
  if (localStorage.getItem('tf-compact') === 'true') {
    document.body.classList.add('compact');
    document.getElementById('compactMode').checked = true;
  }
}

// ── Kanban "Add Task" button ──────────────────────────────────────────
document.addEventListener('click', e => {
  if (e.target.classList.contains('add-task-btn')) openModal();
});

// ── Utility ───────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function cap(s)     { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
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
// Convert stored UTC ISO → local datetime string for <input type="datetime-local">
function toLocalDatetimeInput(iso) {
  if (!iso) return '';
  const d      = new Date(iso);
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 16);
}

// ── Init ──────────────────────────────────────────────────────────────
(async function init() {
  restorePrefs();
  checkNotifBarVisibility();
  await loadTasks();

  // Seed demo data if empty
  if (tasks.length === 0) {
    const in1h  = new Date(Date.now() + 60*60*1000).toISOString();
    const past  = new Date(Date.now() - 30*60*1000).toISOString(); // 30 min ago (overdue demo)
    const demos = [
      { description:'Design UX wireframes',         status:'todo',        priority:'high',   project:'Design',   progress:25, dueDate:in1h },
      { description:'Research competitor apps',     status:'todo',        priority:'medium', project:'Research', progress:0  },
      { description:'Implement sidebar navigation', status:'in-progress', priority:'medium', project:'Frontend', progress:60 },
      { description:'Write API documentation',      status:'in-progress', priority:'low',    project:'Backend',  progress:40, dueDate:past },
      { description:'Setup project repo',           status:'done',        priority:'medium', project:'DevOps',   progress:100},
    ];
    for (const d of demos) await apiFetch('/tasks', 'POST', d);
    tasks = await apiFetch('/tasks');
    render();
  }

  startDeadlineChecker();
})();
