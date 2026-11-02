//! Linked pack installs share the runtime installer and recoverable file journal.
use super::ServerManager;
use crate::{models::instance::Instance, resources::ResourceManager};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};
use tauri::{AppHandle, Emitter, Manager};
use vesta_server_client::{
    pack_sync::{failure, revision, Release, SyncStatus},
    Error, ErrorCode, Result,
};

pub(crate) const RECEIPT: &str = ".vesta-server-pack.json";
// Real provider packs ship single jars above 100 MiB and several hundred MiB in total
// (COBBLEVERSE: a 215 MiB archive, a 130 MiB Cobblemon jar, 412 MiB of pinned mods).
// Provider bytes stream to the review stage on disk, so these bound disk use, not memory.
const FILE_LIMIT: u64 = 1024 * 1024 * 1024;
const TOTAL_LIMIT: u64 = 16 * 1024 * 1024 * 1024;
/// A provider modpack archive referenced by a catalogue release (never held in memory).
const PROVIDER_ARCHIVE_LIMIT: u64 = 4 * 1024 * 1024 * 1024;
/// Embedded members are read into memory; they come from a server archive capped at MAX_ARCHIVE.
const EMBEDDED_LIMIT: u64 = vesta_server_client::pack_sync::MAX_ARCHIVE as u64;
fn io(_: impl std::fmt::Display) -> Error {
    Error::new(ErrorCode::Internal)
}
fn conflict(reason: &str) -> Error {
    failure(reason)
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    pub minecraft_version: String,
    pub loader: String,
    pub loader_version: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Link {
    pub connection_id: String,
    pub server_id: String,
    pub fingerprint: String,
    pub highest_revision: String,
    pub highest_minimum: String,
    pub highest_sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub revision: String,
    pub sha256: String,
    pub runtime: Runtime,
    pub files: BTreeMap<String, String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub operation: String,
    pub executable: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub review_id: String,
    pub connection_id: String,
    pub instance_id: Option<i32>,
    pub server_id: String,
    pub fingerprint: String,
    pub revision: String,
    pub minimum_revision: String,
    pub artifact_sha256: String,
    pub name: String,
    pub runtime: Runtime,
    pub changes: Vec<Change>,
    pub executable_changes: Vec<String>,
    pub consent_required: bool,
}
fn is_pack_resource(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    let lower = lower.strip_suffix(".disabled").unwrap_or(&lower);
    let Some((folder, name)) = lower.rsplit_once('/') else { return false; };
    folder == "mods" && name.ends_with(".jar") || matches!(folder, "resourcepacks" | "shaderpacks") && name.ends_with(".zip")
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackResourceDetails {
    pub path: String,
    pub platform: Option<String>,
    pub project_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackDetails {
    #[serde(flatten)]
    pub preview: Preview,
    pub version: Option<String>,
    pub author: Option<String>,
    pub description: Option<String>,
    pub icon_url: Option<String>,
    pub format: String,
    pub resources: Vec<PackResourceDetails>,
}
#[derive(Clone, Debug)]
pub(crate) struct ProviderPackIdentity {
    pub platform: String, pub project: String, pub version: String, pub icon_url: Option<String>,
}
pub(crate) struct Prepared {
    pub provider_pack: Option<ProviderPackIdentity>,
    pub preview: Preview,
    pub release: Release,
    pub files: BTreeMap<String, String>,
    pub stage: tempfile::TempDir,
    pub created: Instant,
    pub old: Option<Receipt>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Index {
    format_version: u32,
    name: Option<String>,
    revision: u64,
    minecraft_version: String,
    modloader_type: Option<String>,
    modloader_version: Option<String>,
    files: Vec<IndexFile>,
}
#[derive(Deserialize)]
struct Hashes {
    sha256: String,
}
#[derive(Deserialize)]
struct Environment {
    client: String,
}
#[derive(Deserialize)]
struct Source {
    r#type: String,
    platform: Option<String>,
    project_id: Option<String>,
    version_id: Option<String>,
}
#[derive(Deserialize)]
struct IndexFile {
    path: String,
    size: u64,
    hashes: Hashes,
    env: Environment,
    source: Source,
}

fn link_path(root: &Path, id: i32) -> PathBuf {
    root.join("pack-sync").join(format!("{id}.json"))
}
fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    let bytes = match std::fs::File::open(path) {
        Ok(file) => {
            let mut bytes = Vec::new();
            file.take(1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(io)?;
            if bytes.len() > 1024 * 1024 {
                return Err(conflict("pack_invalid_receipt"));
            }
            bytes
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(io(e)),
    };
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| conflict("pack_invalid_receipt"))
}
fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
    let parent = path.parent().ok_or_else(|| io("parent"))?;
    std::fs::create_dir_all(parent).map_err(io)?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(io)?;
    file.write_all(&serde_json::to_vec(value).map_err(io)?)
        .map_err(io)?;
    file.as_file().sync_all().map_err(io)?;
    file.persist(path).map_err(io)?;
    Ok(())
}
fn game_dir(instance: &Instance) -> Result<PathBuf> {
    instance
        .game_directory
        .as_ref()
        .map(PathBuf::from)
        .ok_or_else(|| conflict("pack_instance_directory_missing"))
}
fn runtime(instance: &Instance) -> Runtime {
    Runtime {
        minecraft_version: instance.minecraft_version.clone(),
        loader: instance
            .modloader
            .clone()
            .filter(|l| l != "none")
            .unwrap_or_else(|| "vanilla".into())
            .to_lowercase(),
        loader_version: instance.modloader_version.clone(),
    }
}
fn assert_runtime(instance: &Instance, receipt: &Receipt) -> Result<()> {
    if runtime(instance) != receipt.runtime {
        return Err(conflict("pack_incompatible_runtime"));
    }
    Ok(())
}
fn safe_path(path: &str) -> Result<()> {
    let parts: Vec<_> = path.split('/').collect();
    if parts.is_empty()
        || path.len() > 512
        || parts.iter().any(|p| {
            p.is_empty()
                || *p == "."
                || *p == ".."
                || p.ends_with(['.', ' '])
                || p.bytes().any(|b| b < 32 || b"\\:<>\"|?*".contains(&b))
                || matches!(
                    p.split('.')
                        .next()
                        .unwrap_or("")
                        .to_ascii_uppercase()
                        .as_str(),
                    "CON"
                        | "PRN"
                        | "AUX"
                        | "NUL"
                        | "COM1"
                        | "COM2"
                        | "COM3"
                        | "COM4"
                        | "COM5"
                        | "COM6"
                        | "COM7"
                        | "COM8"
                        | "COM9"
                        | "LPT1"
                        | "LPT2"
                        | "LPT3"
                        | "LPT4"
                        | "LPT5"
                        | "LPT6"
                        | "LPT7"
                        | "LPT8"
                        | "LPT9"
                )
        })
    {
        return Err(conflict("pack_unsafe_path"));
    }
    if !(parts.len() > 1
        && matches!(
            parts[0],
            "mods"
                | "resourcepacks"
                | "shaderpacks"
                | "datapacks"
                | "config"
                | "defaultconfigs"
                | "kubejs"
                | "scripts"
                | "resources"
        )
        || parts.len() == 1
            && matches!(
                parts[0],
                "options.txt"
                    | "optionsof.txt"
                    | "optionsshaders.txt"
                    | "servers.dat"
                    | "pack-icon.png"
                    | "pack-icon.jpg"
            ))
    {
        return Err(conflict("pack_unsafe_path"));
    }
    Ok(())
}
pub(crate) fn confined(root: &Path, path: &str) -> Result<PathBuf> {
    safe_path(path)?;
    let mut current = root.to_path_buf();
    // Reject links/reparse points at the game root and every existing parent.
    for component in root.ancestors() {
        if let Ok(m) = std::fs::symlink_metadata(component) {
            if linked(&m) {
                return Err(conflict("pack_symbolic_link_rejected"));
            }
        }
    }
    for part in path.split('/') {
        current.push(part);
        match std::fs::symlink_metadata(&current) {
            Ok(m) if linked(&m) => return Err(conflict("pack_symbolic_link_rejected")),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(io(e)),
        }
    }
    Ok(current)
}
fn linked(m: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        m.file_type().is_symlink() || m.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        m.file_type().is_symlink()
    }
}
pub(crate) fn digest(bytes: &[u8]) -> String {
    vesta_server_client::trust::leaf_fingerprint(bytes)
}
fn file_digest(path: &Path) -> Result<Option<String>> {
    match std::fs::metadata(path) {
        Ok(m) if m.is_file() => crate::utils::hash::calculate_sha256(path)
            .map(Some)
            .map_err(io),
        Ok(_) => Err(conflict("pack_file_collision")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(io(e)),
    }
}
pub(crate) fn diff(
    root: &Path,
    old: Option<&Receipt>,
    files: &BTreeMap<String, String>,
) -> Result<Vec<Change>> {
    let empty = BTreeMap::new();
    let owned = old.map(|r| &r.files).unwrap_or(&empty);
    let all: BTreeMap<_, _> = owned.iter().chain(files.iter()).collect();
    let mut changes = vec![];
    for path in all.keys() {
        let current = file_digest(&confined(root, path)?)?;
        let wanted = files.get(*path);
        let previous = owned.get(*path);
        if previous.is_none() && current.is_some() && current.as_ref() != wanted {
            return Err(conflict("pack_user_file_collision"));
        }
        if previous.is_some()
            && current.is_some()
            && current.as_ref() != previous
            && current.as_ref() != wanted
        {
            return Err(conflict("pack_owned_file_modified"));
        }
        if current.as_ref() != wanted {
            changes.push(Change {
                path: (*path).clone(),
                operation: if wanted.is_none() {
                    "remove"
                } else if current.is_none() {
                    "add"
                } else {
                    "update"
                }
                .into(),
                executable: executable(path),
            });
        }
    }
    Ok(changes)
}
fn executable(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".jar")
        || lower.starts_with("kubejs/")
        || lower.starts_with("scripts/")
        || [".js", ".class", ".dll", ".so", ".exe"]
            .iter()
            .any(|ext| lower.ends_with(ext))
}
fn read_member<R: Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
    limit: u64,
) -> Result<Vec<u8>> {
    let mut file = zip
        .by_name(name)
        .map_err(|_| conflict("pack_missing_file"))?;
    if file.size() > limit
        || file.is_dir()
        || file.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
    {
        return Err(conflict("pack_unsafe_archive"));
    }
    let mut bytes = Vec::new();
    file.by_ref()
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(io)?;
    if bytes.len() as u64 > limit {
        return Err(conflict("pack_too_large"));
    }
    Ok(bytes)
}

impl ServerManager {
    pub(crate) async fn check_custom_content(&self, instance: &Instance) -> Result<()> {
        if let Some(link) = self.pack_link(instance.id).await? {
            let (release, _) = self.verified_release(&link.connection_id, Some(instance)).await?;
            if !release.allow_custom_content { return Err(conflict("pack_custom_content_disabled")); }
        }
        Ok(())
    }

    pub(crate) async fn detach_modpack_source(&self, id: i32) -> Result<()> {
        let _gate = self.pack_gate.lock().await;
        let active = link_path(&self.root, id);
        let detached = active.with_extension("detached.json");
        if active.exists() {
            // Retain the authority receipt for diagnostics; no game files are removed.
            let link: Link = read_json(&active)?.ok_or_else(|| conflict("pack_invalid_receipt"))?;
            write_json(&detached, &link)?;
            std::fs::remove_file(&active).map_err(io)?;
        }
        self.pack_previews
            .lock()
            .await
            .retain(|_, p| p.preview.instance_id != Some(id));
        Ok(())
    }

    pub async fn pack_sync_discard(&self, review_id: &str) {
        self.pack_previews.lock().await.remove(review_id);
    }
    pub async fn pack_link(&self, id: i32) -> Result<Option<Link>> {
        read_json(&link_path(&self.root, id))
    }
    pub(crate) async fn verified_release(
        &self,
        connection: &str,
        instance: Option<&Instance>,
    ) -> Result<(Release, Option<Receipt>)> {
        let record = self.record(connection).await?;
        let binding = &record.snapshot.connection;
        let link = match instance {
            Some(i) => self.pack_link(i.id).await?,
            None => None,
        };
        if let (Some(instance),Some(link))=(instance,&link) {
            if instance.modpack_platform.as_deref()==Some("server") && instance.modpack_id.as_deref()!=Some(link.server_id.as_str()) {return Err(conflict("pack_server_binding_mismatch"));}
        }
        if let Some(link) = &link {
            if link.connection_id != connection
                || link.server_id != binding.server_id
                || link.fingerprint != binding.fingerprint
            {
                return Err(conflict("pack_server_binding_mismatch"));
            }
        }
        let receipt = match instance {
            Some(i) if link.is_some() => read_json::<Receipt>(&game_dir(i)?.join(RECEIPT))?,
            _ => None,
        };
        // An interrupted first link can leave the durable high-water binding
        // after the file journal restores an absent receipt. Explicit preview
        // may reinstall it; the launch check below always requires a receipt.
        if let (Some(i), Some(receipt)) = (instance, &receipt) {
            assert_runtime(i, receipt)?;
        }
        let installed = receipt
            .as_ref()
            .map(|r| revision(&r.revision))
            .transpose()?
            .unwrap_or(0);
        let release = self
            .client(connection)
            .await?
            .pack_sync_release(installed)
            .await?;
        if let Some(link) = &link {
            release.reject_rollback(
                &link.highest_revision,
                &link.highest_minimum,
                &link.highest_sha256,
            )?;
        }
        if let Some(i) = instance {
            if link.is_some() {
                self.remember_release(i.id, connection, &release)?;
            }
        }
        Ok((release, receipt))
    }
    fn remember_release(&self, id: i32, connection: &str, r: &Release) -> Result<()> {
        write_json(
            &link_path(&self.root, id),
            &Link {
                connection_id: connection.into(),
                server_id: r.server_id.clone(),
                fingerprint: r.fingerprint.clone(),
                highest_revision: r.revision.clone(),
                highest_minimum: r.minimum_revision.clone(),
                highest_sha256: r.sha256.clone(),
            },
        )
    }
    /// Form metadata only. Never resolve or download the pack's individual resources.
    pub async fn pack_sync_details(&self, app: &AppHandle, connection: &str) -> Result<PackDetails> {
        let (release, _) = self.verified_release(connection, None).await?;
        // Version the cache schema: old summaries contained fabricated zero counts and revision labels.
        let cache = self.root.join("pack-sync").join("metadata-v3").join(format!("{}.json", release.sha256));
        if let Ok(Some(mut details)) = read_json::<PackDetails>(&cache) {
            let preview = &mut details.preview;
            if preview.server_id == release.server_id && preview.fingerprint == release.fingerprint && preview.artifact_sha256 == release.sha256 {
                preview.connection_id = connection.into();
                preview.revision = release.revision;
                preview.minimum_revision = release.minimum_revision;
                return Ok(details);
            }
        }
        let archive = self.client(connection).await?.pack_sync_download(&release).await?;
        let (name, runtime, version, author, description, icon_url, format, resources) = if release.format == "vestapack" {
            let mut zip = zip::ZipArchive::new(Cursor::new(&archive)).map_err(|_| conflict("pack_unsafe_archive"))?;
            let bytes = read_member(&mut zip, "vesta.index.json", 1024 * 1024)?;
            let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| conflict("pack_invalid_index"))?;
            let index: Index = serde_json::from_slice(&bytes).map_err(|_| conflict("pack_invalid_index"))?;
            let resources = index.files.iter().filter(|file| file.env.client != "unsupported" && is_pack_resource(&file.path)).map(|file| {
                let platform = file.source.platform.as_deref().filter(|platform| matches!(*platform, "modrinth" | "curseforge") && file.source.project_id.is_some() && file.source.version_id.is_some()).map(str::to_owned);
                PackResourceDetails { path: file.path.clone(), platform, project_id: file.source.project_id.clone() }
            }).collect();
            (index.name.unwrap_or_else(|| "Server pack".into()), Runtime { minecraft_version: index.minecraft_version, loader: index.modloader_type.filter(|loader| loader != "none").unwrap_or_else(|| "vanilla".into()), loader_version: index.modloader_version }, value["version"].as_str().map(str::to_owned), value["author"].as_str().map(str::to_owned), value["description"].as_str().map(str::to_owned), None, "custom".to_owned(), resources)
        } else {
            let (metadata, overrides) = legacy::details(app, &release, archive).await?;
            let mut resources: Vec<_> = metadata.mods.iter().map(|entry| match entry {
                piston_lib::game::modpack::types::ModpackMod::Modrinth { path, urls, .. } => PackResourceDetails { path: path.clone(), platform: urls.iter().any(|url| reqwest::Url::parse(url).ok().is_some_and(|url| url.host_str() == Some("cdn.modrinth.com"))).then(|| "modrinth".into()), project_id: None },
                piston_lib::game::modpack::types::ModpackMod::CurseForge { project_id, file_id, .. } => PackResourceDetails { path: format!("CurseForge file {file_id}"), platform: Some("curseforge".into()), project_id: project_id.map(|id| id.to_string()) },
            }).collect();
            for path in overrides { if !resources.iter().any(|item| item.path == path) { resources.push(PackResourceDetails { path, platform: None, project_id: None }); } }
            let format = if release.format != "catalogue" { "custom".to_owned() } else { match metadata.format { piston_lib::game::modpack::types::ModpackFormat::Modrinth => "modrinth", _ => "curseforge" }.to_owned() };
            (metadata.name, Runtime { minecraft_version: metadata.minecraft_version, loader: metadata.modloader_type, loader_version: metadata.modloader_version }, Some(metadata.version), metadata.author, metadata.description, metadata.icon_url, format, resources)
        };
        let preview = Preview { review_id: String::new(), connection_id: connection.into(), instance_id: None,
            server_id: release.server_id, fingerprint: release.fingerprint, revision: release.revision,
            minimum_revision: release.minimum_revision, artifact_sha256: release.sha256, name, runtime,
            changes: Vec::new(), executable_changes: Vec::new(), consent_required: release.format != "catalogue" };
        let details = PackDetails { preview, version, author, description, icon_url, format, resources };
        write_json(&cache, &details)?;
        Ok(details)
    }    pub async fn pack_sync_preview(
        &self,
        app: &AppHandle,
        connection: &str,
        instance_id: Option<i32>,
    ) -> Result<Preview> {
        let _gate = self.pack_gate.lock().await;
        let instance = instance_id
            .map(crate::commands::instances::get_instance)
            .transpose()
            .map_err(io)?;
        let (release, old) = self.verified_release(connection, instance.as_ref()).await?;
        // Download/resolve outside the policy gate so a slow provider cannot
        // stall launch checks or periodic status for unrelated linked instances.
        drop(_gate);
        if !matches!(
            release.format.as_str(),
            "vestapack" | "mrpack" | "zip" | "catalogue"
        ) {
            return Err(conflict("pack_format_unsupported"));
        }
        let archive = self
            .client(connection)
            .await?
            .pack_sync_download(&release)
            .await?;
        let provider_pack = if release.format == "catalogue" {
            let value: serde_json::Value = serde_json::from_slice(&archive).map_err(|_| conflict("pack_invalid_index"))?;
            let content = &value["content"];
            let platform = content["platform"].as_str().ok_or_else(|| conflict("pack_invalid_source"))?;
            let source = match platform { "modrinth" => crate::models::SourcePlatform::Modrinth, "curseforge" => crate::models::SourcePlatform::CurseForge, _ => return Err(conflict("pack_invalid_source")) };
            let project = content["projectId"].as_str().ok_or_else(|| conflict("pack_invalid_source"))?;
            let version = content["versionId"].as_str().ok_or_else(|| conflict("pack_invalid_source"))?;
            let resource = app.state::<ResourceManager>().get_project(source, project).await.map_err(io)?;
            Some(ProviderPackIdentity { platform: platform.into(), project: project.into(), version: version.into(), icon_url: resource.icon_url })
        } else { None };
        // Provider/legacy packs are normalized straight onto a disk stage; only a
        // server-hosted vestapack (bounded by MAX_ARCHIVE) is read from memory.
        let mut normalized = None;
        let mut vestapack = None;
        let index: Index = if release.format == "vestapack" {
            let mut zip = zip::ZipArchive::new(Cursor::new(archive.as_slice()))
                .map_err(|_| conflict("pack_unsafe_archive"))?;
            if zip.len() > 4097 {
                return Err(conflict("pack_too_large"));
            }
            let mut members = HashSet::new();
            for n in 0..zip.len() {
                let f = zip.by_index(n).map_err(io)?;
                if !members.insert(f.name().to_lowercase())
                    || f.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
                {
                    return Err(conflict("pack_unsafe_archive"));
                }
            }
            let index =
                serde_json::from_slice(&read_member(&mut zip, "vesta.index.json", 1024 * 1024)?)
                    .map_err(|_| conflict("pack_invalid_index"))?;
            vestapack = Some(zip);
            index
        } else {
            let staged = legacy::normalize(app, &release, archive).await?;
            normalized = Some((staged.stage, staged.files));
            staged.index
        };
        if index.format_version != 1
            || index.revision != revision(&release.revision)?
            || index.files.len() > 4096
            || index.minecraft_version.is_empty()
        {
            return Err(conflict("pack_invalid_index"));
        }
        let loader = index
            .modloader_type
            .unwrap_or_else(|| "vanilla".into())
            .to_lowercase();
        let loader = if loader == "none" {
            "vanilla".into()
        } else {
            loader
        };
        if !matches!(
            loader.as_str(),
            "vanilla" | "fabric" | "quilt" | "forge" | "neoforge"
        ) || loader != "vanilla" && index.modloader_version.as_deref().is_none_or(str::is_empty)
        {
            return Err(conflict("pack_incompatible_runtime"));
        }
        let target_runtime = Runtime {
            minecraft_version: index.minecraft_version,
            loader,
            loader_version: index.modloader_version,
        };
        if let Some(instance) = &instance {
            if runtime(instance) != target_runtime {
                return Err(conflict("pack_incompatible_runtime"));
            }
        }
        let (stage, files) = match (normalized, vestapack) {
            (Some(staged), _) => staged,
            (None, Some(mut zip)) => {
                stage_vestapack(&mut zip, index.files, instance.as_ref(), &target_runtime, app)
                    .await?
            }
            (None, None) => return Err(conflict("pack_format_unsupported")),
        };
        let empty = tempfile::tempdir().map_err(io)?;
        let root = instance
            .as_ref()
            .map(game_dir)
            .transpose()?
            .unwrap_or_else(|| empty.path().to_owned());
        let changes = diff(&root, old.as_ref(), &files)?;
        let mut executable_changes: Vec<_> = changes
            .iter()
            .filter(|c| c.executable)
            .map(|c| c.path.clone())
            .collect();
        if instance.is_none() && target_runtime.loader != "vanilla" {
            executable_changes.push("Minecraft loader".into());
        }
        let preview = Preview {
            review_id: uuid::Uuid::new_v4().to_string(),
            connection_id: connection.into(),
            instance_id,
            server_id: release.server_id.clone(),
            fingerprint: release.fingerprint.clone(),
            revision: release.revision.clone(),
            minimum_revision: release.minimum_revision.clone(),
            artifact_sha256: release.sha256.clone(),
            name: index.name.unwrap_or_else(|| "Server pack".into()),
            runtime: target_runtime,
            changes,
            consent_required: !executable_changes.is_empty() && provider_pack.is_none(),
            executable_changes,
        };
        let mut previews = self.pack_previews.lock().await;
        previews.retain(|_, p| p.created.elapsed().as_secs() < 900);
        if previews.len() >= 8 {
            return Err(conflict("pack_preview_limit"));
        }
        previews.insert(
            preview.review_id.clone(),
            Prepared {
                provider_pack,
                preview: preview.clone(),
                release,
                files,
                stage,
                created: Instant::now(),
                old,
            },
        );
        Ok(preview)
    }
}

