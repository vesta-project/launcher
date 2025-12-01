use anyhow::Result;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

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
    let mut slug = slug::slugify(base_name);
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

/// Ensure the instance directory exists.
pub fn ensure_instance_directory(instances_root: &Path, slug: &str) -> Result<PathBuf> {
    let path = instances_root.join(slug);
    if !path.exists() {
        std::fs::create_dir_all(&path)?;
    }
    Ok(path)
}
