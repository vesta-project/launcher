//! Opt-in public compatibility. Fixture records contain only public URLs/digests.
use super::*;
use serde_json::{json, Value};
use sha1::Digest;
use std::sync::atomic::Ordering;
const ROOT: &str = "V:/BIG_BURGS-backend-pass/public-compat-fixtures";
const CAP: usize = 2 * 1024 * 1024;
fn fixture(label: &str) -> anyhow::Result<Value> {
    Ok(serde_json::from_slice(&std::fs::read(format!(
        "{ROOT}/{label}.json"
    ))?)?)
}
async fn body(mut response: Response) -> anyhow::Result<(Vec<u8>, String)> {
    anyhow::ensure!(
        response.status().is_success(),
        "http_status_{}",
        response.status().as_u16()
    );
    anyhow::ensure!(
        !response.content_length().is_some_and(|n| n > CAP as u64),
        "declared_cap"
    );
    let version = format!("{:?}", response.version());
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| anyhow::anyhow!("body_read"))?
    {
        anyhow::ensure!(bytes.len() + chunk.len() <= CAP, "actual_byte_cap");
        bytes.extend_from_slice(&chunk);
    }
    Ok((bytes, version))
}
fn verify(bytes: &[u8], hash: &Value) -> anyhow::Result<()> {
    let actual = match hash["algorithm"].as_str() {
        Some("sha1") => format!("{:x}", sha1::Sha1::digest(bytes)),
        Some("sha512") => format!("{:x}", sha2::Sha512::digest(bytes)),
        _ => anyhow::bail!("hash_algorithm"),
    };
    anyhow::ensure!(
        hash["value"]
            .as_str()
            .is_some_and(|v| v.eq_ignore_ascii_case(&actual)),
        "artifact_digest"
    );
    Ok(())
}
async fn provider(label: &str) -> anyhow::Result<()> {
    let f = fixture(label)?;
    let start = std::time::Instant::now();
    let before = LIVE_CLIENT_BUILDS.load(Ordering::SeqCst);
    let meta = f["metadata_url"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("metadata_url"))?;
    let metadata_response = if label == "curseforge" {
        let url = Url::parse(meta)?;
        anyhow::ensure!(
            url.scheme() == "https"
                && url.host_str() == Some("api.curseforge.com")
                && url.port_or_known_default() == Some(443)
                && url.username().is_empty()
                && url.password().is_none(),
            "cf_origin"
        );
        let key = std::env::var("VESTA_CURSEFORGE_API_KEY")
            .or_else(|_| std::env::var("CURSEFORGE_API_KEY"))
            .map_err(|_| anyhow::anyhow!("cf_test_key_missing"))?;
        crate::client::provider_api_client()?
            .get(url)
            .header("x-api-key", key)
            .timeout(Duration::from_secs(20))
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("cf_metadata_request"))?
    } else {
        get_with_timeout(meta, Duration::from_secs(20)).await?
    };
    let (metadata, _) = body(metadata_response).await?;
    let doc: Value = serde_json::from_slice(&metadata)?;
    if label == "modrinth" {
        anyhow::ensure!(
            doc["id"] == f["version"] && doc["project_id"] == f["project"],
            "modrinth_binding"
        );
    }
    if label == "curseforge" {
        anyhow::ensure!(
            doc["data"]["id"].as_u64() == f["version"].as_str().and_then(|s| s.parse().ok())
                && doc["data"]["modId"].as_u64()
                    == f["project"].as_str().and_then(|s| s.parse().ok()),
            "cf_binding"
        );
    }
    if label == "mojang" {
        verify(
            &metadata,
            &json!({"algorithm":"sha1","value":f["metadata_hash"]}),
        )?;
    }
    let url = f["url"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("artifact_url"))?;
    let (artifact, http_version) =
        body(get_with_timeout(url, Duration::from_secs(20)).await?).await?;
    verify(&artifact, &f["hash"])?;
    let clients = LIVE_CLIENT_BUILDS.load(Ordering::SeqCst) - before;
    let result = json!({"label":label,"requests_minimum":2,"artifact_client_builds":clients,"metadata_bytes":metadata.len(),"artifact_bytes":artifact.len(),"digest_verified":true,"http_version":http_version,"wall_ms":start.elapsed().as_secs_f64()*1000.0});
    std::fs::write(
        format!("{ROOT}/launcher-{label}.json"),
        serde_json::to_vec_pretty(&result)?,
    )?;
    eprintln!("PUBLIC_COMPAT_LAUNCHER {result}");
    Ok(())
}
#[tokio::test]
#[ignore = "bounded live final hardened transports"]
async fn live_public_compat_modrinth() -> anyhow::Result<()> {
    provider("modrinth").await
}
#[tokio::test]
#[ignore = "existing test dotenv only; key to fixed CF origin"]
async fn live_public_compat_curseforge() -> anyhow::Result<()> {
    provider("curseforge").await
}
#[tokio::test]
#[ignore = "bounded live final hardened transports"]
async fn live_public_compat_mojang() -> anyhow::Result<()> {
    provider("mojang").await
}
#[tokio::test]
#[ignore = "bounded live final hardened transports"]
async fn live_public_compat_loader() -> anyhow::Result<()> {
    provider("loader").await
}
#[tokio::test]
#[ignore = "8tiny public POM GETs; safe pinned pooled comparator, no SSRF relaxation"]
async fn live_public_compat_pool() -> anyhow::Result<()> {
    let f = fixture("loader")?;
    let raw = f["url"].as_str().ok_or_else(|| anyhow::anyhow!("url"))?;
    let url = Url::parse(raw)?;
    let host = url.host_str().unwrap();
    let addresses = checked(
        tokio::time::timeout(
            Duration::from_secs(10),
            tokio::net::lookup_host((host, 443)),
        )
        .await??
        .collect(),
    )?;
    // Comparator retains public numeric pin, peer/certificate checks and no proxy.
    // It changes only client lifetime; it is NOT the old unrestricted production client.
    let pooled = reqwest::Client::builder()
        .no_proxy()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .resolve_to_addrs(host, &addresses)
        .timeout(Duration::from_secs(20))
        .user_agent(concat!("VestaLauncher/", env!("CARGO_PKG_VERSION")))
        .build()?;
    let before = LIVE_CLIENT_BUILDS.load(Ordering::SeqCst);
    let mut rows = Vec::new();
    for round in 0..4 {
        for mode in if round % 2 == 0 {
            ["pinned_pooled", "hardened_fresh"]
        } else {
            ["hardened_fresh", "pinned_pooled"]
        } {
            let start = std::time::Instant::now();
            let response = if mode == "pinned_pooled" {
                let r = pooled
                    .get(url.clone())
                    .header(reqwest::header::ACCEPT_ENCODING, "identity")
                    .send()
                    .await?;
                check_peer(&addresses, r.remote_addr())?;
                r
            } else {
                get_with_timeout(raw, Duration::from_secs(20)).await?
            };
            let (bytes, http_version) = body(response).await?;
            verify(&bytes, &f["hash"])?;
            rows.push(json!({"mode":mode,"round":round,"bytes":bytes.len(),"http_version":http_version,"wall_ms":start.elapsed().as_secs_f64()*1000.0}));
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    let result = json!({"requests":8,"hardened_client_builds":LIVE_CLIENT_BUILDS.load(Ordering::SeqCst)-before,"pooled_client_builds":1,"actual_tcp_connections":"not instrumented by reqwest API","rows":rows});
    std::fs::write(
        format!("{ROOT}/launcher-pool.json"),
        serde_json::to_vec_pretty(&result)?,
    )?;
    eprintln!("PUBLIC_COMPAT_LAUNCHER_POOL {result}");
    Ok(())
}
#[tokio::test]
#[ignore = "max3small public directory redirect hops through production follow+perhop transport"]
async fn live_public_compat_redirect() -> anyhow::Result<()> {
    let start = "https://maven.fabricmc.net/net/fabricmc/intermediary/1.21.1";
    let count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let calls = count.clone();
    let response = follow(start, Duration::from_secs(20), move |url, remaining| {
        let calls = calls.clone();
        async move {
            anyhow::ensure!(
                calls.fetch_add(1, Ordering::SeqCst) < 3,
                "smoke_request_cap"
            );
            get_one_with_timeout(&url, remaining).await
        }
    })
    .await?;
    let final_url = response.url().to_string();
    let (bytes, _) = body(response).await?;
    let requests = count.load(Ordering::SeqCst);
    let observed = final_url != start && requests > 1;
    let result = json!({"requests":requests,"redirect_observed":observed,"final_url":final_url,"body_bytes":bytes.len(),"method":"production follow and actual hardened per-hop GET, stricter test3hop cap"});
    std::fs::write(
        format!("{ROOT}/launcher-redirect.json"),
        serde_json::to_vec_pretty(&result)?,
    )?;
    eprintln!("PUBLIC_COMPAT_REDIRECT {result}");
    anyhow::ensure!(observed, "public_directory_redirect_not_observed");
    Ok(())
}
#[tokio::test]
#[ignore = "max2 real CF CDN fallback GETs, exact existing file/hash, no API key"]
async fn live_public_compat_curseforge_cdn_alias() -> anyhow::Result<()> {
    let f = fixture("curseforge")?;
    let mut url = Url::parse(f["url"].as_str().ok_or_else(|| anyhow::anyhow!("url"))?)?;
    anyhow::ensure!(
        url.host_str() == Some("mediafilez.forgecdn.net"),
        "expected_cf_cdn"
    );
    // Same provider-bound file ID/name and digest; this is the existing supported
    // fallback host in content/provider.rs, not an arbitrary redirect service.
    url.set_host(Some("edge.forgecdn.net"))?;
    let initial = url.clone();
    let count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let calls = count.clone();
    let response = follow(
        url.as_str(),
        Duration::from_secs(20),
        move |url, remaining| {
            let calls = calls.clone();
            async move {
                anyhow::ensure!(
                    calls.fetch_add(1, Ordering::SeqCst) < 2,
                    "smoke_request_cap"
                );
                get_one_with_timeout(&url, remaining).await
            }
        },
    )
    .await?;
    let final_url = response.url().clone();
    let (bytes, _) = body(response).await?;
    verify(&bytes, &f["hash"])?;
    let result = json!({"requests":count.load(Ordering::SeqCst),"bytes":bytes.len(),"digest_verified":true,"cross_origin_redirect_observed":initial.host_str()!=final_url.host_str(),"initial_origin":initial.origin().ascii_serialization(),"final_origin":final_url.origin().ascii_serialization()});
    std::fs::write(
        format!("{ROOT}/launcher-cf-cdn-alias.json"),
        serde_json::to_vec_pretty(&result)?,
    )?;
    eprintln!("PUBLIC_COMPAT_CF_CDN_ALIAS {result}");
    Ok(())
}
