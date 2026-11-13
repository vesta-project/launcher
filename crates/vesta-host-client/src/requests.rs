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
