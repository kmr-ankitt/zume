#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod db;
mod models;
mod reminders;

use rusqlite::Connection;
use std::sync::Mutex;

pub struct DbState(pub Mutex<Connection>);

fn main() {
    let conn = db::init_db().expect("failed to initialize database");

    tauri::Builder::default()
        .manage(DbState(Mutex::new(conn)))
        .invoke_handler(tauri::generate_handler![
            commands::get_tasks,
            commands::create_task,
            commands::bulk_create_tasks,
            commands::update_task,
            commands::delete_task,
            commands::delete_all_tasks,
        ])
        .setup(|app| {
            reminders::start(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running zume");
}
