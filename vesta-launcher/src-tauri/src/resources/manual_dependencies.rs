//! Required-only dependency planning for a published manual mod batch.
//! Identification owns file facts; this module owns consent-independent planning.
use crate::models::installed_resource::InstalledResource;
use crate::models::resource::{
    DependencyType, ReleaseType, ResourceDependency, ResourceProject, ResourceType,
    ResourceVersion, SourcePlatform,
};
use crate::resources::manager::{is_game_version_compatible, is_loader_compatible};
use crate::resources::reconciliation::{self, KnownResourceResolution, ResourceCandidate};
use crate::resources::{ResourceManager, ResourceWatcher};
use crate::tasks::manager::{BoxFuture, Task, TaskContext, TaskManager};
use crate::tasks::resource_download::{
    plan_artifacts, ResourceDownloadTask, ResourceInstallTarget,
};
use crate::utils::hash::calculate_sha1;
use crate::utils::instance_helpers::normalize_path;
use async_trait::async_trait;
use diesel::prelude::*;
use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const MAX_NODES: usize = 256;
const MAX_DEPTH: usize = 32;
const MAX_PASSES: usize = 16;
type ProjectKey = (SourcePlatform, String);
type Pins = HashMap<ProjectKey, BTreeSet<String>>;

#[derive(Debug, Clone)]
pub struct PlannedDependency {
    pub id: String,
    pub project: ResourceProject,
    pub version: ResourceVersion,
}

#[derive(Debug, Clone, Default)]
pub struct ManualDependencyPlan {
    pub dependencies: Vec<PlannedDependency>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ManualDependencyQueueOutcome {
    pub queued: usize,
    pub warnings: Vec<String>,
}

fn key(project: &ResourceProject) -> ProjectKey {
    (project.source, project.id.clone())
}

fn planned(project: ResourceProject, version: ResourceVersion) -> PlannedDependency {
    PlannedDependency {
        id: format!("{}:{}:{}", project.source.as_str(), project.id, version.id),
        project,
        version,
    }
}

fn recorded_content_matches(row: &InstalledResource, version: &ResourceVersion) -> bool {
    (version.hash.is_empty() && version.files.iter().all(|file| file.hash.is_empty()))
        || reconciliation::version_matches_sha1(version, row.hash.as_deref())
}

/// Compare the release facts approved by the user, excluding mutable statistics.
fn approved_release_matches(approved: &ResourceVersion, current: &ResourceVersion) -> bool {
    approved.id == current.id
        && approved.project_id == current.project_id
        && approved.version_number == current.version_number
        && approved.release_type == current.release_type
        && approved.download_url == current.download_url
        && approved.file_name == current.file_name
        && approved.hash == current.hash
        && approved.file_size == current.file_size
        && approved.files == current.files
        && approved.game_versions == current.game_versions
        && approved.loaders == current.loaders
        && approved.dependencies.len() == current.dependencies.len()
        && approved
            .dependencies
            .iter()
            .zip(&current.dependencies)
            .all(|(a, b)| {
                a.project_id == b.project_id
                    && a.version_id == b.version_id
                    && a.file_name == b.file_name
                    && a.dependency_type == b.dependency_type
            })
}

fn compatible(version: &ResourceVersion, minecraft: &str, loader: &str) -> bool {
    is_game_version_compatible(&version.game_versions, minecraft)
        && is_loader_compatible(&version.loaders, loader)
}

fn mod_artifacts(project: &ResourceProject, version: &ResourceVersion) -> bool {
    project.resource_type == ResourceType::Mod
        && !version
            .loaders
            .iter()
            .any(|loader| loader.eq_ignore_ascii_case("datapack"))
        && plan_artifacts(version, ResourceType::Mod).is_ok_and(|files| {
            !files.is_empty()
                && files
                    .iter()
                    .all(|file| file.resource_type == ResourceType::Mod)
        })
}

fn choose_version(
    project: &ResourceProject,
    versions: &[ResourceVersion],
    pin: Option<&str>,
    minecraft: &str,
    loader: &str,
) -> Option<ResourceVersion> {
    let mut compatible_versions = versions
        .iter()
        .filter(|version| {
            version.project_id == project.id
                && pin.is_none_or(|id| version.id == id)
                && compatible(version, minecraft, loader)
                && mod_artifacts(project, version)
        })
        .cloned()
        .collect::<Vec<_>>();
    // Follow provider flow's preference for stable releases, then newest publication.
    compatible_versions.sort_by(|a, b| {
        fn rank(release: ReleaseType) -> u8 {
            match release {
                ReleaseType::Release => 0,
                ReleaseType::Beta => 1,
                ReleaseType::Alpha => 2,
            }
        }
        rank(a.release_type)
            .cmp(&rank(b.release_type))
            .then_with(|| b.published_at.cmp(&a.published_at))
            .then_with(|| a.id.cmp(&b.id))
    });
    compatible_versions.into_iter().next()
}

#[derive(Clone)]
struct InventoryEntry {
    row: InstalledResource,
    /// Presence is retained even when identity is stale: never treat that as empty inventory.
    present: bool,
    eligible: bool,
}

impl InventoryEntry {
    async fn verified(&self) -> bool {
        self.eligible && self.content_verified().await
    }

    /// Disabled files still occupy inventory and may be reused by the downloader.
    async fn content_verified(&self) -> bool {
        if !self.present {
            return false;
        }
        let Some(hash) = self.row.hash.clone().filter(|hash| !hash.is_empty()) else {
            return false;
        };
        let path = PathBuf::from(&self.row.local_path);
        tokio::task::spawn_blocking(move || {
            calculate_sha1(&path).is_ok_and(|actual| actual.eq_ignore_ascii_case(&hash))
        })
        .await
        .unwrap_or(false)
    }
}

async fn matching_inventory_content(
    installed: &[InventoryEntry],
    dependency: &PlannedDependency,
) -> Result<bool, String> {
    let mut present = false;
    for entry in installed.iter().filter(|entry| {
        reconciliation::version_matches_sha1(&dependency.version, entry.row.hash.as_deref())
    }) {
        if entry.content_verified().await {
            if !entry.eligible {
                return Err(format!("{} has verified disabled or ineligible local content; manual dependencies never replace or enable it.", dependency.project.name));
            }
            present = true;
        }
    }
    Ok(present)
}

fn inventory(instance_id: i32, mods: &Path) -> Result<Vec<InventoryEntry>, String> {
    use crate::schema::installed_resource::dsl as ir;
    let mut conn = crate::utils::db::get_vesta_conn().map_err(|_| {
        "Installed mod inventory is unavailable; dependencies were not queued.".to_string()
    })?;
    let rows = ir::installed_resource
        .filter(ir::instance_id.eq(instance_id))
        .load::<InstalledResource>(&mut conn)
        .map_err(|_| {
            "Installed mod inventory could not be read; dependencies were not queued.".to_string()
        })?;
    Ok(rows
        .into_iter()
        .filter(|row| row.resource_type == "mod")
        .map(|row| inventory_entry(row, mods))
        .collect())
}

fn inventory_entry(row: InstalledResource, mods: &Path) -> InventoryEntry {
    let path = Path::new(&row.local_path);
    let present = path.is_file();
    let inside_mods = mods.parent().is_some_and(|game| {
        crate::resources::source_enrichment::real_direct_child_file(game, mods, path)
    });
    let eligible = present
        && inside_mods
        && row.is_enabled
        && !row.local_path.to_ascii_lowercase().ends_with(".disabled");
    InventoryEntry {
        row,
        present,
        eligible,
    }
}

fn matches_project(
    row: &InstalledResource,
    project: &ResourceProject,
    peer: Option<&ProjectKey>,
) -> bool {
    (row.platform == project.source.as_str() && row.remote_id == project.id)
        || peer
            .is_some_and(|(platform, id)| row.platform == platform.as_str() && row.remote_id == *id)
        || project.external_ids.as_ref().is_some_and(|ids| {
            SourcePlatform::from_str_id(&row.platform).is_some_and(|platform| {
                ids.get(platform.as_str())
                    .is_some_and(|id| *id == row.remote_id)
            })
        })
}

#[async_trait]
trait DependencyLookup: Sync {
    async fn project(&self, platform: SourcePlatform, id: &str) -> Result<ResourceProject, ()>;
    async fn versions(
        &self,
        platform: SourcePlatform,
        id: &str,
    ) -> Result<Vec<ResourceVersion>, ()>;
    async fn version(
        &self,
        platform: SourcePlatform,
        project: &str,
        id: &str,
    ) -> Result<ResourceVersion, ()>;
    async fn peer(&self, project: &ResourceProject) -> Result<Option<ProjectKey>, ()>;
}

#[async_trait]
impl DependencyLookup for ResourceManager {
    async fn project(&self, platform: SourcePlatform, id: &str) -> Result<ResourceProject, ()> {
        self.get_project(platform, id).await.map_err(|_| ())
    }
    async fn versions(
        &self,
        platform: SourcePlatform,
        id: &str,
    ) -> Result<Vec<ResourceVersion>, ()> {
        self.get_versions(platform, id, false, None, None)
            .await
            .map_err(|_| ())
    }
    async fn version(
        &self,
        platform: SourcePlatform,
        project: &str,
        id: &str,
    ) -> Result<ResourceVersion, ()> {
        self.get_version(platform, project, id)
            .await
            .map_err(|_| ())
    }
    async fn peer(&self, project: &ResourceProject) -> Result<Option<ProjectKey>, ()> {
        reconciliation::find_persisted_peer(project.source, &project.id).map_err(|_| ())
    }
}

/// Memoized provider metadata survives constraint passes; no repeated hash identification.
struct LookupCache<'a, L> {
    lookup: &'a L,
    projects: HashMap<ProjectKey, Result<ResourceProject, ()>>,
    versions: HashMap<ProjectKey, Result<Vec<ResourceVersion>, ()>>,
    pins: HashMap<(SourcePlatform, String, String), Result<ResourceVersion, ()>>,
    peers: HashMap<ProjectKey, Result<Option<ProjectKey>, ()>>,
}

