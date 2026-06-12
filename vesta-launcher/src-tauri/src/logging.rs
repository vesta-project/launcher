pub fn register_log_plugin(
    app: &tauri::App,
    log_level: log::LevelFilter,
) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;
    use tauri_plugin_log::{Target, TargetKind};

    let log_dir = crate::utils::db_manager::get_launcher_log_dir()?;
    let log_dir_is_empty = log_dir.read_dir()?.next().is_none();
    let legacy_log_dir = app.handle().path().app_log_dir().ok();

    let session_stamp = chrono::Local::now().format("%Y-%m-%d_%H%M%S");
    let session_file_name = format!("vesta-log-{session_stamp}");
    let session_log_path = log_dir.join(format!("{session_file_name}.log"));

    // Devtools bridges tracing/log events through its own subscriber. Sending those
    // same records back into the app webview can recursively flood the page while
    // devtools is attached, especially during a full webview reload.
    #[cfg(all(debug_assertions, feature = "devtools"))]
    let targets = vec![
        Target::new(TargetKind::Stdout),
        Target::new(TargetKind::Folder {
            path: log_dir.clone(),
            file_name: Some(session_file_name),
        }),
    ];

    #[cfg(not(all(debug_assertions, feature = "devtools")))]
    let targets = vec![
        Target::new(TargetKind::Stdout),
        Target::new(TargetKind::Folder {
            path: log_dir.clone(),
            file_name: Some(session_file_name),
        }),
        Target::new(TargetKind::Webview),
    ];

    #[cfg_attr(all(debug_assertions, feature = "devtools"), allow(unused_variables))]
    let (log_plugin, max_level, logger) = tauri_plugin_log::Builder::new()
        .targets(targets)
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

    log::info!("Launcher session log: {:?}", session_log_path);

    if log_dir_is_empty {
        if let Some(legacy_log_dir) = legacy_log_dir {
            if legacy_log_dir.exists()
                && legacy_log_dir
                    .read_dir()
                    .map(|entries| {
                        entries
                            .flatten()
                            .any(|e| e.path().extension().is_some_and(|ext| ext == "log"))
                    })
                    .unwrap_or(false)
            {
                log::info!(
                    "Launcher logs are now written to {:?}. Older logs may still be at {:?}",
                    log_dir,
                    legacy_log_dir
                );
            }
        }
    }

    app.handle().plugin(log_plugin)?;
    Ok(())
}
