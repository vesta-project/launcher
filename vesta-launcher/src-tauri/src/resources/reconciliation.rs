use crate::models::installed_resource::InstalledResource;
use crate::models::resource::{ResourceProject, ResourceVersion};
use crate::models::resource::{ResourceProjectPeerRecord, ResourceProjectRef, SourcePlatform};
use crate::resources::ledger::{
    self, InstalledResourceFact, LedgerBatchResult, ResourceProvenance,
};
use crate::resources::ResourceManager;
use crate::schema::vesta::resource_project_peer::dsl as peer_dsl;
use crate::utils::hash::{calculate_curseforge_fingerprint, calculate_sha1};
use crate::utils::instance_helpers::normalize_path;
use anyhow::Result;
use diesel::prelude::*;
use futures::stream::{self, StreamExt};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

pub const ROWS_CHANGED_EVENT: &str = "core://instance-resource-rows-changed";
pub const METADATA_CHANGED_EVENT: &str = "core://instance-resource-metadata-changed";

#[derive(Debug, Clone)]
pub struct ResourceCandidate {
    pub path: PathBuf,
    pub provenance: Option<ResourceProvenance>,
    pub preferred_platform: Option<SourcePlatform>,
    pub resolved: Option<KnownResourceResolution>,
}

#[derive(Debug, Clone)]
pub struct KnownResourceResolution {
    pub project: ResourceProject,
    pub version: ResourceVersion,
    pub platform: SourcePlatform,
}

#[derive(Debug, Clone)]
pub(crate) struct PreparedResourceCandidate {
    candidate: ResourceCandidate,
    sha1: Option<String>,
    curseforge_fingerprint: Option<String>,
    metadata: (i64, i64),
}

