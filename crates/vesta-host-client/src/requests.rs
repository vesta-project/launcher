//! Signing bytes for the host's integer/string identity schemas. The caller owns
//! Ed25519 keys, HTTPS, Mojang join and pin storage; this crate holds no credentials.
use serde_json::Value;
/// Domain-separated RFC 8785 bytes for host identity messages (no floats).
pub fn signing_bytes(domain: &str, value: &Value) -> Vec<u8> {
    fn write(v: &Value, out: &mut String) {
        match v {
            Value::Object(m) => {
                out.push('{');
                let mut keys = m.keys().collect::<Vec<_>>();
                keys.sort_by_cached_key(|k| k.encode_utf16().collect::<Vec<_>>());
                for (i, k) in keys.iter().enumerate() {
                    if i > 0 {
                        out.push(',')
                    }
                    out.push_str(&serde_json::to_string(k).unwrap());
                    out.push(':');
                    write(&m[*k], out)
                }
                out.push('}')
            }
            Value::Array(a) => {
                out.push('[');
                for (i, v) in a.iter().enumerate() {
                    if i > 0 {
                        out.push(',')
                    }
                    write(v, out)
                }
                out.push(']')
            }
            _ => out.push_str(&serde_json::to_string(v).unwrap()),
        }
    }
    let mut json = String::new();
    write(value, &mut json);
    let mut bytes = domain.as_bytes().to_vec();
    bytes.push(0);
    bytes.extend(json.as_bytes());
    bytes
}

/// The Mojang `serverId` an honest host issues for an account challenge:
/// `lowerhex(SHA256("vesta.host.account.v1\0" || JCS({hostId,deviceKey,purpose,
/// binding,accountId,nonce}))[0..20])`. For `purpose:"signin"` the binding is the
/// certificate fingerprint. Build every argument except `nonce` from values the
/// launcher chose or observed itself (pinned host id, observed fingerprint, its
/// own device key and account), and call Mojang join only when this equals the
/// host's `serverHash`; otherwise a relaying host could spend the join elsewhere.
pub fn account_server_hash(
    host_id: &str,
    device_key: &str,
    purpose: &str,
    binding: &str,
    account_id: &str,
    nonce: &str,
) -> String {
    use sha2::{Digest, Sha256};
    let value = serde_json::json!({"hostId":host_id,"deviceKey":device_key,"purpose":purpose,"binding":binding,"accountId":account_id,"nonce":nonce});
    let digest = Sha256::digest(signing_bytes("vesta.host.account.v1", &value));
    digest[..20].iter().map(|b| format!("{b:02x}")).collect()
}
