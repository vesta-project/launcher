use anyhow::{Context, Result};
use reqwest::Client;
use std::collections::HashMap;
use std::path::Path;
use tokio::process::Command;

use crate::game::installer::types::{InstallSpec, ModloaderType, ProgressReporter};
use crate::game::launcher::version_parser::{
    Arguments, Artifact, ExtractRules, Library, LibraryDownloads, Rule, VersionManifest,
};
use crate::game::metadata::{
    is_dummy_game_version, ModrinthArtifact, ModrinthLoaderProfile, ModrinthManifest,
    ModrinthProcessor, ModrinthSidedDataEntry,
};

pub async fn resolve_loader_profile(
    spec: &InstallSpec,
    reporter: std::sync::Arc<dyn ProgressReporter>,
    client: &Client,
) -> Result<ModrinthLoaderProfile> {
    let loader = spec
        .modloader
        .context("resolve_loader_profile called without modloader")?;

    if loader == ModloaderType::Vanilla {
        anyhow::bail!("resolve_loader_profile called for vanilla install")
    }

    reporter.set_message("Resolving modloader profile");
    let loader_slug = match loader {
        ModloaderType::Fabric => "fabric",
        ModloaderType::Quilt => "quilt",
        ModloaderType::Forge => "forge",
        ModloaderType::NeoForge => "neo",
        ModloaderType::Vanilla => unreachable!(),
    };

    let manifest_url = format!(
        "https://launcher-meta.modrinth.com/{}/v0/manifest.json",
        loader_slug
    );
    let manifest: ModrinthManifest = client
        .get(&manifest_url)
        .send()
        .await
        .with_context(|| format!("Failed to request {}", manifest_url))?
        .error_for_status()
        .with_context(|| format!("Manifest request failed: {}", manifest_url))?
        .json()
        .await
        .with_context(|| format!("Failed to parse manifest: {}", manifest_url))?;

    let selected = match loader {
        ModloaderType::Fabric | ModloaderType::Quilt => {
            let supports_version = manifest
                .game_versions
                .iter()
                .any(|gv| !is_dummy_game_version(&gv.id) && gv.id == spec.version_id);
            if !supports_version {
                anyhow::bail!(
                    "{} does not support Minecraft {}",
                    loader.as_str(),
                    spec.version_id
                );
            }

            let dummy = manifest
                .game_versions
                .iter()
                .find(|gv| is_dummy_game_version(&gv.id))
                .context("Loader manifest missing dummy loader list entry")?;

            if let Some(wanted) = spec.modloader_version.as_deref() {
                dummy
                    .loaders
                    .iter()
                    .find(|l| l.id == wanted)
                    .context(format!("Requested loader version not found: {}", wanted))?
            } else {
                dummy
                    .loaders
                    .iter()
                    .find(|l| l.stable)
                    .or_else(|| dummy.loaders.first())
                    .context("No loader versions available in manifest")?
            }
        }
        ModloaderType::Forge | ModloaderType::NeoForge => {
            let game_entry = manifest
                .game_versions
                .iter()
                .find(|gv| gv.id == spec.version_id)
                .context(format!(
                    "{} has no loaders for Minecraft {}",
                    loader.as_str(),
                    spec.version_id
                ))?;

            if let Some(wanted) = spec.modloader_version.as_deref() {
                game_entry
                    .loaders
                    .iter()
                    .find(|l| l.id == wanted)
                    .context(format!("Requested loader version not found: {}", wanted))?
            } else {
                game_entry
                    .loaders
                    .iter()
                    .find(|l| l.stable)
                    .or_else(|| game_entry.loaders.first())
                    .context("No loader versions available for this Minecraft version")?
            }
        }
        ModloaderType::Vanilla => unreachable!(),
    };

    reporter.set_message(&format!(
        "Fetching {} profile {}",
        loader.as_str(),
        selected.id
    ));
    let mut profile: ModrinthLoaderProfile = client
        .get(&selected.url)
        .send()
        .await
        .with_context(|| format!("Failed to request loader profile {}", selected.url))?
        .error_for_status()
        .with_context(|| format!("Loader profile request failed: {}", selected.url))?
        .json()
        .await
        .with_context(|| format!("Failed to parse loader profile: {}", selected.url))?;
    profile.resolve_placeholders(&spec.version_id);
    Ok(profile)
}

