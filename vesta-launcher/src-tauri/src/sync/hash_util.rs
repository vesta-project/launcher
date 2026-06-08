use anyhow::Result;
use std::path::Path;

use piston_lib::game::modpack::manifest::compute_file_sha1;

/// Hash a tracked file on disk (sha1 — same as repair and modpack index).
pub fn hash_file_on_disk(path: &Path) -> Result<String> {
    compute_file_sha1(path)
}

/// Verify a file matches an expected sha1 hash.
pub fn file_matches_hash(path: &Path, expected: &str) -> Result<bool> {
    let actual = compute_file_sha1(path)?.to_lowercase();
    Ok(actual == expected.to_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_matches_sha1() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("test.txt");
        std::fs::write(&file, b"hello world").unwrap();

        let sha1 = compute_file_sha1(&file).unwrap();
        assert!(file_matches_hash(&file, &sha1).unwrap());
        assert!(!file_matches_hash(&file, "deadbeef").unwrap());
    }
}
