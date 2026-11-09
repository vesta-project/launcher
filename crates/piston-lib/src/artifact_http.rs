//! Public-only artifact GETs. No provider credentials/default headers/proxies.
//! Resolve once per hop, pin the exact numeric answers into reqwest, and verify
//! the observed peer belongs to that set. The URI stays unchanged for TLS/SNI.
use crate::public_address::{is_public_ip, peer_matches, public_answers};
use reqwest::{Response, Url};
use std::{
    net::{IpAddr, SocketAddr},
    time::Duration,
};
#[cfg(test)]
static LIVE_CLIENT_BUILDS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

fn refused() -> anyhow::Error {
    anyhow::anyhow!("public_artifact_destination_required")
}
fn validate(url: &Url) -> anyhow::Result<()> {
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host().is_none()
    {
        return Err(refused());
    }
    match url.host() {
        Some(url::Host::Ipv4(ip)) if !is_public_ip(IpAddr::V4(ip)) => Err(refused()),
        Some(url::Host::Ipv6(ip)) if !is_public_ip(IpAddr::V6(ip)) => Err(refused()),
        _ => Ok(()),
    }
}
fn checked(addresses: Vec<SocketAddr>) -> anyhow::Result<Vec<SocketAddr>> {
    if !public_answers(&addresses) || addresses.iter().any(|a| a.port() == 0) {
        return Err(refused());
    }
    Ok(addresses)
}
fn check_peer(addresses: &[SocketAddr], peer: Option<SocketAddr>) -> anyhow::Result<()> {
    if !peer.is_some_and(|p| addresses.iter().any(|a| peer_matches(*a, p))) {
        return Err(refused());
    }
    Ok(())
}
/// One hop for callers which enforce their own stricter redirect/provider policy.
pub async fn get_one(url: &Url) -> anyhow::Result<Response> {
    get_one_with_timeout(url, Duration::from_secs(120)).await
}
async fn get_one_with_timeout(url: &Url, timeout: Duration) -> anyhow::Result<Response> {
    let started = std::time::Instant::now();
    validate(url)?;
    if crate::client::configured_proxy().enabled {
        return Err(anyhow::anyhow!("public_artifact_proxy_unsupported"));
    }
    let port = url.port_or_known_default().ok_or_else(refused)?;
    let host = url.host_str().ok_or_else(refused)?;
    let addresses = match url.host() {
        Some(url::Host::Ipv4(ip)) => vec![SocketAddr::new(IpAddr::V4(ip), port)],
        Some(url::Host::Ipv6(ip)) => vec![SocketAddr::new(IpAddr::V6(ip), port)],
        _ => tokio::time::timeout(
            timeout.min(Duration::from_secs(10)),
            tokio::net::lookup_host((host, port)),
        )
        .await
        .map_err(|_| anyhow::anyhow!("artifact_dns_timeout"))?
        .map_err(|_| anyhow::anyhow!("artifact_dns_failed"))?
        .collect(),
    };
    let addresses = checked(addresses)?;
    let timeout = timeout
        .checked_sub(started.elapsed())
        .filter(|v| !v.is_zero())
        .ok_or_else(|| anyhow::anyhow!("artifact_request_timeout"))?;
    #[cfg(test)]
    LIVE_CLIENT_BUILDS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let client = reqwest::Client::builder()
        .no_proxy()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host, &addresses)
        .connect_timeout(timeout.min(Duration::from_secs(10)))
        .timeout(timeout)
        .user_agent(concat!("VestaLauncher/", env!("CARGO_PKG_VERSION")))
        .build()?;
    let response = client
        .get(url.clone())
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("artifact_request_failed"))?;
    check_peer(&addresses, response.remote_addr())?;
    Ok(response)
}
/// Artifact redirects never inherit provider API headers, cookies or credentials.
pub async fn get(raw: &str) -> anyhow::Result<Response> {
    get_with_timeout(raw, Duration::from_secs(120)).await
}
pub async fn get_with_timeout(raw: &str, timeout: Duration) -> anyhow::Result<Response> {
    follow(raw, timeout, |url, remaining| async move {
        get_one_with_timeout(&url, remaining).await
    })
    .await
}
async fn follow<F, Fut>(raw: &str, timeout: Duration, mut fetch: F) -> anyhow::Result<Response>
where
    F: FnMut(Url, Duration) -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<Response>>,
{
    let mut url = Url::parse(raw).map_err(|_| refused())?;
    let start = std::time::Instant::now();
    for hop in 0..=6 {
        let remaining = timeout
            .checked_sub(start.elapsed())
            .ok_or_else(|| anyhow::anyhow!("artifact_request_timeout"))?;
        validate(&url)?;
        let response = fetch(url.clone(), remaining).await?;
        if matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
            if hop == 6 {
                return Err(anyhow::anyhow!("artifact_redirect_limit"));
            }
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(refused)?;
            if location.len() > 2048 || location.chars().any(char::is_control) {
                return Err(refused());
            }
            url = url.join(location).map_err(|_| refused())?;
            validate(&url)?;
        } else {
            return Ok(response);
        }
    }
    unreachable!()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn private_literals_rejected_without_any_network() {
        for raw in [
            "https://127.0.0.1/a",
            "https://169.254.169.254/a",
            "https://[::1]/a",
            "https://[::ffff:10.0.0.1]/a",
            "http://8.8.8.8/a",
            "https://FAKE:SECRET@8.8.8.8/a",
        ] {
            assert_eq!(
                get(raw).await.unwrap_err().to_string(),
                "public_artifact_destination_required"
            );
        }
    }
    #[test]
    fn injected_answers_and_observed_peer_fail_closed() {
        let public = "8.8.8.8:443".parse().unwrap();
        let private = "127.0.0.1:443".parse().unwrap();
        assert!(checked(vec![public]).is_ok());
        assert!(checked(vec![]).is_err());
        assert!(checked(vec![public, private]).is_err());
        assert!(check_peer(&[public], Some(public)).is_ok());
        assert!(check_peer(&[public], Some(private)).is_err());
        assert!(check_peer(&[public], Some("1.1.1.1:443".parse().unwrap())).is_err());
        assert!(check_peer(&[public], None).is_err());
        let base = Url::parse("https://artifact.example/a").unwrap();
        assert!(validate(&base.join("https://[fc00::1]/a").unwrap()).is_err());
    }
    #[tokio::test]
    async fn every_redirect_is_validated_before_injected_transport() {
        use std::sync::{Arc, Mutex};
        use wiremock::{matchers::path, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(path("/private"))
            .respond_with(
                ResponseTemplate::new(302)
                    .insert_header("Location", "https://169.254.169.254/never-contacted"),
            )
            .mount(&server)
            .await;
        Mock::given(path("/public"))
            .respond_with(
                ResponseTemplate::new(302).insert_header("Location", "https://second.example/done"),
            )
            .mount(&server)
            .await;
        Mock::given(path("/done"))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;
        for (path, want_ok, want_calls) in [("private", false, 1), ("public", true, 2)] {
            let seen = Arc::new(Mutex::new(Vec::new()));
            let calls = seen.clone();
            let origin = server.uri();
            let result = follow(
                &format!("https://first.example/{path}"),
                Duration::from_secs(2),
                move |url, _| {
                    calls.lock().unwrap().push(url.to_string());
                    let target = format!("{}{}", origin, url.path());
                    async move {
                        Ok(reqwest::Client::builder()
                            .no_proxy()
                            .redirect(reqwest::redirect::Policy::none())
                            .build()?
                            .get(target)
                            .send()
                            .await?)
                    }
                },
            )
            .await;
            assert_eq!(result.is_ok(), want_ok);
            assert_eq!(seen.lock().unwrap().len(), want_calls);
        }
        assert_eq!(
            server.received_requests().await.unwrap().len(),
            3,
            "no request for denied redirect"
        );
    }
}

#[cfg(test)]
#[path = "artifact_http_public_compat.rs"]
mod public_compat;
