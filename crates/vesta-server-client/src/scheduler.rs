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
static GLOBAL_ORDINARY: OnceLock<Arc<Semaphore>> = OnceLock::new();
static GLOBAL_URGENT: OnceLock<Arc<Semaphore>> = OnceLock::new();

/// Capacity priority grants no authentication or rate-limit exemption.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RequestPriority {
    Background,
    Foreground,
    Urgent,
}
impl RequestPriority {
    fn from_interactive(interactive: bool) -> Self {
        if interactive {
            Self::Foreground
        } else {
            Self::Background
        }
    }
}

pub struct TokenBucket {
    capacity: f64,
    tokens: f64,
    updated: Instant,
    paused_until: Instant,
}
impl TokenBucket {
    pub fn new(now: Instant) -> Self {
        Self::with_capacity(now, 40.)
    }
    fn with_capacity(now: Instant, capacity: f64) -> Self {
        Self {
            capacity,
            tokens: capacity,
            updated: now,
            paused_until: now,
        }
    }
    pub fn admit(&mut self, interactive: bool, now: Instant) -> Result<()> {
        self.tokens = (self.tokens
            + now.saturating_duration_since(self.updated).as_secs_f64() * self.capacity / 60.)
            .min(self.capacity);
        self.updated = now;
        let required = if interactive { 1. } else { 11. };
        if (now < self.paused_until) || self.tokens < required {
            let wait = if now < self.paused_until {
                self.paused_until.duration_since(now)
            } else {
                Duration::from_secs_f64((required - self.tokens).max(0.) * 60. / self.capacity)
            };
            return Err(Error {
                code: ErrorCode::RateLimited,
                local_pressure: true,
                reason: None,
                retry_after_ms: Some(wait.as_millis().max(1) as u64),
            });
        }
        self.tokens -= 1.;
        Ok(())
    }
    pub fn pause(&mut self, delay: Duration) {
        self.paused_until = self.paused_until.max(Instant::now() + delay);
    }
}
pub struct Scheduler {
    bucket: Mutex<TokenBucket>,
    authenticated_bucket: Mutex<TokenBucket>,
    local: Arc<Semaphore>,
    ordinary: Arc<Semaphore>,
    urgent: Arc<Semaphore>,
    background: Arc<Semaphore>,
    bulk: Arc<Semaphore>,
    interactive_waiters: AtomicUsize,
    urgent_waiters: AtomicUsize,
}
pub struct Admission {
    _global: OwnedSemaphorePermit,
    _local: OwnedSemaphorePermit,
    _lane: OwnedSemaphorePermit,
    _global_lane: OwnedSemaphorePermit,
    _background: Option<OwnedSemaphorePermit>,
    _global_background: Option<OwnedSemaphorePermit>,
}
impl Default for Scheduler {
    fn default() -> Self {
        Self {
            bucket: Mutex::new(TokenBucket::new(Instant::now())),
            authenticated_bucket: Mutex::new(TokenBucket::with_capacity(Instant::now(), 240.)),
            local: Arc::new(Semaphore::new(3)),
            // In-flight reads cannot be preempted safely; never lend the last slot.
            ordinary: Arc::new(Semaphore::new(2)),
            urgent: Arc::new(Semaphore::new(1)),
            background: Arc::new(Semaphore::new(2)),
            bulk: Arc::new(Semaphore::new(1)),
            interactive_waiters: AtomicUsize::new(0),
            urgent_waiters: AtomicUsize::new(0),
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
                reason: None,
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
                || s.authenticated_bucket.lock().is_ok_and(|b| {
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
    fn request_bucket(&self, authenticated: bool) -> &Mutex<TokenBucket> {
        if authenticated {
            &self.authenticated_bucket
        } else {
            &self.bucket
        }
    }
    /// Authenticated traffic stays below the agent's 300/min session default;
    /// anonymous discovery/enrollment retains the 40/min budget below its 60/min limit.
    pub async fn admit_authenticated_request(&self, interactive: bool) -> Result<Admission> {
        self.admit_request_for(interactive, true).await
    }
    pub fn admit_authenticated(&self, interactive: bool) -> Result<Admission> {
        self.admit_for(interactive, true)
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
        self.admit_for(interactive, false)
    }
    fn admit_for(&self, interactive: bool, authenticated: bool) -> Result<Admission> {
        self.admit_priority(
            RequestPriority::from_interactive(interactive),
            authenticated,
        )
    }
    fn lane(&self, priority: RequestPriority) -> (&Arc<Semaphore>, Arc<Semaphore>) {
        if priority == RequestPriority::Urgent {
            (
                &self.urgent,
                GLOBAL_URGENT
                    .get_or_init(|| Arc::new(Semaphore::new(2)))
                    .clone(),
            )
        } else {
            (
                &self.ordinary,
                GLOBAL_ORDINARY
                    .get_or_init(|| Arc::new(Semaphore::new(10)))
                    .clone(),
            )
        }
    }
    fn admit_priority(&self, priority: RequestPriority, authenticated: bool) -> Result<Admission> {
        let interactive = priority != RequestPriority::Background;
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
        let (lane, global_lane) = self.lane(priority);
        let lane = lane.clone().try_acquire_owned().map_err(|_| busy())?;
        let global_lane = global_lane.try_acquire_owned().map_err(|_| busy())?;
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
        self.request_bucket(authenticated)
            .lock()
            .map_err(|_| busy())?
            .admit(interactive, Instant::now())?;
        Ok(Admission {
            _global: global,
            _local: local,
            _lane: lane,
            _global_lane: global_lane,
            _background: background,
            _global_background: global_background,
        })
    }
    /// Interactive reads may briefly wait for in-flight requests to release a
    /// permit or for a local token to refill, with a five-second total bound.
    /// Background work keeps the existing fail-fast policy so it cannot build
    /// a queue behind a busy server.
    pub async fn admit_request(&self, interactive: bool) -> Result<Admission> {
        self.admit_request_for(interactive, false).await
    }
    async fn admit_request_for(&self, interactive: bool, authenticated: bool) -> Result<Admission> {
        self.admit_priority_request(
            RequestPriority::from_interactive(interactive),
            authenticated,
        )
        .await
    }
    /// Separate bounded FIFO lanes reserve control capacity while keeping ordinary
    /// traffic independent of an urgent flood. This method never spawns work.
    pub async fn admit_priority_request(
        &self,
        priority: RequestPriority,
        authenticated: bool,
    ) -> Result<Admission> {
        let interactive = priority != RequestPriority::Background;
        let (waiters, max_waiters) = if priority == RequestPriority::Urgent {
            (&self.urgent_waiters, 2)
        } else {
            (&self.interactive_waiters, 8)
        };
        const WAIT: Duration = Duration::from_secs(5);
        let mut retry = Duration::from_millis(20);
        if !interactive {
            return self.admit_priority(priority, authenticated);
        }

        let mut count = waiters.load(Ordering::Relaxed);
        loop {
            if count >= max_waiters {
                return Err(Error::new(ErrorCode::ServerBusy).local_pressure());
            }
            match waiters.compare_exchange_weak(
                count,
                count + 1,
                Ordering::AcqRel,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(next) => count = next,
            }
        }
        let _waiter = InteractiveWaiter(waiters);
        let deadline = Instant::now() + WAIT;

        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(Error::new(ErrorCode::ServerBusy).local_pressure());
            }
            let (lane, global_lane) = self.lane(priority);
            let lane = match tokio::time::timeout(remaining, lane.clone().acquire_owned()).await {
                Ok(Ok(permit)) => permit,
                Ok(Err(_)) | Err(_) => {
                    return Err(Error::new(ErrorCode::ServerBusy).local_pressure())
                }
            };
            let local = self
                .local
                .clone()
                .try_acquire_owned()
                .map_err(|_| Error::new(ErrorCode::ServerBusy).local_pressure())?;

            // Never hold a global permit while waiting for origin capacity. If
            // global capacity is full, release local capacity before retrying.
            let global = global_lane.try_acquire_owned().and_then(|global_lane| {
                GLOBAL_REQUESTS
                    .get_or_init(|| Arc::new(Semaphore::new(12)))
                    .clone()
                    .try_acquire_owned()
                    .map(|global| (global_lane, global))
            });
            let (global_lane, global) = match global {
                Ok(permit) => permit,
                Err(_) => {
                    drop(local);
                    drop(lane);
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if remaining.is_zero() {
                        return Err(Error::new(ErrorCode::ServerBusy).local_pressure());
                    }
                    // Back off only under contention, with no higher concurrency.
                    tokio::time::sleep(retry.min(remaining)).await;
                    retry = (retry * 2).min(Duration::from_millis(100));
                    continue;
                }
            };

            let bucket_result = self
                .request_bucket(authenticated)
                .lock()
                .map_err(|_| Error::new(ErrorCode::ServerBusy).local_pressure())?
                .admit(true, Instant::now());
            match bucket_result {
                Ok(()) => {
                    return Ok(Admission {
                        _global: global,
                        _local: local,
                        _lane: lane,
                        _global_lane: global_lane,
                        _background: None,
                        _global_background: None,
                    });
                }
                Err(error) if error.code == ErrorCode::RateLimited && error.local_pressure => {
                    let delay = Duration::from_millis(error.retry_after_ms.unwrap_or(1));
                    let remaining = deadline.saturating_duration_since(Instant::now());
                    if delay > remaining {
                        return Err(error);
                    }
                    // Token waiting must not reserve scarce request capacity.
                    drop(global);
                    drop(local);
                    drop(lane);
                    drop(global_lane);
                    tokio::time::sleep(delay).await;
                }
                Err(error) => return Err(error),
            }
        }
    }
    pub fn pause(&self, ms: u64) {
        for bucket in [&self.bucket, &self.authenticated_bucket] {
            if let Ok(mut b) = bucket.lock() {
                b.pause(Duration::from_millis(ms.min(3_600_000)));
            }
        }
    }
}
