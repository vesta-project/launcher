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
const FILE_LIMIT: u64 = 16 * 1024 * 1024;
const TOTAL_LIMIT: u64 = 64 * 1024 * 1024;
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
fn read_member(
    zip: &mut zip::ZipArchive<Cursor<&[u8]>>,
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
    pub async fn pack_sync_preview(
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
        let archive = if release.format == "vestapack" {
            archive
        } else {
            legacy::normalize(app, &release, archive).await?
        };
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
        let index: Index =
            serde_json::from_slice(&read_member(&mut zip, "vesta.index.json", 1024 * 1024)?)
                .map_err(|_| conflict("pack_invalid_index"))?;
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
        let stage = tempfile::tempdir().map_err(io)?;
        let mut files = BTreeMap::new();
        let mut names = HashSet::new();
        let mut total = 0u64;
        let resources = app.state::<ResourceManager>();
        for file in index.files {
            safe_path(&file.path)?;
            let lower = file.path.to_lowercase();
            if names.iter().any(|p: &String| {
                p == &lower
                    || p.starts_with(&format!("{lower}/"))
                    || lower.starts_with(&format!("{p}/"))
            }) {
                return Err(conflict("pack_file_collision"));
            }
            names.insert(lower);
            if !matches!(
                file.env.client.as_str(),
                "required" | "optional" | "unsupported"
            ) {
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
            if !matches!(
                file.source.r#type.as_str(),
                "embedded" | "override" | "platform" | "modrinth" | "curseforge"
            ) {
                return Err(conflict("pack_invalid_source"));
            }
            let cached = instance
                .as_ref()
                .map(|i| {
                    read_matching_file(&game_dir(i)?, &file.path, file.size, &file.hashes.sha256)
                })
                .transpose()?
                .flatten();
            let bytes = if let Some(bytes) = cached {
                bytes
            } else {
                match file.source.r#type.as_str() {
                    "embedded" | "override" => {
                        read_member(&mut zip, &format!("overrides/{}", file.path), FILE_LIMIT)?
                    }
                    "platform" | "modrinth" | "curseforge" => {
                        let source = match file.source.platform.as_deref() {
                            Some("modrinth") => crate::models::SourcePlatform::Modrinth,
                            Some("curseforge") => crate::models::SourcePlatform::CurseForge,
                            _ => return Err(conflict("pack_invalid_source")),
                        };
                        let project = file
                            .source
                            .project_id
                            .as_deref()
                            .ok_or_else(|| conflict("pack_invalid_source"))?;
                        let version = file
                            .source
                            .version_id
                            .as_deref()
                            .ok_or_else(|| conflict("pack_invalid_source"))?;
                        let v = resources
                            .get_version(source, project, version)
                            .await
                            .map_err(io)?;
                        if !v.game_versions.contains(&target_runtime.minecraft_version)
                            || file.path.starts_with("mods/")
                                && !crate::resources::manager::is_loader_compatible(
                                    &v.loaders,
                                    &target_runtime.loader,
                                )
                        {
                            return Err(conflict("pack_incompatible_runtime"));
                        }
                        download_provider(&v.download_url).await?
                    }
                    _ => return Err(conflict("pack_invalid_source")),
                }
            };
            if bytes.len() as u64 != file.size || digest(&bytes) != file.hashes.sha256 {
                return Err(conflict("pack_integrity_failure"));
            }
            let target = stage.path().join(&file.path);
            std::fs::create_dir_all(target.parent().unwrap()).map_err(io)?;
            std::fs::write(target, bytes).map_err(io)?;
            files.insert(file.path, file.hashes.sha256);
        }
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
            consent_required: !executable_changes.is_empty(),
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

async fn download_provider(raw: &str) -> Result<Vec<u8>> {
    download_provider_limit(raw, FILE_LIMIT).await
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
async fn download_provider_limit(raw: &str, limit: u64) -> Result<Vec<u8>> {
    let mut url = url::Url::parse(raw).map_err(io)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(io)?;
    for _ in 0..6 {
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port_or_known_default() != Some(443)
            || url.fragment().is_some()
            || !matches!(
                url.host_str(),
                Some("cdn.modrinth.com" | "edge.forgecdn.net" | "mediafilez.forgecdn.net")
            )
        {
            return Err(conflict("pack_download_unavailable"));
        }
        let mut response = client.get(url.clone()).send().await.map_err(io)?;
        if response.status().is_redirection() {
            url = url
                .join(
                    response
                        .headers()
                        .get("location")
                        .and_then(|v| v.to_str().ok())
                        .ok_or_else(|| conflict("pack_download_unavailable"))?,
                )
                .map_err(io)?;
            continue;
        }
        if !response.status().is_success() || response.content_length().is_some_and(|n| n > limit) {
            return Err(conflict("pack_download_unavailable"));
        }
        let mut bytes = vec![];
        while let Some(chunk) = response.chunk().await.map_err(io)? {
            if bytes.len() + chunk.len() > limit as usize {
                return Err(conflict("pack_too_large"));
            }
            bytes.extend_from_slice(&chunk);
        }
        return Ok(bytes);
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
