use crate::{Error, ErrorCode, Result};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc, Mutex,
    },
};
use tokio::sync::Notify;

/// Cancellation and atomic publication compete for one state transition. After
/// publication is admitted, callers must await its result rather than report a
/// cancellation that could still replace the user's destination.
#[derive(Default)]
pub struct DownloadCancellation {
    state: AtomicU8,
    changed: Notify,
}
impl DownloadCancellation {
    pub fn cancel(&self) -> bool {
        if self
            .state
            .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return self.state.load(Ordering::Acquire) == 1;
        }
        self.changed.notify_waiters();
        true
    }
    pub(super) fn begin_commit(&self) -> bool {
        self.state
            .compare_exchange(0, 2, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
    }
    pub(super) fn is_cancelled(&self) -> bool {
        self.state.load(Ordering::Acquire) == 1
    }
    pub(super) async fn cancelled(&self) {
        loop {
            // Tokio guarantees notify_waiters wakeups from Notified creation,
            // even before first poll. Create it BEFORE inspecting retained state.
            let notified = self.changed.notified();
            if self.state.load(Ordering::Acquire) == 1 {
                return;
            }
            notified.await;
        }
    }
}
struct Active {
    owner: String,
    cancellation: Arc<DownloadCancellation>,
}
#[derive(Default)]
pub struct DownloadTransfers {
    active: Arc<Mutex<HashMap<String, Active>>>,
}
pub struct DownloadRegistration {
    id: String,
    active: Arc<Mutex<HashMap<String, Active>>>,
    pub cancellation: Arc<DownloadCancellation>,
}
impl Drop for DownloadRegistration {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(&self.id);
        }
    }
}
impl DownloadTransfers {
    pub fn register(
        &self,
        owner: &str,
        connection: &str,
        transfer: &str,
    ) -> Result<DownloadRegistration> {
        let id = format!("server-file:{connection}:{transfer}");
        let mut active = self
            .active
            .lock()
            .map_err(|_| Error::new(ErrorCode::Internal))?;
        if active.len() >= 8 {
            return Err(Error::new(ErrorCode::ServerBusy).local_pressure());
        }
        if active.contains_key(&id) {
            return Err(Error::new(ErrorCode::Conflict));
        }
        let cancellation = Arc::new(DownloadCancellation::default());
        active.insert(
            id.clone(),
            Active {
                owner: owner.into(),
                cancellation: cancellation.clone(),
            },
        );
        Ok(DownloadRegistration {
            id,
            active: self.active.clone(),
            cancellation,
        })
    }
    pub fn cancel(&self, owner: &str, id: &str) -> Result<()> {
        let active = self
            .active
            .lock()
            .map_err(|_| Error::new(ErrorCode::Internal))?;
        let download = active
            .get(id)
            .ok_or_else(|| Error::new(ErrorCode::NotFound))?;
        if download.owner != owner {
            return Err(Error::new(ErrorCode::Forbidden));
        }
        if !download.cancellation.cancel() {
            return Err(Error::new(ErrorCode::Conflict));
        }
        Ok(())
    }
    pub fn window_closed(&self, owner: &str) {
        if let Ok(active) = self.active.lock() {
            for download in active.values().filter(|d| d.owner == owner) {
                download.cancellation.cancel();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn cancellation_is_window_bound_and_cannot_overtake_publication() {
        let transfers = DownloadTransfers::default();
        let first = transfers.register("one", "server", "first").unwrap();
        assert_eq!(
            transfers.cancel("two", &first.id).unwrap_err().code,
            ErrorCode::Forbidden
        );
        transfers.cancel("one", &first.id).unwrap();
        first.cancellation.cancelled().await;
        assert!(!first.cancellation.begin_commit());
        let second = transfers.register("two", "server", "second").unwrap();
        assert!(second.cancellation.begin_commit());
        assert_eq!(
            transfers.cancel("two", &second.id).unwrap_err().code,
            ErrorCode::Conflict
        );
        transfers.window_closed("two");
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(10),
            second.cancellation.cancelled()
        )
        .await
        .is_err());
        drop(first);
        drop(second);
        assert!(transfers.active.lock().unwrap().is_empty());
    }
}
