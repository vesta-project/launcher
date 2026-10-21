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
