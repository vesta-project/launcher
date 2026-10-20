//! Blocking filesystem calls cannot be forcibly interrupted. Keep the permit in
//! the worker after a caller times out/cancels, so retries cannot leak workers.
use std::{
    sync::{Arc, OnceLock},
    time::Duration,
};
use tokio::sync::Semaphore;

pub async fn blocking<T: Send + 'static>(
    budget: Duration,
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    static WORKERS: OnceLock<Arc<Semaphore>> = OnceLock::new();
    let workers = WORKERS.get_or_init(|| Arc::new(Semaphore::new(2))).clone();
    tokio::time::timeout(budget, async move {
        let permit = workers
            .acquire_owned()
            .await
            .map_err(|error| error.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            let _permit = permit;
            work()
        })
        .await
        .map_err(|error| format!("Launcher scan failed: {error}"))?
    })
    .await
    .map_err(|_| "launcher-import-timeout".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[tokio::test]
    async fn timeout_does_not_wait_for_blocking_io() {
        let finished = Arc::new(AtomicBool::new(false));
        let worker_finished = finished.clone();
        let result = blocking(Duration::from_millis(10), move || {
            std::thread::sleep(Duration::from_millis(100));
            worker_finished.store(true, Ordering::SeqCst);
            Ok(())
        })
        .await;
        assert_eq!(result.unwrap_err(), "launcher-import-timeout");
        assert!(!finished.load(Ordering::SeqCst));
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert!(finished.load(Ordering::SeqCst));
    }
}
