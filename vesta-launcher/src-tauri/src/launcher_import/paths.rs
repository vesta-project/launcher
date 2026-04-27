use std::collections::HashSet;
use std::path::PathBuf;

use crate::launcher_import::types::LauncherKind;

pub fn candidate_paths_for_launcher(kind: LauncherKind) -> Vec<PathBuf> {
    let paths = match kind {
        LauncherKind::CurseforgeFlame => curseforge_paths(),
        LauncherKind::GDLauncher => gdlauncher_paths(),
        LauncherKind::Prism => prism_paths(),
        LauncherKind::MultiMC => multimc_paths(),
        LauncherKind::ATLauncher => atlauncher_paths(),
        LauncherKind::Ftb => ftb_paths(),
        LauncherKind::ModrinthApp => modrinth_paths(),
        LauncherKind::Technic => technic_paths(),
    };

    dedupe_paths(paths)
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for path in paths {
        let key = path.to_string_lossy().to_string();
        if seen.insert(key) {
            out.push(path);
        }
    }
    out
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

fn app_data_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(PathBuf::from)
}

fn local_app_data_dir() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
}

fn user_profile_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(PathBuf::from)
}

fn xdg_data_home_dir() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME").map(PathBuf::from)
}

fn linux_data_dirs_from_home() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Some(xdg) = xdg_data_home_dir() {
        out.push(xdg);
    }
    if let Some(home) = home_dir() {
        out.push(home.join(".local/share"));
    }
    out
}

fn modrinth_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();

    if let Some(appdata) = app_data_dir() {
        out.push(appdata.join("ModrinthApp"));
        out.push(appdata.join("Modrinth"));
        out.push(appdata.join("Modrinth/minecraft/Instances"));
    }

    if let Some(home) = home_dir() {
        out.push(home.join("Library/Application Support/ModrinthApp"));
        out.push(home.join("Library/Application Support/Modrinth"));
        out.push(home.join("Library/Application Support/Modrinth/minecraft/Instances"));
        out.push(home.join("Library/Application Support/theseus/profiles"));
        out.push(home.join("Library/Application Support/com.modrinth.theseus/profiles"));
    }

    for data_root in linux_data_dirs_from_home() {
        out.push(data_root.join("ModrinthApp"));
        out.push(data_root.join("Modrinth"));
        out.push(data_root.join("Modrinth/minecraft/Instances"));
        out.push(data_root.join("theseus/profiles"));
        out.push(data_root.join("com.modrinth.theseus/profiles"));
    }

    out
}

fn curseforge_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();

    if let Some(appdata) = app_data_dir() {
        out.push(appdata.join("CurseForge"));
        out.push(appdata.join("CurseForge/Instances"));
        out.push(appdata.join("CurseForge/Minecraft/Instances"));
        out.push(appdata.join("CurseForge/agent/GameInstances"));
    }

    if let Some(local_app_data) = local_app_data_dir() {
        out.push(local_app_data.join("CurseForge"));
        out.push(local_app_data.join("CurseForge/Instances"));
        out.push(local_app_data.join("CurseForge/Minecraft/Instances"));
        out.push(local_app_data.join("CurseForge/agent/GameInstances"));
    }

    if let Some(profile) = user_profile_dir() {
        out.push(profile.join("AppData/Roaming/CurseForge"));
        out.push(profile.join("AppData/Roaming/CurseForge/agent/GameInstances"));
        out.push(profile.join("AppData/Local/CurseForge"));
        out.push(profile.join("AppData/Local/CurseForge/agent/GameInstances"));
        out.push(profile.join("curseforge/minecraft/Instances"));
        out.push(profile.join("Documents/curseforge/minecraft/Instances"));
        out.push(profile.join("Documents/CurseForge/Minecraft/Instances"));
    }

    if let Some(home) = home_dir() {
        out.push(home.join("Library/Application Support/CurseForge"));
        out.push(home.join("Library/Application Support/CurseForge/Instances"));
        out.push(home.join("Library/Application Support/CurseForge/Minecraft/Instances"));
        out.push(home.join("Library/Application Support/CurseForge/agent/GameInstances"));
        out.push(home.join("curseforge/minecraft/Instances"));
        out.push(home.join("Documents/curseforge/minecraft/Instances"));
        out.push(home.join("Documents/CurseForge/Minecraft/Instances"));
        out.push(home.join("Applications/CurseForge/minecraft/Instances"));
    }

    out
}

