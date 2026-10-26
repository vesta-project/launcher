//! Application-level link shaping, not packet-level mobile-network emulation.
//! Each test uses a single async executor, local pinned TLS and bounded bodies.
use hyper::{service::service_fn, Body, Request, Response};
use reqwest::Method;
use serde_json::json;
use std::{
    convert::Infallible,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio::{sync::Semaphore, task::JoinHandle};
use vesta_server_client::{
    endpoint::Endpoint, transport::Transport, trust::leaf_fingerprint, ErrorCode,
};

const RESPONSE_BYTES: usize = 32 * 1024;
const CHUNK: usize = 1024;

#[derive(Clone, Copy)]
struct Link {
    latency: Duration,
    bytes_per_second: usize,
}

struct Fixture {
    transport: Arc<Transport>,
    reads: Arc<AtomicUsize>,
    mutations: Arc<AtomicUsize>,
    entered: Arc<Semaphore>,
    server: JoinHandle<()>,
    bodies: Arc<Mutex<Vec<JoinHandle<()>>>>,
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
        for task in self.bodies.lock().unwrap().drain(..) {
            task.abort();
        }
    }
}

impl Fixture {
    async fn start(link: Link) -> Self {
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
            rustls::pki_types::PrivatePkcs8KeyDer::from(certificate.key_pair.serialize_der())
                .into(),
        )
        .unwrap();
        let tls = tokio_rustls::TlsAcceptor::from(Arc::new(config));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint =
            Endpoint::parse(&format!("https://{}", listener.local_addr().unwrap())).unwrap();
        let reads = Arc::new(AtomicUsize::new(0));
        let mutations = Arc::new(AtomicUsize::new(0));
        let entered = Arc::new(Semaphore::new(0));
        let bodies = Arc::new(Mutex::new(Vec::new()));
        // Responses compete for one link, rather than each receiving the
        // nominal rate independently. No thread sleeps or busy polling.
        let next_chunk = Arc::new(tokio::sync::Mutex::new(tokio::time::Instant::now()));
        let (count, writes, started, producers) = (
            reads.clone(),
            mutations.clone(),
            entered.clone(),
            bodies.clone(),
        );
        let server = tokio::spawn(async move {
            let mut connections = tokio::task::JoinSet::new();
            loop {
                tokio::select! {
                    accepted = listener.accept() => {
                        let (socket, _) = accepted.unwrap();
                        let (tls, count, writes, started, producers, next_chunk) = (
                            tls.clone(), count.clone(), writes.clone(), started.clone(), producers.clone(), next_chunk.clone(),
                        );
                        connections.spawn(async move {
                            let socket = tls.accept(socket).await.unwrap();
                            let service = service_fn(move |request: Request<Body>| {
                                let (count, writes, started, producers, next_chunk) = (
                                    count.clone(), writes.clone(), started.clone(), producers.clone(), next_chunk.clone(),
                                );
                                async move {
                                    if request.method() != hyper::Method::GET {
                                        writes.fetch_add(1, Ordering::SeqCst);
                                    }
                                    let slow = request.uri().path().ends_with("/slow");
                                    let stalled = request.uri().path().ends_with("/stalled");
                                    let dropped = request.uri().path().ends_with("/dropped");
                                    if slow || stalled {
                                        count.fetch_add(1, Ordering::SeqCst);
                                        started.add_permits(1);
                                    }
                                    tokio::time::sleep(link.latency).await;
                                    let payload = json!({"api_version":"3","data":{
                                        "ok":true,"padding":if slow { "x".repeat(RESPONSE_BYTES) } else { String::new() }
                                    }}).to_string();
                                    let (mut sender, body) = Body::channel();
                                    producers.lock().unwrap().push(tokio::spawn(async move {
                                        if stalled {
                                            // Client's real 15s deadline, not a shortened fixture timeout.
                                            std::future::pending::<()>().await;
                                        } else if dropped {
                                            let _ = sender.send_data("{\"api_version\":\"3\",\"data\":".into()).await;
                                            sender.abort();
                                        } else {
                                            for chunk in payload.as_bytes().chunks(CHUNK) {
                                                let at = {
                                                    let mut next = next_chunk.lock().await;
                                                    *next = (*next).max(tokio::time::Instant::now())
                                                        + Duration::from_secs_f64(chunk.len() as f64 / link.bytes_per_second as f64);
                                                    *next
                                                };
                                                tokio::time::sleep_until(at).await;
                                                if sender.send_data(chunk.to_vec().into()).await.is_err() { break; }
                                            }
                                        }
                                    }));
                                    Ok::<_, Infallible>(Response::new(body))
                                }
                            });
                            let _ = hyper::server::conn::Http::new().serve_connection(socket, service).await;
                        });
                    }
                    _ = connections.join_next(), if !connections.is_empty() => {}
                }
            }
        });
        Self {
            transport: Transport::new(endpoint, Some(fingerprint)).unwrap(),
            reads,
            mutations,
            entered,
            server,
            bodies,
        }
    }

    async fn stop(&self) {
        let start = Instant::now();
        tokio::time::timeout(
            Duration::from_secs(4),
            self.transport.request(
                Method::POST,
                "/api/v3/manage/lifecycle/stop",
                Some("fixture"),
                None,
                Some("stop-intent"),
                true,
            ),
        )
        .await
        .expect("control starved behind slow reads")
        .unwrap();
        eprintln!("control latency: {:?}", start.elapsed());
    }
}

