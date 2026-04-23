use crate::models::{NewSavedTheme, SavedTheme};
use crate::schema::saved_themes::dsl::{
    id as saved_theme_id, name as saved_theme_name, saved_themes, theme_data as saved_theme_data,
    updated_at as saved_theme_updated_at,
};
use crate::utils::config::get_app_config;
use crate::utils::db::get_vesta_conn;
use chrono::Utc;
use diesel::prelude::*;
use diesel::upsert::excluded;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

const RESERVED_THEME_IDS: &[&str] = &[
    "vesta",
    "solar",
    "neon",
    "classic",
    "forest",
    "sunset",
    "prism",
    "midnight",
    "oldschool",
    "custom",
];

#[derive(Debug, Serialize, Deserialize)]
pub struct ExportedThemeFile {
    pub version: u32,
    pub r#type: String,
    pub theme: ThemeFileTheme,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ThemeFileTheme {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: Option<String>,
    pub primary_hue: i32,
    pub primary_sat: Option<i32>,
    pub primary_light: Option<i32>,
    pub opacity: i32,
    pub grain_strength: Option<i32>,
    pub style: String,
    pub allow_hue_change: Option<bool>,
    pub allow_style_change: Option<bool>,
    pub allow_border_change: Option<bool>,
    pub gradient_enabled: bool,
    pub rotation: Option<i32>,
    pub gradient_type: Option<String>,
    pub gradient_harmony: Option<String>,
    pub border_width: Option<i32>,
    pub background_opacity: Option<i32>,
    pub window_effect: Option<String>,
    pub custom_css: Option<String>,
    pub variables: Option<Value>,
    pub user_variables: Option<Value>,
    pub user_params: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThemeLibraryTheme {
    pub id: String,
    pub name: String,
    pub author: String,
    pub description: Option<String>,
    pub primary_hue: i32,
    pub primary_sat: Option<i32>,
    pub primary_light: Option<i32>,
    pub opacity: i32,
    pub grain_strength: Option<i32>,
    pub style: String,
    pub allow_hue_change: Option<bool>,
    pub allow_style_change: Option<bool>,
    pub allow_border_change: Option<bool>,
    pub gradient_enabled: bool,
    pub rotation: Option<i32>,
    pub gradient_type: Option<String>,
    pub gradient_harmony: Option<String>,
    pub border_width: Option<i32>,
    pub background_opacity: Option<i32>,
    pub window_effect: Option<String>,
    pub custom_css: Option<String>,
    pub variables: Option<Value>,
    pub user_variables: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ThemeLibraryEntry {
    pub id: String,
    pub name: String,
    pub theme_data: ThemeLibraryTheme,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeImportResult {
    pub theme: ThemeLibraryEntry,
    pub warnings: Vec<String>,
}

fn clamp(value: i32, min: i32, max: i32) -> i32 {
    value.max(min).min(max)
}

fn get_value<'a>(obj: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    for key in keys {
        if let Some(v) = obj.get(*key) {
            return Some(v);
        }
    }
    None
}

fn get_i32(obj: &Value, keys: &[&str]) -> Option<i32> {
    get_value(obj, keys).and_then(|v| {
        v.as_i64()
            .map(|n| n as i32)
            .or_else(|| v.as_str().and_then(|s| s.parse::<i32>().ok()))
    })
}

fn get_bool(obj: &Value, keys: &[&str]) -> Option<bool> {
    get_value(obj, keys).and_then(|v| {
        v.as_bool().or_else(|| {
            v.as_str()
                .and_then(|s| match s.to_ascii_lowercase().as_str() {
                    "true" | "1" => Some(true),
                    "false" | "0" => Some(false),
                    _ => None,
                })
        })
    })
}

fn get_string(obj: &Value, keys: &[&str]) -> Option<String> {
    get_value(obj, keys)
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn get_json(obj: &Value, keys: &[&str]) -> Option<Value> {
    get_value(obj, keys).cloned()
}

fn slugify(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_dash = false;

    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }

    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "custom-theme".to_string()
    } else {
        trimmed.to_string()
    }
}

fn short_hash(input: &str) -> String {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in input.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }

