//! Reuse the instance archive parser and provider resolver; normalize their
//! verified files into a private Vesta index for the one diff/apply pipeline.
//! Bytes go straight to an on-disk review stage: provider modpacks routinely
//! exceed the in-memory archive bound (COBBLEVERSE ships a 215 MiB archive).
use super::*;
use piston_lib::game::{
    installer::core::modpack_installer::ModpackResolver,
    modpack::{parser::get_modpack_metadata, types::ModpackMod},
};
use serde_json::Value;

/// A normalized pack: its index (files already verified) and the stage holding them.
pub(super) struct Normalized {
    pub(super) index: Index,
    pub(super) stage: tempfile::TempDir,
    pub(super) files: BTreeMap<String, String>,
}

/// Verified staged files, keyed by their pack path, with the same alias and size
/// rules as the Vesta index.
struct Staged {
    stage: tempfile::TempDir,
    files: BTreeMap<String, (u64, String)>,
    total: u64,
    scratch: u64,
}
impl Staged {
    fn new() -> Result<Self> {
        Ok(Self { stage: tempfile::tempdir().map_err(io)?, files: BTreeMap::new(), total: 0, scratch: 0 })
    }
    /// A private scratch name outside every pack path (pack paths never start with '.').
    fn scratch(&mut self) -> PathBuf {
        self.scratch += 1;
        self.stage.path().join(format!(".download-{}", self.scratch))
    }
    /// Admit `path` (replacing it when `replace`), then move `from` into place.
    fn insert(&mut self, path: String, from: &Path, size: u64, sha256: String, replace: bool) -> Result<()> {
        if replace {
            if let Some((previous, _)) = self.files.remove(&path) {
                self.total -= previous;
            }
        }
        admit(&self.files, self.total, &path, size)?;
        let target = self.stage.path().join(&path);
        std::fs::create_dir_all(target.parent().unwrap()).map_err(io)?;
        std::fs::rename(from, &target).map_err(io)?;
        self.total += size;
        self.files.insert(path, (size, sha256));
        Ok(())
    }
    fn insert_bytes(&mut self, path: String, bytes: &[u8], replace: bool) -> Result<()> {
        safe_path(&path)?;
        let scratch = self.scratch();
        std::fs::write(&scratch, bytes).map_err(io)?;
        self.insert(path, &scratch, bytes.len() as u64, digest(bytes), replace)
    }
}

