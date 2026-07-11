use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub start_time: String, // ISO 8601, e.g. 2026-07-11T09:00:00
    pub end_time: String,   // ISO 8601
    pub completed: bool,
    pub reminder_enabled: bool,
    pub reminder_minutes_before: i64,
    pub reminder_fired: bool,
    pub order_index: i64,
    pub created_at: String,
}

/// Input for bulk-creating a list of tasks that get equal time slots.
#[derive(Debug, Deserialize)]
pub struct BulkCreateInput {
    pub titles: Vec<String>,
    pub duration_minutes: i64, // default slot length per task, e.g. 120 for 2hrs
    pub start_time: String,    // ISO datetime for first task's start
}

#[derive(Debug, Deserialize)]
pub struct NewTaskInput {
    pub title: String,
    pub start_time: String,
    pub end_time: String,
    pub reminder_enabled: Option<bool>,
    pub reminder_minutes_before: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateTaskInput {
    pub id: i64,
    pub title: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub completed: Option<bool>,
    pub reminder_enabled: Option<bool>,
    pub reminder_minutes_before: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ReorderInput {
    pub id: i64,
    pub new_start_time: String,
    pub new_end_time: String,
}
