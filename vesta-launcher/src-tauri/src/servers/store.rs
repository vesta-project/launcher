//! Profile-local metadata only. Credentials and confirmation tokens never enter this file.
use serde::{Deserialize, Serialize};
use std::{
    io::{Read, Write},
    path::Path,
};
use vesta_server_client::{model::ServerSnapshot, Error, ErrorCode, Result};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub snapshot: ServerSnapshot,
    pub device_id: String,
    pub key_reference: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn management_prepare_is_not_replayable_after_restart_and_journal_is_payload_free() {
        let root = tempfile::tempdir().unwrap();
        let pending = PendingIntent {
            connection_id: "connection".into(),
            key: "intent-hash".into(),
            key_version: 2,
            action: "backups/restore-in-place".into(),
            payload_hash: "payload-hash".into(),
            operation_id: None,
            created_at_ms: 1,
            terminal: false,
            uncertain: true,
        };
        let mut store = Store::default();
        store
            .reserve_management_intent(pending.clone(), true)
            .unwrap();
        store.save(root.path()).unwrap();
        let mut restarted = Store::load(root.path()).unwrap();
        assert_eq!(
            restarted
                .reserve_management_intent(pending.clone(), true)
                .unwrap_err()
                .code,
            ErrorCode::OutcomeUnknown
        );
        let mut changed = pending.clone();
        changed.payload_hash = "different".into();
        assert_eq!(
            restarted
                .reserve_management_intent(changed, true)
                .unwrap_err()
                .code,
            ErrorCode::Conflict
        );
        let mut replayable = pending;
        replayable.key = "other-intent".into();
        replayable.action = "pack/publish".into();
        restarted
            .reserve_management_intent(replayable.clone(), false)
            .unwrap();
        restarted
            .reserve_management_intent(replayable, false)
            .unwrap();
        let bytes = std::fs::read_to_string(root.path().join(FILE)).unwrap();
        for forbidden in ["confirmation", "token", "snapshot", "paths", "code"] {
            assert!(!bytes.contains(forbidden));
        }
    }
    #[test]
    fn session_only_connections_and_journals_never_survive_restart() {
        let root = tempfile::tempdir().unwrap();
        let snapshot: ServerSnapshot = serde_json::from_value(serde_json::json!({
            "connection": {"id":"session-only", "name":"temporary", "endpoint":"localhost:8443", "serverId":"server", "fingerprint":"ab".repeat(32), "role":null, "signInMethod":"pairing_code", "memoryOnly":true, "pinned":false, "addedAtMs":0, "lastConnectedAtMs":null},
            "state":{"phase":"online", "access":"paired", "retryAtMs":null, "rateLimitedUntilMs":null, "lastError":null},
            "info":null, "status":null, "statusObservedAtMs":null, "pack":null,
            "capabilities":{"source":"unknown", "granted":[], "refused":[]}, "restartRequired":false
        })).unwrap();
        let mut store = Store::default();
        store.connections.push(Record {
            snapshot,
            device_id: "temporary-device".into(),
            key_reference: "temporary-key".into(),
        });
        store.intents.push(PendingIntent {
            connection_id: "session-only".into(),
            key: "temporary-intent".into(),
            key_version: 2,
            action: "lifecycle.start".into(),
            payload_hash: "hash".into(),
            operation_id: None,
            created_at_ms: 0,
            terminal: false,
            uncertain: true,
        });
        store.save(root.path()).unwrap();
        let bytes = std::fs::read(root.path().join(FILE)).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("temporary"));
        assert!(Store::load(root.path()).unwrap().connections.is_empty());
        // A profile written by an older launcher must also drop temporary entries.
        std::fs::write(root.path().join(FILE), serde_json::to_vec(&store).unwrap()).unwrap();
        let restarted = Store::load(root.path()).unwrap();
        assert!(restarted.connections.is_empty());
        assert!(restarted.intents.is_empty());
    }
    #[test]
    fn metadata_is_atomic_profile_isolated_and_does_not_store_mutation_payloads() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let mut store = Store::default();
        store.intents.push(PendingIntent {
            connection_id: "connection".into(),
            key: "launcher-hash".into(),
            key_version: 2,
            action: "console.command".into(),
            payload_hash: "payload-hash".into(),
            operation_id: Some("operation".into()),
            created_at_ms: 1,
            terminal: false,
            uncertain: true,
        });
        store
            .pending_enrollment_keys
            .push(uuid::Uuid::new_v4().to_string());
        store.save(a.path()).unwrap();
        store.save(a.path()).unwrap();
        assert_eq!(Store::load(a.path()).unwrap().intents.len(), 1);
        assert!(Store::load(b.path()).unwrap().intents.is_empty());
        let value: serde_json::Value =
            serde_json::from_slice(&std::fs::read(a.path().join(FILE)).unwrap()).unwrap();
        let intent = value["intents"][0].as_object().unwrap();
        assert!(!intent.contains_key("body"));
        assert!(!intent.contains_key("token"));
        assert!(!intent.contains_key("line"));
        assert!(!intent.contains_key("privateKey"));
        std::fs::write(b.path().join(FILE), b"invalid store").unwrap();
        assert!(Store::load(b.path()).is_err());
        assert_eq!(
            std::fs::read(b.path().join(FILE)).unwrap(),
            b"invalid store"
        );
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingIntent {
    pub connection_id: String,
    pub key: String,
    /// Missing on pre-followup journals, whose wire key must survive upgrade.
    #[serde(default)]
    pub key_version: u8,
    pub action: String,
    pub payload_hash: String,
    pub operation_id: Option<String>,
    pub created_at_ms: i64,
    #[serde(default)]
    pub terminal: bool,
    #[serde(default)]
    pub uncertain: bool,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    pub connections: Vec<Record>,
    pub intents: Vec<PendingIntent>,
    // Retain keys for enrollment with an uncertain response. No pairing code.
    #[serde(default)]
    pub pending_enrollment_keys: Vec<String>,
}
const FILE: &str = "server-connections-v1.json";
const MAX_BYTES: u64 = 4 * 1024 * 1024;
fn failed(_: impl std::fmt::Display) -> Error {
    Error::new(ErrorCode::Internal)
}
impl Store {
    /// Reserve before sending. One-shot routes bypass agent replay caches, so even
    /// an identical intent must not be submitted again after a launcher restart.
    pub fn reserve_management_intent(&mut self, pending: PendingIntent, once: bool) -> Result<()> {
        if let Some(old) = self
            .intents
            .iter()
            .find(|i| i.connection_id == pending.connection_id && i.key == pending.key)
        {
            if old.action != pending.action || old.payload_hash != pending.payload_hash {
                return Err(Error::new(ErrorCode::Conflict));
            }
            return if once {
                Err(Error::new(ErrorCode::OutcomeUnknown))
            } else {
                Ok(())
            };
        }
        if self.intents.len() >= 4096 {
            return Err(Error::new(ErrorCode::ServerBusy));
        }
        self.intents.push(pending);
        Ok(())
    }
    pub fn load(root: &Path) -> Result<Self> {
        let file = match std::fs::File::open(root.join(FILE)) {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(e) => return Err(failed(e)),
        };
        let mut bytes = Vec::new();
        file.take(MAX_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(failed)?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(Error::new(ErrorCode::Internal));
        }
        let mut store: Self = serde_json::from_slice(&bytes).map_err(failed)?;
        if store.connections.len() > 100
            || store.intents.len() > 4096
            || store.pending_enrollment_keys.len() > 32
        {
            return Err(Error::new(ErrorCode::Internal));
        }
        // Session-only entries, including metadata from older versions, are dropped.
        let dropped: Vec<_> = store
            .connections
            .iter()
            .filter(|r| r.snapshot.connection.memory_only)
            .map(|r| r.snapshot.connection.id.clone())
            .collect();
        store
            .connections
            .retain(|r| !r.snapshot.connection.memory_only);
        store
            .intents
            .retain(|i| !dropped.contains(&i.connection_id));
        for record in &mut store.connections {
            record.snapshot.state = Default::default();
        }
        Ok(store)
    }
    pub fn save(&self, root: &Path) -> Result<()> {
        // Memory-only devices and their intent journals never enter profile storage.
        let mut persisted = self.clone();
        persisted
            .connections
            .retain(|r| !r.snapshot.connection.memory_only);
        persisted.intents.retain(|i| {
            !self.connections.iter().any(|r| {
                r.snapshot.connection.id == i.connection_id && r.snapshot.connection.memory_only
            })
        });
        let bytes = serde_json::to_vec(&persisted).map_err(failed)?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(Error::new(ErrorCode::ServerBusy));
        }
        std::fs::create_dir_all(root).map_err(failed)?;
        let mut file = tempfile::NamedTempFile::new_in(root).map_err(failed)?;
        file.write_all(&bytes).map_err(failed)?;
        file.as_file().sync_all().map_err(failed)?;
        file.persist(root.join(FILE)).map_err(failed)?;
        Ok(())
    }
}
