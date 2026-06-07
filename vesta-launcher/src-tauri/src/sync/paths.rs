use anyhow::{bail, Context, Result};
use std::path::{Component, Path, PathBuf};

/// Validate and normalize a relative path for staging/commit operations.
/// Rejects absolute paths, `..` components, NUL bytes, and empty paths.
pub fn validate_staged_relative_path(path: &str) -> Result<PathBuf> {
    if path.is_empty() {
        bail!("Path must not be empty");
    }
    if path.contains('\0') {
        bail!("Path contains NUL byte");
    }

    let normalized = path.replace('\\', "/");
    if normalized.starts_with('/') {
        bail!("Absolute paths are not allowed: {}", path);
    }
    if normalized.chars().nth(1) == Some(':') {
        bail!("Absolute paths are not allowed: {}", path);
    }

    let mut out = PathBuf::new();
    for component in Path::new(&normalized).components() {
        match component {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            Component::ParentDir => bail!("Path traversal (..) is not allowed: {}", path),
            Component::RootDir | Component::Prefix(_) => {
                bail!("Absolute paths are not allowed: {}", path)
            }
        }
    }

    if out.as_os_str().is_empty() {
        bail!("Path must not be empty");
    }

    Ok(out)
}

/// Verify that `candidate` is equal to or nested under `root` (both relative or absolute).
pub fn path_is_within(root: &Path, candidate: &Path) -> Result<()> {
    let root = root
        .components()
        .fold(PathBuf::new(), |mut acc, c| {
            acc.push(c);
            acc
        });
    let candidate = candidate
        .components()
        .fold(PathBuf::new(), |mut acc, c| {
            acc.push(c);
            acc
        });

    if candidate == root {
        return Ok(());
    }

    let mut root_iter = root.components();
    for component in candidate.components() {
        match root_iter.next() {
            Some(expected) if expected == component => continue,
            Some(_) => bail!(
                "Path escapes root: {:?} is not under {:?}",
                candidate,
                root
            ),
            None => return Ok(()),
        }
    }

    bail!(
        "Path escapes root: {:?} is not under {:?}",
        candidate,
        root
    )
}

/// Join `root` with a validated relative path and verify containment.
pub fn join_validated(root: &Path, relative_path: &str) -> Result<PathBuf> {
    let relative = validate_staged_relative_path(relative_path)?;
    let joined = root.join(&relative);
    path_is_within(root, &joined).with_context(|| {
        format!(
            "Validated path {:?} escapes root {:?}",
            relative_path, root
        )
    })?;
    Ok(joined)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_normal_nested_path() {
        let p = validate_staged_relative_path("mods/foo.jar").unwrap();
        assert_eq!(p, PathBuf::from("mods/foo.jar"));
    }

    #[test]
    fn rejects_parent_dir() {
        assert!(validate_staged_relative_path("../etc/passwd").is_err());
        assert!(validate_staged_relative_path("foo/../../../etc/passwd").is_err());
    }

    #[test]
    fn rejects_absolute_unix() {
        assert!(validate_staged_relative_path("/etc/passwd").is_err());
    }

    #[test]
    fn rejects_empty() {
        assert!(validate_staged_relative_path("").is_err());
    }

    #[test]
    fn normalizes_backslashes() {
        let p = validate_staged_relative_path("config\\test.properties").unwrap();
        assert_eq!(p, PathBuf::from("config/test.properties"));
    }

    #[test]
    fn path_is_within_accepts_nested() {
        let root = PathBuf::from("/game/.update_stage");
        let nested = PathBuf::from("/game/.update_stage/mods/a.jar");
        path_is_within(&root, &nested).unwrap();
    }

    #[test]
    fn path_is_within_rejects_escape() {
        let root = PathBuf::from("/game/.update_stage");
        let escaped = PathBuf::from("/game/mods/a.jar");
        assert!(path_is_within(&root, &escaped).is_err());
    }
}
