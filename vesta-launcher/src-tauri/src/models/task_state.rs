use crate::schema::task_state;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(
    Queryable, Selectable, Insertable, AsChangeset, Serialize, Deserialize, Debug, Clone, PartialEq,
)]
#[diesel(table_name = task_state)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct TaskState {
    pub id: String,
    pub task_type: String,
    pub status: String,
    pub current_step: i32,
    pub total_steps: i32,
    pub data: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Insertable, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = task_state)]
pub struct NewTaskState {
    pub id: String,
    pub task_type: String,
    pub status: String,
    pub current_step: i32,
    pub total_steps: i32,
    pub data: String,
    pub created_at: String,
    pub updated_at: String,
}
