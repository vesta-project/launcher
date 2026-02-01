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
    #[serde(default)]
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
    pub icon_path: Option<String>,
    pub last_played: Option<String>,
    pub total_playtime_minutes: i32,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub installation_status: Option<String>,
    pub crashed: Option<bool>,
    pub crash_details: Option<String>,
    pub min_memory: i32,
    pub max_memory: i32,
    pub modpack_id: Option<String>,
    pub modpack_version_id: Option<String>,
    pub modpack_platform: Option<String>,
    pub modpack_icon_url: Option<String>,
    pub icon_data: Option<Vec<u8>>,
    pub last_operation: Option<String>,
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
    pub min_memory: i32,
    pub max_memory: i32,
    pub icon_path: Option<String>,
    pub last_played: Option<String>,
    pub total_playtime_minutes: i32,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub installation_status: Option<String>,
    pub crashed: Option<bool>,
    pub crash_details: Option<String>,
    pub modpack_id: Option<String>,
    pub modpack_version_id: Option<String>,
    pub modpack_platform: Option<String>,
    pub modpack_icon_url: Option<String>,
    pub icon_data: Option<Vec<u8>>,
    pub last_operation: Option<String>,
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
            min_memory: 2048,
            max_memory: 4096,
            icon_path: None,
            last_played: None,
            total_playtime_minutes: 0,
            created_at: None,
            updated_at: None,
            installation_status: Some("pending".to_string()),
            crashed: None,
            crash_details: None,
            modpack_id: None,
            modpack_version_id: None,
            modpack_platform: None,
            modpack_icon_url: None,
            icon_data: None,
            last_operation: None,
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
        min_memory: i32,
        max_memory: i32,
        icon_path: Option<String>,
        last_played: Option<String>,
        total_playtime_minutes: i32,
        created_at: Option<String>,
        updated_at: Option<String>,
        installation_status: Option<String>,
        crashed: Option<bool>,
        crash_details: Option<String>,
        modpack_id: Option<String>,
        modpack_version_id: Option<String>,
        modpack_platform: Option<String>,
        modpack_icon_url: Option<String>,
        icon_data: Option<Vec<u8>>,
        last_operation: Option<String>,
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
            min_memory,
            max_memory,
            icon_path,
            last_played,
            total_playtime_minutes,
            created_at,
            updated_at,
            installation_status,
            crashed,
            crash_details,
            modpack_id,
            modpack_version_id,
            modpack_platform,
            modpack_icon_url,
            icon_data,
            last_operation,
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
            min_memory: 2048,
            max_memory: 4096,
            icon_path: None,
            last_played: None,
            total_playtime_minutes: 0,
            created_at: None,
            updated_at: None,
            installation_status: Some("pending".to_string()),
            crashed: None,
            crash_details: None,
            modpack_id: None,
            modpack_version_id: None,
            modpack_platform: None,
            modpack_icon_url: None,
            icon_data: None,
            last_operation: None,
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
            4096,
            None,
            None,
            0,
            None,
            None,
            Some("pending".to_string()),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        );

        // Can't call slug on NewInstance, need to insert first
        // This test will need update
        assert_eq!(sanitize_instance_name(&inst.name), "my-cool-instance");
    }
}
