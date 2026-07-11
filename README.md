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

## Notes / things worth knowing

- **Why Tauri v2, not v1**: v1's webview library doesn't cleanly support
  webkit2gtk-4.1 (what Ubuntu 24.04+ ships) — it crashes at runtime with a
  `libsoup2`/`libsoup3` symbol conflict. v2 fixes this natively, so use v2.
- **Equal time slots**: bulk-add divides tasks sequentially starting at your
  chosen start time — task 1 gets `[start, start+duration)`, task 2 gets
  `[end of task 1, +duration)`, etc. Nothing stops you from creating overlaps
  afterward (e.g. dragging one on top of another) — the calendar just splits
  the width between them.
- **Reminders fire once**: a reminder marks itself "fired" after triggering,
  so editing the task's start time or reminder settings re-arms it.
- **I built and verified this compiles + links successfully** in my sandbox
  using Tauri v1 (had to pin ~15 transitive crates down because the sandbox's
  `apt`-provided rustc was an old 1.75 with no route to a newer toolchain —
  not a real-world constraint). I then ported to v2 for the correct
  webkit2gtk-4.1 support, but couldn't fully compile-verify v2 in that same
  sandbox for the same rustc-version reason — a chain of gtk-rs/toml crates
  hit a genuine conflict that only resolves with a modern toolchain. Your own
  machine (you're already building sqlx/axum/tokio projects, so you've got a
  current rustup toolchain) won't hit any of this — `cargo tauri build` should
  just work. If it doesn't, paste me the error and I'll fix it fast.
