pub mod arguments;
pub mod classifier;
pub mod classpath;
pub mod natives;
pub mod process;
pub mod registry;
/// Game launcher module for executing Minecraft with various modloaders
pub mod types;
pub mod unified_manifest;
pub mod version_parser;

// Re-export commonly used types
pub use crate::game::installer::types::OsType;
pub use arguments::{build_game_arguments, build_jvm_arguments, substitute_variables};
pub use classpath::{build_classpath, maven_to_path};
pub use natives::{extract_natives, get_natives_dir};
pub use process::{kill_instance, launch_game, LogCallback};
pub use registry::{
    get_instance, get_running_instances, is_instance_running, load_registry, register_instance,
    unregister_instance,
};
pub use types::{GameInstance, InstanceState, LaunchResult, LaunchSpec, ProcessHandle};
pub use version_parser::{
    get_asset_index, get_main_class, parse_version_json, resolve_version_chain, Argument,
    Arguments, Library, VersionManifest,
};
