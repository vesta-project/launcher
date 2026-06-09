use std::collections::{BTreeMap, HashMap};

use piston_lib::game::modpack::manifest::{
    ModSource, ModpackManifest, ModpackManifestMod,
};

use super::action_tree::{ActionTree, FileSource, RemoveReason, SkipReason, SyncAction};
use super::classifier::{classify, is_world_save, world_folder_from_level_dat, FileClass};
use super::manifest::FileHash;

/// The ThreeWayDiffer takes three data sources:
///   $O$ — Old base manifest (what the pack was supposed to look like)
///   $C$ — Current client directory (sha1 hashes of actual files on disk)
///   $N$ — New base manifest (what the pack wants to look like now)
///
/// And produces an ActionTree of ADD/UPDATE/REMOVE/MERGE/SKIP actions.
pub struct ThreeWayDiffer;

impl ThreeWayDiffer {
    /// Run the full three-way diff and return the action tree.
    pub fn diff(
        old: &ModpackManifest,
        current_hashes: &HashMap<String, FileHash>,
        new: &ModpackManifest,
    ) -> ActionTree {
        let mut tree = ActionTree::new();

        // Build lookup maps (lowercase keys for case normalization)
        let old_mods = build_mod_map(&old.mods);
        let new_mods = build_mod_map(&new.mods);
        let old_overrides = build_override_set(&old.overrides.extracted);
        let new_overrides = build_override_set(&new.overrides.extracted);

        // Collect all paths from both manifests
        let mut all_paths: BTreeMap<String, ()> = BTreeMap::new();
        for m in &old.mods {
            all_paths.insert(m.path.to_lowercase(), ());
        }
        for m in &new.mods {
            all_paths.insert(m.path.to_lowercase(), ());
        }
        for ov in &old.overrides.extracted {
            all_paths.insert(ov.to_lowercase(), ());
        }
        for ov in &new.overrides.extracted {
            all_paths.insert(ov.to_lowercase(), ());
        }

        // Process each unique path
        for lower_path in all_paths.keys() {
            let file_class = classify(lower_path);

            // Look up in old and new
            let old_mod = old_mods.get(lower_path).copied();
            let new_mod = new_mods.get(lower_path).copied();
            let in_old_overrides = old_overrides.contains(lower_path);
            let in_new_overrides = new_overrides.contains(lower_path);

            let old_hash = old.expected_content_hash(lower_path, old_mod);
            let new_hash = new.expected_content_hash(lower_path, new_mod);
            let current = current_hashes.get(lower_path);

            // Determine the original path (not lowercased) from whichever manifest has it
            let display_path = new_mod
                .map(|m| m.path.clone())
                .or_else(|| old_mod.map(|m| m.path.clone()))
                .unwrap_or_else(|| lower_path.clone());

            match file_class {
                FileClass::Binary => {
                    Self::handle_binary(
                        &mut tree,
                        &display_path,
                        lower_path,
                        old_mod,
                        new_mod,
                        in_old_overrides,
                        in_new_overrides,
                        &old_hash,
                        &new_hash,
                        current,
                    );
                }
                FileClass::Text => {
                    Self::handle_text(
                        &mut tree,
                        &display_path,
                        lower_path,
                        old_mod,
                        new_mod,
                        in_old_overrides,
                        in_new_overrides,
                        &old_hash,
                        &new_hash,
                        current,
                    );
                }
                // Untracked files (Category C in MODPACK_UPDATING.md) are not in either
                // manifest and are intentionally excluded from this diff loop.
            }
        }

        // Check for world collisions
        Self::detect_world_collisions(&mut tree, old, current_hashes, new);

        tree
    }

