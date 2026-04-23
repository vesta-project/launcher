use std::borrow::Cow;

fn read_non_empty_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn read_trace_sample_rate() -> f32 {
    let Some(raw) = read_non_empty_env("SENTRY_TRACES_SAMPLE_RATE") else {
        return 0.0;
    };

    match raw.parse::<f32>() {
        Ok(value) if (0.0..=1.0).contains(&value) => value,
        Ok(_) => {
            log::warn!(
                "Ignoring SENTRY_TRACES_SAMPLE_RATE because it is outside [0.0, 1.0]: {}",
                raw
            );
            0.0
        }
        Err(error) => {
            log::warn!(
                "Ignoring SENTRY_TRACES_SAMPLE_RATE because it could not be parsed: {} ({})",
                raw,
                error
            );
            0.0
        }
    }
}

fn read_environment() -> String {
    read_non_empty_env("SENTRY_ENVIRONMENT").unwrap_or_else(|| {
        if cfg!(debug_assertions) {
            "development".to_string()
        } else {
            "production".to_string()
        }
    })
}

fn read_release() -> Option<Cow<'static, str>> {
    read_non_empty_env("SENTRY_RELEASE")
        .map(Cow::Owned)
        .or_else(|| sentry::release_name!())
}

fn read_dsn() -> Option<String> {
    read_non_empty_env("SENTRY_DSN")
}

fn load_env_files() {
    // Load local env files when available for development convenience.
    let _ = dotenvy::dotenv();
    let _ = dotenvy::from_filename("../.env");
}

/// Initialize Sentry and return the guard for lifecycle management.
/// The guard must be kept alive for the duration of the program.
pub fn init_sentry() -> sentry::ClientInitGuard {
    load_env_files();

    let dsn = read_dsn();
    if dsn.is_none() {
        log::info!(
            "Sentry DSN is not configured. Monitoring remains disabled until SENTRY_DSN is set."
        );
    }

    sentry::init(sentry::ClientOptions {
        dsn: dsn.and_then(|raw| raw.parse().ok()),
        release: read_release(),
        environment: Some(Cow::Owned(read_environment())),
        auto_session_tracking: true,
        traces_sample_rate: read_trace_sample_rate(),
        attach_stacktrace: true,
        ..Default::default()
    })
}
