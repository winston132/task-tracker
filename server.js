/**
 * server.js — Task Tracker Web Server
 * Serves the web dashboard and REST API using only Node.js built-in modules.
 * No Express, no external dependencies.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'tasks.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ─── Data Helpers ────────────────────────────────────────────────────────────

function loadTasks() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { nextId: 1, tasks: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { nextId: 1, tasks: [] };
  }
}

function saveTasks(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function now() {
  return new Date().toISOString();
}

// ─── MIME Types ───────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

// ─── Request Body Parser ──────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ─── Response Helpers ────────────────────────────────────────────────────────

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
}

// ─── API Router ───────────────────────────────────────────────────────────────

async function handleAPI(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;
  const method = req.method;

  // OPTIONS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // GET /api/tasks[?status=...]
  if (pathname === '/api/tasks' && method === 'GET') {
    const data = loadTasks();
    const status = url.searchParams.get('status');
    const tasks = status ? data.tasks.filter(t => t.status === status) : data.tasks;
    return json(res, 200, tasks);
  }

  // POST /api/tasks
  if (pathname === '/api/tasks' && method === 'POST') {
    const body = await readBody(req);
    if (!body.description || !body.description.trim()) {
      return json(res, 400, { error: 'Description is required.' });
    }
    const data = loadTasks();
    const task = {
      id: data.nextId++,
      description: body.description.trim(),
      status: body.status || 'todo',
      priority: body.priority || 'medium',
      project: body.project || '',
      progress: body.progress || 0,
      assignee: body.assignee || '',
      createdAt: now(),
      updatedAt: now(),
    };
    data.tasks.push(task);
    saveTasks(data);
    return json(res, 201, task);
  }

  // Match /api/tasks/:id
  const taskMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);

  // PUT /api/tasks/:id — full update
  if (taskMatch && method === 'PUT') {
    const id = parseInt(taskMatch[1]);
    const body = await readBody(req);
    const data = loadTasks();
    const idx = data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return json(res, 404, { error: 'Task not found.' });
    data.tasks[idx] = {
      ...data.tasks[idx],
      description: body.description !== undefined ? body.description.trim() : data.tasks[idx].description,
      status: body.status || data.tasks[idx].status,
      priority: body.priority || data.tasks[idx].priority,
      project: body.project !== undefined ? body.project : data.tasks[idx].project,
      progress: body.progress !== undefined ? body.progress : data.tasks[idx].progress,
      assignee: body.assignee !== undefined ? body.assignee : data.tasks[idx].assignee,
      updatedAt: now(),
    };
    saveTasks(data);
    return json(res, 200, data.tasks[idx]);
  }

  // PATCH /api/tasks/:id — partial update (status)
  if (taskMatch && method === 'PATCH') {
    const id = parseInt(taskMatch[1]);
    const body = await readBody(req);
    const data = loadTasks();
    const idx = data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return json(res, 404, { error: 'Task not found.' });
    Object.assign(data.tasks[idx], body, { updatedAt: now() });
    saveTasks(data);
    return json(res, 200, data.tasks[idx]);
  }

  // DELETE /api/tasks/:id
  if (taskMatch && method === 'DELETE') {
    const id = parseInt(taskMatch[1]);
    const data = loadTasks();
    const idx = data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return json(res, 404, { error: 'Task not found.' });
    data.tasks.splice(idx, 1);
    saveTasks(data);
    return json(res, 200, { message: 'Task deleted.' });
  }

  // GET /api/stats
  if (pathname === '/api/stats' && method === 'GET') {
    const data = loadTasks();
    const done = data.tasks.filter(t => t.status === 'done').length;
    const total = data.tasks.length;
    const inProgress = data.tasks.filter(t => t.status === 'in-progress').length;
    const todo = data.tasks.filter(t => t.status === 'todo').length;
    const overdue = 0; // placeholder
    return json(res, 200, { total, done, inProgress, todo, overdue });
  }

  return json(res, 404, { error: 'API route not found.' });
}

// ─── Main Server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  try {
    if (pathname.startsWith('/api/')) {
      return await handleAPI(req, res);
    }

    // Serve static files
    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    // Security: prevent directory traversal
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403); return res.end('Forbidden');
    }
    serveStatic(res, filePath);
  } catch (err) {
    console.error('Server error:', err.message);
    json(res, 500, { error: 'Internal server error.' });
  }
});

server.listen(PORT, () => {
  console.log(`\n✅  Task Tracker running at http://localhost:${PORT}\n`);
});