#[tokio::test]
async fn shaped_links_coalesce_reads_and_leave_control_capacity() {
    for (label, link) in [
        (
            "3G-like",
            Link {
                latency: Duration::from_millis(400),
                bytes_per_second: 50_000,
            },
        ),
        (
            "poor",
            Link {
                latency: Duration::from_millis(1200),
                bytes_per_second: 8 * 1024,
            },
        ),
    ] {
        let fixture = Fixture::start(link).await;
        let start = Instant::now();
        let mut readers = tokio::task::JoinSet::new();
        let completed = Arc::new(AtomicUsize::new(0));
        for index in 0..16 {
            let transport = fixture.transport.clone();
            let completed = completed.clone();
            readers.spawn(async move {
                // Two distinct reads fill both ordinary lanes. Other callers share them.
                let path = format!("/api/v3/manage/read/{}/slow", index % 2);
                let result = transport
                    .request(Method::GET, &path, Some("fixture"), None, None, true)
                    .await;
                completed.fetch_add(1, Ordering::SeqCst);
                result
            });
        }
        tokio::time::timeout(Duration::from_secs(3), fixture.entered.acquire_many(2))
            .await
            .unwrap()
            .unwrap()
            .forget();
        fixture.stop().await;
        // A completed control cannot depend on draining either large response.
        assert_eq!(
            completed.load(Ordering::SeqCst),
            0,
            "control waited for read completion"
        );
        assert!(start.elapsed() < link.latency + Duration::from_secs(4));
        while let Some(result) = readers.join_next().await {
            assert_eq!(
                result.unwrap().unwrap()["padding"].as_str().unwrap().len(),
                RESPONSE_BYTES
            );
        }
        assert_eq!(
            fixture.reads.load(Ordering::SeqCst),
            2,
            "duplicate reads on {label}"
        );
        assert_eq!(fixture.mutations.load(Ordering::SeqCst), 1);
        eprintln!(
            "{label}: two shaped 32KiB reads, 16 callers, {:?}",
            start.elapsed()
        );
    }
}

#[tokio::test]
async fn dropped_mutation_reply_is_uncertain_and_never_replayed() {
    let fixture = Fixture::start(Link {
        latency: Duration::from_millis(400),
        bytes_per_second: 8 * 1024,
    })
    .await;
    let error = fixture
        .transport
        .request(
            Method::POST,
            "/api/v3/manage/lifecycle/dropped",
            Some("fixture"),
            Some(json!({"action":"fixture"})),
            Some("one-intent"),
            true,
        )
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::OutcomeUnknown);
    assert_eq!(fixture.mutations.load(Ordering::SeqCst), 1);
    fixture.stop().await;
    assert_eq!(fixture.mutations.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn stalled_reads_expire_release_capacity_and_do_not_block_control() {
    let fixture = Fixture::start(Link {
        latency: Duration::from_millis(100),
        bytes_per_second: 8 * 1024,
    })
    .await;
    let start = Instant::now();
    let mut readers = tokio::task::JoinSet::new();
    for index in 0..2 {
        let transport = fixture.transport.clone();
        readers.spawn(async move {
            transport
                .request(
                    Method::GET,
                    &format!("/api/v3/manage/read/{index}/stalled"),
                    Some("fixture"),
                    None,
                    None,
                    true,
                )
                .await
        });
    }
    tokio::time::timeout(Duration::from_secs(3), fixture.entered.acquire_many(2))
        .await
        .unwrap()
        .unwrap()
        .forget();
    fixture.stop().await;
    while let Some(result) = tokio::time::timeout(Duration::from_secs(18), readers.join_next())
        .await
        .unwrap()
    {
        assert_eq!(result.unwrap().unwrap_err().code, ErrorCode::Timeout);
    }
    let recovered = fixture
        .transport
        .request(
            Method::GET,
            "/api/v3/manage/read/recovered",
            Some("fixture"),
            None,
            None,
            true,
        )
        .await
        .unwrap();
    assert_eq!(recovered["ok"], true);
    assert_eq!(
        fixture.reads.load(Ordering::SeqCst),
        2,
        "timeout must not retry the read"
    );
    eprintln!("stalled reads released after {:?}", start.elapsed());
}