impl<'a, L: DependencyLookup> LookupCache<'a, L> {
    fn new(lookup: &'a L) -> Self {
        Self {
            lookup,
            projects: HashMap::new(),
            versions: HashMap::new(),
            pins: HashMap::new(),
            peers: HashMap::new(),
        }
    }
    async fn project(&mut self, platform: SourcePlatform, id: &str) -> Result<ResourceProject, ()> {
        let key = (platform, id.to_string());
        if !self.projects.contains_key(&key) {
            self.projects
                .insert(key.clone(), self.lookup.project(platform, id).await);
        }
        self.projects[&key].clone()
    }
    async fn version(
        &mut self,
        platform: SourcePlatform,
        project: &str,
        id: &str,
    ) -> Result<ResourceVersion, ()> {
        let key = (platform, project.to_string(), id.to_string());
        if !self.pins.contains_key(&key) {
            self.pins.insert(
                key.clone(),
                self.lookup.version(platform, project, id).await,
            );
        }
        self.pins[&key].clone()
    }
    async fn versions(&mut self, project: &ResourceProject) -> Result<Vec<ResourceVersion>, ()> {
        let key = key(project);
        if !self.versions.contains_key(&key) {
            self.versions.insert(
                key.clone(),
                self.lookup.versions(project.source, &project.id).await,
            );
        }
        self.versions[&key].clone()
    }
    async fn peer(&mut self, project: &ResourceProject) -> Result<Option<ProjectKey>, ()> {
        let key = key(project);
        if !self.peers.contains_key(&key) {
            self.peers
                .insert(key.clone(), self.lookup.peer(project).await);
        }
        self.peers[&key].clone()
    }
}

#[derive(Clone)]
struct Requirement {
    platform: SourcePlatform,
    dependency: ResourceDependency,
    depth: usize,
}

fn enqueue(
    queue: &mut VecDeque<Requirement>,
    project: &ResourceProject,
    version: &ResourceVersion,
    depth: usize,
) {
    for dependency in &version.dependencies {
        if dependency.dependency_type == DependencyType::Required {
            queue.push_back(Requirement {
                platform: project.source,
                dependency: dependency.clone(),
                depth,
            });
        }
    }
}

