use crate::models::instance::Instance;
use anyhow::Result;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// Compute a unique name for an instance, appending a number if the name already exists
/// Names are checked case-insensitively to prevent confusion
pub fn compute_unique_name(base_name: &str, existing_names_lowercase: &HashSet<String>) -> String {
    let base_lower = base_name.to_lowercase();

    if !existing_names_lowercase.contains(&base_lower) {
        return base_name.to_string();
    }

    // Name exists (case-insensitive), find next available number
    let mut idx = 2;
    loop {
        let candidate = format!("{} ({})", base_name, idx);
        if !existing_names_lowercase.contains(&candidate.to_lowercase()) {
            return candidate;
        }
        idx += 1;
    }
}

/// Compute a unique slug for an instance based on its name.
/// Ensures uniqueness by checking against existing slugs and the filesystem.
pub fn compute_unique_slug(
    base_name: &str,
    seen_slugs: &HashSet<String>,
    instances_root: &Path,
) -> String {
    let mut slug = crate::utils::sanitize::sanitize_instance_name(base_name);
    if slug.is_empty() {
        slug = "instance".to_string();
    }

    // Check if slug exists in DB or on disk
    if seen_slugs.contains(&slug) || instances_root.join(&slug).exists() {
        let mut idx = 2;
        loop {
            let candidate = format!("{}-{}", slug, idx);
            if !seen_slugs.contains(&candidate) && !instances_root.join(&candidate).exists() {
                return candidate;
            }
            idx += 1;
        }
    }
    slug
}

pub fn normalize_path(path: &Path) -> String {
    let s = path.to_string_lossy().to_string();
    if cfg!(windows) {
        s.replace("/", "\\")
    } else {
        s.replace("\\", "/")
    }
}

/// Resolve the configured instances root directory.
pub fn resolve_instances_root(app_config_dir: &Path, default_game_dir: Option<&str>) -> PathBuf {
    if let Some(dir) = default_game_dir {
        if !dir.is_empty() && dir != "/" {
            return PathBuf::from(dir);
        }
    }
    app_config_dir.join("instances")
}

/// Resolve the game directory for an instance using the same rules as launch.
pub fn resolve_instance_game_directory(
    inst: &Instance,
    instances_root: &Path,
    data_dir: &Path,
) -> PathBuf {
    let slug = inst.slug();

    if let Some(stored) = inst.game_directory.as_ref() {
        if !stored.is_empty() {
            let stored_path = PathBuf::from(stored);
            if stored_path.exists() {
                return stored_path;
            }
            if inst.use_global_game_dir {
                return instances_root.join(&slug);
            }
            return stored_path;
        }
    }

    if inst.use_global_game_dir {
        return instances_root.join(&slug);
    }

    data_dir.join("instances").join(&slug)
}

/// Locate the on-disk source folder when duplicating an instance.
pub fn resolve_clone_source_directory(
    inst: &Instance,
    instances_root: &Path,
    data_dir: &Path,
) -> Result<PathBuf, String> {
    let mut seen = HashSet::new();
    let mut candidates = Vec::new();

    let mut push_candidate = |path: PathBuf| {
        let key = normalize_path(&path);
        if seen.insert(key) {
            candidates.push(path);
        }
    };

    if let Some(stored) = inst.game_directory.as_ref() {
        if !stored.is_empty() {
            push_candidate(PathBuf::from(stored));
        }
    }

    let slug = inst.slug();
    push_candidate(instances_root.join(&slug));
    push_candidate(data_dir.join("instances").join(&slug));

    if let Some(import_src) = inst.import_source_game_directory.as_ref() {
        if !import_src.is_empty() {
            push_candidate(PathBuf::from(import_src));
        }
    }

    for path in &candidates {
        if path.is_dir() {
            return Ok(path.clone());
        }
    }

    let checked = candidates
        .iter()
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");

    Err(format!(
        "Could not find source files for '{}'. Checked: {}. Verify the original instance still has its game folder.",
        inst.name, checked
    ))
}

