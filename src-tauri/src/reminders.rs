use crate::db;
use crate::DbState;
use chrono::{Local, NaiveDateTime};
use std::process::Command;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Fires a Linux desktop notification via `notify-send`, which ships with
/// virtually every Linux desktop environment (GNOME, KDE, XFCE, etc).
fn notify(title: &str, body: &str) {
    let result = Command::new("notify-send")
        .arg("--app-name=Zume")
        .arg("--icon=appointment-soon")
        .arg(title)
        .arg(body)
        .spawn();
    if let Err(e) = result {
        eprintln!("notify-send failed (is it installed?): {e}");
    }
}

fn parse(dt: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(dt, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(dt, "%Y-%m-%dT%H:%M"))
        .ok()
}

/// Spawns a background thread that polls the DB every 20 seconds and fires a
/// Linux desktop notification (via notify-send under the hood) for any task
/// whose reminder window has arrived.
pub fn start(app_handle: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(20));

        let state: tauri::State<DbState> = app_handle.state();
        let conn = match state.0.lock() {
            Ok(c) => c,
            Err(_) => continue,
        };

        let tasks = match db::get_all_tasks(&conn) {
            Ok(t) => t,
            Err(_) => continue,
        };

        let now = Local::now().naive_local();

        for task in tasks {
            if task.completed || !task.reminder_enabled || task.reminder_fired {
                continue;
            }
            let Some(start) = parse(&task.start_time) else { continue };
            let remind_at = start - chrono::Duration::minutes(task.reminder_minutes_before);

            // Fire once we've reached the reminder time, as long as we haven't
            // sailed too far past the task start (avoids a flood of stale
            // notifications if the app was closed for a while).
            if now >= remind_at && now <= start + chrono::Duration::minutes(5) {
                let body = format!(
                    "{} starts at {}",
                    task.title,
                    start.format("%I:%M %p")
                );
                notify("Task reminder", &body);
                let _ = db::set_reminder_fired(&conn, task.id);
            }
        }
    });
}