async fn build_plan<L: DependencyLookup>(
    lookup: &L,
    roots: &[(ResourceProject, ResourceVersion)],
    installed: &[InventoryEntry],
    minecraft: &str,
    loader: &str,
) -> ManualDependencyPlan {
    let mut cache = LookupCache::new(lookup);
    for (project, version) in roots {
        cache.projects.insert(key(project), Ok(project.clone()));
        cache.pins.insert(
            (project.source, project.id.clone(), version.id.clone()),
            Ok(version.clone()),
        );
    }
    let mut hints = Pins::new();
    // A later root may pin a project visited earlier without a pin. Rebuild the
    // reachable graph with aggregated pins, discarding edges of abandoned versions.
    for _ in 0..MAX_PASSES {
        let mut plan = ManualDependencyPlan::default();
        let mut constraints = Pins::new();
        let mut queue = VecDeque::new();
        let mut visited = HashSet::new();
        let mut selected = HashMap::<ProjectKey, (ResourceProject, ResourceVersion)>::new();
        let root_keys = roots
            .iter()
            .map(|(project, _)| key(project))
            .collect::<HashSet<_>>();
        for (project, version) in roots {
            visited.insert(key(project));
            enqueue(&mut queue, project, version, 1);
        }
        let mut requests = 0;
        let mut requested_projects = HashSet::new();
        let mut exceeded = false;
        while let Some(requirement) = queue.pop_front() {
            requests += 1;
            if requirement.depth > MAX_DEPTH || requests > MAX_NODES * MAX_NODES {
                exceeded = true;
                break;
            }
            let dep = requirement.dependency;
            let mut id = dep.project_id.clone();
            if id.is_empty() {
                if let Some(pin) = dep.version_id.as_deref() {
                    match cache.version(requirement.platform, "", pin).await {
                        Ok(version) if version.id == pin => id = version.project_id,
                        _ => {
                            plan.warnings.push("A required pinned dependency could not be identified by its provider.".into());
                            continue;
                        }
                    }
                } else {
                    plan.warnings.push("A required dependency has no provider project identity; filename matching is insufficient.".into());
                    continue;
                }
            }
            requested_projects.insert((requirement.platform, id.clone()));
            if requested_projects.len() > MAX_NODES {
                exceeded = true;
                break;
            }
            let project = match cache.project(requirement.platform, &id).await {
                Ok(project) if project.source == requirement.platform => project,
                _ => {
                    plan.warnings.push(format!("{} required project metadata is unavailable; dependencies remain unresolved.", requirement.platform.as_str()));
                    continue;
                }
            };
            let project_key = key(&project);
            let pins = constraints.entry(project_key.clone()).or_default();
            if let Some(pin) = &dep.version_id {
                pins.insert(pin.clone());
            }
            let effective = hints
                .get(&project_key)
                .cloned()
                .unwrap_or_default()
                .union(pins)
                .cloned()
                .collect::<BTreeSet<_>>();
            if effective.len() > 1 {
                plan.warnings.push(format!(
                    "{} has conflicting required version pins; it will not be downloaded.",
                    project.name
                ));
                continue;
            }
            let pin = effective.iter().next().map(String::as_str);
            if root_keys.contains(&project_key) {
                let actual = roots
                    .iter()
                    .filter(|(root, _)| key(root) == project_key)
                    .collect::<Vec<_>>();
                if actual.iter().any(|(_, version)| {
                    !compatible(version, minecraft, loader)
                        || pin.is_some_and(|pin| version.id != pin)
                }) {
                    plan.warnings.push(format!("{} conflicts with a dropped mod version; the dropped mod will not be replaced.", project.name));
                }
                continue;
            }
            if visited.contains(&project_key) {
                continue;
            }
            if visited.len() >= MAX_NODES {
                exceeded = true;
                break;
            }
            visited.insert(project_key.clone());
            if project.resource_type != ResourceType::Mod {
                plan.warnings.push(format!(
                    "{} requires a destination for a non-mod resource; install it separately.",
                    project.name
                ));
                continue;
            }
            let peer = match cache.peer(&project).await {
                Ok(peer) => peer,
                Err(_) => {
                    plan.warnings.push(format!("{} installed peer identity could not be checked; it will not be downloaded.", project.name));
                    continue;
                }
            };
            let matches = installed
                .iter()
                .filter(|entry| matches_project(&entry.row, &project, peer.as_ref()))
                .collect::<Vec<_>>();
            if !matches.is_empty() {
                let mut satisfied = None;
                let pinned = if let Some(pin) = pin {
                    cache
                        .version(project.source, &project.id, pin)
                        .await
                        .ok()
                        .filter(|version| {
                            version.id == pin
                                && version.project_id == project.id
                                && compatible(version, minecraft, loader)
                                && mod_artifacts(&project, version)
                        })
                } else {
                    None
                };
                for entry in &matches {
                    if !entry.verified().await {
                        continue;
                    }
                    if let Some(pin) = pin {
                        let Some(version) = &pinned else {
                            continue;
                        };
                        // Provider version IDs are scoped. Peer identity alone
                        // cannot prove a pin; verified identical content can.
                        let exact =
                            (entry.row.platform == project.source.as_str()
                                && entry.row.remote_version_id == pin)
                                || (!version.hash.is_empty()
                                    && entry.row.hash.as_ref().is_some_and(|hash| {
                                        hash.eq_ignore_ascii_case(&version.hash)
                                    }));
                        if exact && recorded_content_matches(&entry.row, version) {
                            satisfied = Some((project.clone(), version.clone()));
                            break;
                        }
                        continue;
                    }
                    let Some(platform) = SourcePlatform::from_str_id(&entry.row.platform) else {
                        continue;
                    };
                    if let Ok(version) = cache
                        .version(platform, &entry.row.remote_id, &entry.row.remote_version_id)
                        .await
                    {
                        if version.id == entry.row.remote_version_id
                            && version.project_id == entry.row.remote_id
                            && compatible(&version, minecraft, loader)
                            && recorded_content_matches(&entry.row, &version)
                        {
                            if let Ok(installed_project) =
                                cache.project(platform, &entry.row.remote_id).await
                            {
                                satisfied = Some((installed_project, version));
                                break;
                            }
                        }
                    }
                }
                if let Some((installed_project, version)) = satisfied {
                    if let Err(warning) = matching_inventory_content(
                        installed,
                        &planned(installed_project.clone(), version.clone()),
                    )
                    .await
                    {
                        plan.warnings.push(warning);
                        continue;
                    }
                    enqueue(
                        &mut queue,
                        &installed_project,
                        &version,
                        requirement.depth + 1,
                    );
                } else {
                    plan.warnings.push(format!("{} is installed but its enabled compatible file/version could not satisfy the requirement; it will not be replaced or enabled.", project.name));
                }
                continue;
            }
            let versions = if let Some(pin) = pin {
                cache
                    .version(project.source, &project.id, pin)
                    .await
                    .map(|version| vec![version])
            } else {
                cache.versions(&project).await
            };
            let version = match versions {
                Ok(versions) => choose_version(&project, &versions, pin, minecraft, loader),
                Err(_) => None,
            };
            let Some(version) = version else {
                plan.warnings.push(if pin.is_some() {
                    format!("{} required pinned release is missing, incompatible, or not a mod-only download; no alternate release will be selected.", project.name)
                } else {
                    format!("{} has no available compatible mod-only release; required dependencies remain unresolved.", project.name)
                });
                continue;
            };
            // An enabled verified local file with the exact release hash proves
            // identity even when its ledger enrichment has not completed yet.
            let hash_present = match matching_inventory_content(
                installed,
                &planned(project.clone(), version.clone()),
            )
            .await
            {
                Ok(present) => present,
                Err(warning) => {
                    plan.warnings.push(warning);
                    continue;
                }
            };
            let occupied = installed.iter().any(|entry| {
                entry.present
                    && Path::new(&entry.row.local_path)
                        .file_name()
                        .is_some_and(|name| {
                            name.to_string_lossy() == version.file_name
                                || name.to_string_lossy()
                                    == format!("{}.disabled", version.file_name)
                        })
            });
            if occupied && !hash_present {
                plan.warnings.push(format!("{} has an occupied local mod filename without verified release identity; it will not be replaced.", project.name));
                continue;
            }
            enqueue(&mut queue, &project, &version, requirement.depth + 1);
            if !hash_present {
                selected.insert(project_key, (project, version));
            }
        }
        if exceeded {
            plan.warnings.push("Required dependency planning reached its node/depth limit; dependencies were not queued from an incomplete graph.".into());
            return plan;
        }
        if constraints == hints {
            // Provider peers represent one project. Different provider releases
            // cannot both be auto-installed unless their exact content agrees.
            let mut choices = selected.into_values().collect::<Vec<_>>();
            choices.sort_by_key(|(project, version)| planned(project.clone(), version.clone()).id);
            let mut excluded = HashSet::new();
            for i in 0..choices.len() {
                let (a, av) = &choices[i];
                let peer = cache.peer(a).await.ok().flatten();
                for j in i + 1..choices.len() {
                    let (b, bv) = &choices[j];
                    let same_project = peer.as_ref().is_some_and(|peer| *peer == key(b))
                        || a.external_ids
                            .as_ref()
                            .and_then(|ids| ids.get(b.source.as_str()))
                            .is_some_and(|id| *id == b.id)
                        || b.external_ids
                            .as_ref()
                            .and_then(|ids| ids.get(a.source.as_str()))
                            .is_some_and(|id| *id == a.id);
                    if same_project {
                        if !av.hash.is_empty() && av.hash.eq_ignore_ascii_case(&bv.hash) {
                            excluded.insert(j);
                        } else {
                            excluded.insert(i);
                            excluded.insert(j);
                            plan.warnings.push(format!("{} has conflicting provider release choices; it will not be downloaded automatically.", a.name));
                        }
                    }
                }
            }
            plan.dependencies = choices
                .into_iter()
                .enumerate()
                .filter(|(i, _)| !excluded.contains(i))
                .map(|(_, choice)| choice)
                .map(|(project, version)| planned(project, version))
                .collect();
            plan.dependencies.sort_by(|a, b| a.id.cmp(&b.id));
            plan.warnings.sort();
            plan.warnings.dedup();
            return plan;
        }
        hints = constraints;
    }
    ManualDependencyPlan { dependencies: Vec::new(), warnings: vec!["Required dependency constraints did not converge; no dependencies will be downloaded automatically.".into()] }
}

