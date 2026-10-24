use vesta_server_client::{
    files::{validate_path, validate_sha256},
    scheduler::Scheduler,
    Error, ErrorCode,
};

#[test]
fn portable_game_root_paths_reject_traversal_and_windows_aliases() {
    for path in [
        "",
        "../outside",
        "a/../b",
        "a/./b",
        "/absolute",
        "C:/game/a",
        "C:relative",
        "\\\\host\\share",
        "a\\b",
        "a//b",
        "a/",
        "a\0b",
        "a\nb",
        "COM0.txt",
        "Lpt9",
        "con.txt",
        "aux .txt",
        "a.",
        "a ",
        " space",
        "a:stream",
        ".vesta/secret",
        "config/SERVER.PROPERTIES",
        "foo/whitelist.json",
        "non-ascii-é",
    ] {
        assert_eq!(
            validate_path(path, false).unwrap_err().code,
            ErrorCode::InvalidInput,
            "{path:?}"
        );
    }
    for path in [
        "config/a.txt",
        "ops.json",
        "server.properties",
        "logs/2026-10-22.log.gz",
        "mods/test mod.jar",
        "a+b#c%.txt",
        "normal~name.txt",
    ] {
        validate_path(path, false).unwrap();
    }
    validate_path("", true).unwrap();
    for hash in [
        "",
        "ab",
        &"AA".repeat(32),
        &format!("{}g", "a".repeat(63)),
        &format!("\"{}\"", "ab".repeat(32)),
    ] {
        assert!(validate_sha256(hash).is_err());
    }
    validate_sha256(&"ab".repeat(32)).unwrap();
}

#[test]
fn file_error_mapping_table() {
    use ErrorCode::*;
    for (status, wire, expected) in [
        (412, "precondition_failed", StaleTarget),
        (409, "confirmation_invalid", ConfirmationExpired),
        (409, "idempotency_conflict", Conflict),
        (409, "cursor_gap", Conflict),
        (409, "recovery_required", OutcomeUnknown),
        (400, "invalid_request", InvalidInput),
        (400, "not_compressed", InvalidInput),
        (413, "request_too_large", InvalidInput),
        (416, "range_not_satisfiable", InvalidInput),
        (422, "archive_corrupt", InvalidInput),
        (404, "resource_not_found", NotFound),
        (403, "management_forbidden", Forbidden),
        (503, "temporarily_unavailable", ServerBusy),
    ] {
        assert_eq!(Error::wire(status, wire, None).code, expected);
    }
    assert_eq!(
        Error::wire(503, "temporarily_unavailable", Some(3000)).retry_after_ms,
        Some(3000)
    );
}

#[test]
fn bulk_admission_is_two_global_one_per_server_and_preserves_control_tokens() {
    let first = Scheduler::default();
    let second = Scheduler::default();
    let third = Scheduler::default();
    let one = first.admit_bulk().unwrap();
    assert!(first.admit_bulk().is_err());
    let two = second.admit_bulk().unwrap();
    assert!(third.admit_bulk().is_err());
    drop(one);
    drop(two);
    for _ in 0..100 {
        let _bulk = first.admit_bulk().unwrap();
    }
    for _ in 0..40 {
        let _interactive = first.admit(true).unwrap();
    }
}
