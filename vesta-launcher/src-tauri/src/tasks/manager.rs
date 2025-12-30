use crate::notifications::manager::NotificationManager;
use crate::notifications::models::{CreateNotificationInput, NotificationAction, NotificationType};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use tokio::sync::{mpsc, watch, Semaphore};

pub struct TaskContext {
    pub app_handle: AppHandle,
    pub notification_id: String,
    pub cancel_rx: watch::Receiver<bool>,
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait Task: Send + Sync {
    fn name(&self) -> String;
    fn cancellable(&self) -> bool {
        false
    }
    /// Whether a progress task should leave a persistent completion notification on success.
    /// Default: false (auto-delete on success)
    fn show_completion_notification(&self) -> bool {
        false
    }
    /// Total logical steps (used for progress bar). If unknown, return 0.
    fn total_steps(&self) -> i32 {
        0
    }
    /// Description shown when the worker picks up the task.
    fn starting_description(&self) -> String {
        "Starting...".to_string()
    }
    /// Description shown on successful completion.
    fn completion_description(&self) -> String {
        "Completed successfully".to_string()
    }
    /// Execute task work.
    fn run(&self, ctx: TaskContext) -> BoxFuture<'static, Result<(), String>>;
}

pub struct TaskManager {
    sender: mpsc::Sender<Box<dyn Task>>,
    semaphore: Arc<Semaphore>,
    current_limit: Mutex<usize>,
    cancellation_tokens: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
}

impl TaskManager {
    pub fn new(app_handle: AppHandle) -> Self {
        let (sender, mut receiver) = mpsc::channel::<Box<dyn Task>>(100);
        let initial_limit = 2;
        let semaphore = Arc::new(Semaphore::new(initial_limit));
        let current_limit = Mutex::new(initial_limit);
        let cancellation_tokens = Arc::new(Mutex::new(HashMap::new()));

        let manager_semaphore = semaphore.clone();
        let manager_app = app_handle.clone();
        let manager_tokens = cancellation_tokens.clone();

        tauri::async_runtime::spawn(async move {
            static TASK_COUNTER: AtomicU64 = AtomicU64::new(0);
            log::info!("TaskManager: Worker loop started, ready to receive tasks");

            while let Some(task) = receiver.recv().await {
                log::info!("TaskManager: Received task: {}", task.name());
                // Generate ID and create "Waiting" notification immediately
                let id = TASK_COUNTER.fetch_add(1, Ordering::Relaxed);
                let client_key = format!("task_{}_{}", chrono::Utc::now().timestamp(), id);
                let task_name = task.name();
                let is_cancellable = task.cancellable();

                let manager = manager_app.state::<NotificationManager>();

                // Create actions array with cancel button if cancellable
                let actions = if is_cancellable {
                    Some(vec![NotificationAction {
                        action_id: "cancel_task".to_string(),
                        label: "Cancel".to_string(),
                        primary: false,
                    }])
                } else {
                    None
                };

                let _ = manager.create(CreateNotificationInput {
                    client_key: Some(client_key.clone()),
                    title: Some(task_name.clone()),
                    description: Some("Waiting for worker...".to_string()),
                    severity: Some("info".to_string()),
                    notification_type: Some(NotificationType::Progress),
                    dismissible: Some(false),
                    show_on_completion: Some(task.show_completion_notification()),
                    actions: actions.and_then(|a| serde_json::to_string(&a).ok()),
                    progress: Some(-1), // Indeterminate until picked up
                    current_step: Some(0),
                    total_steps: Some(task.total_steps()),
                    metadata: None,
                });

                // Create cancellation channel
                let (tx, rx) = watch::channel(false);
                if is_cancellable {
                    manager_tokens
                        .lock()
                        .unwrap()
                        .insert(client_key.clone(), tx);
                }

                // Acquire permit to respect concurrency limit
                // We need to check cancellation while waiting for permit too?
                // For now, let's just acquire. If cancelled while waiting, we can check immediately after.
                log::info!(
                    "TaskManager: Waiting for worker permit for task: {}",
                    task_name
                );
                let permit = match manager_semaphore.clone().acquire_owned().await {
                    Ok(p) => p,
                    Err(_) => break, // Semaphore closed
                };
                log::info!(
                    "TaskManager: Acquired worker permit for task: {}",
                    task_name
                );

                let app = manager_app.clone();
                let tokens = manager_tokens.clone();
                let key_clone = client_key.clone();

                tokio::spawn(async move {
                    // Check if cancelled while waiting
                    if *rx.borrow() {
                        let manager = app.state::<NotificationManager>();
                        let _ = manager.create(CreateNotificationInput {
                            client_key: Some(key_clone.clone()),
                            title: Some(task_name),
                            description: Some("Task cancelled.".to_string()),
                            severity: Some("warning".to_string()),
                            notification_type: Some(NotificationType::Patient),
                            dismissible: Some(true),
                            actions: None,
                            progress: None,
                            current_step: None,
                            total_steps: None,
                            metadata: None,
                            show_on_completion: None,
                        });
                        // Cleanup token
                        if is_cancellable {
                            tokens.lock().unwrap().remove(&key_clone);
                        }
                        drop(permit);
                        return;
                    }

                    let ctx = TaskContext {
                        app_handle: app.clone(),
                        notification_id: key_clone.clone(),
                        cancel_rx: rx,
                    };

                    log::info!("TaskManager: Executing task: {}", task_name);
                    // Update initial progress to 0 and starting description.
                    {
                        let manager = app.state::<NotificationManager>();
                        let _ = manager.update_progress_with_description(
                            key_clone.clone(),
                            0,
                            Some(0),
                            Some(task.total_steps()),
                            task.starting_description(),
                        );
                    }

                    let run_result = task.run(ctx).await;

                    let manager = app.state::<NotificationManager>();
                    match run_result {
                        Ok(_) => {
                            // Auto completion update to 100%
                            let _ = manager.update_progress_with_description(
                                key_clone.clone(),
                                100,
                                Some(task.total_steps()),
                                Some(task.total_steps()),
                                task.completion_description(),
                            );
                        }
                        Err(e) => {
                            eprintln!("Task execution failed: {}", e);
                            // Convert progress notification to Patient failure
                            let _ = manager.create(CreateNotificationInput {
                                client_key: Some(key_clone.clone()),
                                title: Some(task_name),
                                description: Some(format!("Failed: {}", e)),
                                severity: Some("error".to_string()),
                                notification_type: Some(NotificationType::Patient),
                                dismissible: Some(true),
                                actions: None,
                                progress: None,
                                current_step: None,
                                total_steps: None,
                                metadata: None,
                                show_on_completion: Some(true),
                            });
                        }
                    }

                    // Cleanup token
                    if is_cancellable {
                        tokens.lock().unwrap().remove(&key_clone);
                    }
                    // Permit is dropped here, allowing next task to run
                    drop(permit);
                });
            }
        });

        Self {
            sender,
            semaphore,
            current_limit,
            cancellation_tokens,
        }
    }

