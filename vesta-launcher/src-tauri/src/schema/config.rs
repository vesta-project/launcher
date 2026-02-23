// @generated automatically by Diesel CLI.

diesel::table! {
    app_config (id) {
        id -> Integer,
        background_hue -> Integer,
        theme -> Text,
        language -> Text,
        max_download_threads -> Integer,
        max_memory_mb -> Integer,
        java_path -> Nullable<Text>,
        default_game_dir -> Nullable<Text>,
        auto_update_enabled -> Bool,
        notification_enabled -> Bool,
        startup_check_updates -> Bool,
        show_tray_icon -> Bool,
        minimize_to_tray -> Bool,
        reduced_motion -> Bool,
        last_window_width -> Integer,
        last_window_height -> Integer,
        debug_logging -> Bool,
        notification_retention_days -> Integer,
        active_account_uuid -> Nullable<Text>,
        theme_id -> Text,
        theme_mode -> Text,
        theme_primary_hue -> Integer,
        theme_primary_sat -> Nullable<Integer>,
        theme_primary_light -> Nullable<Integer>,
        theme_style -> Text,
        theme_gradient_enabled -> Bool,
        theme_gradient_angle -> Nullable<Integer>,
        theme_gradient_harmony -> Nullable<Text>,
        theme_advanced_overrides -> Nullable<Text>,
        theme_gradient_type -> Nullable<Text>,
        theme_border_width -> Nullable<Integer>,
        setup_completed -> Bool,
        setup_step -> Integer,
        tutorial_completed -> Bool,
        use_dedicated_gpu -> Bool,
        discord_presence_enabled -> Bool,
        auto_install_dependencies -> Bool,
    }
}

diesel::table! {
    global_java_paths (major_version) {
        major_version -> Integer,
        path -> Text,
        is_managed -> Bool,
    }
}

diesel::allow_tables_to_appear_in_same_query!(app_config, global_java_paths,);