#[derive(Debug, Clone)]
struct DiscoveredResourceCandidate {
    candidate: ResourceCandidate,
    metadata: (i64, i64),
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReconciliationSummary {
    pub attempted: usize,
    pub changed: usize,
    pub identified: usize,
    pub unresolved: usize,
    pub metadata_refs: Vec<ResourceProjectRef>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRowsChanged {
    pub instance_id: i32,
    pub revision: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceMetadataChanged {
    pub instance_id: i32,
    pub revision: String,
    pub project_refs: Vec<ResourceProjectRef>,
    pub status: String,
}

fn platform_name(platform: SourcePlatform) -> &'static str {
    match platform {
        SourcePlatform::Modrinth => "modrinth",
        SourcePlatform::CurseForge => "curseforge",
    }
}

fn source_platform(value: &str) -> Option<SourcePlatform> {
    match value {
        "modrinth" => Some(SourcePlatform::Modrinth),
        "curseforge" => Some(SourcePlatform::CurseForge),
        _ => None,
    }
}

fn event_revision() -> String {
    chrono::Utc::now()
        .timestamp_nanos_opt()
        .unwrap_or_default()
        .to_string()
}

pub fn emit_rows_changed(app: &AppHandle, instance_id: i32, reason: &str) -> Result<()> {
    app.emit(
        ROWS_CHANGED_EVENT,
        ResourceRowsChanged {
            instance_id,
            revision: event_revision(),
            reason: reason.to_string(),
        },
    )?;
    Ok(())
}

pub fn emit_metadata_changed(
    app: &AppHandle,
    instance_id: i32,
    refs: Vec<ResourceProjectRef>,
    status: &str,
) -> Result<()> {
    app.emit(
        METADATA_CHANGED_EVENT,
        ResourceMetadataChanged {
            instance_id,
            revision: event_revision(),
            project_refs: refs,
            status: status.to_string(),
        },
    )?;
    Ok(())
}

pub(crate) async fn prepare_candidates(
    instance_id: i32,
    candidates: Vec<ResourceCandidate>,
) -> Vec<PreparedResourceCandidate> {
    prepare_candidates_with_progress(instance_id, candidates, None).await
}

pub(crate) type LocalFactProgress = Arc<dyn Fn(usize, usize) + Send + Sync>;

async fn prepare_discovered_candidates(
    candidates: Vec<ResourceCandidate>,
) -> Vec<DiscoveredResourceCandidate> {
    stream::iter(candidates.into_iter().map(|candidate| async move {
        let path = candidate.path.clone();
        tokio::task::spawn_blocking(move || {
            let metadata = std::fs::metadata(&path).ok()?;
            let modified = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs() as i64)
                .unwrap_or(0);
            Some(DiscoveredResourceCandidate {
                candidate,
                metadata: (metadata.len() as i64, modified),
            })
        })
        .await
        .ok()
        .flatten()
    }))
    .buffer_unordered(16)
    .filter_map(|candidate| async move { candidate })
    .collect()
    .await
}

/// Publish filesystem truth without hashing files or contacting providers.
///
/// Watcher and startup paths use this operation so passive discovery remains cheap.
pub async fn discover_candidates(
    app: &AppHandle,
    instance_id: i32,
    candidates: Vec<ResourceCandidate>,
    reason: &str,
) -> Result<LedgerBatchResult> {
    if candidates.is_empty() {
        return Ok(LedgerBatchResult::default());
    }
    let discovered = prepare_discovered_candidates(candidates).await;
    let facts = discovered
        .into_iter()
        .map(|local| InstalledResourceFact::Discovered {
            instance_id,
            path: local.candidate.path,
            metadata: local.metadata,
            provenance: local.candidate.provenance,
        })
        .collect();
    let result = ledger::record_many(facts)?;
    if result.changed > 0 {
        emit_rows_changed(app, instance_id, reason)?;
    }
    Ok(result)
}

pub(crate) async fn prepare_candidates_with_progress(
    instance_id: i32,
    candidates: Vec<ResourceCandidate>,
    progress: Option<LocalFactProgress>,
) -> Vec<PreparedResourceCandidate> {
    let total = candidates.len();
    let existing = Arc::new(
        crate::utils::db::get_vesta_conn()
            .and_then(|mut conn| {
                use crate::schema::vesta::installed_resource::dsl as installed_dsl;
                installed_dsl::installed_resource
                    .filter(installed_dsl::instance_id.eq(instance_id))
                    .load::<InstalledResource>(&mut conn)
                    .map_err(Into::into)
            })
            .unwrap_or_default()
            .into_iter()
            .map(|resource| (resource.local_path.clone(), resource))
            .collect::<HashMap<_, _>>(),
    );

    let mut pending = stream::iter(candidates.into_iter().map(|candidate| {
        let existing = existing.clone();
        async move {
            let path = candidate.path.clone();
            let existing = existing.get(&normalize_path(&path)).cloned();
            tokio::task::spawn_blocking(move || {
                let metadata = std::fs::metadata(&path)
                    .map(|metadata| {
                        (
                            metadata.len() as i64,
                            metadata
                                .modified()
                                .ok()
                                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|duration| duration.as_secs() as i64)
                                .unwrap_or(0),
                        )
                    })
                    .unwrap_or((0, 0));
                let enabled = !path.to_string_lossy().to_lowercase().ends_with(".disabled");
                if existing.as_ref().is_some_and(|resource| {
                    resource.file_size == metadata.0
                        && resource.file_mtime == metadata.1
                        && resource.is_enabled == enabled
                        && !resource.remote_id.is_empty()
                        && matches!(resource.platform.as_str(), "modrinth" | "curseforge")
                }) {
                    return None;
                }
                let sha1 = calculate_sha1(&path).ok();
                let curseforge_fingerprint = calculate_curseforge_fingerprint(&path)
                    .ok()
                    .map(|value| value.to_string());
                Some(PreparedResourceCandidate {
                    candidate,
                    sha1,
                    curseforge_fingerprint,
                    metadata,
                })
            })
            .await
            .ok()
            .flatten()
        }
    }))
    .buffer_unordered(6);

    let mut processed = 0;
    let mut prepared = Vec::with_capacity(total);
    while let Some(candidate) = pending.next().await {
        processed += 1;
        if let Some(candidate) = candidate {
            prepared.push(candidate);
        }
        if let Some(progress) = &progress {
            progress(processed, total);
        }
    }
    prepared
}

pub(crate) fn publish_local_rows(
    app: &AppHandle,
    instance_id: i32,
    candidates: &[PreparedResourceCandidate],
    reason: &str,
) -> Result<LedgerBatchResult> {
    let facts = candidates
        .iter()
        .map(|local| InstalledResourceFact::Manual {
            instance_id,
            path: local.candidate.path.clone(),
            hash: local.sha1.clone(),
            metadata: local.metadata,
            platform: "manual".to_string(),
            provenance: local.candidate.provenance.clone(),
        })
        .collect();
    let result = ledger::record_many(facts)?;
    if result.changed > 0 {
        emit_rows_changed(app, instance_id, reason)?;
    }
    Ok(result)
}

