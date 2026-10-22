/* ════════════════════════════════════════════════════════════════════
   app.js — TrackFlow Frontend Logic
   Pure vanilla JS — no external libraries.
   ════════════════════════════════════════════════════════════════════ */

'use strict';

const API = '/api';

// ── State ────────────────────────────────────────────────────────────
let tasks = [];
let currentFilter = 'all';
let currentView   = 'dashboard';
let editingId     = null;

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
const fProgress    = document.getElementById('fProgress');
const progressVal  = document.getElementById('progressVal');
const notifPanel   = document.getElementById('notifPanel');
const notifList    = document.getElementById('notifList');
const toast        = document.getElementById('toast');
const globalSearch = document.getElementById('globalSearch');

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
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2800);
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
  fDesc.value     = task ? task.description : '';
  fStatus.value   = task ? task.status      : 'todo';
  fPriority.value = task ? (task.priority || 'medium') : 'medium';
  fProject.value  = task ? (task.project  || '')       : '';
  fAssignee.value = task ? (task.assignee || '')        : '';
  fProgress.value = task ? (task.progress || 0)        : 0;
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
  const payload = {
    description: fDesc.value.trim(),
    status:   fStatus.value,
    priority: fPriority.value,
    project:  fProject.value.trim(),
    assignee: fAssignee.value.trim(),
    progress: parseInt(fProgress.value),
  };
  try {
    if (editingId) {
      await apiFetch(`/tasks/${editingId}`, 'PUT', payload);
      showToast('Task updated ✓', 'success');
      addNotif(`Task #${editingId} updated`);
    } else {
      const created = await apiFetch('/tasks', 'POST', payload);
      showToast(`Task added (ID: ${created.id}) ✓`, 'success');
      addNotif(`New task created: "${created.description}"`);
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
    showToast(`Task #${id} deleted`, 'info');
    addNotif(`Task #${id} deleted`);
    await loadTasks();
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

async function patchStatus(id, status) {
  try {
    await apiFetch(`/tasks/${id}`, 'PATCH', { status });
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
    (t.project || '').toLowerCase().includes(q) ||
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
  const done      = tasks.filter(t => t.status === 'done').length;
  const inProg    = tasks.filter(t => t.status === 'in-progress').length;
  const todo      = tasks.filter(t => t.status === 'todo').length;
  const total     = tasks.length;
  const pct       = total ? Math.round((done / total) * 100) : 0;
  const circ      = 238.76;

  document.getElementById('donutPct').textContent = pct + '%';
  document.getElementById('statDone').textContent = done;
  document.getElementById('statPending').textContent = todo;
  document.getElementById('statProgress').textContent = inProg;
  const seg = document.getElementById('donutSeg');
  seg.style.strokeDashoffset = circ - (circ * pct / 100);

  // Urgent tasks (high priority, not done)
  const urgent = tasks.filter(t => t.priority === 'high' && t.status !== 'done').slice(0, 5);
  const ul = document.getElementById('urgentList');
  ul.innerHTML = urgent.length ? urgent.map(t => `
    <div class="urgent-item">
      <input type="checkbox" class="urg-check" ${t.status === 'done' ? 'checked' : ''}
        onchange="patchStatus(${t.id}, this.checked ? 'done' : 'todo')" />
      <span class="urg-desc" title="${esc(t.description)}">${esc(t.description)}</span>
      <span class="badge high">High</span>
    </div>`).join('') : '<div class="empty-state">No urgent tasks 🎉</div>';

  // Activity chart
  drawActivityChart();

  // Mini kanban on dashboard
  renderKanban('dashKanban', true);
}

// ── Activity Chart (canvas) ───────────────────────────────────────────
function drawActivityChart() {
  const canvas = document.getElementById('activityChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Generate fake week data weighted by actual task counts
  const base = Math.max(tasks.length, 5);
  const pts = [
    Math.round(base * .3), Math.round(base * .5), Math.round(base * .4),
    Math.round(base * .8), Math.round(base * .6), Math.round(base * .9), Math.round(base * .7)
  ];
  const max = Math.max(...pts, 1);
  const pad = { t:10, b:10, l:10, r:10 };
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;
  const step = pw / 6;

  const xs = pts.map((_, i) => pad.l + i * step);
  const ys = pts.map(v => pad.t + ph - (v / max) * ph);

  // Gradient fill
  const grad = ctx.createLinearGradient(0, pad.t, 0, H);
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f6ef7';
  grad.addColorStop(0, accent + '55');
  grad.addColorStop(1, accent + '00');

  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i = 1; i < xs.length; i++) {
    const cx = (xs[i-1] + xs[i]) / 2;
    ctx.bezierCurveTo(cx, ys[i-1], cx, ys[i], xs[i], ys[i]);
  }
  ctx.lineTo(xs[xs.length-1], H); ctx.lineTo(xs[0], H); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
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
    const cards = colTasks.map(t => kanbanCard(t, mini)).join('');
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

  // Attach card click handlers
  container.querySelectorAll('.kanban-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.classList.contains('btn-icon') || e.target.tagName === 'SELECT') return;
      const id = parseInt(card.dataset.id);
      const t = tasks.find(x => x.id === id);
      if (t) openModal(t);
    });
  });
}

