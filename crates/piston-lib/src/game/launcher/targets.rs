use super::{
    arguments::build_game_arguments,
    types::{LaunchSpec, LaunchTarget},
    unified_manifest::UnifiedManifest,
};
use crate::game::{installer::types::OsType, metadata::ModloaderType};
use anyhow::{bail, Result};

/// Deliberately bounded to the release families reviewed for slice 1.
/// Fabric's Knot client forwards argv to the vanilla client entry point.
pub fn supports_quick_play(version: &str, loader: Option<ModloaderType>) -> bool {
    let parts: Vec<_> = version.split('.').collect();
    (parts.len() == 2 || parts.len() == 3)
        && parts
            .iter()
            .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
        && parts[0] == "1"
        && matches!(parts[1], "20" | "21")
        && matches!(
            loader,
            None | Some(ModloaderType::Vanilla | ModloaderType::Fabric)
        )
}

pub fn server_address(host: &str, port: Option<u16>) -> Result<String> {
    if host.is_empty()
        || host.trim() != host
        || host.chars().any(|c| c.is_whitespace() || c.is_control())
        || host.contains(['/', '\\', '[', ']'])
        || port == Some(0)
    {
        bail!("Invalid server host or port");
    }
    let ipv6 = host.parse::<std::net::Ipv6Addr>().is_ok();
    if host.contains(':') && !ipv6 {
        bail!("Host must not contain a port");
    }
    Ok(match (ipv6, port) {
        (true, Some(port)) => format!("[{host}]:{port}"),
        (true, None) => format!("[{host}]"),
        (false, Some(port)) => format!("{host}:{port}"),
        (false, None) => host.to_owned(),
    })
}

pub fn parse_server_address(address: &str) -> Result<LaunchTarget> {
    let (host, port) = if let Some(rest) = address.strip_prefix('[') {
        let (host, tail) = rest
            .split_once(']')
            .ok_or_else(|| anyhow::anyhow!("Invalid IPv6 address"))?;
        host.parse::<std::net::Ipv6Addr>()?;
        (
            host,
            if tail.is_empty() {
                None
            } else {
                Some(
                    tail.strip_prefix(':')
                        .ok_or_else(|| anyhow::anyhow!("Invalid port"))?
                        .parse::<u16>()?,
                )
            },
        )
    } else if address.matches(':').count() == 1 {
        let (host, port) = address.split_once(':').unwrap();
        (host, Some(port.parse::<u16>()?))
    } else {
        (address, None)
    };
    server_address(host, port)?;
    Ok(LaunchTarget::Server {
        host: host.into(),
        port,
    })
}

pub fn validate_target(spec: &LaunchSpec, manifest: &UnifiedManifest) -> Result<()> {
    let supported = supports_quick_play(&spec.version_id, spec.modloader);
    if spec.target != LaunchTarget::None && !supported {
        bail!("Direct launch is unsupported for this version/loader");
    }
    match &spec.target {
        LaunchTarget::World { folder } => {
            if folder.is_empty()
                || folder == "."
                || folder == ".."
                || folder.contains(['/', '\\', ':'])
                || folder.chars().any(char::is_control)
            {
                bail!("Invalid world folder");
            }
            let saves = dunce::canonicalize(spec.game_dir.join("saves"))?;
            let world = dunce::canonicalize(saves.join(folder))?;
            if !world.starts_with(&saves) || !world.is_dir() || !world.join("level.dat").is_file() {
                bail!("World is missing or outside this instance's saves");
            }
        }
        LaunchTarget::Server { host, port } => {
            server_address(host, *port)?;
        }
        LaunchTarget::Realm { id } if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) => {
            bail!("Invalid Realm id")
        }
        _ => {}
    }
    validate_target_arguments(spec, manifest)
}