    let encoded = format!("{:08x}", hash);
    encoded[..6].to_string()
}

fn is_reserved_theme_id(value: &str) -> bool {
    RESERVED_THEME_IDS
        .iter()
        .any(|reserved| reserved.eq_ignore_ascii_case(value))
}

fn create_deterministic_theme_id(author: &str, name: &str) -> String {
    let normalized_author = if author.trim().is_empty() {
        "unknown"
    } else {
        author.trim()
    };
    let normalized_name = if name.trim().is_empty() {
        "custom-theme"
    } else {
        name.trim()
    };

    let base = slugify(&format!("{}-{}", normalized_author, normalized_name));
    if !is_reserved_theme_id(&base) {
        return base;
    }

    format!(
        "{}-{}",
        base,
        short_hash(&format!(
            "{}|{}",
            normalized_author.to_ascii_lowercase(),
            normalized_name.to_ascii_lowercase()
        ))
    )
}

fn sanitize_custom_css(css: Option<String>) -> (Option<String>, bool) {
    let Some(raw) = css else {
        return (None, false);
    };

    let trimmed = raw.trim().to_string();
    if trimmed.is_empty() {
        return (None, false);
    }

    let lowered = trimmed.to_ascii_lowercase();
    let blocked_tokens = [
        "@import",
        "javascript:",
        "expression(",
        "<script",
        "</script",
        "-moz-binding",
        "behavior:",
    ];

    if blocked_tokens.iter().any(|token| lowered.contains(token)) {
        return (None, true);
    }

    (Some(trimmed), false)
}

fn normalize_import_id(raw_id: Option<String>, author: &str, name: &str) -> (String, bool) {
    let generated = create_deterministic_theme_id(author, name);
    let provided = raw_id
        .map(|value| slugify(&value))
        .filter(|value| !value.is_empty());

    if let Some(id) = provided {
        if is_reserved_theme_id(&id) {
            return (generated, true);
        }
        return (id, false);
    }

    (generated, false)
}

fn normalize_window_effect_for_platform(effect: Option<String>) -> (Option<String>, bool) {
    let Some(raw_effect) = effect else {
        return (None, false);
    };

    let normalized = raw_effect.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return (None, false);
    }

    let capabilities = crate::utils::window_effects::get_window_effect_capabilities();
    let (effect, coerced) =
        crate::utils::window_effects::normalize_window_effect(normalized.as_str(), &capabilities);
    (Some(effect), coerced)
}

fn normalize_style_mode(raw_style: Option<String>) -> (String, bool) {
    let normalized = raw_style
        .as_deref()
        .unwrap_or("glass")
        .trim()
        .to_ascii_lowercase();

    let mapped = match normalized.as_str() {
        "glass" => "glass",
        "frosted" | "satin" => "frosted",
        "flat" | "solid" | "bordered" => "flat",
        _ => "glass",
    }
    .to_string();

    (mapped.clone(), mapped != normalized)
}