fn push_peer(
    peers: &mut Vec<ResourceProjectPeerRecord>,
    source: SourcePlatform,
    project_id: &str,
    peer_source: SourcePlatform,
    peer_project_id: &str,
    evidence: &str,
) {
    let now = chrono::Utc::now().to_rfc3339();
    peers.push(ResourceProjectPeerRecord {
        source: platform_name(source).to_string(),
        project_id: project_id.to_string(),
        peer_source: platform_name(peer_source).to_string(),
        peer_project_id: peer_project_id.to_string(),
        evidence: evidence.to_string(),
        updated_at: now.clone(),
    });
    peers.push(ResourceProjectPeerRecord {
        source: platform_name(peer_source).to_string(),
        project_id: peer_project_id.to_string(),
        peer_source: platform_name(source).to_string(),
        peer_project_id: project_id.to_string(),
        evidence: evidence.to_string(),
        updated_at: now,
    });
}

fn select_platform_match<T>(
    preferred: Option<SourcePlatform>,
    modrinth: Option<T>,
    curseforge: Option<T>,
) -> Option<T> {
    match preferred {
        Some(SourcePlatform::CurseForge) => curseforge.or(modrinth),
        Some(SourcePlatform::Modrinth) => modrinth.or(curseforge),
        None => modrinth.or(curseforge),
    }
}

fn persist_peer_links(records: Vec<ResourceProjectPeerRecord>) -> Result<()> {
    if records.is_empty() {
        return Ok(());
    }
    let mut conn = crate::utils::db::get_vesta_conn()?;
    conn.transaction::<(), anyhow::Error, _>(|conn| {
        for record in records {
            diesel::insert_into(peer_dsl::resource_project_peer)
                .values(&record)
                .on_conflict((
                    peer_dsl::source,
                    peer_dsl::project_id,
                    peer_dsl::peer_source,
                ))
                .do_update()
                .set(&record)
                .execute(conn)?;
        }
        Ok(())
    })
}

pub fn find_persisted_peer(
    source: SourcePlatform,
    project_id: &str,
) -> Result<Option<(SourcePlatform, String)>> {
    let mut conn = crate::utils::db::get_vesta_conn()?;
    let source = platform_name(source);
    let record = peer_dsl::resource_project_peer
        .filter(peer_dsl::source.eq(source))
        .filter(peer_dsl::project_id.eq(project_id))
        .first::<ResourceProjectPeerRecord>(&mut conn)
        .optional()?;
    Ok(record.and_then(|record| {
        source_platform(&record.peer_source).map(|platform| (platform, record.peer_project_id))
    }))
}

pub async fn reconcile_candidates(
    app: &AppHandle,
    instance_id: i32,
    candidates: Vec<ResourceCandidate>,
    reason: &str,
) -> Result<ReconciliationSummary> {
    if candidates.is_empty() {
        return Ok(ReconciliationSummary::default());
    }

    let locals = prepare_candidates(instance_id, candidates).await;
    reconcile_prepared_candidates(app, instance_id, locals, reason).await
}

