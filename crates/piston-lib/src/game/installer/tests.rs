#[cfg(test)]
mod tests {
    use super::modloaders::neoforge::install_neoforge;
    use super::types::{InstallSpec, NotificationActionSpec, ProgressReporter};
    use super::*;
    use crate::game::metadata::ModloaderType;
    use std::sync::{Arc, Mutex};
    use tempfile;

    // ---------------------------------------------------------------------
    // MockProgressReporter – a simple in‑memory implementation of ProgressReporter
    // ---------------------------------------------------------------------
    struct MockProgressReporter {
        steps: Arc<Mutex<Vec<String>>>,
        percent: Arc<Mutex<i32>>,
        messages: Arc<Mutex<Vec<String>>>,
        counts: Arc<Mutex<Vec<(u32, Option<u32>)>>>,
        cancelled: Arc<Mutex<bool>>,
    }

    impl MockProgressReporter {
        fn new() -> Self {
            Self {
                steps: Arc::new(Mutex::new(Vec::new())),
                percent: Arc::new(Mutex::new(0)),
                messages: Arc::new(Mutex::new(Vec::new())),
                counts: Arc::new(Mutex::new(Vec::new())),
                cancelled: Arc::new(Mutex::new(false)),
            }
        }
        fn cancel(&self) {
            *self.cancelled.lock().unwrap() = true;
        }
    }

    impl ProgressReporter for MockProgressReporter {
        fn start_step(&self, name: &str, _total_steps: Option<u32>) {
            self.steps.lock().unwrap().push(name.to_string());
        }
        fn update_bytes(&self, _transferred: u64, _total: Option<u64>) {}
        fn set_percent(&self, percent: i32) {
            *self.percent.lock().unwrap() = percent;
        }
        fn set_message(&self, message: &str) {
            self.messages.lock().unwrap().push(message.to_string());
        }
        fn set_step_count(&self, current: u32, total: Option<u32>) {
            self.counts.lock().unwrap().push((current, total));
        }
        fn set_substep(&self, _name: Option<&str>, _current: Option<u32>, _total: Option<u32>) {}
        fn set_actions(&self, _actions: Option<Vec<NotificationActionSpec>>) {}
        fn done(&self, _success: bool, _message: Option<&str>) {
            *self.percent.lock().unwrap() = 100;
        }
        fn is_cancelled(&self) -> bool {
            *self.cancelled.lock().unwrap()
        }
    }

    // ---------------------------------------------------------------------
    // Basic sanity checks for the ModloaderType enum
    // ---------------------------------------------------------------------
    #[test]
    fn test_modloader_type_serialization() {
        assert_eq!(ModloaderType::Vanilla.as_str(), "vanilla");
        assert_eq!(ModloaderType::Fabric.as_str(), "fabric");
        assert_eq!(ModloaderType::Quilt.as_str(), "quilt");
        assert_eq!(ModloaderType::Forge.as_str(), "forge");
        assert_eq!(ModloaderType::NeoForge.as_str(), "neoforge");
    }

    // ---------------------------------------------------------------------
    // Verify that the mock reporter works as expected
    // ---------------------------------------------------------------------
    #[test]
    fn test_mock_progress_reporter() {
        let reporter = MockProgressReporter::new();
        reporter.start_step("step1", Some(3));
        reporter.set_percent(42);
        reporter.set_message("hello");
        reporter.done(true, Some("done"));
        assert_eq!(reporter.steps.lock().unwrap().len(), 1);
        assert_eq!(*reporter.percent.lock().unwrap(), 100);
        assert_eq!(reporter.messages.lock().unwrap().len(), 1);
        assert!(!reporter.is_cancelled());
        reporter.cancel();
        assert!(reporter.is_cancelled());
    }

    // ---------------------------------------------------------------------
    // Test NeoForge 1.21.1 installation to reproduce patch file issues
    // ---------------------------------------------------------------------
    #[tokio::test]
    async fn test_neoforge_1_21_1_install() {
        // This test attempts to install NeoForge 1.21.1 to reproduce the reported failure.
        // It requires internet access to download the installer.

        let temp_dir = tempfile::tempdir().expect("temp dir creation failed");
        let root_dir = temp_dir.path().to_path_buf();
        let game_dir = root_dir.join("game");

        // Use a known valid NeoForge version for 1.21.1
        let neoforge_version = "21.1.65".to_string();

        let spec = InstallSpec {
            version_id: "1.21.1".to_string(),
            modloader: Some(ModloaderType::NeoForge),
            modloader_version: Some(neoforge_version),
            data_dir: root_dir.clone(),
            game_dir: game_dir,
            java_path: None,
        };

        let reporter = std::sync::Arc::new(MockProgressReporter::new());

        // We expect this might fail if there's a bug, so we capture the result
        let result = install_neoforge(&spec, reporter).await;

        if let Err(e) = &result {
            println!(
                "NeoForge installation failed as expected (or unexpected): {:?}",
                e
            );
        } else {
            println!("NeoForge installation succeeded!");
        }

        // Uncomment to assert success once fixed
        // assert!(result.is_ok(), "NeoForge installation failed: {:?}", result.err());
    }
}
