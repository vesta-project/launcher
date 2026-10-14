//! Adds `.jar` files dropped onto an instance card to that instance's `mods`
//! folder, then identifies them against Modrinth and CurseForge.
//!
//! Paths come from the renderer and are untrusted, so every source is
//! re-validated here. Invalid sources are skipped and counted; they never abort
//! the valid ones. A published file never replaces an existing file.

use crate::notifications::models::{NotificationContext, PROGRESS_INDETERMINATE};
use crate::resources::reconciliation::{
    prepare_candidates_with_progress, reconcile_prepared_candidates,
    unresolved_candidates_for_instance,
};
use crate::resources::watcher::ResourceWatcher;
use crate::tasks::manager::{mods_conflict_key, BoxFuture, Task, TaskContext};
use crate::utils::instance_helpers::normalize_path;
use crate::utils::network::{NetworkManager, NetworkStatus};
use std::collections::HashSet;
use std::fs::File;
use std::io::{self, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

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
    CopyFailed,
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
            SkipReason::CopyFailed => "could not be copied",
        }
    }
}

/// What the identification pass learned about the files that were added.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Identification {
    /// The lookup ran; `identified` files matched a provider.
    Checked { identified: usize },
    /// Lookup was skipped because the app is offline.
    Offline,
    /// The added files were not visible to the resource ledger for matching.
    Unknown,
    /// The lookup failed after the files were already copied.
    Failed,
}

pub struct AddDroppedModsTask {
    instance_id: i32,
    instance_name: String,
    game_dir: PathBuf,
    sources: Vec<PathBuf>,
    outcome: Arc<Mutex<Option<String>>>,
}

impl AddDroppedModsTask {
    pub(crate) fn new(
        instance_id: i32,
        instance_name: impl Into<String>,
        game_dir: PathBuf,
        sources: Vec<PathBuf>,
    ) -> Self {
        Self {
            instance_id,
            instance_name: instance_name.into(),
            game_dir,
            sources,
            outcome: Arc::new(Mutex::new(None)),
        }
    }
}

impl Task for AddDroppedModsTask {
    fn name(&self) -> String {
        if self.sources.len() == 1 {
            format!("Adding dropped mod to {}", self.instance_name)
        } else {
            format!(
                "Adding {} dropped mods to {}",
                self.sources.len(),
                self.instance_name
            )
        }
    }

    fn notification_context(&self) -> Option<NotificationContext> {
        Some(NotificationContext::instance(
            self.instance_id,
            Some(self.instance_name.clone()),
        ))
    }

    fn conflict_keys(&self) -> Vec<String> {
        vec![mods_conflict_key(self.instance_id)]
    }

    fn show_completion_notification(&self) -> bool {
        true
    }

    fn starting_description(&self) -> String {
        "Copying…".to_string()
    }

    fn completion_description(&self) -> String {
        self.outcome
            .lock()
            .ok()
            .and_then(|slot| slot.clone())
            .unwrap_or_else(|| format!("Added dropped mod to {}.", self.instance_name))
    }

