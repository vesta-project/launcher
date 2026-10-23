//! Wire-level coverage of central route classification and remote guidance.
use hyper::{service::service_fn, Body, Request, Response, StatusCode};
use reqwest::Method;
use serde_json::json;
use std::{convert::Infallible, sync::Arc, time::Duration};
use tokio::sync::Semaphore;
use vesta_server_client::{
    endpoint::Endpoint, transport::Transport, trust::leaf_fingerprint, ErrorCode,
};

#[tokio::test]
async fn controls_and_session_auth_progress_during_slow_reads_but_obey_remote_guidance() {
    let certificate = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
    let der = certificate.cert.der().to_vec();
    let fingerprint = leaf_fingerprint(&der);
    let config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![rustls::pki_types::CertificateDer::from(der)],
        rustls::pki_types::PrivatePkcs8KeyDer::from(certificate.key_pair.serialize_der()).into(),
    )
    .unwrap();
    let tls = tokio_rustls::TlsAcceptor::from(Arc::new(config));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = Endpoint::parse(&format!("https://{}", listener.local_addr().unwrap())).unwrap();
    let entered = Arc::new(Semaphore::new(0));
    let release = Arc::new(Semaphore::new(0));
    let (server_entered, server_release) = (entered.clone(), release.clone());
    let server = tokio::spawn(async move {
        loop {
            let (socket, _) = listener.accept().await.unwrap();
            let (tls, entered, release) =
                (tls.clone(), server_entered.clone(), server_release.clone());
            tokio::spawn(async move {
                let socket = tls.accept(socket).await.unwrap();
                let service = service_fn(move |request: Request<Body>| {
                    let (entered, release) = (entered.clone(), release.clone());
                    async move {
                        let path = request.uri().path();
                        if request.method() == hyper::Method::GET {
                            entered.add_permits(1);
                            release.acquire().await.unwrap().forget();
                        }
                        let mut response = Response::new(Body::from(
                            json!({"api_version":"3","data":{"ok":true}}).to_string(),
                        ));
                        if path.ends_with("/restart") {
                            *response.status_mut() = StatusCode::SERVICE_UNAVAILABLE;
                            *response.body_mut() = Body::from(
                                json!({"error":{"code":"temporarily_unavailable"}}).to_string(),
                            );
                            response
                                .headers_mut()
                                .insert("retry-after", "1".parse().unwrap());
                        }
                        if path.ends_with("/kill") {
                            *response.status_mut() = StatusCode::TOO_MANY_REQUESTS;
                            *response.body_mut() =
                                Body::from(json!({"error":{"code":"rate_limited"}}).to_string());
                            response
                                .headers_mut()
                                .insert("retry-after", "60".parse().unwrap());
                        }
                        Ok::<_, Infallible>(response)
                    }
                });
                let _ = hyper::server::conn::Http::new()
                    .serve_connection(socket, service)
                    .await;
            });
        }
    });
    let transport = Transport::new(endpoint, Some(fingerprint)).unwrap();
    let mut reads = Vec::new();
    for path in ["/api/v3/manage/panel/one", "/api/v3/manage/panel/two"] {
        let transport = transport.clone();
        reads.push(tokio::spawn(async move {
            transport
                .request(Method::GET, path, Some("session"), None, None, true)
                .await
        }));
    }
    tokio::time::timeout(Duration::from_secs(2), entered.acquire_many(2))
        .await
        .unwrap()
        .unwrap()
        .forget();
    // Neither the legacy interactive flag nor the presence of a bearer token
    // chooses urgent priority: the exact POST route does.
    for (path, token) in [
        ("/api/v3/manage/lifecycle/stop", Some("session")),
        ("/api/v3/auth/session/challenge", None),
        ("/api/v3/auth/session", None),
    ] {
        tokio::time::timeout(
            Duration::from_secs(1),
            transport.request(Method::POST, path, token, None, None, false),
        )
        .await
        .unwrap()
        .unwrap();
    }
    let busy = transport
        .request(
            Method::POST,
            "/api/v3/manage/lifecycle/restart",
            Some("session"),
            None,
            None,
            true,
        )
        .await
        .unwrap_err();
    assert_eq!(busy.code, ErrorCode::ServerBusy);
    assert!(!busy.local_pressure);
    assert_eq!(busy.retry_after_ms, Some(1000));
    let limited = transport
        .request(
            Method::POST,
            "/api/v3/manage/lifecycle/kill",
            Some("session"),
            None,
            None,
            true,
        )
        .await
        .unwrap_err();
    assert_eq!(limited.code, ErrorCode::RateLimited);
    assert!(!limited.local_pressure);
    assert_eq!(limited.retry_after_ms, Some(60_000));
    let paused = transport
        .request(
            Method::POST,
            "/api/v3/manage/lifecycle/stop",
            Some("session"),
            None,
            None,
            true,
        )
        .await
        .unwrap_err();
    assert_eq!(paused.code, ErrorCode::RateLimited);
    assert!(paused.local_pressure);
    assert!(paused.retry_after_ms.unwrap() > 50_000);
    release.add_permits(2);
    for read in reads {
        read.await.unwrap().unwrap();
    }
    server.abort();
}