fn read_matching_file(root: &Path, path: &str, size: u64, sha256: &str) -> Result<Option<Vec<u8>>> {
    let path = confined(root, path)?;
    let Ok(metadata) = std::fs::metadata(&path) else {
        return Ok(None);
    };
    if !metadata.is_file() || metadata.len() != size {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(io)?;
    Ok((digest(&bytes) == sha256).then_some(bytes))
}


/// Stage a server-authored vestapack: embedded members come from the bounded archive,
/// platform files stream from their provider straight to disk.
async fn stage_vestapack(
    zip: &mut zip::ZipArchive<Cursor<&[u8]>>,
    entries: Vec<IndexFile>,
    instance: Option<&Instance>,
    target_runtime: &Runtime,
    app: &AppHandle,
) -> Result<(tempfile::TempDir, BTreeMap<String, String>)> {
    let stage = tempfile::tempdir().map_err(io)?;
    let mut files = BTreeMap::new();
    let mut names = HashSet::new();
    let mut total = 0u64;
    let resources = app.state::<ResourceManager>();
    for file in entries {
        safe_path(&file.path)?;
        let lower = file.path.to_lowercase();
        if names.iter().any(|p: &String| {
            p == &lower || p.starts_with(&format!("{lower}/")) || lower.starts_with(&format!("{p}/"))
        }) {
            return Err(conflict("pack_file_collision"));
        }
        names.insert(lower);
        if !matches!(file.env.client.as_str(), "required" | "optional" | "unsupported") {
            return Err(conflict("pack_invalid_index"));
        }
        if file.env.client == "unsupported" {
            continue;
        }
        total = total
            .checked_add(file.size)
            .ok_or_else(|| conflict("pack_too_large"))?;
        if file.size > FILE_LIMIT || total > TOTAL_LIMIT {
            return Err(conflict("pack_too_large"));
        }
        let target = stage.path().join(&file.path);
        let cached = instance
            .map(|i| read_matching_file(&game_dir(i)?, &file.path, file.size, &file.hashes.sha256))
            .transpose()?
            .flatten();
        let bytes = match (cached, file.source.r#type.as_str()) {
            (Some(bytes), _) => bytes,
            (None, "embedded" | "override") => {
                read_member(zip, &format!("overrides/{}", file.path), EMBEDDED_LIMIT)?
            }
            (None, "platform" | "modrinth" | "curseforge") => {
                let source = match file.source.platform.as_deref() {
                    Some("modrinth") => crate::models::SourcePlatform::Modrinth,
                    Some("curseforge") => crate::models::SourcePlatform::CurseForge,
                    _ => return Err(conflict("pack_invalid_source")),
                };
                let project = file.source.project_id.as_deref().ok_or_else(|| conflict("pack_invalid_source"))?;
                let version = file.source.version_id.as_deref().ok_or_else(|| conflict("pack_invalid_source"))?;
                let v = resources.get_version(source, project, version).await.map_err(io)?;
                if !v.game_versions.contains(&target_runtime.minecraft_version)
                    || file.path.starts_with("mods/")
                        && !crate::resources::manager::is_loader_compatible(&v.loaders, &target_runtime.loader)
                {
                    return Err(conflict("pack_incompatible_runtime"));
                }
                let got = download_provider_to(&v.download_url, file.size, &target).await?;
                if got.size != file.size || got.sha256 != file.hashes.sha256 {
                    return Err(conflict("pack_integrity_failure"));
                }
                files.insert(file.path, file.hashes.sha256);
                continue;
            }
            _ => return Err(conflict("pack_invalid_source")),
        };
        if bytes.len() as u64 != file.size || digest(&bytes) != file.hashes.sha256 {
            return Err(conflict("pack_integrity_failure"));
        }
        std::fs::create_dir_all(target.parent().unwrap()).map_err(io)?;
        std::fs::write(target, bytes).map_err(io)?;
        files.insert(file.path, file.hashes.sha256);
    }
    Ok((stage, files))
}

/// Size and digests of bytes streamed to disk, so provider hashes of any family verify.
pub(crate) struct Downloaded {
    pub size: u64,
    sha1: String,
    pub sha256: String,
    sha512: String,
}
impl Downloaded {
    pub(crate) fn verify(&self, hash: &str) -> Result<()> {
        let actual = match hash.len() {
            40 => &self.sha1,
            64 => &self.sha256,
            128 => &self.sha512,
            _ => return Err(conflict("pack_integrity_failure")),
        };
        if !actual.eq_ignore_ascii_case(hash) {
            return Err(conflict("pack_integrity_failure"));
        }
        Ok(())
    }
}
/// Over-limit provider content is too large, not unavailable: the bytes exist and are
/// reachable, and the two must stay distinguishable to the user.
fn over_limit(size: u64, limit: u64) -> Result<()> {
    if size > limit {
        return Err(conflict("pack_too_large"));
    }
    Ok(())
}
fn provider_url_allowed(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && url.fragment().is_none()
        && matches!(
            url.host_str(),
            Some("cdn.modrinth.com" | "edge.forgecdn.net" | "mediafilez.forgecdn.net")
        )
}
/// Streams an allow-listed provider download to `target`, hashing as it goes. Never
/// buffers the body: provider jars and modpack archives exceed hundreds of MiB.
async fn download_provider_to(raw: &str, limit: u64, target: &Path) -> Result<Downloaded> {
    use sha2::Digest;
    use tokio::io::AsyncWriteExt;
    let mut url = url::Url::parse(raw).map_err(|_| conflict("pack_download_unavailable"))?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(io)?;
    let idle = std::time::Duration::from_secs(60);
    for _ in 0..6 {
        if !provider_url_allowed(&url) {
            return Err(conflict("pack_download_unavailable"));
        }
        let mut response = tokio::time::timeout(idle, client.get(url.clone()).send())
            .await
            .map_err(io)?
            .map_err(io)?;
        if response.status().is_redirection() {
            url = url
                .join(
                    response
                        .headers()
                        .get("location")
                        .and_then(|v| v.to_str().ok())
                        .ok_or_else(|| conflict("pack_download_unavailable"))?,
                )
                .map_err(|_| conflict("pack_download_unavailable"))?;
            continue;
        }
        if !response.status().is_success() {
            return Err(conflict("pack_download_unavailable"));
        }
        over_limit(response.content_length().unwrap_or(0), limit)?;
        if let Some(parent) = target.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(io)?;
        }
        let mut file = tokio::fs::File::create(target).await.map_err(io)?;
        let (mut sha1, mut sha256, mut sha512) =
            (sha1::Sha1::new(), sha2::Sha256::new(), sha2::Sha512::new());
        let mut size = 0u64;
        let result: Result<()> = async {
            while let Some(chunk) = tokio::time::timeout(idle, response.chunk())
                .await
                .map_err(io)?
                .map_err(io)?
            {
                size += chunk.len() as u64;
                over_limit(size, limit)?;
                sha1.update(&chunk);
                sha256.update(&chunk);
                sha512.update(&chunk);
                file.write_all(&chunk).await.map_err(io)?;
            }
            file.flush().await.map_err(io)
        }
        .await;
        if let Err(error) = result {
            drop(file);
            let _ = tokio::fs::remove_file(target).await;
            return Err(error);
        }
        return Ok(Downloaded {
            size,
            sha1: hex::encode(sha1.finalize()),
            sha256: hex::encode(sha256.finalize()),
            sha512: hex::encode(sha512.finalize()),
        });
    }
    Err(conflict("pack_download_unavailable"))
}

