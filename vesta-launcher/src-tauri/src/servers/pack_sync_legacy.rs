//! Reuse the instance archive parser and provider resolver; normalize their
//! verified files into a private Vesta index for the one diff/apply pipeline.
use super::*;
use piston_lib::game::{
    installer::core::modpack_installer::ModpackResolver,
    modpack::{parser::get_modpack_metadata, types::ModpackMod},
};
use serde_json::{json, Value};

pub(super) async fn normalize(
    app: &AppHandle,
    release: &Release,
    mut archive: Vec<u8>,
) -> Result<Vec<u8>> {
    let resources = app.state::<ResourceManager>();
    if release.format == "catalogue" {
        let value: Value =
            serde_json::from_slice(&archive).map_err(|_| conflict("pack_invalid_index"))?;
        if value["schemaVersion"] != 1 || value["content"]["mode"] != "platform" {
            return Err(conflict("pack_invalid_index"));
        }
        let source = match value["content"]["platform"].as_str() {
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
        let p = resources.get_project(source, project).await.map_err(io)?;
        if p.resource_type != crate::models::resource::ResourceType::Modpack {
            return Err(conflict("pack_invalid_source"));
        }
        let v = resources
            .get_version(source, project, version)
            .await
            .map_err(io)?;
        archive = download_provider_limit(
            &v.download_url,
            vesta_server_client::pack_sync::MAX_ARCHIVE as u64,
        )
        .await?;
        verify_hash(&archive, &v.hash)?;
    }
    let temp = tempfile::NamedTempFile::new().map_err(io)?;
    std::fs::write(temp.path(), &archive).map_err(io)?;
    let mut zip = zip::ZipArchive::new(Cursor::new(archive.as_slice()))
        .map_err(|_| conflict("pack_unsafe_archive"))?;
    if zip.len() > 4097 {
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
    let metadata = get_modpack_metadata(temp.path()).map_err(|_| conflict("pack_invalid_index"))?;
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
    let mut files: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    let mut total = 0u64;
    for entry in metadata.mods {
        let (path, bytes) = match entry {
            ModpackMod::Modrinth {
                path, hashes, size, ..
            } => {
                safe_path(&path)?;
                if unsupported.contains(&path) {
                    continue;
                }
                let hash = hashes
                    .get("sha1")
                    .ok_or_else(|| conflict("pack_download_unavailable"))?;
                let (project, version) = resources
                    .get_by_hash(crate::models::SourcePlatform::Modrinth, hash)
                    .await
                    .map_err(io)?;
                compatible(
                    &version,
                    &metadata.minecraft_version,
                    &metadata.modloader_type,
                    path.starts_with("mods/"),
                )?;
                if project.environment.is_some_and(|e| {
                    e.client_requirement
                        == Some(crate::models::resource::SideRequirement::Unsupported)
                }) {
                    return Err(conflict("pack_incompatible_runtime"));
                }
                let bytes = download_provider(&version.download_url).await?;
                if bytes.len() as u64 != size {
                    return Err(conflict("pack_integrity_failure"));
                }
                let hash = hashes
                    .get("sha512")
                    .or_else(|| hashes.get("sha256"))
                    .or_else(|| hashes.get("sha1"))
                    .ok_or_else(|| conflict("pack_integrity_failure"))?;
                verify_hash(&bytes, hash)?;
                (path, bytes)
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
                compatible(
                    &version,
                    &metadata.minecraft_version,
                    &metadata.modloader_type,
                    resolved.subfolder == "mods",
                )?;
                let bytes = download_provider(&resolved.url).await?;
                verify_hash(
                    &bytes,
                    resolved
                        .sha1
                        .as_deref()
                        .filter(|h| !h.is_empty())
                        .ok_or_else(|| conflict("pack_download_unavailable"))?,
                )?;
                (
                    format!("{}/{}", resolved.subfolder, resolved.filename),
                    bytes,
                )
            }
        };
        insert(&mut files, &mut total, path, bytes)?;
    }
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
    // Match shared parser precedence: client overrides replace shared overrides.
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
        for name in names {
            let path = name.strip_prefix(&prefix).unwrap();
            safe_path(path)?;
            let bytes = read_member(&mut zip, &name, FILE_LIMIT)?;
            if let Some(previous) = files.remove(path) {
                total -= previous.len() as u64;
            }
            insert(&mut files, &mut total, path.into(), bytes)?;
        }
    }
    let index_files:Vec<_>=files.iter().map(|(path,bytes)|json!({"path":path,"size":bytes.len(),"hashes":{"sha256":digest(bytes)},"env":{"client":"required"},"source":{"type":"embedded"}})).collect();
    let index = json!({"formatVersion":1,"name":metadata.name,"revision":revision(&release.revision)?,"minecraftVersion":metadata.minecraft_version,"modloaderType":metadata.modloader_type,"modloaderVersion":metadata.modloader_version,"files":index_files});
    let index = serde_json::to_vec(&index).map_err(io)?;
    if index.len() > 1024 * 1024 {
        return Err(conflict("pack_too_large"));
    }
    let mut output = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    output.start_file("vesta.index.json", options).map_err(io)?;
    output.write_all(&index).map_err(io)?;
    for (path, bytes) in files {
        output
            .start_file(format!("overrides/{path}"), options)
            .map_err(io)?;
        output.write_all(&bytes).map_err(io)?;
    }
    let bytes = output.finish().map_err(io)?.into_inner();
    if bytes.len() > vesta_server_client::pack_sync::MAX_ARCHIVE {
        return Err(conflict("pack_too_large"));
    }
    Ok(bytes)
}
fn compatible(
    version: &crate::models::resource::ResourceVersion,
    mc: &str,
    loader: &str,
    is_mod: bool,
) -> Result<()> {
    if !version.game_versions.iter().any(|v| v == mc)
        || is_mod && !crate::resources::manager::is_loader_compatible(&version.loaders, loader)
    {
        return Err(conflict("pack_incompatible_runtime"));
    }
    Ok(())
}
fn insert(
    files: &mut BTreeMap<String, Vec<u8>>,
    total: &mut u64,
    path: String,
    bytes: Vec<u8>,
) -> Result<()> {
    safe_path(&path)?;
    let lower = path.to_lowercase();
    if files.keys().any(|p| {
        let p = p.to_lowercase();
        p == lower || p.starts_with(&format!("{lower}/")) || lower.starts_with(&format!("{p}/"))
    }) {
        return Err(conflict("pack_file_collision"));
    }
    *total += bytes.len() as u64;
    if *total > TOTAL_LIMIT || bytes.len() as u64 > FILE_LIMIT || files.len() >= 4096 {
        return Err(conflict("pack_too_large"));
    }
    files.insert(path, bytes);
    Ok(())
}
fn verify_hash(bytes: &[u8], hash: &str) -> Result<()> {
    use sha2::Digest;
    let actual = match hash.len() {
        40 => hex::encode(sha1::Sha1::digest(bytes)),
        64 => digest(bytes),
        128 => hex::encode(sha2::Sha512::digest(bytes)),
        _ => return Err(conflict("pack_integrity_failure")),
    };
    if !actual.eq_ignore_ascii_case(hash) {
        return Err(conflict("pack_integrity_failure"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalization_accepts_large_packs_and_still_bounds_entry_count() {
        let mut files = BTreeMap::new();
        let mut total = 0;
        for n in 0..4096 {
            insert(&mut files, &mut total, format!("mods/{n}.jar"), vec![]).unwrap();
        }
        assert_eq!(files.len(), 4096);
        assert!(insert(&mut files, &mut total, "mods/overflow.jar".into(), vec![]).is_err());
    }
    #[test]
    fn legacy_hashes_are_verified_before_ownership_is_derived() {
        use sha2::Digest;
        for hash in [
            hex::encode(sha1::Sha1::digest(b"content")),
            digest(b"content"),
            hex::encode(sha2::Sha512::digest(b"content")),
        ] {
            verify_hash(b"content", &hash).unwrap();
            assert!(verify_hash(b"changed", &hash).is_err());
        }
        assert!(verify_hash(b"content", "short").is_err());
    }
    #[test]
    fn normalized_file_set_rejects_aliases_traversal_and_tree_collisions() {
        let mut files = BTreeMap::new();
        let mut total = 0;
        insert(
            &mut files,
            &mut total,
            "mods/one.jar".into(),
            b"jar".to_vec(),
        )
        .unwrap();
        for path in ["mods/ONE.jar", "mods/one.jar/child", "mods/../escape"] {
            assert!(insert(&mut files, &mut total, path.into(), vec![]).is_err());
        }
        assert_eq!(files.len(), 1);
    }
}
