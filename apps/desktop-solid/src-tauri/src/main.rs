// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Select the isolated profile before the shared backend opens any database.
    // This also covers direct `tauri dev`, which bypasses our JS runner.
    vesta_launcher::utils::db_manager::configure_rewrite_profile(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.dev-profile"),
    )
    .expect("Unable to select the rewrite data profile");
    let profile = vesta_launcher::utils::db_manager::get_app_config_dir()
        .expect("Unable to open the isolated rewrite profile");
    eprintln!("[rewrite] Isolated data profile: {}", profile.display());
    vesta_launcher::run(tauri::generate_context!());
}
