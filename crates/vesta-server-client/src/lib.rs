//! Framework-independent, pinned-TLS Vesta v3 management client.
pub mod auth;
mod client;
pub mod endpoint;
mod file_transport;
pub mod files;
pub mod metrics;
pub mod model;
pub mod observation;
pub mod operations;
pub mod retry;
mod role_defaults;
pub mod scheduler;
pub mod streams;
pub mod transport;
pub mod trust;
pub use client::{automation, backups_config, branding, hosting, management, presence, Client};
pub use model::{Error, ErrorCode, Result};
// Keep callers independent of the HTTP major version selected by this crate.
pub use reqwest::Method;

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