/// Identify only the supplied published paths, while refreshing cheap local facts first.
/// The `never` policy suppresses dependency resolution after identification completes.
pub async fn plan_for_paths(
    app: &AppHandle,
    instance_id: i32,
    paths: &[PathBuf],
) -> Result<ManualDependencyPlan, String> {
    let instance = crate::commands::instances::get_instance(instance_id)?;
    let game = crate::worlds::instance_game_directory(&instance)?;
    let mods = game.join("mods");
    let manager = app.state::<ResourceManager>();
    let mut warnings = Vec::new();
    if app
        .state::<ResourceWatcher>()
        .refresh_instance(instance_id, game.to_string_lossy().into_owned())
        .await
        .is_err()
    {
        warnings.push("Local resource refresh was incomplete; dependency inventory will be checked conservatively.".into());
    }
    let installed = inventory(instance_id, &mods);
    let mut candidates = Vec::new();
    let mut retained_hashes = HashMap::new();
    let mut seen_paths = HashSet::new();
    for path in paths {
        if !seen_paths.insert(normalize_path(path)) {
            continue;
        }
        if !crate::resources::source_enrichment::real_direct_child_file(&game, &mods, path) {
            warnings.push("A published mod file is missing or outside the instance mod directory; its dependencies could not be checked.".into());
            continue;
        }
        let mut resolved = None;
        if let Ok(installed) = &installed {
            if let Some(entry) = installed.iter().find(|entry| {
                normalize_path(Path::new(&entry.row.local_path)) == normalize_path(path)
            }) {
                if let Some(platform) =
                    SourcePlatform::from_str_id(&entry.row.platform).filter(|_| entry.eligible)
                {
                    if !entry.verified().await {
                        candidates.push(ResourceCandidate {
                            path: path.clone(),
                            provenance: None,
                            preferred_platform: None,
                            resolved: None,
                        });
                        continue;
                    }
                    let (project, version) = tokio::join!(
                        manager.get_project(platform, &entry.row.remote_id),
                        manager.get_version(
                            platform,
                            &entry.row.remote_id,
                            &entry.row.remote_version_id
                        )
                    );
                    match (project, version) {
                        (Ok(project), Ok(version))
                            if project.source == platform
                                && project.id == entry.row.remote_id
                                && version.project_id == project.id
                                && version.id == entry.row.remote_version_id =>
                        {
                            // get_version may describe only a primary artifact.
                            // An alternate must be identified by its actual hash.
                            if reconciliation::version_matches_sha1(&version, entry.row.hash.as_deref()) {
                                retained_hashes.insert(normalize_path(path), entry.row.hash.clone().unwrap());
                                resolved = Some(KnownResourceResolution { project, version, platform });
                            }
                        }
                        _ => warnings.push("An identified dropped mod's release metadata is unavailable; its dependencies could not be checked.".into()),
                    }
                }
            }
        }
        candidates.push(ResourceCandidate {
            path: path.clone(),
            provenance: None,
            preferred_platform: None,
            resolved,
        });
    }
    let prepared = reconciliation::prepare_manual_dependency_candidates(
        instance_id,
        candidates,
        retained_hashes,
    )
    .await;
    let evidence = reconciliation::reconcile_prepared_candidates_with_evidence(
        app,
        instance_id,
        prepared,
        "manual-dependency-identification",
    )
    .await
    .map_err(|_| {
        "Dropped mod identification could not be persisted; copied files remain installed."
            .to_string()
    })?;
    warnings.extend(evidence.warnings);
    let policy = match crate::utils::config::get_app_config() {
        Ok(config) => config.manual_mod_dependency_policy,
        Err(_) => {
            warnings.push(
                "Manual dependency policy could not be read; dependency planning was skipped."
                    .into(),
            );
            return Ok(ManualDependencyPlan {
                dependencies: Vec::new(),
                warnings,
            });
        }
    };
    if policy == "never" {
        return Ok(ManualDependencyPlan {
            dependencies: Vec::new(),
            warnings,
        });
    }
    let installed = match inventory(instance_id, &mods) {
        Ok(installed) => installed,
        Err(warning) => {
            warnings.push(warning);
            return Ok(ManualDependencyPlan {
                dependencies: Vec::new(),
                warnings,
            });
        }
    };
    let roots = evidence
        .resolutions
        .into_iter()
        .filter_map(|identified| {
            if identified.project.resource_type != ResourceType::Mod {
                return None;
            }
            if identified
                .path
                .to_string_lossy()
                .to_ascii_lowercase()
                .ends_with(".disabled")
            {
                warnings
                    .push("A dropped mod is disabled; its dependencies were not planned.".into());
                return None;
            }
            if !compatible(&identified.version, &instance.minecraft_version, instance.modloader.as_deref().unwrap_or("vanilla")) {
                warnings.push(format!("{} is incompatible with the instance version or loader; its dependencies were not planned.", identified.project.name));
                return None;
            }
            Some((identified.project, identified.version))
        })
        .collect::<Vec<_>>();
    let mut plan = build_plan(
        manager.inner(),
        &roots,
        &installed,
        &instance.minecraft_version,
        instance.modloader.as_deref().unwrap_or("vanilla"),
    )
    .await;
    plan.warnings.extend(warnings);
    plan.warnings.sort();
    plan.warnings.dedup();
    Ok(plan)
}

/// Recheck the entire approved batch before any submissions. Once a task is
/// submitted, later failures are returned as warnings with the exact queued count.
pub async fn queue_plan(
    app: &AppHandle,
    instance_id: i32,
    plan: &ManualDependencyPlan,
    approved_ids: &[String],
) -> Result<ManualDependencyQueueOutcome, String> {
    let by_id = plan
        .dependencies
        .iter()
        .map(|dep| (dep.id.as_str(), dep))
        .collect::<HashMap<_, _>>();
    let mut seen = HashSet::new();
    let mut approved = Vec::new();
    for id in approved_ids {
        let dependency = by_id
            .get(id.as_str())
            .ok_or_else(|| "The dependency approval includes an unknown plan ID.".to_string())?;
        if seen.insert(id) {
            approved.push((*dependency).clone());
        }
    }
    queue_approved(&AppDependencyQueue { app, instance_id }, approved).await
}

#[async_trait]
trait DependencyQueue: Sync {
    async fn version(&self, dependency: &PlannedDependency) -> Result<ResourceVersion, String>;
    async fn missing(&self, dependency: &PlannedDependency) -> Result<bool, String>;
    async fn submit(
        &self,
        dependency: PlannedDependency,
        version: ResourceVersion,
    ) -> Result<(), String>;
}

struct AppDependencyQueue<'a> {
    app: &'a AppHandle,
    instance_id: i32,
}

#[async_trait]
impl DependencyQueue for AppDependencyQueue<'_> {
    async fn version(&self, dependency: &PlannedDependency) -> Result<ResourceVersion, String> {
        self.app
            .state::<ResourceManager>()
            .get_version(
                dependency.project.source,
                &dependency.project.id,
                &dependency.version.id,
            )
            .await
            .map_err(|_| {
                "An approved dependency release is unavailable; submission was stopped.".to_string()
            })
    }

    async fn missing(&self, dependency: &PlannedDependency) -> Result<bool, String> {
        dependency_missing(self.instance_id, dependency).await
    }

    async fn submit(
        &self,
        dependency: PlannedDependency,
        version: ResourceVersion,
    ) -> Result<(), String> {
        self.app
            .state::<TaskManager>()
            .submit(Box::new(GuardedDependencyTask {
                dependency: dependency.clone(),
                instance_id: self.instance_id,
                download: ResourceDownloadTask {
                    target: ResourceInstallTarget::Instance {
                        instance_id: self.instance_id,
                    },
                    platform: dependency.project.source,
                    project_id: dependency.project.id.clone(),
                    project_name: dependency.project.name.clone(),
                    project_icon_url: dependency.project.icon_url.clone(),
                    version,
                    resource_type: ResourceType::Mod,
                    dependency_for: Some("manually added mods".into()),
                    replacement_resource_id: None,
                },
            }))
            .await
    }
}

fn stopped_queue(
    mut outcome: ManualDependencyQueueOutcome,
    warning: String,
) -> Result<ManualDependencyQueueOutcome, String> {
    if outcome.queued == 0 {
        Err(warning)
    } else {
        outcome.warnings.push(warning);
        Ok(outcome)
    }
}