#[path = "pack_sync_apply.rs"]
mod apply;
pub use apply::ApplyRequest;
#[path = "pack_sync_check.rs"]
mod check;
pub use check::Check;
#[path = "pack_sync_legacy.rs"]
mod legacy;

#[derive(Clone)]
struct ServerInstallTask {
    instance: Instance,
    details: PackDetails,
}
impl crate::tasks::manager::Task for ServerInstallTask {
    fn name(&self) -> String { "Installing Modpack".into() }
    fn id(&self) -> Option<String> { Some(format!("install_instance_{}_server_pack", self.instance.id)) }
    fn activity_kind(&self) -> crate::tasks::activity::ActivityKind { crate::tasks::activity::ActivityKind::ModpackInstall }
    fn notification_context(&self) -> Option<crate::notifications::models::NotificationContext> {
        Some(crate::notifications::models::NotificationContext::instance(self.instance.id, Some(self.instance.name.clone())))
    }
    fn conflict_keys(&self) -> Vec<String> { vec![crate::tasks::manager::instance_play_conflict_key(self.instance.id)] }
    fn cancellable(&self) -> bool { true }
    fn show_completion_notification(&self) -> bool { true }
    fn starting_description(&self) -> String { format!("Installing {}", self.instance.name) }
    fn on_abandoned(&self, app: &AppHandle) -> futures::future::BoxFuture<'static, ()> {
        let app = app.clone(); let instance = self.instance.clone();
        Box::pin(async move { if let Ok(root) = game_dir(&instance) { crate::modpack::update::rollback_start(&app, instance.id, &root); mark_server_install_interrupted(&app, instance.id); } })
    }
    fn run(&self, ctx: crate::tasks::manager::TaskContext) -> futures::future::BoxFuture<'static, std::result::Result<(), String>> {
        let instance = self.instance.clone(); let details = self.details.clone();
        Box::pin(async move {
            let root = game_dir(&instance).map_err(|e| e.to_string())?;
            ctx.set_stage("downloading");
            ctx.update_description("Downloading modpack files...".into());
            let manager = ctx.app_handle.state::<Arc<ServerManager>>();
            let mut cancel = ctx.cancel_rx.clone();
            let result = tokio::select! {
                result = manager.prepare_new_install(&ctx.app_handle, &instance, &details) => result.map_err(|e| e.to_string()),
                _ = async { loop { if *cancel.borrow() { break; } if cancel.changed().await.is_err() { break; } } } => Err("Installation cancelled".into()),
            };
            let prepared = match result {
                Ok(prepared) => prepared,
                Err(error) => {
                    crate::modpack::update::rollback_start(&ctx.app_handle, instance.id, &root);
                    mark_server_install_interrupted(&ctx.app_handle, instance.id);
                    return Err(error);
                }
            };
            let request_path = root.join(".vesta/server-install.json");
            let task = crate::tasks::update_modpack::UpdateModpackTask::from_server(instance.id, instance.name, root, prepared, false);
            let app = ctx.app_handle.clone();
            let id = instance.id;
            let result = task.run(ctx).await;
            if result.is_ok() { let _ = std::fs::remove_file(request_path); }
            else { mark_server_install_interrupted(&app, id); }
            result
        })
    }
}
impl ServerManager {
    async fn prepare_new_install(&self, app: &AppHandle, instance: &Instance, details: &PackDetails) -> Result<Prepared> {
        let preview = self.pack_sync_preview(app, &details.preview.connection_id, Some(instance.id)).await?;
        let prepared = self.pack_previews.lock().await.remove(&preview.review_id).ok_or_else(|| conflict("pack_review_expired"))?;
        if preview.revision != details.preview.revision || preview.artifact_sha256 != details.preview.artifact_sha256 || preview.server_id != details.preview.server_id || preview.fingerprint != details.preview.fingerprint {
            return Err(conflict("pack_review_stale"));
        }
        Ok(prepared)
    }
    pub async fn start_pack_install(&self, app: &AppHandle, connection: &str, expected_revision: &str, expected_sha256: &str, consent: bool, mut instance: Instance) -> Result<i32> {
        use crate::tasks::manager::TaskManager;
        let details = self.pack_sync_details(app, connection).await?;
        if details.preview.consent_required && !consent { return Err(conflict("pack_executable_consent_required")); }
        if details.preview.revision != expected_revision || details.preview.artifact_sha256 != expected_sha256 { return Err(conflict("pack_review_stale")); }
        let (release, _) = self.verified_release(connection, None).await?;
        if release.revision != expected_revision || release.sha256 != expected_sha256 { return Err(conflict("pack_review_stale")); }
        instance.minecraft_version = details.preview.runtime.minecraft_version.clone();
        instance.modloader = Some(details.preview.runtime.loader.clone());
        instance.modloader_version = details.preview.runtime.loader_version.clone();
        instance.modpack_platform = Some("server".into());
        instance.modpack_id = Some(details.preview.server_id.clone());
        instance.modpack_version_id = Some(details.preview.revision.clone());
        instance.installation_status = Some("skip-initial-watch".into());
        let id = crate::commands::instances::create_instance(app.clone(), instance, app.state::<crate::resources::watcher::ResourceWatcher>()).await.map_err(io)?;
        let instance = crate::commands::instances::get_instance(id).map_err(io)?;
        let root = game_dir(&instance)?;
        self.remember_release(id, connection, &release)?;
        write_json(&root.join(".vesta/server-install.json"), &details)?;
        crate::modpack::update::begin(app, &instance, &root, &release.revision).map_err(io)?;
        crate::commands::instances::update_instance_operation(app, id, "server-pack-install").map_err(io)?;
        if let Err(error) = app.state::<TaskManager>().submit(Box::new(ServerInstallTask { instance, details })).await {
            crate::modpack::update::rollback_start(app, id, &root);
            mark_server_install_interrupted(app, id);
            return Err(io(error));
        }
        Ok(id)
    }
}

