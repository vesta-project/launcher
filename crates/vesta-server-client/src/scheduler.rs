use crate::{Error, ErrorCode, Result};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock, Weak},
    time::{Duration, Instant},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

pub struct TokenBucket {
    tokens: f64,
    updated: Instant,
    paused_until: Instant,
}
impl TokenBucket {
    pub fn new(now: Instant) -> Self {
        Self {
            tokens: 40.,
            updated: now,
            paused_until: now,
        }
    }
    pub fn admit(&mut self, interactive: bool, now: Instant) -> Result<()> {
        self.tokens = (self.tokens
            + now.saturating_duration_since(self.updated).as_secs_f64() * 40. / 60.)
            .min(40.);
        self.updated = now;
        let required = if interactive { 1. } else { 11. };
        if (!interactive && now < self.paused_until) || self.tokens < required {
            let wait = if !interactive && now < self.paused_until {
                self.paused_until.duration_since(now)
            } else {
                Duration::from_secs_f64((required - self.tokens).max(0.) * 1.5)
            };
            return Err(Error {
                code: ErrorCode::RateLimited,
                retry_after_ms: Some(wait.as_millis().max(1) as u64),
            });
        }
        self.tokens -= 1.;
        Ok(())
    }
    pub fn pause(&mut self, delay: Duration) {
        self.paused_until = Instant::now() + delay;
    }
}
pub struct Scheduler {
    bucket: Mutex<TokenBucket>,
    local: Arc<Semaphore>,
    background: Arc<Semaphore>,
}
pub struct Admission {
    _global: OwnedSemaphorePermit,
    _local: OwnedSemaphorePermit,
    _background: Option<OwnedSemaphorePermit>,
    _global_background: Option<OwnedSemaphorePermit>,
}
impl Default for Scheduler {
    fn default() -> Self {
        Self {
            bucket: Mutex::new(TokenBucket::new(Instant::now())),
            local: Arc::new(Semaphore::new(3)),
            background: Arc::new(Semaphore::new(2)),
        }
    }
}
impl Scheduler {
    pub fn for_origin(origin: &str) -> Result<Arc<Self>> {
        static OWNERS: OnceLock<Mutex<HashMap<String, Weak<Scheduler>>>> = OnceLock::new();
        let mut owners = OWNERS
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| Error::new(ErrorCode::Internal))?;
        owners.retain(|_, s| s.strong_count() > 0);
        if let Some(scheduler) = owners.get(origin).and_then(Weak::upgrade) {
            return Ok(scheduler);
        }
        if owners.len() >= 128 {
            return Err(Error::new(ErrorCode::ServerBusy));
        }
        let scheduler = Arc::new(Self::default());
        owners.insert(origin.into(), Arc::downgrade(&scheduler));
        Ok(scheduler)
    }
    pub fn paused_for(&self) -> Duration {
        self.bucket
            .lock()
            .map(|b| b.paused_until.saturating_duration_since(Instant::now()))
            .unwrap_or_default()
    }
    /// Fail fast instead of accumulating unbounded request queues. Local admission
    /// precedes global admission; no global permit is held waiting for a server.
    pub fn admit(&self, interactive: bool) -> Result<Admission> {
        static GLOBAL: OnceLock<Arc<Semaphore>> = OnceLock::new();
        static BACKGROUND: OnceLock<Arc<Semaphore>> = OnceLock::new();
        let busy = || Error::new(ErrorCode::ServerBusy);
        let background = if interactive {
            None
        } else {
            Some(
                self.background
                    .clone()
                    .try_acquire_owned()
                    .map_err(|_| busy())?,
            )
        };
        let local = self.local.clone().try_acquire_owned().map_err(|_| busy())?;
        let global_background = if interactive {
            None
        } else {
            Some(
                BACKGROUND
                    .get_or_init(|| Arc::new(Semaphore::new(8)))
                    .clone()
                    .try_acquire_owned()
                    .map_err(|_| busy())?,
            )
        };
        let global = GLOBAL
            .get_or_init(|| Arc::new(Semaphore::new(12)))
            .clone()
            .try_acquire_owned()
            .map_err(|_| busy())?;
        self.bucket
            .lock()
            .map_err(|_| busy())?
            .admit(interactive, Instant::now())?;
        Ok(Admission {
            _global: global,
            _local: local,
            _background: background,
            _global_background: global_background,
        })
    }
    pub fn pause(&self, ms: u64) {
        if let Ok(mut b) = self.bucket.lock() {
            b.pause(Duration::from_millis(ms.min(3_600_000)));
        }
    }
}
