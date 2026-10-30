//! Native OS-drop admission. IPC paths are selectors, never filesystem authority.
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use vesta_server_client::{
    files::{FileTransfers, UploadCandidate, MAX_WRITE_BYTES},
    Error, ErrorCode, Result,
};

const MAX_FILES: usize = 64;
const MAX_DEPTH: usize = 64;

#[derive(Default)]
pub(crate) struct DroppedFiles {
    latest: Mutex<HashMap<String, Vec<PathBuf>>>,
}

#[derive(Debug, serde::Serialize)]
pub(crate) struct DroppedUploadCandidate {
    #[serde(flatten)]
    candidate: UploadCandidate,
    #[serde(skip_serializing_if = "Option::is_none")]
    folder: Option<String>,
}

fn invalid() -> Error {
    Error::new(ErrorCode::InvalidInput)
}

impl DroppedFiles {
    /// Called only from the native event handler, never from a frontend event/command.
    pub(crate) fn observe(&self, owner: &str, event: &tauri::DragDropEvent) {
        if let tauri::DragDropEvent::Drop { paths, .. } = event {
            // Even an oversized/empty drop replaces the previous authority.
            let paths = if paths.len() <= MAX_FILES {
                paths.clone()
            } else {
                Vec::new()
            };
            self.latest.lock().unwrap().insert(owner.to_owned(), paths);
        }
    }

    pub(crate) fn window_closed(&self, owner: &str) {
        self.latest.lock().unwrap().remove(owner);
    }

    fn accept(&self, owner: &str, paths: Vec<String>) -> Result<Vec<PathBuf>> {
        if paths.is_empty() || paths.len() > MAX_FILES {
            return Err(invalid());
        }
        let mut latest = self.latest.lock().unwrap();
        let observed = latest.get(owner).ok_or_else(invalid)?;
        let mut selected = HashSet::new();
        for path in paths {
            // Compare exact native spelling; do not canonicalize an IPC path into authority.
            let path = PathBuf::from(path);
            if !observed.iter().any(|p| p.as_os_str() == path.as_os_str()) || !selected.insert(path)
            {
                return Err(invalid());
            }
        }
        let paths = observed
            .iter()
            .filter(|p| selected.contains(*p))
            .cloned()
            .collect();
        // Consume once so stale frontend retries cannot re-open a changed local source.
        latest.remove(owner);
        Ok(paths)
    }

    pub(crate) async fn pack_sources(
        &self,
        owner: &str,
        paths: Vec<String>,
        archive: bool,
    ) -> Result<Vec<PackSource>> {
        let paths = self.accept(owner, paths)?;
        if archive && paths.len() != 1 {
            return Err(invalid());
        }
        tokio::task::spawn_blocking(move || {
            use sha2::{Digest, Sha256};
            use std::io::{Read, Seek, SeekFrom};
            let limit = if archive {
                128 * 1024 * 1024 * 1024
            } else {
                16 * 1024 * 1024
            };
            let sources = collect_with_limit(paths, limit)?;
            if archive && (sources.len() != 1 || sources[0].folder.is_some()) {
                return Err(invalid());
            }
            sources
                .into_iter()
                .map(|mut source| {
                    let path = source
                        .folder
                        .map_or_else(|| source.name.clone(), |f| format!("{f}/{}", source.name));
                    let mut hash = Sha256::new();
                    let mut size = 0u64;
                    let mut buffer = [0u8; 65536];
                    loop {
                        let count = source.file.read(&mut buffer).map_err(|_| invalid())?;
                        if count == 0 {
                            break;
                        }
                        size += count as u64;
                        if size > limit {
                            return Err(invalid());
                        }
                        hash.update(&buffer[..count]);
                    }
                    source
                        .file
                        .seek(SeekFrom::Start(0))
                        .map_err(|_| invalid())?;
                    Ok(PackSource {
                        name: source.name,
                        path,
                        file: source.file,
                        size,
                        sha256: hex::encode(hash.finalize()),
                    })
                })
                .collect()
        })
        .await
        .map_err(|_| Error::new(ErrorCode::Internal))?
    }
    pub(crate) async fn upload(
        &self,
        owner: &str,
        paths: Vec<String>,
        transfers: &FileTransfers,
    ) -> Result<Vec<DroppedUploadCandidate>> {
        let paths = self.accept(owner, paths)?;
        // Folder walking and opening local handles must not block the event loop/runtime.
        let sources = tokio::task::spawn_blocking(move || collect(paths))
            .await
            .map_err(|_| Error::new(ErrorCode::Internal))??;
        let mut candidates = Vec::with_capacity(sources.len());
        for source in sources {
            candidates.push(DroppedUploadCandidate {
                candidate: transfers.pick(owner, source.file, source.name).await?,
                folder: source.folder,
            });
        }
        Ok(candidates)
    }
}

