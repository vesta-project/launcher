use crate::{Error, ErrorCode, Result};
use url::{Host, Url};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Endpoint {
    url: Url,
}
#[derive(Clone, Debug)]
pub struct Address {
    pub endpoint: Endpoint,
    pub code: Option<String>,
    pub fingerprint: Option<String>,
    pub server_id: Option<String>,
}

#[cfg(test)]
mod game_address_tests {
    use super::Endpoint;
    #[test]
    fn game_port_uses_validated_host_for_saved_endpoints() {
        for (endpoint, expected) in [
            ("localhost:8443", "localhost:25565"),
            ("https://example.com:8443/", "example.com:25565"),
            ("[::1]:8443", "[::1]:25565"),
            ("127.0.0.1:8443", "127.0.0.1:25565"),
        ] {
            assert_eq!(Endpoint::parse(endpoint).unwrap().game_address(25565), expected);
        }
    }
}
impl Endpoint {
    pub fn parse(input: &str) -> Result<Self> {
        let bad = || Error::new(ErrorCode::InvalidAddress);
        if input.len() > 2048
            || input.chars().any(|c| c.is_control() || c.is_whitespace())
            || input.contains('\\')
        {
            return Err(bad());
        }
        let raw = if input.contains("://") {
            input.to_owned()
        } else {
            format!("https://{input}")
        };
        let mut url = Url::parse(&raw).map_err(|_| bad())?;
        if url.scheme() != "https"
            || url.host().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.fragment().is_some()
            || url.query().is_some()
            || url.path() != "/"
            || url.port() == Some(0)
            || raw
                .split("://")
                .nth(1)
                .unwrap_or("")
                .split('/')
                .next()
                .unwrap_or("")
                .contains('@')
        {
            return Err(bad());
        }
        if url.port().is_none() && !raw.trim_end_matches('/').ends_with(":443") {
            url.set_port(Some(8443)).map_err(|_| bad())?;
        }
        Ok(Self { url })
    }
    pub fn url(&self) -> &Url {
        &self.url
    }
    /// Use the management host with Minecraft's separately advertised port.
    pub fn game_address(&self, port: u16) -> String {
        let host = match self.url.host().expect("validated host") {
            Host::Ipv6(value) => format!("[{value}]"),
            value => value.to_string(),
        };
        format!("{host}:{port}")
    }
    pub fn display(&self) -> String {
        let host = match self.url.host().expect("validated host") {
            Host::Ipv6(v) => format!("[{v}]"),
            h => h.to_string(),
        };
        format!(
            "{host}:{}",
            self.url.port_or_known_default().unwrap_or(8443)
        )
    }
    pub(crate) fn route(&self, path: &str) -> Result<Url> {
        if !path.starts_with("/api/v3/")
            || path.contains('#')
            || path.split('?').next().unwrap_or(path).contains("..")
        {
            return Err(Error::new(ErrorCode::InvalidInput));
        }
        self.url
            .join(path)
            .map_err(|_| Error::new(ErrorCode::InvalidInput))
    }
}
pub fn fingerprint(value: &str) -> Result<String> {
    if value.len() != 64 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(Error::new(ErrorCode::InvalidInput));
    }
    Ok(value.to_ascii_lowercase())
}
impl Address {
    pub fn parse(input: &str) -> Result<Self> {
        let input = input.trim();
        if !input.starts_with("vesta:") {
            return Ok(Self {
                endpoint: Endpoint::parse(input)?,
                code: None,
                fingerprint: None,
                server_id: None,
            });
        }
        let bad = || Error::new(ErrorCode::InvalidAddress);
        let link = Url::parse(input).map_err(|_| bad())?;
        if link.host_str() != Some("pair")
            || !link.username().is_empty()
            || link.password().is_some()
            || link.fragment().is_some()
            || !matches!(link.path(), "" | "/")
            || link.port().is_some()
        {
            return Err(bad());
        }
        let mut fields = std::collections::HashMap::new();
        for (k, v) in link.query_pairs() {
            if !["endpoint", "code", "fp", "sid"].contains(&k.as_ref())
                || fields.insert(k.into_owned(), v.into_owned()).is_some()
            {
                return Err(bad());
            }
        }
        let endpoint = Endpoint::parse(fields.get("endpoint").ok_or_else(bad)?)?;
        let code = fields
            .remove("code")
            .filter(|v| !v.is_empty() && v.len() <= 256)
            .ok_or_else(bad)?;
        let fp = fingerprint(&fields.remove("fp").ok_or_else(bad)?).map_err(|_| bad())?;
        let server_id = fields
            .remove("sid")
            .filter(|v| !v.is_empty() && v.len() <= 256 && !v.chars().any(char::is_control))
            .ok_or_else(bad)?;
        Ok(Self {
            endpoint,
            code: Some(code),
            fingerprint: Some(fp),
            server_id: Some(server_id),
        })
    }
}
