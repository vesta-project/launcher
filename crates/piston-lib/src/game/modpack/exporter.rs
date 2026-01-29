use std::fs::File;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::{ZipWriter, write::FileOptions};
use anyhow::Result;
use serde_json::json;
use sha2::{Sha512, Digest};
use sha1::Sha1;

use crate::game::modpack::types::ModpackFormat;
use crate::game::installer::types::ProgressReporter;

fn calculate_hashes(path: &Path) -> Result<(String, String)> {
    let mut file = File::open(path)?;
    let mut sha1 = Sha1::new();
    let mut sha512 = Sha512::new();
    let mut buffer = [0; 8192];
    
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 { break; }
        sha1.update(&buffer[..count]);
        sha512.update(&buffer[..count]);
    }
    
    Ok((
        format!("{:x}", sha1.finalize()),
        format!("{:x}", sha512.finalize())
    ))
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct ExportSpec {
    pub name: String,
    pub version: String,
    pub author: String,
    pub description: Option<String>,
    pub minecraft_version: String,
    pub modloader_type: String,
    pub modloader_version: String,
    pub entries: Vec<ExportEntry>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub enum ExportEntry {
    Mod {
        path: PathBuf, // Relative to instance root
        source_id: String, // Modrinth/CurseForge ID
        version_id: String,
        platform: Option<ModpackFormat>,
        download_url: Option<String>,
        external_ids: Option<std::collections::HashMap<String, String>>,
    },
    Override {
        path: PathBuf, // Relative to instance root
    },
}

pub fn export_modpack<P: AsRef<Path>>(
    instance_root: P,
    spec: ExportSpec,
    output_path: P,
    format: ModpackFormat,
    reporter: &dyn ProgressReporter,
) -> Result<()> {
    let instance_root = instance_root.as_ref();
    let file = File::create(output_path.as_ref())?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    match format {
        ModpackFormat::Modrinth => {
            export_modrinth(instance_root, spec, &mut zip, options, reporter)?;
        }
        ModpackFormat::CurseForge => {
            export_curseforge(instance_root, spec, &mut zip, options, reporter)?;
        }
    }

    zip.finish()?;
    reporter.set_percent(100);
    Ok(())
}

fn export_modrinth<W: Write + std::io::Seek>(
    instance_root: &Path,
    spec: ExportSpec,
    zip: &mut ZipWriter<W>,
    options: FileOptions<()>,
    reporter: &dyn ProgressReporter,
) -> Result<()> {
    reporter.set_message("Generating Modrinth manifest...");
    let mut index = json!({
        "formatVersion": 1,
        "game": "minecraft",
        "versionId": spec.version,
        "name": spec.name,
        "summary": spec.description.as_deref().unwrap_or("Exported from Vesta Launcher"),
        "dependencies": {
            "minecraft": spec.minecraft_version,
        },
        "files": []
    });

    // Add modloader dependency
    let deps = index.get_mut("dependencies").unwrap().as_object_mut().unwrap();
    match spec.modloader_type.to_lowercase().as_str() {
        "fabric" => { deps.insert("fabric-loader".to_string(), json!(spec.modloader_version)); }
        "forge" => { deps.insert("forge".to_string(), json!(spec.modloader_version)); }
        "neoforge" => { deps.insert("neoforge".to_string(), json!(spec.modloader_version)); }
        "quilt" => { deps.insert("quilt-loader".to_string(), json!(spec.modloader_version)); }
        _ => {}
    }

    let files = index.get_mut("files").unwrap().as_array_mut().unwrap();
    let total_entries = spec.entries.len();

    for (i, entry) in spec.entries.into_iter().enumerate() {
        if reporter.is_cancelled() {
            return Err(anyhow::anyhow!("Export cancelled"));
        }

        let percent = (i as f32 / total_entries as f32 * 100.0) as i32;
        reporter.set_percent(percent);

        match entry {
            ExportEntry::Mod { path, download_url, platform, source_id, version_id, .. } => {
                let file_name = path.file_name().unwrap_or_default().to_string_lossy();
                
                let full_path = instance_root.join(&path);
                if !full_path.exists() {
                    continue;
                }

                // ONLY link if we have a known platform (Modrinth or CurseForge)
                // This prevents linking custom/manual files to Modrinth hash-fallback
                if let Some(source_platform) = platform {
                    match calculate_hashes(&full_path) {
                        Ok((sha1_hash, sha512_hash)) => {
                            reporter.set_message(&format!("Linking mod: {}", file_name));
                            
                            let file_size = full_path.metadata().map(|m| m.len()).unwrap_or(0);
                            let mut downloads = Vec::new();
                            
                            if let Some(url) = download_url {
                                downloads.push(json!(url));
                            }
                            
                            // Modrinth hash-based download
                            downloads.push(json!(format!("https://api.modrinth.com/v2/version_file/{}/download", sha1_hash)));
                            
                            // If it's a CurseForge mod, add its direct download link as well
                            if source_platform == ModpackFormat::CurseForge {
                                if let (Ok(pid), Ok(fid)) = (source_id.parse::<u32>(), version_id.parse::<u32>()) {
                                    downloads.push(json!(format!("https://www.curseforge.com/api/v1/mods/{}/files/{}/download", pid, fid)));
                                }
                            }

                            let file_entry = json!({
                                "path": path.to_string_lossy().replace("\\", "/"),
                                "hashes": {
                                    "sha1": sha1_hash,
                                    "sha512": sha512_hash
                                },
                                "downloads": downloads,
                                "fileSize": file_size,
                                "env": {
                                    "client": "required",
                                    "server": "required"
                                }
                            });

                            files.push(file_entry);
                            continue;
                        },
                        Err(_) => {
                            reporter.set_message(&format!("Adding to overrides (hash failed): {}", file_name));
                        }
                    }
                }

                // If no platform or hash failed, bundle as override
                reporter.set_message(&format!("Adding to overrides: {}", file_name));
                add_file_to_zip(instance_root, &path, "overrides", zip, options, reporter)?;
            }
            ExportEntry::Override { path } => {
                let file_name = path.file_name().unwrap_or_default().to_string_lossy();
                reporter.set_message(&format!("Adding override: {}", file_name));
                add_file_to_zip(instance_root, &path, "overrides", zip, options, reporter)?;
            }
        }
    }

    zip.start_file("modrinth.index.json", options)?;
    zip.write_all(serde_json::to_string_pretty(&index)?.as_bytes())?;

    Ok(())
}

fn export_curseforge<W: Write + std::io::Seek>(
    instance_root: &Path,
    spec: ExportSpec,
    zip: &mut ZipWriter<W>,
    options: FileOptions<()>,
    reporter: &dyn ProgressReporter,
) -> Result<()> {
    reporter.set_message("Generating CurseForge manifest...");
    let mut manifest = json!({
        "minecraft": {
            "version": spec.minecraft_version,
            "modLoaders": [
                {
                    "id": format!("{}-{}", spec.modloader_type, spec.modloader_version),
                    "primary": true
                }
            ]
        },
        "manifestType": "minecraftModpack",
        "manifestVersion": 1,
        "name": spec.name,
        "version": spec.version,
        "author": spec.author,
        "description": spec.description,
        "files": [],
        "overrides": "overrides"
    });

    let files = manifest.get_mut("files").unwrap().as_array_mut().unwrap();
    let total_entries = spec.entries.len();

    for (i, entry) in spec.entries.into_iter().enumerate() {
        if reporter.is_cancelled() {
            return Err(anyhow::anyhow!("Export cancelled"));
        }

        let percent = (i as f32 / total_entries as f32 * 100.0) as i32;
        reporter.set_percent(percent);

        match entry {
            ExportEntry::Mod { path, source_id, version_id, external_ids, .. } => {
                let file_name = path.file_name().unwrap_or_default().to_string_lossy();
                
                // If we have numeric IDs, try to link them (CurseForge requirement)
                let mut project_id = source_id.parse::<u32>().ok();
                
                // If not numeric, check external_ids for "curseforge"
                if project_id.is_none() {
                    if let Some(ref ext) = external_ids {
                        if let Some(cf_id_str) = ext.get("curseforge") {
                            project_id = cf_id_str.parse::<u32>().ok();
                        }
                    }
                }

                let file_id = version_id.parse::<u32>().ok();

                if let (Some(pid), Some(fid)) = (project_id, file_id) {
                    reporter.set_message(&format!("Linking CF mod: {}", file_name));
                    files.push(json!({
                        "projectID": pid,
                        "fileID": fid,
                        "required": true
                    }));
                } else {
                    reporter.set_message(&format!("Adding to overrides: {}", file_name));
                    add_file_to_zip(instance_root, &path, "overrides", zip, options, reporter)?;
                }
            }
            ExportEntry::Override { path } => {
                let file_name = path.file_name().unwrap_or_default().to_string_lossy();
                reporter.set_message(&format!("Adding override: {}", file_name));
                add_file_to_zip(instance_root, &path, "overrides", zip, options, reporter)?;
            }
        }
    }

    zip.start_file("manifest.json", options)?;
    zip.write_all(serde_json::to_string_pretty(&manifest)?.as_bytes())?;

    Ok(())
}

fn add_file_to_zip<W: Write + std::io::Seek>(
    instance_root: &Path,
    rel_path: &Path,
    zip_prefix: &str,
    zip: &mut ZipWriter<W>,
    options: FileOptions<()>,
    reporter: &dyn ProgressReporter,
) -> Result<()> {
    if reporter.is_cancelled() {
        return Err(anyhow::anyhow!("Export cancelled"));
    }

    let full_path = instance_root.join(rel_path);
    if !full_path.exists() { return Ok(()); }

    if full_path.is_dir() {
        for entry in std::fs::read_dir(full_path)? {
            let entry = entry?;
            let next_rel = rel_path.join(entry.file_name());
            add_file_to_zip(instance_root, &next_rel, zip_prefix, zip, options, reporter)?;
        }
    } else {
        let zip_path = Path::new(zip_prefix).join(rel_path);
        zip.start_file(zip_path.to_string_lossy().replace("\\", "/"), options)?;
        let mut f = File::open(full_path)?;
        std::io::copy(&mut f, zip)?;
    }
    
    Ok(())
}
