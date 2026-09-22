//! Raw serialized values, not display-space values. Version hints are advisory:
//! absent settings are never materialized merely by opening an editor.

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ValueKind {
    Boolean,
    Number { min: f64, max: f64 },
    Text,
}

#[derive(Clone, Copy, Debug)]
pub struct OptionDefinition {
    pub key: &'static str,
    pub category: &'static str,
    pub label_id: &'static str,
    pub kind: ValueKind,
    /// None means retain the game's own version-specific default.
    pub default: Option<&'static str>,
    pub version_hint: Option<&'static str>,
}

pub const CATALOG: &[OptionDefinition] = &[
    OptionDefinition {
        key: "fov",
        category: "video",
        label_id: "game-options-fov",
        kind: ValueKind::Number {
            min: -1.0,
            max: 1.0,
        },
        default: None,
        version_hint: Some("Stored normalized; display degrees = 70 + 40 × value"),
    },
    OptionDefinition {
        key: "fullscreen",
        category: "video",
        label_id: "game-options-fullscreen",
        kind: ValueKind::Boolean,
        default: None,
        version_hint: None,
    },
    OptionDefinition {
        key: "bobView",
        category: "video",
        label_id: "game-options-view-bobbing",
        kind: ValueKind::Boolean,
        default: None,
        version_hint: None,
    },
    OptionDefinition {
        key: "invertYMouse",
        category: "mouse",
        label_id: "game-options-invert-mouse",
        kind: ValueKind::Boolean,
        default: None,
        version_hint: None,
    },
    OptionDefinition {
        key: "mouseSensitivity",
        category: "mouse",
        label_id: "game-options-mouse-sensitivity",
        kind: ValueKind::Number { min: 0.0, max: 1.0 },
        default: None,
        version_hint: None,
    },
    OptionDefinition {
        key: "soundCategory_master",
        category: "sound",
        label_id: "game-options-master-volume",
        kind: ValueKind::Number { min: 0.0, max: 1.0 },
        default: None,
        version_hint: Some("Modern sound-category format"),
    },
    OptionDefinition {
        key: "soundCategory_music",
        category: "sound",
        label_id: "game-options-music-volume",
        kind: ValueKind::Number { min: 0.0, max: 1.0 },
        default: None,
        version_hint: Some("Modern sound-category format"),
    },
    OptionDefinition {
        key: "lang",
        category: "language",
        label_id: "game-options-language",
        kind: ValueKind::Text,
        default: None,
        version_hint: Some("Language identifiers differ between game versions"),
    },
];

pub fn definition(key: &str) -> Option<&'static OptionDefinition> {
    CATALOG.iter().find(|option| option.key == key)
}

pub fn category(key: &str) -> &'static str {
    if key.starts_with("key_") {
        "keybindings"
    } else {
        definition(key).map_or("custom", |option| option.category)
    }
}

/// These values are owned by version migration or resource-pack management.
pub fn is_editable(key: &str) -> bool {
    !matches!(
        key,
        "version" | "resourcePacks" | "incompatibleResourcePacks"
    )
}

/// Validate only explicitly edited values. Existing out-of-range values must
/// remain readable and must not be rewritten during unrelated changes.
pub fn validate(key: &str, value: &str) -> Result<(), &'static str> {
    if !is_editable(key) {
        return Err("This option is managed by the game or resource-pack manager");
    }
    if value.contains(['\r', '\n', '\0']) {
        return Err("Option values must be a single line");
    }
    match definition(key).map(|option| option.kind) {
        Some(ValueKind::Boolean) if !matches!(value, "true" | "false") => {
            Err("Expected true or false")
        }
        Some(ValueKind::Number { min, max }) => {
            let number = value.parse::<f64>().map_err(|_| "Expected a number")?;
            if !number.is_finite() || !(min..=max).contains(&number) {
                Err("Number is outside the supported range")
            } else {
                Ok(())
            }
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_has_unique_keys_and_valid_explicit_defaults() {
        let mut keys = std::collections::HashSet::new();
        for option in CATALOG {
            assert!(keys.insert(option.key));
            if let Some(value) = option.default {
                assert!(validate(option.key, value).is_ok());
            }
        }
    }

    #[test]
    fn validates_edits_without_converting_custom_or_legacy_bindings() {
        assert!(validate("fov", "0.5").is_ok());
        for value in ["NaN", "inf", "2", "degrees"] {
            assert!(validate("fov", value).is_err());
        }
        assert!(validate("fullscreen", "yes").is_err());
        assert!(validate("version", "1").is_err());
        assert!(validate("resourcePacks", "[]").is_err());
        assert_eq!(category("key_key.jump"), "keybindings");
        assert!(validate("key_key.jump", "32").is_ok());
        assert!(validate("key_key.jump", "key.keyboard.space").is_ok());
        assert_eq!(category("mod.option"), "custom");
        assert!(validate("mod.option", "namespace:value").is_ok());
    }
}
