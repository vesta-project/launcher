//! Signed release consumption. TLS leaf DER is the paired signing authority.
use crate::{file_transport::Request, Client, Error, ErrorCode, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const MAX_ARCHIVE: usize = 68 * 1024 * 1024;
pub fn failure(reason: &str) -> Error {
    let mut error = Error::new(ErrorCode::Conflict);
    error.reason = Some(reason.into());
    error
}
pub fn revision(value: &str) -> Result<u64> {
    let n = value
        .parse::<u64>()
        .map_err(|_| failure("pack_invalid_revision"))?;
    if n.to_string() != value {
        return Err(failure("pack_invalid_revision"));
    }
    Ok(n)
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncStatus {
    Current,
    UpdateAvailable,
    UpdateRequired,
}
pub fn status(installed: u64, latest: u64, minimum: u64) -> Result<SyncStatus> {
    if latest == 0 || minimum > latest || installed > latest {
        return Err(failure("pack_rollback_rejected"));
    }
    Ok(if installed < minimum {
        SyncStatus::UpdateRequired
    } else if installed < latest {
        SyncStatus::UpdateAvailable
    } else {
        SyncStatus::Current
    })
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Release {
    #[serde(default)]
    pub allow_custom_content: bool,
    pub server_id: String,
    pub fingerprint: String,
    pub revision: String,
    pub minimum_revision: String,
    pub sha256: String,
    pub size: String,
    pub format: String,
    pub installed_revision: String,
    pub status: SyncStatus,
    pub nonce: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SignedRelease {
    pub payload_base64: String,
    pub certificate_base64: String,
    pub signature_base64: String,
}
impl Release {
    pub fn reject_rollback(
        &self,
        highest_revision: &str,
        highest_minimum: &str,
        highest_sha256: &str,
    ) -> Result<()> {
        let latest = revision(&self.revision)?;
        if latest < revision(highest_revision)?
            || revision(&self.minimum_revision)? < revision(highest_minimum)?
            || latest == revision(highest_revision)? && self.sha256 != highest_sha256
        {
            return Err(failure("pack_rollback_rejected"));
        }
        Ok(())
    }
}
impl SignedRelease {
    pub fn verify(
        &self,
        server: &str,
        fingerprint: &str,
        nonce: &str,
        installed: u64,
    ) -> Result<Release> {
        let bad = || failure("pack_integrity_failure");
        if self.payload_base64.len() > 16384
            || self.certificate_base64.len() > 65536
            || self.signature_base64.len() > 2048
        {
            return Err(bad());
        }
        let payload = STANDARD.decode(&self.payload_base64).map_err(|_| bad())?;
        let cert = STANDARD
            .decode(&self.certificate_base64)
            .map_err(|_| bad())?;
        let sig = STANDARD.decode(&self.signature_base64).map_err(|_| bad())?;
        if crate::trust::leaf_fingerprint(&cert) != fingerprint {
            return Err(failure("pack_server_binding_mismatch"));
        }
        let cert = rustls::pki_types::CertificateDer::from(cert);
        let leaf = webpki::EndEntityCert::try_from(&cert).map_err(|_| bad())?;
        let mut message = b"vesta-pack-sync-v1\0".to_vec();
        message.extend_from_slice(&payload);
        if !rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .all
            .iter()
            .any(|alg| leaf.verify_signature(*alg, &message, &sig).is_ok())
        {
            return Err(bad());
        }
        let release: Release = serde_json::from_slice(&payload).map_err(|_| bad())?;
        if release.server_id != server || release.fingerprint != fingerprint {
            return Err(failure("pack_server_binding_mismatch"));
        }
        if release.nonce != nonce || revision(&release.installed_revision)? != installed {
            return Err(bad());
        }
        let latest = revision(&release.revision)?;
        let minimum = revision(&release.minimum_revision)?;
        if status(installed, latest, minimum)? != release.status
            || revision(&release.size)? > MAX_ARCHIVE as u64
            || release.sha256.len() != 64
            || !release
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(bad());
        }
        Ok(release)
    }
}
impl Client {
    pub async fn pack_sync_release(&self, installed: u64) -> Result<Release> {
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let path = format!("/api/v3/manage/pack/sync?installed={installed}&nonce={nonce}");
        let value = self
            .file_request(Request {
                method: reqwest::Method::GET,
                path,
                body: vec![],
                headers: Default::default(),
                key: None,
                bulk: false,
            })
            .await?
            .json(128 * 1024)
            .await?;
        let envelope: SignedRelease =
            serde_json::from_value(value).map_err(|_| failure("pack_integrity_failure"))?;
        envelope.verify(
            &self.server_id,
            self.transport
                .expected
                .as_deref()
                .ok_or_else(|| failure("pack_server_binding_mismatch"))?,
            &nonce,
            installed,
        )
    }
    pub async fn pack_sync_download(&self, release: &Release) -> Result<Vec<u8>> {
        if release.server_id != self.server_id
            || Some(release.fingerprint.as_str()) != self.transport.expected.as_deref()
        {
            return Err(failure("pack_server_binding_mismatch"));
        }
        let path = format!(
            "/api/v3/manage/pack/artifact?revision={}&sha256={}",
            release.revision, release.sha256
        );
        let bytes = self
            .file_request(Request {
                method: reqwest::Method::GET,
                path,
                body: vec![],
                headers: Default::default(),
                key: None,
                bulk: true,
            })
            .await?
            .bytes(MAX_ARCHIVE)
            .await?;
        if bytes.len() as u64 != revision(&release.size)?
            || hex::encode(Sha256::digest(&bytes)) != release.sha256
        {
            return Err(failure("pack_integrity_failure"));
        }
        Ok(bytes)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn signed() -> (SignedRelease, String) {
        use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
        let cert = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        let der = cert.cert.der().to_vec();
        let fingerprint = crate::trust::leaf_fingerprint(&der);
        let key = rustls::sign::CertifiedKey::from_der(
            vec![CertificateDer::from(der.clone())],
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(cert.key_pair.serialize_der())),
            &rustls::crypto::ring::default_provider(),
        )
        .unwrap();
        let payload=serde_json::to_vec(&serde_json::json!({"server_id":"server","fingerprint":fingerprint,"revision":"3","minimum_revision":"2","sha256":"a".repeat(64),"size":"12","format":"vestapack","installed_revision":"2","status":"update_available","nonce":"test-nonce"})).unwrap();
        let mut message = b"vesta-pack-sync-v1\0".to_vec();
        message.extend_from_slice(&payload);
        let signer = key
            .key
            .choose_scheme(&[rustls::SignatureScheme::ECDSA_NISTP256_SHA256])
            .unwrap();
        (
            SignedRelease {
                payload_base64: STANDARD.encode(payload),
                certificate_base64: STANDARD.encode(der),
                signature_base64: STANDARD.encode(signer.sign(&message).unwrap()),
            },
            fingerprint,
        )
    }
    #[test]
    fn verifies_paired_tls_key_signature_and_rejects_substitution_replay_or_tamper() {
        let (mut envelope, fp) = signed();
        let release = envelope.verify("server", &fp, "test-nonce", 2).unwrap();
        assert_eq!(release.status, SyncStatus::UpdateAvailable);
        assert!(envelope.verify("other", &fp, "test-nonce", 2).is_err());
        assert!(envelope
            .verify("server", &"b".repeat(64), "test-nonce", 2)
            .is_err());
        assert!(envelope.verify("server", &fp, "old-nonce", 2).is_err());
        assert!(envelope.verify("server", &fp, "test-nonce", 1).is_err());
        let mut payload = STANDARD.decode(&envelope.payload_base64).unwrap();
        payload.push(b' ');
        envelope.payload_base64 = STANDARD.encode(payload);
        assert!(envelope.verify("server", &fp, "test-nonce", 2).is_err());
    }
    #[test]
    fn optional_required_and_rollback() {
        assert_eq!(status(3, 3, 1).unwrap(), SyncStatus::Current);
        assert_eq!(status(2, 3, 2).unwrap(), SyncStatus::UpdateAvailable);
        assert_eq!(status(1, 3, 2).unwrap(), SyncStatus::UpdateRequired);
        assert!(status(4, 3, 1).is_err());
        assert!(status(1, 3, 4).is_err());
        assert_eq!(revision("9007199254740993").unwrap(), 9007199254740993);
        assert!(revision("01").is_err());
        let (envelope, fp) = signed();
        let release = envelope.verify("server", &fp, "test-nonce", 2).unwrap();
        assert!(release.reject_rollback("4", "2", &release.sha256).is_err());
        assert!(release.reject_rollback("3", "3", &release.sha256).is_err());
        assert!(release.reject_rollback("3", "2", &"f".repeat(64)).is_err());
        release.reject_rollback("2", "1", &"f".repeat(64)).unwrap();
    }
}