pub fn profile_to_version_manifest(
    profile: &ModrinthLoaderProfile,
    spec: &InstallSpec,
) -> VersionManifest {
    let arguments = profile
        .arguments
        .as_ref()
        .and_then(|v| serde_json::from_value::<Arguments>(v.clone()).ok());

    let libraries = profile
        .libraries
        .iter()
        .map(|lib| Library {
            name: lib.name.clone(),
            downloads: lib.downloads.as_ref().map(to_library_downloads),
            url: lib.url.clone(),
            rules: lib.rules.as_ref().map(|rules| {
                rules
                    .iter()
                    .filter_map(|r| serde_json::from_value::<Rule>(r.clone()).ok())
                    .collect()
            }),
            natives: lib.natives.clone(),
            extract: lib
                .extract
                .as_ref()
                .and_then(|v| serde_json::from_value::<ExtractRules>(v.clone()).ok()),
            include_in_classpath: lib.include_in_classpath,
        })
        .collect();

    VersionManifest {
        id: spec.installed_version_id(),
        main_class: profile.main_class.clone(),
        inherits_from: Some(profile.inherits_from.clone()),
        downloads: None,
        arguments,
        jvm_arguments: None,
        game_arguments: None,
        minecraft_arguments: profile.minecraft_arguments.clone(),
        libraries,
        asset_index: None,
        assets: None,
        java_version: None,
        version_type: profile.version_type.clone(),
        release_time: Some(profile.release_time.clone()),
        time: Some(profile.time.clone()),
        logging: None,
    }
}

pub async fn execute_loader_processors(
    spec: &InstallSpec,
    reporter: std::sync::Arc<dyn ProgressReporter>,
    processors: &[ModrinthProcessor],
    data: &HashMap<String, ModrinthSidedDataEntry>,
    _client: &Client,
) -> Result<()> {
    if spec.dry_run {
        return Ok(());
    }

    let java_bin = spec
        .java_path
        .clone()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "java".to_string());
    let side = "client";

    // Inject standard data entries like Modrinth's `processor_rules!` macro.
    // These are required by Forge/NeoForge processors to resolve paths.
    let mut data = data.clone();
    let libraries_dir = spec.libraries_dir();
    let client_jar = minecraft_jar_path(spec);
    data.entry("SIDE".to_string())
        .or_insert(ModrinthSidedDataEntry {
            client: "client".to_string(),
            server: String::new(),
        });
    data.entry("MINECRAFT_JAR".to_string())
        .or_insert(ModrinthSidedDataEntry {
            client: client_jar.to_string_lossy().to_string(),
            server: String::new(),
        });
    data.entry("MINECRAFT_VERSION".to_string())
        .or_insert(ModrinthSidedDataEntry {
            client: spec.version_id.clone(),
            server: String::new(),
        });
    data.entry("ROOT".to_string())
        .or_insert(ModrinthSidedDataEntry {
            client: spec.data_dir().to_string_lossy().to_string(),
            server: String::new(),
        });
    data.entry("LIBRARY_DIR".to_string())
        .or_insert(ModrinthSidedDataEntry {
            client: libraries_dir.to_string_lossy().to_string(),
            server: String::new(),
        });

    let mut step = 0u32;
    for processor in processors {
        if let Some(sides) = &processor.sides {
            if !sides.iter().any(|s| s == side) {
                continue;
            }
        }

        step += 1;
        reporter.set_substep(Some(&format!("Processor {}", step)), Some(step), None);

        let processor_jar = spec
            .libraries_dir()
            .join(crate::game::launcher::maven_to_path(&processor.jar)?);
        if !processor_jar.exists() {
            anyhow::bail!("Processor jar missing: {}", processor_jar.display());
        }

        // Build processor classpath: classpath entries + the processor jar itself
        let mut cp_entries: Vec<String> = processor
            .classpath
            .iter()
            .map(|cp| {
                crate::game::launcher::maven_to_path(cp)
                    .map(|p| spec.libraries_dir().join(p).to_string_lossy().to_string())
            })
            .collect::<std::result::Result<Vec<_>, _>>()?;
        cp_entries.push(processor_jar.to_string_lossy().to_string());
        let classpath = cp_entries.join(if cfg!(windows) { ";" } else { ":" });

        let mut cmd = Command::new(&java_bin);
        cmd.arg("-cp")
            .arg(&classpath)
            .arg(read_processor_main_class(processor, &processor_jar)?);

        // Resolve processor arguments using the same logic as Modrinth's
        // `args::get_processor_arguments()` — supports [maven:coords] library
        // references and recursive {KEY} → value resolution.
        let resolved_args =
            resolve_processor_arguments(&spec.libraries_dir(), &processor.args, &data)?;
        for arg in &resolved_args {
            cmd.arg(arg);
        }
        cmd.current_dir(spec.data_dir());

        let status = cmd
            .status()
            .await
            .with_context(|| format!("Failed to execute processor {}", processor.jar))?;
        if !status.success() {
            anyhow::bail!("Processor failed: {} (status: {})", processor.jar, status);
        }
    }

    Ok(())
}

