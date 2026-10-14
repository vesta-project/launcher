use crate::worlds::level_dat;
use crate::worlds::manifest::{self, WorldManifest, WorldSource};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, Cursor, Read, Seek, SeekFrom, Write};
use std::path::{Component, Path, PathBuf};
use sysinfo::Disks;
use unicode_casefold::UnicodeCaseFold;
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;
use zip::read::HasZipMetadata;
use zip::ZipArchive;

const MAX_ARCHIVE_ENTRIES: usize = 100_000;
const MAX_WORLD_CANDIDATES: usize = 32;
const MAX_EXPANDED_BYTES: u64 = 64 * 1024 * 1024 * 1024;
const MAX_COMPRESSION_RATIO: u64 = 500;
const MAX_ARCHIVE_ICON_BYTES: u64 = 1024 * 1024;
const MAX_PORTABLE_COMPONENT_BYTES: usize = 255;
const MAX_PORTABLE_RELATIVE_PATH_BYTES: usize = 240;

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

/// Preserve buffering across ZIP's current-position and local-header seeks.
/// The ZIP crate remains responsible for parsing and local-header validation.
pub(crate) struct ArchiveReader(BufReader<File>);
impl ArchiveReader {
    pub(crate) fn open(path: &Path) -> io::Result<Self> {
        Ok(Self(BufReader::with_capacity(
            128 * 1024,
            File::open(path)?,
        )))
    }
}
impl Read for ArchiveReader {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        self.0.read(bytes)
    }
}
impl Seek for ArchiveReader {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        let offset = match position {
            SeekFrom::Current(offset) => Some(offset),
            SeekFrom::Start(target) => {
                let current = self.0.stream_position()?;
                i64::try_from(i128::from(target) - i128::from(current)).ok()
            }
            SeekFrom::End(_) => None,
        };
        if let Some(offset) = offset {
            self.0.seek_relative(offset)?;
            self.0.stream_position()
        } else {
            self.0.seek(position)
        }
    }
    fn stream_position(&mut self) -> io::Result<u64> {
        self.0.stream_position()
    }
}

/// Opt-in debug diagnostics contain only static phase names and counters.
pub(crate) struct ArchiveTiming {
    start: Option<std::time::Instant>,
    phase: &'static str,
    pub(crate) entries: usize,
    pub(crate) evidence: usize,
    pub(crate) raw_reads: usize,
    assignments: usize,
    pub(crate) bytes: u64,
}
impl ArchiveTiming {
    pub(crate) fn new(phase: &'static str) -> Self {
        Self {
            start: (cfg!(debug_assertions)
                && std::env::var_os("VESTA_ARCHIVE_TIMING").is_some_and(|value| value == "1"))
            .then(std::time::Instant::now),
            phase,
            entries: 0,
            evidence: 0,
            raw_reads: 0,
            assignments: 0,
            bytes: 0,
        }
    }
}
impl Drop for ArchiveTiming {
    fn drop(&mut self) {
        if let Some(start) = self.start {
            eprintln!(
                "vesta-archive phase={} ms={:.3} entries={} raw_reads={} evidence={} bytes={} ownership_assignments={}",
                self.phase,
                start.elapsed().as_secs_f64() * 1000.0,
                self.entries,
                self.raw_reads,
                self.evidence,
                self.bytes,
                self.assignments
            );
        }
    }
}

/// Validated central metadata and bounded evidence, shared with manual drops.
pub(crate) struct WorldArchiveEntry {
    pub(crate) path: PathBuf,
    pub(crate) size: u64,
    pub(crate) directory: bool,
    pub(crate) level: Option<level_dat::LevelDat>,
    pub(crate) icon: Option<String>,
}

