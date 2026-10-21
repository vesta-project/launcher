//! Framework-independent, pinned-TLS Vesta v3 management client.
pub mod auth;
mod client;
pub mod endpoint;
mod file_transport;
pub mod files;
pub mod model;
pub mod operations;
mod role_defaults;
pub mod scheduler;
pub mod streams;
pub mod transport;
pub mod trust;
pub use client::Client;
pub use model::{Error, ErrorCode, Result};

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
