use serde_json::{json, Value};
use vesta_server_client::{model::ServerEvent, operations::decode};

fn operation(details: Value, principal: Option<&str>) -> Value {
    let mut wire = json!({
        "operation_id":"op-1", "state":"succeeded", "progress_percent":100,
        "created_at_ms":1, "updated_at_ms":2, "finished_at_ms":2,
    });
    wire.as_object_mut()
        .unwrap()
        .extend(details.as_object().unwrap().clone());
    serde_json::to_value(decode(wire, principal).unwrap()).unwrap()
}

#[test]
fn older_agents_and_unavailable_summaries_still_decode() {
    let old = operation(json!({"unknown_addition":true}), None);
    for key in ["kind", "actor", "summary", "outcome"] {
        assert!(old[key].is_null());
    }
    for summary in [Value::Null, json!({"details_redacted":true})] {
        let op = operation(json!({"kind":"players.moderate", "summary":summary}), None);
        assert!(op["summary"].is_null());
    }
}

#[test]
fn console_details_and_principal_self_are_mapped_without_changing_text() {
    let details = json!({
        "kind":"console.command",
        "actor":{"principal_id":"me", "display_name":"Alex", "device_name":"Other device"},
        "summary":{"command":"say Hello, players!"}, "summary_purged":false,
        "outcome":"stdin_written",
    });
    let op = operation(details.clone(), Some("me"));
    assert_eq!(op["kind"], "console.command");
    assert_eq!(
        op["actor"],
        json!({"kind":"principal", "principalId":"me", "displayName":"Alex", "deviceName":"Other device", "self":true})
    );
    assert_eq!(
        op["summary"],
        json!({"kind":"console.command", "command":"say Hello, players!"})
    );
    assert_eq!(op["outcome"], "stdin_written");
    for principal in [None, Some("someone-else")] {
        assert_eq!(
            operation(details.clone(), principal)["actor"]["self"],
            false
        );
    }
    let mut no_device = details;
    no_device["actor"]
        .as_object_mut()
        .unwrap()
        .remove("device_name");
    assert!(operation(no_device, Some("me"))["actor"]["deviceName"].is_null());
}

#[test]
fn redacted_command_and_purged_input_are_distinct_and_never_rebuilt() {
    let redacted = operation(
        json!({"kind":"console.command", "summary":{"command_redacted":true}}),
        None,
    );
    assert_eq!(
        redacted["summary"],
        json!({"kind":"console.command", "command":null})
    );
    let purged = operation(
        json!({"kind":"console.command", "summary":null, "summary_purged":true}),
        None,
    );
    assert_eq!(purged["summary"], json!({"kind":"purged"}));
    // Purge/redaction flags dominate text, even if a future agent includes both.
    assert_eq!(
        operation(
            json!({"kind":"console.command", "summary":{"command":"secret", "command_redacted":true}}),
            None
        )["summary"]["command"],
        Value::Null
    );
    assert_eq!(
        operation(
            json!({"kind":"console.command", "summary":{"command":"secret"}, "summary_purged":true}),
            None
        )["summary"],
        json!({"kind":"purged"})
    );
}

#[test]
fn moderation_preserves_reason_and_camel_case_duration() {
    let op = operation(
        json!({"kind":"players.moderate", "summary":{"action":"ban", "player":"Alex", "reason":"Griefing", "duration_seconds":3600}}),
        None,
    );
    assert_eq!(
        op["summary"],
        json!({"kind":"players.moderate", "action":"ban", "player":"Alex", "reason":"Griefing", "durationSeconds":3600})
    );
    let op = operation(
        json!({"kind":"players.moderate", "summary":{"action":"pardon", "player":"Alex"}}),
        None,
    );
    assert!(op["summary"]["reason"].is_null());
    assert!(op["summary"]["durationSeconds"].is_null());
}

#[test]
fn lifecycle_action_comes_from_kind_and_generations_stay_strings() {
    let generation = "0123456789abcdef0123456789abcdef";
    for action in ["start", "stop", "restart", "kill"] {
        let op = operation(
            json!({"kind":format!("lifecycle.{action}"), "summary":{"target_generation":null, "result_generation":generation, "confirmed":true}}),
            None,
        );
        assert_eq!(
            op["summary"],
            json!({"kind":"lifecycle", "action":action, "targetGeneration":null, "resultGeneration":generation})
        );
    }
    // Sleep and future bindings have no corresponding TS summary variant.
    for kind in ["lifecycle.sleep", "future.operation", "other"] {
        let op = operation(
            json!({"kind":kind, "summary":{"target_generation":generation}}),
            None,
        );
        assert_eq!(op["kind"], kind);
        assert!(op["summary"].is_null());
    }
}

#[test]
fn workflow_and_system_actors_survive_operation_event_serialization() {
    for (kind, name) in [("workflow", "Vesta automation"), ("system", "Vesta agent")] {
        let op = operation(
            json!({"kind":"other", "actor":{"kind":kind, "name":name}, "outcome":"future_safe_code"}),
            Some("me"),
        );
        let event = ServerEvent::Operation {
            operation: serde_json::from_value(op).unwrap(),
        };
        let event = serde_json::to_value(event).unwrap();
        assert_eq!(
            event["operation"]["actor"],
            json!({"kind":kind, "name":name})
        );
        assert_eq!(event["operation"]["outcome"], "future_safe_code");
    }
}