fn normalize_import_payload(source: Value) -> Result<(ThemeLibraryTheme, Vec<String>), String> {
    let source_obj = source
        .as_object()
        .ok_or_else(|| "Theme payload must be a JSON object".to_string())?;

    let source_value = Value::Object(source_obj.clone());

    let name = get_string(&source_value, &["name"]).unwrap_or_else(|| "Imported Theme".to_string());
    let author = get_string(&source_value, &["author"]).unwrap_or_else(|| "Unknown".to_string());
    let mut warnings = Vec::new();
    let (id, id_was_reserved) =
        normalize_import_id(get_string(&source_value, &["id"]), &author, &name);
    if id_was_reserved {
        warnings.push(
            "Imported theme used a reserved built-in id and was renamed to avoid conflicts."
                .to_string(),
        );
    }

    let primary_hue = clamp(
        get_i32(&source_value, &["primary_hue", "primaryHue"]).unwrap_or(180),
        0,
        360,
    );
    let primary_sat =
        get_i32(&source_value, &["primary_sat", "primarySat"]).map(|v| clamp(v, 0, 100));
    let primary_light =
        get_i32(&source_value, &["primary_light", "primaryLight"]).map(|v| clamp(v, 0, 100));
    let opacity = clamp(get_i32(&source_value, &["opacity"]).unwrap_or(0), 0, 100);
    let grain_strength =
        get_i32(&source_value, &["grain_strength", "grainStrength"]).map(|v| clamp(v, 0, 100));

    let (style, style_was_normalized) = normalize_style_mode(get_string(&source_value, &["style"]));
    if style_was_normalized {
        warnings.push(
            "Imported style used a deprecated value and was migrated to the current style set."
                .to_string(),
        );
    }

    // Imported themes are locked by default unless explicitly unlocked in metadata.
    let allow_hue_change =
        Some(get_bool(&source_value, &["allow_hue_change", "allowHueChange"]).unwrap_or(false));
    let allow_style_change =
        Some(get_bool(&source_value, &["allow_style_change", "allowStyleChange"]).unwrap_or(false));
    let allow_border_change = Some(
        get_bool(&source_value, &["allow_border_change", "allowBorderChange"]).unwrap_or(false),
    );

    let gradient_enabled =
        get_bool(&source_value, &["gradient_enabled", "gradientEnabled"]).unwrap_or(true);
    let rotation = get_i32(&source_value, &["rotation"]).map(|v| clamp(v, 0, 360));
    let gradient_type = get_string(&source_value, &["gradient_type", "gradientType"]);
    let gradient_harmony = get_string(&source_value, &["gradient_harmony", "gradientHarmony"]);
    let border_width =
        get_i32(&source_value, &["border_width", "borderWidth"]).map(|v| clamp(v, 0, 8));
    let background_opacity = get_i32(&source_value, &["background_opacity", "backgroundOpacity"])
        .map(|v| clamp(v, 0, 100));
    let (window_effect, window_effect_was_coerced) = normalize_window_effect_for_platform(
        get_string(&source_value, &["window_effect", "windowEffect"]),
    );
    if window_effect_was_coerced {
        warnings.push(
            "Imported window effect is not supported on this platform and was set to 'none'."
                .to_string(),
        );
    }

    let (custom_css, css_was_blocked) =
        sanitize_custom_css(get_string(&source_value, &["custom_css", "customCss"]));

    if css_was_blocked {
        warnings.push("Unsafe CSS was removed from imported theme.".to_string());
    }

    let variables = get_json(&source_value, &["variables", "params"]);
    let user_variables = get_json(
        &source_value,
        &[
            "user_variables",
            "userVariables",
            "user_params",
            "userParams",
        ],
    );

    Ok((
        ThemeLibraryTheme {
            id,
            name,
            author,
            description: get_string(&source_value, &["description"]),
            primary_hue,
            primary_sat,
            primary_light,
            opacity,
            grain_strength,
            style,
            allow_hue_change,
            allow_style_change,
            allow_border_change,
            gradient_enabled,
            rotation,
            gradient_type,
            gradient_harmony,
            border_width,
            background_opacity,
            window_effect,
            custom_css,
            variables,
            user_variables,
        },
        warnings,
    ))
}

fn extract_theme_payload(raw: Value) -> Result<Value, String> {
    if raw.is_object() {
        let payload_type = raw
            .get("type")
            .and_then(|v| v.as_str())
            .map(|s| s.to_ascii_lowercase());

        if payload_type.as_deref() == Some("vesta-theme") {
            return raw
                .get("theme")
                .cloned()
                .ok_or_else(|| "Theme file missing 'theme' payload".to_string());
        }
    }

    Ok(raw)
}

fn parse_theme_data_blob(theme_data_raw: &str) -> Value {
    serde_json::from_str::<Value>(theme_data_raw)
        .unwrap_or_else(|_| Value::Object(Default::default()))
}