/// Remap an absolute resource path from the source instance root to the clone root.
pub fn remap_path_under_root(local_path: &str, source_root: &Path, dest_root: &Path) -> String {
    let path = Path::new(local_path);
    if let Ok(relative) = path.strip_prefix(source_root) {
        return dest_root.join(relative).to_string_lossy().to_string();
    }

    let norm_local = normalize_path(path);
    let norm_source = normalize_path(source_root);
    let source_prefix = format!(
        "{}/",
        norm_source.trim_end_matches(['/', '\\'])
    );

    let relative = if cfg!(windows) {
        norm_local
            .to_lowercase()
            .strip_prefix(&source_prefix.to_lowercase())
            .map(|suffix| suffix.to_string())
    } else {
        norm_local
            .strip_prefix(&source_prefix)
            .map(|suffix| suffix.to_string())
    };

    if let Some(relative) = relative {
        return dest_root.join(relative).to_string_lossy().to_string();
    }

    local_path.to_string()
}

/// Count regular files under a directory tree.
pub fn count_files_in_directory(dir: &Path) -> u64 {
    if !dir.is_dir() {
        return 0;
    }

    WalkDir::new(dir)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .count() as u64
}

/// Recursively copy a directory tree into `dest`.
pub fn copy_directory_recursive(src: &Path, dest: &Path) -> Result<u64, String> {
    if !src.is_dir() {
        return Err(format!("Source is not a directory: {}", src.display()));
    }

    let mut files_copied = 0u64;
    for entry in WalkDir::new(src).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let relative = path
            .strip_prefix(src)
            .map_err(|e| format!("Strip prefix error: {:?}", e))?;
        let target = dest.join(relative);

        if path.is_dir() {
            std::fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::copy(path, &target).map_err(|e| {
                format!(
                    "Failed to copy '{}' to '{}': {}",
                    path.display(),
                    target.display(),
                    e
                )
            })?;
            files_copied += 1;
        }
    }

    Ok(files_copied)
}

/// Ensure the instance directory exists.
pub fn ensure_instance_directory(instances_root: &Path, slug: &str) -> Result<PathBuf> {
    let path = instances_root.join(slug);
    if !path.exists() {
        std::fs::create_dir_all(&path)?;
    }
    Ok(path)
}

/// Download an icon from a URL and return it as bytes
pub async fn download_icon_as_bytes(url: &str) -> Result<Vec<u8>> {
    let client = piston_lib::client::shared_client();
    let resp = client.get(url).send().await?;
    let bytes = resp.bytes().await?;
    Ok(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_clone_source_prefers_existing_game_directory() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let source_path = tmp.path().join("my-instance");
        std::fs::create_dir_all(&source_path).expect("create source");

        let mut inst = Instance::default();
        inst.name = "My Instance".to_string();
        inst.game_directory = Some(source_path.to_string_lossy().to_string());

        let instances_root = tmp.path().join("instances");
        let data_dir = tmp.path().join("data");
        let resolved = resolve_clone_source_directory(&inst, &instances_root, &data_dir)
            .expect("resolve source");

        assert_eq!(resolved, source_path);
    }

    #[test]
    fn resolve_clone_source_falls_back_to_import_directory() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let import_path = tmp.path().join("imported");
        std::fs::create_dir_all(&import_path).expect("create import");

        let mut inst = Instance::default();
        inst.name = "Imported Pack".to_string();
        inst.game_directory = Some(tmp.path().join("missing").to_string_lossy().to_string());
        inst.import_source_game_directory =
            Some(import_path.to_string_lossy().to_string());

        let instances_root = tmp.path().join("instances");
        let data_dir = tmp.path().join("data");
        let resolved = resolve_clone_source_directory(&inst, &instances_root, &data_dir)
            .expect("resolve source");

        assert_eq!(resolved, import_path);
    }

    #[test]
    fn remap_path_under_root_rewrites_absolute_paths() {
        let source = PathBuf::from("/instances/source");
        let dest = PathBuf::from("/instances/dest");
        let remapped = remap_path_under_root("/instances/source/mods/foo.jar", &source, &dest);
        assert_eq!(remapped, "/instances/dest/mods/foo.jar");
    }
}
