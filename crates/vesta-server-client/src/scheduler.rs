use crate::{Error, ErrorCode, Result};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

static GLOBAL_REQUESTS: OnceLock<Arc<Semaphore>> = OnceLock::new();

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
                local_pressure: true,
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
    bulk: Arc<Semaphore>,
    interactive_waiters: AtomicUsize,
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
            bulk: Arc::new(Semaphore::new(1)),
            interactive_waiters: AtomicUsize::new(0),
        }
    }
}
struct InteractiveWaiter<'a>(&'a AtomicUsize);
impl Drop for InteractiveWaiter<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Release);
    }
}
impl Scheduler {
    /// Transfers have independent concurrency and do not consume the control
    /// token bucket. Keep both permits until the response body has been drained.
    pub fn admit_bulk(&self) -> Result<(OwnedSemaphorePermit, OwnedSemaphorePermit)> {
        static GLOBAL: OnceLock<Arc<Semaphore>> = OnceLock::new();
        let busy = || Error::new(ErrorCode::ServerBusy).local_pressure();
        if !self.paused_for().is_zero() {
            return Err(Error {
                code: ErrorCode::RateLimited,
                local_pressure: true,
                retry_after_ms: Some(self.paused_for().as_millis() as u64),
            });
        }
        let local = self.bulk.clone().try_acquire_owned().map_err(|_| busy())?;
        let global = GLOBAL
            .get_or_init(|| Arc::new(Semaphore::new(2)))
            .clone()
            .try_acquire_owned()
            .map_err(|_| busy())?;
        Ok((local, global))
    }
    pub fn for_origin(origin: &str) -> Result<Arc<Self>> {
        static OWNERS: OnceLock<Mutex<HashMap<String, Arc<Scheduler>>>> = OnceLock::new();
        let mut owners = OWNERS
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| Error::new(ErrorCode::Internal))?;
        // Keep an idle origin through its refill window even when every pool is
        // retired. Repeated failed enrollment must not refill a fresh bucket.
        owners.retain(|_, s| {
            Arc::strong_count(s) > 1
                || s.bucket.lock().is_ok_and(|b| {
                    b.updated.elapsed() < Duration::from_secs(120)
                        || b.paused_until > Instant::now()
                })
        });
        if let Some(scheduler) = owners.get(origin) {
            return Ok(scheduler.clone());
        }
        if owners.len() >= 128 {
            return Err(Error::new(ErrorCode::ServerBusy).local_pressure());
        }
        let scheduler = Arc::new(Self::default());
        owners.insert(origin.into(), scheduler.clone());
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
        static BACKGROUND: OnceLock<Arc<Semaphore>> = OnceLock::new();
        let busy = || Error::new(ErrorCode::ServerBusy).local_pressure();
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
        let global = GLOBAL_REQUESTS
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
    /// Interactive reads may briefly wait for in-flight requests to release a
    /// permit. Background work keeps the existing fail-fast policy so it cannot
    /// build a queue behind a busy server.
    pub async fn admit_request(&self, interactive: bool) -> Result<Admission> {
        const MAX_WAITERS: usize = 8;
        const WAIT: Duration = Duration::from_secs(2);
        const RETRY: Duration = Duration::from_millis(20);
        if !interactive {
            return self.admit(false);
        }

        let mut count = self.interactive_waiters.load(Ordering::Relaxed);
        loop {
            if count >= MAX_WAITERS {
                return Err(Error::new(ErrorCode::ServerBusy).local_pressure());
            }
            match self.interactive_waiters.compare_exchange_weak(
                count,
                count + 1,
                Ordering::AcqRel,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(next) => count = next,
            }
        }
        let _waiter = InteractiveWaiter(&self.interactive_waiters);
        let deadline = Instant::now() + WAIT;

        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(Error::new(ErrorCode::ServerBusy).local_pressure());
            }
            let local =
                match tokio::time::timeout(remaining, self.local.clone().acquire_owned()).await {
                    Ok(Ok(permit)) => permit,
                    Ok(Err(_)) | Err(_) => {
                        return Err(Error::new(ErrorCode::ServerBusy).local_pressure())
                    }
                };

            // Never hold a global permit while waiting for origin capacity. If
            // global capacity is full, release local capacity before retrying.
            let global = GLOBAL_REQUESTS
                .get_or_init(|| Arc::new(Semaphore::new(12)))
                .clone()
                .try_acquire_owned();
            let global = match global {
                Ok(permit) => permit,
                Err(_) => {
                    drop(local);
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        return Err(Error::new(ErrorCode::ServerBusy).local_pressure());
                    }
                    tokio::time::sleep(RETRY.min(remaining)).await;
                    continue;
                }
            };

            if let Err(error) = self
                .bucket
                .lock()
                .map_err(|_| Error::new(ErrorCode::ServerBusy).local_pressure())?
                .admit(true, Instant::now())
            {
                return Err(error);
            }
            return Ok(Admission {
                _global: global,
                _local: local,
                _background: None,
                _global_background: None,
            });
        }
    }
    pub fn pause(&self, ms: u64) {
        if let Ok(mut b) = self.bucket.lock() {
            b.pause(Duration::from_millis(ms.min(3_600_000)));
        }
    }
}
