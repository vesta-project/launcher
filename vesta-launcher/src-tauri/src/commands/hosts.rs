use crate::servers::{hosts::HostDiscovery, ServerManager};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, State};
use vesta_server_client::{host::VestaHost, Error, ErrorCode, Result};
type Manager<'a> = State<'a, Arc<ServerManager>>;
#[tauri::command]
pub async fn host_discover(manager: Manager<'_>) -> Result<Vec<HostDiscovery>> {
    manager.host_discover().await
}
#[tauri::command]
pub async fn host_probe(manager: Manager<'_>, address: String) -> Result<HostDiscovery> {
    manager.host_probe(&address).await
}
#[tauri::command]
pub async fn hosts_list(manager: Manager<'_>) -> Result<Vec<VestaHost>> {
    manager.hosts_list().await
}
#[tauri::command]
pub async fn host_remove(app: AppHandle, manager: Manager<'_>, host_id: String) -> Result<()> {
    manager.host_remove(&app, &host_id).await
}
#[tauri::command]
pub async fn host_claim(
    app: AppHandle,
    manager: Manager<'_>,
    address: String,
    code: String,
    account_uuid: String,
    device_name: String,
    verification_id: Option<String>,
) -> Result<Value> {
    manager
        .host_enroll(
            &app,
            &address,
            &code,
            &account_uuid,
            &device_name,
            false,
            verification_id.as_deref(),
        )
        .await
}
#[tauri::command]
pub async fn host_link_start(
    app: AppHandle,
    manager: Manager<'_>,
    address: String,
    code: String,
    account_uuid: String,
    device_name: String,
    verification_id: Option<String>,
) -> Result<Value> {
    manager
        .host_enroll(
            &app,
            &address,
            &code,
            &account_uuid,
            &device_name,
            true,
            verification_id.as_deref(),
        )
        .await
}
/// Checks a setup or link code right away (PAKE only). Never logs the code.
#[tauri::command]
pub async fn host_verify_code(
    manager: Manager<'_>,
    address: String,
    code: String,
    purpose: String,
) -> Result<Value> {
    let link = match purpose.as_str() {
        "claim" => false,
        "link" => true,
        _ => return Err(Error::new(ErrorCode::InvalidInput)),
    };
    manager.host_verify_code(&address, &code, link).await
}
#[tauri::command]
pub async fn host_link_poll(manager: Manager<'_>, link_id: String) -> Result<Value> {
    manager.host_link_poll(&link_id).await
}
#[tauri::command]
pub async fn host_sign_in(manager: Manager<'_>, host_id: String) -> Result<Value> {
    manager.host_info(&host_id).await
}
#[tauri::command]
pub async fn host_servers(app: AppHandle, manager: Manager<'_>, host_id: String) -> Result<Value> {
    manager.host_servers(&app, &host_id).await
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HostAction {
    Info,
    Devices,
    LinkCode,
    LinkStatus,
    LinkApprove,
    DeviceRevoke,
    OwnerPromote,
    OwnerDemote,
    OwnershipTransfer,
    FolderRoots,
    FolderResolve,
    FolderList,
    FolderCheck,
    ImportCandidates,
    ImportInspect,
    ImportResources,
    ImportPlan,
    ImportApply,
    ImportJob,
    ImportCancel,
    ImportResume,
    ImportStart,
    ImportReadiness,
}
/// Closed route selection: frontend cannot provide arbitrary URLs or authorization.
#[tauri::command]
pub async fn host_request(
    manager: Manager<'_>,
    host_id: String,
    action: HostAction,
    id: Option<String>,
    body: Option<Value>,
    revision: Option<String>,
    idempotency_key: Option<String>,
) -> Result<Value> {
    if matches!(action, HostAction::Info) {
        return manager.host_info(&host_id).await;
    }
    let session = manager.host_session(&host_id).await?;
    let id = || -> Result<String> {
        let id = id
            .as_ref()
            .ok_or_else(|| Error::new(ErrorCode::InvalidInput))?;
        uuid::Uuid::parse_str(id).map_err(|_| Error::new(ErrorCode::InvalidInput))?;
        Ok(id.clone())
    };
    use HostAction::*;
    if matches!(action, OwnerPromote | OwnerDemote | OwnershipTransfer) {
        let target = id()?;
        let revision = revision.ok_or_else(|| Error::new(ErrorCode::InvalidInput))?;
        let challenge = session
            .call(
                "POST",
                "/v1/host/ownership/challenge",
                Some(json!({})),
                None,
                None,
            )
            .await?;
        let verb = match action {
            OwnerPromote => "promote",
            OwnerDemote => "demote",
            _ => "transfer",
        };
        let signature=session.signer.sign(&vesta_host_client::requests::signing_bytes("vesta.host.owner.v1",&json!({"hostId":host_id,"deviceId":session.host.device_id,"action":verb,"targetAccountId":target,"nonce":challenge["nonce"],"expiresAt":challenge["expiresAt"],"revision":revision}))).await?;
        let mut body = json!({"targetAccountId":target,"nonce":challenge["nonce"],"expiresAt":challenge["expiresAt"],"revision":revision,"signature":signature});
        if matches!(action, OwnerPromote) {
            body["role"] = json!("owner");
        }
        let path = if matches!(action, OwnershipTransfer) {
            "/v1/host/ownership/transfer".into()
        } else {
            format!("/v1/host/owners/{target}")
        };
        return session
            .call(
                if matches!(action, OwnerDemote) {
                    "DELETE"
                } else if matches!(action, OwnerPromote) {
                    "PUT"
                } else {
                    "POST"
                },
                &path,
                Some(body),
                Some(&revision),
                idempotency_key.as_deref(),
            )
            .await;
    }
    let (method, suffix) = match action {
        Info => ("GET", "".into()),
        Devices => ("GET", "/devices".into()),
        LinkCode => ("POST", "/link-codes".into()),
        LinkStatus => ("GET", format!("/links/{}", id()?)),
        LinkApprove => ("POST", format!("/links/{}/approve", id()?)),
        DeviceRevoke => ("DELETE", format!("/devices/{}", id()?)),
        FolderRoots => ("GET", "/folders/roots".into()),
        FolderResolve => ("POST", "/folders/resolve".into()),
        FolderList => ("POST", "/folders/list".into()),
        FolderCheck => ("POST", "/folders/check".into()),
        ImportCandidates => ("GET", "/imports/candidates".into()),
        ImportInspect => ("POST", "/imports/inspect".into()),
        ImportResources => ("POST", "/imports/resources".into()),
        ImportPlan => ("POST", "/imports/plan".into()),
        ImportApply => ("POST", "/imports/apply".into()),
        ImportJob => ("GET", format!("/imports/jobs/{}", id()?)),
        ImportCancel => ("POST", format!("/imports/jobs/{}/cancel", id()?)),
        ImportResume => ("POST", format!("/imports/jobs/{}/resume", id()?)),
        ImportStart => ("POST", format!("/imports/jobs/{}/start", id()?)),
        ImportReadiness => ("GET", format!("/imports/jobs/{}", id()?)),
        _ => unreachable!(),
    };
    session
        .call(
            method,
            &format!("/v1/host{suffix}"),
            body,
            revision.as_deref(),
            idempotency_key.as_deref(),
        )
        .await
}
