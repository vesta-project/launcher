use crate::error::SandboxError;
use crate::policy::PathAccess;
use std::path::{Path, PathBuf};

/// Canonicalize allowlisted paths and reject symlink escapes relative to declared roots.
///
/// When one input path is an ancestor of another, the canonical child must remain
/// under the canonical ancestor. Symlinks that resolve outside a declared root are
/// rejected.
pub fn canonicalize_allowlist(paths: &[PathBuf]) -> Result<Vec<PathBuf>, SandboxError> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut entries: Vec<(usize, PathBuf, PathBuf)> = paths
        .iter()
        .enumerate()
        .map(|(index, path)| {
            let canonical = canonicalize_path(path)?;
            Ok((index, path.clone(), canonical))
        })
        .collect::<Result<_, SandboxError>>()?;

    entries.sort_by_key(|(_, _, canonical)| canonical.components().count());

    for i in 0..entries.len() {
        for j in 0..i {
            let (_, child_orig, child_canon) = &entries[i];
            let (_, ancestor_orig, ancestor_canon) = &entries[j];
            if is_logical_ancestor(child_orig, ancestor_orig)
                && !is_subpath(child_canon, ancestor_canon)
            {
                return Err(SandboxError::SymlinkEscape {
                    path: child_orig.display().to_string(),
                    root: ancestor_orig.display().to_string(),
                });
            }
        }
    }

    let mut canonical = vec![PathBuf::new(); paths.len()];
    for (idx, _, path) in entries {
        canonical[idx] = path;
    }
    Ok(canonical)
}

/// Canonicalize [`PathAccess`] entries, preserving access flags.
pub fn canonicalize_path_access(
    entries: &[PathAccess],
) -> Result<Vec<PathAccess>, SandboxError> {
    let paths: Vec<PathBuf> = entries.iter().map(|entry| entry.path.clone()).collect();
    let canonical = canonicalize_allowlist(&paths)?;

    Ok(entries
        .iter()
        .zip(canonical)
        .map(|(entry, path)| PathAccess {
            path,
            read: entry.read,
            write: entry.write,
            execute: entry.execute,
        })
        .collect())
}

fn canonicalize_path(path: &Path) -> Result<PathBuf, SandboxError> {
    if path.exists() {
        return std::fs::canonicalize(path).map_err(|source| SandboxError::Canonicalize {
            path: path.display().to_string(),
            source,
        });
    }

    let mut suffix = PathBuf::new();
    let mut current = path.to_path_buf();

    while !current.as_os_str().is_empty() {
        if current.exists() {
            let base = std::fs::canonicalize(&current).map_err(|source| {
                SandboxError::Canonicalize {
                    path: path.display().to_string(),
                    source,
                }
            })?;
            return Ok(base.join(&suffix));
        }

        match current.file_name() {
            Some(name) => {
                suffix = PathBuf::from(name).join(suffix);
                current.pop();
            }
            None => {
                return Err(SandboxError::PathNotFound {
                    path: path.display().to_string(),
                });
            }
        }
    }

    Err(SandboxError::PathNotFound {
        path: path.display().to_string(),
    })
}

fn is_logical_ancestor(path: &Path, ancestor: &Path) -> bool {
    path.starts_with(ancestor) && path != ancestor
}

fn is_subpath(child: &Path, root: &Path) -> bool {
    child.starts_with(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn canonicalize_existing_paths() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("data");
        fs::create_dir_all(&root).unwrap();

        let canonical = canonicalize_allowlist(&[root.clone()]).unwrap();
        assert_eq!(canonical.len(), 1);
        assert!(canonical[0].ends_with("data"));
    }

    #[test]
    fn child_must_stay_under_root_after_canonicalization() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("root");
        let child = root.join("child");
        fs::create_dir_all(&child).unwrap();

        let canonical =
            canonicalize_allowlist(&[root.clone(), child.clone()]).unwrap();
        assert!(is_subpath(&canonical[1], &canonical[0]));
    }

    #[test]
    fn rejects_symlink_escape() {
        let temp = TempDir::new().unwrap();
        let root = temp.path().join("root");
        let outside = temp.path().join("outside");
        let link = root.join("escape");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::symlink;
            symlink(&outside, &link).unwrap();
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::symlink_dir;
            symlink_dir(&outside, &link).unwrap();
        }

        let err = canonicalize_allowlist(&[root, link]).unwrap_err();
        assert!(matches!(err, SandboxError::SymlinkEscape { .. }));
    }
}