/// Central-name lookup only; does not open any payload or embedded archive.
pub(crate) fn world_icon_entry<R: Read + Seek>(archive: &ZipArchive<R>, path: &Path) -> bool {
    if !path.file_name().is_some_and(|name| name == "icon.png") || is_wrapper_noise(path) {
        return false;
    }
    let root = path.parent().unwrap_or(Path::new(""));
    ["level.dat", "level.dat_old"].iter().any(|marker| {
        root.join(marker)
            .to_str()
            .is_some_and(|name| archive.index_for_name(name).is_some())
    })
}

pub(crate) fn archive_icon(bytes: &[u8]) -> Option<String> {
    let dimensions = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()
        .and_then(|reader| reader.into_dimensions().ok());
    dimensions
        .filter(|(width, height)| *width <= 4096 && *height <= 4096)
        .map(|_| {
            let mime = crate::utils::image::detect_image_mime(bytes);
            format!(
                "data:{mime};base64,{}",
                general_purpose::STANDARD.encode(bytes)
            )
        })
}

#[derive(Default)]
struct WorldSummary {
    size: u64,
    primary: Option<level_dat::LevelDat>,
    backup: Option<level_dat::LevelDat>,
    icon: Option<String>,
}

/// Assign each entry once, walking its ancestors to find the deepest world.
/// No archive scans or payload reads are performed by this aggregation.
pub(crate) fn summarize_inventory(
    entries: &[WorldArchiveEntry],
    cancelled: &dyn Fn() -> bool,
) -> Result<ArchiveInspection, String> {
    let mut timing = ArchiveTiming::new("world-ownership-summaries");
    timing.entries = entries.len();
    let mut roots = BTreeSet::new();
    for entry in entries {
        if cancelled() {
            return Err("Resource inspection cancelled.".into());
        }
        if !entry.directory
            && !is_wrapper_noise(&entry.path)
            && entry
                .path
                .file_name()
                .is_some_and(|name| name == "level.dat" || name == "level.dat_old")
        {
            roots.insert(entry.path.parent().unwrap_or(Path::new("")).to_path_buf());
            if roots.len() > MAX_WORLD_CANDIDATES {
                return Err(format!(
                    "Archive contains more than {MAX_WORLD_CANDIDATES} Java worlds"
                ));
            }
        }
    }
    let mut summaries: BTreeMap<PathBuf, WorldSummary> = roots
        .into_iter()
        .map(|root| (root, WorldSummary::default()))
        .collect();
    for entry in entries {
        if cancelled() {
            return Err("Resource inspection cancelled.".into());
        }
        for owner in entry.path.ancestors() {
            if let Some(summary) = summaries.get_mut(owner) {
                timing.assignments += 1;
                summary.size = summary
                    .size
                    .checked_add(entry.size)
                    .ok_or("World size overflowed")?;
                let relative = entry.path.strip_prefix(owner).unwrap();
                if relative == Path::new("level.dat") {
                    summary.primary = entry.level.clone();
                } else if relative == Path::new("level.dat_old") {
                    summary.backup = entry.level.clone();
                } else if relative == Path::new("icon.png") {
                    summary.icon = entry.icon.clone();
                }
                break;
            }
        }
    }
    let roots: Vec<_> = summaries
        .into_iter()
        .enumerate()
        .map(|(index, (root, summary))| {
            let folder = root
                .file_name()
                .and_then(|name| name.to_str())
                .filter(|name| !name.is_empty())
                .unwrap_or("World")
                .to_string();
            let level = summary.primary.or(summary.backup);
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
            let summary = WorldArchiveCandidate {
                id: format!("candidate-{}", index + 1),
                name,
                folder,
                size_bytes: summary.size,
                game_version,
                data_version: level.and_then(|level| level.data_version),
                icon_data_url: summary.icon,
            };
            CandidateRoot { root, summary }
        })
        .collect();
    Ok(ArchiveInspection {
        candidates: roots.iter().map(|root| root.summary.clone()).collect(),
        roots,
    })
}