function kanbanCard(t, mini) {
  const prog = t.progress || 0;
  const badgeHtml = t.priority ? `<span class="badge ${t.priority}">${cap(t.priority)}</span>` : '';
  const assigneeHtml = t.assignee ? `<div class="avatar av1" style="width:22px;height:22px;font-size:.65rem" title="${esc(t.assignee)}">${t.assignee[0].toUpperCase()}</div>` : '';
  const progressHtml = (!mini && prog > 0) ? `
    <div class="kanban-card-footer">
      <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${prog}%"></div></div>
      <div class="progress-pct">${prog}%</div>
    </div>` : '';
  const doneStyle = t.status === 'done' ? 'text-decoration:line-through;opacity:.7;' : '';

  return `
    <div class="kanban-card" data-id="${t.id}">
      <div class="kanban-card-title" style="${doneStyle}">${esc(t.description)}</div>
      <div class="kanban-card-meta">
        ${badgeHtml}
        ${assigneeHtml}
        ${t.project ? `<span style="font-size:.72rem;color:var(--text-muted)">${esc(t.project)}</span>` : ''}
        <button class="btn-icon" style="margin-left:auto" onclick="event.stopPropagation();showCardMenu(event,${t.id})">···</button>
      </div>
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
    border-radius:10px;box-shadow:var(--shadow-lg);padding:.4rem 0;min-width:160px;
    left:${e.clientX}px;top:${e.clientY}px`;
  const items = [
    ['✏️ Edit', () => openModal(t)],
    ['▶️ In Progress', () => patchStatus(id, 'in-progress')],
    ['✅ Mark Done', () => patchStatus(id, 'done')],
    ['↩️ Reset to Todo', () => patchStatus(id, 'todo')],
    ['🗑 Delete', () => deleteTask(id)],
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
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No tasks found.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(t => `
    <tr>
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
      <td>${fmtDate(t.createdAt)}</td>
      <td>${fmtDate(t.updatedAt)}</td>
      <td>
        <div class="task-actions">
          <button class="btn-icon" title="Edit" onclick="openModal(tasks.find(x=>x.id===${t.id}))">✏️</button>
          <button class="btn-icon" title="Delete" onclick="deleteTask(${t.id})">🗑</button>
        </div>
      </td>
    </tr>`).join('');
}

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

  const todo = tasks.filter(t => t.status === 'todo').length;
  const prog = tasks.filter(t => t.status === 'in-progress').length;
  const done = tasks.filter(t => t.status === 'done').length;
  const total = tasks.length || 1;

  const slices = [
    { val: todo, color: '#f59e0b', label: 'To Do' },
    { val: prog, color: '#4f6ef7', label: 'In Progress' },
    { val: done, color: '#10b981', label: 'Done' },
  ];

  let angle = -Math.PI / 2;
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 16;

  slices.forEach(s => {
    const sweep = (s.val / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
    angle += sweep;
  });

  // Donut hole
  ctx.beginPath(); ctx.arc(cx, cy, r * .5, 0, Math.PI * 2);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff';
  ctx.fill();

  // Center text
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#111';
  ctx.font = 'bold 18px Segoe UI';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(tasks.length, cx, cy - 8);
  ctx.font = '11px Segoe UI';
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim() || '#6b7280';
  ctx.fillText('Total', cx, cy + 12);

  // Legend
  const legend = document.getElementById('pieLegend');
  if (legend) {
    legend.innerHTML = slices.map(s =>
      `<div class="pie-leg-item"><div class="pie-leg-dot" style="background:${s.color}"></div>${s.label}: ${s.val}</div>`
    ).join('');
  }
}

function drawBarChart() {
  const container = document.getElementById('barChart');
  if (!container) return;
  const stats = [
    { label: 'To Do',       val: tasks.filter(t=>t.status==='todo').length,        color: '#f59e0b' },
    { label: 'In Progress', val: tasks.filter(t=>t.status==='in-progress').length,  color: '#4f6ef7' },
    { label: 'Done',        val: tasks.filter(t=>t.status==='done').length,          color: '#10b981' },
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
  const pts = [
    Math.round(base*.25), Math.round(base*.45), Math.round(base*.3),
    Math.round(base*.7),  Math.round(base*.55), Math.round(base*.85), Math.round(base*.6)
  ];
  const max = Math.max(...pts, 1);
  const pad = { t:15, b:15, l:15, r:15 };
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;
  const step = pw / 6;
  const xs = pts.map((_,i) => pad.l + i * step);
  const ys = pts.map(v => pad.t + ph - (v/max)*ph);

  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#4f6ef7';
  const grad = ctx.createLinearGradient(0, pad.t, 0, H);
  grad.addColorStop(0, accent+'66'); grad.addColorStop(1, accent+'00');

  ctx.beginPath();
  ctx.moveTo(xs[0], ys[0]);
  for (let i=1;i<xs.length;i++) {
    const cx=(xs[i-1]+xs[i])/2;
    ctx.bezierCurveTo(cx,ys[i-1],cx,ys[i],xs[i],ys[i]);
  }
  ctx.lineTo(xs[xs.length-1],H); ctx.lineTo(xs[0],H); ctx.closePath();
  ctx.fillStyle=grad; ctx.fill();

  ctx.beginPath(); ctx.moveTo(xs[0],ys[0]);
  for (let i=1;i<xs.length;i++) {
    const cx=(xs[i-1]+xs[i])/2;
    ctx.bezierCurveTo(cx,ys[i-1],cx,ys[i],xs[i],ys[i]);
  }
  ctx.strokeStyle=accent; ctx.lineWidth=2.5; ctx.stroke();

  xs.forEach((x,i) => {
    ctx.beginPath(); ctx.arc(x,ys[i],4,0,Math.PI*2);
    ctx.fillStyle=accent; ctx.fill();
    ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
  });
}

// ── Projects ──────────────────────────────────────────────────────────
function renderProjects() {
  const container = document.getElementById('projectsGrid');
  if (!container) return;
  const projects = {};
  tasks.forEach(t => {
    const name = t.project || 'General';
    if (!projects[name]) projects[name] = { total: 0, done: 0 };
    projects[name].total++;
    if (t.status === 'done') projects[name].done++;
  });
  const names = Object.keys(projects);
  if (!names.length) {
    container.innerHTML = '<div class="empty-state">No projects yet. Tag tasks with a project name.</div>';
    return;
  }
  container.innerHTML = names.map(name => {
    const p = projects[name];
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    return `
      <div class="project-card" onclick="filterByProject('${esc(name)}')">
        <div class="project-name">${esc(name)}</div>
        <div class="project-count">${p.total} task${p.total!==1?'s':''} · ${p.done} done</div>
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
  openModal();
  fProject.focus();
});

// ── Settings ──────────────────────────────────────────────────────────

// Theme swatches
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
  setTimeout(() => { render(); }, 50); // re-draw charts with new colors
}

// Background options
document.querySelectorAll('input[name="bg"]').forEach(radio => {
  radio.addEventListener('change', () => {
    document.getElementById('bgSolidOpt').classList.add('hidden');
    document.getElementById('bgGradientOpt').classList.add('hidden');
    document.getElementById('bgImageOpt').classList.add('hidden');
    document.getElementById('bgUploadOpt').classList.add('hidden');
    const id = `bg${cap(radio.value)}Opt`;
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
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

// Accent color
document.getElementById('accentColor').addEventListener('input', e => {
  document.documentElement.style.setProperty('--accent', e.target.value);
  localStorage.setItem('tf-accent', e.target.value);
});

// Sidebar collapse
document.getElementById('sidebarCollapse').addEventListener('change', e => {
  sidebar.classList.toggle('collapsed', e.target.checked);
  localStorage.setItem('tf-sidebar-collapsed', e.target.checked);
});

// Compact mode
document.getElementById('compactMode').addEventListener('change', e => {
  document.body.classList.toggle('compact', e.target.checked);
  localStorage.setItem('tf-compact', e.target.checked);
});

// Export
document.getElementById('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'tasks-export.json';
  a.click();
  showToast('Exported tasks.json', 'success');
});

// Clear all
document.getElementById('clearAllBtn').addEventListener('click', async () => {
  if (!confirm('Delete ALL tasks? This cannot be undone.')) return;
  await Promise.all(tasks.map(t => apiFetch(`/tasks/${t.id}`, 'DELETE')));
  await loadTasks();
  showToast('All tasks cleared', 'info');
});

// ── Restore Preferences ───────────────────────────────────────────────
function restorePrefs() {
  const theme = localStorage.getItem('tf-theme');
  if (theme) {
    applyTheme(theme);
    document.querySelectorAll('.swatch').forEach(s => {
      s.classList.toggle('active', s.dataset.theme === theme);
    });
  }

  const bgType = localStorage.getItem('tf-bg-type');
  const bgVal  = localStorage.getItem('tf-bg-val');
  if (bgType === 'solid' && bgVal) {
    document.body.style.background = bgVal;
    document.getElementById('bgColor').value = bgVal;
  } else if (bgType === 'gradient' && bgVal) {
    document.body.style.background = bgVal;
  } else if (bgType === 'image' && bgVal) {
    applyBgImage(bgVal);
  }

  const accent = localStorage.getItem('tf-accent');
  if (accent) {
    document.documentElement.style.setProperty('--accent', accent);
    document.getElementById('accentColor').value = accent;
  }

  const collapsed = localStorage.getItem('tf-sidebar-collapsed') === 'true';
  if (collapsed) {
    sidebar.classList.add('collapsed');
    document.getElementById('sidebarCollapse').checked = true;
  }

  const compact = localStorage.getItem('tf-compact') === 'true';
  if (compact) {
    document.body.classList.add('compact');
    document.getElementById('compactMode').checked = true;
  }
}

// ── Kanban Board — Add Task via "Add Task" btn in kanban view ─────────
document.addEventListener('click', e => {
  if (e.target.classList.contains('add-task-btn')) openModal();
});

// ── Utility ───────────────────────────────────────────────────────────
function esc(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
}

// ── Init ──────────────────────────────────────────────────────────────
(async function init() {
  restorePrefs();
  await loadTasks();

  // Seed demo data if empty
  if (tasks.length === 0) {
    const demos = [
      { description: 'Design UX wireframes',         status: 'todo',        priority: 'high',   project: 'Design',   progress: 25 },
      { description: 'Research competitor apps',     status: 'todo',        priority: 'medium', project: 'Research', progress: 0  },
      { description: 'Implement sidebar navigation', status: 'in-progress', priority: 'medium', project: 'Frontend', progress: 60 },
      { description: 'Write API documentation',      status: 'in-progress', priority: 'low',    project: 'Backend',  progress: 40 },
      { description: 'Setup project repo',           status: 'done',        priority: 'medium', project: 'DevOps',   progress: 100},
    ];
    for (const d of demos) {
      await apiFetch('/tasks', 'POST', d);
    }
    tasks = await apiFetch('/tasks');
    render();
  }
})();
