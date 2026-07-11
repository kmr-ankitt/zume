use crate::db;
use crate::models::{BulkCreateInput, NewTaskInput, Task, UpdateTaskInput};
use crate::DbState;
use tauri::State;

#[tauri::command]
pub fn get_tasks(state: State<DbState>) -> Result<Vec<Task>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::get_all_tasks(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_task(state: State<DbState>, input: NewTaskInput) -> Result<Task, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::create_task(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn bulk_create_tasks(state: State<DbState>, input: BulkCreateInput) -> Result<Vec<Task>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::bulk_create_tasks(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_task(state: State<DbState>, input: UpdateTaskInput) -> Result<Task, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::update_task(&conn, &input).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_task(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::delete_task(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_all_tasks(state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    db::delete_all_tasks(&conn).map_err(|e| e.to_string())
}
