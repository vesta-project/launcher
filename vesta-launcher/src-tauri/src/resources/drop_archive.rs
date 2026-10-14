//! Blocking manual-drop inspection. Private source snapshots are staged;
//! classification never extracts an archive tree or opens embedded ZIPs.
//! Enclosing folders are discovered at any portable depth.
//! Limits per operation: 50 sources, 4 GiB raw snapshots (2 GiB each), 8 GiB
//! streamed expansion and 100,000 entries. Selected mod JARs receive directory
//! preflight; ZIPs inside owned resources remain opaque payloads.
//! Rooted ZIPs retain their bytes; wrappers are normalized only on preparation.
//! Stored/Deflated UTF-8 ZIPs are accepted; split archives and trailing data
//! are rejected. This module does not apply resources or import modpacks.
use crate::worlds::archive::{
    archive_icon, ensure_available_space, portable_collision_key, reject_unsupported_entry_kind,
    safe_entry_path, summarize_inventory, world_icon_entry, ArchiveReader, ArchiveTiming,
    WorldArchiveCandidate, WorldArchiveEntry,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tempfile::{NamedTempFile, TempDir};
use zip::read::HasZipMetadata;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

const MAX_SOURCES: usize = 50;
const MAX_SOURCE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_RAW_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_EXPANDED_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_ENTRIES: usize = 100_000;
const MAX_CENTRAL_DIRECTORY_BYTES: u64 = 64 * 1024 * 1024;
const MAX_CANDIDATES: usize = 256;
const MAX_RATIO: u64 = 500;
const MAX_METADATA_BYTES: u64 = 1024 * 1024;
const MAX_TOTAL_METADATA_BYTES: u64 = 8 * 1024 * 1024;
const MAX_JSON_DEPTH: usize = 32;
const MAX_JSON_NODES: usize = 100_000;
const MAX_WORLD_ROOTS: usize = 32;
const MAX_TOTAL_LEVEL_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DropKind {
    Mod,
    DataPack,
    ResourcePack,
    Shader,
    World,
    Modpack,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DropCandidate {
    pub id: String,
    pub name: String,
    pub kinds: Vec<DropKind>,
    pub world_candidates: Vec<WorldArchiveCandidate>,
}

/// Retains the private snapshots until every task sharing the inspection ends.
/// No original dropped path is retained or returned.
pub struct InspectedDrop {
    pub candidates: Vec<DropCandidate>,
    pub notes: Vec<String>,
    prepared: HashMap<String, Prepared>,
    _staging: TempDir,
    materialization_budget: Mutex<Budget>,
}

struct Prepared {
    source: PathBuf,
    name: String,
    kinds: Vec<DropKind>,
    plan: Plan,
    source_evidence: bool,
}

enum Plan {
    Copy,
    Pack { root: PathBuf, entries: Vec<Entry> },
    Jars(Vec<Entry>),
    World,
    Modpack,
}

#[derive(Clone)]
struct Entry {
    index: usize,
    path: PathBuf,
    size: u64,
    directory: bool,
}

struct Index {
    entries: Vec<Entry>,
    metadata: BTreeMap<PathBuf, Value>,
    readable_worlds: HashSet<PathBuf>,
    worlds: Vec<WorldArchiveEntry>,
}

#[derive(Default)]
struct Budget {
    raw: u64,
    expanded: u64,
    declared: u64,
    entries: usize,
    metadata: u64,
    level_metadata: u64,
}

impl Budget {
    fn read(&mut self, bytes: u64) -> Result<(), String> {
        self.expanded = self
            .expanded
            .checked_add(bytes)
            .ok_or("Archive size overflow")?;
        if self.expanded > MAX_EXPANDED_BYTES {
            return Err("Drop exceeds the cumulative expanded-byte limit.".into());
        }
        Ok(())
    }
}

pub fn inspect_paths(paths: Vec<PathBuf>) -> Result<InspectedDrop, String> {
    inspect_paths_with_cancel(paths, || false)
}

/// Cooperative cancellation aborts the entire inspection and cleans snapshots.
pub fn inspect_paths_with_cancel<F>(
    paths: Vec<PathBuf>,
    cancelled: F,
) -> Result<InspectedDrop, String>
where
    F: Fn() -> bool,
{
    let _timing = ArchiveTiming::new("drop-inspection");
    check_cancel(&cancelled)?;
    if paths.is_empty() || paths.len() > MAX_SOURCES {
        return Err("Drop between 1 and 50 .jar or .zip files.".into());
    }
    let staging = tempfile::Builder::new()
        .prefix("vesta-resource-drop-")
        .tempdir()
        .map_err(|_| "Could not create private drop staging.".to_string())?;
    let mut result = InspectedDrop {
        candidates: Vec::new(),
        notes: Vec::new(),
        prepared: HashMap::new(),
        _staging: staging,
        materialization_budget: Mutex::new(Budget::default()),
    };
    let mut budget = Budget::default();
    for (number, path) in paths.into_iter().enumerate() {
        check_cancel(&cancelled)?;
        // Failed sources have their own directory, so their snapshots cannot
        // accumulate on disk. Budgets still count failed inspection work.
        let directory = result._staging.path().join(format!("source-{number}"));
        fs::create_dir(&directory).map_err(|_| "Could not create source staging.".to_string())?;
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| safe_entry_path(name).is_ok())
            .unwrap_or("Dropped file")
            .to_string();
        let before = result.candidates.len();
        let inspected = snapshot_with_cancel(
            &path,
            &directory.join("source.zip"),
            &mut budget,
            &cancelled,
        )
        .and_then(|source| {
            inspect_snapshot(
                &source,
                &name,
                has_extension(&path, "jar"),
                &mut budget,
                &mut result,
                &cancelled,
            )
        });
        check_cancel(&cancelled)?;
        if inspected
            .as_ref()
            .is_err_and(|error| error == "Resource inspection cancelled.")
        {
            return Err("Resource inspection cancelled.".into());
        }
        match inspected {
            Ok(()) if result.candidates.len() > before => {}
            Ok(()) => {
                result
                    .notes
                    .push(format!("{name}: no supported resource layout found."));
                let _ = fs::remove_dir_all(&directory);
            }
            Err(error) => {
                for candidate in result.candidates.drain(before..) {
                    result.prepared.remove(&candidate.id);
                }
                result.notes.push(format!("{name}: {error}"));
                let _ = fs::remove_dir_all(&directory);
            }
        }
    }
    if result.candidates.is_empty() {
        return Err(result.notes.join("\n"));
    }
    result.materialization_budget = Mutex::new(budget);
    Ok(result)
}

fn check_cancel(cancelled: &dyn Fn() -> bool) -> Result<(), String> {
    if cancelled() {
        Err("Resource inspection cancelled.".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
fn snapshot(path: &Path, output: &Path, budget: &mut Budget) -> Result<PathBuf, String> {
    snapshot_with_cancel(path, output, budget, &|| false)
}

fn snapshot_with_cancel(
    path: &Path,
    output: &Path,
    budget: &mut Budget,
    cancelled: &dyn Fn() -> bool,
) -> Result<PathBuf, String> {
    let mut timing = ArchiveTiming::new("drop-snapshot");
    check_cancel(cancelled)?;
    if !path.is_absolute() {
        return Err("source must be an absolute path.".into());
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| "source is unreadable.")?;
    if !metadata.file_type().is_file() {
        return Err("source must be a regular file, never a symbolic link.".into());
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("source has an invalid filename.")?;
    safe_entry_path(name).map_err(|_| "source has an unsafe filename.")?;
    if !has_extension(path, "jar") && !has_extension(path, "zip") {
        return Err("only .jar and .zip files are supported.".into());
    }
    if metadata.len() == 0 || metadata.len() > MAX_SOURCE_BYTES {
        return Err("source is empty or exceeds the 2 GiB file limit.".into());
    }
    if budget.raw.saturating_add(metadata.len()) > MAX_RAW_BYTES {
        return Err("Drop exceeds the 4 GiB raw-source limit.".into());
    }
    ensure_available_space(output.parent().unwrap(), metadata.len())
        .map_err(|_| "Insufficient staging disk space.")?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // Open the reparse point itself rather than following a raced link.
        options.custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    let mut input = options
        .open(path)
        .map_err(|_| "source could not be opened safely.")?;
    let opened = input
        .metadata()
        .map_err(|_| "source could not be checked.")?;
    let after = fs::symlink_metadata(path).map_err(|_| "source changed during inspection.")?;
    if !opened.is_file() || !after.file_type().is_file() || opened.len() != metadata.len() {
        return Err("source changed during inspection.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if opened.dev() != after.dev() || opened.ino() != after.ino() {
            return Err("source changed during inspection.".into());
        }
    }
    let mut target = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(output)
        .map_err(|_| "Could not create source snapshot.")?;
    stream_exact(&mut input, &mut target, metadata.len(), |bytes| {
        check_cancel(cancelled)?;
        timing.bytes += bytes;
        budget.raw = budget
            .raw
            .checked_add(bytes)
            .ok_or("Source size overflow")?;
        if budget.raw > MAX_RAW_BYTES {
            return Err("Drop exceeds the raw-source limit.".into());
        }
        Ok(())
    })?;
    seal(output)?;
    Ok(output.to_path_buf())
}

fn seal(path: &Path) -> Result<(), String> {
    let mut permissions = fs::metadata(path)
        .map_err(|_| "Could not check staged archive.")?
        .permissions();
    permissions.set_readonly(true);
    fs::set_permissions(path, permissions).map_err(|_| "Could not protect staged archive.".into())
}

fn open_archive(path: &Path) -> Result<ZipArchive<ArchiveReader>, String> {
    let file = ArchiveReader::open(path).map_err(|_| "Could not read staged archive.")?;
    ZipArchive::new(file).map_err(|_| "File is not a supported ZIP archive.".into())
}

// zip indexes entries by decoded name, silently replacing exact duplicates.
// Preflight the footer/count and central-header lengths before it allocates
// that index; compare counts afterward so every central entry is accounted for.
// ZIP64 is supported, but split archives and trailing data are not.
fn preflight_directory(
    source: &Path,
    remaining_entries: usize,
    cancelled: &dyn Fn() -> bool,
) -> Result<usize, String> {
    let mut timing = ArchiveTiming::new("drop-central-preflight");
    const INVALID: &str = "Invalid or unsupported ZIP directory.";
    let file = File::open(source).map_err(|_| INVALID)?;
    let length = file.metadata().map_err(|_| INVALID)?.len();
    let mut file = BufReader::with_capacity(128 * 1024, file);
    let tail_length = length.min(65_535 + 22);
    file.seek(SeekFrom::End(-(tail_length as i64)))
        .map_err(|_| INVALID)?;
    let mut tail = vec![0; tail_length as usize];
    file.read_exact(&mut tail).map_err(|_| INVALID)?;
    let footer = (0..tail.len().saturating_sub(21))
        .rev()
        .find(|&index| {
            tail[index..index + 4] == *b"PK\x05\x06"
                && index + 22 + u16::from_le_bytes([tail[index + 20], tail[index + 21]]) as usize
                    == tail.len()
        })
        .ok_or(INVALID)?;
    let footer_position = length - tail_length + footer as u64;
    let footer = &tail[footer..];
    let u16_at =
        |bytes: &[u8], at: usize| u16::from_le_bytes(bytes[at..at + 2].try_into().unwrap());
    let u32_at =
        |bytes: &[u8], at: usize| u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap());
    let u64_at =
        |bytes: &[u8], at: usize| u64::from_le_bytes(bytes[at..at + 8].try_into().unwrap());
    if u16_at(footer, 4) != 0 || u16_at(footer, 6) != 0 || u16_at(footer, 8) != u16_at(footer, 10) {
        return Err(INVALID.into());
    }
    let mut count = u16_at(footer, 10) as u64;
    let mut directory_bytes = u32_at(footer, 12) as u64;
    let mut directory_end = footer_position;
    if count == u16::MAX as u64
        || directory_bytes == u32::MAX as u64
        || u32_at(footer, 16) == u32::MAX
    {
        let locator_position = footer_position.checked_sub(20).ok_or(INVALID)?;
        file.seek(SeekFrom::Start(locator_position))
            .map_err(|_| INVALID)?;
        let mut locator = [0; 20];
        file.read_exact(&mut locator).map_err(|_| INVALID)?;
        if locator[..4] != *b"PK\x06\x07" || u32_at(&locator, 4) != 0 || u32_at(&locator, 16) != 1 {
            return Err(INVALID.into());
        }
        let record_position = u64_at(&locator, 8);
        file.seek(SeekFrom::Start(record_position))
            .map_err(|_| INVALID)?;
        let mut record = [0; 56];
        file.read_exact(&mut record).map_err(|_| INVALID)?;
        if record[..4] != *b"PK\x06\x06"
            || u64_at(&record, 4) < 44
            || record_position
                .checked_add(12)
                .and_then(|position| position.checked_add(u64_at(&record, 4)))
                != Some(locator_position)
            || u32_at(&record, 16) != 0
            || u32_at(&record, 20) != 0
            || u64_at(&record, 24) != u64_at(&record, 32)
        {
            return Err(INVALID.into());
        }
        count = u64_at(&record, 32);
        directory_bytes = u64_at(&record, 40);
        directory_end = record_position;
    }
    if count > remaining_entries as u64 || directory_bytes > MAX_CENTRAL_DIRECTORY_BYTES {
        return Err("ZIP directory exceeds entry or metadata limits.".into());
    }
    let start = directory_end.checked_sub(directory_bytes).ok_or(INVALID)?;
    file.seek(SeekFrom::Start(start)).map_err(|_| INVALID)?;
    let mut position = start;
    for _ in 0..count {
        check_cancel(cancelled)?;
        timing.entries += 1;
        let mut header = [0; 46];
        file.read_exact(&mut header).map_err(|_| INVALID)?;
        if header[..4] != *b"PK\x01\x02" || u16_at(&header, 28) > 241 {
            return Err("Archive has an invalid or non-portable central entry.".into());
        }
        let variable_bytes =
            u16_at(&header, 28) as u64 + u16_at(&header, 30) as u64 + u16_at(&header, 32) as u64;
        let next = position
            .checked_add(46)
            .and_then(|position| position.checked_add(variable_bytes))
            .ok_or(INVALID)?;
        if next > directory_end {
            return Err(INVALID.into());
        }
        file.seek_relative(variable_bytes as i64)
            .map_err(|_| INVALID)?;
        position = next;
    }
    if position != directory_end {
        return Err(INVALID.into());
    }
    Ok(count as usize)
}

#[cfg(test)]
fn inspect_index(source: &Path, budget: &mut Budget) -> Result<Index, String> {
    inspect_index_with_evidence(source, budget, true)
}

fn inspect_index_with_evidence(
    source: &Path,
    budget: &mut Budget,
    evidence: bool,
) -> Result<Index, String> {
    inspect_index_cancellable(source, budget, evidence, &|| false)
}

fn inspect_index_cancellable(
    source: &Path,
    budget: &mut Budget,
    evidence: bool,
    cancelled: &dyn Fn() -> bool,
) -> Result<Index, String> {
    let mut timing = ArchiveTiming::new("drop-index-evidence");
    let count = preflight_directory(
        source,
        MAX_ENTRIES.saturating_sub(budget.entries),
        cancelled,
    )?;
    let mut archive = open_archive(source)?;
    if archive.len() != count {
        return Err("Archive contains duplicate or ambiguous entry names.".into());
    }
    budget.entries = budget
        .entries
        .checked_add(archive.len())
        .ok_or("Entry count overflow")?;
    if budget.entries > MAX_ENTRIES {
        return Err("Drop exceeds the cumulative 100,000-entry limit.".into());
    }
    let mut paths = HashMap::<String, (PathBuf, bool)>::new();
    let mut explicit = HashSet::new();
    let mut entries = Vec::with_capacity(archive.len());
    let mut metadata = BTreeMap::new();
    let mut readable_worlds = HashSet::new();
    let mut worlds = Vec::with_capacity(archive.len());
    let mut world_roots = HashSet::new();
    let mut declared = 0_u64;
    let mut compressed = 0_u64;
    for index in 0..archive.len() {
        check_cancel(cancelled)?;
        timing.entries += 1;
        let path = safe_entry_path(archive.name_for_index(index).ok_or("Missing ZIP entry")?)
            .map_err(|_| "Archive contains an unsafe or non-portable path.")?;
        let json = evidence
            && !noise(&path)
            && matches!(
                path.file_name().and_then(|n| n.to_str()),
                Some("pack.mcmeta" | "manifest.json" | "modrinth.index.json")
            );
        let level = evidence
            && !noise(&path)
            && matches!(
                path.file_name().and_then(|n| n.to_str()),
                Some("level.dat" | "level.dat_old")
            );
        let icon = evidence && !noise(&path) && world_icon_entry(&archive, &path);
        let mut entry = if json || level || icon {
            archive.by_index(index)
        } else {
            timing.raw_reads += 1;
            archive.by_index_raw(index)
        }
        .map_err(|_| "Encrypted or unsupported ZIP entry.")?;
        if entry.encrypted()
            || entry.get_metadata().aes_mode.is_some()
            || !matches!(
                entry.compression(),
                CompressionMethod::Stored | CompressionMethod::Deflated
            )
        {
            return Err("Encrypted or unsupported ZIP entry.".into());
        }
        let name = std::str::from_utf8(entry.name_raw())
            .map_err(|_| "Archive entry name is not UTF-8.")?;
        if entry.name() != name {
            return Err("Archive entry name has an ambiguous encoding.".into());
        }

        reject_unsupported_entry_kind(&entry, &path)
            .map_err(|_| "Archive contains a link or special file.")?;
        register_path(&path, entry.is_dir(), &mut paths, &mut explicit)?;
        declared = declared
            .checked_add(entry.size())
            .ok_or("Archive size overflow")?;
        compressed = compressed
            .checked_add(entry.compressed_size())
            .ok_or("Archive size overflow")?;
        budget.declared = budget
            .declared
            .checked_add(entry.size())
            .ok_or("Archive size overflow")?;
        if budget.declared > MAX_EXPANDED_BYTES {
            return Err("Drop exceeds the cumulative expanded-byte limit.".into());
        }
        if entry.size() > 64 * 1024 && excessive_ratio(entry.size(), entry.compressed_size()) {
            return Err("Archive has a suspicious compression ratio.".into());
        }
        if level && !entry.is_dir() {
            world_roots.insert(path.parent().unwrap_or(Path::new("")).to_path_buf());
            if world_roots.len() > MAX_WORLD_ROOTS {
                return Err("Archive contains more than 32 Java worlds.".into());
            }
        }
        if json {
            if entry.size() > MAX_METADATA_BYTES
                || budget.metadata.saturating_add(entry.size()) > MAX_TOTAL_METADATA_BYTES
            {
                return Err("Archive metadata exceeds the bounded JSON limit.".into());
            }
            budget.metadata += entry.size();
        }
        // level.dat is also bounded by the existing world's gzip/NBT parser.
        let capture = json
            || (icon && entry.size() <= 1024 * 1024)
            || (level && entry.size() <= 16 * 1024 * 1024);
        if level && capture {
            budget.level_metadata = budget.level_metadata.saturating_add(entry.size());
            if budget.level_metadata > MAX_TOTAL_LEVEL_BYTES {
                return Err("Drop exceeds the cumulative world metadata limit.".into());
            }
        }
        let mut bytes = Vec::new();
        if capture {
            bytes.reserve(entry.size() as usize);
        }
        let directory = entry.is_dir();
        let size = entry.size();
        // Classification reads bounded evidence only. Payload CRC/actual-size
        // validation happens when the selected resource is materialized.
        if capture {
            timing.evidence += 1;
            stream_exact(&mut entry, &mut bytes, size, |read| {
                check_cancel(cancelled)?;
                timing.bytes += read;
                budget.read(read)
            })?;
        }
        if directory && size != 0 {
            return Err("Archive directory contains file data.".into());
        }
        if json {
            let value: Value = serde_json::from_slice(&bytes)
                .map_err(|_| "Archive metadata is not valid bounded JSON.")?;
            check_json(&value, 0, &mut 0)?;
            metadata.insert(path.clone(), value);
        }
        let parsed_level = if level && capture {
            crate::worlds::level_dat::read_level_gzip_bytes(&bytes).ok()
        } else {
            None
        };
        if parsed_level.is_some() {
            readable_worlds.insert(path.parent().unwrap_or(Path::new("")).to_path_buf());
        }
        worlds.push(WorldArchiveEntry {
            path: path.clone(),
            size,
            directory,
            level: parsed_level,
            icon: if icon && capture {
                archive_icon(&bytes)
            } else {
                None
            },
        });
        entries.push(Entry {
            index,
            path,
            size,
            directory,
        });
    }
    if declared > 1024 * 1024 && excessive_ratio(declared, compressed) {
        return Err("Archive has a suspicious aggregate compression ratio.".into());
    }
    Ok(Index {
        entries,
        metadata,
        readable_worlds,
        worlds,
    })
}

// Implicit parent directories must have the same spelling and type too:
// `A/file` plus `a/other`, or a file `A` plus `A/child`, is not portable.
fn register_path(
    path: &Path,
    directory: bool,
    paths: &mut HashMap<String, (PathBuf, bool)>,
    explicit: &mut HashSet<String>,
) -> Result<(), String> {
    let key = portable_collision_key(path);
    if !explicit.insert(key) {
        return Err("Archive contains colliding entries.".into());
    }
    for ancestor in path.ancestors().filter(|p| !p.as_os_str().is_empty()) {
        let is_directory = ancestor != path || directory;
        let key = portable_collision_key(ancestor);
        if let Some((old, old_directory)) = paths.get(&key) {
            if old != ancestor || *old_directory != is_directory {
                return Err("Archive contains Unicode/case or file/directory collisions.".into());
            }
        } else {
            paths.insert(key, (ancestor.to_path_buf(), is_directory));
        }
    }
    Ok(())
}

fn excessive_ratio(expanded: u64, compressed: u64) -> bool {
    compressed == 0 || expanded > compressed.saturating_mul(MAX_RATIO)
}

fn check_json(value: &Value, depth: usize, nodes: &mut usize) -> Result<(), String> {
    *nodes += 1;
    if depth > MAX_JSON_DEPTH || *nodes > MAX_JSON_NODES {
        return Err("Archive metadata exceeds JSON depth or node limits.".into());
    }
    match value {
        Value::Array(values) => {
            for value in values {
                check_json(value, depth + 1, nodes)?;
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                check_json(value, depth + 1, nodes)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// Reads one extra byte at the boundary rather than trusting ZIP size headers.
/// Fully consuming the entry also forces the ZIP reader's CRC check.
fn stream_exact(
    reader: &mut impl Read,
    writer: &mut impl Write,
    expected: u64,
    mut account: impl FnMut(u64) -> Result<(), String>,
) -> Result<(), String> {
    let mut copied = 0_u64;
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let available =
            (expected.saturating_sub(copied).saturating_add(1)).min(buffer.len() as u64) as usize;
        let read = reader
            .read(&mut buffer[..available])
            .map_err(|_| "Archive or source could not be read completely.")?;
        if read == 0 {
            break;
        }
        account(read as u64)?;
        copied = copied
            .checked_add(read as u64)
            .ok_or("Stream size overflow")?;
        if copied > expected {
            return Err("Archive or source expanded beyond its declared size.".into());
        }
        writer
            .write_all(&buffer[..read])
            .map_err(|_| "Could not write prepared resource.")?;
    }
    if copied != expected {
        return Err("Archive or source has an unexpected size.".into());
    }
    writer
        .flush()
        .map_err(|_| "Could not flush prepared resource.".into())
}

fn noise(path: &Path) -> bool {
    path.components().any(|part| part.as_os_str() == "__MACOSX")
        || path.file_name().is_some_and(|name| name == ".DS_Store")
}
fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
}

fn inspect_snapshot(
    source: &Path,
    name: &str,
    jar: bool,
    budget: &mut Budget,
    result: &mut InspectedDrop,
    cancelled: &dyn Fn() -> bool,
) -> Result<(), String> {
    let before = result.candidates.len();
    let index = inspect_index_cancellable(source, budget, !jar, cancelled)?;
    let _timing = ArchiveTiming::new("drop-roots");
    if jar {
        return add_candidate(
            result,
            source,
            name,
            vec![DropKind::Mod],
            Vec::new(),
            Plan::Copy,
        );
    }
    let mut proposed = BTreeMap::<PathBuf, Vec<DropKind>>::new();
    // At an equal root, manifests take precedence over worlds, pack metadata
    // and shaders. Ancestors own all descendants regardless of marker type.
    for (path, value) in &index.metadata {
        check_cancel(cancelled)?;
        let marker = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if is_modpack(marker, value)? {
            proposed.insert(
                path.parent().unwrap_or(Path::new("")).to_path_buf(),
                vec![DropKind::Modpack],
            );
            check_root_count(proposed.len())?;
        }
    }
    let world_roots: BTreeSet<PathBuf> = index
        .entries
        .iter()
        .filter(|entry| {
            !entry.directory
                && !noise(&entry.path)
                && matches!(
                    entry.path.file_name().and_then(|n| n.to_str()),
                    Some("level.dat" | "level.dat_old")
                )
        })
        .map(|entry| entry.path.parent().unwrap_or(Path::new("")).to_path_buf())
        .collect();
    for root in &world_roots {
        check_cancel(cancelled)?;
        proposed
            .entry(root.clone())
            .or_insert_with(|| vec![DropKind::World]);
        check_root_count(proposed.len())?;
    }
    for (path, value) in &index.metadata {
        check_cancel(cancelled)?;
        if path.file_name().is_some_and(|name| name == "pack.mcmeta") {
            let root = path.parent().unwrap_or(Path::new(""));
            // A world's bundled metadata belongs to the world. It must not
            // create an independent DataPack selection.
            if proposed.iter().any(|(owner, _)| root.starts_with(owner)) {
                continue;
            }
            check_root_count(proposed.len() + 1)?;
            let pack = value
                .get("pack")
                .and_then(Value::as_object)
                .ok_or("pack.mcmeta has no valid pack object.")?;
            if pack
                .get("pack_format")
                .is_some_and(|v| v.as_u64().is_none())
            {
                return Err("pack.mcmeta has an invalid pack_format.".into());
            }
            let data = contains_folder(&index.entries, root, "data");
            let assets = contains_folder(&index.entries, root, "assets");
            let kinds = match (data, assets) {
                (true, false) => vec![DropKind::DataPack],
                (false, true) => vec![DropKind::ResourcePack],
                // Metadata alone does not establish the intended pack type.
                _ => vec![DropKind::DataPack, DropKind::ResourcePack],
            };
            proposed.entry(root.to_path_buf()).or_insert(kinds);
        }
    }
    for entry in index
        .entries
        .iter()
        .filter(|entry| !entry.directory && !noise(&entry.path))
    {
        if ["fsh", "vsh", "glsl", "csh", "gsh", "tcs", "tes"]
            .iter()
            .any(|ext| has_extension(&entry.path, ext))
        {
            let mut root = PathBuf::new();
            for part in entry.path.components() {
                if part.as_os_str() == "shaders" {
                    proposed
                        .entry(root)
                        .or_insert_with(|| vec![DropKind::Shader]);
                    check_root_count(proposed.len())?;
                    break;
                }
                root.push(part);
            }
        }
    }
    let mut proposed: Vec<_> = proposed.into_iter().collect();
    proposed.sort_by(|(a, _), (b, _)| {
        a.components()
            .count()
            .cmp(&b.components().count())
            .then_with(|| a.cmp(b))
    });
    let mut owners: Vec<(PathBuf, Vec<DropKind>)> = Vec::new();
    for (root, kinds) in proposed {
        check_cancel(cancelled)?;
        if !owners.iter().any(|(owner, _)| root.starts_with(owner)) {
            owners.push((root, kinds));
        }
    }
    let selected_worlds: HashSet<_> = world_roots
        .iter()
        .filter(|root| {
            owners
                .iter()
                .any(|(owner, kinds)| root.starts_with(owner) && kinds.contains(&DropKind::World))
        })
        .cloned()
        .collect();
    if !selected_worlds.is_empty() {
        if selected_worlds
            .iter()
            .any(|root| !index.readable_worlds.contains(root))
        {
            return Err(
                "Archive contains an unreadable Java world; level.dat or its backup must be valid."
                    .into(),
            );
        }
        // The existing installer is the authority for World candidate IDs and
        // selection. Keep its whole archive, including world-owned datapacks.
        let inspection = summarize_inventory(&index.worlds, cancelled)?;
        if inspection.candidates.len() != world_roots.len() {
            return Err("World archive contains ambiguous level.dat directory markers.".into());
        }
        let worlds: Vec<_> = world_roots
            .iter()
            .zip(inspection.candidates)
            .filter(|(root, _)| selected_worlds.contains(*root))
            .map(|(_, candidate)| candidate)
            .collect();
        if worlds.len() != selected_worlds.len() {
            return Err("World archive selection could not be validated.".into());
        }
        add_candidate(
            result,
            source,
            name,
            vec![DropKind::World],
            worlds,
            Plan::World,
        )?;
    }
    for (root, kinds) in &owners {
        check_cancel(cancelled)?;
        if kinds.contains(&DropKind::World) {
            continue;
        }
        let display_name = if root.as_os_str().is_empty() {
            name.to_string()
        } else {
            format!("{name} ({})", root.file_name().unwrap().to_string_lossy())
        };
        let plan = if kinds.contains(&DropKind::Modpack) {
            Plan::Modpack
        } else if root.as_os_str().is_empty() {
            Plan::Copy
        } else {
            Plan::Pack {
                root: root.clone(),
                entries: index
                    .entries
                    .iter()
                    .filter(|entry| entry.path.starts_with(root) && !noise(&entry.path))
                    .cloned()
                    .collect(),
            }
        };
        add_candidate_named(
            result,
            source,
            &display_name,
            name,
            kinds.clone(),
            Vec::new(),
            plan,
        )?;
    }
    let unowned = |entry: &&Entry| {
        !entry.directory
            && !noise(&entry.path)
            && !owners.iter().any(|(root, _)| entry.path.starts_with(root))
    };
    let jars: Vec<_> = index
        .entries
        .iter()
        .filter(unowned)
        .filter(|entry| has_extension(&entry.path, "jar"))
        .cloned()
        .collect();
    if !jars.is_empty() {
        add_candidate(
            result,
            source,
            name,
            vec![DropKind::Mod],
            Vec::new(),
            Plan::Jars(jars),
        )?;
    }
    if index
        .entries
        .iter()
        .filter(unowned)
        .any(|entry| has_extension(&entry.path, "zip"))
    {
        result.notes.push(format!(
            "{name}: unsupported embedded ZIP files were not inspected."
        ));
    }
    check_cancel(cancelled)?;
    if result.candidates.len() == before + 1 {
        let candidate = &result.candidates[before];
        let coherent = !candidate.kinds.contains(&DropKind::Mod)
            && !candidate.kinds.contains(&DropKind::Modpack)
            && (candidate.kinds != vec![DropKind::World] || candidate.world_candidates.len() == 1)
            && index.entries.iter().filter(unowned).all(|entry| {
                let name = entry
                    .path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                matches!(
                    name.as_str(),
                    "readme"
                        | "readme.txt"
                        | "readme.md"
                        | "license"
                        | "license.txt"
                        | "license.md"
                )
            });
        result
            .prepared
            .get_mut(&candidate.id)
            .unwrap()
            .source_evidence = coherent;
    }
    Ok(())
}

fn check_root_count(count: usize) -> Result<(), String> {
    if count > MAX_CANDIDATES {
        return Err("Archive contains too many independent resource roots.".into());
    }
    Ok(())
}

fn contains_folder(entries: &[Entry], root: &Path, folder: &str) -> bool {
    entries
        .iter()
        .filter(|entry| !noise(&entry.path))
        .any(|entry| {
            entry
                .path
                .strip_prefix(root)
                .ok()
                .and_then(|relative| relative.components().next())
                .is_some_and(|component| {
                    component.as_os_str() == folder
                        && (entry.directory || entry.path != root.join(folder))
                })
        })
}

fn is_modpack(marker: &str, value: &Value) -> Result<bool, String> {
    if marker == "modrinth.index.json" {
        if value.get("formatVersion").and_then(Value::as_u64) != Some(1)
            || value.get("game").and_then(Value::as_str) != Some("minecraft")
            || !value.get("files").is_some_and(Value::is_array)
            || !value.get("dependencies").is_some_and(Value::is_object)
        {
            return Err("Invalid Modrinth modpack manifest; use the modpack import flow.".into());
        }
        return Ok(true);
    }
    if marker == "manifest.json"
        && (value.get("manifestType").is_some()
            || (value.get("minecraft").is_some() && value.get("files").is_some()))
    {
        if value
            .get("manifestType")
            .and_then(Value::as_str)
            .is_some_and(|kind| kind != "minecraftModpack")
            || !value.get("minecraft").is_some_and(Value::is_object)
            || !value.get("files").is_some_and(Value::is_array)
        {
            return Err("Invalid CurseForge modpack manifest; use the modpack import flow.".into());
        }
        return Ok(true);
    }
    Ok(false)
}

fn add_candidate(
    result: &mut InspectedDrop,
    source: &Path,
    name: &str,
    kinds: Vec<DropKind>,
    worlds: Vec<WorldArchiveCandidate>,
    plan: Plan,
) -> Result<(), String> {
    add_candidate_named(result, source, name, name, kinds, worlds, plan)
}
fn add_candidate_named(
    result: &mut InspectedDrop,
    source: &Path,
    display_name: &str,
    file_name: &str,
    kinds: Vec<DropKind>,
    worlds: Vec<WorldArchiveCandidate>,
    plan: Plan,
) -> Result<(), String> {
    if result.candidates.len() >= MAX_CANDIDATES {
        return Err("Drop contains too many independent resources.".into());
    }
    let id = format!("drop-{}", result.candidates.len() + 1);
    result.candidates.push(DropCandidate {
        id: id.clone(),
        name: display_name.into(),
        kinds: kinds.clone(),
        world_candidates: worlds,
    });
    result.prepared.insert(
        id,
        Prepared {
            source: source.into(),
            name: file_name.into(),
            kinds,
            plan,
            source_evidence: false,
        },
    );
    Ok(())
}

impl InspectedDrop {
    /// Original immutable snapshot for a sole coherent resource in this source.
    /// Never supplies an outer archive identity for mods or mixed containers.
    pub fn source_evidence_path(&self, candidate_id: &str) -> Option<&Path> {
        let prepared = self.prepared.get(candidate_id)?;
        prepared
            .source_evidence
            .then_some(prepared.source.as_path())
    }

    pub fn materialize(
        &self,
        candidate_id: &str,
        kind: DropKind,
        output_directory: &Path,
    ) -> Result<Vec<PathBuf>, String> {
        let _timing = ArchiveTiming::new("drop-materialize");
        let prepared = self
            .prepared
            .get(candidate_id)
            .ok_or("Unknown dropped resource candidate.")?;
        if !prepared.kinds.contains(&kind) {
            return Err("Selected type does not belong to this resource candidate.".into());
        }
        if matches!(prepared.plan, Plan::Modpack) {
            return Err("Modpacks cannot be applied over an existing instance. Use the modpack import flow to create an instance.".into());
        }
        if matches!(prepared.plan, Plan::World) {
            return Ok(vec![prepared.source.clone()]);
        }
        fs::create_dir_all(output_directory)
            .map_err(|_| "Could not create preparation directory.")?;
        if !fs::symlink_metadata(output_directory)
            .map_err(|_| "Could not check preparation directory.")?
            .file_type()
            .is_dir()
        {
            return Err("Preparation output must be a directory, never a symbolic link.".into());
        }
        let mut published = Vec::new();
        let mut reserved = fs::read_dir(output_directory)
            .map_err(|_| "Could not inspect preparation directory.")?
            .map(|entry| {
                entry
                    .map(|entry| portable_collision_key(Path::new(&entry.file_name())))
                    .map_err(|_| "Could not inspect preparation directory.")
            })
            .collect::<Result<HashSet<_>, _>>()?;
        let mut budget = self
            .materialization_budget
            .lock()
            .map_err(|_| "Resource preparation is unavailable")?;
        let operation = (|| {
            match &prepared.plan {
                Plan::Copy => {
                    validate_payloads(&prepared.source, &mut budget)?;
                    let mut source = File::open(&prepared.source)
                        .map_err(|_| "Could not read source snapshot.")?;
                    let size = source
                        .metadata()
                        .map_err(|_| "Could not check source snapshot.")?
                        .len();
                    ensure_available_space(output_directory, size)
                        .map_err(|_| "Insufficient preparation disk space.")?;
                    let mut output = new_output(output_directory)?;
                    stream_exact(&mut source, output.as_file_mut(), size, |_| Ok(()))?;
                    published.push(publish(
                        output,
                        output_directory,
                        &prepared.name,
                        &mut reserved,
                    )?);
                }
                Plan::Jars(entries) => {
                    let mut archive = open_archive(&prepared.source)?;
                    ensure_available_space(
                        output_directory,
                        entries.iter().map(|entry| entry.size).sum(),
                    )
                    .map_err(|_| "Insufficient preparation disk space.")?;
                    for entry in entries {
                        let name = entry
                            .path
                            .file_name()
                            .and_then(|name| name.to_str())
                            .ok_or("Invalid mod filename.")?;
                        safe_entry_path(name).map_err(|_| "Invalid mod filename.")?;
                        if !has_extension(Path::new(name), "jar") {
                            return Err("Invalid mod filename.".into());
                        }
                        let mut input = archive
                            .by_index(entry.index)
                            .map_err(|_| "Could not read bundled mod.")?;
                        let mut output = new_output(output_directory)?;
                        stream_exact(&mut input, output.as_file_mut(), entry.size, |bytes| {
                            budget.read(bytes)
                        })?;
                        // Bound selected JAR directory allocation before the
                        // coordinator's ZIP validation; do not infer resources
                        // from incidental metadata or inflate its payload here.
                        inspect_index_with_evidence(output.path(), &mut budget, false)?;
                        published.push(publish(output, output_directory, name, &mut reserved)?);
                    }
                }
                Plan::Pack { root, entries } => {
                    ensure_available_space(
                        output_directory,
                        entries.iter().map(|entry| entry.size).sum(),
                    )
                    .map_err(|_| "Insufficient preparation disk space.")?;
                    let mut archive = open_archive(&prepared.source)?;
                    let mut output = new_output(output_directory)?;
                    {
                        let mut writer = ZipWriter::new(output.as_file_mut());
                        let options = SimpleFileOptions::default()
                            .compression_method(CompressionMethod::Deflated);
                        for entry in entries {
                            let relative = entry
                                .path
                                .strip_prefix(root)
                                .map_err(|_| "Invalid selected pack root.")?;
                            if relative.as_os_str().is_empty() {
                                continue;
                            }
                            let name = relative
                                .to_str()
                                .ok_or("Invalid normalized pack name.")?
                                .replace('\\', "/");
                            safe_entry_path(&name).map_err(|_| "Invalid normalized pack name.")?;
                            if entry.directory {
                                writer
                                    .add_directory(format!("{name}/"), options)
                                    .map_err(|_| "Could not write pack directory.")?;
                            } else {
                                writer
                                    .start_file(name, options)
                                    .map_err(|_| "Could not write pack file.")?;
                                let mut input = archive
                                    .by_index(entry.index)
                                    .map_err(|_| "Could not read pack file.")?;
                                stream_exact(&mut input, &mut writer, entry.size, |bytes| {
                                    budget.read(bytes)
                                })?;
                            }
                        }
                        writer
                            .finish()
                            .map_err(|_| "Could not finish normalized pack ZIP.")?;
                    }
                    published.push(publish(
                        output,
                        output_directory,
                        &prepared.name,
                        &mut reserved,
                    )?);
                }
                Plan::World | Plan::Modpack => unreachable!(),
            }
            Ok(())
        })();
        if let Err(error) = operation {
            for path in published {
                let _ = fs::remove_file(path);
            }
            return Err(error);
        }
        Ok(published)
    }
}

fn validate_payloads(source: &Path, budget: &mut Budget) -> Result<(), String> {
    let mut archive = open_archive(source)?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| "Could not validate archive payload")?;
        let size = entry.size();
        stream_exact(&mut entry, &mut io::sink(), size, |bytes| {
            budget.read(bytes)
        })?;
    }
    Ok(())
}

fn new_output(directory: &Path) -> Result<NamedTempFile, String> {
    tempfile::Builder::new()
        .prefix(".vesta-prepared-")
        .tempfile_in(directory)
        .map_err(|_| "Could not stage prepared resource.".into())
}
fn publish(
    mut file: NamedTempFile,
    directory: &Path,
    name: &str,
    reserved: &mut HashSet<String>,
) -> Result<PathBuf, String> {
    safe_entry_path(name).map_err(|_| "Invalid output filename.")?;
    file.as_file()
        .sync_all()
        .map_err(|_| "Could not flush prepared resource.")?;
    let stem = Path::new(name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or("Invalid output filename.")?;
    let extension = Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .ok_or("Missing resource extension.")?;
    // Cache portable names once per materialization rather than rescanning the
    // output directory for every jar in a large bundle.
    for number in 1..=10_000 {
        let candidate = if number == 1 {
            name.to_string()
        } else {
            let suffix = format!(" ({number}).{extension}");
            let mut stem = stem.to_string();
            while stem.len() + suffix.len() > 240 {
                stem.pop();
            }
            format!("{stem}{suffix}")
        };
        safe_entry_path(&candidate).map_err(|_| "Output filename exceeds portable limits.")?;
        let key = portable_collision_key(Path::new(&candidate));
        if !reserved.insert(key) {
            continue;
        }
        let destination = directory.join(candidate);
        match file.persist_noclobber(&destination) {
            Ok(_) => return Ok(destination),
            Err(error) if error.error.kind() == io::ErrorKind::AlreadyExists => file = error.file,
            Err(_) => return Err("Could not publish prepared resource.".into()),
        }
    }
    Err("No free output filename is available.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::worlds::archive::inspect_archive;
    use flate2::{write::GzEncoder, Compression};
    use std::io::Cursor;

    fn zip_bytes(entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
        zip_bytes_with(entries, CompressionMethod::Stored)
    }
    fn zip_bytes_with(entries: &[(&str, Vec<u8>)], method: CompressionMethod) -> Vec<u8> {
        let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            zip.start_file(
                *name,
                SimpleFileOptions::default()
                    .last_modified_time(zip::DateTime::default())
                    .compression_method(method),
            )
            .unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }
    fn source(directory: &TempDir, name: &str, entries: &[(&str, Vec<u8>)]) -> PathBuf {
        let path = directory.path().join(name);
        fs::write(&path, zip_bytes(entries)).unwrap();
        path
    }
    fn metadata() -> Vec<u8> {
        br#"{"pack":{"pack_format":15,"description":"A pack"}}"#.to_vec()
    }
    fn jar() -> Vec<u8> {
        zip_bytes(&[("META-INF/MANIFEST.MF", b"Manifest-Version: 1.0\n".to_vec())])
    }
    fn level(name: &str) -> Vec<u8> {
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
        let bytes = fastnbt::to_bytes(&Root {
            data: Data {
                level_name: name.into(),
                data_version: 3465,
            },
        })
        .unwrap();
        let mut gzip = GzEncoder::new(Vec::new(), Compression::default());
        gzip.write_all(&bytes).unwrap();
        gzip.finish().unwrap()
    }
    fn prepare(
        inspection: &InspectedDrop,
        index: usize,
        kind: DropKind,
        output: &Path,
    ) -> Vec<PathBuf> {
        inspection
            .materialize(&inspection.candidates[index].id, kind, output)
            .unwrap()
    }
    fn archive_names(path: &Path) -> Vec<String> {
        let mut archive = open_archive(path).unwrap();
        (0..archive.len())
            .map(|index| archive.by_index(index).unwrap().name().to_string())
            .collect()
    }
    #[test]
    fn classification_reads_evidence_only_and_publication_checks_payload_crc() {
        let temp = TempDir::new().unwrap();
        let payload = b"non-metadata payload".to_vec();
        let path = source(
            &temp,
            "pack.zip",
            &[
                ("pack.mcmeta", metadata()),
                ("assets/test/large.bin", payload.clone()),
            ],
        );
        let mut bytes = fs::read(&path).unwrap();
        let offset = bytes
            .windows(payload.len())
            .position(|window| window == payload)
            .unwrap();
        bytes[offset] ^= 1;
        fs::write(&path, bytes).unwrap();
        let inspected = inspect_paths(vec![path]).unwrap();
        assert_eq!(
            inspected.materialization_budget.lock().unwrap().expanded,
            metadata().len() as u64
        );
        let output = TempDir::new().unwrap();
        assert!(inspected
            .materialize(
                &inspected.candidates[0].id,
                DropKind::ResourcePack,
                output.path()
            )
            .is_err());
        assert_eq!(fs::read_dir(output.path()).unwrap().count(), 0);
    }

    #[test]
    fn jars_do_not_parse_incidental_resource_metadata() {
        let temp = TempDir::new().unwrap();
        let path = source(
            &temp,
            "mod.jar",
            &[
                ("manifest.json", b"not resource metadata".to_vec()),
                ("assets/test/data", vec![1]),
            ],
        );
        let inspected = inspect_paths(vec![path]).unwrap();
        assert_eq!(inspected.candidates[0].kinds, vec![DropKind::Mod]);
        let output = TempDir::new().unwrap();
        assert!(inspected
            .materialize(&inspected.candidates[0].id, DropKind::Mod, output.path())
            .is_ok());
    }

    #[test]
    fn public_contract_is_send_sync_and_serializes_camel_case() {
        fn send_sync<T: Send + Sync>() {}
        send_sync::<InspectedDrop>();
        assert_eq!(
            serde_json::to_string(&DropKind::DataPack).unwrap(),
            "\"dataPack\""
        );
        let candidate = DropCandidate {
            id: "id".into(),
            name: "name".into(),
            kinds: vec![DropKind::World],
            world_candidates: Vec::new(),
        };
        assert!(serde_json::to_value(candidate)
            .unwrap()
            .get("worldCandidates")
            .is_some());
    }

    #[test]
    fn identifies_all_resource_types_and_preserves_source_names() {
        let temp = TempDir::new().unwrap();
        let cases = [
            (
                "mod.JAR",
                vec![("META-INF/MANIFEST.MF", b"manifest".to_vec())],
                DropKind::Mod,
            ),
            (
                "data.ZIP",
                vec![
                    ("pack.mcmeta", metadata()),
                    ("data/test/function.mcfunction", b"say hi".to_vec()),
                ],
                DropKind::DataPack,
            ),
            (
                "assets.zip",
                vec![
                    ("pack.mcmeta", metadata()),
                    ("assets/test/textures/x.png", vec![1]),
                ],
                DropKind::ResourcePack,
            ),
            (
                "shader.zip",
                vec![("shaders/program.GLSL", b"void main() {}".to_vec())],
                DropKind::Shader,
            ),
            (
                "world.zip",
                vec![("level.dat", level("Named world"))],
                DropKind::World,
            ),
        ];
        for (name, entries, kind) in cases {
            let inspection = inspect_paths(vec![source(&temp, name, &entries)]).unwrap();
            assert_eq!(inspection.candidates.len(), 1);
            assert_eq!(inspection.candidates[0].name, name);
            assert_eq!(inspection.candidates[0].kinds, vec![kind]);
        }
    }

    #[test]
    fn normalizes_one_and_two_directory_wrappers() {
        for wrapper in ["Pack", "Download/Pack"] {
            let temp = TempDir::new().unwrap();
            let marker = format!("{wrapper}/pack.mcmeta");
            let data = format!("{wrapper}/data/test/a.json");
            let path = source(
                &temp,
                "original.zip",
                &[
                    (&marker, metadata()),
                    (&data, b"{}".to_vec()),
                    ("__MACOSX/noise", b"ignored".to_vec()),
                    ("readme.txt", b"outside".to_vec()),
                ],
            );
            let inspection = inspect_paths(vec![path]).unwrap();
            let output = TempDir::new().unwrap();
            let prepared = prepare(&inspection, 0, DropKind::DataPack, output.path());
            assert_eq!(prepared[0].file_name().unwrap(), "original.zip");
            assert_eq!(
                archive_names(&prepared[0]),
                vec!["pack.mcmeta", "data/test/a.json"]
            );
        }
    }

    #[test]
    fn wrapped_shader_normalizes_without_pack_metadata() {
        let temp = TempDir::new().unwrap();
        let path = source(
            &temp,
            "shaders.zip",
            &[("Download/Shader/shaders/composite.fsh", b"shader".to_vec())],
        );
        let inspection = inspect_paths(vec![path]).unwrap();
        let output = TempDir::new().unwrap();
        let prepared = prepare(&inspection, 0, DropKind::Shader, output.path());
        assert_eq!(archive_names(&prepared[0]), vec!["shaders/composite.fsh"]);
    }

    #[test]
    fn correctly_rooted_zip_and_individual_jar_preserve_exact_bytes() {
        let temp = TempDir::new().unwrap();
        for (name, entries, kind) in [
            (
                "pack.zip",
                vec![
                    ("pack.mcmeta", metadata()),
                    ("assets/test/item.json", b"{}".to_vec()),
                    (".DS_Store", vec![1]),
                ],
                DropKind::ResourcePack,
            ),
            ("mod.jar", vec![("mod.class", vec![1, 2, 3])], DropKind::Mod),
        ] {
            let path = source(&temp, name, &entries);
            let original = fs::read(&path).unwrap();
            let inspection = inspect_paths(vec![path]).unwrap();
            let output = TempDir::new().unwrap();
            let prepared = prepare(&inspection, 0, kind, output.path());
            assert_eq!(fs::read(&prepared[0]).unwrap(), original);
        }
    }

    #[test]
    fn dual_and_metadata_only_packs_require_a_type_selection() {
        let temp = TempDir::new().unwrap();
        for entries in [
            vec![("pack.mcmeta", metadata())],
            vec![
                ("pack.mcmeta", metadata()),
                ("assets/test/a", vec![1]),
                ("data/test/a", vec![2]),
            ],
        ] {
            let path = source(&temp, "pack.zip", &entries);
            let inspection = inspect_paths(vec![path]).unwrap();
            assert_eq!(
                inspection.candidates[0].kinds,
                vec![DropKind::DataPack, DropKind::ResourcePack]
            );
            let output = TempDir::new().unwrap();
            assert!(inspection
                .materialize(
                    &inspection.candidates[0].id,
                    DropKind::Shader,
                    output.path()
                )
                .is_err());
            assert!(inspection
                .materialize("unknown", DropKind::DataPack, output.path())
                .is_err());
        }
    }

    #[test]
    fn mixed_independent_roots_and_loose_mods_are_separate_candidates() {
        let temp = TempDir::new().unwrap();
        let path = source(
            &temp,
            "collection.zip",
            &[
                ("A/pack.mcmeta", metadata()),
                ("A/data/test/a", vec![1]),
                ("B/pack.mcmeta", metadata()),
                ("B/assets/test/a", vec![2]),
                ("C/shaders/main.vsh", vec![3]),
                ("mods/mod.jar", jar()),
                ("readme.txt", vec![4]),
            ],
        );
        let inspection = inspect_paths(vec![path]).unwrap();
        assert_eq!(inspection.candidates.len(), 4);
        let output = TempDir::new().unwrap();
        for (candidate_index, kind, names) in [
            (0, DropKind::DataPack, vec!["pack.mcmeta", "data/test/a"]),
            (
                1,
                DropKind::ResourcePack,
                vec!["pack.mcmeta", "assets/test/a"],
            ),
            (2, DropKind::Shader, vec!["shaders/main.vsh"]),
        ] {
            let prepared = prepare(&inspection, candidate_index, kind, output.path());
            assert_eq!(archive_names(&prepared[0]), names);
        }
        let mods = prepare(&inspection, 3, DropKind::Mod, output.path());
        assert_eq!(fs::read(&mods[0]).unwrap(), jar());
    }

    #[test]
    fn bundle_allows_readme_noise_and_safely_renames_matching_basenames() {
        let temp = TempDir::new().unwrap();
        let path = source(
            &temp,
            "mods.zip",
            &[
                ("a/mod.jar", jar()),
                ("b/MOD.JAR", jar()),
                ("readme.md", vec![1]),
            ],
        );
        let inspection = inspect_paths(vec![path]).unwrap();
        let output = TempDir::new().unwrap();
        fs::write(output.path().join("mod.jar"), b"existing").unwrap();
        let prepared = prepare(&inspection, 0, DropKind::Mod, output.path());
        assert_eq!(prepared.len(), 2);
        assert_ne!(prepared[0], prepared[1]);
        assert_eq!(prepared[0].file_name().unwrap(), "mod (2).jar");
        assert_eq!(prepared[1].file_name().unwrap(), "MOD (3).JAR");
        assert_eq!(
            fs::read(output.path().join("mod.jar")).unwrap(),
            b"existing"
        );
        for path in prepared {
            assert_eq!(fs::read(path).unwrap(), jar());
        }
    }

    #[test]
    fn worlds_group_candidates_and_own_nested_datapacks_and_jars() {
        let temp = TempDir::new().unwrap();
        let path = source(
            &temp,
            "worlds.zip",
            &[
                ("One/level.dat", level("One")),
                ("One/datapacks/test/pack.mcmeta", metadata()),
                ("One/datapacks/test/data/test/a", vec![1]),
                ("One/datapacks/inner.zip", b"world-owned payload".to_vec()),
                ("One/nested.jar", jar()),
                ("Two/level.dat", level("Two")),
            ],
        );
        let original = fs::read(&path).unwrap();
        let inspection = inspect_paths(vec![path]).unwrap();
        assert_eq!(inspection.candidates.len(), 1);
        assert_eq!(inspection.candidates[0].kinds, vec![DropKind::World]);
        assert_eq!(inspection.candidates[0].world_candidates.len(), 2);
        let unused_output = temp.path().join("unused");
        let prepared = prepare(&inspection, 0, DropKind::World, &unused_output);
        assert!(!unused_output.exists());
        assert_eq!(fs::read(&prepared[0]).unwrap(), original);
        let saves = TempDir::new().unwrap();
        let selection = inspection.candidates[0]
            .world_candidates
            .iter()
            .map(|candidate| candidate.id.clone())
            .collect::<Vec<_>>();
        let installed = crate::worlds::archive::install_archive(
            &prepared[0],
            saves.path(),
            &selection,
            None,
            |_, _| Ok(()),
        )
        .unwrap();
        assert_eq!(installed.len(), 2);
        assert!(saves
            .path()
            .join("One/datapacks/test/data/test/a")
            .is_file());
    }

    #[test]
    fn root_world_and_descendant_world_remain_one_group() {
        let temp = TempDir::new().unwrap();
        let path = source(
            &temp,
            "worlds.zip",
            &[
                ("level.dat", level("Root")),
                ("child/level.dat", level("Child")),
            ],
        );
        let inspection = inspect_paths(vec![path]).unwrap();
        assert_eq!(inspection.candidates.len(), 1);
        assert_eq!(inspection.candidates[0].world_candidates.len(), 2);
    }

    #[test]
    fn rejects_unreadable_world_but_accepts_valid_backup() {
        let temp = TempDir::new().unwrap();
        let bad = source(&temp, "bad.zip", &[("level.dat", b"bad".to_vec())]);
        assert!(inspect_paths(vec![bad]).is_err());
        let backup = source(
            &temp,
            "backup.zip",
            &[
                ("level.dat", b"bad".to_vec()),
                ("level.dat_old", level("Recovered")),
            ],
        );
        let inspection = inspect_paths(vec![backup]).unwrap();
        assert_eq!(
            inspection.candidates[0].world_candidates[0].name,
            "Recovered"
        );
    }

    #[test]
    fn modpack_guard_takes_precedence_over_loose_jars_and_wrappers() {
        let temp = TempDir::new().unwrap();
        for (wrapper, marker, manifest) in [
            ("", "manifest.json", br#"{"manifestType":"minecraftModpack","minecraft":{"version":"1.20"},"files":[]}"#.to_vec()),
            ("download/pack/", "modrinth.index.json", br#"{"formatVersion":1,"game":"minecraft","files":[],"dependencies":{"minecraft":"1.20"}}"#.to_vec()),
        ] {
            let manifest_path = format!("{wrapper}{marker}");
            let jar_path = format!("{wrapper}overrides/mods/mod.jar");
            let path = source(&temp, "modpack.zip", &[(&manifest_path, manifest), (&jar_path, jar())]);
            let inspection = inspect_paths(vec![path]).unwrap();
            assert_eq!(inspection.candidates.len(), 1);
            assert_eq!(inspection.candidates[0].kinds, vec![DropKind::Modpack]);
            let error = inspection.materialize(&inspection.candidates[0].id, DropKind::Modpack, temp.path()).unwrap_err();
            assert!(error.contains("existing instance"));
        }
        let malformed = source(
            &temp,
            "bad.zip",
            &[
                ("modrinth.index.json", br#"{"files":[]}"#.to_vec()),
                ("mod.jar", jar()),
            ],
        );
        assert!(inspect_paths(vec![malformed]).is_err());
    }

    #[test]
    fn jars_are_not_recursed_into() {
        let temp = TempDir::new().unwrap();
        let embedded = zip_bytes(&[("pack.zip", b"not a zip".to_vec())]);
        let path = source(&temp, "bundle.zip", &[("mod.jar", embedded)]);
        let inspection = inspect_paths(vec![path]).unwrap();
        assert_eq!(inspection.candidates[0].kinds, vec![DropKind::Mod]);
        let jar_path = temp.path().join("individual.jar");
        fs::write(
            &jar_path,
            zip_bytes(&[("inner.zip", b"not a zip".to_vec())]),
        )
        .unwrap();
        assert!(inspect_paths(vec![jar_path]).is_ok());
    }

    #[test]
    fn metadata_size_depth_and_cumulative_limits_are_bounded() {
        let temp = TempDir::new().unwrap();
        let huge = source(
            &temp,
            "large.zip",
            &[("pack.mcmeta", vec![b' '; MAX_METADATA_BYTES as usize + 1])],
        );
        assert!(inspect_paths(vec![huge])
            .err()
            .unwrap()
            .contains("JSON limit"));
        let deep = format!(
            "{}0{}",
            "[".repeat(MAX_JSON_DEPTH + 1),
            "]".repeat(MAX_JSON_DEPTH + 1)
        );
        let path = source(&temp, "deep.zip", &[("pack.mcmeta", deep.into_bytes())]);
        assert!(inspect_paths(vec![path]).err().unwrap().contains("depth"));
        let path = source(&temp, "pack.zip", &[("pack.mcmeta", metadata())]);
        let mut budget = Budget {
            metadata: MAX_TOTAL_METADATA_BYTES,
            ..Budget::default()
        };
        assert!(inspect_index(&path, &mut budget)
            .err()
            .unwrap()
            .contains("JSON limit"));
        let malformed = source(&temp, "malformed.zip", &[("pack.mcmeta", b"{".to_vec())]);
        assert!(inspect_paths(vec![malformed]).is_err());
        let invalid_pack = source(&temp, "invalid.zip", &[("pack.mcmeta", b"{}".to_vec())]);
        assert!(inspect_paths(vec![invalid_pack]).is_err());
    }

    #[test]
    fn rejects_invalid_traversal_absolute_and_collision_archives_even_when_rooted() {
        let temp = TempDir::new().unwrap();
        for bad in [
            "../escape",
            "/absolute",
            "C:/absolute",
            "folder/back\\slash",
            "folder/CON",
            "a//b",
        ] {
            let path = source(
                &temp,
                "unsafe.zip",
                &[("pack.mcmeta", metadata()), (bad, vec![1])],
            );
            assert!(inspect_paths(vec![path]).is_err(), "{bad}");
        }
        for (a, b) in [
            ("A.txt", "a.txt"),
            ("Café", "Cafe\u{301}"),
            ("Straße", "STRASSE"),
            ("A/a", "a/b"),
            ("file", "file/child"),
        ] {
            let path = source(
                &temp,
                "collision.zip",
                &[("pack.mcmeta", metadata()), (a, vec![1]), (b, vec![2])],
            );
            assert!(inspect_paths(vec![path]).is_err(), "{a} / {b}");
        }
        let invalid = temp.path().join("invalid.zip");
        fs::write(&invalid, b"not zip").unwrap();
        assert!(inspect_paths(vec![invalid]).is_err());
    }

    fn central_headers(bytes: &[u8]) -> Vec<usize> {
        // Fixture archives are small, non-ZIP64 and have no footer comment.
        // Follow the outer directory rather than matching signatures inside JARs.
        let footer = bytes.len() - 22;
        assert_eq!(&bytes[footer..footer + 4], b"PK\x05\x06");
        let count = u16::from_le_bytes(bytes[footer + 10..footer + 12].try_into().unwrap());
        let mut position =
            u32::from_le_bytes(bytes[footer + 16..footer + 20].try_into().unwrap()) as usize;
        let mut headers = Vec::new();
        for _ in 0..count {
            assert_eq!(&bytes[position..position + 4], b"PK\x01\x02");
            headers.push(position);
            let variable: usize = [28, 30, 32]
                .into_iter()
                .map(|offset| {
                    u16::from_le_bytes(
                        bytes[position + offset..position + offset + 2]
                            .try_into()
                            .unwrap(),
                    ) as usize
                })
                .sum();
            position += 46 + variable;
        }
        headers
    }

    fn patch_central(path: &Path, offset: usize, bytes: &[u8]) {
        let mut archive = fs::read(path).unwrap();
        let central = central_headers(&archive)[0];
        archive[central + offset..central + offset + bytes.len()].copy_from_slice(bytes);
        fs::write(path, archive).unwrap();
    }

    #[test]
    fn bundled_jars_receive_bounded_directory_validation_only_when_selected() {
        let temp = TempDir::new().unwrap();
        let path = source(
            &temp,
            "mods.zip",
            &[
                ("valid.jar", jar()),
                ("unsafe.jar", zip_bytes(&[("../escaped", b"data".to_vec())])),
            ],
        );
        let inspected = inspect_paths(vec![path]).unwrap();
        assert_eq!(inspected.candidates[0].kinds, vec![DropKind::Mod]);
        assert_eq!(inspected.materialization_budget.lock().unwrap().expanded, 0);
        let output = TempDir::new().unwrap();
        assert!(inspected
            .materialize(&inspected.candidates[0].id, DropKind::Mod, output.path())
            .unwrap_err()
            .contains("unsafe"));
        assert_eq!(fs::read_dir(output.path()).unwrap().count(), 0);
    }

    #[test]
    fn central_directory_preflight_rejects_hidden_exact_duplicates_and_oversized_counts() {
        let temp = TempDir::new().unwrap();
        let path = source(
            &temp,
            "duplicate.zip",
            &[("a.jar", jar()), ("b.jar", jar())],
        );
        let mut bytes = fs::read(&path).unwrap();
        let central = central_headers(&bytes);
        bytes[central[1] + 46] = b'a';
        fs::write(&path, bytes).unwrap();
        assert!(inspect_paths(vec![path])
            .err()
            .unwrap()
            .contains("duplicate"));

        let path = source(&temp, "count.zip", &[("pack.mcmeta", metadata())]);
        let mut bytes = fs::read(&path).unwrap();
        let footer = bytes.len() - 22;
        bytes[footer + 8..footer + 12].copy_from_slice(&[0xff; 4]);
        fs::write(&path, bytes).unwrap();
        assert!(inspect_paths(vec![path]).is_err());
    }

    #[test]
    fn world_group_and_independent_pack_keep_distinct_ownership() {
        let temp = TempDir::new().unwrap();
        let path = source(
            &temp,
            "mixed.zip",
            &[
                ("World/level.dat", level("World")),
                ("World/datapacks/Bundled/pack.mcmeta", metadata()),
                ("Separate/pack.mcmeta", metadata()),
                ("Separate/assets/test/a", vec![1]),
            ],
        );
        let inspection = inspect_paths(vec![path]).unwrap();
        assert_eq!(inspection.candidates.len(), 2);
        assert_eq!(inspection.candidates[0].kinds, vec![DropKind::World]);
        assert_eq!(inspection.candidates[1].kinds, vec![DropKind::ResourcePack]);
    }

    #[test]
    fn explicit_wrapper_directories_are_normalized_without_empty_root_entries() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("pack.zip");
        let mut writer = ZipWriter::new(File::create(&path).unwrap());
        writer
            .add_directory("Wrapper/", SimpleFileOptions::default())
            .unwrap();
        writer
            .add_directory("Wrapper/data/", SimpleFileOptions::default())
            .unwrap();
        writer
            .start_file("Wrapper/pack.mcmeta", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(&metadata()).unwrap();
        writer.finish().unwrap();
        let inspection = inspect_paths(vec![path]).unwrap();
        let output = TempDir::new().unwrap();
        assert_eq!(
            archive_names(&prepare(&inspection, 0, DropKind::DataPack, output.path())[0]),
            vec!["data/", "pack.mcmeta"]
        );
    }

    #[test]
    fn raw_per_file_limit_rejects_large_sparse_sources_before_reading() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("large.zip");
        let file = File::create(&path).unwrap();
        file.set_len(MAX_SOURCE_BYTES + 1).unwrap();
        assert!(inspect_paths(vec![path]).err().unwrap().contains("2 GiB"));
    }

    #[test]
    fn rejects_links_special_files_encryption_and_unsupported_compression() {
        let temp = TempDir::new().unwrap();
        for mode in [0o120777_u32, 0o010644, 0o060644, 0o020644] {
            let path = source(&temp, "unsafe.zip", &[("pack.mcmeta", metadata())]);
            patch_central(&path, 5, &[3]);
            patch_central(&path, 38, &(mode << 16).to_le_bytes());
            assert!(inspect_paths(vec![path]).is_err());
        }
        let encrypted = source(&temp, "encrypted.zip", &[("pack.mcmeta", metadata())]);
        patch_central(&encrypted, 8, &1_u16.to_le_bytes());
        assert!(inspect_paths(vec![encrypted]).is_err());
        let unsupported = source(&temp, "unsupported.zip", &[("pack.mcmeta", metadata())]);
        patch_central(&unsupported, 10, &99_u16.to_le_bytes());
        assert!(inspect_paths(vec![unsupported]).is_err());
    }

    #[test]
    fn rejects_zip_bombs_and_corrupted_payloads_by_actual_reads() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("bomb.zip");
        fs::write(
            &path,
            zip_bytes_with(
                &[
                    ("pack.mcmeta", metadata()),
                    ("data/test/bomb", vec![0; 2 * 1024 * 1024]),
                ],
                CompressionMethod::Deflated,
            ),
        )
        .unwrap();
        assert!(inspect_paths(vec![path])
            .err()
            .unwrap()
            .contains("compression ratio"));
        let path = source(&temp, "corrupt.zip", &[("pack.mcmeta", metadata())]);
        let mut bytes = fs::read(&path).unwrap();
        let payload = bytes
            .windows(metadata().len())
            .position(|window| window == metadata())
            .unwrap();
        bytes[payload] ^= 1;
        fs::write(&path, bytes).unwrap();
        assert!(inspect_paths(vec![path]).is_err());
        let mut read = Cursor::new(vec![1, 2, 3]);
        assert!(stream_exact(&mut read, &mut io::sink(), 2, |_| Ok(())).is_err());
    }

    #[test]
    fn entry_expansion_raw_and_staging_limits_are_cumulative() {
        let temp = TempDir::new().unwrap();
        let path = source(&temp, "pack.zip", &[("pack.mcmeta", metadata())]);
        let mut budget = Budget {
            entries: MAX_ENTRIES,
            ..Budget::default()
        };
        assert!(inspect_index(&path, &mut budget).is_err());
        let mut budget = Budget {
            declared: MAX_EXPANDED_BYTES,
            ..Budget::default()
        };
        assert!(inspect_index(&path, &mut budget).is_err());
        let mut budget = Budget {
            raw: MAX_RAW_BYTES,
            ..Budget::default()
        };
        assert!(snapshot(&path, &temp.path().join("snapshot.zip"), &mut budget).is_err());
    }

    #[test]
    fn invalid_subset_is_noted_without_source_paths() {
        let temp = TempDir::new().unwrap();
        let valid = source(&temp, "valid.jar", &[("mod.class", vec![1])]);
        let wrong = temp.path().join("wrong.txt");
        fs::write(&wrong, b"text").unwrap();
        let inspection = inspect_paths(vec![wrong, PathBuf::from("relative.zip"), valid]).unwrap();
        assert_eq!(inspection.candidates.len(), 1);
        assert_eq!(inspection.notes.len(), 2);
        for note in &inspection.notes {
            assert!(!note.contains(&temp.path().to_string_lossy().to_string()));
            assert!(!note.contains('/'));
        }
        assert!(inspect_paths(Vec::new()).is_err());
        assert!(inspect_paths(vec![PathBuf::from("unused.zip"); MAX_SOURCES + 1]).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_and_non_file_sources() {
        let temp = TempDir::new().unwrap();
        let valid = source(&temp, "valid.zip", &[("pack.mcmeta", metadata())]);
        let link = temp.path().join("link.zip");
        std::os::unix::fs::symlink(&valid, &link).unwrap();
        assert!(inspect_paths(vec![link]).is_err());
        let directory = temp.path().join("folder.zip");
        fs::create_dir(&directory).unwrap();
        assert!(inspect_paths(vec![directory]).is_err());
    }

    #[test]
    fn source_mutation_after_inspection_cannot_change_prepared_resources() {
        let temp = TempDir::new().unwrap();
        let path = source(
            &temp,
            "pack.zip",
            &[
                ("pack.mcmeta", metadata()),
                ("data/test/a", b"original".to_vec()),
            ],
        );
        let original = fs::read(&path).unwrap();
        let inspection = inspect_paths(vec![path.clone()]).unwrap();
        fs::write(&path, b"mutated source").unwrap();
        let output = TempDir::new().unwrap();
        let prepared = prepare(&inspection, 0, DropKind::DataPack, output.path());
        assert_eq!(fs::read(&prepared[0]).unwrap(), original);
        assert_ne!(prepared[0], path);
    }

    #[test]
    fn jar_source_mutation_after_inspection_cannot_change_published_resource() {
        use crate::resources::drop_publication::{publish_file_with_cancel, validate_source};

        let temp = TempDir::new().unwrap();
        let path = temp.path().join("mod.jar");
        let original = jar();
        fs::write(&path, &original).unwrap();
        let inspection = inspect_paths(vec![path.clone()]).unwrap();
        fs::remove_file(&path).unwrap();
        fs::write(&path, b"invalid replacement archive").unwrap();
        assert!(validate_source(&path).is_err());

        let output = TempDir::new().unwrap();
        let prepared = prepare(&inspection, 0, DropKind::Mod, output.path());
        assert_ne!(prepared[0], path);
        assert_eq!(validate_source(&prepared[0]), Ok(()));
        let mods = TempDir::new().unwrap();
        let installed = publish_file_with_cancel(&prepared[0], mods.path(), || Ok(())).unwrap();
        assert_eq!(fs::read(&installed).unwrap(), original);
        assert_eq!(validate_source(&installed), Ok(()));
        assert_eq!(fs::read_dir(mods.path()).unwrap().count(), 1);
    }

    #[test]
    fn partial_source_failure_removes_candidates_and_staged_files() {
        let temp = TempDir::new().unwrap();
        let broken = source(
            &temp,
            "broken.zip",
            &[("mods/a.jar", jar()), ("../unsafe", vec![1])],
        );
        let good = source(&temp, "good.jar", &[("mod.class", vec![1])]);
        let inspection = inspect_paths(vec![broken, good]).unwrap();
        assert_eq!(inspection.candidates.len(), 1);
        assert_eq!(inspection.candidates[0].name, "good.jar");
        assert_eq!(inspection.prepared.len(), 1);
        assert!(!inspection._staging.path().join("source-0").exists());
    }

    #[test]
    fn unsupported_unowned_zips_are_never_opened_or_staged() {
        let temp = TempDir::new().unwrap();
        let path = source(
            &temp,
            "mixed.zip",
            &[
                ("Pack/pack.mcmeta", metadata()),
                ("Pack/assets/test/a", vec![1]),
                ("unowned.zip", zip_bytes(&[("../unsafe", metadata())])),
                ("broken.zip", b"not a zip".to_vec()),
            ],
        );
        // Unsupported data is not inflated, even to validate its payload CRC.
        let mut bytes = fs::read(&path).unwrap();
        let headers = central_headers(&bytes);
        bytes[headers[2] + 16..headers[2] + 20].copy_from_slice(&[0; 4]);
        fs::write(&path, bytes).unwrap();
        let inspection = inspect_paths(vec![path]).unwrap();
        assert_eq!(inspection.candidates.len(), 1);
        assert_eq!(inspection.candidates[0].kinds, vec![DropKind::ResourcePack]);
        assert!(inspection
            .notes
            .iter()
            .any(|note| note.contains("unsupported embedded ZIP")));
        assert!(inspection
            .source_evidence_path(&inspection.candidates[0].id)
            .is_none());
        let files: Vec<_> = fs::read_dir(inspection._staging.path().join("source-0"))
            .unwrap()
            .collect();
        assert_eq!(files.len(), 1); // source snapshot only
        let zip_only = source(&temp, "outer.zip", &[("inner.zip", jar())]);
        assert!(inspect_paths(vec![zip_only])
            .err()
            .unwrap()
            .contains("unsupported embedded ZIP"));
    }

    #[test]
    fn owned_inner_zips_remain_exact_opaque_payloads() {
        let temp = TempDir::new().unwrap();
        let opaque = zip_bytes(&[("../unsafe", vec![7])]);
        let path = source(
            &temp,
            "owned.zip",
            &[
                ("deep/Pack/Pack/pack.mcmeta", metadata()),
                ("deep/Pack/Pack/assets/test/a", vec![1]),
                ("deep/Pack/Pack/inner.zip", opaque.clone()),
                ("deep/Pack/Pack/not-archive.zip", b"not a ZIP".to_vec()),
                ("World/level.dat", level("World")),
                ("World/datapacks/opaque.zip", opaque.clone()),
            ],
        );
        let inspection = inspect_paths(vec![path]).unwrap();
        assert_eq!(inspection.candidates.len(), 2);
        assert!(inspection.notes.is_empty());
        let output = TempDir::new().unwrap();
        let pack = inspection
            .candidates
            .iter()
            .find(|candidate| candidate.kinds.contains(&DropKind::ResourcePack))
            .unwrap();
        let prepared = inspection
            .materialize(&pack.id, DropKind::ResourcePack, output.path())
            .unwrap();
        let mut archive = open_archive(&prepared[0]).unwrap();
        let mut bytes = Vec::new();
        archive
            .by_name("inner.zip")
            .unwrap()
            .read_to_end(&mut bytes)
            .unwrap();
        assert_eq!(bytes, opaque);
        let world = inspection
            .candidates
            .iter()
            .find(|candidate| candidate.kinds == vec![DropKind::World])
            .unwrap();
        let world_path = inspection
            .materialize(&world.id, DropKind::World, output.path())
            .unwrap();
        let saves = TempDir::new().unwrap();
        let installed = crate::worlds::archive::install_archive(
            &world_path[0],
            saves.path(),
            &[world.world_candidates[0].id.clone()],
            None,
            |_, _| Ok(()),
        )
        .unwrap();
        assert_eq!(
            fs::read(installed[0].path.join("datapacks/opaque.zip")).unwrap(),
            opaque
        );
    }

    #[test]
    fn repeated_deep_folder_wrappers_work_for_every_layout() {
        for wrapper in [
            "my-pack/my-pack",
            "one/two/three/four/my-pack/my-pack/five/six",
        ] {
            for (kind, entries) in [
                (DropKind::DataPack, vec![("pack.mcmeta", metadata()), ("data/test/a", vec![1])]),
                (DropKind::ResourcePack, vec![("pack.mcmeta", metadata()), ("assets/test/a", vec![1])]),
                (DropKind::Shader, vec![("shaders/a.fsh", vec![1])]),
                (DropKind::World, vec![("level.dat", level("Deep"))]),
                (DropKind::Mod, vec![("mods/a.jar", jar())]),
                (DropKind::Modpack, vec![("modrinth.index.json", br#"{"formatVersion":1,"game":"minecraft","files":[],"dependencies":{}}"#.to_vec()), ("mods/a.jar", jar())]),
            ] {
                let temp = TempDir::new().unwrap();
                let entries: Vec<_> = entries.into_iter().map(|(name, data)| (format!("{wrapper}/{name}"), data)).collect();
                let borrowed: Vec<_> = entries.iter().map(|(name, data)| (name.as_str(), data.clone())).collect();
                let path = source(&temp, "no-type-in-name.zip", &borrowed);
                let inspection = inspect_paths(vec![path]).unwrap();
                assert_eq!(inspection.candidates.len(), 1);
                assert_eq!(inspection.candidates[0].kinds, vec![kind]);
                if kind != DropKind::World && kind != DropKind::Modpack {
                    let output = TempDir::new().unwrap();
                    let prepared = prepare(&inspection, 0, kind, output.path());
                    if kind != DropKind::Mod {
                        assert!(archive_names(&prepared[0]).iter().all(|name| !name.starts_with(wrapper)));
                    }
                }
            }
        }
    }

    #[test]
    fn mixed_modpack_preserves_independent_candidates_and_rejects_apply() {
        let temp = TempDir::new().unwrap();
        let path = source(
            &temp,
            "mixed.zip",
            &[
                (
                    "Modpack/modrinth.index.json",
                    br#"{"formatVersion":1,"game":"minecraft","files":[],"dependencies":{}}"#
                        .to_vec(),
                ),
                ("Modpack/pack.mcmeta", metadata()),
                ("Modpack/level.dat", level("Owned")),
                ("Modpack/mods/owned.jar", jar()),
                ("Pack/pack.mcmeta", metadata()),
                ("Pack/data/test/a", vec![1]),
                ("World/level.dat", level("Independent")),
                ("loose.jar", jar()),
            ],
        );
        let inspection = inspect_paths(vec![path]).unwrap();
        assert_eq!(inspection.candidates.len(), 4);
        let modpack = inspection
            .candidates
            .iter()
            .find(|candidate| candidate.kinds == vec![DropKind::Modpack])
            .unwrap();
        assert!(inspection
            .materialize(&modpack.id, DropKind::Modpack, temp.path())
            .unwrap_err()
            .contains("existing instance"));
        assert!(inspection
            .candidates
            .iter()
            .all(|candidate| inspection.source_evidence_path(&candidate.id).is_none()));
        let world = inspection
            .candidates
            .iter()
            .find(|candidate| candidate.kinds == vec![DropKind::World])
            .unwrap();
        assert_eq!(world.world_candidates.len(), 1);
        assert_eq!(world.world_candidates[0].name, "Independent");
    }

    #[test]
    fn source_evidence_is_per_source_and_requires_one_coherent_non_mod_resource() {
        let temp = TempDir::new().unwrap();
        let pack = source(
            &temp,
            "pack.zip",
            &[
                ("pack/pack/pack.mcmeta", metadata()),
                ("pack/pack/assets/a", vec![1]),
                ("readme.txt", vec![1]),
            ],
        );
        let original = fs::read(&pack).unwrap();
        let world = source(
            &temp,
            "world.zip",
            &[("deep/World/level.dat", level("One"))],
        );
        let mod_path = source(&temp, "mod.jar", &[("mod.class", vec![1])]);
        let inspection = inspect_paths(vec![pack, world, mod_path]).unwrap();
        assert_eq!(
            fs::read(
                inspection
                    .source_evidence_path(&inspection.candidates[0].id)
                    .unwrap()
            )
            .unwrap(),
            original
        );
        assert!(inspection
            .source_evidence_path(&inspection.candidates[1].id)
            .is_some());
        assert!(inspection
            .source_evidence_path(&inspection.candidates[2].id)
            .is_none());
        assert!(inspection.source_evidence_path("missing").is_none());
        for entries in [
            vec![("A/pack.mcmeta", metadata()), ("B/pack.mcmeta", metadata())],
            vec![("A/level.dat", level("A")), ("B/level.dat", level("B"))],
            vec![("A/pack.mcmeta", metadata()), ("unknown.bin", vec![1])],
            vec![("mods/a.jar", jar())],
        ] {
            let path = source(&temp, "container.zip", &entries);
            let inspection = inspect_paths(vec![path]).unwrap();
            assert!(inspection
                .candidates
                .iter()
                .all(|candidate| inspection.source_evidence_path(&candidate.id).is_none()));
        }
    }

    #[test]
    fn cancellation_aborts_snapshot_index_and_summary_loops() {
        use std::cell::Cell;
        let temp = TempDir::new().unwrap();
        let path = source(
            &temp,
            "big.zip",
            &[
                ("pack.mcmeta", metadata()),
                ("assets/a", vec![1; 2 * 1024 * 1024]),
            ],
        );
        let calls = Cell::new(0);
        let error = inspect_paths_with_cancel(vec![path.clone()], || {
            calls.set(calls.get() + 1);
            calls.get() == 6
        })
        .err()
        .unwrap();
        assert_eq!(error, "Resource inspection cancelled.");
        let entries: Vec<_> = (0..100).map(|i| (format!("assets/{i}"), vec![1])).collect();
        let borrowed: Vec<_> = entries
            .iter()
            .map(|(name, data)| (name.as_str(), data.clone()))
            .collect();
        let path = source(&temp, "entries.zip", &borrowed);
        let calls = Cell::new(0);
        assert_eq!(
            inspect_index_cancellable(&path, &mut Budget::default(), false, &|| {
                calls.set(calls.get() + 1);
                calls.get() == 105
            })
            .err()
            .unwrap(),
            "Resource inspection cancelled."
        );
        let index = inspect_index(&path, &mut Budget::default()).unwrap();
        assert_eq!(
            summarize_inventory(&index.worlds, &|| true).err().unwrap(),
            "Resource inspection cancelled."
        );
        assert_eq!(
            inspect_paths_with_cancel(vec![path], || true)
                .err()
                .unwrap(),
            "Resource inspection cancelled."
        );
    }

    #[test]
    fn raw_reads_reject_aes_even_without_the_encryption_flag() {
        let temp = TempDir::new().unwrap();
        let path = temp.path().join("aes.zip");
        let mut writer = ZipWriter::new(File::create(&path).unwrap());
        writer
            .start_file("pack.mcmeta", SimpleFileOptions::default())
            .unwrap();
        writer.write_all(&metadata()).unwrap();
        writer
            .start_file(
                "assets/a",
                SimpleFileOptions::default().with_aes_encryption(zip::AesMode::Aes128, "password"),
            )
            .unwrap();
        writer.write_all(b"secret").unwrap();
        writer.finish().unwrap();
        let mut bytes = fs::read(&path).unwrap();
        let headers = central_headers(&bytes);
        let header = headers[1];
        bytes[header + 8] &= !1;
        let local =
            u32::from_le_bytes(bytes[header + 42..header + 46].try_into().unwrap()) as usize;
        bytes[local + 6] &= !1;
        fs::write(&path, bytes).unwrap();
        assert!(inspect_paths(vec![path.clone()])
            .err()
            .unwrap()
            .contains("Encrypted or unsupported"));
        assert!(inspect_archive(&path, temp.path()).is_err());
    }

    /// Benign generated fixtures; run with --ignored --nocapture --test-threads=1.
    #[test]
    #[ignore]
    fn benchmark_archive_inspection() {
        let temp = TempDir::new().unwrap();
        for label in [
            "byte-heavy",
            "entry-heavy",
            "worlds-1",
            "worlds-8",
            "worlds-32",
        ] {
            let entries: Vec<(String, Vec<u8>)> = if label == "byte-heavy" {
                vec![
                    ("pack.mcmeta".into(), metadata()),
                    ("assets/test/payload".into(), vec![7; 64 * 1024 * 1024]),
                ]
            } else if label == "entry-heavy" {
                std::iter::once(("pack.mcmeta".into(), metadata()))
                    .chain((0..10_000).map(|i| (format!("assets/test/{i}"), vec![7])))
                    .collect()
            } else {
                let worlds: usize = label.strip_prefix("worlds-").unwrap().parse().unwrap();
                (0..worlds)
                    .flat_map(|world| {
                        std::iter::once((format!("World-{world:02}/level.dat"), level("Benchmark")))
                            .chain((0..500).map(move |i| {
                                (format!("World-{world:02}/region/{i}"), vec![7; 256])
                            }))
                    })
                    .collect()
            };
            let borrowed: Vec<_> = entries
                .iter()
                .map(|(name, data)| (name.as_str(), data.clone()))
                .collect();
            let path = source(&temp, &format!("{label}.zip"), &borrowed);
            let mut drop_ms = Vec::new();
            let mut world_ms = Vec::new();
            for _ in 0..5 {
                let start = std::time::Instant::now();
                let inspection = inspect_paths(vec![path.clone()]).unwrap();
                drop_ms.push(start.elapsed().as_secs_f64() * 1000.0);
                drop(inspection);
                if label.starts_with("worlds-") {
                    let start = std::time::Instant::now();
                    inspect_archive(&path, temp.path()).unwrap();
                    world_ms.push(start.elapsed().as_secs_f64() * 1000.0);
                }
            }
            drop_ms.sort_by(f64::total_cmp);
            world_ms.sort_by(f64::total_cmp);
            eprintln!("archive-benchmark {label} entries={} bytes={} drop_median_ms={:.3} world_median_ms={:?}", entries.len(), fs::metadata(&path).unwrap().len(), drop_ms[2], world_ms.get(2));
        }
    }
}
