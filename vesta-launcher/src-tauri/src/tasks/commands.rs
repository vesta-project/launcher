use tauri::State;
use crate::tasks::manager::{TaskManager, TestTask};

#[tauri::command]
pub async fn submit_test_task(
    state: State<'_, TaskManager>,
    title: String,
    duration_secs: u64,
) -> Result<(), String> {
    let task = TestTask { title, duration_secs };
    state.submit(Box::new(task)).await
}

#[tauri::command]
pub async fn set_worker_limit(
    state: State<'_, TaskManager>,
    limit: usize,
) -> Result<(), String> {
    state.set_worker_count(limit);
    Ok(())
}

#[tauri::command]
pub async fn cancel_task(
    state: State<'_, TaskManager>,
    client_key: String,
) -> Result<(), String> {
    state.cancel_task(&client_key)
}
