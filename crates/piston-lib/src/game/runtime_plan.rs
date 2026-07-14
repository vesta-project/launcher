use crate::game::installer::types::{InstallSpec, ModloaderType, OsType, VerificationResult};
use crate::game::java_policy::{java_requirement_from_version_detail_value, JavaRequirement};
use crate::game::launcher::types::LaunchSpec;
use crate::game::launcher::unified_manifest::UnifiedManifest;
use crate::game::launcher::version_parser::{merge_manifests, Artifact, VersionManifest};
use std::collections::HashSet;
use std::fmt;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RuntimeRequest {
    pub version_id: String,
    pub modloader: Option<ModloaderType>,
    pub modloader_version: Option<String>,
    pub data_dir: PathBuf,
    pub os: OsType,
}

impl RuntimeRequest {
    pub fn installed_version_id(&self) -> String {
        match (&self.modloader, &self.modloader_version) {
            (Some(loader), Some(loader_version)) if *loader != ModloaderType::Vanilla => format!(
                "{}-loader-{}-{}",
                loader.as_str(),
                loader_version,
                self.version_id
            ),
            _ => self.version_id.clone(),
        }
    }

    pub fn is_modded(&self) -> bool {
        self.modloader
            .is_some_and(|loader| loader != ModloaderType::Vanilla)
    }

    fn versions_dir(&self) -> PathBuf {
        self.data_dir.join("versions")
    }
}

impl From<&InstallSpec> for RuntimeRequest {
    fn from(spec: &InstallSpec) -> Self {
        Self {
            version_id: spec.version_id.clone(),
            modloader: spec.modloader,
            modloader_version: spec.modloader_version.clone(),
            data_dir: spec.data_dir.clone(),
            os: OsType::current(),
        }
    }
}

