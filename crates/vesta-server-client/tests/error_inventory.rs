use vesta_server_client::Error;

#[test]
fn every_inventoried_wire_code_survives_ipc_serialization() {
    let inventory = include_str!("../../../docs/reviews/2026-10-31-error-inventory.md");
    let mut count = 0;
    for line in inventory.lines().filter(|line| line.starts_with("| `")) {
        let code = line.split('`').nth(1).unwrap();
        let error = Error::wire(500, code, None);
        assert_eq!(error.reason.as_deref(), Some(code), "{code}");
        let wire = serde_json::to_value(&error).unwrap();
        assert_eq!(wire["reason"], code);
        let decoded: Error = serde_json::from_value(wire).unwrap();
        assert_eq!(decoded.reason, error.reason);
        count += 1;
    }
    assert!(count > 250);
}

#[test]
fn wire_reason_rejects_non_codes() {
    for code in ["", "error with secrets", "https://example.com", "bad\ncode", &"a".repeat(97)] {
        assert!(Error::wire(500, code, None).reason.is_none());
    }
}
