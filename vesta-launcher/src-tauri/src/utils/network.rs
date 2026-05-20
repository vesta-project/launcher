use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NetworkStatus {
    Online,
    Offline,
}

pub struct NetworkManager {
    status: Arc<Mutex<NetworkStatus>>,
    app_handle: AppHandle,
}

impl NetworkManager {
    pub fn new(app_handle: AppHandle) -> Self {
        let status = Arc::new(Mutex::new(NetworkStatus::Online));
        let status_clone = status.clone();
        let app_handle_clone = app_handle.clone();

        tauri::async_runtime::spawn(async move {
            let actual = Self::verify_online_static().await;
            let mut s = match status_clone.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            if *s != actual {
                *s = actual;
                drop(s);
                let _ = app_handle_clone.emit("core://network-status-changed", actual);
            }
        });

        Self {
            status,
            app_handle,
        }
    }

    async fn verify_online_static() -> NetworkStatus {
        let client = piston_lib::client::shared_client();
        let endpoints = ["https://1.1.1.1", "https://www.google.com"];
        let timeout = std::time::Duration::from_secs(5);

        for endpoint in endpoints {
            if client
                .head(endpoint)
                .timeout(timeout)
                .send()
                .await
                .is_ok()
            {
                return NetworkStatus::Online;
            }
        }

        NetworkStatus::Offline
    }

    pub async fn verify_online(&self) -> NetworkStatus {
        Self::verify_online_static().await
    }

    pub fn get_status(&self) -> NetworkStatus {
        self.status
            .lock()
            .map(|s| *s)
            .unwrap_or(NetworkStatus::Offline)
    }

    pub fn set_status(&self, new_status: NetworkStatus) {
        let mut status = match self.status.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if *status != new_status {
            *status = new_status;
            log::info!("[NetworkManager] Status changed to: {:?}", new_status);
            drop(status);
            let _ = self
                .app_handle
                .emit("core://network-status-changed", new_status);
        }
    }
}