    fn run(&self, ctx: TaskContext) -> BoxFuture<'static, Result<(), String>> {
        let app_handle = ctx.app_handle.clone();
        let instance_id = self.instance_id;
        let instance_name = self.instance_name.clone();
        let game_dir = self.game_dir.clone();
        let sources = self.sources.clone();
        let outcome = self.outcome.clone();
        Box::pin(async move {
            let mods_dir = game_dir.join("mods");
            let total = sources.len();

            let mods_for_setup = mods_dir.clone();
            tauri::async_runtime::spawn_blocking(move || std::fs::create_dir_all(&mods_for_setup))
                .await
                .map_err(|_| "Could not prepare the mods folder".to_string())?
                .map_err(|_| "Could not prepare the mods folder".to_string())?;

            let mut published: Vec<PathBuf> = Vec::with_capacity(total);
            let mut skipped: Vec<SkipReason> = Vec::new();
            for (index, source) in sources.into_iter().enumerate() {
                ctx.update_full(
                    PROGRESS_INDETERMINATE,
                    format!("Copying mod {}/{}…", index + 1, total),
                    Some((index + 1) as i32),
                    Some(total as i32),
                );
                let mods = mods_dir.clone();
                let result =
                    tauri::async_runtime::spawn_blocking(move || add_source(&source, &mods))
                        .await
                        .unwrap_or(Err(SkipReason::CopyFailed));
                match result {
                    Ok(destination) => published.push(destination),
                    Err(reason) => {
                        log::info!(
                            "[add_dropped_mods] skipped a dropped file: {}",
                            reason.describe()
                        );
                        skipped.push(reason);
                    }
                }
            }

            log::info!(
                "[add_dropped_mods] instance {}: copied {} file(s), skipped {}",
                instance_id,
                published.len(),
                skipped.len()
            );
            if published.is_empty() {
                return Err("No valid .jar files to add".to_string());
            }

            ctx.update_description("Detecting mod…".to_string());
            let identification = identify_published(
                &app_handle,
                instance_id,
                game_dir.to_string_lossy().into_owned(),
                &published,
            )
            .await;

            let added: Vec<String> = published
                .iter()
                .map(|path| {
                    path.file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("mod.jar")
                        .to_string()
                })
                .collect();
            let text = outcome_text(&instance_name, &added, identification, &skipped);
            if let Ok(mut slot) = outcome.lock() {
                *slot = Some(text);
            }
            Ok(())
        })
    }
}

