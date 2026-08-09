use crate::worlds::level_dat;
use crate::worlds::manifest::{self, WorldManifest, WorldSource};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Cursor, Read, Write};
use std::path::{Component, Path, PathBuf};
use sysinfo::Disks;
use uuid::Uuid;
use zip::ZipArchive;

const MAX_ARCHIVE_ENTRIES: usize = 100_000;
const MAX_EXPANDED_BYTES: u64 = 64 * 1024 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 1_000;
const MAX_ARCHIVE_ICON_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldArchiveCandidate {
    pub id: String,
    pub name: String,
    pub folder: String,
    pub size_bytes: u64,
    pub game_version: Option<String>,
    pub data_version: Option<i32>,
    pub icon_data_url: Option<String>,
}

#[derive(Debug, Clone)]
struct CandidateRoot {
    summary: WorldArchiveCandidate,
    root: PathBuf,
}

#[derive(Debug, Clone)]
pub struct ArchiveInspection {
    pub candidates: Vec<WorldArchiveCandidate>,
    roots: Vec<CandidateRoot>,
}

#[derive(Debug, Clone)]
pub struct InstalledWorld {
    pub directory_name: String,
    pub path: PathBuf,
}

pub fn inspect_archive(
    archive_path: &Path,
    saves_directory: &Path,
) -> Result<ArchiveInspection, String> {
    let file = File::open(archive_path)
        .map_err(|error| format!("Failed to open {}: {error}", archive_path.display()))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| format!("World download is not a valid ZIP archive: {error}"))?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(format!(
            "Archive contains too many entries ({})",
            archive.len()
        ));
    }

    let mut normalized_names = HashSet::new();
    let mut roots = HashSet::new();
    let mut declared_size = 0_u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("Failed to inspect archive entry: {error}"))?;
        let path = safe_entry_path(entry.name())?;
        let folded = path.to_string_lossy().to_lowercase();
        if !normalized_names.insert(folded) {
            return Err(format!(
                "Archive contains case-colliding entry {}",
                path.display()
            ));
        }
        reject_link(&entry, &path)?;
        declared_size = declared_size
            .checked_add(entry.size())
            .ok_or_else(|| "Archive expansion size overflowed".to_string())?;
        if declared_size > MAX_EXPANDED_BYTES {
            return Err("Archive declares an unreasonable expanded size".to_string());
        }
        if entry.size() > 1024 * 1024
            && (entry.compressed_size() == 0
                || entry.size() / entry.compressed_size().max(1) > MAX_COMPRESSION_RATIO)
        {
            return Err(format!(
                "Archive entry {} has a suspicious compression ratio",
                path.display()
            ));
        }
        if !is_wrapper_noise(&path)
            && path
                .file_name()
                .is_some_and(|name| name == "level.dat" || name == "level.dat_old")
        {
            roots.insert(path.parent().unwrap_or(Path::new("")).to_path_buf());
        }
    }
    ensure_available_space(saves_directory, declared_size)?;

    let mut roots: Vec<_> = roots.into_iter().collect();
    roots.sort();
    let all_roots = roots.clone();
    let mut candidates = Vec::with_capacity(roots.len());
    let mut candidate_roots = Vec::with_capacity(roots.len());
    for (index, root) in roots.into_iter().enumerate() {
        let summary = summarize_candidate(&mut archive, &root, &all_roots, index)?;
        candidates.push(summary.clone());
        candidate_roots.push(CandidateRoot { summary, root });
    }
    Ok(ArchiveInspection {
        candidates,
        roots: candidate_roots,
    })
}

