//! Pin the *leaf DER*, independent of PKI/hostname validity. TLS handshake signatures
//! are still checked by rustls. Capture mode is used only for unauthenticated discovery.
use rustls::{
    client::{ServerCertVerified, ServerCertVerifier},
    Certificate, ServerName,
};
use sha2::{Digest, Sha256};
use std::{
    sync::{Arc, Mutex},
    time::SystemTime,
};

pub fn leaf_fingerprint(der: &[u8]) -> String {
    hex::encode(Sha256::digest(der))
}
pub struct PinVerifier {
    expected: Option<String>,
    observed: Arc<Mutex<Option<String>>>,
}
impl PinVerifier {
    pub fn new(expected: Option<String>, observed: Arc<Mutex<Option<String>>>) -> Self {
        Self { expected, observed }
    }
}
impl ServerCertVerifier for PinVerifier {
    fn verify_server_cert(
        &self,
        leaf: &Certificate,
        _: &[Certificate],
        _: &ServerName,
        _: &mut dyn Iterator<Item = &[u8]>,
        _: &[u8],
        _: SystemTime,
    ) -> std::result::Result<ServerCertVerified, rustls::Error> {
        let fp = leaf_fingerprint(&leaf.0);
        *self
            .observed
            .lock()
            .map_err(|_| rustls::Error::General("pin lock".into()))? = Some(fp.clone());
        if self.expected.as_ref().is_some_and(|v| v != &fp) {
            return Err(rustls::Error::General("fingerprint mismatch".into()));
        }
        Ok(ServerCertVerified::assertion())
    }
}
pub fn config(
    expected: Option<String>,
    observed: Arc<Mutex<Option<String>>>,
) -> rustls::ClientConfig {
    rustls::ClientConfig::builder()
        .with_safe_defaults()
        .with_custom_certificate_verifier(Arc::new(PinVerifier::new(expected, observed)))
        .with_no_client_auth()
}
