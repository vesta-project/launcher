use super::*;
use vesta_server_client::automation::*;

fn definition() -> Value {
    json!({"trigger":{"kind":"manual"},"missed_policy":{"kind":"skip_and_notify"},"steps":[{
 "id":"one","action":{"kind":"script_preset","preset":"safe","params":{"some_key":"literal"}},
 "timeout_secs":60,"retries":{"max_retries":0,"backoff_secs":0},"on_success":{"kind":"end"},"on_failure":{"kind":"fail"}}]})
}
fn workflow() -> Value {
    json!({"id":"w-1","name":"Test","enabled":true,"execution_principal_id":"owner","created_at_ms":1,"updated_at_ms":2,"revision":1})
}
fn run() -> Value {
    json!({"id":"r-1","workflow_id":"w-1","workflow_revision":1,"execution_principal_id":"owner",
 "trigger":{"kind":"schedule","occurrence":1791115200000_i64},"state":"future_state","current_step":0,"attempt":0,
 "next_wake_at_ms":null,"started_at_ms":1,"finished_at_ms":null,"outcome_code":null})
}
#[tokio::test]
async fn all_automation_routes_use_typed_projections_and_device_intent_keys() {
    let _owner = OWNER.lock().await;
    let a = Agent::start().await;
    a.set(
        "GET",
        "/api/v3/manage/session",
        json!({"server_id":"server-1","principal_id":"owner","roles":[{"rank":20},{"rank":100}]}),
    );
    let caller = a.client.automation_self().await.unwrap();
    assert_eq!(caller.principal_id, "owner");
    assert_eq!(caller.rank, 100);
    a.set(
        "GET",
        "/api/v3/manage/automation/workflows?limit=100",
        json!({"workflows":[workflow()],"next_after":"w-1"}),
    );
    let page = a.client.automation_workflows(None).await.unwrap();
    assert_eq!(page.items[0].execution_principal_id, "owner");
    assert_eq!(page.next_after.as_deref(), Some("w-1"));
    a.set(
        "GET",
        "/api/v3/manage/automation/workflows?limit=100&after=w-1",
        json!({"workflows":[],"next_after":null}),
    );
    assert!(a
        .client
        .automation_workflows(Some("w-1"))
        .await
        .unwrap()
        .items
        .is_empty());
    let mut detail = workflow();
    detail["definition"] = definition();
    a.set(
        "GET",
        "/api/v3/manage/automation/workflows/w-1",
        json!({"workflow":detail}),
    );
    let detail = a.client.automation_workflow("w-1").await.unwrap();
    let draft = WorkflowDraft {
        name: detail.summary.name,
        execution_principal_id: detail.summary.execution_principal_id,
        definition: detail.definition,
    };
    a.reply(
        "POST",
        "/api/v3/manage/automation/workflows",
        201,
        json!({"kind":"workflow","workflow_id":"w-1","revision":1}),
    );
    assert_eq!(
        a.client
            .automation_workflow_create(draft.clone(), true, "create")
            .await
            .unwrap()
            .revision,
        1
    );
    let call = a
        .calls("/api/v3/manage/automation/workflows")
        .pop()
        .unwrap();
    assert_eq!(
        call.key,
        Some(device_intent_key("server-1", "device-1", "create").unwrap())
    );
    assert_eq!(call.body["definition"], definition());
    assert_eq!(call.body["execution_principal_id"], "owner");
    assert_eq!(call.body["enabled"], true);
    a.set(
        "PUT",
        "/api/v3/manage/automation/workflows/w-1",
        json!({"kind":"workflow","workflow_id":"w-1","revision":2}),
    );
    assert_eq!(
        a.client
            .automation_workflow_update("w-1", 1, draft, "update")
            .await
            .unwrap()
            .revision,
        2
    );
    let call = a
        .calls("/api/v3/manage/automation/workflows/w-1")
        .pop()
        .unwrap();
    assert_eq!(call.method, "PUT");
    assert_eq!(call.body["expected_revision"], 1);
    assert!(call.body.get("enabled").is_none());
    a.set(
        "POST",
        "/api/v3/manage/automation/workflows/w-1/enabled",
        json!({"kind":"workflow","workflow_id":"w-1","revision":3}),
    );
    a.client
        .automation_workflow_enabled("w-1", 2, false, "enabled")
        .await
        .unwrap();
    assert_eq!(
        a.calls("/api/v3/manage/automation/workflows/w-1/enabled")[0].body,
        json!({"expected_revision":2,"enabled":false})
    );
    a.reply(
        "POST",
        "/api/v3/manage/automation/workflows/w-1/run",
        202,
        json!({"kind":"run","workflow_id":"w-1","run_id":"r-1","skipped":false}),
    );
    assert_eq!(
        a.client
            .automation_workflow_run("w-1", "run")
            .await
            .unwrap()
            .run_id
            .as_deref(),
        Some("r-1")
    );
    assert_eq!(
        a.calls("/api/v3/manage/automation/workflows/w-1/run")[0].body,
        json!({})
    );
    for route in [
        "/api/v3/manage/automation/runs?limit=100&after=r-0",
        "/api/v3/manage/automation/workflows/w-1/runs?limit=100&after=r-0",
    ] {
        a.set("GET", route, json!({"runs":[run()],"next_after":null}));
    }
    let runs = a.client.automation_runs(Some("r-0")).await.unwrap();
    assert_eq!(runs.items[0].state, "future_state");
    assert_eq!(
        serde_json::to_value(&runs.items[0]).unwrap()["trigger"],
        json!({"kind":"schedule","occurrenceMs":1791115200000_i64})
    );
    assert_eq!(
        a.client
            .automation_workflow_runs("w-1", Some("r-0"))
            .await
            .unwrap()
            .items
            .len(),
        1
    );
    let mut detail = run();
    detail["definition"] = definition();
    a.set(
        "GET",
        "/api/v3/manage/automation/runs/r-1",
        json!({"run":detail}),
    );
    assert_eq!(
        a.client
            .automation_run("r-1")
            .await
            .unwrap()
            .summary
            .workflow_revision,
        1
    );
    a.set("GET","/api/v3/manage/automation/runs/r-1/steps?limit=100&after=0",json!({"steps":[{
 "run_id":"r-1","index":1,"attempt":0,"cursor":6,"state":"future_state","operation_reference":null,"output":{"raw_key":{"then_step":1}},
 "error_code":null,"started_at_ms":1,"finished_at_ms":null}],"next_after":6}));
    let steps = a
        .client
        .automation_run_steps("r-1", Some("0"))
        .await
        .unwrap();
    assert_eq!(steps.next_after.as_deref(), Some("6"));
    assert_eq!(steps.items[0].cursor, "6");
    assert_eq!(steps.items[0].output, json!({"raw_key":{"then_step":1}}));
    a.reply(
        "POST",
        "/api/v3/manage/automation/runs/r-1/discard",
        409,
        json!({"code":"automation_conflict"}),
    );
    assert_eq!(
        a.client
            .automation_run_discard("r-1", "discard")
            .await
            .unwrap_err()
            .code,
        ErrorCode::Conflict
    );
    a.set(
        "POST",
        "/api/v3/manage/automation/runs/r-1/discard",
        json!({"kind":"discarded","run_id":"r-1","discarded":true,"operation_cancelled":false}),
    );
    a.client
        .automation_run_discard("r-1", "discard-ok")
        .await
        .unwrap();
    a.set(
        "DELETE",
        "/api/v3/manage/automation/workflows/w-1",
        json!({"kind":"deleted","workflow_id":"w-1","deleted":true}),
    );
    a.client
        .automation_workflow_delete("w-1", 3, "delete")
        .await
        .unwrap();
    let call = a
        .calls("/api/v3/manage/automation/workflows/w-1")
        .pop()
        .unwrap();
    assert_eq!(call.method, "DELETE");
    assert_eq!(call.body, json!({"expected_revision":3}));
    for call in &a.state.lock().unwrap().calls {
        if call.route.contains("/automation/") && call.method != "GET" {
            assert!(call.key.is_some());
        }
    }
}
