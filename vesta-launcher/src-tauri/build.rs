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

    #[cfg(target_os = "linux")]
    bundle_linux_sandbox_exec();
}

#[cfg(target_os = "linux")]
fn bundle_linux_sandbox_exec() {
    use std::path::PathBuf;
    use std::process::Command;

    let profile = env::var("PROFILE").unwrap_or_else(|_| "debug".into());
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let workspace_root = manifest_dir.join("../..");
    let target_dir = env::var("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| workspace_root.join("target"));

    println!("cargo:rerun-if-changed=../../crates/vesta-sandbox/src/bin/vesta-sandbox-exec.rs");
    println!("cargo:rerun-if-changed=../../crates/vesta-sandbox/src/landlock_exec.rs");

    let build_status = Command::new(env::var("CARGO").unwrap_or_else(|_| "cargo".into()))
        .current_dir(&workspace_root)
        .args([
            "build",
            "-p",
            "vesta-sandbox",
            "--bin",
            "vesta-sandbox-exec",
            "--profile",
            &profile,
        ])
        .status();

    if let Ok(status) = build_status {
        if !status.success() {
            println!("cargo:warning=failed to build vesta-sandbox-exec helper");
        }
    }

    let helper_src = target_dir.join(&profile).join("vesta-sandbox-exec");
    let binaries_dir = manifest_dir.join("binaries");
    let helper_dest = binaries_dir.join("vesta-sandbox-exec");

    if helper_src.is_file() {
        let _ = fs::create_dir_all(&binaries_dir);
        if fs::copy(&helper_src, &helper_dest).is_ok() {
            println!(
                "cargo:rustc-env=VESTA_SANDBOX_EXEC={}",
                helper_src.display()
            );
        }
    }
}
