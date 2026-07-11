const invoke = window.__TAURI__.core.invoke;

// ---------- State ----------
let allTasks = [];
let viewDate = startOfDay(new Date());
let editingTaskId = null; // null = creating new task
const PX_PER_MIN = 1; // hour-height is 60px in CSS, so 1px == 1 minute

// ---------- DOM refs ----------
const gridCol = document.getElementById("gridCol");
const hoursCol = document.getElementById("hoursCol");
const dateLabel = document.getElementById("dateLabel");
const nowLine = document.getElementById("nowLine");
const toastEl = document.getElementById("toast");

const bulkModal = document.getElementById("bulkModalBackdrop");
const taskModal = document.getElementById("taskModalBackdrop");

// ---------- Helpers ----------
function startOfDay(d) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function fmtDateLabel(d) {
  const today = startOfDay(new Date());
  const diffDays = Math.round((startOfDay(d) - today) / 86400000);
  const opts = { weekday: "short", month: "short", day: "numeric" };
  const base = d.toLocaleDateString(undefined, opts);
  if (diffDays === 0) return `Today · ${base}`;
  if (diffDays === 1) return `Tomorrow · ${base}`;
  if (diffDays === -1) return `Yesterday · ${base}`;
  return base;
}

function pad(n) { return String(n).padStart(2, "0"); }

// Format a JS Date as the ISO-ish string our Rust backend parses:
// YYYY-MM-DDTHH:MM:SS (local time, no timezone offset)
function toIsoLocal(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function parseIsoLocal(s) {
  // "YYYY-MM-DDTHH:MM:SS" -> Date (local)
  const [datePart, timePart] = s.split("T");
  const [y, mo, da] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  return new Date(y, mo - 1, da, h, mi, 0);
}

function minutesFromMidnight(d) {
  return d.getHours() * 60 + d.getMinutes();
}

function timeLabel(d) {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ---------- Backend calls ----------
async function loadTasks() {
  try {
    allTasks = await invoke("get_tasks");
    render();
  } catch (e) {
    showToast("Failed to load tasks: " + e);
  }
}

async function createTask(payload) {
  await invoke("create_task", { input: payload });
  await loadTasks();
}

async function bulkCreate(payload) {
  await invoke("bulk_create_tasks", { input: payload });
  await loadTasks();
}

async function updateTask(payload) {
  await invoke("update_task", { input: payload });
  await loadTasks();
}

async function deleteTask(id) {
  await invoke("delete_task", { id });
  await loadTasks();
}

// ---------- Rendering ----------
function buildHourLabels() {
  hoursCol.innerHTML = "";
  for (let h = 0; h < 24; h++) {
    const el = document.createElement("div");
    el.className = "hour-label";
    const d = new Date(2000, 0, 1, h, 0);
    el.textContent = h === 0 ? "12 AM" : d.toLocaleTimeString([], { hour: "numeric" }).replace(":00", "");
    hoursCol.appendChild(el);
  }
}

function classify(task, now) {
  if (task.completed) return "expired"; // visually dim/expired styling, badge shows done
  const start = parseIsoLocal(task.start_time);
  const end = parseIsoLocal(task.end_time);
  if (now >= end) return "expired";
  if (now >= start && now < end) return "current";
  return "upcoming";
}

// Assign overlap columns so overlapping tasks share width instead of stacking.
function layoutColumns(tasks) {
  const sorted = [...tasks].sort((a, b) => parseIsoLocal(a.start_time) - parseIsoLocal(b.start_time));
  const active = []; // {task, col, endMin}
  const positioned = [];
  let groupMembers = [];

  function flushGroup() {
    if (!groupMembers.length) return;
    const maxCol = Math.max(...groupMembers.map((m) => m.col)) + 1;
    groupMembers.forEach((m) => positioned.push({ ...m, groupSize: maxCol }));
    groupMembers = [];
  }

  for (const t of sorted) {
    const startMin = minutesFromMidnight(parseIsoLocal(t.start_time));
    const endMin = startMin + Math.max(15, (parseIsoLocal(t.end_time) - parseIsoLocal(t.start_time)) / 60000);

    // drop columns that no longer overlap
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].endMin <= startMin) active.splice(i, 1);
    }
    if (active.length === 0) flushGroup();

    let col = 0;
    const usedCols = new Set(active.map((a) => a.col));
    while (usedCols.has(col)) col++;

    active.push({ col, endMin });
    groupMembers.push({ task: t, col, startMin, endMin });
  }
  flushGroup();
  return positioned;
}

