//! Signed server source adapter for the ordinary instance update engine.
use crate::servers::pack_sync::{self, Prepared, Receipt};
use crate::sync::action_tree::{ActionTree, FileSource, RemoveReason, SyncAction};
use piston_lib::game::modpack::{
    manifest::{ModpackManifest, ModpackManifestModloader, ModpackManifestOverrides},
    types::ModpackFormat,
};
use std::{collections::HashMap, io::Write, path::Path, sync::Arc};

pub(crate) fn receipt(review: &Prepared) -> Receipt {
    Receipt {
        revision: review.release.revision.clone(),
        sha256: review.release.sha256.clone(),
        runtime: review.preview.runtime.clone(),
        files: review.files.clone(),
    }
}
/// Legacy adapter receipts are admitted as an old manifest only after the signed
/// binding and every owned-file precondition have been checked by the source.
pub(crate) fn plan(root: &Path, review: &Prepared) -> Result<super::engine::UpdatePlan, String> {
    verify_baseline(root, review)?;
    let changes =
        pack_sync::diff(root, review.old.as_ref(), &review.files).map_err(|e| e.to_string())?;
    if review.preview.instance_id.is_some()
        && serde_json::to_value(&changes).unwrap()
            != serde_json::to_value(&review.preview.changes).unwrap()
    {
        return Err("pack_review_stale".into());
    }
    let template = |version: String| ModpackManifest {
        source: ModpackFormat::Modrinth,
        modpack_id: Some(review.provider_pack.as_ref().map_or_else(|| review.release.server_id.clone(), |p| p.project.clone())),
        name: review.preview.name.clone(),
        version,
        installed_at: String::new(),
        minecraft_version: review.preview.runtime.minecraft_version.clone(),
        modloader: ModpackManifestModloader {
            loader_type: review.preview.runtime.loader.clone(),
            version: review.preview.runtime.loader_version.clone(),
        },
        mods: vec![],
        overrides: ModpackManifestOverrides {
            extracted: vec![],
            skipped_configs: vec![],
            hashes: HashMap::new(),
        },
        source_zip_path: None,
    };
    let mut old = template(
        review
            .old
            .as_ref()
            .map_or_else(|| "0".into(), |r| r.revision.clone()),
    );
    if let Some(receipt) = &review.old {
        for path in receipt.files.keys() {
            old.overrides.extracted.push(path.clone());
            match std::fs::read(pack_sync::confined(root, path).map_err(|e| e.to_string())?) {
                Ok(bytes) => {
                    old.overrides.hashes.insert(
                        path.to_lowercase(),
                        crate::utils::hash::calculate_sha1_from_bytes(&bytes),
                    );
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.to_string()),
            }
        }
    }
    let mut new = template(review.release.revision.clone());
    let zip_path = review.stage.path().join("reviewed-client.zip");
    let mut zip = zip::ZipWriter::new(std::fs::File::create(&zip_path).map_err(|e| e.to_string())?);
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("modrinth.index.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(br#"{"formatVersion":1,"game":"minecraft","versionId":"server","name":"Server pack","files":[],"dependencies":{}}"#).map_err(|e|e.to_string())?;
    for (path, hash) in &review.files {
        let bytes = std::fs::read(review.stage.path().join(path)).map_err(|e| e.to_string())?;
        if &pack_sync::digest(&bytes) != hash {
            return Err("pack_integrity_failure".into());
        }
        new.overrides.extracted.push(path.clone());
        new.overrides.hashes.insert(
            path.to_lowercase(),
            crate::utils::hash::calculate_sha1_from_bytes(&bytes),
        );
        zip.start_file(format!("overrides/{path}"), options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    let mut actions = ActionTree::new();
    for change in changes {
        let path = change.path;
        let old_hash = old.overrides.hashes.get(&path.to_lowercase()).cloned();
        let new_hash = new.overrides.hashes.get(&path.to_lowercase()).cloned();
        let source = FileSource::ZipOverride {
            relative_path: path.clone(),
        };
        actions.add_action(match change.operation.as_str() {
            "remove" => SyncAction::Remove {
                path,
                reason: RemoveReason::AuthorRemoved,
                last_hash: old_hash,
            },
            "add" => SyncAction::Add {
                path,
                source,
                expected_hash: new_hash,
            },
            _ => SyncAction::Update {
                path,
                source,
                old_hash,
                new_hash,
            },
        });
    }
    Ok(super::engine::UpdatePlan {
        old_manifest: old,
        new_manifest: new,
        zip_path,
        format: ModpackFormat::Modrinth,
        actions,
        source: crate::tasks::update_modpack::UpdateSource::Provider,
        server_receipt: Some(serde_json::to_vec(&receipt(review)).map_err(|e| e.to_string())?),
    })
}

pub(crate) fn verify_baseline(root: &Path, review: &Prepared) -> Result<(), String> {
    let receipt = match std::fs::read(root.join(pack_sync::RECEIPT)) {
        Ok(b) => Some(serde_json::from_slice::<Receipt>(&b).map_err(|e| e.to_string())?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(e.to_string()),
    };
    if receipt.as_ref().map(|r| (&r.revision, &r.sha256))
        != review.old.as_ref().map(|r| (&r.revision, &r.sha256))
    {
        return Err("pack_review_stale".into());
    }
    let changes =
        pack_sync::diff(root, review.old.as_ref(), &review.files).map_err(|e| e.to_string())?;
    if review.preview.instance_id.is_some()
        && serde_json::to_value(changes).unwrap()
            != serde_json::to_value(&review.preview.changes).unwrap()
    {
        return Err("pack_review_stale".into());
    }
    Ok(())
}

pub(crate) fn verify_staged(
    staging: &crate::sync::staging::StagingDir,
    review: &Prepared,
) -> Result<(), String> {
    for change in &review.preview.changes {
        if change.operation == "remove" {
            continue;
        }
        let path = pack_sync::confined(staging.root(), &change.path).map_err(|e| e.to_string())?;
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        if review.files.get(&change.path) != Some(&pack_sync::digest(&bytes)) {
            return Err("pack_integrity_failure".into());
        }
    }
    Ok(())
}

impl crate::servers::ServerManager {
    pub(crate) async fn validate_update_review(
        &self,
        instance: &crate::models::instance::Instance,
        review: &Arc<Prepared>,
    ) -> vesta_server_client::Result<()> {
        if review.created.elapsed().as_secs() >= 900 {
            return Err(vesta_server_client::pack_sync::failure(
                "pack_review_expired",
            ));
        }
        let (active, _) = self
            .verified_release(&review.preview.connection_id, Some(instance))
            .await?;
        if active.revision != review.release.revision
            || active.sha256 != review.release.sha256
            || active.server_id != review.release.server_id
            || active.fingerprint != review.release.fingerprint
        {
            return Err(vesta_server_client::pack_sync::failure("pack_review_stale"));
        }
        Ok(())
    }
}
