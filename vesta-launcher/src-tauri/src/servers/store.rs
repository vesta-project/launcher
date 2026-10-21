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
    fn metadata_is_atomic_profile_isolated_and_does_not_store_mutation_payloads() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let mut store = Store::default();
        store.intents.push(PendingIntent {
            connection_id: "connection".into(),
            key: "launcher-hash".into(),
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
        for record in &mut store.connections {
            record.snapshot.state = Default::default();
            if record.snapshot.connection.memory_only {
                record.snapshot.state.access = "credentials_unavailable".into();
            }
        }
        Ok(store)
    }
    pub fn save(&self, root: &Path) -> Result<()> {
        let bytes = serde_json::to_vec(self).map_err(failed)?;
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