pub fn inspect_archive(
    archive_path: &Path,
    saves_directory: &Path,
) -> Result<ArchiveInspection, String> {
    let (inspection, declared_size) = inspect_archive_contents(archive_path)?;
    // Keep the existing full-source disk preflight for provider inspection.
    ensure_available_space(saves_directory, declared_size)?;
    Ok(inspection)
}

fn inspect_archive_contents(archive_path: &Path) -> Result<(ArchiveInspection, u64), String> {
    let mut timing = ArchiveTiming::new("world-index-evidence");
    let file = ArchiveReader::open(archive_path)
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
    let mut inventory = Vec::with_capacity(archive.len());
    let mut roots = HashSet::new();
    let mut declared_size = 0_u64;
    let mut declared_compressed_size = 0_u64;
    for index in 0..archive.len() {
        let path = safe_entry_path(archive.name_for_index(index).ok_or("Missing ZIP entry")?)?;
        let is_level = !is_wrapper_noise(&path)
            && path
                .file_name()
                .is_some_and(|name| name == "level.dat" || name == "level.dat_old");
        let is_icon = world_icon_entry(&archive, &path);
        // Delegate uncommon codecs to the existing decoded API for exactly the
        // same support/error behavior as before; common non-evidence is raw.
        let common_method = if is_level || is_icon {
            false
        } else {
            timing.raw_reads += 1;
            let raw = archive
                .by_index_raw(index)
                .map_err(|error| error.to_string())?;
            if raw.encrypted() || raw.get_metadata().aes_mode.is_some() {
                return Err("Encrypted ZIP entry.".into());
            }
            matches!(
                raw.compression(),
                zip::CompressionMethod::Stored | zip::CompressionMethod::Deflated
            )
        };
        let mut entry = if !is_level && !is_icon && common_method {
            timing.raw_reads += 1;
            archive.by_index_raw(index)
        } else {
            archive.by_index(index)
        }
        .map_err(|error| format!("Failed to inspect archive entry: {error}"))?;
        let folded = portable_collision_key(&path);
        if !normalized_names.insert(folded) {
            return Err(format!(
                "Archive contains colliding entry {}",
                path.display()
            ));
        }
        reject_unsupported_entry_kind(&entry, &path)?;
        declared_size = declared_size
            .checked_add(entry.size())
            .ok_or_else(|| "Archive expansion size overflowed".to_string())?;
        if declared_size > MAX_EXPANDED_BYTES {
            return Err("Archive declares an unreasonable expanded size".to_string());
        }
        declared_compressed_size = declared_compressed_size
            .checked_add(entry.compressed_size())
            .ok_or_else(|| "Archive compressed size overflowed".to_string())?;
        if entry.size() > 64 * 1024
            && (entry.compressed_size() == 0
                || entry.size() / entry.compressed_size().max(1) > MAX_COMPRESSION_RATIO)
        {
            return Err(format!(
                "Archive entry {} has a suspicious compression ratio",
                path.display()
            ));
        }
        let is_level = is_level && !entry.is_dir();
        let is_icon = is_icon && !entry.is_dir();
        if is_level {
            roots.insert(path.parent().unwrap_or(Path::new("")).to_path_buf());
            if roots.len() > MAX_WORLD_CANDIDATES {
                return Err(format!(
                    "Archive contains more than {MAX_WORLD_CANDIDATES} Java worlds"
                ));
            }
        }
        let capture = (is_level && entry.size() <= 16 * 1024 * 1024)
            || (is_icon && entry.size() <= MAX_ARCHIVE_ICON_BYTES);
        let size = entry.size();
        let directory = entry.is_dir();
        if directory && size != 0 {
            return Err("Archive directory contains file data.".into());
        }
        let mut bytes = Vec::new();
        if capture {
            (&mut entry)
                .take(size + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            if bytes.len() as u64 != size {
                return Err("Archive evidence expanded to an unexpected size".into());
            }
            timing.evidence += 1;
            timing.bytes += size;
        }
        inventory.push(WorldArchiveEntry {
            path,
            size,
            directory,
            level: if is_level && capture {
                level_dat::read_level_gzip_bytes(&bytes).ok()
            } else {
                None
            },
            icon: if is_icon && capture {
                archive_icon(&bytes)
            } else {
                None
            },
        });
    }
    if declared_size > 1024 * 1024
        && (declared_compressed_size == 0
            || declared_size / declared_compressed_size.max(1) > MAX_COMPRESSION_RATIO)
    {
        return Err("Archive has a suspicious aggregate compression ratio".to_string());
    }
    timing.entries = inventory.len();
    drop(timing);
    summarize_inventory(&inventory, &|| false).map(|inspection| (inspection, declared_size))
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
    // Publication checks selected bytes at their destination, rather than
    // requiring space for independent worlds/packs that were not selected.
    let (inspection, _) = inspect_archive_contents(archive_path)?;
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
    ensure_available_space(saves_directory, total)?;
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
        if let Err(error) = publish_directory_no_replace(&staged_world, &destination) {
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

#[cfg(target_os = "macos")]
fn publish_directory_no_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?;
    let destination = CString::new(destination.as_os_str().as_bytes())
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?;
    // SAFETY: both C strings live for the duration of the call and contain no NUL bytes.
    let result = unsafe {
        libc::renameatx_np(
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            destination.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
fn publish_directory_no_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let source = CString::new(source.as_os_str().as_bytes())
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?;
    let destination = CString::new(destination.as_os_str().as_bytes())
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidInput, error))?;
    // SAFETY: both C strings live for the duration of the call and contain no NUL bytes.
    let result = unsafe {
        libc::renameat2(
            libc::AT_FDCWD,
            source.as_ptr(),
            libc::AT_FDCWD,
            destination.as_ptr(),
            libc::RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn publish_directory_no_replace(source: &Path, destination: &Path) -> std::io::Result<()> {
    if destination.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "world destination already exists",
        ));
    }
    fs::rename(source, destination)
}

fn belongs_to_descendant_candidate(path: &Path, root: &Path, all_roots: &[PathBuf]) -> bool {
    all_roots.iter().any(|other| {
        other != root
            && other.starts_with(root)
            && path.starts_with(other)
            && !other.as_os_str().is_empty()
    })
}

pub(crate) fn safe_entry_path(name: &str) -> Result<PathBuf, String> {
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

    let path_without_directory_marker = name.strip_suffix('/').unwrap_or(name);
    if path_without_directory_marker.is_empty()
        || path_without_directory_marker.len() > MAX_PORTABLE_RELATIVE_PATH_BYTES
    {
        return Err(format!(
            "Archive path exceeds portable length limits: {name:?}"
        ));
    }
    for component in path_without_directory_marker.split('/') {
        validate_portable_component(component, name)?;
    }
    Ok(path)
}

fn validate_portable_component(component: &str, full_path: &str) -> Result<(), String> {
    if component.is_empty() || component == "." || component == ".." {
        return Err(format!("Archive contains unsafe path {full_path:?}"));
    }
    if component.len() > MAX_PORTABLE_COMPONENT_BYTES {
        return Err(format!(
            "Archive path component exceeds portable length limits: {full_path:?}"
        ));
    }
    if component.ends_with(['.', ' '])
        || component
            .chars()
            .any(|character| character.is_control() || r#"<>:"/\|?*"#.contains(character))
    {
        return Err(format!(
            "Archive path contains a Windows-incompatible component: {full_path:?}"
        ));
    }

    let stem = component
        .split('.')
        .next()
        .unwrap_or(component)
        .trim_end_matches(' ');
    let reserved_stem: String = stem.nfkc().flat_map(char::to_uppercase).collect();
    let is_reserved = matches!(
        reserved_stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CLOCK$" | "CONIN$" | "CONOUT$"
    ) || reserved_stem
        .strip_prefix("COM")
        .or_else(|| reserved_stem.strip_prefix("LPT"))
        .is_some_and(|suffix| {
            matches!(suffix, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
        });
    if is_reserved {
        return Err(format!(
            "Archive path contains a Windows-reserved component: {full_path:?}"
        ));
    }
    Ok(())
}

pub(crate) fn portable_collision_key(path: &Path) -> String {
    let normalized: String = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => value.to_str(),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
        .nfc()
        .case_fold()
        .collect();
    normalized.nfc().collect()
}

pub(crate) fn reject_unsupported_entry_kind<R: Read>(
    entry: &zip::read::ZipFile<'_, R>,
    path: &Path,
) -> Result<(), String> {
    if let Some(mode) = entry.unix_mode() {
        let kind = mode & 0o170000;
        let expected_kind = if entry.is_dir() { 0o040000 } else { 0o100000 };
        // Some ZIP writers store permission bits without Unix file-type bits.
        // Treat that portable representation as unspecified, while rejecting
        // every explicitly encoded special type.
        if kind != 0 && kind != expected_kind {
            return Err(format!(
                "Archive entry type is not allowed: {}",
                path.display()
            ));
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

pub(crate) fn ensure_available_space(destination: &Path, declared_size: u64) -> Result<(), String> {
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

    fn set_first_entry_unix_mode(path: &Path, mode: u32) {
        let mut bytes = fs::read(path).unwrap();
        let central_directory = bytes
            .windows(4)
            .position(|window| window == b"PK\x01\x02")
            .expect("central directory entry");
        bytes[central_directory + 5] = 3;
        bytes[central_directory + 38..central_directory + 42]
            .copy_from_slice(&(mode << 16).to_le_bytes());
        fs::write(path, bytes).unwrap();
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
    fn rejects_unicode_equivalent_collisions() {
        let (_temp, zip) = zip_with(&[
            ("World/Caf\u{e9}.txt", Vec::new()),
            ("World/Cafe\u{301}.txt", Vec::new()),
            ("World/level.dat", level_bytes("World")),
        ]);
        let saves = TempDir::new().unwrap();
        assert!(inspect_archive(&zip, saves.path())
            .unwrap_err()
            .contains("colliding entry"));
    }

    #[test]
    fn rejects_unicode_case_equivalent_collisions() {
        let (_temp, zip) = zip_with(&[
            ("World/Stra\u{df}e.dat", Vec::new()),
            ("World/STRASSE.dat", Vec::new()),
            ("World/level.dat", level_bytes("World")),
        ]);
        let saves = TempDir::new().unwrap();
        assert!(inspect_archive(&zip, saves.path())
            .unwrap_err()
            .contains("colliding entry"));
    }

    #[test]
    fn rejects_windows_reserved_and_ambiguous_components() {
        for name in [
            "World/CON.txt",
            "World/lpt9",
            "World/trailing. ",
            "World/trailing.",
            "World/has:colon.dat",
            "World/has?.dat",
            "World/back\\slash.dat",
            "World/CONIN$",
            "World//region.mca",
            "World/./region.mca",
        ] {
            let (_temp, zip) = zip_with(&[(name, Vec::new())]);
            let saves = TempDir::new().unwrap();
            assert!(
                inspect_archive(&zip, saves.path()).is_err(),
                "expected {name:?} to be rejected"
            );
        }
    }

    #[test]
    fn rejects_paths_beyond_portable_length_limits() {
        let long_component = format!("{}.dat", "a".repeat(MAX_PORTABLE_COMPONENT_BYTES));
        let long_path = format!("World/{long_component}");
        let (_temp, zip) = zip_with(&[(&long_path, Vec::new())]);
        let saves = TempDir::new().unwrap();
        assert!(inspect_archive(&zip, saves.path())
            .unwrap_err()
            .contains("portable length limits"));

        let long_path = format!("World/{}/file.dat", "a/".repeat(120));
        let (_temp, zip) = zip_with(&[(&long_path, Vec::new())]);
        assert!(inspect_archive(&zip, saves.path())
            .unwrap_err()
            .contains("portable length limits"));
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
    fn publish_never_replaces_a_world_created_after_preflight() {
        let (_temp, zip) = zip_with(&[("World/level.dat", level_bytes("World"))]);
        let saves = TempDir::new().unwrap();
        let inspection = inspect_archive(&zip, saves.path()).unwrap();
        let selected = vec![inspection.candidates[0].id.clone()];
        let destination = saves.path().join("World");
        let mut created = false;

        let error = install_archive(&zip, saves.path(), &selected, None, |_, _| {
            if !created {
                fs::create_dir(&destination).unwrap();
                fs::write(destination.join("owner.txt"), b"existing").unwrap();
                created = true;
            }
            Ok(())
        })
        .unwrap_err();

        assert!(error.contains("Failed to publish world"));
        assert_eq!(
            fs::read(destination.join("owner.txt")).unwrap(),
            b"existing"
        );
        assert!(!destination.join("level.dat").exists());
    }

    #[test]
    fn rejects_unreasonable_world_candidate_counts() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("many-worlds.zip");
        let file = File::create(&path).unwrap();
        let mut writer = ZipWriter::new(file);
        for index in 0..=MAX_WORLD_CANDIDATES {
            writer
                .start_file(
                    format!("World {index}/level.dat"),
                    SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
                )
                .unwrap();
            writer.write_all(&level_bytes("World")).unwrap();
        }
        writer.finish().unwrap();

        let saves = TempDir::new().unwrap();
        assert!(inspect_archive(&path, saves.path())
            .unwrap_err()
            .contains("Java worlds"));
    }

    #[test]
    fn rejects_suspicious_aggregate_compression_ratio() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("compressed.zip");
        let file = File::create(&path).unwrap();
        let mut writer = ZipWriter::new(file);
        writer
            .start_file(
                "World/level.dat",
                SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
            )
            .unwrap();
        writer.write_all(&level_bytes("World")).unwrap();
        for index in 0..32 {
            writer
                .start_file(
                    format!("World/region/bomb-{index}.mca"),
                    SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
                )
                .unwrap();
            writer.write_all(&vec![0_u8; 64 * 1024]).unwrap();
        }
        writer.finish().unwrap();

        let saves = TempDir::new().unwrap();
        assert!(inspect_archive(&path, saves.path())
            .unwrap_err()
            .contains("compression ratio"));
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
            .contains("entry type is not allowed"));
    }

    #[test]
    fn unix_special_file_entries_are_rejected() {
        let (_temp, zip) = zip_with(&[("World/fifo", Vec::new())]);
        set_first_entry_unix_mode(&zip, 0o010644);
        let saves = TempDir::new().unwrap();
        assert!(inspect_archive(&zip, saves.path())
            .unwrap_err()
            .contains("entry type is not allowed"));
    }

    #[test]
    fn regular_file_and_directory_entries_are_allowed() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("world.zip");
        let file = File::create(&path).unwrap();
        let mut writer = ZipWriter::new(file);
        writer
            .add_directory("World/", SimpleFileOptions::default())
            .unwrap();
        writer
            .start_file("World/level.dat", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(&level_bytes("World")).unwrap();
        writer.finish().unwrap();

        let saves = TempDir::new().unwrap();
        assert_eq!(
            inspect_archive(&path, saves.path())
                .unwrap()
                .candidates
                .len(),
            1
        );
    }

    #[test]
    fn entries_with_permissions_but_no_unix_type_are_allowed() {
        let (_temp, zip) = zip_with(&[("World/level.dat", level_bytes("World"))]);
        set_first_entry_unix_mode(&zip, 0o600);
        let saves = TempDir::new().unwrap();

        assert_eq!(
            inspect_archive(&zip, saves.path())
                .unwrap()
                .candidates
                .len(),
            1
        );
    }
    #[test]
    fn summaries_assign_descendants_once_and_preserve_ids_backup_and_icons() {
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(16, 16)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let parent_level = level_bytes("Parent");
        let child_level = level_bytes("Child");
        let parent_payload = vec![7; 100];
        let child_payload = vec![8; 200];
        let (temp, path) = zip_with(&[
            ("wrap/wrap/Parent/level.dat", b"bad NBT".to_vec()),
            ("wrap/wrap/Parent/level.dat_old", parent_level.clone()),
            ("wrap/wrap/Parent/icon.png", png.get_ref().clone()),
            ("wrap/wrap/Parent/region/a", parent_payload.clone()),
            ("wrap/wrap/Parent/Child/level.dat", child_level.clone()),
            ("wrap/wrap/Parent/Child/region/b", child_payload.clone()),
            ("wrap/wrap/Parent/Child/opaque.zip", b"not a ZIP".to_vec()),
            ("unowned/icon.png", b"invalid image".to_vec()),
        ]);
        let inspection = inspect_archive(&path, temp.path()).unwrap();
        assert_eq!(inspection.candidates.len(), 2);
        let parent = &inspection.candidates[0];
        let child = &inspection.candidates[1];
        assert_eq!(
            (&parent.id, &parent.name),
            (&"candidate-1".into(), &"Parent".into())
        );
        assert_eq!(
            (&child.id, &child.name),
            (&"candidate-2".into(), &"Child".into())
        );
        assert_eq!(
            parent.size_bytes,
            7 + parent_level.len() as u64 + png.get_ref().len() as u64 + 100
        );
        assert_eq!(child.size_bytes, child_level.len() as u64 + 200 + 9);
        assert_eq!(parent.data_version, Some(3465));
        assert!(parent
            .icon_data_url
            .as_ref()
            .unwrap()
            .starts_with("data:image/png;base64,"));
        assert!(child.icon_data_url.is_none());
        let saves = TempDir::new().unwrap();
        let installed = install_archive(
            &path,
            saves.path(),
            &[parent.id.clone(), child.id.clone()],
            None,
            |_, _| Ok(()),
        )
        .unwrap();
        assert!(!installed[0].path.join("Child").exists());
        assert_eq!(
            fs::read(installed[1].path.join("opaque.zip")).unwrap(),
            b"not a ZIP"
        );
    }

    #[test]
    fn provider_inspection_retains_supported_non_deflate_codecs() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("world.zip");
        let mut writer = zip::ZipWriter::new(File::create(&path).unwrap());
        for (name, bytes) in [
            ("World/level.dat", level_bytes("Bzip")),
            ("World/region/a", vec![7; 128]),
        ] {
            writer
                .start_file(
                    name,
                    zip::write::SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Bzip2),
                )
                .unwrap();
            writer.write_all(&bytes).unwrap();
        }
        writer.finish().unwrap();
        assert_eq!(
            inspect_archive(&path, temp.path()).unwrap().candidates[0].name,
            "Bzip"
        );
    }

    #[test]
    fn buffered_reader_retains_bytes_across_current_and_absolute_seeks() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("reader.bin");
        fs::write(&path, vec![7; 1024]).unwrap();
        let mut reader = ArchiveReader::open(&path).unwrap();
        let mut bytes = [0; 32];
        reader.read_exact(&mut bytes).unwrap();
        fs::write(&path, vec![8; 1024]).unwrap();
        assert_eq!(reader.seek(SeekFrom::Current(0)).unwrap(), 32);
        assert_eq!(reader.seek(SeekFrom::Start(16)).unwrap(), 16);
        reader.read_exact(&mut bytes).unwrap();
        assert_eq!(bytes, [7; 32]); // cached bytes, rather than a discarded buffer
        assert_eq!(reader.stream_position().unwrap(), 48);
    }
}