fn mark_server_install_interrupted(app: &AppHandle, id: i32) {
    let _ = crate::commands::instances::update_instance_operation(app, id, "server-pack-install");
    let _ = crate::commands::instances::update_installation_status(app, id, "interrupted");
}
impl ServerManager {
    pub async fn resume_pack_install(&self, app: &AppHandle, instance: Instance) -> Result<()> {
        let _guard = app.state::<crate::tasks::manager::TaskManager>().acquire_conflicts([crate::tasks::manager::instance_play_conflict_key(instance.id)]).await;
        let instance = crate::commands::instances::get_instance(instance.id).map_err(io)?;
        if instance.installation_status.as_deref() == Some("installed") { return Ok(()); }
        let root = game_dir(&instance)?;
        let details: PackDetails = read_json(&root.join(".vesta/server-install.json"))?.ok_or_else(|| conflict("pack_review_expired"))?;
        let (release, _) = self.verified_release(&details.preview.connection_id, Some(&instance)).await?;
        if release.revision != details.preview.revision || release.sha256 != details.preview.artifact_sha256 { return Err(conflict("pack_review_stale")); }
        if crate::modpack::update::has_pending_recovery(&root) { crate::modpack::update::recover_previous_instance(app, instance.id, &root).map_err(io)?; }
        crate::modpack::update::begin(app, &instance, &root, &release.revision).map_err(io)?;
        crate::commands::instances::update_instance_operation(app, instance.id, "server-pack-install").map_err(io)?;
        let id = instance.id;
        if let Err(error) = app.state::<crate::tasks::manager::TaskManager>().submit(Box::new(ServerInstallTask { instance, details })).await {
            crate::modpack::update::rollback_start(app, id, &root);
            mark_server_install_interrupted(app, id);
            return Err(io(error));
        }
        Ok(())
    }
}
impl ServerManager {
    pub fn pack_install_details(&self, id: i32) -> Result<Option<PackDetails>> {
        let instance = crate::commands::instances::get_instance(id).map_err(io)?;
        read_json(&game_dir(&instance)?.join(".vesta/server-install.json"))
    }
}
