use std::env;
use std::fs;
use std::path::Path;

fn main() {
    tauri_build::build();

    // Obfuscate CurseForge API Key
    let _ = dotenvy::dotenv();
    let api_key = env::var("CURSEFORGE_API_KEY")
        .unwrap_or_else(|_| "".to_string())
        .trim_matches(|c| c == '\'' || c == '"')
        .to_string();

    let out_dir = env::var_os("OUT_DIR").unwrap();
    let dest_path = Path::new(&out_dir).join("curseforge_key.rs");

    // Simple XOR obfuscation
    const XOR_OBFUSCATION_SEED: u8 = 0x55;
    let seed = XOR_OBFUSCATION_SEED;
    let obfuscated: Vec<u8> = api_key.as_bytes().iter().map(|b| b ^ seed).collect();

    let content = format!(
        "pub const CURSEFORGE_API_KEY_OBFUSCATED: &[u8] = &{:?};\npub const CURSEFORGE_SEED: u8 = {};",
        obfuscated, seed
    );

    fs::write(dest_path, content).unwrap();

    // Trigger rebuild when migrations change (for diesel_migrations)
    println!("cargo:rerun-if-changed=migrations");
    println!("cargo:rerun-if-env-changed=CURSEFORGE_API_KEY");
}
