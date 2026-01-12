// @generated automatically by Diesel CLI.

diesel::table! {
    account (id) {
        id -> Integer,
        uuid -> Text,
        username -> Text,
        display_name -> Nullable<Text>,
        access_token -> Nullable<Text>,
        refresh_token -> Nullable<Text>,
        token_expires_at -> Nullable<Text>,
        is_active -> Bool,
        skin_url -> Nullable<Text>,
        cape_url -> Nullable<Text>,
        created_at -> Nullable<Text>,
        updated_at -> Nullable<Text>,
        theme_mode -> Nullable<Text>,
        theme_primary_sat -> Nullable<Integer>,
        theme_primary_light -> Nullable<Integer>,
        theme_id -> Nullable<Text>,
        theme_primary_hue -> Nullable<Integer>,
        theme_style -> Nullable<Text>,
        theme_gradient_enabled -> Nullable<Bool>,
        theme_gradient_angle -> Nullable<Integer>,
        theme_gradient_type -> Nullable<Text>,
        theme_gradient_harmony -> Nullable<Text>,
        theme_advanced_overrides -> Nullable<Text>,
        theme_border_width -> Nullable<Integer>,
    }
}

diesel::table! {
    installed_resource (id) {
        id -> Nullable<Integer>,
        instance_id -> Integer,
        platform -> Text,
        remote_id -> Text,
        remote_version_id -> Text,
        resource_type -> Text,
        local_path -> Text,
        display_name -> Text,
        current_version -> Text,
        is_manual -> Bool,
        is_enabled -> Bool,
        last_updated -> Timestamp,
    }
}

diesel::table! {
    instance (id) {
        id -> Integer,
        name -> Text,
        minecraft_version -> Text,
        modloader -> Nullable<Text>,
        modloader_version -> Nullable<Text>,
        java_path -> Nullable<Text>,
        java_args -> Nullable<Text>,
        game_directory -> Nullable<Text>,
        width -> Integer,
        height -> Integer,
        memory_mb -> Integer,
        icon_path -> Nullable<Text>,
        last_played -> Nullable<Text>,
        total_playtime_minutes -> Integer,
        created_at -> Nullable<Text>,
        updated_at -> Nullable<Text>,
        installation_status -> Nullable<Text>,
        crashed -> Nullable<Bool>,
        crash_details -> Nullable<Text>,
    }
}

diesel::table! {
    notification (id) {
        id -> Integer,
        client_key -> Nullable<Text>,
        title -> Nullable<Text>,
        description -> Nullable<Text>,
        severity -> Text,
        notification_type -> Text,
        dismissible -> Bool,
        progress -> Nullable<Integer>,
        current_step -> Nullable<Integer>,
        total_steps -> Nullable<Integer>,
        read -> Bool,
        actions -> Nullable<Text>,
        metadata -> Nullable<Text>,
        created_at -> Text,
        updated_at -> Text,
        expires_at -> Nullable<Text>,
        show_on_completion -> Nullable<Bool>,
    }
}

diesel::table! {
    task_state (id) {
        id -> Text,
        task_type -> Text,
        status -> Text,
        current_step -> Integer,
        total_steps -> Integer,
        data -> Text,
        created_at -> Text,
        updated_at -> Text,
    }
}

diesel::table! {
    user_version_tracking (id) {
        id -> Integer,
        version_type -> Text,
        last_seen_version -> Text,
        last_seen_at -> Text,
        notified -> Bool,
    }
}

diesel::allow_tables_to_appear_in_same_query!(
    account,
    installed_resource,
    instance,
    notification,
    task_state,
    user_version_tracking,
);
