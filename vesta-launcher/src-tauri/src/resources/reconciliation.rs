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

/// Release identity is evidence only for an exact advertised artifact, including
/// alternate files. A CurseForge fingerprint alone is not content identity.
pub(crate) fn version_matches_sha1(version: &ResourceVersion, sha1: Option<&str>) -> bool {
    let Some(sha1) = sha1.filter(|hash| !hash.is_empty()) else {
        return false;
    };
    (!version.hash.is_empty() && version.hash.eq_ignore_ascii_case(sha1))
        || version
            .files
            .iter()
            .any(|file| !file.hash.is_empty() && file.hash.eq_ignore_ascii_case(sha1))
}

/// Shared strict artifact seam. Neither a lookup key nor a CF fingerprint is
/// identity without an advertised SHA-1 and consistent project/version facts.
pub(crate) fn verified_artifact(
    found: &(ResourceProject, ResourceVersion),
    platform: SourcePlatform,
    sha1: &str,
) -> bool {
    found.0.source == platform
        && found.1.project_id == found.0.id
        && !found.0.id.is_empty()
        && !found.1.id.is_empty()
        && version_matches_sha1(&found.1, Some(sha1))
}

fn validate_retained_resolution(
    candidate: &mut ResourceCandidate,
    sha1: Option<&str>,
    expected: Option<&str>,
) {
    if candidate.resolved.as_ref().is_some_and(|resolved| {
        !version_matches_sha1(&resolved.version, sha1)
            || expected.is_some_and(|expected| {
                !sha1.is_some_and(|actual| actual.eq_ignore_ascii_case(expected))
            })
    }) {
        candidate.resolved = None;
    }
}

#[derive(Debug, Clone)]
pub(crate) struct PreparedResourceCandidate {
    candidate: ResourceCandidate,
    sha1: Option<String>,
    curseforge_fingerprint: Option<String>,
    metadata: (i64, i64),
}

impl PreparedResourceCandidate {
    /// Enrichment may outlive an enable/disable rename. Follow only the same
    /// content; skip missing files and files with changed size or modification time.
    fn refresh_path(&mut self) -> bool {
        let mut path = self.candidate.path.clone();
        let renamed = !path.is_file();
        if renamed {
            let enable = path.to_string_lossy().ends_with(".disabled");
            path = ledger::toggled_path(&path, enable);
        }
        // Always re-verify content when a hash is known. Size+mtime alone can miss
        // same-size replacements within one second on coarse filesystems.
        if (renamed || self.sha1.is_some())
            && !self.sha1.as_ref().is_some_and(|hash| {
                calculate_sha1(&path).is_ok_and(|current| current.eq_ignore_ascii_case(hash))
            })
        {
            return false;
        }
        let Ok(metadata) = std::fs::metadata(&path) else {
            return false;
        };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or(0);
        if !metadata.is_file() || (metadata.len() as i64, modified) != self.metadata {
            return false;
        }
        self.candidate.path = path;
        true
    }
}