    pub async fn submit(&self, task: Box<dyn Task>) -> Result<(), String> {
        let task_name = task.name();
        log::info!(
            "[TaskManager::submit] Submitting task '{}' to channel",
            task_name
        );
        match self.sender.send(task).await {
            Ok(_) => {
                log::info!(
                    "[TaskManager::submit] Task '{}' successfully sent to worker queue",
                    task_name
                );
                Ok(())
            }
            Err(e) => {
                log::error!(
                    "[TaskManager::submit] Failed to send task '{}': {}",
                    task_name,
                    e
                );
                Err(e.to_string())
            }
        }
    }

    pub fn cancel_task(&self, client_key: &str) -> Result<(), String> {
        let tokens = self.cancellation_tokens.lock().unwrap();
        if let Some(tx) = tokens.get(client_key) {
            let _ = tx.send(true);
            Ok(())
        } else {
            Err("Task not found or not cancellable".to_string())
        }
    }

    pub fn set_worker_count(&self, limit: usize) {
        let mut current = self.current_limit.lock().unwrap();
        if limit > *current {
            // Increase capacity
            self.semaphore.add_permits(limit - *current);
        } else if limit < *current {
            // Decrease capacity by acquiring permits and forgetting them (leaking)
            let diff = *current - limit;
            let sem = self.semaphore.clone();
            tauri::async_runtime::spawn(async move {
                if let Ok(permits) = sem.acquire_many(diff as u32).await {
                    permits.forget();
                }
            });
        }
        *current = limit;
    }
}

#[allow(dead_code)]
pub struct TestTask {
    pub title: String,
    pub duration_secs: u64,
}

impl Task for TestTask {
    fn name(&self) -> String {
        self.title.clone()
    }

