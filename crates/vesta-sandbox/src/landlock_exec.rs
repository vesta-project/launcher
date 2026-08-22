//! Landlock LSM helpers for Linux exec allowlisting.
//!
//! Bubblewrap confines filesystem visibility; Landlock adds kernel-enforced
//! execute allowlists matching macOS Seatbelt `process-exec*` semantics.

use std::collections::HashSet;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[cfg(target_os = "linux")]
use landlock::{
    AccessFs, BitFlags, CompatLevel, Compatible, PathBeneath, PathFd, RestrictionStatus, Ruleset,
    RulesetAttr, RulesetCreated, RulesetCreatedAttr, RulesetStatus,
};
#[cfg(target_os = "linux")]
use std::os::unix::process::CommandExt;

#[derive(Debug, thiserror::Error)]
pub enum LandlockExecError {
    #[error("Landlock is not supported on this host")]
    Unsupported,

    #[error("failed to canonicalize exec allowlist entry {path}: {source}")]
    Canonicalize {
        path: String,
        source: io::Error,
    },

    #[error("failed to open path for Landlock rule {path}: {source}")]
    OpenPath {
        path: String,
        #[source]
        source: Box<dyn std::error::Error + Send + Sync>,
    },

    #[error("Landlock ruleset error: {0}")]
    Ruleset(String),

    #[error("Landlock did not fully enforce exec rules")]
    NotFullyEnforced,

    #[error("missing `--` separator before target program")]
    MissingProgramSeparator,

    #[error("no target program provided after `--`")]
    MissingProgram,
}

/// Whether the running kernel exposes a usable Landlock exec ruleset.
pub fn landlock_available() -> bool {
    #[cfg(not(target_os = "linux"))]
    {
        return false;
    }

    #[cfg(target_os = "linux")]
    {
        landlock_available_linux()
    }
}

/// Resolved path to the `vesta-sandbox-exec` helper when present on Linux.
pub fn landlock_helper_path() -> Option<PathBuf> {
    #[cfg(not(target_os = "linux"))]
    {
        return None;
    }

    #[cfg(target_os = "linux")]
    {
        landlock_helper_path_linux()
    }
}

/// Whether Landlock exec enforcement can run (kernel support + helper binary).
pub fn landlock_enforcement_ready() -> bool {
    landlock_available() && landlock_helper_path().is_some()
}

/// Apply a Landlock execute allowlist to the current process.
pub fn apply_exec_allowlist(paths: &[PathBuf]) -> Result<RestrictionStatus, LandlockExecError> {
    #[cfg(not(target_os = "linux"))]
    {
        let _ = paths;
        Err(LandlockExecError::Unsupported)
    }

    #[cfg(target_os = "linux")]
    {
        apply_exec_allowlist_linux(paths)
    }
}

/// CLI entrypoint for the `vesta-sandbox-exec` helper binary.
pub fn run_landlock_exec_cli<I, S>(args: I) -> i32
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    #[cfg(not(target_os = "linux"))]
    {
        let _ = args;
        eprintln!("vesta-sandbox-exec is only supported on Linux");
        return 1;
    }

    #[cfg(target_os = "linux")]
    {
        run_landlock_exec_cli_linux(args)
    }
}

#[cfg(target_os = "linux")]
fn landlock_available_linux() -> bool {
    landlock_kernel_supported()
}

#[cfg(target_os = "linux")]
fn landlock_handled_access() -> BitFlags<AccessFs> {
    AccessFs::Execute | AccessFs::Refer
}

fn landlock_kernel_supported() -> bool {
    Ruleset::default()
        .set_compatibility(CompatLevel::HardRequirement)
        .handle_access(landlock_handled_access())
        .and_then(|ruleset| ruleset.create())
        .is_ok()
}

#[cfg(target_os = "linux")]
fn landlock_helper_path_linux() -> Option<PathBuf> {
    if let Some(path) = option_env!("CARGO_BIN_EXE_vesta_sandbox_exec").map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }

    if let Some(path) = option_env!("VESTA_SANDBOX_EXEC").map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }

    if let Ok(path) = std::env::var("VESTA_SANDBOX_EXEC") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in [
                "vesta-sandbox-exec",
                "vesta-sandbox-exec-x86_64-unknown-linux-gnu",
            ] {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    for profile in ["debug", "release"] {
        let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../target")
            .join(profile)
            .join("vesta-sandbox-exec");
        if candidate.is_file() {
            return candidate.canonicalize().ok();
        }
    }

    which::which("vesta-sandbox-exec").ok()
}

