//! OS vault adapter. Memory-only enrollment is explicit (per sign-in opt-in),
//! never an automatic fallback from a failing credential service.
use std::sync::Arc;
use vesta_server_client::{
    auth::{DeviceSigner, Ed25519Signer},
    trust::leaf_fingerprint,
    Error, ErrorCode, Result,
};
use zeroize::{Zeroize, Zeroizing};

pub struct Credentials {
    service: String,
    #[cfg(test)]
    denied: std::sync::atomic::AtomicBool,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credential_namespaces_follow_profile_and_invalid_references_are_refused() {
        let a = Credentials::new(std::path::Path::new("profile-a"));
        let b = Credentials::new(std::path::Path::new("profile-b"));
        assert_ne!(a.service, b.service);
        assert_eq!(
            a.service,
            Credentials::new(std::path::Path::new("profile-a")).service
        );
        assert!(a.entry("../other-user").is_err());
        let signer = a.create(&uuid::Uuid::new_v4().to_string(), true).unwrap();
        assert_eq!(signer.public_key().len(), 43);
    }
}
impl Credentials {
    pub fn new(profile: &std::path::Path) -> Self {
        let canonical = profile
            .canonicalize()
            .unwrap_or_else(|_| profile.to_owned());
        Self {
            #[cfg(test)]
            denied: Default::default(),
            service: format!(
                "Vesta.ServerDevice.{}",
                leaf_fingerprint(canonical.to_string_lossy().as_bytes())
            ),
        }
    }
    #[cfg(test)]
    pub fn deny_storage(&self) {
        self.denied
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }
    fn entry(&self, reference: &str) -> Result<keyring::Entry> {
        #[cfg(test)]
        if self.denied.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(Error::new(ErrorCode::CredentialsUnavailable));
        }
        if reference.len() != 36 || uuid::Uuid::parse_str(reference).is_err() {
            return Err(Error::new(ErrorCode::CredentialsUnavailable));
        }
        keyring::Entry::new(&self.service, reference)
            .map_err(|_| Error::new(ErrorCode::CredentialsUnavailable))
    }
    /// Test actual write/read/delete access, rather than merely constructing an entry.
    pub fn available(&self) -> bool {
        let reference = uuid::Uuid::new_v4().to_string();
        let result = self.create(&reference, false);
        let deleted = self.delete(&reference);
        result.is_ok() && deleted.is_ok()
    }
    pub fn create(&self, reference: &str, memory_only: bool) -> Result<Arc<dyn DeviceSigner>> {
        let mut seed = rand::random::<[u8; 32]>();
        let signer = Arc::new(Ed25519Signer::from_seed(seed));
        if !memory_only {
            let result = self.entry(reference).and_then(|e| {
                e.set_secret(&seed)
                    .map_err(|_| Error::new(ErrorCode::CredentialsUnavailable))?;
                let stored = Zeroizing::new(
                    e.get_secret()
                        .map_err(|_| Error::new(ErrorCode::CredentialsUnavailable))?,
                );
                if stored.as_slice() != seed {
                    return Err(Error::new(ErrorCode::CredentialsUnavailable));
                }
                Ok(())
            });
            seed.zeroize();
            if result.is_err() {
                let _ = self.delete(reference);
            }
            result?;
        } else {
            seed.zeroize();
        }
        Ok(signer)
    }
    pub fn load(&self, reference: &str) -> Result<Arc<dyn DeviceSigner>> {
        let bytes = Zeroizing::new(
            self.entry(reference)?
                .get_secret()
                .map_err(|_| Error::new(ErrorCode::CredentialsUnavailable))?,
        );
        let mut seed: [u8; 32] = bytes
            .as_slice()
            .try_into()
            .map_err(|_| Error::new(ErrorCode::CredentialsUnavailable))?;
        let signer = Arc::new(Ed25519Signer::from_seed(seed));
        seed.zeroize();
        Ok(signer)
    }
    pub fn delete(&self, reference: &str) -> Result<()> {
        match self.entry(reference)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(Error::new(ErrorCode::CredentialsUnavailable)),
        }
    }
}
