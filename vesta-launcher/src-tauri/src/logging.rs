pub fn register_log_plugin(
    app: &tauri::App,
    log_level: log::LevelFilter,
) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_log::{Target, TargetKind};

    let (log_plugin, max_level, logger) = tauri_plugin_log::Builder::new()
        .targets([
            Target::new(TargetKind::Stdout),
            Target::new(TargetKind::LogDir { file_name: None }),
            Target::new(TargetKind::Webview),
        ])
        .level(log_level)
        .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
        .max_file_size(10_000_000)
        .split(app.handle())?;

    #[cfg(all(debug_assertions, feature = "devtools"))]
    {
        let mut devtools_builder = tauri_plugin_devtools::Builder::default();
        devtools_builder.attach_logger(logger);
        app.handle().plugin(devtools_builder.init())?;
    }

    #[cfg(not(all(debug_assertions, feature = "devtools")))]
    {
        tauri_plugin_log::attach_logger(max_level, logger)?;
    }

    app.handle().plugin(log_plugin)?;
    Ok(())
}
