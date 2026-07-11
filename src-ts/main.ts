import type { Task, NewTaskInput, UpdateTaskInput, BulkCreateInput } from "./types";

const invoke = window.__TAURI__.core.invoke;

// ---------- State ----------
let allTasks: Task[] = [];
let viewDate: Date = startOfDay(new Date());
let editingTaskId: number | null = null; // null = creating new task
const PX_PER_MIN = 1; // hour-height is 60px in CSS, so 1px == 1 minute

// ---------- DOM refs ----------
const gridCol = document.getElementById("gridCol") as HTMLDivElement;
const hoursCol = document.getElementById("hoursCol") as HTMLDivElement;
const dateLabel = document.getElementById("dateLabel") as HTMLDivElement;
const nowLine = document.getElementById("nowLine") as HTMLDivElement;
const toastEl = document.getElementById("toast") as HTMLDivElement;

const bulkModal = document.getElementById("bulkModalBackdrop") as HTMLDivElement;
const taskModal = document.getElementById("taskModalBackdrop") as HTMLDivElement;

// ---------- Helpers ----------
function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function fmtDateLabel(d: Date): string {
  const today = startOfDay(new Date());
  const diffDays = Math.round((startOfDay(d).getTime() - today.getTime()) / 86400000);
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" };
  const base = d.toLocaleDateString(undefined, opts);
  if (diffDays === 0) return `Today · ${base}`;
  if (diffDays === 1) return `Tomorrow · ${base}`;
  if (diffDays === -1) return `Yesterday · ${base}`;
  return base;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Format a JS Date as the ISO-ish string our Rust backend parses:
// YYYY-MM-DDTHH:MM:SS (local time, no timezone offset)
function toIsoLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

function parseIsoLocal(s: string): Date {
  // "YYYY-MM-DDTHH:MM:SS" -> Date (local)
  const [datePart, timePart] = s.split("T");
  const [y, mo, da] = datePart.split("-").map(Number);
  const [h, mi] = timePart.split(":").map(Number);
  return new Date(y, mo - 1, da, h, mi, 0);
}

function minutesFromMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(msg: string): void {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// ---------- Backend calls ----------
async function loadTasks(): Promise<void> {
  try {
    allTasks = await invoke<Task[]>("get_tasks");
    render();
  } catch (e) {
    showToast("Failed to load tasks: " + e);
  }
}

async function createTask(payload: NewTaskInput): Promise<void> {
  await invoke("create_task", { input: payload });
  await loadTasks();
}

async function bulkCreate(payload: BulkCreateInput): Promise<void> {
  await invoke("bulk_create_tasks", { input: payload });
  await loadTasks();
}

async function updateTask(payload: UpdateTaskInput): Promise<void> {
  await invoke("update_task", { input: payload });
  await loadTasks();
}

async function deleteTask(id: number): Promise<void> {
  await invoke("delete_task", { id });
  await loadTasks();
}

// ---------- Rendering ----------
function buildHourLabels(): void {
  hoursCol.innerHTML = "";
  for (let h = 0; h < 24; h++) {
    const el = document.createElement("div");
    el.className = "hour-label";
    const d = new Date(2000, 0, 1, h, 0);
    el.textContent = h === 0 ? "12 AM" : d.toLocaleTimeString([], { hour: "numeric" }).replace(":00", "");
    hoursCol.appendChild(el);
  }
}

type Status = "expired" | "current" | "upcoming";

function classify(task: Task, now: Date): Status {
  if (task.completed) return "expired"; // visually dim/expired styling, badge shows done
  const start = parseIsoLocal(task.start_time);
  const end = parseIsoLocal(task.end_time);
  if (now >= end) return "expired";
  if (now >= start && now < end) return "current";
  return "upcoming";
}

interface PositionedTask {
  task: Task;
  col: number;
  startMin: number;
  endMin: number;
  groupSize: number;
}

interface ActiveSlot {
  col: number;
  endMin: number;
}

interface GroupMember {
  task: Task;
  col: number;
  startMin: number;
  endMin: number;
}

// Assign overlap columns so overlapping tasks share width instead of stacking.
function layoutColumns(tasks: Task[]): PositionedTask[] {
  const sorted = [...tasks].sort(
    (a, b) => parseIsoLocal(a.start_time).getTime() - parseIsoLocal(b.start_time).getTime()
  );
  const active: ActiveSlot[] = [];
  const positioned: PositionedTask[] = [];
  let groupMembers: GroupMember[] = [];

  function flushGroup(): void {
    if (!groupMembers.length) return;
    const maxCol = Math.max(...groupMembers.map((m) => m.col)) + 1;
    groupMembers.forEach((m) => positioned.push({ ...m, groupSize: maxCol }));
    groupMembers = [];
  }

  for (const t of sorted) {
    const startMin = minutesFromMidnight(parseIsoLocal(t.start_time));
    const endMin =
      startMin +
      Math.max(15, (parseIsoLocal(t.end_time).getTime() - parseIsoLocal(t.start_time).getTime()) / 60000);

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

function render(): void {
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
    const durMin = Math.max(15, (end.getTime() - start.getTime()) / 60000);
    const height = durMin * PX_PER_MIN;

    const block = document.createElement("div");
    const status = classify(task, now);
    block.className = `task-block ${status}${task.completed ? " completed" : ""}`;
    block.style.top = top + "px";
    block.style.height = Math.max(height, 22) + "px";
    const widthPct = 100 / groupSize;
    block.style.width = `calc(${widthPct}% - 8px)`;
    block.style.left = `calc(${widthPct * col}% + 4px)`;
    block.dataset.id = String(task.id);

    block.innerHTML = `
      <div class="task-badges">${task.reminder_enabled ? "🔔" : ""}${task.completed ? " ✓" : ""}</div>
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-time">${timeLabel(start)} – ${timeLabel(end)}</div>
      <div class="resize-handle"></div>
    `;

    attachDrag(block, task);
    const handle = block.querySelector<HTMLDivElement>(".resize-handle");
    if (handle) attachResize(handle, task);

    block.addEventListener("click", () => {
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

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function positionNowLine(): void {
  const now = new Date();
  if (isSameDay(now, viewDate)) {
    nowLine.style.display = "block";
    nowLine.style.top = minutesFromMidnight(now) * PX_PER_MIN + "px";
  } else {
    nowLine.style.display = "none";
  }
}

// ---------- Drag to move ----------
function attachDrag(block: HTMLDivElement, task: Task): void {
  let dragging = false;
  let startY = 0;
  let startTop = 0;
  let moved = false;

  block.addEventListener("mousedown", (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("resize-handle")) return;
    dragging = true;
    moved = false;
    startY = e.clientY;
    startTop = parseFloat(block.style.top);
    block.classList.add("dragging");
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e: MouseEvent) => {
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

  window.addEventListener("mouseup", async () => {
    if (!dragging) return;
    dragging = false;
    block.classList.remove("dragging");
    if (!moved) return;
    block.dataset.dragged = "1";

    const newTopMin = parseFloat(block.style.top) / PX_PER_MIN;
    const durMin = Math.round(
      (parseIsoLocal(task.end_time).getTime() - parseIsoLocal(task.start_time).getTime()) / 60000
    );
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
function attachResize(handle: HTMLDivElement, task: Task): void {
  let resizing = false;
  let startY = 0;
  let startHeight = 0;
  const block = handle.parentElement as HTMLDivElement;

  handle.addEventListener("mousedown", (e: MouseEvent) => {
    resizing = true;
    startY = e.clientY;
    startHeight = parseFloat(block.style.height);
    e.preventDefault();
    e.stopPropagation();
  });

  window.addEventListener("mousemove", (e: MouseEvent) => {
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
(document.getElementById("prevDay") as HTMLButtonElement).onclick = () => {
  viewDate = new Date(viewDate.getTime() - 86400000);
  render();
};
(document.getElementById("nextDay") as HTMLButtonElement).onclick = () => {
  viewDate = new Date(viewDate.getTime() + 86400000);
  render();
};
(document.getElementById("todayBtn") as HTMLButtonElement).onclick = () => {
  viewDate = startOfDay(new Date());
  render();
};

// ---------- Bulk add modal ----------
const bulkTextarea = document.getElementById("bulkTextarea") as HTMLTextAreaElement;
const bulkDurationHours = document.getElementById("bulkDurationHours") as HTMLInputElement;
const bulkStartTime = document.getElementById("bulkStartTime") as HTMLInputElement;

(document.getElementById("openBulkAdd") as HTMLButtonElement).onclick = () => {
  bulkTextarea.value = "";
  bulkDurationHours.value = "2";
  const now = new Date();
  bulkStartTime.value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  bulkModal.classList.add("open");
};
(document.getElementById("bulkCancel") as HTMLButtonElement).onclick = () => bulkModal.classList.remove("open");

(document.getElementById("bulkSubmit") as HTMLButtonElement).onclick = async () => {
  const titles = bulkTextarea.value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
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
const taskTitleInput = document.getElementById("taskTitle") as HTMLInputElement;
const taskStart = document.getElementById("taskStart") as HTMLInputElement;
const taskEnd = document.getElementById("taskEnd") as HTMLInputElement;
const taskReminderEnabled = document.getElementById("taskReminderEnabled") as HTMLInputElement;
const taskReminderMinutes = document.getElementById("taskReminderMinutes") as HTMLInputElement;
const reminderMinsRow = document.getElementById("reminderMinsRow") as HTMLDivElement;
const taskCompleted = document.getElementById("taskCompleted") as HTMLInputElement;
const taskModalTitle = document.getElementById("taskModalTitle") as HTMLHeadingElement;
const taskDeleteBtn = document.getElementById("taskDelete") as HTMLButtonElement;

taskReminderEnabled.addEventListener("change", () => {
  reminderMinsRow.classList.toggle("active", taskReminderEnabled.checked);
});

(document.getElementById("openSingleAdd") as HTMLButtonElement).onclick = () => openNewModal();

function openNewModal(): void {
  editingTaskId = null;
  taskModalTitle.textContent = "New task";
  taskDeleteBtn.style.display = "none";
  taskTitleInput.value = "";
  const now = new Date();
  const rounded = new Date(now);
  rounded.setMinutes(Math.ceil(now.getMinutes() / 5) * 5, 0, 0);
  const end = new Date(rounded.getTime() + 120 * 60000);
  taskStart.value = `${pad(rounded.getHours())}:${pad(rounded.getMinutes())}`;
  taskEnd.value = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  taskReminderEnabled.checked = false;
  taskReminderMinutes.value = "10";
  reminderMinsRow.classList.remove("active");
  taskCompleted.checked = false;
  taskModal.classList.add("open");
}

function openEditModal(task: Task): void {
  editingTaskId = task.id;
  taskModalTitle.textContent = "Edit task";
  taskDeleteBtn.style.display = "inline-block";
  taskTitleInput.value = task.title;
  const s = parseIsoLocal(task.start_time);
  const e = parseIsoLocal(task.end_time);
  taskStart.value = `${pad(s.getHours())}:${pad(s.getMinutes())}`;
  taskEnd.value = `${pad(e.getHours())}:${pad(e.getMinutes())}`;
  taskReminderEnabled.checked = !!task.reminder_enabled;
  taskReminderMinutes.value = String(task.reminder_minutes_before || 10);
  reminderMinsRow.classList.toggle("active", !!task.reminder_enabled);
  taskCompleted.checked = !!task.completed;
  taskModal.classList.add("open");
}

(document.getElementById("taskCancel") as HTMLButtonElement).onclick = () => taskModal.classList.remove("open");

(document.getElementById("taskSubmit") as HTMLButtonElement).onclick = async () => {
  const title = taskTitleInput.value.trim();
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
  m.addEventListener("click", (e: MouseEvent) => {
    if (e.target === m) m.classList.remove("open");
  });
});

// ---------- Boot ----------
loadTasks();
setInterval(() => {
  positionNowLine();
  render(); // cheap enough at this scale; keeps expired/current/upcoming colors fresh
}, 30000);