fn to_library_downloads(
    downloads: &crate::game::metadata::ModrinthLibraryDownloads,
) -> LibraryDownloads {
    LibraryDownloads {
        artifact: downloads.artifact.as_ref().map(to_artifact),
        classifiers: downloads.classifiers.as_ref().map(|map| {
            map.iter()
                .map(|(k, v)| (k.clone(), to_artifact(v)))
                .collect::<HashMap<_, _>>()
        }),
    }
}

fn to_artifact(artifact: &ModrinthArtifact) -> Artifact {
    Artifact {
        path: artifact.path.clone(),
        url: Some(artifact.url.clone()),
        sha1: Some(artifact.sha1.clone()),
        size: Some(artifact.size),
    }
}

fn read_processor_main_class(processor: &ModrinthProcessor, jar_path: &Path) -> Result<String> {
    if let Some(main_class) = &processor.main_class {
        return Ok(main_class.clone());
    }

    let file = std::fs::File::open(jar_path)
        .with_context(|| format!("Failed to open processor jar: {}", jar_path.display()))?;
    let mut archive = zip::ZipArchive::new(file)
        .with_context(|| format!("Failed to read processor jar: {}", jar_path.display()))?;
    let mut manifest = archive
        .by_name("META-INF/MANIFEST.MF")
        .context("Processor jar missing META-INF/MANIFEST.MF")?;
    let mut contents = String::new();
    use std::io::Read;
    manifest.read_to_string(&mut contents)?;

    for line in contents.lines() {
        if let Some(main) = line.strip_prefix("Main-Class:") {
            return Ok(main.trim().to_string());
        }
    }

    anyhow::bail!(
        "Processor {} has no mainClass and jar manifest has no Main-Class",
        processor.jar
    )
}

/// Resolve processor arguments matching Modrinth's `args::get_processor_arguments()`.
///
/// Handles:
/// - `[maven:coords]` -> resolved library path
/// - `{KEY}` -> replaced with data value (which may itself be a `[maven:coords]` ref)
fn resolve_processor_arguments(
    libraries_path: &std::path::Path,
    arguments: &[impl AsRef<str>],
    data: &HashMap<String, ModrinthSidedDataEntry>,
) -> Result<Vec<String>> {
    arguments
        .iter()
        .map(|arg| {
            let arg = arg.as_ref();
            // If the entire argument is a library reference in brackets,
            // resolve it to the library's file path.
            if let Some(lib_key) = arg.strip_prefix('[').and_then(|a| a.strip_suffix(']')) {
                return Ok(resolve_library_path(libraries_path, lib_key));
            }

            let mut resolved = arg.to_string();
            // Replace {KEY} placeholders with their client-side values.
            // If a value is itself a [maven:coords] reference, resolve it too.
            for (key, entry) in data {
                let replacement = if let Some(lib_key) = entry
                    .client
                    .strip_prefix('[')
                    .and_then(|v| v.strip_suffix(']'))
                {
                    resolve_library_path(libraries_path, lib_key)
                } else {
                    entry.client.clone()
                };
                let token = format!("{{{}}}", key);
                resolved = resolved.replace(&token, &replacement);
            }
            Ok(resolved)
        })
        .collect::<Result<Vec<_>>>()
}

/// Resolve a Maven coordinate string to its on-disk library path.
/// Returns the path as-is if the file doesn't exist (the processor may create it).
fn resolve_library_path(libraries_path: &std::path::Path, maven_coords: &str) -> String {
    match crate::game::launcher::maven_to_path(maven_coords) {
        Ok(rel_path) => {
            let full = libraries_path.join(&rel_path);
            full.to_string_lossy().to_string()
        }
        Err(_) => maven_coords.to_string(),
    }
}

fn minecraft_jar_path(spec: &InstallSpec) -> std::path::PathBuf {
    let installed = spec.installed_version_id();
    spec.versions_dir()
        .join(&installed)
        .join(format!("{}.jar", installed))
}