    fn cancellable(&self) -> bool {
        true
    }

    fn run(&self, mut ctx: TaskContext) -> BoxFuture<'static, Result<(), String>> {
        let title = self.title.clone();
        let duration = self.duration_secs;
        let client_key = ctx.notification_id.clone();
        let app = ctx.app_handle.clone();

        Box::pin(async move {
            let manager = app.state::<NotificationManager>();

            // Update notification to "Running"
            println!("Task started: {}, client_key: {}", title, client_key);
            manager
                .create(CreateNotificationInput {
                    client_key: Some(client_key.clone()),
                    title: Some(title.clone()),
                    description: Some("Task is running...".to_string()),
                    severity: Some("info".to_string()),
                    notification_type: Some(NotificationType::Progress),
                    dismissible: Some(false),
                    actions: None,
                    progress: Some(0),
                    current_step: Some(0),
                    total_steps: Some(100),
                    metadata: None,
                    show_on_completion: None,
                })
                .map_err(|e| e.to_string())?;

            // Simulate work with progress updates - update every second
            let steps = duration;
            for i in 1..=steps {
                // Check cancellation
                if *ctx.cancel_rx.borrow() {
                    println!("Task cancelled: {}", client_key);
                    manager
                        .create(CreateNotificationInput {
                            client_key: Some(client_key.clone()),
                            title: Some(format!("{} (Cancelled)", title)),
                            description: Some("Task was cancelled by user.".to_string()),
                            severity: Some("warning".to_string()),
                            notification_type: Some(NotificationType::Patient),
                            dismissible: Some(true),
                            actions: None,
                            progress: None,
                            current_step: None,
                            total_steps: None,
                            metadata: None,
                            show_on_completion: None,
                        })
                        .map_err(|e| e.to_string())?;
                    return Ok(());
                }

                tokio::select! {
                    _ = tokio::time::sleep(tokio::time::Duration::from_secs(1)) => {}
                    _ = ctx.cancel_rx.changed() => {
                        if *ctx.cancel_rx.borrow() {
                            println!("Task cancelled via signal: {}", client_key);
                            manager.create(CreateNotificationInput {
                                client_key: Some(client_key.clone()),
                                title: Some(format!("{} (Cancelled)", title)),
                                description: Some("Task was cancelled by user.".to_string()),
                                severity: Some("warning".to_string()),
                                notification_type: Some(NotificationType::Patient),
                                dismissible: Some(true),
                                actions: None,
                                progress: None,
                                current_step: None,
                                total_steps: None,
                                metadata: None,
                                show_on_completion: None,
                            }).map_err(|e| e.to_string())?;
                            return Ok(());
                        }
                    }
                }

                let progress = (i * 100) / steps;
                println!(
                    "Task updating progress: {}%, step {}/{}",
                    progress, i, steps
                );
                manager
                    .update_progress(
                        client_key.clone(),
                        progress as i32,
                        Some(i as i32),
                        Some(steps as i32),
                    )
                    .map_err(|e| e.to_string())?;
            }

            println!("Task finished: {}", client_key);
            // Final update to ensure 100% and maybe change description (auto-delete by default)
            manager
                .update_progress(
                    client_key.clone(),
                    100,
                    Some(steps as i32),
                    Some(steps as i32),
                )
                .map_err(|e| e.to_string())?;

            Ok(())
        })
    }
}
