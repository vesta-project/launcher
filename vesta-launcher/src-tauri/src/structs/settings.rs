use tauri::utils::WindowEffect;

struct Settings {
    pub version: String,
    pub language: String,

    pub window_effect: WindowEffect,

    pub default_instance_dir: String,

    pub java_versions: Vec<JavaPath>,
}

struct JavaPath {
    pub name: String,
    pub path: String,
    pub version: String,
}