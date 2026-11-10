//! Real agent + provider downloads. No Minecraft process or user server is touched.
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use vesta_server_client::{
    auth::Ed25519Signer,
    endpoint::Address,
    pack::{PackInstallRequest, PackInstallSource},
    transport::Transport,
    Client,
};
#[path = "support/live_agent.rs"]
#[allow(dead_code)]
mod fixture;

#[tokio::test]
#[ignore = "requires VESTA_LIVE_AGENT=1, agent and inert fixture binaries; real provider traffic"]
async fn provider_reviews_keep_real_agent_status_available() {
    assert_eq!(std::env::var("VESTA_LIVE_AGENT").as_deref(), Ok("1"));
    let agent = fixture::Agent::start();
    let issued = agent.pair();
    let address = Address::parse(issued["pairing_link"].as_str().unwrap()).unwrap();
    let transport = Transport::new(address.endpoint, address.fingerprint).unwrap();
    let signer = Arc::new(Ed25519Signer::from_seed([93; 32]));
    let server = issued["server_id"].as_str().unwrap();
    let enrollment = Client::pair(
        &transport,
        server,
        address.code.as_deref().unwrap(),
        signer.as_ref(),
    )
    .await
    .unwrap();
    let client = Client::new(transport, server.into(), enrollment.device_id, signer);
    client.capabilities(Some("owner")).await.unwrap();
    for (provider, project, version) in [
        ("modrinth", "cm9Ke4UE", "G2xrUEZf"),
        ("curseforge", "1714524", "9024763"),
    ] {
        let request = PackInstallRequest {
            analyze: false,
            source: PackInstallSource::Provider {
                provider: provider.into(),
                project_id: project.into(),
                version_id: version.into(),
            },
        };
        let review = client.pack_install_plan(request);
        tokio::pin!(review);
        let started = Instant::now();
        let mut tick = tokio::time::interval(Duration::from_secs(1));
        let mut reads = 0;
        let mut slowest = Duration::ZERO;
        let plan = loop {
            tokio::select! {
                value = &mut review => break value.unwrap_or_else(|e| panic!("{provider} plan: {e:?}")),
                _ = tick.tick() => {
                    let start = Instant::now();
                    let status = tokio::time::timeout(Duration::from_secs(3), client.status(false)).await
                        .expect("pack review stalled the agent's status route").unwrap();
                    assert_eq!(status.state, "stopped");
                    slowest = slowest.max(start.elapsed());
                    reads += 1;
                }
            }
        };
        assert!(plan.valid);
        assert!(!plan.files.is_empty());
        assert!(reads > 0);
        assert!(client.server_modpack_link().await.unwrap().is_none());
        assert!(
            !agent.instance.join("game/mods").exists(),
            "review applied files"
        );
        println!("{provider}: real HTTPS review {:.3}s, {} server files; {reads} status reads, slowest {:.3}s; no apply or Minecraft start", started.elapsed().as_secs_f64(), plan.files.len(), slowest.as_secs_f64());
    }
}
