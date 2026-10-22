//! Pin the *leaf DER*, independent of PKI/hostname validity. TLS handshake signatures
//! are still checked by rustls. Capture mode is used only for unauthenticated discovery.
use rustls::{
    client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier},
    pki_types::{CertificateDer, ServerName, UnixTime},
    DigitallySignedStruct, SignatureScheme,
};
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};

pub fn leaf_fingerprint(der: &[u8]) -> String {
    hex::encode(Sha256::digest(der))
}
#[derive(Debug)]
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
        leaf: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> std::result::Result<ServerCertVerified, rustls::Error> {
        let fp = leaf_fingerprint(leaf.as_ref());
        *self
            .observed
            .lock()
            .map_err(|_| rustls::Error::General("pin lock".into()))? = Some(fp.clone());
        if self.expected.as_ref().is_some_and(|v| v != &fp) {
            return Err(rustls::Error::General("fingerprint mismatch".into()));
        }
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &rustls::crypto::ring::default_provider().signature_verification_algorithms,
        )
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> std::result::Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &rustls::crypto::ring::default_provider().signature_verification_algorithms,
        )
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}
pub fn config(
    expected: Option<String>,
    observed: Arc<Mutex<Option<String>>>,
) -> rustls::ClientConfig {
    rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_safe_default_protocol_versions()
        .expect("ring supports the default TLS versions")
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(PinVerifier::new(expected, observed)))
        .with_no_client_auth()
}
