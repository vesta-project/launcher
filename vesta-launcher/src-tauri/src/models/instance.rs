use crate::schema::instance;
use crate::utils::sanitize::sanitize_instance_name;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

/// Minecraft instance configuration
///
/// Represents a single Minecraft installation with specific version,
/// modloader, and runtime settings.
#[derive(
    Queryable, Selectable, Insertable, AsChangeset, Serialize, Deserialize, Debug, Clone, PartialEq,
)]
#[diesel(table_name = instance)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: i32,
    pub name: String,
    pub minecraft_version: String,
    pub modloader: Option<String>,
    pub modloader_version: Option<String>,
    pub java_path: Option<String>,
    pub java_args: Option<String>,
    pub game_directory: Option<String>,
    pub width: i32,
    pub height: i32,
    pub memory_mb: i32,
    pub icon_path: Option<String>,
    pub last_played: Option<String>,
    pub total_playtime_minutes: i32,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub installation_status: Option<String>,
    pub crashed: Option<bool>,
    pub crash_details: Option<String>,
}

/// New instance (without id for insertion)
#[derive(Insertable, Serialize, Deserialize, Debug, Clone)]
#[diesel(table_name = instance)]
#[serde(rename_all = "camelCase")]
pub struct NewInstance {
    pub name: String,
    pub minecraft_version: String,
    pub modloader: Option<String>,
    pub modloader_version: Option<String>,
    pub java_path: Option<String>,
    pub java_args: Option<String>,
    pub game_directory: Option<String>,
    pub width: i32,
    pub height: i32,
    pub memory_mb: i32,
    pub icon_path: Option<String>,
    pub last_played: Option<String>,
    pub total_playtime_minutes: i32,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub installation_status: Option<String>,
    pub crashed: Option<bool>,
    pub crash_details: Option<String>,
}

impl Default for Instance {
    fn default() -> Self {
        Instance {
            id: 0, // Will be overwritten by database
            name: "New Instance".to_string(),
            minecraft_version: "1.21.1".to_string(),
            modloader: Some("vanilla".to_string()),
            modloader_version: None,
            java_path: None,
            java_args: None,
            game_directory: None,
            width: 854,
            height: 480,
            memory_mb: 2048,
            icon_path: None,
            last_played: None,
            total_playtime_minutes: 0,
            created_at: None,
            updated_at: None,
            installation_status: Some("pending".to_string()),
            crashed: None,
            crash_details: None,
        }
    }
}

impl Instance {
    /// Return a filesystem-safe slug derived from the instance name. This
    /// slug will be used as the runtime instance id / folder name.
    pub fn slug(&self) -> String {
        sanitize_instance_name(&self.name)
    }
}

impl NewInstance {
    /// Create a new instance with all fields
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        name: String,
        minecraft_version: String,
        modloader: Option<String>,
        modloader_version: Option<String>,
        java_path: Option<String>,
        java_args: Option<String>,
        game_directory: Option<String>,
        width: i32,
        height: i32,
        memory_mb: i32,
        icon_path: Option<String>,
        last_played: Option<String>,
        total_playtime_minutes: i32,
        created_at: Option<String>,
        updated_at: Option<String>,
        installation_status: Option<String>,
        crashed: Option<bool>,
        crash_details: Option<String>,
    ) -> Self {
        NewInstance {
            name,
            minecraft_version,
            modloader,
            modloader_version,
            java_path,
            java_args,
            game_directory,
            width,
            height,
            memory_mb,
            icon_path,
            last_played,
            total_playtime_minutes,
            created_at,
            updated_at,
            installation_status,
            crashed,
            crash_details,
        }
    }
}

impl Default for NewInstance {
    fn default() -> Self {
        NewInstance {
            name: "New Instance".to_string(),
            minecraft_version: "1.21.1".to_string(),
            modloader: Some("vanilla".to_string()),
            modloader_version: None,
            java_path: None,
            java_args: None,
            game_directory: None,
            width: 854,
            height: 480,
            memory_mb: 2048,
            icon_path: None,
            last_played: None,
            total_playtime_minutes: 0,
            created_at: None,
            updated_at: None,
            installation_status: Some("pending".to_string()),
            crashed: None,
            crash_details: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_generated_from_name() {
        let inst = NewInstance::new(
            "My Cool Instance".to_string(),
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
            Some("pending".to_string()),
            None,
            None,
        );

        // Can't call slug on NewInstance, need to insert first
        // This test will need update
        assert_eq!(sanitize_instance_name(&inst.name), "my-cool-instance");
    }
}
