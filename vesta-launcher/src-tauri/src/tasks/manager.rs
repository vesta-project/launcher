use crate::notifications::manager::NotificationManager;
use crate::notifications::models::{
    CreateNotificationInput, NotificationAction, NotificationSeverity, NotificationType,
    ProgressUpdate, PROGRESS_INDETERMINATE,
};
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, watch, Notify, Semaphore};
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;

#[derive(Clone)]
pub struct TaskContext {
    pub app_handle: AppHandle,
    pub notification_id: String,
    pub notifications_enabled: bool,
    pub cancel_rx: watch::Receiver<bool>,
    pub pause_rx: watch::Receiver<bool>,
    pub progress_channel: Option<Channel<ProgressUpdate>>,
}

impl TaskContext {
    pub fn update_description(&self, description: String) {
        // 1. Update the channel if available
        if let Some(ref channel) = self.progress_channel {
            let _ = channel.send(ProgressUpdate::Progress {
                percent: PROGRESS_INDETERMINATE,
                description: Some(description.clone()),
                severity: None,
            });
        }

        if !self.notifications_enabled {
            return;
        }

        // 2. Fallback to classic NotificationManager
        // Keep current progress and step counters intact while updating text.
        let manager = self.app_handle.state::<NotificationManager>();
        let _ = manager.upsert_description(&self.notification_id, &description);
    }

    pub fn update_progress(
        &self,
        progress: i32,
        current_step: Option<i32>,
        total_steps: Option<i32>,
    ) {
        // 1. Update the channel if available
        if let Some(ref channel) = self.progress_channel {
            let _ = channel.send(ProgressUpdate::Progress {
                percent: progress,
                description: None,
                severity: None,
            });
            if let Some(current) = current_step {
                let _ = channel.send(ProgressUpdate::StepCount {
                    current: current as u32,
                    total: total_steps.map(|t| t as u32),
                });
            }
        }

        if !self.notifications_enabled {
            return;
        }

        // 2. Fallback to classic NotificationManager
        let manager = self.app_handle.state::<NotificationManager>();
        let _ = manager.update_progress_full(
            self.notification_id.clone(),
            progress,
            current_step,
            total_steps,
            String::new(),
            None,
            None,
        );
    }

    pub fn set_title(&self, title: String) {
        if !self.notifications_enabled {
            return;
        }
        let manager = self.app_handle.state::<NotificationManager>();
        let _ = manager.update_progress_full(
            self.notification_id.clone(),
            0,
            None,
            None,
            String::new(),
            None,
            Some(title),
        );
    }

