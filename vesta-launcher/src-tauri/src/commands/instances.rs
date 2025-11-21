use tauri::State;
use crate::tasks::manager::TaskManager;
use crate::tasks::installers::InstallInstanceTask;
use crate::models::instance::Instance;

#[tauri::command]
pub async fn install_instance(
    task_manager: State<'_, TaskManager>,
    instance: Instance,
) -> Result<(), String> {
    log::info!("Queueing installation for instance: {}", instance.name);
    
    let task = InstallInstanceTask::new(instance);
    task_manager.submit(Box::new(task)).await?;
    
    Ok(())
}