#[cfg(target_os = "linux")]
fn apply_exec_allowlist_linux(paths: &[PathBuf]) -> Result<RestrictionStatus, LandlockExecError> {
    if !landlock_kernel_supported() {
        return Err(LandlockExecError::Unsupported);
    }

    let mut ruleset: RulesetCreated = Ruleset::default()
        .set_compatibility(CompatLevel::HardRequirement)
        .handle_access(landlock_handled_access())
        .map_err(|err| LandlockExecError::Ruleset(err.to_string()))?
        .create()
        .map_err(|err| LandlockExecError::Ruleset(err.to_string()))?;

    let mut expanded = Vec::new();
    for path in paths {
        expanded.push(path.clone());
        if path.is_file() {
            if let Some(interpreter) = elf_interpreter(path) {
                expanded.push(interpreter);
            }
        }
    }

    let mut seen = HashSet::new();
    for path in expanded {
        let canonical = path.canonicalize().map_err(|source| LandlockExecError::Canonicalize {
            path: path.display().to_string(),
            source,
        })?;
        for (rule_path, access) in exec_rule_entries(&canonical) {
            if !seen.insert(rule_path.clone()) {
                continue;
            }
            let fd = PathFd::new(&rule_path).map_err(|source| LandlockExecError::OpenPath {
                path: rule_path.display().to_string(),
                source: Box::new(source),
            })?;
            ruleset = ruleset
                .add_rule(PathBeneath::new(fd, access))
                .map_err(|err| LandlockExecError::Ruleset(err.to_string()))?;
        }
    }

    let status = ruleset
        .restrict_self()
        .map_err(|err| LandlockExecError::Ruleset(err.to_string()))?;

    if status.ruleset != RulesetStatus::FullyEnforced {
        return Err(LandlockExecError::NotFullyEnforced);
    }

    Ok(status)
}

#[cfg(target_os = "linux")]
fn exec_rule_entries(path: &Path) -> Vec<(PathBuf, BitFlags<AccessFs>)> {
    let mut entries = Vec::new();
    if path.is_dir() {
        entries.push((path.to_path_buf(), (AccessFs::Execute | AccessFs::Refer).into()));
        return entries;
    }

    for ancestor in path.ancestors() {
        if ancestor.as_os_str().is_empty() {
            continue;
        }
        if ancestor == path {
            entries.push((path.to_path_buf(), AccessFs::Execute.into()));
        } else {
            entries.push((ancestor.to_path_buf(), AccessFs::Refer.into()));
        }
    }

    entries
}

#[cfg(target_os = "linux")]
fn elf_interpreter(path: &Path) -> Option<PathBuf> {
    const PT_INTERP: u32 = 3;
    let data = std::fs::read(path).ok()?;
    if data.len() < 64 || data.get(0..4)? != b"\x7fELF" || data[4] != 2 {
        return None;
    }
    let le = data[5] == 1;
    let read_u16 = |offset: usize| -> Option<u16> {
        let bytes: [u8; 2] = data.get(offset..offset + 2)?.try_into().ok()?;
        Some(if le {
            u16::from_le_bytes(bytes)
        } else {
            u16::from_be_bytes(bytes)
        })
    };
    let read_u32 = |offset: usize| -> Option<u32> {
        let bytes: [u8; 4] = data.get(offset..offset + 4)?.try_into().ok()?;
        Some(if le {
            u32::from_le_bytes(bytes)
        } else {
            u32::from_be_bytes(bytes)
        })
    };
    let read_u64 = |offset: usize| -> Option<u64> {
        let bytes: [u8; 8] = data.get(offset..offset + 8)?.try_into().ok()?;
        Some(if le {
            u64::from_le_bytes(bytes)
        } else {
            u64::from_be_bytes(bytes)
        })
    };

    let e_phoff = read_u64(32)?;
    let e_phentsize = read_u16(54)? as u64;
    let e_phnum = read_u16(56)? as u64;
    for index in 0..e_phnum {
        let header = e_phoff + index * e_phentsize;
        if read_u32(header as usize)? != PT_INTERP {
            continue;
        }
        let offset = read_u64(header as usize + 8)? as usize;
        let filesz = read_u64(header as usize + 32)? as usize;
        let bytes = data.get(offset..offset.saturating_add(filesz))?;
        let nul = bytes.iter().position(|byte| *byte == 0)?;
        return Some(PathBuf::from(std::str::from_utf8(&bytes[..nul]).ok()?));
    }
    None
}

