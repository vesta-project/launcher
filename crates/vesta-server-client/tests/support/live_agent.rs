//! Real CLI process fixture. The agent checkout is read-only; all runtime data is scratch.
use serde_json::Value;
use std::{
    fs,
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

pub struct Agent {
    pub root: PathBuf,
    pub endpoint: String,
    pub instance: PathBuf,
    binary: PathBuf,
    child: Child,
}
impl Agent {
    pub fn start() -> Self {
        let binary = PathBuf::from(std::env::var_os("VESTA_AGENT_BIN").expect("VESTA_AGENT_BIN"));
        let inert = PathBuf::from(
            std::env::var_os("VESTA_AGENT_INERT_BIN")
                .expect("VESTA_AGENT_INERT_BIN (vesta-transport https test executable)"),
        );
        let parent = std::env::var_os("VESTA_LIVE_SCRATCH")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join("vesta-e2e"));
        fs::create_dir_all(&parent).unwrap();
        let root = tempfile::Builder::new()
            .prefix("launcher-")
            .tempdir_in(parent)
            .unwrap()
            .keep();
        let id = format!("srv_{}", uuid::Uuid::new_v4().simple());
        let instance = root.join("instances").join(&id);
        for path in ["game/config", "bin", "private", "profile"] {
            fs::create_dir_all(instance.join(path)).unwrap();
        }
        fs::create_dir_all(root.join("names")).unwrap();
        fs::write(
            root.join("names/owned.json"),
            serde_json::to_vec(&serde_json::json!({"schema":1,"instance":id})).unwrap(),
        )
        .unwrap();
        fs::write(instance.join("local-name"), "owned").unwrap();
        fs::copy(inert, instance.join("bin/owned-inert.exe")).unwrap();
        fs::write(
            instance.join("game/tls-inert-enabled"),
            "vesta-owned-tls-inert-v1",
        )
        .unwrap();
        fs::write(instance.join("game/eula.txt"), "eula=true\n").unwrap();
        fs::write(instance.join("private/launch.toml"), "[minecraft]\nworking-directory = 'game'\n[launch]\nkind = 'native'\nexecutable = '../bin/owned-inert.exe'\nargs = ['--exact','management_inert_child','--nocapture','--test-threads=1']\nstop = 'console-stop'\n").unwrap();
        let certificate = rcgen::generate_simple_self_signed(vec!["localhost".into()]).unwrap();
        fs::write(instance.join("private/cert.pem"), certificate.cert.pem()).unwrap();
        fs::write(
            instance.join("private/key.pem"),
            certificate.key_pair.serialize_pem(),
        )
        .unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let endpoint = format!("https://127.0.0.1:{port}");
        let config = format!("schema-version = 1\n[paths]\nstate = 'private-state'\ngame = 'game'\nscan-roots = ['game/config']\nlaunch-definition = 'private/launch.toml'\n[pack]\nname = 'Live Launcher Test'\nversion = '1.0.0'\nrevision = 1\nminimum-revision = 1\nminecraft-version = '1.21.1'\nunresolved-disposition = 'embed-public'\n[pack-access]\nmode = 'minecraft'\n[listener]\nmode = 'tls'\nbind = '127.0.0.1'\nport = {port}\ncertificate = 'private/cert.pem'\nprivate-key = 'private/key.pem'\npublic-endpoint = '{endpoint}'\nmax-connections = 16\nmax-request-bytes = 65536\nrequest-timeout-seconds = 10\npeer-requests-per-minute = 120\nsession-requests-per-minute = 300\n");
        fs::write(instance.join("host.toml"), config).unwrap();
        let child = Command::new(&binary)
            .args(["serve"])
            .arg(instance.join("host.toml"))
            .current_dir(&instance)
            .stdin(Stdio::null())
            .stdout(fs::File::create(root.join("agent.stdout.log")).unwrap())
            .stderr(fs::File::create(root.join("agent.stderr.log")).unwrap())
            .spawn()
            .unwrap();
        let mut agent = Self {
            root,
            endpoint,
            instance,
            binary,
            child,
        };
        println!("scratch: {}", agent.root.display());
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            if std::net::TcpStream::connect(("127.0.0.1", port)).is_ok() {
                break;
            }
            assert!(
                agent.child.try_wait().unwrap().is_none(),
                "agent exited: {}",
                fs::read_to_string(agent.root.join("agent.stderr.log")).unwrap()
            );
            assert!(Instant::now() < deadline, "agent did not bind TLS");
            std::thread::sleep(Duration::from_millis(100));
        }
        agent
    }
    pub fn cli(&self, args: &[&str]) -> Value {
        let output = Command::new(&self.binary)
            .args(args)
            .arg("--install-root")
            .arg(&self.root)
            .current_dir(&self.instance)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "CLI failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice(&output.stdout).unwrap()
    }
    pub fn pair(&self) -> Value {
        self.cli(&["pair", "owned", "--role", "owner"])
    }
    pub fn revoke(&self, id: &str) {
        self.cli(&["devices", "revoke", id, "owned"]);
    }
}
impl Drop for Agent {
    fn drop(&mut self) {
        // No game remains after successful tests. Release it on an assertion failure too.
        let _ = fs::write(self.instance.join("game/tls-inert-release"), "release");
        std::thread::sleep(Duration::from_millis(100));
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}
