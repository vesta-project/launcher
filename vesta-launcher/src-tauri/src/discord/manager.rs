use crate::utils::config::get_app_config;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Listener};
use tokio::sync::Mutex;

/// The Discord Application ID for Vesta Launcher
const DISCORD_APP_ID: &str = "1471108653573603510";

pub struct DiscordState {
    pub client: Option<DiscordIpcClient>,
    pub running_instances: Vec<String>,
    pub last_start_time: i64,
}

#[derive(Clone)]
pub struct DiscordManager {
    state: Arc<Mutex<DiscordState>>,
}

impl DiscordManager {
    pub fn new(app_handle: AppHandle) -> Self {
        let manager = Self {
            state: Arc::new(Mutex::new(DiscordState {
                client: None,
                running_instances: Vec::new(),
                last_start_time: SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64,
            })),
        };

        let dm = manager.clone();
        app_handle.listen("config-updated", move |event| {
            let raw_payload = event.payload();
            if let Ok(payload) = serde_json::from_str::<serde_json::Value>(raw_payload) {
                if payload["field"] == "discord_presence_enabled" {
                    let enabled = payload["value"].as_bool().unwrap_or(true);
                    let dm_inner = dm.clone();
                    tauri::async_runtime::spawn(async move {
                        if enabled {
                            dm_inner.connect().await;
                        } else {
                            dm_inner.disconnect().await;
                        }
                    });
                }
            }
        });

        manager
    }

    /// Initialize the Discord client if enabled in settings
    pub async fn init(&self) {
        let config = match get_app_config() {
            Ok(c) => c,
            Err(e) => {
                log::error!("[DiscordManager] Failed to get app config: {}", e);
                return;
            }
        };

        if config.discord_presence_enabled {
            self.connect().await;
        }
    }

    /// Connect to Discord
    pub async fn connect(&self) {
        let state = self.state.lock().await;
        if state.client.is_some() {
            return;
        }

        log::info!("[DiscordManager] Connecting to Discord...");

        let mut client = match DiscordIpcClient::new(DISCORD_APP_ID) {
            Ok(c) => c,
            Err(e) => {
                log::error!("[DiscordManager] Failed to create Discord client: {}", e);
                return;
            }
        };

        drop(state); // Drop the lock before blocking operation

        if let Err(e) = client.connect() {
            log::error!("[DiscordManager] Failed to connect to Discord: {}", e);
            return;
        }

        log::info!("[DiscordManager] Connected to Discord");
        let mut state = self.state.lock().await;
        state.client = Some(client);
        drop(state);
        self.set_idle_status().await;
    }

    /// Disconnect from Discord
    pub async fn disconnect(&self) {
        let mut state = self.state.lock().await;
        let client = state.client.take();
        drop(state); // Drop the lock before blocking operation

        if let Some(mut client) = client {
            log::info!("[DiscordManager] Disconnecting from Discord...");
            let _ = client.close();
        }
    }

    /// Set "Playing" status for a specific instance
    pub async fn add_running_instance(&self, instance_name: &str) {
        let mut state = self.state.lock().await;
        if state.running_instances.is_empty() {
            state.last_start_time = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
        }
        if !state.running_instances.contains(&instance_name.to_string()) {
            state.running_instances.push(instance_name.to_string());
        }
        let name = instance_name.to_string();
        drop(state);
        self.update_presence("Playing Minecraft", Some(&name), true)
            .await;
    }

    /// Remove a running instance and update status
    pub async fn remove_running_instance(&self, instance_name: &str) {
        let mut state = self.state.lock().await;
        state.running_instances.retain(|i| i != instance_name);

        if let Some(last) = state.running_instances.last().cloned() {
            drop(state);
            self.update_presence("Playing Minecraft", Some(&last), true)
                .await;
        } else {
            state.last_start_time = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs() as i64;
            drop(state);
            self.set_idle_status().await;
        }
    }

    /// Set "Idle" status (browsing the launcher)
    pub async fn set_idle_status(&self) {
        self.update_presence("Browsing Launcher", None, false).await;
    }

    /// Internal helper to update presence
    async fn update_presence(&self, details: &str, state_text: Option<&str>, _is_playing: bool) {
        let mut state = self.state.lock().await;
        let last_start_time = state.last_start_time;
        let mut client = match state.client.take() {
            Some(c) => c,
            None => return,
        };
        drop(state); // Drop the lock before blocking operation

        log::debug!(
            "[DiscordManager] Updating presence: {} - {:?}",
            details,
            state_text
        );

        let assets = activity::Assets::new()
            .large_image("logo")
            .large_text("Vesta Launcher");

        let mut disc_activity = activity::Activity::new()
            .details(details)
            .assets(assets)
            .timestamps(activity::Timestamps::new().start(last_start_time))
            .buttons(vec![activity::Button::new(
                "Visit Website",
                "https://www.vestalauncher.com",
            )]);

        if let Some(s) = state_text {
            disc_activity = disc_activity.state(s);
        }

        if let Err(e) = client.set_activity(disc_activity) {
            log::error!("[DiscordManager] Failed to update presence: {}", e);
            // If it failed, maybe the connection is dead?
            if e.to_string().contains("pipe") || e.to_string().contains("closed") {
                // Don't put client back
                return;
            }
        }

        // Put client back
        let mut state = self.state.lock().await;
        state.client = Some(client);
    }
}
