//! LAN discovery records are untrusted hints, never TLS trust anchors.
use mdns_sd::{ServiceDaemon, ServiceEvent};
use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

pub const SERVICE_TYPE: &str = "_vesta._tcp.local.";
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimState {
    Unclaimed,
    Claimed,
}
impl ClaimState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unclaimed => "unclaimed",
            Self::Claimed => "claimed",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TxtRecord {
    pub id: String,
    pub fingerprint: String,
    pub name: String,
    pub state: ClaimState,
}
impl TxtRecord {
    pub fn properties(&self) -> Result<Vec<(String, String)>, &'static str> {
        let id = uuid::Uuid::parse_str(&self.id).map_err(|_| "invalid host id")?;
        if id.to_string() != self.id {
            return Err("noncanonical host id");
        }
        if self.fingerprint.len() != 64
            || !self
                .fingerprint
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err("invalid fingerprint");
        }
        if self.name.len() > 63 || self.name.chars().any(char::is_control) {
            return Err("invalid name");
        }
        let props = [
            ("v", "1"),
            ("id", &self.id),
            ("fp", &self.fingerprint),
            ("name", &self.name),
            ("state", self.state.as_str()),
            ("tls", "1"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_owned(), v.to_owned()))
        .collect::<Vec<_>>();
        if props.iter().any(|(k, v)| k.len() + 1 + v.len() > 255)
            || props
                .iter()
                .map(|(k, v)| k.len() + 1 + v.len() + 1)
                .sum::<usize>()
                > 900
        {
            return Err("TXT too large");
        }
        Ok(props)
    }
    pub fn parse(
        properties: impl IntoIterator<Item = (String, Vec<u8>)>,
    ) -> Result<Self, &'static str> {
        let mut values = BTreeMap::new();
        let mut size = 0;
        for (key, value) in properties {
            size += 1 + key.len() + 1 + value.len();
            if key.len() + 1 + value.len() > 255
                || values
                    .insert(key, String::from_utf8(value).map_err(|_| "invalid UTF-8")?)
                    .is_some()
            {
                return Err("invalid TXT");
            }
        }
        if size > 900
            || values.len() != 6
            || values.get("v").map(String::as_str) != Some("1")
            || values.get("tls").map(String::as_str) != Some("1")
        {
            return Err("invalid TXT");
        }
        let state = match values.get("state").map(String::as_str) {
            Some("claimed") => ClaimState::Claimed,
            Some("unclaimed") => ClaimState::Unclaimed,
            _ => return Err("invalid state"),
        };
        let record = Self {
            id: values.remove("id").ok_or("missing id")?,
            fingerprint: values.remove("fp").ok_or("missing fp")?,
            name: values.remove("name").ok_or("missing name")?,
            state,
        };
        record.properties()?;
        Ok(record)
    }
}
#[derive(Debug, Clone)]
pub struct DiscoveredHost {
    pub txt: TxtRecord,
    pub hostname: String,
    pub port: u16,
    pub addresses: Vec<mdns_sd::ScopedIp>,
}
/// Browse for a bounded interval; duplicate host IDs replace earlier hints. Confirm identity over TLS/PAKE.
pub fn browse(timeout: Duration) -> Result<Vec<DiscoveredHost>, mdns_sd::Error> {
    let daemon = ServiceDaemon::new()?;
    let events = daemon.browse(SERVICE_TYPE)?;
    let end = Instant::now() + timeout;
    let mut hosts = BTreeMap::new();
    while let Some(remaining) = end.checked_duration_since(Instant::now()) {
        match events.recv_timeout(remaining) {
            Ok(ServiceEvent::ServiceResolved(s)) => {
                let props = s
                    .get_properties()
                    .iter()
                    .map(|p| (p.key().to_string(), p.val().unwrap_or_default().to_vec()))
                    .collect::<Vec<_>>();
                if let Ok(txt) = TxtRecord::parse(props) {
                    if s.get_port() != 0
                        && s.get_fullname()
                            .eq_ignore_ascii_case(&format!("Vesta-{}.{}", txt.id, SERVICE_TYPE))
                        && s.get_hostname().to_ascii_lowercase().ends_with(".local.")
                        && !s.get_addresses().is_empty()
                    {
                        hosts.insert(
                            txt.id.clone(),
                            DiscoveredHost {
                                txt,
                                hostname: s.get_hostname().to_owned(),
                                port: s.get_port(),
                                addresses: s.get_addresses().iter().cloned().collect(),
                            },
                        );
                    }
                }
            }
            Ok(ServiceEvent::ServiceRemoved(_, fullname)) => {
                hosts.retain(|id, _| {
                    !fullname.eq_ignore_ascii_case(&format!("Vesta-{}.{}", id, SERVICE_TYPE))
                });
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }
    let _ = daemon.shutdown();
    Ok(hosts.into_values().collect())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn record() -> TxtRecord {
        TxtRecord {
            id: "11111111-1111-4111-8111-111111111111".into(),
            fingerprint: "a".repeat(64),
            name: "Server".into(),
            state: ClaimState::Unclaimed,
        }
    }
    #[test]
    fn txt_roundtrip_and_limits() {
        let r = record();
        let p = r.properties().unwrap();
        assert_eq!(
            TxtRecord::parse(p.into_iter().map(|(k, v)| (k, v.into_bytes()))).unwrap(),
            r
        );
        let mut r = record();
        r.name = "é".repeat(32);
        assert!(r.properties().is_err());
        r.name = "x".into();
        r.fingerprint = "A".repeat(64);
        assert!(r.properties().is_err());
    }
    #[test]
    fn malformed_txt_rejected() {
        let r = record();
        let mut p = r
            .properties()
            .unwrap()
            .into_iter()
            .map(|(k, v)| (k, v.into_bytes()))
            .collect::<Vec<_>>();
        p.push(("v".into(), b"1".to_vec()));
        assert!(TxtRecord::parse(p).is_err());
    }
}