struct Source {
    file: File,
    name: String,
    folder: Option<String>,
}

/// Open without following the last component. Unix children resolve relative to
/// their already-open parent; Windows parents stay locked against rename/delete.
fn open(path: &Path, parent: Option<&File>) -> Result<File> {
    #[cfg(unix)]
    {
        use std::{
            ffi::CString,
            os::{
                fd::{AsRawFd, FromRawFd},
                unix::ffi::OsStrExt,
            },
        };
        let name = if parent.is_some() {
            path.file_name().ok_or_else(invalid)?
        } else {
            path.as_os_str()
        };
        let name = CString::new(name.as_bytes()).map_err(|_| invalid())?;
        let fd = unsafe {
            libc::openat(
                parent.map_or(libc::AT_FDCWD, |p| p.as_raw_fd()),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
            )
        };
        if fd < 0 {
            return Err(invalid());
        }
        Ok(unsafe { File::from_raw_fd(fd) })
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        let _ = parent;
        fs::OpenOptions::new()
            .read(true)
            // FILE_SHARE_READ: prevent replacement while walking/snapshotting.
            .share_mode(1)
            // FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS (directories).
            .custom_flags(0x0020_0000 | 0x0200_0000)
            .open(path)
            .map_err(|_| invalid())
    }
}

fn checked_metadata(file: &File) -> Result<fs::Metadata> {
    let meta = file.metadata().map_err(|_| invalid())?;
    if crate::instance_file::is_link(&meta) || !(meta.is_file() || meta.is_dir()) {
        return Err(invalid());
    }
    Ok(meta)
}

fn collect(paths: Vec<PathBuf>) -> Result<Vec<Source>> {
    collect_with_limit(paths, MAX_WRITE_BYTES)
}

fn collect_with_limit(paths: Vec<PathBuf>, limit: u64) -> Result<Vec<Source>> {
    let mut sources = Vec::new();
    let mut seen = HashSet::new();
    for path in paths {
        if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
            return Err(invalid());
        }
        // Inspect/open every ancestor, including ancestors of a loose dropped file.
        let mut ancestors: Vec<_> = path.ancestors().skip(1).collect();
        ancestors.reverse();
        let mut guards = Vec::new();
        for ancestor in ancestors {
            let guard = open(ancestor, guards.last())?;
            if !checked_metadata(&guard)?.is_dir() {
                return Err(invalid());
            }
            guards.push(guard);
        }
        walk(
            &path,
            guards.last(),
            None,
            0,
            &mut seen,
            &mut sources,
            limit,
        )?;
    }
    Ok(sources)
}

