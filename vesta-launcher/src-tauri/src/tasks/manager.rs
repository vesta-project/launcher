use crate::notifications::manager::NotificationManager;
use crate::notifications::models::{
    CreateNotificationInput, NotificationAction, NotificationType, PROGRESS_INDETERMINATE,
};
use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, watch, Semaphore};

#[derive(Clone)]
pub struct TaskContext {
    pub app_handle: AppHandle,
    pub notification_id: String,
    pub cancel_rx: watch::Receiver<bool>,
    pub pause_rx: watch::Receiver<bool>,
}

impl TaskContext {
    pub fn update_description(&self, description: String) {
        let manager = self.app_handle.state::<NotificationManager>();
        let _ = manager.update_progress_with_description(
            self.notification_id.clone(),
            0, // We keep it at indeterminate if we don't know the exact progress
            None,
            None,
            description,
        );
    }
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

pub trait Task: Send + Sync {
    fn name(&self) -> String;
    fn id(&self) -> Option<String> {
        None
    }
    fn cancellable(&self) -> bool {
        false
    }
    fn pausable(&self) -> bool {
        false
    }
    #[allow(dead_code)]
    fn serialize(&self) -> Option<String> {
        None
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
    app_handle: AppHandle,
    sender: mpsc::Sender<Box<dyn Task>>,
    semaphore: Arc<Semaphore>,
    current_limit: Mutex<usize>,
    cancellation_tokens: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
    pause_tokens: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
    active_tasks: Arc<Mutex<HashMap<String, String>>>,
}

impl TaskManager {
    pub fn new(app_handle: AppHandle) -> Self {
        let (sender, mut receiver) = mpsc::channel::<Box<dyn Task>>(100);
        let initial_limit = 2;
        let semaphore = Arc::new(Semaphore::new(initial_limit));
        let current_limit = Mutex::new(initial_limit);
        let cancellation_tokens = Arc::new(Mutex::new(HashMap::new()));
        let pause_tokens = Arc::new(Mutex::new(HashMap::new()));
        let active_tasks = Arc::new(Mutex::new(HashMap::new()));

        let manager_semaphore = semaphore.clone();
        let manager_app = app_handle.clone();
        let manager_tokens = cancellation_tokens.clone();
        let manager_pause_tokens = pause_tokens.clone();
        let manager_active_tasks = active_tasks.clone();

        tauri::async_runtime::spawn(async move {
            static TASK_COUNTER: AtomicU64 = AtomicU64::new(0);
            log::info!("TaskManager: Worker loop started, ready to receive tasks");

            while let Some(task) = receiver.recv().await {
                log::info!("TaskManager: Received task: {}", task.name());

                let task_name = task.name();
                let is_cancellable = task.cancellable();
                let is_pausable = task.pausable();

                // Generate ID and create "Waiting" notification immediately
                let id = TASK_COUNTER.fetch_add(1, Ordering::Relaxed);
                let client_key = task
                    .id()
                    .unwrap_or_else(|| format!("task_{}_{}", chrono::Utc::now().timestamp(), id));

                // Check if task is already running (deduplication)
                {
                    let active = manager_active_tasks.lock().unwrap();
                    if active.contains_key(&client_key) {
                        log::info!(
                            "TaskManager: Task with ID {} already active, ignoring submission",
                            client_key
                        );
                        continue;
                    }
                }

                // Track active task
                manager_active_tasks
                    .lock()
                    .unwrap()
                    .insert(client_key.clone(), task_name.clone());

                let manager = manager_app.state::<NotificationManager>();

                // Create actions array
                let mut actions = Vec::new();
                if is_cancellable {
                    actions.push(NotificationAction {
                        action_id: "cancel_task".to_string(),
                        label: "Cancel".to_string(),
                        action_type: "secondary".to_string(),
                    });
                }
                if is_pausable {
                    actions.push(NotificationAction {
                        action_id: "pause_task".to_string(),
                        label: "Pause".to_string(),
                        action_type: "secondary".to_string(),
                    });
                }

                let actions_json = if actions.is_empty() {
                    None
                } else {
                    serde_json::to_string(&actions).ok()
                };

                let _ = manager.create(CreateNotificationInput {
                    client_key: Some(client_key.clone()),
                    title: Some(task_name.clone()),
                    description: Some("Waiting for worker...".to_string()),
                    severity: Some("info".to_string()),
                    notification_type: Some(NotificationType::Progress),
                    dismissible: Some(false),
                    show_on_completion: Some(task.show_completion_notification()),
                    actions: actions_json,
                    progress: Some(PROGRESS_INDETERMINATE), // Indeterminate until picked up
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

                // Create pause channel
                let (pause_tx, pause_rx) = watch::channel(false);
                if is_pausable {
                    manager_pause_tokens
                        .lock()
                        .unwrap()
                        .insert(client_key.clone(), pause_tx);
                }

                // Acquire permit to respect concurrency limit
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
                let p_tokens = manager_pause_tokens.clone();
                let active_tasks = manager_active_tasks.clone();
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

                        // Notify frontend about failure if it's a resource download
                        if let Some(task_id) = task.id() {
                            if task_id.starts_with("download_") {
                                let _ = app.emit("resource-install-error", task_id);
                            }
                        }

                        // Cleanup tokens
                        if is_cancellable {
                            tokens.lock().unwrap().remove(&key_clone);
                        }
                        if is_pausable {
                            p_tokens.lock().unwrap().remove(&key_clone);
                        }
                        active_tasks.lock().unwrap().remove(&key_clone);
                        drop(permit);
                        return;
                    }

                    let ctx = TaskContext {
                        app_handle: app.clone(),
                        notification_id: key_clone.clone(),
                        cancel_rx: rx,
                        pause_rx,
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

                    // Cleanup tokens after run
                    if is_cancellable {
                        tokens.lock().unwrap().remove(&key_clone);
                    }
                    if is_pausable {
                        p_tokens.lock().unwrap().remove(&key_clone);
                    }
                    active_tasks.lock().unwrap().remove(&key_clone);

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

                            // Notify frontend about failure if it follows the resource download pattern
                            if let Some(task_id) = task.id() {
                                if task_id.starts_with("download_") {
                                    let _ = app.emit("resource-install-error", task_id);
                                }
                            }

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

                    // Cleanup tokens
                    if is_cancellable {
                        tokens.lock().unwrap().remove(&key_clone);
                    }
                    if is_pausable {
                        p_tokens.lock().unwrap().remove(&key_clone);
                    }

                    // TODO: The type cast 'as unknown as number' suggests a TypeScript/JavaScript pattern in Rust code. This appears to be in a setTimeout context, but the cast is unnecessary and potentially indicates confusion between JavaScript and Rust. The result of setTimeout in a browser context would be a timeout ID, but this is Rust backend code.
                    // Permit is dropped here, allowing next task to run
                    drop(permit);
                });
            }
        });

        Self {
            app_handle,
            sender,
            semaphore,
            current_limit,
            cancellation_tokens,
            pause_tokens,
            active_tasks,
        }
    }

