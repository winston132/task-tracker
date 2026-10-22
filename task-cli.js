#!/usr/bin/env node
/**
 * task-cli.js — Task Tracker CLI
 * Uses only Node.js built-in modules (no external dependencies).
 * Storage: tasks.json in the current working directory.
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(process.cwd(), 'tasks.json');

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadTasks() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ nextId: 1, tasks: [] }, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    console.error('Error: Could not parse tasks.json. File may be corrupted.');
    process.exit(1);
  }
}

function saveTasks(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function now() {
  return new Date().toISOString();
}

function findTask(data, id) {
  const task = data.tasks.find(t => t.id === id);
  if (!task) {
    console.error(`Error: Task with ID ${id} not found.`);
    process.exit(1);
  }
  return task;
}

function printTask(task) {
  const statusColor = {
    'todo': '\x1b[33m',       // yellow
    'in-progress': '\x1b[34m', // blue
    'done': '\x1b[32m',        // green
  };
  const reset = '\x1b[0m';
  const color = statusColor[task.status] || '';
  console.log(
    `  [${task.id}] ${task.description}\n` +
    `       Status: ${color}${task.status}${reset} | Created: ${task.createdAt.slice(0, 10)} | Updated: ${task.updatedAt.slice(0, 10)}`
  );
}

// ─── Commands ────────────────────────────────────────────────────────────────

function addTask(description) {
  if (!description || !description.trim()) {
    console.error('Error: Task description cannot be empty.');
    process.exit(1);
  }
  const data = loadTasks();
  const task = {
    id: data.nextId++,
    description: description.trim(),
    status: 'todo',
    createdAt: now(),
    updatedAt: now(),
  };
  data.tasks.push(task);
  saveTasks(data);
  console.log(`Task added successfully (ID: ${task.id})`);
}

function updateTask(id, description) {
  if (!description || !description.trim()) {
    console.error('Error: Task description cannot be empty.');
    process.exit(1);
  }
  const data = loadTasks();
  const task = findTask(data, id);
  task.description = description.trim();
  task.updatedAt = now();
  saveTasks(data);
  console.log(`Task ${id} updated successfully.`);
}

function deleteTask(id) {
  const data = loadTasks();
  findTask(data, id); // validates existence
  data.tasks = data.tasks.filter(t => t.id !== id);
  saveTasks(data);
  console.log(`Task ${id} deleted successfully.`);
}

function markTask(id, status) {
  const data = loadTasks();
  const task = findTask(data, id);
  task.status = status;
  task.updatedAt = now();
  saveTasks(data);
  console.log(`Task ${id} marked as "${status}".`);
}

function listTasks(filter) {
  const data = loadTasks();
  let tasks = data.tasks;
  const validFilters = ['todo', 'in-progress', 'done'];
  if (filter) {
    if (!validFilters.includes(filter)) {
      console.error(`Error: Unknown filter "${filter}". Use: todo | in-progress | done`);
      process.exit(1);
    }
    tasks = tasks.filter(t => t.status === filter);
  }
  if (tasks.length === 0) {
    console.log(filter ? `No tasks with status "${filter}".` : 'No tasks found.');
    return;
  }
  console.log(filter ? `\nTasks [${filter}]:\n` : '\nAll Tasks:\n');
  tasks.forEach(printTask);
  console.log('');
}

function showHelp() {
  console.log(`
\x1b[1mTask Tracker CLI\x1b[0m — Manage your tasks from the command line.

Usage:
  task-cli <command> [args]

Commands:
  add <description>           Add a new task
  update <id> <description>   Update a task's description
  delete <id>                 Delete a task
  mark-in-progress <id>       Mark a task as in-progress
  mark-done <id>              Mark a task as done
  list                        List all tasks
  list todo                   List tasks with status "todo"
  list in-progress            List tasks with status "in-progress"
  list done                   List tasks with status "done"
  help                        Show this help message

Examples:
  task-cli add "Buy groceries"
  task-cli update 1 "Buy groceries and cook dinner"
  task-cli delete 1
  task-cli mark-in-progress 1
  task-cli mark-done 1
  task-cli list
  task-cli list done
`);
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

const [,, command, ...args] = process.argv;

switch (command) {
  case 'add':
    addTask(args.join(' '));
    break;
  case 'update': {
    const id = parseInt(args[0]);
    if (isNaN(id)) { console.error('Error: ID must be a number.'); process.exit(1); }
    updateTask(id, args.slice(1).join(' '));
    break;
  }
  case 'delete': {
    const id = parseInt(args[0]);
    if (isNaN(id)) { console.error('Error: ID must be a number.'); process.exit(1); }
    deleteTask(id);
    break;
  }
  case 'mark-in-progress': {
    const id = parseInt(args[0]);
    if (isNaN(id)) { console.error('Error: ID must be a number.'); process.exit(1); }
    markTask(id, 'in-progress');
    break;
  }
  case 'mark-done': {
    const id = parseInt(args[0]);
    if (isNaN(id)) { console.error('Error: ID must be a number.'); process.exit(1); }
    markTask(id, 'done');
    break;
  }
  case 'list':
    listTasks(args[0]);
    break;
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    showHelp();
    break;
  default:
    console.error(`Error: Unknown command "${command}". Run "task-cli help" for usage.`);
    process.exit(1);
}