pub fn install_archive<F>(
    archive_path: &Path,
    saves_directory: &Path,
    selected_candidate_ids: &[String],
    source: Option<WorldSource>,
    mut progress: F,
) -> Result<Vec<InstalledWorld>, String>
where
    F: FnMut(u64, u64) -> Result<(), String>,
{
    fs::create_dir_all(saves_directory)
        .map_err(|error| format!("Failed to create {}: {error}", saves_directory.display()))?;
    let inspection = inspect_archive(archive_path, saves_directory)?;
    let all_candidate_roots: Vec<PathBuf> = inspection
        .roots
        .iter()
        .map(|candidate| candidate.root.clone())
        .collect();
    let selected: Vec<_> = inspection
        .roots
        .into_iter()
        .filter(|candidate| selected_candidate_ids.contains(&candidate.summary.id))
        .collect();
    if selected.len() != selected_candidate_ids.len() || selected.is_empty() {
        return Err("World archive selection contains an unknown candidate".to_string());
    }

    let staging_root = saves_directory.join(format!(".vesta-world-install-{}", Uuid::new_v4()));
    fs::create_dir(&staging_root)
        .map_err(|error| format!("Failed to create world staging directory: {error}"))?;
    let result = install_selected_into_staging(
        archive_path,
        saves_directory,
        &staging_root,
        selected,
        all_candidate_roots,
        source,
        &mut progress,
    );
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging_root);
    }
    result
}

fn install_selected_into_staging<F>(
    archive_path: &Path,
    saves_directory: &Path,
    staging_root: &Path,
    selected: Vec<CandidateRoot>,
    all_candidate_roots: Vec<PathBuf>,
    source: Option<WorldSource>,
    progress: &mut F,
) -> Result<Vec<InstalledWorld>, String>
where
    F: FnMut(u64, u64) -> Result<(), String>,
{
    let file = File::open(archive_path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let total: u64 = selected
        .iter()
        .map(|candidate| candidate.summary.size_bytes)
        .sum();
    let mut written = 0_u64;
    let mut staged = Vec::new();

    for (candidate_index, candidate) in selected.iter().enumerate() {
        let directory_name = collision_free_name(
            saves_directory,
            &candidate.summary.folder,
            staged
                .iter()
                .map(|(name, _): &(String, PathBuf)| name.as_str()),
        );
        let staged_world = staging_root.join(format!("world-{candidate_index}"));
        fs::create_dir(&staged_world).map_err(|error| error.to_string())?;
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
            let entry_path = safe_entry_path(entry.name())?;
            if belongs_to_descendant_candidate(&entry_path, &candidate.root, &all_candidate_roots) {
                continue;
            }
            let Some(relative) = strip_candidate_root(&entry_path, &candidate.root) else {
                continue;
            };
            if relative.as_os_str().is_empty() {
                continue;
            }
            let output = staged_world.join(relative);
            if entry.is_dir() {
                fs::create_dir_all(&output).map_err(|error| error.to_string())?;
            } else {
                if let Some(parent) = output.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                let mut file = OpenOptions::new()
                    .create_new(true)
                    .write(true)
                    .open(&output)
                    .map_err(|error| format!("Failed to create {}: {error}", output.display()))?;
                let mut copied = 0_u64;
                let mut buffer = [0_u8; 128 * 1024];
                loop {
                    let read = entry.read(&mut buffer).map_err(|error| {
                        format!("Failed to extract {}: {error}", output.display())
                    })?;
                    if read == 0 {
                        break;
                    }
                    file.write_all(&buffer[..read]).map_err(|error| {
                        format!("Failed to write {}: {error}", output.display())
                    })?;
                    copied = copied.saturating_add(read as u64);
                    written = written.saturating_add(read as u64);
                    if written > total || written > MAX_EXPANDED_BYTES {
                        return Err("Archive expanded beyond its declared safe size".to_string());
                    }
                    progress(written, total)?;
                }
                file.flush().map_err(|error| error.to_string())?;
                if copied != entry.size() {
                    return Err(format!(
                        "Archive entry {} expanded to an unexpected size",
                        entry_path.display()
                    ));
                }
            }
        }
        if level_dat::read_world_level(&staged_world).status == level_dat::LevelStatus::Unreadable {
            return Err(format!(
                "{} did not extract as a readable Java world",
                candidate.summary.name
            ));
        }
        let manifest = WorldManifest::new(source.clone());
        manifest::write_manifest(&staged_world, &manifest)?;
        staged.push((directory_name, staged_world));
    }

    let mut published: Vec<InstalledWorld> = Vec::new();
    for (directory_name, staged_world) in staged {
        let destination = saves_directory.join(&directory_name);
        if let Err(error) = fs::rename(&staged_world, &destination) {
            for world in &published {
                let _ = fs::remove_dir_all(&world.path);
            }
            return Err(format!("Failed to publish world {directory_name}: {error}"));
        }
        published.push(InstalledWorld {
            directory_name,
            path: destination,
        });
    }
    let _ = fs::remove_dir_all(staging_root);
    Ok(published)
}