async fn refresh_prepared_candidates(
    locals: Vec<PreparedResourceCandidate>,
) -> Vec<PreparedResourceCandidate> {
    stream::iter(locals.into_iter().map(|mut local| async move {
        tokio::task::spawn_blocking(move || {
            if local.refresh_path() {
                Some(local)
            } else {
                None
            }
        })
        .await
        .ok()
        .flatten()
    }))
    .buffer_unordered(6)
    .filter_map(|candidate| async move { candidate })
    .collect()
    .await
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

/// Actual matched file/version facts retained for manual dependency planning.
#[derive(Debug, Clone)]
pub(crate) struct IdentifiedResource {
    pub path: PathBuf,
    pub project: ResourceProject,
    pub version: ResourceVersion,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct ReconciliationEvidence {
    pub summary: ReconciliationSummary,
    pub resolutions: Vec<IdentifiedResource>,
    pub warnings: Vec<String>,
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
    platform.as_str()
}

fn source_platform(value: &str) -> Option<SourcePlatform> {
    SourcePlatform::from_str_id(value)
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
    prepare_candidates_inner(instance_id, candidates, progress, None).await
}

/// Explicit manual roots must yield evidence even for unchanged identified rows.
/// Retained metadata is bound to the content verified before provider awaits.
pub(crate) async fn prepare_manual_dependency_candidates(
    instance_id: i32,
    candidates: Vec<ResourceCandidate>,
    retained_hashes: HashMap<String, String>,
) -> Vec<PreparedResourceCandidate> {
    prepare_candidates_inner(
        instance_id,
        candidates,
        None,
        Some(Arc::new(retained_hashes)),
    )
    .await
}

async fn prepare_candidates_inner(
    instance_id: i32,
    candidates: Vec<ResourceCandidate>,
    progress: Option<LocalFactProgress>,
    retained_hashes: Option<Arc<HashMap<String, String>>>,
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
        let retained_hashes = retained_hashes.clone();
        async move {
            let path = candidate.path.clone();
            let existing = existing.get(&normalize_path(&path)).cloned();
            tokio::task::spawn_blocking(move || {
                prepare_candidate(
                    candidate,
                    existing.as_ref(),
                    retained_hashes.is_some(),
                    retained_hashes
                        .as_ref()
                        .and_then(|hashes| hashes.get(&normalize_path(&path)))
                        .map(String::as_str),
                )
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

fn prepare_candidate(
    mut candidate: ResourceCandidate,
    existing: Option<&InstalledResource>,
    explicit: bool,
    expected_hash: Option<&str>,
) -> Option<PreparedResourceCandidate> {
    let path = candidate.path.clone();
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
    if existing.is_some_and(|resource| {
        !explicit
            && candidate.resolved.is_none()
            && resource.file_size == metadata.0
            && resource.file_mtime == metadata.1
            && resource.is_enabled == enabled
            && !resource.remote_id.is_empty()
            && matches!(resource.platform.as_str(), "modrinth" | "curseforge")
            && resource.hash.as_ref().is_some_and(|hash| {
                calculate_sha1(&path).is_ok_and(|actual| actual.eq_ignore_ascii_case(hash))
            })
    }) {
        return None;
    }
    let sha1 = calculate_sha1(&path).ok();
    validate_retained_resolution(&mut candidate, sha1.as_deref(), expected_hash);
    let curseforge_fingerprint = calculate_curseforge_fingerprint(&path)
        .ok()
        .map(|value| value.to_string());
    Some(PreparedResourceCandidate {
        candidate,
        sha1,
        curseforge_fingerprint,
        metadata,
    })
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

pub(crate) fn push_peer(
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

pub(crate) fn select_platform_match<T>(
    preferred: Option<SourcePlatform>,
    modrinth: Option<T>,
    curseforge: Option<T>,
) -> Option<T> {
    match preferred {
        Some(SourcePlatform::CurseForge) => curseforge.or(modrinth),
        Some(SourcePlatform::Modrinth) => modrinth.or(curseforge),
        // Smithed (and unknown peers) are not part of the MR/CF hash identity pair.
        Some(SourcePlatform::Smithed) | None => modrinth.or(curseforge),
    }
}

pub(crate) fn persist_peer_links(records: Vec<ResourceProjectPeerRecord>) -> Result<()> {
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

pub(crate) type ArtifactMatches = HashMap<String, (ResourceProject, ResourceVersion)>;

/// Provider lookup only: callers revalidate publication under mutation exclusion
/// before persisting any returned identity. Fingerprints remain provisional.
pub(crate) async fn lookup_artifacts(
    app: &AppHandle,
    sha1s: &[String],
    fingerprints: &[String],
) -> (ArtifactMatches, ArtifactMatches, Vec<String>) {
    let mut warnings = Vec::new();
    let network = app.state::<crate::utils::network::NetworkManager>();
    let online = network.get_status() != crate::utils::network::NetworkStatus::Offline;
    let manager = app.state::<ResourceManager>();
    let (modrinth, curseforge) = if online {
        let (modrinth, curseforge) = tokio::join!(
            manager.get_by_hashes_with_evidence(SourcePlatform::Modrinth, sha1s),
            manager.get_by_hashes_with_evidence(SourcePlatform::CurseForge, fingerprints),
        );
        let mut retain = |platform: &str,
                          result: Result<(
            HashMap<String, (ResourceProject, ResourceVersion)>,
            usize,
        )>| {
            match result {
                Ok((matches, failed)) => {
                    if failed > 0 {
                        warnings.push(format!("{platform} identification failed for {failed} file lookup(s); identification is partial."));
                    }
                    matches
                }
                Err(_) => {
                    warnings.push(format!("{platform} identification is unavailable; some resources may remain unrecognized."));
                    HashMap::new()
                }
            }
        };
        (
            retain("Modrinth", modrinth),
            retain("CurseForge", curseforge),
        )
    } else {
        warnings.push("Offline: remote resource identification is unavailable.".to_string());
        (HashMap::new(), HashMap::new())
    };

    (modrinth, curseforge, warnings)
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
    Ok(
        reconcile_prepared_candidates_with_evidence(app, instance_id, locals, reason)
            .await?
            .summary,
    )
}

pub(crate) async fn reconcile_prepared_candidates_with_evidence(
    app: &AppHandle,
    instance_id: i32,
    locals: Vec<PreparedResourceCandidate>,
    reason: &str,
) -> Result<ReconciliationEvidence> {
    let locals = refresh_prepared_candidates(locals).await;
    let attempted = locals.len();
    if attempted == 0 {
        return Ok(ReconciliationEvidence::default());
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

    let (modrinth, curseforge, mut warnings) = lookup_artifacts(app, &sha1s, &fingerprints).await;

    // Network is complete. Share the mutation barrier with publication, world
    // transfer and resource toggles, then rehash before writing late identity.
    let keys = locals
        .iter()
        .filter_map(
            |local| match ledger::resource_type_for_path(&local.candidate.path)? {
                "mod" => Some(crate::tasks::manager::mods_conflict_key(instance_id)),
                "resourcepack" => Some(crate::tasks::manager::resourcepacks_conflict_key(
                    instance_id,
                )),
                "shader" => Some(crate::tasks::manager::shaderpacks_conflict_key(instance_id)),
                _ => None,
            },
        )
        .collect::<Vec<_>>();
    // Legacy reconciliation may already run inside a locking task. The manual
    // coordinator calls this only after its publication task has released locks.
    let tasks = (reason == "manual-dependency-identification")
        .then(|| app.try_state::<crate::tasks::manager::TaskManager>())
        .flatten();
    let _guard = match tasks.as_ref() {
        Some(tasks) => Some(tasks.acquire_conflicts(keys).await),
        None => None,
    };

    let mut locals = refresh_prepared_candidates(locals).await;
    if reason == "manual-dependency-identification" {
        let mods = crate::commands::instances::get_instance(instance_id)
            .ok()
            .and_then(|instance| crate::worlds::instance_game_directory(&instance).ok())
            .map(|root| root.join("mods"));
        locals.retain(|local| {
            mods.as_ref().is_some_and(|mods| {
                mods.parent().is_some_and(|game| {
                    crate::resources::source_enrichment::real_direct_child_file(
                        game,
                        mods,
                        &local.candidate.path,
                    )
                })
            }) && ledger::get_resource_by_path(instance_id, &local.candidate.path)
                .ok()
                .flatten()
                .is_some_and(|row| row.resource_type == "mod" && row.hash == local.sha1)
        });
    }
    let mut facts = Vec::with_capacity(locals.len());
    let mut peer_records = Vec::new();
    let mut metadata_refs = Vec::new();
    let mut seen_refs = HashSet::new();
    let mut identified = 0;
    let mut resolutions = Vec::new();

    for local in locals {
        if local
            .curseforge_fingerprint
            .as_ref()
            .and_then(|fingerprint| curseforge.get(fingerprint))
            .is_some_and(|(_, version)| !version_matches_sha1(version, local.sha1.as_deref()))
        {
            warnings.push("A CurseForge fingerprint match did not verify against the local SHA-1; it was excluded from dependency and shared-content evidence.".into());
        }
        let known_resolution = local
            .candidate
            .resolved
            .clone()
            .filter(|resolved| version_matches_sha1(&resolved.version, local.sha1.as_deref()));
        let modrinth_match = local
            .sha1
            .as_ref()
            .and_then(|hash| modrinth.get(hash))
            .filter(|found| {
                local
                    .sha1
                    .as_deref()
                    .is_some_and(|sha1| verified_artifact(found, SourcePlatform::Modrinth, sha1))
            })
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
            .filter(|found| {
                local
                    .sha1
                    .as_deref()
                    .is_some_and(|sha1| verified_artifact(found, SourcePlatform::CurseForge, sha1))
            })
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
            resolutions.push(IdentifiedResource {
                path: local.candidate.path.clone(),
                project: project.clone(),
                version: version.clone(),
            });
            facts.push(InstalledResourceFact::Remote {
                instance_id,
                path: local.candidate.path,
                project,
                version,
                platform,
                hash: local.sha1,
                metadata: local.metadata,
                provenance: local.candidate.provenance,
                resource_type: (reason == "manual-dependency-identification").then(|| "mod".into()),
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

    let unresolved = attempted.saturating_sub(identified);
    if unresolved > 0 {
        warnings.push(format!("{unresolved} file(s) were not recognized; their required dependencies could not be checked."));
    }
    Ok(ReconciliationEvidence {
        resolutions,
        warnings,
        summary: ReconciliationSummary {
            attempted,
            changed,
            identified,
            unresolved: attempted.saturating_sub(identified),
            metadata_refs,
        },
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

    fn resolution(hash: &str) -> KnownResourceResolution {
        KnownResourceResolution {
            platform: SourcePlatform::Modrinth,
            project: serde_json::from_value(serde_json::json!({
                "id": "project", "source": "modrinth", "resource_type": "mod",
                "name": "project", "summary": "", "author": "", "authors": [],
                "download_count": 0, "follower_count": 0, "categories": [],
                "web_url": "", "gallery": []
            }))
            .unwrap(),
            version: serde_json::from_value(serde_json::json!({
                "id": "release", "project_id": "project", "version_number": "1",
                "game_versions": ["1.21.1"], "loaders": ["fabric"],
                "download_url": "https://example.invalid/primary.jar", "file_name": "primary.jar",
                "release_type": "release", "hash": hash, "dependencies": []
            }))
            .unwrap(),
        }
    }

    #[test]
    fn retained_resolution_is_bound_to_pre_request_content_including_alternates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("alternate.jar");
        std::fs::write(&path, b"alternate").unwrap();
        let verified_hash = calculate_sha1(&path).unwrap();
        let mut known = resolution("primary-hash");
        known
            .version
            .files
            .push(crate::models::resource::ResourceVersionFile {
                url: "https://example.invalid/alternate.jar".into(),
                file_name: "alternate.jar".into(),
                hash: verified_hash.clone(),
                file_size: None,
                role: "alternate".into(),
            });
        let candidate = ResourceCandidate {
            path: path.clone(),
            provenance: None,
            preferred_platform: None,
            resolved: Some(known.clone()),
        };
        let prepared =
            prepare_candidate(candidate.clone(), None, true, Some(&verified_hash)).unwrap();
        assert!(prepared.candidate.resolved.is_some());
        // Replacement with another advertised artifact must still discard the
        // resolution retained for the bytes checked before provider requests.
        std::fs::write(&path, b"primary").unwrap();
        known.version.hash = calculate_sha1(&path).unwrap();
        let mut changed = candidate;
        changed.resolved = Some(known);
        let prepared = prepare_candidate(changed, None, true, Some(&verified_hash)).unwrap();
        assert!(prepared.candidate.resolved.is_none());
        assert_ne!(prepared.sha1.as_deref(), Some(verified_hash.as_str()));
    }

    #[test]
    fn explicit_unchanged_alternate_root_is_prepared_for_actual_hash_lookup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("alternate.jar");
        std::fs::write(&path, b"alternate").unwrap();
        let hash = calculate_sha1(&path).unwrap();
        let candidate = ResourceCandidate {
            path: path.clone(),
            provenance: None,
            preferred_platform: None,
            resolved: None,
        };
        let prepared = prepare_candidate(candidate.clone(), None, false, None).unwrap();
        let installed: InstalledResource = serde_json::from_value(serde_json::json!({
            "id": 1, "instance_id": 1, "platform": "modrinth", "remote_id": "project",
            "remote_version_id": "release", "resource_type": "mod", "local_path": normalize_path(&path),
            "display_name": "project", "current_version": "1", "is_manual": true,
            "is_enabled": true, "last_updated": "", "release_type": "release", "hash": hash,
            "file_size": prepared.metadata.0, "file_mtime": prepared.metadata.1, "source_kind": "manual"
        })).unwrap();
        assert!(!version_matches_sha1(
            &resolution("primary-hash").version,
            installed.hash.as_deref()
        ));
        assert!(prepare_candidate(candidate.clone(), Some(&installed), false, None).is_none());
        let explicit = prepare_candidate(candidate, Some(&installed), true, None).unwrap();
        assert_eq!(explicit.sha1, installed.hash);
        assert!(explicit.candidate.resolved.is_none());
    }

    #[test]
    fn curseforge_whitespace_fingerprint_is_not_strict_content_evidence() {
        let dir = tempfile::tempdir().unwrap();
        let advertised = dir.path().join("advertised.jar");
        let local = dir.path().join("local.jar");
        std::fs::write(&advertised, b"mod content").unwrap();
        std::fs::write(&local, b"mod\ncontent").unwrap();
        assert_eq!(
            calculate_curseforge_fingerprint(&advertised).unwrap(),
            calculate_curseforge_fingerprint(&local).unwrap()
        );
        let release = resolution(&calculate_sha1(&advertised).unwrap()).version;
        let local_hash = calculate_sha1(&local).unwrap();
        assert!(!version_matches_sha1(&release, Some(&local_hash)));
        assert!(version_matches_sha1(
            &release,
            Some(&calculate_sha1(&advertised).unwrap())
        ));
        let mut missing_hash = release;
        missing_hash.hash.clear();
        assert!(!version_matches_sha1(&missing_hash, Some(&local_hash)));
    }

    #[test]
    fn enrichment_follows_disabled_renames_without_resurrecting_missing_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mod.jar");
        std::fs::write(&path, b"mod").unwrap();
        let metadata = std::fs::metadata(&path).unwrap();
        let mut prepared = PreparedResourceCandidate {
            candidate: ResourceCandidate {
                path: path.clone(),
                provenance: None,
                preferred_platform: None,
                resolved: None,
            },
            sha1: Some(calculate_sha1(&path).unwrap()),
            curseforge_fingerprint: None,
            metadata: (
                metadata.len() as i64,
                metadata
                    .modified()
                    .unwrap()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs() as i64,
            ),
        };
        let disabled = ledger::toggled_path(&path, false);
        std::fs::rename(&path, &disabled).unwrap();
        assert!(prepared.refresh_path());
        assert_eq!(prepared.candidate.path, disabled);
        std::fs::rename(&disabled, &path).unwrap();
        assert!(prepared.refresh_path());
        assert_eq!(prepared.candidate.path, path);
        std::fs::write(&path, b"different content").unwrap();
        assert!(!prepared.refresh_path());
        std::fs::remove_file(&path).unwrap();
        assert!(!prepared.refresh_path());
        std::fs::write(&disabled, b"unrelated").unwrap();
        assert!(!prepared.refresh_path());
    }

    #[test]
    fn refresh_path_rejects_same_size_in_place_content_replacement() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("mods/example.jar");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"mod!").unwrap();
        let metadata = std::fs::metadata(&path).unwrap();
        let mut prepared = PreparedResourceCandidate {
            candidate: ResourceCandidate {
                path: path.clone(),
                provenance: None,
                preferred_platform: None,
                resolved: None,
            },
            sha1: Some(calculate_sha1(&path).unwrap()),
            curseforge_fingerprint: None,
            metadata: (
                metadata.len() as i64,
                metadata
                    .modified()
                    .unwrap()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs() as i64,
            ),
        };
        std::fs::write(&path, b"new!").unwrap();
        assert_eq!(std::fs::metadata(&path).unwrap().len(), 4);
        assert!(!prepared.refresh_path());
    }

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