fn save_to_library(entry: ThemeLibraryTheme) -> Result<ThemeLibraryEntry, String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    let serialized = serde_json::to_string(&entry)
        .map_err(|e| format!("Failed to serialize theme data: {}", e))?;
    let new_entry = NewSavedTheme {
        id: entry.id.clone(),
        name: entry.name.clone(),
        theme_data: serialized,
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    diesel::insert_into(saved_themes)
        .values(&new_entry)
        .on_conflict(saved_theme_id)
        .do_update()
        .set((
            saved_theme_name.eq(excluded(saved_theme_name)),
            saved_theme_data.eq(excluded(saved_theme_data)),
            saved_theme_updated_at.eq(now.clone()),
        ))
        .execute(&mut conn)
        .map_err(|e| format!("Failed to save theme in library: {}", e))?;

    let row = saved_themes
        .filter(saved_theme_id.eq(&entry.id))
        .first::<SavedTheme>(&mut conn)
        .map_err(|e| format!("Failed to read saved theme: {}", e))?;

    Ok(ThemeLibraryEntry {
        id: row.id,
        name: row.name,
        theme_data: entry,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

#[tauri::command]
pub async fn list_saved_themes() -> Result<Vec<ThemeLibraryEntry>, String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    let rows = saved_themes
        .order(saved_theme_updated_at.desc())
        .load::<SavedTheme>(&mut conn)
        .map_err(|e| format!("Failed to list saved themes: {}", e))?;

    let mut out = Vec::new();
    for row in rows {
        let mut data = match serde_json::from_str::<ThemeLibraryTheme>(&row.theme_data) {
            Ok(data) => data,
            Err(e) => {
                log::warn!("Skipping malformed saved theme '{}': {}", row.id, e);
                continue;
            }
        };

        let (normalized_style, _) = normalize_style_mode(Some(data.style.clone()));
        data.style = normalized_style;
        data.grain_strength = data.grain_strength.map(|v| clamp(v, 0, 100));
        if data.allow_hue_change.is_none() {
            data.allow_hue_change = Some(false);
        }
        if data.allow_style_change.is_none() {
            data.allow_style_change = Some(false);
        }
        if data.allow_border_change.is_none() {
            data.allow_border_change = Some(false);
        }

        out.push(ThemeLibraryEntry {
            id: row.id,
            name: row.name,
            theme_data: data,
            created_at: row.created_at,
            updated_at: row.updated_at,
        });
    }

    Ok(out)
}

#[tauri::command]
pub async fn delete_saved_theme(theme_id: String) -> Result<(), String> {
    let mut conn = get_vesta_conn().map_err(|e| e.to_string())?;
    diesel::delete(saved_themes.filter(saved_theme_id.eq(theme_id)))
        .execute(&mut conn)
        .map_err(|e| format!("Failed to delete saved theme: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn save_theme_to_library(theme: Value) -> Result<ThemeLibraryEntry, String> {
    let (entry, _warnings) = normalize_import_payload(theme)?;
    save_to_library(entry)
}

#[tauri::command]
pub async fn import_theme_from_file(file_path: PathBuf) -> Result<ThemeImportResult, String> {
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read theme file '{}': {}", file_path.display(), e))?;

    let parsed = serde_json::from_str::<Value>(&content)
        .map_err(|e| format!("Theme file is not valid JSON: {}", e))?;
    let payload = extract_theme_payload(parsed)?;
    let (entry, warnings) = normalize_import_payload(payload)?;
    let saved = save_to_library(entry)?;

    Ok(ThemeImportResult {
        theme: saved,
        warnings,
    })
}

#[tauri::command]
pub async fn export_theme(
    save_path: PathBuf,
    custom_name: String,
    author: String,
    custom_css: Option<String>,
) -> Result<(), String> {
    let config = get_app_config().map_err(|e| e.to_string())?;

    let config_theme_style = config.theme_style.clone();
    let config_gradient_type = config.theme_gradient_type.clone();
    let config_gradient_harmony = config.theme_gradient_harmony.clone();
    let config_window_effect = config.theme_window_effect.clone();

    let theme_blob = config
        .theme_data
        .as_deref()
        .map(parse_theme_data_blob)
        .unwrap_or_else(|| Value::Object(Default::default()));

    let (sanitized_css, _css_blocked) = sanitize_custom_css(
        custom_css.or_else(|| get_string(&theme_blob, &["customCss", "custom_css"])),
    );

    let normalized_name = {
        let trimmed = custom_name.trim();
        if trimmed.is_empty() {
            "Custom Theme".to_string()
        } else {
            trimmed.to_string()
        }
    };

    let normalized_author = {
        let trimmed = author.trim();
        if trimmed.is_empty() {
            "Unknown".to_string()
        } else {
            trimmed.to_string()
        }
    };

    let export_theme_id = create_deterministic_theme_id(&normalized_author, &normalized_name);

    let file_theme = ThemeFileTheme {
        id: export_theme_id,
        name: normalized_name,
        author: normalized_author,
        description: get_string(&theme_blob, &["description"]),
        primary_hue: clamp(
            get_i32(&theme_blob, &["primaryHue", "primary_hue"])
                .unwrap_or(config.theme_primary_hue),
            0,
            360,
        ),
        primary_sat: get_i32(&theme_blob, &["primarySat", "primary_sat"])
            .or(config.theme_primary_sat),
        primary_light: get_i32(&theme_blob, &["primaryLight", "primary_light"])
            .or(config.theme_primary_light),
        opacity: clamp(get_i32(&theme_blob, &["opacity"]).unwrap_or(0), 0, 100),
        grain_strength: get_i32(&theme_blob, &["grainStrength", "grain_strength"])
            .map(|v| clamp(v, 0, 100)),
        style: normalize_style_mode(
            get_string(&theme_blob, &["style"]).or(Some(config_theme_style)),
        )
        .0,
        allow_hue_change: get_bool(&theme_blob, &["allowHueChange", "allow_hue_change"]),
        allow_style_change: get_bool(&theme_blob, &["allowStyleChange", "allow_style_change"]),
        allow_border_change: get_bool(&theme_blob, &["allowBorderChange", "allow_border_change"]),
        gradient_enabled: get_bool(&theme_blob, &["gradientEnabled", "gradient_enabled"])
            .unwrap_or(config.theme_gradient_enabled),
        rotation: get_i32(&theme_blob, &["rotation"]).or(config.theme_gradient_angle),
        gradient_type: get_string(&theme_blob, &["gradientType", "gradient_type"])
            .or(config_gradient_type),
        gradient_harmony: get_string(&theme_blob, &["gradientHarmony", "gradient_harmony"])
            .or(config_gradient_harmony),
        border_width: get_i32(&theme_blob, &["borderWidth", "border_width"])
            .or(config.theme_border_width),
        background_opacity: get_i32(&theme_blob, &["backgroundOpacity", "background_opacity"])
            .or(config.theme_background_opacity),
        window_effect: get_string(&theme_blob, &["windowEffect", "window_effect"])
            .or(config_window_effect),
        custom_css: sanitized_css,
        variables: get_json(&theme_blob, &["variables", "params"]),
        user_variables: get_json(&theme_blob, &["userVariables", "user_variables"]),
        user_params: get_json(
            &theme_blob,
            &[
                "userVariables",
                "user_variables",
                "userParams",
                "user_params",
                "params",
            ],
        ),
    };

    let exported = ExportedThemeFile {
        version: 2,
        r#type: "vesta-theme".to_string(),
        theme: file_theme,
    };

    let json = serde_json::to_string_pretty(&exported)
        .map_err(|e| format!("Failed to serialize theme: {}", e))?;

    fs::write(save_path, json).map_err(|e| format!("Failed to write theme file: {}", e))?;

    Ok(())
}
