use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::launcher_import::types::ExternalInstanceCandidate;

const MAX_SIZE_SCAN_ENTRIES: usize = 50_000;

pub fn enrich_candidate_stats(candidate: &mut ExternalInstanceCandidate) {
    let game_dir = PathBuf::from(&candidate.game_directory);
    if !game_dir.exists() || !game_dir.is_dir() {
        return;
    }

    candidate.mods_count = count_files_in_dir(&game_dir.join("mods"));
    candidate.resourcepacks_count = count_files_in_dir(&game_dir.join("resourcepacks"));
    candidate.shaderpacks_count = count_files_in_dir(&game_dir.join("shaderpacks"));
    candidate.worlds_count = count_dirs_in_dir(&game_dir.join("saves"));
    candidate.screenshots_count = count_files_in_dir(&game_dir.join("screenshots"));
    if candidate.last_played_at_unix_ms.is_none() {
        candidate.last_played_at_unix_ms = guess_last_played_ms(&game_dir);
    }
    candidate.game_directory_size_bytes =
        compute_dir_size_bounded(&game_dir, MAX_SIZE_SCAN_ENTRIES);
}

fn count_files_in_dir(path: &Path) -> Option<u32> {
    let read_dir = fs::read_dir(path).ok()?;
    let count = read_dir
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_file())
        .count();
    u32::try_from(count).ok()
}

fn count_dirs_in_dir(path: &Path) -> Option<u32> {
    let read_dir = fs::read_dir(path).ok()?;
    let count = read_dir
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .count();
    u32::try_from(count).ok()
}

fn guess_last_played_ms(game_dir: &Path) -> Option<i64> {
    // Directory mtimes reflect imports and file management, not game sessions.
    fs::metadata(game_dir.join("logs/latest.log"))
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

fn compute_dir_size_bounded(root: &Path, max_entries: usize) -> Option<u64> {
    let mut total_size: u64 = 0;
    let mut seen_entries: usize = 0;
    let mut stack = vec![root.to_path_buf()];

    while let Some(path) = stack.pop() {
        let read_dir = fs::read_dir(&path).ok()?;
        for entry in read_dir.flatten() {
            seen_entries += 1;
            if seen_entries > max_entries {
                return None;
            }

            let entry_path = entry.path();
            if entry_path.is_dir() {
                stack.push(entry_path);
                continue;
            }
            if let Ok(metadata) = entry.metadata() {
                total_size = total_size.saturating_add(metadata.len());
            }
        }
    }

    Some(total_size)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_recorded_dates_and_does_not_treat_folder_changes_as_play() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("saves")).unwrap();
        let mut candidate = ExternalInstanceCandidate {
            game_directory: root.path().to_string_lossy().to_string(),
            ..Default::default()
        };
        enrich_candidate_stats(&mut candidate);
        assert_eq!(candidate.last_played_at_unix_ms, None);
        fs::create_dir(root.path().join("logs")).unwrap();
        fs::write(root.path().join("logs/latest.log"), "session").unwrap();
        enrich_candidate_stats(&mut candidate);
        assert!(candidate.last_played_at_unix_ms.is_some());
        candidate.last_played_at_unix_ms = Some(1_700_000_000_000);
        enrich_candidate_stats(&mut candidate);
        assert_eq!(candidate.last_played_at_unix_ms, Some(1_700_000_000_000));
    }
}
