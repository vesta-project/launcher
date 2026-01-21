use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use zip::{ZipWriter, write::FileOptions};
use anyhow::Result;
use serde_json::json;

use crate::game::modpack::types::ModpackFormat;

pub struct ExportSpec {
    pub name: String,
    pub version: String,
    pub author: String,
    pub minecraft_version: String,
    pub modloader_type: String,
    pub modloader_version: String,
    pub entries: Vec<ExportEntry>,
}

pub enum ExportEntry {
    Mod {
        path: PathBuf, // Relative to instance root
        source_id: String, // Modrinth/CurseForge ID
        version_id: String,
        platform: ModpackFormat,
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
) -> Result<()> {
    let instance_root = instance_root.as_ref();
    let file = File::create(output_path.as_ref())?;
    let mut zip = ZipWriter::new(file);
    let options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    match format {
        ModpackFormat::Modrinth => {
            export_modrinth(instance_root, spec, &mut zip, options)?;
        }
        ModpackFormat::CurseForge => {
            export_curseforge(instance_root, spec, &mut zip, options)?;
        }
    }

    zip.finish()?;
    Ok(())
}

fn export_modrinth<W: Write + std::io::Seek>(
    instance_root: &Path,
    spec: ExportSpec,
    zip: &mut ZipWriter<W>,
    options: FileOptions<()>,
) -> Result<()> {
    let mut index = json!({
        "formatVersion": 1,
        "game": "minecraft",
        "versionId": spec.version,
        "name": spec.name,
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

    for entry in spec.entries {
        match entry {
            ExportEntry::Mod { path, platform, .. } => {
                if platform == ModpackFormat::Modrinth {
                    // In a real implementation, we'd fetch the direct download URLs and hashes here
                    // For now, we'll assume the caller provides them or we leave it for a "smart" exporter
                    files.push(json!({
                        "path": path.to_string_lossy(),
                        "hashes": {}, // Should be filled
                        "downloads": [], // Should be filled
                        "fileSize": 0
                    }));
                } else {
                    // CurseForge mods in a Modrinth pack must be in overrides
                    add_file_to_zip(instance_root, &path, "overrides", zip, options)?;
                }
            }
            ExportEntry::Override { path } => {
                add_file_to_zip(instance_root, &path, "overrides", zip, options)?;
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
) -> Result<()> {
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
        "files": [],
        "overrides": "overrides"
    });

    let files = manifest.get_mut("files").unwrap().as_array_mut().unwrap();

    for entry in spec.entries {
        match entry {
            ExportEntry::Mod { path, source_id, version_id, platform } => {
                if platform == ModpackFormat::CurseForge {
                    let project_id = source_id.parse::<u32>().unwrap_or(0);
                    let file_id = version_id.parse::<u32>().unwrap_or(0);
                    files.push(json!({
                        "projectID": project_id,
                        "fileID": file_id,
                        "required": true
                    }));
                } else {
                    add_file_to_zip(instance_root, &path, "overrides", zip, options)?;
                }
            }
            ExportEntry::Override { path } => {
                add_file_to_zip(instance_root, &path, "overrides", zip, options)?;
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
) -> Result<()> {
    let full_path = instance_root.join(rel_path);
    if !full_path.exists() { return Ok(()); }

    if full_path.is_dir() {
        for entry in std::fs::read_dir(full_path)? {
            let entry = entry?;
            let next_rel = rel_path.join(entry.file_name());
            add_file_to_zip(instance_root, &next_rel, zip_prefix, zip, options)?;
        }
    } else {
        let zip_path = Path::new(zip_prefix).join(rel_path);
        zip.start_file(zip_path.to_string_lossy().replace("\\", "/"), options)?;
        let mut f = File::open(full_path)?;
        std::io::copy(&mut f, zip)?;
    }
    
    Ok(())
}