    pub fn get_active_tasks(&self) -> Vec<String> {
        self.active_tasks
            .lock()
            .unwrap()
            .values()
            .cloned()
            .collect()
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

    /// Cancel all active tasks associated with a specific instance (e.g. before deletion)
    pub fn cancel_instance_tasks(&self, instance_id: i32) {
        let tokens = self.cancellation_tokens.lock().unwrap();
        let install_prefix = format!("install_instance_{}", instance_id);
        let download_prefix = format!("download_{}_", instance_id);

        for (key, tx) in tokens.iter() {
            if key.starts_with(&install_prefix) || key.starts_with(&download_prefix) {
                let _ = tx.send(true);
                log::info!(
                    "TaskManager: Sent automatic cancel signal to associated task: {}",
                    key
                );
            }
        }
    }

    pub fn pause_task(&self, client_key: &str) -> Result<(), String> {
        let tokens = self.pause_tokens.lock().unwrap();
        if let Some(tx) = tokens.get(client_key) {
            let _ = tx.send(true);

            // Update notification actions to show Resume
            let is_cancellable = self
                .cancellation_tokens
                .lock()
                .unwrap()
                .contains_key(client_key);
            let mut actions = Vec::new();
            if is_cancellable {
                actions.push(NotificationAction {
                    action_id: "cancel_task".to_string(),
                    label: "Cancel".to_string(),
                    action_type: "secondary".to_string(),
                });
            }
            actions.push(NotificationAction {
                action_id: "resume_task".to_string(),
                label: "Resume".to_string(),
                action_type: "primary".to_string(),
            });

            let manager = self.app_handle.state::<NotificationManager>();
            let _ = manager.update_notification_actions(client_key.to_string(), actions);
            let _ = manager.upsert_description(client_key, "Paused");

            Ok(())
        } else {
            Err("Task not found or not pausable".to_string())
        }
    }

    pub fn resume_task(&self, client_key: &str) -> Result<(), String> {
        let tokens = self.pause_tokens.lock().unwrap();
        if let Some(tx) = tokens.get(client_key) {
            let _ = tx.send(false);

            // Update notification actions to show Pause
            let is_cancellable = self
                .cancellation_tokens
                .lock()
                .unwrap()
                .contains_key(client_key);
            let mut actions = Vec::new();
            if is_cancellable {
                actions.push(NotificationAction {
                    action_id: "cancel_task".to_string(),
                    label: "Cancel".to_string(),
                    action_type: "secondary".to_string(),
                });
            }
            actions.push(NotificationAction {
                action_id: "pause_task".to_string(),
                label: "Pause".to_string(),
                action_type: "secondary".to_string(),
            });

            let manager = self.app_handle.state::<NotificationManager>();
            let _ = manager.update_notification_actions(client_key.to_string(), actions);
            let _ = manager.upsert_description(client_key, "Resuming...");

            Ok(())
        } else {
            Err("Task not found or not pausable".to_string())
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

    fn pausable(&self) -> bool {
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
                    actions: Some(
                        serde_json::to_string(&vec![
                            NotificationAction {
                                action_id: "cancel_task".to_string(),
                                label: "Cancel".to_string(),
                                action_type: "secondary".to_string(),
                            },
                            NotificationAction {
                                action_id: "pause_task".to_string(),
                                label: "Pause".to_string(),
                                action_type: "secondary".to_string(),
                            },
                        ])
                        .unwrap(),
                    ),
                    progress: Some(0),
                    current_step: Some(0),
                    total_steps: Some(100),
                    metadata: None,
                    show_on_completion: None,
                })
                .map_err(|e| e.to_string())?;

            // Simulate work with progress updates - update every second
            let steps = duration;
            let mut i = 1;
            while i <= steps {
                // Check cancellation
                if *ctx.cancel_rx.borrow() {
                    println!("Task cancelled: {}", client_key);
                    return Ok(());
                }

                // Check pause
                if *ctx.pause_rx.borrow() {
                    println!("Task paused: {}", client_key);
                    // Update notification to show Resume button
                    manager
                        .update_notification_actions(
                            client_key.clone(),
                            vec![
                                NotificationAction {
                                    action_id: "cancel_task".to_string(),
                                    label: "Cancel".to_string(),
                                    action_type: "secondary".to_string(),
                                },
                                NotificationAction {
                                    action_id: "resume_task".to_string(),
                                    label: "Resume".to_string(),
                                    action_type: "primary".to_string(),
                                },
                            ],
                        )
                        .map_err(|e| e.to_string())?;

                    manager
                        .update_progress_with_description(
                            client_key.clone(),
                            ((i * 100) / steps) as i32,
                            Some(i as i32),
                            Some(steps as i32),
                            "Paused".to_string(),
                        )
                        .map_err(|e| e.to_string())?;

                    // Wait for resume or cancel
                    loop {
                        tokio::select! {
                            _ = ctx.pause_rx.changed() => {
                                if !*ctx.pause_rx.borrow() {
                                    println!("Task resumed: {}", client_key);
                                    // Update notification back to Pause button
                                    manager.update_notification_actions(
                                        client_key.clone(),
                                        vec![
                                            NotificationAction {
                                                action_id: "cancel_task".to_string(),
                                                label: "Cancel".to_string(),
                                                action_type: "secondary".to_string(),
                                            },
                                            NotificationAction {
                                                action_id: "pause_task".to_string(),
                                                label: "Pause".to_string(),
                                                action_type: "secondary".to_string(),
                                            },
                                        ]
                                    ).map_err(|e| e.to_string())?;

                                    manager.update_progress_with_description(
                                        client_key.clone(),
                                        ((i * 100) / steps) as i32,
                                        Some(i as i32),
                                        Some(steps as i32),
                                        "Resuming...".to_string()
                                    ).map_err(|e| e.to_string())?;
                                    break;
                                }
                            }
                            _ = ctx.cancel_rx.changed() => {
                                if *ctx.cancel_rx.borrow() {
                                    return Ok(());
                                }
                            }
                        }
                    }
                }

                tokio::select! {
                    _ = tokio::time::sleep(tokio::time::Duration::from_secs(1)) => {}
                    _ = ctx.cancel_rx.changed() => {
                        if *ctx.cancel_rx.borrow() {
                            return Ok(());
                        }
                    }
                    _ = ctx.pause_rx.changed() => {
                        // Will be handled at start of next loop iteration
                        continue;
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
                i += 1;
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