fn summarize_candidate(
    archive: &mut ZipArchive<File>,
    root: &Path,
    all_roots: &[PathBuf],
    index: usize,
) -> Result<WorldArchiveCandidate, String> {
    let mut size_bytes = 0_u64;
    let mut primary_level = None;
    let mut backup_level = None;
    let mut icon = None;
    for entry_index in 0..archive.len() {
        let mut entry = archive
            .by_index(entry_index)
            .map_err(|error| error.to_string())?;
        let path = safe_entry_path(entry.name())?;
        if belongs_to_descendant_candidate(&path, root, all_roots) {
            continue;
        }
        if strip_candidate_root(&path, root).is_none() {
            continue;
        }
        size_bytes = size_bytes.saturating_add(entry.size());
        let relative = strip_candidate_root(&path, root).unwrap();
        if relative == Path::new("level.dat") || relative == Path::new("level.dat_old") {
            if entry.size() <= 16 * 1024 * 1024 {
                let mut bytes = Vec::with_capacity(entry.size() as usize);
                entry
                    .read_to_end(&mut bytes)
                    .map_err(|error| error.to_string())?;
                let parsed = level_dat::read_level_gzip_bytes(&bytes).ok();
                if relative == Path::new("level.dat") {
                    primary_level = parsed;
                } else {
                    backup_level = parsed;
                }
            }
        } else if relative == Path::new("icon.png") && entry.size() <= MAX_ARCHIVE_ICON_BYTES {
            let mut bytes = Vec::with_capacity(entry.size() as usize);
            entry
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            let dimensions = image::ImageReader::new(Cursor::new(&bytes))
                .with_guessed_format()
                .ok()
                .and_then(|reader| reader.into_dimensions().ok());
            if dimensions.is_some_and(|(width, height)| width <= 4096 && height <= 4096) {
                let mime = crate::utils::image::detect_image_mime(&bytes);
                icon = Some(format!(
                    "data:{mime};base64,{}",
                    general_purpose::STANDARD.encode(bytes)
                ));
            }
        }
    }
    let folder = root
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("World")
        .to_string();
    let level = primary_level.or(backup_level);
    let name = level
        .as_ref()
        .and_then(|level| level.level_name.clone())
        .unwrap_or_else(|| folder.clone());
    let game_version = level.as_ref().and_then(|level| {
        level.version_name.clone().or_else(|| {
            level
                .data_version
                .map(|value| format!("DataVersion {value}"))
        })
    });
    Ok(WorldArchiveCandidate {
        id: format!("candidate-{}", index + 1),
        name,
        folder,
        size_bytes,
        game_version,
        data_version: level.and_then(|level| level.data_version),
        icon_data_url: icon,
    })
}

fn belongs_to_descendant_candidate(path: &Path, root: &Path, all_roots: &[PathBuf]) -> bool {
    all_roots.iter().any(|other| {
        other != root
            && other.starts_with(root)
            && path.starts_with(other)
            && !other.as_os_str().is_empty()
    })
}

