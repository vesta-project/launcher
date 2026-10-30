//! Opt-in full launcher API flow against freshly installed Java servers.
//! Never accept the EULA, start Minecraft, or touch an existing server registry.
use serde_json::Value;
use std::{
    fs,
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Arc,
    time::{Duration, Instant},
};
use vesta_server_client::{
    auth::Ed25519Signer,
    endpoint::Address,
    hosting::SoftwarePlanRequest,
    pack::{PackInstallApply, PackInstallRequest, PackInstallSource},
    transport::Transport,
    Client,
};

struct Scratch {
    root: tempfile::TempDir,
    binary: PathBuf,
    instance: PathBuf,
    child: Option<Child>,
}
impl Scratch {
    fn create() -> Self {
        let binary = PathBuf::from(std::env::var_os("VESTA_AGENT_BIN").expect("VESTA_AGENT_BIN"));
        let java = PathBuf::from(std::env::var_os("VESTA_TEST_JAVA").expect("VESTA_TEST_JAVA"));
        let root = tempfile::Builder::new()
            .prefix("vesta-real-pack-api-")
            .tempdir()
            .unwrap();
        let output = Command::new(&binary)
            .args(["create", "api-scratch", "--install-root"])
            .arg(root.path())
            .args(["--minecraft-version", "1.21.1", "--java"])
            .arg(java)
            .args([
                "--loader",
                "vanilla",
                "--agent-startup",
                "manual",
                "--approve-install",
                "--ack-warnings",
                "--ack-legacy-checksum",
            ])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "scratch create: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let record: Value =
            serde_json::from_slice(&fs::read(root.path().join("names/api-scratch.json")).unwrap())
                .unwrap();
        let instance = root
            .path()
            .join("instances")
            .join(record["instance"].as_str().unwrap());
        let cert = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        fs::write(instance.join("api-cert.pem"), cert.cert.pem()).unwrap();
        fs::write(instance.join("api-key.pem"), cert.key_pair.serialize_pem()).unwrap();
        let socket = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = socket.local_addr().unwrap().port();
        drop(socket);
        let config = fs::read_to_string(instance.join("host.toml")).unwrap();
        let prefix = config.split("[listener]").next().unwrap();
        fs::write(instance.join("host.toml"), format!("{prefix}[listener]\nmode='tls'\nbind='127.0.0.1'\nport={port}\ncertificate='api-cert.pem'\nprivate-key='api-key.pem'\npublic-endpoint='https://127.0.0.1:{port}'\nmax-connections=16\nmax-request-bytes=65536\nrequest-timeout-seconds=10\npeer-requests-per-minute=120\nsession-requests-per-minute=300\n[process]\nsupervision='in-process'\non-agent-start='stay_stopped'\n")).unwrap();
        let mut scratch = Self {
            root,
            binary,
            instance,
            child: None,
        };
        scratch.start();
        scratch
    }
    fn start(&mut self) {
        self.child = Some(
            Command::new(&self.binary)
                .args(["agent", "serve"])
                .arg(self.instance.join("host.toml"))
                .current_dir(&self.instance)
                .env("VESTA_AGENT_STAY_STOPPED", "1")
                .stdin(Stdio::null())
                .stdout(fs::File::create(self.root.path().join("agent.out.log")).unwrap())
                .stderr(fs::File::create(self.root.path().join("agent.err.log")).unwrap())
                .spawn()
                .unwrap(),
        );
        let deadline = Instant::now() + Duration::from_secs(25);
        loop {
            let probe = self.cli(&["manage", "api-scratch", "status", "--json"]);
            if probe.status.success()
                && serde_json::from_slice::<Value>(&probe.stdout)
                    .ok()
                    .is_some_and(|v| v["agent"] == "online")
            {
                break;
            }
            assert!(
                self.child.as_mut().unwrap().try_wait().unwrap().is_none(),
                "scratch agent exited: {}",
                fs::read_to_string(self.root.path().join("agent.err.log")).unwrap()
            );
            assert!(
                Instant::now() < deadline,
                "scratch agent never became ready"
            );
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    fn cli(&self, args: &[&str]) -> std::process::Output {
        Command::new(&self.binary)
            .args(args)
            .arg("--install-root")
            .arg(self.root.path())
            .current_dir(&self.instance)
            .output()
            .unwrap()
    }
    fn stop(&mut self) {
        let Some(child) = self.child.as_mut() else {
            return;
        };
        if child.try_wait().unwrap().is_none() {
            let output = Command::new(&self.binary)
                .args(["manage", "api-scratch", "agent", "stop", "--install-root"])
                .arg(self.root.path())
                .current_dir(&self.instance)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "scratch shutdown: {}",
                String::from_utf8_lossy(&output.stderr)
            );
            let until = Instant::now() + Duration::from_secs(20);
            while self.child.as_mut().unwrap().try_wait().unwrap().is_none() {
                assert!(Instant::now() < until, "scratch agent did not stop");
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        self.child = None;
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        if std::thread::panicking() {
            self.root.disable_cleanup(true);
            eprintln!(
                "Preserved failed scratch fixture: {}",
                self.root.path().display()
            );
        }
        // Only the child created by this fixture; never look up a process by name.
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tokio::test]
#[ignore = "requires real agent, Java and live providers; creates disposable servers; no Minecraft start"]
async fn real_provider_packs_stage_through_launcher_apis_and_survive_reconnect() {
    assert_eq!(std::env::var("VESTA_LIVE_AGENT").as_deref(), Ok("1"));
    for (provider, project, version) in [
        ("modrinth", "cm9Ke4UE", "G2xrUEZf"),
        ("curseforge", "1714524", "9024763"),
    ] {
        let mut scratch = Scratch::create();
        let paired = scratch.cli(&["pair", "api-scratch", "--role", "owner"]);
        assert!(
            paired.status.success(),
            "pair: {}",
            String::from_utf8_lossy(&paired.stderr)
        );
        let issued: Value = serde_json::from_slice(&paired.stdout).unwrap();
        let address = Address::parse(issued["pairing_link"].as_str().unwrap()).unwrap();
        let transport =
            Transport::new(address.endpoint.clone(), address.fingerprint.clone()).unwrap();
        let signer = Arc::new(Ed25519Signer::from_seed([94; 32]));
        let server = issued["server_id"].as_str().unwrap();
        let enrollment = Client::pair(
            &transport,
            server,
            address.code.as_deref().unwrap(),
            signer.as_ref(),
        )
        .await
        .unwrap();
        let client = Client::new(
            transport,
            server.into(),
            enrollment.device_id.clone(),
            signer.clone(),
        );
        let input = PackInstallRequest {
            source: PackInstallSource::Provider {
                provider: provider.into(),
                project_id: project.into(),
                version_id: version.into(),
            },
        };
        let initial = client
            .pack_install_plan(input.clone())
            .await
            .unwrap_or_else(|e| panic!("{provider} initial review: {e:?}"));
        assert!(initial.valid && initial.software_switch_required);
        println!(
            "{provider}: review needs {} {} loader {:?}",
            initial.software, initial.minecraft_version, initial.loader_version
        );
        let software = client
            .software_plan(SoftwarePlanRequest {
                software: initial.software,
                version: initial.minecraft_version,
                loader_version: initial.loader_version,
                build: None,
                experimental: Some(false),
            })
            .await
            .unwrap_or_else(|e| panic!("{provider} software plan: {e:?}"));
        let job = client
            .software_apply(software.plan_id, true, true, "real-pack-software")
            .await
            .unwrap();
        let until = Instant::now() + Duration::from_secs(180);
        loop {
            let jobs = client.software_jobs(true).await.unwrap();
            let observed = jobs.iter().find(|v| v.id == job.id).unwrap();
            if observed.state == "succeeded" {
                break;
            }
            assert!(
                !matches!(observed.state.as_str(), "failed" | "recovery_required"),
                "{provider} software activation: {observed:?}"
            );
            assert!(Instant::now() < until, "software activation timed out");
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        let plan = client
            .pack_install_plan(input)
            .await
            .unwrap_or_else(|e| panic!("{provider} matching review: {e:?}"));
        assert!(plan.valid && !plan.software_switch_required);
        let outcome = client
            .pack_install_apply(
                PackInstallApply {
                    plan_id: plan.plan_id,
                    confirmation_token: plan.confirmation_token,
                    choices: Vec::new(),
                    set_as_modpack: false,
                },
                "real-pack-apply",
            )
            .await
            .unwrap_or_else(|e| panic!("{provider} apply: {e:?}"));
        assert_eq!(outcome.pending_ids.len(), plan.files.len());
        assert!(client.server_modpack_link().await.unwrap().is_some());
        assert_eq!(client.status(true).await.unwrap().state, "stopped");
        assert!(fs::read_to_string(scratch.instance.join("game/eula.txt"))
            .unwrap()
            .contains("eula=false"));
        scratch.stop();
        scratch.start();
        let reconnect = Client::new(
            Transport::new(address.endpoint, address.fingerprint).unwrap(),
            server.into(),
            enrollment.device_id,
            signer,
        );
        assert!(reconnect.server_modpack_link().await.unwrap().is_some());
        assert_eq!(reconnect.status(true).await.unwrap().state, "stopped");
        println!("{provider}: real software activation + {} staged files + agent restart + authenticated reconnect passed; Minecraft stayed stopped, EULA pending", outcome.pending_ids.len());
        scratch.stop();
    }
}
