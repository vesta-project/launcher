use crate::{Error, ErrorCode, Result};
use sha2::{Digest, Sha256};

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