#[cfg(target_os = "linux")]
fn run_landlock_exec_cli_linux<I, S>(args: I) -> i32
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    let args: Vec<String> = args.into_iter().map(|arg| arg.as_ref().to_string()).collect();
    let mut allowlist = Vec::new();
    let mut program_start = None;

    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--exec-allow" => {
                index += 1;
                let Some(path) = args.get(index) else {
                    eprintln!("missing path after --exec-allow");
                    return 2;
                };
                allowlist.push(PathBuf::from(path));
            }
            "--" => {
                program_start = Some(index + 1);
                break;
            }
            other => {
                eprintln!("unexpected argument `{other}`");
                return 2;
            }
        }
        index += 1;
    }

    let Some(program_index) = program_start else {
        eprintln!("{}", LandlockExecError::MissingProgramSeparator);
        return 2;
    };

    let Some(program) = args.get(program_index) else {
        eprintln!("{}", LandlockExecError::MissingProgram);
        return 2;
    };

    if allowlist.is_empty() {
        eprintln!("at least one --exec-allow path is required");
        return 2;
    }

    let helper = landlock_helper_path_linux()
        .or_else(|| std::env::current_exe().ok())
        .unwrap_or_else(|| PathBuf::from(program));
    if !allowlist.iter().any(|path| {
        path.canonicalize()
            .ok()
            .is_some_and(|canonical| canonical == helper)
    }) {
        allowlist.push(helper);
    }

    if let Err(err) = apply_exec_allowlist_linux(&allowlist) {
        eprintln!("Landlock exec allowlist failed: {err}");
        return 1;
    }

    let program_args: Vec<&str> = args[program_index..].iter().map(String::as_str).collect();
    let err = Command::new(program)
        .args(&program_args[1..])
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .exec();

    eprintln!(
        "failed to exec {}: {err}",
        program_args.first().unwrap_or(&"<missing>")
    );
    1
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::process::Command;

    fn helper_path() -> Option<PathBuf> {
        landlock_helper_path_linux()
    }

    #[test]
    fn landlock_available_matches_ruleset_creation() {
        assert_eq!(landlock_available(), landlock_available_linux());
    }

    #[test]
    fn apply_exec_allowlist_denies_unlisted_program() {
        if !landlock_available_linux() {
            return;
        }
        let helper = helper_path().expect("vesta-sandbox-exec must be built for Landlock tests");

        let status = Command::new(&helper)
            .args([
                "--exec-allow",
                "/bin/true",
                "--exec-allow",
                &helper.to_string_lossy(),
                "--",
                "/bin/sh",
                "-c",
                "exit 0",
            ])
            .status()
            .unwrap();

        assert!(
            !status.success(),
            "Landlock allowlist incorrectly permitted /bin/sh"
        );
    }

    #[test]
    fn apply_exec_allowlist_denies_curl_when_only_java_allowed() {
        if !landlock_available_linux() {
            return;
        }
        let helper = helper_path().expect("vesta-sandbox-exec must be built for Landlock tests");
        let curl = ["/usr/bin/curl", "/bin/curl"]
            .iter()
            .map(Path::new)
            .find(|path| path.is_file());
        let Some(curl) = curl else {
            return;
        };

        let status = Command::new(&helper)
            .args([
                "--exec-allow",
                "/usr/bin/java",
                "--exec-allow",
                &helper.to_string_lossy(),
                "--",
                curl.to_str().unwrap(),
                "--version",
            ])
            .status()
            .unwrap();

        assert!(
            !status.success(),
            "Landlock allowlist incorrectly permitted {}",
            curl.display()
        );
    }

    #[test]
    fn apply_exec_allowlist_permits_listed_program() {
        if !landlock_available_linux() {
            return;
        }
        let helper = helper_path().expect("vesta-sandbox-exec must be built for Landlock tests");

        let status = Command::new(&helper)
            .args([
                "--exec-allow",
                "/bin/true",
                "--exec-allow",
                &helper.to_string_lossy(),
                "--",
                "/bin/true",
            ])
            .status()
            .unwrap();

        assert!(
            status.success(),
            "Landlock allowlist blocked /bin/true unexpectedly"
        );
    }
}
