use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunPlan {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: HashMap<String, String>,
}

impl RunPlan {
    pub fn new(
        program: impl Into<PathBuf>,
        args: Vec<String>,
        cwd: impl Into<PathBuf>,
        env: HashMap<String, String>,
    ) -> Self {
        Self {
            program: program.into(),
            args,
            cwd: cwd.into(),
            env,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SandboxedSpawn {
    /// Use the original [`RunPlan`] unchanged (Trusted preset).
    Passthrough,
    /// OS adapter adjusted program/args/env and may require `pre_exec` hooks.
    Prepared {
        program: PathBuf,
        args: Vec<String>,
        env: HashMap<String, String>,
        cwd: PathBuf,
        pre_exec_notes: Vec<String>,
    },
}
