use crate::models::{BulkCreateInput, NewTaskInput, Task, UpdateTaskInput};
use chrono::{Duration as ChronoDuration, NaiveDateTime};
use rusqlite::{params, Connection, Result as SqlResult};
use std::path::PathBuf;

pub fn db_path() -> PathBuf {
    let mut dir = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    dir.push("zume");
    std::fs::create_dir_all(&dir).ok();
    dir.push("zume.db");
    dir
}

pub fn init_db() -> SqlResult<Connection> {
    let conn = Connection::open(db_path())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            start_time TEXT NOT NULL,
            end_time TEXT NOT NULL,
            completed INTEGER NOT NULL DEFAULT 0,
            reminder_enabled INTEGER NOT NULL DEFAULT 0,
            reminder_minutes_before INTEGER NOT NULL DEFAULT 10,
            reminder_fired INTEGER NOT NULL DEFAULT 0,
            order_index INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );",
    )?;
    Ok(conn)
}

fn row_to_task(row: &rusqlite::Row) -> SqlResult<Task> {
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        start_time: row.get(2)?,
        end_time: row.get(3)?,
        completed: row.get::<_, i64>(4)? != 0,
        reminder_enabled: row.get::<_, i64>(5)? != 0,
        reminder_minutes_before: row.get(6)?,
        reminder_fired: row.get::<_, i64>(7)? != 0,
        order_index: row.get(8)?,
        created_at: row.get(9)?,
    })
}

const SELECT_COLS: &str = "id, title, start_time, end_time, completed, reminder_enabled, reminder_minutes_before, reminder_fired, order_index, created_at";

pub fn get_all_tasks(conn: &Connection) -> SqlResult<Vec<Task>> {
    let sql = format!("SELECT {} FROM tasks ORDER BY start_time ASC", SELECT_COLS);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_task)?;
    rows.collect()
}

pub fn create_task(conn: &Connection, input: &NewTaskInput) -> SqlResult<Task> {
    let created_at = chrono::Local::now().naive_local().to_string();
    let max_order: i64 = conn
        .query_row("SELECT COALESCE(MAX(order_index), 0) FROM tasks", [], |r| r.get(0))
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO tasks (title, start_time, end_time, completed, reminder_enabled, reminder_minutes_before, reminder_fired, order_index, created_at)
         VALUES (?1, ?2, ?3, 0, ?4, ?5, 0, ?6, ?7)",
        params![
            input.title,
            input.start_time,
            input.end_time,
            input.reminder_enabled.unwrap_or(false) as i64,
            input.reminder_minutes_before.unwrap_or(10),
            max_order + 1,
            created_at
        ],
    )?;
    let id = conn.last_insert_rowid();
    get_task_by_id(conn, id)
}

pub fn get_task_by_id(conn: &Connection, id: i64) -> SqlResult<Task> {
    let sql = format!("SELECT {} FROM tasks WHERE id = ?1", SELECT_COLS);
    conn.query_row(&sql, params![id], row_to_task)
}

/// Creates a list of tasks starting at `start_time`, each given an equal
/// `duration_minutes` slot back-to-back on the timeline.
pub fn bulk_create_tasks(conn: &Connection, input: &BulkCreateInput) -> SqlResult<Vec<Task>> {
    let created_at = chrono::Local::now().naive_local().to_string();
    let mut cursor = NaiveDateTime::parse_from_str(&input.start_time, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(&input.start_time, "%Y-%m-%dT%H:%M"))
        .unwrap_or_else(|_| chrono::Local::now().naive_local());

    let max_order: i64 = conn
        .query_row("SELECT COALESCE(MAX(order_index), 0) FROM tasks", [], |r| r.get(0))
        .unwrap_or(0);

    let mut created = Vec::new();
    for (i, title) in input.titles.iter().enumerate() {
        let title = title.trim();
        if title.is_empty() {
            continue;
        }
        let start = cursor;
        let end = cursor + ChronoDuration::minutes(input.duration_minutes);
        conn.execute(
            "INSERT INTO tasks (title, start_time, end_time, completed, reminder_enabled, reminder_minutes_before, reminder_fired, order_index, created_at)
             VALUES (?1, ?2, ?3, 0, 0, 10, 0, ?4, ?5)",
            params![
                title,
                start.format("%Y-%m-%dT%H:%M:%S").to_string(),
                end.format("%Y-%m-%dT%H:%M:%S").to_string(),
                max_order + 1 + i as i64,
                created_at
            ],
        )?;
        let id = conn.last_insert_rowid();
        created.push(get_task_by_id(conn, id)?);
        cursor = end;
    }
    Ok(created)
}

pub fn update_task(conn: &Connection, input: &UpdateTaskInput) -> SqlResult<Task> {
    let existing = get_task_by_id(conn, input.id)?;
    let title = input.title.clone().unwrap_or(existing.title.clone());
    let start_time = input.start_time.clone().unwrap_or(existing.start_time.clone());
    let end_time = input.end_time.clone().unwrap_or(existing.end_time);
    let completed = input.completed.unwrap_or(existing.completed);
    let reminder_enabled = input.reminder_enabled.unwrap_or(existing.reminder_enabled);
    let reminder_minutes_before = input
        .reminder_minutes_before
        .unwrap_or(existing.reminder_minutes_before);

    // If the reminder settings or start time changed, allow it to fire again.
    let reminder_fired = if reminder_enabled != existing.reminder_enabled
        || start_time != existing.start_time
        || reminder_minutes_before != existing.reminder_minutes_before
    {
        false
    } else {
        existing.reminder_fired
    };

    conn.execute(
        "UPDATE tasks SET title = ?1, start_time = ?2, end_time = ?3, completed = ?4,
         reminder_enabled = ?5, reminder_minutes_before = ?6, reminder_fired = ?7 WHERE id = ?8",
        params![
            title,
            start_time,
            end_time,
            completed as i64,
            reminder_enabled as i64,
            reminder_minutes_before,
            reminder_fired as i64,
            input.id
        ],
    )?;
    get_task_by_id(conn, input.id)
}

pub fn delete_task(conn: &Connection, id: i64) -> SqlResult<()> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn set_reminder_fired(conn: &Connection, id: i64) -> SqlResult<()> {
    conn.execute("UPDATE tasks SET reminder_fired = 1 WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn delete_all_tasks(conn: &Connection) -> SqlResult<()> {
    conn.execute("DELETE FROM tasks", [])?;
    Ok(())
}