function render() {
  dateLabel.textContent = fmtDateLabel(viewDate);
  buildHourLabels();

  // clear existing task blocks (keep now-line)
  [...gridCol.querySelectorAll(".task-block")].forEach((el) => el.remove());

  const dayTasks = allTasks.filter((t) => isSameDay(parseIsoLocal(t.start_time), viewDate));
  const now = new Date();
  const positioned = layoutColumns(dayTasks);

  for (const p of positioned) {
    const { task, col, groupSize } = p;
    const start = parseIsoLocal(task.start_time);
    const end = parseIsoLocal(task.end_time);
    const top = minutesFromMidnight(start) * PX_PER_MIN;
    const durMin = Math.max(15, (end - start) / 60000);
    const height = durMin * PX_PER_MIN;

    const block = document.createElement("div");
    const status = classify(task, now);
    block.className = `task-block ${status}${task.completed ? " completed" : ""}`;
    block.style.top = top + "px";
    block.style.height = Math.max(height, 22) + "px";
    const widthPct = 100 / groupSize;
    block.style.width = `calc(${widthPct}% - 8px)`;
    block.style.left = `calc(${widthPct * col}% + 4px)`;
    block.dataset.id = task.id;

    block.innerHTML = `
      <div class="task-badges">${task.reminder_enabled ? "🔔" : ""}${task.completed ? " ✓" : ""}</div>
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-time">${timeLabel(start)} – ${timeLabel(end)}</div>
      <div class="resize-handle"></div>
    `;

    attachDrag(block, task);
    attachResize(block.querySelector(".resize-handle"), task);

    block.addEventListener("click", (e) => {
      if (block.dataset.dragged === "1") {
        block.dataset.dragged = "0";
        return;
      }
      openEditModal(task);
    });

    gridCol.appendChild(block);
  }

  positionNowLine();
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function positionNowLine() {
  const now = new Date();
  if (isSameDay(now, viewDate)) {
    nowLine.style.display = "block";
    nowLine.style.top = minutesFromMidnight(now) * PX_PER_MIN + "px";
  } else {
    nowLine.style.display = "none";
  }
}

// ---------- Drag to move ----------
function attachDrag(block, task) {
  let dragging = false;
  let startY = 0;
  let startTop = 0;
  let moved = false;

  block.addEventListener("mousedown", (e) => {
    if (e.target.classList.contains("resize-handle")) return;
    dragging = true;
    moved = false;
    startY = e.clientY;
    startTop = parseFloat(block.style.top);
    block.classList.add("dragging");
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const deltaY = e.clientY - startY;
    if (Math.abs(deltaY) > 3) moved = true;
    let newTop = startTop + deltaY;
    const heightPx = parseFloat(block.style.height);
    newTop = Math.max(0, Math.min(newTop, 1440 * PX_PER_MIN - heightPx));
    // snap to 5-minute increments
    newTop = Math.round(newTop / 5) * 5;
    block.style.top = newTop + "px";
  });

  window.addEventListener("mouseup", async (e) => {
    if (!dragging) return;
    dragging = false;
    block.classList.remove("dragging");
    if (!moved) return;
    block.dataset.dragged = "1";

    const newTopMin = parseFloat(block.style.top) / PX_PER_MIN;
    const durMin = Math.round((parseIsoLocal(task.end_time) - parseIsoLocal(task.start_time)) / 60000);
    const newStart = new Date(viewDate);
    newStart.setMinutes(newTopMin);
    const newEnd = new Date(newStart.getTime() + durMin * 60000);

    try {
      await updateTask({
        id: task.id,
        start_time: toIsoLocal(newStart),
        end_time: toIsoLocal(newEnd),
      });
      showToast("Task moved to " + timeLabel(newStart));
    } catch (err) {
      showToast("Failed to move task: " + err);
      render();
    }
  });
}

// ---------- Resize to change duration ----------
function attachResize(handle, task) {
  let resizing = false;
  let startY = 0;
  let startHeight = 0;
  const block = handle.parentElement;

  handle.addEventListener("mousedown", (e) => {
    resizing = true;
    startY = e.clientY;
    startHeight = parseFloat(block.style.height);
    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener("mousemove", (e) => {
    if (!resizing) return;
    const deltaY = e.clientY - startY;
    let newHeight = Math.max(15 * PX_PER_MIN, startHeight + deltaY);
    const top = parseFloat(block.style.top);
    newHeight = Math.min(newHeight, 1440 * PX_PER_MIN - top);
    newHeight = Math.round(newHeight / 5) * 5;
    block.style.height = newHeight + "px";
  });

  window.addEventListener("mouseup", async () => {
    if (!resizing) return;
    resizing = false;
    block.dataset.dragged = "1";

    const top = parseFloat(block.style.top) / PX_PER_MIN;
    const newDurMin = parseFloat(block.style.height) / PX_PER_MIN;
    const newStart = new Date(viewDate);
    newStart.setMinutes(top);
    const newEnd = new Date(newStart.getTime() + newDurMin * 60000);

    try {
      await updateTask({
        id: task.id,
        end_time: toIsoLocal(newEnd),
      });
      showToast("Duration updated");
    } catch (err) {
      showToast("Failed to resize task: " + err);
      render();
    }
  });
}

// ---------- Day navigation ----------
document.getElementById("prevDay").onclick = () => {
  viewDate = new Date(viewDate.getTime() - 86400000);
  render();
};
document.getElementById("nextDay").onclick = () => {
  viewDate = new Date(viewDate.getTime() + 86400000);
  render();
};
document.getElementById("todayBtn").onclick = () => {
  viewDate = startOfDay(new Date());
  render();
};

// ---------- Bulk add modal ----------
const bulkTextarea = document.getElementById("bulkTextarea");
const bulkDurationHours = document.getElementById("bulkDurationHours");
const bulkStartTime = document.getElementById("bulkStartTime");

document.getElementById("openBulkAdd").onclick = () => {
  bulkTextarea.value = "";
  bulkDurationHours.value = "2";
  const now = new Date();
  bulkStartTime.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  bulkModal.classList.add("open");
};
document.getElementById("bulkCancel").onclick = () => bulkModal.classList.remove("open");

document.getElementById("bulkSubmit").onclick = async () => {
  const titles = bulkTextarea.value.split("\n").map((l) => l.trim()).filter(Boolean);
  if (titles.length === 0) {
    showToast("Add at least one task");
    return;
  }
  const hours = parseFloat(bulkDurationHours.value) || 2;
  const [h, m] = bulkStartTime.value.split(":").map(Number);
  const start = new Date(viewDate);
  start.setHours(h, m, 0, 0);

  try {
    await bulkCreate({
      titles,
      duration_minutes: Math.round(hours * 60),
      start_time: toIsoLocal(start),
    });
    bulkModal.classList.remove("open");
    showToast(`${titles.length} tasks scheduled, ${hours}h each`);
  } catch (err) {
    showToast("Failed to schedule tasks: " + err);
  }
};

// ---------- Single add / edit modal ----------
const taskTitle = document.getElementById("taskTitle");
const taskStart = document.getElementById("taskStart");
const taskEnd = document.getElementById("taskEnd");
const taskReminderEnabled = document.getElementById("taskReminderEnabled");
const taskReminderMinutes = document.getElementById("taskReminderMinutes");
const reminderMinsRow = document.getElementById("reminderMinsRow");
const taskCompleted = document.getElementById("taskCompleted");
const taskModalTitle = document.getElementById("taskModalTitle");
const taskDeleteBtn = document.getElementById("taskDelete");

taskReminderEnabled.addEventListener("change", () => {
  reminderMinsRow.classList.toggle("active", taskReminderEnabled.checked);
});

document.getElementById("openSingleAdd").onclick = () => openNewModal();

function openNewModal() {
  editingTaskId = null;
  taskModalTitle.textContent = "New task";
  taskDeleteBtn.style.display = "none";
  taskTitle.value = "";
  const now = new Date();
  const rounded = new Date(now);
  rounded.setMinutes(Math.ceil(now.getMinutes() / 5) * 5, 0, 0);
  const end = new Date(rounded.getTime() + 120 * 60000);
  taskStart.value = `${pad(rounded.getHours())}:${pad(rounded.getMinutes())}`;
  taskEnd.value = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  taskReminderEnabled.checked = false;
  taskReminderMinutes.value = 10;
  reminderMinsRow.classList.remove("active");
  taskCompleted.checked = false;
  taskModal.classList.add("open");
}

function openEditModal(task) {
  editingTaskId = task.id;
  taskModalTitle.textContent = "Edit task";
  taskDeleteBtn.style.display = "inline-block";
  taskTitle.value = task.title;
  const s = parseIsoLocal(task.start_time);
  const e = parseIsoLocal(task.end_time);
  taskStart.value = `${pad(s.getHours())}:${pad(s.getMinutes())}`;
  taskEnd.value = `${pad(e.getHours())}:${pad(e.getMinutes())}`;
  taskReminderEnabled.checked = !!task.reminder_enabled;
  taskReminderMinutes.value = task.reminder_minutes_before || 10;
  reminderMinsRow.classList.toggle("active", !!task.reminder_enabled);
  taskCompleted.checked = !!task.completed;
  taskModal.classList.add("open");
}

document.getElementById("taskCancel").onclick = () => taskModal.classList.remove("open");

document.getElementById("taskSubmit").onclick = async () => {
  const title = taskTitle.value.trim();
  if (!title) {
    showToast("Give the task a title");
    return;
  }
  const [sh, sm] = taskStart.value.split(":").map(Number);
  const [eh, em] = taskEnd.value.split(":").map(Number);
  const start = new Date(viewDate);
  start.setHours(sh, sm, 0, 0);
  let end = new Date(viewDate);
  end.setHours(eh, em, 0, 0);
  if (end <= start) end = new Date(end.getTime() + 86400000); // task crosses midnight

  try {
    if (editingTaskId == null) {
      await createTask({
        title,
        start_time: toIsoLocal(start),
        end_time: toIsoLocal(end),
        reminder_enabled: taskReminderEnabled.checked,
        reminder_minutes_before: parseInt(taskReminderMinutes.value, 10) || 10,
      });
      showToast("Task created");
    } else {
      await updateTask({
        id: editingTaskId,
        title,
        start_time: toIsoLocal(start),
        end_time: toIsoLocal(end),
        reminder_enabled: taskReminderEnabled.checked,
        reminder_minutes_before: parseInt(taskReminderMinutes.value, 10) || 10,
        completed: taskCompleted.checked,
      });
      showToast("Task updated");
    }
    taskModal.classList.remove("open");
  } catch (err) {
    showToast("Failed to save task: " + err);
  }
};

taskDeleteBtn.onclick = async () => {
  if (editingTaskId == null) return;
  try {
    await deleteTask(editingTaskId);
    taskModal.classList.remove("open");
    showToast("Task deleted");
  } catch (err) {
    showToast("Failed to delete task: " + err);
  }
};

// close modals on backdrop click
[bulkModal, taskModal].forEach((m) => {
  m.addEventListener("click", (e) => {
    if (e.target === m) m.classList.remove("open");
  });
});

// ---------- Boot ----------
loadTasks();
setInterval(() => {
  positionNowLine();
  render(); // cheap enough at this scale; keeps expired/current/upcoming colors fresh
}, 30000);
