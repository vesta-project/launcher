// TODO: Verify the paths are correct on Windows and Linux.

use std::collections::HashSet;
use std::path::PathBuf;

use directories::BaseDirs;

use crate::launcher_import::types::LauncherKind;

#[derive(Clone, Copy)]
enum BaseKind {
    Data,
    #[cfg(target_os = "windows")]
    LocalData,
    Home,
    Absolute(&'static str),
}

#[derive(Clone, Copy)]
struct PathPreset {
    base: BaseKind,
    relative: &'static [&'static str],
}

const fn data_preset(relative: &'static [&'static str]) -> PathPreset {
    PathPreset {
        base: BaseKind::Data,
        relative,
    }
}

#[cfg(target_os = "windows")]
const fn local_data_preset(relative: &'static [&'static str]) -> PathPreset {
    PathPreset {
        base: BaseKind::LocalData,
        relative,
    }
}

const fn home_preset(relative: &'static [&'static str]) -> PathPreset {
    PathPreset {
        base: BaseKind::Home,
        relative,
    }
}

const fn absolute_preset(path: &'static str) -> PathPreset {
    PathPreset {
        base: BaseKind::Absolute(path),
        relative: &[],
    }
}

pub fn candidate_paths_for_launcher(kind: LauncherKind) -> Vec<PathBuf> {
    let paths = build_paths(match kind {
        LauncherKind::CurseforgeFlame => curseforge_presets(),
        LauncherKind::GDLauncher => gdlauncher_presets(),
        LauncherKind::Prism => prism_presets(),
        LauncherKind::MultiMC => multimc_presets(),
        LauncherKind::ATLauncher => atlauncher_presets(),
        LauncherKind::Ftb => ftb_presets(),
        LauncherKind::ModrinthApp => modrinth_presets(),
        LauncherKind::Technic => technic_presets(),
    });

    dedupe_paths(filter_existing_paths(paths))
}

fn build_paths(presets: &[PathPreset]) -> Vec<PathBuf> {
    let mut out = Vec::new();

    for preset in presets {
        let Some(base_dir) = resolve_base_dir(preset.base) else {
            continue;
        };

        if preset.relative.is_empty() {
            out.push(base_dir);
            continue;
        }

        for relative in preset.relative {
            out.push(base_dir.join(relative));
        }
    }

    out
}

fn resolve_base_dir(base: BaseKind) -> Option<PathBuf> {
    let base_dirs = BaseDirs::new()?;

    Some(match base {
        BaseKind::Data => base_dirs.data_dir().to_path_buf(),
        #[cfg(target_os = "windows")]
        BaseKind::LocalData => base_dirs.data_local_dir().to_path_buf(),
        BaseKind::Home => base_dirs.home_dir().to_path_buf(),
        BaseKind::Absolute(path) => PathBuf::from(path),
    })
}

fn filter_existing_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    paths.into_iter().filter(|path| path.is_dir()).collect()
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();

    for path in paths {
        let key = normalize_path_for_dedup(&path);
        if seen.insert(key) {
            out.push(path);
        }
    }

    out
}

fn normalize_path_for_dedup(path: &PathBuf) -> String {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        path.to_string_lossy().to_lowercase()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        path.to_string_lossy().to_string()
    }
}

const MODRINTH_PRESETS: &[PathPreset] = &[
    data_preset(&["ModrinthApp"]),
    data_preset(&["com.modrinth.theseus"]),
];

fn modrinth_presets() -> &'static [PathPreset] {
    MODRINTH_PRESETS
}

const CURSEFORGE_PRESETS: &[PathPreset] = &[data_preset(&["CurseForge"])];

fn curseforge_presets() -> &'static [PathPreset] {
    CURSEFORGE_PRESETS
}

const GDLAUNCHER_PRESETS: &[PathPreset] = &[
    data_preset(&["gdlauncher_carbon"]),
    data_preset(&["gdlauncher_next"]),
    data_preset(&["gdlauncher"]),
];

fn gdlauncher_presets() -> &'static [PathPreset] {
    GDLAUNCHER_PRESETS
}

const PRISM_PRESETS: &[PathPreset] = &[
    data_preset(&["PrismLauncher"]),
    #[cfg(target_os = "macos")]
    absolute_preset("/Applications/PrismLauncher.app"),
    #[cfg(target_os = "macos")]
    absolute_preset("/Applications/Prism Launcher.app"),
];

fn prism_presets() -> &'static [PathPreset] {
    PRISM_PRESETS
}

// MultiMC doesn't have a consistent data directory across platforms
// It is always stored with the app when you download it.
// So we can only reliably find it on MacOS, where it's most likely in /Applications.

const MULTIMC_PRESETS: &[PathPreset] = &[
    #[cfg(target_os = "macos")]
    absolute_preset("/Applications/MultiMC.app"),
];

fn multimc_presets() -> &'static [PathPreset] {
    MULTIMC_PRESETS
}

const ATLAUNCHER_PRESETS: &[PathPreset] = &[
    #[cfg(target_os = "macos")]
    absolute_preset("/Applications/ATLauncher.app"),
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    home_preset(&[".atlauncher"]),
    data_preset(&["ATLauncher"]),
    #[cfg(target_os = "linux")]
    data_preset(&["atlauncher"]),
];

fn atlauncher_presets() -> &'static [PathPreset] {
    ATLAUNCHER_PRESETS
}

// TODO: Cleanup technic
const TECHNIC_PRESETS: &[PathPreset] = &[
    #[cfg(target_os = "macos")]
    data_preset(&["technic"]),
    #[cfg(target_os = "linux")]
    home_preset(&[".technic"]),
    #[cfg(target_os = "windows")]
    data_preset(&[".technic"]),
];

fn technic_presets() -> &'static [PathPreset] {
    TECHNIC_PRESETS
}

const FTB_PRESETS: &[PathPreset] = &[
    data_preset(&[".ftba"]),
    #[cfg(target_os = "macos")]
    home_preset(&[".ftba"]),
    #[cfg(target_os = "windows")]
    local_data_preset(&[".ftba"]),
];

fn ftb_presets() -> &'static [PathPreset] {
    FTB_PRESETS
}

#[cfg(test)]
mod tests {
    use super::{build_paths, dedupe_paths, filter_existing_paths, BaseKind, PathPreset};
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn filter_existing_paths_keeps_only_dirs() {
        let temp_dir = tempfile::tempdir().expect("tempdir");
        let existing = temp_dir.path().join("existing");
        fs::create_dir_all(&existing).expect("create dir");

        let paths = vec![existing.clone(), temp_dir.path().join("missing")];

        let filtered = filter_existing_paths(paths);
        assert_eq!(filtered, vec![existing]);
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn dedupe_paths_collapses_case_variants_on_case_insensitive_platforms() {
        let paths = vec![
            PathBuf::from("/tmp/CurseForge"),
            PathBuf::from("/tmp/curseforge"),
        ];

        let deduped = dedupe_paths(paths);
        assert_eq!(deduped, vec![PathBuf::from("/tmp/CurseForge")]);
    }

    #[test]
    fn build_paths_joins_relative_segments() {
        let presets = [PathPreset {
            base: BaseKind::Absolute("/tmp"),
            relative: &["example/path"],
        }];

        let paths = build_paths(&presets);
        assert_eq!(paths, vec![PathBuf::from("/tmp/example/path")]);
    }
}