async fn queue_approved<Q: DependencyQueue>(
    queue: &Q,
    approved: Vec<PlannedDependency>,
) -> Result<ManualDependencyQueueOutcome, String> {
    let mut ready = Vec::new();
    let mut destinations = HashSet::new();
    for dependency in approved {
        let version = queue.version(&dependency).await?;
        if !approved_release_matches(&dependency.version, &version)
            || version.project_id != dependency.project.id
        {
            return Err(
                "An approved dependency release changed; create a new dependency plan.".into(),
            );
        }
        if queue.missing(&dependency).await? {
            let artifacts = plan_artifacts(&version, ResourceType::Mod)
                .map_err(|_| "A dependency has an invalid download artifact.".to_string())?;
            for artifact in artifacts {
                if !destinations.insert(artifact.file_name.to_ascii_lowercase()) {
                    return Err("Approved dependencies have conflicting mod filenames; create a new dependency plan.".into());
                }
            }
            ready.push((dependency, version));
        }
    }
    let mut outcome = ManualDependencyQueueOutcome::default();
    for (dependency, version) in ready {
        // Inventory may change during prevalidation or earlier task submissions.
        match queue.missing(&dependency).await {
            Ok(false) => continue,
            Ok(true) => {}
            Err(warning) => return stopped_queue(outcome, warning),
        }
        if let Err(warning) = queue.submit(dependency, version).await {
            return stopped_queue(outcome, warning);
        }
        outcome.queued += 1;
    }
    Ok(outcome)
}

/// True only when the approved dependency is absent and publication is safe.
async fn dependency_missing(
    instance_id: i32,
    dependency: &PlannedDependency,
) -> Result<bool, String> {
    let instance = crate::commands::instances::get_instance(instance_id)?;
    let game = crate::worlds::instance_game_directory(&instance)?;
    let mods = game.join("mods");
    if !compatible(
        &dependency.version,
        &instance.minecraft_version,
        instance.modloader.as_deref().unwrap_or("vanilla"),
    ) || !mod_artifacts(&dependency.project, &dependency.version)
        || dependency.id != planned(dependency.project.clone(), dependency.version.clone()).id
        || dependency.version.project_id != dependency.project.id
    {
        return Err(
            "The dependency plan no longer matches this instance's version and loader.".into(),
        );
    }
    let installed = inventory(instance_id, &mods)?;
    let hash_present = matching_inventory_content(&installed, dependency).await?;
    let peer =
        reconciliation::find_persisted_peer(dependency.project.source, &dependency.project.id)
            .map_err(|_| {
                "Installed peer identity is unavailable; dependency submission was stopped."
                    .to_string()
            })?;
    let matches = installed
        .iter()
        .filter(|entry| matches_project(&entry.row, &dependency.project, peer.as_ref()))
        .collect::<Vec<_>>();
    for entry in &matches {
        let same_release = (entry.row.platform == dependency.project.source.as_str()
            && entry.row.remote_version_id == dependency.version.id)
            || (!dependency.version.hash.is_empty()
                && entry
                    .row
                    .hash
                    .as_ref()
                    .is_some_and(|hash| hash.eq_ignore_ascii_case(&dependency.version.hash)));
        if same_release
            && recorded_content_matches(&entry.row, &dependency.version)
            && entry.verified().await
        {
            return Ok(false);
        }
    }
    if !matches.is_empty() {
        return Err(format!("{} now has an installed, disabled, missing, or differing release; manual dependencies never replace or enable it.", dependency.project.name));
    }
    if hash_present {
        return Ok(false);
    }
    // Repeat cheap authoritative reads after asynchronous content checks.
    let latest = crate::commands::instances::get_instance(instance_id)?;
    if latest.minecraft_version != instance.minecraft_version
        || latest.modloader != instance.modloader
        || crate::worlds::instance_game_directory(&latest)? != game
    {
        return Err("The instance changed during dependency validation; create a new plan.".into());
    }
    if inventory(instance_id, &mods)?
        .iter()
        .any(|entry| matches_project(&entry.row, &dependency.project, peer.as_ref()))
    {
        return Err("Installed dependency inventory changed; submission was stopped.".into());
    }
    let artifacts = plan_artifacts(&dependency.version, ResourceType::Mod)
        .map_err(|_| "A dependency has an invalid download artifact.".to_string())?;
    if artifacts.iter().any(|artifact| {
        let path = mods.join(&artifact.file_name);
        path.exists() || crate::resources::ledger::toggled_path(&path, false).exists()
    }) {
        return Err(format!(
            "{} has an occupied mod filename; manual dependencies never replace or enable it.",
            dependency.project.name
        ));
    }
    Ok(true)
}

/// ResourceDownloadTask's ordinary provider flow may replace an older project.
/// Keep that behavior there; manual downloads recheck under its conflict locks.
struct GuardedDependencyTask {
    instance_id: i32,
    dependency: PlannedDependency,
    download: ResourceDownloadTask,
}

