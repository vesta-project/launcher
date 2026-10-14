//! Internal validation and no-clobber publication of prepared drop resources.
//!
//! Publication accepts only coordinator-owned files in private staging. These
//! helpers do not form a validate-then-publish API for renderer source paths.

use std::fs::File;
use std::io::{self, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};

/// Upper bound on numbered names tried for one file (`mod (2).jar`, ...).
const MAX_NAME_ATTEMPTS: usize = 1000;

/// Why a dropped file was not added. Only the reason text is ever shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SkipReason {
    NotAbsolute,
    Unreadable,
    NotRegularFile,
    Symlink,
    WrongExtension,
    EmptyFile,
    UnsafeFileName,
    NotZipArchive,
}

impl SkipReason {
    pub(crate) fn describe(self) -> &'static str {
        match self {
            SkipReason::NotAbsolute => "path is not absolute",
            SkipReason::Unreadable => "could not be read",
            SkipReason::NotRegularFile => "not a regular file",
            SkipReason::Symlink => "symlinks are not allowed",
            SkipReason::WrongExtension => "not a .jar file",
            SkipReason::EmptyFile => "file is empty",
            SkipReason::UnsafeFileName => "file name is not allowed",
            SkipReason::NotZipArchive => "not a valid .jar archive",
        }
    }
}

/// Checks that `source` is an absolute, non-empty, regular `.jar` file that
/// parses as a zip archive. Only the archive directory is read.
pub(crate) fn validate_source(source: &Path) -> Result<(), SkipReason> {
    if !source.is_absolute() {
        return Err(SkipReason::NotAbsolute);
    }
    let metadata = std::fs::symlink_metadata(source).map_err(|_| SkipReason::Unreadable)?;
    if metadata.file_type().is_symlink() {
        return Err(SkipReason::Symlink);
    }
    if !metadata.is_file() {
        return Err(SkipReason::NotRegularFile);
    }
    let file_name = safe_file_name(source)?;
    if !has_jar_extension(&file_name) {
        return Err(SkipReason::WrongExtension);
    }
    if metadata.len() == 0 {
        return Err(SkipReason::EmptyFile);
    }
    let file = File::open(source).map_err(|_| SkipReason::Unreadable)?;
    zip::ZipArchive::new(file)
        .map(|_| ())
        .map_err(|_| SkipReason::NotZipArchive)
}

/// Returns the final path component if it is safe to use as a file name.
fn safe_file_name(source: &Path) -> Result<String, SkipReason> {
    let name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(SkipReason::UnsafeFileName)?;
    let unsafe_name = name.is_empty()
        || name.starts_with('.')
        || name
            .chars()
            .any(|c| matches!(c, '/' | '\\') || c.is_control());
    if unsafe_name {
        return Err(SkipReason::UnsafeFileName);
    }
    Ok(name.to_string())
}

fn has_jar_extension(file_name: &str) -> bool {
    Path::new(file_name)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("jar"))
}

/// `mod.jar` for the first attempt, then `mod (2).jar`, `mod (3).jar`, ...
fn numbered_file_name(file_name: &str, number: usize) -> String {
    if number == 1 {
        return file_name.to_string();
    }
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(file_name);
    match path.extension().and_then(|value| value.to_str()) {
        Some(extension) => format!("{stem} ({number}).{extension}"),
        None => format!("{stem} ({number})"),
    }
}