fn safe_entry_path(name: &str) -> Result<PathBuf, String> {
    if name.contains('\\') || name.as_bytes().contains(&0) {
        return Err(format!("Archive contains unsafe path {name:?}"));
    }
    let path = PathBuf::from(name);
    if path.is_absolute()
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
        || path
            .components()
            .next()
            .and_then(|component| component.as_os_str().to_str())
            .is_some_and(|component| component.contains(':'))
    {
        return Err(format!("Archive contains unsafe path {name:?}"));
    }
    Ok(path)
}

fn reject_link(entry: &zip::read::ZipFile<'_, File>, path: &Path) -> Result<(), String> {
    if let Some(mode) = entry.unix_mode() {
        let kind = mode & 0o170000;
        if kind == 0o120000 || kind == 0o060000 {
            return Err(format!("Archive links are not allowed: {}", path.display()));
        }
    }
    Ok(())
}

fn strip_candidate_root<'a>(path: &'a Path, root: &Path) -> Option<&'a Path> {
    if root.as_os_str().is_empty() {
        Some(path)
    } else {
        path.strip_prefix(root).ok()
    }
}

fn is_wrapper_noise(path: &Path) -> bool {
    path.components()
        .any(|component| component.as_os_str() == "__MACOSX")
}

fn ensure_available_space(destination: &Path, declared_size: u64) -> Result<(), String> {
    let probe = destination
        .canonicalize()
        .or_else(|_| destination.parent().unwrap_or(destination).canonicalize())
        .unwrap_or_else(|_| destination.to_path_buf());
    let disks = Disks::new_with_refreshed_list();
    if let Some(disk) = disks
        .list()
        .iter()
        .filter(|disk| probe.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().components().count())
    {
        if declared_size > disk.available_space() {
            return Err(
                "Archive declares more data than the destination disk can hold".to_string(),
            );
        }
    }
    Ok(())
}

fn collision_free_name<'a>(
    saves_directory: &Path,
    requested: &str,
    reserved: impl Iterator<Item = &'a str>,
) -> String {
    let base = sanitize_folder_name(requested);
    let reserved: HashSet<String> = reserved.map(|name| name.to_lowercase()).collect();
    for suffix in 1_u32.. {
        let candidate = if suffix == 1 {
            base.clone()
        } else {
            format!("{base} ({suffix})")
        };
        if !saves_directory.join(&candidate).exists()
            && !reserved.contains(&candidate.to_lowercase())
        {
            return candidate;
        }
    }
    unreachable!()
}

