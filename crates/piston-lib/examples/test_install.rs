use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use tokio::sync::watch;

use piston_lib::game::installer::install_instance;
use piston_lib::game::installer::types::{InstallSpec, NotificationActionSpec, ProgressReporter};

struct ConsoleReporter {
    cancel_rx: watch::Receiver<bool>,
}

impl ConsoleReporter {
    fn new() -> (Self, watch::Sender<bool>) {
        let (tx, rx) = watch::channel(false);
        (Self { cancel_rx: rx }, tx)
    }
}

impl ProgressReporter for ConsoleReporter {
    fn start_step(&self, name: &str, total_steps: Option<u32>) {
        println!("[STEP START] {} (total: {:?})", name, total_steps);
    }

    fn update_bytes(&self, transferred: u64, total: Option<u64>) {
        if let Some(t) = total {
            println!("[BYTES] {}/{}", transferred, t);
        } else {
            println!("[BYTES] {}", transferred);
        }
    }

    fn set_percent(&self, percent: i32) {
        println!("[PROGRESS] {}%", percent);
    }

    fn set_message(&self, message: &str) {
        println!("[MSG] {}", message);
    }

    fn set_step_count(&self, current: u32, total: Option<u32>) {
        println!("[STEP COUNT] {}/{:?}", current, total);
    }

    fn set_substep(&self, name: Option<&str>, current: Option<u32>, total: Option<u32>) {
        println!("[SUBSTEP] name={:?} {}/{:?}", name, current.unwrap_or(0), total);
    }

    fn set_actions(&self, actions: Option<Vec<NotificationActionSpec>>) {
        if let Some(a) = actions {
            println!("[ACTIONS] {} actions", a.len());
        }
    }

    fn done(&self, success: bool, message: Option<&str>) {
        println!("[DONE] success={} message={:?}", success, message);
    }

    fn is_cancelled(&self) -> bool {
        *self.cancel_rx.borrow()
    }

    fn is_paused(&self) -> bool {
        false
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    // Run a test installation into a temp directory. This will download
    // artifacts and may take a few minutes depending on network.
    let tmp = tempfile::tempdir()?;
    let data_dir = tmp.path().join("data");
    let game_dir = tmp.path().join("game");

    // Make sure dirs exist for the installer
    std::fs::create_dir_all(&data_dir)?;
    std::fs::create_dir_all(&game_dir)?;

    let spec = InstallSpec {
        version_id: "1.21.10".to_string(),
        modloader: Some(piston_lib::game::metadata::ModloaderType::NeoForge),
        modloader_version: Some("21.10.54-beta".to_string()),
        data_dir: data_dir.clone(),
        game_dir: game_dir.clone(),
        java_path: None,
        dry_run: false,
        concurrency: 8,
    };

    let (reporter_impl, _tx) = ConsoleReporter::new();
    let reporter = Arc::new(reporter_impl);

    println!("Starting test installation into {}", tmp.path().display());

    if let Err(e) = install_instance(spec, reporter).await {
        println!("Install failed: {:?}", e);
        std::process::exit(1);
    }

    println!("Installation runner finished successfully");
    // Keep the temp dir around for inspection a short while
    tokio::time::sleep(Duration::from_secs(2)).await;

    Ok(())
}