impl Task for GuardedDependencyTask {
    fn name(&self) -> String {
        self.download.name()
    }
    fn id(&self) -> Option<String> {
        self.download.id()
    }
    fn notification_context(&self) -> Option<crate::notifications::models::NotificationContext> {
        self.download.notification_context()
    }
    fn cancellable(&self) -> bool {
        self.download.cancellable()
    }
    fn conflict_keys(&self) -> Vec<String> {
        self.download.conflict_keys()
    }
    fn show_completion_notification(&self) -> bool {
        self.download.show_completion_notification()
    }
    fn completion_description(&self) -> String {
        self.download.completion_description()
    }
    fn run(&self, ctx: TaskContext) -> BoxFuture<'static, Result<(), String>> {
        let instance_id = self.instance_id;
        let dependency = self.dependency.clone();
        let download = self.download.run(ctx);
        Box::pin(async move {
            if dependency_missing(instance_id, &dependency).await? {
                download.await
            } else {
                Ok(())
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inventory_accepts_canonical_candidate_under_declared_root_alias() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::create_dir(temp.path().join("anchor")).unwrap();
        let mods = temp.path().join("anchor/../game/mods");
        std::fs::create_dir_all(&mods).unwrap();
        std::fs::write(mods.join("a.jar"), b"mod").unwrap();
        let path = mods.join("a.jar").canonicalize().unwrap();
        let entry = inventory_entry(row(&path, "a", "a1"), &mods);
        assert!(entry.present && entry.eligible);
        assert_eq!(entry.row.local_path, path.to_string_lossy());
    }

    #[test]
    fn inventory_presence_remains_independent_of_scope_and_enabled_state() {
        let temp = tempfile::tempdir().unwrap();
        let mods = temp.path().join("mods");
        std::fs::create_dir_all(mods.join("nested")).unwrap();
        for path in [
            temp.path().join("outside.jar"),
            mods.join("nested/a.jar"),
            mods.join("a.jar.disabled"),
        ] {
            std::fs::write(&path, b"mod").unwrap();
            let entry = inventory_entry(row(&path, "a", "a1"), &mods);
            assert!(entry.present);
            assert!(!entry.eligible);
        }
        let entry = inventory_entry(row(&mods.join("missing.jar"), "a", "a1"), &mods);
        assert!(!entry.present && !entry.eligible);
    }

    #[cfg(unix)]
    #[test]
    fn linked_inventory_is_present_but_ineligible() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let mods = temp.path().join("mods");
        std::fs::create_dir(&mods).unwrap();
        std::fs::write(mods.join("a.jar"), b"mod").unwrap();
        symlink(mods.join("a.jar"), mods.join("linked.jar")).unwrap();
        symlink(&mods, temp.path().join("linked-mods")).unwrap();
        for (directory, path) in [
            (&mods, mods.join("linked.jar")),
            (
                &temp.path().join("linked-mods"),
                mods.join("a.jar").canonicalize().unwrap(),
            ),
        ] {
            let entry = inventory_entry(row(&path, "a", "a1"), directory);
            assert!(entry.present && !entry.eligible);
        }
    }

    #[cfg(windows)]
    #[test]
    fn inventory_accepts_verbatim_candidate_under_ordinary_windows_root() {
        let temp = tempfile::tempdir().unwrap();
        let mods = crate::resources::source_enrichment::ordinary_windows_test_path(temp.path())
            .join("mods");
        std::fs::create_dir(&mods).unwrap();
        std::fs::write(mods.join("a.jar"), b"mod").unwrap();
        let path = mods.join("a.jar").canonicalize().unwrap();
        assert_ne!(path.parent(), Some(mods.as_path()));
        let entry = inventory_entry(row(&path, "a", "a1"), &mods);
        assert!(entry.present && entry.eligible);
    }

    #[test]
    fn approval_ignores_counts_but_rejects_changed_release_facts() {
        let mut approved = version("a", "a1", vec![dependency("b", Some("b1"))]);
        approved
            .files
            .push(crate::models::resource::ResourceVersionFile {
                url: "https://example.invalid/alternate.jar".into(),
                file_name: "alternate.jar".into(),
                hash: "alternate-hash".into(),
                file_size: Some(42),
                role: "alternate".into(),
            });
        let mut current = approved.clone();
        current.download_count = Some(1000);
        assert!(approved_release_matches(&approved, &current));
        let changes: Vec<Box<dyn Fn(&mut ResourceVersion)>> = vec![
            Box::new(|v| v.id = "other".into()),
            Box::new(|v| v.project_id = "other".into()),
            Box::new(|v| v.download_url.push_str("?changed")),
            Box::new(|v| v.file_name = "other.jar".into()),
            Box::new(|v| v.hash = "changed".into()),
            Box::new(|v| v.file_size = Some(999)),
            Box::new(|v| v.files[0].hash = "changed".into()),
            Box::new(|v| v.game_versions.push("1.22".into())),
            Box::new(|v| v.loaders = vec!["forge".into()]),
            Box::new(|v| v.dependencies[0].version_id = Some("b2".into())),
            Box::new(|v| v.dependencies[0].dependency_type = DependencyType::Optional),
        ];
        for change in changes {
            let mut changed = current.clone();
            change(&mut changed);
            assert!(!approved_release_matches(&approved, &changed));
        }
    }

    struct FakeQueue {
        versions: HashMap<String, ResourceVersion>,
        missing: std::sync::Mutex<VecDeque<Result<bool, String>>>,
        submissions: std::sync::Mutex<Vec<String>>,
        fail_submit: Option<String>,
    }
    #[async_trait]
    impl DependencyQueue for FakeQueue {
        async fn version(&self, dependency: &PlannedDependency) -> Result<ResourceVersion, String> {
            self.versions
                .get(&dependency.id)
                .cloned()
                .ok_or("release unavailable".into())
        }
        async fn missing(&self, _: &PlannedDependency) -> Result<bool, String> {
            self.missing.lock().unwrap().pop_front().unwrap_or(Ok(true))
        }
        async fn submit(
            &self,
            dependency: PlannedDependency,
            _: ResourceVersion,
        ) -> Result<(), String> {
            if self.fail_submit.as_ref() == Some(&dependency.id) {
                return Err("submission failed".into());
            }
            self.submissions.lock().unwrap().push(dependency.id);
            Ok(())
        }
    }
    fn queue_fixture() -> (FakeQueue, Vec<PlannedDependency>) {
        let approved = ["a", "b", "c"]
            .into_iter()
            .map(|id| planned(project(id), version(id, "v1", vec![])))
            .collect::<Vec<_>>();
        let queue = FakeQueue {
            versions: approved
                .iter()
                .map(|d| (d.id.clone(), d.version.clone()))
                .collect(),
            missing: Default::default(),
            submissions: Default::default(),
            fail_submit: None,
        };
        (queue, approved)
    }

    #[tokio::test]
    async fn entire_queue_is_validated_before_any_submission() {
        let (mut queue, approved) = queue_fixture();
        queue.versions.remove(&approved[2].id);
        assert_eq!(
            queue_approved(&queue, approved).await.unwrap_err(),
            "release unavailable"
        );
        assert!(queue.submissions.lock().unwrap().is_empty());
        let (queue, approved) = queue_fixture();
        queue
            .missing
            .lock()
            .unwrap()
            .extend([Ok(true), Ok(true), Err("inventory failed".into())]);
        assert_eq!(
            queue_approved(&queue, approved).await.unwrap_err(),
            "inventory failed"
        );
        assert!(queue.submissions.lock().unwrap().is_empty());
        let (mut queue, approved) = queue_fixture();
        queue.versions.get_mut(&approved[2].id).unwrap().hash = "changed".into();
        assert!(queue_approved(&queue, approved)
            .await
            .unwrap_err()
            .contains("release changed"));
        assert!(queue.submissions.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn conflicting_approved_destinations_fail_before_submission() {
        let (mut queue, mut approved) = queue_fixture();
        approved[2].version.file_name = approved[0].version.file_name.clone();
        queue
            .versions
            .insert(approved[2].id.clone(), approved[2].version.clone());
        assert!(queue_approved(&queue, approved)
            .await
            .unwrap_err()
            .contains("conflicting mod filenames"));
        assert!(queue.submissions.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn queue_reports_exact_partial_count_for_submit_and_recheck_failures() {
        let (mut queue, approved) = queue_fixture();
        queue.fail_submit = Some(approved[2].id.clone());
        let outcome = queue_approved(&queue, approved).await.unwrap();
        assert_eq!(
            outcome,
            ManualDependencyQueueOutcome {
                queued: 2,
                warnings: vec!["submission failed".into()]
            }
        );
        assert_eq!(queue.submissions.lock().unwrap().len(), 2);
        let (queue, approved) = queue_fixture();
        queue.missing.lock().unwrap().extend([
            Ok(true),
            Ok(true),
            Ok(true),
            Ok(true),
            Err("inventory changed".into()),
        ]);
        let outcome = queue_approved(&queue, approved).await.unwrap();
        assert_eq!(
            outcome,
            ManualDependencyQueueOutcome {
                queued: 1,
                warnings: vec!["inventory changed".into()]
            }
        );
        assert_eq!(queue.submissions.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn queue_counts_only_submissions_and_accepts_updated_statistics() {
        let (mut queue, approved) = queue_fixture();
        for v in queue.versions.values_mut() {
            v.download_count = Some(500);
        }
        queue
            .missing
            .lock()
            .unwrap()
            .extend([Ok(true), Ok(false), Ok(true), Ok(false), Ok(true)]);
        assert_eq!(
            queue_approved(&queue, approved).await.unwrap(),
            ManualDependencyQueueOutcome {
                queued: 1,
                warnings: vec![]
            }
        );
        assert_eq!(queue.submissions.lock().unwrap().len(), 1);
        let (mut queue, approved) = queue_fixture();
        queue.fail_submit = Some(approved[0].id.clone());
        assert_eq!(
            queue_approved(&queue, approved).await.unwrap_err(),
            "submission failed"
        );
    }

    #[tokio::test]
    async fn renamed_disabled_verified_content_blocks_planning_and_queue_validation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("renamed.jar.disabled");
        std::fs::write(&path, b"mod").unwrap();
        let mut installed = row(&path, "", "");
        installed.platform = "manual".into();
        installed.is_enabled = false;
        installed.hash = Some(calculate_sha1(&path).unwrap());
        let mut release = version("a", "a1", vec![]);
        release.hash = installed.hash.clone().unwrap();
        let mut entries = vec![inventory_entry(installed, dir.path())];
        assert!(entries[0].content_verified().await);
        assert!(!entries[0].verified().await);
        let dependency_plan = planned(project("a"), release.clone());
        assert!(matching_inventory_content(&entries, &dependency_plan)
            .await
            .unwrap_err()
            .contains("disabled"));
        let lookup = provider(vec![("a", vec![release])]);
        let root = version("root", "r1", vec![dependency("a", Some("a1"))]);
        let plan = build_plan(
            &lookup,
            &[(project("root"), root)],
            &entries,
            "1.21.1",
            "fabric",
        )
        .await;
        assert!(plan.dependencies.is_empty());
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("disabled")));
        // An enabled duplicate must not hide a disabled reuse conflict.
        let enabled_path = dir.path().join("enabled.jar");
        std::fs::write(&enabled_path, b"mod").unwrap();
        let mut enabled = row(&enabled_path, "a", "a1");
        enabled.hash = entries[0].row.hash.clone();
        entries.insert(0, inventory_entry(enabled, dir.path()));
        assert!(matching_inventory_content(&entries, &dependency_plan)
            .await
            .is_err());
    }

    struct FakeProvider {
        projects: HashMap<ProjectKey, ResourceProject>,
        versions: HashMap<ProjectKey, Vec<ResourceVersion>>,
    }
    #[async_trait]
    impl DependencyLookup for FakeProvider {
        async fn project(&self, platform: SourcePlatform, id: &str) -> Result<ResourceProject, ()> {
            self.projects.get(&(platform, id.into())).cloned().ok_or(())
        }
        async fn versions(
            &self,
            platform: SourcePlatform,
            id: &str,
        ) -> Result<Vec<ResourceVersion>, ()> {
            self.versions.get(&(platform, id.into())).cloned().ok_or(())
        }
        async fn version(
            &self,
            platform: SourcePlatform,
            project: &str,
            id: &str,
        ) -> Result<ResourceVersion, ()> {
            self.versions
                .iter()
                .filter(|((source, key), _)| {
                    *source == platform && (project.is_empty() || key == project)
                })
                .flat_map(|(_, versions)| versions)
                .find(|version| version.id == id)
                .cloned()
                .ok_or(())
        }
        async fn peer(&self, _: &ResourceProject) -> Result<Option<ProjectKey>, ()> {
            Ok(None)
        }
    }
    fn project(id: &str) -> ResourceProject {
        ResourceProject {
            id: id.into(),
            source: SourcePlatform::Modrinth,
            resource_type: ResourceType::Mod,
            name: id.into(),
            summary: String::new(),
            description: None,
            icon_url: None,
            author: String::new(),
            authors: vec![],
            author_details: vec![],
            organization: None,
            project_types: vec![ResourceType::Mod],
            download_count: 0,
            follower_count: 0,
            categories: vec![],
            web_url: String::new(),
            links: vec![],
            environment: None,
            external_ids: None,
            gallery: vec![],
            featured_gallery: None,
            published_at: None,
            updated_at: None,
        }
    }
    fn dependency(id: &str, pin: Option<&str>) -> ResourceDependency {
        ResourceDependency {
            project_id: id.into(),
            version_id: pin.map(str::to_string),
            file_name: None,
            dependency_type: DependencyType::Required,
        }
    }
    fn version(project: &str, id: &str, dependencies: Vec<ResourceDependency>) -> ResourceVersion {
        ResourceVersion {
            id: id.into(),
            project_id: project.into(),
            version_number: id.into(),
            game_versions: vec!["1.21.1".into()],
            loaders: vec!["fabric".into()],
            download_url: "https://example.invalid/mod.jar".into(),
            file_name: format!("{project}.jar"),
            release_type: ReleaseType::Release,
            hash: String::new(),
            dependencies,
            published_at: Some("2026-01-01".into()),
            download_count: None,
            file_size: None,
            files: vec![],
        }
    }
    fn provider(entries: Vec<(&str, Vec<ResourceVersion>)>) -> FakeProvider {
        FakeProvider {
            projects: entries
                .iter()
                .map(|(id, _)| (key(&project(id)), project(id)))
                .collect(),
            versions: entries
                .into_iter()
                .map(|(id, versions)| (key(&project(id)), versions))
                .collect(),
        }
    }
    fn row(path: &Path, project_id: &str, version_id: &str) -> InstalledResource {
        InstalledResource {
            id: 1,
            instance_id: 1,
            platform: "modrinth".into(),
            remote_id: project_id.into(),
            remote_version_id: version_id.into(),
            resource_type: "mod".into(),
            local_path: normalize_path(path),
            display_name: "same display name".into(),
            current_version: "same display name".into(),
            is_manual: true,
            is_enabled: true,
            last_updated: String::new(),
            release_type: "release".into(),
            hash: None,
            file_size: 0,
            file_mtime: 0,
            source_kind: "manual".into(),
            source_modpack_id: None,
            source_modpack_version_id: None,
            source_modpack_platform: None,
            manual_source_evidence: None,
        }
    }

    #[tokio::test]
    async fn required_cycles_dedupe_and_ignore_other_dependency_types() {
        let mut optional = dependency("optional", None);
        optional.dependency_type = DependencyType::Optional;
        let mut embedded = dependency("embedded", None);
        embedded.dependency_type = DependencyType::Embedded;
        let mut incompatible = dependency("incompatible", None);
        incompatible.dependency_type = DependencyType::Incompatible;
        let root = version(
            "root",
            "r1",
            vec![
                dependency("a", None),
                dependency("a", None),
                optional,
                embedded,
                incompatible,
            ],
        );
        let lookup = provider(vec![
            ("a", vec![version("a", "a1", vec![dependency("b", None)])]),
            (
                "b",
                vec![version(
                    "b",
                    "b1",
                    vec![dependency("a", None), dependency("root", None)],
                )],
            ),
            ("root", vec![root.clone()]),
        ]);
        let plan = build_plan(&lookup, &[(project("root"), root)], &[], "1.21.1", "fabric").await;
        assert_eq!(
            plan.dependencies
                .iter()
                .map(|dep| dep.id.as_str())
                .collect::<Vec<_>>(),
            ["modrinth:a:a1", "modrinth:b:b1"]
        );
        assert!(plan.warnings.is_empty());
    }

    #[tokio::test]
    async fn missing_and_incompatible_pins_never_select_an_alternate() {
        let mut wrong = version("a", "wrong", vec![]);
        wrong.loaders = vec!["forge".into()];
        let lookup = provider(vec![("a", vec![version("a", "good", vec![]), wrong])]);
        for pin in ["missing", "wrong"] {
            let root = version("root", "r1", vec![dependency("a", Some(pin))]);
            let plan =
                build_plan(&lookup, &[(project("root"), root)], &[], "1.21.1", "fabric").await;
            assert!(plan.dependencies.is_empty());
            assert!(plan
                .warnings
                .iter()
                .any(|warning| warning.contains("pinned release")));
        }
    }

    #[tokio::test]
    async fn shared_later_pin_rebuilds_edges_of_the_unpinned_version() {
        let lookup = provider(vec![
            (
                "a",
                vec![
                    version("a", "a1", vec![dependency("old-child", None)]),
                    version("a", "a2", vec![dependency("new-child", None)]),
                ],
            ),
            ("old-child", vec![version("old-child", "o1", vec![])]),
            ("new-child", vec![version("new-child", "n1", vec![])]),
        ]);
        let roots = vec![
            (
                project("root1"),
                version("root1", "r1", vec![dependency("a", None)]),
            ),
            (
                project("root2"),
                version("root2", "r2", vec![dependency("a", Some("a2"))]),
            ),
        ];
        let plan = build_plan(&lookup, &roots, &[], "1.21.1", "fabric").await;
        assert_eq!(
            plan.dependencies
                .iter()
                .map(|dep| dep.id.as_str())
                .collect::<Vec<_>>(),
            ["modrinth:a:a2", "modrinth:new-child:n1"]
        );
    }

    #[tokio::test]
    async fn conflicting_root_pins_block_shared_project() {
        let lookup = provider(vec![(
            "a",
            vec![version("a", "a1", vec![]), version("a", "a2", vec![])],
        )]);
        let roots = vec![
            (
                project("root1"),
                version("root1", "r1", vec![dependency("a", Some("a1"))]),
            ),
            (
                project("root2"),
                version("root2", "r2", vec![dependency("a", Some("a2"))]),
            ),
        ];
        let plan = build_plan(&lookup, &roots, &[], "1.21.1", "fabric").await;
        assert!(plan.dependencies.is_empty());
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("conflicting")));
    }

    #[test]
    fn provider_and_peer_ids_match_without_display_names() {
        let mut installed = row(Path::new("/unused/a.jar"), "other", "a1");
        let mut dependency_project = project("a");
        dependency_project.name = installed.display_name.clone();
        assert!(!matches_project(&installed, &dependency_project, None));
        installed.platform = "curseforge".into();
        installed.remote_id = "123".into();
        assert!(matches_project(
            &installed,
            &dependency_project,
            Some(&(SourcePlatform::CurseForge, "123".into()))
        ));
        assert!(!matches_project(
            &installed,
            &dependency_project,
            Some(&(SourcePlatform::CurseForge, "999".into()))
        ));
    }

    #[tokio::test]
    async fn stale_or_disabled_inventory_is_not_empty_and_never_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.jar");
        std::fs::write(&path, b"changed").unwrap();
        let mut installed = row(&path, "a", "a1");
        installed.hash = Some("stale-hash".into());
        let entry = inventory_entry(installed.clone(), dir.path());
        assert!(entry.present);
        assert!(!entry.verified().await);
        let lookup = provider(vec![("a", vec![version("a", "a1", vec![])])]);
        let root = version("root", "r1", vec![dependency("a", None)]);
        for entry in [entry, {
            installed.hash = Some(calculate_sha1(&path).unwrap());
            installed.is_enabled = false;
            inventory_entry(installed, dir.path())
        }] {
            let plan = build_plan(
                &lookup,
                &[(project("root"), root.clone())],
                &[entry],
                "1.21.1",
                "fabric",
            )
            .await;
            assert!(plan.dependencies.is_empty());
            assert!(!plan.warnings.is_empty());
        }
    }

    #[tokio::test]
    async fn installed_exact_release_satisfies_pin_and_current_batch_roots_are_not_downloaded() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.jar");
        std::fs::write(&path, b"mod").unwrap();
        let mut installed = row(&path, "a", "a1");
        installed.hash = Some(calculate_sha1(&path).unwrap());
        let root = version("root", "r1", vec![dependency("a", Some("a1"))]);
        let lookup = provider(vec![("a", vec![version("a", "a1", vec![])])]);
        let plan = build_plan(
            &lookup,
            &[(project("root"), root.clone())],
            &[inventory_entry(installed, dir.path())],
            "1.21.1",
            "fabric",
        )
        .await;
        assert!(plan.dependencies.is_empty());
        assert!(plan.warnings.is_empty());
        let roots = vec![
            (project("root"), root),
            (project("a"), version("a", "a1", vec![])),
        ];
        let plan = build_plan(&lookup, &roots, &[], "1.21.1", "fabric").await;
        assert!(plan.dependencies.is_empty());
        assert!(plan.warnings.is_empty());
    }

