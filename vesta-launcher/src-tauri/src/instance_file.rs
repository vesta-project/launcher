//! Bounded, no-follow persistence for files inside an instance game directory.
#[cfg(windows)]
use std::fs::OpenOptions;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[cfg(unix)]
use std::ffi::CString;
#[cfg(unix)]
use std::os::fd::{AsRawFd, FromRawFd};
#[cfg(unix)]
use std::os::unix::ffi::OsStrExt;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

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
    #[cfg(unix)]
    {
        let directory = path.parent().ok_or("Invalid instance file path")?;
        let filename = path.file_name().ok_or("Invalid instance filename")?;
        let directory = open_directory(directory)?;
        return read_at(&directory, filename, limit, label);
    }
    #[cfg(windows)]
    {
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
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000);
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
}

#[cfg(unix)]
fn c_name(name: &std::ffi::OsStr) -> Result<CString, String> {
    CString::new(name.as_bytes()).map_err(err)
}

#[cfg(unix)]
fn open_directory(directory: &Path) -> Result<File, String> {
    let directory = CString::new(directory.as_os_str().as_bytes()).map_err(err)?;
    let fd = unsafe {
        libc::open(
            directory.as_ptr(),
            libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(err(std::io::Error::last_os_error()));
    }
    Ok(unsafe { File::from_raw_fd(fd) })
}

#[cfg(unix)]
fn open_at(directory: &File, filename: &std::ffi::OsStr) -> Result<Option<File>, String> {
    let filename = c_name(filename)?;
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            filename.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::NotFound {
            return Ok(None);
        }
        return Err(err(error));
    }
    Ok(Some(unsafe { File::from_raw_fd(fd) }))
}

#[cfg(unix)]
fn read_at(
    directory: &File,
    filename: &std::ffi::OsStr,
    limit: u64,
    label: &str,
) -> Result<Option<Vec<u8>>, String> {
    let Some(file) = open_at(directory, filename)? else {
        return Ok(None);
    };
    let metadata = file.metadata().map_err(err)?;
    if !metadata.is_file() {
        return Err(format!("{label} must be a regular file, not a link"));
    }
    if metadata.len() > limit {
        return Err(format!("{label} exceeds the size limit"));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes).map_err(err)?;
    if bytes.len() as u64 > limit {
        return Err(format!("{label} exceeds the size limit"));
    }
    Ok(Some(bytes))
}

#[cfg(unix)]
fn create_temporary_at(directory: &File) -> Result<(CString, File), String> {
    for _ in 0..16 {
        let name = CString::new(format!(".vesta-{}.tmp", uuid::Uuid::new_v4())).map_err(err)?;
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if fd >= 0 {
            return Ok((name, unsafe { File::from_raw_fd(fd) }));
        }
        let error = std::io::Error::last_os_error();
        if error.kind() != std::io::ErrorKind::AlreadyExists {
            return Err(err(error));
        }
    }
    Err("Could not create a temporary instance file".into())
}

#[cfg(unix)]
fn unlink_at(directory: &File, name: &CString) {
    unsafe {
        libc::unlinkat(directory.as_raw_fd(), name.as_ptr(), 0);
    }
}

#[cfg(unix)]
fn replace_at(
    directory: &File,
    filename: &std::ffi::OsStr,
    before: Option<&[u8]>,
    updated: &[u8],
    limit: u64,
    label: &str,
) -> Result<(), String> {
    let filename = c_name(filename)?;
    let (temporary_name, mut temporary) = create_temporary_at(directory)?;
    let result = (|| {
        if before.is_some() {
            let current = open_at(directory, std::ffi::OsStr::from_bytes(filename.as_bytes()))?
                .ok_or_else(|| format!("{label} changed on disk. Reload before saving."))?;
            let permissions = current.metadata().map_err(err)?.permissions().mode();
            if unsafe { libc::fchmod(temporary.as_raw_fd(), permissions as libc::mode_t) } != 0 {
                return Err(err(std::io::Error::last_os_error()));
            }
        }
        temporary.write_all(updated).map_err(err)?;
        temporary.sync_all().map_err(err)?;
        if read_at(
            directory,
            std::ffi::OsStr::from_bytes(filename.as_bytes()),
            limit,
            label,
        )?
        .as_deref()
            != before
        {
            return Err(format!("{label} changed on disk. Reload before saving."));
        }
        let status = if before.is_some() {
            unsafe {
                libc::renameat(
                    directory.as_raw_fd(),
                    temporary_name.as_ptr(),
                    directory.as_raw_fd(),
                    filename.as_ptr(),
                )
            }
        } else {
            unsafe {
                libc::linkat(
                    directory.as_raw_fd(),
                    temporary_name.as_ptr(),
                    directory.as_raw_fd(),
                    filename.as_ptr(),
                    0,
                )
            }
        };
        if status != 0 {
            return Err(err(std::io::Error::last_os_error()));
        }
        if before.is_none() {
            unlink_at(directory, &temporary_name);
        }
        directory.sync_all().map_err(err)
    })();
    unlink_at(directory, &temporary_name);
    result
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
    #[cfg(unix)]
    {
        let directory = open_directory(directory)?;
        return replace_at(
            &directory,
            std::ffi::OsStr::new(filename),
            before,
            updated,
            limit,
            label,
        );
    }
    #[cfg(windows)]
    {
        let mut temporary = tempfile::NamedTempFile::new_in(directory).map_err(err)?;
        if before.is_some() {
            temporary
                .as_file()
                .set_permissions(fs::symlink_metadata(path).map_err(err)?.permissions())
                .map_err(err)?;
        }
        temporary.write_all(updated).map_err(err)?;
        temporary.as_file().sync_all().map_err(err)?;
        if checked_path(directory, filename)? != path
            || read(path, limit, label)?.as_deref() != before
        {
            return Err(format!("{label} changed on disk. Reload before saving."));
        }
        if before.is_some() {
            temporary.persist(path).map_err(err)?;
        } else {
            temporary.persist_noclobber(path).map_err(err)?;
        }
        Ok(())
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn replacement_stays_bound_to_the_open_instance_directory() {
        let root = tempfile::tempdir().unwrap();
        let instance = root.path().join("instance");
        let moved = root.path().join("moved");
        let outside = root.path().join("outside");
        fs::create_dir(&instance).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(instance.join("options.txt"), b"before").unwrap();
        fs::write(outside.join("options.txt"), b"outside").unwrap();

        let directory = open_directory(&instance).unwrap();
        fs::rename(&instance, &moved).unwrap();
        symlink(&outside, &instance).unwrap();

        replace_at(
            &directory,
            std::ffi::OsStr::new("options.txt"),
            Some(b"before"),
            b"updated",
            1024,
            "Options file",
        )
        .unwrap();

        assert_eq!(fs::read(moved.join("options.txt")).unwrap(), b"updated");
        assert_eq!(fs::read(outside.join("options.txt")).unwrap(), b"outside");
    }
}
