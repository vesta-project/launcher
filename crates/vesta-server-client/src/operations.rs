use crate::model::{LifecycleAction, OperationActor, OperationSummary, ServerOperation};
use crate::{Error, ErrorCode, Result};
use serde::Deserialize;
use sha2::{Digest, Sha256};

// Decode the authorized projection only. Never reconstruct details from the
// submitted payload: permissions/redaction and retention belong to the agent.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Projection {
    actor: Option<Actor>,
    summary: Option<Summary>,
    #[serde(default)]
    summary_purged: bool,
    #[serde(flatten)]
    operation: ServerOperation,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Actor {
    Principal {
        #[serde(rename = "principalId")]
        principal_id: String,
        #[serde(rename = "displayName")]
        display_name: String,
        #[serde(rename = "deviceName")]
        device_name: Option<String>,
    },
    Named(NamedActor),
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum NamedActor {
    Workflow { name: String },
    System { name: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Summary {
    command: Option<String>,
    #[serde(default)]
    command_redacted: bool,
    #[serde(default)]
    details_redacted: bool,
    action: Option<String>,
    player: Option<String>,
    reason: Option<String>,
    duration_seconds: Option<u64>,
    target_generation: Option<String>,
    result_generation: Option<String>,
}

/// Map snake_case agent operation details to the native UI contract. Missing
/// projections on older agents remain null; unknown summaries are not invented.
pub fn decode(value: serde_json::Value, own_principal: Option<&str>) -> Result<ServerOperation> {
    let projection: Projection = crate::model::from_wire(value)?;
    let mut operation = projection.operation;
    operation.actor = projection.actor.map(|actor| {
        Box::new(match actor {
            Actor::Principal {
                principal_id,
                display_name,
                device_name,
            } => OperationActor::Principal {
                is_self: own_principal == Some(principal_id.as_str()),
                principal_id,
                display_name,
                device_name,
            },
            Actor::Named(NamedActor::Workflow { name }) => OperationActor::Workflow { name },
            Actor::Named(NamedActor::System { name }) => OperationActor::System { name },
        })
    });
    operation.summary = (if projection.summary_purged {
        Some(OperationSummary::Purged)
    } else {
        projection.summary.and_then(|summary| {
            if summary.details_redacted {
                return None;
            }
            match operation.kind.as_deref() {
                Some("console.command")
                    if summary.command.is_some() || summary.command_redacted =>
                {
                    Some(OperationSummary::ConsoleCommand {
                        command: if summary.command_redacted {
                            None
                        } else {
                            summary.command
                        },
                    })
                }
                Some("players.moderate") => Some(OperationSummary::PlayersModerate {
                    action: summary.action?,
                    player: summary.player?,
                    reason: summary.reason,
                    duration_seconds: summary.duration_seconds,
                }),
                Some(kind) => {
                    let action = match kind {
                        "lifecycle.start" => LifecycleAction::Start,
                        "lifecycle.stop" => LifecycleAction::Stop,
                        "lifecycle.restart" => LifecycleAction::Restart,
                        "lifecycle.kill" => LifecycleAction::Kill,
                        _ => return None,
                    };
                    Some(OperationSummary::Lifecycle {
                        action,
                        target_generation: summary.target_generation,
                        result_generation: summary.result_generation,
                    })
                }
                None => None,
            }
        })
    })
    .map(Box::new);
    Ok(operation)
}

pub fn intent_key(intent_id: &str) -> Result<String> {
    if intent_id.is_empty() || intent_id.len() > 256 || intent_id.chars().any(char::is_control) {
        return Err(Error::new(ErrorCode::InvalidInput));
    }
    let mut digest = Sha256::new();
    digest.update(b"vesta.launcher.intent.v1\0");
    digest.update(intent_id);
    Ok(format!("launcher-{}", hex::encode(digest.finalize())))
}
pub fn generation(value: &str) -> Result<()> {
    if value.len() == 32 && value.bytes().all(|b| b.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(Error::new(ErrorCode::InvalidInput))
    }
}

/// Durable server keys are scoped to the enrolled device on the pinned server.
/// Reconstructing a client with that device preserves explicit retry identity.
pub fn device_intent_key(server_id: &str, device_id: &str, intent_id: &str) -> Result<String> {
    intent_key(intent_id)?;
    let mut digest = Sha256::new();
    digest.update(b"vesta.launcher.device-intent.v1\0");
    for part in [server_id, device_id, intent_id] {
        digest.update((part.len() as u64).to_be_bytes());
        digest.update(part);
    }
    Ok(format!("launcher-{}", hex::encode(digest.finalize())))
}
