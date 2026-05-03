use std::path::{Path, PathBuf};

pub fn strip_known_suffixes(path: &Path, suffixes: &[&str]) -> PathBuf {
    let mut current = path.to_path_buf();

    loop {
        let Some(name) = current.file_name().and_then(|s| s.to_str()) else {
            break current;
        };

        if suffixes
            .iter()
            .any(|suffix| name.eq_ignore_ascii_case(suffix))
        {
            if let Some(parent) = current.parent() {
                current = parent.to_path_buf();
                continue;
            }
        }

        break current;
    }
}

#[cfg(test)]
mod tests {
    use super::strip_known_suffixes;
    use std::path::PathBuf;

    #[test]
    fn strips_known_suffixes_repeatedly() {
        let base = PathBuf::from("/tmp/ATLauncher/Contents/Java/instances");
        let resolved = strip_known_suffixes(&base, &["instances", "java", "contents"]);

        assert_eq!(resolved, PathBuf::from("/tmp/ATLauncher"));
    }

    #[test]
    fn leaves_unmatched_paths_untouched() {
        let base = PathBuf::from("/tmp/launcher-root");
        let resolved = strip_known_suffixes(&base, &["instances", "data"]);

        assert_eq!(resolved, base);
    }
}
