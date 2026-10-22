//! Bounded local-client reconstruction backoff. No authentication fallback and no
//! mutation replay: the caller retries only opening its saved credential/client.
use crate::ErrorCode;
use std::time::Duration;

pub fn client_reconstruction_delay(code: ErrorCode, failures: u32) -> Option<Duration> {
    if !matches!(
        code,
        ErrorCode::CredentialsUnavailable
            | ErrorCode::Internal
            | ErrorCode::ServerBusy
            | ErrorCode::Timeout
            | ErrorCode::Unreachable
            | ErrorCode::OutcomeUnknown
    ) {
        return None;
    }
    Some(Duration::from_secs(
        (1u64 << failures.saturating_sub(1).min(6)).min(60),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_recovery_backs_off_without_retrying_trust_or_access_failures() {
        let delays: Vec<_> = (1..=10)
            .map(|n| {
                client_reconstruction_delay(ErrorCode::CredentialsUnavailable, n)
                    .unwrap()
                    .as_secs()
            })
            .collect();
        assert_eq!(delays, [1, 2, 4, 8, 16, 32, 60, 60, 60, 60]);
        for code in [
            ErrorCode::FingerprintMismatch,
            ErrorCode::CredentialsRejected,
            ErrorCode::Forbidden,
            ErrorCode::NoManagementAccess,
            ErrorCode::TlsFailed,
            ErrorCode::NotFound,
        ] {
            assert_eq!(client_reconstruction_delay(code, 1), None);
        }
        assert_eq!(
            client_reconstruction_delay(ErrorCode::ServerBusy, u32::MAX),
            Some(Duration::from_secs(60))
        );
    }
}
