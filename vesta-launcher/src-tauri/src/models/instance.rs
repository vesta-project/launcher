use serde::{Deserialize, Serialize};
use crate::utils::sqlite::{AUTOINCREMENT, SqlTable};
use piston_macros::SqlTable;

/// Minecraft instance configuration
/// 
/// Represents a single Minecraft installation with specific version,
/// modloader, and runtime settings.
#[derive(Serialize, Deserialize, Debug, Clone, SqlTable)]
#[migration_version("0.3.0")]
#[migration_description("Minecraft instance management")]
pub struct Instance {
    #[primary_key]
    #[autoincrement]
    pub id: AUTOINCREMENT,
    
    #[not_null]
    pub name: String,
    
    #[not_null]
    pub minecraft_version: String,
    
    /// Modloader type: vanilla, forge, fabric, quilt, or neoforge
    pub modloader: Option<String>,
    
    pub modloader_version: Option<String>,
    
    pub java_path: Option<String>,
    
    pub java_args: Option<String>,
    
    pub game_directory: Option<String>,
    
    pub width: i32,
    
    pub height: i32,
    
    pub memory_mb: i32,
    
    pub icon_path: Option<String>,
    
    pub last_played: Option<String>,  // DATETIME as TEXT in SQLite
    
    pub total_playtime_minutes: i32,
    
    pub created_at: Option<String>,  // DATETIME as TEXT in SQLite
    
    pub updated_at: Option<String>,  // DATETIME as TEXT in SQLite
}

impl Default for Instance {
    fn default() -> Self {
        Self::new(
            "New Instance".to_string(),
            "1.21.1".to_string(),
            Some("vanilla".to_string()),
            None,
            None,
            None,
            None,
            854,
            480,
            2048,
            None,
            None,
            0,
            None,
            None,
        )
    }
}

impl Instance {
    /// Get indices to create for this table
    pub fn get_indices() -> Vec<String> {
        vec![
            "CREATE INDEX IF NOT EXISTS idx_instance_name ON instance(name)".to_string(),
            "CREATE INDEX IF NOT EXISTS idx_instance_version ON instance(minecraft_version)".to_string(),
        ]
    }
    
    /// Get DROP INDEX statements for rollback
    pub fn get_drop_indices() -> Vec<String> {
        vec![
            "DROP INDEX IF EXISTS idx_instance_version".to_string(),
            "DROP INDEX IF EXISTS idx_instance_name".to_string(),
        ]
    }
}