fn walk(
    path: &Path,
    parent: Option<&File>,
    folder: Option<&str>,
    depth: usize,
    seen: &mut HashSet<PathBuf>,
    sources: &mut Vec<Source>,
    limit: u64,
) -> Result<()> {
    if depth > MAX_DEPTH {
        return Err(invalid());
    }
    let file = open(path, parent)?;
    let meta = checked_metadata(&file)?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(invalid)?;
    // The only path returned is portable and relative, never a native path.
    if name.contains(['/', '\\']) {
        return Err(invalid());
    }
    if meta.is_dir() {
        let folder = folder.map_or_else(|| name.to_owned(), |f| format!("{f}/{name}"));
        // Stream entries, stopping at the cap rather than collecting an unbounded listing.
        for entry in fs::read_dir(path).map_err(|_| invalid())? {
            let path = path.join(entry.map_err(|_| invalid())?.file_name());
            walk(
                &path,
                Some(&file),
                Some(&folder),
                depth + 1,
                seen,
                sources,
                limit,
            )?;
        }
    } else if seen.insert(path.to_owned()) {
        if sources.len() >= MAX_FILES || meta.len() > limit {
            return Err(invalid());
        }
        sources.push(Source {
            file,
            name: name.to_owned(),
            folder: folder.map(str::to_owned),
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn pack_drops_require_observed_paths_and_preserve_folder_paths() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("config");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("settings.toml"), b"enabled=true").unwrap();
        let drops = DroppedFiles::default();
        rejects(
            drops
                .pack_bytes("main", strings(std::slice::from_ref(&root)), false)
                .await,
        );
        drop_paths(&drops, "main", std::slice::from_ref(&root));
        let files = drops
            .pack_bytes("main", strings(std::slice::from_ref(&root)), false)
            .await
            .unwrap();
        assert_eq!(files[0].1, "config/settings.toml");
        assert_eq!(files[0].2, b"enabled=true");
        rejects(
            drops
                .pack_bytes("main", strings(std::slice::from_ref(&root)), false)
                .await,
        );
        drop_paths(&drops, "main", std::slice::from_ref(&root));
        rejects(
            drops
                .pack_bytes("main", strings(std::slice::from_ref(&root)), true)
                .await,
        );
    }

    fn strings(paths: &[PathBuf]) -> Vec<String> {
        paths
            .iter()
            .map(|p| p.to_str().unwrap().to_owned())
            .collect()
    }

    fn drop_paths(drops: &DroppedFiles, owner: &str, paths: &[PathBuf]) {
        drops.observe(
            owner,
            &tauri::DragDropEvent::Drop {
                paths: paths.to_vec(),
                position: tauri::PhysicalPosition::new(0.0, 0.0),
            },
        );
    }

    fn rejects<T>(result: Result<T>) {
        assert_eq!(
            result.err().expect("must reject").code,
            ErrorCode::InvalidInput
        );
    }

    #[test]
    fn only_latest_native_drop_on_same_window_can_authorize_paths() {
        let drops = DroppedFiles::default();
        let first = PathBuf::from("first.txt");
        let second = PathBuf::from("second.txt");
        rejects(drops.accept("main", strings(&[first.clone()])));
        drops.observe(
            "main",
            &tauri::DragDropEvent::Enter {
                paths: vec![first.clone()],
                position: tauri::PhysicalPosition::new(0.0, 0.0),
            },
        );
        rejects(drops.accept("main", strings(&[first.clone()])));
        drop_paths(&drops, "main", &[first.clone()]);
        rejects(drops.accept("other", strings(&[first.clone()])));
        rejects(drops.accept("main", strings(&[second.clone()])));
        drop_paths(&drops, "main", &[second.clone()]);
        rejects(drops.accept("main", strings(&[first])));
        assert_eq!(
            drops.accept("main", strings(&[second.clone()])).unwrap(),
            vec![second.clone()]
        );
        rejects(drops.accept("main", strings(&[second])));
    }

    #[test]
    fn requested_descendants_aliases_duplicates_and_mixed_unobserved_paths_are_rejected() {
        let drops = DroppedFiles::default();
        let root = tempfile::tempdir().unwrap();
        let observed = root.path().join("plugins");
        drop_paths(&drops, "main", &[observed.clone()]);
        rejects(drops.accept("main", strings(&[observed.join("secret.txt")])));
        rejects(drops.accept("main", strings(&[root.path().join(".").join("plugins")])));
        rejects(drops.accept("main", strings(&[observed.clone(), observed.clone()])));
        rejects(drops.accept(
            "main",
            strings(&[observed.clone(), root.path().join("secret.txt")]),
        ));
        drops.window_closed("main");
        rejects(drops.accept("main", strings(&[observed])));
    }

    #[test]
    fn oversized_or_empty_native_drop_revokes_previous_paths() {
        let drops = DroppedFiles::default();
        let path = PathBuf::from("file");
        drop_paths(&drops, "main", &[path.clone()]);
        rejects(drops.accept("main", vec![]));
        rejects(drops.accept("main", vec!["file".into(); 65]));
        drop_paths(&drops, "main", &vec![path.clone(); 65]);
        rejects(drops.accept("main", strings(&[path.clone()])));
        drop_paths(&drops, "main", &[path.clone()]);
        drop_paths(&drops, "main", &[]);
        rejects(drops.accept("main", strings(&[path])));
    }

    #[tokio::test]
    async fn nested_and_loose_files_use_existing_snapshot_candidates_without_native_paths() {
        let root = tempfile::tempdir().unwrap();
        let plugins = root.path().join("plugins");
        fs::create_dir_all(plugins.join("LuckPerms")).unwrap();
        fs::write(plugins.join("LuckPerms/config.yml"), b"nested").unwrap();
        fs::write(plugins.join("plugin.jar"), b"jar").unwrap();
        let loose = root.path().join("loose.txt");
        fs::write(&loose, b"loose").unwrap();
        let drops = DroppedFiles::default();
        let paths = vec![plugins, loose];
        drop_paths(&drops, "main", &paths);
        let candidates = drops
            .upload("main", strings(&paths), &FileTransfers::default())
            .await
            .unwrap();
        assert_eq!(candidates.len(), 3);
        let json = serde_json::to_value(&candidates).unwrap();
        for candidate in json.as_array().unwrap() {
            assert!(!candidate["localId"].as_str().unwrap().is_empty());
            assert!(candidate.get("path").is_none());
            match candidate["name"].as_str().unwrap() {
                "config.yml" => {
                    assert_eq!(candidate["folder"], "plugins/LuckPerms");
                    assert_eq!(candidate["size"], "6");
                }
                "plugin.jar" => assert_eq!(candidate["folder"], "plugins"),
                "loose.txt" => assert!(candidate.get("folder").is_none()),
                name => panic!("unexpected candidate {name}"),
            }
        }
        assert!(!serde_json::to_string(&candidates)
            .unwrap()
            .contains(&root.path().to_string_lossy().to_string()));
    }

    #[test]
    fn file_cap_is_shared_across_dropped_roots_and_nested_folders() {
        let root = tempfile::tempdir().unwrap();
        let nested = root.path().join("folder/nested");
        fs::create_dir_all(&nested).unwrap();
        for index in 0..64 {
            fs::write(nested.join(format!("{index}.txt")), b"x").unwrap();
        }
        let folder = root.path().join("folder");
        assert_eq!(collect(vec![folder.clone()]).unwrap().len(), 64);
        let loose = root.path().join("extra.txt");
        fs::write(&loose, b"x").unwrap();
        rejects(collect(vec![folder.clone(), loose]));
        fs::write(nested.join("65.txt"), b"x").unwrap();
        rejects(collect(vec![folder]));
    }

    #[test]
    fn picker_size_limit_applies_to_each_dropped_file() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("large.dat");
        let file = File::create(&path).unwrap();
        file.set_len(MAX_WRITE_BYTES).unwrap();
        drop(file);
        assert_eq!(collect(vec![path.clone()]).unwrap().len(), 1);
        let file = fs::OpenOptions::new().write(true).open(&path).unwrap();
        file.set_len(MAX_WRITE_BYTES + 1).unwrap();
        drop(file);
        rejects(collect(vec![path]));
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_are_refused_as_roots_children_and_ancestors() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.txt"), b"secret").unwrap();
        let link = root.path().join("linked");
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();
        rejects(collect(vec![link.clone()]));
        rejects(collect(vec![link.join("secret.txt")]));
        rejects(collect(vec![root.path().to_owned()]));
        fs::remove_file(&link).unwrap();
        std::os::unix::fs::symlink(outside.path().join("secret.txt"), &link).unwrap();
        rejects(collect(vec![link]));
    }

    #[cfg(windows)]
    #[test]
    fn junctions_are_refused_as_roots_children_and_ancestors() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret.txt"), b"secret").unwrap();
        let link = root.path().join("linked");
        let result = std::process::Command::new("cmd.exe")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        rejects(collect(vec![link.clone()]));
        rejects(collect(vec![link.join("secret.txt")]));
        rejects(collect(vec![root.path().to_owned()]));
        fs::remove_dir(&link).unwrap();
        assert_eq!(
            fs::read(outside.path().join("secret.txt")).unwrap(),
            b"secret"
        );
    }
}

pub(crate) struct PackSource {
    pub name: String,
    pub path: String,
    pub file: File,
    pub size: u64,
    pub sha256: String,
}
