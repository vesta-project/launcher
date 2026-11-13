//! Requires a built server binary and a disposable online Minecraft Java account.
//! VESTA_AGENT_BIN overrides V:/hm/server/target/debug/vesta-agent.exe.
//! VESTA_TEST_ACCOUNT_ID, VESTA_TEST_ACCOUNT_NAME, VESTA_TEST_MC_TOKEN are read only here.
use serde_json::{json, Value};
use std::{
    process::{Child, Command, Stdio},
    sync::Arc,
    time::Duration,
};
use vesta_server_client::{
    auth::Ed25519Signer,
    endpoint::Endpoint,
    host::{string, Bootstrap, Connection, HostSession, VestaHost},
};
struct Agent(Child);
impl Drop for Agent {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
#[tokio::test]
#[ignore = "requires built vesta-agent and online disposable Minecraft profile/token"]
async fn real_agent_claim_then_list_servers() {
    let account =
        uuid::Uuid::parse_str(&std::env::var("VESTA_TEST_ACCOUNT_ID").expect("account id"))
            .unwrap()
            .to_string();
    let name = std::env::var("VESTA_TEST_ACCOUNT_NAME").expect("account name");
    let token =
        zeroize::Zeroizing::new(std::env::var("VESTA_TEST_MC_TOKEN").expect("Minecraft token"));
    let binary = std::env::var("VESTA_AGENT_BIN")
        .unwrap_or_else(|_| "V:/hm/server/target/debug/vesta-agent.exe".into());
    let root = tempfile::tempdir().unwrap();
    let certificate = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
    std::fs::write(root.path().join("server.pem"), certificate.cert.pem()).unwrap();
    std::fs::write(
        root.path().join("key.pem"),
        certificate.key_pair.serialize_pem(),
    )
    .unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    drop(listener);
    std::fs::write(root.path().join("host.toml"),format!("state = 'state'\ncertificate = 'server.pem'\nprivate-key = 'key.pem'\nlocal-only = true\nport = {port}\n")).unwrap();
    let _agent = Agent(
        Command::new(&binary)
            .arg("host")
            .arg(root.path().join("host.toml"))
            .current_dir("V:/hm/server")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("built vesta-agent"),
    );
    let address = format!("127.0.0.1:{port}");
    let endpoint = Endpoint::host(&address).unwrap();
    let mut ready = false;
    for _ in 0..50 {
        if Connection::open(&endpoint, None).await.is_ok() {
            ready = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    assert!(ready, "agent listener");
    let output = Command::new(&binary)
        .args(["setup-code", "--state"])
        .arg(root.path().join("state"))
        .output()
        .unwrap();
    assert!(output.status.success(), "local setup code");
    let setup: Value = serde_json::from_slice(&output.stdout).unwrap();
    let signer = Arc::new(Ed25519Signer::from_seed([31; 32]));
    let mut bootstrap = Bootstrap::start(
        &address,
        setup["code"].as_str().unwrap(),
        vesta_host_client::Purpose::Claim,
        signer.as_ref(),
    )
    .await
    .unwrap();
    let profile = account.replace('-', "");
    let proof=bootstrap.account_proof(&account,&name,signer.as_ref(),"claim",|hash|async move{
        let response=reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).build().unwrap().post("https://sessionserver.mojang.com/session/minecraft/join").json(&json!({"accessToken":token.as_str(),"selectedProfile":profile,"serverId":hash})).send().await.unwrap();assert!(response.status().is_success());Ok(())
    }).await.unwrap();
    let reply = bootstrap
        .claim(&proof, "launcher integration", signer.as_ref())
        .await
        .unwrap();
    let host = VestaHost {
        id: string(&reply, "hostId").unwrap(),
        name: "test".into(),
        fingerprint: bootstrap.connection.fingerprint.clone(),
        endpoints: vec![address],
        device_id: string(&reply, "deviceId").unwrap(),
        account_id: account,
        key_reference: "memory-test".into(),
        auth_revision: string(&reply, "authGeneration").unwrap(),
    };
    let session = HostSession::new(host, signer, endpoint);
    session.install(&reply).await.unwrap();
    let servers = session
        .call("GET", "/v1/host/servers", None, None, None)
        .await
        .unwrap();
    assert!(servers["servers"].as_array().unwrap().is_empty());
    drop(bootstrap);
    session
        .token(Some(reply["session"].as_str().unwrap()))
        .await
        .unwrap();
}