    pub fn update_full(
        &self,
        progress: i32,
        description: String,
        current_step: Option<i32>,
        total_steps: Option<i32>,
    ) {
        // 1. Update the channel if available
        if let Some(ref channel) = self.progress_channel {
            let _ = channel.send(ProgressUpdate::Progress {
                percent: progress,
                description: Some(description.clone()),
                severity: None,
            });
            if let Some(current) = current_step {
                let _ = channel.send(ProgressUpdate::StepCount {
                    current: current as u32,
                    total: total_steps.map(|t| t as u32),
                });
            }
        }

        if !self.notifications_enabled {
            return;
        }

        // 2. Fallback to classic NotificationManager
        let manager = self.app_handle.state::<NotificationManager>();
        let _ = manager.update_progress_full(
            self.notification_id.clone(),
            progress,
            current_step,
            total_steps,
            description,
            None,
            None,
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
    /// Filesystem or database resources that must not be mutated concurrently.
    /// Keys are normalized, sorted, and deduplicated by Task Manager before use.
    fn conflict_keys(&self) -> Vec<String> {
        Vec::new()
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
    /// Whether Task Manager should create a progress/failure notification for this task.
    /// Silent tasks still participate in deduplication and can report over an IPC channel.
    fn show_notification(&self) -> bool {
        true
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

pub struct QueuedTask {
    pub task: Box<dyn Task>,
    pub progress_channel: Option<Channel<ProgressUpdate>>,
}

pub fn world_conflict_key(instance_id: i32, directory_name: &str) -> String {
    let directory_name: String = directory_name.nfc().case_fold().collect();
    format!("world:{instance_id}:{directory_name}")
}

pub fn saves_conflict_key(instance_id: i32) -> String {
    format!("saves:{instance_id}")
}

pub fn resourcepacks_conflict_key(instance_id: i32) -> String {
    format!("resourcepacks:{instance_id}")
}

fn normalize_conflict_keys<I, S>(keys: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: Into<String>,
{
    let mut keys = keys
        .into_iter()
        .map(Into::into)
        .filter(|key| !key.trim().is_empty())
        .collect::<Vec<_>>();
    keys.sort_unstable();
    keys.dedup();
    keys
}

/// Coordinates mutations that share a logical filesystem or ledger resource.
/// A complete key set is reserved atomically, avoiding deadlocks and preventing
/// a waiting multi-resource task from holding unrelated keys.
#[derive(Clone, Default)]
pub struct TaskConflictCoordinator {
    state: Arc<TaskConflictState>,
}

pub struct TaskConflictGuard {
    state: Arc<TaskConflictState>,
    keys: Vec<String>,
}

#[derive(Default)]
struct TaskConflictState {
    active: Mutex<HashSet<String>>,
    changed: Notify,
}

impl Drop for TaskConflictGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = self.state.active.lock() {
            for key in &self.keys {
                active.remove(key);
            }
        }
        self.state.changed.notify_waiters();
    }
}

impl TaskConflictCoordinator {
    pub async fn acquire<I, S>(&self, keys: I) -> TaskConflictGuard
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        let keys = normalize_conflict_keys(keys);
        loop {
            let changed = self.state.changed.notified();
            {
                let mut active = self.state.active.lock().unwrap();
                if keys.iter().all(|key| !active.contains(key)) {
                    active.extend(keys.iter().cloned());
                    return TaskConflictGuard {
                        state: self.state.clone(),
                        keys,
                    };
                }
            }
            changed.await;
        }
    }
}

pub struct TaskManager {
    app_handle: AppHandle,
    sender: mpsc::Sender<QueuedTask>,
    semaphore: Arc<Semaphore>,
    current_limit: Mutex<usize>,
    cancellation_tokens: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
    pause_tokens: Arc<Mutex<HashMap<String, watch::Sender<bool>>>>,
    active_tasks: Arc<Mutex<HashMap<String, String>>>,
    conflicts: TaskConflictCoordinator,
}

impl TaskManager {
    pub fn new(app_handle: AppHandle) -> Self {
        let (sender, mut receiver) = mpsc::channel::<QueuedTask>(100);
        let initial_limit = 2;
        let semaphore = Arc::new(Semaphore::new(initial_limit));
        let current_limit = Mutex::new(initial_limit);
        let cancellation_tokens = Arc::new(Mutex::new(HashMap::new()));
        let pause_tokens = Arc::new(Mutex::new(HashMap::new()));
        let active_tasks = Arc::new(Mutex::new(HashMap::new()));
        let conflicts = TaskConflictCoordinator::default();

        let manager_semaphore = semaphore.clone();
        let manager_app = app_handle.clone();
        let manager_tokens = cancellation_tokens.clone();
        let manager_pause_tokens = pause_tokens.clone();
        let manager_active_tasks = active_tasks.clone();
        let manager_conflicts = conflicts.clone();

        tauri::async_runtime::spawn(async move {
            static TASK_COUNTER: AtomicU64 = AtomicU64::new(0);
            log::info!("TaskManager: Worker loop started, ready to receive tasks");

            while let Some(queued_task) = receiver.recv().await {
                let task = queued_task.task;
                let progress_channel = queued_task.progress_channel;
                log::info!("TaskManager: Received task: {}", task.name());

                let task_name = task.name();
                let is_cancellable = task.cancellable();
                let is_pausable = task.pausable();
                let notifications_enabled = task.show_notification();

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
                        payload: None,
                    });
                }
                if is_pausable {
                    actions.push(NotificationAction {
                        action_id: "pause_task".to_string(),
                        label: "Pause".to_string(),
                        action_type: "secondary".to_string(),
                        payload: None,
                    });
                }

                let actions_json = if actions.is_empty() {
                    None
                } else {
                    serde_json::to_string(&actions).ok()
                };

                let task_total_steps = task.total_steps();
                let initial_current_step = if task_total_steps > 0 { Some(0) } else { None };
                let initial_total_steps = if task_total_steps > 0 {
                    Some(task_total_steps)
                } else {
                    None
                };

                if notifications_enabled {
                    if let Err(e) = manager
                        .create(CreateNotificationInput {
                            client_key: Some(client_key.clone()),
                            title: Some(task_name.clone()),
                            description: Some("Waiting for worker...".to_string()),
                            severity: Some("info".to_string()),
                            notification_type: Some(NotificationType::Progress),
                            dismissible: Some(false),
                            persist: Some(true),
                            silent: Some(false),
                            actions: actions_json,
                            progress: Some(PROGRESS_INDETERMINATE), // Indeterminate until picked up
                            current_step: initial_current_step,
                            total_steps: initial_total_steps,
                            metadata: None,
                            show_on_completion: Some(task.show_completion_notification()),
                        })
                        .map_err(|e| e.to_string())
                    {
                        log::error!(
                            "Failed to create task-start notification for {}: {}",
                            client_key,
                            e
                        );
                    }
                }

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

                let app = manager_app.clone();
                let tokens = manager_tokens.clone();
                let p_tokens = manager_pause_tokens.clone();
                let active_tasks = manager_active_tasks.clone();
                let conflicts = manager_conflicts.clone();
                let worker_semaphore = manager_semaphore.clone();
                let key_clone = client_key.clone();
                let conflict_keys = task.conflict_keys();

                tokio::spawn(async move {
                    log::info!(
                        "TaskManager: Waiting for resource locks for task: {}",
                        task_name
                    );
                    let _conflict_guard = conflicts.acquire(conflict_keys).await;

                    // Resource locks are acquired before a worker permit so tasks waiting on
                    // another mutation do not consume the global concurrency allowance.
                    log::info!(
                        "TaskManager: Waiting for worker permit for task: {}",
                        task_name
                    );
                    let permit = match worker_semaphore.acquire_owned().await {
                        Ok(permit) => permit,
                        Err(_) => {
                            if is_cancellable {
                                tokens.lock().unwrap().remove(&key_clone);
                            }
                            if is_pausable {
                                p_tokens.lock().unwrap().remove(&key_clone);
                            }
                            active_tasks.lock().unwrap().remove(&key_clone);
                            return;
                        }
                    };
                    log::info!(
                        "TaskManager: Acquired worker permit for task: {}",
                        task_name
                    );

                    // Check if cancelled while waiting
                    if *rx.borrow() {
                        if notifications_enabled {
                            let manager = app.state::<NotificationManager>();
                            if let Err(e) = manager.create(CreateNotificationInput {
                                client_key: Some(key_clone.clone()),
                                title: Some(task_name),
                                description: Some("Task cancelled.".to_string()),
                                severity: Some("warning".to_string()),
                                notification_type: Some(NotificationType::Patient),
                                dismissible: Some(true),
                                persist: Some(true),
                                silent: Some(false),
                                actions: None,
                                progress: None,
                                current_step: None,
                                total_steps: None,
                                metadata: None,
                                show_on_completion: None,
                            }) {
                                log::error!(
                                    "Failed to create task-cancel notification for {}: {}",
                                    key_clone,
                                    e
                                );
                            }
                        }

                        // Notify frontend about failure if it's a resource download
                        if let Some(task_id) = task.id() {
                            if task_id.starts_with("download_") || task_id.starts_with("download|")
                            {
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
                        notifications_enabled,
                        cancel_rx: rx,
                        pause_rx,
                        progress_channel,
                    };

                    log::info!("TaskManager: Executing task: {}", task_name);
                    // Update initial progress to 0 and starting description.
                    if notifications_enabled {
                        let manager = app.state::<NotificationManager>();
                        let _ = manager.update_progress_with_description(
                            key_clone.clone(),
                            0,
                            initial_current_step,
                            initial_total_steps,
                            task.starting_description(),
                        );
                    }

                    let run_result = task.run(ctx.clone()).await;

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
                            // 1. Update the channel if available
                            if let Some(ref channel) = ctx.progress_channel {
                                let _ = channel.send(ProgressUpdate::Finished {
                                    success: true,
                                    message: Some(task.completion_description()),
                                });
                            }

                            // 2. Auto completion update back to classic NotificationManager
                            let final_step = if task_total_steps > 0 {
                                Some(task_total_steps)
                            } else {
                                None
                            };

                            if notifications_enabled {
                                let _ = manager.update_progress_with_description_and_severity(
                                    key_clone.clone(),
                                    100,
                                    final_step,
                                    final_step,
                                    task.completion_description(),
                                    Some(NotificationSeverity::Success),
                                );
                            }
                        }
                        Err(e) => {
                            log::error!("Task execution failed: {}", e);

                            // 1. Update the channel if available
                            if let Some(ref channel) = ctx.progress_channel {
                                let _ = channel.send(ProgressUpdate::Finished {
                                    success: false,
                                    message: Some(e.to_string()),
                                });
                            }

                            // Notify frontend about failure if it follows the resource download pattern
                            if let Some(task_id) = task.id() {
                                if task_id.starts_with("download_")
                                    || task_id.starts_with("download|")
                                {
                                    let _ = app.emit("resource-install-error", task_id);
                                }
                            }

                            // Convert progress notification to Patient failure
                            if notifications_enabled {
                                if let Err(err) = manager.create(CreateNotificationInput {
                                    client_key: Some(key_clone.clone()),
                                    title: Some(task_name),
                                    description: Some(format!("Failed: {}", e)),
                                    severity: Some("error".to_string()),
                                    notification_type: Some(NotificationType::Patient),
                                    dismissible: Some(true),
                                    persist: Some(true),
                                    silent: Some(false),
                                    actions: None,
                                    progress: None,
                                    current_step: None,
                                    total_steps: None,
                                    metadata: None,
                                    show_on_completion: Some(true),
                                }) {
                                    log::error!(
                                        "Failed to create task-failure notification for {}: {}",
                                        key_clone,
                                        err
                                    );
                                }
                            }
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
            conflicts,
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

    /// Acquires the same conflict locks used by queued tasks. Command adapters
    /// can hold the returned guard while performing a short direct mutation.
    pub async fn acquire_conflicts<I, S>(&self, keys: I) -> TaskConflictGuard
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.conflicts.acquire(keys).await
    }

    pub async fn submit(&self, task: Box<dyn Task>) -> Result<(), String> {
        self.submit_with_channel(task, None).await
    }

    pub async fn submit_with_channel(
        &self,
        task: Box<dyn Task>,
        progress_channel: Option<Channel<ProgressUpdate>>,
    ) -> Result<(), String> {
        let task_name = task.name();
        log::info!(
            "[TaskManager::submit] Submitting task '{}' to channel",
            task_name
        );
        match self
            .sender
            .send(QueuedTask {
                task,
                progress_channel,
            })
            .await
        {
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
        let download_instance_prefix = format!("download|instance-{}|", instance_id);
        let download_world_prefix = format!("download|world-{}-", instance_id);
        // Legacy underscore task ids (pre-separator change).
        let legacy_download_prefix = format!("download_instance-{}_", instance_id);
        let legacy_world_prefix = format!("download_world-{}-", instance_id);

        for (key, tx) in tokens.iter() {
            if key.starts_with(&install_prefix)
                || key.starts_with(&download_instance_prefix)
                || key.starts_with(&download_world_prefix)
                || key.starts_with(&legacy_download_prefix)
                || key.starts_with(&legacy_world_prefix)
            {
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
                    payload: None,
                });
            }
            actions.push(NotificationAction {
                action_id: "resume_task".to_string(),
                label: "Resume".to_string(),
                action_type: "primary".to_string(),
                payload: None,
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
                    payload: None,
                });
            }
            actions.push(NotificationAction {
                action_id: "pause_task".to_string(),
                label: "Pause".to_string(),
                action_type: "secondary".to_string(),
                payload: None,
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
            log::info!("Task started: {}, client_key: {}", title, client_key);
            manager
                .create(CreateNotificationInput {
                    client_key: Some(client_key.clone()),
                    title: Some(title.clone()),
                    description: Some("Task is running...".to_string()),
                    severity: Some("info".to_string()),
                    notification_type: Some(NotificationType::Progress),
                    dismissible: Some(false),
                    persist: Some(true),
                    silent: Some(false),
                    actions: Some(
                        serde_json::to_string(&vec![
                            NotificationAction {
                                action_id: "cancel_task".to_string(),
                                label: "Cancel".to_string(),
                                action_type: "secondary".to_string(),
                                payload: None,
                            },
                            NotificationAction {
                                action_id: "pause_task".to_string(),
                                label: "Pause".to_string(),
                                action_type: "secondary".to_string(),
                                payload: None,
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
                    log::info!("Task cancelled: {}", client_key);
                    return Ok(());
                }

                // Check pause
                if *ctx.pause_rx.borrow() {
                    log::info!("Task paused: {}", client_key);
                    // Update notification to show Resume button
                    manager
                        .update_notification_actions(
                            client_key.clone(),
                            vec![
                                NotificationAction {
                                    action_id: "cancel_task".to_string(),
                                    label: "Cancel".to_string(),
                                    action_type: "secondary".to_string(),
                                    payload: None,
                                },
                                NotificationAction {
                                    action_id: "resume_task".to_string(),
                                    label: "Resume".to_string(),
                                    action_type: "primary".to_string(),
                                    payload: None,
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
                                    log::info!("Task resumed: {}", client_key);
                                    // Update notification back to Pause button
                                    manager.update_notification_actions(
                                        client_key.clone(),
                                        vec![
                                            NotificationAction {
                                                action_id: "cancel_task".to_string(),
                                                label: "Cancel".to_string(),
                                                action_type: "secondary".to_string(),
                                                payload: None,
                                            },
                                            NotificationAction {
                                                action_id: "pause_task".to_string(),
                                                label: "Pause".to_string(),
                                                action_type: "secondary".to_string(),
                                                payload: None,
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
                log::debug!(
                    "Task updating progress: {}%, step {}/{}",
                    progress,
                    i,
                    steps
                );
                manager
                    .update_progress(
                        client_key.clone(),
                        progress as i32,
                        Some(i as i32),
                        Some(steps as i32),
                        None,
                    )
                    .map_err(|e| e.to_string())?;
                i += 1;
            }

            log::info!("Task finished: {}", client_key);
            // Final update to ensure 100% and maybe change description (auto-delete by default)
            manager
                .update_progress(
                    client_key.clone(),
                    100,
                    Some(steps as i32),
                    Some(steps as i32),
                    None,
                )
                .map_err(|e| e.to_string())?;

            Ok(())
        })
    }
}

#[cfg(test)]
mod conflict_tests {
    use super::{normalize_conflict_keys, TaskConflictCoordinator};
    use std::time::Duration;

    #[test]
    fn conflict_keys_are_sorted_deduplicated_and_empty_keys_are_ignored() {
        assert_eq!(
            normalize_conflict_keys(["world:2:b", "", "world:1:a", "world:2:b"]),
            vec!["world:1:a", "world:2:b"]
        );
    }

    #[test]
    fn world_keys_normalize_case_and_unicode_equivalents() {
        assert_eq!(
            super::world_conflict_key(1, "Straße"),
            super::world_conflict_key(1, "STRASSE")
        );
        assert_eq!(
            super::world_conflict_key(1, "Café"),
            super::world_conflict_key(1, "Café")
        );
    }

    #[tokio::test]
    async fn tasks_sharing_a_conflict_key_are_serialized() {
        let coordinator = TaskConflictCoordinator::default();
        let first = coordinator.acquire(["world:1:test"]).await;
        let waiting_coordinator = coordinator.clone();
        let (acquired_tx, mut acquired_rx) = tokio::sync::oneshot::channel();

        let waiter = tokio::spawn(async move {
            let _guard = waiting_coordinator.acquire(["world:1:test"]).await;
            let _ = acquired_tx.send(());
        });

        assert!(
            tokio::time::timeout(Duration::from_millis(25), &mut acquired_rx)
                .await
                .is_err()
        );
        drop(first);
        tokio::time::timeout(Duration::from_secs(1), &mut acquired_rx)
            .await
            .expect("waiter should acquire the released conflict key")
            .expect("waiter should report acquisition");
        waiter.await.expect("waiter should finish");
    }

    #[tokio::test]
    async fn unrelated_conflict_keys_can_be_held_concurrently() {
        let coordinator = TaskConflictCoordinator::default();
        let _first = coordinator.acquire(["world:1:first"]).await;

        tokio::time::timeout(
            Duration::from_millis(100),
            coordinator.acquire(["world:1:second"]),
        )
        .await
        .expect("an unrelated key should not wait");
    }

    #[tokio::test]
    async fn multi_key_acquisition_uses_a_deadlock_safe_order() {
        let coordinator = TaskConflictCoordinator::default();
        let first_coordinator = coordinator.clone();
        let second_coordinator = coordinator.clone();

        let first = tokio::spawn(async move {
            let _guard = first_coordinator.acquire(["world:1:b", "world:1:a"]).await;
            tokio::task::yield_now().await;
        });
        let second = tokio::spawn(async move {
            let _guard = second_coordinator.acquire(["world:1:a", "world:1:b"]).await;
            tokio::task::yield_now().await;
        });

        tokio::time::timeout(Duration::from_secs(1), async {
            first.await.expect("first acquisition should finish");
            second.await.expect("second acquisition should finish");
        })
        .await
        .expect("opposite input orders should not deadlock");
    }

    #[tokio::test]
    async fn waiting_key_sets_do_not_hold_their_unblocked_keys() {
        let coordinator = TaskConflictCoordinator::default();
        let saves = coordinator.acquire(["saves:1"]).await;
        let waiting = coordinator.clone();
        let waiter = tokio::spawn(async move {
            let _guard = waiting.acquire(["resourcepacks:1", "saves:1"]).await;
        });
        tokio::task::yield_now().await;

        tokio::time::timeout(
            Duration::from_millis(100),
            coordinator.acquire(["resourcepacks:1"]),
        )
        .await
        .expect("a waiting key set must not reserve resourcepacks");

        drop(saves);
        waiter.await.unwrap();
    }
}
