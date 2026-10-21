use crate::{Error, ErrorCode, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ed25519_dalek::{Signer as _, SigningKey};

pub const SESSION_PURPOSE: &str = "vesta.management.session.v1";
pub fn signing_bytes(server_id: &str, nonce: &str) -> Vec<u8> {
    format!("{SESSION_PURPOSE}\0{server_id}\0{nonce}").into_bytes()
}
#[async_trait::async_trait]
pub trait DeviceSigner: Send + Sync {
    fn public_key(&self) -> String;
    async fn sign(&self, message: &[u8]) -> Result<String>;
}
/// The host owns loading/sealing this seed. This type never serializes it.
pub struct Ed25519Signer(SigningKey);
impl Ed25519Signer {
    pub fn from_seed(seed: [u8; 32]) -> Self {
        Self(SigningKey::from_bytes(&seed))
    }
}
#[async_trait::async_trait]
impl DeviceSigner for Ed25519Signer {
    fn public_key(&self) -> String {
        URL_SAFE_NO_PAD.encode(self.0.verifying_key().as_bytes())
    }
    async fn sign(&self, message: &[u8]) -> Result<String> {
        Ok(URL_SAFE_NO_PAD.encode(self.0.sign(message).to_bytes()))
    }
}
#[derive(serde::Deserialize)]
pub struct Enrollment {
    pub server_id: String,
    pub principal_id: String,
    pub device_id: String,
    pub role: String,
}
#[derive(serde::Deserialize)]
pub(crate) struct Challenge {
    pub server_id: String,
    pub nonce: String,
    pub purpose: String,
}
#[derive(serde::Deserialize)]
pub(crate) struct Session {
    pub server_id: String,
    pub token: zeroize::Zeroizing<String>,
    pub expires_at_ms: i64,
}
pub(crate) fn check_identity(expected: &str, actual: &str) -> Result<()> {
    if expected == actual {
        Ok(())
    } else {
        Err(Error::new(ErrorCode::FingerprintMismatch))
    }
}
