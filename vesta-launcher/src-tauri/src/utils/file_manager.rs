use std::path::Path;

/// Reveal an existing file in the native file manager; Linux opens its parent.
pub fn reveal(p: &Path) -> Result<(), String> {
    if !p.exists() {
        return Err("File does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use piston_lib::utils::process::PistonCommandExt;
        use std::process::Command;
        let mut command = Command::new("explorer");
        command.arg("/select,").arg(p).suppress_console();
        command.spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        Command::new("open")
            .arg("-R")
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = p.parent() {
            open::that(parent).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}
