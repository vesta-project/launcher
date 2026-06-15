use reqwest::Client;
use std::sync::OnceLock;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProxyConfig {
    pub enabled: bool,
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedProxy {
    pub scheme: String,
    pub host: String,
    pub port: u16,
    pub has_credentials: bool,
}

fn base_client_builder() -> reqwest::ClientBuilder {
    Client::builder()
        .pool_max_idle_per_host(8)
        .tcp_keepalive(Some(Duration::from_secs(30)))
        .timeout(Duration::from_secs(120))
        .user_agent("VestaLauncher/1.0")
        .redirect(reqwest::redirect::Policy::limited(10))
}

pub fn configure_proxy(config: ProxyConfig) -> Result<(), String> {
    if config.enabled {
        let url = config
            .url
            .as_deref()
            .ok_or_else(|| "Proxy URL is required when proxy is enabled".to_string())?;
        validate_proxy_url(url)?;
    }

    if let Some(existing) = SHARED_PROXY_CONFIG.get() {
        return if existing == &config {
            Ok(())
        } else {
            Err("HTTP proxy configuration was already initialized".to_string())
        };
    }

    SHARED_PROXY_CONFIG
        .set(config)
        .map_err(|_| "HTTP proxy configuration was already initialized".to_string())
}

pub fn configured_proxy() -> ProxyConfig {
    SHARED_PROXY_CONFIG
        .get()
        .cloned()
        .unwrap_or_else(|| ProxyConfig {
            enabled: false,
            url: None,
        })
}

pub(crate) fn configured_proxy_url() -> Option<String> {
    let config = configured_proxy();
    if !config.enabled {
        return None;
    }
    config
        .url
        .map(|url| url.trim().to_string())
        .filter(|url| !url.is_empty())
}

pub fn redact_proxy_url(raw_url: &str) -> String {
    let trimmed = raw_url.trim();
    let Ok(mut parsed) = reqwest::Url::parse(trimmed) else {
        return "<invalid proxy url>".to_string();
    };

    if !parsed.username().is_empty() || parsed.password().is_some() {
        let had_password = parsed.password().is_some();
        let _ = parsed.set_username("redacted");
        let _ = parsed.set_password(if had_password { Some("redacted") } else { None });
    }

    parsed.to_string()
}

pub fn redact_configured_proxy_secrets(message: &str) -> String {
    let Some(proxy_url) = configured_proxy_url() else {
        return message.to_string();
    };

    let redacted_url = redact_proxy_url(&proxy_url);
    message.replace(&proxy_url, &redacted_url)
}

pub fn validate_proxy_url(raw_url: &str) -> Result<ParsedProxy, String> {
    let trimmed = raw_url.trim();
    if trimmed.is_empty() {
        return Err("Proxy URL cannot be empty".to_string());
    }

    let parsed = reqwest::Url::parse(trimmed).map_err(|e| format!("Invalid proxy URL: {e}"))?;
    let scheme = parsed.scheme().to_ascii_lowercase();
    match scheme.as_str() {
        "http" | "https" | "socks5" | "socks5h" => {}
        _ => {
            return Err(
                "Proxy URL must use http://, https://, socks5://, or socks5h://".to_string(),
            )
        }
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "Proxy URL must include a host".to_string())?
        .to_string();

    if !parsed.path().is_empty() && parsed.path() != "/" {
        return Err("Proxy URL must not include a path".to_string());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("Proxy URL must not include query parameters or fragments".to_string());
    }

    let port = parsed
        .port_or_known_default()
        .unwrap_or(match scheme.as_str() {
            "http" => 80,
            "https" => 443,
            "socks5" | "socks5h" => 1080,
            _ => unreachable!(),
        });

    Ok(ParsedProxy {
        scheme,
        host,
        port,
        has_credentials: !parsed.username().is_empty() || parsed.password().is_some(),
    })
}

pub fn build_client_with_proxy(proxy_url: Option<&str>) -> Result<Client, reqwest::Error> {
    let mut builder = base_client_builder();
    if let Some(raw_url) = proxy_url.map(str::trim).filter(|url| !url.is_empty()) {
        builder = builder.proxy(reqwest::Proxy::all(raw_url)?);
    }
    builder.build()
}

pub fn build_reqwest12_client_with_proxy(
    proxy_url: Option<&str>,
) -> Result<reqwest12::Client, reqwest12::Error> {
    let mut builder = reqwest12::Client::builder()
        .pool_max_idle_per_host(8)
        .tcp_keepalive(Some(Duration::from_secs(30)))
        .timeout(Duration::from_secs(120))
        .user_agent("VestaLauncher/1.0");

    if let Some(raw_url) = proxy_url.map(str::trim).filter(|url| !url.is_empty()) {
        builder = builder.proxy(reqwest12::Proxy::all(raw_url)?);
    }

    builder.build()
}

pub fn build_configured_reqwest12_client() -> Result<reqwest12::Client, reqwest12::Error> {
    build_reqwest12_client_with_proxy(configured_proxy_url().as_deref())
}

pub async fn oauth_http_client(
    request: oauth2::HttpRequest,
) -> Result<oauth2::HttpResponse, oauth2::reqwest::Error<reqwest::Error>> {
    let mut builder = base_client_builder().redirect(reqwest::redirect::Policy::none());
    if let Some(proxy_url) = configured_proxy_url() {
        builder = builder
            .proxy(reqwest::Proxy::all(&proxy_url).map_err(oauth2::reqwest::Error::Reqwest)?);
    }

    let client = builder.build().map_err(oauth2::reqwest::Error::Reqwest)?;
    let mut request_builder = client
        .request(request.method, request.url.as_str())
        .body(request.body);

    for (name, value) in &request.headers {
        request_builder = request_builder.header(name.as_str(), value.as_bytes());
    }

    let request = request_builder
        .build()
        .map_err(oauth2::reqwest::Error::Reqwest)?;
    let response = client
        .execute(request)
        .await
        .map_err(oauth2::reqwest::Error::Reqwest)?;
    let status_code = response.status();
    let headers = response.headers().to_owned();
    let body = response
        .bytes()
        .await
        .map_err(oauth2::reqwest::Error::Reqwest)?
        .to_vec();

    Ok(oauth2::HttpResponse {
        status_code,
        headers,
        body,
    })
}

fn build_shared_client() -> Client {
    match build_client_with_proxy(configured_proxy_url().as_deref()) {
        Ok(client) => client,
        Err(e) => {
            log::error!(
                "Failed to build configured HTTP client for {}; falling back to direct networking: {}",
                configured_proxy_url()
                    .as_deref()
                    .map(redact_proxy_url)
                    .unwrap_or_else(|| "<direct>".to_string()),
                redact_configured_proxy_secrets(&e.to_string())
            );
            build_client_with_proxy(None).expect("Failed to build shared HTTP client")
        }
    }
}

pub fn shared_client() -> &'static Client {
    SHARED_CLIENT.get_or_init(build_shared_client)
}