pub(super) async fn normalize(app: &AppHandle, release: &Release, archive: Vec<u8>, progress: Option<&crate::tasks::manager::TaskContext>) -> Result<Normalized> {
    let resources = app.state::<ResourceManager>();
    let mut staged = Staged::new()?;
    let source = staged.scratch();
    if release.format == "catalogue" {
        let value: Value =
            serde_json::from_slice(&archive).map_err(|_| conflict("pack_invalid_index"))?;
        if value["schemaVersion"] != 1 || value["content"]["mode"] != "platform" {
            return Err(conflict("pack_invalid_index"));
        }
        let platform = match value["content"]["platform"].as_str() {
            Some("modrinth") => crate::models::SourcePlatform::Modrinth,
            Some("curseforge") => crate::models::SourcePlatform::CurseForge,
            _ => return Err(conflict("pack_invalid_source")),
        };
        let project = value["content"]["projectId"]
            .as_str()
            .ok_or_else(|| conflict("pack_invalid_source"))?;
        let version = value["content"]["versionId"]
            .as_str()
            .ok_or_else(|| conflict("pack_invalid_source"))?;
        let p = resources.get_project(platform, project).await.map_err(io)?;
        if p.resource_type != crate::models::resource::ResourceType::Modpack {
            return Err(conflict("pack_invalid_source"));
        }
        let v = resources.get_version(platform, project, version).await.map_err(io)?;
        if let Some(ctx) = progress { ctx.update_description("Downloading modpack archive...".into()); }
        let archive_progress = progress.map(|ctx| ctx.with_overall_range(0, 20));
        download_provider_with_progress(&v.download_url, PROVIDER_ARCHIVE_LIMIT, &source, archive_progress.as_ref())
            .await?
            .verify(&v.hash)?;
    } else {
        std::fs::write(&source, &archive).map_err(io)?;
    }
    drop(archive);
    let mut zip = zip::ZipArchive::new(std::io::BufReader::new(
        std::fs::File::open(&source).map_err(io)?,
    ))
    .map_err(|_| conflict("pack_unsafe_archive"))?;
    if zip.len() > 16384 {
        return Err(conflict("pack_too_large"));
    }
    let mut seen = HashSet::new();
    let mut expanded = 0u64;
    for n in 0..zip.len() {
        let member = zip.by_index(n).map_err(io)?;
        if !seen.insert(member.name().to_lowercase())
            || member.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
        {
            return Err(conflict("pack_unsafe_archive"));
        }
        expanded = expanded
            .checked_add(member.size())
            .ok_or_else(|| conflict("pack_too_large"))?;
        if expanded > TOTAL_LIMIT || member.size() > FILE_LIMIT {
            return Err(conflict("pack_too_large"));
        }
        if matches!(member.name(), "modrinth.index.json" | "manifest.json")
            && member.size() > 1024 * 1024
        {
            return Err(conflict("pack_too_large"));
        }
    }
    // The shared parser determines Minecraft/loader identities and provider pins.
    let metadata = get_modpack_metadata(&source).map_err(|_| conflict("pack_invalid_index"))?;
    let override_folder = if seen.contains("manifest.json") {
        let manifest: Value =
            serde_json::from_slice(&read_member(&mut zip, "manifest.json", 1024 * 1024)?)
                .map_err(io)?;
        manifest["overrides"]
            .as_str()
            .unwrap_or("overrides")
            .to_owned()
    } else {
        "overrides".into()
    };
    if override_folder.is_empty()
        || override_folder.contains(['\\', ':'])
        || override_folder
            .split('/')
            .any(|p| p.is_empty() || p == "." || p == "..")
    {
        return Err(conflict("pack_unsafe_archive"));
    }
    // Reject unsupported override paths before any provider files are downloaded.
    for prefix in [format!("{override_folder}/"), "client-overrides/".into()] {
        for n in 0..zip.len() {
            let file = zip.by_index(n).map_err(io)?;
            if file.is_dir() { continue; }
            if let Some(path) = file.name().strip_prefix(&prefix) {
                safe_path(path).map_err(|error| {
                    log::warn!("[server-pack] unsupported override path: {:?}", path.chars().take(512).collect::<String>());
                    error
                })?;
            }
        }
    }
    let mut unsupported = HashSet::new();
    if seen.contains("modrinth.index.json") {
        let index: Value =
            serde_json::from_slice(&read_member(&mut zip, "modrinth.index.json", 1024 * 1024)?)
                .map_err(io)?;
        if let Some(files) = index["files"].as_array() {
            for file in files {
                if file["env"]["client"] == "unsupported" {
                    if let Some(path) = file["path"].as_str() {
                        unsupported.insert(path.to_owned());
                    }
                }
            }
        }
    }
    let resolver = crate::tasks::installers::modpack::PistonModpackResolver::new(app.clone());
    if let Some(ctx) = progress { ctx.set_stage("downloading_resources"); }
    let total = metadata.mods.len();
    let staged = std::sync::Mutex::new(staged);
    let completed = std::sync::atomic::AtomicUsize::new(0);
    let loader = &metadata.modloader_type;
    piston_lib::game::installer::core::batch::run_batch(
        metadata.mods,
        piston_lib::game::installer::core::batch::MODPACK_DOWNLOAD_CONCURRENCY,
        |entry| {
            let staged = &staged;
            let resources = &resources;
            let resolver = &resolver;
            let unsupported = &unsupported;
            let completed = &completed;
            async move {
                match entry {
                    ModpackMod::Modrinth {
                        path, hashes, size, ..
                    } => {
                        safe_path(&path)?;
                        if unsupported.contains(&path) {
                            return Ok(());
                        }
                        { let state = staged.lock().unwrap(); admit(&state.files, state.total, &path, size)?; }
                        let hash = hashes
                            .get("sha1")
                            .ok_or_else(|| conflict("pack_download_unavailable"))?;
                        let (project, version) = resources
                            .get_by_hash(crate::models::SourcePlatform::Modrinth, hash)
                            .await
                            .map_err(io)?;
                        compatible(&version, loader, path.starts_with("mods/"))?;
                        if project.environment.is_some_and(|e| {
                            e.client_requirement
                                == Some(crate::models::resource::SideRequirement::Unsupported)
                        }) {
                            return Err(conflict("pack_incompatible_runtime"));
                        }
                        let scratch = staged.lock().unwrap().scratch();
                        if let Some(ctx) = progress { ctx.set_file_name(&path); }
                        let got = download_provider_with_progress(&version.download_url, FILE_LIMIT, &scratch, None).await?;
                        if got.size != size {
                            return Err(conflict("pack_integrity_failure"));
                        }
                        let hash = hashes
                            .get("sha512")
                            .or_else(|| hashes.get("sha256"))
                            .or_else(|| hashes.get("sha1"))
                            .ok_or_else(|| conflict("pack_integrity_failure"))?;
                        got.verify(hash)?;
                        staged.lock().unwrap().insert(path, &scratch, got.size, got.sha256, false)?;
                    }
                    ModpackMod::CurseForge {
                        project_id,
                        file_id,
                        hash,
                        ..
                    } => {
                        let resolved = resolver
                            .resolve_curseforge(project_id, file_id, hash)
                            .await
                            .map_err(io)?;
                        let project = project_id.ok_or_else(|| conflict("pack_download_unavailable"))?;
                        let version = resources
                            .get_version(
                                crate::models::SourcePlatform::CurseForge,
                                &project.to_string(),
                                &file_id.to_string(),
                            )
                            .await
                            .map_err(io)?;
                        compatible(&version, loader, resolved.subfolder == "mods")?;
                        let path = format!("{}/{}", resolved.subfolder, resolved.filename);
                        safe_path(&path)?;
                        { let state = staged.lock().unwrap(); admit(&state.files, state.total, &path, 0)?; }
                        let sha1 = resolved
                            .sha1
                            .as_deref()
                            .filter(|h| !h.is_empty())
                            .ok_or_else(|| conflict("pack_download_unavailable"))?;
                        let scratch = staged.lock().unwrap().scratch();
                        if let Some(ctx) = progress { ctx.set_file_name(&path); }
                        let got = download_provider_with_progress(&resolved.url, FILE_LIMIT, &scratch, None).await?;
                        got.verify(sha1)?;
                        staged.lock().unwrap().insert(path, &scratch, got.size, got.sha256, false)?;
                    }
                }

                let done = completed.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                if let Some(ctx) = progress {
                    ctx.update_items(done as u64, Some(total as u64));
                    ctx.update_overall_progress(20 + (done * 70 / total.max(1)) as i32);
                    ctx.update_description(format!("Downloading modpack files ({}/{})", done, total));
                }
                Ok::<(), Error>(())
            }
        },
    ).await?;
    let mut staged = staged.into_inner().unwrap();
    // Match shared parser precedence: client overrides replace shared overrides.
    if let Some(ctx) = progress {
        ctx.set_stage("extracting");
        ctx.update_overall_progress(90);
        ctx.update_description("Extracting modpack files...".into());
    }
    for prefix in [format!("{override_folder}/"), "client-overrides/".into()] {
        let names: Vec<_> = (0..zip.len())
            .filter_map(|n| {
                zip.by_index(n)
                    .ok()
                    .filter(|f| !f.is_dir())
                    .map(|f| f.name().to_owned())
            })
            .filter(|n| n.starts_with(&prefix))
            .collect();
        let count = names.len();
        for (number, name) in names.into_iter().enumerate() {
            tokio::task::yield_now().await;
            if number % 25 == 0 {
                if let Some(ctx) = progress {
                    ctx.update_items(number as u64, Some(count as u64));
                    ctx.update_overall_progress(90 + (number * 10 / count.max(1)) as i32);
                }
            }
            let path = name.strip_prefix(&prefix).unwrap().to_owned();
            safe_path(&path)?;
            let scratch = staged.scratch();
            let (size, sha256) = copy_member(&mut zip, &name, &scratch)?;
            staged.insert(path, &scratch, size, sha256, true)?;
        }
    }
    drop(zip);
    let _ = std::fs::remove_file(&source);
    let files = staged.files.iter().map(|(path, (_, sha))| (path.clone(), sha.clone())).collect();
    let index = Index {
        format_version: 1,
        name: metadata.name.into(),
        revision: revision(&release.revision)?,
        minecraft_version: metadata.minecraft_version,
        modloader_type: Some(metadata.modloader_type),
        modloader_version: metadata.modloader_version,
        files: vec![],
    };
    Ok(Normalized { index, stage: staged.stage, files })
}
/// Stream one archive member to disk, enforcing the per-file bound and hashing it.
fn copy_member<R: Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
    target: &Path,
) -> Result<(u64, String)> {
    use sha2::Digest;
    let mut member = zip.by_name(name).map_err(|_| conflict("pack_missing_file"))?;
    if member.size() > FILE_LIMIT || member.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000) {
        return Err(conflict("pack_unsafe_archive"));
    }
    let mut out = std::fs::File::create(target).map_err(io)?;
    let mut hasher = sha2::Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024];
    let mut size = 0u64;
    let mut limited = member.by_ref().take(FILE_LIMIT + 1);
    loop {
        let n = limited.read(&mut buffer).map_err(io)?;
        if n == 0 {
            break;
        }
        size += n as u64;
        if size > FILE_LIMIT {
            return Err(conflict("pack_too_large"));
        }
        hasher.update(&buffer[..n]);
        out.write_all(&buffer[..n]).map_err(io)?;
    }
    Ok((size, hex::encode(hasher.finalize())))
}
/// A modpack pins exact provider files, so its own Minecraft version is authoritative:
/// files tagged only for a sibling release (e.g. `1.21` in a `1.21.1` pack) are what the
/// author shipped, and every ordinary provider install accepts them. Only reject mods
/// whose provider metadata positively names other loaders.
fn compatible(version: &crate::models::resource::ResourceVersion, loader: &str, is_mod: bool) -> Result<()> {
    if is_mod
        && !version.loaders.is_empty()
        && !crate::resources::manager::is_loader_compatible(&version.loaders, loader)
    {
        return Err(conflict("pack_incompatible_runtime"));
    }
    Ok(())
}
/// Alias, traversal, tree-collision, size and count rules for one more staged file.
fn admit(files: &BTreeMap<String, (u64, String)>, total: u64, path: &str, size: u64) -> Result<()> {
    safe_path(path)?;
    let lower = path.to_lowercase();
    if files.keys().any(|p| {
        let p = p.to_lowercase();
        p == lower || p.starts_with(&format!("{lower}/")) || lower.starts_with(&format!("{p}/"))
    }) {
        return Err(conflict("pack_file_collision"));
    }
    let total = total.checked_add(size).ok_or_else(|| conflict("pack_too_large"))?;
    if total > TOTAL_LIMIT || size > FILE_LIMIT || files.len() >= 4096 {
        return Err(conflict("pack_too_large"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn version(loaders: &[&str], games: &[&str]) -> crate::models::resource::ResourceVersion {
        serde_json::from_value(serde_json::json!({
            "id": "v", "project_id": "p", "version_number": "1", "game_versions": games,
            "loaders": loaders, "download_url": "https://cdn.modrinth.com/x.jar",
            "file_name": "x.jar", "release_type": "release", "hash": "", "dependencies": []
        }))
        .unwrap()
    }
    #[test]
    fn normalization_accepts_large_packs_and_still_bounds_entry_count() {
        let mut staged = Staged::new().unwrap();
        for n in 0..4096 {
            staged.insert_bytes(format!("mods/{n}.jar"), b"", false).unwrap();
        }
        assert_eq!(staged.files.len(), 4096);
        assert!(staged.insert_bytes("mods/overflow.jar".into(), b"", false).is_err());
    }
    #[test]
    fn provider_scale_files_are_admitted() {
        // COBBLEVERSE: a 130 MiB Cobblemon jar within 412 MiB of pinned mods.
        let files = BTreeMap::new();
        admit(&files, 412 * 1024 * 1024, "mods/Cobblemon-fabric-1.7.3+1.21.1.jar", 130 * 1024 * 1024).unwrap();
        let error = admit(&files, 0, "mods/huge.jar", FILE_LIMIT + 1).unwrap_err();
        assert_eq!(error.reason.as_deref(), Some("pack_too_large"));
        assert!(PROVIDER_ARCHIVE_LIMIT >= 215 * 1024 * 1024);
    }
    #[test]
    fn oversized_provider_content_is_too_large_not_unavailable() {
        let error = over_limit(FILE_LIMIT + 1, FILE_LIMIT).unwrap_err();
        assert_eq!(error.reason.as_deref(), Some("pack_too_large"));
        over_limit(FILE_LIMIT, FILE_LIMIT).unwrap();
    }
    #[test]
    fn pinned_modpack_files_follow_the_pack_runtime() {
        // Pinned by the pack author for 1.21.1 although the provider only tags 1.21.
        compatible(&version(&["fabric"], &["1.21"]), "fabric", true).unwrap();
        compatible(&version(&[], &["1.20.1"]), "fabric", false).unwrap();
        compatible(&version(&[], &[]), "fabric", true).unwrap();
        assert!(compatible(&version(&["forge"], &["1.21.1"]), "fabric", true).is_err());
    }
    #[test]
    fn downloaded_digests_verify_every_provider_hash_family() {
        use sha2::Digest;
        let got = Downloaded {
            size: 7,
            sha1: hex::encode(sha1::Sha1::digest(b"content")),
            sha256: digest(b"content"),
            sha512: hex::encode(sha2::Sha512::digest(b"content")),
        };
        for hash in [got.sha1.clone(), got.sha256.clone(), got.sha512.clone()] {
            got.verify(&hash).unwrap();
            got.verify(&hash.to_uppercase()).unwrap();
        }
        assert!(got.verify(&digest(b"changed")).is_err());
        assert!(got.verify("short").is_err());
    }
    #[test]
    fn staged_members_stream_to_disk_with_their_digest() {
        let mut bytes = Cursor::new(Vec::new());
        {
            let mut writer = zip::ZipWriter::new(&mut bytes);
            writer.start_file("overrides/config/a.toml", zip::write::SimpleFileOptions::default()).unwrap();
            writer.write_all(b"value = 1").unwrap();
            writer.finish().unwrap();
        }
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes.into_inner())).unwrap();
        let mut staged = Staged::new().unwrap();
        let scratch = staged.scratch();
        let (size, sha) = copy_member(&mut zip, "overrides/config/a.toml", &scratch).unwrap();
        assert_eq!((size, sha.as_str()), (9, digest(b"value = 1").as_str()));
        staged.insert("config/a.toml".into(), &scratch, size, sha, true).unwrap();
        assert_eq!(std::fs::read(staged.stage.path().join("config/a.toml")).unwrap(), b"value = 1");
        // Client overrides replace shared overrides in place.
        staged.insert_bytes("config/a.toml".into(), b"value = 2", true).unwrap();
        assert_eq!(staged.total, 9);
        assert_eq!(staged.files.len(), 1);
    }
    #[test]
    fn cobbleverse_licences_and_saved_servers_are_accepted_without_opening_unsafe_paths() {
        for path in ["COBBLEVERSE - Third-Party Licenses.pdf", "licenses/Accessories - License.txt", "servers.dat", "shaderpacks/pack/shaders/main.vsh"] {
            assert!(safe_path(path).is_ok(), "{path}");
        }
        for path in ["../escape.pdf", "licenses/../../escape.txt", "CON.pdf", "danger.exe", "config/../escape"] {
            assert!(safe_path(path).is_err(), "{path}");
        }
    }
    #[test]
    fn normalized_file_set_rejects_aliases_traversal_and_tree_collisions() {
        let mut staged = Staged::new().unwrap();
        staged.insert_bytes("mods/one.jar".into(), b"jar", false).unwrap();
        for path in ["mods/ONE.jar", "mods/one.jar/child", "mods/../escape"] {
            assert!(staged.insert_bytes(path.into(), b"", false).is_err());
        }
        assert_eq!(staged.files.len(), 1);
    }
}

pub(super) async fn details(app: &AppHandle, release: &Release, archive: Vec<u8>) -> Result<(piston_lib::game::modpack::types::ModpackMetadata, Vec<String>)> {
    let stage = tempfile::tempdir().map_err(io)?;
    let source = stage.path().join("pack.zip");
    let mut identity = None;
    if release.format == "catalogue" {
        let value: Value = serde_json::from_slice(&archive).map_err(|_| conflict("pack_invalid_index"))?;
        if value["schemaVersion"] != 1 || value["content"]["mode"] != "platform" { return Err(conflict("pack_invalid_index")); }
        let content = &value["content"];
        let platform = match content["platform"].as_str() { Some("modrinth") => crate::models::SourcePlatform::Modrinth, Some("curseforge") => crate::models::SourcePlatform::CurseForge, _ => return Err(conflict("pack_invalid_source")) };
        let project = content["projectId"].as_str().ok_or_else(|| conflict("pack_invalid_source"))?;
        let version = content["versionId"].as_str().ok_or_else(|| conflict("pack_invalid_source"))?;
        let resources = app.state::<ResourceManager>();
        identity = resources.get_project(platform, project).await.ok();
        let version = resources.get_version(platform, project, version).await.map_err(io)?;
        download_provider_to(&version.download_url, PROVIDER_ARCHIVE_LIMIT, &source).await?.verify(&version.hash)?;
    } else if matches!(release.format.as_str(), "zip" | "mrpack") {
        std::fs::write(&source, archive).map_err(io)?;
    } else { return Err(conflict("pack_format_unsupported")); }
    tokio::task::spawn_blocking(move || {
    let mut metadata = get_modpack_metadata(&source).map_err(|_| conflict("pack_invalid_index"))?;
    if let Some(project) = identity {
        metadata.name = project.name;
        metadata.author = (!project.author.is_empty()).then_some(project.author);
        metadata.description = (!project.summary.is_empty()).then_some(project.summary);
        metadata.icon_url = project.icon_url.or(metadata.icon_url);
    }
    let mut zip = zip::ZipArchive::new(std::fs::File::open(&source).map_err(io)?).map_err(io)?;
    let mut overrides = std::collections::BTreeSet::new();
    for index in 0..zip.len() {
        let file = zip.by_index(index).map_err(io)?;
        let name = file.name().strip_prefix(metadata.root_prefix.as_deref().unwrap_or("")).unwrap_or(file.name());
        if let Some(path) = name.strip_prefix("overrides/").or_else(|| name.strip_prefix("client-overrides/")) {
            if is_pack_resource(path) { overrides.insert(path.to_owned()); }
        }
    }
    Ok((metadata, overrides.into_iter().collect()))
    }).await.map_err(io)?
}