    #[tokio::test]
    async fn missing_provider_and_non_mod_dependencies_warn() {
        let root = version("root", "r1", vec![dependency("a", None)]);
        let missing = provider(vec![]);
        let plan = build_plan(
            &missing,
            &[(project("root"), root.clone())],
            &[],
            "1.21.1",
            "fabric",
        )
        .await;
        assert!(plan.dependencies.is_empty());
        assert!(!plan.warnings.is_empty());
        let mut lookup = provider(vec![("a", vec![version("a", "a1", vec![])])]);
        lookup
            .projects
            .get_mut(&key(&project("a")))
            .unwrap()
            .resource_type = ResourceType::DataPack;
        let plan = build_plan(&lookup, &[(project("root"), root)], &[], "1.21.1", "fabric").await;
        assert!(plan.dependencies.is_empty());
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("destination")));
    }

    #[tokio::test]
    async fn depth_limit_returns_no_partial_downloads() {
        let entries = (0..MAX_DEPTH + 2)
            .map(|i| {
                let id = format!("node{i}");
                let next = format!("node{}", i + 1);
                (
                    id.clone(),
                    vec![version(
                        &id,
                        &format!("v{i}"),
                        vec![dependency(&next, None)],
                    )],
                )
            })
            .collect::<Vec<_>>();
        let lookup = provider(
            entries
                .iter()
                .map(|(id, versions)| (id.as_str(), versions.clone()))
                .collect(),
        );
        let root = version("root", "r1", vec![dependency("node0", None)]);
        let plan = build_plan(&lookup, &[(project("root"), root)], &[], "1.21.1", "fabric").await;
        assert!(plan.dependencies.is_empty());
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("limit")));
    }

    #[tokio::test]
    async fn node_limit_applies_to_missing_provider_projects_too() {
        let roots = vec![(
            project("root"),
            version(
                "root",
                "r1",
                (0..MAX_NODES + 1)
                    .map(|i| dependency(&format!("missing{i}"), None))
                    .collect(),
            ),
        )];
        let plan = build_plan(&provider(vec![]), &roots, &[], "1.21.1", "fabric").await;
        assert!(plan.dependencies.is_empty());
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("limit")));
    }

    #[tokio::test]
    async fn cross_provider_peer_choices_cannot_install_two_different_releases() {
        let mut mr = project("a");
        mr.external_ids = Some(HashMap::from([("curseforge".into(), "123".into())]));
        let mut cf = project("123");
        cf.source = SourcePlatform::CurseForge;
        let mut cf_root = project("cf-root");
        cf_root.source = SourcePlatform::CurseForge;
        let roots = vec![
            (
                project("mr-root"),
                version("mr-root", "r1", vec![dependency("a", None)]),
            ),
            (
                cf_root,
                version("cf-root", "r2", vec![dependency("123", None)]),
            ),
        ];
        let lookup = FakeProvider {
            projects: HashMap::from([(key(&mr), mr.clone()), (key(&cf), cf.clone())]),
            versions: HashMap::from([
                (key(&mr), vec![version("a", "a1", vec![])]),
                (key(&cf), vec![version("123", "cf1", vec![])]),
            ]),
        };
        let plan = build_plan(&lookup, &roots, &[], "1.21.1", "fabric").await;
        assert!(plan.dependencies.is_empty());
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("provider release choices")));
    }

    #[tokio::test]
    async fn verified_unenriched_file_hash_satisfies_exact_provider_release() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("renamed.jar");
        std::fs::write(&path, b"mod").unwrap();
        let mut installed = row(&path, "", "");
        installed.platform = "manual".into();
        installed.hash = Some(calculate_sha1(&path).unwrap());
        let mut release = version("a", "a1", vec![]);
        release.hash = installed.hash.clone().unwrap();
        let lookup = provider(vec![("a", vec![release])]);
        let root = version("root", "r1", vec![dependency("a", Some("a1"))]);
        let plan = build_plan(
            &lookup,
            &[(project("root"), root)],
            &[inventory_entry(installed, dir.path())],
            "1.21.1",
            "fabric",
        )
        .await;
        assert!(plan.dependencies.is_empty());
        assert!(plan.warnings.is_empty());
    }

    #[tokio::test]
    async fn active_differing_release_never_satisfies_a_pin_or_gets_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.jar");
        std::fs::write(&path, b"old").unwrap();
        let mut installed = row(&path, "a", "a1");
        installed.hash = Some(calculate_sha1(&path).unwrap());
        let lookup = provider(vec![(
            "a",
            vec![version("a", "a1", vec![]), version("a", "a2", vec![])],
        )]);
        let root = version("root", "r1", vec![dependency("a", Some("a2"))]);
        let plan = build_plan(
            &lookup,
            &[(project("root"), root)],
            &[inventory_entry(installed, dir.path())],
            "1.21.1",
            "fabric",
        )
        .await;
        assert!(plan.dependencies.is_empty());
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("not be replaced")));
    }

    #[tokio::test]
    async fn incompatible_dependency_pin_on_current_batch_root_cannot_replace_it() {
        let roots = vec![
            (
                project("root"),
                version("root", "r1", vec![dependency("a", Some("a2"))]),
            ),
            (project("a"), version("a", "a1", vec![])),
        ];
        let plan = build_plan(&provider(vec![]), &roots, &[], "1.21.1", "fabric").await;
        assert!(plan.dependencies.is_empty());
        assert!(plan
            .warnings
            .iter()
            .any(|warning| warning.contains("dropped mod version")));
    }
}
