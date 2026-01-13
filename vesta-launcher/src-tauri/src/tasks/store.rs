use crate::models::task_state::{NewTaskState, TaskState};
use crate::schema::task_state::dsl::*;
use crate::utils::db::get_vesta_conn;
use anyhow::Result;
use diesel::prelude::*;

#[allow(dead_code)]
pub struct TaskStore;

#[allow(dead_code)]
impl TaskStore {
    pub fn save_task(
        task_id: &str,
        task_type_name: &str,
        task_status: &str,
        step: i32,
        total: i32,
        task_data: String,
    ) -> Result<()> {
        let mut conn = get_vesta_conn()?;
        let now = chrono::Utc::now().to_rfc3339();

        let new_state = NewTaskState {
            id: task_id.to_string(),
            task_type: task_type_name.to_string(),
            status: task_status.to_string(),
            current_step: step,
            total_steps: total,
            data: task_data,
            created_at: now.clone(),
            updated_at: now,
        };

        diesel::insert_into(task_state)
            .values(&new_state)
            .on_conflict(id)
            .do_update()
            .set((
                status.eq(task_status),
                current_step.eq(step),
                total_steps.eq(total),
                data.eq(&new_state.data),
                updated_at.eq(&new_state.updated_at),
            ))
            .execute(&mut conn)?;

        Ok(())
    }

    pub fn get_task(task_id: &str) -> Result<Option<TaskState>> {
        let mut conn = get_vesta_conn()?;
        let result = task_state
            .filter(id.eq(task_id))
            .first::<TaskState>(&mut conn)
            .optional()?;
        Ok(result)
    }

    pub fn list_tasks_by_status(task_status: &str) -> Result<Vec<TaskState>> {
        let mut conn = get_vesta_conn()?;
        let results = task_state
            .filter(status.eq(task_status))
            .load::<TaskState>(&mut conn)?;
        Ok(results)
    }

    pub fn delete_task(task_id: &str) -> Result<()> {
        let mut conn = get_vesta_conn()?;
        diesel::delete(task_state.filter(id.eq(task_id))).execute(&mut conn)?;
        Ok(())
    }
}
