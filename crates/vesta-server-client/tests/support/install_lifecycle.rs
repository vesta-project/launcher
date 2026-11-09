//! Native request/response adapter proof against owned TLS mock, not a server install.
use super::*;
use vesta_server_client::pack::{PackInstallRequest,PackInstallApply};

#[tokio::test]
async fn reviewed_pack_transition_preserves_wire_effects_and_retry_intent() {
    let _owner=OWNER.lock().await;let a=Agent::start().await;
    let plan_route="/api/v3/manage/pack/install/plan";
    let apply_route="/api/v3/manage/pack/install/apply";
    a.set("POST",plan_route,json!({
        "plan_id":"fixture-plan","confirmation_token":"fixture-review",
        "expires_at_ms":vesta_server_client::now_ms()+900000,
        "minecraft_version":"1.21.1","software":"fabric","loader_version":"0.18.4",
        "software_switch_required":false,"software_switch":null,"valid":true,
        "files":[{"path":"mods/renamed.jar.disabled","sha256":"a".repeat(64),"expected_sha256":"b".repeat(64),"conflict":"same_filename","operation":"updated"}],
        "skipped":["config/local.cfg"],"warnings":[{"code":"fixture_warning","rule":"fixture","item":"public-id","detail":"review"}],
        "backup_recommended":true,"removed":[["mods/removed.jar","c".repeat(64)]]
    }));
    let request:PackInstallRequest=serde_json::from_value(json!({"analyze":true,"source":{"source":"provider","provider":"modrinth","projectId":"Jkb29YJU","versionId":"4SKGla61"}})).unwrap();
    let plan=a.client.pack_install_plan(request).await.unwrap();
    assert_eq!(plan.minecraft_version,"1.21.1");assert_eq!(plan.loader_version.as_deref(),Some("0.18.4"));
    assert_eq!(plan.files[0].path,"mods/renamed.jar.disabled");
    assert_eq!(plan.removed[0].0,"mods/removed.jar");
    let planned=a.calls(plan_route);
    assert_eq!(planned.len(),1);
    assert_eq!(planned[0].body,json!({"analyze":true,"source":{"source":"provider","provider":"modrinth","project_id":"Jkb29YJU","version_id":"4SKGla61"}}));
    assert!(planned[0].key.is_none());
    let input:PackInstallApply=serde_json::from_value(json!({
        "planId":plan.plan_id,"confirmationToken":plan.confirmation_token,
        "acknowledgeWarnings":true,"acknowledgeSoftwareSwitch":false,
        "choices":[{"path":"mods/renamed.jar.disabled","choice":"keep"}],"setAsModpack":false
    })).unwrap();
    a.set("POST",apply_route,json!({"state":"queued","pending_ids":[],"software_job_id":"fixture-job","modpack_revision":null}));
    let first=a.client.pack_install_apply(input.clone(),"stable-transition-intent").await.unwrap();
    let retry=a.client.pack_install_apply(input.clone(),"stable-transition-intent").await.unwrap();
    assert_eq!(first.software_job_id,retry.software_job_id);
    let calls=a.calls(apply_route);assert_eq!(calls.len(),2);
    assert!(calls[0].key.is_some());assert_eq!(calls[0].key,calls[1].key);
    assert_eq!(calls[0].body,calls[1].body);
    assert_eq!(calls[0].body["choices"][0],json!({"path":"mods/renamed.jar.disabled","choice":"keep"}));
    assert_eq!(calls[0].body["acknowledge_software_switch"],false);
    assert!(calls[0].body.get("confirmationToken").is_none());
    a.reply("POST",apply_route,409,json!({"code":"software_idempotency_conflict"}));
    let error=a.client.pack_install_apply(input,"stable-transition-intent").await.unwrap_err();
    assert_eq!(error.code,ErrorCode::Conflict);
    assert_eq!(error.reason.as_deref(),Some("software_idempotency_conflict"));
    assert_eq!(a.calls(apply_route).len(),3,"conflict must not silently generate a new intent");
}
