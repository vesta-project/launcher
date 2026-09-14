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
pub(crate) async fn prepare(staging: &StagingDir, dir: &Path, id: i32) -> Result<(), String> {
    let _serial = bundle::SERIAL.lock().await;
    let staged = staging
        .staged_path("options.txt")
        .map_err(|e| e.to_string())?;
    let current = crate::game_options_file::load(dir)?;
    if !current.exists {
        return Ok(());
    }
    let local = crate::game_options_file::read_bytes(&dir.join("options.txt"))?
        .ok_or("Local options disappeared during update")?;
    let mut conn = get_config_conn().map_err(|e| e.to_string())?;
    let version = crate::commands::instances::get_instance(id)?.minecraft_version;
    let mut active = false;
    for category in [Category::GameOptions, Category::Keybinds] {
        let prefs = super::read(&mut conn, category)?.preferences;
        if prefs.enabled && prefs.instance_ids.contains(&id) {
            active = true;
            let mut shared = bundle::load(&mut conn, category)?;
            bundle::capture(category, &mut shared, &prefs, id, &version, &current.values);
            bundle::store(&mut conn, category, &shared)?;
        }
    }
    let Some(incoming) = crate::game_options_file::read_bytes(&staged)? else {
        return Ok(());
    };
    let bytes = if active {
        merge(&local, &incoming)?
    } else {
        local
    };
    staging
        .write_staged("options.txt", &bytes)
        .map_err(|e| e.to_string())
}
pub(crate) async fn restore(id: i32) {
    for result in [
        super::game_options::restore_after_pack_update(id).await,
        super::keybinds::restore_after_pack_update(id).await,
    ] {
        if let Err(error) = result {
            log::warn!("Settings sync after pack update: {error}");
        }
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
}
