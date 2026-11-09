//! Opt-in cross-device endpoint test. Temporary account/runtime fixtures only.
//! Never discovers hosts, launches games, or accepts an unexpected certificate.
use base64::{Engine, engine::general_purpose::STANDARD};
use reqwest::Method;
use serde_json::{Value, json};
use std::{
    fs,
    sync::Arc,
    time::{Duration, Instant},
};
use vesta_server_client::{
    Client, Error, ErrorCode,
    auth::{DeviceSigner, Ed25519Signer},
    endpoint::Endpoint,
    transport::Transport,
};
const ROOT: &str = "C:/Users/eatha/AppData/Local/Temp/vesta-remote-integration-20261109";
fn signer(label: &str) -> Arc<Ed25519Signer> {
    Arc::new(Ed25519Signer::from_seed(
        [if label == "owner" { 31 } else { 32 }; 32],
    ))
}
fn transport(pin: &str) -> Arc<Transport> {
    Transport::new(
        Endpoint::parse("https://localhost:18443/").unwrap(),
        Some(pin.into()),
    )
    .unwrap()
}
fn client(ids: &Value, label: &str, pin: &str) -> Arc<Client> {
    Client::new(
        transport(pin),
        ids[label]["server_id"].as_str().unwrap().into(),
        ids[label]["device_id"].as_str().unwrap().into(),
        signer(label),
    )
}
fn ok<T>(label: &str, start: Instant, result: Result<T, Error>) -> T {
    println!(
        "REMOTE_RESULT {}",
        json!({"check":label,"ms":start.elapsed().as_secs_f64()*1000.,"passed":result.is_ok(),"error":result.as_ref().err().map(|e|format!("{:?}:{}",e.code,e.reason.as_deref().unwrap_or("")))})
    );
    match result {
        Ok(v) => v,
        Err(_) => panic!("Remote check failed; see redacted result: {label}"),
    }
}
fn denied<T>(label: &str, result: Result<T, Error>, code: ErrorCode) {
    let e = match result {
        Err(e) => e,
        Ok(_) => panic!("Forbidden request succeeded: {label}"),
    };
    println!(
        "REMOTE_RESULT {}",
        json!({"check":label,"passed":e.code==code,"code":format!("{:?}",e.code),"reason":e.reason})
    );
    assert_eq!(e.code, code, "{label}");
}
async fn mutation(c: &Client, route: &str, body: Value, intent: &str) -> Value {
    ok(
        route,
        Instant::now(),
        c.request(
            Method::POST,
            &format!("/api/v3/manage/{route}"),
            Some(body),
            Some(intent),
            true,
            "",
        )
        .await,
    )
}
async fn terminal(c: &Client, id: &str, label: &str, limit: Duration) -> Value {
    let start = Instant::now();
    let mut previous = String::new();
    loop {
        c.transport.invalidate_reads();
        let jobs = ok(
            "provider phase job poll",
            Instant::now(),
            c.software_jobs(true).await,
        );
        let j = jobs
            .iter()
            .find(|j| j.id == id)
            .expect("accepted job must be visible");
        if j.state != previous {
            println!(
                "REMOTE_JOB {}",
                json!({"phase":label,"id":id,"state":j.state,"elapsed_s":start.elapsed().as_secs_f64(),"error":j.error})
            );
            previous = j.state.clone();
        }
        if matches!(
            j.state.as_str(),
            "succeeded" | "failed" | "recovery_required"
        ) {
            let v = serde_json::to_value(j).unwrap();
            fs::write(
                format!("{ROOT}/{label}-job.json"),
                serde_json::to_vec(&v).unwrap(),
            )
            .unwrap();
            assert_eq!(
                j.state, "succeeded",
                "{label}: persisted failure {:?}; no blind retry",
                j.error
            );
            return v;
        }
        assert!(
            start.elapsed() < limit,
            "{label}: bounded wait expired; job not automatically cancelled"
        );
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}
#[tokio::test]
#[ignore = "Requires exact owned remote container and coordinator-started SSH byte relay"]
async fn remote_endpoint_batch() {
    assert_eq!(
        fs::read_to_string(format!("{ROOT}/OWNED-BY-VESTA-AUDIT")).unwrap(),
        "remote-integration-20261109\n"
    );
    let mode = std::env::var("VESTA_REMOTE_TEST_MODE").expect("explicit mode required");
    if mode == "keys" {
        fs::write(format!("{ROOT}/fixture-public-keys.json"),serde_json::to_vec(&json!({"owner":signer("owner").public_key(),"viewer":signer("viewer").public_key()})).unwrap()).unwrap();
        println!("REMOTE_PUBLIC_KEYS_CREATED");
        return;
    }
    let ids: Value =
        serde_json::from_slice(&fs::read(format!("{ROOT}/fixture-identities.json")).unwrap())
            .unwrap();
    let pin = fs::read_to_string(format!("{ROOT}/tls-fingerprint.txt")).unwrap();
    let pin = pin.trim();
    let owner = client(&ids, "owner", pin);
    let viewer = client(&ids, "viewer", pin);
    if mode == "smoke" {
        denied(
            "anonymous management",
            owner
                .transport
                .request(
                    Method::GET,
                    "/api/v3/manage/server/status",
                    None,
                    None,
                    None,
                    true,
                )
                .await,
            ErrorCode::CredentialsRejected,
        );
        let state = ok(
            "owner challenge/session/status",
            Instant::now(),
            owner.status(true).await,
        );
        assert_eq!(state.state, "stopped");
        ok(
            "viewer challenge/session/status",
            Instant::now(),
            viewer.status(true).await,
        );
        // model::Error::response maps management_forbidden to Forbidden;
        // NoManagementAccess is reserved for management_unavailable/pack_access_denied.
        denied(
            "viewer cannot plan installation",
            viewer
                .request(
                    Method::POST,
                    "/api/v3/manage/pack/install/plan",
                    Some(json!({})),
                    None,
                    true,
                    "",
                )
                .await,
            ErrorCode::Forbidden,
        );
        denied(
            "owner malformed plan validation",
            owner
                .request(
                    Method::POST,
                    "/api/v3/manage/pack/install/plan",
                    Some(json!({})),
                    None,
                    true,
                    "",
                )
                .await,
            ErrorCode::InvalidInput,
        );
        let wrong = Client::new(
            transport(pin),
            "different-server".into(),
            ids["owner"]["device_id"].as_str().unwrap().into(),
            signer("owner"),
        );
        denied(
            "server ID mismatch",
            wrong.status(true).await,
            ErrorCode::FingerprintMismatch,
        );
        let wrong = Client::new(
            transport(&"0".repeat(64)),
            ids["owner"]["server_id"].as_str().unwrap().into(),
            ids["owner"]["device_id"].as_str().unwrap().into(),
            signer("owner"),
        );
        denied(
            "TLS pin mismatch",
            wrong.status(true).await,
            ErrorCode::FingerprintMismatch,
        );
        let issued = ok(
            "owner creates single-use invitation",
            Instant::now(),
            owner
                .invitation_create(
                    "maintainer",
                    10,
                    &format!("remote-invitation-{}", vesta_server_client::now_ms()),
                )
                .await,
        );
        let code = issued.code.as_str();
        denied(
            "anonymous invitation cannot authenticate",
            Client::pair(
                &owner.transport,
                ids["owner"]["server_id"].as_str().unwrap(),
                code,
                signer("viewer").as_ref(),
            )
            .await,
            ErrorCode::PairCodeInvalid,
        );
        let enrollment = ok(
            "authenticated invitation redemption",
            Instant::now(),
            viewer.redeem_pairing(code, "remote-viewer").await,
        );
        assert_eq!(enrollment.device_id, ids["viewer"]["device_id"]);
        assert_eq!(enrollment.principal_id, ids["viewer"]["principal_id"]);
        denied(
            "invitation replay",
            viewer.redeem_pairing(code, "remote-viewer").await,
            ErrorCode::PairCodeInvalid,
        );
        ok(
            "content inventory",
            Instant::now(),
            owner.content_inventory().await,
        );
        let draft = ok(
            "draft read",
            Instant::now(),
            owner.get("pack/draft", true, "").await,
        );
        let revision = draft["draft"]["revision"]
            .as_str()
            .or_else(|| draft["revision"].as_str())
            .unwrap_or("0");
        let change=mutation(&owner,"pack/files/mutate",json!({"expected_revision":revision,"change":{"operation":"write","root":"overrides","path":"config/remote-managed.json","content_base64":STANDARD.encode(b"{\"remote\":true}\n")}}),"remote-owned-file-0001").await;
        let revision = change["revision"].as_str().unwrap();
        let request = serde_json::from_value(
            json!({"analyze":true,"source":{"source":"draft","revision":revision}}),
        )
        .unwrap();
        let plan = ok(
            "install plan",
            Instant::now(),
            owner.pack_install_plan(request).await,
        );
        assert!(plan.valid);
        assert!(
            !plan.software_switch_required,
            "fixture runtime must match; no runtime download allowed"
        );
        assert!(
            plan.files
                .iter()
                .any(|f| f.path == "config/remote-managed.json")
        );
        let apply = vesta_server_client::pack::PackInstallApply {
            plan_id: plan.plan_id,
            confirmation_token: plan.confirmation_token,
            acknowledge_warnings: true,
            acknowledge_software_switch: false,
            choices: plan
                .files
                .into_iter()
                .filter(|f| f.conflict.is_some())
                .map(|f| vesta_server_client::pack::PackInstallChoice {
                    path: f.path,
                    choice: "replace".into(),
                })
                .collect(),
            set_as_modpack: false,
        };
        let accepted = ok(
            "install apply accepted",
            Instant::now(),
            owner
                .pack_install_apply(apply.clone(), "remote-owned-apply-0001")
                .await,
        );
        let id = accepted.software_job_id.expect("accepted job");
        let retry = ok(
            "identical Apply retry",
            Instant::now(),
            owner
                .pack_install_apply(apply, "remote-owned-apply-0001")
                .await,
        );
        assert_eq!(retry.software_job_id.as_deref(), Some(id.as_str()));
        let started = Instant::now();
        let mut observed = Vec::new();
        loop {
            owner.transport.invalidate_reads();
            let jobs = ok(
                "job status",
                Instant::now(),
                owner.software_jobs(true).await,
            );
            let job = jobs.iter().find(|j| j.id == id).expect("job persisted");
            if observed.last() != Some(&job.state) {
                observed.push(job.state.clone());
            }
            if job.state == "succeeded" {
                break;
            }
            assert!(
                !matches!(job.state.as_str(), "failed" | "recovery_required"),
                "job failed, error {:?}",
                job.error
            );
            assert!(started.elapsed() < Duration::from_secs(60));
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        fs::write(
            format!("{ROOT}/accepted-job.json"),
            serde_json::to_vec(&json!({"id":id,"observed_states":observed})).unwrap(),
        )
        .unwrap();
        println!("REMOTE_INSTALL_JOB_SUCCEEDED");
    } else if mode == "reopen" {
        ok(
            "authenticated client retained before restart",
            Instant::now(),
            owner.status(true).await,
        );
        let ready = format!("{ROOT}/client-awaiting-restart");
        let signal = format!("{ROOT}/service-reopened.signal");
        assert!(
            !std::path::Path::new(&ready).exists() && !std::path::Path::new(&signal).exists(),
            "Use this finite stage once per owned fixture"
        );
        fs::write(ready, b"remote-integration-20261109\n").unwrap();
        let deadline = Instant::now() + Duration::from_secs(90);
        while !std::path::Path::new(&signal).exists() {
            assert!(
                Instant::now() < deadline,
                "Coordinator restart signal timed out"
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        owner.transport.invalidate_reads();
        ok(
            "renew authentication after service reopen",
            Instant::now(),
            owner.status(true).await,
        );
        let id: Value =
            serde_json::from_slice(&fs::read(format!("{ROOT}/accepted-job.json")).unwrap())
                .unwrap();
        let jobs = ok(
            "persisted jobs after reopen",
            Instant::now(),
            owner.software_jobs(true).await,
        );
        assert_eq!(
            jobs.iter().find(|j| j.id == id["id"]).unwrap().state,
            "succeeded"
        );
        ok(
            "identity continuity after reopen",
            Instant::now(),
            owner.capabilities(None).await,
        );
        ok(
            "viewer before revocation",
            Instant::now(),
            viewer.status(true).await,
        );
        ok(
            "owner revokes temporary device",
            Instant::now(),
            owner
                .device_revoke(
                    ids["viewer"]["device_id"].as_str().unwrap(),
                    "remote-device-revoke-0001",
                )
                .await,
        );
        viewer.transport.invalidate_reads();
        denied(
            "revoked device cached session rejected",
            viewer.status(true).await,
            ErrorCode::CredentialsRejected,
        );
        let fresh = client(&ids, "viewer", pin);
        denied(
            "revoked device cannot renew",
            fresh.status(true).await,
            ErrorCode::CredentialsRejected,
        );
    } else if mode == "java" {
        let before = ok(
            "Java inventory before managed download",
            Instant::now(),
            owner.java_inventory().await,
        );
        println!(
            "REMOTE_JAVA {}",
            json!({"runtimes":before.runtimes.len(),"selected_major":before.selected.as_ref().map(|x|x.major)})
        );
        let download = ok(
            "Java21 download accepted",
            Instant::now(),
            owner.java_download(21, "remote-java21-download-0001").await,
        );
        terminal(
            &owner,
            &download.id,
            "java21-download",
            Duration::from_secs(600),
        )
        .await;
        owner.transport.invalidate_reads();
        let inventory = ok(
            "managed Java inventory",
            Instant::now(),
            owner.java_inventory().await,
        );
        let java = inventory
            .runtimes
            .iter()
            .find(|j| j.managed && j.major == 21)
            .expect("verified managed Java21");
        println!(
            "REMOTE_JAVA {}",
            json!({"major":java.major,"version":java.version,"vendor":java.vendor,"managed":java.managed,"arch":java.arch})
        );
        let selected = ok(
            "Java21 selection accepted",
            Instant::now(),
            owner
                .java_select(Some(java.id.clone()), None, "remote-java21-select-0001")
                .await,
        );
        terminal(
            &owner,
            &selected.id,
            "java21-select",
            Duration::from_secs(60),
        )
        .await;
        owner.transport.invalidate_reads();
        assert_eq!(
            owner
                .java_inventory()
                .await
                .unwrap()
                .selected
                .unwrap()
                .major,
            21
        );
    } else if mode == "provider" {
        let initial = ok(
            "check previous preparation completed",
            Instant::now(),
            owner.get("pack/draft", true, "").await,
        );
        assert!(
            initial["install_progress"].is_null(),
            "A previous preparation is still active; no overlapping retry"
        );
        let start = Instant::now();
        let request=serde_json::from_value(json!({"analyze":true,"source":{"source":"provider","provider":"modrinth","projectId":"Jkb29YJU","versionId":"4SKGla61"}})).unwrap();
        let observer = owner.clone();
        let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel::<()>();
        let monitor = tokio::spawn(async move {
            loop {
                tokio::select! {_= &mut stop_rx=>break,_=tokio::time::sleep(Duration::from_secs(3))=>{
                    let at=Instant::now();observer.transport.invalidate_reads();
                    match observer.get("pack/draft",false,"").await{
                        Ok(v)=>println!("REMOTE_PREPARATION_PROGRESS {}",json!({"ms":at.elapsed().as_secs_f64()*1000.,"progress":v["install_progress"]})),
                        Err(e)=>println!("REMOTE_PREPARATION_PROGRESS {}",json!({"ms":at.elapsed().as_secs_f64()*1000.,"error":format!("{:?}",e.code)})),
                    }
                }}
            }
        });
        let planned = owner.pack_install_plan(request).await;
        let _ = stop_tx.send(());
        monitor.await.unwrap();
        let plan = ok(
            "Cobbleverse1.7.42 real provider preparation+plan",
            start,
            planned,
        );
        assert!(plan.valid);
        assert_eq!(plan.minecraft_version, "1.21.1");
        assert_eq!(plan.software, "fabric");
        assert_eq!(plan.loader_version.as_deref(), Some("0.18.4"));
        let public = json!({"provider":"modrinth","project":"Jkb29YJU","version":"4SKGla61","minecraft":plan.minecraft_version,"software":plan.software,"loader":plan.loader_version,"software_switch_required":plan.software_switch_required,"files":plan.files,"removed":plan.removed,"skipped":plan.skipped,"warnings":plan.warnings,"prepare_plan_ms":start.elapsed().as_secs_f64()*1000.});
        fs::write(
            format!("{ROOT}/real-provider-plan.json"),
            serde_json::to_vec_pretty(&public).unwrap(),
        )
        .unwrap();
        println!(
            "REMOTE_PROVIDER_PLAN {}",
            json!({"files":plan.files.len(),"removed":plan.removed.len(),"skipped":plan.skipped.len(),"software_switch":plan.software_switch_required,"warnings":plan.warnings.len()})
        );
        let input = vesta_server_client::pack::PackInstallApply {
            plan_id: plan.plan_id,
            confirmation_token: plan.confirmation_token,
            acknowledge_warnings: true,
            acknowledge_software_switch: plan.software_switch_required,
            choices: plan
                .files
                .iter()
                .filter(|f| f.conflict.is_some())
                .map(|f| vesta_server_client::pack::PackInstallChoice {
                    path: f.path.clone(),
                    choice: "keep".into(),
                })
                .collect(),
            set_as_modpack: true,
        };
        let accepted = ok(
            "Cobbleverse real Apply accepted",
            Instant::now(),
            owner
                .pack_install_apply(input.clone(), "remote-cobbleverse-1742-0001")
                .await,
        );
        let id = accepted.software_job_id.expect("real provider apply job");
        let retry = ok(
            "real provider identical Apply retry",
            Instant::now(),
            owner
                .pack_install_apply(input, "remote-cobbleverse-1742-0001")
                .await,
        );
        assert_eq!(retry.software_job_id.as_deref(), Some(id.as_str()));
        let job = terminal(
            &owner,
            &id,
            "cobbleverse-install",
            Duration::from_secs(1200),
        )
        .await;
        fs::write(format!("{ROOT}/real-provider-acceptance.json"),serde_json::to_vec(&json!({"id":id,"state":job["state"],"total_prepare_apply_s":start.elapsed().as_secs_f64()})).unwrap()).unwrap();
        owner.transport.invalidate_reads();
        let link = ok(
            "persisted real server modpack link",
            Instant::now(),
            owner.server_modpack_link().await,
        )
        .expect("installed source link");
        fs::write(
            format!("{ROOT}/real-provider-link.json"),
            serde_json::to_vec(&link).unwrap(),
        )
        .unwrap();
        println!("REMOTE_REAL_PROVIDER_INSTALL_COMPLETED");
    } else if mode == "provider-reopen" {
        ok(
            "real install client retained before restart",
            Instant::now(),
            owner.status(true).await,
        );
        let ready = format!("{ROOT}/provider-client-awaiting-restart");
        let signal = format!("{ROOT}/provider-service-reopened.signal");
        assert!(!std::path::Path::new(&ready).exists() && !std::path::Path::new(&signal).exists());
        fs::write(ready, b"remote-integration-20261109\n").unwrap();
        let deadline = Instant::now() + Duration::from_secs(90);
        while !std::path::Path::new(&signal).exists() {
            assert!(Instant::now() < deadline);
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        owner.transport.invalidate_reads();
        assert_eq!(
            ok(
                "real installation restart automatic reauth",
                Instant::now(),
                owner.status(true).await
            )
            .state,
            "stopped"
        );
        let expected: Value = serde_json::from_slice(
            &fs::read(format!("{ROOT}/real-provider-acceptance.json")).unwrap(),
        )
        .unwrap();
        let jobs = ok(
            "real succeeded job persisted after reopen",
            Instant::now(),
            owner.software_jobs(true).await,
        );
        assert_eq!(
            jobs.iter().find(|j| j.id == expected["id"]).unwrap().state,
            "succeeded"
        );
        let link = ok(
            "real source identity after reopen",
            Instant::now(),
            owner.server_modpack_link().await,
        )
        .unwrap();
        assert_eq!(link.state, "installed");
        assert_eq!(link.display_version, "1.7.42");
        assert!(link.pending.is_none());
        assert_eq!(link.files.len(), 424);
        let source = serde_json::to_value(&link.source).unwrap();
        assert_eq!(
            source,
            json!({"source":"provider","provider":"modrinth","projectId":"Jkb29YJU","versionId":"4SKGla61"})
        );
        let software = ok(
            "real runtime identity after reopen",
            Instant::now(),
            owner.software().await,
        );
        assert!(!software.recovery_required);
        let current = software.current.unwrap();
        assert_eq!(current.software.as_deref(), Some("fabric"));
        assert_eq!(current.version.as_deref(), Some("1.21.1"));
        assert_eq!(current.loader_version.as_deref(), Some("0.18.4"));
        assert_eq!(
            ok(
                "managed Java selection persisted",
                Instant::now(),
                owner.java_inventory().await
            )
            .selected
            .unwrap()
            .major,
            21
        );
        let inventory = ok(
            "real installed resource inventory",
            Instant::now(),
            owner.content_inventory().await,
        );
        fs::write(
            format!("{ROOT}/real-resource-inventory.json"),
            serde_json::to_vec(&inventory).unwrap(),
        )
        .unwrap();
        let input=serde_json::from_value(json!({"analyze":false,"source":{"source":"provider","provider":"modrinth","projectId":"Jkb29YJU","versionId":"4SKGla61"}})).unwrap();
        let plan = ok(
            "normal lightweight review after reopen",
            Instant::now(),
            owner.pack_install_plan(input).await,
        );
        assert!(plan.valid && plan.deferred);
        assert!(!plan.software_switch_required);
        fs::write(format!("{ROOT}/real-provider-post-reopen.json"),serde_json::to_vec(&json!({"state":"installed","jobs_succeeded":true,"software":"fabric","minecraft":"1.21.1","loader":"0.18.4","java_major":21,"normal_review_deferred":plan.deferred,"resource_count":inventory.items.len()})).unwrap()).unwrap();
        println!("REMOTE_REAL_PROVIDER_PERSISTENCE_VERIFIED");
    } else {
        panic!("Unsupported explicit remote mode");
    }
}
