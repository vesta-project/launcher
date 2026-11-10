/// v3 stores pack formats in `loaders` and their Minecraft runtime in
/// `mrpack_loaders`. Server listings use the same runtime field as packs.
pub(super) fn loader_filter(project_type: &str, loader: &str) -> Option<String> {
    let field = match project_type {
        "modpack" | "minecraft_java_server" => "mrpack_loaders",
        "mod" | "plugin" => "loaders",
        _ => return None,
    };
    let loader = loader.to_lowercase();
    if loader == "quilt" {
        Some(format!(
            "({field} IN [\"quilt\"] OR {field} IN [\"fabric\"])"
        ))
    } else {
        Some(format!(
            "{field} IN [{}]",
            serde_json::to_string(&loader).expect("string serialization")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::loader_filter;

    #[test]
    fn modpacks_and_server_listings_filter_the_runtime_loader() {
        for project_type in ["modpack", "minecraft_java_server"] {
            assert_eq!(
                loader_filter(project_type, "Fabric").as_deref(),
                Some("mrpack_loaders IN [\"fabric\"]")
            );
            assert_eq!(
                loader_filter(project_type, "neoforge").as_deref(),
                Some("mrpack_loaders IN [\"neoforge\"]")
            );
        }
    }

    #[test]
    fn mods_and_plugins_keep_the_distribution_loader() {
        for project_type in ["mod", "plugin"] {
            assert_eq!(
                loader_filter(project_type, "fabric").as_deref(),
                Some("loaders IN [\"fabric\"]")
            );
        }
        assert_eq!(
            loader_filter("plugin", "paper").as_deref(),
            Some("loaders IN [\"paper\"]")
        );
    }

    #[test]
    fn quilt_compatibility_uses_the_same_field_for_both_alternatives() {
        assert_eq!(
            loader_filter("modpack", "quilt").as_deref(),
            Some("(mrpack_loaders IN [\"quilt\"] OR mrpack_loaders IN [\"fabric\"])")
        );
        assert_eq!(
            loader_filter("mod", "quilt").as_deref(),
            Some("(loaders IN [\"quilt\"] OR loaders IN [\"fabric\"])")
        );
    }

    #[test]
    fn non_loader_projects_ignore_loaders_and_values_cannot_inject_filters() {
        for project_type in ["resourcepack", "shader", "datapack", "world"] {
            assert!(loader_filter(project_type, "fabric").is_none());
        }
        assert_eq!(
            loader_filter("mod", "a\"b").as_deref(),
            Some("loaders IN [\"a\\\"b\"]")
        );
    }
}