pub(crate) async fn reconcile_prepared_candidates(
    app: &AppHandle,
    instance_id: i32,
    locals: Vec<PreparedResourceCandidate>,
    reason: &str,
) -> Result<ReconciliationSummary> {
    let attempted = locals.len();
    if attempted == 0 {
        return Ok(ReconciliationSummary::default());
    }
    let sha1s = locals
        .iter()
        .filter(|candidate| {
            candidate
                .candidate
                .resolved
                .as_ref()
                .is_none_or(|resolved| resolved.platform != SourcePlatform::Modrinth)
        })
        .filter_map(|candidate| candidate.sha1.clone())
        .collect::<Vec<_>>();
    let fingerprints = locals
        .iter()
        .filter(|candidate| {
            candidate
                .candidate
                .resolved
                .as_ref()
                .is_none_or(|resolved| resolved.platform != SourcePlatform::CurseForge)
        })
        .filter_map(|candidate| candidate.curseforge_fingerprint.clone())
        .collect::<Vec<_>>();

    let network = app.state::<crate::utils::network::NetworkManager>();
    let online = network.get_status() != crate::utils::network::NetworkStatus::Offline;
    let manager = app.state::<ResourceManager>();
    let (modrinth, curseforge) = if online {
        let (modrinth, curseforge) = tokio::join!(
            manager.get_by_hashes(SourcePlatform::Modrinth, &sha1s),
            manager.get_by_hashes(SourcePlatform::CurseForge, &fingerprints),
        );
        (
            modrinth.unwrap_or_else(|error| {
                log::warn!("[ResourceReconciliation] Modrinth batch failed: {error}");
                HashMap::new()
            }),
            curseforge.unwrap_or_else(|error| {
                log::warn!("[ResourceReconciliation] CurseForge batch failed: {error}");
                HashMap::new()
            }),
        )
    } else {
        (HashMap::new(), HashMap::new())
    };

    let mut facts = Vec::with_capacity(locals.len());
    let mut peer_records = Vec::new();
    let mut metadata_refs = Vec::new();
    let mut seen_refs = HashSet::new();
    let mut identified = 0;

    for local in locals {
        let known_resolution = local.candidate.resolved.clone();
        let modrinth_match = local
            .sha1
            .as_ref()
            .and_then(|hash| modrinth.get(hash))
            .cloned()
            .or_else(|| {
                known_resolution.as_ref().and_then(|resolved| {
                    (resolved.platform == SourcePlatform::Modrinth)
                        .then(|| (resolved.project.clone(), resolved.version.clone()))
                })
            });
        let curseforge_match = local
            .curseforge_fingerprint
            .as_ref()
            .and_then(|hash| curseforge.get(hash))
            .cloned()
            .or_else(|| {
                known_resolution.as_ref().and_then(|resolved| {
                    (resolved.platform == SourcePlatform::CurseForge)
                        .then(|| (resolved.project.clone(), resolved.version.clone()))
                })
            });

        if let (Some((modrinth_project, _)), Some((curseforge_project, _))) =
            (&modrinth_match, &curseforge_match)
        {
            push_peer(
                &mut peer_records,
                SourcePlatform::Modrinth,
                &modrinth_project.id,
                SourcePlatform::CurseForge,
                &curseforge_project.id,
                "shared-file-hash",
            );
        }
        if let Some((project, _)) = &modrinth_match {
            if let Some(curseforge_id) = project
                .external_ids
                .as_ref()
                .and_then(|ids| ids.get("curseforge"))
            {
                push_peer(
                    &mut peer_records,
                    SourcePlatform::Modrinth,
                    &project.id,
                    SourcePlatform::CurseForge,
                    curseforge_id,
                    "provider-external-id",
                );
            }
        }

        let selected = known_resolution
            .map(|resolved| (resolved.project, resolved.version))
            .or_else(|| {
                select_platform_match(
                    local.candidate.preferred_platform,
                    modrinth_match,
                    curseforge_match,
                )
            });

        if let Some((project, version)) = selected {
            identified += 1;
            let platform = project.source;
            let key = (platform, project.id.clone());
            if seen_refs.insert(key) {
                metadata_refs.push(ResourceProjectRef {
                    platform,
                    id: project.id.clone(),
                });
            }
            facts.push(InstalledResourceFact::Remote {
                instance_id,
                path: local.candidate.path,
                project,
                version,
                platform,
                hash: local.sha1,
                metadata: local.metadata,
                provenance: local.candidate.provenance,
                resource_type: None,
            });
        } else {
            facts.push(InstalledResourceFact::Manual {
                instance_id,
                path: local.candidate.path,
                hash: local.sha1,
                metadata: local.metadata,
                platform: "manual".to_string(),
                provenance: local.candidate.provenance,
            });
        }
    }

    let LedgerBatchResult { changed, .. } = ledger::record_many(facts)?;
    if changed > 0 {
        emit_rows_changed(app, instance_id, reason)?;
    }
    persist_peer_links(peer_records)?;
    if !metadata_refs.is_empty() {
        emit_metadata_changed(
            app,
            instance_id,
            metadata_refs.clone(),
            if identified == attempted {
                "complete"
            } else {
                "partial"
            },
        )?;
    }

    Ok(ReconciliationSummary {
        attempted,
        changed,
        identified,
        unresolved: attempted.saturating_sub(identified),
        metadata_refs,
    })
}

pub fn candidates_from_paths(
    paths: impl IntoIterator<Item = PathBuf>,
    provenance: Option<ResourceProvenance>,
    preferred_platform: Option<SourcePlatform>,
) -> Vec<ResourceCandidate> {
    paths
        .into_iter()
        .filter(|path| path.exists())
        .map(|path| ResourceCandidate {
            path,
            provenance: provenance.clone(),
            preferred_platform,
            resolved: None,
        })
        .collect()
}