fn sanitize_folder_name(name: &str) -> String {
    let sanitized: String = name
        .chars()
        .map(|character| match character {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => character,
        })
        .collect();
    let sanitized = sanitized.trim().trim_matches('.');
    if sanitized.is_empty() {
        "World".to_string()
    } else {
        sanitized.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use serde::Serialize;
    use tempfile::TempDir;
    use zip::write::SimpleFileOptions;
    use zip::{CompressionMethod, ZipWriter};

    fn level_bytes(name: &str) -> Vec<u8> {
        #[derive(Serialize)]
        #[serde(rename_all = "PascalCase")]
        struct Root {
            data: Data,
        }
        #[derive(Serialize)]
        #[serde(rename_all = "PascalCase")]
        struct Data {
            level_name: String,
            data_version: i32,
        }
        let nbt = fastnbt::to_bytes(&Root {
            data: Data {
                level_name: name.into(),
                data_version: 3465,
            },
        })
        .unwrap();
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&nbt).unwrap();
        encoder.finish().unwrap()
    }

    fn zip_with(entries: &[(&str, Vec<u8>)]) -> (TempDir, PathBuf) {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("world.zip");
        let file = File::create(&path).unwrap();
        let mut writer = ZipWriter::new(file);
        for (name, bytes) in entries {
            writer
                .start_file(
                    *name,
                    SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
                )
                .unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
        (temp, path)
    }

    #[test]
    fn finds_root_wrapped_and_multiple_worlds_while_ignoring_macos_noise() {
        let (_temp, zip) = zip_with(&[
            ("level.dat", level_bytes("Root")),
            ("wrapper/second/level.dat", level_bytes("Second")),
            ("__MACOSX/junk/level.dat", level_bytes("Noise")),
        ]);
        let saves = TempDir::new().unwrap();
        let inspection = inspect_archive(&zip, saves.path()).unwrap();
        assert_eq!(inspection.candidates.len(), 2);
        assert_eq!(inspection.candidates[0].name, "Root");
        assert_eq!(inspection.candidates[1].name, "Second");
    }

    #[test]
    fn rejects_traversal_absolute_and_case_collisions() {
        for name in ["../level.dat", "/level.dat", "C:/level.dat"] {
            let (_temp, zip) = zip_with(&[(name, level_bytes("Unsafe"))]);
            let saves = TempDir::new().unwrap();
            assert!(inspect_archive(&zip, saves.path()).is_err());
        }
        let (_temp, zip) = zip_with(&[
            ("World/level.dat", level_bytes("One")),
            ("world/LEVEL.DAT", level_bytes("Two")),
        ]);
        let saves = TempDir::new().unwrap();
        assert!(inspect_archive(&zip, saves.path()).is_err());
    }

    #[test]
    fn installs_all_candidates_with_collision_safe_names() {
        let (_temp, zip) = zip_with(&[
            ("World/level.dat", level_bytes("One")),
            ("Other/level.dat", level_bytes("Two")),
        ]);
        let saves = TempDir::new().unwrap();
        fs::create_dir(saves.path().join("World")).unwrap();
        let inspection = inspect_archive(&zip, saves.path()).unwrap();
        let ids: Vec<_> = inspection
            .candidates
            .iter()
            .map(|candidate| candidate.id.clone())
            .collect();
        let installed = install_archive(&zip, saves.path(), &ids, None, |_, _| Ok(())).unwrap();
        assert_eq!(installed.len(), 2);
        assert!(saves.path().join("World (2)/level.dat").exists());
        assert!(saves.path().join("Other/level.dat").exists());
    }

    #[test]
    fn zero_candidate_archive_is_rejected_by_selection() {
        let (_temp, zip) = zip_with(&[("readme.txt", b"hello".to_vec())]);
        let saves = TempDir::new().unwrap();
        let inspection = inspect_archive(&zip, saves.path()).unwrap();
        assert!(inspection.candidates.is_empty());
        assert!(install_archive(&zip, saves.path(), &[], None, |_, _| Ok(())).is_err());
    }

    #[test]
    fn cancellation_during_streaming_removes_partial_worlds() {
        let (_temp, zip) = zip_with(&[
            ("World/level.dat", level_bytes("World")),
            ("World/region/r.0.0.mca", vec![7_u8; 512 * 1024]),
        ]);
        let destination = TempDir::new().unwrap();
        let inspection = inspect_archive(&zip, destination.path()).unwrap();
        let selected = vec![inspection.candidates[0].id.clone()];
        let error = install_archive(&zip, destination.path(), &selected, None, |_, _| {
            Err("cancelled".to_string())
        })
        .unwrap_err();
        assert_eq!(error, "cancelled");
        assert!(destination.path().read_dir().unwrap().next().is_none());
    }

    #[test]
    fn symlink_entries_are_rejected() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("world.zip");
        let file = File::create(&path).unwrap();
        let mut writer = ZipWriter::new(file);
        writer
            .start_file(
                "World/level.dat",
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .unwrap();
        writer.write_all(&level_bytes("World")).unwrap();
        writer
            .add_symlink("World/link", "../../outside", SimpleFileOptions::default())
            .unwrap();
        writer.finish().unwrap();
        let saves = TempDir::new().unwrap();
        assert!(inspect_archive(&path, saves.path())
            .unwrap_err()
            .contains("links are not allowed"));
    }
}
