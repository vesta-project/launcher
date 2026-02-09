use tauri::{command, AppHandle, Manager};
use std::process::Command;
use std::path::PathBuf;
use std::fs;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

async fn process_icon(app_handle: &AppHandle, input: Option<String>) -> Option<PathBuf> {
    let input = input?;
    let cache_dir = app_handle.path().app_cache_dir().ok()?.join("shortcuts");
    fs::create_dir_all(&cache_dir).ok()?;

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    use std::hash::{Hash, Hasher};
    input.hash(&mut hasher);
    let hash = hasher.finish();
    let out_path = cache_dir.join(format!("{}.branded.ico", hash));

    // If exists, just return it
    if out_path.exists() {
        return Some(out_path);
    }

    let bytes = if input.starts_with("http") {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .ok()?;
        client.get(&input).send().await.ok()?.bytes().await.ok()?.to_vec()
    } else if input.starts_with("data:image") {
        let parts: Vec<&str> = input.split(',').collect();
        if parts.len() < 2 { return None; }
        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, parts[1]).ok()?
    } else {
        fs::read(&input).ok()?
    };

    let base_img = image::load_from_memory(&bytes).ok()?;
    let base_img = base_img.resize_exact(256, 256, image::imageops::FilterType::Lanczos3);
    
    // Load logo overlay
    let resource_dir = app_handle.path().resource_dir().ok()?;
    let logo_path = resource_dir.join("icons/icon.png");
    
    let mut final_img = base_img.to_rgba8();
    
    if let Ok(logo_img) = image::open(logo_path) {
        let logo_img = logo_img.resize(80, 80, image::imageops::FilterType::Lanczos3);
        // Place in bottom right with slight padding
        image::imageops::overlay(&mut final_img, &logo_img, 256 - 80 - 12, 256 - 80 - 12);
    }

    // Save as proper ICO using image crate's encoder
    image::DynamicImage::ImageRgba8(final_img).save(&out_path).ok()?;
    Some(out_path)
}

#[command]
pub async fn create_desktop_shortcut(
    app_handle: AppHandle,
    mut name: String,
    target_args: String, // e.g. "--launch-instance slug"
    icon_path: Option<String>,
) -> Result<(), String> {
    // Sanitize name for filesystem
    name = name.chars().filter(|c| !r#"\/:*?"<>|"#.contains(*c)).collect();
    if name.is_empty() { name = "Vesta Shortcut".to_string(); }
    if name.len() > 100 { name.truncate(100); }

    let desktop_dir = app_handle.path().desktop_dir().map_err(|e| e.to_string())?;
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;

    let processed_icon = process_icon(&app_handle, icon_path).await;

    #[cfg(target_os = "windows")]
    {
        let shortcut_path = desktop_dir.join(format!("{}.lnk", name));
        
        // Clean paths and args for PowerShell single-quoted strings
        let shortcut_path_str = shortcut_path.to_string_lossy().replace("'", "''");
        let exe_path_str = exe_path.to_string_lossy().replace("'", "''");
        let working_dir = exe_path.parent().unwrap().to_string_lossy().replace("'", "''");
        let safe_target_args = target_args.replace("'", "''");
        
        let icon_path_str = match processed_icon {
            Some(p) => p.to_string_lossy().to_string(),
            None => exe_path.to_string_lossy().to_string(),
        }.replace("'", "''");

        let ps_script = format!(
            "$WshShell = New-Object -ComObject WScript.Shell; \
             $Shortcut = $WshShell.CreateShortcut('{}'); \
             $Shortcut.TargetPath = '{}'; \
             $Shortcut.Arguments = '{}'; \
             $Shortcut.IconLocation = '{},0'; \
             $Shortcut.WorkingDirectory = '{}'; \
             $Shortcut.WindowStyle = 1; \
             $Shortcut.Save()",
            shortcut_path_str,
            exe_path_str,
            safe_target_args,
            icon_path_str,
            working_dir
        );

        let mut cmd = Command::new("powershell");
        cmd.args(["-NoProfile", "-Command", &ps_script]);

        #[cfg(target_os = "windows")]
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = cmd.output().map_err(|e| e.to_string())?;

        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).to_string());
        }
    }

    #[cfg(target_os = "macos")]
    {
        // Convert "--launch-instance slug" to "vesta://launch-instance/slug"
        let deep_link = if target_args.starts_with("--") {
            let parts: Vec<&str> = target_args.split_whitespace().collect();
            if parts.len() >= 2 {
                let action = parts[0].trim_start_matches("--");
                format!("vesta://{}/{}", action, parts[1])
            } else {
                format!("vesta://{}", parts[0].trim_start_matches("--"))
            }
        } else {
            target_args.clone()
        };

        let path = desktop_dir.join(format!("{}.inetloc", name));
        let content = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
             <!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
             <plist version=\"1.0\">\n\
             <dict>\n\
                 <key>URL</key>\n\
                 <string>{}</string>\n\
             </dict>\n\
             </plist>",
            deep_link
        );
        std::fs::write(path, content).map_err(|e| e.to_string())?;
        
        // Note: This creates an 'Internet Location' which Mac users often use for this purpose.
        // A true 'Alias' to the .app can't hold arguments.
    }

    #[cfg(target_os = "linux")]
    {
        let desktop_file_path = desktop_dir.join(format!("{}.desktop", name.to_lowercase().replace(" ", "-")));
        
        let icon_val = match processed_icon {
            Some(p) => p.to_string_lossy().to_string(),
            None => "vesta-launcher".to_string(),
        };

        let content = format!(
            "[Desktop Entry]\n\
             Version=1.0\n\
             Type=Application\n\
             Name={}\n\
             Exec={} {}\n\
             Icon={}\n\
             Terminal=false\n\
             Categories=Game;Launcher;\n",
            name,
            exe_path.to_string_lossy(),
            target_args,
            icon_val
        );
        std::fs::write(desktop_file_path, content).map_err(|e| e.to_string())?;
        
        // Make it executable
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&desktop_file_path).map_err(|e| e.to_string())?.permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&desktop_file_path, perms).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}
