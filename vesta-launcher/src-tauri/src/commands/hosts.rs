use crate::servers::{hosts::HostDiscovery, ServerManager};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, State};
use vesta_server_client::{
    host::{HostSession, VestaHost},
    Error, ErrorCode, Result,
};
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
/// `device_name` is only a fallback: the machine lists this computer by its own name.
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
            &ServerManager::host_device_name(&device_name),
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
            &ServerManager::host_device_name(&device_name),
            true,
            verification_id.as_deref(),
        )
        .await
}
/// No code: signs this device in to a machine someone already set up, as the account.
#[tauri::command]
pub async fn host_sign_in_with_account(
    app: AppHandle,
    manager: Manager<'_>,
    address: String,
    host_id: Option<String>,
    account_uuid: String,
    device_name: String,
) -> Result<VestaHost> {
    manager
        .host_sign_in_with_account(
            &app,
            &address,
            host_id.as_deref(),
            &account_uuid,
            &ServerManager::host_device_name(&device_name),
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
pub async fn host_sign_in(app: AppHandle, manager: Manager<'_>, host_id: String) -> Result<Value> {
    manager.host_info(&app, &host_id).await
}
#[tauri::command]
pub async fn host_servers(app: AppHandle, manager: Manager<'_>, host_id: String) -> Result<Value> {
    manager.host_servers(&app, &host_id).await
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HostAction {
    Info,
    Update,
    Owners,
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
    CatalogueMinecraft,
    CatalogueSoftware,
    CreateDefaults,
    CreateRestoreSources,
    CreatePlan,
    CreateApply,
    CreateJob,
    CreateCancel,
    CreateResume,
    CreateStart,
    ServerRemove,
    ServersRemoved,
    ServerRestore,
    ServerPurge,
    Storage,
    StorageMeasure,
}
/// A Minecraft version id for a catalogue query: short, and only characters a version uses.
fn version_query(body: Option<&Value>) -> Result<String> {
    body.and_then(|body| body.get("minecraftVersion"))
        .and_then(Value::as_str)
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 48
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
        })
        .map(str::to_owned)
        .ok_or_else(|| Error::new(ErrorCode::InvalidInput))
}
/// Removing a server: the name typed to confirm (exactly as typed, case and all) and the
/// attempt's idempotency key, so a retry of the same attempt gets the same receipt.
fn confirm_name(body: Option<&Value>) -> Result<&str> {
    body.and_then(|body| body.get("confirmName"))
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty() && name.len() <= 256)
        .ok_or_else(|| Error::new(ErrorCode::InvalidInput))
}
/// An optional boolean the page may send; anything else is dropped.
fn flag(body: Option<&Value>, key: &str) -> Option<bool> {
    body.and_then(|body| body.get(key)).and_then(Value::as_bool)
}
fn remove_body(body: Option<&Value>, idempotency_key: &str) -> Result<Value> {
    let mut out = json!({ "confirmName": confirm_name(body)?, "idempotencyKey": idempotency_key });
    // Deleting for good (and whether to keep backups) only travels when the page asked for it.
    if flag(body, "permanently") == Some(true) {
        out["permanently"] = json!(true);
        if let Some(keep) = flag(body, "keepBackups") {
            out["keepBackups"] = json!(keep);
        }
    }
    Ok(out)
}
/// Deleting a removed server for good: the typed name and the backup choice, nothing else.
fn purge_body(body: Option<&Value>) -> Result<Value> {
    let mut out = json!({ "confirmName": confirm_name(body)? });
    if let Some(keep) = flag(body, "keepBackups") {
        out["keepBackups"] = json!(keep);
    }
    Ok(out)
}
/// Restoring: an optional new name and port; the machine picks free ones when they're absent.
fn restore_body(body: Option<&Value>) -> Result<Value> {
    let mut out = json!({});
    if let Some(name) = body.and_then(|body| body.get("name")).and_then(Value::as_str) {
        if name.trim().is_empty() || name.len() > 256 {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        out["name"] = json!(name);
    }
    if let Some(port) = body.and_then(|body| body.get("gamePort")).and_then(Value::as_u64) {
        if !(1..=65535).contains(&port) {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        out["gamePort"] = json!(port);
    }
    Ok(out)
}
/// A list cursor for a query string: the opaque token the machine handed out, nothing more.
fn cursor_query(body: Option<&Value>) -> Result<String> {
    match body.and_then(|body| body.get("cursor")).and_then(Value::as_str) {
        None => Ok(String::new()),
        Some(cursor)
            if !cursor.is_empty()
                && cursor.len() <= 512
                && cursor
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~')) =>
        {
            Ok(format!("?cursor={cursor}"))
        }
        Some(_) => Err(Error::new(ErrorCode::InvalidInput)),
    }
}
#[cfg(test)]
mod remove_tests {
    use super::*;
    #[test]
    fn remove_body_keeps_the_typed_name_and_the_attempt_key() {
        let body = json!({ "confirmName": "Lobby ", "idempotencyKey": "ignored", "extra": 1 });
        assert_eq!(
            remove_body(Some(&body), "k-1").unwrap(),
            json!({ "confirmName": "Lobby ", "idempotencyKey": "k-1" })
        );
        let forever = json!({ "confirmName": "Lobby", "permanently": true, "keepBackups": false });
        assert_eq!(
            remove_body(Some(&forever), "k-2").unwrap(),
            json!({ "confirmName": "Lobby", "idempotencyKey": "k-2", "permanently": true, "keepBackups": false })
        );
        assert_eq!(
            purge_body(Some(&json!({ "confirmName": "Lobby", "keepBackups": true, "x": 1 }))).unwrap(),
            json!({ "confirmName": "Lobby", "keepBackups": true })
        );
        assert_eq!(
            restore_body(Some(&json!({ "gamePort": 25570, "x": 1 }))).unwrap(),
            json!({ "gamePort": 25570 })
        );
        assert!(restore_body(Some(&json!({ "gamePort": 70000 }))).is_err());
        assert_eq!(cursor_query(Some(&json!({ "cursor": "abc-1" }))).unwrap(), "?cursor=abc-1");
        assert!(cursor_query(Some(&json!({ "cursor": "a&b=c" }))).is_err());
        assert!(remove_body(Some(&json!({ "confirmName": "" })), "k").is_err());
        assert!(remove_body(None, "k").is_err());
    }
}
/// Closed route selection: frontend cannot provide arbitrary URLs or authorization.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn host_request(
    app: AppHandle,
    manager: Manager<'_>,
    host_id: String,
    action: HostAction,
    id: Option<String>,
    body: Option<Value>,
    revision: Option<String>,
    idempotency_key: Option<String>,
) -> Result<Value> {
    if matches!(action, HostAction::Info) {
        return manager.host_info(&app, &host_id).await;
    }
    // One key for both attempts: a retry after signing in again is the same request.
    let key = idempotency_key.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    manager
        .host_using(&app, &host_id, |session| {
            dispatch(
                session,
                host_id.clone(),
                action.clone(),
                id.clone(),
                body.clone(),
                revision.clone(),
                key.clone(),
            )
        })
        .await
}
async fn dispatch(
    session: Arc<HostSession>,
    host_id: String,
    action: HostAction,
    id: Option<String>,
    body: Option<Value>,
    revision: Option<String>,
    idempotency_key: String,
) -> Result<Value> {
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
                Some(&idempotency_key),
            )
            .await;
    }
    let (method, suffix) = match action {
        Update => ("PATCH", "".into()),
        Owners => ("GET", "/owners".into()),
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
        CatalogueMinecraft => ("GET", "/catalogue/minecraft".into()),
        CatalogueSoftware => (
            "GET",
            format!(
                "/catalogue/software?minecraftVersion={}",
                version_query(body.as_ref())?
            ),
        ),
        CreateDefaults => ("GET", "/creates/defaults".into()),
        CreateRestoreSources => ("GET", "/creates/restore-sources".into()),
        CreatePlan => ("POST", "/creates/plan".into()),
        CreateApply => ("POST", "/creates/apply".into()),
        CreateJob => ("GET", format!("/creates/jobs/{}", id()?)),
        CreateCancel => ("POST", format!("/creates/jobs/{}/cancel", id()?)),
        CreateResume => ("POST", format!("/creates/jobs/{}/resume", id()?)),
        CreateStart => ("POST", format!("/creates/jobs/{}/start", id()?)),
        ServerRemove => ("DELETE", format!("/servers/{}", id()?)),
        ServersRemoved => ("GET", format!("/servers/removed{}", cursor_query(body.as_ref())?)),
        ServerRestore => ("POST", format!("/servers/removed/{}/restore", id()?)),
        ServerPurge => ("DELETE", format!("/servers/removed/{}", id()?)),
        Storage => ("GET", "/storage".into()),
        StorageMeasure => ("POST", "/storage/measure".into()),
        _ => unreachable!(),
    };
    // Reads carry no body: a catalogue query travels in the path.
    let body = if method == "GET" {
        None
    } else if matches!(action, ServerRemove) {
        // Built here: only the typed name travels from the page, the key is this attempt's.
        Some(remove_body(body.as_ref(), &idempotency_key)?)
    } else if matches!(action, ServerPurge) {
        Some(purge_body(body.as_ref())?)
    } else if matches!(action, ServerRestore) {
        Some(restore_body(body.as_ref())?)
    } else if matches!(action, StorageMeasure) {
        Some(json!({}))
    } else {
        body
    };
    session
        .call(
            method,
            &format!("/v1/host{suffix}"),
            body,
            revision.as_deref(),
            Some(&idempotency_key),
        )
        .await
}
