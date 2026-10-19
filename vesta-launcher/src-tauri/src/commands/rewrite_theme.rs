//! Rewrite-only theme storage. Never reads or modifies legacy theme rows.
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::Path, sync::Mutex};
use tauri::Emitter;

static STORE_LOCK: Mutex<()> = Mutex::new(());
const FILE: &str = "rewrite-theme-v1.json";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Theme {
    id: String,
    mode: String,
    hue: f64,
    material: String,
    translucency: f64,
    grain: f64,
    gradient: bool,
    gradient_type: String,
    gradient_angle: f64,
    gradient_harmony: String,
    border_width: f64,
}
impl Default for Theme {
    fn default() -> Self {
        Self {
            id: "vesta".into(),
            mode: "system".into(),
            hue: 207.0,
            material: "glass".into(),
            translucency: 60.0,
            grain: 20.0,
            gradient: true,
            gradient_type: "radial".into(),
            gradient_angle: 135.0,
            gradient_harmony: "analogous".into(),
            border_width: 1.0,
        }
    }
}
impl Theme {
    fn validate(&self) -> Result<(), String> {
        // Retain readable Paper documents from the earlier rewrite preset catalog.
        if !["vesta", "slate", "mono", "aurora", "haze", "sorbet", "paper"].contains(&self.id.as_str())
            || !["system", "light", "dark"].contains(&self.mode.as_str())
            || !["glass", "frosted", "flat"].contains(&self.material.as_str())
            || !["linear", "radial"].contains(&self.gradient_type.as_str())
            || !["none", "analogous", "complementary", "triadic"]
                .contains(&self.gradient_harmony.as_str())
        {
            return Err("Unsupported rewrite theme value".into());
        }
        for (value, max) in [
            (self.hue, 360.0),
            (self.translucency, 100.0),
            (self.grain, 100.0),
            (self.gradient_angle, 360.0),
            (self.border_width, 6.0),
        ] {
            if !value.is_finite() || value < 0.0 || value > max {
                return Err("Theme value outside supported range".into());
            }
        }
        Ok(())
    }
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ThemeDocument {
    schema_version: u32,
    theme: Theme,
}

fn read(root: &Path) -> Result<Theme, String> {
    let path = root.join(FILE);
    if !path.exists() {
        return Ok(Theme::default());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() > 16384 {
        return Err("Rewrite theme file exceeds size limit".into());
    }
    let document: ThemeDocument = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    if document.schema_version != 1 {
        return Err("Unsupported rewrite theme schema".into());
    }
    document.theme.validate()?;
    Ok(document.theme)
}
fn update(root: &Path, updates: HashMap<String, serde_json::Value>) -> Result<Theme, String> {
    let mut value = serde_json::to_value(read(root)?).map_err(|e| e.to_string())?;
    let fields = value.as_object_mut().ok_or("Invalid theme document")?;
    for (key, value) in updates {
        if !fields.contains_key(&key) {
            return Err(format!("Unknown rewrite theme field: {key}"));
        }
        fields.insert(key, value);
    }
    let theme: Theme = serde_json::from_value(value).map_err(|e| e.to_string())?;
    theme.validate()?;
    let document = ThemeDocument {
        schema_version: 1,
        theme: theme.clone(),
    };
    let mut temp = tempfile::NamedTempFile::new_in(root).map_err(|e| e.to_string())?;
    serde_json::to_writer_pretty(temp.as_file_mut(), &document).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    temp.persist(root.join(FILE)).map_err(|e| e.to_string())?;
    Ok(theme)
}
#[tauri::command]
pub async fn get_rewrite_theme() -> Result<Theme, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
        read(&crate::utils::db_manager::get_app_config_dir().map_err(|e| e.to_string())?)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn update_rewrite_theme(
    app: tauri::AppHandle,
    updates: HashMap<String, serde_json::Value>,
) -> Result<Theme, String> {
    let theme = tauri::async_runtime::spawn_blocking(move || {
        let _guard = STORE_LOCK.lock().map_err(|e| e.to_string())?;
        update(
            &crate::utils::db_manager::get_app_config_dir().map_err(|e| e.to_string())?,
            updates,
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = app.emit("rewrite-theme-updated", &theme);
    Ok(theme)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_rewrite_presets_round_trip() {
        let root = tempfile::tempdir().unwrap();
        for id in ["vesta", "slate", "mono", "aurora"] {
            update(
                root.path(),
                HashMap::from([("id".into(), serde_json::json!(id))]),
            )
            .unwrap();
            assert_eq!(read(root.path()).unwrap().id, id);
        }
    }

    #[test]
    fn fresh_store_ignores_legacy_data_and_invalid_writes_are_atomic() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("app_config.db"), b"untouched legacy data").unwrap();
        assert_eq!(read(root.path()).unwrap().hue, 207.0);
        update(
            root.path(),
            HashMap::from([("hue".into(), serde_json::json!(42.5))]),
        )
        .unwrap();
        assert_eq!(read(root.path()).unwrap().hue, 42.5);
        assert!(update(
            root.path(),
            HashMap::from([("id".into(), serde_json::json!("solar"))])
        )
        .is_err());
        assert!(update(
            root.path(),
            HashMap::from([("windowEffect".into(), serde_json::json!("mica"))])
        )
        .is_err());
        assert_eq!(read(root.path()).unwrap().hue, 42.5);
        assert_eq!(
            std::fs::read(root.path().join("app_config.db")).unwrap(),
            b"untouched legacy data"
        );
    }
}
