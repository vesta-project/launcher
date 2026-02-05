use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NetworkStatus {
    Online,
    Weak,
    Offline,
}

pub struct NetworkManager {
    status: Arc<Mutex<NetworkStatus>>,
    is_checking: Arc<Mutex<bool>>,
    stability_counter: Arc<Mutex<u32>>,
    last_check_time: Arc<Mutex<Option<Instant>>>,
    app_handle: AppHandle,
    client: reqwest::Client,
}

impl NetworkManager {
    pub fn new(app_handle: AppHandle) -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(6)) // Slightly longer for weak networks
            .build()
            .unwrap_or_default();

        let status = Arc::new(Mutex::new(NetworkStatus::Online));
        let is_checking = Arc::new(Mutex::new(false));
        let stability_counter = Arc::new(Mutex::new(0));
        let last_check_time = Arc::new(Mutex::new(None));

        // Initial check in background
        let status_clone = status.clone();
        let is_checking_clone = is_checking.clone();
        let stability_counter_clone = stability_counter.clone();
        let last_check_time_clone = last_check_time.clone();
        let app_handle_clone = app_handle.clone();
        let client_clone = client.clone();

        tauri::async_runtime::spawn(async move {
            {
                if let Ok(mut checking) = is_checking_clone.lock() {
                    *checking = true;
                }
            }

            // Fallback endpoints for different regions (e.g. Minecraft-specific ones)
            let endpoints = [
                "https://1.1.1.1",
                "https://session.minecraft.net",
                "https://www.google.com"
            ];
            let mut detected = NetworkStatus::Offline;

            for endpoint in endpoints {
                if client_clone.head(endpoint).send().await.is_ok() {
                    detected = NetworkStatus::Online;
                    break;
                }
            }

            {
                if let Ok(mut s) = status_clone.lock() {
                    *s = detected;
                }
                if let Ok(mut counter) = stability_counter_clone.lock() {
                    if detected == NetworkStatus::Online {
                        *counter = 3; // Start as stabilized
                    }
                }
                if let Ok(mut last_check) = last_check_time_clone.lock() {
                    *last_check = Some(Instant::now());
                }
                if let Ok(mut checking) = is_checking_clone.lock() {
                    *checking = false;
                }
                log::info!("[NetworkManager] Initial status check: {:?}", detected);
            }
            let _ = app_handle_clone.emit("core://network-status-changed", detected);
        });

        Self {
            status,
            is_checking,
            stability_counter,
            last_check_time,
            app_handle,
            client,
        }
    }

    pub async fn check_connectivity(&self) -> NetworkStatus {
        {
            if let Ok(last_check) = self.last_check_time.lock() {
                if let Some(time) = *last_check {
                    if time.elapsed().as_secs() < 5 {
                        return self.get_status();
                    }
                }
            }

            let mut checking = match self.is_checking.lock() {
                Ok(l) => l,
                Err(_) => return self.get_status(), // Poisoned
            };
            if *checking {
                return self.get_status();
            }
            *checking = true;
        }

        // Ensure we reset is_checking even if we return early or panic
        let (best_detected, _elapsed) = async {
            let endpoints = [
                "https://session.minecraft.net",
                "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
            ];
            let mut best = NetworkStatus::Offline;
            let mut total_duration = 0;

            for endpoint in endpoints {
                let start = std::time::Instant::now();
                let is_throughput_test = endpoint.contains("piston-meta");
                
                // For throughput, we download a small chunk (10KB)
                let request = if is_throughput_test {
                    self.client.get(endpoint).header("Range", "bytes=0-10240")
                } else {
                    self.client.head(endpoint)
                };

                match request.send().await {
                    Ok(res) => {
                        // CRITICAL: Actually consume the body to test throughput
                        if is_throughput_test {
                            let _ = res.bytes().await;
                        }

                        let duration = start.elapsed().as_millis();
                        total_duration += duration;
                        
                        let is_slow = if is_throughput_test {
                            duration > 2000 // 10KB should be fast
                        } else {
                            duration > 1000
                        };

                        if is_slow {
                            best = NetworkStatus::Weak;
                        } else if best != NetworkStatus::Weak {
                            best = NetworkStatus::Online;
                        }
                    }
                    Err(e) => {
                        log::debug!("[NetworkManager] Check failed for {}: {}", endpoint, e);
                    }
                }
            }
            (best, total_duration)
        }.await;

        let result = {
            let current_status = self.get_status();
            let mut counter = match self.stability_counter.lock() {
                Ok(l) => l,
                Err(_) => return current_status,
            };

            match best_detected {
                NetworkStatus::Online => {
                    *counter += 1;
                    if *counter >= 2 || current_status == NetworkStatus::Online {
                        NetworkStatus::Online
                    } else {
                        NetworkStatus::Weak
                    }
                }
                NetworkStatus::Weak => {
                    *counter = 0;
                    NetworkStatus::Weak
                }
                NetworkStatus::Offline => {
                    *counter = 0;
                    NetworkStatus::Offline
                }
            }
        };

        {
            if let Ok(mut checking) = self.is_checking.lock() {
                *checking = false;
            }
            if let Ok(mut last_check) = self.last_check_time.lock() {
                *last_check = Some(Instant::now());
            }
        }

        result
    }

    pub fn get_status(&self) -> NetworkStatus {
        self.status.lock().map(|s| *s).unwrap_or(NetworkStatus::Offline)
    }

    pub fn set_status(&self, new_status: NetworkStatus) {
        let mut status = match self.status.lock() {
            Ok(l) => l,
            Err(_) => return,
        };
        
        if *status != new_status {
            *status = new_status;
            log::info!("[NetworkManager] Status changed to: {:?}", new_status);
            let _ = self
                .app_handle
                .emit("core://network-status-changed", new_status);
        }
    }

    pub fn report_request_result(&self, duration_ms: u128, success: bool) {
        // TODO: In the future, we could pass the result of this check back into 
        // piston-lib to dynamically adjust retry strategies for the current session.

        let current = self.get_status();

        if !success {
            // If a request fails, we reset stability counter
            if let Ok(mut counter) = self.stability_counter.lock() {
                *counter = 0;
            }

            // Throttle: don't spawn a check if one is already running
            if let Ok(checking) = self.is_checking.lock() {
                if *checking {
                    return;
                }
            }

            let app_handle = self.app_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(nm) = app_handle.try_state::<NetworkManager>() {
                    let status = nm.check_connectivity().await;
                    nm.set_status(status);
                }
            });
            return;
        }

        if current == NetworkStatus::Offline {
            // Reactive Recovery: If a request SUCCEEDED while we thought we were offline,
            // we should trigger a background check immediately to see if we've recovered.
            if let Ok(checking) = self.is_checking.lock() {
                if *checking {
                    return;
                }
            }

            let app_handle = self.app_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(nm) = app_handle.try_state::<NetworkManager>() {
                    let status = nm.check_connectivity().await;
                    nm.set_status(status);
                }
            });
            return;
        }

        if duration_ms > 2000 {
            if let Ok(mut counter) = self.stability_counter.lock() {
                *counter = 0;
            }
            self.set_status(NetworkStatus::Weak);
        } else if duration_ms < 400 && current == NetworkStatus::Weak {
            // Significant stability reached in background.
            let should_recover = if let Ok(mut counter) = self.stability_counter.lock() {
                *counter += 1;
                *counter >= 5 // Require multiple fast requests
            } else {
                false
            };

            if should_recover {
                log::info!("[NetworkManager] Significant stability reached in background. Recovering to Online.");
                self.set_status(NetworkStatus::Online);
            }
        }
    }
}