/// Validates one dropped file and publishes it into `mods_dir`.
fn add_source(source: &Path, mods_dir: &Path) -> Result<PathBuf, SkipReason> {
    validate_source(source)?;
    publish_jar(source, mods_dir).map_err(|error| {
        log::warn!("[add_dropped_mods] copy failed: {:?}", error.kind());
        SkipReason::CopyFailed
    })
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

/// Copies `source` into `mods_dir` without ever exposing a partial file under a
/// resource name and without replacing an existing entry.
///
/// The bytes go to a hidden `.vesta-drop-*.tmp` file in the same directory
/// first, so the file watcher never sees a partial `.jar`. The final name is
/// then claimed with a no-replace rename (`tempfile::persist_noclobber`), which
/// fails rather than overwriting if the name appeared in the meantime. The temp
/// file is removed on every failure path.
pub(crate) fn publish_jar(source: &Path, mods_dir: &Path) -> io::Result<PathBuf> {
    publish_file_with_cancel(source, mods_dir, || Ok(()))
}

/// Same atomic no-clobber publication for normalized packs and jars. The caller
/// validates format and destination scope; cancellation is checked per chunk
/// and immediately before claiming the final name.
pub(crate) fn publish_file_with_cancel(
    source: &Path,
    mods_dir: &Path,
    mut check_cancel: impl FnMut() -> io::Result<()>,
) -> io::Result<PathBuf> {
    let file_name = safe_file_name(source)
        .map_err(|reason| io::Error::new(ErrorKind::InvalidInput, reason.describe()))?;
    let mut input = File::open(source)?;
    // Re-check after opening so a symlink swapped in after validation is refused.
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

/// Registers the copied files with the resource ledger and identifies them.
/// Never fails: problems are reported as an `Identification` so the copy stays
/// reported as successful.
async fn identify_published(
    app_handle: &AppHandle,
    instance_id: i32,
    game_dir: String,
    published: &[PathBuf],
) -> Identification {
    let wanted: HashSet<String> = published.iter().map(|path| normalize_path(path)).collect();

    let watcher = app_handle.state::<ResourceWatcher>();
    if let Err(error) = watcher.refresh_instance(instance_id, game_dir).await {
        log::warn!("[add_dropped_mods] resource refresh failed: {error}");
        return Identification::Failed;
    }

    let candidates = match unresolved_candidates_for_instance(instance_id, None) {
        Ok(candidates) => candidates,
        Err(error) => {
            log::warn!("[add_dropped_mods] could not load candidates: {error}");
            return Identification::Failed;
        }
    };
    let candidates: Vec<_> = candidates
        .into_iter()
        .filter(|candidate| wanted.contains(&normalize_path(&candidate.path)))
        .collect();
    if candidates.is_empty() {
        return Identification::Unknown;
    }

    let prepared = prepare_candidates_with_progress(instance_id, candidates, None).await;
    if prepared.is_empty() {
        return Identification::Unknown;
    }

    let result =
        reconcile_prepared_candidates(app_handle, instance_id, prepared, "dropped-mod").await;
    let offline = app_handle.state::<NetworkManager>().get_status() == NetworkStatus::Offline;
    match result {
        Ok(summary) if summary.identified > 0 => Identification::Checked {
            identified: summary.identified,
        },
        Ok(_) if offline => Identification::Offline,
        Ok(summary) => Identification::Checked {
            identified: summary.identified,
        },
        Err(_) if offline => Identification::Offline,
        Err(error) => {
            log::warn!("[add_dropped_mods] identification failed: {error}");
            Identification::Failed
        }
    }
}

/// Plain-English summary for the completion notification. File names are
/// included; full paths never are.
fn outcome_text(
    instance_name: &str,
    added: &[String],
    identification: Identification,
    skipped: &[SkipReason],
) -> String {
    let count = added.len();
    let mut text = if count == 1 {
        let name = &added[0];
        match identification {
            Identification::Checked { identified } if identified > 0 => {
                format!("Added {name} to {instance_name} and identified it.")
            }
            Identification::Checked { .. } => format!(
                "Added {name} to {instance_name}. It wasn't recognised on Modrinth or CurseForge, so it's listed as a local mod."
            ),
            Identification::Offline => format!(
                "Added {name} to {instance_name}. Couldn't check online, so it's listed as a local mod until you're back online."
            ),
            Identification::Unknown => format!(
                "Added {name} to {instance_name}, but its Modrinth and CurseForge status is unknown."
            ),
            Identification::Failed => format!(
                "Added {name} to {instance_name} but couldn't identify it (the Modrinth and CurseForge lookup failed)."
            ),
        }
    } else {
        match identification {
            Identification::Checked { identified } => {
                format!("Added {count} mods to {instance_name}; identified {identified}.")
            }
            Identification::Offline => format!(
                "Added {count} mods to {instance_name}. Couldn't check online, so they're listed as local mods until you're back online."
            ),
            Identification::Unknown => format!(
                "Added {count} mods to {instance_name}, but their Modrinth and CurseForge status is unknown."
            ),
            Identification::Failed => format!(
                "Added {count} mods to {instance_name} but couldn't identify them (the Modrinth and CurseForge lookup failed)."
            ),
        }
    };

    if !skipped.is_empty() {
        let mut reasons: Vec<&'static str> = Vec::new();
        for reason in skipped {
            let description = reason.describe();
            if !reasons.contains(&description) {
                reasons.push(description);
            }
        }
        text.push_str(&format!(
            " Skipped {} file(s): {}.",
            skipped.len(),
            reasons.join(", ")
        ));
    }
    text
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
        let destination = publish_jar(&source, &mods).unwrap();

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

        let added = publish_jar(&first, &mods).unwrap();
        assert_eq!(added, mods.join("mod (2).jar"));
        assert_eq!(
            std::fs::read(&existing).unwrap(),
            b"original mod, must survive"
        );
        assert_eq!(
            std::fs::read(&added).unwrap(),
            std::fs::read(&first).unwrap()
        );

        let third = publish_jar(&second, &mods).unwrap();
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

        publish_jar(&source, &mods).unwrap();
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

        assert!(publish_jar(&folder, &mods).is_err());
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
        let destination = publish_jar(&source, &mods).unwrap();
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
    fn outcome_identified_single() {
        assert_eq!(
            outcome_text(
                "Test Pack",
                &["sodium.jar".to_string()],
                Identification::Checked { identified: 1 },
                &[],
            ),
            "Added sodium.jar to Test Pack and identified it."
        );
    }

    #[test]
    fn outcome_unrecognised_single() {
        let text = outcome_text(
            "Test Pack",
            &["custom.jar".to_string()],
            Identification::Checked { identified: 0 },
            &[],
        );
        assert_eq!(
            text,
            "Added custom.jar to Test Pack. It wasn't recognised on Modrinth or CurseForge, so it's listed as a local mod."
        );
    }

    #[test]
    fn outcome_offline_single() {
        let text = outcome_text(
            "Test Pack",
            &["custom.jar".to_string()],
            Identification::Offline,
            &[],
        );
        assert!(text.contains("Couldn't check online"));
        assert!(text.ends_with("until you're back online."));
    }

    #[test]
    fn outcome_failed_and_unknown_single() {
        let failed = outcome_text(
            "Test Pack",
            &["custom.jar".to_string()],
            Identification::Failed,
            &[],
        );
        assert!(failed.starts_with("Added custom.jar to Test Pack but couldn't identify it"));

        let unknown = outcome_text(
            "Test Pack",
            &["custom.jar".to_string()],
            Identification::Unknown,
            &[],
        );
        assert!(unknown.contains("status is unknown"));
    }

    #[test]
    fn outcome_multiple_reports_counts() {
        let added = vec![
            "a.jar".to_string(),
            "b.jar".to_string(),
            "c.jar".to_string(),
        ];
        assert_eq!(
            outcome_text(
                "Test Pack",
                &added,
                Identification::Checked { identified: 2 },
                &[],
            ),
            "Added 3 mods to Test Pack; identified 2."
        );
    }

    #[test]
    fn outcome_lists_each_skip_reason_once() {
        let text = outcome_text(
            "Test Pack",
            &["sodium.jar".to_string()],
            Identification::Checked { identified: 1 },
            &[
                SkipReason::WrongExtension,
                SkipReason::NotZipArchive,
                SkipReason::WrongExtension,
            ],
        );
        assert_eq!(
            text,
            "Added sodium.jar to Test Pack and identified it. Skipped 3 file(s): not a .jar file, not a valid .jar archive."
        );
    }

    #[test]
    fn outcome_never_contains_a_path() {
        let text = outcome_text(
            "Test Pack",
            &["sodium.jar".to_string()],
            Identification::Failed,
            &[SkipReason::Symlink],
        );
        assert!(!text.contains('/'));
        assert!(!text.contains('\\'));
    }

    #[test]
    fn task_metadata_matches_contract() {
        let single = AddDroppedModsTask::new(
            7,
            "Test Pack",
            PathBuf::from("/games/test"),
            vec![PathBuf::from("/tmp/a.jar")],
        );
        assert_eq!(single.name(), "Adding dropped mod to Test Pack");
        assert_eq!(single.conflict_keys(), vec!["mods:7".to_string()]);
        assert!(single.show_completion_notification());
        assert_eq!(single.id(), None);
        assert_eq!(
            single.completion_description(),
            "Added dropped mod to Test Pack."
        );

        let many = AddDroppedModsTask::new(
            7,
            "Test Pack",
            PathBuf::from("/games/test"),
            vec![PathBuf::from("/tmp/a.jar"), PathBuf::from("/tmp/b.jar")],
        );
        assert_eq!(many.name(), "Adding 2 dropped mods to Test Pack");
    }

    #[test]
    fn completion_description_returns_stored_outcome() {
        let task = AddDroppedModsTask::new(
            7,
            "Test Pack",
            PathBuf::from("/games/test"),
            vec![PathBuf::from("/tmp/a.jar")],
        );
        *task.outcome.lock().unwrap() = Some("Added a.jar to Test Pack and identified it.".into());
        assert_eq!(
            task.completion_description(),
            "Added a.jar to Test Pack and identified it."
        );
    }
}