fn gdlauncher_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();

    if let Some(appdata) = app_data_dir() {
        out.push(appdata.join("gdlauncher_carbon/data"));
        out.push(appdata.join("gdlauncher_carbon/data/instances"));
        out.push(appdata.join("gdlauncher_next/instances"));
        out.push(appdata.join("gdlauncher/instances"));
    }

    if let Some(home) = home_dir() {
        out.push(home.join("Library/Application Support/gdlauncher_carbon/data"));
        out.push(home.join("Library/Application Support/gdlauncher_carbon/data/instances"));
        out.push(home.join("Library/Application Support/gdlauncher_next/instances"));
        out.push(home.join("Library/Application Support/gdlauncher/instances"));
    }

    for data_root in linux_data_dirs_from_home() {
        out.push(data_root.join("gdlauncher_carbon/data"));
        out.push(data_root.join("gdlauncher_carbon/data/instances"));
        out.push(data_root.join("gdlauncher_next/instances"));
        out.push(data_root.join("gdlauncher/instances"));
    }

    out
}

fn prism_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();

    if let Some(appdata) = app_data_dir() {
        out.push(appdata.join("PrismLauncher/instances"));
    }

    if let Some(home) = home_dir() {
        out.push(home.join("Library/Application Support/PrismLauncher/instances"));
        out.push(home.join(".var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher/instances"));
        out.push(PathBuf::from("/Applications/PrismLauncher.app/Data/instances"));
        out.push(PathBuf::from("/Applications/PrismLauncher.app/Data"));
        out.push(PathBuf::from("/Applications/Prism Launcher.app/Data/instances"));
        out.push(PathBuf::from("/Applications/Prism Launcher.app/Data"));
    }

    for data_root in linux_data_dirs_from_home() {
        out.push(data_root.join("PrismLauncher/instances"));
    }

    out
}

fn multimc_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();

    if let Some(appdata) = app_data_dir() {
        out.push(appdata.join("MultiMC/instances"));
    }

    if let Some(home) = home_dir() {
        out.push(home.join("Library/Application Support/MultiMC/instances"));
        out.push(home.join(".local/share/multimc/instances"));
        out.push(PathBuf::from("/Applications/MultiMC.app/Data/instances"));
        out.push(PathBuf::from("/Applications/MultiMC.app/Data"));
    }

    for data_root in linux_data_dirs_from_home() {
        out.push(data_root.join("multimc/instances"));
        out.push(data_root.join("MultiMC/instances"));
    }

    out
}

fn atlauncher_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();

    if let Some(home) = home_dir() {
        out.push(home.join("Library/Application Support/ATLauncher/instances"));
        out.push(home.join("Library/Application Support/ATLauncher"));
        out.push(home.join(".atlauncher/instances"));
        out.push(home.join(".atlauncher"));
    }

    if let Some(appdata) = app_data_dir() {
        out.push(appdata.join("ATLauncher/instances"));
        out.push(appdata.join("ATLauncher"));
    }

    for data_root in linux_data_dirs_from_home() {
        out.push(data_root.join("atlauncher/instances"));
        out.push(data_root.join("atlauncher"));
        out.push(data_root.join("ATLauncher/instances"));
        out.push(data_root.join("ATLauncher"));
    }

    out.push(PathBuf::from("/Applications/ATLauncher.app/Contents/Java/instances"));
    out.push(PathBuf::from("/Applications/ATLauncher.app/Contents/Java"));
    out.push(PathBuf::from("/Applications/ATLauncher.app/Data/instances"));
    out.push(PathBuf::from("/Applications/ATLauncher.app/Data"));

    out
}

fn technic_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();

    if let Some(appdata) = app_data_dir() {
        out.push(appdata.join("technic"));
        out.push(appdata.join("technic/modpacks"));
    }

    if let Some(local_app_data) = local_app_data_dir() {
        out.push(local_app_data.join("technic"));
        out.push(local_app_data.join("technic/modpacks"));
    }

    if let Some(home) = home_dir() {
        out.push(home.join("Library/Application Support/technic"));
        out.push(home.join("Library/Application Support/Technic"));
        out.push(home.join("Library/Application Support/technic/modpacks"));
        out.push(home.join("Library/Application Support/Technic/modpacks"));
        out.push(home.join(".technic"));
        out.push(home.join(".technic/modpacks"));
    }

    for data_root in linux_data_dirs_from_home() {
        out.push(data_root.join("technic"));
        out.push(data_root.join("technic/modpacks"));
    }

    out
}

fn ftb_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();

    if let Some(local_app_data) = local_app_data_dir() {
        out.push(local_app_data.join(".ftba"));
    }

    if let Some(appdata) = app_data_dir() {
        out.push(appdata.join(".ftba"));
    }

    if let Some(home) = home_dir() {
        out.push(home.join("Library/Application Support/.ftba"));
        out.push(home.join(".ftba"));
    }

    out
}