static SHARED_CLIENT: OnceLock<Client> = OnceLock::new();
static SHARED_PROXY_CONFIG: OnceLock<ProxyConfig> = OnceLock::new();

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_supported_proxy_urls() {
        let http = validate_proxy_url("http://127.0.0.1:8080").unwrap();
        assert_eq!(http.scheme, "http");
        assert_eq!(http.host, "127.0.0.1");
        assert_eq!(http.port, 8080);
        assert!(!http.has_credentials);

        let socks = validate_proxy_url("socks5h://user:pass@example.test:1081").unwrap();
        assert_eq!(socks.scheme, "socks5h");
        assert_eq!(socks.host, "example.test");
        assert_eq!(socks.port, 1081);
        assert!(socks.has_credentials);
    }

    #[test]
    fn rejects_unsupported_or_ambiguous_proxy_urls() {
        assert!(validate_proxy_url("").is_err());
        assert!(validate_proxy_url("ftp://proxy.example.test:21").is_err());
        assert!(validate_proxy_url("http:///missing-host").is_err());
        assert!(validate_proxy_url("http://proxy.example.test/path").is_err());
        assert!(validate_proxy_url("http://proxy.example.test?x=1").is_err());
    }

    #[test]
    fn builds_direct_and_proxy_clients() {
        build_client_with_proxy(None).unwrap();
        build_client_with_proxy(Some("http://127.0.0.1:8080")).unwrap();
    }

    #[test]
    fn redacts_proxy_credentials() {
        assert_eq!(
            redact_proxy_url("http://user:pass@example.test:8080"),
            "http://redacted:redacted@example.test:8080/"
        );
        assert_eq!(
            redact_proxy_url("socks5h://user@example.test:1080"),
            "socks5h://redacted@example.test:1080/"
        );
        assert_eq!(
            redact_proxy_url("http://127.0.0.1:8080"),
            "http://127.0.0.1:8080/"
        );
        assert_eq!(redact_proxy_url("http://[::1]:8080"), "http://[::1]:8080/");
        assert_eq!(redact_proxy_url("not a url"), "<invalid proxy url>");
    }
}
