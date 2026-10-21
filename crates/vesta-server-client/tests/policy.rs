use rustls::client::ServerCertVerifier;
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime},
};
use vesta_server_client::{
    auth::{signing_bytes, DeviceSigner, Ed25519Signer},
    endpoint::{Address, Endpoint},
    model::*,
    operations::intent_key,
    scheduler::{Scheduler, TokenBucket},
    streams::ConsoleRing,
    trust::{leaf_fingerprint, PinVerifier},
    ErrorCode,
};

#[test]
fn addresses_and_pairing_links_are_origin_scoped() {
    for (input, display) in [
        ("example.net", "example.net:8443"),
        ("127.0.0.1:9443", "127.0.0.1:9443"),
        ("[::1]", "[::1]:8443"),
        ("https://[2001:db8::1]:9443/", "[2001:db8::1]:9443"),
        ("https://example.net:443/", "example.net:443"),
    ] {
        assert_eq!(Endpoint::parse(input).unwrap().display(), display);
    }
    for input in [
        "",
        "http://example.net",
        "https://user:pass@example.net",
        "https://@example.net",
        "example.net/#x",
        "example.net/?x=1",
        "example.net/path",
        "::1:8443",
        "example.net:0",
        "https://example.net\\evil",
    ] {
        assert!(Endpoint::parse(input).is_err(), "{input}");
    }
    let fp = "ab".repeat(32);
    let link = format!("vesta://pair?endpoint=https%3A%2F%2Fexample.net%3A8443%2F&code=secret&fp={fp}&sid=server-1");
    let parsed = Address::parse(&link).unwrap();
    assert_eq!(parsed.fingerprint, Some(fp));
    assert_eq!(parsed.code.as_deref(), Some("secret"));
    assert_eq!(parsed.server_id.as_deref(), Some("server-1"));
    assert!(Address::parse(&format!("{link}&code=duplicate")).is_err());
    assert!(Address::parse(&link.replace("https%3A", "http%3A")).is_err());
    assert!(Address::parse(&format!("{link}#fragment")).is_err());
}
#[test]
fn fingerprint_verifier_captures_and_pins_exact_leaf_der() {
    let cert = rustls::Certificate(vec![1, 2, 3]);
    let fp = leaf_fingerprint(&cert.0);
    let observed = Arc::new(Mutex::new(None));
    let verify = |expected| {
        PinVerifier::new(expected, observed.clone()).verify_server_cert(
            &cert,
            &[],
            &rustls::ServerName::try_from("localhost").unwrap(),
            &mut std::iter::empty(),
            &[],
            SystemTime::now(),
        )
    };
    assert!(verify(None).is_ok());
    assert_eq!(*observed.lock().unwrap(), Some(fp.clone()));
    assert!(verify(Some(fp)).is_ok());
    assert!(verify(Some("00".repeat(32))).is_err());
}
#[tokio::test]
async fn session_signing_bytes_and_unpadded_base64url_are_exact() {
    use base64::Engine;
    let bytes = signing_bytes("server-1", "nonce");
    assert_eq!(bytes, b"vesta.management.session.v1\0server-1\0nonce");
    let signer = Ed25519Signer::from_seed([42; 32]);
    let signature = signer.sign(&bytes).await.unwrap();
    assert!(!signature.contains('='));
    assert_eq!(signature.len(), 86);
    let public = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(signer.public_key())
        .unwrap();
    let signature = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(signature)
        .unwrap();
    ed25519_dalek::VerifyingKey::from_bytes(public.as_slice().try_into().unwrap())
        .unwrap()
        .verify_strict(
            &bytes,
            &ed25519_dalek::Signature::from_slice(&signature).unwrap(),
        )
        .unwrap();
}
#[test]
fn management_error_mapping_is_closed_and_covers_wire_codes() {
    use ErrorCode::*;
    // Auth's legacy string errors and management's enveloped codes share this table.
    let cases = [
        (401, "management_pair_invalid", PairCodeInvalid),
        (401, "management_session_invalid", CredentialsRejected),
        (401, "device_session_required", CredentialsRejected),
        (403, "management_forbidden", Forbidden),
        (403, "management_unavailable", NoManagementAccess),
        (403, "pack_access_denied", NoManagementAccess),
        (400, "invalid_request", InvalidInput),
        (400, "confirmation_required", ConfirmationExpired),
        (404, "resource_not_found", NotFound),
        (404, "endpoint_not_found", NotFound),
        (409, "idempotency_conflict", Conflict),
        (409, "operation_conflict", Conflict),
        (409, "permission_conflict", Conflict),
        (409, "cursor_gap", Conflict),
        (409, "confirmation_invalid", ConfirmationExpired),
        (409, "confirmation_expired", ConfirmationExpired),
        (412, "precondition_failed", StaleTarget),
        (412, "lightning_unsupported_version", StaleTarget),
        (429, "rate_limited", RateLimited),
        (429, "minecraft_rate_limited", RateLimited),
        (501, "not_implemented", Unsupported),
        (410, "legacy_endpoint_removed", Unsupported),
        (503, "temporarily_unavailable", ServerBusy),
        (503, "management_saturated", ServerBusy),
        (503, "management_unavailable", ServerBusy),
        (503, "management_unavailable_capacity", ServerBusy),
        (503, "players_file_malformed", ServerBusy),
        (503, "players_file_too_large", ServerBusy),
        (503, "players_file_unavailable", ServerBusy),
        (503, "minecraft_busy", ServerBusy),
        (503, "minecraft_unavailable", ServerBusy),
        (500, "new_unknown_code", Internal),
        (413, "request_too_large", InvalidInput),
    ];
    for (status, code, expected) in cases {
        assert_eq!(Error::wire(status, code, None).code, expected, "{code}");
    }
    assert_eq!(
        serde_json::to_value(Error::wire(429, "rate_limited", Some(2500))).unwrap(),
        serde_json::json!({"code":"rate_limited","retryAfterMs":2500})
    );
}
#[test]
fn wire_envelopes_preserve_opaque_strings_and_ipc_casing() {
    let wire = serde_json::json!({"operation_id":"op-1","state":"succeeded","progress_percent":100,"created_at_ms":1,"updated_at_ms":2,"finished_at_ms":2,"unknown_addition":true});
    let op: ServerOperation = from_wire(wire).unwrap();
    let ipc = serde_json::to_value(op).unwrap();
    assert_eq!(ipc["operationId"], "op-1");
    assert_eq!(ipc["reconciling"], false);
    let line: ConsoleLine = from_wire(serde_json::json!({"cursor":"server.console.18446744073709551615","text":"hello","truncated":false})).unwrap();
    assert_eq!(line.cursor, "server.console.18446744073709551615");
}
#[test]
fn intent_keys_are_stable_bounded_and_domain_separated() {
    let a = intent_key("intent-1").unwrap();
    assert_eq!(a, intent_key("intent-1").unwrap());
    assert_ne!(a, intent_key("intent-2").unwrap());
    assert!((16..=128).contains(&a.len()));
    assert!(a.bytes().all(|b| b.is_ascii_graphic()));
    assert!(intent_key("").is_err());
    assert!(intent_key("x\ny").is_err());
}
#[test]
fn token_bucket_reserves_ten_tokens_for_interactive_work() {
    let now = Instant::now();
    let mut bucket = TokenBucket::new(now);
    for _ in 0..30 {
        bucket.admit(false, now).unwrap();
    }
    assert_eq!(
        bucket.admit(false, now).unwrap_err().code,
        ErrorCode::RateLimited
    );
    for _ in 0..10 {
        bucket.admit(true, now).unwrap();
    }
    assert!(bucket.admit(true, now).is_err());
    bucket
        .admit(true, now + Duration::from_millis(1500))
        .unwrap();
    let mut bucket = TokenBucket::new(now);
    bucket.pause(Duration::from_secs(60));
    assert!(bucket.admit(false, now).is_err());
    assert!(bucket.admit(true, now).is_ok());
}
#[test]
fn concurrency_reservation_and_fail_fast_queue_are_bounded() {
    let s = Scheduler::default();
    let _a = s.admit(false).unwrap();
    let _b = s.admit(false).unwrap();
    assert_eq!(s.admit(false).err().unwrap().code, ErrorCode::ServerBusy);
    let _interactive = s.admit(true).unwrap();
    assert!(s.admit(true).is_err());
}
#[test]
fn console_ring_bounds_lines_bytes_and_reports_visible_gaps() {
    let mut ring = ConsoleRing::default();
    for i in 0..6000 {
        ring.push(ConsoleLine {
            cursor: i.to_string(),
            text: "hello".into(),
            truncated: false,
        });
    }
    assert_eq!(ring.lines().len(), 5000);
    assert!(ring.take_gap());
    assert!(!ring.take_gap());
    for i in 0..100 {
        ring.push(ConsoleLine {
            cursor: i.to_string(),
            text: "λ".repeat(50_000),
            truncated: false,
        });
    }
    assert!(ring.bytes() <= 2 * 1024 * 1024);
    assert!(ring.lines().len() < 100);
    assert!(ring.lines().back().unwrap().truncated);
    assert!(ring.take_gap());
}

#[test]
fn replacing_a_transport_does_not_reset_its_origin_request_budget() {
    let a = Scheduler::for_origin("https://budget-test.invalid:8443/").unwrap();
    let b = Scheduler::for_origin("https://budget-test.invalid:8443/").unwrap();
    assert!(Arc::ptr_eq(&a, &b));
    for _ in 0..30 {
        drop(a.admit(false).unwrap());
    }
    assert_eq!(b.admit(false).err().unwrap().code, ErrorCode::RateLimited);
    assert!(b.admit(true).is_ok());
}

#[test]
fn unknown_operation_states_do_not_imply_acceptance_or_success() {
    let wire = serde_json::json!({"operation_id":"id","state":"new_state","progress_percent":null,"created_at_ms":1,"updated_at_ms":2,"finished_at_ms":null});
    assert_eq!(
        from_wire::<ServerOperation>(wire).unwrap_err().code,
        ErrorCode::Unsupported
    );
}
