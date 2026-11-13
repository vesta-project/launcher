//! Shared native bootstrap protocol. No networking or certificate verifier is installed here.
//! The caller must use a dedicated TLS 1.3 connection without resumption or early data.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
use hmac::{Hmac, Mac};
pub use rand_core;
use rand_core::{CryptoRng, OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
pub use spake2;
use spake2::{Ed25519Group, Identity, Password, Spake2};
use zeroize::Zeroizing;
pub const EXPORTER_LABEL: &[u8] = b"EXPORTER-Vesta-host-pake-v1";
pub const ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PairingFailed;
impl std::fmt::Display for PairingFailed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("pairing_failed")
    }
}
impl std::error::Error for PairingFailed {}
pub type Result<T> = std::result::Result<T, PairingFailed>;
/// Never Debug/Serialize the setup password.
pub struct SetupCode(Zeroizing<String>);
impl SetupCode {
    pub fn parse(input: &str) -> Result<Self> {
        if input.len() > 64 {
            return Err(PairingFailed);
        }
        let code: String = input
            .bytes()
            .filter(|b| *b != b'-' && *b != b' ')
            .map(|b| b.to_ascii_uppercase() as char)
            .collect();
        if code.len() != 12 || !code.bytes().all(|b| ALPHABET.contains(&b)) {
            return Err(PairingFailed);
        }
        Ok(Self(Zeroizing::new(code)))
    }
    pub fn generate() -> Self {
        let mut bytes = [0; 12];
        OsRng.fill_bytes(&mut bytes);
        Self(Zeroizing::new(
            bytes
                .iter()
                .map(|b| ALPHABET[(b & 31) as usize] as char)
                .collect(),
        ))
    }
    pub fn canonical(&self) -> &str {
        &self.0
    }
    pub fn display(&self) -> String {
        format!("{}-{}-{}", &self.0[..4], &self.0[4..8], &self.0[8..])
    }
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Purpose {
    Claim,
    Link,
}
impl Purpose {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claim => "claim",
            Self::Link => "link",
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Start {
    pub purpose: Purpose,
    pub link_id: Option<String>,
    pub host_id: String,
    pub device_key: String,
    pub client_nonce: String,
    pub message_a: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Started {
    pub exchange_id: String,
    pub link_id: Option<String>,
    pub host_id: String,
    pub fingerprint: String,
    pub server_nonce: String,
    pub message_b: String,
    pub expires_at: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Finish {
    pub exchange_id: String,
    pub client_confirm: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Finished {
    pub server_confirm: String,
    pub pake_token: String,
    pub expires_at: String,
}
pub fn encode(bytes: &[u8]) -> String {
    B64.encode(bytes)
}
pub fn decode<const N: usize>(s: &str) -> Result<[u8; N]> {
    if s.len() != (N * 8).div_ceil(6) {
        return Err(PairingFailed);
    }
    let bytes = B64.decode(s).map_err(|_| PairingFailed)?;
    let out: [u8; N] = bytes.try_into().map_err(|_| PairingFailed)?;
    if encode(&out) != s {
        return Err(PairingFailed);
    }
    Ok(out)
}
pub fn identities(s: &Start) -> (Identity, Identity) {
    let suffix = format!("\0{}\0{}\0{}", s.purpose.as_str(), s.host_id, s.device_key);
    (
        Identity::new(format!("vesta.host.pake.v1/A{suffix}").as_bytes()),
        Identity::new(format!("vesta.host.pake.v1/B{suffix}").as_bytes()),
    )
}
/// This fixed ASCII-key/string/integer schema has identical JCS and sorted JSON encoding.
/// Do not extend it to arbitrary JSON numbers or Unicode property names.
pub fn transcript(s: &Start, b: &Started) -> Result<Vec<u8>> {
    let value = serde_json::json!({"v":1,"purpose":s.purpose,"linkId":b.link_id,"hostId":b.host_id,"fingerprint":b.fingerprint,"deviceKey":s.device_key,"clientNonce":s.client_nonce,"serverNonce":b.server_nonce,"exchangeId":b.exchange_id,"messageA":s.message_a,"messageB":b.message_b,"expiresAt":b.expires_at});
    // Feature unification may enable serde_json/preserve_order in the launcher.
    let sorted: std::collections::BTreeMap<_, _> =
        value.as_object().ok_or(PairingFailed)?.iter().collect();
    serde_json::to_vec(&sorted).map_err(|_| PairingFailed)
}
pub struct Confirmation {
    key: Zeroizing<[u8; 32]>,
    hash: [u8; 32],
}
impl Confirmation {
    pub fn new(shared: &[u8], exporter: &[u8; 32], transcript: &[u8]) -> Self {
        let hash: [u8; 32] = Sha256::digest(transcript).into();
        let mut info = b"vesta.host.pake.key.v1\0".to_vec();
        info.extend(hash);
        let mut key = Zeroizing::new([0; 32]);
        hkdf::Hkdf::<Sha256>::new(Some(exporter), shared)
            .expand(&info, key.as_mut())
            .expect("fixed HKDF length");
        Self { key, hash }
    }
    fn mac(&self, side: &[u8]) -> Hmac<Sha256> {
        let mut mac = Hmac::<Sha256>::new_from_slice(self.key.as_ref()).expect("HMAC key");
        mac.update(side);
        mac.update(&self.hash);
        mac
    }
    pub fn client(&self) -> String {
        encode(&self.mac(b"client\0").finalize().into_bytes())
    }
    pub fn server(&self) -> String {
        encode(&self.mac(b"server\0").finalize().into_bytes())
    }
    pub fn verify_client(&self, s: &str) -> Result<()> {
        self.mac(b"client\0")
            .verify_slice(&decode::<32>(s)?)
            .map_err(|_| PairingFailed)
    }
    pub fn verify_server(&self, s: &str) -> Result<()> {
        self.mac(b"server\0")
            .verify_slice(&decode::<32>(s)?)
            .map_err(|_| PairingFailed)
    }
}
pub struct Client {
    state: Spake2<Ed25519Group>,
    request: Start,
}
pub struct ClientFinish {
    confirmation: Confirmation,
}
impl Client {
    pub fn start(
        code: &SetupCode,
        purpose: Purpose,
        link_id: Option<String>,
        host_id: String,
        device_key: [u8; 32],
    ) -> (Self, Start) {
        Self::start_with_rng(code, purpose, link_id, host_id, device_key, OsRng)
    }
    pub fn start_with_rng(
        code: &SetupCode,
        purpose: Purpose,
        link_id: Option<String>,
        host_id: String,
        device_key: [u8; 32],
        mut rng: impl CryptoRng + RngCore,
    ) -> (Self, Start) {
        let mut nonce = [0; 32];
        rng.fill_bytes(&mut nonce);
        let mut request = Start {
            purpose,
            link_id,
            host_id,
            device_key: encode(&device_key),
            client_nonce: encode(&nonce),
            message_a: String::new(),
        };
        let (a, b) = identities(&request);
        let (state, msg) =
            Spake2::start_a_with_rng(&Password::new(code.canonical().as_bytes()), &a, &b, rng);
        request.message_a = encode(&msg);
        (
            Self {
                state,
                request: request.clone(),
            },
            request,
        )
    }
    pub fn finish(
        self,
        b: &Started,
        observed_fingerprint: &str,
        exporter: &[u8; 32],
    ) -> Result<(ClientFinish, Finish)> {
        if self.request.host_id != b.host_id
            || b.fingerprint != observed_fingerprint
            || (self.request.link_id.is_some() && self.request.link_id != b.link_id)
            || (self.request.purpose == Purpose::Claim && b.link_id.is_some())
        {
            return Err(PairingFailed);
        }
        decode::<32>(&b.server_nonce)?;
        let shared = Zeroizing::new(
            self.state
                .finish(&decode::<33>(&b.message_b)?)
                .map_err(|_| PairingFailed)?,
        );
        let confirmation = Confirmation::new(&shared, exporter, &transcript(&self.request, b)?);
        let finish = Finish {
            exchange_id: b.exchange_id.clone(),
            client_confirm: confirmation.client(),
        };
        Ok((ClientFinish { confirmation }, finish))
    }
}
impl ClientFinish {
    pub fn verify(self, response: Finished) -> Result<String> {
        self.confirmation.verify_server(&response.server_confirm)?;
        decode::<32>(&response.pake_token)?;
        Ok(response.pake_token)
    }
}

#[cfg(feature = "discovery")]
pub mod discovery;

pub mod requests;
