use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use vesta_server_client::{
    branding::BrandingPatch,
    presence::{MotdDocument, STATES},
};

fn document() -> Value {
    let states:serde_json::Map<String,Value>=STATES.iter().map(|s|(s.to_string(),json!({"template":"Hello","version_name":"Vesta","maximum_players":20,"icon_png":null}))).collect();
    json!({"states":states,"normal_icon_png":null,"login_message":"Reconnect"})
}
#[tokio::test]
async fn presence_routes_revisions_receipts_and_preview_refusals() {
    let _owner = OWNER.lock().await;
    let a = Agent::start().await;
    let policy = json!({"enabled":false,"offline_status":false,"wake_on_join":false,"idle_seconds":600,"warning_seconds":30,"start_cooldown_seconds":30});
    a.set(
        "GET",
        "/api/v3/manage/sleep/policy",
        json!({"policy":policy,"revision":0,"game_port_known":true,"sleep_blocker":{"reason":"disabled"}}),
    );
    let sleep = a.client.sleep_policy().await.unwrap();
    assert_eq!(sleep.revision, 0);
    assert_eq!(
        sleep.sleep_blocker,
        Some(vesta_server_client::presence::SleepBlocker::Disabled)
    );
    a.set(
        "PUT",
        "/api/v3/manage/sleep/policy",
        json!({"policy":policy,"revision":1,"game_port_known":true}),
    );
    assert_eq!(
        a.client
            .sleep_policy_update(sleep.policy.clone(), 0, "sleep")
            .await
            .unwrap()
            .revision,
        1
    );
    let call = a.calls("/api/v3/manage/sleep/policy").pop().unwrap();
    assert_eq!(call.body, json!({"policy":policy,"expected_revision":0}));
    assert_eq!(
        call.key,
        Some(device_intent_key("server-1", "device-1", "sleep").unwrap())
    );
    a.reply(
        "PUT",
        "/api/v3/manage/sleep/policy",
        409,
        json!({"code":"sleep_policy_conflict"}),
    );
    assert_eq!(
        a.client
            .sleep_policy_update(sleep.policy, 0, "sleep-stale")
            .await
            .unwrap_err()
            .code,
        ErrorCode::StaleTarget
    );
    a.set("GET","/api/v3/manage/motd/policy",json!({"document":document(),"revision":null,"live_apply":"separate_server_properties_edit_required"}));
    let motd = a.client.motd_policy().await.unwrap();
    assert!(motd.revision.is_none());
    a.set(
        "PUT",
        "/api/v3/manage/motd/policy",
        json!({"revision":9007199254740993_i64,"offline_apply":"immediate"}),
    );
    let saved = a
        .client
        .motd_policy_update(motd.document.clone(), Some("9007199254740992"), "motd")
        .await
        .unwrap();
    assert_eq!(saved.revision.as_deref(), Some("9007199254740993"));
    let call = a.calls("/api/v3/manage/motd/policy").pop().unwrap();
    assert_eq!(call.body["expected_revision"], 9007199254740992_i64);
    assert!(call.body["document"]["states"].get("crash_loop").is_some());
    a.set("POST","/api/v3/manage/motd/preview",json!({"preview":{"description":{"text":"","extra":[{"text":"Hello","color":"aqua"}]},"plain_lines":["Hello"],"favicon_data_uri":"data:image/png;base64,aWNvbg=="},"placeholders":["server_name"]}));
    let preview = a
        .client
        .motd_preview("crash_loop", motd.document.clone())
        .await
        .unwrap();
    assert_eq!(preview.lines, ["Hello", ""]);
    assert_eq!(preview.segments[0].color.as_deref(), Some("#55FFFF"));
    assert!(a.calls("/api/v3/manage/motd/preview")[0].key.is_none());
    a.reply(
        "POST",
        "/api/v3/manage/motd/preview",
        400,
        json!({"code":"invalid_request"}),
    );
    assert_eq!(
        a.client
            .motd_preview("offline", motd.document.clone())
            .await
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
    a.reply(
        "PUT",
        "/api/v3/manage/motd/policy",
        409,
        json!({"code":"motd_policy_conflict"}),
    );
    assert_eq!(
        a.client
            .motd_policy_update(motd.document, None, "motd-stale")
            .await
            .unwrap_err()
            .code,
        ErrorCode::StaleTarget
    );
    assert!(MotdDocument::from_agent(document()).is_ok());
}
#[tokio::test]
async fn branding_and_icon_binary_routes_use_native_conditions_and_allowlisted_dtos() {
    let _owner = OWNER.lock().await;
    let a = Agent::start().await;
    let oversized = STANDARD.encode(vec![0; vesta_server_client::branding::MAX_ICON_BYTES + 1]);
    assert_eq!(
        a.client
            .icon_set(&oversized, "oversized")
            .await
            .unwrap_err()
            .code,
        ErrorCode::InvalidInput
    );
    assert!(a.calls("/api/v3/manage/server/icon").is_empty());
    a.set("GET","/api/v3/manage/server",json!({"name":"Server","description":null,"revision":"0","server_id":"server-1","private":"hidden"}));
    let branding = a.client.branding().await.unwrap();
    assert!(branding.description.is_none());
    assert!(!serde_json::to_string(&branding).unwrap().contains("hidden"));
    a.set(
        "PATCH",
        "/api/v3/manage/server",
        json!({"name":"Server","description":"New","revision":"1"}),
    );
    let saved = a
        .client
        .branding_update(
            BrandingPatch {
                name: None,
                description: Some("New".into()),
            },
            "0",
            "branding",
        )
        .await
        .unwrap();
    assert_eq!(saved.revision, "1");
    let call = a.calls("/api/v3/manage/server").pop().unwrap();
    assert_eq!(call.method, "PATCH");
    assert_eq!(
        call.body,
        json!({"description":"New","expected_revision":"0"})
    );
    a.set(
        "PATCH",
        "/api/v3/manage/devices/device-1",
        json!({"id":"device-1","name":"Desk"}),
    );
    assert_eq!(
        a.client
            .device_rename("device-1", "Desk", "rename")
            .await
            .unwrap()
            .name,
        "Desk"
    );
    assert_eq!(
        a.calls("/api/v3/manage/devices/device-1")[0].body,
        json!({"name":"Desk"})
    );
    assert!(a.client.icon().await.unwrap().is_none());
    let png = STANDARD.encode(b"\x89PNG\r\n\x1a\nfirst");
    a.client.icon_set(&png, "icon-create").await.unwrap();
    assert_eq!(a.client.icon().await.unwrap(), Some(png));
    let png = STANDARD.encode(b"\x89PNG\r\n\x1a\nsecond");
    a.client.icon_set(&png, "icon-replace").await.unwrap();
    assert_eq!(a.client.icon().await.unwrap(), Some(png));
    a.client.icon_clear("icon-clear").await.unwrap();
    a.client.icon_clear("icon-empty").await.unwrap();
    assert!(a.client.icon().await.unwrap().is_none());
    let calls = a.calls("/api/v3/manage/server/icon");
    assert_eq!(calls.iter().filter(|c| c.method == "PUT").count(), 2);
    assert_eq!(calls.iter().filter(|c| c.method == "DELETE").count(), 1);
    a.state.lock().unwrap().icon_conflict = true;
    let png = STANDARD.encode(b"\x89PNG\r\n\x1a\nconflicted");
    assert_eq!(
        a.client.icon_set(&png, "icon-race").await.unwrap_err().code,
        ErrorCode::StaleTarget
    );
    assert_eq!(
        a.calls("/api/v3/manage/server/icon")
            .iter()
            .filter(|c| c.method == "PUT")
            .count(),
        3
    );
}
#[tokio::test]
async fn pagination_has_a_four_page_budget_and_snapshot_detail_matches_agent() {
    let _owner = OWNER.lock().await;
    let a = Agent::start().await;
    for resource in ["invitations", "devices"] {
        for offset in 0..4 {
            let mut value = json!({"next_offset":offset+1});
            value[resource] = json!([]);
            a.set(
                "GET",
                &format!("/api/v3/manage/{resource}?offset={offset}&limit=100"),
                value,
            );
        }
    }
    assert_eq!(
        a.client.invitations().await.unwrap_err().code,
        ErrorCode::ServerBusy
    );
    assert_eq!(
        a.client.devices().await.unwrap_err().code,
        ErrorCode::ServerBusy
    );
    for page in 0..4 {
        let route = if page == 0 {
            "/api/v3/manage/backups/snapshots?profile=daily&limit=100".into()
        } else {
            format!("/api/v3/manage/backups/snapshots?profile=daily&before=c{page}&limit=100")
        };
        a.set(
            "GET",
            &route,
            json!({"snapshots":[],"next_before":format!("c{}",page+1)}),
        );
    }
    assert_eq!(
        a.client.backup_snapshots("daily").await.unwrap_err().code,
        ErrorCode::ServerBusy
    );
    let id = "a".repeat(32);
    a.set("GET",&format!("/api/v3/manage/backups/snapshots/{id}?profile=daily"),json!({"profile":"daily","snapshot":{"id":id,"time":"2026-10-22T00:00:00Z","size_bytes":null,"added_bytes":null,"file_count":null,"tags":["vesta"]}}));
    let detail = a.client.backup_snapshot("daily", &id).await.unwrap();
    assert_eq!(detail.id, id);
    assert_eq!(detail.size_bytes, None);
    let calls = a.state.lock().unwrap().calls.clone();
    for resource in ["invitations?", "devices?", "backups/snapshots?"] {
        assert_eq!(
            calls.iter().filter(|c| c.route.contains(resource)).count(),
            4
        );
    }
}