    fn handle_binary(
        tree: &mut ActionTree,
        display_path: &str,
        _lower_path: &str,
        old_mod: Option<&ModpackManifestMod>,
        new_mod: Option<&ModpackManifestMod>,
        in_old_overrides: bool,
        in_new_overrides: bool,
        old_hash: &Option<String>,
        new_hash: &Option<String>,
        current: Option<&FileHash>,
    ) {
        let cur_hash = current.map(|c| &c.hash);

        match (old_mod, new_mod) {
            // File in both old and new
            (Some(old_m), Some(new_m)) => {
                if let Some(ch) = cur_hash {
                    if let Some(oh) = old_hash {
                        if ch.to_lowercase() != oh.to_lowercase() {
                            // User modified binary → protect
                            tree.add_action(SyncAction::Skip {
                                path: display_path.to_string(),
                                reason: SkipReason::UserModifiedBinary,
                            });
                            tree.protected_count += 1;
                            return;
                        }
                    }
                }

                // Check if update is needed
                if cur_hash.map(|h| h.to_lowercase()) != new_hash.as_ref().map(|h| h.to_lowercase())
                {
                    tree.add_action(SyncAction::Update {
                        path: display_path.to_string(),
                        source: mod_source_to_file_source(new_m),
                        old_hash: old_hash.clone(),
                        new_hash: new_hash.clone(),
                    });
                } else {
                    tree.add_action(SyncAction::Skip {
                        path: display_path.to_string(),
                        reason: SkipReason::AlreadyCurrent,
                    });
                }
            }
            // File only in new (add)
            (None, Some(new_m)) => {
                tree.add_action(SyncAction::Add {
                    path: display_path.to_string(),
                    source: mod_source_to_file_source(new_m),
                    expected_hash: new_hash.clone(),
                });
            }
            // File only in old (remove)
            (Some(_old_m), None) => {
                let should_remove = match cur_hash {
                    Some(ch) => {
                        // Only remove if user hasn't modified it
                        old_hash
                            .as_ref()
                            .map_or(true, |oh| ch.to_lowercase() == oh.to_lowercase())
                    }
                    None => true, // File doesn't exist on disk, nothing to remove
                };

                if should_remove {
                    tree.add_action(SyncAction::Remove {
                        path: display_path.to_string(),
                        reason: RemoveReason::AuthorRemoved,
                        last_hash: old_hash.clone(),
                    });
                } else {
                    tree.add_action(SyncAction::Skip {
                        path: display_path.to_string(),
                        reason: SkipReason::UserModified,
                    });
                    tree.protected_count += 1;
                }
            }
            // File in neither (shouldn't reach here)
            (None, None) => {}
        }

        // Mod entries take precedence — overrides are for non-mod paths only.
        if old_mod.is_some() || new_mod.is_some() {
            return;
        }

        // Handle overrides (configs, scripts, etc. that aren't mods)
        if in_old_overrides && !in_new_overrides {
            // Override removed — delete if user hasn't modified
            let should_remove = match cur_hash {
                Some(ch) => old_hash
                    .as_ref()
                    .map_or(true, |oh| ch.to_lowercase() == oh.to_lowercase()),
                None => true,
            };
            if should_remove {
                tree.add_action(SyncAction::Remove {
                    path: display_path.to_string(),
                    reason: RemoveReason::AuthorRemoved,
                    last_hash: old_hash.clone(),
                });
            } else {
                tree.add_action(SyncAction::Skip {
                    path: display_path.to_string(),
                    reason: SkipReason::UserModified,
                });
                tree.protected_count += 1;
            }
        } else if !in_old_overrides && in_new_overrides {
            // New override added
            tree.add_action(SyncAction::Add {
                path: display_path.to_string(),
                source: FileSource::ZipOverride {
                    relative_path: display_path.to_string(),
                },
                expected_hash: None,
            });
        }
    }

