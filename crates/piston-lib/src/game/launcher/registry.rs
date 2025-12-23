/// Process registry for tracking running game instances
use crate::game::launcher::types::GameInstance;
use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use sysinfo::{Pid, System};
use tokio::sync::RwLock;

/// Global process registry for tracking running instances (in-memory only)
pub struct ProcessRegistry {
    /// Map of instance_id -> GameInstance
    instances: Arc<RwLock<HashMap<String, GameInstance>>>,

    /// System info for PID checking
    system: Arc<RwLock<System>>,
}

impl ProcessRegistry {
    /// Create a new process registry
    pub fn new() -> Self {
        Self {
            instances: Arc::new(RwLock::new(HashMap::new())),
            system: Arc::new(RwLock::new(System::new_all())),
        }
    }

    /// Initialize the registry
    pub async fn init(&self) -> Result<()> {
        self.start_monitoring();
        log::info!("Process registry initialized (in-memory only)");
        Ok(())
    }

    /// Register a new running instance
    pub async fn register(&self, instance: GameInstance) -> Result<()> {
        log::info!(
            "Registering instance: {} (PID {})",
            instance.instance_id,
            instance.pid
        );

        let mut instances = self.instances.write().await;
        instances.insert(instance.instance_id.clone(), instance);

        Ok(())
    }

    /// Unregister an instance
    pub async fn unregister(&self, instance_id: &str) -> Result<()> {
        log::info!("Unregistering instance: {}", instance_id);

        let mut instances = self.instances.write().await;
        instances.remove(instance_id);

        Ok(())
    }

    /// Get all running instances
    pub async fn get_all(&self) -> Vec<GameInstance> {
        let instances = self.instances.read().await;
        instances.values().cloned().collect()
    }

    /// Get a specific instance
    pub async fn get(&self, instance_id: &str) -> Option<GameInstance> {
        let instances = self.instances.read().await;
        instances.get(instance_id).cloned()
    }

    /// Check if an instance is running
    pub async fn is_running(&self, instance_id: &str) -> bool {
        let instances = self.instances.read().await;
        instances.contains_key(instance_id)
    }

    /// Start background monitoring task
    fn start_monitoring(&self) {
        let instances = self.instances.clone();
        let system = self.system.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(5));

            loop {
                interval.tick().await;

                // Refresh system info
                let mut sys = system.write().await;
                sys.refresh_all();

                // Check each instance
                let mut instances_lock = instances.write().await;
                let mut to_remove = Vec::new();

                for (id, instance) in instances_lock.iter() {
                    if sys.process(Pid::from_u32(instance.pid)).is_none() {
                        log::info!("Instance {} (PID {}) has exited", id, instance.pid);
                        to_remove.push(id.clone());
                    }
                }

                // Remove dead instances
                for id in to_remove {
                    instances_lock.remove(&id);
                }
            }
        });
    }
}

// Global registry instance
use once_cell::sync::OnceCell;
static REGISTRY: OnceCell<ProcessRegistry> = OnceCell::new();

/// Initialize the global registry
pub fn init_registry() -> Result<()> {
    let registry = ProcessRegistry::new();
    REGISTRY
        .set(registry)
        .map_err(|_| anyhow::anyhow!("Registry already initialized"))?;
    Ok(())
}

/// Get the global registry
fn get_registry() -> Result<&'static ProcessRegistry> {
    REGISTRY
        .get()
        .ok_or_else(|| anyhow::anyhow!("Registry not initialized"))
}

/// Initialize and load the registry
pub async fn load_registry() -> Result<()> {
    init_registry()?;
    let registry = get_registry()?;
    registry.init().await?;
    Ok(())
}

/// Register a running instance
pub async fn register_instance(instance: GameInstance) -> Result<()> {
    get_registry()?.register(instance).await
}

/// Unregister an instance
pub async fn unregister_instance(instance_id: &str) -> Result<()> {
    get_registry()?.unregister(instance_id).await
}

/// Get all running instances
pub async fn get_running_instances() -> Result<Vec<GameInstance>> {
    Ok(get_registry()?.get_all().await)
}

/// Get a specific instance
pub async fn get_instance(instance_id: &str) -> Result<Option<GameInstance>> {
    Ok(get_registry()?.get(instance_id).await)
}

/// Check if an instance is running
pub async fn is_instance_running(instance_id: &str) -> Result<bool> {
    Ok(get_registry()?.is_running(instance_id).await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::metadata::ModloaderType;
    use chrono::Utc;
    use tempfile::TempDir;

    #[tokio::test]
    async fn test_registry_memory() {
        let registry = ProcessRegistry::new();

        let temp_dir = TempDir::new().unwrap();
        let instance = GameInstance {
            instance_id: "test-1".to_string(),
            version_id: "1.20.1".to_string(),
            modloader: Some(ModloaderType::Vanilla),
            pid: std::process::id(),
            started_at: Utc::now(),
            log_file: temp_dir.path().join("test.log"),
            game_dir: temp_dir.path().to_path_buf(),
        };

        registry.register(instance.clone()).await.unwrap();

        // Verify it's registered
        assert!(registry.is_running("test-1").await);

        // Unregister
        registry.unregister("test-1").await.unwrap();
        assert!(!registry.is_running("test-1").await);
    }
}
