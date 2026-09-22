//! The modpack updater supplies incoming options; settings sync owns their merge.
use super::{bundle, Category};
use crate::game_options::options_file::OptionsDocument;
use crate::sync::action_tree::{FileSource, SkipReason, SyncAction};
use crate::sync::staging::StagingDir;
use crate::utils::db::get_config_conn;
use std::{collections::BTreeMap, path::Path};

pub(crate) fn plan(path: &str, source: Option<FileSource>) -> SyncAction {
    match source {
        Some(source) => SyncAction::Update {
            path: path.into(),
            source,
            old_hash: None,
            new_hash: None,
        },
        None => SyncAction::Skip {
            path: path.into(),
            reason: SkipReason::NotInNewVersion,
        },
    }
}
/// Existing lines remain byte-for-byte local except the pack's real version.
/// New pack keys can join the document; selected bundles are overlaid after commit.
pub(crate) fn merge(current: &[u8], incoming: &[u8]) -> Result<Vec<u8>, String> {
    if current.len() > 1024 * 1024 || incoming.len() > 1024 * 1024 {
        return Err("options.txt exceeds 1 MiB".into());
    }
    let local = OptionsDocument::parse(current).map_err(str::to_owned)?;
    let pack = OptionsDocument::parse(incoming).map_err(str::to_owned)?;
    let existing = local.values();
    let changes: BTreeMap<String, String> = pack
        .values()
        .into_iter()
        .filter(|(key, _)| *key == "version" || !existing.contains_key(*key))
        .map(|(k, v)| (k.to_owned(), v.to_owned()))
        .collect();
    let merged = local.patched(&changes).map_err(str::to_owned)?;
    if merged.as_bytes().len() > 1024 * 1024 {
        return Err("Merged options.txt exceeds 1 MiB".into());
    }
    Ok(merged.as_bytes().to_vec())
}

fn prepared_bytes(current: &[u8], incoming: &[u8], active: bool) -> Result<Vec<u8>, String> {
    if active {
        merge(current, incoming)
    } else {
        Ok(current.to_vec())
    }
}

pub(crate) async fn prepare(staging: &StagingDir, dir: &Path, id: i32) -> Result<(), String> {
    let staged = staging
        .staged_path("options.txt")
        .map_err(|e| e.to_string())?;
    let local_path = crate::game_options_file::checked_path(dir)?;
    let files = tauri::async_runtime::spawn_blocking(move || {
        let local = crate::game_options_file::read_bytes(&local_path)?;
        let incoming = crate::game_options_file::read_bytes(&staged)?;
        Ok::<_, String>((local, incoming))
    })
    .await
    .map_err(|error| error.to_string())??;
    let (Some(local), Some(incoming)) = files else {
        return Ok(());
    };
    let serial = bundle::SERIAL.lock().await;
    let capture_source = local.clone();
    let active = tauri::async_runtime::spawn_blocking(move || {
        let mut conn = get_config_conn().map_err(|e| e.to_string())?;
        let mut active_categories = Vec::new();
        for category in [Category::GameOptions, Category::Keybinds] {
            let prefs = super::read(&mut conn, category)?.preferences;
            if prefs.enabled && prefs.instance_ids.contains(&id) {
                active_categories.push((category, prefs));
            }
        }
        if active_categories.is_empty() {
            return Ok::<_, String>(false);
        }
        let version = crate::commands::instances::get_instance(id)?.minecraft_version;
        let document = OptionsDocument::parse(&capture_source).map_err(str::to_owned)?;
        let values: BTreeMap<String, String> = document
            .values()
            .into_iter()
            .map(|(key, value)| (key.to_owned(), value.to_owned()))
            .collect();
        for (category, prefs) in active_categories {
            let mut shared = bundle::load(&mut conn, category)?;
            bundle::capture(category, &mut shared, &prefs, id, &version, &values);
            bundle::store(&mut conn, category, &shared)?;
        }
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())??;
    drop(serial);
    let staging = staging.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = prepared_bytes(&local, &incoming, active)?;
        staging
            .write_staged("options.txt", &bytes)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}
pub(crate) async fn restore(id: i32) -> Result<(), String> {
    let mut failures = Vec::new();
    for result in [
        super::game_options::restore_after_pack_update(id).await,
        super::keybinds::restore_after_pack_update(id).await,
    ] {
        if let Err(error) = result {
            failures.push(error);
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pack_keeps_unsynced_and_other_category_lines() {
        let merged = merge(
            b"# local\r\nversion:1\r\nfov:0.5\r\nkey_key.forward:17\r\ncustom:keep",
            b"version:2\nfov:0\nkey_key.forward:32\ncustom:pack\nrenderDistance:12",
        )
        .unwrap();
        let text = String::from_utf8(merged).unwrap();
        assert!(text
            .starts_with("# local\r\nversion:2\r\nfov:0.5\r\nkey_key.forward:17\r\ncustom:keep"));
        assert!(text.contains("renderDistance:12"));
    }

    #[test]
    fn pack_merge_preserves_cr_only_boundaries() {
        let merged = merge(
            b"version:1\rfov:0.5\rcustom:keep\r",
            b"version:2\rfov:0\rrenderDistance:12\r",
        )
        .unwrap();

        assert_eq!(
            merged,
            b"version:2\rfov:0.5\rcustom:keep\rrenderDistance:12\r"
        );
    }

    #[test]
    fn inactive_pack_prepare_preserves_non_utf8_bytes() {
        let current = [0xff, 0x00, b'\r', 0xfe];
        let incoming = [0xfd, b'\n'];
        assert_eq!(prepared_bytes(&current, &incoming, false).unwrap(), current);
    }
}
