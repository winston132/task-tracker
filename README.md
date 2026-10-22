# TrackFlow — Task Tracker CLI & Web Dashboard

A full-featured **Task Tracker** with both a **command-line interface (CLI)** and a beautiful **web dashboard** — built with zero external dependencies (pure Node.js + vanilla HTML/CSS/JS).

![TrackFlow Dashboard](./screenshot.png)

---

## ✨ Features

### Web Dashboard
- 📊 **Dashboard** — overview donut chart, activity graph, urgent tasks panel
- 📋 **My Tasks** — filterable task table (All / Todo / In Progress / Done)
- 🗂️ **Kanban Board** — drag-friendly columns for To Do, In Progress, Done
- 📈 **Analytics** — pie chart, bar chart, weekly activity graph
- 📁 **Projects** — auto-grouped by project tag with completion bars
- ⚙️ **Settings** — 8 themes, custom background (solid color / gradient / image URL / upload), accent color, compact mode

### CLI Tool
- Add, update, delete tasks
- Mark tasks as `todo`, `in-progress`, or `done`
- List all tasks or filter by status
- Persistent JSON storage (`tasks.json`)

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) v16+ (no `npm install` needed — zero dependencies)

### Run the Web Dashboard

```bash
# Clone the repo (or unzip the project folder)
cd task-tracker

# Start the server
node server.js
```

Open **http://localhost:3000** in your browser.

---

## 🖥️ CLI Usage

```bash
# Use with Node directly
node task-cli.js <command> [args]

# Or install globally (optional)
npm link
task-cli <command> [args]
```

### Commands

| Command | Description |
|---|---|
| `task-cli add "description"` | Add a new task |
| `task-cli update <id> "new description"` | Update a task |
| `task-cli delete <id>` | Delete a task |
| `task-cli mark-in-progress <id>` | Mark task as in-progress |
| `task-cli mark-done <id>` | Mark task as done |
| `task-cli list` | List all tasks |
| `task-cli list todo` | List todo tasks |
| `task-cli list in-progress` | List in-progress tasks |
| `task-cli list done` | List done tasks |
| `task-cli help` | Show help |

### Examples

```bash
node task-cli.js add "Buy groceries"
# Output: Task added successfully (ID: 1)

node task-cli.js update 1 "Buy groceries and cook dinner"
node task-cli.js mark-in-progress 1
node task-cli.js mark-done 1
node task-cli.js list
node task-cli.js list done
node task-cli.js delete 1
```

---

## 📁 Project Structure

```
task-tracker/
├── task-cli.js      # CLI tool (Node.js built-ins only)
├── server.js        # HTTP server + REST API (Node.js built-ins only)
├── tasks.json       # Task data store (auto-created)
├── package.json
├── README.md
└── public/
    ├── index.html   # Dashboard UI
    ├── style.css    # CSS with 8 themes + theming system
    └── app.js       # Vanilla JS app logic
```

---

## 🎨 Themes

The Settings page lets you switch between **8 built-in themes**:

| Theme | Description |
|---|---|
| ☀️ Light | Clean white (default) |
| 🌙 Dark | Dark gray |
| 🌊 Ocean | Deep blue sidebar |
| 🌿 Forest | Deep green sidebar |
| 🌅 Sunset | Warm orange-red |
| 🌌 Midnight | Deep indigo |
| 🌸 Rose | Pink/crimson |
| 🍊 Amber | Golden yellow |

You can also set a **custom background**:
- Solid color picker
- Gradient presets (8 options)
- Custom image URL
- Upload your own image

---

## 🗄️ Task JSON Schema

```json
{
  "id": 1,
  "description": "Buy groceries",
  "status": "todo",
  "priority": "medium",
  "project": "Personal",
  "assignee": "Alex",
  "progress": 0,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

---

## 🌐 REST API

The server exposes a simple REST API:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/tasks` | Get all tasks |
| `GET` | `/api/tasks?status=done` | Filter by status |
| `POST` | `/api/tasks` | Create task |
| `PUT` | `/api/tasks/:id` | Full update |
| `PATCH` | `/api/tasks/:id` | Partial update |
| `DELETE` | `/api/tasks/:id` | Delete task |
| `GET` | `/api/stats` | Get stats summary |

---

## 📄 License

MIT