/// Check the resolved argv, also used by the UI support query without accessing saves.
pub fn validate_target_arguments(spec: &LaunchSpec, manifest: &UnifiedManifest) -> Result<()> {
    let supported = supports_quick_play(&spec.version_id, spec.modloader);
    let args = build_game_arguments(spec, manifest, OsType::current());
    let expected = match &spec.target {
        LaunchTarget::None => None,
        LaunchTarget::World { folder } => Some(("--quickPlaySingleplayer", folder.clone())),
        LaunchTarget::Server { host, port } => {
            Some(("--quickPlayMultiplayer", server_address(host, *port)?))
        }
        LaunchTarget::Realm { id } => Some(("--quickPlayRealms", id.clone())),
    };
    for flag in [
        "--server",
        "--port",
        "--quickPlaySingleplayer",
        "--quickPlayMultiplayer",
        "--quickPlayRealms",
        "--quickPlayPath",
    ] {
        let values: Vec<_> = args
            .iter()
            .enumerate()
            .filter(|(_, a)| *a == flag || a.starts_with(&format!("{flag}=")))
            .collect();
        let wanted = if flag == "--quickPlayPath"
            && supported
            && (spec.target != LaunchTarget::None || !values.is_empty())
        {
            Some(
                spec.game_dir
                    .join(".vesta/quickplay.json")
                    .to_string_lossy()
                    .into_owned(),
            )
        } else {
            expected
                .as_ref()
                .filter(|(f, _)| *f == flag)
                .map(|(_, v)| v.clone())
        };
        if values.len() != usize::from(wanted.is_some()) {
            bail!("Conflicting or missing direct-launch argument: {flag}");
        }
        if let (Some((index, token)), Some(wanted)) = (values.first(), wanted) {
            if token.as_str() != flag || args.get(index + 1) != Some(&wanted) {
                bail!("Conflicting direct-launch value: {flag}");
            }
        }
    }
    Ok(())
}

/// Prepare the game's join log without allowing a redirected .vesta path.
pub fn prepare_quick_play_log(spec: &LaunchSpec) -> Result<()> {
    if !supports_quick_play(&spec.version_id, spec.modloader) {
        return Ok(());
    }
    let game = dunce::canonicalize(&spec.game_dir)?;
    let directory = spec.game_dir.join(".vesta");
    std::fs::create_dir_all(&directory)?;
    if !dunce::canonicalize(&directory)?.starts_with(&game) {
        bail!("Quick Play log directory is outside the instance");
    }
    let log = directory.join("quickplay.json");
    if let Ok(meta) = std::fs::symlink_metadata(&log) {
        if meta.file_type().is_symlink() || !dunce::canonicalize(&log)?.starts_with(&game) {
            bail!("Quick Play log is outside the instance");
        }
    }
    log::info!("Quick Play log: {}", log.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn addresses_and_support_matrix() {
        for (input, output) in [
            ("example.org", "example.org"),
            ("example.org:25566", "example.org:25566"),
            ("[::1]:25566", "[::1]:25566"),
            ("::1", "[::1]"),
        ] {
            let LaunchTarget::Server { host, port } = parse_server_address(input).unwrap() else {
                panic!()
            };
            assert_eq!(server_address(&host, port).unwrap(), output);
        }
        for bad in [
            "",
            "host:0",
            "host:65536",
            "[::1",
            "[::1]:bad",
            "host:25565:garbage",
            "host name",
            "host/path",
        ] {
            assert!(parse_server_address(bad).is_err(), "{bad}");
        }
        assert!(supports_quick_play("1.21.1", Some(ModloaderType::Fabric)));
        for version in ["1.19.4", "1.12.2", "23w14a", "1.21-pre1", "1.22"] {
            assert!(!supports_quick_play(version, None));
        }
        for loader in [
            ModloaderType::Forge,
            ModloaderType::NeoForge,
            ModloaderType::Quilt,
        ] {
            assert!(!supports_quick_play("1.21", Some(loader)));
        }
    }
}
