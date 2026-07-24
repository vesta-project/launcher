use fluent_bundle::concurrent::FluentBundle;
use fluent_bundle::{FluentArgs, FluentResource};
use include_dir::{include_dir, Dir};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;
use tauri::{AppHandle, State};
use unic_langid::LanguageIdentifier;

pub const SYSTEM_LANGUAGE: &str = "system";
static LOCALES_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/../locales");
const MANIFEST_SOURCE: &str = include_str!("../../../locales/manifest.json");

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocaleDefinition {
    pub code: String,
    pub enabled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocaleManifest {
    source_locale: String,
    locales: Vec<LocaleDefinition>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocaleState {
    pub preference: String,
    pub effective_locale: String,
}

pub struct LocalizationManager {
    source_locale: String,
    supported_locales: Vec<LocaleDefinition>,
    bundles: HashMap<String, FluentBundle<FluentResource>>,
    preference: RwLock<String>,
    effective_locale: RwLock<String>,
}

impl LocalizationManager {
    pub fn new(preference: &str) -> Result<Self, String> {
        let manifest: LocaleManifest = serde_json::from_str(MANIFEST_SOURCE)
            .map_err(|error| format!("Failed to parse locale manifest: {error}"))?;
        let supported_locales: Vec<_> = manifest
            .locales
            .into_iter()
            .filter(|locale| locale.enabled)
            .collect();
        let mut bundles = HashMap::new();

        for locale in &supported_locales {
            let language_id: LanguageIdentifier = locale
                .code
                .parse()
                .map_err(|error| format!("Invalid locale code {}: {error}", locale.code))?;
            let mut bundle = FluentBundle::new_concurrent(vec![language_id]);
            let locale_dir = LOCALES_DIR
                .get_dir(&locale.code)
                .ok_or_else(|| format!("Missing locale directory for {}", locale.code))?;
            let mut files: Vec<_> = locale_dir
                .files()
                .filter(|file| {
                    file.path()
                        .extension()
                        .is_some_and(|extension| extension == "ftl")
                })
                .collect();
            files.sort_by_key(|file| file.path());

            for file in files {
                let source = file
                    .contents_utf8()
                    .ok_or_else(|| format!("Locale file {:?} is not UTF-8", file.path()))?;
                let resource = FluentResource::try_new(source.to_string()).map_err(
                    |(_resource, errors)| {
                        format!("Failed to parse locale file {:?}: {errors:?}", file.path())
                    },
                )?;
                bundle.add_resource(resource).map_err(|errors| {
                    format!("Failed to load locale file {:?}: {errors:?}", file.path())
                })?;
            }

            bundles.insert(locale.code.clone(), bundle);
        }

        if !bundles.contains_key(&manifest.source_locale) {
            return Err(format!(
                "Source locale {} is not enabled or has no catalog",
                manifest.source_locale
            ));
        }

        let preference = if preference == SYSTEM_LANGUAGE {
            SYSTEM_LANGUAGE.to_string()
        } else {
            match_supported_locale(preference, &supported_locales)
                .unwrap_or_else(|| manifest.source_locale.clone())
        };
        let effective_locale = resolve_supported_locale(
            &preference,
            &supported_locales,
            &manifest.source_locale,
            sys_locale::get_locales(),
        );

        Ok(Self {
            source_locale: manifest.source_locale,
            supported_locales,
            bundles,
            preference: RwLock::new(preference),
            effective_locale: RwLock::new(effective_locale),
        })
    }

    pub fn validate_preference(&self, preference: &str) -> Result<(), String> {
        if preference == SYSTEM_LANGUAGE
            || self
                .supported_locales
                .iter()
                .any(|locale| locale.code.eq_ignore_ascii_case(preference))
        {
            return Ok(());
        }

        Err(format!("Unsupported language preference: {preference}"))
    }

    pub fn set_preference(&self, preference: &str) -> Result<LocaleState, String> {
        self.validate_preference(preference)?;
        let effective_locale = resolve_supported_locale(
            preference,
            &self.supported_locales,
            &self.source_locale,
            sys_locale::get_locales(),
        );

        *self
            .preference
            .write()
            .map_err(|_| "Language preference lock is poisoned".to_string())? =
            preference.to_string();
        *self
            .effective_locale
            .write()
            .map_err(|_| "Effective locale lock is poisoned".to_string())? =
            effective_locale.clone();

        Ok(LocaleState {
            preference: preference.to_string(),
            effective_locale,
        })
    }

    pub fn state(&self) -> LocaleState {
        LocaleState {
            preference: self
                .preference
                .read()
                .map(|value| value.clone())
                .unwrap_or_else(|_| SYSTEM_LANGUAGE.to_string()),
            effective_locale: self
                .effective_locale
                .read()
                .map(|value| value.clone())
                .unwrap_or_else(|_| self.source_locale.clone()),
        }
    }

    pub fn text(&self, message_id: &str) -> String {
        self.format(message_id, None)
    }

    pub fn format(&self, message_id: &str, args: Option<&FluentArgs<'_>>) -> String {
        let active_locale = self.state().effective_locale;
        self.format_from_locale(&active_locale, message_id, args)
            .or_else(|| self.format_from_locale(&self.source_locale, message_id, args))
            .unwrap_or_else(|| {
                log::warn!("Missing localization message: {message_id}");
                message_id.to_string()
            })
    }

    fn format_from_locale(
        &self,
        locale: &str,
        message_id: &str,
        args: Option<&FluentArgs<'_>>,
    ) -> Option<String> {
        let bundle = self.bundles.get(locale)?;
        let message = bundle.get_message(message_id)?;
        let pattern = message.value()?;
        let mut errors = Vec::new();
        let value = bundle
            .format_pattern(pattern, args, &mut errors)
            .to_string();
        if !errors.is_empty() {
            log::warn!(
                "Failed to format localization message {message_id} for {locale}: {errors:?}"
            );
        }
        Some(value)
    }
}

fn normalize_locale(locale: &str) -> String {
    locale.trim().replace('_', "-").to_lowercase()
}

fn match_supported_locale(
    candidate: &str,
    supported_locales: &[LocaleDefinition],
) -> Option<String> {
    let normalized = normalize_locale(candidate);
    if let Some(locale) = supported_locales
        .iter()
        .find(|locale| normalize_locale(&locale.code) == normalized)
    {
        return Some(locale.code.clone());
    }

    let base = normalized.split('-').next()?;
    supported_locales
        .iter()
        .find(|locale| normalize_locale(&locale.code) == base)
        .map(|locale| locale.code.clone())
}

fn resolve_supported_locale(
    preference: &str,
    supported_locales: &[LocaleDefinition],
    source_locale: &str,
    system_locales: impl IntoIterator<Item = String>,
) -> String {
    if preference != SYSTEM_LANGUAGE {
        return match_supported_locale(preference, supported_locales)
            .unwrap_or_else(|| source_locale.to_string());
    }

    system_locales
        .into_iter()
        .find_map(|locale| match_supported_locale(&locale, supported_locales))
        .unwrap_or_else(|| source_locale.to_string())
}

#[tauri::command]
pub fn set_language(
    app_handle: AppHandle,
    manager: State<'_, LocalizationManager>,
    preference: String,
) -> Result<LocaleState, String> {
    manager.validate_preference(&preference)?;
    crate::utils::config::update_config_field(
        app_handle.clone(),
        "language".to_string(),
        serde_json::Value::String(preference.clone()),
    )?;
    let state = manager.set_preference(&preference)?;
    if let Err(error) = crate::startup::shell::refresh_tray_menu(&app_handle) {
        log::warn!("Language changed, but the tray menu could not be refreshed: {error}");
    }
    Ok(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn locales() -> Vec<LocaleDefinition> {
        vec![
            LocaleDefinition {
                code: "en".to_string(),
                enabled: true,
            },
            LocaleDefinition {
                code: "fr".to_string(),
                enabled: true,
            },
        ]
    }

    #[test]
    fn resolves_exact_and_base_language_matches() {
        assert_eq!(
            resolve_supported_locale("fr-CA", &locales(), "en", Vec::<String>::new()),
            "fr"
        );
        assert_eq!(
            resolve_supported_locale("EN_us", &locales(), "en", Vec::<String>::new()),
            "en"
        );
    }

    #[test]
    fn resolves_system_locale_and_falls_back_to_source() {
        assert_eq!(
            resolve_supported_locale(SYSTEM_LANGUAGE, &locales(), "en", vec!["fr-CA".to_string()]),
            "fr"
        );
        assert_eq!(
            resolve_supported_locale(SYSTEM_LANGUAGE, &locales(), "en", vec!["zz-ZZ".to_string()]),
            "en"
        );
    }

    #[test]
    fn loads_and_formats_the_embedded_source_catalog() {
        let manager = LocalizationManager::new("en").expect("catalog should load");

        assert_eq!(manager.text("shell-tray-show"), "Show");
        assert_eq!(manager.text("missing-message"), "missing-message");
    }

    #[test]
    fn canonicalizes_a_removed_persisted_locale_to_the_source_locale() {
        let manager = LocalizationManager::new("removed-locale").expect("catalog should load");

        assert_eq!(manager.state().preference, "en");
        assert_eq!(manager.state().effective_locale, "en");
    }
}
