# Zume

A native Linux desktop todo app (Tauri + Rust + SQLite) that lays your tasks
out on a 24-hour day calendar. Give it a list of tasks, it slices the day into
equal time blocks (default 2h each), and you drag/resize from there.

## Features

- **Bulk add**: paste a list of tasks (one per line), pick a slot length and
  start time, get them auto-scheduled back-to-back on the calendar.
- **24h calendar view** with day navigation (prev/next/today).
- **Color coding**: red/muted = expired, green = happening now, blue = upcoming.
- **Drag to move** a task up/down to change its time. **Drag the bottom edge**
  to resize its duration.
- **Full CRUD**: create, edit, delete, mark complete — via the calendar or the
  task modal.
- **Optional reminders**: toggle per task, fires a native Linux desktop
  notification (`notify-send`) N minutes before start. Off by default, never
  mandatory.
- **SQLite storage** at `~/.local/share/zume/zume.db` (survives restarts).

## Prerequisites

You'll need Rust and the Tauri Linux system dependencies. On Arch Linux:

```bash
# Rust (skip if you already have rustup — you need rustc 1.77+)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Tauri v2 system deps
sudo pacman -Syu
sudo pacman -S --needed \
  base-devel \
  webkit2gtk-4.1 \
  gtk3 \
  librsvg \
  openssl \
  sqlite \
  pkgconf \
  curl \
  wget \
  file \
  libnotify

# Tauri CLI
cargo install tauri-cli --version "^2"
```

`notify-send` (for reminders) is provided by `libnotify`, which is installed in
the command above.

## Run in dev mode

```bash
cd zume
cargo tauri dev
```

## Build a real .deb / AppImage

```bash
cargo tauri build
```

Output lands in `src-tauri/target/release/bundle/deb/` and
`.../bundle/appimage/`. Install the `.deb` with
`sudo dpkg -i src-tauri/target/release/bundle/deb/*.deb`.

## Project layout

```
src-tauri/          Rust backend (Tauri)
  src/main.rs        entry point, wires up commands + reminder thread
  src/db.rs          SQLite layer (rusqlite)
  src/models.rs       task structs
  src/commands.rs     #[tauri::command]s exposed to the frontend
  src/reminders.rs     background thread, fires notify-send
  tauri.conf.json      app/window config
  capabilities/         Tauri v2 permission grants
src/                 Frontend (plain HTML/CSS/JS, no build step)
  index.html
  style.css
  main.js             calendar rendering, drag/resize, CRUD calls
```

## Application 

<img width="1600" height="900" alt="image" src="https://github.com/user-attachments/assets/320fbbba-9948-48f7-8531-2764459bc3c9" />
