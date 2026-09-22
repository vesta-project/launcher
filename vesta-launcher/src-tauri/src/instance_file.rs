//! Bounded, no-follow persistence for files inside an instance game directory.
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

pub(crate) fn checked_path(directory: &Path, filename: &str) -> Result<PathBuf, String> {
    if filename.is_empty()
        || filename.contains(['/', '\\'])
        || !directory.is_absolute()
        || directory
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("Invalid instance file path".into());
    }
    for ancestor in directory.ancestors() {
        let metadata = fs::symlink_metadata(ancestor).map_err(err)?;
        if is_link(&metadata) || !metadata.is_dir() {
            return Err("Linked instance directories are not supported".into());
        }
    }
    Ok(directory.join(filename))
}

pub(crate) fn read(path: &Path, limit: u64, label: &str) -> Result<Option<Vec<u8>>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(err(error)),
    };
    if is_link(&metadata) || !metadata.is_file() {
        return Err(format!("{label} must be a regular file, not a link"));
    }
    if metadata.len() > limit {
        return Err(format!("{label} exceeds the size limit"));
    }
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
        options.custom_flags(0x00200000);
    }
    let file = options.open(path).map_err(err)?;
    let opened = file.metadata().map_err(err)?;
    if is_link(&opened) || !opened.is_file() {
        return Err(format!("{label} must be a regular file"));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes).map_err(err)?;
    if bytes.len() as u64 > limit {
        return Err(format!("{label} exceeds the size limit"));
    }
    Ok(Some(bytes))
}

pub(crate) fn replace(
    directory: &Path,
    path: &Path,
    before: Option<&[u8]>,
    updated: &[u8],
    limit: u64,
    label: &str,
) -> Result<(), String> {
    if updated.len() as u64 > limit {
        return Err(format!("Updated {label} exceeds the size limit"));
    }
    let filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid instance filename")?;
    if checked_path(directory, filename)? != path {
        return Err("Instance file is outside its game directory".into());
    }
    let mut temporary = tempfile::NamedTempFile::new_in(directory).map_err(err)?;
    if before.is_some() {
        temporary
            .as_file()
            .set_permissions(fs::symlink_metadata(path).map_err(err)?.permissions())
            .map_err(err)?;
    }
    temporary.write_all(updated).map_err(err)?;
    temporary.as_file().sync_all().map_err(err)?;
    if checked_path(directory, filename)? != path || read(path, limit, label)?.as_deref() != before
    {
        return Err(format!("{label} changed on disk. Reload before saving."));
    }
    if before.is_some() {
        temporary.persist(path).map_err(err)?;
    } else {
        temporary.persist_noclobber(path).map_err(err)?;
    }
    #[cfg(unix)]
    File::open(directory)
        .and_then(|file| file.sync_all())
        .map_err(err)?;
    Ok(())
}
