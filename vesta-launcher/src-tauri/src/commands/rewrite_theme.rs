//! Rewrite-only theme storage. Never reads or modifies legacy theme rows.
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::Path};

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
    pub(crate) fn validate(&self) -> Result<(), String> {
        // Retain readable Paper documents from the earlier rewrite preset catalog.
        if ![
            "vesta", "slate", "mono", "aurora", "haze", "sorbet", "paper",
        ]
        .contains(&self.id.as_str())
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

pub(crate) fn read_v1(root: &Path) -> Result<Theme, String> {
    let path = root.join(FILE);
    if !path.exists() {
        return Ok(Theme::default());
    }
    let bytes = super::author_theme_store::bounded_read(&path, 16384)?;
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
#[tauri::command]
pub async fn get_rewrite_theme() -> Result<Theme, String> {
    Ok(super::author_themes::get_author_theme_state()
        .await?
        .built_in)
}

#[tauri::command]
pub async fn update_rewrite_theme(
    app: tauri::AppHandle,
    updates: HashMap<String, serde_json::Value>,
    expected_revision: u64,
) -> Result<super::author_theme_store::AppearanceSnapshot, String> {
    super::author_themes::update_builtin(app, updates, expected_revision).await
}
