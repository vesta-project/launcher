fn main() {
    tauri_build::build();
    // Trigger rebuild when migrations change (for diesel_migrations)
    println!("cargo:rerun-if-changed=migrations");
}