    fn handle_text(
        tree: &mut ActionTree,
        display_path: &str,
        _lower_path: &str,
        old_mod: Option<&ModpackManifestMod>,
        new_mod: Option<&ModpackManifestMod>,
        in_old_overrides: bool,
        in_new_overrides: bool,
        old_hash: &Option<String>,
        _new_hash: &Option<String>,
        current: Option<&FileHash>,
    ) {
        // Text files are always overrides (configs), not mod entries
        let in_old = in_old_overrides || old_mod.is_some();
        let in_new = in_new_overrides || new_mod.is_some();

        let cur_hash = current.map(|c| &c.hash);

        match (in_old, in_new) {
            // In both → try merge
            (true, true) => {
                if let Some(ch) = cur_hash {
                    if let Some(oh) = old_hash {
                        if ch.to_lowercase() == oh.to_lowercase() {
                            // User didn't change → just update to new version
                            tree.add_action(SyncAction::Add {
                                path: display_path.to_string(),
                                source: FileSource::ZipOverride {
                                    relative_path: display_path.to_string(),
                                },
                                expected_hash: None,
                            });
                            return;
                        }
                    }
                }

                // User may have changed — flag for merge
                tree.add_action(SyncAction::Merge {
                    path: display_path.to_string(),
                    merged_content: String::new(), // Will be resolved in Phase 2
                    old_hash: old_hash.clone(),
                    new_hash: None,
                });
            }
            // Only in new
            (false, true) => {
                tree.add_action(SyncAction::Add {
                    path: display_path.to_string(),
                    source: FileSource::ZipOverride {
                        relative_path: display_path.to_string(),
                    },
                    expected_hash: None,
                });
            }
            // Only in old — author dropped this config from the new pack; keep local copy
            (true, false) => {
                tree.add_action(SyncAction::Skip {
                    path: display_path.to_string(),
                    reason: SkipReason::NotInNewVersion,
                });
                tree.protected_count += 1;
            }
            (false, false) => {}
        }
    }

    /// Detect world save collisions: if a world folder exists in the new manifest
    /// but the user's current level.dat hash differs from the old manifest hash.
    fn detect_world_collisions(
        tree: &mut ActionTree,
        old: &ModpackManifest,
        current_hashes: &HashMap<String, FileHash>,
        new: &ModpackManifest,
    ) {
        let old_level_dats: HashMap<String, Option<String>> = old
            .overrides
            .extracted
            .iter()
            .filter(|p| is_world_save(p))
            .map(|p| {
                let hash = old.overrides.hashes.get(&p.to_lowercase()).cloned();
                (p.to_lowercase(), hash)
            })
            .collect();

        for n_path in &new.overrides.extracted {
            if !is_world_save(n_path) {
                continue;
            }

            let lower = n_path.to_lowercase();
            if let Some(Some(expected_old_hash)) = old_level_dats.get(&lower) {
                if let Some(current_fh) = current_hashes.get(&lower) {
                    if current_fh.hash.to_lowercase() != expected_old_hash.to_lowercase() {
                        let Some(world_folder) = world_folder_from_level_dat(n_path) else {
                            continue;
                        };
                        let quarantine = build_quarantine_path(&world_folder);
                        tree.add_world_collision(world_folder.clone(), quarantine.clone());
                        tree.add_action(SyncAction::RotateWorld {
                            original_path: world_folder,
                            quarantine_path: quarantine,
                            old_level_dat_hash: Some(expected_old_hash.clone()),
                        });
                    }
                }
            }
        }
    }
}

/// Build a lowercase-keyed map of mod entries for case-insensitive lookup.
fn build_mod_map(mods: &[ModpackManifestMod]) -> HashMap<String, &ModpackManifestMod> {
    let mut map = HashMap::new();
    for m in mods {
        map.insert(m.path.to_lowercase(), m);
    }
    map
}

/// Build a set of lowercase override paths.
fn build_override_set(overrides: &[String]) -> std::collections::HashSet<String> {
    overrides.iter().map(|o| o.to_lowercase()).collect()
}

/// Convert a ModSource from the manifest into a FileSource for download.
fn mod_source_to_file_source(m: &ModpackManifestMod) -> FileSource {
    match &m.source {
        ModSource::Modrinth {
            project_id: _,
            version_id: _,
            url,
        } => FileSource::Modrinth {
            url: url.clone(),
            sha1: m.sha1.clone(),
            filename: extract_filename(&m.path),
        },
        ModSource::CurseForge {
            project_id,
            file_id,
            url,
        } => {
            let subfolder = guess_subfolder(&m.path);
            FileSource::CurseForge {
                url: url.clone(),
                project_id: *project_id,
                file_id: *file_id,
                filename: extract_filename(&m.path),
                subfolder,
                sha1: m.sha1.clone(),
            }
        }
    }
}

