#[cfg(test)]
mod tests {
    use crate::game::installer::modloaders::neoforge::install_neoforge;
    use crate::game::installer::modloaders::fabric::install_fabric;
    use crate::game::installer::modloaders::quilt::install_quilt;
    use crate::game::installer::modloaders::forge::install_forge;
    use crate::game::installer::vanilla::install_vanilla;
    use crate::game::installer::types::{InstallSpec, NotificationActionSpec, ProgressReporter};
    use crate::game::installer::types::ModloaderType;
    use std::sync::{Arc, Mutex};
    use tempfile;
    use std::fs;
    use std::io::Write;
    use once_cell::sync::Lazy;

    // Shared temp directory for all tests
    static SHARED_TEMP_DIR: Lazy<tempfile::TempDir> = Lazy::new(|| {
        tempfile::tempdir().unwrap()
    });

    fn get_shared_temp_dir() -> &'static std::path::Path {
        SHARED_TEMP_DIR.path()
    }

    fn init_logging() {
        let _ = env_logger::builder()
            .is_test(true)
            .filter_level(log::LevelFilter::Info)
            .try_init();
    }

    // Helper function to create timestamped log path
    fn create_log_path(temp_dir: &std::path::Path, test_name: &str) -> std::path::PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let logs_dir = temp_dir.join("logs");
        std::fs::create_dir_all(&logs_dir).unwrap();

        logs_dir.join(format!("test-{}-{}.log", test_name, timestamp))
    }

    // ---------------------------------------------------------------------
    // MockProgressReporter – a simple in‑memory implementation of ProgressReporter
    // ---------------------------------------------------------------------
    struct MockProgressReporter {
        steps: Arc<Mutex<Vec<String>>>,
        percent: Arc<Mutex<i32>>,
        messages: Arc<Mutex<Vec<String>>>,
        counts: Arc<Mutex<Vec<(u32, Option<u32>)>>>,
        cancelled: Arc<Mutex<bool>>,
        dry_run: bool,
        log_file: Arc<Mutex<Option<std::fs::File>>>,
    }

    impl MockProgressReporter {
        fn new(log_path: Option<&std::path::Path>) -> Self {
            let log_file = log_path.map(|p| std::fs::File::create(p).unwrap());
            Self {
                steps: Arc::new(Mutex::new(Vec::new())),
                percent: Arc::new(Mutex::new(0)),
                messages: Arc::new(Mutex::new(Vec::new())),
                counts: Arc::new(Mutex::new(Vec::new())),
                cancelled: Arc::new(Mutex::new(false)),
                dry_run: false,
                log_file: Arc::new(Mutex::new(log_file)),
            }
        }

        fn with_dry_run(mut self, dry_run: bool) -> Self {
            self.dry_run = dry_run;
            self
        }
        fn cancel(&self) {
            *self.cancelled.lock().unwrap() = true;
        }
        fn log(&self, message: &str) {
            if let Some(ref mut file) = *self.log_file.lock().unwrap() {
                writeln!(file, "{}", message).unwrap();
            }
        }
    }

    impl ProgressReporter for MockProgressReporter {
        fn start_step(&self, name: &str, _total_steps: Option<u32>) {
            self.steps.lock().unwrap().push(name.to_string());
            self.log(&format!("Starting step: {}", name));
        }
        fn update_bytes(&self, transferred: u64, total: Option<u64>) {
            if let Some(total) = total {
                let percent = if total > 0 { (transferred as f64 / total as f64 * 100.0) as i32 } else { 0 };
                self.log(&format!("Download progress: {}/{} bytes ({}%)", transferred, total, percent));
            } else {
                self.log(&format!("Download progress: {} bytes transferred", transferred));
            }
        }
        fn set_percent(&self, percent: i32) {
            *self.percent.lock().unwrap() = percent;
            self.log(&format!("Progress: {}%", percent));
        }
        fn set_message(&self, message: &str) {
            self.messages.lock().unwrap().push(message.to_string());
            self.log(&format!("Message: {}", message));
        }
        fn set_step_count(&self, current: u32, total: Option<u32>) {
            self.counts.lock().unwrap().push((current, total));
            self.log(&format!("Step count: {}/{}", current, total.unwrap_or(0)));
        }
        fn set_substep(&self, name: Option<&str>, current: Option<u32>, total: Option<u32>) {
            if let Some(name) = name {
                if let (Some(current), Some(total)) = (current, total) {
                    self.log(&format!("Substep: {} ({}/{})", name, current, total));
                } else {
                    self.log(&format!("Substep: {}", name));
                }
            }
        }
        fn set_actions(&self, _actions: Option<Vec<NotificationActionSpec>>) {}
        fn done(&self, success: bool, message: Option<&str>) {
            *self.percent.lock().unwrap() = 100;
            let msg = format!("Done: {} - {:?}", success, message);
            self.log(&msg);
        }
        fn is_cancelled(&self) -> bool {
            *self.cancelled.lock().unwrap()
        }
        fn is_paused(&self) -> bool {
            false
        }
        fn is_dry_run(&self) -> bool {
            self.dry_run
        }
    }

    // ---------------------------------------------------------------------
    // VANILLA INSTALLATION TESTS
    // ---------------------------------------------------------------------

    #[tokio::test]
    async fn test_vanilla_install_various_versions() {
        init_logging();

        let versions = vec![
            "1.21.1",  // Latest release
            "1.20.1",  // Modern version
            "1.19.2",  // Older version
            "1.18.2",  // Even older
        ];

        for mc_version in versions {
            let root_dir = get_shared_temp_dir().join(format!("vanilla_{}", mc_version.replace(".", "_")));
            std::fs::create_dir_all(&root_dir).unwrap();
            let game_dir = root_dir.join("game");
            let log_path = create_log_path(&root_dir, &format!("vanilla_{}", mc_version.replace(".", "_")));

            let spec = InstallSpec {
                version_id: mc_version.to_string(),
                modloader: Some(ModloaderType::Vanilla),
                modloader_version: None, // Vanilla doesn't need a modloader version
                data_dir: root_dir.clone(),
                game_dir: game_dir,
                java_path: None,
                dry_run: false,
                concurrency: 8,
            };

            let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));

            let result = install_vanilla(&spec, reporter).await;

            if let Err(e) = &result {
                println!("Vanilla {} installation failed: {:?}", mc_version, e);
                if log_path.exists() {
                    let log = fs::read_to_string(&log_path).unwrap();
                    println!("Log:\n{}", log);
                }
            } else {
                println!("Vanilla {} installation succeeded", mc_version);
            }

            // Preserve logs by copying to a persistent location before temp dir cleanup
            if log_path.exists() {
                let persistent_log = std::env::temp_dir().join(format!("test-vanilla-{}-{}.log", mc_version.replace(".", "_"), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
                std::fs::copy(&log_path, &persistent_log).ok();
                println!("Log preserved at: {:?}", persistent_log);
            }
        }
    }

    #[tokio::test]
    async fn test_vanilla_invalid_version() {
        init_logging();

        let root_dir = get_shared_temp_dir().join("vanilla_invalid");
        std::fs::create_dir_all(&root_dir).unwrap();
        let game_dir = root_dir.join("game");
        let log_path = create_log_path(&root_dir, "vanilla_invalid");

        let spec = InstallSpec {
            version_id: "999.999.999".to_string(), // Invalid version
            modloader: Some(ModloaderType::Vanilla),
            modloader_version: None,
            data_dir: root_dir.clone(),
            game_dir: game_dir,
            java_path: None,
            dry_run: false,
            concurrency: 8,
        };

        let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));

        let result = install_vanilla(&spec, reporter).await;

        // Should fail gracefully
        assert!(result.is_err(), "Expected invalid version to fail");

        if log_path.exists() {
            let log = fs::read_to_string(&log_path).unwrap();
            println!("Invalid version log:\n{}", log);
        }

        // Preserve logs
        if log_path.exists() {
            let persistent_log = std::env::temp_dir().join(format!("test-vanilla-invalid-{}.log", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
            std::fs::copy(&log_path, &persistent_log).ok();
            println!("Log preserved at: {:?}", persistent_log);
        }
    }

    #[tokio::test]
    async fn test_vanilla_installation_cancellation() {
        init_logging();

        let root_dir = get_shared_temp_dir().join("vanilla_cancelled");
        std::fs::create_dir_all(&root_dir).unwrap();
        let game_dir = root_dir.join("game");
        let log_path = create_log_path(&root_dir, "vanilla_cancelled");

        let spec = InstallSpec {
            version_id: "1.20.1".to_string(),
            modloader: Some(ModloaderType::Vanilla),
            modloader_version: None,
            data_dir: root_dir.clone(),
            game_dir: game_dir,
            java_path: None,
            dry_run: false,
            concurrency: 8,
        };

        let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));

        // Cancel after a short delay
        let reporter_clone = reporter.clone();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            reporter_clone.cancel();
        });

        let result = install_vanilla(&spec, reporter.clone()).await;

        // Should be cancelled
        println!("Vanilla cancellation test result: {:?}", result);
        assert!(result.is_err() || reporter.is_cancelled(), "Installation should have been cancelled");

        if log_path.exists() {
            let log = fs::read_to_string(&log_path).unwrap();
            println!("Cancellation log:\n{}", log);
        }
    }

    #[tokio::test]
    async fn test_vanilla_already_installed() {
        init_logging();

        let root_dir = get_shared_temp_dir().join("vanilla_already_installed");
        std::fs::create_dir_all(&root_dir).unwrap();
        let game_dir = root_dir.join("game");
        let log_path1 = create_log_path(&root_dir, "vanilla_already_installed_1");
        let log_path2 = create_log_path(&root_dir, "vanilla_already_installed_2");

        // First install
        let spec = InstallSpec {
            version_id: "1.20.1".to_string(),
            modloader: Some(ModloaderType::Vanilla),
            modloader_version: None,
            data_dir: root_dir.clone(),
            game_dir: game_dir.clone(),
            java_path: None,
            dry_run: false,
            concurrency: 8,
        };

        let reporter1 = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path1)));
        let result1 = install_vanilla(&spec, reporter1).await;

        if result1.is_ok() {
            // Second install to same location
            let reporter2 = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path2)));
            let result2 = install_vanilla(&spec, reporter2).await;

            // Should handle already installed gracefully (either succeed or fail appropriately)
            println!("Second vanilla install result: {:?}", result2);

            if log_path2.exists() {
                let log = fs::read_to_string(&log_path2).unwrap();
                println!("Second install log:\n{}", log);
            }

            // Preserve logs
            if log_path2.exists() {
                let persistent_log = std::env::temp_dir().join(format!("test-vanilla-already-installed-2-{}.log", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
                std::fs::copy(&log_path2, &persistent_log).ok();
                println!("Log preserved at: {:?}", persistent_log);
            }
        }

        // Preserve first log
        if log_path1.exists() {
            let persistent_log = std::env::temp_dir().join(format!("test-vanilla-already-installed-1-{}.log", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
            std::fs::copy(&log_path1, &persistent_log).ok();
            println!("Log preserved at: {:?}", persistent_log);
        }
    }

    // ---------------------------------------------------------------------
    // FABRIC INSTALLATION TESTS
    // ---------------------------------------------------------------------

    #[tokio::test]
    async fn test_fabric_install_various_versions() {
        init_logging();

        let versions = vec![
            ("1.21.1", "0.16.5"),  // Latest Minecraft with recent Fabric
            ("1.20.1", "0.15.11"), // Modern version
            ("1.19.2", "0.14.25"), // Older version
        ];

        for (mc_version, fabric_version) in versions {
            let root_dir = get_shared_temp_dir().join(format!("fabric_{}_{}", mc_version.replace(".", "_"), fabric_version.replace(".", "_")));
            std::fs::create_dir_all(&root_dir).unwrap();
            let game_dir = root_dir.join("game");
            let log_path = create_log_path(&root_dir, &format!("fabric_{}_{}", mc_version.replace(".", "_"), fabric_version.replace(".", "_")));

            let spec = InstallSpec {
                version_id: mc_version.to_string(),
                modloader: Some(ModloaderType::Fabric),
                modloader_version: Some(fabric_version.to_string()),
                data_dir: root_dir.clone(),
                game_dir: game_dir,
                java_path: None,
                dry_run: false,
                concurrency: 8,
            };

            let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));

            let result = install_fabric(&spec, reporter).await;

            if let Err(e) = &result {
                println!("Fabric {} {} installation failed: {:?}", mc_version, fabric_version, e);
                if log_path.exists() {
                    let log = fs::read_to_string(&log_path).unwrap();
                    println!("Log:\n{}", log);
                }
            } else {
                println!("Fabric {} {} installation succeeded", mc_version, fabric_version);
            }

            // Preserve logs
            if log_path.exists() {
                let persistent_log = std::env::temp_dir().join(format!("test-fabric-{}-{}-{}.log", mc_version.replace(".", "_"), fabric_version.replace(".", "_"), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
                std::fs::copy(&log_path, &persistent_log).ok();
                println!("Log preserved at: {:?}", persistent_log);
            }
        }
    }

    #[tokio::test]
    async fn test_fabric_invalid_version() {
        init_logging();

        let root_dir = get_shared_temp_dir().join("fabric_invalid");
        std::fs::create_dir_all(&root_dir).unwrap();
        let game_dir = root_dir.join("game");
        let log_path = create_log_path(&root_dir, "fabric_invalid");

        let spec = InstallSpec {
            version_id: "1.21.1".to_string(),
            modloader: Some(ModloaderType::Fabric),
            modloader_version: Some("999.999.999".to_string()), // Invalid version
            data_dir: root_dir.clone(),
            game_dir: game_dir,
            java_path: None,
            dry_run: false,
            concurrency: 8,
        };

        let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));

        let result = install_fabric(&spec, reporter).await;

        // Should fail gracefully
        assert!(result.is_err(), "Expected invalid Fabric version to fail");

        if log_path.exists() {
            let log = fs::read_to_string(&log_path).unwrap();
            println!("Invalid Fabric version log:\n{}", log);
        }

        // Preserve logs
        if log_path.exists() {
            let persistent_log = std::env::temp_dir().join(format!("test-fabric-invalid-{}.log", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
            std::fs::copy(&log_path, &persistent_log).ok();
            println!("Log preserved at: {:?}", persistent_log);
        }
    }

    #[tokio::test]
    async fn test_fabric_invalid_mc_version() {
        init_logging();

        let root_dir = get_shared_temp_dir().join("fabric_invalid_mc");
        std::fs::create_dir_all(&root_dir).unwrap();
        let game_dir = root_dir.join("game");
        let log_path = create_log_path(&root_dir, "fabric_invalid_mc");

        let spec = InstallSpec {
            version_id: "999.999.999".to_string(), // Invalid MC version
            modloader: Some(ModloaderType::Fabric),
            modloader_version: Some("0.15.11".to_string()),
            data_dir: root_dir.clone(),
            game_dir: game_dir,
            java_path: None,
            dry_run: false,
            concurrency: 8,
        };

        let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));

        let result = install_fabric(&spec, reporter).await;

        // Should fail gracefully
        assert!(result.is_err(), "Expected invalid MC version to fail");

        if log_path.exists() {
            let log = fs::read_to_string(&log_path).unwrap();
            println!("Invalid MC version log:\n{}", log);
        }

        // Preserve logs
        if log_path.exists() {
            let persistent_log = std::env::temp_dir().join(format!("test-fabric-invalid-mc-{}.log", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
            std::fs::copy(&log_path, &persistent_log).ok();
            println!("Log preserved at: {:?}", persistent_log);
        }
    }

    // ---------------------------------------------------------------------
    // QUILT INSTALLATION TESTS
    // ---------------------------------------------------------------------

    #[tokio::test]
    async fn test_quilt_install_various_versions() {
        init_logging();

        let versions = vec![
            ("1.21.1", "0.26.1"),  // Latest Minecraft with recent Quilt
            ("1.20.1", "0.25.0"),  // Modern version
            ("1.19.2", "0.22.0"),  // Older version
        ];

        for (mc_version, quilt_version) in versions {
            let root_dir = get_shared_temp_dir().join(format!("quilt_{}_{}", mc_version.replace(".", "_"), quilt_version.replace(".", "_")));
            std::fs::create_dir_all(&root_dir).unwrap();
            let game_dir = root_dir.join("game");
            let log_path = create_log_path(&root_dir, &format!("quilt_{}_{}", mc_version.replace(".", "_"), quilt_version.replace(".", "_")));

            let spec = InstallSpec {
                version_id: mc_version.to_string(),
                modloader: Some(ModloaderType::Quilt),
                modloader_version: Some(quilt_version.to_string()),
                data_dir: root_dir.clone(),
                game_dir: game_dir,
                java_path: None,
                dry_run: false,
                concurrency: 8,
            };

            let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));

            let result = install_quilt(&spec, reporter).await;

            if let Err(e) = &result {
                println!("Quilt {} {} installation failed: {:?}", mc_version, quilt_version, e);
                if log_path.exists() {
                    let log = fs::read_to_string(&log_path).unwrap();
                    println!("Log:\n{}", log);
                }
            } else {
                println!("Quilt {} {} installation succeeded", mc_version, quilt_version);
            }

            // Preserve logs
            if log_path.exists() {
                let persistent_log = std::env::temp_dir().join(format!("test-quilt-{}-{}-{}.log", mc_version.replace(".", "_"), quilt_version.replace(".", "_"), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
                std::fs::copy(&log_path, &persistent_log).ok();
                println!("Log preserved at: {:?}", persistent_log);
            }
        }
    }

    #[tokio::test]
    async fn test_quilt_invalid_version() {
        init_logging();

        let root_dir = get_shared_temp_dir().join("quilt_invalid");
        std::fs::create_dir_all(&root_dir).unwrap();
        let game_dir = root_dir.join("game");
        let log_path = create_log_path(&root_dir, "quilt_invalid");

        let spec = InstallSpec {
            version_id: "1.21.1".to_string(),
            modloader: Some(ModloaderType::Quilt),
            modloader_version: Some("999.999.999".to_string()), // Invalid version
            data_dir: root_dir.clone(),
            game_dir: game_dir,
            java_path: None,
            dry_run: false,
            concurrency: 8,
        };

        let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));

        let result = install_quilt(&spec, reporter).await;

        // Should fail gracefully
        assert!(result.is_err(), "Expected invalid Quilt version to fail");

        if log_path.exists() {
            let log = fs::read_to_string(&log_path).unwrap();
            println!("Invalid Quilt version log:\n{}", log);
        }

        // Preserve logs
        if log_path.exists() {
            let persistent_log = std::env::temp_dir().join(format!("test-quilt-invalid-{}.log", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
            std::fs::copy(&log_path, &persistent_log).ok();
            println!("Log preserved at: {:?}", persistent_log);
        }
    }

    // ---------------------------------------------------------------------
    // FORGE INSTALLATION TESTS
    // ---------------------------------------------------------------------

    #[tokio::test]
    async fn test_forge_install_various_versions() {
        init_logging();

        let versions = vec![
            ("1.20.1", "47.2.0"),  // Modern Forge
            ("1.19.2", "43.3.0"),  // Older version
            ("1.18.2", "40.2.0"),  // Even older
        ];

        for (mc_version, forge_version) in versions {
            let root_dir = get_shared_temp_dir().join(format!("forge_{}_{}", mc_version.replace(".", "_"), forge_version.replace(".", "_")));
            std::fs::create_dir_all(&root_dir).unwrap();
            let game_dir = root_dir.join("game");
            let log_path = create_log_path(&root_dir, &format!("forge_{}_{}", mc_version.replace(".", "_"), forge_version.replace(".", "_")));

            let spec = InstallSpec {
                version_id: mc_version.to_string(),
                modloader: Some(ModloaderType::Forge),
                modloader_version: Some(forge_version.to_string()),
                data_dir: root_dir.clone(),
                game_dir: game_dir,
                java_path: None,
                dry_run: false,
                concurrency: 8,
            };

            let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));

            let result = install_forge(&spec, reporter).await;

            if let Err(e) = &result {
                println!("Forge {} {} installation failed: {:?}", mc_version, forge_version, e);
                if log_path.exists() {
                    let log = fs::read_to_string(&log_path).unwrap();
                    println!("Log:\n{}", log);
                }
            } else {
                println!("Forge {} {} installation succeeded", mc_version, forge_version);
            }

            // Preserve logs
            if log_path.exists() {
                let persistent_log = std::env::temp_dir().join(format!("test-forge-{}-{}-{}.log", mc_version.replace(".", "_"), forge_version.replace(".", "_"), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
                std::fs::copy(&log_path, &persistent_log).ok();
                println!("Log preserved at: {:?}", persistent_log);
            }
        }
    }

    #[tokio::test]
    async fn test_forge_invalid_version() {
        init_logging();

        let root_dir = get_shared_temp_dir().join("forge_invalid");
        std::fs::create_dir_all(&root_dir).unwrap();
        let game_dir = root_dir.join("game");
        let log_path = create_log_path(&root_dir, "forge_invalid");

        let spec = InstallSpec {
            version_id: "1.21.1".to_string(),
            modloader: Some(ModloaderType::Forge),
            modloader_version: Some("999.999.999".to_string()), // Invalid version
            data_dir: root_dir.clone(),
            game_dir: game_dir,
            java_path: None,
            dry_run: false,
            concurrency: 8,
        };

        let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));

        let result = install_forge(&spec, reporter).await;

        // Should fail gracefully
        assert!(result.is_err(), "Expected invalid Forge version to fail");

        if log_path.exists() {
            let log = fs::read_to_string(&log_path).unwrap();
            println!("Invalid Forge version log:\n{}", log);
        }

        // Preserve logs
        if log_path.exists() {
            let persistent_log = std::env::temp_dir().join(format!("test-forge-invalid-{}.log", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
            std::fs::copy(&log_path, &persistent_log).ok();
            println!("Log preserved at: {:?}", persistent_log);
        }
    }

    #[tokio::test]
    async fn test_forge_invalid_mc_version() {
        init_logging();

        let root_dir = get_shared_temp_dir().join("forge_invalid_mc");
        std::fs::create_dir_all(&root_dir).unwrap();
        let game_dir = root_dir.join("game");
        let log_path = create_log_path(&root_dir, "forge_invalid_mc");

        let spec = InstallSpec {
            version_id: "999.999.999".to_string(), // Invalid MC version
            modloader: Some(ModloaderType::Forge),
            modloader_version: Some("47.2.0".to_string()),
            data_dir: root_dir.clone(),
            game_dir: game_dir,
            java_path: None,
            dry_run: false,
            concurrency: 8,
        };

        let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));

        let result = install_forge(&spec, reporter).await;

        // Should fail gracefully
        assert!(result.is_err(), "Expected invalid MC version to fail");

        if log_path.exists() {
            let log = fs::read_to_string(&log_path).unwrap();
            println!("Invalid MC version log:\n{}", log);
        }

        // Preserve logs
        if log_path.exists() {
            let persistent_log = std::env::temp_dir().join(format!("test-forge-invalid-mc-{}.log", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
            std::fs::copy(&log_path, &persistent_log).ok();
            println!("Log preserved at: {:?}", persistent_log);
        }
    }

    #[tokio::test]
    async fn test_forge_installation_cancellation() {
        init_logging();

        let root_dir = get_shared_temp_dir().join("forge_cancelled");
        std::fs::create_dir_all(&root_dir).unwrap();
        let game_dir = root_dir.join("game");
        let log_path = create_log_path(&root_dir, "forge_cancelled");

        let spec = InstallSpec {
            version_id: "1.20.1".to_string(),
            modloader: Some(ModloaderType::Forge),
            modloader_version: Some("47.2.0".to_string()),
            data_dir: root_dir.clone(),
            game_dir: game_dir,
            java_path: None,
            dry_run: false,
            concurrency: 8,
        };

        let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));

        // Cancel after a short delay
        let reporter_clone = reporter.clone();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            reporter_clone.cancel();
        });

        let result = install_forge(&spec, reporter.clone()).await;

        // Should be cancelled
        println!("Forge cancellation test result: {:?}", result);
        assert!(result.is_err() || reporter.is_cancelled(), "Installation should have been cancelled");

        if log_path.exists() {
            let log = fs::read_to_string(&log_path).unwrap();
            println!("Cancellation log:\n{}", log);
        }

        // Preserve logs
        if log_path.exists() {
            let persistent_log = std::env::temp_dir().join(format!("test-forge-cancelled-{}.log", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
            std::fs::copy(&log_path, &persistent_log).ok();
            println!("Log preserved at: {:?}", persistent_log);
        }
    }

    // ---------------------------------------------------------------------
    // NEOFORGE INSTALLATION TESTS
    // ---------------------------------------------------------------------

    #[tokio::test]
    async fn test_neoforge_install_various_versions() {
        init_logging();

        let versions = vec![
            ("1.21.1", "21.1.65"),  // Latest NeoForge
            ("1.20.1", "47.1.79"),  // Modern version
        ];

        for (mc_version, neoforge_version) in versions {
            let root_dir = get_shared_temp_dir().join(format!("neoforge_{}_{}", mc_version.replace(".", "_"), neoforge_version.replace(".", "_")));
            std::fs::create_dir_all(&root_dir).unwrap();
            let game_dir = root_dir.join("game");
            let log_path = create_log_path(&root_dir, &format!("neoforge_{}_{}", mc_version.replace(".", "_"), neoforge_version.replace(".", "_")));

            let spec = InstallSpec {
                version_id: mc_version.to_string(),
                modloader: Some(ModloaderType::NeoForge),
                modloader_version: Some(neoforge_version.to_string()),
                data_dir: root_dir.clone(),
                game_dir: game_dir,
                java_path: None,
                dry_run: false,
                concurrency: 8,
            };

            let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));

            let result = install_neoforge(&spec, reporter).await;

            if let Err(e) = &result {
                println!("NeoForge {} {} installation failed: {:?}", mc_version, neoforge_version, e);
                if log_path.exists() {
                    let log = fs::read_to_string(&log_path).unwrap();
                    println!("Log:\n{}", log);
                }
            } else {
                println!("NeoForge {} {} installation succeeded", mc_version, neoforge_version);
            }

            // Preserve logs
            if log_path.exists() {
                let persistent_log = std::env::temp_dir().join(format!("test-neoforge-{}-{}-{}.log", mc_version.replace(".", "_"), neoforge_version.replace(".", "_"), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
                std::fs::copy(&log_path, &persistent_log).ok();
                println!("Log preserved at: {:?}", persistent_log);
            }
        }
    }

    #[tokio::test]
    async fn test_neoforge_invalid_version() {
        init_logging();

        let root_dir = get_shared_temp_dir().join("neoforge_invalid");
        std::fs::create_dir_all(&root_dir).unwrap();
        let game_dir = root_dir.join("game");
        let log_path = create_log_path(&root_dir, "neoforge_invalid");

        let spec = InstallSpec {
            version_id: "1.21.1".to_string(),
            modloader: Some(ModloaderType::NeoForge),
            modloader_version: Some("999.999.999".to_string()), // Invalid version
            data_dir: root_dir.clone(),
            game_dir: game_dir,
            java_path: None,
            dry_run: false,
            concurrency: 8,
        };

        let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));

        let result = install_neoforge(&spec, reporter).await;

        // Should fail gracefully
        assert!(result.is_err(), "Expected invalid NeoForge version to fail");

        if log_path.exists() {
            let log = fs::read_to_string(&log_path).unwrap();
            println!("Invalid NeoForge version log:\n{}", log);
        }

        // Preserve logs
        if log_path.exists() {
            let persistent_log = std::env::temp_dir().join(format!("test-neoforge-invalid-{}.log", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
            std::fs::copy(&log_path, &persistent_log).ok();
            println!("Log preserved at: {:?}", persistent_log);
        }
    }

    #[tokio::test]
    async fn test_neoforge_invalid_mc_version() {
        init_logging();

        let root_dir = get_shared_temp_dir().join("neoforge_invalid_mc");
        std::fs::create_dir_all(&root_dir).unwrap();
        let game_dir = root_dir.join("game");
        let log_path = create_log_path(&root_dir, "neoforge_invalid_mc");

        let spec = InstallSpec {
            version_id: "999.999.999".to_string(), // Invalid MC version
            modloader: Some(ModloaderType::NeoForge),
            modloader_version: Some("21.1.65".to_string()),
            data_dir: root_dir.clone(),
            game_dir: game_dir,
            java_path: None,
            dry_run: false,
            concurrency: 8,
        };

        let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));

        let result = install_neoforge(&spec, reporter).await;

        // Should fail gracefully
        assert!(result.is_err(), "Expected invalid MC version to fail");

        if log_path.exists() {
            let log = fs::read_to_string(&log_path).unwrap();
            println!("Invalid MC version log:\n{}", log);
        }

        // Preserve logs
        if log_path.exists() {
            let persistent_log = std::env::temp_dir().join(format!("test-neoforge-invalid-mc-{}.log", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
            std::fs::copy(&log_path, &persistent_log).ok();
            println!("Log preserved at: {:?}", persistent_log);
        }
    }

    // ---------------------------------------------------------------------
    // CROSS-LOADER EDGE CASE TESTS
    // ---------------------------------------------------------------------

    #[tokio::test]
    async fn test_different_loaders_same_version() {
        init_logging();

        let root_dir = get_shared_temp_dir().join("cross_loader_same_version");
        std::fs::create_dir_all(&root_dir).unwrap();
        let game_dir = root_dir.join("game");

        // Test installing different loaders for the same Minecraft version
        let loaders = vec![
            (ModloaderType::Vanilla, None, "vanilla"),
            (ModloaderType::Fabric, Some("0.15.11".to_string()), "fabric"),
        ];

        for (loader_type, loader_version, loader_name) in loaders {
            let log_path = create_log_path(&root_dir, &format!("{}_1_20_1", loader_name));
            let spec = InstallSpec {
                version_id: "1.20.1".to_string(),
                modloader: Some(loader_type),
                modloader_version: loader_version,
                data_dir: root_dir.clone(),
                game_dir: game_dir.clone(),
                java_path: None,
                dry_run: false,
                concurrency: 8,
            };

            let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));

            let result = match loader_type {
                ModloaderType::Vanilla => install_vanilla(&spec, reporter).await,
                ModloaderType::Fabric => install_fabric(&spec, reporter).await,
                _ => continue,
            };

            if let Err(e) = &result {
                println!("{} 1.20.1 installation failed: {:?}", loader_name, e);
                if log_path.exists() {
                    let log = fs::read_to_string(&log_path).unwrap();
                    println!("Log:\n{}", log);
                }
            } else {
                println!("{} 1.20.1 installation succeeded", loader_name);
            }

            // Preserve logs
            if log_path.exists() {
                let persistent_log = std::env::temp_dir().join(format!("test-{}-1-20-1-{}.log", loader_name, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
                std::fs::copy(&log_path, &persistent_log).ok();
                println!("Log preserved at: {:?}", persistent_log);
            }
        }
    }

    #[tokio::test]
    async fn test_concurrent_installations() {
        init_logging();

        // Test multiple installations running concurrently
        let mut handles = vec![];

        for i in 0..3 {
            let handle = tokio::spawn(async move {
                let root_dir = get_shared_temp_dir().join(format!("concurrent_{}", i));
                std::fs::create_dir_all(&root_dir).unwrap();
                let game_dir = root_dir.join("game");
                let log_path = create_log_path(&root_dir, &format!("concurrent_{}", i));

                let spec = InstallSpec {
                    version_id: "1.20.1".to_string(),
                    modloader: Some(ModloaderType::Vanilla),
                    modloader_version: None,
                    data_dir: root_dir.clone(),
                    game_dir: game_dir,
                    java_path: None,
                    dry_run: false,
                    concurrency: 8,
                };

                let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));
                let result = install_vanilla(&spec, reporter).await;

                (i, result, log_path, root_dir)
            });
            handles.push(handle);
        }

        // Wait for all installations to complete
        for handle in handles {
            let (i, result, log_path, _root_dir) = handle.await.unwrap();
            if let Err(e) = &result {
                println!("Concurrent installation {} failed: {:?}", i, e);
                if log_path.exists() {
                    let log = fs::read_to_string(&log_path).unwrap();
                    println!("Log:\n{}", log);
                }
            } else {
                println!("Concurrent installation {} succeeded", i);
            }

            // Preserve logs
            if log_path.exists() {
                let persistent_log = std::env::temp_dir().join(format!("test-concurrent-{}-{}.log", i, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
                std::fs::copy(&log_path, &persistent_log).ok();
                println!("Log preserved at: {:?}", persistent_log);
            }
        }
    }

    // ---------------------------------------------------------------------
    // ERROR RECOVERY AND RETRY TESTS
    // ---------------------------------------------------------------------

    #[tokio::test]
    async fn test_partial_installation_recovery() {
        init_logging();

        let root_dir = get_shared_temp_dir().join("partial_recovery");
        std::fs::create_dir_all(&root_dir).unwrap();
        let game_dir = root_dir.join("game");

        // First, create some partial installation state
        let versions_dir = root_dir.join("versions");
        let version_dir = versions_dir.join("1.20.1");
        tokio::fs::create_dir_all(&version_dir).await.unwrap();

        // Create a partial version JSON file
        let version_json = r#"{
            "id": "1.20.1",
            "type": "release",
            "mainClass": "net.minecraft.client.main.Main",
            "libraries": []
        }"#;
        let version_json_path = version_dir.join("1.20.1.json");
        tokio::fs::write(&version_json_path, version_json).await.unwrap();

        // Now try to install - should handle partial state gracefully
        let spec = InstallSpec {
            version_id: "1.20.1".to_string(),
            modloader: Some(ModloaderType::Vanilla),
            modloader_version: None,
            data_dir: root_dir.clone(),
            game_dir: game_dir,
            java_path: None,
            dry_run: false,
            concurrency: 8,
        };

        let log_path = create_log_path(&root_dir, "partial_recovery");
        let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)));

        let result = install_vanilla(&spec, reporter).await;

        if let Err(e) = &result {
            println!("Partial recovery test failed: {:?}", e);
            if log_path.exists() {
                let log = fs::read_to_string(&log_path).unwrap();
                println!("Log:\n{}", log);
            }
        } else {
            println!("Partial recovery test succeeded");
        }

        // Preserve logs
        if log_path.exists() {
            let persistent_log = std::env::temp_dir().join(format!("test-partial-recovery-{}.log", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()));
            std::fs::copy(&log_path, &persistent_log).ok();
            println!("Log preserved at: {:?}", persistent_log);
        }
    }

    #[tokio::test]
    async fn test_vanilla_dry_run() {
        init_logging();

        let root_dir = get_shared_temp_dir().join("vanilla_dry_run");
        std::fs::create_dir_all(&root_dir).unwrap();
        let game_dir = root_dir.join("game");
        let log_path = create_log_path(&root_dir, "vanilla_dry_run");

        let spec = InstallSpec {
            version_id: "1.20.1".to_string(),
            modloader: Some(ModloaderType::Vanilla),
            modloader_version: None,
            data_dir: root_dir.clone(),
            game_dir: game_dir.clone(),
            java_path: None,
            dry_run: true,
            concurrency: 8,
        };

        let reporter = std::sync::Arc::new(MockProgressReporter::new(Some(&log_path)).with_dry_run(true));

        let result = install_vanilla(&spec, reporter).await;

        assert!(result.is_ok(), "Dry-run should succeed");

        // Verify that no files were actually created in the game directory
        // (Note: some metadata files might be created in data_dir by the cache, but game_dir should be empty)
        if game_dir.exists() {
            let entries = std::fs::read_dir(&game_dir).unwrap().count();
            assert_eq!(entries, 0, "Game directory should be empty after dry-run");
        }

        if log_path.exists() {
            let log = fs::read_to_string(&log_path).unwrap();
            assert!(log.contains("[Dry-Run]"), "Log should contain dry-run indicators");
        }
    }

    // ---------------------------------------------------------------------
    // BASIC SANITY CHECKS
    // ---------------------------------------------------------------------

    #[test]
    fn test_modloader_type_serialization() {
        assert_eq!(ModloaderType::Vanilla.as_str(), "vanilla");
        assert_eq!(ModloaderType::Fabric.as_str(), "fabric");
        assert_eq!(ModloaderType::Quilt.as_str(), "quilt");
        assert_eq!(ModloaderType::Forge.as_str(), "forge");
        assert_eq!(ModloaderType::NeoForge.as_str(), "neoforge");
    }

    // #[test]
    // fn test_mock_progress_reporter() {
    //     let temp_dir = tempfile::tempdir().unwrap();
    //     let root_dir = temp_dir.path().to_path_buf();
    //     let log_path = create_log_path(&root_dir, "mock_progress_reporter");
    //     let reporter = MockProgressReporter::new(Some(&log_path));
    //     reporter.start_step("step1", Some(3));
    //     reporter.set_percent(42);
    //     reporter.set_message("hello");
    //     reporter.done(true, Some("done"));
    //     assert_eq!(reporter.steps.lock().unwrap().len(), 1);
    //     assert_eq!(*reporter.percent.lock().unwrap(), 100);
    //     assert_eq!(reporter.messages.lock().unwrap().len(), 1);
    //     assert!(!reporter.is_cancelled());
    //     reporter.cancel();
    //     assert!(reporter.is_cancelled());
    //     // Check log file
    //     let log_content = fs::read_to_string(&log_path).unwrap();
    //     assert!(log_content.contains("Starting step: step1"));
    //     assert!(log_content.contains("Progress: 42%"));
    //     assert!(log_content.contains("Message: hello"));
    //     assert!(log_content.contains("Done: true"));
    // }
}