/// Publishes a coordinator-owned prepared file into a validated resource folder.
/// The source must belong to private preparation staging, never an original
/// renderer-supplied path. The caller validates format and destination scope.
///
/// Bytes are copied exactly into a hidden `.vesta-drop-*.tmp` file so watchers
/// never see partial resources. No-clobber persistence claims the final name
/// without replacing existing entries. Cancellation is checked per chunk and
/// immediately before publication; every failure removes the temporary file.
pub(crate) fn publish_file_with_cancel(
    source: &Path,
    mods_dir: &Path,
    mut check_cancel: impl FnMut() -> io::Result<()>,
) -> io::Result<PathBuf> {
    let file_name = safe_file_name(source)
        .map_err(|reason| io::Error::new(ErrorKind::InvalidInput, reason.describe()))?;
    let mut input = File::open(source)?;
    // Reject symlinks defensively; source ownership is guaranteed by the coordinator.
    if std::fs::symlink_metadata(source)?.file_type().is_symlink() {
        return Err(io::Error::new(
            ErrorKind::InvalidInput,
            SkipReason::Symlink.describe(),
        ));
    }

    let mut staged = tempfile::Builder::new()
        .prefix(".vesta-drop-")
        .suffix(".tmp")
        .tempfile_in(mods_dir)?;
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        check_cancel()?;
        let read = input.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        staged.as_file_mut().write_all(&buffer[..read])?;
    }
    staged.as_file().sync_all()?;

    for number in 1..=MAX_NAME_ATTEMPTS {
        check_cancel()?;
        let destination = mods_dir.join(numbered_file_name(&file_name, number));
        match staged.persist_noclobber(&destination) {
            Ok(_) => return Ok(destination),
            Err(tempfile::PersistError { error, file })
                if error.kind() == ErrorKind::AlreadyExists =>
            {
                staged = file;
            }
            Err(tempfile::PersistError { error, .. }) => return Err(error),
        }
    }
    Err(io::Error::new(
        ErrorKind::AlreadyExists,
        "no free file name for dropped mod",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn write_jar(path: &Path, marker: &str) {
        let file = File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file(
            "META-INF/MANIFEST.MF",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(format!("Manifest-Version: 1.0\nMarker: {marker}\n").as_bytes())
            .unwrap();
        zip.finish().unwrap();
    }

    fn dir_names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn valid_jar_is_validated_and_copied() {
        let dir = TempDir::new().unwrap();
        let source = dir.path().join("sodium.jar");
        let mods = dir.path().join("mods");
        std::fs::create_dir(&mods).unwrap();
        write_jar(&source, "a");

        assert_eq!(validate_source(&source), Ok(()));
        let destination = publish_file_with_cancel(&source, &mods, || Ok(())).unwrap();

        assert_eq!(destination, mods.join("sodium.jar"));
        assert_eq!(
            std::fs::read(&destination).unwrap(),
            std::fs::read(&source).unwrap()
        );
        assert_eq!(dir_names(&mods), vec!["sodium.jar".to_string()]);
    }

    #[test]
    fn extension_match_is_case_insensitive_and_jar_only() {
        let dir = TempDir::new().unwrap();
        let upper = dir.path().join("MOD.JAR");
        write_jar(&upper, "u");
        assert_eq!(validate_source(&upper), Ok(()));

        let zipped = dir.path().join("mod.zip");
        write_jar(&zipped, "z");
        assert_eq!(validate_source(&zipped), Err(SkipReason::WrongExtension));

        let bare = dir.path().join("modfile");
        write_jar(&bare, "n");
        assert_eq!(validate_source(&bare), Err(SkipReason::WrongExtension));
    }

    #[test]
    fn non_zip_content_is_rejected() {
        let dir = TempDir::new().unwrap();
        let fake = dir.path().join("fake.jar");
        std::fs::write(&fake, b"this is not a zip archive").unwrap();
        assert_eq!(validate_source(&fake), Err(SkipReason::NotZipArchive));
    }

    #[test]
    fn empty_file_is_rejected() {
        let dir = TempDir::new().unwrap();
        let empty = dir.path().join("empty.jar");
        std::fs::write(&empty, b"").unwrap();
        assert_eq!(validate_source(&empty), Err(SkipReason::EmptyFile));
    }

    #[test]
    fn directory_named_like_a_jar_is_rejected() {
        let dir = TempDir::new().unwrap();
        let folder = dir.path().join("folder.jar");
        std::fs::create_dir(&folder).unwrap();
        assert_eq!(validate_source(&folder), Err(SkipReason::NotRegularFile));
    }

    #[test]
    fn relative_path_is_rejected() {
        assert_eq!(
            validate_source(Path::new("mods/mod.jar")),
            Err(SkipReason::NotAbsolute)
        );
    }

    #[test]
    fn missing_file_is_unreadable() {
        let dir = TempDir::new().unwrap();
        assert_eq!(
            validate_source(&dir.path().join("gone.jar")),
            Err(SkipReason::Unreadable)
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_to_valid_jar_is_rejected() {
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("target.jar");
        let link = dir.path().join("link.jar");
        write_jar(&target, "t");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        assert_eq!(validate_source(&link), Err(SkipReason::Symlink));
    }

    #[test]
    fn hidden_and_separator_names_are_rejected() {
        assert_eq!(
            safe_file_name(Path::new("/tmp/.hidden.jar")),
            Err(SkipReason::UnsafeFileName)
        );
        assert_eq!(
            safe_file_name(Path::new("/tmp/..")),
            Err(SkipReason::UnsafeFileName)
        );
    }

    #[cfg(unix)]
    #[test]
    fn backslash_in_name_is_rejected() {
        assert_eq!(
            safe_file_name(Path::new("/tmp/a\\b.jar")),
            Err(SkipReason::UnsafeFileName)
        );
    }

    #[test]
    fn collision_gets_suffix_and_never_overwrites() {
        let dir = TempDir::new().unwrap();
        let mods = dir.path().join("mods");
        std::fs::create_dir(&mods).unwrap();
        let existing = mods.join("mod.jar");
        std::fs::write(&existing, b"original mod, must survive").unwrap();

        let first = dir.path().join("first").join("mod.jar");
        let second = dir.path().join("second").join("mod.jar");
        std::fs::create_dir_all(first.parent().unwrap()).unwrap();
        std::fs::create_dir_all(second.parent().unwrap()).unwrap();
        write_jar(&first, "first");
        write_jar(&second, "second");

        let added = publish_file_with_cancel(&first, &mods, || Ok(())).unwrap();
        assert_eq!(added, mods.join("mod (2).jar"));
        assert_eq!(
            std::fs::read(&existing).unwrap(),
            b"original mod, must survive"
        );
        assert_eq!(
            std::fs::read(&added).unwrap(),
            std::fs::read(&first).unwrap()
        );

        let third = publish_file_with_cancel(&second, &mods, || Ok(())).unwrap();
        assert_eq!(third, mods.join("mod (3).jar"));
        assert_eq!(
            std::fs::read(&existing).unwrap(),
            b"original mod, must survive"
        );
    }

    #[test]
    fn no_temp_file_is_left_after_success() {
        let dir = TempDir::new().unwrap();
        let source = dir.path().join("lithium.jar");
        let mods = dir.path().join("mods");
        std::fs::create_dir(&mods).unwrap();
        write_jar(&source, "l");

        publish_file_with_cancel(&source, &mods, || Ok(())).unwrap();
        assert_eq!(dir_names(&mods), vec!["lithium.jar".to_string()]);
    }

    #[test]
    fn no_temp_file_is_left_after_failure() {
        let dir = TempDir::new().unwrap();
        let mods = dir.path().join("mods");
        std::fs::create_dir(&mods).unwrap();
        // A directory passes the open step on unix but fails during the copy,
        // which happens after the temp file exists.
        let folder = dir.path().join("folder.jar");
        std::fs::create_dir(&folder).unwrap();

        assert!(publish_file_with_cancel(&folder, &mods, || Ok(())).is_err());
        assert!(dir_names(&mods).is_empty());
    }

    #[test]
    fn unicode_and_space_name_is_preserved() {
        let dir = TempDir::new().unwrap();
        let source = dir.path().join("mödpack 世界.jar");
        let mods = dir.path().join("mods");
        std::fs::create_dir(&mods).unwrap();
        write_jar(&source, "u");

        assert_eq!(validate_source(&source), Ok(()));
        let destination = publish_file_with_cancel(&source, &mods, || Ok(())).unwrap();
        assert_eq!(
            destination.file_name().and_then(|n| n.to_str()),
            Some("mödpack 世界.jar")
        );
    }

    #[test]
    fn numbered_names_keep_the_extension() {
        assert_eq!(numbered_file_name("mod.jar", 1), "mod.jar");
        assert_eq!(numbered_file_name("mod.jar", 2), "mod (2).jar");
        assert_eq!(numbered_file_name("mod.JAR", 3), "mod (3).JAR");
    }

    #[test]
    fn cancellation_during_copy_or_before_publication_removes_temporary_files() {
        // Checks 2 and 5 interrupt mid-copy and before claiming the final name.
        for cancel_at in [2, 5] {
            let staging = TempDir::new().unwrap();
            let source = staging.path().join("pack.zip");
            let bytes = vec![42; 2 * 128 * 1024 + 1];
            std::fs::write(&source, &bytes).unwrap();
            let destination = TempDir::new().unwrap();
            let mut checks = 0;
            let error = publish_file_with_cancel(&source, destination.path(), || {
                checks += 1;
                if checks == cancel_at {
                    Err(io::Error::new(ErrorKind::Interrupted, "cancelled"))
                } else {
                    Ok(())
                }
            })
            .unwrap_err();
            assert_eq!(error.kind(), ErrorKind::Interrupted);
            assert_eq!(checks, cancel_at);
            assert!(dir_names(destination.path()).is_empty());
            assert_eq!(std::fs::read(&source).unwrap(), bytes);
        }
    }

    #[test]
    fn exhausted_collision_names_preserve_existing_files_and_remove_temporary_file() {
        let staging = TempDir::new().unwrap();
        let source = staging.path().join("mod.jar");
        write_jar(&source, "new");
        let mods = TempDir::new().unwrap();
        for number in 1..=MAX_NAME_ATTEMPTS {
            std::fs::write(
                mods.path().join(numbered_file_name("mod.jar", number)),
                b"existing",
            )
            .unwrap();
        }
        let error = publish_file_with_cancel(&source, mods.path(), || Ok(())).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::AlreadyExists);
        assert_eq!(dir_names(mods.path()).len(), MAX_NAME_ATTEMPTS);
        for entry in std::fs::read_dir(mods.path()).unwrap() {
            assert_eq!(std::fs::read(entry.unwrap().path()).unwrap(), b"existing");
        }
    }
}