impl From<&LaunchSpec> for RuntimeRequest {
    fn from(spec: &LaunchSpec) -> Self {
        Self {
            version_id: spec.version_id.clone(),
            modloader: spec.modloader,
            modloader_version: spec.modloader_version.clone(),
            data_dir: spec.data_dir.clone(),
            os: OsType::current(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManifestSource {
    Vanilla,
    Installed,
}

#[derive(Debug, Clone)]
pub struct RuntimePlan {
    pub request: RuntimeRequest,
    pub installed_version_id: String,
    pub manifest_path: PathBuf,
    pub manifest_source: ManifestSource,
    pub manifest: UnifiedManifest,
    pub installed_client_jar: PathBuf,
    pub vanilla_client_jar: PathBuf,
    pub client_jar: PathBuf,
    pub client_download: Option<Artifact>,
    pub asset_index_path: Option<PathBuf>,
    pub libraries_dir: PathBuf,
    pub natives_dir: PathBuf,
    pub java_requirement: JavaRequirement,
}

impl RuntimePlan {
    pub fn resolve_installed(request: RuntimeRequest) -> Result<Self, RuntimePlanError> {
        let installed_id = request.installed_version_id();
        let vanilla_path = manifest_path(&request, &request.version_id);
        let selected_path = if request.is_modded() {
            manifest_path(&request, &installed_id)
        } else {
            vanilla_path.clone()
        };
        let source = if request.is_modded() {
            ManifestSource::Installed
        } else {
            ManifestSource::Vanilla
        };

        if !selected_path.exists() {
            return Err(RuntimePlanError::missing(
                selected_path,
                if request.is_modded() {
                    "Modloader version manifest is missing"
                } else {
                    "Version manifest is missing"
                },
            ));
        }
        if !vanilla_path.exists() {
            return Err(RuntimePlanError::missing(
                vanilla_path,
                "Vanilla version manifest is missing",
            ));
        }

        let vanilla = resolve_manifest_chain(&request, &request.version_id, &mut HashSet::new())?;
        let manifest = load_selected_manifest(&request, &installed_id, &selected_path)?;
        Self::build(request, vanilla, manifest, selected_path, source)
    }

    pub fn from_manifests(
        request: RuntimeRequest,
        vanilla: VersionManifest,
        loader: Option<VersionManifest>,
    ) -> Result<Self, RuntimePlanError> {
        let installed_id = request.installed_version_id();
        let source = if request.is_modded() {
            ManifestSource::Installed
        } else {
            ManifestSource::Vanilla
        };
        let selected_path = manifest_path(&request, &installed_id);
        let manifest = UnifiedManifest::merge(vanilla.clone(), loader, request.os);
        Self::build(request, vanilla, manifest, selected_path, source)
    }

    pub fn validate_launch_spec(&self, spec: &LaunchSpec) -> Result<(), RuntimePlanError> {
        let request = RuntimeRequest::from(spec);
        if request != self.request {
            return Err(RuntimePlanError::invalid(
                self.manifest_path.clone(),
                "Runtime plan does not match the launch specification",
            ));
        }
        Ok(())
    }

    fn build(
        request: RuntimeRequest,
        vanilla: VersionManifest,
        mut manifest: UnifiedManifest,
        manifest_path: PathBuf,
        manifest_source: ManifestSource,
    ) -> Result<Self, RuntimePlanError> {
        manifest.apply_native_arch_policy(request.os);
        let installed_version_id = request.installed_version_id();
        let installed_client_jar = request
            .versions_dir()
            .join(&installed_version_id)
            .join(format!("{}.jar", installed_version_id));
        let vanilla_client_jar = request
            .versions_dir()
            .join(&request.version_id)
            .join(format!("{}.jar", request.version_id));
        let client_jar = if installed_client_jar.exists() {
            installed_client_jar.clone()
        } else {
            vanilla_client_jar.clone()
        };
        let client_download = vanilla.downloads.as_ref().and_then(|d| d.client.clone());
        let asset_index_path = manifest.asset_index.as_ref().map(|asset| {
            request
                .data_dir
                .join("assets")
                .join("indexes")
                .join(format!("{}.json", asset.id))
        });
        let vanilla_json = serde_json::to_value(&vanilla)
            .map_err(|error| RuntimePlanError::invalid(manifest_path.clone(), error.to_string()))?;
        let java_requirement =
            java_requirement_from_version_detail_value(&request.version_id, vanilla_json).map_err(
                |error| RuntimePlanError::invalid(manifest_path.clone(), error.to_string()),
            )?;

        Ok(Self {
            libraries_dir: request.data_dir.join("libraries"),
            natives_dir: request.data_dir.join("natives").join(&request.version_id),
            request,
            installed_version_id,
            manifest_path,
            manifest_source,
            manifest,
            installed_client_jar,
            vanilla_client_jar,
            client_jar,
            client_download,
            asset_index_path,
            java_requirement,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimePlanErrorKind {
    Missing,
    Unreadable,
    Invalid,
    InheritanceCycle,
}

#[derive(Debug, Clone)]
pub struct RuntimePlanError {
    pub kind: RuntimePlanErrorKind,
    pub path: PathBuf,
    pub detail: String,
}

impl RuntimePlanError {
    fn missing(path: PathBuf, detail: impl Into<String>) -> Self {
        Self {
            kind: RuntimePlanErrorKind::Missing,
            path,
            detail: detail.into(),
        }
    }

    fn unreadable(path: PathBuf, detail: impl Into<String>) -> Self {
        Self {
            kind: RuntimePlanErrorKind::Unreadable,
            path,
            detail: detail.into(),
        }
    }

    fn invalid(path: PathBuf, detail: impl Into<String>) -> Self {
        Self {
            kind: RuntimePlanErrorKind::Invalid,
            path,
            detail: detail.into(),
        }
    }

    fn cycle(path: PathBuf, version_id: &str) -> Self {
        Self {
            kind: RuntimePlanErrorKind::InheritanceCycle,
            path,
            detail: format!("Version manifest inheritance cycle at {}", version_id),
        }
    }
}

impl fmt::Display for RuntimePlanError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.path.display(), self.detail)
    }
}

impl std::error::Error for RuntimePlanError {}

#[derive(Debug, Clone)]
pub struct RuntimeInspection {
    pub plan: Option<RuntimePlan>,
    pub verification: VerificationResult,
}

fn manifest_path(request: &RuntimeRequest, version_id: &str) -> PathBuf {
    request
        .versions_dir()
        .join(version_id)
        .join(format!("{}.json", version_id))
}

fn load_selected_manifest(
    request: &RuntimeRequest,
    installed_id: &str,
    path: &Path,
) -> Result<UnifiedManifest, RuntimePlanError> {
    let raw = read_manifest(path)?;
    if let Ok(mut unified) = serde_json::from_str::<UnifiedManifest>(&raw) {
        if !unified.minecraft_version.is_empty() {
            unified.apply_native_arch_policy(request.os);
            return Ok(unified);
        }
    }

    let resolved = resolve_manifest_chain(request, installed_id, &mut HashSet::new())?;
    Ok(UnifiedManifest::from(resolved))
}

fn resolve_manifest_chain(
    request: &RuntimeRequest,
    version_id: &str,
    visiting: &mut HashSet<String>,
) -> Result<VersionManifest, RuntimePlanError> {
    let path = manifest_path(request, version_id);
    if !visiting.insert(version_id.to_string()) {
        return Err(RuntimePlanError::cycle(path, version_id));
    }
    if !path.exists() {
        return Err(RuntimePlanError::missing(
            path,
            "Inherited version manifest is missing",
        ));
    }

    let raw = read_manifest(&path)?;
    let child: VersionManifest = serde_json::from_str(&raw)
        .map_err(|error| RuntimePlanError::invalid(path.clone(), error.to_string()))?;
    let resolved = if let Some(parent_id) = child.inherits_from.clone() {
        let parent = resolve_manifest_chain(request, &parent_id, visiting)?;
        merge_manifests(parent, child)
            .map_err(|error| RuntimePlanError::invalid(path.clone(), error.to_string()))?
    } else {
        child
    };
    visiting.remove(version_id);
    Ok(resolved)
}

fn read_manifest(path: &Path) -> Result<String, RuntimePlanError> {
    std::fs::read_to_string(path)
        .map_err(|error| RuntimePlanError::unreadable(path.to_path_buf(), error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::installer::types::DEFAULT_ARTIFACT_CACHE_MAX_BYTES;
    use tempfile::tempdir;

    fn request(root: &Path, loader: Option<ModloaderType>) -> RuntimeRequest {
        RuntimeRequest {
            version_id: "1.20.1".to_string(),
            modloader: loader,
            modloader_version: loader.map(|_| "0.15.0".to_string()),
            data_dir: root.to_path_buf(),
            os: OsType::current(),
        }
    }

    fn manifest(id: &str, parent: Option<&str>) -> VersionManifest {
        VersionManifest {
            id: id.to_string(),
            inherits_from: parent.map(str::to_string),
            main_class: Some("net.minecraft.client.main.Main".to_string()),
            java_version: Some(crate::game::launcher::version_parser::JavaVersion {
                major_version: 17,
                component: "java-runtime-gamma".to_string(),
            }),
            version_type: Some("release".to_string()),
            release_time: Some("2023-06-12T00:00:00Z".to_string()),
            ..VersionManifest::default()
        }
    }

    fn write_manifest(root: &Path, manifest: &VersionManifest) {
        let path = root
            .join("versions")
            .join(&manifest.id)
            .join(format!("{}.json", manifest.id));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, serde_json::to_vec(manifest).unwrap()).unwrap();
    }

    fn launch_spec(root: PathBuf) -> LaunchSpec {
        LaunchSpec {
            instance_id: "test".to_string(),
            version_id: "1.20.1".to_string(),
            modloader: Some(ModloaderType::Fabric),
            modloader_version: Some("0.15.0".to_string()),
            data_dir: root,
            game_dir: PathBuf::from("game"),
            java_path: PathBuf::from("java"),
            username: String::new(),
            uuid: String::new(),
            access_token: String::new(),
            user_type: String::new(),
            xuid: None,
            jvm_args: vec![],
            game_args: vec![],
            window_width: None,
            window_height: None,
            min_memory: None,
            max_memory: None,
            client_id: String::new(),
            exit_handler_jar: None,
            log_file: None,
            env_vars: Default::default(),
            wrapper_command: None,
            pre_launch_hook: None,
            post_exit_hook: None,
        }
    }

    #[test]
    fn install_and_launch_requests_share_installed_id() {
        let root = PathBuf::from("/tmp/vesta-runtime-plan");
        let mut install = InstallSpec::new("1.20.1".to_string(), root.clone(), root.join("game"));
        install.modloader = Some(ModloaderType::Fabric);
        install.modloader_version = Some("0.15.0".to_string());
        let launch = launch_spec(root);
        assert_eq!(
            RuntimeRequest::from(&install).installed_version_id(),
            RuntimeRequest::from(&launch).installed_version_id()
        );
        assert_eq!(
            install.artifact_cache_max_bytes,
            DEFAULT_ARTIFACT_CACHE_MAX_BYTES
        );
    }

    #[test]
    fn modded_runtime_requires_loader_manifest() {
        let dir = tempdir().unwrap();
        write_manifest(dir.path(), &manifest("1.20.1", None));
        let error =
            RuntimePlan::resolve_installed(request(dir.path(), Some(ModloaderType::Fabric)))
                .unwrap_err();
        assert_eq!(error.kind, RuntimePlanErrorKind::Missing);
        assert!(error.detail.contains("Modloader"));
    }

    #[test]
    fn resolves_raw_inheritance_chain() {
        let dir = tempdir().unwrap();
        let mut parent = manifest("1.20.1", None);
        parent
            .libraries
            .push(crate::game::launcher::version_parser::Library {
                name: "example:parent:1.0".to_string(),
                ..Default::default()
            });
        let child_id = "fabric-loader-0.15.0-1.20.1";
        let child = manifest(child_id, Some("1.20.1"));
        write_manifest(dir.path(), &parent);
        write_manifest(dir.path(), &child);

        let plan = RuntimePlan::resolve_installed(request(dir.path(), Some(ModloaderType::Fabric)))
            .unwrap();
        assert!(plan
            .manifest
            .libraries
            .iter()
            .any(|library| library.name == "example:parent:1.0"));
    }

    #[test]
    fn detects_inheritance_cycle() {
        let dir = tempdir().unwrap();
        write_manifest(dir.path(), &manifest("1.20.1", Some("child")));
        write_manifest(dir.path(), &manifest("child", Some("1.20.1")));
        let error = RuntimePlan::resolve_installed(request(dir.path(), None)).unwrap_err();
        assert_eq!(error.kind, RuntimePlanErrorKind::InheritanceCycle);
    }

    #[test]
    fn prefers_installed_client_then_vanilla_fallback() {
        let dir = tempdir().unwrap();
        let vanilla = manifest("1.20.1", None);
        write_manifest(dir.path(), &vanilla);
        let vanilla_jar = dir.path().join("versions/1.20.1/1.20.1.jar");
        std::fs::write(&vanilla_jar, b"jar").unwrap();
        let plan = RuntimePlan::resolve_installed(request(dir.path(), None)).unwrap();
        assert_eq!(plan.client_jar, vanilla_jar);
    }

    #[test]
    fn invalid_manifest_is_classified() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("versions/1.20.1/1.20.1.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "not-json").unwrap();
        let error = RuntimePlan::resolve_installed(request(dir.path(), None)).unwrap_err();
        assert_eq!(error.kind, RuntimePlanErrorKind::Invalid);
        assert_eq!(error.path, path);
    }

    #[test]
    fn installer_plan_matches_persisted_unified_plan() {
        let dir = tempdir().unwrap();
        let vanilla = manifest("1.20.1", None);
        let loader_id = "fabric-loader-0.15.0-1.20.1";
        let loader = manifest(loader_id, Some("1.20.1"));
        write_manifest(dir.path(), &vanilla);
        let built = RuntimePlan::from_manifests(
            request(dir.path(), Some(ModloaderType::Fabric)),
            vanilla,
            Some(loader),
        )
        .unwrap();
        std::fs::create_dir_all(built.manifest_path.parent().unwrap()).unwrap();
        built.manifest.save_to_path(&built.manifest_path).unwrap();

        let resolved =
            RuntimePlan::resolve_installed(request(dir.path(), Some(ModloaderType::Fabric)))
                .unwrap();
        assert_eq!(resolved.installed_version_id, built.installed_version_id);
        assert_eq!(resolved.manifest.main_class, built.manifest.main_class);
        assert_eq!(resolved.java_requirement, built.java_requirement);
        assert_eq!(resolved.natives_dir, built.natives_dir);
    }

    #[test]
    fn exposes_asset_library_native_and_java_facts() {
        let dir = tempdir().unwrap();
        let mut vanilla = manifest("1.20.1", None);
        vanilla.asset_index = Some(crate::game::launcher::version_parser::AssetIndex {
            id: "17".to_string(),
            sha1: "sha1".to_string(),
            size: 1,
            total_size: 1,
            url: "https://example.invalid/17.json".to_string(),
        });
        let plan = RuntimePlan::from_manifests(request(dir.path(), None), vanilla, None).unwrap();
        assert_eq!(plan.java_requirement.major_version, 17);
        assert_eq!(plan.libraries_dir, dir.path().join("libraries"));
        assert_eq!(plan.natives_dir, dir.path().join("natives/1.20.1"));
        assert_eq!(
            plan.asset_index_path,
            Some(dir.path().join("assets/indexes/17.json"))
        );
    }

    #[test]
    fn rejects_mismatched_launch_spec() {
        let dir = tempdir().unwrap();
        let plan = RuntimePlan::from_manifests(
            request(dir.path(), Some(ModloaderType::Fabric)),
            manifest("1.20.1", None),
            Some(manifest("fabric-loader-0.15.0-1.20.1", Some("1.20.1"))),
        )
        .unwrap();
        let mut launch = launch_spec(dir.path().to_path_buf());
        launch.version_id = "1.20.2".to_string();
        assert!(plan.validate_launch_spec(&launch).is_err());
    }
}
