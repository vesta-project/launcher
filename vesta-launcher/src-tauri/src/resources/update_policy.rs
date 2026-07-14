use crate::models::installed_resource::InstalledResource;
use crate::models::resource::{ReleaseType, ResourceType, ResourceVersion};

pub fn find_best_update(
    versions: &[ResourceVersion],
    resource: &InstalledResource,
    game_version: &str,
    loader: &str,
) -> Option<ResourceVersion> {
    let current_release = release_type_from_str(&resource.release_type);
    let resource_type = resource_type_from_str(&resource.resource_type);

    versions
        .iter()
        .filter(|version| {
            is_game_version_compatible(&version.game_versions, game_version)
                && version_matches_loader(version, loader, resource_type)
                && is_release_allowed(version.release_type, current_release)
        })
        .min_by_key(|version| {
            let explicit = version.game_versions.iter().any(|v| v == game_version);
            (!explicit, release_rank(version.release_type))
        })
        .cloned()
}

fn resource_type_from_str(resource_type: &str) -> Option<ResourceType> {
    match resource_type {
        "mod" => Some(ResourceType::Mod),
        "resourcepack" => Some(ResourceType::ResourcePack),
        "shader" => Some(ResourceType::Shader),
        "datapack" => Some(ResourceType::DataPack),
        "modpack" => Some(ResourceType::Modpack),
        "world" => Some(ResourceType::World),
        _ => None,
    }
}

fn release_type_from_str(release_type: &str) -> ReleaseType {
    match release_type {
        "alpha" => ReleaseType::Alpha,
        "beta" => ReleaseType::Beta,
        _ => ReleaseType::Release,
    }
}

fn is_release_allowed(candidate: ReleaseType, current: ReleaseType) -> bool {
    match current {
        ReleaseType::Release => candidate == ReleaseType::Release,
        ReleaseType::Beta => candidate != ReleaseType::Alpha,
        ReleaseType::Alpha => true,
    }
}

fn release_rank(release_type: ReleaseType) -> u8 {
    match release_type {
        ReleaseType::Release => 0,
        ReleaseType::Beta => 1,
        ReleaseType::Alpha => 2,
    }
}

fn is_game_version_compatible(supported: &[String], target: &str) -> bool {
    let normalized_target = normalize_mc_version(target);
    let target_major_minor = normalized_target
        .split('.')
        .take(2)
        .collect::<Vec<_>>()
        .join(".");

    supported.iter().any(|version| {
        let normalized = normalize_mc_version(version);
        normalized == normalized_target || normalized == format!("{target_major_minor}.x")
    })
}

fn normalize_mc_version(version: &str) -> String {
    version.strip_suffix(".0").unwrap_or(version).to_string()
}

fn version_matches_loader(
    version: &ResourceVersion,
    instance_loader: &str,
    resource_type: Option<ResourceType>,
) -> bool {
    let instance_loader = instance_loader.to_lowercase();
    let loaders = version
        .loaders
        .iter()
        .map(|loader| loader.to_lowercase())
        .collect::<Vec<_>>();

    match resource_type {
        Some(ResourceType::Shader) => instance_loader != "vanilla" && !instance_loader.is_empty(),
        Some(ResourceType::ResourcePack) | Some(ResourceType::DataPack) => true,
        Some(ResourceType::Mod) => {
            instance_loader != "vanilla"
                && !instance_loader.is_empty()
                && loader_matches(&loaders, &instance_loader)
        }
        Some(ResourceType::Modpack) => true,
        _ if instance_loader == "vanilla" || instance_loader.is_empty() => {
            loaders.is_empty() || loaders.iter().any(|loader| loader == "minecraft")
        }
        _ => loader_matches(&loaders, &instance_loader),
    }
}

fn loader_matches(loaders: &[String], instance_loader: &str) -> bool {
    loaders.iter().any(|loader| loader == instance_loader)
        || (instance_loader == "quilt" && loaders.iter().any(|loader| loader == "fabric"))
        || (instance_loader == "neoforge" && loaders.iter().any(|loader| loader == "forge"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::installed_resource::InstalledResource;

    fn installed(resource_type: &str, release_type: &str) -> InstalledResource {
        InstalledResource {
            id: 1,
            instance_id: 1,
            platform: "modrinth".into(),
            remote_id: "project".into(),
            remote_version_id: "old".into(),
            resource_type: resource_type.into(),
            local_path: "mods/example.jar".into(),
            display_name: "Example".into(),
            current_version: "1.0".into(),
            is_manual: false,
            is_enabled: true,
            last_updated: String::new(),
            release_type: release_type.into(),
            hash: None,
            file_size: 0,
            file_mtime: 0,
            source_kind: "custom".into(),
            source_modpack_id: None,
            source_modpack_version_id: None,
            source_modpack_platform: None,
        }
    }

    fn version(id: &str, game: &str, loader: &str, release: ReleaseType) -> ResourceVersion {
        ResourceVersion {
            id: id.into(),
            project_id: "project".into(),
            version_number: id.into(),
            game_versions: vec![game.into()],
            loaders: vec![loader.into()],
            download_url: String::new(),
            file_name: "example.jar".into(),
            release_type: release,
            hash: String::new(),
            dependencies: vec![],
            published_at: None,
        }
    }

    #[test]
    fn prefers_exact_game_versions_and_stable_releases() {
        let versions = vec![
            version("wildcard", "1.21.x", "fabric", ReleaseType::Beta),
            version("exact", "1.21.1", "fabric", ReleaseType::Release),
        ];
        let best = find_best_update(&versions, &installed("mod", "beta"), "1.21.1", "fabric");
        assert_eq!(best.unwrap().id, "exact");
    }

    #[test]
    fn supports_loader_compatibility_aliases() {
        let fabric = version("fabric", "1.21.1", "fabric", ReleaseType::Release);
        assert!(
            find_best_update(&[fabric], &installed("mod", "release"), "1.21.1", "quilt").is_some()
        );
    }

    #[test]
    fn release_installations_do_not_upgrade_to_prereleases() {
        let beta = version("beta", "1.21.1", "fabric", ReleaseType::Beta);
        assert!(
            find_best_update(&[beta], &installed("mod", "release"), "1.21.1", "fabric").is_none()
        );
    }

    #[test]
    fn vanilla_rejects_mod_updates_but_accepts_resource_packs() {
        let candidate = version("next", "1.21.1", "fabric", ReleaseType::Release);
        assert!(find_best_update(
            &[candidate.clone()],
            &installed("mod", "release"),
            "1.21.1",
            "vanilla"
        )
        .is_none());
        assert!(find_best_update(
            &[candidate],
            &installed("resourcepack", "release"),
            "1.21.1",
            "vanilla"
        )
        .is_some());
    }
}