pub fn unresolved_candidates_for_instance(
    instance_id: i32,
    resource_ids: Option<&[i32]>,
) -> Result<Vec<ResourceCandidate>> {
    use crate::schema::installed_resource::dsl as installed_dsl;

    let mut conn = crate::utils::db::get_vesta_conn()?;
    let mut query = installed_dsl::installed_resource
        .filter(installed_dsl::instance_id.eq(instance_id))
        .into_boxed();
    if let Some(ids) = resource_ids.filter(|ids| !ids.is_empty()) {
        query = query.filter(installed_dsl::id.eq_any(ids));
    } else {
        query = query.filter(
            installed_dsl::remote_id.eq("").or(installed_dsl::platform
                .ne("modrinth")
                .and(installed_dsl::platform.ne("curseforge"))),
        );
    }

    Ok(query
        .load::<InstalledResource>(&mut conn)?
        .into_iter()
        .filter_map(|resource| {
            let path = PathBuf::from(&resource.local_path);
            path.is_file().then(|| {
                let preferred_platform = match resource.source_modpack_platform.as_deref() {
                    Some("modrinth") => Some(SourcePlatform::Modrinth),
                    Some("curseforge") => Some(SourcePlatform::CurseForge),
                    _ => None,
                };
                ResourceCandidate {
                    path,
                    provenance: Some(ResourceProvenance {
                        source_kind: resource.source_kind,
                        source_modpack_id: resource.source_modpack_id,
                        source_modpack_version_id: resource.source_modpack_version_id,
                        source_modpack_platform: resource.source_modpack_platform,
                    }),
                    preferred_platform,
                    resolved: None,
                }
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_platform_selection_honors_pack_source_and_falls_back() {
        assert_eq!(
            select_platform_match(
                Some(SourcePlatform::CurseForge),
                Some("modrinth"),
                Some("curseforge"),
            ),
            Some("curseforge")
        );
        assert_eq!(
            select_platform_match(Some(SourcePlatform::CurseForge), Some("modrinth"), None,),
            Some("modrinth")
        );
        assert_eq!(
            select_platform_match(None, Some("modrinth"), Some("curseforge")),
            Some("modrinth")
        );
    }

    #[test]
    fn authoritative_peer_links_are_persisted_bidirectionally() {
        let mut peers = Vec::new();
        push_peer(
            &mut peers,
            SourcePlatform::Modrinth,
            "mr-project",
            SourcePlatform::CurseForge,
            "42",
            "shared-file-hash",
        );

        assert_eq!(peers.len(), 2);
        assert_eq!(peers[0].source, "modrinth");
        assert_eq!(peers[0].peer_source, "curseforge");
        assert_eq!(peers[1].source, "curseforge");
        assert_eq!(peers[1].peer_source, "modrinth");
        assert!(peers.iter().all(|peer| peer.evidence == "shared-file-hash"));
    }

    #[test]
    fn scoped_event_payloads_use_frontend_field_names() {
        let rows = serde_json::to_value(ResourceRowsChanged {
            instance_id: 9,
            revision: "1".to_string(),
            reason: "test".to_string(),
        })
        .unwrap();
        let metadata = serde_json::to_value(ResourceMetadataChanged {
            instance_id: 9,
            revision: "2".to_string(),
            project_refs: vec![],
            status: "partial".to_string(),
        })
        .unwrap();

        assert_eq!(rows["instanceId"], 9);
        assert!(rows.get("instance_id").is_none());
        assert_eq!(metadata["projectRefs"], serde_json::json!([]));
    }

    #[tokio::test]
    async fn passive_discovery_collects_large_batches_without_hash_preparation() {
        let temp = tempfile::tempdir().expect("tempdir");
        let mods = temp.path().join("mods");
        std::fs::create_dir_all(&mods).expect("mods directory");
        let paths = (0..500)
            .map(|index| {
                let path = mods.join(format!("resource-{index}.jar"));
                std::fs::write(&path, b"jar").expect("resource file");
                path
            })
            .collect::<Vec<_>>();
        let candidates = candidates_from_paths(paths, None, None);

        let discovered = prepare_discovered_candidates(candidates).await;

        assert_eq!(discovered.len(), 500);
        assert!(discovered.iter().all(|candidate| candidate.metadata.0 == 3));
    }
}