/// Extract just the filename from a relative path.
fn extract_filename(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

/// Guess the subfolder for a mod based on its path.
fn guess_subfolder(path: &str) -> String {
    let lower = path.to_lowercase();
    if lower.starts_with("resourcepacks") {
        "resourcepacks".into()
    } else if lower.starts_with("shaderpacks") {
        "shaderpacks".into()
    } else if lower.starts_with("datapacks") {
        "datapacks".into()
    } else if lower.starts_with("saves") {
        "saves".into()
    } else {
        "mods".into()
    }
}

/// Build a quarantine path for a world folder (e.g. `saves/MyWorld`).
fn build_quarantine_path(world_folder: &str) -> String {
    let now = chrono::Utc::now();
    let timestamp = now.format("%Y%m%d_%H%M").to_string();

    let parts: Vec<&str> = world_folder.split('/').collect();
    let world_name = parts.last().copied().unwrap_or("world");

    format!("saves/{}_{}", world_name, timestamp)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_manifest(
        mods: Vec<ModpackManifestMod>,
        overrides: Vec<String>,
    ) -> ModpackManifest {
        ModpackManifest {
            source: piston_lib::game::modpack::types::ModpackFormat::Modrinth,
            modpack_id: Some("test-pack".into()),
            name: "Test Pack".into(),
            version: "1.0.0".into(),
            installed_at: "2024-01-01T00:00:00Z".into(),
            minecraft_version: "1.20.1".into(),
            modloader: piston_lib::game::modpack::manifest::ModpackManifestModloader {
                loader_type: "fabric".into(),
                version: Some("0.15.0".into()),
            },
            mods,
            overrides: piston_lib::game::modpack::manifest::ModpackManifestOverrides {
                extracted: overrides,
                skipped_configs: vec![],
                hashes: std::collections::HashMap::new(),
            },
            source_zip_path: None,
        }
    }

    fn make_mod(path: &str, sha1: &str) -> ModpackManifestMod {
        ModpackManifestMod {
            source: ModSource::Modrinth {
                project_id: "test-proj".into(),
                version_id: "test-ver".into(),
                url: "https://cdn.modrinth.com/test".into(),
            },
            path: path.to_string(),
            sha1: Some(sha1.to_string()),
            size: Some(1000),
        }
    }

    #[test]
    fn test_diff_mod_unchanged() {
        let old = make_test_manifest(vec![make_mod("mods/A.jar", "sha1a")], vec![]);
        let new = make_test_manifest(vec![make_mod("mods/A.jar", "sha1a")], vec![]);

        let mut current = HashMap::new();
        current.insert(
            "mods/a.jar".to_string(),
            FileHash {
                path: "mods/A.jar".into(),
                hash: "sha1a".into(),
            },
        );

        let tree = ThreeWayDiffer::diff(&old, &current, &new);
        let skips: Vec<_> = tree
            .actions
            .iter()
            .filter(|a| matches!(a, SyncAction::Skip { .. }))
            .collect();
        assert_eq!(skips.len(), 1, "Should skip unchanged mod");
    }

    #[test]
    fn test_diff_mod_updated() {
        let old = make_test_manifest(vec![make_mod("mods/A.jar", "sha1a")], vec![]);
        let new = make_test_manifest(vec![make_mod("mods/A.jar", "sha1b")], vec![]);

        let mut current = HashMap::new();
        current.insert(
            "mods/a.jar".to_string(),
            FileHash {
                path: "mods/A.jar".into(),
                hash: "sha1a".into(),
            },
        );

        let tree = ThreeWayDiffer::diff(&old, &current, &new);
        let updates: Vec<_> = tree
            .actions
            .iter()
            .filter(|a| matches!(a, SyncAction::Update { .. }))
            .collect();
        assert_eq!(updates.len(), 1, "Should update changed mod");
    }

    #[test]
    fn test_diff_mod_added() {
        let old = make_test_manifest(vec![], vec![]);
        let new = make_test_manifest(vec![make_mod("mods/B.jar", "sha1b")], vec![]);
        let current = HashMap::new();

        let tree = ThreeWayDiffer::diff(&old, &current, &new);
        let adds: Vec<_> = tree
            .actions
            .iter()
            .filter(|a| matches!(a, SyncAction::Add { .. }))
            .collect();
        assert_eq!(adds.len(), 1, "Should add new mod");
    }

    #[test]
    fn test_diff_mod_removed() {
        let old = make_test_manifest(vec![make_mod("mods/C.jar", "sha1c")], vec![]);
        let new = make_test_manifest(vec![], vec![]);

        let mut current = HashMap::new();
        current.insert(
            "mods/c.jar".to_string(),
            FileHash {
                path: "mods/C.jar".into(),
                hash: "sha1c".into(),
            },
        );

        let tree = ThreeWayDiffer::diff(&old, &current, &new);
        let removes: Vec<_> = tree
            .actions
            .iter()
            .filter(|a| matches!(a, SyncAction::Remove { .. }))
            .collect();
        assert_eq!(removes.len(), 1, "Should remove old mod");
    }

    #[test]
    fn test_diff_user_modified_binary_protected() {
        let old = make_test_manifest(vec![make_mod("mods/A.jar", "sha1a")], vec![]);
        let new = make_test_manifest(vec![make_mod("mods/A.jar", "sha1b")], vec![]);

        let mut current = HashMap::new();
        current.insert(
            "mods/a.jar".to_string(),
            FileHash {
                path: "mods/A.jar".into(),
                hash: "user_modified_sha1".into(),
            },
        );

        let tree = ThreeWayDiffer::diff(&old, &current, &new);
        assert_eq!(tree.protected_count, 1);
        let skips: Vec<_> = tree
            .actions
            .iter()
            .filter(|a| matches!(a, SyncAction::Skip { reason: SkipReason::UserModifiedBinary, .. }))
            .collect();
        assert_eq!(skips.len(), 1, "Should protect user-modified binary");
    }

    #[test]
    fn test_diff_case_insensitive_paths() {
        let old = make_test_manifest(vec![make_mod("mods/MyMod.jar", "sha1a")], vec![]);
        let new = make_test_manifest(vec![make_mod("mods/mymod.jar", "sha1a")], vec![]);

        let mut current = HashMap::new();
        current.insert(
            "mods/mymod.jar".to_string(),
            FileHash {
                path: "mods/mymod.jar".into(),
                hash: "sha1a".into(),
            },
        );

        let tree = ThreeWayDiffer::diff(&old, &current, &new);
        // Case difference should be normalized — no update needed
        let skips: Vec<_> = tree
            .actions
            .iter()
            .filter(|a| matches!(a, SyncAction::Skip { .. }))
            .collect();
        assert!(skips.len() >= 1, "Should normalize case");
        let updates: Vec<_> = tree
            .actions
            .iter()
            .filter(|a| matches!(a, SyncAction::Update { .. }))
            .collect();
        assert_eq!(updates.len(), 0, "Should not update on case-only difference");
    }

    #[test]
    fn test_world_collision_when_user_modified_level_dat() {
        let mut override_hashes = std::collections::HashMap::new();
        override_hashes.insert(
            "saves/myworld/level.dat".to_string(),
            "expected_old_hash".to_string(),
        );

        let old = ModpackManifest {
            source: piston_lib::game::modpack::types::ModpackFormat::Modrinth,
            modpack_id: Some("test-pack".into()),
            name: "Test Pack".into(),
            version: "1.0.0".into(),
            installed_at: "2024-01-01T00:00:00Z".into(),
            minecraft_version: "1.20.1".into(),
            modloader: piston_lib::game::modpack::manifest::ModpackManifestModloader {
                loader_type: "fabric".into(),
                version: Some("0.15.0".into()),
            },
            mods: vec![],
            overrides: piston_lib::game::modpack::manifest::ModpackManifestOverrides {
                extracted: vec!["saves/MyWorld/level.dat".into()],
                skipped_configs: vec![],
                hashes: override_hashes,
            },
            source_zip_path: None,
        };
        let new = make_test_manifest(vec![], vec!["saves/MyWorld/level.dat".into()]);

        let mut current = HashMap::new();
        current.insert(
            "saves/myworld/level.dat".to_string(),
            FileHash {
                path: "saves/MyWorld/level.dat".into(),
                hash: "user_modified_hash".into(),
            },
        );

        let tree = ThreeWayDiffer::diff(&old, &current, &new);
        assert_eq!(
            tree.world_collisions.len(),
            1,
            "Should detect world collision when level.dat hash differs from manifest"
        );
    }
}
