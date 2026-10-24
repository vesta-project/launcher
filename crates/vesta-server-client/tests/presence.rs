use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use vesta_server_client::{
    branding::{decode_icon, BrandingPatch, MAX_ICON_BYTES},
    presence::{MotdDocument, MotdPreview, SleepBlocker, SleepPolicyView, STATES},
    Error, ErrorCode,
};

#[test]
fn sleep_diagnostic_maps_countdown_fields_and_preserves_reason_values() {
    use vesta_server_client::model::from_wire;
    let policy = json!({"enabled":true,"offline_status":true,"wake_on_join":true,"idle_seconds":60,"warning_seconds":30,"start_cooldown_seconds":30});
    for reason in ["counting_down", "warning_sent"] {
        let view: SleepPolicyView = from_wire(json!({"policy":policy,"revision":3,"sleep_blocker":{"reason":reason,"remaining_seconds":42}})).unwrap();
        let ipc = serde_json::to_value(view).unwrap();
        assert_eq!(
            ipc["sleepBlocker"],
            json!({"reason":reason,"remainingSeconds":42})
        );
    }
    let view: SleepPolicyView = from_wire(
        json!({"policy":policy,"revision":3,"sleep_blocker":{"reason":"players_online"}}),
    )
    .unwrap();
    assert_eq!(view.sleep_blocker, Some(SleepBlocker::PlayersOnline));
    let legacy: SleepPolicyView = from_wire(json!({"policy":policy,"revision":3})).unwrap();
    assert_eq!(legacy.sleep_blocker, None);
}

fn document() -> Value {
    let states: serde_json::Map<String,Value>=STATES.iter().map(|s|(s.to_string(),json!({"template":"Hello","version_name":"Vesta","maximum_players":0,"icon_png":null}))).collect();
    json!({"states":states,"normal_icon_png":null,"login_message":"Reconnect"})
}
#[test]
fn document_mapping_preserves_state_keys_and_resolves_null_defaults() {
    let mut document = MotdDocument::from_agent(document()).unwrap();
    document.states.get_mut("crash_loop").unwrap().version_name = None;
    document
        .states
        .get_mut("recovery_required")
        .unwrap()
        .maximum_players = None;
    let wire = document.wire().unwrap();
    assert_eq!(wire["states"]["crash_loop"]["version_name"], "Vesta");
    assert_eq!(wire["states"]["recovery_required"]["maximum_players"], 0);
    let ipc = serde_json::to_value(&document).unwrap();
    assert!(ipc["states"].get("crash_loop").is_some());
    assert!(ipc.get("normalIconPng").is_some());
    document.states.remove("online");
    assert_eq!(document.wire().unwrap_err().code, ErrorCode::InvalidInput);
}
fn preview() -> Value {
    json!({"preview":{"description":{"text":"","extra":[{"text":"Green","color":"green","bold":true,"italic":true},{"text":"\nplain "},{"text":"Gold","color":"gold","underlined":true,"strikethrough":true,"obfuscated":true}]},"plain_lines":["Green","plain Gold"],"favicon_data_uri":"data:image/png;base64,iVBORw==","version_name":"Vesta","maximum_players":20},"placeholders":["server_name","state"],"live_apply":"separate_server_properties_edit_required"})
}
#[test]
fn structured_preview_maps_named_colors_styles_newlines_and_fallback_icon() {
    let result = MotdPreview::from_agent(preview()).unwrap();
    assert_eq!(result.lines, ["Green", "plain Gold"]);
    assert_eq!(result.segments[0].color.as_deref(), Some("#55FF55"));
    assert!(result.segments[0].bold && result.segments[0].italic);
    assert_eq!(result.segments[1].line, 1);
    assert_eq!(result.segments[1].color, None);
    assert!(!result.segments[1].bold);
    assert_eq!(result.segments[2].color.as_deref(), Some("#FFAA00"));
    assert!(
        result.segments[2].underlined
            && result.segments[2].strikethrough
            && result.segments[2].obfuscated
    );
    assert_eq!(result.icon_png.as_deref(), Some("iVBORw=="));
    let mut broken = preview();
    broken["preview"]["plain_lines"] = json!(["wrong"]);
    assert_eq!(
        MotdPreview::from_agent(broken).unwrap_err().code,
        ErrorCode::Unsupported
    );
    let mut broken = preview();
    broken["preview"]["description"]["extra"][0]["color"] = json!("invented");
    assert_eq!(
        MotdPreview::from_agent(broken).unwrap_err().code,
        ErrorCode::Unsupported
    );
}
#[test]
fn branding_patch_and_icon_input_are_bounded() {
    let patch = BrandingPatch {
        name: None,
        description: Some(String::new()),
    };
    assert_eq!(
        patch.wire("0").unwrap(),
        json!({"description":"","expected_revision":"0"})
    );
    assert_eq!(patch.wire("01").unwrap_err().code, ErrorCode::InvalidInput);
    assert!(BrandingPatch::default().wire("0").is_err());
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    bytes.resize(MAX_ICON_BYTES, 0);
    assert_eq!(
        decode_icon(&STANDARD.encode(&bytes)).unwrap().len(),
        MAX_ICON_BYTES
    );
    bytes.push(0);
    assert_eq!(
        decode_icon(&STANDARD.encode(bytes)).unwrap_err().code,
        ErrorCode::InvalidInput
    );
    assert!(decode_icon("data:image/png;base64,aGVsbG8=").is_err());
    assert!(decode_icon("@@@@").is_err());
}
#[test]
fn policy_conflicts_and_template_refusals_use_closed_codes() {
    for code in ["sleep_policy_conflict", "motd_policy_conflict"] {
        assert_eq!(Error::wire(409, code, None).code, ErrorCode::StaleTarget);
    }
    assert_eq!(
        Error::wire(400, "invalid_request", None).code,
        ErrorCode::InvalidInput
    );
}
